/**
 * Generic Repository abstraction. Used by tests (in-memory) and by the web
 * package (localStorage). Production-grade persistence (SQL/etc.) plugs in
 * here without touching workflow logic.
 */

export interface Repository<T> {
  get(id: string): T | undefined;
  put(value: T): void;
  list(): T[];
  delete(id: string): boolean;
}

/**
 * Append-only repository. `append` throws if an entry with the same id already
 * exists. There is no `put`, no `delete`. Used for AuditLog.
 */
export interface AppendOnlyRepository<T> {
  get(id: string): T | undefined;
  append(value: T): void;
  list(): T[];
}

export class AppendOnlyViolationError extends Error {
  readonly code = "APPEND_ONLY_VIOLATION";
  constructor(id: string) {
    super(`AppendOnlyRepository: id ${id} already exists; cannot overwrite`);
    this.name = "AppendOnlyViolationError";
  }
}

export function createInMemoryRepository<T>(
  getId: (value: T) => string,
): Repository<T> {
  const store = new Map<string, T>();
  return {
    get: (id) => store.get(id),
    put: (value) => {
      store.set(getId(value), value);
    },
    list: () => Array.from(store.values()),
    delete: (id) => store.delete(id),
  };
}

export function createInMemoryAppendOnlyRepository<T>(
  getId: (value: T) => string,
): AppendOnlyRepository<T> {
  const store = new Map<string, T>();
  return {
    get: (id) => store.get(id),
    append: (value) => {
      const id = getId(value);
      if (store.has(id)) {
        throw new AppendOnlyViolationError(id);
      }
      store.set(id, value);
    },
    list: () => Array.from(store.values()),
  };
}
