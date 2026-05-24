"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { useStore } from "@/components/store-provider";
import { actAnswerIntake } from "@/lib/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export default function IntakePage() {
  const params = useParams<{ id: string }>();
  const { store, applyProjectOp } = useStore();
  const state = store.projects[params.id]!;
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    for (const a of state.intake_answers) map[a.question_id] = a.value;
    return map;
  });

  const required = state.intake_questions.filter((q) => q.required);
  const answered = new Set(state.intake_answers.map((a) => a.question_id));
  const remaining = required.filter((q) => !answered.has(q.id)).length;

  function save(questionId: string) {
    const value = (draft[questionId] ?? "").trim();
    if (!value) return;
    try {
      setError(null);
      applyProjectOp(params.id, (s) =>
        actAnswerIntake(s, { question_id: questionId, value }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Intake</h1>
          <p className="text-sm text-muted-foreground">
            Required questions come from the Playbook. Deal Memo approval is blocked until every
            required question is answered.
          </p>
        </div>
        <Badge
          variant={remaining === 0 && required.length > 0 ? "success" : "secondary"}
          data-testid="intake-progress"
        >
          {state.intake_answers.length}/{state.intake_questions.length} answered ·{" "}
          {remaining === 0 ? "all required answered" : `${remaining} required missing`}
        </Badge>
      </div>

      {!state.playbook && (
        <div className="rounded-md border border-warning bg-warning/10 p-3 text-sm">
          Select a Playbook first.
        </div>
      )}

      {error && (
        <div className="rounded-md border border-destructive bg-destructive/5 p-3 text-sm text-destructive" data-testid="page-error">
          {error}
        </div>
      )}

      {state.intake_questions.length === 0 ? (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            No intake questions yet. They are generated when a Playbook is selected.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {state.intake_questions.map((q) => {
            const existing = state.intake_answers.find((a) => a.question_id === q.id);
            return (
              <Card key={q.id} data-testid={`intake-card-${q.key}`}>
                <CardHeader className="!pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-sm">{q.text}</CardTitle>
                    {q.required && <Badge variant="outline">required</Badge>}
                  </div>
                  <CardDescription className="text-xs">key: {q.key}</CardDescription>
                </CardHeader>
                <CardContent className="!pt-0">
                  <div className="flex gap-2">
                    <Input
                      value={draft[q.id] ?? ""}
                      onChange={(e) => setDraft({ ...draft, [q.id]: e.target.value })}
                      placeholder={existing?.value ?? "answer"}
                      data-testid={`intake-input-${q.key}`}
                    />
                    <Button
                      onClick={() => save(q.id)}
                      disabled={!draft[q.id]?.trim()}
                      data-testid={`intake-save-${q.key}`}
                    >
                      Save
                    </Button>
                  </div>
                  {existing && (
                    <div className="text-xs text-muted-foreground mt-1">
                      Current: <code>{existing.value}</code>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
