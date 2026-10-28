import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';

export const KIT = join(import.meta.dir, '..', '..', '..', 'schemas');
export const EXAMPLES = join(import.meta.dir, '..', 'schemas', 'examples');

export const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));
export const kitSchema = (name: string) => readJson(join(KIT, `${name}.schema.json`)) as Record<string, unknown>;
export const example = (name: string) => readJson(join(EXAMPLES, `${name}.json`));

/** Ajv over the kit schemas. The kit's relative refs ("handoff.schema.json#/$defs/cost") resolve against
 *  each schema's own $id, so the handoff schema is also registered at those two resolved URLs. */
export function makeAjv() {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const handoff = kitSchema('handoff');
  for (const name of ['handoff', 'task', 'event', 'plan', 'review', 'skill', 'skill-proposal', 'metrics', 'questions', 'outcome']) ajv.addSchema(kitSchema(name));
  for (const base of ['event', 'review']) {
    ajv.addSchema({ ...handoff, $id: `https://stint.dev/schemas/${base}/handoff.schema.json` });
  }
  return (name: string, data: unknown) => {
    const id = (kitSchema(name) as { $id: string }).$id;
    const validate = ajv.getSchema(id);
    if (!validate) throw new Error(`no schema ${id}`);
    return validate(data) === true;
  };
}
