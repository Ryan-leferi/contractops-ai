import {
  AppendOnlyViolationError,
  type AppendOnlyRepository,
  type Repository,
} from "@contractops/core";

function safeRead<T>(storageKey: string): T[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return [];
    return JSON.parse(raw) as T[];
  } catch {
    return [];
  }
}

function safeWrite<T>(storageKey: string, values: T[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(values));
  } catch {
    // ignore quota errors in MVP
  }
}

export function createLocalStorageRepository<T>(
  storageKey: string,
  getId: (value: T) => string,
): Repository<T> {
  return {
    get: (id) => safeRead<T>(storageKey).find((v) => getId(v) === id),
    put: (value) => {
      const all = safeRead<T>(storageKey);
      const idx = all.findIndex((v) => getId(v) === getId(value));
      if (idx >= 0) all[idx] = value;
      else all.push(value);
      safeWrite(storageKey, all);
    },
    list: () => safeRead<T>(storageKey),
    delete: (id) => {
      const all = safeRead<T>(storageKey);
      const next = all.filter((v) => getId(v) !== id);
      const changed = next.length !== all.length;
      safeWrite(storageKey, next);
      return changed;
    },
  };
}

export function createLocalStorageAppendOnlyRepository<T>(
  storageKey: string,
  getId: (value: T) => string,
): AppendOnlyRepository<T> {
  return {
    get: (id) => safeRead<T>(storageKey).find((v) => getId(v) === id),
    append: (value) => {
      const all = safeRead<T>(storageKey);
      if (all.some((v) => getId(v) === getId(value))) {
        throw new AppendOnlyViolationError(getId(value));
      }
      all.push(value);
      safeWrite(storageKey, all);
    },
    list: () => safeRead<T>(storageKey),
  };
}
