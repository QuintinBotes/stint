import { expect, test } from 'bun:test';
import { modelFacingSchema } from '../src/modelSchema';

// The keywords if/then/else are removed so every host can take the schema, but a field named then is a field: the spec
// builder's scenarios are Given/When/Then, and without this the model was never shown then and every draft failed.
test('if, then and else are removed as keywords, while a property named then stays with its schema and stays required', () => {
  const schema = {
    type: 'object',
    properties: {
      scenario: {
        type: 'object',
        properties: { given: { type: 'string' }, when: { type: 'string' }, then: { type: 'string' } },
        required: ['given', 'when', 'then'],
        if: { properties: { given: { const: 'x' } } },
        then: { required: ['when'] },
        else: { required: ['given'] },
      },
    },
    required: ['scenario'],
  };
  const out = modelFacingSchema(schema as never) as { properties: { scenario: Record<string, unknown> } };
  expect(out.properties.scenario).toEqual({
    type: 'object',
    properties: { given: { type: 'string' }, when: { type: 'string' }, then: { type: 'string' } },
    required: ['given', 'when', 'then'],
  });
});
