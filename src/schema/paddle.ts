import type { CountryCode } from '@paddle/paddle-node-sdk';
import type { AuthContext } from '../Context';
import {
  coreProductCustomDataSchema,
  getPriceFromPaddleItem,
  paddleInstance,
} from '../common/paddle';
import type { IResolvers } from '@graphql-tools/utils';
import { traceResolvers } from './trace';
import { SubscriptionCycles } from '../paddle';
import {
  ExperimentAllocationClient,
  getUserGrowthBookInstance,
} from '../growthbook';
import { User } from '../entity';
import { remoteConfig } from '../remoteConfig';
import { getCurrencySymbol, ONE_HOUR_IN_SECONDS } from '../common';
import { generateStorageKey, StorageKey, StorageTopic } from '../config';
import { getRedisObject, setRedisObjectWithExpiry } from '../redis';
import {
  DEFAULT_PLUS_METADATA,
  getPaddleMonthlyPrice,
  getPlusPricePreview,
  getPlusPricingMetadata,
  PLUS_FEATURE_KEY,
  PlusPricingMetadata,
  PlusPricingPreview,
  removeNumbers,
} from '../common/paddle/pricing';
import { PricingPreview } from '@paddle/paddle-node-sdk/dist/types/entities/pricing-preview';
import { createHmac } from 'node:crypto';

export const typeDefs = /* GraphQL */ `
  """
  Price amounts
  """
  type PriceAmounts {
    """
    Price amount
    """
    amount: Float!
    """
    Formatted price
    """
    formatted: String!
    """
    Monthly price amount
    """
    monthlyAmount: Float!
    """
    Formatted monthly price
    """
    monthlyFormatted: String
  }

  """
  Trial period
  """
  type TrialPeriod {
    """
    Trial period
    """
    interval: String
    """
    Trial period unit
    """
    frequency: Int
  }

  """
  Price details for a product
  """
  type Price {
    """
    Label of the price
    """
    label: String!
    """
    Id of the price
    """
    value: String!
    """
    Formatted price with currency symbol
    """
    price: PriceAmounts!
    """
    Three letter currency code (e.g. USD, EUR)
    """
    currencyCode: String
    """
    Currency symbol
    """
    currencySymbol: String
    """
    Optional additional label text
    """
    extraLabel: String
    """
    Apps id
    """
    appsId: String!
    """
    Subscription duration
    """
    duration: String!
    """
    Trial period
    """
    trialPeriod: TrialPeriod

    """
    Number of cores
    """
    coresValue: Int
  }

  """
  Price previews
  """
  type PricePreviews {
    """
    Three letter currency code
    """
    currencyCode: String!
    """
    Price previews
    """
    items: [Price!]!
  }

  extend type Query {
    pricePreviews: PricePreviews! @auth
    corePricePreviews: PricePreviews! @auth
    plusPricingMetadata(variant: String): [PlusPricingMetadata!]! @auth
    plusPricingPreview: [PlusPricingPreview!]! @auth
  }

  """
  Caption information for pricing metadata
  """
  type PricingCaption {
    """
    Caption text
    """
    copy: String!
    """
    Caption color
    """
    color: String!
  }

  """
  ID mapping for different platforms
  """
  type PricingIdMap {
    """
    Paddle platform ID
    """
    paddle: String
    """
    iOS platform ID
    """
    ios: String
  }

  """
  Plus pricing metadata information
  """
  type PlusPricingMetadata {
    """
    Application ID
    """
    appsId: String!
    """
    Title of the pricing option
    """
    title: String!
    """
    Optional caption information
    """
    caption: PricingCaption
    """
    Platform-specific IDs
    """
    idMap: PricingIdMap!
  }

  """
  Price preview information
  """
  type PricePreview {
    """
    Price amount
    """
    amount: Float!
    """
    Formatted price string
    """
    formatted: String!

    """
    Monthly price amount
    """
    monthly: PricePreview
  }

  """
  Currency information
  """
  type Currency {
    """
    Three letter currency code
    """
    code: String!
    """
    Currency symbol
    """
    symbol: String!
  }

  """
  Extended pricing preview with additional information
  """
  type PlusPricingPreview {
    """
    Metadata information
    """
    metadata: PlusPricingMetadata!
    """
    Price ID
    """
    priceId: String!
    """
    Price information
    """
    price: PricePreview!
    """
    Currency information
    """
    currency: Currency!
    """
    Subscription duration
    """
    duration: String!
    """
    Trial period information
    """
    trialPeriod: TrialPeriod
  }
`;

export interface GQLCustomData {
  appsId: string;
  label: string;
}

interface PlusMetadataArgs {
  variant?: string;
}

export const resolvers: IResolvers<unknown, AuthContext> = traceResolvers<
  unknown,
  AuthContext
>({
  Query: {
    pricePreviews: async (_, __, ctx: AuthContext) => {
      const region = ctx.region;

      const user = await ctx.con.getRepository(User).findOneOrFail({
        where: { id: ctx.userId },
        select: {
          createdAt: true,
        },
      });

      const growthbookClient = getUserGrowthBookInstance(ctx.userId, {
        enableDevMode: process.env.NODE_ENV !== 'production',
        subscribeToChanges: false,
        attributes: {
          registrationDate: user.createdAt.toISOString(),
        },
      });

      const featureValue: Record<string, string> =
        growthbookClient.getFeatureValue('pricing_ids', {});

      const hmac = createHmac('sha1', StorageTopic.Paddle);
      hmac.update(Object.keys(featureValue).sort().toString());
      const pricesHash = hmac.digest().toString('hex');

      const redisKey = generateStorageKey(
        StorageTopic.Paddle,
        StorageKey.PricingPreviewPlus,
        [pricesHash, region].join(':'),
      );

      let pricePreview: PricingPreview;

      const redisResult = await getRedisObject(redisKey);

      if (redisResult) {
        pricePreview = JSON.parse(redisResult);
      } else {
        pricePreview = await paddleInstance?.pricingPreview.preview({
          items: Object.keys(featureValue).map((priceId) => ({
            priceId,
            quantity: 1,
          })),
          address: region ? { countryCode: region as CountryCode } : undefined,
        });

        await setRedisObjectWithExpiry(
          redisKey,
          JSON.stringify(pricePreview),
          1 * ONE_HOUR_IN_SECONDS,
        );
      }

      const items = pricePreview?.details?.lineItems.map((item) => {
        const isOneOff = !item.price?.billingCycle?.interval;
        const isYearly = item.price?.billingCycle?.interval === 'year';
        const duration =
          isOneOff || isYearly
            ? SubscriptionCycles.Yearly
            : SubscriptionCycles.Monthly;
        const priceAmount = getPriceFromPaddleItem(item);
        const months = duration === SubscriptionCycles.Yearly ? 12 : 1;
        const monthlyPrice = Number(
          (priceAmount / months).toString().match(/^-?\d+(?:\.\d{0,2})?/)?.[0],
        );
        const currencyCode = pricePreview?.currencyCode;
        const currencySymbol = item.formattedTotals.total.replace(
          /\d|\.|\s|,/g,
          '',
        );
        const customData = item.price.customData as GQLCustomData;
        const priceFormatter = new Intl.NumberFormat('en-US', {
          minimumFractionDigits: 2,
        });

        return {
          label: item.price.name,
          value: item.price.id,
          price: {
            amount: priceAmount,
            formatted: item.formattedTotals.total,
            monthlyAmount: monthlyPrice,
            monthlyFormatted: `${currencySymbol}${priceFormatter.format(
              monthlyPrice,
            )}`,
          },
          currencyCode,
          currencySymbol,
          extraLabel: customData?.label,
          appsId: customData?.appsId ?? 'default',
          duration,
          trialPeriod: item.price.trialPeriod,
        };
      });

      return {
        currencyCode: pricePreview?.currencyCode as string,
        items,
      };
    },
    plusPricingMetadata: async (
      _,
      { variant = DEFAULT_PLUS_METADATA }: PlusMetadataArgs,
      ctx: AuthContext,
    ): Promise<PlusPricingMetadata[]> =>
      getPlusPricingMetadata(ctx.con, variant),
    plusPricingPreview: async (_, __, ctx): Promise<PlusPricingPreview[]> => {
      const user = await ctx.con.getRepository(User).findOneOrFail({
        where: { id: ctx.userId },
        select: { createdAt: true },
      });
      const allocationClient = new ExperimentAllocationClient();
      const gb = getUserGrowthBookInstance(ctx.userId, {
        subscribeToChanges: false,
        attributes: { registrationDate: user.createdAt.toISOString() },
        allocationClient,
      });
      const variant = gb.getFeatureValue(
        PLUS_FEATURE_KEY,
        DEFAULT_PLUS_METADATA,
      );
      const metadata = await getPlusPricingMetadata(ctx.con, variant);
      const ids = metadata
        .map(({ idMap }) => idMap.paddle)
        .filter(Boolean) as string[];

      const preview = await getPlusPricePreview(ctx, ids);

      // consolidate the preview data and metadata
      const consolidated = metadata.map((meta) => {
        const item = preview.details.lineItems.find(
          (item) => item.price.id === meta.idMap.paddle,
        );

        if (!item) {
          return null;
        }

        const isOneOff = !item.price.billingCycle?.interval;
        const isYearly = item.price.billingCycle?.interval === 'year';
        const duration =
          isOneOff || isYearly
            ? SubscriptionCycles.Yearly
            : SubscriptionCycles.Monthly;
        const baseAmount = getPriceFromPaddleItem(item);
        const monthly =
          item.price.billingCycle?.interval === 'year'
            ? getPaddleMonthlyPrice(baseAmount, item)
            : null;
        const trialPeriod = item.price.trialPeriod;

        return {
          metadata: meta,
          priceId: item.price.id,
          price: {
            monthly,
            amount: baseAmount,
            formatted: item.formattedTotals.total,
          },
          currency: {
            code: preview.currencyCode,
            symbol: removeNumbers(item.formattedTotals.total),
          },
          duration,
          trialPeriod,
        } as PlusPricingPreview;
      });

      return consolidated.filter(Boolean) as PlusPricingPreview[];
    },
    corePricePreviews: async (_, __, ctx: AuthContext) => {
      const region = ctx.region;

      const corePaddleProductId = remoteConfig.vars.coreProductId;

      const redisKey = generateStorageKey(
        StorageTopic.Paddle,
        StorageKey.PricingPreviewCores,
        [corePaddleProductId, region].join(':'),
      );

      const redisResult = await getRedisObject(redisKey);

      if (redisResult) {
        const cachedResult = JSON.parse(redisResult);

        return cachedResult;
      }

      if (!corePaddleProductId) {
        throw new Error('Core product id is not set in remote config');
      }

      const paddleProduct = await paddleInstance?.products.get(
        corePaddleProductId,
        {
          include: ['prices'],
        },
      );

      const pricePreview = await paddleInstance?.pricingPreview.preview({
        items: (paddleProduct.prices || [])
          .filter((item) => item.status === 'active')
          .map((price) => ({
            priceId: price.id,
            quantity: 1,
          })),
        address: region ? { countryCode: region as CountryCode } : undefined,
      });

      const items = pricePreview.details.lineItems.map((item) => {
        const currencyCode = pricePreview?.currencyCode;
        const currencySymbol = getCurrencySymbol({
          locale: 'en-US',
          currency: currencyCode,
        });
        const customData = coreProductCustomDataSchema.parse(
          item.price.customData,
        );

        return {
          label: item.price.name,
          value: item.price.id,
          price: {
            amount: item.price.unitPrice.amount,
            formatted: item.formattedTotals.total,
            // just for current schema compatibility
            monthlyAmount: item.price.unitPrice.amount,
            monthlyFormatted: item.formattedTotals.total,
          },
          currencyCode,
          currencySymbol,
          appsId: 'cores',
          duration: 'one-time',
          trialPeriod: null,
          coresValue: customData.cores,
        };
      });
      items.sort((a, b) => a.coresValue - b.coresValue);

      const result = {
        currencyCode: pricePreview?.currencyCode as string,
        items,
      };

      await setRedisObjectWithExpiry(
        redisKey,
        JSON.stringify(result),
        1 * ONE_HOUR_IN_SECONDS,
      );

      return result;
    },
  },
});
