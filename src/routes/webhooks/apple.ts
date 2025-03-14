import { readFile } from 'node:fs/promises';
import { env } from 'node:process';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { logger } from '../../logger';
import {
  Environment,
  NotificationTypeV2,
  SignedDataVerifier,
  Subtype,
  VerificationException,
  type JWSRenewalInfoDecodedPayload,
  type ResponseBodyV2DecodedPayload,
} from '@apple/app-store-server-library';
import { isTest } from '../../common';
import { isInSubnet } from 'is-in-subnet';
import { isNullOrUndefined } from '../../common/object';
import createOrGetConnection from '../../db';
import {
  UserSubscriptionStatus,
  SubscriptionProvider,
  User,
  type UserSubscriptionFlags,
} from '../../entity';
import { JsonContains } from 'typeorm';
import { SubscriptionCycles } from '../../paddle';
import { updateStoreKitUserSubscription } from '../../plusSubscription';

const certificatesToLoad = isTest
  ? ['__tests__/fixture/testCA.der']
  : [
      '/usr/local/share/ca-certificates/AppleIncRootCertificate.cer',
      '/usr/local/share/ca-certificates/AppleRootCA-G2.cer',
      '/usr/local/share/ca-certificates/AppleRootCA-G3.cer',
    ];

const loadAppleRootCAs = async (): Promise<Buffer[]> => {
  const appleRootCAs: Buffer[] = await Promise.all(
    certificatesToLoad.map(async (certPath) => await readFile(certPath)),
  );

  logger.debug(`Loaded ${appleRootCAs.length} Apple's Root CAs`);
  return appleRootCAs;
};

const getVerifierEnvironment = (): Environment => {
  switch (env.NODE_ENV) {
    case 'production':
      return Environment.PRODUCTION;
    case 'development':
      return Environment.SANDBOX;
    case 'test':
      return Environment.LOCAL_TESTING;
    default:
      throw new Error("Invalid 'NODE_ENV' value");
  }
};

const bundleId = isTest ? 'dev.fylla' : env.APPLE_APP_BUNDLE_ID;
const appAppleId = parseInt(env.APPLE_APP_APPLE_ID);
const enableOnlineChecks = true;
const environment = getVerifierEnvironment();

const allowedIPs = [
  '127.0.0.1/24',
  '192.168.0.0/16',
  '172.16.0.0/12',
  '10.0.0.0/8',
  '17.0.0.0/8',
];

interface AppleNotificationRequest {
  signedPayload: string;
}

const productIdToCycle = {
  annualSpecial: SubscriptionCycles.Yearly,
  annual: SubscriptionCycles.Yearly,
  monthly: SubscriptionCycles.Monthly,
};

const renewalInfoToSubscriptionFlags = (
  data: JWSRenewalInfoDecodedPayload,
): UserSubscriptionFlags => {
  const cycle =
    productIdToCycle[data.autoRenewProductId as keyof typeof productIdToCycle];

  if (isNullOrUndefined(cycle)) {
    logger.error(
      { data, provider: SubscriptionProvider.AppleStoreKit },
      'Invalid auto renew product ID',
    );
    throw new Error('Invalid auto renew product ID');
  }

  return {
    cycle,
    subscriptionId: data.originalTransactionId,
    createdAt: new Date(data.recentSubscriptionStartDate!),
    expiresAt: new Date(data.renewalDate!),
    provider: SubscriptionProvider.AppleStoreKit,
  };
};

const getSubscriptionStatus = (
  notificationType: ResponseBodyV2DecodedPayload['notificationType'],
  subtype?: ResponseBodyV2DecodedPayload['subtype'],
): UserSubscriptionStatus => {
  switch (notificationType) {
    case NotificationTypeV2.SUBSCRIBED:
    case NotificationTypeV2.DID_RENEW:
    case NotificationTypeV2.DID_CHANGE_RENEWAL_PREF: // Upgrade/Downgrade
    case NotificationTypeV2.REFUND_REVERSED:
      return UserSubscriptionStatus.Active;
    case NotificationTypeV2.DID_CHANGE_RENEWAL_STATUS: // Disable/Enable Auto-Renew
      return subtype === Subtype.AUTO_RENEW_ENABLED
        ? UserSubscriptionStatus.Active
        : UserSubscriptionStatus.Cancelled;
    case NotificationTypeV2.DID_FAIL_TO_RENEW:
      // When user fails to renew and there is no grace period
      if (isNullOrUndefined(subtype)) {
        return UserSubscriptionStatus.Cancelled;
      }
    case NotificationTypeV2.GRACE_PERIOD_EXPIRED:
      return UserSubscriptionStatus.Cancelled;
    case NotificationTypeV2.REFUND:
    case NotificationTypeV2.EXPIRED:
    case NotificationTypeV2.REVOKE: // We don't support Family Sharing, but to be on the safe side
      return UserSubscriptionStatus.Expired;
    default:
      logger.error(
        {
          notificationType,
          subtype,
          provider: SubscriptionProvider.AppleStoreKit,
        },
        'Unknown notification type',
      );
      throw new Error('Unknown notification type');
  }
};

const handleNotifcationRequest = async (
  verifier: SignedDataVerifier,
  request: FastifyRequest<{ Body: AppleNotificationRequest }>,
  response: FastifyReply,
) => {
  const { signedPayload } = request.body || {};

  if (isNullOrUndefined(signedPayload)) {
    logger.info(
      { body: request.body, provider: SubscriptionProvider.AppleStoreKit },
      "Missing 'signedPayload' in request body",
    );
    return response.status(403).send({ error: 'Invalid Payload' });
  }

  try {
    const notification =
      await verifier.verifyAndDecodeNotification(signedPayload);

    if (isNullOrUndefined(notification?.data?.signedRenewalInfo)) {
      logger.info(
        { notification, provider: SubscriptionProvider.AppleStoreKit },
        "Missing 'signedRenewalInfo' in notification data",
      );
      return response.status(400).send({ error: 'Invalid Payload' });
    }

    const renewalInfo = await verifier.verifyAndDecodeRenewalInfo(
      notification.data.signedRenewalInfo!,
    );

    const con = await createOrGetConnection();
    const user = await con.getRepository(User).findOne({
      select: ['id', 'subscriptionFlags'],
      where: {
        subscriptionFlags: JsonContains({
          appAccountToken: renewalInfo.appAccountToken,
        }),
      },
    });

    if (!user) {
      logger.error(
        { notification, provider: SubscriptionProvider.AppleStoreKit },
        'User not found with matching app account token',
      );
      return response.status(404).send({ error: 'Invalid Payload' });
    }

    if (user.subscriptionFlags?.provider === SubscriptionProvider.Paddle) {
      logger.error(
        {
          user,
          notification,
          provider: SubscriptionProvider.AppleStoreKit,
        },
        'User already has a Paddle subscription',
      );
      throw new Error('User already has a Paddle subscription');
    }

    logger.info(
      { renewalInfo, user, provider: SubscriptionProvider.AppleStoreKit },
      'Received Apple App Store Server Notification',
    );

    const subscriptionStatus = getSubscriptionStatus(
      notification.notificationType,
      notification.subtype,
    );

    const subscriptionFlags = renewalInfoToSubscriptionFlags(renewalInfo);

    await updateStoreKitUserSubscription({
      userId: user.id,
      status: subscriptionStatus,
      data: subscriptionFlags,
    });

    return {
      received: true,
    };
  } catch (_err) {
    const err = _err as Error;
    if (err instanceof VerificationException) {
      logger.error(
        {
          err,
          signedPayload,
          provider: SubscriptionProvider.AppleStoreKit,
        },
        'Failed to verify Apple App Store Server Notification',
      );
      return response.status(403).send({ error: 'Invalid Payload' });
    } else {
      logger.error(
        {
          err,
          signedPayload,
          provider: SubscriptionProvider.AppleStoreKit,
        },
        'Failed to process Apple App Store Server Notification',
      );
      return response.status(500).send({ error: 'Internal Server Error' });
    }
  }
};

export const apple = async (fastify: FastifyInstance): Promise<void> => {
  let appleRootCAs: Buffer[] = [];
  fastify.addHook('onRequest', async (request, res) => {
    if (!isInSubnet(request.ip, allowedIPs)) {
      return res.status(403).send({ error: 'Forbidden' });
    }

    if (appleRootCAs.length === 0) {
      appleRootCAs = await loadAppleRootCAs();
    }
  });

  // Endpoint for receiving App Store Server Notifications V2
  fastify.post(
    '/notifications',
    async (
      request: FastifyRequest<{ Body: AppleNotificationRequest }>,
      response,
    ) => {
      const verifier = new SignedDataVerifier(
        appleRootCAs,
        enableOnlineChecks,
        environment,
        bundleId,
        appAppleId,
      );

      await handleNotifcationRequest(verifier, request, response);
    },
  );

  fastify.post(
    '/notifications/sandbox',
    async (
      request: FastifyRequest<{ Body: AppleNotificationRequest }>,
      response,
    ) => {
      const verifier = new SignedDataVerifier(
        appleRootCAs,
        enableOnlineChecks,
        Environment.SANDBOX,
        bundleId,
        appAppleId,
      );

      await handleNotifcationRequest(verifier, request, response);
    },
  );
};
