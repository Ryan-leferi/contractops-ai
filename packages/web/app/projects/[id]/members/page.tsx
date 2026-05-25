"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useStore } from "@/components/store-provider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { DEMO_ACTOR_IDS, DEMO_ACTOR_REGISTRY, type DemoActorId } from "@/lib/demo-actors";
import { formatDateTime } from "@/lib/utils";
import type { ProjectMembership, ProjectRole } from "@contractops/schemas";

/**
 * Project Members panel (Milestone 3L).
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │ Server is authoritative — the page hides controls the        │
 *   │ caller cannot use, but every action still goes through       │
 *   │ /api/projects/[id]/memberships which re-checks the           │
 *   │ requester's `manage_memberships` permission. A user with     │
 *   │ devtools cannot grant themselves owner_lawyer just by        │
 *   │ unhiding a button.                                           │
 *   └──────────────────────────────────────────────────────────────┘
 */

interface MembershipsResponse {
  memberships: ProjectMembership[];
  my_membership: ProjectMembership | null;
}

const PROJECT_ROLE_OPTIONS: { value: ProjectRole; label: string }[] = [
  { value: "owner_lawyer", label: "Owner Lawyer" },
  { value: "reviewer_lawyer", label: "Reviewer Lawyer" },
  { value: "business_contributor", label: "Business Contributor" },
  { value: "business_viewer", label: "Business Viewer" },
];

export default function MembersPage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;
  const { session } = useStore();
  const [data, setData] = useState<MembershipsResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actorIdToAdd, setActorIdToAdd] = useState<DemoActorId>(
    () => DEMO_ACTOR_IDS.find((id) => id !== session?.actor.id) ?? "lawyer_park",
  );
  const [roleToAdd, setRoleToAdd] = useState<ProjectRole>("reviewer_lawyer");

  const refresh = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/memberships`);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setData((await res.json()) as MembershipsResponse);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, [projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const isOwner = data?.my_membership?.project_role === "owner_lawyer";
  const memberships = data?.memberships ?? [];
  const activeMemberships = memberships.filter((m) => m.disabled_at === null);

  async function handleAdd() {
    setActionError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/memberships`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ actor_id: actorIdToAdd, project_role: roleToAdd }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      await refresh();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleDisable(membershipId: string) {
    setActionError(null);
    setBusy(true);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/memberships/${membershipId}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      await refresh();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Project Members</h1>
        <p className="text-sm text-muted-foreground">
          Project-level RBAC (Milestone 3L). The server validates every
          membership change. The current session&apos;s project role is shown
          below.
        </p>
      </div>

      {loadError && (
        <div
          className="rounded-md border border-destructive bg-destructive/5 p-3 text-sm text-destructive"
          data-testid="page-error"
        >
          {loadError}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>My project role</CardTitle>
          <CardDescription>
            Resolved from the session cookie on the server. Read-only.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data === null ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : data.my_membership === null ? (
            <p className="text-sm text-destructive" data-testid="my-role-none">
              No active membership — you should not be able to see this project.
            </p>
          ) : (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Acting as</span>
              <Badge variant="outline" data-testid="my-actor-id">
                {data.my_membership.actor_id}
              </Badge>
              <span className="text-muted-foreground">with role</span>
              <Badge
                variant={isOwner ? "success" : "outline"}
                data-testid="my-project-role"
              >
                {data.my_membership.project_role}
              </Badge>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Memberships ({activeMemberships.length} active)</CardTitle>
            {isOwner && (
              <Badge variant="outline" data-testid="manage-memberships-allowed">
                You can manage memberships
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {memberships.length === 0 ? (
            <p className="text-sm text-muted-foreground">No memberships yet.</p>
          ) : (
            <ul className="divide-y text-sm">
              {memberships.map((m) => (
                <li
                  key={m.id}
                  className="py-2 flex items-center justify-between gap-3"
                  data-testid={`membership-row-${m.actor_id}`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-medium truncate" data-testid={`membership-actor-${m.actor_id}`}>
                      {m.actor_id}
                    </span>
                    <Badge variant="outline" data-testid={`membership-role-${m.actor_id}`}>
                      {m.project_role}
                    </Badge>
                    {m.disabled_at !== null && (
                      <Badge variant="secondary" data-testid={`membership-disabled-${m.actor_id}`}>
                        disabled {formatDateTime(m.disabled_at)}
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {isOwner && m.disabled_at === null && m.actor_id !== data?.my_membership?.actor_id && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => void handleDisable(m.id)}
                        data-testid={`disable-membership-${m.actor_id}-btn`}
                      >
                        Disable
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {isOwner && (
        <Card>
          <CardHeader>
            <CardTitle>Add a member</CardTitle>
            <CardDescription>
              Owners only. Lawyer roles require the target actor&apos;s global
              role to be <code>human_lawyer</code>; the server rejects
              mismatches with HTTP 403.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <label className="block text-xs text-muted-foreground mb-1" htmlFor="add-member-actor">
                  Actor
                </label>
                <select
                  id="add-member-actor"
                  className="text-sm border rounded px-2 py-1"
                  value={actorIdToAdd}
                  onChange={(e) => setActorIdToAdd(e.target.value as DemoActorId)}
                  data-testid="add-member-actor-select"
                >
                  {DEMO_ACTOR_IDS.map((id) => (
                    <option key={id} value={id}>
                      {DEMO_ACTOR_REGISTRY[id].display_name ?? id} ({id})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1" htmlFor="add-member-role">
                  Project role
                </label>
                <select
                  id="add-member-role"
                  className="text-sm border rounded px-2 py-1"
                  value={roleToAdd}
                  onChange={(e) => setRoleToAdd(e.target.value as ProjectRole)}
                  data-testid="add-member-role-select"
                >
                  {PROJECT_ROLE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <Button
                onClick={() => void handleAdd()}
                disabled={busy}
                data-testid="add-membership-btn"
              >
                Add member
              </Button>
            </div>
            {actionError && (
              <p
                className="text-xs text-destructive"
                data-testid="add-membership-error"
              >
                {actionError}
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
