import type { User } from '../../../entity';

export interface PostBoostReach {
  min: number;
  max: number;
}

export interface PostEstimatedReach {
  impressions: number;
  clicks: number;
  users: number;
  min_impressions: number;
  max_impressions: number;
}

export type LegacyPostEstimatedReach = Pick<
  PostEstimatedReachResponse,
  'clicks' | 'impressions' | 'users'
>;

export interface PostEstimatedReachResponse
  extends Pick<PostEstimatedReach, 'impressions' | 'clicks' | 'users'> {
  minImpressions: number;
  maxImpressions: number;
}

export interface PromotedPost {
  campaign_id: string;
  post_id: string;
  status: string;
  spend: string;
  budget: string;
  started_at: number;
  ended_at: number;
  impressions: number;
  clicks: number;
  users: number;
}

export interface PromotedPostList {
  promoted_posts: PromotedPost[];
  impressions: number;
  clicks: number;
  users: number;
  total_spend: string;
  post_ids: string[];
}

export interface GetCampaignByIdProps {
  campaignId: PromotedPost['campaign_id'];
  userId: User['id'];
}

export interface GetCampaignsProps {
  userId: User['id'];
  offset: number;
  limit: number;
}

export interface StartPostCampaignResponse {
  campaign_id: string;
}

export interface CancelPostCampaignResponse {
  current_budget: string;
}

export interface GetCampaignResponse
  extends Pick<
    PromotedPost,
    'budget' | 'clicks' | 'impressions' | 'spend' | 'status' | 'users'
  > {
  startedAt: number;
  endedAt: number;
  campaignId: string;
  postId: string;
}

export interface GetCampaignListResponse
  extends Pick<PromotedPostList, 'clicks' | 'impressions' | 'users'> {
  promotedPosts: GetCampaignResponse[];
  postIds: string[];
  totalSpend: string; // float
}

export type EstimatedBoostReachParams = {
  postId: string;
  userId: string;
  durationInDays: number;
  budget: number;
};

export interface ISkadiApiClient {
  startPostCampaign(params: {
    postId: string;
    userId: string;
    durationInDays: number;
    budget: number;
  }): Promise<{ campaignId: string }>;
  cancelPostCampaign(params: {
    campaignId: string;
    userId: string;
  }): Promise<{ currentBudget: string }>;
  estimatePostBoostReach(
    params: Pick<EstimatedBoostReachParams, 'userId' | 'postId'>,
  ): Promise<LegacyPostEstimatedReach>;
  estimatePostBoostReachDaily(
    params: EstimatedBoostReachParams,
  ): Promise<PostEstimatedReachResponse>;
  getCampaignById: (
    params: GetCampaignByIdProps,
  ) => Promise<GetCampaignResponse>;
  getCampaigns: (params: GetCampaignsProps) => Promise<GetCampaignListResponse>;
}

export enum CampaignUpdateAction {
  Completed = 'completed',
  FirstMilestone = 'first_milestone',
  Started = 'started',
}
