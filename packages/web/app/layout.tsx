import type { Metadata } from "next";
import "./globals.css";
import { StoreProvider } from "@/components/store-provider";
import { PlaybooksProvider } from "@/components/playbooks-provider";
import { PromptsProvider } from "@/components/prompts-provider";

export const metadata: Metadata = {
  title: "ContractOps AI — Mock MVP",
  description:
    "Generic contract automation platform for Korean in-house legal teams (mock MVP).",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="min-h-screen bg-background text-foreground">
        <StoreProvider>
          <PlaybooksProvider>
            <PromptsProvider>
            <div className="max-w-7xl mx-auto p-6">
              <header className="flex items-center justify-between border-b pb-4 mb-6">
                <a href="/projects" className="text-lg font-semibold">
                  ContractOps AI
                </a>
                <div className="flex items-center gap-2">
                  <span
                    className="text-xs px-2 py-1 border rounded bg-muted text-foreground font-medium"
                    title="LLM provider mode. Set NEXT_PUBLIC_LLM_MODE at build time to display a different value. Real-mode wiring arrives in a later milestone."
                    data-testid="llm-mode-badge"
                  >
                    LLM mode: {(process.env.NEXT_PUBLIC_LLM_MODE ?? "MOCK").toUpperCase()}
                  </span>
                  <span className="text-xs text-muted-foreground px-2 py-1 border rounded">
                    Mock MVP · no external send
                  </span>
                </div>
              </header>
              {children}
            </div>
            </PromptsProvider>
          </PlaybooksProvider>
        </StoreProvider>
      </body>
    </html>
  );
}
