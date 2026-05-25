/**
 * PersistenceAdapter factory (Milestone 3E).
 *
 * Driven by environment variables:
 *
 *   PERSISTENCE_DRIVER       — "memory" (default) | "file"
 *   PERSISTENCE_FILE_PATH    — only read when driver === "file";
 *                              defaults to "./.contractops-data"
 *
 * Resolution rules:
 *   - If PERSISTENCE_DRIVER is unset or empty, use the memory adapter.
 *   - "sqlite" is reserved for a future SQLite-backed adapter and
 *     currently throws (do not silently pick a different driver).
 *   - Any other value throws `UnknownPersistenceDriverError`. Switching
 *     drivers MUST be deliberate.
 *
 * The selected adapter is cached on `globalThis` so Next.js dev HMR
 * does not instantiate a fresh adapter on every route module reload.
 */
import { FilePersistenceAdapter } from "./file-adapter";
import { MemoryPersistenceAdapter } from "./memory-adapter";
import { type PersistenceAdapter, UnknownPersistenceDriverError } from "./types";

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
 */
export function createPersistenceAdapter(
  envOverrides?: { driver?: string; filePath?: string },
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
