import planKitSchema from '@stint-dev/core/schemas/plan.schema.json';
import reviewKitSchema from '@stint-dev/core/schemas/review.schema.json';
import skillProposalKitSchema from '@stint-dev/core/schemas/skill-proposal.schema.json';

export type JsonSchema = Record<string, unknown>;

export const PLAN_JSON_SCHEMA = planKitSchema as unknown as JsonSchema;
export const REVIEW_JSON_SCHEMA = reviewKitSchema as unknown as JsonSchema;
export const SKILL_PROPOSAL_JSON_SCHEMA = skillProposalKitSchema as unknown as JsonSchema;

// Fields the daemon fills after the call, so the model is never asked for them.
export const DAEMON_FIELDS = ['cost', 'run', 'createdAt', 'model', 'offline'] as const;

function stripNode(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripNode);
  if (!node || typeof node !== 'object') return node;
  const obj = node as Record<string, unknown>;
  if (typeof obj.$ref === 'string') {
    // No external refs reach a model. A ref left after the top level strip becomes a free object.
    return { type: 'object' };
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key === 'if' || key === 'then' || key === 'else') continue;
    if (key === 'allOf') {
      const kept = (value as unknown[]).filter(
        (part) => !(part && typeof part === 'object' && ('if' in (part as object) || 'then' in (part as object))),
      );
      if (kept.length > 0) out[key] = kept.map(stripNode);
      continue;
    }
    out[key] = stripNode(value);
  }
  return out;
}

/**
 * The model facing copy of a kit JSON Schema: top level daemon fields removed (version stays
 * as a const), no external $ref and no if/then, so every host can send it as-is.
 */
export function modelFacingSchema(jsonSchema: JsonSchema, extraStrip: string[] = []): JsonSchema {
  const copy = structuredClone(jsonSchema) as Record<string, unknown>;
  delete copy.$schema;
  delete copy.$id;
  const strip = new Set<string>([...DAEMON_FIELDS, ...extraStrip]);
  const props = copy.properties as Record<string, unknown> | undefined;
  if (props) {
    for (const field of strip) delete props[field];
  }
  if (Array.isArray(copy.required)) {
    copy.required = (copy.required as string[]).filter((field) => !strip.has(field));
  }
  return stripNode(copy) as JsonSchema;
}
