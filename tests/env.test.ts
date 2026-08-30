import { afterEach, describe, expect, it, vi } from "vitest";
import {
  siteUrl,
  softDeleteRetentionDays,
  supabaseAnonKey,
  supabaseServiceRoleKey,
  supabaseUrl,
} from "../lib/env";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("required Supabase environment values", () => {
  it("returns configured values", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");

    expect(supabaseUrl()).toBe("https://example.supabase.co");
    expect(supabaseAnonKey()).toBe("anon-key");
    expect(supabaseServiceRoleKey()).toBe("service-role-key");
  });

  it("names a missing required variable in the error", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");

    expect(() => supabaseUrl()).toThrow("NEXT_PUBLIC_SUPABASE_URL");
  });
});

describe("runtime defaults", () => {
  it.each([
    [undefined, 30],
    ["14", 14],
    ["0", 30],
    ["-3", 30],
    ["3.5", 30],
    ["999999999", 30],
    ["not-a-number", 30],
  ])("maps retention value %s to %i days", (raw, expected) => {
    vi.stubEnv("SOFT_DELETE_RETENTION_DAYS", raw);

    expect(softDeleteRetentionDays()).toBe(expected);
  });

  it("uses the public site URL when configured and otherwise the fallback", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://photos.example.com");
    expect(siteUrl("http://localhost:3000")).toBe(
      "https://photos.example.com",
    );

    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    expect(siteUrl("http://localhost:3000")).toBe("http://localhost:3000");
  });
});
