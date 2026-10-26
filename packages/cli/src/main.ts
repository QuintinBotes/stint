import { defineCommand, runMain } from 'citty';
import { costs } from './costs';
import { demo } from './demo';
import { hand, packet } from './packet';
import { up } from './up';

// `stint demo --json | head` closes the pipe early; that is not an error.
process.stdout.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE') process.exit(0);
  throw err;
});

export const main = defineCommand({
  meta: { name: 'stint', version: '0.1.0', description: 'The task outlives the agent.' },
  subCommands: { up, demo, costs, packet, hand },
});

if (import.meta.main) await runMain(main);
