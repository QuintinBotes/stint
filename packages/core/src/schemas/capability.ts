import { z } from 'zod';

/** What an adapter can honestly claim. A capability the code has not proven is `unknown`. */
export const CapabilityLevelSchema = z.discriminatedUnion('level', [
  z.strictObject({ level: z.literal('supported') }),
  z.strictObject({ level: z.literal('partial'), note: z.string().min(1) }),
  z.strictObject({ level: z.literal('unsupported'), reason: z.string().min(1) }),
  z.strictObject({ level: z.literal('unknown') }),
]);
export type CapabilityLevel = z.infer<typeof CapabilityLevelSchema>;

/** `observed`: tool calls are classified but cannot be prevented. `enforced` only once a gate has fired. */
export const GateStrengthSchema = z.enum(['enforced', 'observed', 'none']);
export type GateStrength = z.infer<typeof GateStrengthSchema>;
