import { electronIpcoraClient } from '@ipcora/electron/renderer';

import { events } from './ipc-events.ts';
import type { Ipc } from './ipc.ts';

const client = electronIpcoraClient<Ipc>({
  eventSchema: events,
  throwInvokeError: false,
  hooks: {
    onInvoke: [
      ({ channel, metadata }) => {
        console.error('onInvoke', channel, metadata);
      },
    ],
  },
});

window.addEventListener('load', () => {
  // Test IPC invoke
  document.querySelector<HTMLButtonElement>('#ipcInvoke')?.addEventListener('click', () => {
    client.invoke.ping().then(console.log);
    client.invoke.ping().then(res => {
      console.log(res);
    });
  });

  let count = 0;

  // Test IPC event subscription
  const off = client.event.onUpdated(data => {
    console.log('event.onUpdated', data, count);

    count++;

    // Unsubscribe after 10 events
    if (count >= 10) {
      off();
    }
  });

  // Test IPC event subscription once
  client.event.onOnceUpdated(data => {
    console.log('event.onOnceUpdated', data);
  });
});
