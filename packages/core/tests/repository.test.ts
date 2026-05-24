import { describe, expect, it } from "vitest";
import {
  AppendOnlyViolationError,
  createInMemoryAppendOnlyRepository,
  createInMemoryRepository,
} from "@contractops/core";

interface Thing {
  id: string;
  value: number;
}

describe("Repository<T> (in-memory)", () => {
  it("supports get/put/list/delete", () => {
    const repo = createInMemoryRepository<Thing>((t) => t.id);
    repo.put({ id: "a", value: 1 });
    repo.put({ id: "b", value: 2 });
    expect(repo.list().length).toBe(2);
    expect(repo.get("a")?.value).toBe(1);

    repo.put({ id: "a", value: 10 }); // update
    expect(repo.get("a")?.value).toBe(10);

    expect(repo.delete("a")).toBe(true);
    expect(repo.get("a")).toBeUndefined();
    expect(repo.delete("nope")).toBe(false);
  });
});

describe("AppendOnlyRepository<T> (in-memory)", () => {
  it("appends new items and lists them", () => {
    const repo = createInMemoryAppendOnlyRepository<Thing>((t) => t.id);
    repo.append({ id: "x", value: 1 });
    repo.append({ id: "y", value: 2 });
    expect(repo.list().map((t) => t.id).sort()).toEqual(["x", "y"]);
  });

  it("rejects re-appending an existing id", () => {
    const repo = createInMemoryAppendOnlyRepository<Thing>((t) => t.id);
    repo.append({ id: "x", value: 1 });
    expect(() => repo.append({ id: "x", value: 99 })).toThrowError(AppendOnlyViolationError);
    expect(repo.get("x")?.value).toBe(1); // unchanged
  });

  it("has no put or delete API", () => {
    const repo = createInMemoryAppendOnlyRepository<Thing>((t) => t.id);
    // @ts-expect-error — append-only repo intentionally lacks put
    expect(repo.put).toBeUndefined();
    // @ts-expect-error — append-only repo intentionally lacks delete
    expect(repo.delete).toBeUndefined();
  });
});
