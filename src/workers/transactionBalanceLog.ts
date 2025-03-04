import { TransactionLogEntry } from '@dailydotdev/schema';
import type { TypedWorker } from './worker';

export const transactionBalanceLogWorker: TypedWorker<'njord.v1.balance-log'> =
  {
    subscription: 'api.transaction-balance-log',
    handler: async (message, con, logger): Promise<void> => {
      const { data } = message;

      logger.info({ data }, 'transaction log');
    },
    parseMessage: (message) => {
      return {
        ...message,
        data: TransactionLogEntry.fromBinary(message.data),
      };
    },
  };
