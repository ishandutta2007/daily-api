import { FeedConfig, FeedVersion } from '../feed';

export type UserState = 'personalised' | 'non_personalised';

export type GenericMetadata = {
  [key: string]: unknown;
};

export type LofnFeedConfigResponse = {
  user_id: string;
  config: Omit<FeedConfig, 'page_size' | 'total_pages'>;
  tyr_metadata?: GenericMetadata;
  extra?: GenericMetadata;
};

export type LofnFeedConfigPayload = {
  user_id: string;
  feed_version: FeedVersion;
  cursor: string;
};

export interface ILofnClient {
  fetchConfig(payload: LofnFeedConfigPayload): Promise<LofnFeedConfigResponse>;
}
