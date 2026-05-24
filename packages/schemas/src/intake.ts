import { z } from "zod";
import { idSchema, isoDateTimeSchema } from "./ids";

export const intakeQuestionSchema = z.object({
  id: idSchema,
  project_id: idSchema,
  playbook_id: idSchema,
  key: z.string().min(1),
  text: z.string().min(1),
  required: z.boolean(),
});
export type IntakeQuestion = z.infer<typeof intakeQuestionSchema>;

export const intakeAnswerSchema = z.object({
  id: idSchema,
  project_id: idSchema,
  question_id: idSchema,
  value: z.string(),
  answered_by: idSchema,
  answered_at: isoDateTimeSchema,
});
export type IntakeAnswer = z.infer<typeof intakeAnswerSchema>;
