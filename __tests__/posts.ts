import {
  disposeGraphQLTesting,
  expectTypedEvent,
  GraphQLTestClient,
  GraphQLTestingState,
  initializeGraphQLTesting,
  MockContext,
  saveFixtures,
  testMutationError,
  testMutationErrorCode,
  testQueryError,
  testQueryErrorCode,
} from './helpers';
import {
  ArticlePost,
  Bookmark,
  BookmarkList,
  BRIEFING_SOURCE,
  clearPostTranslations,
  Comment,
  Feed,
  FreeformPost,
  Post,
  PostMention,
  PostQuestion,
  PostRelation,
  PostRelationType,
  PostReport,
  PostTag,
  PostType,
  Settings,
  SharePost,
  Source,
  SourceMember,
  SourceType,
  SourceUser,
  SquadSource,
  User,
  UserAction,
  UserActionType,
  UserPost,
  View,
  WelcomePost,
  YouTubePost,
} from '../src/entity';
import { Roles, SourceMemberRoles, sourceRoleRank } from '../src/roles';
import { sourcesFixture } from './fixture/source';
import {
  createPostCodeSnippetsFixture,
  postsFixture,
  postTagsFixture,
  relatedPostsFixture,
  videoPostsFixture,
} from './fixture/post';
import { DataSource, DeepPartial, IsNull, Not } from 'typeorm';
import createOrGetConnection from '../src/db';
import {
  createSquadWelcomePost,
  DEFAULT_POST_TITLE,
  notifyContentRequested,
  notifyView,
  pickImageUrl,
  postScraperOrigin,
  triggerTypedEvent,
  updateFlagsStatement,
  WATERCOOLER_ID,
} from '../src/common';
import { randomUUID } from 'crypto';
import nock from 'nock';
import {
  deleteKeysByPattern,
  getRedisObject,
  getRedisObjectExpiry,
  ioRedisPool,
  setRedisObject,
  deleteRedisKey,
} from '../src/redis';
import { checkHasMention, markdown } from '../src/common/markdown';
import { generateStorageKey, StorageTopic } from '../src/config';
import { UserVote, UserVoteEntity } from '../src/types';
import { rateLimiterName } from '../src/directive/rateLimit';
import { badUsersFixture, usersFixture } from './fixture/user';
import { PostCodeSnippet } from '../src/entity/posts/PostCodeSnippet';
import {
  PostModerationReason,
  SourcePostModeration,
  SourcePostModerationStatus,
} from '../src/entity/SourcePostModeration';
import { generateUUID } from '../src/ids';
import { GQLResponse } from 'mercurius-integration-testing';
import type { GQLPostSmartTitle } from '../src/schema/posts';
import { SubscriptionCycles } from '../src/paddle';
import {
  ContentPreferenceStatus,
  ContentPreferenceType,
} from '../src/entity/contentPreference/types';
import { ContentPreference } from '../src/entity/contentPreference/ContentPreference';
import {
  UserTransaction,
  UserTransactionProcessor,
  UserTransactionStatus,
} from '../src/entity/user/UserTransaction';
import { Product, ProductType } from '../src/entity/Product';
import { BriefingModel, BriefingType } from '../src/integrations/feed';
import { UserBriefingRequest } from '@dailydotdev/schema';
import { addDays } from 'date-fns';
import { BriefPost } from '../src/entity/posts/BriefPost';

jest.mock('../src/common/pubsub', () => ({
  ...(jest.requireActual('../src/common/pubsub') as Record<string, unknown>),
  notifyView: jest.fn(),
  notifyContentRequested: jest.fn(),
}));

jest.mock('../src/common/typedPubsub', () => ({
  ...(jest.requireActual('../src/common/typedPubsub') as Record<
    string,
    unknown
  >),
  triggerTypedEvent: jest.fn(),
}));

let con: DataSource;
let state: GraphQLTestingState;
let client: GraphQLTestClient;
let loggedUser: string = null;
let isTeamMember = false;
let isPlus = false;
let roles: Roles[] = [];

beforeAll(async () => {
  con = await createOrGetConnection();
  state = await initializeGraphQLTesting(
    (req) => new MockContext(con, loggedUser, roles, req, isTeamMember, isPlus),
  );
  client = state.client;
});

beforeEach(async () => {
  loggedUser = null;
  isTeamMember = false;
  isPlus = false;
  roles = [];
  jest.clearAllMocks();
  await ioRedisPool.execute((client) => client.flushall());

  await saveFixtures(con, Source, sourcesFixture);
  await saveFixtures(con, ArticlePost, postsFixture);
  await saveFixtures(con, YouTubePost, videoPostsFixture);
  await saveFixtures(con, PostTag, postTagsFixture);
  await saveFixtures(con, User, badUsersFixture);
  await con
    .getRepository(User)
    .save({ id: '1', name: 'Ido', image: 'https://daily.dev/ido.jpg' });
  await con.getRepository(User).save({
    id: '2',
    name: 'Lee',
    image: 'https://daily.dev/lee.jpg',
  });
  await con.getRepository(User).save([
    {
      id: '2',
      name: 'Lee',
      image: 'https://daily.dev/lee.jpg',
    },
    {
      id: '3',
      name: 'Amar',
    },
    {
      id: '4',
      name: 'John Doe',
    },
    {
      id: '5',
      name: 'Joanna Deer',
    },
  ]);
  await con.getRepository(SquadSource).save([
    {
      id: 'm',
      name: 'Moderated Squad',
      image: 'http//image.com/m',
      handle: 'moderatedSquad',
      type: SourceType.Squad,
      active: true,
      private: false,
      moderationRequired: true,
      memberPostingRank: sourceRoleRank[SourceMemberRoles.Member],
      memberInviteRank: sourceRoleRank[SourceMemberRoles.Member],
    },
    {
      id: 'm2',
      name: 'Second Moderated Squad',
      image: 'http//image.com/m2',
      handle: 'moderatedSquad2',
      type: SourceType.Squad,
      active: true,
      private: false,
      moderationRequired: true,
      memberPostingRank: sourceRoleRank[SourceMemberRoles.Member],
      memberInviteRank: sourceRoleRank[SourceMemberRoles.Member],
    },
  ]);

  await con.getRepository(SourceMember).save([
    {
      userId: '3',
      sourceId: 'm',
      role: SourceMemberRoles.Moderator,
      referralToken: randomUUID(),
    },
    {
      userId: '4',
      sourceId: 'm',
      role: SourceMemberRoles.Member,
      referralToken: randomUUID(),
    },
    {
      userId: '5',
      sourceId: 'm',
      role: SourceMemberRoles.Member,
      referralToken: randomUUID(),
    },
    {
      userId: '2',
      sourceId: 'm2',
      role: SourceMemberRoles.Moderator,
      referralToken: randomUUID(),
    },
  ]);
  await deleteKeysByPattern(`${rateLimiterName}:*`);
});

const saveSquadFixtures = async () => {
  await con
    .getRepository(Source)
    .update({ id: 'a' }, { type: SourceType.Squad });
  await con
    .getRepository(Post)
    .update(
      { id: 'p1' },
      { type: PostType.Welcome, title: 'Welcome post', authorId: '1' },
    );
  await con.getRepository(SourceMember).save([
    {
      userId: '1',
      sourceId: 'a',
      role: SourceMemberRoles.Member,
      referralToken: randomUUID(),
    },
    {
      userId: '2',
      sourceId: 'a',
      role: SourceMemberRoles.Member,
      referralToken: randomUUID(),
    },
  ]);
  await con.getRepository(SourceMember).save(
    badUsersFixture.map((user) => ({
      userId: user.id,
      sourceId: 'a',
      role: SourceMemberRoles.Member,
      referralToken: randomUUID(),
    })),
  );
};

afterAll(() => disposeGraphQLTesting(state));

describe('slug field', () => {
  const QUERY = `{
    post(id: "p1") {
      slug
    }
  }`;

  it('should return the post slug', async () => {
    const res = await client.query(QUERY);
    expect(res.data.post.slug).toBe('p1-p1');
  });

  it('should return the post slug as id if title is empty', async () => {
    const repo = con.getRepository(ArticlePost);
    await repo.update({ id: 'p1' }, { title: '' });
    const res = await client.query(QUERY);
    expect(res.data.post.slug).toBe('p1');
  });

  it('should return the post slug cleaned if special characters are used', async () => {
    const repo = con.getRepository(ArticlePost);
    await repo.update(
      { id: 'p1' },
      { title: 'gemüse🦙✨杂货/薄荷نعناع!@#$%^&*()_+}{[],./;:""' },
    );
    const res = await client.query(QUERY);
    expect(res.data.post.slug).toBe('gem-se--p1');
  });

  it('should return the post slug truncated if title is too long', async () => {
    const repo = con.getRepository(ArticlePost);
    await repo.update(
      { id: 'p1' },
      {
        title:
          'Donec vulputate neque a est convallis, at interdum ligula fermentum. Pellentesque euismod semper urna, ac eleifend felis viverra nec. Phasellus sit am',
      },
    );
    const res = await client.query(QUERY);
    expect(res.data.post.slug).toBe(
      'donec-vulputate-neque-a-est-convallis-at-interdum-ligula-fermentum-pellentesque-euismod-semper-urn-p1',
    );
  });

  it('should return the post slug when searching for slug', async () => {
    const SUB_QUERY = `{
    post(id: "p1-p1") {
      slug
    }
  }`;
    const res = await client.query(SUB_QUERY);
    expect(res.data.post.slug).toBe('p1-p1');
  });
});

describe('image fields', () => {
  const QUERY = /* GraphQL */ `
    {
      post(id: "image") {
        image
      }
    }
  `;

  it('should return default image when no image exists', async () => {
    const repo = con.getRepository(ArticlePost);
    await repo.save({
      id: 'image',
      shortId: 'image',
      title: 'No image',
      url: 'http://noimage.com',
      score: 0,
      sourceId: 'a',
      createdAt: new Date(2020, 4, 4, 19, 35),
    });
    const res = await client.query(QUERY);
    expect(res.data).toMatchSnapshot();
  });

  it('should return post image when exists', async () => {
    const repo = con.getRepository(ArticlePost);
    await repo.save({
      id: 'image',
      shortId: 'image',
      title: 'Image',
      url: 'http://post.com',
      score: 0,
      sourceId: 'a',
      createdAt: new Date(2020, 4, 4, 19, 35),
      image: 'http://image.com',
      ratio: 0.5,
    });
    const res = await client.query(QUERY);
    expect(res.data).toMatchSnapshot();
  });

  it('should use image proxy', async () => {
    const repo = con.getRepository(ArticlePost);
    await repo.save({
      id: 'image',
      shortId: 'image',
      title: 'Image',
      url: 'http://post.com',
      score: 0,
      sourceId: 'a',
      createdAt: new Date(2020, 4, 4, 19, 35),
      image:
        'https://daily-now-res.cloudinary.com/image/upload/f_auto,q_auto/v1680721516/e0a51d08219c9267b010b136f9fe29f5',
    });
    const res = await client.query(QUERY);
    expect(res.data.post.image).toEqual(
      'https://media.daily.dev/image/upload/f_auto,q_auto/v1680721516/e0a51d08219c9267b010b136f9fe29f5',
    );
  });

  it('should use image proxy for second variation', async () => {
    const repo = con.getRepository(ArticlePost);
    await repo.save({
      id: 'image',
      shortId: 'image',
      title: 'Image',
      url: 'http://post.com',
      score: 0,
      sourceId: 'a',
      createdAt: new Date(2020, 4, 4, 19, 35),
      image:
        'https://res.cloudinary.com/daily-now/image/upload/f_auto,q_auto/v1680721516/e0a51d08219c9267b010b136f9fe29f5',
    });
    const res = await client.query(QUERY);
    expect(res.data.post.image).toEqual(
      'https://media.daily.dev/image/upload/f_auto,q_auto/v1680721516/e0a51d08219c9267b010b136f9fe29f5',
    );
  });
});

describe('source field', () => {
  const QUERY = `{
    post(id: "p1") {
      source {
        id
        name
        image
        public
      }
    }
  }`;

  it('should return the public representation', async () => {
    const res = await client.query(QUERY);
    expect(res.data).toMatchSnapshot();
  });

  // it('should return the private representation', async () => {
  //   loggedUser = '1';
  //   const repo = con.getRepository(SourceDisplay);
  //   await repo.delete({ sourceId: 'a' });
  //   await repo.save({
  //     sourceId: 'a',
  //     name: 'Private A',
  //     image: 'https://private.com/a',
  //     userId: loggedUser,
  //   });
  //   const res = await client.query(QUERY);
  //   expect(res.data).toMatchSnapshot();
  // });
});

describe('read field', () => {
  const QUERY = `{
    post(id: "p1") {
      read
    }
  }`;

  it('should return null when user is not logged in', async () => {
    const res = await client.query(QUERY);
    expect(res.data.post.read).toEqual(null);
  });

  it('should return false when user did not read the post', async () => {
    loggedUser = '1';
    const res = await client.query(QUERY);
    expect(res.data.post.read).toEqual(false);
  });

  it('should return true when user did read the post', async () => {
    loggedUser = '1';
    const repo = con.getRepository(View);
    await repo.save(
      repo.create({
        postId: 'p1',
        userId: loggedUser,
      }),
    );
    const res = await client.query(QUERY);
    expect(res.data.post.read).toEqual(true);
  });
});

describe('bookmarked field', () => {
  const QUERY = `{
    post(id: "p1") {
      bookmarked
    }
  }`;

  it('should return null when user is not logged in', async () => {
    const res = await client.query(QUERY);
    expect(res.data.post.bookmarked).toEqual(null);
  });

  it('should return false when user did not bookmark the post', async () => {
    loggedUser = '1';
    const res = await client.query(QUERY);
    expect(res.data.post.bookmarked).toEqual(false);
  });

  it('should return true when user did bookmark the post', async () => {
    loggedUser = '1';
    const repo = con.getRepository(Bookmark);
    await repo.save(
      repo.create({
        postId: 'p1',
        userId: loggedUser,
      }),
    );
    const res = await client.query(QUERY);
    expect(res.data.post.bookmarked).toEqual(true);
  });
});

describe('bookmark field', () => {
  const QUERY = `{
    post(id: "p1") {
      bookmark {
        createdAt
        remindAt
      }
    }
  }`;

  it('should return null when user is not logged in', async () => {
    const res = await client.query(QUERY);
    expect(res.data.post.bookmark).toEqual(null);
  });

  it('should return null when user did not bookmark the post', async () => {
    loggedUser = '1';
    const res = await client.query(QUERY);
    expect(res.data.post.bookmark).toEqual(null);
  });

  it('should return bookmark object when user did bookmark the post', async () => {
    loggedUser = '1';
    const repo = con.getRepository(Bookmark);
    await repo.save({
      postId: 'p1',
      userId: loggedUser,
      remindAt: new Date(),
    });
    const res = await client.query(QUERY);
    expect(res.data.post.bookmark.createdAt).toBeTruthy();
    expect(res.data.post.bookmark.remindAt).toBeTruthy();
  });
});

describe('bookmarkList field', () => {
  const QUERY = `{
    post(id: "p1") {
      bookmarkList {
        id
        name
      }
    }
  }`;

  let list;

  beforeEach(async () => {
    list = await con
      .getRepository(BookmarkList)
      .save({ name: 'my list', userId: '1' });
  });

  it('should return null when user is not logged in', async () => {
    const res = await client.query(QUERY);
    expect(res.data.post.bookmarkList).toEqual(null);
  });

  it('should return null when bookmark does not belong to a list', async () => {
    loggedUser = '1';
    await con.getRepository(Bookmark).save({
      postId: 'p1',
      userId: loggedUser,
    });
    const res = await client.query(QUERY);
    expect(res.data.post.bookmarkList).toEqual(null);
  });

  it('should return the bookmark list', async () => {
    loggedUser = '1';
    await con.getRepository(Bookmark).save({
      postId: 'p1',
      userId: loggedUser,
      listId: list.id,
    });
    const res = await client.query(QUERY);
    expect(res.data.post.bookmarkList).toEqual({
      id: list.id,
      name: list.name,
    });
  });
});

describe('permalink field', () => {
  const QUERY = `{
    post(id: "p1") {
      permalink
    }
  }`;

  it('should return permalink of the post', async () => {
    const res = await client.query(QUERY);
    expect(res.data.post.permalink).toEqual('http://localhost:4000/r/sp1');
  });
});

describe('commentsPermalink field', () => {
  const QUERY = `{
    post(id: "p1") {
      commentsPermalink
    }
  }`;

  it('should return permalink of the post', async () => {
    const res = await client.query(QUERY);
    expect(res.data.post.commentsPermalink).toEqual(
      'http://localhost:5002/posts/p1-p1',
    );
  });
});

describe('domain field', () => {
  const QUERY = `{
    post(id: "p1") {
      domain
    }
  }`;

  it('should return domain of the post', async () => {
    await con
      .getRepository(ArticlePost)
      .update('p1', { url: 'http://www.p1.com' });
    const res = await client.query(QUERY);
    expect(res.data.post.domain).toEqual('p1.com');
  });

  it('should return domain plus subdomain of the post', async () => {
    await con
      .getRepository(ArticlePost)
      .update('p1', { url: 'http://api.p1.com' });
    const res = await client.query(QUERY);
    expect(res.data.post.domain).toEqual('api.p1.com');
  });
});

describe('upvoted field', () => {
  const QUERY = `{
    post(id: "p1") {
      upvoted
    }
  }`;

  it('should return null when user is not logged in', async () => {
    const res = await client.query(QUERY);
    expect(res.data.post.upvoted).toEqual(null);
  });

  it('should return false when user did not upvoted the post', async () => {
    loggedUser = '1';
    const res = await client.query(QUERY);
    expect(res.data.post.upvoted).toEqual(false);
  });

  it('should return true when user did upvoted the post', async () => {
    loggedUser = '1';
    const repo = con.getRepository(UserPost);
    await repo.save(
      repo.create({
        postId: 'p1',
        userId: loggedUser,
        vote: UserVote.Up,
      }),
    );
    const res = await client.query(QUERY);
    expect(res.data.post.upvoted).toEqual(true);
  });
});

describe('commented field', () => {
  const QUERY = `{
    post(id: "p1") {
      commented
    }
  }`;

  it('should return null when user is not logged in', async () => {
    const res = await client.query(QUERY);
    expect(res.data.post.commented).toEqual(null);
  });

  it('should return false when user did not commented the post', async () => {
    loggedUser = '1';
    const res = await client.query(QUERY);
    expect(res.data.post.commented).toEqual(false);
  });

  it('should return true when user did commented the post', async () => {
    loggedUser = '1';
    const repo = con.getRepository(Comment);
    await repo.save(
      repo.create({
        id: 'c1',
        postId: 'p1',
        userId: loggedUser,
        content: 'My comment',
      }),
    );
    const res = await client.query(QUERY);
    expect(res.data.post.commented).toEqual(true);
  });
});

describe('author field', () => {
  const QUERY = `{
    post(id: "p1") {
      author {
        id
        name
      }
    }
  }`;

  it('should return null when author is not set', async () => {
    const res = await client.query(QUERY);
    expect(res.data).toMatchSnapshot();
  });

  it('should return the author when set', async () => {
    await con
      .getRepository(User)
      .save([{ id: '1', name: 'Ido', image: 'https://daily.dev/ido.jpg' }]);
    await con.getRepository(Post).update('p1', { authorId: '1' });
    const res = await client.query(QUERY);
    expect(res.data).toMatchSnapshot();
  });
});

describe('scout field', () => {
  const QUERY = `{
    post(id: "p1") {
      scout {
        id
        name
      }
      author {
        id
        name
      }
    }
  }`;

  it('should return null when scout is not set', async () => {
    const res = await client.query(QUERY);
    expect(res.data).toMatchSnapshot();
  });

  it('should return the scout when set', async () => {
    await con
      .getRepository(User)
      .save([{ id: '1', name: 'Ido', image: 'https://daily.dev/ido.jpg' }]);
    await con.getRepository(Post).update('p1', { scoutId: '1' });
    const res = await client.query(QUERY);
    expect(res.data).toMatchSnapshot();
  });

  it('should return the scout and author correctly', async () => {
    await con.getRepository(User).save([
      { id: '1', name: 'Ido', image: 'https://daily.dev/ido.jpg' },
      { id: '2', name: 'Lee', image: 'https://daily.dev/lee.jpg' },
    ]);
    await con.getRepository(Post).update('p1', { scoutId: '1', authorId: '2' });
    const res = await client.query(QUERY);
    expect(res.data).toMatchSnapshot();
  });
});

describe('views field', () => {
  const QUERY = `{
    post(id: "p1") {
      views
    }
  }`;

  it('should return null when the user is not the author', async () => {
    const res = await client.query(QUERY);
    expect(res.errors).toBeFalsy();
    expect(res.data.post.views).toEqual(null);
  });

  it('should return views when the user is the author', async () => {
    loggedUser = '1';
    await con
      .getRepository(User)
      .save([{ id: '1', name: 'Ido', image: 'https://daily.dev/ido.jpg' }]);
    await con.getRepository(Post).update('p1', { authorId: '1', views: 200 });
    const res = await client.query(QUERY);
    expect(res.errors).toBeFalsy();
    expect(res.data.post.views).toEqual(200);
  });
});

describe('toc field', () => {
  const QUERY = `{
    post(id: "p1") {
      toc { text, id, children { text, id } }
    }
  }`;

  it('should return null when toc is not set', async () => {
    const res = await client.query(QUERY);
    expect(res.errors).toBeFalsy();
    expect(res.data).toMatchSnapshot();
  });

  it('should return the toc when set', async () => {
    await con.getRepository(Post).update('p1', {
      toc: [
        {
          text: 'Title 1',
          id: 'title-1',
          children: [{ text: 'Sub 1', id: 'sub-1' }],
        },
        { text: 'Title 2', id: 'title-2' },
      ],
    } as DeepPartial<ArticlePost>);
    const res = await client.query(QUERY);
    expect(res.errors).toBeFalsy();
    expect(res.data).toMatchSnapshot();
  });
});

describe('sharedPost field', () => {
  const QUERY = `{
    post(id: "ps") {
      sharedPost {
        id
        title
        createdAt
      }
    }
  }`;

  it('should return the share post properties', async () => {
    await con.getRepository(SharePost).save({
      id: 'ps',
      shortId: 'ps',
      sourceId: 'a',
      title: 'Shared post',
      sharedPostId: 'p1',
    });
    const res = await client.query(QUERY);
    expect(res.data).toEqual({
      post: {
        sharedPost: {
          id: 'p1',
          title: 'P1',
          createdAt: expect.any(String),
        },
      },
    });
  });
});

describe('type field', () => {
  const QUERY = `{
    post(id: "p1") {
      type
    }
  }`;

  it('should return the share post properties', async () => {
    const res = await client.query(QUERY);
    expect(res.data).toEqual({
      post: { type: PostType.Article },
    });
  });
});

describe('translation field', () => {
  beforeEach(async () => {
    await saveFixtures(con, ArticlePost, [
      {
        id: 'p1-tf',
        shortId: 'sp1-tf',
        title: 'P1-tf',
        url: 'http://p1-tf.com',
        canonicalUrl: 'http://p1-tfc.com',
        image: 'https://daily.dev/image.jpg',
        score: 1,
        sourceId: 'a',
        tagsStr: 'javascript,webdev',
        type: PostType.Article,
        contentCuration: ['c1', 'c2'],
      },
    ]);
  });

  const QUERY = /* GraphQL */ `
    {
      post(id: "p1-tf") {
        translation {
          title
          smartTitle
        }
      }
    }
  `;

  it('should return null for fields when content-language header is not set', async () => {
    const res = await client.query(QUERY);
    expect(res.data.post.translation).toEqual({
      title: null,
      smartTitle: null,
    });
  });

  it('should return null for fields when translation does not exist', async () => {
    await con.getRepository(ArticlePost).update('p1-tf', {
      translation: {
        es: {
          title: 'Hola',
        },
      },
    });
    const res = await client.query(QUERY, {
      headers: {
        'content-language': 'de',
      },
    });
    expect(res.data.post.translation).toEqual({
      title: null,
      smartTitle: null,
    });
  });

  it('should return true for fields when translation does exist for the field', async () => {
    await con.getRepository(ArticlePost).update('p1-tf', {
      translation: {
        es: {
          title: 'Hola',
        },
      },
    });
    const res = await client.query(QUERY, {
      headers: {
        'content-language': 'es',
      },
    });
    expect(res.data.post.translation).toEqual({
      title: true,
      smartTitle: false,
    });
  });

  describe('post updated', () => {
    it('should clear post title translations when title is updated', async () => {
      await con.getRepository(ArticlePost).update('p1-tf', {
        translation: {
          es: {
            title: 'Hola',
            summary: 'Cuerpo',
          },
          de: {
            title: 'Hallo',
            summary: 'Körper',
          },
        },
      });

      await clearPostTranslations(con, 'p1-tf', 'title');

      const post = await con
        .getRepository(ArticlePost)
        .findOneByOrFail({ id: 'p1-tf' });

      expect(post.translation).toEqual({
        es: {
          summary: 'Cuerpo',
        },
        de: {
          summary: 'Körper',
        },
      });
    });

    it('should not fail when translation does not exist', async () => {
      expect(
        (await con.getRepository(ArticlePost).findOneByOrFail({ id: 'p1-tf' }))
          .translation,
      ).toEqual({});
      await clearPostTranslations(con, 'p1-tf', 'title');
      expect(
        (await con.getRepository(ArticlePost).findOneByOrFail({ id: 'p1-tf' }))
          .translation,
      ).toEqual({});
    });

    it('should not fail when translation contains scalar value', async () => {
      await con.getRepository(ArticlePost).update('p1-tf', {
        translation: {
          // @ts-expect-error we're testing against scalar value
          some: 'value',
        },
      });

      await clearPostTranslations(con, 'p1-tf', 'title');
      expect(
        (await con.getRepository(ArticlePost).findOneByOrFail({ id: 'p1-tf' }))
          .translation,
      ).toEqual({ some: 'value' });
    });
  });
});

describe('freeformPost type', () => {
  const QUERY = `{
    post(id: "ff") {
      type
      content
      contentHtml
    }
  }`;

  it('should return the freeform post properties', async () => {
    await con.getRepository(FreeformPost).save({
      id: 'ff',
      shortId: 'ff',
      sourceId: 'a',
      title: 'Freeform post',
      content: '#Test',
      contentHtml: '<h1>Test</h1>',
    });
    const res = await client.query(QUERY);
    expect(res.data).toEqual({
      post: {
        type: PostType.Freeform,
        content: '#Test',
        contentHtml: '<h1>Test</h1>',
      },
    });
  });
});

describe('welcomePost type', () => {
  const QUERY = `{
    post(id: "wp") {
      type
      content
      contentHtml
    }
  }`;

  it('should return the welcome post properties', async () => {
    await con.getRepository(WelcomePost).save({
      id: 'wp',
      shortId: 'wp',
      sourceId: 'a',
      title: 'Welcome post',
      content: '#Test',
      contentHtml: '<h1>Test</h1>',
    });
    const res = await client.query(QUERY);
    expect(res.data).toEqual({
      post: {
        type: PostType.Welcome,
        content: '#Test',
        contentHtml: '<h1>Test</h1>',
      },
    });
  });

  it('should add welcome post with showOnFeed as false by default', async () => {
    const source = await con.getRepository(Source).findOneByOrFail({ id: 'a' });
    const post = await createSquadWelcomePost(con, source, '1');
    expect(post.showOnFeed).toEqual(false);
    expect(post.flags.showOnFeed).toEqual(false);
  });

  it('should add welcome post and increment squad total posts', async () => {
    const repo = con.getRepository(Source);
    const sourceToCount = await repo.findOneByOrFail({ id: 'a' });
    expect(sourceToCount.flags.totalPosts).toEqual(3);
    const posts = await con.getRepository(Post).countBy({ sourceId: 'a' });
    expect(posts).toEqual(3);
    await repo.update({ id: 'a' }, { type: SourceType.Squad });
    const source = await repo.findOneByOrFail({ id: 'a' });
    const post = await createSquadWelcomePost(con, source, '1');
    expect(post.showOnFeed).toEqual(false);
    expect(post.flags.showOnFeed).toEqual(false);

    const updatedSource = await repo.findOneByOrFail({ id: 'a' });
    expect(updatedSource.flags.totalPosts).toEqual(posts + 1);
  });

  it('should add a post and increment source total posts', async () => {
    const repo = con.getRepository(Source);
    const posts = await con.getRepository(Post).countBy({ sourceId: 'a' });
    expect(posts).toEqual(3);
    const source = await repo.findOneByOrFail({ id: 'a' });
    const post = await createSquadWelcomePost(con, source, '1');
    expect(post.showOnFeed).toEqual(false);
    expect(post.flags.showOnFeed).toEqual(false);

    const updatedSource = await repo.findOneByOrFail({ id: 'a' });
    expect(updatedSource.flags.totalPosts).toEqual(posts + 1);
  });
});

describe('query post', () => {
  const QUERY = (id: string): string => `{
    post(id: "${id}") {
      id
      url
      title
      readTime
      tags
      source {
        id
        name
        image
        public
      }
    }
  }`;

  it('should throw not found when cannot find post', () =>
    testQueryErrorCode(client, { query: QUERY('notfound') }, 'NOT_FOUND'));

  it('should throw not found when post was soft deleted #1', async () => {
    await saveFixtures(con, ArticlePost, [
      {
        id: 'pdeleted',
        shortId: 'spdeleted',
        title: 'PDeleted',
        url: 'http://p8.com',
        score: 0,
        sourceId: 'a',
        createdAt: new Date('2021-09-22T07:15:51.247Z'),
        tagsStr: 'javascript,webdev',
        deleted: true,
      },
    ]);

    return testQueryErrorCode(
      client,
      { query: QUERY('pdeleted') },
      'NOT_FOUND',
    );
  });

  it('should throw not found when post is not visible', async () => {
    await saveFixtures(con, ArticlePost, [
      {
        id: 'pnotvisible',
        shortId: 'pnotvisible',
        title: 'pnotvisible',
        url: 'http://p8.com',
        score: 0,
        sourceId: 'a',
        createdAt: new Date('2021-09-22T07:15:51.247Z'),
        tagsStr: 'javascript,webdev',
        deleted: false,
        visible: false,
      },
    ]);

    return testQueryErrorCode(
      client,
      { query: QUERY('pnotvisible') },
      'NOT_FOUND',
    );
  });

  it('should throw error when user cannot access the post', async () => {
    loggedUser = '1';
    await con.getRepository(Source).update({ id: 'a' }, { private: true });
    await con.getRepository(Post).update({ id: 'p1' }, { private: true });
    return testQueryError(
      client,
      {
        query: QUERY('p1'),
      },
      (errors) => {
        expect(errors.length).toEqual(1);
        expect(errors[0].extensions?.code).toEqual('FORBIDDEN');
        expect(errors[0].extensions?.postId).toEqual('p1');
      },
    );
  });

  it('should throw error when annonymous user tries to access post from source with members', async () => {
    await con.getRepository(Source).update({ id: 'a' }, { private: true });
    await con.getRepository(Post).update({ id: 'p1' }, { private: true });
    await con.getRepository(SourceMember).save({
      sourceId: 'a',
      userId: '1',
      referralToken: 'rt2',
      role: SourceMemberRoles.Admin,
    });
    return testQueryErrorCode(
      client,
      {
        query: QUERY('p1'),
      },
      'FORBIDDEN',
    );
  });

  it('should throw error when non member tries to access post from source with members', async () => {
    loggedUser = '2';
    await con.getRepository(Source).update({ id: 'a' }, { private: true });
    await con.getRepository(Post).update({ id: 'p1' }, { private: true });
    await con.getRepository(SourceMember).save({
      sourceId: 'a',
      userId: '1',
      referralToken: 'rt2',
      role: SourceMemberRoles.Admin,
    });
    return testQueryErrorCode(
      client,
      {
        query: QUERY('p1'),
      },
      'FORBIDDEN',
    );
  });

  it('should return post by id', async () => {
    const res = await client.query(QUERY('p1'));
    expect(res.data).toMatchSnapshot();
  });

  it('should disallow access to post from public source for blocked members', async () => {
    loggedUser = '1';
    await con
      .getRepository(Source)
      .update({ id: 'a' }, { type: SourceType.Squad, private: false });
    await con
      .getRepository(Post)
      .update({ id: 'p1' }, { private: false, sourceId: 'a' });
    await con.getRepository(SourceMember).save({
      sourceId: 'a',
      userId: '1',
      referralToken: 'rt2',
      role: SourceMemberRoles.Blocked,
    });

    return testQueryErrorCode(
      client,
      {
        query: QUERY('p1'),
      },
      'FORBIDDEN',
    );
  });

  it('should throw not found when brief post is from other user', async () => {
    loggedUser = '1';

    await saveFixtures(con, BriefPost, [
      {
        id: 'pbriefanotherauthor',
        shortId: 'pbfaa',
        title: 'pbriefanotherauthor',
        score: 0,
        sourceId: BRIEFING_SOURCE,
        createdAt: new Date('2021-09-22T07:15:51.247Z'),
        private: true,
        visible: true,
        authorId: '2',
      },
    ]);

    return testQueryErrorCode(
      client,
      { query: QUERY('pbriefanotherauthor') },
      'FORBIDDEN',
    );
  });

  describe('clickbaitTitleDetected', () => {
    const LOCAL_QUERY = /* GraphQL */ `
      query Post($id: ID!) {
        post(id: $id) {
          clickbaitTitleDetected
        }
      }
    `;

    it('should return true if clickbait title probability (string) is above threshold', async () => {
      await con.getRepository(ArticlePost).update('p1', {
        contentQuality: { is_clickbait_probability: '1.99' }, // Use 1.99 as it's above the fallback threshold
        contentMeta: { alt_title: { translations: { en: 'Clickbait title' } } },
      });

      const res = await client.query(LOCAL_QUERY, {
        variables: { id: 'p1' },
      });

      expect(res.errors).toBeFalsy();
      expect(res.data.post.clickbaitTitleDetected).toEqual(true);
    });

    it('should return true if clickbait title probability (float) is above threshold', async () => {
      await con.getRepository(ArticlePost).update('p1', {
        contentQuality: { is_clickbait_probability: 1.98 }, // Use 1.98 as it's above the fallback threshold
        contentMeta: { alt_title: { translations: { en: 'Clickbait title' } } },
      });

      const res = await client.query(LOCAL_QUERY, {
        variables: { id: 'p1' },
      });

      expect(res.errors).toBeFalsy();
      expect(res.data.post.clickbaitTitleDetected).toEqual(true);
    });

    it('should return false if clickbait title probability (float) is above threshold but no alt title exists', async () => {
      await con.getRepository(ArticlePost).update('p1', {
        contentQuality: { is_clickbait_probability: 1.98 }, // Use 1.98 as it's above the fallback threshold
      });

      const res = await client.query(LOCAL_QUERY, {
        variables: { id: 'p1' },
      });

      expect(res.errors).toBeFalsy();
      expect(res.data.post.clickbaitTitleDetected).toEqual(false);
    });

    it('should return false if clickbait title probability is below threshold', async () => {
      await con.getRepository(ArticlePost).update('p1', {
        contentQuality: { is_clickbait_probability: 0.2 },
      });

      const res = await client.query(LOCAL_QUERY, {
        variables: { id: 'p1' },
      });

      expect(res.errors).toBeFalsy();
      expect(res.data.post.clickbaitTitleDetected).toEqual(false);
    });

    it('should return false if contentQuality is undefined', async () => {
      const res = await client.query(LOCAL_QUERY, {
        variables: { id: 'p1' },
      });

      expect(res.errors).toBeFalsy();
      expect(res.data.post.clickbaitTitleDetected).toEqual(false);
    });
  });
});

describe('query postByUrl', () => {
  const QUERY = (url: string): string => `{
    postByUrl(url: "${url}") {
      id
      url
      title
    }
  }`;

  it('should throw not found when not valid url', () =>
    testQueryErrorCode(
      client,
      { query: QUERY('notfound') },
      'GRAPHQL_VALIDATION_FAILED',
      'Invalid URL provided',
    ));

  it('should throw not found when cannot find post', () =>
    testQueryErrorCode(
      client,
      { query: QUERY('http://notfound.com') },
      'NOT_FOUND',
    ));

  it('should throw not found when post was soft deleted #2', async () => {
    await saveFixtures(con, ArticlePost, [
      {
        id: 'pdeleted',
        shortId: 'spdeleted',
        title: 'PDeleted',
        url: 'http://pdelp8.com',
        canonicalUrl: 'http://pdelp8.com',
        score: 0,
        sourceId: 'a',
        createdAt: new Date('2021-09-22T07:15:51.247Z'),
        tagsStr: 'javascript,webdev',
        deleted: true,
      },
    ]);

    return testQueryErrorCode(
      client,
      { query: QUERY('http://pdelp8.com') },
      'NOT_FOUND',
    );
  });

  it('should throw not found when post is not visible', async () => {
    await saveFixtures(con, ArticlePost, [
      {
        id: 'pnotvisible',
        shortId: 'pnotvisible',
        title: 'pnotvisible',
        url: 'http://pdelp8.com',
        canonicalUrl: 'http://pdelp8.com',
        score: 0,
        sourceId: 'a',
        createdAt: new Date('2021-09-22T07:15:51.247Z'),
        tagsStr: 'javascript,webdev',
        deleted: false,
        visible: false,
      },
    ]);

    return testQueryErrorCode(
      client,
      { query: QUERY('http://pdelp8.com') },
      'NOT_FOUND',
    );
  });

  it('should throw error when source is private', async () => {
    await con.getRepository(Source).update({ id: 'a' }, { private: true });
    await con.getRepository(Post).update({ id: 'p1' }, { private: true });
    return testQueryErrorCode(
      client,
      { query: QUERY('http://p1.com') },
      'FORBIDDEN',
    );
  });

  it('should return post by canonical', async () => {
    const res = await client.query(QUERY('http://p1c.com'));
    expect(res.data).toMatchSnapshot();
  });

  it('should return post by url', async () => {
    const res = await client.query(QUERY('http://p1.com'));
    expect(res.data).toMatchSnapshot();
  });

  it('should return post if query params attached', async () => {
    const res = await client.query(QUERY('http://p1.com?query=param'));
    expect(res.data).toMatchSnapshot();
  });

  it('should return post if query params on youtube link', async () => {
    await saveFixtures(con, ArticlePost, [
      {
        id: 'yt0',
        shortId: 'yt0',
        title: 'Youtube video',
        url: 'https://youtube.com/watch?v=123',
        score: 0,
        sourceId: 'a',
        createdAt: new Date('2021-09-22T07:15:51.247Z'),
        tagsStr: 'javascript,webdev',
        deleted: false,
      },
    ]);
    const res = await client.query(QUERY('https://youtube.com/watch?v=123'));
    expect(res.data).toMatchSnapshot();
  });
});

describe('query postUpvotes', () => {
  const QUERY = `
  query postUpvotes($id: String!) {
    postUpvotes(id: $id) {
      edges {
        node {
          votedAt
          user {
            name
            username
            bio
            image
          }
        }
      }
    }
  }
  `;

  it('should throw error when user cannot access the post', async () => {
    loggedUser = '1';
    await con.getRepository(Source).update({ id: 'a' }, { private: true });
    return testQueryErrorCode(
      client,
      {
        query: QUERY,
        variables: { id: 'p1' },
      },
      'FORBIDDEN',
    );
  });

  it('should return users that upvoted the post by id in descending order', async () => {
    const userRepo = con.getRepository(User);
    const userPostRepo = con.getRepository(UserPost);
    const createdAtOld = new Date('2020-09-22T07:15:51.247Z');
    const createdAtNew = new Date('2021-09-22T07:15:51.247Z');
    await userRepo.save({
      id: '2',
      name: 'Lee',
      image: 'https://daily.dev/lee.jpg',
    });
    await userPostRepo.save({
      userId: '1',
      postId: 'p1',
      vote: UserVote.Up,
    });
    await userPostRepo.save({
      userId: '1',
      postId: 'p1',
      votedAt: createdAtOld,
      vote: UserVote.Up,
    });
    await userPostRepo.save({
      userId: '2',
      postId: 'p1',
      vote: UserVote.Up,
    });
    await userPostRepo.save({
      userId: '2',
      postId: 'p1',
      votedAt: createdAtNew,
      vote: UserVote.Up,
    });

    const res = await client.query(QUERY, { variables: { id: 'p1' } });

    const [secondUpvote, firstUpvote] = res.data.postUpvotes.edges;
    expect(res.errors).toBeFalsy();
    expect(res.data).toMatchSnapshot();
    expect(new Date(secondUpvote.node.votedAt).getTime()).toBeGreaterThan(
      new Date(firstUpvote.node.votedAt).getTime(),
    );
  });

  it('should return a list of upvoters that the logged user has not blocked', async () => {
    loggedUser = '1';

    await con.getRepository(User).save([
      {
        id: '2',
        name: 'Lee',
        image: 'https://daily.dev/lee.jpg',
      },
      {
        id: '3',
        name: 'Ante',
        image: 'https://daily.dev/ante.jpg',
      },
      {
        id: '4',
        name: 'Amar',
        image: 'https://daily.dev/amar.jpg',
      },
    ]);

    await con.getRepository(UserPost).save([
      {
        userId: '2',
        postId: 'p1',
        vote: UserVote.Up,
      },
      {
        userId: '3',
        postId: 'p1',
        vote: UserVote.Up,
      },
      {
        userId: '4',
        postId: 'p1',
        vote: UserVote.Up,
      },
    ]);

    await con.getRepository(Feed).save({
      id: '1',
      userId: '1',
    });

    await con.getRepository(ContentPreference).save({
      userId: '1',
      feedId: '1',
      type: ContentPreferenceType.User,
      status: ContentPreferenceStatus.Blocked,
      referenceId: '2',
    });

    const res = await client.query(QUERY, { variables: { id: 'p1' } });
    expect(res.errors).toBeFalsy();
    expect(res.data.postUpvotes.edges.length).toEqual(2);
  });
});

describe('query searchQuestionRecommendations', () => {
  const QUERY = `
    query SearchQuestionRecommendations {
      searchQuestionRecommendations {
        id
        question
      }
    }
  `;

  it('should throw error when user is not logged in', async () =>
    testQueryErrorCode(client, { query: QUERY }, 'UNAUTHENTICATED'));

  it('should return questions related to views of user', async () => {
    loggedUser = '1';

    await con.getRepository(PostQuestion).save([
      { postId: postsFixture[0].id, question: 'Question 1' },
      { postId: postsFixture[1].id, question: 'Question 2' },
      { postId: postsFixture[2].id, question: 'Question 3' },
      { postId: postsFixture[3].id, question: 'Question 4' },
      { postId: postsFixture[4].id, question: 'Question 5' },
      { postId: postsFixture[5].id, question: 'Question 6' },
      { postId: postsFixture[6].id, question: 'Question 7' },
    ]);

    const otherUserUpvotes = [postsFixture[5].id, postsFixture[6].id];
    await con.getRepository(View).save([
      { userId: '1', postId: postsFixture[0].id },
      { userId: '1', postId: postsFixture[1].id },
      { userId: '1', postId: postsFixture[2].id },
      { userId: '1', postId: postsFixture[3].id },
      { userId: '1', postId: postsFixture[4].id },
      { userId: '2', postId: otherUserUpvotes[0] },
      { userId: '2', postId: otherUserUpvotes[1] },
    ]);

    const res = await client.query(QUERY);

    expect(res.errors).toBeFalsy();
    expect(res.data.searchQuestionRecommendations.length).toEqual(3);
  });

  it('should serve cached data if available', async () => {
    loggedUser = '1';
    const key = generateStorageKey(StorageTopic.Search, 'rec', loggedUser);
    await setRedisObject(
      key,
      JSON.stringify([{ id: 'c1', question: 'cached' }]),
    );
    const res = await client.query(QUERY);
    expect(res.errors).toBeFalsy();
    expect(res.data.searchQuestionRecommendations).toEqual([
      { id: 'c1', question: 'cached' },
    ]);
  });
});

describe('mutation hidePost', () => {
  const MUTATION = `
  mutation HidePost($id: ID!) {
  hidePost(id: $id) {
    _
  }
}`;

  it('should not authorize when not logged in', () =>
    testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: { id: 'p1' },
      },
      'UNAUTHENTICATED',
    ));

  it('should throw not found when cannot find post', () => {
    loggedUser = '1';
    return testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: { id: 'invalid' },
      },
      'NOT_FOUND',
    );
  });

  it('should hide the post', async () => {
    loggedUser = '1';
    const res = await client.mutate(MUTATION, { variables: { id: 'p1' } });
    expect(res.errors).toBeFalsy();
    const actualUserPost = await con
      .getRepository(UserPost)
      .findOneBy({ userId: loggedUser });
    expect(actualUserPost).toMatchObject({
      postId: 'p1',
      userId: loggedUser,
      hidden: true,
    });
  });

  it('should ignore conflicts', async () => {
    loggedUser = '1';
    await con.getRepository(UserPost).save({
      postId: 'p1',
      userId: loggedUser,
      hidden: true,
    });
    const res = await client.mutate(MUTATION, { variables: { id: 'p1' } });
    expect(res.errors).toBeFalsy();
    const actualUserPost = await con
      .getRepository(UserPost)
      .findOneBy({ userId: loggedUser, postId: 'p1' });
    expect(actualUserPost).toMatchObject({
      postId: 'p1',
      userId: loggedUser,
      hidden: true,
    });
  });
});

describe('mutation unhidePost', () => {
  const MUTATION = `
    mutation UnhidePost($id: ID!) {
      unhidePost(id: $id) {
        _
      }
    }
  `;

  it('should not authorize when not logged in', () =>
    testMutationErrorCode(
      client,
      { mutation: MUTATION, variables: { id: 'p1' } },
      'UNAUTHENTICATED',
    ));

  it('should unhide post', async () => {
    loggedUser = '1';
    await con.getRepository(UserPost).save({
      postId: 'p1',
      userId: loggedUser,
      hidden: true,
    });
    const initialUserPost = await con
      .getRepository(UserPost)
      .findOneBy({ userId: loggedUser, postId: 'p1' });
    expect(initialUserPost?.hidden).toBe(true);
    const res = await client.mutate(MUTATION, { variables: { id: 'p1' } });
    expect(res.errors).toBeFalsy();
    const actualUserPost = await con
      .getRepository(UserPost)
      .findOneBy({ userId: loggedUser, postId: 'p1' });
    expect(actualUserPost?.hidden).toEqual(false);
  });
});

describe('mutation deletePost', () => {
  const MUTATION = `
    mutation DeletePost($id: ID!) {
      deletePost(id: $id) {
        _
      }
    }
  `;

  it('should not authorize when not logged in', () =>
    testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: { id: 'p1' },
      },
      'UNAUTHENTICATED',
    ));

  it('should delete the post', async () => {
    loggedUser = '1';
    roles = [Roles.Moderator];
    await verifyPostDeleted('p1', loggedUser);
  });

  it('should do nothing if post is already deleted', async () => {
    loggedUser = '1';
    roles = [Roles.Moderator];
    await con.getRepository(Post).delete({ id: 'p1' });
    const res = await client.mutate(MUTATION, { variables: { id: 'p1' } });
    expect(res.errors).toBeFalsy();
  });

  const createSharedPost = async (
    id = 'sp1',
    member: Partial<SourceMember> = {},
    authorId = '2',
  ) => {
    const post = await con.getRepository(Post).findOneBy({ id: 'p1' });
    await con.getRepository(SourceMember).save([
      {
        userId: '1',
        sourceId: 'a',
        role: SourceMemberRoles.Member,
        referralToken: randomUUID(),
      },
      {
        userId: '2',
        sourceId: 'a',
        role: SourceMemberRoles.Member,
        referralToken: randomUUID(),
        ...member,
      },
    ]);
    await con.getRepository(SharePost).save({
      ...post,
      id,
      shortId: `short-${id}`,
      sharedPostId: 'p1',
      authorId,
    });
    await con
      .getRepository(Source)
      .update({ id: 'a' }, { flags: { totalPosts: 1 } });
  };

  it('should not authorize when not logged in', () =>
    testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: { id: 'p1' },
      },
      'UNAUTHENTICATED',
    ));

  it('should restrict when not a member of the squad', async () => {
    loggedUser = '1';
    await createSharedPost();

    return testMutationErrorCode(
      client,
      { mutation: MUTATION, variables: { id: 'sp1' } },
      'FORBIDDEN',
    );
  });

  it('should restrict member deleting a post from a moderator', async () => {
    loggedUser = '1';
    const id = 'sp1';
    await createSharedPost(id, { role: SourceMemberRoles.Moderator });

    return testMutationErrorCode(
      client,
      { mutation: MUTATION, variables: { id: 'sp1' } },
      'FORBIDDEN',
    );
  });

  it('should restrict member deleting a post from the admin', async () => {
    loggedUser = '1';
    const id = 'sp1';
    await createSharedPost(id, { role: SourceMemberRoles.Admin });

    return testMutationErrorCode(
      client,
      { mutation: MUTATION, variables: { id } },
      'FORBIDDEN',
    );
  });

  it('should restrict member deleting a post from other members', async () => {
    loggedUser = '1';
    const id = 'sp1';
    await createSharedPost(id);

    return testMutationErrorCode(
      client,
      { mutation: MUTATION, variables: { id } },
      'FORBIDDEN',
    );
  });

  it('should allow member to delete their own shared post', async () => {
    loggedUser = '2';
    const id = 'sp1';
    await createSharedPost(id);
    await verifyPostDeleted(id, loggedUser);
  });

  const verifyPostDeleted = async (id: string, user: string) => {
    const res = await client.mutate(MUTATION, { variables: { id } });
    expect(res.errors).toBeFalsy();
    const actual = await con.getRepository(Post).findOneByOrFail({ id });
    expect(actual.deleted).toBeTruthy();
    expect(actual.flags.deleted).toBeTruthy();
    expect(actual.flags.deletedBy).toBe(user);
  };

  it('should allow member to delete their own freeform post', async () => {
    loggedUser = '2';
    const source = await con.getRepository(Source).findOneByOrFail({ id: 'a' });
    const post = await createSquadWelcomePost(con, source, '2');
    await con
      .getRepository(Post)
      .update({ id: post.id }, { type: PostType.Freeform });
    await verifyPostDeleted(post.id, loggedUser);
  });

  it('should delete the welcome post by a moderator or an admin', async () => {
    loggedUser = '2';
    await con.getRepository(SourceMember).save({
      userId: '1',
      sourceId: 'a',
      role: SourceMemberRoles.Moderator,
      referralToken: randomUUID(),
    });
    const source = await con.getRepository(Source).findOneByOrFail({ id: 'a' });
    const post = await createSquadWelcomePost(con, source, '2');
    await verifyPostDeleted(post.id, loggedUser);
    await con
      .getRepository(SourceMember)
      .update(
        { userId: '1', sourceId: 'a' },
        { role: SourceMemberRoles.Admin },
      );
    const welcome = await createSquadWelcomePost(con, source, '2');
    await con
      .getRepository(Post)
      .update({ id: welcome.id }, { type: PostType.Freeform });
    await verifyPostDeleted(welcome.id, loggedUser);
  });

  it('should delete the shared post from a member as a moderator', async () => {
    loggedUser = '2';
    const id = 'sp1';
    await createSharedPost(id, { role: SourceMemberRoles.Moderator }, '1');
    await verifyPostDeleted(id, loggedUser);
  });

  it('should allow moderator deleting a post from other moderators', async () => {
    loggedUser = '1';
    const id = 'sp1';
    await createSharedPost(id, { role: SourceMemberRoles.Moderator });
    await con
      .getRepository(SourceMember)
      .update({ userId: '1' }, { role: SourceMemberRoles.Moderator });

    await verifyPostDeleted(id, loggedUser);
  });

  it('should allow moderator deleting a post from the admin', async () => {
    loggedUser = '1';
    const id = 'sp1';
    await createSharedPost(id, { role: SourceMemberRoles.Admin });
    await con
      .getRepository(SourceMember)
      .update({ userId: '1' }, { role: SourceMemberRoles.Moderator });

    await verifyPostDeleted(id, loggedUser);
  });

  it('should delete the shared post as an admin of the squad', async () => {
    loggedUser = '2';
    const id = 'sp1';
    await createSharedPost(id, { role: SourceMemberRoles.Admin }, '1');
    await verifyPostDeleted(id, loggedUser);
  });
});

describe('mutation banPost', () => {
  const MUTATION = `
  mutation BanPost($id: ID!) {
  banPost(id: $id) {
    _
  }
}`;

  it('should not authorize when not logged in', () =>
    testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: { id: 'p1' },
      },
      'UNAUTHENTICATED',
    ));

  it('should not authorize when not moderator', () => {
    loggedUser = '1';
    roles = [];
    return testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: { id: 'p1' },
      },
      'FORBIDDEN',
    );
  });

  it('should ban the post', async () => {
    loggedUser = '1';
    roles = [Roles.Moderator];
    const res = await client.mutate(MUTATION, { variables: { id: 'p1' } });
    expect(res.errors).toBeFalsy();
    const post = await con.getRepository(Post).findOneByOrFail({ id: 'p1' });
    expect(post.banned).toEqual(true);
    expect(post.flags.banned).toEqual(true);
  });

  it('should do nothing if post is already banned', async () => {
    loggedUser = '1';
    roles = [Roles.Moderator];
    await con.getRepository(Post).update({ id: 'p1' }, { banned: true });
    const res = await client.mutate(MUTATION, { variables: { id: 'p1' } });
    expect(res.errors).toBeFalsy();
  });
});

describe('mutation clickbaitPost', () => {
  const MUTATION = /* GraphQL */ `
    mutation ClickbaitPost($id: ID!) {
      clickbaitPost(id: $id) {
        _
      }
    }
  `;

  it('should not authorize when not logged in', () =>
    testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: { id: 'p1' },
      },
      'UNAUTHENTICATED',
    ));

  it('should not authorize when not moderator', () => {
    loggedUser = '1';
    roles = [];
    return testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: { id: 'p1' },
      },
      'FORBIDDEN',
    );
  });

  it('should mark the post as clickbait when it does not have clickbait probability', async () => {
    loggedUser = '1';
    roles = [Roles.Moderator];

    const res = await client.mutate(MUTATION, { variables: { id: 'p1' } });
    expect(res.errors).toBeFalsy();

    const post = await con.getRepository(Post).findOneByOrFail({ id: 'p1' });
    expect(post.contentQuality.manual_clickbait_probability).toEqual(1);
  });

  it('should mark the post as clickbait when it is below threshold', async () => {
    await con
      .getRepository(ArticlePost)
      .update('p1', { contentQuality: { is_clickbait_probability: 0.9 } });

    loggedUser = '1';
    roles = [Roles.Moderator];

    const res = await client.mutate(MUTATION, { variables: { id: 'p1' } });
    expect(res.errors).toBeFalsy();

    const post = await con.getRepository(Post).findOneByOrFail({ id: 'p1' });
    expect(post.contentQuality.is_clickbait_probability).toEqual(0.9);
    expect(post.contentQuality.manual_clickbait_probability).toEqual(1);
  });

  it('should mark the post as not-clickbait when it is above threshold', async () => {
    await con
      .getRepository(ArticlePost)
      .update('p1', { contentQuality: { is_clickbait_probability: 1.1 } });

    loggedUser = '1';
    roles = [Roles.Moderator];

    const res = await client.mutate(MUTATION, { variables: { id: 'p1' } });
    expect(res.errors).toBeFalsy();

    const post = await con.getRepository(Post).findOneByOrFail({ id: 'p1' });
    expect(post.contentQuality.is_clickbait_probability).toEqual(1.1);
    expect(post.contentQuality.manual_clickbait_probability).toEqual(0);
  });

  it('should revert the clickbait status when it is already marked as clickbait', async () => {
    loggedUser = '1';
    roles = [Roles.Moderator];

    const res = await client.mutate(MUTATION, { variables: { id: 'p1' } });
    expect(res.errors).toBeFalsy();

    const post = await con.getRepository(Post).findOneByOrFail({ id: 'p1' });
    expect(post.contentQuality.manual_clickbait_probability).toEqual(1.0);

    const res2 = await client.mutate(MUTATION, { variables: { id: 'p1' } });
    expect(res2.errors).toBeFalsy();

    const post2 = await con.getRepository(Post).findOneByOrFail({ id: 'p1' });
    expect(post2.contentQuality.manual_clickbait_probability).toBeUndefined();
  });
});

describe('mutation reportPost', () => {
  const MUTATION = `
  mutation ReportPost($id: ID!, $reason: ReportReason, $comment: String, $tags: [String]) {
  reportPost(id: $id, reason: $reason, comment: $comment, tags: $tags) {
    _
  }
}`;

  it('should not authorize when not logged in', () =>
    testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: { id: 'p1', reason: 'BROKEN', comment: 'Test comment' },
      },
      'UNAUTHENTICATED',
    ));

  it('should throw not found when cannot find post', () => {
    loggedUser = '1';
    return testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: { id: 'invalid', reason: 'BROKEN', comment: 'Test comment' },
      },
      'NOT_FOUND',
    );
  });

  it('should throw error when user cannot access the post', async () => {
    loggedUser = '1';
    await con.getRepository(Source).update({ id: 'a' }, { private: true });
    return testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: { id: 'p1', reason: 'BROKEN', comment: 'Test comment' },
      },
      'FORBIDDEN',
    );
  });

  it('should report post with comment', async () => {
    loggedUser = '1';
    const res = await client.mutate(MUTATION, {
      variables: { id: 'p1', reason: 'BROKEN', comment: 'Test comment' },
    });
    expect(res.errors).toBeFalsy();
    const actualUserPost = await con.getRepository(UserPost).findOneBy({
      userId: loggedUser,
      postId: 'p1',
    });
    expect(actualUserPost).toMatchObject({
      userId: loggedUser,
      postId: 'p1',
      hidden: true,
    });
    expect(
      await con
        .getRepository(PostReport)
        .findOneBy({ userId: loggedUser, postId: 'p1' }),
    ).toEqual({
      postId: 'p1',
      userId: '1',
      createdAt: expect.anything(),
      reason: 'BROKEN',
      tags: null,
      comment: 'Test comment',
    });
  });

  it('should report post without comment', async () => {
    loggedUser = '1';
    const res = await client.mutate(MUTATION, {
      variables: { id: 'p1', reason: 'BROKEN' },
    });
    expect(res.errors).toBeFalsy();
    const actualUserPost = await con.getRepository(UserPost).findOneBy({
      userId: loggedUser,
      postId: 'p1',
    });
    expect(actualUserPost).toMatchObject({
      userId: loggedUser,
      postId: 'p1',
      hidden: true,
    });
    expect(
      await con
        .getRepository(PostReport)
        .findOneBy({ userId: loggedUser, postId: 'p1' }),
    ).toEqual({
      postId: 'p1',
      userId: '1',
      createdAt: expect.anything(),
      reason: 'BROKEN',
      tags: null,
      comment: null,
    });
  });

  it('should ignore conflicts', async () => {
    loggedUser = '1';
    await con.getRepository(UserPost).save({
      userId: loggedUser,
      postId: 'p1',
      hidden: true,
    });
    const res = await client.mutate(MUTATION, {
      variables: { id: 'p1', reason: 'BROKEN', comment: 'Test comment' },
    });
    expect(res.errors).toBeFalsy();
    const actualUserPost = await con.getRepository(UserPost).findOneBy({
      userId: loggedUser,
      postId: 'p1',
    });
    expect(actualUserPost).toMatchObject({
      userId: loggedUser,
      postId: 'p1',
      hidden: true,
    });
  });

  it('should save all the irrelevant tags', async () => {
    loggedUser = '1';
    const tags = ['js', 'react'];
    const res = await client.mutate(MUTATION, {
      variables: { id: 'p1', tags, reason: 'IRRELEVANT' },
    });
    expect(res.errors).toBeFalsy();
    const actualUserPost = await con.getRepository(UserPost).findOneBy({
      userId: loggedUser,
      postId: 'p1',
    });
    expect(actualUserPost).toMatchObject({
      userId: loggedUser,
      postId: 'p1',
      hidden: true,
    });
    expect(
      await con
        .getRepository(PostReport)
        .findOneBy({ userId: loggedUser, postId: 'p1' }),
    ).toEqual({
      postId: 'p1',
      userId: '1',
      createdAt: expect.anything(),
      reason: 'IRRELEVANT',
      tags,
      comment: null,
    });
  });

  it('should throw an error if there is no irrelevant tags when the reason is IRRELEVANT', async () => {
    loggedUser = '1';

    await testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: { id: 'p1', tags: [], reason: 'IRRELEVANT' },
      },
      'GRAPHQL_VALIDATION_FAILED',
    );

    return testMutationErrorCode(
      client,
      { mutation: MUTATION, variables: { id: 'p1', reason: 'IRRELEVANT' } },
      'GRAPHQL_VALIDATION_FAILED',
    );
  });

  it('should save report if post is hidden already', async () => {
    loggedUser = '1';
    await con.getRepository(UserPost).save({
      userId: loggedUser,
      postId: 'p1',
      hidden: true,
    });
    const res = await client.mutate(MUTATION, {
      variables: { id: 'p1', reason: 'BROKEN', comment: 'Test comment' },
    });
    expect(res.errors).toBeFalsy();
    const actual = await con.getRepository(PostReport).findOne({
      where: { userId: loggedUser },
      select: ['postId', 'userId'],
    });
    expect(actual).toEqual({
      postId: 'p1',
      userId: '1',
    });
  });
});

describe('mutation sharePost', () => {
  const MUTATION = `
  mutation SharePost($sourceId: ID!, $id: ID!, $commentary: String) {
    sharePost(sourceId: $sourceId, id: $id, commentary: $commentary) {
      id
      titleHtml
    }
  }`;

  const variables = {
    sourceId: 's1',
    id: 'p1',
    commentary: 'My comment',
  };

  beforeEach(async () => {
    await con.getRepository(SquadSource).save({
      id: 's1',
      handle: 's1',
      name: 'Squad',
      private: false,
      memberPostingRank: 0,
    });
    await con.getRepository(SourceMember).save({
      sourceId: 's1',
      userId: '1',
      referralToken: 'rt',
      role: SourceMemberRoles.Member,
    });
  });

  it('should not authorize when moderation is required', async () => {
    loggedUser = '4';
    await testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: { ...variables, sourceId: 'm' },
      },
      'FORBIDDEN',
    );
  });

  it('should bypass moderation because user is a moderator', async () => {
    loggedUser = '3';
    const res = await client.mutate(MUTATION, {
      variables: { ...variables, sourceId: 'm' },
    });
    expect(res.errors).toBeFalsy();
    const newId = res.data.sharePost.id;
    const post = await con.getRepository(SharePost).findOneBy({ id: newId });
    expect(post?.authorId).toEqual('3');
    expect(post?.sharedPostId).toEqual('p1');
    expect(post?.title).toEqual('My comment');
  });

  it('should not authorize when not logged in', () =>
    testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables,
      },
      'UNAUTHENTICATED',
    ));

  it('should share to squad', async () => {
    loggedUser = '1';
    const res = await client.mutate(MUTATION, { variables });
    expect(res.errors).toBeFalsy();
    const newId = res.data.sharePost.id;
    const post = await con
      .getRepository(SharePost)
      .findOneByOrFail({ id: newId });
    expect(post.authorId).toEqual('1');
    expect(post.sharedPostId).toEqual('p1');
    expect(post.title).toEqual('My comment');
  });

  it('should share sharedPost to squad if title was provided', async () => {
    await con.getRepository(SharePost).save({
      id: 'sp-1',
      shortId: 'sp-1',
      sourceId: 's1',
      title: 'Some special title',
      type: PostType.Share,
      sharedPostId: 'p1',
    });
    loggedUser = '1';
    const res = await client.mutate(MUTATION, {
      variables: {
        sourceId: 's1',
        id: 'sp-1',
        commentary: 'My comment',
      },
    });
    expect(res.errors).toBeFalsy();
    const newId = res.data.sharePost.id;
    const post = await con
      .getRepository(SharePost)
      .findOneByOrFail({ id: newId });
    expect(post.authorId).toEqual('1');
    expect(post.sharedPostId).toEqual('sp-1');
    expect(post.title).toEqual('My comment');
  });

  it('should share sharedPost to squad but link to original article if no title was provided', async () => {
    await con.getRepository(SharePost).save({
      id: 'sp-2',
      shortId: 'sp-2',
      sourceId: 's1',
      title: null,
      type: PostType.Share,
      sharedPostId: 'p1',
    });
    loggedUser = '1';
    const res = await client.mutate(MUTATION, {
      variables: {
        sourceId: 's1',
        id: 'sp-2',
        commentary: 'My comment',
      },
    });
    expect(res.errors).toBeFalsy();
    const newId = res.data.sharePost.id;
    const post = await con
      .getRepository(SharePost)
      .findOneByOrFail({ id: newId });
    expect(post.authorId).toEqual('1');
    expect(post.sharedPostId).toEqual('p1');
    expect(post.title).toEqual('My comment');
  });

  it('should share to squad and increment squad flags total posts', async () => {
    loggedUser = '1';
    const res = await client.mutate(MUTATION, { variables });
    expect(res.errors).toBeFalsy();
    const newId = res.data.sharePost.id;
    const post = await con
      .getRepository(SharePost)
      .findOneByOrFail({ id: newId });
    const source = await post.source;
    expect(source.flags.totalPosts).toEqual(1);
  });

  it('should share to squad and trim the commentary', async () => {
    loggedUser = '1';
    const res = await client.mutate(MUTATION, {
      variables: { ...variables, commentary: '  My comment  ' },
    });
    expect(res.errors).toBeFalsy();
    const newId = res.data.sharePost.id;
    const post = await con
      .getRepository(SharePost)
      .findOneByOrFail({ id: newId });
    expect(post.authorId).toEqual('1');
    expect(post.sharedPostId).toEqual('p1');
    expect(post.title).toEqual('My comment');
  });

  it('should share to squad without commentary', async () => {
    loggedUser = '1';
    const res = await client.mutate(MUTATION, {
      variables: { ...variables, commentary: null },
    });
    expect(res.errors).toBeFalsy();
    const newId = res.data.sharePost.id;
    const post = await con
      .getRepository(SharePost)
      .findOneByOrFail({ id: newId });
    expect(post.authorId).toEqual('1');
    expect(post.sharedPostId).toEqual('p1');
    expect(post.title).toBeNull();
  });

  it('should share to squad with mentioned users', async () => {
    loggedUser = '1';
    await con.getRepository(User).update({ id: '2' }, { username: 'lee' });
    const params = { ...variables };
    params.commentary = 'Test @lee @non-existent';
    const res = await client.mutate(MUTATION, { variables: params });
    expect(res.errors).toBeFalsy();
    const post = await con
      .getRepository(SharePost)
      .findOneByOrFail({ id: res.data.sharePost.id });
    expect(post.authorId).toEqual('1');
    expect(post.sharedPostId).toEqual('p1');
    expect(post.titleHtml).toMatchSnapshot();
    const mentions = await con
      .getRepository(PostMention)
      .findOneByOrFail({ mentionedUserId: '2', mentionedByUserId: '1' });
    expect(mentions).toBeTruthy();
  });

  it('should escape html content on the title', async () => {
    loggedUser = '1';
    await con.getRepository(User).update({ id: '2' }, { username: 'lee' });
    const params = { ...variables };
    params.commentary = `<style>html { color: red !important; }</style>`;
    const res = await client.mutate(MUTATION, { variables: params });
    expect(res.errors).toBeFalsy();
    const post = await con
      .getRepository(SharePost)
      .findOneByOrFail({ id: res.data.sharePost.id });
    expect(post.authorId).toEqual('1');
    expect(post.sharedPostId).toEqual('p1');
    expect(post.titleHtml).toMatch(
      markdown.utils.escapeHtml(
        `<style>html { color: red !important; }</style>`,
      ),
    );
  });

  it('should throw error when sharing to non-squad', async () => {
    loggedUser = '1';
    return testMutationErrorCode(
      client,
      { mutation: MUTATION, variables: { ...variables, sourceId: 'a' } },
      'FORBIDDEN',
    );
  });

  it('should throw error when non-member share to squad', async () => {
    loggedUser = '2';
    return testMutationErrorCode(
      client,
      { mutation: MUTATION, variables: { ...variables, sourceId: 'a' } },
      'FORBIDDEN',
    );
  });

  it('should throw error when post does not exist', async () => {
    loggedUser = '1';
    return testMutationErrorCode(
      client,
      { mutation: MUTATION, variables: { ...variables, id: 'nope' } },
      'NOT_FOUND',
    );
  });

  it('should throw error for members if posting to squad is not allowed', async () => {
    loggedUser = '1';
    await con.getRepository(SquadSource).update('s1', {
      memberPostingRank: sourceRoleRank[SourceMemberRoles.Moderator],
    });

    await testMutationError(
      client,
      { mutation: MUTATION, variables: { ...variables, sourceId: 's1' } },
      (errors) => {
        expect(errors.length).toEqual(1);
        expect(errors[0].extensions?.code).toEqual('FORBIDDEN');
        expect(errors[0]?.message).toEqual('Posting not allowed!');
      },
    );
  });

  it('should allow moderators to post when posting to squad is not allowed', async () => {
    loggedUser = '1';
    await con.getRepository(SquadSource).update('s1', {
      memberPostingRank: sourceRoleRank[SourceMemberRoles.Moderator],
    });
    await con.getRepository(SourceMember).update(
      { sourceId: 's1', userId: '1' },
      {
        role: SourceMemberRoles.Moderator,
      },
    );

    const res = await client.mutate(MUTATION, { variables });
    expect(res.errors).toBeFalsy();
    const newId = res.data.sharePost.id;
    const post = await con
      .getRepository(SharePost)
      .findOneByOrFail({ id: newId });
    expect(post.authorId).toEqual('1');
    expect(post.sharedPostId).toEqual('p1');
    expect(post.title).toEqual('My comment');
  });

  it('should allow admins to post when posting to squad is not allowed', async () => {
    loggedUser = '1';
    await con.getRepository(SquadSource).update('s1', {
      memberPostingRank: sourceRoleRank[SourceMemberRoles.Moderator],
    });
    await con.getRepository(SourceMember).update(
      { sourceId: 's1', userId: '1' },
      {
        role: SourceMemberRoles.Admin,
      },
    );

    const res = await client.mutate(MUTATION, { variables });
    expect(res.errors).toBeFalsy();
    const newId = res.data.sharePost.id;
    const post = await con
      .getRepository(SharePost)
      .findOneByOrFail({ id: newId });
    expect(post.authorId).toEqual('1');
    expect(post.sharedPostId).toEqual('p1');
    expect(post.title).toEqual('My comment');
  });

  describe('rate limiting', () => {
    const redisKey = `${rateLimiterName}:1:createPost`;
    it('store rate limiting state in redis', async () => {
      loggedUser = '1';

      const res = await client.mutate(MUTATION, {
        variables: variables,
      });

      expect(res.errors).toBeFalsy();
      expect(await getRedisObject(redisKey)).toEqual('1');
    });

    it('should rate limit creating posts to 1 per minute', async () => {
      loggedUser = '1';

      for (let i = 0; i < 1; i++) {
        const res = await client.mutate(MUTATION, {
          variables: variables,
        });

        expect(res.errors).toBeFalsy();
      }
      expect(await getRedisObject(redisKey)).toEqual('1');

      await testMutationErrorCode(
        client,
        { mutation: MUTATION, variables: variables },
        'RATE_LIMITED',
        'Take a break. You already posted enough in the last 30 seconds',
      );

      // Check expiry, to not cause it to be flaky, we check if it is within 10 seconds
      expect(await getRedisObjectExpiry(redisKey)).toBeLessThanOrEqual(30);
      expect(await getRedisObjectExpiry(redisKey)).toBeGreaterThanOrEqual(20);
    });

    describe('high rate squads', () => {
      beforeEach(async () => {
        await con.getRepository(SquadSource).save({
          id: WATERCOOLER_ID,
          handle: 'watercooler',
          name: 'Watercooler',
          private: false,
        });
        await con.getRepository(SourceMember).save({
          sourceId: WATERCOOLER_ID,
          userId: '1',
          referralToken: 'watercoolerRt',
          role: SourceMemberRoles.Member,
        });
      });

      it('should rate limit creating posts in Watercooler squad to 1 per 10 minutes', async () => {
        loggedUser = '1';

        const res = await client.mutate(MUTATION, {
          variables: { ...variables, sourceId: WATERCOOLER_ID },
        });

        expect(res.errors).toBeFalsy();
        expect(await getRedisObject(redisKey)).toEqual('1');

        await testMutationErrorCode(
          client,
          {
            mutation: MUTATION,
            variables: { ...variables, sourceId: WATERCOOLER_ID },
          },
          'RATE_LIMITED',
          'Take a break. You already posted enough in the last 30 seconds',
        );
      });
    });
  });
});

describe('mutation editSharePost', () => {
  const MUTATION = `
  mutation editSharePost($id: ID!, $commentary: String) {
    editSharePost(id: $id, commentary: $commentary) {
      id
    }
  }`;

  const variables = {
    sourceId: 'a',
    id: 'sharePost',
    commentary: 'My comment',
  };

  beforeEach(async () => {
    await saveSquadFixtures();

    await con.getRepository(SharePost).save({
      id: 'sharePost',
      shortId: 'sharePost',
      sourceId: 'a',
      type: PostType.Share,
      title: 'Foo Bar',
      authorId: '1',
    });
  });

  it('should not authorize when not logged in', () =>
    testMutationErrorCode(
      client,
      { mutation: MUTATION, variables },
      'UNAUTHENTICATED',
    ));

  it('should throw error when post does not exist', async () => {
    loggedUser = '1';
    return testMutationErrorCode(
      client,
      { mutation: MUTATION, variables: { ...variables, id: 'nope' } },
      'NOT_FOUND',
    );
  });

  it('should restrict member when user is not the author of the post', async () => {
    loggedUser = '2';

    return testMutationErrorCode(
      client,
      { mutation: MUTATION, variables },
      'FORBIDDEN',
    );
  });

  it('should update the post with a trimmed commentary', async () => {
    loggedUser = '1';
    const res = await client.mutate(MUTATION, {
      variables: { ...variables, commentary: '  My comment  ' },
    });
    expect(res.errors).toBeFalsy();
    const post = await con
      .getRepository(SharePost)
      .findOneByOrFail({ id: variables.id });
    expect(post.title).toEqual('My comment');
  });

  it('should update without commentary', async () => {
    loggedUser = '1';
    const res = await client.mutate(MUTATION, {
      variables: { ...variables, commentary: null },
    });
    expect(res.errors).toBeFalsy();
    const post = await con
      .getRepository(SharePost)
      .findOneByOrFail({ id: variables.id });
    expect(post.title).toBeNull();
  });

  it('should update with mentioned users', async () => {
    loggedUser = '1';
    await con.getRepository(User).update({ id: '2' }, { username: 'lee' });
    const params = { ...variables };
    params.commentary = 'Test @lee @non-existent';
    const res = await client.mutate(MUTATION, { variables: params });
    expect(res.errors).toBeFalsy();
    const post = await con
      .getRepository(SharePost)
      .findOneByOrFail({ id: variables.id });
    expect(post.authorId).toEqual('1');
    expect(post.titleHtml).toMatchSnapshot();
    const mentions = await con
      .getRepository(PostMention)
      .findOneBy({ mentionedUserId: '2', mentionedByUserId: '1' });
    expect(mentions).toBeTruthy();
  });

  it('should escape html content on the title', async () => {
    loggedUser = '1';
    await con.getRepository(User).update({ id: '2' }, { username: 'lee' });
    const params = { ...variables };
    params.commentary = `<style>html { color: red !important; }</style>`;
    const res = await client.mutate(MUTATION, { variables: params });
    expect(res.errors).toBeFalsy();
    const post = await con
      .getRepository(SharePost)
      .findOneByOrFail({ id: variables.id });
    expect(post.titleHtml).toMatch(
      markdown.utils.escapeHtml(
        `<style>html { color: red !important; }</style>`,
      ),
    );
  });
});

describe('mutation viewPost', () => {
  const MUTATION = `
  mutation ViewPost($id: ID!) {
  viewPost(id: $id) {
    _
  }
}`;

  const variables = {
    id: 'p1',
  };

  beforeEach(async () => {
    await con.getRepository(SquadSource).save({
      id: 's1',
      handle: 's1',
      name: 'Squad',
      private: true,
    });
    await con.getRepository(SourceMember).save({
      sourceId: 's1',
      userId: '1',
      referralToken: 'rt',
      role: SourceMemberRoles.Member,
    });
    await con.getRepository(Post).update({ id: 'p1' }, { sourceId: 's1' });
  });

  it('should not authorize when not logged in', () =>
    testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables,
      },
      'UNAUTHENTICATED',
    ));

  it('should throw not found when post does not exist', () => {
    loggedUser = '1';
    return testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: { id: 'nope' },
      },
      'NOT_FOUND',
    );
  });

  it('should throw error when user cannot access the post', async () => {
    loggedUser = '2';
    await con
      .getRepository(Post)
      .update({ id: 'p1' }, { type: PostType.Share });
    return testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables,
      },
      'FORBIDDEN',
    );
  });

  it('should submit view event', async () => {
    loggedUser = '1';
    await con
      .getRepository(Post)
      .update({ id: 'p1' }, { type: PostType.Share });
    const res = await client.mutate(MUTATION, { variables });
    expect(res.errors).toBeFalsy();
    expect(notifyView).toBeCalledTimes(1);
  });

  it('should should not submit view event for articles', async () => {
    loggedUser = '1';
    const res = await client.mutate(MUTATION, { variables });
    expect(res.errors).toBeFalsy();
    expect(notifyView).toBeCalledTimes(0);
  });
});

describe('mutation submitExternalLink', () => {
  const MUTATION = /* GraphQL */ `
    mutation SubmitExternalLink(
      $sourceId: ID!
      $url: String!
      $commentary: String
      $title: String
      $image: String
    ) {
      submitExternalLink(
        sourceId: $sourceId
        url: $url
        commentary: $commentary
        title: $title
        image: $image
      ) {
        _
      }
    }
  `;

  const variables: Record<string, string> = {
    sourceId: 's1',
    url: 'https://daily.dev',
    commentary: 'My comment',
  };

  beforeEach(async () => {
    await con.getRepository(SquadSource).save({
      id: 's1',
      handle: 's1',
      name: 'Squad',
      private: false,
      memberPostingRank: 0,
    });
    await con.getRepository(SourceMember).save({
      sourceId: 's1',
      userId: '1',
      referralToken: 'rt',
      role: SourceMemberRoles.Member,
    });
  });

  it('should not authorize when moderation is required', async () => {
    loggedUser = '4';
    await testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: { ...variables, sourceId: 'm' },
      },
      'FORBIDDEN',
    );
  });

  it('should not authorize when moderation is required', async () => {
    loggedUser = '4';
    await testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: { ...variables, sourceId: 'm' },
      },
      'FORBIDDEN',
    );
  });

  it('should bypass moderation because user is a moderator', async () => {
    loggedUser = '3';
    const res = await client.mutate(MUTATION, {
      variables: { ...variables, sourceId: 'm' },
    });
    expect(res.errors).toBeFalsy();
    const articlePost = await con
      .getRepository(ArticlePost)
      .findOneBy({ url: variables.url });
    expect(articlePost?.url).toEqual('https://daily.dev');
  });

  it('should not authorize when not logged in', () =>
    testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables,
      },
      'UNAUTHENTICATED',
    ));

  const checkSharedPostExpectation = async (visible: boolean) => {
    const res = await client.mutate(MUTATION, { variables });
    expect(res.errors).toBeFalsy();
    const articlePost = await con
      .getRepository(ArticlePost)
      .findOneByOrFail({ url: variables.url });
    expect(articlePost.url).toEqual('https://daily.dev');
    expect(articlePost.visible).toEqual(visible);

    expect(notifyContentRequested).toBeCalledTimes(1);
    expect(jest.mocked(notifyContentRequested).mock.calls[0].slice(1)).toEqual([
      { id: articlePost.id, url: variables.url, origin: articlePost.origin },
    ]);

    const sharedPost = await con
      .getRepository(SharePost)
      .findOneByOrFail({ sharedPostId: articlePost.id });
    expect(sharedPost.authorId).toEqual('1');
    expect(sharedPost.title).toEqual('My comment');
    expect(sharedPost.visible).toEqual(visible);
  };

  it('should share to squad without title to support backwards compatibility', async () => {
    loggedUser = '1';
    await checkSharedPostExpectation(false);
  });

  it('should share to squad and be visible automatically when title is available', async () => {
    loggedUser = '1';
    variables.title = 'Sample external link title';
    await checkSharedPostExpectation(true);
  });

  it('should share existing post to squad', async () => {
    loggedUser = '1';
    const res = await client.mutate(MUTATION, {
      variables: { ...variables, url: 'http://p6.com' },
    });
    expect(res.errors).toBeFalsy();
    const articlePost = await con
      .getRepository(ArticlePost)
      .findOneByOrFail({ url: 'http://p6.com' });
    expect(articlePost.url).toEqual('http://p6.com');
    expect(articlePost.visible).toEqual(true);
    expect(articlePost.id).toEqual('p6');

    expect(notifyContentRequested).toBeCalledTimes(0);

    const sharedPost = await con
      .getRepository(SharePost)
      .findOneByOrFail({ sharedPostId: articlePost.id });
    expect(sharedPost.authorId).toEqual('1');
    expect(sharedPost.title).toEqual('My comment');
    expect(sharedPost.visible).toEqual(true);
  });

  it('should share existing post to squad when URL has allowed search params', async () => {
    loggedUser = '1';
    const res = await client.mutate(MUTATION, {
      variables: { ...variables, url: 'http://p8.com?sk=wololo&foo=bar' },
    });
    expect(res.errors).toBeFalsy();
    const articlePost = await con
      .getRepository(ArticlePost)
      .findOneByOrFail({ url: 'http://p8.com?sk=wololo' });
    expect(articlePost.url).toEqual('http://p8.com?sk=wololo');
    expect(articlePost.canonicalUrl).toEqual('http://p8.com');
    expect(articlePost.visible).toEqual(true);
    expect(articlePost.id).toEqual('p8');

    expect(notifyContentRequested).toHaveBeenCalledTimes(0);

    const sharedPost = await con
      .getRepository(SharePost)
      .findOneByOrFail({ sharedPostId: articlePost.id });
    expect(sharedPost.authorId).toEqual('1');
    expect(sharedPost.title).toEqual('My comment');
    expect(sharedPost.visible).toEqual(true);
  });

  it('should share new post to squad when URL has allowed search params', async () => {
    loggedUser = '1';
    expect(
      await con
        .getRepository(ArticlePost)
        .findOneBy({ url: 'http://brand.new.com?sk=wololo' }),
    ).toBeFalsy();

    const res = await client.mutate(MUTATION, {
      variables: {
        ...variables,
        url: 'http://brand.new.com?sk=wololo&foo=bar',
      },
    });
    expect(res.errors).toBeFalsy();
    const articlePost = await con
      .getRepository(ArticlePost)
      .findOneByOrFail({ url: 'http://brand.new.com?sk=wololo' });
    expect(articlePost.url).toEqual('http://brand.new.com?sk=wololo');
    expect(articlePost.canonicalUrl).toEqual('http://brand.new.com');
    expect(articlePost.visible).toEqual(true);

    expect(notifyContentRequested).toHaveBeenCalledTimes(1);

    const sharedPost = await con
      .getRepository(SharePost)
      .findOneByOrFail({ sharedPostId: articlePost.id });
    expect(sharedPost.authorId).toEqual('1');
    expect(sharedPost.title).toEqual('My comment');
    expect(sharedPost.visible).toEqual(true);
  });

  it('should share existing youtube post to squad', async () => {
    loggedUser = '1';
    const res = await client.mutate(MUTATION, {
      variables: { ...variables, url: 'https://youtu.be/T_AbQGe7fuU' },
    });
    expect(res.errors).toBeFalsy();
    const youtubePost = await con
      .getRepository(YouTubePost)
      .findOneByOrFail({ url: 'https://youtu.be/T_AbQGe7fuU' });
    expect(youtubePost.url).toEqual('https://youtu.be/T_AbQGe7fuU');
    expect(youtubePost.visible).toEqual(true);
    expect(youtubePost.id).toEqual('yt1');

    expect(notifyContentRequested).toHaveBeenCalledTimes(0);

    const sharedPost = await con
      .getRepository(SharePost)
      .findOneByOrFail({ sharedPostId: youtubePost.id });
    expect(sharedPost.authorId).toEqual('1');
    expect(sharedPost.title).toEqual('My comment');
    expect(sharedPost.visible).toEqual(true);
  });

  it('should share existing post to squad without commentary', async () => {
    loggedUser = '1';
    const res = await client.mutate(MUTATION, {
      variables: { ...variables, url: 'http://p6.com', commentary: null },
    });
    expect(res.errors).toBeFalsy();
    const articlePost = await con
      .getRepository(ArticlePost)
      .findOneByOrFail({ url: 'http://p6.com' });
    expect(articlePost.url).toEqual('http://p6.com');
    expect(articlePost.visible).toEqual(true);
    expect(articlePost.id).toEqual('p6');

    expect(notifyContentRequested).toBeCalledTimes(0);

    const sharedPost = await con
      .getRepository(SharePost)
      .findOneByOrFail({ sharedPostId: articlePost.id });
    expect(sharedPost.authorId).toEqual('1');
    expect(sharedPost.title).toBeNull();
    expect(sharedPost.visible).toEqual(true);
  });

  it('should throw error when sharing to non-squad', async () => {
    loggedUser = '1';
    return testMutationErrorCode(
      client,
      { mutation: MUTATION, variables: { ...variables, sourceId: 'a' } },
      'FORBIDDEN',
    );
  });

  it('should throw error when URL is not valid', async () => {
    loggedUser = '1';
    return testMutationErrorCode(
      client,
      { mutation: MUTATION, variables: { ...variables, url: 'a' } },
      'GRAPHQL_VALIDATION_FAILED',
    );
  });

  it('should throw error when post is existing but deleted', async () => {
    loggedUser = '1';
    await con.getRepository(Post).update('p6', { deleted: true });
    return testMutationErrorCode(
      client,
      { mutation: MUTATION, variables: { ...variables, url: 'http://p6.com' } },
      'GRAPHQL_VALIDATION_FAILED',
    );
  });

  it('should throw error when non-member share to squad', async () => {
    loggedUser = '2';
    return testMutationErrorCode(
      client,
      { mutation: MUTATION, variables: { ...variables, sourceId: 'a' } },
      'FORBIDDEN',
    );
  });

  it('should throw error for members if posting to squad is not allowed', async () => {
    loggedUser = '1';
    await con.getRepository(SquadSource).update('s1', {
      memberPostingRank: sourceRoleRank[SourceMemberRoles.Moderator],
    });

    await testMutationError(
      client,
      { mutation: MUTATION, variables: { ...variables, sourceId: 's1' } },
      (errors) => {
        expect(errors.length).toEqual(1);
        expect(errors[0].extensions?.code).toEqual('FORBIDDEN');
        expect(errors[0]?.message).toEqual('Posting not allowed!');
      },
    );
  });

  it('should allow moderators to share when posting to squad is not allowed', async () => {
    loggedUser = '1';
    await con.getRepository(SquadSource).update('s1', {
      memberPostingRank: sourceRoleRank[SourceMemberRoles.Moderator],
    });
    await con.getRepository(SourceMember).update(
      { sourceId: 's1', userId: '1' },
      {
        role: SourceMemberRoles.Moderator,
      },
    );

    const res = await client.mutate(MUTATION, {
      variables: { ...variables, url: 'http://p6.com' },
    });
    expect(res.errors).toBeFalsy();
    const articlePost = await con
      .getRepository(ArticlePost)
      .findOneByOrFail({ url: 'http://p6.com' });
    expect(articlePost.url).toEqual('http://p6.com');
    expect(articlePost.visible).toEqual(true);
    expect(articlePost.id).toEqual('p6');

    expect(notifyContentRequested).toBeCalledTimes(0);

    const sharedPost = await con
      .getRepository(SharePost)
      .findOneByOrFail({ sharedPostId: articlePost.id });
    expect(sharedPost.authorId).toEqual('1');
    expect(sharedPost.title).toEqual('My comment');
    expect(sharedPost.visible).toEqual(true);
  });

  it('should allow admins to share when posting to squad is not allowed', async () => {
    loggedUser = '1';
    await con.getRepository(SquadSource).update('s1', {
      memberPostingRank: sourceRoleRank[SourceMemberRoles.Moderator],
    });
    await con.getRepository(SourceMember).update(
      { sourceId: 's1', userId: '1' },
      {
        role: SourceMemberRoles.Admin,
      },
    );

    const res = await client.mutate(MUTATION, {
      variables: { ...variables, url: 'http://p6.com' },
    });
    expect(res.errors).toBeFalsy();
    const articlePost = await con
      .getRepository(ArticlePost)
      .findOneByOrFail({ url: 'http://p6.com' });
    expect(articlePost.url).toEqual('http://p6.com');
    expect(articlePost.visible).toEqual(true);
    expect(articlePost.id).toEqual('p6');

    expect(notifyContentRequested).toBeCalledTimes(0);

    const sharedPost = await con
      .getRepository(SharePost)
      .findOneByOrFail({ sharedPostId: articlePost.id });
    expect(sharedPost.authorId).toEqual('1');
    expect(sharedPost.title).toEqual('My comment');
    expect(sharedPost.visible).toEqual(true);
  });

  it('should not make squad post visible if shared post is not yet ready and visible', async () => {
    loggedUser = '1';
    const res = await client.mutate(MUTATION, {
      variables: {
        ...variables,
        url: 'http://p7.com',
        commentary: 'Share 1',
      },
    });
    expect(res.errors).toBeFalsy();
    const articlePost = await con
      .getRepository(ArticlePost)
      .findOneBy({ url: 'http://p7.com' });
    expect(articlePost?.url).toEqual('http://p7.com');
    expect(articlePost?.visible).toEqual(false);
    const sharedPost = await con
      .getRepository(SharePost)
      .findOneBy({ sharedPostId: articlePost?.id, title: 'Share 1' });
    expect(sharedPost?.visible).toEqual(false);

    await deleteKeysByPattern(`${rateLimiterName}:*`);

    const res2 = await client.mutate(MUTATION, {
      variables: {
        ...variables,
        url: 'http://p7.com',
        commentary: 'Share 2',
      },
    });
    expect(res2.errors).toBeFalsy();
    const sharedPost2 = await con
      .getRepository(SharePost)
      .findOneBy({ sharedPostId: articlePost?.id, title: 'Share 2' });
    expect(sharedPost2?.visible).toEqual(false);
  });

  describe('rate limiting', () => {
    const redisKey = `${rateLimiterName}:1:createPost`;
    it('store rate limiting state in redis', async () => {
      loggedUser = '1';

      const res = await client.mutate(MUTATION, {
        variables: { ...variables, url: 'http://p6.com' },
      });

      expect(res.errors).toBeFalsy();
      expect(await getRedisObject(redisKey)).toEqual('1');
    });

    it('should rate limit creating posts to 1 per minute', async () => {
      loggedUser = '1';

      for (let i = 0; i < 1; i++) {
        const res = await client.mutate(MUTATION, {
          variables: { ...variables, url: 'http://p6.com' },
        });

        expect(res.errors).toBeFalsy();
      }
      expect(await getRedisObject(redisKey)).toEqual('1');

      await testMutationErrorCode(
        client,
        { mutation: MUTATION, variables: variables },
        'RATE_LIMITED',
        'Take a break. You already posted enough in the last 30 seconds',
      );

      // Check expiry, to not cause it to be flaky, we check if it is within 10 seconds
      expect(await getRedisObjectExpiry(redisKey)).toBeLessThanOrEqual(30);
      expect(await getRedisObjectExpiry(redisKey)).toBeGreaterThanOrEqual(20);
    });

    describe('high rate squads', () => {
      beforeEach(async () => {
        await con.getRepository(SquadSource).save({
          id: WATERCOOLER_ID,
          handle: 'watercooler',
          name: 'Watercooler',
          private: false,
        });
        await con.getRepository(SourceMember).save({
          sourceId: WATERCOOLER_ID,
          userId: '1',
          referralToken: 'watercoolerRt',
          role: SourceMemberRoles.Member,
        });
      });

      it('should rate limit creating posts in Watercooler squad to 1 per 10 minutes', async () => {
        loggedUser = '1';

        const res = await client.mutate(MUTATION, {
          variables: {
            ...variables,
            url: 'http://p6.com',
            sourceId: WATERCOOLER_ID,
          },
        });

        expect(res.errors).toBeFalsy();
        expect(await getRedisObject(redisKey)).toEqual('1');

        await testMutationErrorCode(
          client,
          {
            mutation: MUTATION,
            variables: {
              ...variables,
              url: 'http://p6.com',
              sourceId: WATERCOOLER_ID,
            },
          },
          'RATE_LIMITED',
          'Take a break. You already posted enough in the last 30 seconds',
        );
      });
    });
  });

  describe('vordr', () => {
    describe('new post', () => {
      it('should set the correct vordr flags on new post by a good user', async () => {
        loggedUser = '1';

        const res = await client.mutate(MUTATION, {
          variables: { ...variables, url: 'http://vordr.com' },
        });

        expect(res.errors).toBeFalsy();
        const post = await con
          .getRepository(SharePost)
          .findOneByOrFail({ sourceId: 's1', authorId: loggedUser });

        expect(post.flags.vordr).toEqual(false);
      });

      it('should set the correct vordr flags on new post by a bad user', async () => {
        loggedUser = 'vordr';

        await con.getRepository(SourceMember).save({
          userId: loggedUser,
          sourceId: 's1',
          role: SourceMemberRoles.Member,
          referralToken: randomUUID(),
        });

        const res = await client.mutate(MUTATION, {
          variables: { ...variables, url: 'http://vordr.com' },
        });

        expect(res.errors).toBeFalsy();
        const post = await con
          .getRepository(SharePost)
          .findOneByOrFail({ sourceId: 's1', authorId: loggedUser });

        expect(post.flags.vordr).toEqual(true);
      });
    });

    describe('existing post', () => {
      it('should set the correct vordr flags on existing post by good user', async () => {
        loggedUser = '1';

        const res = await client.mutate(MUTATION, {
          variables: { ...variables, url: 'http://p6.com' },
        });

        expect(res.errors).toBeFalsy();
        const post = await con
          .getRepository(SharePost)
          .findOneByOrFail({ sourceId: 's1', authorId: loggedUser });

        expect(post.flags.vordr).toEqual(false);
      });

      it('should set the correct vordr flags on existing post by bad user', async () => {
        loggedUser = 'vordr';

        await con.getRepository(SourceMember).save({
          userId: loggedUser,
          sourceId: 's1',
          role: SourceMemberRoles.Member,
          referralToken: randomUUID(),
        });

        const res = await client.mutate(MUTATION, {
          variables: { ...variables, url: 'http://p6.com' },
        });

        expect(res.errors).toBeFalsy();
        const post = await con
          .getRepository(SharePost)
          .findOneByOrFail({ sourceId: 's1', authorId: loggedUser });

        expect(post.flags.vordr).toEqual(true);
      });
    });
  });

  describe('user source', () => {
    beforeEach(async () => {
      await con.getRepository(Feed).save({
        id: '1',
        userId: '1',
      });
    });

    it('should create user source if it does not already exist when sharing', async () => {
      loggedUser = '1';

      expect(
        await con
          .getRepository(SourceUser)
          .findOneBy({ id: loggedUser, userId: loggedUser }),
      ).toBeFalsy();

      const res = await client.mutate(MUTATION, {
        variables: { ...variables, sourceId: loggedUser, url: 'http://p6.com' },
      });

      expect(res.errors).toBeFalsy();

      const source = await con
        .getRepository(SourceUser)
        .findOneByOrFail({ id: loggedUser, userId: loggedUser });

      expect(source).toBeTruthy();
    });

    it('should allow user to share to their own source', async () => {
      loggedUser = '1';

      const res = await client.mutate(MUTATION, {
        variables: { ...variables, sourceId: loggedUser, url: 'http://p6.com' },
      });

      expect(res.errors).toBeFalsy();

      const post = await con
        .getRepository(SharePost)
        .findOneByOrFail({ sourceId: loggedUser, authorId: loggedUser });

      expect(post).toBeTruthy();
      expect(post.sharedPostId).toEqual('p6');
      expect(post.title).toEqual('My comment');
      expect(post.sourceId).toEqual(loggedUser);
    });

    it('should not allow other users to share to another user source', async () => {
      loggedUser = '2';

      await con.getRepository(SourceUser).save({
        id: '1',
        userId: '1',
        name: 'User 1',
        handle: 'user1',
        private: false,
      });

      await testMutationErrorCode(
        client,
        {
          mutation: MUTATION,
          variables: { ...variables, sourceId: '1' },
        },
        'FORBIDDEN',
      );
    });
  });
});

describe('mutation checkLinkPreview', () => {
  const MUTATION = /* GraphQL */ `
    mutation CheckLinkPreview($url: String!) {
      checkLinkPreview(url: $url) {
        id
        title
        image
        relatedPublicPosts {
          id
          source {
            id
          }
        }
      }
    }
  `;

  beforeEach(async () => {
    await deleteKeysByPattern(`${rateLimiterName}:*`);
  });

  const variables: Record<string, string> = { url: 'https://daily.dev' };

  it('should not authorize when not logged in', () =>
    testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables,
      },
      'UNAUTHENTICATED',
    ));

  it('should return link preview if url not found', async () => {
    loggedUser = '1';

    const sampleResponse = {
      title: 'We updated our RSA SSH host key',
      image:
        'https://github.blog/wp-content/uploads/2021/12/github-security_orange-banner.png',
    };

    nock(postScraperOrigin)
      .post('/preview', { url: variables.url })
      .reply(200, sampleResponse);

    const res = await client.mutate(MUTATION, { variables });

    expect(res.errors).toBeFalsy();
    expect(res.data.checkLinkPreview.title).toEqual(sampleResponse.title);
    expect(res.data.checkLinkPreview.image).toEqual(sampleResponse.image);
    expect(res.data.checkLinkPreview.id).toBeFalsy();
  });

  it('should rate limit getting link preview by 5', async () => {
    loggedUser = '1';

    const sampleResponse = {
      title: 'We updated our RSA SSH host key',
      image:
        'https://github.blog/wp-content/uploads/2021/12/github-security_orange-banner.png',
    };

    const mockRequest = () =>
      nock(postScraperOrigin)
        .post('/preview', { url: variables.url })
        .reply(200, sampleResponse);

    const limit = 20;
    for (let i = 0; i < Array(limit).length; i++) {
      mockRequest();
      const res = await client.mutate(MUTATION, { variables });
      expect(res.errors).toBeFalsy();
    }

    await testMutationErrorCode(
      client,
      { mutation: MUTATION, variables },
      'RATE_LIMITED',
      'Too many requests, please try again in 60s',
    );
  });

  it('should return link preview and image being the placeholder when empty', async () => {
    loggedUser = '1';

    const sampleResponse = { title: 'We updated our RSA SSH host key' };

    nock(postScraperOrigin)
      .post('/preview', { url: variables.url })
      .reply(200, sampleResponse);

    const res = await client.mutate(MUTATION, { variables });

    expect(res.errors).toBeFalsy();
    expect(res.data.checkLinkPreview.title).toEqual(sampleResponse.title);
    expect(res.data.checkLinkPreview.image).toEqual(
      pickImageUrl({ createdAt: new Date() }),
    );
    expect(res.data.checkLinkPreview.id).toBeFalsy();
  });

  it('should return link preview image and default title when null', async () => {
    loggedUser = '1';

    const sampleResponse = { title: null };

    nock(postScraperOrigin)
      .post('/preview', { url: variables.url })
      .reply(200, sampleResponse);

    const res = await client.mutate(MUTATION, { variables });

    expect(res.errors).toBeFalsy();
    expect(res.data.checkLinkPreview.title).toEqual(DEFAULT_POST_TITLE);
    expect(res.data.checkLinkPreview.image).toEqual(
      pickImageUrl({ createdAt: new Date() }),
    );
    expect(res.data.checkLinkPreview.id).toBeFalsy();
  });

  it('should return link preview image and default title when empty', async () => {
    loggedUser = '1';

    const sampleResponse = { title: '' };

    nock(postScraperOrigin)
      .post('/preview', { url: variables.url })
      .reply(200, sampleResponse);

    const res = await client.mutate(MUTATION, { variables });

    expect(res.errors).toBeFalsy();
    expect(res.data.checkLinkPreview.title).toEqual(DEFAULT_POST_TITLE);
    expect(res.data.checkLinkPreview.image).toEqual(
      pickImageUrl({ createdAt: new Date() }),
    );
    expect(res.data.checkLinkPreview.id).toBeFalsy();
  });

  it('should return post by canonical', async () => {
    loggedUser = '1';
    const url = 'http://p1c.com';
    const foundPost = await con
      .getRepository(ArticlePost)
      .findOneByOrFail({ canonicalUrl: url });
    const res = await client.mutate(MUTATION, { variables: { url } });
    expect(res.data.checkLinkPreview).toBeTruthy();
    expect(res.data.checkLinkPreview.id).toEqual(foundPost.id);
  });

  it('should return post by url', async () => {
    loggedUser = '1';
    const url = 'http://p1.com';
    const foundPost = await con
      .getRepository(ArticlePost)
      .findOneByOrFail({ url });
    const res = await client.mutate(MUTATION, { variables: { url } });
    expect(res.data.checkLinkPreview).toBeTruthy();
    expect(res.data.checkLinkPreview.id).toEqual(foundPost.id);
  });

  it('should return related public posts', async () => {
    loggedUser = '1';

    await saveFixtures(con, Source, [
      {
        id: 'user',
        name: 'User',
        image: 'http//image.com/user',
        handle: 'user',
        type: SourceType.User,
        active: true,
        private: false,
      },
    ]);

    await saveFixtures(con, SharePost, [
      {
        id: 'relatedPost1',
        shortId: 'relatedPost1',
        sharedPostId: 'p1',
        sourceId: 'squad',
        createdAt: addDays(new Date(), -1),
      },
      {
        id: 'relatedPost2',
        shortId: 'relatedPost2',
        sharedPostId: 'p1',
        sourceId: 'user',
        createdAt: new Date(),
      },
      {
        id: 'relatedPost3',
        shortId: 'relatedPost3',
        sharedPostId: 'p1',
        sourceId: 'user',
        private: true,
      },
    ]);
    const url = 'http://p1.com';
    const res = await client.mutate(MUTATION, { variables: { url } });
    expect(res.data.checkLinkPreview).toBeTruthy();
    expect(res.data.checkLinkPreview.relatedPublicPosts).toHaveLength(2);
    expect(res.data.checkLinkPreview.relatedPublicPosts[0].id).toEqual(
      'relatedPost2',
    );
    expect(res.data.checkLinkPreview.relatedPublicPosts[1].id).toEqual(
      'relatedPost1',
    );
  });
});

describe('mutation createFreeformPost', () => {
  const MUTATION = /* GraphQL */ `
    mutation CreateFreeformPost(
      $sourceId: ID!
      $title: String!
      $content: String!
      $image: Upload
    ) {
      createFreeformPost(
        sourceId: $sourceId
        title: $title
        content: $content
        image: $image
      ) {
        id
        author {
          id
        }
        source {
          id
          flags {
            totalPosts
          }
        }
        title
        content
        contentHtml
        type
        private
      }
    }
  `;

  const params = {
    sourceId: 'a',
    title: 'This is a welcome post',
    content: 'Sample content',
  };

  beforeEach(async () => {
    await saveSquadFixtures();
  });

  it('should not authorize when moderation is required', async () => {
    loggedUser = '4';
    await testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: { ...params, sourceId: 'm' },
      },
      'FORBIDDEN',
    );
  });

  it('should not authorize when moderation is required', async () => {
    loggedUser = '4';
    await testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: { ...params, sourceId: 'm' },
      },
      'FORBIDDEN',
    );
  });

  it('should bypass moderation because user is a moderator', async () => {
    loggedUser = '3';
    const res = await client.mutate(MUTATION, {
      variables: { ...params, sourceId: 'm' },
    });
    expect(res.errors).toBeFalsy();
    expect(res.data.createFreeformPost.type).toEqual(PostType.Freeform);
    expect(res.data.createFreeformPost.author.id).toEqual('3');
    expect(res.data.createFreeformPost.source.id).toEqual('m');
  });

  it('should not authorize when not logged in', () =>
    testMutationErrorCode(
      client,
      { mutation: MUTATION, variables: params },
      'UNAUTHENTICATED',
    ));

  it('should return an error if title is an empty space', async () => {
    loggedUser = '1';

    return testMutationErrorCode(
      client,
      { mutation: MUTATION, variables: { ...params, title: ' ' } },
      'GRAPHQL_VALIDATION_FAILED',
    );
  });

  it('should return an error if title exceeds 250 characters', async () => {
    loggedUser = '1';

    return testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: {
          ...params,
          title:
            'Hello World! Start your squad journey here - Hello World! Start your squad journey here Hello World! Start your squad journey here - Hello World! Start your squad journey here Hello World! Start your squad journey here - Hello World! Start your squad journey here',
        },
      },
      'GRAPHQL_VALIDATION_FAILED',
    );
  });

  it('should return an error if content exceeds 10000 characters', async () => {
    loggedUser = '1';

    const content = 'Hello World! Start your squad journey here'; // 42 chars
    const sample = new Array(240).fill(content); // 42*240 = 10_080

    return testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: {
          ...params,
          content: sample.join(' - '),
        },
      },
      'GRAPHQL_VALIDATION_FAILED',
    );
  });

  it('should return error if user is not part of the squad', async () => {
    loggedUser = '1';
    await con
      .getRepository(Source)
      .update({ id: 'b' }, { type: SourceType.Squad });

    return testMutationErrorCode(
      client,
      { mutation: MUTATION, variables: { ...params, sourceId: 'b' } },
      'FORBIDDEN',
    );
  });

  it('should return error if source is machine type', async () => {
    loggedUser = '1';
    await con
      .getRepository(Source)
      .update({ id: 'a' }, { type: SourceType.Machine });

    testMutationErrorCode(
      client,
      { mutation: MUTATION, variables: { ...params, sourceId: 'a' } },
      'NOT_FOUND',
    );
  });

  it('should create a freeform post if all parameters have passed', async () => {
    loggedUser = '1';

    const content = '# Updated content';
    const res = await client.mutate(MUTATION, {
      variables: { ...params, content },
    });
    expect(res.errors).toBeFalsy();
    expect(res.data.createFreeformPost.type).toEqual(PostType.Freeform);
    expect(res.data.createFreeformPost.author.id).toEqual('1');
    expect(res.data.createFreeformPost.source.id).toEqual('a');
    expect(res.data.createFreeformPost.title).toEqual(params.title);
    expect(res.data.createFreeformPost.content).toEqual(content);
    expect(res.data.createFreeformPost.contentHtml).toMatchSnapshot();
  });

  it('should increment source total posts', async () => {
    loggedUser = '1';
    const sourceId = 'a';
    const repo = con.getRepository(Source);
    const current = 2;
    await repo.update({ id: sourceId }, { flags: { totalPosts: current } });
    const source = await repo.findOneByOrFail({ id: sourceId });
    expect(source.flags.totalPosts).toEqual(current);
    const content = '# Updated content';
    const res = await client.mutate(MUTATION, {
      variables: { ...params, content },
    });
    expect(res.errors).toBeFalsy();
    expect(res.data.createFreeformPost.source.id).toEqual('a');
    expect(res.data.createFreeformPost.source.flags.totalPosts).toEqual(
      current + 1,
    );
  });

  it('should increment source total posts even if undefined', async () => {
    loggedUser = '1';
    const sourceId = 'a';
    const source = await con
      .getRepository(Source)
      .findOneByOrFail({ id: sourceId });
    expect(source.flags.totalPosts).toEqual(3);
    const posts = await con.getRepository(Post).countBy({ sourceId: 'a' });
    expect(posts).toEqual(3);
    const content = '# Updated content';
    const res = await client.mutate(MUTATION, {
      variables: { ...params, content },
    });
    expect(res.errors).toBeFalsy();
    expect(res.data.createFreeformPost.source.id).toEqual('a');
    expect(res.data.createFreeformPost.source.flags.totalPosts).toEqual(
      posts + 1,
    );
  });

  it('should set the post to be private if source is private', async () => {
    await con.getRepository(Source).update({ id: 'a' }, { private: true });
    loggedUser = '1';

    const content = '# Updated content';
    const res = await client.mutate(MUTATION, {
      variables: { ...params, content },
    });
    expect(res.errors).toBeFalsy();
    expect(res.data.createFreeformPost.type).toEqual(PostType.Freeform);
    expect(res.data.createFreeformPost.private).toEqual(true);
  });

  it('should set the post to be public if source is public', async () => {
    await con.getRepository(Source).update({ id: 'a' }, { private: false });
    loggedUser = '1';

    const content = '# Updated content';
    const res = await client.mutate(MUTATION, {
      variables: { ...params, content },
    });
    expect(res.errors).toBeFalsy();
    expect(res.data.createFreeformPost.type).toEqual(PostType.Freeform);
    expect(res.data.createFreeformPost.private).toEqual(false);
  });

  it('should handle markdown injections', async () => {
    loggedUser = '1';

    const content =
      '```\n```<style>body{background-color: blue!important}a,h1,h2{color: red!important}</style>\n```';
    const res = await client.mutate(MUTATION, {
      variables: { ...params, content },
    });
    expect(res.errors).toBeFalsy();
    expect(res.data.createFreeformPost.contentHtml).toEqual(
      '<pre><code>```<span class="hljs-tag">&lt;<span class="hljs-name">style</span>&gt;</span><span class="language-css"><span class="hljs-selector-tag">body</span>{<span class="hljs-attribute">background-color</span>: blue<span class="hljs-meta">!important</span>}<span class="hljs-selector-tag">a</span>,<span class="hljs-selector-tag">h1</span>,<span class="hljs-selector-tag">h2</span>{<span class="hljs-attribute">color</span>: red<span class="hljs-meta">!important</span>}</span><span class="hljs-tag">&lt;/<span class="hljs-name">style</span>&gt;</span>\n' +
        '</code></pre>\n',
    );
  });

  const args = {
    mentionedUserId: '2',
    mentionedByUserId: '1',
  };
  const setupMention = async (mutationParams: {
    title?: string;
    content?: string;
  }): Promise<FreeformPost> => {
    const before = await con.getRepository(PostMention).findOneBy(args);
    expect(before).toBeFalsy();
    await con.getRepository(User).update({ id: '2' }, { username: 'lee' });
    const res = await client.mutate(MUTATION, {
      variables: { ...params, ...mutationParams },
    });
    expect(res.errors).toBeFalsy();
    return res.data.createFreeformPost;
  };

  it('should allow mention as part of the content', async () => {
    loggedUser = '1';
    const content = 'Test @lee';
    const post = await setupMention({ content });
    const mention = await con
      .getRepository(PostMention)
      .findOneBy({ ...args, postId: post.id });
    expect(mention).toBeTruthy();
    expect(post.contentHtml).toMatchSnapshot();
  });

  it('should not allow mention outside of squad as part of the content being a freeform post', async () => {
    loggedUser = '1';
    const content = 'Test @sample';
    await con.getRepository(User).update({ id: '9' }, { username: 'sample' });
    const post = await setupMention({ content });
    const mention = await con
      .getRepository(PostMention)
      .findOneBy({ ...args, postId: post.id });
    expect(mention).toBeFalsy();
    expect(post.contentHtml).toMatchSnapshot();
  });

  // I was way too ahead of myself and forgot the mention comes in at v7 - so no need to test for now
  // it('should not allow mention as part of the title being a freeform post', async () => {
  //   loggedUser = '1';
  //   const title = 'Test @lee';
  //   const post = await setupMention({ title });
  //   const mention = await con
  //     .getRepository(PostMention)
  //     .findOneBy({ ...args, postId: post.id });
  //   expect(mention).toBeFalsy();
  //   expect(post.titleHtml).toMatchSnapshot();
  // });

  describe('rate limiting', () => {
    const redisKey = `${rateLimiterName}:1:createPost`;
    it('store rate limiting state in redis', async () => {
      loggedUser = '1';

      const res = await client.mutate(MUTATION, {
        variables: params,
      });

      expect(res.errors).toBeFalsy();
      expect(await getRedisObject(redisKey)).toEqual('1');
    });

    it('should rate limit creating posts to 1 per minute', async () => {
      loggedUser = '1';

      for (let i = 0; i < 1; i++) {
        const res = await client.mutate(MUTATION, {
          variables: params,
        });

        expect(res.errors).toBeFalsy();
      }
      expect(await getRedisObject(redisKey)).toEqual('1');

      await testMutationErrorCode(
        client,
        { mutation: MUTATION, variables: params },
        'RATE_LIMITED',
        'Take a break. You already posted enough in the last 30 seconds',
      );

      // Check expiry, to not cause it to be flaky, we check if it is within 10 seconds
      expect(await getRedisObjectExpiry(redisKey)).toBeLessThanOrEqual(30);
      expect(await getRedisObjectExpiry(redisKey)).toBeGreaterThanOrEqual(20);
    });

    describe('high rate squads', () => {
      beforeEach(async () => {
        await con.getRepository(SquadSource).save({
          id: WATERCOOLER_ID,
          handle: 'watercooler',
          name: 'Watercooler',
          private: false,
        });
        await con.getRepository(SourceMember).save({
          sourceId: WATERCOOLER_ID,
          userId: '1',
          referralToken: 'watercoolerRt',
          role: SourceMemberRoles.Member,
        });
      });

      it('should rate limit creating posts in Watercooler squad to 1 per 10 minutes', async () => {
        loggedUser = '1';

        const res = await client.mutate(MUTATION, {
          variables: { ...params, sourceId: WATERCOOLER_ID },
        });

        expect(res.errors).toBeFalsy();
        expect(await getRedisObject(redisKey)).toEqual('1');

        await testMutationErrorCode(
          client,
          {
            mutation: MUTATION,
            variables: { ...params, sourceId: WATERCOOLER_ID },
          },
          'RATE_LIMITED',
          'Take a break. You already posted enough in the last 30 seconds',
        );
      });
    });
  });

  describe('vordr', () => {
    it('should set the correct vordr flags on a freeform post by a good user', async () => {
      loggedUser = '1';

      const content = '# Updated content';
      const res = await client.mutate(MUTATION, {
        variables: { ...params, content },
      });
      expect(res.errors).toBeFalsy();

      const post = await con
        .getRepository(FreeformPost)
        .findOneByOrFail({ id: res.data.createFreeformPost.id });

      expect(post.flags.vordr).toEqual(false);
    });

    it('should set the correct vordr flags on a freeform post by good user if vordr filter catches it', async () => {
      loggedUser = '1';

      const content = '# Updated content VordrWillCatchYou';
      const res = await client.mutate(MUTATION, {
        variables: { ...params, content },
      });
      expect(res.errors).toBeFalsy();

      const post = await con
        .getRepository(FreeformPost)
        .findOneByOrFail({ id: res.data.createFreeformPost.id });

      expect(post.flags.vordr).toEqual(true);
    });

    it('should set the correct vordr flags on a freeform post by bad user', async () => {
      loggedUser = 'vordr';

      const content = '# Updated content';
      const res = await client.mutate(MUTATION, {
        variables: { ...params, content },
      });
      expect(res.errors).toBeFalsy();

      const post = await con
        .getRepository(FreeformPost)
        .findOneByOrFail({ id: res.data.createFreeformPost.id });

      expect(post.flags.vordr).toEqual(true);
    });
  });

  describe('user source', () => {
    beforeEach(async () => {
      await con.getRepository(Feed).save({
        id: '1',
        userId: '1',
      });
    });

    it('should create user source if it does not already exist when sharing', async () => {
      loggedUser = '1';

      expect(
        await con
          .getRepository(SourceUser)
          .findOneBy({ id: loggedUser, userId: loggedUser }),
      ).toBeFalsy();

      const res = await client.mutate(MUTATION, {
        variables: { ...params, sourceId: loggedUser },
      });

      expect(res.errors).toBeFalsy();

      const source = await con
        .getRepository(SourceUser)
        .findOneByOrFail({ id: loggedUser, userId: loggedUser });

      expect(source).toBeTruthy();
    });

    it('should allow user to share to their own source', async () => {
      loggedUser = '1';

      const res = await client.mutate(MUTATION, {
        variables: { ...params, sourceId: loggedUser },
      });

      expect(res.errors).toBeFalsy();

      const post = await con
        .getRepository(FreeformPost)
        .findOneByOrFail({ sourceId: loggedUser, authorId: loggedUser });

      expect(post).toBeTruthy();
      expect(res.data.createFreeformPost.title).toEqual(params.title);
      expect(res.data.createFreeformPost.content).toEqual(params.content);
      expect(post.sourceId).toEqual(loggedUser);
    });

    it('should not allow other users to share to another user source', async () => {
      loggedUser = '2';

      await con.getRepository(SourceUser).save({
        id: '1',
        userId: '1',
        name: 'User 1',
        handle: 'user1',
        private: false,
      });

      await testMutationErrorCode(
        client,
        {
          mutation: MUTATION,
          variables: { ...params, sourceId: '1' },
        },
        'FORBIDDEN',
      );
    });
  });
});

describe('query sourcePostModeration', () => {
  const firstPostUuid = randomUUID();
  beforeEach(async () => {
    await saveSquadFixtures();
    await con.getRepository(SourcePostModeration).save([
      {
        id: firstPostUuid,
        createdById: '4',
        sourceId: 'm',
        title: 'My First Moderated Post',
        type: PostType.Freeform,
        status: SourcePostModerationStatus.Pending,
        content: 'Hello World',
      },
      {
        id: randomUUID(),
        sourceId: 'm',
        createdById: '4',
        title: 'My Second Moderated Post',
        type: PostType.Share,
        sharedPostId: 'p1',
        status: SourcePostModerationStatus.Pending,
        content: 'Hello World',
      },
      {
        id: randomUUID(),
        sourceId: 'm',
        createdById: '5',
        title: 'My Third Moderated Post',
        type: PostType.Freeform,
        status: SourcePostModerationStatus.Pending,
        content: 'Hello World',
      },
      {
        id: randomUUID(),
        sourceId: 'm',
        createdById: '5',
        title: 'Rejected Post',
        type: PostType.Freeform,
        status: SourcePostModerationStatus.Rejected,
        content: 'Hello World',
      },
      {
        id: randomUUID(),
        sourceId: 'm',
        createdById: '5',
        title: 'Approved Post',
        type: PostType.Freeform,
        status: SourcePostModerationStatus.Approved,
        content: 'Hello World',
      },
    ]);
  });

  const queryOne = `query sourcePostModeration($id: ID!) {
  sourcePostModeration(id: $id) {
    title
    type
  }
}`;

  const queryAllForSource = `query sourcePostModerations($sourceId: ID!, $status: [String]) {
  sourcePostModerations(sourceId: $sourceId, status: $status) {
    edges {
      node {
        id
        title
        type
      }
    }
  }
}`;

  it('should receive forbidden error because user is not member of squad', async () => {
    loggedUser = '2';
    return testQueryErrorCode(
      client,
      {
        query: queryOne,
        variables: { id: firstPostUuid },
      },
      'FORBIDDEN',
    );
  });

  it('should retrieve moderation item because it is made by the user', async () => {
    loggedUser = '4';

    const res = await client.query(queryOne, {
      variables: { id: firstPostUuid },
    });
    expect(res.data).toEqual({
      sourcePostModeration: {
        title: 'My First Moderated Post',
        type: 'freeform',
      },
    });
  });

  it('should retrieve moderation item because user is moderator', async () => {
    loggedUser = '3';
    const res = await client.query(queryOne, {
      variables: { id: firstPostUuid },
    });
    expect(res.errors).toBeUndefined();
    expect(res.data).toEqual({
      sourcePostModeration: {
        title: 'My First Moderated Post',
        type: 'freeform',
      },
    });
  });

  it('should return all the moderation items from sourcePostModerations because user is moderator', async () => {
    loggedUser = '3';

    const res = await client.query(queryAllForSource, {
      variables: { sourceId: 'm' },
    });
    expect(res.errors).toBeUndefined();
    expect(res.data.sourcePostModerations.edges.length).toEqual(5);
  });

  it('should filter out vordred submissions for moderators', async () => {
    loggedUser = '3';
    await con
      .getRepository(SourcePostModeration)
      .update(
        { id: firstPostUuid },
        { flags: updateFlagsStatement<SourcePostModeration>({ vordr: true }) },
      );
    const res = await client.query(queryAllForSource, {
      variables: { sourceId: 'm' },
    });
    expect(res.errors).toBeUndefined();
    expect(res.data.sourcePostModerations.edges.length).toEqual(4);
    const vordred = res.data.sourcePostModerations.edges.find(
      (edge) => edge.node.id === firstPostUuid,
    );
    expect(vordred).toBeFalsy();
  });

  it('should return only approved and rejected items', async () => {
    loggedUser = '3';

    const res = await client.query(queryAllForSource, {
      variables: { sourceId: 'm', status: ['approved', 'rejected'] },
    });
    expect(res.errors).toBeUndefined();
    expect(res.data.sourcePostModerations.edges.length).toEqual(2);
  });

  it('should return only the users moderation items because user is not moderator', async () => {
    loggedUser = '5';

    const res = await client.query(queryAllForSource, {
      variables: { sourceId: 'm' },
    });
    expect(res.errors).toBeUndefined();
    expect(res.data.sourcePostModerations.edges.length).toEqual(3);
  });

  it('should not have access because user is not member of source', async () => {
    loggedUser = '2';

    return testQueryErrorCode(
      client,
      {
        query: queryAllForSource,
        variables: { sourceId: 'm' },
      },
      'FORBIDDEN',
    );
  });
});

describe('mutation createSourcePostModeration', () => {
  beforeEach(async () => {
    await saveSquadFixtures();
  });

  const MUTATION = `mutation CreateSourcePostModeration($sourceId: ID! $title: String!, $type: String!, $content: String, $image: Upload, $imageUrl: String, $sharedPostId: ID, $externalLink: String, $postId: ID) {
    createSourcePostModeration(sourceId: $sourceId, title: $title, type: $type, content: $content, image: $image, imageUrl: $imageUrl, sharedPostId: $sharedPostId, externalLink: $externalLink, postId: $postId) {
      id
      title
      content
      contentHtml
      externalLink
      type
      image
      titleHtml
      sharedPost {
        id
      }
      post {
        id
      }
      source {
        permalink
      }
    }
  }`;

  const params = {
    sourceId: 'm',
    title: 'My first post',
    content: 'Hello World',
  };

  it('should result in error because user is not member of squad', async () => {
    loggedUser = '2';

    return await testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: { ...params, type: PostType.Freeform },
      },
      'FORBIDDEN',
    );
  });

  it('should throw an error if type is welcome', async () => {
    loggedUser = '4';

    return await testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: { ...params, type: PostType.Welcome },
      },
      'GRAPHQL_VALIDATION_FAILED',
    );
  });

  it('should throw an error if type is article', async () => {
    loggedUser = '4';

    return await testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: { ...params, type: PostType.Article },
      },
      'GRAPHQL_VALIDATION_FAILED',
    );
  });

  it('should create freeform moderation entry for an existing post', async () => {
    loggedUser = '4';
    const newPost = con.getRepository(Post).create({
      ...params,
      id: 'new',
      shortId: 'new',
      type: PostType.Freeform,
      authorId: '4',
    });
    await con.getRepository(Post).save(newPost);

    const res = await client.mutate(MUTATION, {
      variables: {
        sourceId: 'm',
        title: 'My new freeform title',
        type: PostType.Freeform,
        content: 'My new freeform content',
        postId: newPost.id,
      },
    });
    expect(res.errors).toBeFalsy();
    expect(res.data.createSourcePostModeration.title).toEqual(
      'My new freeform title',
    );
    expect(res.data.createSourcePostModeration.content).toEqual(
      'My new freeform content',
    );
    expect(res.data.createSourcePostModeration.post.id).toEqual(newPost.id);
    expect(res.data.createSourcePostModeration.source).toBeDefined();
  });

  it('should create share moderation entry for an existing post', async () => {
    loggedUser = '4';
    const newPost = con.getRepository(Post).create({
      ...params,
      id: 'new',
      shortId: 'new',
      type: PostType.Share,
      authorId: '4',
    });
    await con.getRepository(Post).save(newPost);

    const res = await client.mutate(MUTATION, {
      variables: {
        sourceId: 'm',
        title: 'My new share title',
        type: PostType.Share,
        content: 'My new share content',
        postId: newPost.id,
      },
    });
    expect(res.errors).toBeFalsy();
    expect(res.data.createSourcePostModeration.post.id).toEqual(newPost.id);
    expect(res.data.createSourcePostModeration.source).toBeDefined();
  });

  it("should not be able to create moderation entry for another user's post", async () => {
    loggedUser = '3';
    const newPost = con.getRepository(Post).create({
      ...params,
      id: 'new',
      shortId: 'new',
      type: PostType.Share,
      scoutId: '4',
    });
    await con.getRepository(Post).save(newPost);

    await testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: {
          sourceId: 'm',
          title: "I'm editing your post!",
          type: PostType.Share,
          content: "It's mine now",
          postId: newPost.id,
        },
      },
      'FORBIDDEN',
    );
  });

  it('should successfully create a squad post moderation entry of type freeform', async () => {
    loggedUser = '4';
    const res = await client.mutate(MUTATION, {
      variables: { ...params, type: PostType.Freeform },
    });
    expect(res.errors).toBeFalsy();
    expect(res.data.createSourcePostModeration).toBeTruthy();
    expect(res.data.createSourcePostModeration.type).toEqual(PostType.Freeform);
    expect(res.data.createSourcePostModeration.title).toEqual('My first post');
    expect(res.data.createSourcePostModeration.titleHtml).toBeNull();
    expect(res.data.createSourcePostModeration.content).toEqual('Hello World');
    expect(res.data.createSourcePostModeration.contentHtml).toEqual(
      '<p>Hello World</p>',
    );
    expect(res.data.createSourcePostModeration.post).toBeNull();
  });

  it('should successfully create a squad post moderation entry of type share', async () => {
    loggedUser = '4';
    const res = await client.mutate(MUTATION, {
      variables: {
        ...params,
        title: 'I am sharing a post',
        sharedPostId: 'p1',
        type: PostType.Share,
      },
    });
    expect(res.errors).toBeFalsy();
    expect(res.data.createSourcePostModeration).toBeTruthy();
    expect(res.data.createSourcePostModeration.type).toEqual(PostType.Share);
    expect(res.data.createSourcePostModeration.title).toEqual(
      'I am sharing a post',
    );
    expect(res.data.createSourcePostModeration.titleHtml).toEqual(
      '<p>I am sharing a post</p>',
    );
    expect(res.data.createSourcePostModeration.content).toBeNull();
    expect(res.data.createSourcePostModeration.contentHtml).toBeNull();
    expect(res.data.createSourcePostModeration.sharedPost.id).toEqual('p1');
    expect(res.data.createSourcePostModeration.post).toBeNull();
  });

  it('should successfully create a squad post moderation for external link', async () => {
    loggedUser = '4';
    const externalParams = {
      sourceId: 'm',
      title: 'External Link Title',
      content: 'This is an awesome link',
      imageUrl:
        'https://res.cloudinary.com/daily-now/image/upload/f_auto/v1/placeholders/1',
      type: PostType.Share,
      externalLink: 'https://www.google.com',
    };
    const res = await client.mutate(MUTATION, {
      variables: externalParams,
    });
    expect(res.errors).toBeFalsy();
    expect(res.data.createSourcePostModeration).toBeTruthy();
    expect(res.data.createSourcePostModeration.type).toEqual(PostType.Share);
    expect(res.data.createSourcePostModeration.image).toEqual(
      externalParams.imageUrl,
    );
    expect(res.data.createSourcePostModeration.title).toEqual(
      'External Link Title',
    );
    expect(res.data.createSourcePostModeration.titleHtml).toBeNull();
    expect(res.data.createSourcePostModeration.content).toEqual(
      'This is an awesome link',
    );
    expect(res.data.createSourcePostModeration.contentHtml).toEqual(
      '<p>This is an awesome link</p>',
    );
    expect(res.data.createSourcePostModeration.externalLink).toEqual(
      externalParams.externalLink,
    );
    expect(res.data.createSourcePostModeration.post).toBeNull();
  });

  describe('vordr', () => {
    it('should set the correct vordr flags if the submission is from a good user', async () => {
      loggedUser = '4';
      const externalParams = {
        sourceId: 'm',
        title: 'External Link Title',
        content: 'This is an awesome link',
        imageUrl:
          'https://res.cloudinary.com/daily-now/image/upload/f_auto/v1/placeholders/1',
        type: PostType.Share,
        externalLink: 'https://www.google.com',
      };
      const res = await client.mutate(MUTATION, {
        variables: externalParams,
      });
      expect(res.errors).toBeFalsy();
      expect(res.data.createSourcePostModeration).toBeTruthy();

      const { id } = res.data.createSourcePostModeration;
      const moderation = await con
        .getRepository(SourcePostModeration)
        .findOneByOrFail({ id });
      expect(moderation.status).toEqual(SourcePostModerationStatus.Pending);
      expect(moderation.flags.vordr).toEqual(false);
    });

    it('should set the correct vordr flags if the submission is from a bad user', async () => {
      await con.getRepository(SourceMember).save({
        userId: 'vordr',
        sourceId: 'm',
        role: SourceMemberRoles.Member,
        referralToken: randomUUID(),
      });
      loggedUser = 'vordr';
      const externalParams = {
        sourceId: 'm',
        title: 'External Link Title',
        content: 'This is an awesome link',
        imageUrl:
          'https://res.cloudinary.com/daily-now/image/upload/f_auto/v1/placeholders/1',
        type: PostType.Share,
        externalLink: 'https://www.google.com',
      };
      const res = await client.mutate(MUTATION, {
        variables: externalParams,
      });
      expect(res.errors).toBeFalsy();
      expect(res.data.createSourcePostModeration).toBeTruthy();

      const { id } = res.data.createSourcePostModeration;
      const moderation = await con
        .getRepository(SourcePostModeration)
        .findOneByOrFail({ id });
      expect(moderation.status).toEqual(SourcePostModerationStatus.Pending);
      expect(moderation.flags.vordr).toEqual(true);
    });
  });
});

describe('mutation editPost', () => {
  const MUTATION = `
    mutation EditPost($id: ID!, $title: String, $content: String, $image: Upload) {
      editPost(id: $id, title: $title, content: $content, image: $image) {
        id
        title
        content
        contentHtml
        type
        source {
          id
        }
      }
    }
  `;

  const params = {
    id: 'p1',
    title: 'This is a welcome post',
  };

  beforeEach(async () => {
    await saveSquadFixtures();
  });

  it('should not authorize when not logged in', () =>
    testMutationErrorCode(
      client,
      { mutation: MUTATION, variables: params },
      'UNAUTHENTICATED',
    ));

  it('should return an error if post type is not allowed to be editable', async () => {
    loggedUser = '1';
    await con
      .getRepository(Post)
      .update({ id: 'p1' }, { type: PostType.Share });

    await testMutationErrorCode(
      client,
      { mutation: MUTATION, variables: params },
      'FORBIDDEN',
    );

    await con
      .getRepository(Post)
      .update({ id: 'p1' }, { type: PostType.Collection });

    await testMutationErrorCode(
      client,
      { mutation: MUTATION, variables: params },
      'FORBIDDEN',
    );

    await con
      .getRepository(Post)
      .update({ id: 'p1' }, { type: PostType.Article });

    return testMutationErrorCode(
      client,
      { mutation: MUTATION, variables: params },
      'FORBIDDEN',
    );
  });

  it('should return an error if title exceeds 250 characters', async () => {
    loggedUser = '1';

    return testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: {
          ...params,
          title:
            'Hello World! Start your squad journey here - Hello World! Start your squad journey here Hello World! Start your squad journey here - Hello World! Start your squad journey here Hello World! Start your squad journey here - Hello World! Start your squad journey here',
        },
      },
      'GRAPHQL_VALIDATION_FAILED',
    );
  });

  it('should return an error if content exceeds 10000 characters', async () => {
    loggedUser = '1';

    const content = 'Hello World! Start your squad journey here'; // 42 chars
    const sample = new Array(240).fill(content); // 42*240 = 10_080

    return testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: {
          ...params,
          content: sample.join(' - '),
        },
      },
      'GRAPHQL_VALIDATION_FAILED',
    );
  });

  it('should restrict member when user is not the author of the post', async () => {
    loggedUser = '2';

    return testMutationErrorCode(
      client,
      { mutation: MUTATION, variables: { id: 'p1', title: 'Test' } },
      'FORBIDDEN',
    );
  });

  it('should update title of the post if it is either freeform or welcome post', async () => {
    loggedUser = '1';
    await con
      .getRepository(Post)
      .update({ id: 'p1' }, { type: PostType.Freeform });
    const title = 'Updated title';
    const res1 = await client.mutate(MUTATION, {
      variables: { id: 'p1', title },
    });
    expect(res1.errors).toBeFalsy();
    expect(res1.data.editPost.title).toEqual(title);

    await con
      .getRepository(Post)
      .update({ id: 'p1' }, { type: PostType.Welcome, title: 'Test' });

    const res2 = await client.mutate(MUTATION, {
      variables: { id: 'p1', title },
    });
    expect(res2.errors).toBeFalsy();
    expect(res2.data.editPost.title).toEqual(title);
  });

  it('should update title of the post but keep the same squad flags total posts count', async () => {
    loggedUser = '1';
    await con
      .getRepository(Source)
      .update({ id: 'a' }, { flags: { totalPosts: 1 } });
    await con
      .getRepository(Post)
      .update({ id: 'p1' }, { type: PostType.Freeform });
    const title = 'Updated title';
    const res1 = await client.mutate(MUTATION, {
      variables: { id: 'p1', title },
    });
    expect(res1.errors).toBeFalsy();
    expect(res1.data.editPost.title).toEqual(title);

    await con
      .getRepository(Post)
      .update({ id: 'p1' }, { type: PostType.Welcome, title: 'Test' });

    const res2 = await client.mutate(MUTATION, {
      variables: { id: 'p1', title },
    });
    expect(res2.errors).toBeFalsy();
    expect(res2.data.editPost.title).toEqual(title);
    const source = await con
      .getRepository(Source)
      .findOneByOrFail({ id: res2.data.editPost.source.id });
    expect(source.flags.totalPosts).toEqual(1);
  });

  it('should not allow moderator or admin to do update posts of other people', async () => {
    loggedUser = '1';
    await con
      .getRepository(Post)
      .update({ id: 'p1' }, { type: PostType.Freeform, authorId: '2' });
    await con
      .getRepository(SourceMember)
      .update(
        { userId: '1', sourceId: 'a' },
        { role: SourceMemberRoles.Moderator },
      );
    const title = 'Updated title';
    await testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: { ...params, title },
      },
      'FORBIDDEN',
    );

    await con
      .getRepository(SourceMember)
      .update(
        { userId: '1', sourceId: 'a' },
        { role: SourceMemberRoles.Admin },
      );

    return await testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: { ...params, title },
      },
      'FORBIDDEN',
    );
  });

  it('should allow moderator to do update of welcome posts', async () => {
    loggedUser = '2';

    await con
      .getRepository(SourceMember)
      .update(
        { userId: '2', sourceId: 'a' },
        { role: SourceMemberRoles.Moderator },
      );

    const content = 'Updated content';
    const res = await client.mutate(MUTATION, {
      variables: { id: 'p1', content: content },
    });
    expect(res.errors).toBeFalsy();
    expect(res.data.editPost.content).toEqual(content);
  });

  it('should allow admin to do update of welcome post', async () => {
    loggedUser = '2';

    await con
      .getRepository(SourceMember)
      .update(
        { userId: '2', sourceId: 'a' },
        { role: SourceMemberRoles.Admin },
      );

    const content = 'Updated content';
    const res = await client.mutate(MUTATION, {
      variables: { id: 'p1', content: content },
    });
    expect(res.errors).toBeFalsy();
    expect(res.data.editPost.content).toEqual(content);
  });

  it('should allow author to update their freeform post', async () => {
    loggedUser = '1';

    const content = '# Updated content';
    const res = await client.mutate(MUTATION, {
      variables: { id: 'p1', content: content },
    });
    expect(res.errors).toBeFalsy();
    expect(res.data.editPost.contentHtml).toMatchSnapshot();
  });

  it('should allow mention as part of the content', async () => {
    loggedUser = '1';
    const params = {
      mentionedUserId: '2',
      mentionedByUserId: '1',
      postId: 'p1',
    };
    const before = await con.getRepository(PostMention).findOneBy(params);
    expect(before).toBeFalsy();
    await con.getRepository(User).update({ id: '2' }, { username: 'lee' });
    const content = 'Test @lee';
    const res = await client.mutate(MUTATION, {
      variables: { id: 'p1', content: content },
    });
    expect(res.errors).toBeFalsy();
    const mention = await con.getRepository(PostMention).findOneBy(params);
    expect(mention).toBeTruthy();
    expect(res.data.editPost.contentHtml).toMatchSnapshot();
  });

  it('should not throw if no changes are made to post during edit mutation', async () => {
    loggedUser = '2';

    await con.getRepository(WelcomePost).save({
      id: 'wp',
      shortId: 'wp',
      sourceId: 'a',
      title: 'Welcome post',
      content: '#Test',
      contentHtml: '<h1>Test</h1>',
    });
    await con
      .getRepository(SourceMember)
      .update(
        { userId: '2', sourceId: 'a' },
        { role: SourceMemberRoles.Admin },
      );

    const res = await client.mutate(MUTATION, {
      variables: {
        id: 'wp',
        content: '#Test',
      },
    });
    expect(res.errors).toBeFalsy();
  });
});

describe('mutation promoteToPublic', () => {
  const MUTATION = `
    mutation PromoteToPublic($id: ID!) {
      promoteToPublic(id: $id) {
        _
      }
    }
  `;

  const params = { id: 'p1' };

  it('should not authorize when not logged in', () =>
    testMutationErrorCode(
      client,
      { mutation: MUTATION, variables: params },
      'UNAUTHENTICATED',
    ));

  it('should return an error if user is not a system moderator', async () => {
    loggedUser = '1';

    return testMutationErrorCode(
      client,
      { mutation: MUTATION, variables: params },
      'FORBIDDEN',
    );
  });

  it('should promote post to public', async () => {
    loggedUser = '1';
    roles = [Roles.Moderator];

    await client.mutate(MUTATION, {
      variables: params,
    });

    const post = await con.getRepository(Post).findOneByOrFail({ id: 'p1' });
    const sixDays = new Date();
    sixDays.setDate(sixDays.getDate() + 6);
    const timeToSeconds = Math.floor(sixDays.valueOf() / 1000);
    expect(`${post.flags.promoteToPublic}`.length).toEqual(10);
    expect(post.flags.promoteToPublic).toBeGreaterThan(timeToSeconds);
  });
});

describe('mutation demoteFromPublic', () => {
  const MUTATION = `
    mutation DemoteFromPublic($id: ID!) {
      demoteFromPublic(id: $id) {
        _
      }
    }
  `;

  const params = { id: 'p1' };

  it('should not authorize when not logged in', () =>
    testMutationErrorCode(
      client,
      { mutation: MUTATION, variables: params },
      'UNAUTHENTICATED',
    ));

  it('should return an error if user is not a system moderator', async () => {
    loggedUser = '1';

    return testMutationErrorCode(
      client,
      { mutation: MUTATION, variables: params },
      'FORBIDDEN',
    );
  });

  it('should demote post from public', async () => {
    loggedUser = '1';
    roles = [Roles.Moderator];

    await con.getRepository(Post).update(
      { id: 'p1' },
      {
        flags: updateFlagsStatement<Post>({
          promoteToPublic: 1690552747,
        }),
      },
    );

    await client.mutate(MUTATION, {
      variables: params,
    });

    const post = await con.getRepository(Post).findOneByOrFail({ id: 'p1' });
    expect(post.flags.promoteToPublic).toEqual(null);
  });
});

describe('mutation updatePinPost', () => {
  const MUTATION = `
    mutation UpdatePinPost($id: ID!, $pinned: Boolean!) {
      updatePinPost(id: $id, pinned: $pinned) {
        _
      }
    }
  `;

  const params = { id: 'p1', pinned: false };

  beforeEach(async () => {
    await saveSquadFixtures();
  });

  it('should not authorize when not logged in', () =>
    testMutationErrorCode(
      client,
      { mutation: MUTATION, variables: params },
      'UNAUTHENTICATED',
    ));

  it('should return an error if user is not a moderator or an admin', async () => {
    loggedUser = '1';

    return testMutationErrorCode(
      client,
      { mutation: MUTATION, variables: params },
      'FORBIDDEN',
    );
  });

  it('should update pinnedAt property based on the parameter if user is admin or moderator', async () => {
    loggedUser = '1';

    await con
      .getRepository(SourceMember)
      .update({ userId: '1' }, { role: SourceMemberRoles.Admin });

    const getPost = () => con.getRepository(Post).findOneByOrFail({ id: 'p1' });

    const unpinned = await getPost();
    expect(unpinned.pinnedAt).toBeNull();

    await client.mutate(MUTATION, {
      variables: { id: 'p1', pinned: true },
    });

    const pinned = await getPost();
    expect(pinned.pinnedAt).not.toBeNull();

    await client.mutate(MUTATION, {
      variables: { id: 'p1', pinned: false },
    });

    const unpinnedAgain = await getPost();
    expect(unpinnedAgain.pinnedAt).toBeNull();

    await con
      .getRepository(SourceMember)
      .update({ userId: '1' }, { role: SourceMemberRoles.Moderator });

    await client.mutate(MUTATION, {
      variables: { id: 'p1', pinned: true },
    });

    const pinnedAgain = await getPost();
    expect(pinnedAgain.pinnedAt).not.toBeNull();
  });
});

describe('mutation swapPinnedPosts', () => {
  const MUTATION = `
    mutation SwapPinnedPosts($id: ID!, $swapWithId: ID!) {
      swapPinnedPosts(id: $id, swapWithId: $swapWithId) {
        _
      }
    }
  `;

  const params = { id: 'p1', swapWithId: 'p2' };

  beforeEach(async () => {
    await saveSquadFixtures();

    const currentDate = new Date();
    await con.getRepository(Post).update(
      { id: 'p1' },
      {
        pinnedAt: new Date(currentDate.getTime() - 2000),
      },
    );

    await con.getRepository(Post).update(
      { id: 'p2' },
      {
        pinnedAt: new Date(currentDate.getTime() - 1000),
        sourceId: 'a',
      },
    );
  });

  it('should not authorize when not logged in', () =>
    testMutationErrorCode(
      client,
      { mutation: MUTATION, variables: params },
      'UNAUTHENTICATED',
    ));

  it('should return an error if user is not a moderator or an admin', async () => {
    loggedUser = '1';

    return testMutationErrorCode(
      client,
      { mutation: MUTATION, variables: params },
      'FORBIDDEN',
    );
  });

  describe('when authenticated w/ permissions', () => {
    beforeEach(async () => {
      await con
        .getRepository(SourceMember)
        .update({ userId: '1' }, { role: SourceMemberRoles.Admin });
    });

    it('should throw a validation error if posts are not pinned', async () => {
      loggedUser = '1';

      // @ts-expect-error pinnedAt default value is null
      await con.getRepository(Post).update({ id: 'p1' }, { pinnedAt: null });

      return testMutationError(
        client,
        { mutation: MUTATION, variables: params },
        (errors) => {
          expect(errors.length).toEqual(1);
          expect(errors[0].message).toEqual('Posts must be pinned first');
        },
      );
    });

    it('should allow swapping w/ the next pinned post', async () => {
      loggedUser = '1';

      const pinnedQuery = () =>
        con.getRepository(Post).find({
          where: { pinnedAt: Not(IsNull()), sourceId: 'a' },
          order: { pinnedAt: 'DESC' },
        });

      const postsBefore = await pinnedQuery();
      expect(postsBefore.map((p) => p.id)).toEqual(['p2', 'p1']);

      await client.mutate(MUTATION, {
        variables: { id: 'p1', swapWithId: 'p2' },
      });

      const postsAfter = await pinnedQuery();
      expect(postsAfter.map((p) => p.id)).toEqual(['p1', 'p2']);
    });

    it('should allow swapping w/ the previous pinned post', async () => {
      loggedUser = '1';

      const pinnedQuery = () =>
        con.getRepository(Post).find({
          where: { pinnedAt: Not(IsNull()), sourceId: 'a' },
          order: { pinnedAt: 'DESC' },
        });

      const postsBefore = await pinnedQuery();
      expect(postsBefore.map((p) => p.id)).toEqual(['p2', 'p1']);

      await client.mutate(MUTATION, {
        variables: { id: 'p2', swapWithId: 'p1' },
      });

      const postsAfter = await pinnedQuery();
      expect(postsAfter.map((p) => p.id)).toEqual(['p1', 'p2']);
    });

    it('should increment relevant pinnedAt values to avoid duplicates', async () => {
      loggedUser = '1';

      // oldest of the 3 pinned posts: p2, p1, p3
      await con.getRepository(Post).update(
        { id: 'p3' },
        {
          pinnedAt: new Date(new Date().getTime() - 3000),
          sourceId: 'a',
        },
      );

      // to assert that the first pinned post pinnedAt timestamp is changed
      const firstPostBefore = await con
        .getRepository(Post)
        .findOneByOrFail({ id: 'p2' });

      await client.mutate(MUTATION, {
        variables: { id: 'p3', swapWithId: 'p1' },
      });

      const firstPostAfter = await con
        .getRepository(Post)
        .findOneByOrFail({ id: 'p2' });

      expect(firstPostAfter.pinnedAt?.getTime()).toEqual(
        (firstPostBefore.pinnedAt?.getTime() as number) + 1000,
      );
    });

    it('only touches pinned posts in the given source', async () => {
      loggedUser = '1';

      // oldest of the 3 pinned posts: p2, p1, p3
      await con.getRepository(Post).update(
        { id: 'p3' },
        {
          pinnedAt: new Date(new Date().getTime() - 3000),
          sourceId: 'a',
        },
      );

      // take p2 out of the source
      await con.getRepository(Post).update({ id: 'p2' }, { sourceId: 'b' });

      const firstPostBefore = await con
        .getRepository(Post)
        .findOneByOrFail({ id: 'p2' });

      await client.mutate(MUTATION, {
        variables: { id: 'p3', swapWithId: 'p1' },
      });

      const firstPostAfter = await con
        .getRepository(Post)
        .findOneByOrFail({ id: 'p2' });

      expect(firstPostAfter.pinnedAt?.getTime()).toEqual(
        firstPostBefore.pinnedAt?.getTime(),
      );
    });
  });
});

describe('util checkHasMention', () => {
  it('should return true if mention was found', () => {
    expect(checkHasMention('sample title @lee abc', 'lee')).toBeTruthy();
  });

  it('should return false if mention was not found', () => {
    expect(checkHasMention('sample title lee abc', 'lee')).toBeFalsy();
  });
});

describe('downvoted field', () => {
  const QUERY = `{
    post(id: "p1") {
      downvoted
    }
  }`;

  it('should return null when user is not logged in', async () => {
    const res = await client.query(QUERY);
    expect(res.data.post.downvoted).toEqual(null);
  });

  it('should return false when user did not downvoted the post', async () => {
    loggedUser = '1';
    const res = await client.query(QUERY);
    expect(res.data.post.downvoted).toEqual(false);
  });

  it('should return true when user did downvoted the post', async () => {
    loggedUser = '1';
    const repo = con.getRepository(UserPost);
    await repo.save(
      repo.create({
        postId: 'p1',
        userId: loggedUser,
        vote: UserVote.Down,
      }),
    );
    const res = await client.query(QUERY);
    expect(res.data.post.downvoted).toEqual(true);
  });
});

describe('posts flags field', () => {
  const QUERY = `{
    post(id: "p1") {
      flags {
        private
        promoteToPublic
      }
    }
  }`;

  it('should return all the public flags for anonymous user', async () => {
    await con.getRepository(Post).update(
      { id: 'p1' },
      {
        flags: updateFlagsStatement({ private: true, promoteToPublic: 123 }),
      },
    );
    const res = await client.query(QUERY);
    expect(res.errors).toBeFalsy();
    expect(res.data.post.flags).toEqual({
      private: true,
      promoteToPublic: null,
    });
  });

  it('should return all flags to logged user', async () => {
    loggedUser = '1';
    await con.getRepository(Post).update(
      { id: 'p1' },
      {
        flags: updateFlagsStatement({ private: true, promoteToPublic: 123 }),
      },
    );
    const res = await client.query(QUERY);
    expect(res.errors).toBeFalsy();
    expect(res.data.post.flags).toEqual({
      private: true,
      promoteToPublic: null,
    });
  });

  it('should return all flags to system moderator', async () => {
    roles = [Roles.Moderator];
    loggedUser = '1';
    await con.getRepository(Post).update(
      { id: 'p1' },
      {
        flags: updateFlagsStatement({ private: true, promoteToPublic: 123 }),
      },
    );
    const res = await client.query(QUERY);
    expect(res.errors).toBeFalsy();
    expect(res.data.post.flags).toEqual({
      private: true,
      promoteToPublic: 123,
    });
  });

  it('should return null values for unset flags', async () => {
    const res = await client.query(QUERY);
    expect(res.data.post.flags).toEqual({
      private: null,
      promoteToPublic: null,
    });
  });

  it('should contain all default values in db query', async () => {
    const post = await con.getRepository(Post).findOneByOrFail({ id: 'p1' });
    expect(post.flags).toEqual({
      sentAnalyticsReport: true,
      visible: true,
      showOnFeed: true,
    });
  });
});

describe('userState field', () => {
  const QUERY = `{
    post(id: "p1") {
      userState {
        vote
        hidden
        flags {
          feedbackDismiss
        }
        awarded
      }
    }
  }`;

  it('should return null if anonymous user', async () => {
    const res = await client.query(QUERY);
    expect(res.data.post.userState).toBeNull();
  });

  it('should return default state if state does not exist', async () => {
    loggedUser = '1';
    const res = await client.query(QUERY);
    const { vote, hidden, flags } = con.getRepository(UserPost).create();
    expect(res.data.post.userState).toMatchObject({
      vote,
      hidden,
      flags,
      awarded: false,
    });
  });

  it('should return user state', async () => {
    loggedUser = '1';
    await con.getRepository(UserPost).save({
      postId: 'p1',
      userId: loggedUser,
      vote: UserVote.Up,
      hidden: true,
      flags: { feedbackDismiss: false },
    });
    const res = await client.query(QUERY);
    expect(res.data.post.userState).toMatchObject({
      vote: UserVote.Up,
      hidden: true,
      flags: { feedbackDismiss: false },
      awarded: false,
    });
  });

  it('should return awarded state', async () => {
    loggedUser = '1';

    const transaction = await con.getRepository(UserTransaction).save({
      processor: UserTransactionProcessor.Njord,
      receiverId: '1',
      status: UserTransactionStatus.Success,
      productId: null,
      senderId: '1',
      fee: 0,
      value: 100,
      valueIncFees: 100,
    });

    await con.getRepository(UserPost).save({
      postId: 'p1',
      userId: loggedUser,
      vote: UserVote.Up,
      hidden: true,
      flags: { feedbackDismiss: false },
      awardTransactionId: transaction.id,
    });
    const res = await client.query(QUERY);
    expect(res.data.post.userState).toMatchObject({
      vote: UserVote.Up,
      hidden: true,
      flags: { feedbackDismiss: false },
      awarded: true,
    });
  });
});

describe('mutation vote post', () => {
  const MUTATION = `
    mutation Vote($id: ID!, $vote: Int!, $entity: UserVoteEntity!) {
      vote(id: $id, vote: $vote, entity: $entity) {
        _
      }
    }`;

  it('should not authorize when not logged in', () =>
    testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: {
          id: 'p1',
          vote: UserVote.Up,
          entity: UserVoteEntity.Post,
        },
      },
      'UNAUTHENTICATED',
    ));

  it('should throw not found when cannot find post', () => {
    loggedUser = '1';
    return testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: {
          id: 'invalid',
          vote: UserVote.Up,
          entity: UserVoteEntity.Post,
        },
      },
      'NOT_FOUND',
    );
  });

  it('should throw not found when cannot find user', () => {
    loggedUser = '9';
    return testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: { id: 'p1', vote: UserVote.Up, entity: UserVoteEntity.Post },
      },
      'NOT_FOUND',
    );
  });

  it('should throw error when user cannot access the post', async () => {
    loggedUser = '1';
    await con.getRepository(Source).update({ id: 'a' }, { private: true });
    return testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: { id: 'p1', vote: UserVote.Up, entity: UserVoteEntity.Post },
      },
      'FORBIDDEN',
    );
  });

  it('should throw when invalid vote option', () => {
    loggedUser = '1';
    return testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: { id: 'p1', vote: 3, entity: UserVoteEntity.Post },
      },
      'GRAPHQL_VALIDATION_FAILED',
    );
  });

  const testUpvote = async () => {
    await con.getRepository(Post).save({
      id: 'p1',
      upvotes: 3,
    });
    const beforePost = await con
      .getRepository(Post)
      .findOneByOrFail({ id: 'p1' });
    const res = await client.mutate(MUTATION, {
      variables: { id: 'p1', vote: UserVote.Up, entity: UserVoteEntity.Post },
    });
    expect(res.errors).toBeFalsy();
    const userPost = await con.getRepository(UserPost).findOneBy({
      userId: loggedUser,
      postId: 'p1',
    });
    expect(userPost).toMatchObject({
      userId: loggedUser,
      postId: 'p1',
      vote: UserVote.Up,
      hidden: false,
    });
    const post = await con.getRepository(Post).findOneByOrFail({ id: 'p1' });
    expect(post.upvotes).toEqual(4);
    expect(post.statsUpdatedAt.getTime()).toBeGreaterThan(
      beforePost.statsUpdatedAt.getTime(),
    );
  };

  it('should upvote', async () => {
    loggedUser = '1';

    await testUpvote();
  });

  it('should upvote and update source flags upvotes count', async () => {
    loggedUser = '1';
    const source = await con.getRepository(Source).findOneByOrFail({ id: 'a' });
    expect(source.flags.totalUpvotes).toEqual(undefined);

    await testUpvote();

    const updatedSource = await con
      .getRepository(Source)
      .findOneByOrFail({ id: 'a' });
    expect(updatedSource.flags.totalUpvotes).toEqual(4);
  });

  it('should upvote and increment squad total upvotes', async () => {
    loggedUser = '1';
    const repo = con.getRepository(Source);
    await repo.update({ id: 'a' }, { type: SourceType.Squad });
    const source = await repo.findOneByOrFail({ id: 'a' });
    expect(source.flags.totalUpvotes).toEqual(undefined);

    await testUpvote();

    const updatedSource = await repo.findOneByOrFail({ id: 'a' });
    expect(updatedSource.flags.totalUpvotes).toEqual(4);
  });

  const testDownvote = async () => {
    await con.getRepository(Post).save({
      id: 'p1',
      downvotes: 3,
    });
    const beforePost = await con
      .getRepository(Post)
      .findOneByOrFail({ id: 'p1' });
    const res = await client.mutate(MUTATION, {
      variables: { id: 'p1', vote: UserVote.Down, entity: UserVoteEntity.Post },
    });
    expect(res.errors).toBeFalsy();
    const userPost = await con.getRepository(UserPost).findOneBy({
      postId: 'p1',
      userId: loggedUser,
    });
    expect(userPost).toMatchObject({
      postId: 'p1',
      userId: loggedUser,
      vote: UserVote.Down,
      hidden: true,
    });
    const post = await con.getRepository(Post).findOneByOrFail({ id: 'p1' });
    expect(post.downvotes).toEqual(4);
    expect(post.statsUpdatedAt.getTime()).toBeGreaterThan(
      beforePost.statsUpdatedAt.getTime(),
    );
  };

  it('should downvote', async () => {
    loggedUser = '1';

    await testDownvote();
  });

  it('should downvote and NOT update source flags upvotes count', async () => {
    loggedUser = '1';
    const source = await con.getRepository(Source).findOneByOrFail({ id: 'a' });
    expect(source.flags.totalUpvotes).toEqual(undefined);

    await testDownvote();

    // should not be affected since this is not a squad
    const updatedSource = await con
      .getRepository(Source)
      .findOneByOrFail({ id: 'a' });
    expect(updatedSource.flags.totalUpvotes).toEqual(undefined);
  });

  it('should downvote and NOT update squads flags upvotes count', async () => {
    loggedUser = '1';
    const repo = con.getRepository(Source);
    await repo.update({ id: 'a' }, { type: SourceType.Squad });
    const source = await repo.findOneByOrFail({ id: 'a' });
    expect(source.flags.totalUpvotes).toEqual(undefined);

    await testDownvote();

    // should not be affected since the existing vote was a downvote
    const updatedSource = await con
      .getRepository(Source)
      .findOneByOrFail({ id: 'a' });
    expect(updatedSource.flags.totalUpvotes).toEqual(undefined);
  });

  const testCancelVote = async (initialVote = UserVote.Up) => {
    const beforePost = await con
      .getRepository(Post)
      .findOneByOrFail({ id: 'p1' });
    await client.mutate(MUTATION, {
      variables: { id: 'p1', vote: initialVote, entity: UserVoteEntity.Post },
    });
    const oldPost = await con.getRepository(Post).findOneByOrFail({ id: 'p1' });
    expect(oldPost.upvotes).toEqual(1);
    const res = await client.mutate(MUTATION, {
      variables: { id: 'p1', vote: UserVote.None, entity: UserVoteEntity.Post },
    });
    const userPost = await con.getRepository(UserPost).findOneBy({
      postId: 'p1',
      userId: loggedUser,
    });
    expect(res.errors).toBeFalsy();
    expect(userPost).toMatchObject({
      userId: loggedUser,
      postId: 'p1',
      vote: UserVote.None,
      hidden: false,
    });
    expect(oldPost.statsUpdatedAt.getTime()).toBeGreaterThan(
      beforePost.statsUpdatedAt.getTime(),
    );
  };

  it('should cancel vote', async () => {
    loggedUser = '1';
    await testCancelVote();
  });

  it('should cancel vote and update source flags upvotes count', async () => {
    loggedUser = '1';
    const source = await con.getRepository(Source).findOneByOrFail({ id: 'a' });
    expect(source.flags.totalUpvotes).toEqual(undefined);

    await testCancelVote();
    const post = await con.getRepository(Post).findOneBy({ id: 'p1' });
    expect(post?.upvotes).toEqual(0);

    // should not be affected since this is not a squad
    const updatedSource = await con
      .getRepository(Source)
      .findOneByOrFail({ id: 'a' });
    expect(updatedSource.flags.totalUpvotes).toEqual(0);
  });

  it('should cancel vote and decrement squads flags upvotes count if previous vote was upvote', async () => {
    loggedUser = '1';
    const repo = con.getRepository(Source);
    await repo.update({ id: 'a' }, { type: SourceType.Squad });
    const source = await repo.findOneByOrFail({ id: 'a' });
    expect(source.flags.totalUpvotes).toEqual(undefined);

    await testCancelVote();
    const post = await con.getRepository(Post).findOneBy({ id: 'p1' });
    expect(post?.upvotes).toEqual(0);

    const updatedSource = await con
      .getRepository(Source)
      .findOneByOrFail({ id: 'a' });
    expect(updatedSource.flags.totalUpvotes).toEqual(0);
  });

  it('should cancel vote and NOT update squads flags upvotes count if previous state was downvote', async () => {
    const repo = con.getRepository(Source);
    await repo.update({ id: 'a' }, { type: SourceType.Squad });
    const source = await repo.findOneByOrFail({ id: 'a' });
    expect(source.flags.totalUpvotes).toEqual(undefined);

    loggedUser = '2';

    await client.mutate(MUTATION, {
      variables: { id: 'p1', vote: UserVote.Up, entity: UserVoteEntity.Post },
    });

    loggedUser = '1';

    await testCancelVote(UserVote.Down);
    const post = await con.getRepository(Post).findOneBy({ id: 'p1' });
    // expected is 1 since originally we upvoted with a different user
    expect(post?.upvotes).toEqual(1);

    const updatedSource = await con
      .getRepository(Source)
      .findOneByOrFail({ id: 'a' });
    expect(updatedSource.flags.totalUpvotes).toEqual(1);
  });

  it('should not set votedAt when vote is not set on insert', async () => {
    loggedUser = '1';
    await con.getRepository(UserPost).save({
      postId: 'p1',
      userId: loggedUser,
      hidden: false,
    });
    const userPostBefore = await con.getRepository(UserPost).findOneBy({
      postId: 'p1',
      userId: loggedUser,
    });
    expect(userPostBefore?.votedAt).toBeNull();
  });

  it('should set votedAt when user votes for the first time', async () => {
    loggedUser = '1';
    const userPostBefore = await con.getRepository(UserPost).findOneBy({
      postId: 'p1',
      userId: loggedUser,
    });
    expect(userPostBefore).toBeNull();
    const res = await client.mutate(MUTATION, {
      variables: { id: 'p1', vote: UserVote.Down, entity: UserVoteEntity.Post },
    });
    const userPost = await con.getRepository(UserPost).findOneBy({
      postId: 'p1',
      userId: loggedUser,
    });
    expect(res.errors).toBeFalsy();
    expect(userPost?.votedAt).not.toBeNull();
  });

  it('should update votedAt when vote value changes', async () => {
    loggedUser = '1';
    await con.getRepository(UserPost).save({
      postId: 'p1',
      userId: loggedUser,
      vote: UserVote.Up,
      hidden: false,
    });
    const userPostBefore = await con.getRepository(UserPost).findOneBy({
      postId: 'p1',
      userId: loggedUser,
    });
    const res = await client.mutate(MUTATION, {
      variables: { id: 'p1', vote: UserVote.Down, entity: UserVoteEntity.Post },
    });
    const userPost = await con.getRepository(UserPost).findOneBy({
      postId: 'p1',
      userId: loggedUser,
    });
    expect(res.errors).toBeFalsy();
    expect(userPostBefore?.votedAt?.toISOString()).not.toBe(
      userPost?.votedAt?.toISOString(),
    );
  });

  it('should not update votedAt when vote value stays the same', async () => {
    loggedUser = '1';
    await con.getRepository(UserPost).save({
      postId: 'p1',
      userId: loggedUser,
      vote: UserVote.Up,
      hidden: false,
    });
    const userPostBefore = await con.getRepository(UserPost).findOneBy({
      postId: 'p1',
      userId: loggedUser,
    });
    const res = await client.mutate(MUTATION, {
      variables: { id: 'p1', vote: UserVote.Up, entity: UserVoteEntity.Post },
    });
    const userPost = await con.getRepository(UserPost).findOneBy({
      postId: 'p1',
      userId: loggedUser,
    });
    expect(res.errors).toBeFalsy();
    expect(userPostBefore?.votedAt?.toISOString()).toBe(
      userPost?.votedAt?.toISOString(),
    );
  });

  it('should increment post upvotes when user upvotes', async () => {
    loggedUser = '1';
    await con.getRepository(Post).save({
      id: 'p1',
      upvotes: 3,
    });
    await con.getRepository(UserPost).save({
      postId: 'p1',
      userId: loggedUser,
      vote: UserVote.None,
    });
    const res = await client.mutate(MUTATION, {
      variables: { id: 'p1', vote: UserVote.Up, entity: UserVoteEntity.Post },
    });
    expect(res.errors).toBeFalsy();
    const post = await con.getRepository(Post).findOneBy({ id: 'p1' });
    expect(post?.upvotes).toEqual(4);
    expect(post?.downvotes).toEqual(0);
  });

  it('should increment post downvotes when user downvotes', async () => {
    loggedUser = '1';
    await con.getRepository(Post).save({
      id: 'p1',
      downvotes: 3,
    });
    await con.getRepository(UserPost).save({
      postId: 'p1',
      userId: loggedUser,
      vote: UserVote.None,
    });
    const res = await client.mutate(MUTATION, {
      variables: { id: 'p1', vote: UserVote.Down, entity: UserVoteEntity.Post },
    });
    expect(res.errors).toBeFalsy();
    const post = await con.getRepository(Post).findOneBy({ id: 'p1' });
    expect(post?.upvotes).toEqual(0);
    expect(post?.downvotes).toEqual(4);
  });

  it('should decrement post upvotes when user cancels upvote', async () => {
    loggedUser = '1';
    await con.getRepository(UserPost).save({
      postId: 'p1',
      userId: loggedUser,
      vote: UserVote.Up,
    });
    await con.getRepository(Post).save({
      id: 'p1',
      upvotes: 3,
    });
    const res = await client.mutate(MUTATION, {
      variables: { id: 'p1', vote: UserVote.None, entity: UserVoteEntity.Post },
    });
    expect(res.errors).toBeFalsy();
    const post = await con.getRepository(Post).findOneBy({ id: 'p1' });
    expect(post?.upvotes).toEqual(2);
    expect(post?.downvotes).toEqual(0);
  });

  it('should decrement post downvotes when user cancels downvote', async () => {
    loggedUser = '1';
    await con.getRepository(UserPost).save({
      postId: 'p1',
      userId: loggedUser,
      vote: UserVote.Down,
    });
    await con.getRepository(Post).save({
      id: 'p1',
      downvotes: 3,
    });
    const res = await client.mutate(MUTATION, {
      variables: { id: 'p1', vote: UserVote.None, entity: UserVoteEntity.Post },
    });
    expect(res.errors).toBeFalsy();
    const post = await con.getRepository(Post).findOneBy({ id: 'p1' });
    expect(post?.upvotes).toEqual(0);
    expect(post?.downvotes).toEqual(2);
  });

  it('should decrement post upvotes and increment downvotes when user changes vote from up to down', async () => {
    loggedUser = '1';
    await con.getRepository(UserPost).save({
      postId: 'p1',
      userId: loggedUser,
      vote: UserVote.Up,
    });
    await con.getRepository(Post).save({
      id: 'p1',
      upvotes: 3,
      downvotes: 2,
    });
    const res = await client.mutate(MUTATION, {
      variables: { id: 'p1', vote: UserVote.Down, entity: UserVoteEntity.Post },
    });
    expect(res.errors).toBeFalsy();
    const post = await con.getRepository(Post).findOneBy({ id: 'p1' });
    expect(post?.upvotes).toEqual(2);
    expect(post?.downvotes).toEqual(3);
  });

  it('should increment post upvotes and decrement downvotes when user changes vote from down to up', async () => {
    loggedUser = '1';
    await con.getRepository(UserPost).save({
      postId: 'p1',
      userId: loggedUser,
      vote: UserVote.Down,
    });
    await con.getRepository(Post).save({
      id: 'p1',
      upvotes: 2,
      downvotes: 3,
    });
    const res = await client.mutate(MUTATION, {
      variables: { id: 'p1', vote: UserVote.Up, entity: UserVoteEntity.Post },
    });
    expect(res.errors).toBeFalsy();
    const post = await con.getRepository(Post).findOneBy({ id: 'p1' });
    expect(post?.upvotes).toEqual(3);
    expect(post?.downvotes).toEqual(2);
  });

  it('should decrement post upvotes when UserPost entity is removed', async () => {
    loggedUser = '1';
    await con.getRepository(UserPost).save({
      postId: 'p1',
      userId: loggedUser,
      vote: UserVote.Up,
    });
    await con.getRepository(Post).save({
      id: 'p1',
      upvotes: 3,
    });
    await con.getRepository(UserPost).delete({
      postId: 'p1',
      userId: loggedUser,
    });
    const post = await con.getRepository(Post).findOneBy({ id: 'p1' });
    expect(post?.upvotes).toEqual(2);
    expect(post?.downvotes).toEqual(0);
  });

  it('should decrement post downvotes when UserPost entity is removed', async () => {
    loggedUser = '1';
    await con.getRepository(UserPost).save({
      postId: 'p1',
      userId: loggedUser,
      vote: UserVote.Down,
    });
    await con.getRepository(Post).save({
      id: 'p1',
      downvotes: 3,
    });
    await con.getRepository(UserPost).delete({
      postId: 'p1',
      userId: loggedUser,
    });
    const post = await con.getRepository(Post).findOneBy({ id: 'p1' });
    expect(post?.upvotes).toEqual(0);
    expect(post?.downvotes).toEqual(2);
  });
});

describe('mutation dismissPostFeedback', () => {
  const MUTATION = `
    mutation DismissPostFeedback($id: ID!) {
      dismissPostFeedback(id: $id) {
        _
      }
    }`;

  it('should not authorize when not logged in', () =>
    testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: { id: 'p1' },
      },
      'UNAUTHENTICATED',
    ));

  it('should throw not found when cannot find post', () => {
    loggedUser = '1';
    return testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: { id: 'invalid' },
      },
      'NOT_FOUND',
    );
  });

  it('should throw not found when cannot find user', () => {
    loggedUser = '9';
    return testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: { id: 'p1' },
      },
      'NOT_FOUND',
    );
  });

  it('should throw error when user cannot access the post', async () => {
    loggedUser = '1';
    await con.getRepository(Source).update({ id: 'a' }, { private: true });
    return testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: { id: 'p1' },
      },
      'FORBIDDEN',
    );
  });

  it('should dismiss feedback', async () => {
    loggedUser = '1';
    const res = await client.mutate(MUTATION, {
      variables: { id: 'p1' },
    });
    expect(res.errors).toBeFalsy();
    const userPost = await con.getRepository(UserPost).findOneBy({
      userId: loggedUser,
      postId: 'p1',
    });
    expect(userPost).toMatchObject({
      userId: loggedUser,
      postId: 'p1',
      vote: UserVote.None,
      flags: { feedbackDismiss: true },
    });
  });

  it('should dismiss feedback when user state exists', async () => {
    loggedUser = '1';
    await con.getRepository(UserPost).save({
      userId: loggedUser,
      postId: 'p1',
      vote: UserVote.Up,
      flags: { feedbackDismiss: false },
    });
    const res = await client.mutate(MUTATION, {
      variables: { id: 'p1' },
    });
    expect(res.errors).toBeFalsy();
    const userPost = await con.getRepository(UserPost).findOneBy({
      userId: loggedUser,
      postId: 'p1',
    });
    expect(userPost).toMatchObject({
      userId: loggedUser,
      postId: 'p1',
      vote: UserVote.Up,
      flags: { feedbackDismiss: true },
    });
  });
});

describe('query relatedPosts', () => {
  const QUERY = `
  query relatedPosts($id: ID!, $relationType: PostRelationType!, $after: String, $first: Int) {
    relatedPosts(id: $id, relationType: $relationType, after: $after, first: $first) {
      edges {
        node {
          id
          title
        }
      }
    }
  }
  `;

  beforeEach(async () => {
    await con.getRepository(PostRelation).save(relatedPostsFixture);
  });

  it('should throw error when user cannot access the post', async () => {
    loggedUser = '1';
    await con.getRepository(Source).update({ id: 'a' }, { private: true });
    return testQueryErrorCode(
      client,
      {
        query: QUERY,
        variables: { id: 'p1', relationType: PostRelationType.Collection },
      },
      'FORBIDDEN',
    );
  });

  it('should return related posts', async () => {
    loggedUser = '1';

    const res = await client.query(QUERY, {
      variables: { id: 'p1', relationType: PostRelationType.Collection },
    });

    expect(res.errors).toBeFalsy();
    expect(res).toMatchObject({
      data: {
        relatedPosts: {
          edges: [
            {
              node: {
                id: 'p2',
                title: 'P2',
              },
            },
            {
              node: {
                id: 'p3',
                title: 'P3',
              },
            },
            {
              node: {
                id: 'p4',
                title: 'P4',
              },
            },
          ],
        },
      },
    });
  });
});

describe('posts summary field', () => {
  const QUERY = /* GraphQL */ `
    {
      post(id: "p1") {
        summary
      }
    }
  `;

  beforeEach(async () => {
    await con.getRepository(ArticlePost).update(
      { id: 'p1' },
      {
        summary: 'P1 summary',
      },
    );
  });

  it('should return summary', async () => {
    const res = await client.query(QUERY);

    expect(res.errors).toBeFalsy();

    expect(res.data.post).toEqual({
      summary: 'P1 summary',
    });
  });

  it('should return original summary when language is not set', async () => {
    loggedUser = '1';
    await con.getRepository(ArticlePost).update(
      { id: 'p1' },
      {
        translation: {
          en: {
            summary: 'P1 English',
          },
        },
      },
    );

    const res = await client.query(QUERY);

    expect(res.errors).toBeFalsy();

    expect(res.data.post).toEqual({
      summary: 'P1 summary',
    });
  });

  it('should return original summary if i18n exists but not plus', async () => {
    loggedUser = '1';
    await con.getRepository(Post).update(
      { id: 'p1' },
      {
        translation: {
          de: {
            summary: 'P1 german',
          },
        },
      },
    );

    const res = await client.query(QUERY, {
      headers: {
        'content-language': 'de',
      },
    });

    expect(res.errors).toBeFalsy();

    expect(res.data.post).toEqual({
      summary: 'P1 summary',
    });
  });

  it('should return i18n summary if exists', async () => {
    loggedUser = '1';
    isPlus = true;
    await con.getRepository(Post).update(
      { id: 'p1' },
      {
        translation: {
          de: {
            summary: 'P1 german',
          },
        },
      },
    );

    const res = await client.query(QUERY, {
      headers: {
        'content-language': 'de',
      },
    });

    expect(res.errors).toBeFalsy();

    expect(res.data.post).toEqual({
      summary: 'P1 german',
    });
  });

  it('should return default summary if i18n summary does not exist', async () => {
    loggedUser = '1';
    isPlus = true;
    const res = await client.query(QUERY, {
      headers: {
        'content-language': 'fr',
      },
    });

    expect(res.errors).toBeFalsy();

    expect(res.data.post).toEqual({
      summary: 'P1 summary',
    });
  });

  it('should return i18n summary for cased language codes', async () => {
    loggedUser = '1';
    isPlus = true;
    await con.getRepository(Post).update(
      { id: 'p1' },
      {
        translation: {
          'pt-BR': {
            summary: 'P1 Portugal Brazil',
          },
        },
      },
    );

    const res = await client.query(QUERY, {
      headers: {
        'content-language': 'pt-BR',
      },
    });

    expect(res.errors).toBeFalsy();

    expect(res.data.post).toEqual({
      summary: 'P1 Portugal Brazil',
    });
  });
});

describe('posts title field', () => {
  const QUERY = /* GraphQL */ `
    {
      post(id: "p1") {
        title
      }
    }
  `;

  it('should return title', async () => {
    const res = await client.query(QUERY);

    expect(res.errors).toBeFalsy();

    expect(res.data.post).toEqual({
      title: 'P1',
    });
  });

  it('should return original title when language is not set', async () => {
    loggedUser = '1';
    await con.getRepository(Post).update(
      { id: 'p1' },
      {
        translation: {
          en: {
            title: 'P1 English',
          },
        },
      },
    );

    const res = await client.query(QUERY);

    expect(res.errors).toBeFalsy();

    expect(res.data.post).toEqual({
      title: 'P1',
    });
  });

  it('should return i18n title if exists', async () => {
    loggedUser = '1';
    await con.getRepository(Post).update(
      { id: 'p1' },
      {
        translation: {
          de: {
            title: 'P1 german',
          },
        },
      },
    );

    const res = await client.query(QUERY, {
      headers: {
        'content-language': 'de',
      },
    });

    expect(res.errors).toBeFalsy();

    expect(res.data.post).toEqual({
      title: 'P1 german',
    });
  });

  it('should return default title if i18n title does not exist', async () => {
    loggedUser = '1';
    const res = await client.query(QUERY, {
      headers: {
        'content-language': 'fr',
      },
    });

    expect(res.errors).toBeFalsy();

    expect(res.data.post).toEqual({
      title: 'P1',
    });
  });

  it('should return i18n title for cased language codes', async () => {
    loggedUser = '1';
    await con.getRepository(Post).update(
      { id: 'p1' },
      {
        translation: {
          'pt-BR': {
            title: 'P1 Portugal Brazil',
          },
        },
      },
    );

    const res = await client.query(QUERY, {
      headers: {
        'content-language': 'pt-BR',
      },
    });

    expect(res.errors).toBeFalsy();

    expect(res.data.post).toEqual({
      title: 'P1 Portugal Brazil',
    });
  });

  describe('new translation field', () => {
    const QUERY_NTF = /* GraphQL */ `
      {
        post(id: "p1-ntf") {
          title
        }
      }
    `;

    beforeEach(async () => {
      await saveFixtures(con, ArticlePost, [
        {
          id: 'p1-ntf',
          shortId: 'sp1-ntf',
          title: 'P1-ntf',
          url: 'http://p1-ntf.com',
          canonicalUrl: 'http://p1-ntfc.com',
          image: 'https://daily.dev/image.jpg',
          score: 1,
          sourceId: 'a',
          tagsStr: 'javascript,webdev',
          type: PostType.Article,
          contentCuration: ['c1', 'c2'],
        },
      ]);
    });

    it('should return i18n title from new translation field when user is team member', async () => {
      loggedUser = '1';
      isTeamMember = true;
      await con.getRepository(Post).update(
        { id: 'p1-ntf' },
        {
          translation: {
            'pt-BR': {
              title: 'P1 Portugal Brazil',
            },
          },
        },
      );

      const res = await client.query(QUERY_NTF, {
        headers: {
          'content-language': 'pt-BR',
        },
      });

      expect(res.errors).toBeFalsy();

      expect(res.data.post).toEqual({
        title: 'P1 Portugal Brazil',
      });
    });

    it('should return original title from new translation field when user is team member', async () => {
      loggedUser = '1';
      isTeamMember = true;
      await con.getRepository(Post).update(
        { id: 'p1-ntf' },
        {
          translation: {
            'pt-BR': {
              title: 'P1 Portugal Brazil',
            },
          },
        },
      );

      const res = await client.query(QUERY_NTF, {
        headers: {
          'content-language': 'pt-BR',
        },
      });

      expect(res.errors).toBeFalsy();

      expect(res.data.post).toEqual({
        title: 'P1 Portugal Brazil',
      });
    });
  });

  describe('clickbait shield title', () => {
    beforeEach(async () => {
      await con.getRepository(Settings).save({
        userId: '1',
        flags: {
          clickbaitShieldEnabled: false,
        },
      });
    });

    it('should return original title if free user but post has smart title', async () => {
      loggedUser = '1';
      await con.getRepository(Settings).update(
        { userId: '1' },
        {
          flags: {
            clickbaitShieldEnabled: true,
          },
        },
      );
      await con.getRepository(Post).update(
        { id: 'p1' },
        {
          contentQuality: { is_clickbait_probability: 1.98 },
          contentMeta: {
            alt_title: { translations: { en: 'Clickbait title' } },
          },
        },
      );

      const res = await client.query(QUERY);
      expect(res.errors).toBeFalsy();
      expect(res.data.post).toEqual({
        title: 'P1',
      });
    });

    it('should return smart title if user has enabled clickbait shield', async () => {
      loggedUser = '1';
      isPlus = true;
      await con.getRepository(Settings).update(
        { userId: '1' },
        {
          flags: {
            clickbaitShieldEnabled: true,
          },
        },
      );
      await con.getRepository(Post).update(
        { id: 'p1' },
        {
          contentQuality: { is_clickbait_probability: 1.98 },
          contentMeta: {
            alt_title: { translations: { en: 'Clickbait title' } },
          },
        },
      );

      const res = await client.query(QUERY);
      expect(res.errors).toBeFalsy();
      expect(res.data.post).toEqual({
        title: 'Clickbait title',
      });
    });

    it('should return original title if user has enabled clickbait shield but post is not clickbait', async () => {
      loggedUser = '1';
      isPlus = true;
      await con.getRepository(Settings).update(
        { userId: '1' },
        {
          flags: {
            clickbaitShieldEnabled: true,
          },
        },
      );
      await con.getRepository(Post).update(
        { id: 'p1' },
        {
          contentQuality: { is_clickbait_probability: 0 },
          contentMeta: {
            alt_title: { translations: { en: 'Clickbait title' } },
          },
        },
      );

      const res = await client.query(QUERY);
      expect(res.errors).toBeFalsy();
      expect(res.data.post).toEqual({
        title: 'P1',
      });
    });

    it('should return original title if user has disabled clickbait shield', async () => {
      loggedUser = '1';
      isPlus = true;
      await con.getRepository(Settings).update(
        { userId: '1' },
        {
          flags: {
            clickbaitShieldEnabled: false,
          },
        },
      );
      await con.getRepository(Post).update(
        { id: 'p1' },
        {
          contentQuality: { is_clickbait_probability: 1.98 },
          contentMeta: {
            alt_title: { translations: { en: 'Clickbait title' } },
          },
        },
      );

      const res = await client.query(QUERY);
      expect(res.errors).toBeFalsy();
      expect(res.data.post).toEqual({
        title: 'P1',
      });
    });

    it('should return i18n smart title', async () => {
      loggedUser = '1';
      isPlus = true;
      await con.getRepository(Settings).update(
        { userId: '1' },
        {
          flags: {
            clickbaitShieldEnabled: true,
          },
        },
      );
      await con.getRepository(Post).update(
        { id: 'p1' },
        {
          contentQuality: { is_clickbait_probability: 1.98 },
          contentMeta: {
            alt_title: {
              translations: { en: 'Clickbait title', de: 'Clickbait title DE' },
            },
          },
        },
      );

      const res = await client.query(QUERY, {
        headers: {
          'content-language': 'de',
        },
      });
      expect(res.errors).toBeFalsy();
      expect(res.data.post).toEqual({
        title: 'Clickbait title DE',
      });
    });

    it('should return english smart title when i18n smart title does not exist', async () => {
      loggedUser = '1';
      isPlus = true;
      await con.getRepository(Settings).update(
        { userId: '1' },
        {
          flags: {
            clickbaitShieldEnabled: true,
          },
        },
      );
      await con.getRepository(Post).update(
        { id: 'p1' },
        {
          contentQuality: { is_clickbait_probability: 1.98 },
          contentMeta: {
            alt_title: {
              translations: { en: 'Clickbait title EN' },
            },
          },
        },
      );

      const res = await client.query(QUERY, {
        headers: {
          'content-language': 'de',
        },
      });
      expect(res.errors).toBeFalsy();
      expect(res.data.post).toEqual({
        title: 'Clickbait title EN',
      });
    });

    it('should return i18n title when smart title does not exist', async () => {
      loggedUser = '1';
      isPlus = true;
      await con.getRepository(Settings).update(
        { userId: '1' },
        {
          flags: {
            clickbaitShieldEnabled: true,
          },
        },
      );
      await con.getRepository(Post).update(
        { id: 'p1' },
        {
          contentQuality: { is_clickbait_probability: 1.98 },
          translation: {
            en: {
              title: 'Title EN',
            },
            de: {
              title: 'Title DE',
            },
          },
        },
      );

      const res = await client.query(QUERY, {
        headers: {
          'content-language': 'de',
        },
      });
      expect(res.errors).toBeFalsy();
      expect(res.data.post).toEqual({
        title: 'Title DE',
      });
    });

    it('should return original title when smart title and i18n title does not exist', async () => {
      loggedUser = '1';
      isPlus = true;
      await con.getRepository(Settings).update(
        { userId: '1' },
        {
          flags: {
            clickbaitShieldEnabled: true,
          },
        },
      );
      await con.getRepository(Post).update(
        { id: 'p1' },
        {
          contentQuality: { is_clickbait_probability: 1.98 },
          contentMeta: {},
        },
      );

      const res = await client.query(QUERY, {
        headers: {
          'content-language': 'de',
        },
      });
      expect(res.errors).toBeFalsy();
      expect(res.data.post).toEqual({
        title: 'P1',
      });
    });

    it('should return smart title translation', async () => {
      loggedUser = '1';
      isPlus = true;
      await con.getRepository(Settings).update(
        { userId: '1' },
        {
          flags: {
            clickbaitShieldEnabled: true,
          },
        },
      );
      await con.getRepository(Post).update(
        { id: 'p1' },
        {
          contentQuality: { is_clickbait_probability: 1.98 },
          contentMeta: {
            alt_title: {
              translations: { en: 'Clickbait title', de: 'Clickbait title DE' },
            },
          },
          translation: {
            en: {
              smartTitle: 'Smart Title EN',
            },
            de: {
              smartTitle: 'Smart Title DE',
            },
          },
        },
      );

      const res = await client.query(QUERY, {
        headers: {
          'content-language': 'de',
        },
      });
      expect(res.errors).toBeFalsy();
      expect(res.data.post).toEqual({
        title: 'Smart Title DE',
      });
    });

    it('should return english smart title translation when smart title translation does not exist', async () => {
      loggedUser = '1';
      isPlus = true;
      await con.getRepository(Settings).update(
        { userId: '1' },
        {
          flags: {
            clickbaitShieldEnabled: true,
          },
        },
      );
      await con.getRepository(Post).update(
        { id: 'p1' },
        {
          contentQuality: { is_clickbait_probability: 1.98 },
          contentMeta: {
            alt_title: {
              translations: { en: 'Clickbait title EN' },
            },
          },
          translation: {
            en: {
              smartTitle: 'Smart Title EN',
            },
          },
        },
      );

      const res = await client.query(QUERY, {
        headers: {
          'content-language': 'de',
        },
      });
      expect(res.errors).toBeFalsy();
      expect(res.data.post).toEqual({
        title: 'Smart Title EN',
      });
    });
  });
});

describe('posts titleHtml field', () => {
  const QUERY = /* GraphQL */ `
    query Post($id: ID!) {
      post(id: $id) {
        titleHtml
      }
    }
  `;

  beforeEach(async () => {
    await saveFixtures(con, SharePost, [
      {
        id: 'sp1',
        shortId: 'ssp1',
        title: 'sp1',
        titleHtml: '<p>sp1</p>',
        score: 1,
        sourceId: 'a',
        tagsStr: 'javascript,webdev',
        type: PostType.Share,
        sharedPostId: 'p1',
        contentCuration: ['c1', 'c2'],
        authorId: usersFixture[0].id,
      },
    ]);
  });

  it('should return titleHtml', async () => {
    loggedUser = '1';

    const res = await client.query(QUERY, {
      variables: {
        id: 'sp1',
      },
    });

    expect(res.errors).toBeFalsy();

    expect(res.data.post).toEqual({
      titleHtml: '<p>sp1</p>',
    });
  });

  it('should return original titleHtml when not logged in', async () => {
    await con.getRepository(SharePost).update(
      { id: 'sp1' },
      {
        translation: {
          de: {
            titleHtml: '<p>sp1 DE</p>',
          },
        },
      },
    );

    const res = await client.query(QUERY, {
      variables: {
        id: 'sp1',
      },
      headers: {
        'content-language': 'de',
      },
    });

    expect(res.errors).toBeFalsy();

    expect(res.data.post).toEqual({
      titleHtml: '<p>sp1</p>',
    });
  });

  it('should return translated titleHtml when it exists', async () => {
    loggedUser = '1';

    await con.getRepository(SharePost).update(
      { id: 'sp1' },
      {
        translation: {
          de: {
            titleHtml: '<p>sp1 DE</p>',
          },
        },
      },
    );

    const res = await client.query(QUERY, {
      variables: {
        id: 'sp1',
      },
      headers: {
        'content-language': 'de',
      },
    });

    expect(res.errors).toBeFalsy();

    expect(res.data.post).toEqual({
      titleHtml: '<p>sp1 DE</p>',
    });
  });

  it('should fallback to original titleHtml when translation does not exist', async () => {
    loggedUser = '1';

    const res = await client.query(QUERY, {
      variables: {
        id: 'sp1',
      },
      headers: {
        'content-language': 'de',
      },
    });

    expect(res.errors).toBeFalsy();

    expect(res.data.post).toEqual({
      titleHtml: '<p>sp1</p>',
    });
  });
});

describe('query postCodeSnippets', () => {
  const QUERY = `
  query PostCodeSnippets($id: ID!, $after: String, $first: Int) {
    postCodeSnippets(id: $id, after: $after, first: $first) {
      edges {
        node {
          content
        }
      }
    }
  }
  `;

  beforeEach(async () => {
    await con.getRepository(PostCodeSnippet).save(
      createPostCodeSnippetsFixture({
        postId: 'p1',
      }),
    );
    await con.getRepository(PostCodeSnippet).save(
      createPostCodeSnippetsFixture({
        postId: 'p2',
      }),
    );
  });

  it('should throw error when user cannot access the post', async () => {
    loggedUser = '1';
    await con.getRepository(Source).update({ id: 'a' }, { private: true });
    return testQueryErrorCode(
      client,
      {
        query: QUERY,
        variables: { id: 'p1' },
      },
      'FORBIDDEN',
    );
  });

  it('should return code snippets', async () => {
    loggedUser = '1';

    const res = await client.query(QUERY, {
      variables: { id: 'p1' },
    });

    expect(res.errors).toBeFalsy();
    expect(res.data).toMatchObject({
      postCodeSnippets: {
        edges: [
          {
            node: {
              content: 'console.log("Hello World")',
            },
          },
          {
            node: {
              content: 'const a = 1;\n\nconsole.log(a)',
            },
          },
          {
            node: {
              content: 'while (true) {\n    /* remove this */\n}',
            },
          },
        ],
      },
    });
  });
});

describe('Source post moderation approve/reject', () => {
  const [pendingId, pendingId2, rejectedId] = Array.from({ length: 2 }, () =>
    generateUUID(),
  );
  beforeEach(async () => {
    await saveSquadFixtures();
    await con.getRepository(SourcePostModeration).save([
      {
        id: pendingId,
        sourceId: 'm',
        createdById: '4',
        title: 'Title',
        content: 'Content',
        status: SourcePostModerationStatus.Pending,
        type: PostType.Article,
      },
      {
        id: pendingId2,
        sourceId: 'm2',
        createdById: '4',
        title: 'Title',
        content: 'Content',
        status: SourcePostModerationStatus.Pending,
        type: PostType.Article,
      },
      {
        id: rejectedId,
        sourceId: 'm',
        createdById: '4',
        title: 'Title',
        content: 'Content',
        status: SourcePostModerationStatus.Rejected,
        rejectionReason: PostModerationReason.Spam,
        moderatorMessage: 'This is spam',
        type: PostType.Article,
        moderatedById: '3',
      },
    ]);
  });

  const MUTATION = `
  mutation ModerateSourcePost(
    $postIds: [ID]!,
    $status: String,
    $sourceId: ID,
    $rejectionReason: String,
    $moderatorMessage: String
  ) {
    moderateSourcePosts(postIds: $postIds, status: $status, sourceId: $sourceId, rejectionReason: $rejectionReason, moderatorMessage: $moderatorMessage) {
      id
      status
    }
  }`;

  it('should block guest', async () => {
    loggedUser = '0';
    await testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: {
          postIds: [pendingId],
          status: SourcePostModerationStatus.Approved,
        },
      },
      'FORBIDDEN',
    );
  });

  it('should not authorize when not source member', async () => {
    loggedUser = '1'; // Not a member
    await testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: {
          postIds: [pendingId],
          status: SourcePostModerationStatus.Approved,
        },
      },
      'FORBIDDEN',
    );
  });

  it('should not authorize when not source moderator', async () => {
    loggedUser = '4'; // Member level
    await testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: {
          postIds: [pendingId],
          status: SourcePostModerationStatus.Approved,
        },
      },
      'FORBIDDEN',
    );
  });

  it('should approve pending posts', async () => {
    loggedUser = '3'; // Moderator level

    const res: GQLResponse<{
      moderateSourcePosts: { id: string }[];
    }> = await client.mutate(MUTATION, {
      variables: {
        postIds: [pendingId],
        status: SourcePostModerationStatus.Approved,
      },
    });

    expect(res.data.moderateSourcePosts.length).toEqual(1);

    const post = await con.getRepository(SourcePostModeration).findOneByOrFail({
      id: pendingId,
    });

    expect(post.status).toEqual(SourcePostModerationStatus.Approved);
    expect(post.moderatedById).toEqual('3');
  });

  it('should not approve posts in sources where user is not moderator', async () => {
    loggedUser = '2'; // Not moderator of "m" squad, which "pendingId" post belongs to.

    await testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: {
          postIds: [pendingId],
          status: SourcePostModerationStatus.Approved,
        },
      },
      'FORBIDDEN',
    );
  });

  it('should throw error when one or more posts in postIds is from a source where user is not moderator', async () => {
    loggedUser = '2'; // Not moderator of "m" squad, which "pendingId" post belongs to.

    await testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: {
          postIds: [pendingId, pendingId2],
          status: SourcePostModerationStatus.Approved,
        },
      },
      'FORBIDDEN',
    );
  });

  it('should reject pending posts', async () => {
    loggedUser = '3'; // Moderator level

    const res: GQLResponse<{
      moderateSourcePosts: { id: string }[];
    }> = await client.mutate(MUTATION, {
      variables: {
        postIds: [pendingId],
        status: SourcePostModerationStatus.Rejected,
        rejectionReason: 'Spam',
        moderatorMessage: 'This is spam',
      },
    });

    expect(res.data.moderateSourcePosts.length).toEqual(1);

    const post = await con.getRepository(SourcePostModeration).findOneByOrFail({
      id: pendingId,
    });

    expect(post.status).toEqual(SourcePostModerationStatus.Rejected);
    expect(post.moderatedById).toEqual('3');
    expect(post.rejectionReason).toEqual('Spam');
    expect(post.moderatorMessage).toEqual('This is spam');
  });

  it('should not reject pending posts without reason', async () => {
    loggedUser = '3'; // Moderator level

    await testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: {
          postIds: [pendingId],
          status: SourcePostModerationStatus.Rejected,
          moderatorMessage: 'This is spam',
        },
      },
      'GRAPHQL_VALIDATION_FAILED',
    );
  });

  it('should not reject pending posts when reason is `other` and message is empty', async () => {
    loggedUser = '3'; // Moderator level

    await testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: {
          postIds: [pendingId],
          status: SourcePostModerationStatus.Rejected,
          rejectionReason: 'Other',
        },
      },
      'GRAPHQL_VALIDATION_FAILED',
    );
  });

  it('should not update already moderated posts', async () => {
    loggedUser = '3'; // Moderator level

    const res: GQLResponse<{
      moderateSourcePosts: { id: string; status: SourcePostModerationStatus }[];
    }> = await client.mutate(MUTATION, {
      variables: {
        postIds: [pendingId, rejectedId],
        status: SourcePostModerationStatus.Approved,
      },
    });

    // only one post should be updated, one is already rejected
    expect(res.data.moderateSourcePosts.length).toEqual(1);
    expect(res.data.moderateSourcePosts[0].status).toEqual(
      SourcePostModerationStatus.Approved,
    );
  });
});

describe('Source post moderation edit/delete', () => {
  const [pendingId, rejectedId] = Array.from({ length: 2 }, () =>
    generateUUID(),
  );

  beforeEach(async () => {
    await saveSquadFixtures();
    await con.getRepository(SourceMember).save([
      {
        sourceId: 'm',
        userId: '4',
        role: SourceMemberRoles.Member,
        referralToken: 'r4',
      },
    ]);
    await con.getRepository(SourcePostModeration).save([
      {
        id: pendingId,
        sourceId: 'm',
        createdById: '4',
        title: 'Title',
        content: 'Content',
        status: SourcePostModerationStatus.Pending,
        type: PostType.Share,
      },
      {
        id: rejectedId,
        sourceId: 'm',
        createdById: '4',
        title: 'Title',
        content: 'Content',
        status: SourcePostModerationStatus.Rejected,
        rejectionReason: PostModerationReason.Spam,
        moderatorMessage: 'This is spam',
        type: PostType.Share,
        moderatedById: '3',
      },
    ]);
  });

  const DELETE_MUTATION = `
  mutation DeleteSourcePostModeration($postId: ID!) {
    deleteSourcePostModeration(postId: $postId){
      _
    }
  }`;

  const EDIT_MUTATION = `
  mutation EditSourcePostModeration($id: ID!, $sourceId: ID!, $title: String, $content: String, $type: String!) {
    editSourcePostModeration(id: $id, sourceId: $sourceId, title: $title, content: $content, type: $type) {
      id
      title
      content
      status
    }
  }`;

  describe('deleteSourcePostModeration', () => {
    it('should block guest', async () => {
      loggedUser = '0';

      await testMutationErrorCode(
        client,
        {
          mutation: DELETE_MUTATION,
          variables: { postId: pendingId },
        },
        'FORBIDDEN',
      );
    });

    it('should not authorize when not source member', async () => {
      loggedUser = '1'; // Not a member
      await testMutationErrorCode(
        client,
        {
          mutation: DELETE_MUTATION,
          variables: { postId: pendingId },
        },
        'FORBIDDEN',
      );
    });

    it('should not authorize when not author nor moderator', async () => {
      loggedUser = '5'; // Member level
      await testMutationErrorCode(
        client,
        {
          mutation: DELETE_MUTATION,
          variables: { postId: pendingId },
        },
        'FORBIDDEN',
      );
    });

    it('should delete pending post', async () => {
      loggedUser = '4'; // Member level

      const res = await client.mutate(DELETE_MUTATION, {
        variables: { postId: pendingId },
      });

      expect(res.errors).toBeFalsy();
      const post = await con.getRepository(SourcePostModeration).findOneBy({
        id: pendingId,
      });
      expect(post).toBeNull();
    });
  });

  describe('editSourcePostModeration', () => {
    it('should block guest', async () => {
      loggedUser = '0';
      await testMutationErrorCode(
        client,
        {
          mutation: EDIT_MUTATION,
          variables: {
            id: pendingId,
            title: 'New Title',
            type: PostType.Freeform,
            sourceId: 'm',
          },
        },
        'FORBIDDEN',
      );
    });

    it('should not authorize when not source member', async () => {
      loggedUser = '1'; // Not a member
      await testMutationErrorCode(
        client,
        {
          mutation: EDIT_MUTATION,
          variables: {
            id: pendingId,
            title: 'New Title',
            type: PostType.Freeform,
            sourceId: 'm',
          },
        },
        'FORBIDDEN',
      );
    });

    it('should not authorize when not author', async () => {
      loggedUser = '3'; // Moderator level
      await testMutationErrorCode(
        client,
        {
          mutation: EDIT_MUTATION,
          variables: {
            id: pendingId,
            title: 'New Title',
            type: PostType.Freeform,
            sourceId: 'm',
          },
        },
        'FORBIDDEN',
      );
    });

    it('should edit pending post', async () => {
      loggedUser = '4'; // Member level

      const res = await client.mutate(EDIT_MUTATION, {
        variables: {
          id: pendingId,
          title: 'New Title',
          content: 'New Content',
          type: PostType.Freeform,
          sourceId: 'm',
        },
      });

      expect(res.errors).toBeFalsy();

      const post = res.data.editSourcePostModeration;
      expect(post.title).toEqual('New Title');
      expect(post.content).toEqual('New Content');
    });

    it('should edit rejected post and set as pending', async () => {
      loggedUser = '4'; // Member level

      const res: GQLResponse<{
        editSourcePostModeration: SourcePostModeration;
      }> = await client.mutate(EDIT_MUTATION, {
        variables: {
          id: rejectedId,
          title: 'New Title',
          content: 'New Content',
          type: PostType.Freeform,
          sourceId: 'm',
        },
      });

      expect(res.errors).toBeFalsy();
      const post = res.data.editSourcePostModeration;
      expect(post.title).toEqual('New Title');
      expect(post.content).toEqual('New Content');
      expect(post.status).toEqual(SourcePostModerationStatus.Pending);
    });
  });
});

describe('query fetchSmartTitle', () => {
  const QUERY = /* GraphQL */ `
    query FetchSmartTitle($id: ID!) {
      fetchSmartTitle(id: $id) {
        title
        translation {
          title
          smartTitle
        }
      }
    }
  `;

  beforeEach(async () => {
    await con.getRepository(Post).update(
      { id: 'p1' },
      {
        contentMeta: {
          alt_title: {
            translations: {
              en: 'Alt Title',
              de: 'Alt Title DE',
            },
          },
        },
        translation: {
          de: {
            title: 'Title DE',
          },
        },
      },
    );
    await con
      .getRepository(User)
      .update(
        { id: '1' },
        { subscriptionFlags: { cycle: SubscriptionCycles.Yearly } },
      );
  });

  it('should throw error when user is not logged in', async () =>
    testQueryErrorCode(
      client,
      { query: QUERY, variables: { id: 'p1' } },
      'UNAUTHENTICATED',
    ));

  it('should return the original title when clickbait shield is enabled', async () => {
    loggedUser = '1';
    isPlus = true;

    const res = await client.query<
      { fetchSmartTitle: GQLPostSmartTitle },
      { id: string }
    >(QUERY, {
      variables: { id: 'p1' },
    });

    expect(res.errors).toBeFalsy();
    expect(res.data.fetchSmartTitle.title).toEqual('P1');
  });

  it('should return the original title when clickbait shield is enabled and language is set', async () => {
    loggedUser = '1';
    isPlus = true;
    const res = await client.query<
      { fetchSmartTitle: GQLPostSmartTitle },
      { id: string }
    >(QUERY, {
      variables: { id: 'p1' },
      headers: { 'content-language': 'de' },
    });

    expect(res.errors).toBeFalsy();
    expect(res.data.fetchSmartTitle.title).toEqual('Title DE');
  });

  it('should return the smart title when clickbait shield is disabled', async () => {
    loggedUser = '1';
    isPlus = true;

    await con
      .getRepository(Settings)
      .save({ userId: loggedUser, flags: { clickbaitShieldEnabled: false } });

    const res = await client.query<
      { fetchSmartTitle: GQLPostSmartTitle },
      { id: string }
    >(QUERY, {
      variables: { id: 'p1' },
    });

    expect(res.errors).toBeFalsy();
    expect(res.data.fetchSmartTitle.title).toEqual('Alt Title');
  });

  it('should return the smart title muliple times when clickbait shield is disabled', async () => {
    loggedUser = '1';
    isPlus = true;

    await con
      .getRepository(Settings)
      .save({ userId: loggedUser, flags: { clickbaitShieldEnabled: false } });

    const res = await client.query<
      { fetchSmartTitle: GQLPostSmartTitle },
      { id: string }
    >(QUERY, {
      variables: { id: 'p1' },
    });

    expect(res.errors).toBeFalsy();
    expect(res.data.fetchSmartTitle.title).toEqual('Alt Title');

    const res2 = await client.query<
      { fetchSmartTitle: GQLPostSmartTitle },
      { id: string }
    >(QUERY, {
      variables: { id: 'p1' },
    });

    expect(res2.errors).toBeFalsy();
    expect(res2.data.fetchSmartTitle.title).toEqual('Alt Title');
  });

  it('should return the smart title when clickbait shield is disabled and language is set', async () => {
    loggedUser = '1';
    isPlus = true;

    await con
      .getRepository(Settings)
      .save({ userId: loggedUser, flags: { clickbaitShieldEnabled: false } });

    const res = await client.query<
      { fetchSmartTitle: GQLPostSmartTitle },
      { id: string }
    >(QUERY, {
      variables: { id: 'p1' },
      headers: { 'content-language': 'de' },
    });

    expect(res.errors).toBeFalsy();
    expect(res.data.fetchSmartTitle.title).toEqual('Alt Title DE');
  });

  it('should return smart title translation when clickbait shield is enabled and language is set', async () => {
    loggedUser = '1';
    isPlus = true;

    await con.getRepository(Post).update(
      { id: 'p1' },
      {
        contentMeta: {
          alt_title: {
            translations: {
              en: 'Alt Title',
              de: 'Alt Title DE',
            },
          },
        },
        translation: {
          de: {
            title: 'Title DE',
            smartTitle: 'Smart Title DE',
          },
        },
      },
    );

    await con
      .getRepository(Settings)
      .save({ userId: loggedUser, flags: { clickbaitShieldEnabled: false } });

    const res = await client.query<
      { fetchSmartTitle: GQLPostSmartTitle },
      { id: string }
    >(QUERY, {
      variables: { id: 'p1' },
      headers: { 'content-language': 'de' },
    });

    expect(res.errors).toBeFalsy();
    expect(res.data.fetchSmartTitle.title).toEqual('Smart Title DE');
  });

  it('should return the original title translation when clickbait shield is enabled and language is set', async () => {
    loggedUser = '1';
    isPlus = true;

    await con.getRepository(Post).update(
      { id: 'p1' },
      {
        contentMeta: {
          alt_title: {
            translations: {
              en: 'Alt Title',
              de: 'Alt Title DE',
            },
          },
        },
        translation: {
          de: {
            title: 'Title DE',
            smartTitle: 'Smart Title DE',
          },
        },
      },
    );

    const res = await client.query<
      { fetchSmartTitle: GQLPostSmartTitle },
      { id: string }
    >(QUERY, {
      variables: { id: 'p1' },
      headers: { 'content-language': 'de' },
    });

    expect(res.errors).toBeFalsy();
    expect(res.data.fetchSmartTitle.title).toEqual('Title DE');
  });

  describe('free user', () => {
    it('should be able to get the smart title for trial', async () => {
      loggedUser = '2';
      const res = await client.query<
        { fetchSmartTitle: GQLPostSmartTitle },
        { id: string }
      >(QUERY, {
        variables: { id: 'p1' },
      });

      expect(res.errors).toBeFalsy();
      expect(res.data.fetchSmartTitle.title).toEqual('Alt Title');
    });

    it('should return translate field', async () => {
      loggedUser = '1';
      isPlus = true;
      const res = await client.query<
        { fetchSmartTitle: GQLPostSmartTitle },
        { id: string }
      >(QUERY, {
        variables: { id: 'p1' },
        headers: { 'content-language': 'de' },
      });

      expect(res.errors).toBeFalsy();
      expect(res.data.fetchSmartTitle.title).toEqual('Title DE');
      expect(res.data.fetchSmartTitle.translation).toEqual({
        title: true,
        smartTitle: false,
      });
    });
  });

  const keyPrefix = 'clickbait-shield';
  const getShieldKey = (userId: string) => `${keyPrefix}:${userId}`;

  it('should block after 5 fetchSmartTitle queries for non-Plus user', async () => {
    loggedUser = '1';
    isPlus = false;
    await deleteRedisKey(getShieldKey(loggedUser));
    for (let i = 0; i < 5; i++) {
      const res = await client.query<
        { fetchSmartTitle: GQLPostSmartTitle },
        { id: string }
      >(QUERY, {
        variables: { id: 'p1' },
      });
      expect(res.errors).toBeFalsy();
      expect(res.data.fetchSmartTitle).toBeDefined();
    }
    // 6th call should be blocked
    const res = await client.query<
      { fetchSmartTitle: GQLPostSmartTitle },
      { id: string }
    >(QUERY, {
      variables: { id: 'p1' },
    });
    expect(res.errors).toBeDefined();
    expect(res.errors?.[0].message).toMatch(/You have reached your limit/);
    await deleteRedisKey(getShieldKey(loggedUser));
  });

  it('should never block fetchSmartTitle for Plus user', async () => {
    loggedUser = '1';
    isPlus = true;
    await deleteRedisKey(getShieldKey(loggedUser));
    for (let i = 0; i < 10; i++) {
      const res = await client.query<
        { fetchSmartTitle: GQLPostSmartTitle },
        { id: string }
      >(QUERY, {
        variables: { id: 'p1' },
      });
      expect(res.errors).toBeFalsy();
      expect(res.data.fetchSmartTitle).toBeDefined();
    }
    await deleteRedisKey(getShieldKey(loggedUser));
  });
});

describe('field language', () => {
  const QUERY = /* GraphQL */ `
    query Post($id: ID!) {
      post(id: $id) {
        language
      }
    }
  `;

  beforeEach(async () => {
    await saveFixtures(con, ArticlePost, [
      {
        id: 'lp1',
        shortId: 'slp1',
        title: 'LP1',
        url: 'http://lp1.com',
        canonicalUrl: 'http://lp1c.com',
        image: 'https://daily.dev/image.jpg',
        score: 1,
        sourceId: 'a',
        tagsStr: 'javascript,webdev',
        type: PostType.Article,
        contentCuration: ['c1', 'c2'],
        language: 'en',
      },
      {
        id: 'lp2',
        shortId: 'slp2',
        title: 'LP2',
        url: 'http://lp2.com',
        canonicalUrl: 'http://lp2c.com',
        image: 'https://daily.dev/image.jpg',
        score: 1,
        sourceId: 'a',
        tagsStr: 'javascript,webdev',
        type: PostType.Article,
        contentCuration: ['c1', 'c2'],
        language: 'de',
      },
      {
        id: 'lp3',
        shortId: 'slp3',
        title: 'LP3',
        url: 'http://lp3.com',
        canonicalUrl: 'http://lp3c.com',
        image: 'https://daily.dev/image.jpg',
        score: 1,
        sourceId: 'a',
        tagsStr: 'javascript,webdev',
        type: PostType.Article,
        contentCuration: ['c1', 'c2'],
      },
    ]);
  });

  it('should return the post language', async () => {
    const res = await client.query(QUERY, {
      variables: { id: 'lp1' },
    });
    expect(res.errors).toBeFalsy();
    expect(res.data.post.language).toEqual('en');

    const resDe = await client.query(QUERY, {
      variables: { id: 'lp2' },
    });
    expect(resDe.errors).toBeFalsy();
    expect(resDe.data.post.language).toEqual('de');
  });

  it('should default to en when language is not set', async () => {
    const res = await client.query(QUERY, {
      variables: { id: 'lp3' },
    });
    expect(res.errors).toBeFalsy();
    expect(res.data.post.language).toEqual('en');
  });
});

describe('featuredAward field', () => {
  const QUERY = `
  query Post($id: ID!) {
    post(id: $id) {
      featuredAward {
        award {
          id
          name
          image
          value
        }
      }
    }
  }`;

  beforeEach(async () => {
    await saveFixtures(con, Product, [
      {
        id: '5978781a-0e22-4702-bb32-1c59a13023c4',
        name: 'Award 1',
        image: 'https://daily.dev/award.jpg',
        type: ProductType.Award,
        value: 42,
      },
      {
        id: '03916c91-8030-499e-8d3d-ae0a4c065012',
        name: 'Award 2',
        image: 'https://daily.dev/award.jpg',
        type: ProductType.Award,
        value: 10,
      },
      {
        id: '24d83ece-1f82-4a82-ae48-85e5b003c9af',
        name: 'Award 3',
        image: 'https://daily.dev/award.jpg',
        type: ProductType.Award,
        value: 20,
      },
    ]);
  });

  it('should return featuredAward', async () => {
    const [transaction, transaction2, transaction3] = await con
      .getRepository(UserTransaction)
      .save([
        {
          processor: UserTransactionProcessor.Njord,
          receiverId: '1',
          status: UserTransactionStatus.Success,
          productId: '03916c91-8030-499e-8d3d-ae0a4c065012',
          senderId: '1',
          fee: 0,
          value: 10,
          valueIncFees: 10,
        },
        {
          processor: UserTransactionProcessor.Njord,
          receiverId: '1',
          status: UserTransactionStatus.Success,
          productId: '24d83ece-1f82-4a82-ae48-85e5b003c9af',
          senderId: '3',
          fee: 0,
          value: 20,
          valueIncFees: 20,
        },
        {
          processor: UserTransactionProcessor.Njord,
          receiverId: '1',
          status: UserTransactionStatus.Success,
          productId: '5978781a-0e22-4702-bb32-1c59a13023c4',
          senderId: '2',
          fee: 0,
          value: 42,
          valueIncFees: 42,
        },
      ]);

    await con.getRepository(UserPost).save([
      {
        postId: 'p1',
        userId: transaction.senderId,
        vote: UserVote.None,
        hidden: false,
        flags: {
          awardId: transaction.productId,
        },
        awardTransactionId: transaction.id,
      },
      {
        postId: 'p1',
        userId: transaction2.senderId,
        vote: UserVote.None,
        hidden: false,
        flags: {
          awardId: transaction2.productId,
        },
        awardTransactionId: transaction2.id,
      },
      {
        postId: 'p2',
        userId: transaction3.senderId,
        vote: UserVote.None,
        hidden: false,
        flags: {
          awardId: transaction3.productId,
        },
        awardTransactionId: transaction3.id,
      },
    ]);

    const res = await client.query(QUERY, {
      variables: { id: 'p1' },
    });

    expect(res.errors).toBeFalsy();

    expect(res.data.post.featuredAward).toMatchObject({
      award: {
        id: '24d83ece-1f82-4a82-ae48-85e5b003c9af',
        name: 'Award 3',
        image: 'https://daily.dev/award.jpg',
        value: 20,
      },
    });
  });

  it('should not return featuredAward if no awards', async () => {
    const [transaction] = await con.getRepository(UserTransaction).save([
      {
        processor: UserTransactionProcessor.Njord,
        receiverId: '1',
        status: UserTransactionStatus.Success,
        productId: '03916c91-8030-499e-8d3d-ae0a4c065012',
        senderId: '1',
        fee: 0,
        value: 10,
        valueIncFees: 10,
      },
    ]);

    await con.getRepository(UserPost).save([
      {
        postId: 'p1',
        userId: transaction.senderId,
        vote: UserVote.None,
        hidden: false,
        flags: {
          awardId: transaction.productId,
        },
        awardTransactionId: transaction.id,
      },
    ]);

    const res = await client.query(QUERY, {
      variables: { id: 'p2' },
    });

    expect(res.errors).toBeFalsy();

    expect(res.data.post.featuredAward).toBeNull();
  });
});

describe('query post awards', () => {
  const QUERY = `
  query PostAwards($id: ID!) {
    awards: postAwards(id: $id) {
      edges {
        node {
          user {
            id
            name
          }
          award {
            name
            value
          }
          awardTransaction {
            value
          }
        }
      }
    }
    awardsTotal: postAwardsTotal(id: $id) {
      amount
    }
  }
  `;

  beforeEach(async () => {
    await saveFixtures(
      con,
      User,
      usersFixture.map((item) => {
        return {
          ...item,
          id: `${item.id}-paq`,
          username: `${item.username}-paq`,
        };
      }),
    );

    await saveFixtures(con, Source, [
      {
        id: 'a-paq',
        name: 'A-PAQ',
        image: 'http://image.com/a/paq',
        handle: 'a-paq',
        type: SourceType.Machine,
      },
      {
        id: 'b-paq',
        name: 'B-PAQ',
        image: 'http://image.com/b/paq',
        handle: 'b-paq',
        type: SourceType.Machine,
        private: true,
      },
    ]);

    await saveFixtures(con, ArticlePost, [
      {
        id: 'p1-paq',
        shortId: 'sp1-paq',
        title: 'P1-PAQ',
        url: 'http://p1.com/paq',
        canonicalUrl: 'http://p1c.com/paq',
        image: 'https://daily.dev/image-paq.jpg',
        score: 1,
        sourceId: 'a-paq',
        createdAt: new Date(),
        tagsStr: 'javascript,webdev',
        type: PostType.Article,
        contentCuration: ['c1', 'c2'],
        authorId: '1-paq',
      },
      {
        id: 'p2-paq',
        shortId: 'sp2-paq',
        title: 'P2-PAQ',
        url: 'http://p2.com/paq',
        canonicalUrl: 'http://p2c.com/paq',
        image: 'https://daily.dev/image2-paq.jpg',
        score: 1,
        sourceId: 'b-paq',
        createdAt: new Date(),
        tagsStr: 'javascript,webdev',
        type: PostType.Article,
        contentCuration: ['c1', 'c2'],
      },
    ]);

    await saveFixtures(con, Product, [
      {
        id: '987cdf34-7d12-435d-87c1-1bbd4daa4480',
        name: 'Award 1',
        image: 'https://daily.dev/award.jpg',
        type: ProductType.Award,
        value: 42,
      },
      {
        id: '777cfd3d-1359-416b-b52a-e229b230f024',
        name: 'Award 2',
        image: 'https://daily.dev/award.jpg',
        type: ProductType.Award,
        value: 10,
      },
      {
        id: '7097b336-fefa-4d60-bb78-fbc676ae1abf',
        name: 'Award 3',
        image: 'https://daily.dev/award.jpg',
        type: ProductType.Award,
        value: 20,
      },
    ]);
  });

  it('should throw error when user cannot access', async () => {
    loggedUser = '1';

    await testQueryErrorCode(
      client,
      {
        query: QUERY,
        variables: { id: 'p2-paq' },
      },
      'FORBIDDEN',
    );
  });

  it('should return awards', async () => {
    loggedUser = '2-paq';

    const [transaction, transaction2] = await con
      .getRepository(UserTransaction)
      .save([
        {
          processor: UserTransactionProcessor.Njord,
          receiverId: '1-paq',
          status: UserTransactionStatus.Success,
          productId: '777cfd3d-1359-416b-b52a-e229b230f024',
          senderId: '3-paq',
          fee: 0,
          value: 50,
          valueIncFees: 50,
        },
        {
          processor: UserTransactionProcessor.Njord,
          receiverId: '1-paq',
          status: UserTransactionStatus.Success,
          productId: '7097b336-fefa-4d60-bb78-fbc676ae1abf',
          senderId: '4-paq',
          fee: 0,
          value: 20,
          valueIncFees: 20,
        },
      ]);

    await con.getRepository(UserPost).save([
      {
        postId: 'p1-paq',
        userId: transaction.senderId,
        vote: UserVote.None,
        hidden: false,
        flags: {
          awardId: transaction.productId,
        },
        awardTransactionId: transaction.id,
      },
      {
        postId: 'p1-paq',
        userId: transaction2.senderId,
        vote: UserVote.None,
        hidden: false,
        flags: {
          awardId: transaction2.productId,
        },
        awardTransactionId: transaction2.id,
      },
    ]);

    const res = await client.query(QUERY, {
      variables: { id: 'p1-paq' },
    });

    expect(res.errors).toBeFalsy();

    expect(res.data.awardsTotal.amount).toEqual(70);
    expect(res.data.awards.edges).toMatchObject([
      {
        node: {
          user: {
            id: '3-paq',
            name: 'Nimrod',
          },
          award: {
            name: 'Award 2',
            value: 10,
          },
          awardTransaction: {
            value: 50,
          },
        },
      },
      {
        node: {
          user: {
            id: '4-paq',
            name: 'Lee',
          },
          award: {
            name: 'Award 3',
            value: 20,
          },
          awardTransaction: {
            value: 20,
          },
        },
      },
    ]);
  });
});

describe('mutation generateBriefing', () => {
  const MUTATION = `
  mutation GenerateBriefing($type: BriefingType!) {
  generateBriefing(type: $type) {
    postId
  }
}`;

  const variables = {
    type: BriefingType.Daily,
  };

  it('should not authorize when not logged in', async () => {
    await testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables,
      },
      'UNAUTHENTICATED',
    );
  });

  it('should start briefing generation', async () => {
    loggedUser = '1';

    const res = await client.mutate(MUTATION, {
      variables,
    });

    expect(res.errors).toBeFalsy();

    expect(res.data.generateBriefing.postId).toBeDefined();

    expectTypedEvent('api.v1.brief-generate', {
      payload: new UserBriefingRequest({
        userId: loggedUser,
        frequency: variables.type,
        modelName: BriefingModel.Default,
      }),
      postId: res.data.generateBriefing.postId,
    });
  });

  it('should not start briefing generation if already generating', async () => {
    loggedUser = '1';

    const res = await client.mutate(MUTATION, {
      variables,
    });

    expect(res.errors).toBeFalsy();

    expect(triggerTypedEvent).toHaveBeenCalledTimes(1);

    await testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables,
      },
      'CONFLICT',
    );

    expect(triggerTypedEvent).toHaveBeenCalledTimes(1);
  });

  it('should not start briefing generation if generated brief action exists', async () => {
    loggedUser = '1';

    await con.getRepository(UserAction).save({
      userId: loggedUser,
      type: UserActionType.GeneratedBrief,
    });

    await testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables,
      },
      'FORBIDDEN',
    );

    expect(triggerTypedEvent).toHaveBeenCalledTimes(0);
  });

  it('should throw existing post data if briefing is already generating', async () => {
    loggedUser = '1';

    const res = await client.mutate(MUTATION, {
      variables,
    });

    expect(res.errors).toBeFalsy();

    expect(triggerTypedEvent).toHaveBeenCalledTimes(1);

    const resError = await client.mutate(MUTATION, {
      variables,
    });

    expect(resError.errors).toBeTruthy();

    expect(resError.errors?.[0].extensions?.postId).toEqual(
      res.data.generateBriefing.postId,
    );
    expect(resError.errors?.[0].extensions?.createdAt).toEqual(
      expect.any(String),
    );

    expect(triggerTypedEvent).toHaveBeenCalledTimes(1);
  });

  it('should start briefing generation if other user brief is generating', async () => {
    loggedUser = '2';

    const res = await client.mutate(MUTATION, {
      variables,
    });

    expect(res.errors).toBeFalsy();
    expect(triggerTypedEvent).toHaveBeenCalledTimes(1);

    loggedUser = '1';

    const res2 = await client.mutate(MUTATION, {
      variables,
    });

    expect(res2.errors).toBeFalsy();

    expect(res2.errors).toBeFalsy();
    expect(triggerTypedEvent).toHaveBeenCalledTimes(2);
  });
});
