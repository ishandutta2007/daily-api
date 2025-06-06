import deepmerge from 'deepmerge';
import { updateFlagsStatement, User } from '../common';
import { UserPersonalizedDigest } from '../entity';
import {
  features,
  getUserGrowthBookInstance,
  PersonalizedDigestFeatureConfig,
} from '../growthbook';
import { messageToJson, workerToExperimentWorker } from './worker';

interface Data {
  user: User;
}

const worker = workerToExperimentWorker({
  subscription: 'api.user-created-personalized-digest-send-type',
  handler: async (message, con, logger, pubsub, allocationClient) => {
    const data = messageToJson<Data>(message);
    const { user } = data;

    if (!user?.id) {
      return;
    }

    const growthbookClient = getUserGrowthBookInstance(user.id, {
      enableDevMode: process.env.NODE_ENV !== 'production',
      subscribeToChanges: false,
      allocationClient,
    });

    const featureValue = growthbookClient.getFeatureValue(
      features.dailyDigest.id,
      features.dailyDigest.defaultValue,
    ) as PersonalizedDigestFeatureConfig;

    const digestFeature = deepmerge(
      features.dailyDigest.defaultValue as PersonalizedDigestFeatureConfig,
      featureValue,
    );

    await con.getRepository(UserPersonalizedDigest).update(
      {
        userId: user.id,
      },
      {
        flags: updateFlagsStatement<UserPersonalizedDigest>({
          sendType: digestFeature.newUserSendType,
        }),
      },
    );
  },
});

export default worker;
