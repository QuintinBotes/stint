import { z } from 'zod';

export const MetricUnitSchema = z.enum(['ratio', 'count', 'usd', 'ms', 'tokens']);
export type MetricUnit = z.infer<typeof MetricUnitSchema>;

export const MetricTargetSchema = z.strictObject({
  min: z.number().optional(),
  max: z.number().optional(),
  met: z.boolean(),
});
export type MetricTarget = z.infer<typeof MetricTargetSchema>;

export const MetricValueSchema = z.strictObject({
  id: z.string().min(1),
  group: z.string().min(1),
  label: z.string().min(1),
  unit: MetricUnitSchema,
  value: z.number().nullable(),
  n: z.int().min(0),
  small: z.boolean(),
  p50: z.number().optional(),
  p90: z.number().optional(),
  unpriced: z.int().min(0).optional(),
  target: MetricTargetSchema.optional(),
  definition: z.string().min(1),
});
export type MetricValue = z.infer<typeof MetricValueSchema>;

export const MetricsWindowSchema = z.strictObject({
  from: z.iso.datetime({ offset: true }).nullable(),
  to: z.iso.datetime({ offset: true }),
});
export type MetricsWindow = z.infer<typeof MetricsWindowSchema>;

export const MetricsSchema = z.strictObject({
  version: z.literal('stint.metrics/1'),
  window: MetricsWindowSchema,
  by: z.string().nullable(),
  generatedAt: z.iso.datetime({ offset: true }),
  groups: z.strictObject({
    verification: z.array(MetricValueSchema),
    outcome: z.array(MetricValueSchema),
    human: z.array(MetricValueSchema),
    learning: z.array(MetricValueSchema),
    efficiency: z.array(MetricValueSchema),
  }),
  breakdown: z
    .array(z.strictObject({ key: z.string().min(1), metrics: z.array(MetricValueSchema) }))
    .optional(),
});
export type Metrics = z.infer<typeof MetricsSchema>;
