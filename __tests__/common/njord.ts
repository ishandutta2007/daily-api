import { DataSource } from 'typeorm';
import createOrGetConnection from '../../src/db';
import {
  createMockNjordErrorTransport,
  createMockNjordTransport,
  saveFixtures,
} from '../helpers';
import { usersFixture } from '../fixture';

import { Product, ProductType } from '../../src/entity/Product';
import type { AuthContext } from '../../src/Context';
import { createClient } from '@connectrpc/connect';
import {
  Credits,
  Currency,
  EntityType,
  GetBalanceRequest,
  TransferStatus,
} from '@dailydotdev/schema';
import * as njordCommon from '../../src/common/njord';
import { User } from '../../src/entity/user/User';
import { ForbiddenError } from 'apollo-server-errors';
import {
  UserTransaction,
  UserTransactionProcessor,
  UserTransactionStatus,
} from '../../src/entity/user/UserTransaction';
import * as redisFile from '../../src/redis';
import { ioRedisPool } from '../../src/redis';
import { parseBigInt } from '../../src/common';
import { TransferError } from '../../src/errors';
import { verifyJwt } from '../../src/auth';
import { serviceClientId } from '../../src/types';

let con: DataSource;

beforeAll(async () => {
  con = await createOrGetConnection();
});

describe('transferCores', () => {
  beforeEach(async () => {
    jest.clearAllMocks();

    const mockTransport = createMockNjordTransport();
    jest
      .spyOn(njordCommon, 'getNjordClient')
      .mockImplementation(() => createClient(Credits, mockTransport));

    await saveFixtures(
      con,
      User,
      usersFixture.map((item) => {
        return {
          ...item,
          id: `t-tc-${item.id}`,
          username: `t-tc-${item.username}`,
          github: undefined,
        };
      }),
    );

    await saveFixtures(con, Product, [
      {
        id: 'dd65570f-86c0-40a0-b8a0-3fdbd0d3945d',
        name: 'Award 1',
        image: 'https://daily.dev/award.jpg',
        type: ProductType.Award,
        value: 42,
      },
      {
        id: '7ef73a97-ced5-4c7d-945b-6e0519bf3d39',
        name: 'Award 2',
        image: 'https://daily.dev/award.jpg',
        type: ProductType.Award,
        value: 10,
      },
      {
        id: '96423e6d-3d29-49de-9f86-d93124460018',
        name: 'Award 3',
        image: 'https://daily.dev/award.jpg',
        type: ProductType.Award,
        value: 20,
      },
    ]);
  });

  it('should throw if not auth context', async () => {
    await expect(
      async () =>
        await njordCommon.transferCores({
          ctx: {
            userId: undefined,
          } as unknown as AuthContext,
          transaction: con.getRepository(UserTransaction).create({}),
          entityManager: con.manager,
        }),
    ).rejects.toThrow(new ForbiddenError('Auth is required'));
  });

  it('should transfer cores', async () => {
    const transaction = await njordCommon.createTransaction({
      ctx: {
        userId: 't-tc-1',
      } as unknown as AuthContext,
      entityManager: con.manager,
      productId: 'dd65570f-86c0-40a0-b8a0-3fdbd0d3945d',
      receiverId: 't-tc-2',
      note: 'Test test!',
    });

    await njordCommon.transferCores({
      ctx: {
        userId: 't-tc-1',
      } as unknown as AuthContext,
      transaction,
      entityManager: con.manager,
    });

    expect(transaction).toMatchObject({
      id: expect.any(String),
      processor: UserTransactionProcessor.Njord,
      receiverId: 't-tc-2',
      status: UserTransactionStatus.Success,
      productId: 'dd65570f-86c0-40a0-b8a0-3fdbd0d3945d',
      senderId: 't-tc-1',
      value: 42,
      valueIncFees: 42,
      fee: 5,
      createdAt: expect.any(Date),
      updatedAt: expect.any(Date),
      flags: {},
    } as UserTransaction);

    const transactionAfter = await con
      .getRepository(UserTransaction)
      .findOneByOrFail({
        id: transaction.id,
      });

    expect(transactionAfter.id).toBe(transaction.id);
    expect(transactionAfter).toMatchObject({
      ...transaction,
      valueIncFees: 42,
      updatedAt: expect.any(Date),
    });
  });

  it('should update balance cache', async () => {
    const updateBalanceCacheSpy = jest.spyOn(njordCommon, 'updateBalanceCache');

    const transaction = await njordCommon.createTransaction({
      ctx: {
        userId: 't-tc-1',
      } as unknown as AuthContext,
      entityManager: con.manager,
      productId: 'dd65570f-86c0-40a0-b8a0-3fdbd0d3945d',
      receiverId: 't-tc-2',
      note: 'Test test!',
    });

    const result = await njordCommon.transferCores({
      ctx: {
        userId: 't-tc-1',
      } as unknown as AuthContext,
      transaction,
      entityManager: con.manager,
    });

    [
      {
        balance: result.senderBalance!,
        userId: result.senderId,
      },
      {
        balance: result.receiverBalance!,
        userId: result.receiverId,
      },
    ].forEach((balanceUpdate) => {
      expect(updateBalanceCacheSpy).toHaveBeenCalledWith({
        ctx: {
          userId: balanceUpdate.userId,
        },
        value: {
          amount: parseBigInt(balanceUpdate.balance.newBalance),
        },
      });
    });
  });

  it('should throw on njord error', async () => {
    jest.spyOn(njordCommon, 'getNjordClient').mockImplementation(() =>
      createClient(
        Credits,
        createMockNjordErrorTransport({
          errorStatus: TransferStatus.INSUFFICIENT_FUNDS,
          errorMessage: 'Insufficient funds',
        }),
      ),
    );

    const transaction = await njordCommon.createTransaction({
      ctx: {
        userId: 't-tc-1',
      } as unknown as AuthContext,
      entityManager: con.manager,
      productId: 'dd65570f-86c0-40a0-b8a0-3fdbd0d3945d',
      receiverId: 't-tc-2',
      note: 'Test test!',
    });

    await expect(
      async () =>
        await njordCommon.transferCores({
          ctx: {
            userId: 't-tc-1',
          } as unknown as AuthContext,
          transaction,
          entityManager: con.manager,
        }),
    ).rejects.toBeInstanceOf(TransferError);
  });

  it('should sign request', async () => {
    const mockTransport = createMockNjordTransport();
    const mockedClient = createClient(Credits, mockTransport);
    const clientSpy = jest.spyOn(mockedClient, 'transfer');
    jest
      .spyOn(njordCommon, 'getNjordClient')
      .mockImplementation(() => mockedClient);

    const transaction = await njordCommon.createTransaction({
      ctx: {
        userId: 't-tc-1',
      } as unknown as AuthContext,
      entityManager: con.manager,
      productId: 'dd65570f-86c0-40a0-b8a0-3fdbd0d3945d',
      receiverId: 't-tc-2',
      note: 'Test test!',
    });

    await njordCommon.transferCores({
      ctx: {
        userId: 't-tc-1',
      } as unknown as AuthContext,
      transaction,
      entityManager: con.manager,
    });

    expect(clientSpy).toHaveBeenCalledTimes(1);
    expect(clientSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: transaction.id,
        transfers: expect.toBeArrayOfSize(1),
      }),
      expect.objectContaining({
        headers: expect.any(Headers),
      }),
    );
    expect(
      (clientSpy.mock.calls[0][1]!.headers as Headers).get('authorization'),
    ).toStartWith('Bearer ');
  });
});

describe('getBalance', () => {
  beforeEach(async () => {
    await ioRedisPool.execute((client) => client.flushall());
    jest.clearAllMocks();

    const mockTransport = createMockNjordTransport();
    jest
      .spyOn(njordCommon, 'getNjordClient')
      .mockImplementation(() => createClient(Credits, mockTransport));

    await saveFixtures(
      con,
      User,
      usersFixture.map((item) => {
        return {
          ...item,
          id: `t-gb-${item.id}`,
          username: `t-gb-${item.username}`,
          github: undefined,
        };
      }),
    );
  });

  it('should return balance', async () => {
    const setRedisObjectWithExpirySpy = jest.spyOn(
      redisFile,
      'setRedisObjectWithExpiry',
    );
    const getRedisObjectSpy = jest.spyOn(redisFile, 'getRedisObject');

    const testNjordClient = njordCommon.getNjordClient();
    await testNjordClient.transfer({
      idempotencyKey: crypto.randomUUID(),
      transfers: [
        {
          sender: { id: 'system', type: EntityType.SYSTEM },
          receiver: { id: 't-gb-1', type: EntityType.USER },
          amount: 100,
        },
      ],
    });

    const result = await njordCommon.getBalance({
      userId: 't-gb-1',
    });

    expect(result).toEqual({ amount: 100 });
    expect(getRedisObjectSpy).toHaveBeenCalledTimes(1);
    expect(setRedisObjectWithExpirySpy).toHaveBeenCalledTimes(1);
  });

  it('should save with redis keys', async () => {
    const setRedisObjectWithExpirySpy = jest.spyOn(
      redisFile,
      'setRedisObjectWithExpiry',
    );
    const getRedisObjectSpy = jest.spyOn(redisFile, 'getRedisObject');

    const result = await njordCommon.getBalance({
      userId: 't-gb-1',
    });

    expect(result).toEqual({ amount: 0 });

    expect(getRedisObjectSpy).toHaveBeenCalledWith(
      'njord:cores_balance:t-gb-1',
    );
    expect(setRedisObjectWithExpirySpy).toHaveBeenCalledWith(
      'njord:cores_balance:t-gb-1',
      JSON.stringify(result),
      expect.any(Number),
    );
  });

  it('should return cached balance', async () => {
    const setRedisObjectWithExpirySpy = jest.spyOn(
      redisFile,
      'setRedisObjectWithExpiry',
    );
    const getRedisObjectSpy = jest.spyOn(redisFile, 'getRedisObject');
    const getFreshBalanceSpy = jest.spyOn(njordCommon, 'getFreshBalance');

    const testNjordClient = njordCommon.getNjordClient();
    await testNjordClient.transfer({
      idempotencyKey: crypto.randomUUID(),
      transfers: [
        {
          sender: { id: 'system', type: EntityType.SYSTEM },
          receiver: { id: 't-gb-1', type: EntityType.USER },
          amount: 42,
        },
      ],
    });

    const resultNotCached = await njordCommon.getBalance({
      userId: 't-gb-1',
    });

    expect(resultNotCached).toEqual({ amount: 42 });

    expect(getRedisObjectSpy).toHaveBeenCalledTimes(1);
    expect(setRedisObjectWithExpirySpy).toHaveBeenCalledTimes(1);
    expect(getFreshBalanceSpy).toHaveBeenCalledTimes(1);

    const result = await njordCommon.getBalance({
      userId: 't-gb-1',
    });

    expect(result).toEqual({ amount: 42 });

    expect(getRedisObjectSpy).toHaveBeenCalledTimes(2);
    expect(setRedisObjectWithExpirySpy).toHaveBeenCalledTimes(1);
    expect(getFreshBalanceSpy).toHaveBeenCalledTimes(1);
  });

  it('should fetch fresh balance if cache is expired', async () => {
    const setRedisObjectWithExpirySpy = jest.spyOn(
      redisFile,
      'setRedisObjectWithExpiry',
    );
    const getRedisObjectSpy = jest.spyOn(redisFile, 'getRedisObject');
    const getFreshBalanceSpy = jest.spyOn(njordCommon, 'getFreshBalance');

    const testNjordClient = njordCommon.getNjordClient();
    await testNjordClient.transfer({
      idempotencyKey: crypto.randomUUID(),
      transfers: [
        {
          sender: { id: 'system', type: EntityType.SYSTEM },
          receiver: { id: 't-gb-1', type: EntityType.USER },
          amount: 42,
        },
      ],
    });

    const resultNotCached = await njordCommon.getBalance({
      userId: 't-gb-1',
    });

    expect(resultNotCached).toEqual({ amount: 42 });

    expect(getRedisObjectSpy).toHaveBeenCalledTimes(1);
    expect(setRedisObjectWithExpirySpy).toHaveBeenCalledTimes(1);
    expect(getFreshBalanceSpy).toHaveBeenCalledTimes(1);

    const result = await njordCommon.getBalance({
      userId: 't-gb-1',
    });

    expect(result).toEqual({ amount: 42 });

    expect(getRedisObjectSpy).toHaveBeenCalledTimes(2);
    expect(setRedisObjectWithExpirySpy).toHaveBeenCalledTimes(1);
    expect(getFreshBalanceSpy).toHaveBeenCalledTimes(1);

    await ioRedisPool.execute((client) => {
      return client.expire('njord:cores_balance:t-gb-1', 0);
    });

    const resultExpired = await njordCommon.getBalance({
      userId: 't-gb-1',
    });

    expect(resultExpired).toEqual({ amount: 42 });

    expect(getRedisObjectSpy).toHaveBeenCalledTimes(3);
    expect(setRedisObjectWithExpirySpy).toHaveBeenCalledTimes(2);
    expect(getFreshBalanceSpy).toHaveBeenCalledTimes(2);
  });

  it('should return 0 if no balance', async () => {
    const result = await njordCommon.getBalance({
      userId: 't-gb-1-not-exists',
    });

    expect(result).toEqual({ amount: 0 });
  });

  it('should sign request', async () => {
    const mockTransport = createMockNjordTransport();
    const mockedClient = createClient(Credits, mockTransport);
    const clientSpy = jest.spyOn(mockedClient, 'getBalance');
    jest
      .spyOn(njordCommon, 'getNjordClient')
      .mockImplementation(() => mockedClient);

    const result = await njordCommon.getBalance({
      userId: 't-gb-1',
    });

    expect(result).toEqual({ amount: 0 });
    expect(clientSpy).toHaveBeenCalledTimes(1);
    expect(clientSpy).toHaveBeenCalledWith(
      {
        account: {
          userId: 't-gb-1',
          currency: 0,
        },
      },
      expect.objectContaining({
        headers: expect.any(Headers),
      }),
    );
    expect(
      (clientSpy.mock.calls[0][1]!.headers as Headers).get('authorization'),
    ).toStartWith('Bearer ');
  });
});

describe('updatedBalanceCache', () => {
  beforeEach(async () => {
    await ioRedisPool.execute((client) => client.flushall());
    jest.clearAllMocks();

    const mockTransport = createMockNjordTransport();
    jest
      .spyOn(njordCommon, 'getNjordClient')
      .mockImplementation(() => createClient(Credits, mockTransport));
  });

  it('should update balance cache', async () => {
    const setRedisObjectWithExpirySpy = jest.spyOn(
      redisFile,
      'setRedisObjectWithExpiry',
    );

    const resultBefore = await njordCommon.getBalance({
      userId: 't-ubc-1',
    });

    expect(resultBefore).toEqual({ amount: 0 });

    await njordCommon.updateBalanceCache({
      ctx: { userId: 't-ubc-1' } as AuthContext,
      value: { amount: 101 },
    });

    expect(setRedisObjectWithExpirySpy).toHaveBeenCalledWith(
      'njord:cores_balance:t-ubc-1',
      JSON.stringify({ amount: 101 }),
      expect.any(Number),
    );

    const resultAfter = await njordCommon.getBalance({
      userId: 't-ubc-1',
    });

    expect(resultAfter).toEqual({ amount: 101 });
  });
});

describe('expireBalanceCache', () => {
  beforeEach(async () => {
    await ioRedisPool.execute((client) => client.flushall());
    jest.clearAllMocks();

    const mockTransport = createMockNjordTransport();
    jest
      .spyOn(njordCommon, 'getNjordClient')
      .mockImplementation(() => createClient(Credits, mockTransport));
  });

  it('should expire balance cache', async () => {
    const deleteRedisKeySpy = jest.spyOn(redisFile, 'deleteRedisKey');
    const getFreshBalanceSpy = jest.spyOn(njordCommon, 'getFreshBalance');

    await njordCommon.getBalance({
      userId: 't-ebc-1',
    });

    expect(getFreshBalanceSpy).toHaveBeenCalledTimes(1);

    await njordCommon.getBalance({
      userId: 't-ebc-1',
    });

    expect(getFreshBalanceSpy).toHaveBeenCalledTimes(1);

    await njordCommon.expireBalanceCache({
      ctx: { userId: 't-ebc-1' } as AuthContext,
    });

    expect(deleteRedisKeySpy).toHaveBeenCalledWith(
      'njord:cores_balance:t-ebc-1',
    );

    await njordCommon.getBalance({
      userId: 't-ebc-1',
    });

    expect(getFreshBalanceSpy).toHaveBeenCalledTimes(2);
  });
});

describe('purchaseCores', () => {
  beforeEach(async () => {
    jest.clearAllMocks();

    const mockTransport = createMockNjordTransport();
    jest
      .spyOn(njordCommon, 'getNjordClient')
      .mockImplementation(() => createClient(Credits, mockTransport));

    await saveFixtures(
      con,
      User,
      usersFixture.map((item) => {
        return {
          ...item,
          id: `t-pc-${item.id}`,
          username: `t-pc-${item.username}`,
          github: undefined,
        };
      }),
    );

    await saveFixtures(con, Product, [
      {
        id: '5329e56b-b121-47cb-9c3c-58c086c1542b',
        name: 'Award 1',
        image: 'https://daily.dev/award.jpg',
        type: ProductType.Award,
        value: 42,
      },
    ]);
  });

  it('should purchase cores', async () => {
    const transaction = await con.getRepository(UserTransaction).save({
      processor: UserTransactionProcessor.Paddle,
      receiverId: 't-pc-2',
      status: UserTransactionStatus.Success,
      productId: null,
      senderId: null,
      value: 42,
      valueIncFees: 42,
      fee: 0,
      request: {},
      flags: {
        note: 'Test test!',
      },
    });

    await njordCommon.purchaseCores({
      transaction,
    });

    expect(transaction).toMatchObject({
      id: expect.any(String),
      processor: UserTransactionProcessor.Paddle,
      receiverId: 't-pc-2',
      status: UserTransactionStatus.Success,
      productId: null,
      senderId: null,
      value: 42,
      valueIncFees: 42,
      fee: 0,
      createdAt: expect.any(Date),
      updatedAt: expect.any(Date),
      flags: {
        note: 'Test test!',
      },
    } as UserTransaction);

    const transactionAfter = await con
      .getRepository(UserTransaction)
      .findOneByOrFail({
        id: transaction.id,
      });

    expect(transactionAfter.id).toBe(transaction.id);
    expect(transactionAfter).toMatchObject({
      ...transaction,
      valueIncFees: 42,
      updatedAt: expect.any(Date),
    });
  });

  it('should throw if transaction has no id', async () => {
    const transaction = await con.getRepository(UserTransaction).create({
      processor: UserTransactionProcessor.Paddle,
      receiverId: 't-pc-2',
      status: UserTransactionStatus.Success,
      productId: null,
      senderId: 't-pc-1',
      value: 42,
      valueIncFees: 42,
      fee: 0,
      request: {},
      flags: {
        note: 'Test test!',
      },
    });

    await expect(() =>
      njordCommon.purchaseCores({
        transaction,
      }),
    ).rejects.toThrow(new Error('No transaction id'));
  });

  it('should throw if transaction has product', async () => {
    const transaction = await con.getRepository(UserTransaction).save({
      processor: UserTransactionProcessor.Paddle,
      receiverId: 't-pc-2',
      status: UserTransactionStatus.Success,
      productId: '5329e56b-b121-47cb-9c3c-58c086c1542b',
      senderId: null,
      value: 42,
      valueIncFees: 42,
      fee: 0,
      request: {},
      flags: {
        note: 'Test test!',
      },
    });

    await expect(() =>
      njordCommon.purchaseCores({
        transaction,
      }),
    ).rejects.toThrow(
      new Error('Purchase cores transaction can not have product'),
    );
  });

  it('should throw if transaction has sender', async () => {
    const transaction = await con.getRepository(UserTransaction).save({
      processor: UserTransactionProcessor.Paddle,
      receiverId: 't-pc-2',
      status: UserTransactionStatus.Success,
      productId: null,
      senderId: 't-pc-1',
      value: 42,
      valueIncFees: 42,
      fee: 0,
      request: {},
      flags: {
        note: 'Test test!',
      },
    });

    await expect(() =>
      njordCommon.purchaseCores({
        transaction,
      }),
    ).rejects.toThrow(
      new Error('Purchase cores transaction can not have sender'),
    );
  });

  it('should sign request', async () => {
    const mockTransport = createMockNjordTransport();
    const mockedClient = createClient(Credits, mockTransport);
    const clientSpy = jest.spyOn(mockedClient, 'transfer');
    jest
      .spyOn(njordCommon, 'getNjordClient')
      .mockImplementation(() => mockedClient);

    const transaction = await con.getRepository(UserTransaction).save({
      processor: UserTransactionProcessor.Paddle,
      receiverId: 't-pc-2',
      status: UserTransactionStatus.Success,
      productId: null,
      senderId: null,
      value: 42,
      valueIncFees: 42,
      fee: 0,
      request: {},
      flags: {
        note: 'Test test!',
      },
    });

    await njordCommon.purchaseCores({
      transaction,
    });

    expect(clientSpy).toHaveBeenCalledTimes(1);
    expect(clientSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: transaction.id,
        transfers: expect.toBeArrayOfSize(1),
      }),
      expect.objectContaining({
        headers: expect.any(Headers),
      }),
    );
    expect(
      (clientSpy.mock.calls[0][1]!.headers as Headers).get('authorization'),
    ).toStartWith('Bearer ');
  });

  it('should throw on njord error', async () => {
    jest.spyOn(njordCommon, 'getNjordClient').mockImplementation(() =>
      createClient(
        Credits,
        createMockNjordErrorTransport({
          errorStatus: TransferStatus.INTERNAL_ERROR,
        }),
      ),
    );

    const transaction = await con.getRepository(UserTransaction).save({
      processor: UserTransactionProcessor.Njord,
      receiverId: 't-pc-2',
      status: UserTransactionStatus.Success,
      productId: null,
      senderId: null,
      value: 42,
      valueIncFees: 42,
      fee: 0,
      request: {},
      flags: {
        note: 'Test test!',
      },
    });

    await expect(
      async () =>
        await njordCommon.purchaseCores({
          transaction,
        }),
    ).rejects.toBeInstanceOf(TransferError);
  });
});

describe('createNjordAuth', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
  });

  it('should create auth', async () => {
    const payload = new GetBalanceRequest({
      account: {
        userId: 't-cna-1',
        currency: Currency.CORES,
      },
    });

    const result = await njordCommon.createNjordAuth(payload);

    expect(result.headers).toBeInstanceOf(Headers);

    const headers = result.headers as Headers;

    expect(headers.get('authorization')).toStartWith('Bearer ');

    const jwt = await verifyJwt(
      headers.get('authorization')!.replace('Bearer ', '')!,
    );

    expect(jwt).toMatchObject({
      aud: 'Daily Staging',
      client_id: serviceClientId,
      iat: expect.any(Number),
      iss: 'Daily API Staging',
      message_hash:
        '87a33e6ae594147d8cd4d22b7b29f026f0ab4b45b66d9ff65ca7b456894f8871',
    });
  });
});
