/**
 * Holds off idle sleep on macOS while a long live command runs: a Mac that sleeps drops the network mid-run and
 * fails tries the agent never got to make. caffeinate ends by itself when this process does (-w). A closed lid
 * still sleeps; nothing here can stop that.
 */
export function keepAwake(): void {
  if (process.platform !== 'darwin' || !Bun.which('caffeinate')) return;
  Bun.spawn(['caffeinate', '-i', '-w', String(process.pid)], { stdout: 'ignore', stderr: 'ignore' }).unref();
}
