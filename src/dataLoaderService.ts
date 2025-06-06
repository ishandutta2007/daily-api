import DataLoader, { BatchLoadFn } from 'dataloader';
import { Context } from './Context';
import { getShortUrl } from './common';
import { Settings, SourceMember } from './entity';
import { User } from './entity/user/User';
import { GQLSource } from './schema/sources';
import { getBalance, type GetBalanceResult } from './common/njord';
import { queryReadReplica } from './common/queryReadReplica';
import type { FindOneOptions } from 'typeorm';
import { getRedisObject } from './redis';
import { generateStorageKey, StorageKey, StorageTopic } from './config';

export const defaultCacheKeyFn = <K extends object | string>(key: K) => {
  if (typeof key === 'object') {
    return JSON.stringify(key);
  }

  return key.toString();
};

export class DataLoaderService {
  protected loaders: Record<string, DataLoader<unknown, unknown>>;
  private ctx: Context;

  constructor({ ctx }: { ctx: Context }) {
    this.loaders = {};
    this.ctx = ctx;
  }

  protected getLoader<K, V>({
    type,
    loadFn,
    cacheKeyFn,
  }: {
    type: string;
    loadFn: (params: K) => Promise<V | null> | V;
    cacheKeyFn: (key: K) => string;
  }): DataLoader<K, V> {
    if (!this.loaders[type]) {
      const batchLoadFn: BatchLoadFn<K, V> = async (keys) => {
        const results = await Promise.allSettled(keys.map(loadFn));

        return results.map((result) => {
          if (result.status === 'rejected') {
            return result.reason;
          }

          return result.value;
        });
      };

      this.loaders[type] = new DataLoader(batchLoadFn, {
        cacheKeyFn,
        maxBatchSize: 30,
        name: `${DataLoaderService.name}.${type}`,
      });
    }

    return this.loaders[type] as DataLoader<K, V>;
  }

  get userLastActive() {
    return this.getLoader<{ userId: string }, Date | null>({
      type: 'userLastActive',
      loadFn: async ({ userId }) => {
        if (!userId) {
          return null;
        }
        const redisDate = await getRedisObject(
          generateStorageKey(
            StorageTopic.Boot,
            StorageKey.UserLastOnline,
            userId,
          ),
        );
        if (!redisDate) {
          return null;
        }
        return new Date(parseInt(redisDate as string));
      },
      cacheKeyFn: ({ userId }) => defaultCacheKeyFn({ userId }),
    });
  }

  get userSettings() {
    return this.getLoader<{ userId: string }, Settings>({
      type: 'userSettings',
      loadFn: async ({ userId }) => {
        if (!userId) {
          return null;
        }

        return this.ctx.con.getRepository(Settings).findOneBy({ userId });
      },
      cacheKeyFn: ({ userId }) => defaultCacheKeyFn({ userId }),
    });
  }

  get shortUrl() {
    return this.getLoader<string, string>({
      type: 'shortUrl',
      loadFn: (url) => getShortUrl(url, this.ctx.log),
      cacheKeyFn: defaultCacheKeyFn,
    });
  }

  get referralUrl() {
    return this.getLoader<
      {
        source: Pick<GQLSource, 'id' | 'handle' | 'public' | 'currentMember'>;
        userId: string;
      },
      string
    >({
      type: 'referralUrl',
      loadFn: async ({ source, userId }) => {
        const referralUrl = new URL(
          `/squads/${source.handle}`,
          process.env.COMMENTS_PREFIX,
        );

        if (source.public) {
          referralUrl.searchParams.append('cid', 'squad');
          referralUrl.searchParams.append('userid', userId);
        } else {
          let referralToken = source.currentMember?.referralToken;

          if (!referralToken) {
            const sourceMember: Pick<SourceMember, 'referralToken'> | null =
              await this.ctx.con.getRepository(SourceMember).findOne({
                select: ['referralToken'],
                where: { sourceId: source.id, userId },
              });

            referralToken = sourceMember?.referralToken;
          }

          if (!referralToken) {
            return null;
          }

          referralUrl.pathname = `/squads/${source.handle}/${referralToken}`;
        }

        const shortUrl = this.shortUrl.load(referralUrl.toString());

        return shortUrl;
      },
      cacheKeyFn: (key) => {
        const { source, userId } = key;
        const { id: sourceId } = source;

        return defaultCacheKeyFn({ sourceId, userId });
      },
    });
  }

  get organizationReferralUrl() {
    return this.getLoader<
      {
        organizationId: string;
        referralToken: string;
      },
      string
    >({
      type: 'organizationReferralUrl',
      loadFn: async ({ organizationId, referralToken }) => {
        const referralUrl = new URL(
          `/join/organization`,
          process.env.COMMENTS_PREFIX,
        );

        referralUrl.searchParams.append('token', referralToken);
        referralUrl.searchParams.append('orgId', organizationId);

        return this.shortUrl.load(referralUrl.toString());
      },
      cacheKeyFn: ({ organizationId, referralToken }) =>
        defaultCacheKeyFn({ organizationId, referralToken }),
    });
  }

  get userBalance() {
    return this.getLoader<
      {
        userId: string;
      },
      GetBalanceResult
    >({
      type: 'userBalance',
      loadFn: async ({ userId }) => {
        return getBalance({
          userId,
        });
      },
      cacheKeyFn: ({ userId }) => defaultCacheKeyFn({ userId }),
    });
  }

  get user() {
    return this.getLoader<
      { userId: string; select?: FindOneOptions<User>['select'] },
      User
    >({
      type: 'user',
      loadFn: async ({ userId, select }) => {
        if (!userId) {
          return null;
        }

        return queryReadReplica(this.ctx.con, async ({ queryRunner }) => {
          return queryRunner.manager.getRepository(User).findOne({
            select,
            where: {
              id: userId,
            },
          });
        });
      },
      cacheKeyFn: ({ userId, select }) => defaultCacheKeyFn({ userId, select }),
    });
  }
}
