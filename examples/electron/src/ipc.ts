import { electronIpcora } from '@ipcora/electron/main';
import { type } from 'arktype';
import type { InferDefinition } from 'ipcora/client';

import { events } from './ipc-events.ts';

export const ipc = electronIpcora()
  .events(events)
  .handler('ping', () => 'pong')
  .group('check', check =>
    check.handler(
      'schemaParsed',
      ({ params, $emit, emit, baseWindow }) => {
        void baseWindow.id;
        void emit;
        $emit.updated('2');
        return { name: String(params.name) };
      },
      {
        params: type({
          name: 'string.integer.parse',
        }),
        response: type({
          name: 'string.integer.parse',
        }),
        validateResponse: false,
        baseWindow: true,
      },
    ),
  );

export type Ipc = InferDefinition<typeof ipc>;
