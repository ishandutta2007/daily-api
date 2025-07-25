import {
  expectSuccessfulBackground,
  expectTypedEvent,
  saveFixtures,
} from '../helpers';
import worker from '../../src/workers/personalizedDigestEmail';
import { DataSource } from 'typeorm';
import createOrGetConnection from '../../src/db';
import {
  Post,
  PostType,
  Settings,
  Source,
  User,
  UserPersonalizedDigest,
  UserPersonalizedDigestSendType,
  UserPersonalizedDigestType,
  UserStreak,
} from '../../src/entity';
import { usersFixture } from '../fixture/user';
import { postsFixture } from '../fixture/post';
import { sourcesFixture } from '../fixture/source';
import {
  DEFAULT_TIMEZONE,
  getPersonalizedDigestPreviousSendDate,
  getPersonalizedDigestSendDate,
  sendEmail,
} from '../../src/common';
import nock from 'nock';
import { subDays } from 'date-fns';
import { ExperimentAllocationClient, features } from '../../src/growthbook';
import { sendExperimentAllocationEvent } from '../../src/integrations/analytics';
import {
  sendReadingReminderPush,
  sendStreakReminderPush,
} from '../../src/onesignal';
import { SubscriptionCycles } from '../../src/paddle';
import { UserBriefingRequest } from '@dailydotdev/schema';
import { BriefingModel } from '../../src/integrations/feed/types';
import { BriefPost } from '../../src/entity/posts/BriefPost';

jest.mock('../../src/common', () => ({
  ...(jest.requireActual('../../src/common') as Record<string, unknown>),
  sendEmail: jest.fn(),
}));

jest.mock('../../src/onesignal', () => ({
  ...(jest.requireActual('../../src/onesignal') as Record<string, unknown>),
  sendReadingReminderPush: jest.fn(),
  sendStreakReminderPush: jest.fn(),
}));

jest.mock('../../src/integrations/analytics', () => ({
  ...(jest.requireActual('../../src/integrations/analytics') as Record<
    string,
    unknown
  >),
  sendExperimentAllocationEvent: jest.fn(),
}));

jest.mock('../../src/growthbook', () => ({
  ...(jest.requireActual('../../src/growthbook') as Record<string, unknown>),
  getUserGrowthBookInstance: (
    _userId: string,
    { allocationClient }: { allocationClient: ExperimentAllocationClient },
  ) => {
    return {
      loadFeatures: jest.fn(),
      getFeatures: jest.fn(),
      getFeatureValue: (featureId: string) => {
        if (allocationClient) {
          allocationClient.push({
            event_timestamp: new Date(),
            user_id: _userId,
            experiment_id: featureId,
            variation_id: '0',
          });
        }

        return Object.values(features).find(
          (feature) => feature.id === featureId,
        )?.defaultValue;
      },
    };
  },
}));

jest.mock('../../src/common/typedPubsub', () => ({
  ...(jest.requireActual('../../src/common/typedPubsub') as Record<
    string,
    unknown
  >),
  triggerTypedEvent: jest.fn(),
}));

let con: DataSource;
let nockScope: nock.Scope;
let nockBody: Record<string, string> = {};

beforeAll(async () => {
  con = await createOrGetConnection();
});

beforeEach(async () => {
  jest.resetAllMocks();
  nock.cleanAll();
  nockBody = {};

  await saveFixtures(con, User, usersFixture);
  await con.getRepository(UserPersonalizedDigest).clear();
  await saveFixtures(con, Source, sourcesFixture);

  const postsFixtureWithAddedData = postsFixture.map((item) => ({
    ...item,
    readTime: 15,
    summary: 'test summary',
    upvotes: 10,
    comments: 5,
    views: 200,
  }));

  await saveFixtures(con, Post, postsFixtureWithAddedData);
  await con.getRepository(UserPersonalizedDigest).save({
    userId: '1',
  });

  const mockedPostIds = postsFixtureWithAddedData
    .slice(0, 5)
    .map((post) => ({ post_id: post.id }));

  nockScope = nock('http://localhost:6000')
    .post('/feed.json', (body) => {
      nockBody = body;

      return true;
    })
    .reply(200, {
      data: mockedPostIds,
      rows: mockedPostIds.length,
    });
});

const getDates = (
  personalizedDigest: UserPersonalizedDigest,
  timestamp: number,
  timezone = DEFAULT_TIMEZONE,
) => {
  return {
    emailSendTimestamp: getPersonalizedDigestSendDate({
      personalizedDigest,
      generationTimestamp: timestamp,
      timezone,
    }).getTime(),
    previousSendTimestamp: getPersonalizedDigestPreviousSendDate({
      personalizedDigest,
      generationTimestamp: timestamp,
      timezone,
    }).getTime(),
  };
};

describe('personalizedDigestEmail worker', () => {
  it('should generate personalized digest for user with subscription', async () => {
    const personalizedDigest = await con
      .getRepository(UserPersonalizedDigest)
      .findOneBy({
        userId: '1',
      });

    expect(personalizedDigest).toBeTruthy();
    expect(personalizedDigest!.lastSendDate).toBeNull();

    await expectSuccessfulBackground(worker, {
      personalizedDigest,
      ...getDates(personalizedDigest!, Date.now()),
      emailBatchId: 'test-email-batch-id',
    });

    const personalizedDigestAfterWorker = await con
      .getRepository(UserPersonalizedDigest)
      .findOneBy({
        userId: '1',
      });

    expect(sendEmail).toHaveBeenCalledTimes(1);
    const emailData = (sendEmail as jest.Mock).mock.calls[0][0];
    expect(emailData).toMatchSnapshot({
      send_at: expect.any(Number),
      message_data: {
        date: expect.any(String),
      },
    });

    expect(nockScope.isDone()).toBe(true);
    expect(nockBody).toMatchSnapshot({
      date_from: expect.any(String),
      date_to: expect.any(String),
    });

    const dateFrom = new Date(nockBody.date_from);
    const dateTo = new Date(nockBody.date_to);
    expect(dateFrom.getTime()).toBeLessThan(dateTo.getTime());
    expect(dateFrom.getDay()).toBe(personalizedDigest!.preferredDay);
    expect(dateFrom.getHours()).toBe(personalizedDigest!.preferredHour);
    expect(dateFrom.getTimezoneOffset()).toBe(0);

    expect(personalizedDigestAfterWorker!.lastSendDate).not.toBeNull();
  });

  it('should generate personalized digest for user in timezone ahead UTC', async () => {
    await con.getRepository(UserPersonalizedDigest).save({
      userId: '1',
      type: UserPersonalizedDigestType.Digest,
    });
    await con.getRepository(User).save({
      id: '1',
      timezone: 'America/Phoenix',
    });

    const personalizedDigest = await con
      .getRepository(UserPersonalizedDigest)
      .findOneBy({
        userId: '1',
      });

    expect(personalizedDigest).toBeTruthy();

    await expectSuccessfulBackground(worker, {
      personalizedDigest,
      ...getDates(personalizedDigest!, Date.now(), 'America/Phoenix'),
      emailBatchId: 'test-email-batch-id',
    });

    expect(sendEmail).toHaveBeenCalledTimes(1);
    const emailData = (sendEmail as jest.Mock).mock.calls[0][0];
    expect(emailData).toMatchSnapshot({
      send_at: expect.any(Number),
      message_data: {
        date: expect.any(String),
      },
    });
    const sentAtDate = new Date(emailData.send_at * 1000);
    expect(sentAtDate.getDay()).toBe(personalizedDigest!.preferredDay);
    expect(sentAtDate.getHours()).toBe(personalizedDigest!.preferredHour + 7);
    expect(sentAtDate.getTimezoneOffset()).toBe(0);

    expect(nockScope.isDone()).toBe(true);
    expect(nockBody).toMatchSnapshot({
      date_from: expect.any(String),
      date_to: expect.any(String),
    });

    const dateFrom = new Date(nockBody.date_from);
    const dateTo = new Date(nockBody.date_to);
    expect(dateFrom.getTime()).toBeLessThan(dateTo.getTime());
    expect(dateFrom.getDay()).toBe(personalizedDigest!.preferredDay);
    expect(dateFrom.getHours()).toBe(personalizedDigest!.preferredHour + 7);
    expect(dateFrom.getTimezoneOffset()).toBe(0);
  });

  it('should generate personalized digest for user in timezone behind UTC', async () => {
    await con.getRepository(UserPersonalizedDigest).save({
      userId: '1',
      type: UserPersonalizedDigestType.Digest,
    });
    await con.getRepository(User).save({
      id: '1',
      timezone: 'Asia/Dhaka',
    });

    const personalizedDigest = await con
      .getRepository(UserPersonalizedDigest)
      .findOneBy({
        userId: '1',
      });

    expect(personalizedDigest).toBeTruthy();

    await expectSuccessfulBackground(worker, {
      personalizedDigest,
      ...getDates(personalizedDigest!, Date.now(), 'Asia/Dhaka'),
      emailBatchId: 'test-email-batch-id',
    });

    expect(sendEmail).toHaveBeenCalledTimes(1);
    const emailData = (sendEmail as jest.Mock).mock.calls[0][0];
    expect(emailData).toMatchSnapshot({
      send_at: expect.any(Number),
      message_data: {
        date: expect.any(String),
      },
    });
    const sentAtDate = new Date(emailData.send_at * 1000);
    expect(sentAtDate.getDay()).toBe(personalizedDigest!.preferredDay);
    expect(sentAtDate.getHours()).toBe(personalizedDigest!.preferredHour - 6);
    expect(sentAtDate.getTimezoneOffset()).toBe(0);

    expect(nockScope.isDone()).toBe(true);
    expect(nockBody).toMatchSnapshot({
      date_from: expect.any(String),
      date_to: expect.any(String),
    });

    const dateFrom = new Date(nockBody.date_from);
    const dateTo = new Date(nockBody.date_to);
    expect(dateFrom.getTime()).toBeLessThan(dateTo.getTime());
    expect(dateFrom.getDay()).toBe(personalizedDigest!.preferredDay);
    expect(dateFrom.getHours()).toBe(personalizedDigest!.preferredHour - 6);
    expect(dateFrom.getTimezoneOffset()).toBe(0);
  });

  it('should generate personalized digest for user with no name set', async () => {
    const personalizedDigest = await con
      .getRepository(UserPersonalizedDigest)
      .findOneBy({
        userId: '1',
      });

    await saveFixtures(
      con,
      User,
      usersFixture.map((item) => ({
        ...item,
        name: null as unknown,
      })),
    );

    expect(personalizedDigest).toBeTruthy();

    await expectSuccessfulBackground(worker, {
      personalizedDigest,
      ...getDates(personalizedDigest!, Date.now()),
      emailBatchId: 'test-email-batch-id',
    });

    expect(sendEmail).toHaveBeenCalledTimes(1);
    const emailData = (sendEmail as jest.Mock).mock.calls[0][0];
    expect(emailData.to).toEqual('ido@daily.dev');
  });

  it('should not generate personalized digest for user that did not confirm their info', async () => {
    const personalizedDigest = await con
      .getRepository(UserPersonalizedDigest)
      .findOneBy({
        userId: '1',
      });

    await saveFixtures(
      con,
      User,
      usersFixture.map((item) => ({
        ...item,
        infoConfirmed: false,
      })),
    );

    expect(personalizedDigest).toBeTruthy();

    await expectSuccessfulBackground(worker, {
      personalizedDigest,
      ...getDates(personalizedDigest!, Date.now()),
      emailBatchId: 'test-email-batch-id',
    });

    expect(sendEmail).toHaveBeenCalledTimes(0);
  });

  it('should not generate personalized digest for user if lastSendDate is in the same day as current date', async () => {
    const personalizedDigest = await con
      .getRepository(UserPersonalizedDigest)
      .findOneBy({
        userId: '1',
      });

    await con.getRepository(UserPersonalizedDigest).save({
      userId: '1',
      lastSendDate: new Date(),
      type: UserPersonalizedDigestType.Digest,
    });

    await expectSuccessfulBackground(worker, {
      personalizedDigest,
      ...getDates(personalizedDigest!, Date.now()),
      emailBatchId: 'test-email-batch-id',
    });

    expect(sendEmail).toHaveBeenCalledTimes(0);
  });

  it('should generate personalized digest for user if lastSendDate is in the past', async () => {
    const personalizedDigest = await con
      .getRepository(UserPersonalizedDigest)
      .findOneBy({
        userId: '1',
      });

    await con.getRepository(UserPersonalizedDigest).save({
      userId: '1',
      lastSendDate: subDays(new Date(), 7),
      type: UserPersonalizedDigestType.Digest,
    });

    await expectSuccessfulBackground(worker, {
      personalizedDigest,
      ...getDates(personalizedDigest!, Date.now()),
      emailBatchId: 'test-email-batch-id',
    });

    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it('should revert lastSendDate if send email throws error', async () => {
    const personalizedDigest = await con
      .getRepository(UserPersonalizedDigest)
      .findOneBy({
        userId: '1',
      });

    (sendEmail as jest.Mock).mockRejectedValue(new Error('test error'));

    const lastSendDate = subDays(new Date(), 7);

    await con.getRepository(UserPersonalizedDigest).save({
      userId: '1',
      lastSendDate,
      type: UserPersonalizedDigestType.Digest,
    });

    await expect(() => {
      return expectSuccessfulBackground(worker, {
        personalizedDigest,
        ...getDates(personalizedDigest!, Date.now()),
        emailBatchId: 'test-email-batch-id',
      });
    }).rejects.toEqual(new Error('test error'));

    const personalizedDigestAfterWorker = await con
      .getRepository(UserPersonalizedDigest)
      .findOneBy({
        userId: '1',
      });

    expect(personalizedDigestAfterWorker?.lastSendDate?.toISOString()).toBe(
      lastSendDate.toISOString(),
    );
  });

  it('should send allocation analytics event for experiment', async () => {
    const personalizedDigest = await con
      .getRepository(UserPersonalizedDigest)
      .findOneBy({
        userId: '1',
      });

    await con.getRepository(UserPersonalizedDigest).save({
      userId: '1',
      lastSendDate: subDays(new Date(), 7),
      type: UserPersonalizedDigestType.Digest,
    });

    await expectSuccessfulBackground(worker, {
      personalizedDigest,
      ...getDates(personalizedDigest!, Date.now()),
      emailBatchId: 'test-email-batch-id',
    });

    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendExperimentAllocationEvent).toHaveBeenCalledTimes(1);
    expect(sendExperimentAllocationEvent).toHaveBeenCalledWith({
      event_timestamp: expect.any(Date),
      experiment_id: 'personalized_digest',
      user_id: '1',
      variation_id: '0',
    });
  });

  it('should ignore lastSendDate if deduplicate param is false', async () => {
    const personalizedDigest = await con
      .getRepository(UserPersonalizedDigest)
      .findOneBy({
        userId: '1',
      });

    const lastSendDate = new Date();

    await con.getRepository(UserPersonalizedDigest).save({
      userId: '1',
      lastSendDate,
      type: UserPersonalizedDigestType.Digest,
    });

    await expectSuccessfulBackground(worker, {
      personalizedDigest,
      ...getDates(personalizedDigest!, Date.now()),
      emailBatchId: 'test-email-batch-id',
      deduplicate: false,
    });

    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it('should not set lastSendDate if deduplicate param is false', async () => {
    const personalizedDigest = await con
      .getRepository(UserPersonalizedDigest)
      .findOneBy({
        userId: '1',
      });

    const lastSendDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    await con.getRepository(UserPersonalizedDigest).save({
      userId: '1',
      lastSendDate,
      type: UserPersonalizedDigestType.Digest,
    });

    await expectSuccessfulBackground(worker, {
      personalizedDigest,
      ...getDates(personalizedDigest!, Date.now()),
      emailBatchId: 'test-email-batch-id',
      deduplicate: false,
    });

    const personalizedDigestAfterWorker = await con
      .getRepository(UserPersonalizedDigest)
      .findOneBy({
        userId: '1',
      });

    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(personalizedDigestAfterWorker?.lastSendDate?.toISOString()).toBe(
      lastSendDate.toISOString(),
    );
  });

  it('should not generate personalized digest if no posts are returned from feed', async () => {
    const personalizedDigest = await con
      .getRepository(UserPersonalizedDigest)
      .findOneBy({
        userId: '1',
      });

    const lastSendDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    await con.getRepository(UserPersonalizedDigest).save({
      userId: '1',
      lastSendDate,
      type: UserPersonalizedDigestType.Digest,
    });

    nock.cleanAll();

    nockScope = nock('http://localhost:6000')
      .post('/feed.json', (body) => {
        nockBody = body;

        return true;
      })
      .reply(200, {
        data: [],
        rows: 0,
      });

    await expectSuccessfulBackground(worker, {
      personalizedDigest,
      ...getDates(personalizedDigest!, Date.now()),
      emailBatchId: 'test-email-batch-id',
    });

    expect(sendEmail).toHaveBeenCalledTimes(0);
  });

  it('should truncate long posts summary', async () => {
    const postsFixtureWithAddedData = postsFixture.map((item) => ({
      ...item,
      readTime: 15,
      summary:
        'In quis nulla lorem. Suspendisse potenti. Quisque gravida convallis urna, ut venenatis sapien. Maecenas sem odio, blandit vel auctor ut, pellentesque ac magna.',
      upvotes: 10,
      comments: 5,
      views: 200,
    }));

    await saveFixtures(con, Post, postsFixtureWithAddedData);

    const personalizedDigest = await con
      .getRepository(UserPersonalizedDigest)
      .findOneBy({
        userId: '1',
      });

    await expectSuccessfulBackground(worker, {
      personalizedDigest,
      ...getDates(personalizedDigest!, Date.now()),
      emailBatchId: 'test-email-batch-id',
    });

    expect(sendEmail).toHaveBeenCalledTimes(1);
    const emailData = (sendEmail as jest.Mock).mock.calls[0][0];
    expect(emailData).toMatchSnapshot({
      send_at: expect.any(Number),
      message_data: {
        date: expect.any(String),
      },
    });
  });

  it('properly set showStreak to false if there is no user streak record', async () => {
    const postsFixtureWithAddedData = postsFixture.map((item) => ({
      ...item,
      readTime: 15,
      summary:
        'In quis nulla lorem. Suspendisse potenti. Quisque gravida convallis urna, ut venenatis sapien. Maecenas sem odio, blandit vel auctor ut, pellentesque ac magna.',
      upvotes: 10,
      comments: 5,
      views: 200,
    }));

    await saveFixtures(con, Post, postsFixtureWithAddedData);
    await con.getRepository(UserStreak).delete({ userId: '1' });

    const personalizedDigest = await con
      .getRepository(UserPersonalizedDigest)
      .findOneBy({
        userId: '1',
      });

    await expectSuccessfulBackground(worker, {
      personalizedDigest,
      ...getDates(personalizedDigest!, Date.now()),
      emailBatchId: 'test-email-batch-id',
    });

    expect(sendEmail).toHaveBeenCalledTimes(1);
    const emailData = (sendEmail as jest.Mock).mock.calls[0][0];
    expect(emailData).toMatchSnapshot({
      send_at: expect.any(Number),
      message_data: {
        date: expect.any(String),
      },
    });
  });

  it('should generate personalized digest for user with provided config', async () => {
    const personalizedDigest = await con
      .getRepository(UserPersonalizedDigest)
      .findOneBy({
        userId: '1',
      });

    expect(personalizedDigest).toBeTruthy();

    await expectSuccessfulBackground(worker, {
      personalizedDigest,
      ...getDates(personalizedDigest!, Date.now()),
      emailBatchId: 'test-email-batch-id',
      config: {
        templateId: 'd-testtemplateidfromconfig',
        maxPosts: 3,
        feedConfig: 'testfeedconfig',
      },
    });

    expect(sendEmail).toHaveBeenCalledTimes(1);
    const emailData = (sendEmail as jest.Mock).mock.calls[0][0];
    expect(emailData).toMatchSnapshot({
      send_at: expect.any(Number),
      message_data: {
        date: expect.any(String),
      },
    });

    expect(nockScope.isDone()).toBe(true);
    expect(nockBody).toMatchSnapshot({
      date_from: expect.any(String),
      date_to: expect.any(String),
    });
  });

  it('should generate personalized digest without an ad for plus members', async () => {
    const personalizedDigest = await con
      .getRepository(UserPersonalizedDigest)
      .findOneBy({
        userId: '1',
      });

    expect(personalizedDigest).toBeTruthy();

    await con
      .getRepository(User)
      .update(
        { id: '1' },
        { subscriptionFlags: { cycle: SubscriptionCycles.Yearly } },
      );

    await expectSuccessfulBackground(worker, {
      personalizedDigest,
      ...getDates(personalizedDigest!, Date.now()),
      emailBatchId: 'test-email-batch-id',
    });

    expect(sendEmail).toHaveBeenCalledTimes(1);
    const emailData = (sendEmail as jest.Mock).mock.calls[0][0];
    expect(
      emailData.message_data.posts.find(
        (x: { type: string }) => x.type !== 'post',
      ),
    ).toBeFalsy();
    expect(nockScope.isDone()).toBe(true);
  });

  it('should support reading reminder', async () => {
    await con.getRepository(UserPersonalizedDigest).update(
      {
        userId: '1',
      },
      { type: UserPersonalizedDigestType.ReadingReminder },
    );

    const personalizedDigest = await con
      .getRepository(UserPersonalizedDigest)
      .findOneBy({
        userId: '1',
      });

    expect(personalizedDigest).toBeTruthy();
    expect(personalizedDigest!.lastSendDate).toBeNull();

    await expectSuccessfulBackground(worker, {
      personalizedDigest,
      ...getDates(personalizedDigest!, Date.now()),
      emailBatchId: 'test-email-batch-id',
    });

    const personalizedDigestAfterWorker = await con
      .getRepository(UserPersonalizedDigest)
      .findOneBy({
        userId: '1',
      });

    expect(sendReadingReminderPush).toHaveBeenCalledWith(
      ['1'],
      expect.any(Date),
    );
    const at = (sendReadingReminderPush as jest.Mock).mock.calls[0][1];
    expect(at.getDay()).toBe(personalizedDigest!.preferredDay);
    expect(at.getHours()).toBe(personalizedDigest!.preferredHour);
    expect(at.getTimezoneOffset()).toBe(0);

    expect(personalizedDigestAfterWorker!.lastSendDate).not.toBeNull();
  });

  describe('streak reminder', () => {
    it('should send a streak reminder if user has not viewed a post today', async () => {
      await con.getRepository(UserPersonalizedDigest).update(
        {
          userId: '1',
        },
        { type: UserPersonalizedDigestType.StreakReminder },
      );

      await con
        .getRepository(UserStreak)
        .update({ userId: '1' }, { currentStreak: 1 });

      const personalizedDigest = await con
        .getRepository(UserPersonalizedDigest)
        .findOneBy({
          userId: '1',
        });

      expect(personalizedDigest).toBeTruthy();
      expect(personalizedDigest!.lastSendDate).toBeNull();

      await expectSuccessfulBackground(worker, {
        personalizedDigest,
        emailBatchId: 'test-email-batch-id',
      });

      expect(sendStreakReminderPush).toHaveBeenCalledWith(['1']);
      expect(sendStreakReminderPush).toHaveBeenCalledTimes(1);
    });

    it('should not send a streak reminder if user has streak of 0', async () => {
      await con.getRepository(UserPersonalizedDigest).update(
        {
          userId: '1',
        },
        { type: UserPersonalizedDigestType.StreakReminder },
      );

      const personalizedDigest = await con
        .getRepository(UserPersonalizedDigest)
        .findOneBy({
          userId: '1',
        });

      expect(personalizedDigest).toBeTruthy();
      expect(personalizedDigest!.lastSendDate).toBeNull();

      await expectSuccessfulBackground(worker, {
        personalizedDigest,
        ...getDates(personalizedDigest!, Date.now()),
        emailBatchId: 'test-email-batch-id',
      });

      expect(sendStreakReminderPush).toHaveBeenCalledTimes(0);
    });

    it('should not send a streak reminder if user has viewed a post today', async () => {
      await con.getRepository(UserPersonalizedDigest).update(
        {
          userId: '1',
        },
        { type: UserPersonalizedDigestType.StreakReminder },
      );

      await con
        .getRepository(UserStreak)
        .update({ userId: '1' }, { lastViewAt: new Date() });

      const personalizedDigest = await con
        .getRepository(UserPersonalizedDigest)
        .findOneBy({
          userId: '1',
        });

      expect(personalizedDigest).toBeTruthy();
      expect(personalizedDigest!.lastSendDate).toBeNull();

      await expectSuccessfulBackground(worker, {
        personalizedDigest,
        ...getDates(personalizedDigest!, Date.now()),
        emailBatchId: 'test-email-batch-id',
      });

      expect(sendStreakReminderPush).toHaveBeenCalledTimes(0);
      expect(
        (
          await con.getRepository(UserPersonalizedDigest).findOneBy({
            userId: '1',
          })
        )?.lastSendDate,
      ).toBeNull();
    });

    it('should not send a streak reminder if user has opted out of reading streaks', async () => {
      await con.getRepository(UserPersonalizedDigest).update(
        {
          userId: '1',
        },
        { type: UserPersonalizedDigestType.StreakReminder },
      );

      await con.getRepository(Settings).insert({
        userId: '1',
        optOutReadingStreak: true,
      });

      await con
        .getRepository(UserStreak)
        .update({ userId: '1' }, { lastViewAt: new Date() });

      const personalizedDigest = await con
        .getRepository(UserPersonalizedDigest)
        .findOneBy({
          userId: '1',
        });

      expect(personalizedDigest).toBeTruthy();
      expect(personalizedDigest!.lastSendDate).toBeNull();

      await expectSuccessfulBackground(worker, {
        personalizedDigest,
        ...getDates(personalizedDigest!, Date.now()),
        emailBatchId: 'test-email-batch-id',
      });

      expect(sendStreakReminderPush).toHaveBeenCalledTimes(0);
      expect(
        (
          await con.getRepository(UserPersonalizedDigest).findOneBy({
            userId: '1',
          })
        )?.lastSendDate,
      ).toBeNull();
    });

    it('should generate posts with title and image for shared post', async () => {
      const mockedPosts = [
        {
          id: 'fp1',
          shortId: 'fp1',
          score: 1,
          sourceId: 'a',
          createdAt: new Date(),
          tagsStr: 'javascript,webdev',
          type: PostType.Share,
          sharedPostId: postsFixture[0].id,
        },
      ];
      await saveFixtures(con, Post, mockedPosts);

      nock.cleanAll();

      nockScope = nock('http://localhost:6000')
        .post('/feed.json', (body) => {
          nockBody = body;

          return true;
        })
        .reply(200, {
          data: mockedPosts.map((post) => ({ post_id: post.id })),
          rows: mockedPosts.length,
        });

      const personalizedDigest = await con
        .getRepository(UserPersonalizedDigest)
        .findOneBy({
          userId: '1',
        });

      expect(personalizedDigest).toBeTruthy();
      expect(personalizedDigest!.lastSendDate).toBeNull();

      await expectSuccessfulBackground(worker, {
        personalizedDigest,
        ...getDates(personalizedDigest!, Date.now()),
        emailBatchId: 'test-email-batch-id',
      });

      expect(sendEmail).toHaveBeenCalledTimes(1);
      const emailData = (sendEmail as jest.Mock).mock.calls[0][0];
      expect(emailData).toMatchObject({
        message_data: {
          posts: [
            {
              post_image: 'https://daily.dev/image.jpg',
              post_title: 'P1',
            },
          ],
        },
      });

      expect(nockScope.isDone()).toBe(true);
    });

    it('should generate posts with image for freeform post', async () => {
      const mockedPosts = [
        {
          id: 'fp1',
          shortId: 'fp1',
          title: 'FP1',
          url: 'http://fp1.com',
          canonicalUrl: 'http://fp1c.com',
          score: 1,
          sourceId: 'a',
          createdAt: new Date(),
          tagsStr: 'javascript,webdev',
          type: PostType.Freeform,
          content: `Freeform content\\n![alt](https://daily.dev/image.jpg)![alt](https://daily.dev/image2.jpg)`,
          contentHtml:
            '<p>Freeform content</p><img src="https://daily.dev/image.jpg" alt="alt">',
        },
      ];
      await saveFixtures(con, Post, mockedPosts);

      nock.cleanAll();

      nockScope = nock('http://localhost:6000')
        .post('/feed.json', (body) => {
          nockBody = body;

          return true;
        })
        .reply(200, {
          data: mockedPosts.map((post) => ({ post_id: post.id })),
          rows: mockedPosts.length,
        });

      const personalizedDigest = await con
        .getRepository(UserPersonalizedDigest)
        .findOneBy({
          userId: '1',
        });

      expect(personalizedDigest).toBeTruthy();
      expect(personalizedDigest!.lastSendDate).toBeNull();

      await expectSuccessfulBackground(worker, {
        personalizedDigest,
        ...getDates(personalizedDigest!, Date.now()),
        emailBatchId: 'test-email-batch-id',
      });

      expect(sendEmail).toHaveBeenCalledTimes(1);
      const emailData = (sendEmail as jest.Mock).mock.calls[0][0];
      expect(emailData).toMatchObject({
        message_data: {
          posts: [
            {
              post_image: 'https://daily.dev/image.jpg',
              post_title: 'FP1',
            },
          ],
        },
      });

      expect(nockScope.isDone()).toBe(true);
    });
  });

  describe('briefing', () => {
    it('should schedule post generation', async () => {
      await con.getRepository(UserPersonalizedDigest).update(
        {
          userId: '1',
        },
        {
          type: UserPersonalizedDigestType.Brief,
          flags: {
            sendType: UserPersonalizedDigestSendType.daily,
          },
        },
      );

      const personalizedDigest = await con
        .getRepository(UserPersonalizedDigest)
        .findOneBy({
          userId: '1',
        });

      expect(personalizedDigest).toBeTruthy();
      expect(personalizedDigest!.lastSendDate).toBeNull();

      const postBefore = await con.getRepository(BriefPost).findOneBy({
        authorId: '1',
      });

      expect(postBefore).toBeNull();

      await expectSuccessfulBackground(worker, {
        ...getDates(personalizedDigest!, Date.now()),
        personalizedDigest,
        emailBatchId: 'test-email-batch-id',
      });

      const postAfter = await con.getRepository(BriefPost).findOneBy({
        authorId: '1',
      });

      expect(postAfter).toBeTruthy();
      expect(postAfter!.type).toBe(PostType.Brief);
      expect(postAfter!.authorId).toBe('1');
      expect(postAfter!.private).toBeTruthy();
      expect(postAfter!.visible).toBeFalsy();

      expectTypedEvent('api.v1.brief-generate', {
        payload: new UserBriefingRequest({
          userId: '1',
          frequency: UserPersonalizedDigestSendType.daily,
          modelName: BriefingModel.Default,
        }),
        postId: postAfter!.id,
        sendAtMs: expect.any(Number),
      });
    });

    it('should schedule daily generation when workdays is selected', async () => {
      await con.getRepository(UserPersonalizedDigest).update(
        {
          userId: '1',
        },
        {
          type: UserPersonalizedDigestType.Brief,
          flags: {
            sendType: UserPersonalizedDigestSendType.workdays,
          },
        },
      );

      const personalizedDigest = await con
        .getRepository(UserPersonalizedDigest)
        .findOneBy({
          userId: '1',
        });

      expect(personalizedDigest).toBeTruthy();
      expect(personalizedDigest!.lastSendDate).toBeNull();

      const postBefore = await con.getRepository(BriefPost).findOneBy({
        authorId: '1',
      });

      expect(postBefore).toBeNull();

      await expectSuccessfulBackground(worker, {
        ...getDates(personalizedDigest!, Date.now()),
        personalizedDigest,
        emailBatchId: 'test-email-batch-id',
      });

      const postAfter = await con.getRepository(BriefPost).findOneBy({
        authorId: '1',
      });

      expect(postAfter).toBeTruthy();
      expect(postAfter!.type).toBe(PostType.Brief);
      expect(postAfter!.authorId).toBe('1');
      expect(postAfter!.private).toBeTruthy();
      expect(postAfter!.visible).toBeFalsy();

      expectTypedEvent('api.v1.brief-generate', {
        payload: new UserBriefingRequest({
          userId: '1',
          frequency: UserPersonalizedDigestSendType.daily,
          modelName: BriefingModel.Default,
        }),
        postId: postAfter!.id,
        sendAtMs: expect.any(Number),
      });
    });

    it('should schedule weekly generation when sendType is not set', async () => {
      await con.getRepository(UserPersonalizedDigest).update(
        {
          userId: '1',
        },
        {
          type: UserPersonalizedDigestType.Brief,
          flags: {},
        },
      );

      const personalizedDigest = await con
        .getRepository(UserPersonalizedDigest)
        .findOneBy({
          userId: '1',
        });

      expect(personalizedDigest).toBeTruthy();
      expect(personalizedDigest!.lastSendDate).toBeNull();

      const postBefore = await con.getRepository(BriefPost).findOneBy({
        authorId: '1',
      });

      expect(postBefore).toBeNull();

      await expectSuccessfulBackground(worker, {
        ...getDates(personalizedDigest!, Date.now()),
        personalizedDigest,
        emailBatchId: 'test-email-batch-id',
      });

      const postAfter = await con.getRepository(BriefPost).findOneBy({
        authorId: '1',
      });

      expect(postAfter).toBeTruthy();
      expect(postAfter!.type).toBe(PostType.Brief);
      expect(postAfter!.authorId).toBe('1');
      expect(postAfter!.private).toBeTruthy();
      expect(postAfter!.visible).toBeFalsy();

      expectTypedEvent('api.v1.brief-generate', {
        payload: new UserBriefingRequest({
          userId: '1',
          frequency: UserPersonalizedDigestSendType.weekly,
          modelName: BriefingModel.Default,
        }),
        postId: postAfter!.id,
        sendAtMs: expect.any(Number),
      });
    });
  });
});
