"use client";

import Link from "next/link";
import { useStore } from "@/components/store-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/utils";

export default function ProjectsPage() {
  const { store, hydrated, resetStore } = useStore();
  if (!hydrated) {
    return <div className="text-sm text-muted-foreground">Loading...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Projects</h1>
          <p className="text-sm text-muted-foreground">
            Generic contract workflow. Every project goes through the same 22-step pipeline.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/projects/new"
            className="inline-flex items-center justify-center h-9 px-4 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:opacity-90"
          >
            + New project
          </Link>
          {store.projectIds.length > 0 && (
            <Button
              variant="outline"
              onClick={() => {
                if (confirm("Reset all local data (projects, audit logs)?")) resetStore();
              }}
            >
              Reset local data
            </Button>
          )}
        </div>
      </div>

      {store.projectIds.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No projects yet. Create a project to start the mock workflow.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {store.projectIds.map((id) => {
            const p = store.projects[id];
            if (!p) return null;
            return (
              <Link key={id} href={`/projects/${id}`} className="block">
                <Card className="hover:bg-muted/50 transition-colors">
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div>
                        <CardTitle>{p.project.name}</CardTitle>
                        <CardDescription>
                          Created {formatDateTime(p.project.created_at)}
                        </CardDescription>
                      </div>
                      <Badge variant="outline">{p.project.status}</Badge>
                    </div>
                  </CardHeader>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
