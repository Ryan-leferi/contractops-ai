"use client";

import type { DeterministicQAResult } from "@contractops/core";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const CHECK_LABEL: Record<string, string> = {
  forbidden_expressions: "금지 표현",
  korean_numbering: "한국어 번호",
  cross_references: "교차 참조",
  amount_format: "금액 형식",
  date_format: "날짜 형식",
  clean_commentary_leakage: "주석 누출",
  undefined_terms: "정의 누락 후보",
};

/**
 * Displays the persisted deterministic-QA history of a project. Each run
 * shows: passes (checks that produced zero findings), total findings, and a
 * per-check breakdown. Most-recent run first.
 *
 * Data comes from `ProjectState.qa_runs` (Milestone 2E). Survives browser
 * reloads via the existing localStorage repository.
 */
export function QARunsPanel({ runs }: { runs: DeterministicQAResult[] }) {
  if (runs.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Deterministic QA history</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          결정론적 QA 실행 이력이 없습니다.
        </CardContent>
      </Card>
    );
  }

  // Sort runs in reverse so the most recent is on top. Runs are stored in
  // insertion order; this slice + reverse keeps the original immutable.
  const sorted = [...runs].reverse();
  const latest = sorted[0]!;
  const latestPasses = latest.checks_run.filter((c) => c.finding_count === 0).length;
  const latestFindings = latest.findings.length;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Deterministic QA history{" "}
          <span className="text-xs text-muted-foreground font-normal">({runs.length})</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 max-h-[420px] overflow-y-auto">
        <div className="rounded-md border p-2 bg-muted/50">
          <div className="text-[10px] uppercase text-muted-foreground">Latest run</div>
          <div className="mt-1 text-sm flex items-center gap-2">
            <Badge variant={latestPasses === latest.checks_run.length ? "success" : "info"}>
              {latestPasses}/{latest.checks_run.length} passes
            </Badge>
            <Badge variant={latestFindings === 0 ? "success" : "warning"}>
              {latestFindings} findings
            </Badge>
          </div>
        </div>

        {sorted.map((run, idx) => (
          <div
            key={idx}
            className="text-xs border-l-2 border-border pl-3 py-1"
            data-testid={`qa-run-${idx === 0 ? "latest" : `prev-${idx}`}`}
          >
            <div className="flex items-center justify-between">
              <span className="font-medium">
                {idx === 0 ? "가장 최근" : `이전 #${idx}`}
              </span>
              <span className="text-muted-foreground">
                findings {run.findings.length} · passes{" "}
                {run.checks_run.filter((c) => c.finding_count === 0).length}/
                {run.checks_run.length}
              </span>
            </div>
            <ul className="mt-1 grid grid-cols-2 gap-x-2 text-[11px] text-muted-foreground">
              {run.checks_run.map((c) => (
                <li key={c.check_id} className="flex items-center justify-between gap-2">
                  <span>{CHECK_LABEL[c.check_id] ?? c.check_id}</span>
                  <span className={c.finding_count === 0 ? "text-success" : "text-warning"}>
                    {c.finding_count === 0 ? "✓" : `${c.finding_count}건`}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
