import { vi } from 'vitest';

import type { IpcInvoke, IpcPeer, IpcResponse, StandardSchemaV1 } from '../..';
import { createMemoryAdapter, type MemoryAdapter } from '../test';

export interface MemoryTestAdapter extends MemoryAdapter {
  invoke(channel: string, senderId: number, invoke: IpcInvoke): Promise<IpcResponse>;
  reset(): void;
}

export function createMemoryTestAdapter(): MemoryTestAdapter {
  const memory = createMemoryAdapter();
  const adapter = {
    handle: vi.fn(memory.adapter.handle),
    emit: vi.fn(memory.adapter.emit),
    listenerCount: vi.fn(memory.adapter.listenerCount),
    removeHandler: vi.fn(memory.adapter.removeHandler),
  };

  return {
    ...memory,
    adapter,
    async invoke(channel, senderId, invoke) {
      const handler = memory.handlers.get(channel);
      if (!handler) {
        return {
          error: {
            name: 'ADAPTER_ERROR',
            message: `No handler registered for channel "${channel}"`,
          },
        };
      }
      return handler({ sender: { id: senderId } }, invoke) as Promise<IpcResponse>;
    },
    reset() {
      memory.emitted.length = 0;
    },
  };
}

export function createPeer(id = 1): IpcPeer & { onDispose: () => void } {
  return {
    sender: { id },
    onDispose: vi.fn(),
  };
}

export function schema<TResponse>(
  validate: (
    value: unknown,
  ) =>
    | { value: TResponse; issues?: undefined }
    | { issues: readonly { message: string; path?: readonly unknown[] }[] },
): StandardSchemaV1<unknown, TResponse> {
  return {
    '~standard': {
      version: 1,
      vendor: 'test',
      validate,
    },
  };
}

export async function invokeMemory(
  memory: MemoryAdapter,
  channel: string,
  senderId: number,
  invoke: IpcInvoke,
): Promise<IpcResponse> {
  const handler = memory.handlers.get(channel);
  if (!handler) {
    throw new Error(`No handler registered for ${channel}`);
  }
  return handler({ sender: { id: senderId } }, invoke) as Promise<IpcResponse>;
}
