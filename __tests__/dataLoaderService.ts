import { MockContext, MockDataLoaderService } from './helpers';
import { DataSource } from 'typeorm';
import createOrGetConnection from '../src/db';
import { Context } from '../src/Context';
import { ioRedisPool, setRedisObject } from '../src/redis';
import { generateStorageKey, StorageKey, StorageTopic } from '../src/config';

let con: DataSource;
let ctx: MockContext;

beforeAll(async () => {
  con = await createOrGetConnection();
});

beforeEach(async () => {
  ctx = new MockContext(con);
  jest.resetAllMocks();
});

describe('DataLoaderService', () => {
  it('should cache DataLoader instance', () => {
    const dataLoaderService = new MockDataLoaderService({
      ctx: ctx as Context,
    });

    const dataLoader = dataLoaderService.test;
    const dataLoader2 = dataLoaderService.test;
    expect(dataLoader).toBe(dataLoader2);
  });

  it('should stringify object key', async () => {
    const dataLoaderService = new MockDataLoaderService({
      ctx: ctx as Context,
    });

    const dataLoader = dataLoaderService.test;
    dataLoader.prime({ foo: true }, 'test1');
    dataLoader.prime({ foo: false }, 'test2');
    const value1 = await dataLoader.load({ foo: true });
    const value2 = await dataLoader.load({ foo: false });
    expect(value1).toBe('test1');
    expect(value2).toBe('test2');
    expect(dataLoaderService.mockLoadFn).toHaveBeenCalledTimes(0);
  });

  it('should return values when batch calling internally', async () => {
    const dataLoaderService = new MockDataLoaderService({
      ctx: ctx as Context,
    });

    const dataLoader = dataLoaderService.test;
    const values = await dataLoader.loadMany(['test1', 'test2', 'test3']);
    expect(values).toEqual(['test1', 'test2', 'test3']);
    expect(dataLoaderService.mockLoadFn).toHaveBeenCalledTimes(3);
  });

  it('should return rejected errors when batch calling internally', async () => {
    const dataLoaderService = new MockDataLoaderService({
      ctx: ctx as Context,
    });

    const dataLoader = dataLoaderService.test;
    const values = await dataLoader.loadMany([
      'test1',
      new Error('error2'),
      'test3',
    ]);
    expect(values).toEqual(['test1', new Error('error2'), 'test3']);
    expect(dataLoaderService.mockLoadFn).toHaveBeenCalledTimes(3);
  });

  it('should throw if load promise is rejected', async () => {
    const dataLoaderService = new MockDataLoaderService({
      ctx: ctx as Context,
    });

    const dataLoader = dataLoaderService.test;
    await expect(() => dataLoader.load(new Error('error2'))).rejects.toThrow(
      'error2',
    );
  });

  it('should return short url', async () => {
    const dataLoaderService = new MockDataLoaderService({
      ctx: ctx as Context,
    });

    const dataLoader = dataLoaderService.shortUrl;
    const shortUrl = await dataLoader.load('https://daily.dev/test/1');
    expect(shortUrl).toBe('https://daily.dev/test/1');
  });

  describe('userLastActive', () => {
    beforeEach(async () => {
      await ioRedisPool.execute((client) => client.flushall());
    });
    it('should return null if no userId set', async () => {
      const dataLoaderService = new MockDataLoaderService({
        ctx: ctx as Context,
      });
      const dataLoader = dataLoaderService.userLastActive;
      const lastActive = await dataLoader.load({ userId: null });
      expect(lastActive).toBeNull();
    });
    it('should return null if no redis object set', async () => {
      const dataLoaderService = new MockDataLoaderService({
        ctx: ctx as Context,
      });
      const dataLoader = dataLoaderService.userLastActive;
      const lastActive = await dataLoader.load({ userId: '1' });
      expect(lastActive).toBeNull();
    });
    it('should return date if redis object set', async () => {
      await setRedisObject(
        generateStorageKey(StorageTopic.Boot, StorageKey.UserLastOnline, '1'),
        '1748588810000',
      );
      const dataLoaderService = new MockDataLoaderService({
        ctx: ctx as Context,
      });
      const dataLoader = dataLoaderService.userLastActive;
      const lastActive = await dataLoader.load({ userId: '1' });
      expect(lastActive).toBeInstanceOf(Date);
    });
  });
});
