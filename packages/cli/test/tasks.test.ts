import { expect, test } from 'bun:test';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tempDir } from '../../core/test/fixture';
import { fromBead } from '../src/tasks';

test('stint new --from-bead copies the title and description from bd show --json', () => {
  const tmp = tempDir();
  const path = process.env.PATH;
  try {
    const bin = join(tmp.dir, 'bin');
    mkdirSync(bin);
    writeFileSync(join(bin, 'bd'), `#!/bin/sh\necho '[{"id":"bd-7","title":"Rate-limit webhooks","description":"Answer 429 per tenant."}]'\n`);
    chmodSync(join(bin, 'bd'), 0o755);
    process.env.PATH = `${bin}:${path}`;
    expect(fromBead('bd-7', tmp.dir)).toEqual({ title: 'Rate-limit webhooks', description: 'Answer 429 per tenant.' });
  } finally {
    process.env.PATH = path;
    tmp.cleanup();
  }
});
