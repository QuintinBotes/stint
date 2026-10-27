import { defineCommand, runMain } from 'citty';
import { bench } from './bench';
import { costs } from './costs';
import { demo } from './demo';
import { evalCommand } from './eval';
import { graph } from './graph';
import { hook } from './hook';
import { initCommand } from './init';
import { intake } from './intake';
import { mcp } from './mcp';
import { metricsCommand } from './metrics';
import { otel } from './otel';
import { reportCommand } from './report';
import { approve, exportTask, reject, show } from './approve';
import { hand, packet } from './packet';
import { scenario } from './scenario';
import { skills } from './skills';
import { doctor } from './doctor';
import { applyStartupKeys, keys } from './keys';
import { assignTask, newTask, runTask } from './tasks';
import { up } from './up';

// `stint demo --json | head` closes the pipe early; that is not an error.
process.stdout.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE') process.exit(0);
  throw err;
});

export const main = defineCommand({
  meta: { name: 'stint', version: '0.1.0', description: 'The task outlives the agent.' },
  subCommands: { up, init: initCommand, new: newTask, assign: assignTask, run: runTask, demo, costs, metrics: metricsCommand, packet, hand, approve, reject, show, export: exportTask, graph, skills, scenario, mcp, hook, bench, otel, report: reportCommand, eval: evalCommand, intake, doctor, keys },
});

if (import.meta.main) {
  // keys from the user-level file, this repository's ignored .env, or the old place in the checkout (R-059);
  // agent hooks and the MCP server need none and must stay silent on stderr
  if (!['hook', 'mcp'].includes(process.argv[2] ?? '')) applyStartupKeys();
  await runMain(main);
}
