import {
  expectSuccessfulBackground,
  saveFixtures,
  saveNotificationV2Fixture,
} from '../helpers';
import worker from '../../src/workers/newNotificationV2Push';
import {
  ArticlePost,
  NotificationAttachmentType,
  NotificationAttachmentV2,
  NotificationAvatarV2,
  NotificationV2,
  Source,
  User,
} from '../../src/entity';
import { DataSource } from 'typeorm';
import createOrGetConnection from '../../src/db';
import { usersFixture } from '../fixture/user';
import { notificationV2Fixture } from '../fixture/notifications';
import { UserNotification } from '../../src/entity/notifications/UserNotification';
import { sendPushNotification } from '../../src/onesignal';
import { cacheConnectedUser } from '../../src/subscription';
import { deleteKeysByPattern } from '../../src/redis';
import {
  NotificationPostContext,
  NotificationUserContext,
  Reference,
} from '../../src/notifications/types';
import { postsFixture } from '../fixture/post';
import { NotificationType } from '../../src/notifications/common';
import { sourcesFixture } from '../fixture';

jest.mock('../../src/onesignal', () => ({
  ...(jest.requireActual('../../src/onesignal') as Record<string, unknown>),
  sendPushNotification: jest.fn(),
}));

let con: DataSource;
let notif: NotificationV2;
let avatars: NotificationAvatarV2[];

beforeAll(async () => {
  con = await createOrGetConnection();
});

beforeEach(async () => {
  jest.resetAllMocks();
  await deleteKeysByPattern('connected:*');
  await saveFixtures(con, User, usersFixture);
  const attchs = await con.getRepository(NotificationAttachmentV2).save([
    {
      image: 'img#1',
      title: 'att #1',
      type: NotificationAttachmentType.Post,
      referenceId: '1',
    },
    {
      image: 'img#2',
      title: 'att #2',
      type: NotificationAttachmentType.Post,
      referenceId: '2',
    },
  ]);
  avatars = await con.getRepository(NotificationAvatarV2).save([
    {
      image: 'img#1',
      referenceId: '1',
      type: 'user',
      targetUrl: 'user#1',
      name: 'User #1',
    },
    {
      image: 'img#2',
      referenceId: '2',
      type: 'source',
      targetUrl: 'source#1',
      name: 'Source #1',
    },
  ]);
  notif = await con.getRepository(NotificationV2).save({
    ...notificationV2Fixture,
    attachments: [attchs[1].id, attchs[0].id],
    avatars: [avatars[1].id, avatars[0].id],
  });
  const { id } = notif;
  await con.getRepository(UserNotification).insert([
    { userId: '1', notificationId: id },
    { userId: '2', notificationId: id },
  ]);
});

it('should send push notifications to all users', async () => {
  await expectSuccessfulBackground(worker, {
    notification: {
      id: notif.id,
      public: true,
    },
  });
  expect(sendPushNotification).toHaveBeenCalledWith(
    ['1', '2'],
    notif,
    avatars[1],
  );
});

it('should send push notifications to disconnected users only', async () => {
  await cacheConnectedUser('1');
  await expectSuccessfulBackground(worker, {
    notification: {
      id: notif.id,
      public: true,
    },
  });
  expect(sendPushNotification).toHaveBeenCalledWith(['2'], notif, avatars[1]);
});

it('should not send follow push notification if the user prefers not to receive them', async () => {
  const userId = '1';
  const repo = con.getRepository(User);
  const user = await repo.findOneBy({ id: userId });
  await repo.save({ ...user, followNotifications: false });
  await saveFixtures(con, Source, sourcesFixture);
  const post = await con.getRepository(ArticlePost).save(postsFixture[0]);
  const source = await con.getRepository(Source).findOneBy({
    id: post.sourceId,
  });
  const ctx: NotificationUserContext & NotificationPostContext = {
    userIds: ['1'],
    user: user as Reference<User>,
    post,
    source: source as Reference<Source>,
  };

  const notificationId = await saveNotificationV2Fixture(
    con,
    NotificationType.UserPostAdded,
    ctx,
  );
  await expectSuccessfulBackground(worker, {
    notification: {
      id: notificationId,
      userId,
      public: true,
    },
  });
  expect(sendPushNotification).toHaveBeenCalledTimes(0);
});
