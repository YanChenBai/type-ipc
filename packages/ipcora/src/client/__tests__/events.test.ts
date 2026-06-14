import { describe, expect, expectTypeOf, test, vi } from 'vitest';

import { ipcoraClient, type Client, type InferDefinition } from '..';
import { ipcora, type StandardSchemaV1 } from '../..';
import { defineEvents } from '../../event';

function schema<TResponse, TInput = unknown>(
  validate: (
    value: unknown,
  ) => { value: TResponse } | { issues: readonly { message: string }[] } = (value: unknown) => ({
    value: value as TResponse,
  }),
): StandardSchemaV1<TInput, TResponse> {
  return {
    '~standard': {
      version: 1,
      vendor: 'test',
      validate,
    },
  };
}

describe('events', () => {
  test('subscribes to inferred event methods and returns unsubscribe', () => {
    const ipc = ipcora({ abstract: true }).events(
      defineEvents({
        update: schema<{ title: string }>(),
        created: schema<{ id: string }>(),
      }),
    );
    let capturedListener: ((payload: unknown) => void) | undefined;
    const unsubscribe = vi.fn();
    const subscribe = vi.fn((call: { listener: (payload: unknown) => void }) => {
      capturedListener = call.listener;
      return unsubscribe;
    });
    type IpcDefinition = InferDefinition<typeof ipc>;
    const client: Client<IpcDefinition> = ipcoraClient<IpcDefinition>({
      adapter: { invoke: vi.fn(), subscribe },
    });
    const onUpdate = vi.fn((payload: { title: string }) => payload.title);

    expectTypeOf(client.event.onUpdate).toExtend<
      (listener: (payload: { title: string }) => void) => () => void
    >();
    const receivedUnsubscribe = client.event.onUpdate(onUpdate);
    capturedListener?.({ title: 'Main Window' });

    expect(receivedUnsubscribe).toBe(unsubscribe);
    expect(onUpdate).toHaveBeenCalledWith({ title: 'Main Window' });
    expect(subscribe).toHaveBeenCalledWith({
      event: 'update',
      channel: 'ipcora:invoke:event:update',
      once: false,
      listener: expect.any(Function),
    });
  });

  test('onOnce subscription cancels itself when the event fires', () => {
    const ipc = ipcora({ abstract: true }).events(
      defineEvents({
        created: schema<{ id: string }>(),
      }),
    );
    const calls: string[] = [];
    let capturedListener: ((payload: unknown) => void) | undefined;
    const unsubscribe = vi.fn(() => calls.push('unsubscribe'));
    const subscribe = vi.fn((call: { listener: (payload: unknown) => void }) => {
      capturedListener = call.listener;
      return unsubscribe;
    });
    type IpcDefinition = InferDefinition<typeof ipc>;
    const client: Client<IpcDefinition> = ipcoraClient<IpcDefinition>({
      adapter: { invoke: vi.fn(), subscribe },
    });

    expectTypeOf(client.event.onOnceCreated).toExtend<
      (listener: (payload: { id: string }) => void) => () => void
    >();
    client.event.onOnceCreated(payload => {
      calls.push(`listener:${payload.id}`);
    });
    capturedListener?.({ id: 'created-1' });

    expect(subscribe).toHaveBeenCalledWith({
      event: 'created',
      channel: 'ipcora:invoke:event:created',
      once: true,
      listener: expect.any(Function),
    });
    expect(calls).toEqual(['unsubscribe', 'listener:created-1']);
  });

  test('throws when subscribing without a subscribe adapter', () => {
    const ipc = ipcora({ abstract: true }).events(
      defineEvents({
        update: schema<{ title: string }>(),
      }),
    );
    type IpcDefinition = InferDefinition<typeof ipc>;
    const client: Client<IpcDefinition> = ipcoraClient<IpcDefinition>({
      adapter: { invoke: vi.fn() },
    });

    expect(() => client.event.onUpdate(() => {})).toThrow(
      'Client subscribe adapter is required for IPC events',
    );
  });

  test('subscribes to tree-shaped event definitions', () => {
    const ipc = ipcora({ abstract: true }).events(
      defineEvents({
        window: {
          resized: schema<{ width: number; height: number }>(),
        },
      }),
    );
    let capturedSubscription: { event: string; channel: string; once: boolean } | undefined;
    const subscribe = vi.fn((call: { event: string; channel: string; once: boolean }) => {
      capturedSubscription = call;
      return vi.fn();
    });
    type IpcDefinition = InferDefinition<typeof ipc>;
    const client: Client<IpcDefinition> = ipcoraClient<IpcDefinition>({
      adapter: { invoke: vi.fn(), subscribe },
    });

    expectTypeOf(client.event.window.onResized).toExtend<
      (listener: (payload: { width: number; height: number }) => void) => () => void
    >();
    client.event.window.onResized(() => {});

    expect(capturedSubscription).toMatchObject({
      event: 'window.resized',
      channel: 'ipcora:invoke:event:window.resized',
      once: false,
    });
  });

  test('accepts defineEvents schema directly on the client', () => {
    const resizedSchema = schema<{ width: number; height: number }>();
    const events = defineEvents({
      window: {
        resized: resizedSchema,
      },
    });
    let capturedSubscription:
      | { event: string; channel: string; once: boolean; schema?: StandardSchemaV1 }
      | undefined;
    const subscribe = vi.fn(
      (call: { event: string; channel: string; once: boolean; schema?: StandardSchemaV1 }) => {
        capturedSubscription = call;
        return vi.fn();
      },
    );
    const client = ipcoraClient({
      adapter: { invoke: vi.fn(), subscribe },
      eventSchema: events,
    });

    expectTypeOf(client.event.window.onResized).toExtend<
      (listener: (payload: { width: number; height: number }) => void) => () => void
    >();
    client.event.window.onResized(() => {});

    expect(capturedSubscription).toMatchObject({
      event: 'window.resized',
      channel: 'ipcora:invoke:event:window.resized',
      once: false,
      schema: resizedSchema,
    });
  });

  test('validates delivered event payloads with parsed values', async () => {
    const updatedSchema = schema<{ count: number }, string>(value =>
      typeof value === 'string'
        ? { value: { count: Number(value) } }
        : { issues: [{ message: 'Expected string' }] },
    );
    const events = defineEvents({
      updated: updatedSchema,
    });
    let capturedListener: ((payload: unknown) => void) | undefined;
    const subscribe = vi.fn((call: { listener: (payload: unknown) => void }) => {
      capturedListener = call.listener;
      return vi.fn();
    });
    const client = ipcoraClient({
      adapter: { invoke: vi.fn(), subscribe },
      eventSchema: events,
    });
    const onUpdated = vi.fn();

    client.event.onUpdated(onUpdated);
    capturedListener?.('3');
    await Promise.resolve();
    await Promise.resolve();

    expect(onUpdated).toHaveBeenCalledWith({ count: 3 });
  });
});
