import { format } from 'date-fns';
import { markdown } from '../../common/markdown';
import { BriefPost } from '../../entity/posts/BriefPost';
import type { TypedWorker } from '../worker';
import { getPostVisible, parseReadTime, UserActionType } from '../../entity';
import { triggerTypedEvent } from '../../common/typedPubsub';
import type { Briefing } from '@dailydotdev/schema';
import { updateFlagsStatement } from '../../common';
import { insertOrIgnoreAction } from '../../schema/actions';
import {
  briefFeedClient,
  getUserConfigForBriefingRequest,
} from '../../common/brief';
import { queryReadReplica } from '../../common/queryReadReplica';

const generateMarkdown = (data: Briefing): string => {
  let markdown = '';

  for (const section of data.sections) {
    markdown += `## ${section.title}\n\n`;

    for (const item of section.items) {
      markdown += `- **${item.title}**: ${item.body}\n`;
    }

    markdown += '\n';
  }

  return markdown.trim();
};

export const userGenerateBriefWorker: TypedWorker<'api.v1.brief-generate'> = {
  subscription: 'api.user-generate-brief',
  handler: async ({ data }, con, logger): Promise<void> => {
    try {
      logger.info(
        {
          request: data,
        },
        'start generating user brief',
      );

      const { postId, payload: briefRequest } = data;

      const pendingPost = await con.getRepository(BriefPost).findOne({
        where: {
          id: postId,
        },
      });

      if (!pendingPost) {
        logger.error({ data }, 'brief post not found, skipping generation');

        return;
      }

      const userConfig = await queryReadReplica(
        con,
        async ({ queryRunner }) => {
          return getUserConfigForBriefingRequest({
            con: queryRunner.manager,
            userId: data.payload.userId,
          });
        },
      );

      briefRequest.allowedTags = userConfig.allowedTags;
      briefRequest.seniorityLevel = userConfig.seniorityLevel;

      const brief = await briefFeedClient.getUserBrief(briefRequest);

      const content = generateMarkdown(brief);
      const title = format(new Date(), 'MMM d, yyyy');

      const post = con.getRepository(BriefPost).create({
        id: postId,
        title,
        titleHtml: title,
        content,
        contentHtml: markdown.render(content),
        visible: true,
        readTime: brief.readingTime
          ? parseReadTime(brief.readingTime / 60)
          : undefined,
        flags: {
          generatedAt: new Date(),
        },
        collectionSources: brief.sourceIds || [],
        contentJSON: brief.sections.map((section) => section.toJson()),
      });
      post.visible = getPostVisible({ post });

      if (brief.briefStatistics?.posts) {
        post.flags.posts = brief.briefStatistics.posts;
      }

      if (brief.briefStatistics?.sources) {
        post.flags.sources = brief.briefStatistics.sources;
      }

      if (brief.briefStatistics?.savedTime) {
        post.flags.savedTime = brief.briefStatistics.savedTime
          ? parseReadTime(brief.briefStatistics.savedTime / 60)
          : undefined;
      }

      await con.getRepository(BriefPost).update(
        { id: post.id },
        {
          ...post,
          flags: updateFlagsStatement<BriefPost>(post.flags),
        },
      );

      await triggerTypedEvent(logger, 'api.v1.brief-ready', data);

      await insertOrIgnoreAction(
        con,
        data.payload.userId,
        UserActionType.GeneratedBrief,
      );
    } catch (originalError) {
      // TODO feat-brief for now catch error and stop, in the future retry and add dead letter after X attempts
      const err = originalError as Error;

      logger.error({ err, data }, 'failed to generate user brief');
    }
  },
};
