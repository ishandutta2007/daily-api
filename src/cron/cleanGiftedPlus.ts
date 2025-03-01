import { Cron } from './cron';
import { User } from '../entity';
import { updateFlagsStatement } from '../common';

const cron: Cron = {
  name: 'clean-gifted-plus',
  handler: async (con, logger) => {
    logger.debug('cleaning gifted plus membership...');
    const timeThreshold = new Date();

    const { affected } = await con
      .getRepository(User)
      .createQueryBuilder('user')
      .update()
      .set({
        subscriptionFlags: {},
        flags: updateFlagsStatement({ showPlusGift: false }),
      })
      .where(`"user"."subscriptionFlags"->>'giftExpirationDate'  < :time`, {
        time: timeThreshold,
      })
      .execute();

    logger.info({ count: affected }, 'expired gifted plus cleaned! 🎁');
  },
};

export default cron;
