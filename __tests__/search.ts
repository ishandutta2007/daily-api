import {
  disposeGraphQLTesting,
  GraphQLTestClient,
  GraphQLTestingState,
  initializeGraphQLTesting,
  MockContext,
  saveFixtures,
  testMutationErrorCode,
  testQueryErrorCode,
} from './helpers';
import { DataSource } from 'typeorm';
import createOrGetConnection from '../src/db';
import nock from 'nock';
import { magniOrigin, SearchResultFeedback } from '../src/integrations';
import {
  ArticlePost,
  Feed,
  Keyword,
  Source,
  SourceUser,
  User,
  UserPost,
} from '../src/entity';
import { postsFixture } from './fixture/post';
import { sourcesFixture } from './fixture/source';
import { usersFixture } from './fixture/user';
import { ghostUser, updateFlagsStatement } from '../src/common';
import { ContentPreferenceUser } from '../src/entity/contentPreference/ContentPreferenceUser';
import { ContentPreferenceStatus } from '../src/entity/contentPreference/types';
import { ContentPreferenceSource } from '../src/entity/contentPreference/ContentPreferenceSource';

let con: DataSource;
let state: GraphQLTestingState;
let client: GraphQLTestClient;
let loggedUser: string = null;

beforeAll(async () => {
  con = await createOrGetConnection();
  state = await initializeGraphQLTesting(
    () => new MockContext(con, loggedUser),
  );
  client = state.client;
});

afterAll(() => disposeGraphQLTesting(state));

beforeEach(async () => {
  loggedUser = null;
});

describe('searchResultFeedback mutation', () => {
  const chunkId = 'chunk';

  const mockFeedback = (params: SearchResultFeedback) => {
    nock(magniOrigin)
      .post('/feedback')
      .matchHeader('Content-Type', 'application/json')
      .matchHeader('X-User-Id', loggedUser)
      .reply(204, params);
  };

  const MUTATION = `
    mutation SearchResultFeedback($chunkId: String!, $value: Int!) {
      searchResultFeedback(chunkId: $chunkId, value: $value) {
        _
      }
    }
  `;

  it('should not authorize when not logged in', async () =>
    testMutationErrorCode(
      client,
      { mutation: MUTATION, variables: { chunkId, value: 1 } },
      'UNAUTHENTICATED',
    ));

  it('should throw validation error when value is greater than 1', async () => {
    loggedUser = '1';

    return testMutationErrorCode(
      client,
      { mutation: MUTATION, variables: { chunkId, value: 2 } },
      'GRAPHQL_VALIDATION_FAILED',
    );
  });

  it('should throw validation error when value is less than -1', async () => {
    loggedUser = '1';

    return testMutationErrorCode(
      client,
      { mutation: MUTATION, variables: { chunkId, value: -2 } },
      'GRAPHQL_VALIDATION_FAILED',
    );
  });

  it('should throw validation error when chunk id is missing', async () => {
    loggedUser = '1';

    return testMutationErrorCode(
      client,
      { mutation: MUTATION, variables: { value: 2 } },
      'GRAPHQL_VALIDATION_FAILED',
    );
  });

  it('should send feedback to magni if all values are valid', async () => {
    loggedUser = '1';

    mockFeedback({ value: 1, chunkId });

    const res = await client.mutate(MUTATION, {
      variables: { chunkId, value: 1 },
    });

    expect(res.errors).toBeFalsy();
  });
});

describe('searchSessionHistory query', () => {
  const mockResponse = {
    sessions: [
      {
        id: 'unique id',
        prompt: 'the first question',
        createdAt: new Date(2023, 7, 11).toISOString(),
      },
    ],
  };

  const mockHistory = (limit = 30, lastId?: string) => {
    const params = new URLSearchParams({ limit: limit.toString() });

    if (lastId) params.append('lastId', lastId);

    nock(magniOrigin)
      .get(`/sessions?${params.toString()}`)
      .matchHeader('X-User-Id', loggedUser)
      .reply(200, mockResponse);
  };

  const QUERY = `
    query SearchSessionHistory($after: String, $first: Int) {
      searchSessionHistory(after: $after, first: $first) {
        pageInfo {
          endCursor
          hasNextPage
          hasPreviousPage
        }
        edges {
          node {
            id
            prompt
            createdAt
          }
        }
      }
    }
  `;

  it('should not authorize when not logged in', async () =>
    testQueryErrorCode(client, { query: QUERY }, 'UNAUTHENTICATED'));

  it('should get user search history with limit', async () => {
    loggedUser = '1';

    const limit = 20;

    mockHistory(limit);

    const res = await client.query(QUERY, { variables: { first: limit } });

    expect(res.errors).toBeFalsy();
    expect(res.data).toEqual({
      searchSessionHistory: {
        edges: [
          {
            node: {
              createdAt: expect.any(String),
              id: 'unique id',
              prompt: 'the first question',
            },
          },
        ],
        pageInfo: {
          endCursor: 'unique id',
          hasNextPage: false,
          hasPreviousPage: false,
        },
      },
    });
  });

  it('should get user search history with limit and last id', async () => {
    loggedUser = '1';

    const limit = 20;
    const lastId = 'last id';

    mockHistory(limit, lastId);

    const res = await client.query(QUERY, {
      variables: { first: limit, after: lastId },
    });

    expect(res.errors).toBeFalsy();
    expect(res.data.searchSessionHistory).toEqual({
      edges: [
        {
          node: {
            createdAt: expect.any(String),
            id: 'unique id',
            prompt: 'the first question',
          },
        },
      ],
      pageInfo: {
        endCursor: 'unique id',
        hasNextPage: false,
        hasPreviousPage: true,
      },
    });
  });
});

describe('searchSession query', () => {
  const mockResponse = {
    id: 'session id',
    createdAt: new Date(2023, 7, 14).toISOString(),
    chunks: [
      {
        id: 'chunk id',
        prompt: 'user prompt',
        response: 'response as markdown',
        error: {
          code: 'error code (string)',
          message: 'error message',
        },
        createdAt: new Date(2023, 7, 14).toISOString(),
        completedAt: new Date(2023, 7, 14).toISOString(),
        feedback: 1,
        sources: [
          {
            id: 'source id',
            name: 'title returned from the search engine',
            snippet: 'text snippet returned from the search engine',
            url: 'URL to the page itself (external link)',
          },
        ],
      },
    ],
  };

  const mockSession = (id: string) => {
    nock(magniOrigin)
      .get(`/session?id=${id}`)
      .matchHeader('X-User-Id', loggedUser)
      .reply(200, mockResponse);
  };

  const QUERY = `
    query SearchSession($id: String!) {
      searchSession(id: $id) {
        id
        createdAt
        chunks {
          id
          prompt
          response
          error {
            message
            code
          }
          createdAt
          completedAt
          feedback
          sources  {
            id
            name
            snippet
            url
          }
        }
      }
    }
  `;

  it('should not authorize when not logged in', async () =>
    testQueryErrorCode(
      client,
      { query: QUERY, variables: { id: 'session id' } },
      'UNAUTHENTICATED',
    ));

  it('should throw an error when id is missing', async () =>
    testQueryErrorCode(client, { query: QUERY }, 'GRAPHQL_VALIDATION_FAILED'));

  it('should get user search session with id', async () => {
    loggedUser = '1';
    const id = 'session id';

    mockSession(id);

    const res = await client.mutate(QUERY, { variables: { id } });

    expect(res.errors).toBeFalsy();
    expect(res.data.searchSession).toEqual(mockResponse);
  });
});

describe('query searchPostSuggestions', () => {
  const QUERY = (query: string): string => `{
    searchPostSuggestions(query: "${query}") {
      query
      hits {
        title
      }
    }
  }
`;

  const nockMimir = (params: string, res: string) => {
    nock('http://localhost:7600').post(`/v1/search`).reply(204, res);
  };

  beforeEach(async () => {
    await saveFixtures(con, Source, sourcesFixture);
    await saveFixtures(con, ArticlePost, postsFixture);
    nockMimir(
      'q=p1',
      JSON.stringify({
        result: [{ postId: 'p2' }, { postId: 'p1' }],
      }),
    );
  });

  it('should return search suggestions', async () => {
    const res = await client.query(QUERY('p1'));
    expect(res.data).toEqual({
      searchPostSuggestions: {
        query: 'p1',
        hits: [{ title: 'P2' }, { title: 'P1' }],
      },
    });
  });

  it('should not return search suggestions if user has hidden posts', async () => {
    loggedUser = '1';
    await con.getRepository(User).save(usersFixture[0]);
    await con.getRepository(UserPost).save({
      userId: '1',
      postId: 'p1',
      hidden: true,
    });
    const res = await client.query(QUERY('p1'));
    expect(res.data).toEqual({
      searchPostSuggestions: {
        query: 'p1',
        hits: [{ title: 'P2' }],
      },
    });
  });

  it('should not return search suggestions if post has no title', async () => {
    await con.getRepository(ArticlePost).update({ id: 'p1' }, { title: null });
    const res = await client.query(QUERY('p1'));
    expect(res.data).toEqual({
      searchPostSuggestions: {
        query: 'p1',
        hits: [{ title: 'P2' }],
      },
    });
  });

  it('should not return search suggestion if private source', async () => {
    await con.getRepository(Source).update({ id: 'a' }, { private: true });
    const res = await client.query(QUERY('p1'));
    expect(res.data).toEqual({
      searchPostSuggestions: {
        query: 'p1',
        hits: [{ title: 'P2' }],
      },
    });
  });

  it('should return empty search suggestion if no hits found', async () => {
    nock.cleanAll();
    nockMimir(
      'q=p1',
      JSON.stringify({
        result: [],
      }),
    );

    const res = await client.query(QUERY('p1'));
    expect(res.data).toEqual({
      searchPostSuggestions: {
        query: 'p1',
        hits: [],
      },
    });
  });
});

describe('query searchTagSuggestions', () => {
  const QUERY = (query: string): string => `{
    searchTagSuggestions(query: "${query}") {
      query
      hits {
        id
        title
      }
    }
  }
`;

  beforeEach(async () => {
    await con.getRepository(Keyword).save([
      {
        value: 'javascript',
        status: 'allow',
        flags: { title: 'JavaScript' },
        occurrences: 20,
      },
      {
        value: 'java',
        status: 'allow',
        flags: { title: 'Java', occurrences: 50 },
      },
      { value: 'javafilms', status: 'deny', occurrences: 0 },
      { value: 'php', status: 'allow', occurrences: 5 },
      { value: 'go', status: 'allow', occurrences: 10 },
    ]);
  });

  it('should return search suggestions', async () => {
    const res = await client.query(QUERY('java'));
    expect(res.errors).toBeFalsy();
    expect(res.data.searchTagSuggestions).toBeTruthy();

    const result = res.data.searchTagSuggestions;

    expect(result.query).toBe('java');
    expect(result.hits).toHaveLength(2);
    expect(result.hits).toMatchObject([
      { id: 'javascript', title: 'JavaScript' },
      { id: 'java', title: 'Java' },
    ]);
  });

  it('should return keyword value as title if no title', async () => {
    const res = await client.query(QUERY('php'));
    expect(res.errors).toBeFalsy();
    expect(res.data.searchTagSuggestions).toBeTruthy();

    const result = res.data.searchTagSuggestions;

    expect(result.query).toBe('php');
    expect(result.hits).toHaveLength(1);
    expect(result.hits).toMatchObject([{ id: 'php', title: 'php' }]);
  });

  it('should only return allowed keywords', async () => {
    const res = await client.query(QUERY('javafilms'));
    expect(res.errors).toBeFalsy();
    expect(res.data.searchTagSuggestions).toBeTruthy();

    const result = res.data.searchTagSuggestions;

    expect(result.query).toBe('javafilms');
    expect(result.hits).toHaveLength(0);
  });
});

describe('query searchSourceSuggestions', () => {
  const QUERY = (query: string, feedId?: string): string => `{
    searchSourceSuggestions(query: "${query}", feedId: "${feedId}", includeContentPreference: true) {
      query
      hits {
        id
        title
        subtitle
        image
        contentPreference {
          status
        }
      }
    }
  }
`;

  beforeEach(async () => {
    await saveFixtures(con, Source, sourcesFixture);
    await con.getRepository(User).save({ ...usersFixture[0] });
  });

  it('should return search suggestions', async () => {
    await con.getRepository(Source).update({ id: 'a' }, { name: 'Java news' });
    await con.getRepository(Source).update(
      { id: 'b' },
      {
        name: 'JavaScript news',
      },
    );
    const res = await client.query(QUERY('java'));
    expect(res.errors).toBeFalsy();
    expect(res.data.searchSourceSuggestions).toBeTruthy();

    const result = res.data.searchSourceSuggestions;

    expect(result.query).toBe('java');
    expect(result.hits).toHaveLength(2);
    expect(result.hits).toMatchObject([
      {
        id: 'a',
        title: 'Java news',
        subtitle: 'a',
        image: 'http://image.com/a',
      },
      {
        id: 'b',
        title: 'JavaScript news',
        subtitle: 'b',
        image: 'http://image.com/b',
      },
    ]);
  });

  it('should only return non private sources', async () => {
    await con
      .getRepository(Source)
      .update({ id: 'a' }, { name: 'Java news', private: true });
    await con
      .getRepository(Source)
      .update({ id: 'b' }, { name: 'JavaScript news' });
    const res = await client.query(QUERY('java'));
    expect(res.errors).toBeFalsy();
    expect(res.data.searchSourceSuggestions).toBeTruthy();

    const result = res.data.searchSourceSuggestions;

    expect(result.query).toBe('java');
    expect(result.hits).toHaveLength(1);
    expect(result.hits).toMatchObject([
      {
        id: 'b',
        title: 'JavaScript news',
        subtitle: 'b',
        image: 'http://image.com/b',
      },
    ]);
  });
  it('should only return public threshold sources', async () => {
    await con.getRepository(Source).update(
      { id: 'squad' },
      {
        private: false,
        flags: updateFlagsStatement<Source>({ publicThreshold: true }),
      },
    );
    await con.getRepository(Source).update(
      { id: 'm' },
      {
        private: false,
      },
    );
    const res = await client.query(QUERY('squad'));
    expect(res.errors).toBeFalsy();
    expect(res.data.searchSourceSuggestions).toBeTruthy();

    const result = res.data.searchSourceSuggestions;

    expect(result.query).toBe('squad');
    expect(result.hits).toHaveLength(1);
    expect(result.hits).toMatchObject([
      {
        id: 'squad',
        image: 'http//image.com/s',
        subtitle: 'squad',
        title: 'Squad',
      },
    ]);
  });

  it('should return following status', async () => {
    loggedUser = '1';
    await con.getRepository(Source).update(
      { id: 'squad' },
      {
        private: false,
        flags: updateFlagsStatement<Source>({ publicThreshold: true }),
      },
    );
    await con.getRepository(Feed).save({
      id: '1',
      userId: '1',
    });
    await con.getRepository(ContentPreferenceSource).save({
      userId: '1',
      referenceId: 'squad',
      sourceId: 'squad',
      feedId: '1',
      status: ContentPreferenceStatus.Subscribed,
    });
    const res = await client.query(QUERY('squad', '1'));
    expect(res.data.searchSourceSuggestions).toBeTruthy();

    const result = res.data.searchSourceSuggestions;

    expect(result.query).toBe('squad');
    expect(result.hits).toHaveLength(1);
    expect(result.hits).toMatchObject([
      {
        id: 'squad',
        image: 'http//image.com/s',
        subtitle: 'squad',
        title: 'Squad',
        contentPreference: { status: 'subscribed' },
      },
    ]);
  });

  it('should return following status for custom feed', async () => {
    loggedUser = '1';
    await con.getRepository(Source).update(
      { id: 'squad' },
      {
        private: false,
        flags: updateFlagsStatement<Source>({ publicThreshold: true }),
      },
    );
    await con.getRepository(Feed).save({
      id: '2',
      userId: '1',
    });
    await con.getRepository(ContentPreferenceSource).save({
      userId: '1',
      referenceId: 'squad',
      sourceId: 'squad',
      feedId: '2',
      status: ContentPreferenceStatus.Subscribed,
    });
    const res = await client.query(QUERY('squad', '2'));
    expect(res.data.searchSourceSuggestions).toBeTruthy();

    const result = res.data.searchSourceSuggestions;

    expect(result.query).toBe('squad');
    expect(result.hits).toHaveLength(1);
    expect(result.hits).toMatchObject([
      {
        id: 'squad',
        image: 'http//image.com/s',
        subtitle: 'squad',
        title: 'Squad',
        contentPreference: { status: 'subscribed' },
      },
    ]);
  });

  it('should not return following status if not your feed', async () => {
    loggedUser = '1';
    await con.getRepository(User).save({ ...usersFixture[1] });
    await con.getRepository(Source).update(
      { id: 'squad' },
      {
        private: false,
        flags: updateFlagsStatement<Source>({ publicThreshold: true }),
      },
    );
    await con.getRepository(Feed).save({
      id: '2',
      userId: '2',
    });
    await con.getRepository(ContentPreferenceSource).save({
      userId: '2',
      referenceId: 'squad',
      sourceId: 'squad',
      feedId: '2',
      status: ContentPreferenceStatus.Subscribed,
    });
    const res = await client.query(QUERY('squad', '2'));
    expect(res.data.searchSourceSuggestions).toBeTruthy();

    const result = res.data.searchSourceSuggestions;

    expect(result.query).toBe('squad');
    expect(result.hits).toHaveLength(1);
    expect(result.hits).toMatchObject([
      {
        id: 'squad',
        image: 'http//image.com/s',
        subtitle: 'squad',
        title: 'Squad',
        contentPreference: null,
      },
    ]);
  });

  it('should not return user source', async () => {
    loggedUser = '1';
    await con.getRepository(User).save({ ...usersFixture[1] });
    await con.getRepository(SourceUser).save({
      id: loggedUser,
      name: 'user-source',
      handle: 'user-source',
      userId: loggedUser,
    });
    const res = await client.query(QUERY('user-source', '2'));

    expect(res.data.searchSourceSuggestions).toBeTruthy();
    expect(res.data.searchSourceSuggestions.query).toBe('user-source');
    expect(res.data.searchSourceSuggestions.hits).toHaveLength(0);
  });
});

describe('query searchUserSuggestions', () => {
  const QUERY = (query: string, feedId?: string): string => `{
    searchUserSuggestions(query: "${query}", feedId: "${feedId}", includeContentPreference: true) {
      query
      hits {
        id
        title
        subtitle
        image
        contentPreference {
          status
        }
      }
    }
  }
`;

  beforeEach(async () => {
    await saveFixtures(con, User, usersFixture);
  });

  it('should not return search suggestions if query length < 3', async () => {
    const res = await client.query(QUERY('i'));
    expect(res.errors).toBeFalsy();
    expect(res.data.searchUserSuggestions).toBeTruthy();

    const result = res.data.searchUserSuggestions;

    expect(result.query).toBe('i');
    expect(result.hits).toHaveLength(0);
    expect(result.hits).toMatchObject([]);
  });

  it('should return search suggestions', async () => {
    const res = await client.query(QUERY('ido'));
    expect(res.errors).toBeFalsy();
    expect(res.data.searchUserSuggestions).toBeTruthy();

    const result = res.data.searchUserSuggestions;

    expect(result.query).toBe('ido');
    expect(result.hits).toHaveLength(1);
    expect(result.hits).toMatchObject([
      {
        id: '1',
        image: 'https://daily.dev/ido.jpg',
        subtitle: 'idoshamun',
        title: 'Ido',
      },
    ]);
  });

  it('should order by reputation', async () => {
    await con
      .getRepository(User)
      .update({ id: '2' }, { name: 'Ido test 2', reputation: 100 });
    const res = await client.query(QUERY('ido'));
    expect(res.data.searchUserSuggestions).toBeTruthy();

    const result = res.data.searchUserSuggestions;

    expect(result.query).toBe('ido');
    expect(result.hits).toHaveLength(2);
    expect(result.hits).toMatchObject([
      {
        id: '2',
        image: 'https://daily.dev/tsahi.jpg',
        subtitle: 'tsahidaily',
        title: 'Ido test 2',
      },
      {
        id: '1',
        image: 'https://daily.dev/ido.jpg',
        subtitle: 'idoshamun',
        title: 'Ido',
      },
    ]);
  });

  it('should only return 3', async () => {
    await con
      .getRepository(User)
      .update({ id: '2' }, { name: 'Ido test 2', reputation: 100 });
    await con
      .getRepository(User)
      .update({ id: '3' }, { name: 'Ido test 3', reputation: 99 });
    await con
      .getRepository(User)
      .update({ id: '4' }, { name: 'Ido test 4', reputation: 98 });
    const res = await client.query(QUERY('ido'));
    expect(res.data.searchUserSuggestions).toBeTruthy();

    const result = res.data.searchUserSuggestions;

    expect(result.query).toBe('ido');
    expect(result.hits).toHaveLength(3);
    expect(result.hits).toMatchObject([
      {
        id: '2',
        image: 'https://daily.dev/tsahi.jpg',
        subtitle: 'tsahidaily',
        title: 'Ido test 2',
      },
      {
        id: '3',
        image: 'https://daily.dev/nimrod.jpg',
        subtitle: 'nimroddaily',
        title: 'Ido test 3',
      },
      {
        id: '4',
        image: 'https://daily.dev/lee.jpg',
        subtitle: 'lee',
        title: 'Ido test 4',
      },
    ]);
  });

  it('should only return infoConfirmed users', async () => {
    await con.getRepository(User).update({ id: '1' }, { infoConfirmed: false });
    await con.getRepository(User).update({ id: '2' }, { name: 'Ido test 2' });
    const res = await client.query(QUERY('ido'));
    expect(res.data.searchUserSuggestions).toBeTruthy();

    const result = res.data.searchUserSuggestions;

    expect(result.query).toBe('ido');
    expect(result.hits).toHaveLength(1);
    expect(result.hits).toMatchObject([
      {
        id: '2',
        image: 'https://daily.dev/tsahi.jpg',
        subtitle: 'tsahidaily',
        title: 'Ido test 2',
      },
    ]);
  });

  it('should only return vodr false users', async () => {
    await con.getRepository(User).update(
      { id: '1' },
      {
        flags: updateFlagsStatement<User>({
          vordr: true,
        }),
      },
    );
    await con.getRepository(User).update({ id: '2' }, { name: 'Ido test 2' });
    const res = await client.query(QUERY('ido'));
    expect(res.data.searchUserSuggestions).toBeTruthy();

    const result = res.data.searchUserSuggestions;

    expect(result.query).toBe('ido');
    expect(result.hits).toHaveLength(1);
    expect(result.hits).toMatchObject([
      {
        id: '2',
        image: 'https://daily.dev/tsahi.jpg',
        subtitle: 'tsahidaily',
        title: 'Ido test 2',
      },
    ]);
  });

  it('should return following status', async () => {
    loggedUser = '1';
    await con
      .getRepository(User)
      .update({ id: '2' }, { name: 'Ido test 2', reputation: 100 });
    await con
      .getRepository(User)
      .update({ id: '3' }, { name: 'Ido test 3', reputation: 99 });
    await con
      .getRepository(User)
      .update({ id: '4' }, { name: 'Ido test 4', reputation: 98 });
    await con.getRepository(Feed).save({
      id: '1',
      userId: '1',
    });
    await con.getRepository(ContentPreferenceUser).save({
      userId: '1',
      referenceId: '2',
      referenceUserId: '2',
      feedId: '1',
      status: ContentPreferenceStatus.Follow,
    });
    await con.getRepository(ContentPreferenceUser).save({
      userId: '1',
      referenceId: '4',
      referenceUserId: '4',
      feedId: '1',
      status: ContentPreferenceStatus.Subscribed,
    });
    const res = await client.query(QUERY('ido', '1'));
    expect(res.data.searchUserSuggestions).toBeTruthy();

    const result = res.data.searchUserSuggestions;

    expect(result.query).toBe('ido');
    expect(result.hits).toHaveLength(3);
    expect(result.hits).toMatchObject([
      {
        id: '2',
        image: 'https://daily.dev/tsahi.jpg',
        subtitle: 'tsahidaily',
        title: 'Ido test 2',
        contentPreference: { status: 'follow' },
      },
      {
        id: '3',
        image: 'https://daily.dev/nimrod.jpg',
        subtitle: 'nimroddaily',
        title: 'Ido test 3',
        contentPreference: null,
      },
      {
        id: '4',
        image: 'https://daily.dev/lee.jpg',
        subtitle: 'lee',
        title: 'Ido test 4',
        contentPreference: { status: 'subscribed' },
      },
    ]);
  });

  it('should return following status for custom feed', async () => {
    loggedUser = '1';
    await con
      .getRepository(User)
      .update({ id: '2' }, { name: 'Ido test 2', reputation: 100 });
    await con
      .getRepository(User)
      .update({ id: '3' }, { name: 'Ido test 3', reputation: 99 });
    await con
      .getRepository(User)
      .update({ id: '4' }, { name: 'Ido test 4', reputation: 98 });
    await con.getRepository(Feed).save({
      id: '2',
      userId: '1',
    });
    await con.getRepository(Feed).save({
      id: '3',
      userId: '2',
    });
    await con.getRepository(ContentPreferenceUser).save({
      userId: '1',
      referenceId: '2',
      referenceUserId: '2',
      feedId: '2',
      status: ContentPreferenceStatus.Follow,
    });
    await con.getRepository(ContentPreferenceUser).save({
      userId: '2',
      referenceId: '4',
      referenceUserId: '4',
      feedId: '3',
      status: ContentPreferenceStatus.Subscribed,
    });
    const res = await client.query(QUERY('ido', '2'));
    expect(res.data.searchUserSuggestions).toBeTruthy();

    const result = res.data.searchUserSuggestions;

    expect(result.query).toBe('ido');
    expect(result.hits).toHaveLength(3);
    expect(result.hits).toMatchObject([
      {
        id: '2',
        image: 'https://daily.dev/tsahi.jpg',
        subtitle: 'tsahidaily',
        title: 'Ido test 2',
        contentPreference: { status: 'follow' },
      },
      {
        id: '3',
        image: 'https://daily.dev/nimrod.jpg',
        subtitle: 'nimroddaily',
        title: 'Ido test 3',
        contentPreference: null,
      },
      {
        id: '4',
        image: 'https://daily.dev/lee.jpg',
        subtitle: 'lee',
        title: 'Ido test 4',
        contentPreference: null,
      },
    ]);
  });

  it('should not return following status if not your feed', async () => {
    loggedUser = '1';
    await con
      .getRepository(User)
      .update({ id: '2' }, { name: 'Ido test 2', reputation: 100 });
    await con
      .getRepository(User)
      .update({ id: '3' }, { name: 'Ido test 3', reputation: 99 });
    await con
      .getRepository(User)
      .update({ id: '4' }, { name: 'Ido test 4', reputation: 98 });
    await con.getRepository(Feed).save({
      id: '2',
      userId: '2',
    });
    await con.getRepository(ContentPreferenceUser).save({
      userId: '2',
      referenceId: '4',
      referenceUserId: '4',
      feedId: '2',
      status: ContentPreferenceStatus.Subscribed,
    });
    const res = await client.query(QUERY('ido', '2'));
    expect(res.data.searchUserSuggestions).toBeTruthy();

    const result = res.data.searchUserSuggestions;

    expect(result.query).toBe('ido');
    expect(result.hits).toHaveLength(3);
    expect(result.hits).toMatchObject([
      {
        id: '2',
        image: 'https://daily.dev/tsahi.jpg',
        subtitle: 'tsahidaily',
        title: 'Ido test 2',
        contentPreference: null,
      },
      {
        id: '3',
        image: 'https://daily.dev/nimrod.jpg',
        subtitle: 'nimroddaily',
        title: 'Ido test 3',
        contentPreference: null,
      },
      {
        id: '4',
        image: 'https://daily.dev/lee.jpg',
        subtitle: 'lee',
        title: 'Ido test 4',
        contentPreference: null,
      },
    ]);
  });

  it('should not return 404 user', async () => {
    await saveFixtures(con, User, [ghostUser]);
    const res = await client.query(QUERY('ghost'));
    expect(res.data.searchUserSuggestions).toBeTruthy();

    const result = res.data.searchUserSuggestions;

    expect(result.query).toBe('ghost');
    expect(result.hits).toHaveLength(0);
  });
});
