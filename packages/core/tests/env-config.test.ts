import { describe, expect, it } from "vitest";
import { DEFAULT_ENV_CONFIG, readEnvConfig } from "@contractops/core";

describe("readEnvConfig", () => {
  it("returns mock defaults when env is empty", () => {
    const cfg = readEnvConfig({});
    expect(cfg.USE_REAL_LLM).toBe(false);
    expect(cfg.OPENAI_API_KEY).toBeNull();
    expect(cfg.ANTHROPIC_API_KEY).toBeNull();
    expect(cfg.GOOGLE_API_KEY).toBeNull();
    expect(cfg.LLM_PROVIDER_ALLOWLIST).toEqual([]);
    expect(cfg.LLM_LOG_PROMPTS).toBe(false);
  });

  it("treats 'true', '1', 'yes', 'on' as truthy", () => {
    expect(readEnvConfig({ USE_REAL_LLM: "true" }).USE_REAL_LLM).toBe(true);
    expect(readEnvConfig({ USE_REAL_LLM: "1" }).USE_REAL_LLM).toBe(true);
    expect(readEnvConfig({ USE_REAL_LLM: "yes" }).USE_REAL_LLM).toBe(true);
    expect(readEnvConfig({ USE_REAL_LLM: "on" }).USE_REAL_LLM).toBe(true);
  });

  it("treats 'false', '0', 'no', 'off', empty as falsy", () => {
    expect(readEnvConfig({ USE_REAL_LLM: "false" }).USE_REAL_LLM).toBe(false);
    expect(readEnvConfig({ USE_REAL_LLM: "0" }).USE_REAL_LLM).toBe(false);
    expect(readEnvConfig({ USE_REAL_LLM: "no" }).USE_REAL_LLM).toBe(false);
    expect(readEnvConfig({ USE_REAL_LLM: "off" }).USE_REAL_LLM).toBe(false);
    expect(readEnvConfig({ USE_REAL_LLM: "" }).USE_REAL_LLM).toBe(false);
  });

  it("parses LLM_PROVIDER_ALLOWLIST as comma-separated list", () => {
    expect(readEnvConfig({ LLM_PROVIDER_ALLOWLIST: "openai,anthropic" }).LLM_PROVIDER_ALLOWLIST).toEqual([
      "openai",
      "anthropic",
    ]);
    expect(readEnvConfig({ LLM_PROVIDER_ALLOWLIST: " openai , google " }).LLM_PROVIDER_ALLOWLIST).toEqual([
      "openai",
      "google",
    ]);
  });

  it("DEFAULT_ENV_CONFIG matches the empty-env reading", () => {
    expect(DEFAULT_ENV_CONFIG).toEqual(readEnvConfig({}));
  });

  it("never holds an API key by default", () => {
    expect(DEFAULT_ENV_CONFIG.OPENAI_API_KEY).toBeNull();
    expect(DEFAULT_ENV_CONFIG.ANTHROPIC_API_KEY).toBeNull();
    expect(DEFAULT_ENV_CONFIG.GOOGLE_API_KEY).toBeNull();
  });
});
