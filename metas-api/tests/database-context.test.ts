import assert from 'node:assert/strict';
import test from 'node:test';

import type { Sequelize, Transaction } from 'sequelize';

import { withDatabaseContext } from '../src/shared/database/withDatabaseContext.js';

await test('database context rejects invalid UUIDs before opening a transaction', async () => {
  let transactionOpened = false;
  const database = {
    transaction: (): Promise<never> => {
      transactionOpened = true;
      return Promise.reject(new Error('Transaction should not be opened'));
    },
  } as unknown as Sequelize;

  await assert.rejects(
    withDatabaseContext(
      database,
      {
        employeeId: 'invalid',
        storeId: 'invalid',
        userId: 'invalid',
      },
      () => Promise.resolve(undefined),
    ),
  );
  assert.equal(transactionOpened, false);
});

await test('database context uses parameterized transaction-local settings', async () => {
  const queries: Array<{ replacements: unknown; sql: string }> = [];
  const transaction = {} as Transaction;
  const database = {
    query: (sql: string, options: { replacements: unknown }): Promise<void> => {
      queries.push({ sql, replacements: options.replacements });
      return Promise.resolve();
    },
    transaction: async <Result>(
      callback: (currentTransaction: Transaction) => Promise<Result>,
    ): Promise<Result> => callback(transaction),
  } as unknown as Sequelize;
  const context = {
    userId: '018f47a1-3d11-7c14-a8bf-0242ac120002',
    employeeId: '018f47a1-3d11-7c14-a8bf-0242ac120003',
    storeId: '018f47a1-3d11-7c14-a8bf-0242ac120004',
  };

  const result = await withDatabaseContext(database, context, (currentTransaction) => {
    assert.equal(currentTransaction, transaction);
    return Promise.resolve('ok');
  });

  assert.equal(result, 'ok');
  assert.equal(queries.length, 1);
  assert.match(queries[0]?.sql ?? '', /set_config\('app\.current_store_id', :storeId, TRUE\)/u);
  assert.deepEqual(queries[0]?.replacements, context);
});
