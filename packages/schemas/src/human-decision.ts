import { z } from "zod";
import { idSchema, isoDateTimeSchema } from "./ids";

export const humanDecisionOutcomeSchema = z.enum([
  "approved",
  "accepted",
  "partially_accepted",
  "rejected",
  "deferred",
  "confirmed",
]);
export type HumanDecisionOutcome = z.infer<typeof humanDecisionOutcomeSchema>;

export const humanDecisionSchema = z.object({
  decided_by: idSchema,
  decided_at: isoDateTimeSchema,
  outcome: humanDecisionOutcomeSchema,
  note: z.string().nullable(),
});
export type HumanDecision = z.infer<typeof humanDecisionSchema>;
