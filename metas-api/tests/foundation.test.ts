import assert from 'node:assert/strict';
import test from 'node:test';

import express from 'express';
import request from 'supertest';

import { createApp } from '../src/app.js';
import { createErrorHandler } from '../src/middleware/errorHandler.js';
import { requestId } from '../src/middleware/requestId.js';
import type { Logger } from '../src/shared/logging/logger.js';

const silentLogger: Logger = {
  error: () => undefined,
  info: () => undefined,
};

const parseJson = (text: string): Record<string, unknown> => {
  const value: unknown = JSON.parse(text);
  assert.equal(typeof value, 'object');
  assert.notEqual(value, null);
  return value as Record<string, unknown>;
};

await test('GET /health returns a minimal successful response', async () => {
  const response = await request(createApp({ logger: silentLogger }))
    .get('/health')
    .expect(200);
  const body = parseJson(response.text);

  assert.deepEqual(body, { status: 'ok' });
});

await test('the app applies the configured trusted proxy hop count', () => {
  const app = createApp({ logger: silentLogger, trustProxyHops: 1 });

  assert.equal(app.get('trust proxy'), 1);
});

await test('unknown routes return the controlled 404 contract', async () => {
  const response = await request(createApp({ logger: silentLogger }))
    .get('/does-not-exist')
    .expect(404);
  const body = parseJson(response.text);

  assert.equal(body.code, 'NOT_FOUND');
  assert.equal(body.message, 'Recurso não encontrado.');
  assert.equal(body.requestId, response.headers['x-request-id']);
});

await test('the server generates its own request ID', async () => {
  const response = await request(createApp({ logger: silentLogger }))
    .get('/health')
    .set('X-Request-ID', 'client-controlled-id')
    .expect(200);

  const generatedRequestId = response.headers['x-request-id'];
  assert.equal(typeof generatedRequestId, 'string');
  assert.notEqual(generatedRequestId, 'client-controlled-id');
  assert.match(
    String(generatedRequestId),
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
  );
});

await test('unknown errors return 500 without leaking internal details', async () => {
  const app = express();
  app.use(requestId);
  app.get('/failure', () => {
    throw new Error('DATABASE_URL=postgresql://secret local stack');
  });
  app.use(createErrorHandler(silentLogger));

  const response = await request(app).get('/failure').expect(500);
  const body = parseJson(response.text);

  assert.equal(body.code, 'INTERNAL_ERROR');
  assert.equal(body.message, 'Ocorreu um erro interno.');
  assert.equal(body.requestId, response.headers['x-request-id']);
  assert.doesNotMatch(response.text, /DATABASE_URL|postgresql|stack|secret/u);
});

await test('database failures log only safe diagnostic metadata', async () => {
  const logged: Array<{ context?: Parameters<Logger['error']>[1]; event: string }> = [];
  const capturingLogger: Logger = {
    error: (event, context) => logged.push({ context, event }),
    info: () => undefined,
  };
  const app = express();
  app.use(requestId);
  app.get('/database-failure', () => {
    const error = new Error('SQL and credentials must remain private');
    Object.assign(error, {
      parent: {
        code: '42702',
        constraint: 'private_constraint',
        message: 'private SQL message',
        routine: 'plpgsql_post_column_ref',
        sql: 'SELECT secret',
      },
    });
    error.name = 'SequelizeDatabaseError';
    throw error;
  });
  app.use(createErrorHandler(capturingLogger));

  const response = await request(app).get('/database-failure').expect(500);
  const body = parseJson(response.text);

  assert.equal(body.code, 'INTERNAL_ERROR');
  assert.deepEqual(logged[0]?.context, {
    databaseCode: '42702',
    databaseConstraint: 'private_constraint',
    databaseRoutine: 'plpgsql_post_column_ref',
    errorType: 'SequelizeDatabaseError',
    requestId: response.headers['x-request-id'],
  });
  assert.doesNotMatch(JSON.stringify(logged), /credentials|private SQL|SELECT secret/u);
});

await test('JSON payloads above 64 KB are rejected with a controlled response', async () => {
  const response = await request(createApp({ logger: silentLogger }))
    .post('/health')
    .send({ payload: 'x'.repeat(70 * 1024) })
    .expect(413);
  const body = parseJson(response.text);

  assert.equal(body.code, 'PAYLOAD_TOO_LARGE');
  assert.equal(body.requestId, response.headers['x-request-id']);
});

await test('malformed JSON returns a controlled 400 response', async () => {
  const response = await request(createApp({ logger: silentLogger }))
    .post('/health')
    .set('Content-Type', 'application/json')
    .send('{"invalid":')
    .expect(400);
  const body = parseJson(response.text);

  assert.equal(body.code, 'INVALID_JSON');
  assert.equal(body.requestId, response.headers['x-request-id']);
});
