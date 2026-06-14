import { type } from 'arktype';
import { beforeEach, describe, expect, expectTypeOf, test } from 'vitest';

import { ipcora, type StandardSchemaV1 } from '../..';
import { defineEvents } from '../../event';
import { createMemoryTestAdapter, createPeer, schema, type MemoryTestAdapter } from './helpers';

let ipcAdapter: MemoryTestAdapter = createMemoryTestAdapter();

beforeEach(() => {
  ipcAdapter = createMemoryTestAdapter();
});

describe('Ipcora events', () => {
  test('defines typed events and emits validated payloads to bound peers', async () => {
    const updateEvent = schema<{ title: string }>(value => {
      const params = value as Record<string, unknown>;
      return typeof params?.title === 'string'
        ? { value: { title: params.title } }
        : { issues: [{ message: 'Expected title' }] };
    });
    const createdEvent = schema<{ id: string }>(value => {
      const params = value as Record<string, unknown>;
      return typeof params?.id === 'string'
        ? { value: { id: params.id } }
        : { issues: [{ message: 'Expected id' }] };
    });

    const ipc = ipcora({
      channel: 'test:events',
      adapter: ipcAdapter.adapter,
    }).events(
      defineEvents({
        update: updateEvent,
        created: createdEvent,
      }),
    );
    ipc.bind(createPeer(1));
    ipc.bind(createPeer(2));

    expectTypeOf(ipc.manifest.onUpdate).toExtend<{
      readonly __ipcoraEvent: true;
      readonly name: 'update';
      readonly payload?: { title: string };
    }>();
    expectTypeOf(ipc.manifest.onOnceCreated).toExtend<{
      readonly __ipcoraEvent: true;
      readonly name: 'created';
      readonly payload?: { id: string };
    }>();

    expectTypeOf(ipc.$emit.update).toExtend<
      (
        payload: { title: string },
        options?: { peers?: Iterable<number | ReturnType<typeof createPeer>> },
      ) => Promise<void>
    >();

    await ipc.$emit.update({ title: 'Main Window' });

    expect(ipcAdapter.emitted).toEqual([
      {
        channel: 'test:events:event:update',
        sender: { id: 1 },
        payload: { title: 'Main Window' },
      },
      {
        channel: 'test:events:event:update',
        sender: { id: 2 },
        payload: { title: 'Main Window' },
      },
    ]);

    await expect(ipc.emit('created', { nope: true } as never)).rejects.toMatchObject({
      name: 'VALIDATION_ERROR',
    });
  });

  test('validates event payloads but emits the original value', async () => {
    const countEvent: StandardSchemaV1<string, { count: number }> = {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate: value =>
          typeof value === 'string'
            ? { value: { count: Number(value) } }
            : { issues: [{ message: 'Expected string' }] },
      },
    };
    const ipc = ipcora({
      channel: 'test:event-parse',
      adapter: ipcAdapter.adapter,
    }).events(
      defineEvents({
        count: countEvent,
      }),
    );
    ipc.bind(createPeer(1));

    await ipc.emit('count', '2');

    expect(ipcAdapter.emitted).toEqual([
      {
        channel: 'test:event-parse:event:count',
        sender: { id: 1 },
        payload: '2',
      },
    ]);
  });

  test('validateEvents: false skips event payload validation', async () => {
    const strictSchema = schema<{ name: string }>(value =>
      typeof (value as { name?: unknown })?.name === 'string'
        ? { value: value as { name: string } }
        : { issues: [{ message: 'Expected object with name' }] },
    );
    const ipc = ipcora({
      channel: 'test:no-validate-events',
      adapter: ipcAdapter.adapter,
      validateEvents: false,
    }).events(defineEvents({ update: strictSchema }));
    ipc.bind(createPeer(1));

    // Should NOT throw even though the payload is invalid
    await expect(ipc.$emit.update(999 as unknown as { name: string })).resolves.toBeUndefined();

    expect(ipcAdapter.emitted).toHaveLength(1);
  });

  test('validateEvents: true (default) validates event payloads', async () => {
    const strictSchema = schema<{ name: string }>(value =>
      typeof (value as { name?: unknown })?.name === 'string'
        ? { value: value as { name: string } }
        : { issues: [{ message: 'Expected object with name' }] },
    );
    const ipc = ipcora({
      channel: 'test:validate-events',
      adapter: ipcAdapter.adapter,
      validateEvents: true,
    }).events(defineEvents({ update: strictSchema }));
    ipc.bind(createPeer(1));

    await expect(ipc.$emit.update(999 as unknown as { name: string })).rejects.toThrow();
  });

  test('can emit events to selected peers', async () => {
    const updateEvent = schema<{ title: string }>(value =>
      typeof (value as { title?: unknown })?.title === 'string'
        ? { value: value as { title: string } }
        : { issues: [{ message: 'Expected title' }] },
    );
    const peer = createPeer(2);
    const ipc = ipcora({
      channel: 'test:target-events',
      adapter: ipcAdapter.adapter,
    }).events(defineEvents({ update: updateEvent }));
    ipc.bind(createPeer(1));
    ipc.bind(peer);

    await ipc.$emit.update({ title: 'Only peer 2' }, { peers: [peer] });

    expect(ipcAdapter.emitted).toEqual([
      {
        channel: 'test:target-events:event:update',
        sender: { id: 2 },
        payload: { title: 'Only peer 2' },
      },
    ]);
  });

  test('defines tree-shaped events and emits them with dotted names', async () => {
    const resizedEvent = schema<{ width: number; height: number }>(value => {
      const params = value as Record<string, unknown>;
      return typeof params?.width === 'number' && typeof params.height === 'number'
        ? { value: { width: params.width, height: params.height } }
        : { issues: [{ message: 'Expected window size' }] };
    });

    const ipc = ipcora({
      channel: 'test:tree-events',
      adapter: ipcAdapter.adapter,
    }).events(
      defineEvents({
        window: {
          resized: resizedEvent,
        },
      }),
    );
    ipc.bind(createPeer(1));

    expectTypeOf(ipc.manifest.window.onResized).toExtend<{
      readonly __ipcoraEvent: true;
      readonly name: 'window.resized';
      readonly payload?: { width: number; height: number };
    }>();
    expectTypeOf(ipc.$emit.window.resized).toExtend<
      (payload: { width: number; height: number }) => Promise<void>
    >();

    await ipc.$emit.window.resized({ width: 1280, height: 720 });

    expect(ipcAdapter.emitted).toEqual([
      {
        channel: 'test:tree-events:event:window.resized',
        sender: { id: 1 },
        payload: { width: 1280, height: 720 },
      },
    ]);
    await expect(
      ipc.emit('window.resized', { width: 'bad', height: 720 } as never),
    ).rejects.toMatchObject({
      name: 'VALIDATION_ERROR',
    });
  });

  test('exposes direct and proxy emitters in handler context', async () => {
    const ipc = ipcora({
      channel: 'test:handler-context-events',
      adapter: ipcAdapter.adapter,
    })
      .events(
        defineEvents({
          update: schema<{ title: string }>(value => ({ value: value as { title: string } })),
          window: {
            resized: schema<{ width: number; height: number }>(value => ({
              value: value as { width: number; height: number },
            })),
          },
        }),
      )
      .handler('notify', async ({ emit, $emit }) => {
        expectTypeOf(emit).toExtend<
          (name: 'update', payload: { title: string }) => Promise<void>
        >();
        expectTypeOf($emit.window.resized).toExtend<
          (payload: { width: number; height: number }) => Promise<void>
        >();

        await emit('update', { title: 'direct' });
        await $emit.window.resized({ width: 800, height: 600 });
        return 'ok';
      });
    ipc.bind(createPeer(1));

    await expect(
      ipcAdapter.invoke('test:handler-context-events', 1, { id: '1', path: 'notify' }),
    ).resolves.toEqual({ data: 'ok' });
    expect(ipcAdapter.emitted).toEqual([
      {
        channel: 'test:handler-context-events:event:update',
        sender: { id: 1 },
        payload: { title: 'direct' },
      },
      {
        channel: 'test:handler-context-events:event:window.resized',
        sender: { id: 1 },
        payload: { width: 800, height: 600 },
      },
    ]);
  });

  test('extends event contracts and registers merged event schemas', async () => {
    const readyEvent = type({
      at: 'number',
    });
    const createdEvent = type({
      id: 'string > 0',
    });
    const baseEvents = defineEvents({
      system: {
        ready: readyEvent,
      },
    });
    const events = defineEvents({
      extends: [baseEvents],
      schema: {
        user: {
          created: createdEvent,
        },
      },
    });

    const ipc = ipcora({
      channel: 'test:extended-events',
      adapter: ipcAdapter.adapter,
    }).events(events);
    ipc.bind(createPeer(1));

    expectTypeOf(ipc.$emit.system.ready).toExtend<(payload: { at: number }) => Promise<void>>();
    expectTypeOf(ipc.$emit.user.created).toExtend<(payload: { id: string }) => Promise<void>>();

    await ipc.$emit.system.ready({ at: 1 });
    await ipc.$emit.user.created({ id: 'user-1' });

    expect(ipcAdapter.emitted).toEqual([
      {
        channel: 'test:extended-events:event:system.ready',
        sender: { id: 1 },
        payload: { at: 1 },
      },
      {
        channel: 'test:extended-events:event:user.created',
        sender: { id: 1 },
        payload: { id: 'user-1' },
      },
    ]);

    await expect(ipc.$emit.system.ready({ at: 'bad' } as never)).rejects.toMatchObject({
      name: 'VALIDATION_ERROR',
    });
    await expect(ipc.$emit.user.created({ id: '' })).rejects.toMatchObject({
      name: 'VALIDATION_ERROR',
    });
  });
});
