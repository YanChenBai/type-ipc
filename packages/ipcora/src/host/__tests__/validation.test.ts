import { beforeEach, describe, expect, test } from 'vitest';

import { ipcora } from '../..';
import { createMemoryTestAdapter, createPeer, schema, type MemoryTestAdapter } from './helpers';

let ipcAdapter: MemoryTestAdapter = createMemoryTestAdapter();

beforeEach(() => {
  ipcAdapter = createMemoryTestAdapter();
});

describe('Ipcora validation', () => {
  test('rejects calls from unbound peers', async () => {
    const ipc = ipcora({
      channel: 'test:unbound',
      adapter: ipcAdapter.adapter,
    }).handler('ping', () => 'pong');
    ipc.bind(createPeer(1));

    await expect(
      ipcAdapter.invoke('test:unbound', 2, { id: '1', path: 'ping' }),
    ).resolves.toMatchObject({
      error: { name: 'PEER_NOT_BOUND' },
    });
  });

  test('returns handler-not-found for unknown paths', async () => {
    const ipc = ipcora({ channel: 'test:not-found', adapter: ipcAdapter.adapter });
    ipc.bind(createPeer(1));

    await expect(
      ipcAdapter.invoke('test:not-found', 1, { id: '1', path: 'missing' }),
    ).resolves.toMatchObject({
      error: { name: 'HANDLER_NOT_FOUND' },
    });
  });

  test('validates params and response with Standard Schema', async () => {
    const numberParams = schema<number>(value =>
      typeof value === 'number' ? { value } : { issues: [{ message: 'Expected number' }] },
    );
    const stringResponse = schema<string>(value =>
      typeof value === 'string' ? { value } : { issues: [{ message: 'Expected string' }] },
    );

    const ipc = ipcora({
      channel: 'test:schema',
      adapter: ipcAdapter.adapter,
    }).handler('double', ({ params }) => String(params * 2), {
      params: numberParams,
      response: stringResponse,
    });
    ipc.bind(createPeer(1));

    await expect(
      ipcAdapter.invoke('test:schema', 1, { id: '1', path: 'double', params: 2 }),
    ).resolves.toEqual({
      data: '4',
    });

    await expect(
      ipcAdapter.invoke('test:schema', 1, { id: '2', path: 'double', params: 'bad' }),
    ).resolves.toMatchObject({
      error: { name: 'VALIDATION_ERROR' },
    });
  });

  test('validates response schema failures', async () => {
    const stringResponse = schema<string>(value =>
      typeof value === 'string' ? { value } : { issues: [{ message: 'Expected string' }] },
    );
    const ipc = ipcora({
      channel: 'test:response-schema',
      adapter: ipcAdapter.adapter,
    }).handler('bad', () => 1 as any, {
      response: stringResponse,
    });
    ipc.bind(createPeer(1));

    await expect(
      ipcAdapter.invoke('test:response-schema', 1, { id: '1', path: 'bad' }),
    ).resolves.toMatchObject({
      error: { name: 'VALIDATION_ERROR' },
    });
  });

  test('validates response schema without replacing the response input', async () => {
    const numericStringResponse = schema<number>(value =>
      typeof value === 'string' && /^\d+$/.test(value)
        ? { value: Number(value) }
        : { issues: [{ message: 'Expected numeric string' }] },
    );
    const ipc = ipcora({
      channel: 'test:response-schema-input',
      adapter: ipcAdapter.adapter,
    }).handler('parseable', () => '42', {
      response: numericStringResponse,
    });
    ipc.bind(createPeer(1));

    await expect(
      ipcAdapter.invoke('test:response-schema-input', 1, { id: '1', path: 'parseable' }),
    ).resolves.toEqual({
      data: '42',
    });
  });

  test('can disable response validation per route', async () => {
    const stringResponse = schema<string>(value =>
      typeof value === 'string' ? { value } : { issues: [{ message: 'Expected string' }] },
    );
    const ipc = ipcora({
      channel: 'test:response-schema-local-off',
      adapter: ipcAdapter.adapter,
    }).handler('bad', () => 1 as any, {
      response: stringResponse,
      validateResponse: false,
    });
    ipc.bind(createPeer(1));

    await expect(
      ipcAdapter.invoke('test:response-schema-local-off', 1, { id: '1', path: 'bad' }),
    ).resolves.toEqual({
      data: 1,
    });
  });

  test('can disable response validation globally', async () => {
    const stringResponse = schema<string>(value =>
      typeof value === 'string' ? { value } : { issues: [{ message: 'Expected string' }] },
    );
    const ipc = ipcora({
      channel: 'test:response-schema-global-off',
      adapter: ipcAdapter.adapter,
      validateResponse: false,
    }).handler('bad', () => 1 as any, {
      response: stringResponse,
    });
    ipc.bind(createPeer(1));

    await expect(
      ipcAdapter.invoke('test:response-schema-global-off', 1, { id: '1', path: 'bad' }),
    ).resolves.toEqual({
      data: 1,
    });
  });

  test('validates metadata with Standard Schema and passes it to handler', async () => {
    const metadataSchema = schema<{ traceId: string; userId: number }>(value => {
      const m = value as Record<string, unknown>;
      if (!m || typeof m !== 'object') return { issues: [{ message: 'Expected metadata object' }] };
      const errors: { message: string; path?: readonly unknown[] }[] = [];
      if (typeof m.traceId !== 'string' || !m.traceId)
        errors.push({ message: 'traceId must be a non-empty string', path: ['traceId'] });
      if (typeof m.userId !== 'number')
        errors.push({ message: 'userId must be a number', path: ['userId'] });
      if (errors.length) return { issues: errors };
      return {
        value: { traceId: m.traceId, userId: m.userId } as { traceId: string; userId: number },
      };
    });

    const ipc = ipcora({
      channel: 'test:meta-schema',
      adapter: ipcAdapter.adapter,
    }).handler('read', ({ metadata }) => ({ meta: metadata }), {
      metadata: metadataSchema,
    });
    ipc.bind(createPeer(1));

    await expect(
      ipcAdapter.invoke('test:meta-schema', 1, {
        id: '1',
        path: 'read',
        metadata: { traceId: 'abc-123', userId: 42 },
      }),
    ).resolves.toEqual({
      data: { meta: { traceId: 'abc-123', userId: 42 } },
    });
  });

  test('rejects invalid metadata with VALIDATION_ERROR', async () => {
    const metadataSchema = schema<{ token: string }>(value => {
      const m = value as Record<string, unknown>;
      return m && typeof m.token === 'string'
        ? { value: { token: m.token } }
        : { issues: [{ message: 'token must be a string', path: ['token'] }] };
    });

    const ipc = ipcora({
      channel: 'test:meta-invalid',
      adapter: ipcAdapter.adapter,
    }).handler('read', () => 'ok', { metadata: metadataSchema });
    ipc.bind(createPeer(1));

    await expect(
      ipcAdapter.invoke('test:meta-invalid', 1, {
        id: '1',
        path: 'read',
        metadata: { token: 123 }, // number instead of string
      }),
    ).resolves.toMatchObject({
      error: { name: 'VALIDATION_ERROR' },
    });
  });

  test('metadata is optional — no schema means no validation', async () => {
    const ipc = ipcora({
      channel: 'test:meta-optional',
      adapter: ipcAdapter.adapter,
    }).handler('read', ({ metadata }) => ({ received: metadata }));

    ipc.bind(createPeer(1));

    // No metadata at all — should pass through.
    await expect(
      ipcAdapter.invoke('test:meta-optional', 1, { id: '1', path: 'read' }),
    ).resolves.toEqual({
      data: { received: {} },
    });

    // Arbitrary metadata — should pass through unvalidated.
    await expect(
      ipcAdapter.invoke('test:meta-optional', 1, {
        id: '2',
        path: 'read',
        metadata: { anything: 'goes', num: 42 },
      }),
    ).resolves.toEqual({ data: { received: { anything: 'goes', num: 42 } } });
  });

  test('metadata validation occurs alongside params validation (same phase)', async () => {
    const paramsSchema = schema<number>(value =>
      typeof value === 'number' ? { value } : { issues: [{ message: 'Expected number' }] },
    );
    const metadataSchema = schema<{ role: string }>(value => {
      const m = value as Record<string, unknown>;
      return m && typeof m.role === 'string'
        ? { value: { role: m.role } }
        : { issues: [{ message: 'role must be a string' }] };
    });

    let failedPhase: string | undefined;

    // Invalid metadata → validation phase error
    const ipc = ipcora({
      channel: 'test:meta-phase',
      adapter: ipcAdapter.adapter,
    }).handler('run', () => 'ok', {
      params: paramsSchema,
      metadata: metadataSchema,
      onError({ phase }) {
        failedPhase = phase;
      },
    });
    ipc.bind(createPeer(1));

    await ipcAdapter.invoke('test:meta-phase', 1, {
      id: '1',
      path: 'run',
      params: 'bad', // invalid params
      metadata: { role: 'admin' }, // valid metadata
    });

    expect(failedPhase).toBe('validation');
  });

  test('rejects metadata missing required fields with VALIDATION_ERROR', async () => {
    const metadataSchema = schema<{ traceId: string }>(value => {
      const m = value as Record<string, unknown>;
      return m && typeof m.traceId === 'string'
        ? { value: { traceId: m.traceId } }
        : { issues: [{ message: 'traceId must be a string' }] };
    });

    const ipc = ipcora({
      channel: 'test:meta-ipcora',
      adapter: ipcAdapter.adapter,
    }).handler('read', ({ metadata }) => ({ meta: metadata }), {
      metadata: metadataSchema,
    });
    ipc.bind(createPeer(1));

    await expect(
      ipcAdapter.invoke('test:meta-ipcora', 1, {
        id: '1',
        path: 'read',
        metadata: { something: 'else' },
      }),
    ).resolves.toMatchObject({
      error: { name: 'VALIDATION_ERROR' },
    });
  });

  test('local metadata option validates metadata with schema', async () => {
    const localSchema = schema<{ local: number }>(value => {
      const m = value as Record<string, unknown>;
      return m && typeof m.local === 'number'
        ? { value: { local: m.local } }
        : { issues: [{ message: 'local must be number' }] };
    });

    const ipc = ipcora({
      channel: 'test:meta-local',
      adapter: ipcAdapter.adapter,
    }).handler('withLocal', ({ metadata }) => ({ local: (metadata as { local: number }).local }), {
      metadata: localSchema,
    });

    ipc.bind(createPeer(1));

    // Valid metadata passes local schema validation.
    await expect(
      ipcAdapter.invoke('test:meta-local', 1, {
        id: '1',
        path: 'withLocal',
        metadata: { local: 42 },
      }),
    ).resolves.toEqual({ data: { local: 42 } });

    // Invalid metadata fails local schema validation.
    await expect(
      ipcAdapter.invoke('test:meta-local', 1, {
        id: '2',
        path: 'withLocal',
        metadata: { global: 'x' },
      }),
    ).resolves.toMatchObject({ error: { name: 'VALIDATION_ERROR' } });
  });
});
