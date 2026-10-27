import type { MetricUnit } from '../schemas/metrics';
import type { MetricsContext } from './context';
import type { MetricGroup, MetricId } from './ids';

export type MetricResult = { value: number | null; n: number; p50?: number; p90?: number; unpriced?: number };

export type MetricDef = {
  id: MetricId;
  group: MetricGroup;
  label: string;
  unit: MetricUnit;
  eventTypes: string[];
  compute: (ctx: MetricsContext) => MetricResult;
};
