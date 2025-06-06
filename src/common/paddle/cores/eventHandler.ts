import { EventName, type EventEntity } from '@paddle/paddle-node-sdk';

import { PurchaseType, SubscriptionProvider } from '../../plus';
import { logger } from '../../../logger';
import { logPaddleAnalyticsEvent } from '../index';
import { AnalyticsEventName } from '../../../integrations/analytics';
import {
  processCoresTransactionCompleted,
  processCoresTransactionCreated,
  processCoresTransactionPaid,
  processCoresTransactionPaymentFailed,
  processCoresTransactionUpdated,
} from './processing';

export const processCorePaddleEvent = async (event: EventEntity) => {
  switch (event?.eventType) {
    case EventName.TransactionCreated:
      await processCoresTransactionCreated({
        event,
      });

      break;
    case EventName.TransactionPaid:
      await processCoresTransactionPaid({
        event,
      });

      break;
    case EventName.TransactionPaymentFailed:
      await processCoresTransactionPaymentFailed({
        event,
      });

      break;
    case EventName.TransactionUpdated:
      await processCoresTransactionUpdated({
        event,
      });

      break;
    case EventName.TransactionCompleted:
      await Promise.all([
        logPaddleAnalyticsEvent(event, AnalyticsEventName.ReceivePayment),
        processCoresTransactionCompleted({ event }),
      ]);
      break;
    default:
      logger.info(
        {
          provider: SubscriptionProvider.Paddle,
          purchaseType: PurchaseType.Cores,
        },
        event?.eventType,
      );
  }
};
