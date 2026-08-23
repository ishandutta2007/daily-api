import request from 'supertest';
import { setupPublicApiTests } from './helpers';
import { buildOperationId } from '../../../src/routes/public';

const state = setupPublicApiTests();

describe('buildOperationId', () => {
  it.each([
    ['GET', '/public/v1/feeds/foryou', 'getFeedsForyou'],
    ['GET', '/public/v1/feeds/tag/{tag}', 'getFeedsTagByTag'],
    ['GET', '/public/v1/posts/{id}/comments', 'getPostsByIdComments'],
    ['POST', '/public/v1/signup/', 'postSignup'],
  ])('should map %s %s to %s', (method, url, expected) => {
    expect(buildOperationId(method, url)).toBe(expected);
  });
});

describe('OpenAPI document', () => {
  // Function-calling clients name the tool after operationId, so an operation
  // without one is awkward to call and a duplicate is ambiguous.
  it('should give every operation a unique operationId', async () => {
    const { body } = await request(state.app.server)
      .get('/public/v1/docs/json')
      .expect(200);

    const operations = Object.entries(
      body.paths as Record<string, Record<string, { operationId?: string }>>,
    ).flatMap(([path, methods]) =>
      Object.entries(methods)
        .filter(([method]) =>
          ['get', 'post', 'put', 'patch', 'delete'].includes(method),
        )
        .map(([method, operation]) => ({
          ref: `${method.toUpperCase()} ${path}`,
          operationId: operation.operationId,
        })),
    );

    expect(operations.length).toBeGreaterThan(0);

    const missing = operations.filter((o) => !o.operationId).map((o) => o.ref);
    expect(missing).toEqual([]);

    const ids = operations.map((o) => o.operationId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('should describe every operation', async () => {
    const { body } = await request(state.app.server)
      .get('/public/v1/docs/json')
      .expect(200);

    const undocumented = Object.entries(
      body.paths as Record<
        string,
        Record<string, { description?: string; summary?: string }>
      >,
    ).flatMap(([path, methods]) =>
      Object.entries(methods)
        .filter(([method]) =>
          ['get', 'post', 'put', 'patch', 'delete'].includes(method),
        )
        .filter(([, operation]) => !operation.description && !operation.summary)
        .map(([method]) => `${method.toUpperCase()} ${path}`),
    );

    expect(undocumented).toEqual([]);
  });
});
