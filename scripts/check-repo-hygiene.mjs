#!/usr/bin/env node
/**
 * scripts/check-repo-hygiene.mjs — Milestone 2F repository hygiene gate.
 *
 * Run with:  npm run repo:hygiene
 *
 * Pure Node ESM (no dependencies, no tsx) so it works identically on every
 * machine including the GitHub Actions runner. The gate fails (exit 1) if
 * either of these is true:
 *
 *   (1) FORBIDDEN PATHS — any tracked or staged file matches one of the
 *       paths in FORBIDDEN_PATH_PATTERNS. This catches accidental commits of
 *       build output (`.next`, `dist`, `build`), test artifacts
 *       (`test-results`, `playwright-report`), bundled dependencies
 *       (`node_modules`), or environment files (`.env`, `.env.local`). The
 *       only `.env*` file that is allowed to be tracked is `.env.example`.
 *
 *   (2) SECRETS — any tracked or staged file contains a string that matches
 *       a real-looking provider API key shape (OpenAI `sk-...`, Anthropic
 *       `sk-ant-...`, Google `AIza...`) or a PEM PRIVATE KEY block. Strings
 *       that clearly self-identify as test placeholders (containing
 *       "fake", "test", "example", "dummy", "your-", etc.) are suppressed
 *       so the existing fixture/test code (e.g. "sk-ant-fake") does not
 *       trigger this gate.
 *
 * Rationale: PLATFORM_BRIEF.md §10/§12 and CLAUDE.md §8 forbid hardcoded
 * API keys and confidential content in the repository. Mock mode (CI) must
 * never depend on a leaked secret. See docs/05_SECURITY_AND_CONFIDENTIALITY.md.
 */

import { execSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

// Resolve to the git repo root so file paths returned by `git ls-files`
// (always relative to the toplevel) resolve correctly regardless of where
// the script was invoked from.
const REPO_ROOT = (() => {
  try {
    return execSync("git rev-parse --show-toplevel", { encoding: "utf-8" }).trim();
  } catch {
    return process.cwd();
  }
})();

// ─────────────────────────────────────────────────────────────────────────
// Forbidden tracked/staged paths.
// ─────────────────────────────────────────────────────────────────────────

const FORBIDDEN_PATH_PATTERNS = [
  { name: "Next.js build output (.next)", re: /(^|\/)\.next(\/|$)/ },
  { name: "node_modules", re: /(^|\/)node_modules(\/|$)/ },
  { name: "Playwright test-results", re: /(^|\/)test-results(\/|$)/ },
  { name: "Playwright report", re: /(^|\/)playwright-report(\/|$)/ },
  { name: "build/dist output", re: /(^|\/)(dist|build)(\/|$)/ },
  // .env, .env.local, .env.production, etc. — but NOT .env.example
  // (handled by the explicit allowlist below).
  { name: "environment file (.env / .env.*)", re: /(^|\/)\.env(\.[^/]+)?$/ },
  // DOCX export artifacts (Milestone 3A). The renderer generates files in
  // memory and streams them to the user; nothing is meant to be tracked.
  // If a binary Playbook template is ever needed, add an explicit
  // allowlist exception here and document the reason in CLAUDE.md §8.
  { name: "generated DOCX export", re: /\.docx$/i },
  // Cover email Markdown export (Milestone 3B). Specifically the renderer
  // suffix — ordinary docs/README MD remain trackable.
  { name: "generated cover email Markdown", re: /_cover_email\.md$/i },
  // Local durable persistence files (Milestone 3E). The file adapter
  // writes JSON/JSONL under `.contractops-data/` (or any configured root)
  // and a future SQLite adapter would write `*.db` / `*.sqlite*`.
  { name: "local persistence data dir", re: /(^|\/)\.contractops-data(\/|$)/ },
  { name: "Playwright durable-test scratch dir", re: /(^|\/)\.tmp-e2e-data(\/|$)/ },
  { name: "SQLite database file", re: /\.(db|sqlite|sqlite3)$/i },
];

const ENV_ALLOWLIST = new Set(["\\.env.example", ".env.example"]);

// ─────────────────────────────────────────────────────────────────────────
// Secret-shaped patterns. Ordered most-specific first so the reported
// `name` is correct (`sk-ant-...` matches both Anthropic and OpenAI; the
// scanner reports only the first match per line per file).
// ─────────────────────────────────────────────────────────────────────────

const SECRET_PATTERNS = [
  { name: "Anthropic API key", re: /\bsk-ant-(?:api\d{2}-)?[A-Za-z0-9_-]{20,}\b/ },
  { name: "OpenAI API key", re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/ },
  { name: "Google API key", re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: "PEM PRIVATE KEY block", re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
];

const FAKE_MARKERS = [
  "fake",
  "test",
  "example",
  "placeholder",
  "dummy",
  "demo",
  "sample",
  "your-",
  "xxx",
  "redacted",
  "...",
];

function looksLikeFakeMatch(matched) {
  const lower = matched.toLowerCase();
  return FAKE_MARKERS.some((m) => lower.includes(m));
}

// ─────────────────────────────────────────────────────────────────────────
// Files we deliberately skip when scanning for secrets.
// ─────────────────────────────────────────────────────────────────────────

const SECRET_SCAN_SKIP_FILES = new Set([
  "package-lock.json", // huge, full of sha512 hashes; manifests cannot leak secrets
  "scripts/check-repo-hygiene.mjs", // this script lists the regexes literally
]);

// ─────────────────────────────────────────────────────────────────────────
// Git plumbing.
// ─────────────────────────────────────────────────────────────────────────

function gitFiles() {
  const tracked = safeExec("git ls-files");
  // ACM = Added/Copied/Modified (skip Deleted/Renamed-source). --cached =
  // index, i.e. what is staged for commit but not yet committed.
  const staged = safeExec("git diff --cached --name-only --diff-filter=ACM");
  const all = new Set();
  for (const line of (tracked + "\n" + staged).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed) all.add(trimmed);
  }
  return [...all];
}

function safeExec(cmd) {
  try {
    return execSync(cmd, { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (err) {
    // If we are not inside a git repo, treat the file list as empty rather
    // than crash. CI always runs after checkout so this branch is mostly a
    // safety net for unusual local invocations.
    process.stderr.write(`warn: \`${cmd}\` failed: ${err.message}\n`);
    return "";
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Checks.
// ─────────────────────────────────────────────────────────────────────────

function checkForbiddenPaths(files) {
  const violations = [];
  for (const file of files) {
    if (ENV_ALLOWLIST.has(file)) continue;
    for (const { name, re } of FORBIDDEN_PATH_PATTERNS) {
      if (re.test(file)) {
        violations.push({ file, reason: name });
        break;
      }
    }
  }
  return violations;
}

function checkSecrets(files) {
  const violations = [];
  for (const file of files) {
    if (SECRET_SCAN_SKIP_FILES.has(file)) continue;

    const abs = resolve(REPO_ROOT, file);
    let stat;
    try {
      stat = statSync(abs);
    } catch {
      continue; // staged-but-not-on-disk (deleted), or symlink target missing
    }
    if (!stat.isFile() || stat.size > 1_000_000) continue;

    let text;
    try {
      text = readFileSync(abs, "utf-8");
    } catch {
      continue; // binary or unreadable
    }

    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const { name, re } of SECRET_PATTERNS) {
        const m = line.match(re);
        if (!m) continue;
        if (looksLikeFakeMatch(m[0])) continue;
        violations.push({
          file,
          line: i + 1,
          secret: name,
          // Show the matched fragment only — never echo the whole line in
          // case of surrounding identifying context.
          excerpt: `${m[0].slice(0, 12)}...(${m[0].length} chars)`,
        });
        break; // one finding per line is enough
      }
    }
  }
  return violations;
}

// ─────────────────────────────────────────────────────────────────────────
// Run.
// ─────────────────────────────────────────────────────────────────────────

const files = gitFiles();

const pathViolations = checkForbiddenPaths(files);
const secretViolations = checkSecrets(files);

let failed = false;

if (pathViolations.length > 0) {
  process.stderr.write("✗ Forbidden path tracked or staged:\n");
  for (const v of pathViolations) {
    process.stderr.write(`    ${v.file}    (${v.reason})\n`);
  }
  process.stderr.write("\n");
  failed = true;
}

if (secretViolations.length > 0) {
  process.stderr.write("✗ Possible secret in tracked or staged file:\n");
  for (const v of secretViolations) {
    process.stderr.write(`    ${v.file}:${v.line}    [${v.secret}]  ${v.excerpt}\n`);
  }
  process.stderr.write(
    "\n  If this is a deliberate test placeholder, mark it with one of: " +
      FAKE_MARKERS.join(", ") +
      ".\n  See docs/05_SECURITY_AND_CONFIDENTIALITY.md.\n\n",
  );
  failed = true;
}

if (failed) {
  process.stderr.write("Repository hygiene gate FAILED.\n");
  process.exit(1);
}

process.stdout.write(
  `✓ Repository hygiene OK — scanned ${files.length} tracked/staged files, no forbidden paths, no exposed secrets.\n`,
);
