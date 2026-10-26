import { defineCommand, runMain } from 'citty';
import { up } from './up';

export const main = defineCommand({
  meta: { name: 'stint', version: '0.1.0', description: 'The task outlives the agent.' },
  subCommands: { up },
});

if (import.meta.main) await runMain(main);
