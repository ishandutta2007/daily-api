import { DataSource } from 'typeorm';
import worker from '../../../src/workers/notifications/sourcePostModerationRejectedNotification';
import createOrGetConnection from '../../../src/db';
import {
  Post,
  Source,
  SourceMember,
  SourceType,
  User,
} from '../../../src/entity';
import { sourcesFixture, usersFixture } from '../../fixture';
import { workers } from '../../../src/workers';
import { invokeNotificationWorker, saveFixtures } from '../../helpers';
import { SourcePostModerationStatus } from '../../../src/entity/SourcePostModeration';
import { SourceMemberRoles } from '../../../src/roles';
import { NotificationPostModerationContext } from '../../../src/notifications';
import { postsFixture } from '../../fixture/post';

let con: DataSource;

beforeAll(async () => {
  con = await createOrGetConnection();
});

beforeEach(async () => {
  jest.resetAllMocks();
  await saveFixtures(con, Source, sourcesFixture);
  await saveFixtures(con, User, usersFixture);
  await saveFixtures(con, Post, postsFixture);
});

describe('SourcePostModerationSubmitted', () => {
  it('should be registered', () => {
    const registeredWorker = workers.find(
      (item) => item.subscription === worker.subscription,
    );

    expect(registeredWorker).toBeDefined();
  });

  it('should not send notification when status is not rejected', async () => {
    const postApproved = {
      sourceId: 'a',
      createdById: '2',
      status: SourcePostModerationStatus.Approved,
    };

    const approved = await invokeNotificationWorker(worker, {
      post: postApproved,
    });
    expect(approved).toBeUndefined();

    const postPending = {
      sourceId: 'a',
      createdById: '2',
      status: SourcePostModerationStatus.Pending,
    };

    const pending = await invokeNotificationWorker(worker, {
      post: postPending,
    });
    expect(pending).toBeUndefined();
  });

  it('should send notification to author only', async () => {
    const post = {
      sourceId: 'a',
      createdById: '2',
      status: SourcePostModerationStatus.Rejected,
    };
    await con
      .getRepository(Source)
      .update({ id: 'a' }, { type: SourceType.Squad });
    await con.getRepository(SourceMember).save({
      sourceId: 'a',
      userId: '1',
      role: SourceMemberRoles.Admin,
      referralToken: 'a',
    });

    const result = await invokeNotificationWorker(worker, { post });
    const ctx = result[0].ctx as NotificationPostModerationContext;

    expect(result.length).toEqual(1);
    expect(result[0].type).toEqual('source_post_rejected');
    expect(ctx.userIds).toEqual(['2']);
  });

  it('should not send notification other members', async () => {
    const post = {
      sourceId: 'a',
      createdById: '2',
      status: SourcePostModerationStatus.Rejected,
    };
    await con
      .getRepository(Source)
      .update({ id: 'a' }, { type: SourceType.Squad });
    await con.getRepository(SourceMember).save([
      {
        sourceId: 'a',
        userId: '1',
        role: SourceMemberRoles.Moderator,
        referralToken: 'a',
      },
      {
        sourceId: 'a',
        userId: '3',
        role: SourceMemberRoles.Member,
        referralToken: 'b',
      },
      {
        sourceId: 'a',
        userId: '4',
        role: SourceMemberRoles.Moderator,
        referralToken: 'c',
      },
    ]);

    const result = await invokeNotificationWorker(worker, { post });
    const ctx = result[0].ctx as NotificationPostModerationContext;

    expect(result.length).toEqual(1);
    expect(result[0].type).toEqual('source_post_rejected');
    expect(ctx.userIds).toEqual(['2']);
    const ownerOnly = ctx.userIds.every((id) => id === '2');
    expect(ownerOnly).toBeTruthy();
  });
});
