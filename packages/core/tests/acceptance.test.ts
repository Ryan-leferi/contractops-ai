import { describe, expect, it } from "vitest";
import {
  addSourceDocument,
  approveDealMemo,
  approveDraftingPlan,
  approveFinalVersion,
  buildRevisionInputFromIssueCards,
  classifyContractTypeMock,
  confirmContractType,
  createDealMemo,
  createDraftingPlan,
  createDraftVersion,
  createExportPlaceholder,
  createIssueCards,
  createRevisionVersion,
  decideIssueCard,
  generateRequiredIntakeQuestions,
  lockSourcePack,
  removeSourceDocument,
  selectPlaybook,
  WorkflowError,
} from "@contractops/core";
import { humanLawyer, loadAllPlaybooks, loadPlaybook, nonLawyer, user } from "./helpers";
import {
  addOneSource,
  approveDeal,
  approvePlan,
  approveV0AsFinal,
  buildToV0,
  classifyAndConfirm,
  generateIntake,
  lockPack,
  makeDealMemo,
  makeDraftingPlan,
  makeV0,
  startScenario,
  selectPb,
  seedIssues,
} from "./scenarios";
import type { IssueCardSeed } from "@contractops/core";

// Tests are numbered to match docs/06_ACCEPTANCE_CRITERIA.md.

describe("§1. Contract type confirmation required before Playbook selection", () => {
  it("rejects Playbook selection when contract type is not yet confirmed", () => {
    let s = startScenario();
    s = addOneSource(s);
    s = lockPack(s);
    const classified = classifyContractTypeMock({
      project_id: s.project.id,
      source_pack: s.source_pack,
      hint: "NDA",
      env: s.env,
    });
    expect(classified.is_confirmed).toBe(false);

    expect(() =>
      selectPlaybook({
        contract_type: classified,
        available_playbooks: s.playbooks_available,
        selector: humanLawyer,
        env: s.env,
      }),
    ).toThrowError(/Contract type must be confirmed/);
  });

  it("allows Playbook selection once contract type is confirmed by a human lawyer", () => {
    let s = startScenario();
    s = addOneSource(s);
    s = lockPack(s);
    s = classifyAndConfirm(s, "NDA", "NDA");
    s = selectPb(s);
    expect(s.playbook?.contract_type).toBe("NDA");
  });
});

describe("§2. Custom Contract requires human-approved Drafting Plan", () => {
  it("rejects v0 draft when Drafting Plan is unapproved in Custom Contract mode", () => {
    let s = startScenario();
    s = addOneSource(s);
    s = lockPack(s);
    s = classifyAndConfirm(s, "Some Unusual Type", "Some Unusual Type");
    s = selectPb(s);
    expect(s.playbook?.is_custom_marker).toBe(true);
    s = generateIntake(s);
    s = ((): typeof s => {
      // Custom playbook has 2 required intake questions; answer them.
      const answers = s.intake_questions
        .filter((q) => q.required)
        .map((q) => ({
          id: s.env.newId(),
          project_id: s.project.id,
          question_id: q.id,
          value: "answer",
          answered_by: user.id,
          answered_at: s.env.now(),
        }));
      return { ...s, intake_answers: [...s.intake_answers, ...answers] };
    })();
    s = makeDealMemo(s);
    s = approveDeal(s);
    s = makeDraftingPlan(s);
    expect(s.drafting_plan?.is_custom).toBe(true);
    expect(s.drafting_plan?.approved).toBe(false);

    expect(() =>
      createDraftVersion({
        project_id: s.project.id,
        source_pack: s.source_pack,
        playbook: s.playbook!,
        deal_memo: s.deal_memo!,
        drafting_plan: s.drafting_plan!,
        content: "x",
        env: s.env,
      }),
    ).toThrowError(/Custom Contract mode requires/);
  });

  it("allows v0 draft once a human lawyer has approved the Custom Drafting Plan", () => {
    let s = startScenario();
    s = addOneSource(s);
    s = lockPack(s);
    s = classifyAndConfirm(s, "Some Unusual Type", "Some Unusual Type");
    s = selectPb(s);
    s = generateIntake(s);
    const answers = s.intake_questions
      .filter((q) => q.required)
      .map((q) => ({
        id: s.env.newId(),
        project_id: s.project.id,
        question_id: q.id,
        value: "answer",
        answered_by: user.id,
        answered_at: s.env.now(),
      }));
    s = { ...s, intake_answers: [...s.intake_answers, ...answers] };
    s = makeDealMemo(s);
    s = approveDeal(s);
    s = makeDraftingPlan(s);
    s = approvePlan(s);
    s = makeV0(s);
    expect(s.v0?.version_number).toBe("v0");
  });
});

describe("§3. Required intake questions must be answered before Deal Memo approval", () => {
  it("rejects Deal Memo approval when a required question is unanswered", () => {
    let s = startScenario();
    s = addOneSource(s);
    s = lockPack(s);
    s = classifyAndConfirm(s, "NDA", "NDA");
    s = selectPb(s);
    s = generateIntake(s);
    // Intentionally answer none.
    s = makeDealMemo(s);

    expect(() =>
      approveDealMemo({
        deal_memo: s.deal_memo!,
        approved_by: humanLawyer,
        required_questions: s.intake_questions,
        answers: [],
        env: s.env,
      }),
    ).toThrowError(/Required intake questions not answered/);
  });

  it("allows Deal Memo approval once every required question has an answer", () => {
    const s = buildToV0("nda.json");
    expect(s.deal_memo?.approved).toBe(true);
  });
});

describe("§4. Deal Memo approval required before Drafting Plan approval", () => {
  it("rejects Drafting Plan approval when Deal Memo is unapproved", () => {
    let s = startScenario();
    s = addOneSource(s);
    s = lockPack(s);
    s = classifyAndConfirm(s, "NDA", "NDA");
    s = selectPb(s);
    s = generateIntake(s);
    s = makeDealMemo(s);
    s = makeDraftingPlan(s);
    // Do NOT approve deal memo.

    expect(() =>
      approveDraftingPlan({
        plan: s.drafting_plan!,
        deal_memo: s.deal_memo!,
        approved_by: humanLawyer,
        env: s.env,
      }),
    ).toThrowError(/Deal Memo must be approved/);
  });
});

describe("§5. Drafting Plan approval required before v0 draft generation", () => {
  it("rejects v0 draft when Drafting Plan is unapproved", () => {
    let s = startScenario();
    s = addOneSource(s);
    s = lockPack(s);
    s = classifyAndConfirm(s, "NDA", "NDA");
    s = selectPb(s);
    s = generateIntake(s);
    s = ((): typeof s => {
      const answers = s.intake_questions
        .filter((q) => q.required)
        .map((q) => ({
          id: s.env.newId(),
          project_id: s.project.id,
          question_id: q.id,
          value: "answer",
          answered_by: user.id,
          answered_at: s.env.now(),
        }));
      return { ...s, intake_answers: [...s.intake_answers, ...answers] };
    })();
    s = makeDealMemo(s);
    s = approveDeal(s);
    s = makeDraftingPlan(s);
    // Do NOT approve drafting plan.

    expect(() =>
      createDraftVersion({
        project_id: s.project.id,
        source_pack: s.source_pack,
        playbook: s.playbook!,
        deal_memo: s.deal_memo!,
        drafting_plan: s.drafting_plan!,
        content: "x",
        env: s.env,
      }),
    ).toThrowError(/Drafting Plan must be approved|Custom Contract mode requires/);
  });
});

describe("§6. Rejected Issue Card not applied", () => {
  it("excludes rejected Issue Cards from revision and leaves applied_version unset", () => {
    let s = buildToV0("nda.json");
    const seeds: Omit<IssueCardSeed, "project_id">[] = [
      {
        source_agent: "mock_claude",
        severity: "high",
        location: { article: "제4조" },
        issue_type: "obligation_scope",
        problem: "비밀유지 의무 범위 광범위",
        why_it_matters: "리스크",
        recommended_revision: "범위 명확화",
        business_impact: "낮음",
        recommended_action: "revise",
      },
    ];
    s = seedIssues(s, seeds);

    const { issue_card: rejected, audit: decisionAudit } = decideIssueCard({
      issue_card: s.issue_cards[0]!,
      decision: "rejected",
      decided_by: humanLawyer,
      env: s.env,
    });

    const rev = createRevisionVersion({
      project_id: s.project.id,
      previous_version: s.v0!,
      source_pack: s.source_pack,
      playbook: s.playbook!,
      deal_memo: s.deal_memo!,
      drafting_plan: s.drafting_plan!,
      issue_cards: [rejected],
      base_content: s.v0!.content,
      next_version_number: "v1",
      env: s.env,
    });

    expect(rev.applied_issue_card_ids).toEqual([]);
    expect(rev.skipped.map((sk) => sk.issue_card_id)).toContain(rejected.issue_id);
    expect(rev.updated_issue_cards[0]?.applied_version).toBeNull();
    // sanity: revision content does NOT mention this issue id
    expect(rev.version.content).not.toContain(rejected.issue_id);
    expect(decisionAudit.event_type).toBe("issue_card_decided");
  });
});

describe("§7. Accepted Issue Card applied", () => {
  it("includes accepted Issue Cards and sets applied_version", () => {
    let s = buildToV0("nda.json");
    s = seedIssues(s, [
      {
        source_agent: "mock_claude",
        severity: "high",
        location: { article: "제6조" },
        issue_type: "term_length",
        problem: "기간 5년 과다",
        why_it_matters: "협상 부담",
        recommended_revision: "기간을 3년으로 변경",
        business_impact: "낮음",
        recommended_action: "accept",
      },
    ]);

    const { issue_card: accepted } = decideIssueCard({
      issue_card: s.issue_cards[0]!,
      decision: "accepted",
      decided_by: humanLawyer,
      env: s.env,
    });

    const rev = createRevisionVersion({
      project_id: s.project.id,
      previous_version: s.v0!,
      source_pack: s.source_pack,
      playbook: s.playbook!,
      deal_memo: s.deal_memo!,
      drafting_plan: s.drafting_plan!,
      issue_cards: [accepted],
      base_content: s.v0!.content,
      next_version_number: "v1",
      env: s.env,
    });

    expect(rev.applied_issue_card_ids).toEqual([accepted.issue_id]);
    expect(rev.updated_issue_cards[0]?.applied_version).toBe(rev.version.id);
    expect(rev.version.content).toContain("기간을 3년으로 변경");
  });
});

describe("§8. Partially accepted Issue Card included with partial note", () => {
  it("includes the partial note in the revision content and preserves it on the card", () => {
    let s = buildToV0("nda.json");
    s = seedIssues(s, [
      {
        source_agent: "mock_claude",
        severity: "medium",
        location: { article: "제7조" },
        issue_type: "damages",
        problem: "징벌적 손해배상",
        why_it_matters: "리스크",
        recommended_revision: "징벌적 배상 전면 삭제",
        business_impact: "중간",
        recommended_action: "revise",
      },
    ]);

    const { issue_card: partial } = decideIssueCard({
      issue_card: s.issue_cards[0]!,
      decision: "partially_accepted",
      decided_by: humanLawyer,
      partial_note: "징벌적 배상은 유지하되 한도 위탁료 200%로 제한",
      env: s.env,
    });

    expect(partial.partial_note).toContain("한도 위탁료 200%");

    const rev = createRevisionVersion({
      project_id: s.project.id,
      previous_version: s.v0!,
      source_pack: s.source_pack,
      playbook: s.playbook!,
      deal_memo: s.deal_memo!,
      drafting_plan: s.drafting_plan!,
      issue_cards: [partial],
      base_content: s.v0!.content,
      next_version_number: "v1",
      env: s.env,
    });

    expect(rev.applied_issue_card_ids).toEqual([partial.issue_id]);
    expect(rev.version.content).toContain("Partial revision");
    expect(rev.version.content).toContain("한도 위탁료 200%");
    expect(rev.updated_issue_cards[0]?.applied_version).toBe(rev.version.id);
  });

  it("rejects partially_accepted without a partial_note", () => {
    const s = buildToV0("nda.json");
    const seeded = seedIssues(s, [
      {
        source_agent: "mock_claude",
        severity: "low",
        location: {},
        issue_type: "x",
        problem: "x",
        why_it_matters: "x",
        recommended_revision: "x",
        business_impact: "x",
        recommended_action: "revise",
      },
    ]);
    expect(() =>
      decideIssueCard({
        issue_card: seeded.issue_cards[0]!,
        decision: "partially_accepted",
        decided_by: humanLawyer,
        env: s.env,
      }),
    ).toThrowError(/partial_note is required/);
  });
});

describe("§9. Source Pack lock prevents source changes", () => {
  it("rejects addSourceDocument after the pack is locked", () => {
    let s = startScenario();
    s = addOneSource(s);
    s = lockPack(s);
    expect(s.source_pack.locked).toBe(true);
    expect(() =>
      addSourceDocument({
        pack: s.source_pack,
        file_name: "late.pdf",
        source_type: "email",
        version: "1",
        incorporated: false,
        source_priority: 2,
        uploaded_by: user,
        env: s.env,
      }),
    ).toThrowError(/Source Pack is locked/);
  });

  it("rejects removeSourceDocument after the pack is locked", () => {
    let s = startScenario();
    s = addOneSource(s);
    s = lockPack(s);
    expect(() =>
      removeSourceDocument({
        pack: s.source_pack,
        document_id: s.source_documents[0]!.id,
      }),
    ).toThrowError(/Source Pack is locked/);
  });
});

describe("§10. ContractVersion tied to source_pack_id and playbook_id", () => {
  it("fails when source_pack_id is missing", () => {
    const s = buildToV0("nda.json");
    expect(() =>
      createDraftVersion({
        project_id: s.project.id,
        source_pack: { ...s.source_pack, id: "" },
        playbook: s.playbook!,
        deal_memo: s.deal_memo!,
        drafting_plan: s.drafting_plan!,
        content: "x",
        env: s.env,
      }),
    ).toThrowError(/source_pack_id/);
  });

  it("fails when playbook_id is missing", () => {
    const s = buildToV0("nda.json");
    expect(() =>
      createDraftVersion({
        project_id: s.project.id,
        source_pack: s.source_pack,
        playbook: { ...s.playbook!, id: "" },
        deal_memo: s.deal_memo!,
        drafting_plan: s.drafting_plan!,
        content: "x",
        env: s.env,
      }),
    ).toThrowError(/playbook_id/);
  });

  it("carries both ids on the created version", () => {
    const s = buildToV0("nda.json");
    expect(s.v0?.source_pack_id).toBe(s.source_pack.id);
    expect(s.v0?.playbook_id).toBe(s.playbook!.id);
  });
});

describe("§11. Final approval required before final export", () => {
  it("rejects export when ContractVersion is not yet final", () => {
    const s = buildToV0("nda.json");
    expect(s.v0?.final).toBe(false);
    expect(() =>
      createExportPlaceholder({
        version: s.v0!,
        export_type: "clean_docx",
        content: "CLEAN BODY",
        created_by: humanLawyer,
        env: s.env,
      }),
    ).toThrowError(/Final approval/);
  });

  it("allows export once a human lawyer has approved the final version", () => {
    let s = buildToV0("nda.json");
    s = approveV0AsFinal(s);
    const { file } = createExportPlaceholder({
      version: s.v0!,
      export_type: "clean_docx",
      content: "CLEAN BODY",
      created_by: humanLawyer,
      env: s.env,
    });
    expect(file.export_type).toBe("clean_docx");
  });
});

describe("§12. Clean / commentary export separation", () => {
  it("produces two distinct ExportFile records with different export_type values", () => {
    let s = buildToV0("nda.json");
    s = approveV0AsFinal(s);

    const clean = createExportPlaceholder({
      version: s.v0!,
      export_type: "clean_docx",
      content: "EXTERNAL CLEAN BODY",
      created_by: humanLawyer,
      env: s.env,
    });
    const commentary = createExportPlaceholder({
      version: s.v0!,
      export_type: "commentary_docx",
      content: "[COMMENTARY] internal lawyer notes",
      created_by: humanLawyer,
      env: s.env,
    });

    expect(clean.file.id).not.toBe(commentary.file.id);
    expect(clean.file.export_type).toBe("clean_docx");
    expect(commentary.file.export_type).toBe("commentary_docx");
    expect(clean.file.export_type).not.toBe(commentary.file.export_type);
  });
});

describe("§13. Internal commentary not included in clean export", () => {
  it("throws when clean export content contains commentary markers", () => {
    let s = buildToV0("nda.json");
    s = approveV0AsFinal(s);
    expect(() =>
      createExportPlaceholder({
        version: s.v0!,
        export_type: "clean_docx",
        content: "EXTERNAL [COMMENTARY] leaked",
        created_by: humanLawyer,
        env: s.env,
      }),
    ).toThrowError(/Internal commentary must not be included/);
  });

  it("permits commentary in commentary_docx export", () => {
    let s = buildToV0("nda.json");
    s = approveV0AsFinal(s);
    const res = createExportPlaceholder({
      version: s.v0!,
      export_type: "commentary_docx",
      content: "[COMMENTARY] reasoning",
      created_by: humanLawyer,
      env: s.env,
    });
    expect(res.file.content).toContain("[COMMENTARY]");
  });
});

describe("§14. AuditLog created for human decisions", () => {
  it("emits one AuditLog per human decision in a full happy-path run", () => {
    let s = buildToV0("nda.json");
    // Decide one issue card
    s = seedIssues(s, [
      {
        source_agent: "mock",
        severity: "low",
        location: {},
        issue_type: "x",
        problem: "x",
        why_it_matters: "x",
        recommended_revision: "x",
        business_impact: "x",
        recommended_action: "accept",
      },
    ]);
    const { audit: issueAudit } = decideIssueCard({
      issue_card: s.issue_cards[0]!,
      decision: "accepted",
      decided_by: humanLawyer,
      env: s.env,
    });
    s = { ...s, audits: [...s.audits, issueAudit] };
    s = approveV0AsFinal(s);
    const exp = createExportPlaceholder({
      version: s.v0!,
      export_type: "clean_docx",
      content: "CLEAN",
      created_by: humanLawyer,
      env: s.env,
    });
    s = { ...s, audits: [...s.audits, exp.audit] };

    // The audit log set should include AT LEAST one of each event_type for these human actions.
    const types = new Set(s.audits.map((a) => a.event_type));
    expect(types).toContain("project_created");
    expect(types).toContain("source_uploaded");
    expect(types).toContain("source_pack_locked");
    expect(types).toContain("contract_type_confirmed");
    expect(types).toContain("playbook_confirmed");
    expect(types).toContain("deal_memo_approved");
    expect(types).toContain("drafting_plan_approved");
    expect(types).toContain("issue_card_decided");
    expect(types).toContain("final_approved");
    expect(types).toContain("exported");

    // Each entry has the required shape.
    for (const a of s.audits) {
      expect(a.id).toBeTruthy();
      expect(a.project_id).toBeTruthy();
      expect(a.actor).toBeTruthy();
      expect(a.timestamp).toBeTruthy();
      expect(a.ref_id).toBeTruthy();
    }
  });

  it("rejects approveDealMemo from a non-lawyer (defensive)", () => {
    let s = startScenario();
    s = addOneSource(s);
    s = lockPack(s);
    s = classifyAndConfirm(s, "NDA", "NDA");
    s = selectPb(s);
    s = generateIntake(s);
    const answers = s.intake_questions
      .filter((q) => q.required)
      .map((q) => ({
        id: s.env.newId(),
        project_id: s.project.id,
        question_id: q.id,
        value: "answer",
        answered_by: user.id,
        answered_at: s.env.now(),
      }));
    s = { ...s, intake_answers: [...s.intake_answers, ...answers] };
    s = makeDealMemo(s);
    expect(() =>
      approveDealMemo({
        deal_memo: s.deal_memo!,
        approved_by: nonLawyer,
        required_questions: s.intake_questions,
        answers: s.intake_answers,
        env: s.env,
      }),
    ).toThrowError(/requires a human lawyer/);
  });
});
