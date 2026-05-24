export interface Env {
  newId: () => string;
  now: () => string;
}

export function createCounterIdGenerator(prefix = "id"): () => string {
  let i = 0;
  return () => `${prefix}_${++i}`;
}

export function createFixedClock(start: string, tickMs = 1000): () => string {
  let t = new Date(start).getTime();
  return () => {
    const iso = new Date(t).toISOString();
    t += tickMs;
    return iso;
  };
}

export const systemClock: () => string = () => new Date().toISOString();
