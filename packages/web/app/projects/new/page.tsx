"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useStore } from "@/components/store-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export default function NewProjectPage() {
  const router = useRouter();
  const { createProject } = useStore();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const id = await createProject(name.trim());
      router.push(`/projects/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-md">
      <Card>
        <CardHeader>
          <CardTitle>New project</CardTitle>
          <CardDescription>
            A project is the top-level container for one contract workflow run.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-3">
            <div>
              <Label htmlFor="name">Project name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. 2026 NDA — Acme partnership"
                autoFocus
              />
            </div>
            {error && (
              <div className="rounded-md border border-destructive bg-destructive/5 p-3 text-sm text-destructive">
                {error}
              </div>
            )}
            <div className="flex gap-2">
              <Button type="submit" disabled={!name.trim() || submitting}>
                {submitting ? "Creating…" : "Create project"}
              </Button>
              <Button type="button" variant="outline" onClick={() => router.push("/projects")}>
                Cancel
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
