"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useStore } from "@/components/store-provider";
import { cn } from "@/lib/utils";
import type { ProjectState } from "@contractops/core";

interface Step {
  href: string;
  label: string;
  isDone: (s: ProjectState) => boolean;
}

const STEPS: Step[] = [
  { href: "", label: "Overview", isDone: () => true },
  { href: "/sources", label: "1. Sources", isDone: (s) => s.source_pack.locked },
  {
    href: "/contract-type",
    label: "2. Contract Type",
    isDone: (s) => !!s.contract_type?.is_confirmed,
  },
  { href: "/playbook", label: "3. Playbook", isDone: (s) => !!s.playbook },
  {
    href: "/intake",
    label: "4. Intake",
    isDone: (s) => {
      const reqIds = s.intake_questions.filter((q) => q.required).map((q) => q.id);
      if (reqIds.length === 0) return false;
      const answered = new Set(s.intake_answers.map((a) => a.question_id));
      return reqIds.every((id) => answered.has(id));
    },
  },
  { href: "/deal-memo", label: "5. Deal Memo", isDone: (s) => !!s.deal_memo?.approved },
  { href: "/drafting-plan", label: "6. Drafting Plan", isDone: (s) => !!s.drafting_plan?.approved },
  { href: "/draft", label: "7. Draft (v0)", isDone: (s) => s.contract_versions.length > 0 },
  {
    href: "/issues",
    label: "8. Issues",
    isDone: (s) =>
      s.issue_cards.length > 0 && s.issue_cards.every((c) => c.human_decision !== "pending"),
  },
  { href: "/qa", label: "9. QA & Final", isDone: (s) => s.contract_versions.some((v) => v.final) },
  {
    href: "/draft-loop",
    label: "Draft Loop",
    // Mark "done" once at least one iteration has been stopped (the
    // lawyer's explicit "ready for final review" signal).
    isDone: (s) => (s.draft_iterations ?? []).some((it) => it.status === "stopped"),
  },
  { href: "/exports", label: "10. Exports", isDone: (s) => s.exports.length > 0 },
  {
    href: "/members",
    label: "Members",
    // Always "done" — membership is metadata, not a workflow gate.
    // The owner_lawyer membership is auto-granted at creation, so
    // every project starts with ≥ 1 active membership.
    isDone: (s) => (s.memberships ?? []).some((m) => m.disabled_at === null),
  },
];

export default function ProjectLayout({ children }: { children: ReactNode }) {
  const params = useParams<{ id: string }>();
  const pathname = usePathname();
  const { store, hydrated } = useStore();

  if (!hydrated) {
    return <div className="text-sm text-muted-foreground">Loading...</div>;
  }
  const state = store.projects[params.id];
  if (!state) {
    return (
      <div className="text-sm">
        Project not found.{" "}
        <Link className="underline" href="/projects">
          Back to projects
        </Link>
      </div>
    );
  }

  const basePath = `/projects/${params.id}`;

  return (
    <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-6">
      <aside className="space-y-1">
        <div className="mb-3">
          <Link href="/projects" className="text-xs text-muted-foreground hover:underline">
            ← All projects
          </Link>
          <h2 className="font-semibold truncate" title={state.project.name}>
            {state.project.name}
          </h2>
          <p className="text-xs text-muted-foreground">Status: {state.project.status}</p>
        </div>
        <nav className="flex flex-col gap-0.5">
          {STEPS.map((step) => {
            const href = basePath + step.href;
            const isActive = pathname === href;
            const done = step.isDone(state);
            return (
              <Link
                key={step.href}
                href={href}
                className={cn(
                  "flex items-center justify-between text-sm rounded-md px-2 py-1.5 hover:bg-muted",
                  isActive && "bg-muted font-medium",
                )}
                data-testid={`nav-step-${step.label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`}
              >
                <span>{step.label}</span>
                {done && <span className="text-success text-xs" data-testid="step-done">✓</span>}
              </Link>
            );
          })}
        </nav>
      </aside>
      <main className="min-w-0">{children}</main>
    </div>
  );
}
