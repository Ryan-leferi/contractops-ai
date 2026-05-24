import { z } from "zod";
import { idSchema } from "./ids";

export const intakeQuestionDefSchema = z.object({
  key: z.string().min(1),
  text: z.string().min(1),
  required: z.boolean(),
});
export type IntakeQuestionDef = z.infer<typeof intakeQuestionDefSchema>;

export const clauseDefSchema = z.object({
  key: z.string().min(1),
  heading: z.string().min(1),
  notes: z.string().optional(),
});
export type ClauseDef = z.infer<typeof clauseDefSchema>;

export const playbookSchema = z.object({
  id: idSchema,
  contract_type: z.string().min(1),
  contract_family: z.string().min(1),
  legal_characterization: z.string().min(1),
  required_intake_questions: z.array(intakeQuestionDefSchema),
  optional_intake_questions: z.array(intakeQuestionDefSchema),
  default_table_of_contents: z.array(z.string()),
  mandatory_clauses: z.array(clauseDefSchema),
  optional_clauses: z.array(clauseDefSchema),
  common_risks: z.array(z.string()),
  red_flags: z.array(z.string()),
  source_document_expectations: z.array(z.string()),
  drafting_style_notes: z.array(z.string()),
  negotiation_positions: z.array(z.string()),
  fallback_clauses: z.array(clauseDefSchema),
  final_qa_checklist: z.array(z.string()),
  is_custom_marker: z.boolean(),
});
export type Playbook = z.infer<typeof playbookSchema>;
