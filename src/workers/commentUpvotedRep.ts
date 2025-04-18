import {
  ReputationEvent,
  ReputationReason,
  ReputationType,
  canGrantReputation,
} from './../entity/ReputationEvent';
import { TypedWorker } from './worker';
import { Comment, User } from '../entity';

const worker: TypedWorker<'comment-upvoted'> = {
  subscription: 'comment-upvoted-rep',
  handler: async (message, con, logger): Promise<void> => {
    const { data } = message;
    const logDetails = { data, messageId: message.messageId };
    try {
      await con.transaction(async (transaction) => {
        const comment = await transaction
          .getRepository(Comment)
          .findOneBy({ id: data.commentId });

        if (!comment) {
          logger.info(logDetails, 'comment does not exist');
          return;
        }

        const grantBy = await transaction
          .getRepository(User)
          .findOneBy({ id: data.userId });

        if (!grantBy) {
          logger.info(logDetails, 'grantBy user does not exist');

          return;
        }

        if (
          comment.userId === grantBy.id ||
          !(await canGrantReputation(transaction, grantBy))
        ) {
          return;
        }

        const repo = transaction.getRepository(ReputationEvent);
        const event = repo.create({
          grantById: grantBy.id,
          grantToId: comment.userId,
          targetId: comment.id,
          targetType: ReputationType.Comment,
          reason: ReputationReason.CommentUpvoted,
        });
        await repo
          .createQueryBuilder()
          .insert()
          .values(event)
          .orIgnore()
          .execute();
        logger.info(logDetails, 'increased reputation due to upvote');
      });
    } catch (err) {
      logger.error(
        { ...logDetails, err },
        'failed to increase reputation due to upvote',
      );
    }
  },
};

export default worker;
