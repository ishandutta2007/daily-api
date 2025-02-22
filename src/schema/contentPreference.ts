import { IResolvers } from '@graphql-tools/utils';
import { traceResolvers } from './trace';
import { AuthContext, BaseContext } from '../Context';
import { ContentPreference } from '../entity/contentPreference/ContentPreference';
import {
  getFeedByIdentifiersOrFail,
  MAX_FOLLOWERS_LIMIT,
  toGQLEnum,
} from '../common';
import {
  ContentPreferenceStatus,
  ContentPreferenceType,
} from '../entity/contentPreference/types';
import {
  blockEntity,
  followEntity,
  unblockEntity,
  unfollowEntity,
  whereNotUserBlocked,
} from '../common/contentPreference';
import { GQLEmptyResponse, offsetPageGenerator } from './common';
import graphorm from '../graphorm';
import { Connection, ConnectionArguments } from 'graphql-relay';
import { In, Not } from 'typeorm';
import { ConflictError } from '../errors';

export type GQLContentPreference = Pick<
  ContentPreference,
  'referenceId' | 'userId' | 'type' | 'createdAt' | 'status'
>;

export const typeDefs = /* GraphQL */ `
  ${toGQLEnum(ContentPreferenceType, 'ContentPreferenceType')}

  ${toGQLEnum(ContentPreferenceStatus, 'ContentPreferenceStatus')}

  enum FollowStatus {
    follow
    subscribed
  }

  type ContentPreference {
    referenceId: ID!

    user: User!

    referenceUser: User

    source: Source

    type: ContentPreferenceType!

    createdAt: DateTime!

    status: ContentPreferenceStatus!
  }

  type ContentPreferenceEdge {
    node: ContentPreference!

    """
    Used in \`before\` and \`after\` args
    """
    cursor: String!
  }

  type ContentPreferenceConnection {
    pageInfo: PageInfo!
    edges: [ContentPreferenceEdge!]!
  }

  extend type Query {
    """
    Content preference status
    """
    contentPreferenceStatus(
      """
      Id of the entity
      """
      id: ID!
      """
      Entity type (user, source..)
      """
      entity: ContentPreferenceType!
    ): ContentPreference @auth

    """
    Who follows user
    """
    userFollowers(
      """
      Id of user
      """
      userId: ID!
      """
      Entity to list (user, source..)
      """
      entity: ContentPreferenceType!
      """
      Paginate after opaque cursor
      """
      after: String
      """
      Paginate first
      """
      first: Int
    ): ContentPreferenceConnection!

    """
    What user follows
    """
    userFollowing(
      """
      Id of user
      """
      userId: ID!
      """
      Entity to list (user, source..)
      """
      entity: ContentPreferenceType!
      """
      Paginate after opaque cursor
      """
      after: String
      """
      Paginate first
      """
      first: Int
      """
      Feed id (if empty defaults to my feed)
      """
      feedId: String
    ): ContentPreferenceConnection!

    """
    What user blocked
    """
    userBlocked(
      """
      Entity to list (user, source..)
      """
      entity: ContentPreferenceType!
      """
      Paginate after opaque cursor
      """
      after: String
      """
      Paginate first
      """
      first: Int
      """
      Feed id (if empty defaults to my feed)
      """
      feedId: String
    ): ContentPreferenceConnection @auth
  }

  extend type Mutation {
    """
    Follow entity
    """
    follow(
      """
      Id of the entity
      """
      id: ID!
      """
      Entity to follow (user, source..)
      """
      entity: ContentPreferenceType!
      """
      Follow status
      """
      status: FollowStatus!

      """
      Feed id (if empty defaults to my feed)
      """
      feedId: String
    ): EmptyResponse @auth
    """
    Unfollow entity
    """
    unfollow(
      """
      Id of the entity
      """
      id: ID!
      """
      Entity unfollow (user, source..)
      """
      entity: ContentPreferenceType!

      """
      Feed id (if empty defaults to my feed)
      """
      feedId: String
    ): EmptyResponse @auth

    """
    Block entity
    """
    block(
      """
      Id of the entity
      """
      id: ID!
      """
      Entity to block (user, source..)
      """
      entity: ContentPreferenceType!

      """
      Feed id (if empty defaults to my feed)
      """
      feedId: String
    ): EmptyResponse @auth

    """
    Unblock entity
    """
    unblock(
      """
      Id of the entity
      """
      id: ID!
      """
      Entity to unblock (user, source..)
      """
      entity: ContentPreferenceType!

      """
      Feed id (if empty defaults to my feed)
      """
      feedId: String
    ): EmptyResponse @auth
  }
`;

const contentPreferencePageGenerator =
  offsetPageGenerator<GQLContentPreference>(10, 50);

export const resolvers: IResolvers<unknown, BaseContext> = traceResolvers<
  unknown,
  BaseContext
>({
  Query: {
    contentPreferenceStatus: async (
      _,
      args: { id: string; entity: ContentPreferenceType },
      ctx: AuthContext,
      info,
    ): Promise<GQLContentPreference | null> => {
      return graphorm.queryOneOrFail<GQLContentPreference>(
        ctx,
        info,
        (builder) => ({
          ...builder,
          queryBuilder: builder.queryBuilder
            .where(`"${builder.alias}"."userId" = :userId`, {
              userId: ctx.userId,
            })
            .andWhere(`"${builder.alias}"."type" = :type`, {
              type: args.entity,
            })
            .andWhere(`"${builder.alias}"."referenceId" = :id`, {
              id: args.id,
            }),
        }),
      );
    },
    userFollowers: async (
      _,
      args: {
        userId: string;
        entity: ContentPreferenceType;
      } & ConnectionArguments,
      ctx: AuthContext,
      info,
    ): Promise<Connection<GQLContentPreference>> => {
      const page = contentPreferencePageGenerator.connArgsToPage(args);

      return graphorm.queryPaginated(
        ctx,
        info,
        (nodeSize) =>
          contentPreferencePageGenerator.hasPreviousPage(page, nodeSize),
        (nodeSize) =>
          contentPreferencePageGenerator.hasNextPage(page, nodeSize),
        (node, index) =>
          contentPreferencePageGenerator.nodeToCursor(page, args, node, index),
        (builder) => {
          builder.queryBuilder = builder.queryBuilder
            .where(`${builder.alias}."referenceId" = :userId`, {
              userId: args.userId,
            })
            .andWhere(`${builder.alias}."type" = :type`, {
              type: args.entity,
            })
            .andWhere(`${builder.alias}."status" != :status`, {
              status: ContentPreferenceStatus.Blocked,
            })
            .limit(page.limit)
            .offset(page.offset)
            .addOrderBy(`${builder.alias}."createdAt"`, 'DESC');

          if (ctx.userId) {
            builder.queryBuilder.andWhere(
              whereNotUserBlocked(builder.queryBuilder, {
                userId: ctx.userId,
              }),
            );
          }

          return builder;
        },
        undefined,
        true,
      );
    },
    userFollowing: async (
      _,
      args: {
        userId: string;
        entity: ContentPreferenceType;
        feedId?: string;
      } & ConnectionArguments,
      ctx: AuthContext,
      info,
    ): Promise<Connection<GQLContentPreference>> => {
      const page = contentPreferencePageGenerator.connArgsToPage(args);
      if (args.feedId) {
        await getFeedByIdentifiersOrFail({
          con: ctx.con,
          feedIdOrSlug: args.feedId,
          userId: args.userId,
        });
      }

      const feedId = args.feedId || args.userId;

      return graphorm.queryPaginated(
        ctx,
        info,
        (nodeSize) =>
          contentPreferencePageGenerator.hasPreviousPage(page, nodeSize),
        (nodeSize) =>
          contentPreferencePageGenerator.hasNextPage(page, nodeSize),
        (node, index) =>
          contentPreferencePageGenerator.nodeToCursor(page, args, node, index),
        (builder) => {
          builder.queryBuilder = builder.queryBuilder
            .where(`${builder.alias}."userId" = :userId`, {
              userId: args.userId,
            })
            .andWhere(`${builder.alias}."type" = :type`, {
              type: args.entity,
            })
            .andWhere(`${builder.alias}."feedId" = :feedId`, {
              feedId,
            })
            .andWhere(`${builder.alias}."status" != :status`, {
              status: ContentPreferenceStatus.Blocked,
            })
            .limit(page.limit)
            .offset(page.offset)
            .addOrderBy(`${builder.alias}."createdAt"`, 'DESC');

          if (ctx.userId) {
            builder.queryBuilder.andWhere(
              whereNotUserBlocked(builder.queryBuilder, {
                userId: ctx.userId,
                columnName: `referenceId`,
              }),
            );
          }

          return builder;
        },
        undefined,
        true,
      );
    },
    userBlocked: async (
      _,
      args: {
        entity: ContentPreferenceType;
        feedId?: string;
      } & ConnectionArguments,
      ctx: AuthContext,
      info,
    ): Promise<Connection<GQLContentPreference>> => {
      const page = contentPreferencePageGenerator.connArgsToPage(args);

      if (args.feedId) {
        await getFeedByIdentifiersOrFail({
          con: ctx.con,
          feedIdOrSlug: args.feedId,
          userId: ctx.userId,
        });
      }

      const feedId = args.feedId || ctx.userId;

      return graphorm.queryPaginated(
        ctx,
        info,
        (nodeSize) =>
          contentPreferencePageGenerator.hasPreviousPage(page, nodeSize),
        (nodeSize) =>
          contentPreferencePageGenerator.hasNextPage(page, nodeSize),
        (node, index) =>
          contentPreferencePageGenerator.nodeToCursor(page, args, node, index),
        (builder) => {
          builder.queryBuilder = builder.queryBuilder
            .where(`${builder.alias}."userId" = :userId`, {
              userId: ctx.userId,
            })
            .andWhere(`${builder.alias}."type" = :type`, {
              type: args.entity,
            })
            .andWhere(`${builder.alias}."status" = :status`, {
              status: ContentPreferenceStatus.Blocked,
            })
            .andWhere(`${builder.alias}."feedId" = :feedId`, {
              feedId,
            })
            .limit(page.limit)
            .offset(page.offset)
            .addOrderBy(`${builder.alias}."createdAt"`, 'DESC');

          return builder;
        },
        undefined,
        true,
      );
    },
  },
  Mutation: {
    follow: async (
      _,
      {
        id,
        entity,
        status,
        feedId: feedIdArg,
      }: {
        id: string;
        entity: ContentPreferenceType;
        status:
          | ContentPreferenceStatus.Follow
          | ContentPreferenceStatus.Subscribed;
        feedId?: string;
      },
      ctx: AuthContext,
    ): Promise<GQLEmptyResponse> => {
      if (feedIdArg) {
        await getFeedByIdentifiersOrFail({
          con: ctx.con,
          feedIdOrSlug: feedIdArg,
          userId: ctx.userId,
        });
      }

      const feedId = feedIdArg || ctx.userId;

      const followersCount = await ctx.con
        .getRepository(ContentPreference)
        .countBy({
          userId: ctx.userId,
          status: In([
            ContentPreferenceStatus.Follow,
            ContentPreferenceStatus.Subscribed,
          ]),
          type: Not(ContentPreferenceType.Keyword),
          feedId,
        });

      if (followersCount >= MAX_FOLLOWERS_LIMIT) {
        throw new ConflictError('Max followers limit reached');
      }

      await followEntity({ ctx, id, entity, status, feedId });

      return {
        _: true,
      };
    },
    unfollow: async (
      _,
      {
        id,
        entity,
        feedId: feedIdArg,
      }: { id: string; entity: ContentPreferenceType; feedId?: string },
      ctx: AuthContext,
    ): Promise<GQLEmptyResponse> => {
      if (feedIdArg) {
        await getFeedByIdentifiersOrFail({
          con: ctx.con,
          feedIdOrSlug: feedIdArg,
          userId: ctx.userId,
        });
      }

      const feedId = feedIdArg || ctx.userId;

      await unfollowEntity({ ctx, id, entity, feedId });

      return {
        _: true,
      };
    },
    block: async (
      _,
      {
        id,
        entity,
        feedId: feedIdArg,
      }: { id: string; entity: ContentPreferenceType; feedId?: string },
      ctx: AuthContext,
    ): Promise<GQLEmptyResponse> => {
      if (feedIdArg) {
        await getFeedByIdentifiersOrFail({
          con: ctx.con,
          feedIdOrSlug: feedIdArg,
          userId: ctx.userId,
        });
      }

      const feedId = feedIdArg || ctx.userId;
      await blockEntity({ ctx, id, entity, feedId });

      return {
        _: true,
      };
    },
    unblock: async (
      _,
      {
        id,
        entity,
        feedId: feedIdArg,
      }: { id: string; entity: ContentPreferenceType; feedId?: string },
      ctx: AuthContext,
    ): Promise<GQLEmptyResponse> => {
      if (feedIdArg) {
        await getFeedByIdentifiersOrFail({
          con: ctx.con,
          feedIdOrSlug: feedIdArg,
          userId: ctx.userId,
        });
      }

      const feedId = feedIdArg || ctx.userId;
      await unblockEntity({ ctx, id, entity, feedId });

      return {
        _: true,
      };
    },
  },
});
