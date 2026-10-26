// Publishes the contract into the package: copies the kit's JSON Schemas from /schemas.
// The kit schemas are the source of truth; test/schemas.agree.test.ts proves the zod mirrors agree with them.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const from = join(import.meta.dir, '..', '..', '..', 'schemas');
const to = join(import.meta.dir, '..', 'schemas');
for (const name of readdirSync(from).filter((n) => n.endsWith('.schema.json')).sort()) {
  await Bun.write(join(to, name), Bun.file(join(from, name)));
}
