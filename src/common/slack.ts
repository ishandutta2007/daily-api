import { IncomingWebhook } from '@slack/webhook';
import { Post, Comment, User, Source } from '../entity';
import { getDiscussionLink, getSourceLink } from './links';
import { NotFoundError } from '../errors';
import { DataSource } from 'typeorm';
import { UserIntegrationSlack } from '../entity/UserIntegration';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { FastifyRequest } from 'fastify';
import { PropsParameters } from '../types';
import type { GetCampaignResponse } from '../integrations/skadi';
import { getAbsoluteDifferenceInDays } from './users';
import { usdToCores } from './number';
import { concatTextToNewline, debeziumTimeToDate } from './utils';

const nullWebhook = { send: (): Promise<void> => Promise.resolve() };
export const webhooks = Object.freeze({
  content: process.env.SLACK_WEBHOOK
    ? new IncomingWebhook(process.env.SLACK_WEBHOOK)
    : nullWebhook,
  comments: process.env.SLACK_COMMENTS_WEBHOOK
    ? new IncomingWebhook(process.env.SLACK_COMMENTS_WEBHOOK)
    : nullWebhook,
  vordr: process.env.SLACK_VORDR_WEBHOOK
    ? new IncomingWebhook(process.env.SLACK_VORDR_WEBHOOK)
    : nullWebhook,
  transactions: process.env.SLACK_TRANSACTIONS_WEBHOOK
    ? new IncomingWebhook(process.env.SLACK_TRANSACTIONS_WEBHOOK)
    : nullWebhook,
  ads: process.env.SLACK_ADS_WEBHOOK
    ? new IncomingWebhook(process.env.SLACK_ADS_WEBHOOK)
    : nullWebhook,
});

interface NotifyBoostedPostProps {
  post: Post;
  campaign: GetCampaignResponse;
  userId: string;
}

export const notifyNewPostBoostedSlack = async ({
  post,
  campaign,
  userId,
}: NotifyBoostedPostProps): Promise<void> => {
  const difference = getAbsoluteDifferenceInDays(
    debeziumTimeToDate(campaign.endedAt),
    debeziumTimeToDate(campaign.startedAt),
  );

  await webhooks.ads.send({
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: ':boost: New post boosted',
          emoji: true,
        },
      },
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: concatTextToNewline(
              '*Post:*',
              `<${getDiscussionLink(post.id)}|${post.id}>`,
            ),
          },
          {
            type: 'mrkdwn',
            text: concatTextToNewline(
              '*Boosted by:*',
              `<https://app.daily.dev/${userId}|${userId}>`,
            ),
          },
        ],
      },
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: concatTextToNewline(
              '*Budget:*',
              `${usdToCores(parseFloat(campaign.budget))} :cores:`,
            ),
          },
          {
            type: 'mrkdwn',
            text: concatTextToNewline(
              '*Duration:*',
              `${difference} day${difference === 1 ? '' : 's'}`,
            ),
          },
        ],
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: concatTextToNewline('*Campaign:*', campaign.campaignId),
        },
      },
    ],
  });
};

export const notifyNewComment = async (
  post: Post,
  userId: string,
  comment: string,
  commentId: string,
): Promise<void> => {
  await webhooks.comments.send({
    text: 'New comment',
    attachments: [
      {
        title: comment,
        title_link: getDiscussionLink(post.id, commentId),
        fields: [
          {
            title: 'User',
            value: userId,
          },
          {
            title: 'Post title',
            value: post.title ?? '',
          },
        ],
        color: '#1DDC6F',
      },
    ],
  });
};

export const notifyNewVordrComment = async (
  post: Post,
  user: User,
  comment: Comment,
): Promise<void> => {
  await webhooks.vordr.send({
    text: 'New comment prevented by vordr',
    attachments: [
      {
        title: comment.content,
        title_link: getDiscussionLink(post.id, comment.id),
        fields: [
          {
            title: 'Username',
            value: user.username || '',
            short: true,
          },
          {
            title: 'User ID',
            value: user.id,
            short: true,
          },
          {
            title: 'Post title',
            value: post.title ?? '',
          },
          {
            title: 'Comment ID',
            value: comment.id,
          },
          {
            title: 'Vordr status',
            value: user.flags?.vordr?.toString() ?? '',
          },
          {
            title: 'Trust score',
            value: user.flags?.trustScore?.toString() ?? '',
          },
          {
            title: 'Reputation',
            value: user.reputation.toString() ?? '',
          },
        ],
        color: '#1DDC6F',
      },
    ],
  });
};

export const notifyNewVordrPost = async (
  post: Post,
  author?: User,
  scout?: User,
): Promise<void> => {
  const getUser = (title: string, user?: User) =>
    user
      ? [
          {
            title: `${title} Username`,
            value: user.username || '',
            short: true,
          },
          {
            title: `${title} ID`,
            value: user.id,
            short: true,
          },
          {
            title: `${title} Vordr status`,
            value: user.flags?.vordr?.toString() ?? '',
          },
          {
            title: `${title} Trust score`,
            value: user.flags?.trustScore?.toString() ?? '',
          },
          {
            title: `${title} Reputation`,
            value: user.reputation.toString() ?? '',
          },
        ]
      : [];

  await webhooks.vordr.send({
    text: 'New post prevented by vordr',
    attachments: [
      {
        title: post.title!,
        title_link: `${process.env.COMMENTS_PREFIX}/posts/${post.id}`,
        fields: [
          {
            title: 'Post type',
            value: post.type,
            short: true,
          },
          {
            title: 'Source',
            value: post.sourceId,
            short: true,
          },
          ...getUser('Scout', scout),
          ...getUser('Author', author),
        ],
        color: '#1DDC6F',
      },
    ],
  });
};

export const notifySourceReport = async (
  userId: string,
  source: Source,
  reason: string,
  comment?: string,
): Promise<void> => {
  await webhooks.content.send({
    text: 'Source/Squad was just reported!',
    attachments: [
      {
        title: source.name ?? `Source ${source.id}`,
        title_link: getSourceLink(source),
        fields: [
          {
            title: 'User',
            value: userId,
          },
          {
            title: 'Reason',
            value: reason,
          },
          {
            title: 'Comment',
            value: comment || '',
          },
        ],
        color: '#FF1E1F',
      },
    ],
  });
};

export const notifyPostReport = async (
  userId: string,
  post: Post,
  reason: string,
  comment?: string,
  tags?: string[],
): Promise<void> => {
  await webhooks.content.send({
    text: 'Post was just reported!',
    attachments: [
      {
        title: post.title ?? `Post ${post.id}`,
        title_link: getDiscussionLink(post.id),
        fields: [
          {
            title: 'User',
            value: userId,
          },
          {
            title: 'Reason',
            value: reason,
          },
          {
            title: 'Comment',
            value: comment || '',
          },
          {
            title: 'Tags',
            value: tags?.join(', ') || '',
          },
        ],
        color: '#FF1E1F',
      },
    ],
  });
};

export const notifyCommentReport = async (
  userId: string,
  comment: Comment,
  reason: string,
  note?: string,
): Promise<void> => {
  await webhooks.content.send({
    text: 'Comment was just reported!',
    attachments: [
      {
        title: comment.content,
        title_link: getDiscussionLink(comment.postId, comment.id),
        fields: [
          {
            title: 'User',
            value: userId,
          },
          {
            title: 'Reason',
            value: reason,
          },
          {
            title: 'Note',
            value: note || '',
          },
        ],
        color: '#FF1E1F',
      },
    ],
  });
};

export const notifyReportUser = async (
  reportedUserId: string,
  reason: string,
  note?: string,
): Promise<void> => {
  await webhooks.content.send({
    text: 'A user was just reported!',
    attachments: [
      {
        title: `User profile`,
        title_link: `https://app.daily.dev/${reportedUserId}`,
        fields: [
          {
            title: 'Reported User',
            value: reportedUserId,
          },
          {
            title: 'Reason',
            value: reason,
          },
          {
            title: 'Note',
            value: note || '',
          },
        ],
        color: '#FF1E1F',
      },
    ],
  });
};

export const getSlackIntegration = async ({
  id,
  userId,
  con,
}: {
  id: string;
  userId: string;
  con: DataSource;
}): Promise<UserIntegrationSlack | null> => {
  const slackIntegration = await con
    .getRepository(UserIntegrationSlack)
    .findOneBy({
      id,
      userId: userId,
    });

  return slackIntegration;
};

export const getSlackIntegrationOrFail = async ({
  id,
  userId,
  con,
}: PropsParameters<
  typeof getSlackIntegration
>): Promise<UserIntegrationSlack> => {
  const slackIntegration = await getSlackIntegration({ id, userId, con });

  if (!slackIntegration) {
    throw new NotFoundError('slack integration not found');
  }

  return slackIntegration;
};

export const verifySlackSignature = ({
  req,
}: {
  req: FastifyRequest<{
    Headers: {
      'x-slack-request-timestamp': string;
      'x-slack-signature': string;
    };
  }>;
}): boolean => {
  const timestamp = req.headers['x-slack-request-timestamp'] as string;
  const signature = req.headers['x-slack-signature'] as string;

  if (!timestamp || !signature) {
    return false;
  }

  const hmac = createHmac('sha256', process.env.SLACK_SIGNING_SECRET);
  hmac.update(`v0:${timestamp}:${req.rawBody}`);

  const hash = hmac.digest();

  return timingSafeEqual(
    hash,
    Buffer.from(signature.replace('v0=', ''), 'hex'),
  );
};

export enum SlackEventType {
  UrlVerification = 'url_verification',
  EventCallback = 'event_callback',
}

export enum SlackEvent {
  AppUninstalled = 'app_uninstalled',
  TokensRevoked = 'tokens_revoked',
}
