/**
 * PersistenceAdapter factory (Milestone 3E + 3H).
 *
 * Driven by environment variables:
 *
 *   PERSISTENCE_DRIVER       — "memory" (default) | "file" | "postgres"
 *   PERSISTENCE_FILE_PATH    — only read when driver === "file";
 *                              defaults to "./.contractops-data"
 *   DATABASE_URL             — required when driver === "postgres".
 *                              Example: postgres://user:pass@host:5432/db
 *   POSTGRES_SSL             — only read when driver === "postgres";
 *                              "true" / "1" enables SSL with
 *                              `rejectUnauthorized: false` (suitable for
 *                              managed providers). Anything else → no SSL.
 *
 * Resolution rules:
 *   - If PERSISTENCE_DRIVER is unset or empty, use the memory adapter.
 *   - "postgres" REQUIRES DATABASE_URL — missing/empty throws
 *     `PostgresConfigError`. We refuse to silently fall back to
 *     memory; switching storage backends must always be the operator's
 *     deliberate choice.
 *   - "sqlite" is reserved for a possible future SQLite-backed adapter
 *     and currently throws.
 *   - Any other value throws `UnknownPersistenceDriverError`.
 *
 * The selected adapter is cached on `globalThis` so Next.js dev HMR
 * does not instantiate a fresh adapter (and a fresh Postgres pool!)
 * on every route module reload.
 */
import { FilePersistenceAdapter } from "./file-adapter";
import { MemoryPersistenceAdapter } from "./memory-adapter";
import { createPgPool, PostgresPersistenceAdapter } from "./postgres-adapter";
import {
  type PersistenceAdapter,
  PostgresConfigError,
  UnknownPersistenceDriverError,
} from "./types";

const GLOBAL_KEY = "__contractops_persistence_adapter_v1__";

const DEFAULT_FILE_ROOT = ".contractops-data";

export function selectPersistenceAdapter(): PersistenceAdapter {
  const g = globalThis as Record<string, unknown>;
  const cached = g[GLOBAL_KEY] as PersistenceAdapter | undefined;
  if (cached) return cached;
  const fresh = createPersistenceAdapter();
  g[GLOBAL_KEY] = fresh;
  return fresh;
}

/**
 * Build a fresh adapter from the current env vars. Exported for tests
 * that want to bypass the global cache.
 *
 * `envOverrides` lets tests inject the driver / file path / postgres
 * config without mutating `process.env`. Production callers leave it
 * empty so the real env wins.
 */
export function createPersistenceAdapter(
  envOverrides?: {
    driver?: string;
    filePath?: string;
    databaseUrl?: string;
    postgresSsl?: string;
  },
): PersistenceAdapter {
  const driver = (
    envOverrides?.driver ??
    process.env.PERSISTENCE_DRIVER ??
    "memory"
  )
    .trim()
    .toLowerCase();

  switch (driver) {
    case "":
    case "memory":
      return new MemoryPersistenceAdapter();
    case "file": {
      const root =
        envOverrides?.filePath ??
        process.env.PERSISTENCE_FILE_PATH ??
        DEFAULT_FILE_ROOT;
      return new FilePersistenceAdapter(root);
    }
    case "postgres": {
      const databaseUrl = (
        envOverrides?.databaseUrl ??
        process.env.DATABASE_URL ??
        ""
      ).trim();
      if (databaseUrl === "") {
        throw new PostgresConfigError(
          'PERSISTENCE_DRIVER="postgres" requires DATABASE_URL to be set. ' +
            "Example: DATABASE_URL=postgres://user:pass@host:5432/dbname. " +
            'Switch to PERSISTENCE_DRIVER="memory" (default) or "file" if ' +
            "you don't have a Postgres instance yet.",
        );
      }
      const ssl = parsePostgresSsl(
        envOverrides?.postgresSsl ?? process.env.POSTGRES_SSL,
      );
      const pool = createPgPool({ connectionString: databaseUrl, ssl });
      return new PostgresPersistenceAdapter(pool);
    }
    case "sqlite":
      // Reserved — silently falling back to memory would violate the
      // "do not silently switch" rule from the Milestone 3E prompt.
      throw new UnknownPersistenceDriverError(driver);
    default:
      throw new UnknownPersistenceDriverError(driver);
  }
}

/**
 * Drop the cached adapter (next `selectPersistenceAdapter` call rebuilds
 * one from the current env). Tests use this to swap drivers between
 * cases; production code should never need it.
 */
export function __resetPersistenceAdapterCacheForTests(): void {
  const g = globalThis as Record<string, unknown>;
  delete g[GLOBAL_KEY];
}

/**
 * POSTGRES_SSL parser. Conservative — only "true" / "1" / "yes" / "on"
 * (case-insensitive) enable SSL. Anything else, including unset, means
 * no SSL. Tests cover both branches directly.
 */
function parsePostgresSsl(raw: string | undefined): boolean {
  if (raw === undefined) return false;
  const v = raw.trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes" || v === "on";
}
