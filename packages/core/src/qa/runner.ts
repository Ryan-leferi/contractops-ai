import { checkAmountFormat } from "./checks/amount-format";
import { checkCleanCommentaryLeakage } from "./checks/clean-commentary-leakage";
import { checkCrossReferences } from "./checks/cross-references";
import { checkDateFormat } from "./checks/date-format";
import { checkForbiddenExpressions } from "./checks/forbidden-expressions";
import { checkKoreanNumbering } from "./checks/korean-numbering";
import { checkUndefinedTerms } from "./checks/undefined-terms";
import type { DeterministicQAInput, DeterministicQAResult, QACheckExecution, QAFinding } from "./types";

/**
 * Entry point for the deterministic-QA engine.
 *
 * Pure function. No LLM, no provider, no network. Always returns a result;
 * an empty findings list means "no detected issues".
 */
export function runDeterministicQA(input: DeterministicQAInput): DeterministicQAResult {
  const body = input.contract_content ?? "";

  const findings: QAFinding[] = [];
  const checks_run: QACheckExecution[] = [];

  function runCheck(check_id: QACheckExecution["check_id"], fn: () => QAFinding[]) {
    const out = fn();
    findings.push(...out);
    checks_run.push({ check_id, finding_count: out.length });
  }

  runCheck("forbidden_expressions", () => checkForbiddenExpressions(body));
  runCheck("korean_numbering", () => checkKoreanNumbering(body));
  runCheck("cross_references", () => checkCrossReferences(body));
  runCheck("amount_format", () => checkAmountFormat(body));
  runCheck("date_format", () => checkDateFormat(body));
  runCheck("clean_commentary_leakage", () =>
    checkCleanCommentaryLeakage(body, input.clean_export_content),
  );
  runCheck("undefined_terms", () => checkUndefinedTerms(body));

  return { findings, checks_run };
}
