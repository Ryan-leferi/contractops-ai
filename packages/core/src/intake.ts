import type {
  Actor,
  IntakeAnswer,
  IntakeQuestion,
  Playbook,
} from "@contractops/schemas";
import type { Env } from "./env";

export interface GenerateRequiredIntakeQuestionsInput {
  project_id: string;
  playbook: Playbook;
  env: Env;
}

export function generateRequiredIntakeQuestions(
  input: GenerateRequiredIntakeQuestionsInput,
): IntakeQuestion[] {
  return input.playbook.required_intake_questions.map((q) => ({
    id: input.env.newId(),
    project_id: input.project_id,
    playbook_id: input.playbook.id,
    key: q.key,
    text: q.text,
    required: q.required,
  }));
}

export interface AnswerIntakeQuestionInput {
  question: IntakeQuestion;
  value: string;
  answered_by: Actor;
  env: Env;
}

export function answerIntakeQuestion(input: AnswerIntakeQuestionInput): IntakeAnswer {
  return {
    id: input.env.newId(),
    project_id: input.question.project_id,
    question_id: input.question.id,
    value: input.value,
    answered_by: input.answered_by.id,
    answered_at: input.env.now(),
  };
}

export interface ValidateRequiredIntakeAnswersInput {
  required_questions: IntakeQuestion[];
  answers: IntakeAnswer[];
}

export interface ValidateRequiredIntakeAnswersResult {
  ok: boolean;
  missing_keys: string[];
}

export function validateRequiredIntakeAnswers(
  input: ValidateRequiredIntakeAnswersInput,
): ValidateRequiredIntakeAnswersResult {
  const answeredQuestionIds = new Set(input.answers.map((a) => a.question_id));
  const missing = input.required_questions
    .filter((q) => q.required && !answeredQuestionIds.has(q.id))
    .map((q) => q.key);
  return { ok: missing.length === 0, missing_keys: missing };
}
