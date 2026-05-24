import type { Metadata } from "next";
import "./globals.css";
import { StoreProvider } from "@/components/store-provider";
import { PlaybooksProvider } from "@/components/playbooks-provider";

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
            <div className="max-w-7xl mx-auto p-6">
              <header className="flex items-center justify-between border-b pb-4 mb-6">
                <a href="/projects" className="text-lg font-semibold">
                  ContractOps AI
                </a>
                <span className="text-xs text-muted-foreground px-2 py-1 border rounded">
                  Mock MVP · no real LLM · no external send
                </span>
              </header>
              {children}
            </div>
          </PlaybooksProvider>
        </StoreProvider>
      </body>
    </html>
  );
}
