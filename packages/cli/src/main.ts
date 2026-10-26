import { defineCommand, runMain } from 'citty';
import { bench } from './bench';
import { costs } from './costs';
import { demo } from './demo';
import { evalCommand } from './eval';
import { graph } from './graph';
import { hook } from './hook';
import { initCommand } from './init';
import { mcp } from './mcp';
import { otel } from './otel';
import { reportCommand } from './report';
import { approve, exportTask, reject, show } from './approve';
import { hand, packet } from './packet';
import { scenario } from './scenario';
import { skills } from './skills';
import { assignTask, newTask, runTask } from './tasks';
import { up } from './up';

// `stint demo --json | head` closes the pipe early; that is not an error.
process.stdout.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE') process.exit(0);
  throw err;
});

export const main = defineCommand({
  meta: { name: 'stint', version: '0.1.0', description: 'The task outlives the agent.' },
  subCommands: { up, init: initCommand, new: newTask, assign: assignTask, run: runTask, demo, costs, packet, hand, approve, reject, show, export: exportTask, graph, skills, scenario, mcp, hook, bench, otel, report: reportCommand, eval: evalCommand },
});

if (import.meta.main) await runMain(main);
