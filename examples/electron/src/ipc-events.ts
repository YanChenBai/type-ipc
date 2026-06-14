import { type } from 'arktype';
import { defineEvents } from 'ipcora/event';

export const events = defineEvents({
  updated: type('string.integer.parse'),
});
