import request from 'supertest';
import { FastifyInstance } from 'fastify';
import appFunc from '../../src';

let app: FastifyInstance;

beforeAll(async () => {
  app = await appFunc();
  return app.ready();
});

afterAll(() => app.close());

describe('OpenAPI conventional aliases', () => {
  it.each([
    ['/openapi.json', '/public/v1/docs/json'],
    ['/openapi.yaml', '/public/v1/docs/yaml'],
    ['/.well-known/openapi.json', '/public/v1/docs/json'],
  ])('should redirect %s to %s', async (alias, target) => {
    const { headers } = await request(app.server).get(alias).expect(302);

    expect(headers.location).toBe(target);
  });

  it('should land on a served OpenAPI document when followed', async () => {
    const { headers } = await request(app.server)
      .get('/openapi.json')
      .expect(302);

    const { body } = await request(app.server)
      .get(headers.location)
      .expect(200);

    expect(body.openapi).toMatch(/^3\./);
    expect(Object.keys(body.paths ?? {}).length).toBeGreaterThan(0);
  });
});
