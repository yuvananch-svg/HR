import { describe, expect, it } from "vitest";
import { resolveSupabaseConfig } from "./config";

const safe = {
  url: "https://fixture.supabase.co",
  key: "sb_publishable_ci_fixture_key",
  target: "test",
};

describe("Supabase environment configuration", () => {
  it("accepts a complete explicit non-production fixture", () => {
    expect(resolveSupabaseConfig(safe)).toEqual({ ...safe });
  });

  it("requires target, URL, and key instead of embedded defaults", () => {
    expect(() => resolveSupabaseConfig({ ...safe, target: undefined })).toThrow("NEXT_PUBLIC_SUPABASE_TARGET");
    expect(() => resolveSupabaseConfig({ ...safe, url: undefined })).toThrow("NEXT_PUBLIC_SUPABASE_URL");
    expect(() => resolveSupabaseConfig({ ...safe, key: undefined })).toThrow("NEXT_PUBLIC_SUPABASE_URL");
  });

  it("rejects invalid URLs and privileged keys", () => {
    expect(() => resolveSupabaseConfig({ ...safe, url: "http://fixture.supabase.co" })).toThrow("HTTPS");
    expect(() => resolveSupabaseConfig({ ...safe, key: "service_role" })).toThrow("service_role or secret");
    expect(() => resolveSupabaseConfig({ ...safe, key: "sb_secret_ci_fixture" })).toThrow("service_role or secret");
    const serviceJwt = `header.${btoa(JSON.stringify({ role: "service_role" }))}.sig`;
    expect(() => resolveSupabaseConfig({ ...safe, key: serviceJwt })).toThrow("service_role or secret");
    const anonJwt = `header.${btoa(JSON.stringify({ role: "anon" }))}.sig`;
    expect(resolveSupabaseConfig({ ...safe, key: anonJwt }).key).toBe(anonJwt);
  });

  it("allows local HTTP only for development and test targets", () => {
    expect(resolveSupabaseConfig({ ...safe, url: "http://127.0.0.1:54321", target: "development" }).url).toBe("http://127.0.0.1:54321");
    expect(() => resolveSupabaseConfig({ ...safe, url: "http://127.0.0.1:54321", target: "preview" })).toThrow("HTTPS");
  });

  it("blocks development and preview from the known production project", () => {
    const url = "https://kedohmbtpegupndldkex.supabase.co";
    expect(() => resolveSupabaseConfig({ ...safe, url, target: "development" })).toThrow("cannot use the production project");
    expect(() => resolveSupabaseConfig({ ...safe, url, target: "preview" })).toThrow("cannot use the production project");
  });

  it("requires an explicit production target and approved production URL", () => {
    const url = "https://kedohmbtpegupndldkex.supabase.co";
    expect(() => resolveSupabaseConfig({ ...safe, url, target: "test" })).toThrow("cannot use the production project");
    expect(resolveSupabaseConfig({ ...safe, url, target: "production", vercelEnvironment: "production" }).target).toBe("production");
    expect(() => resolveSupabaseConfig({ ...safe, url: "https://other.supabase.co", target: "production" })).toThrow("approved production");
  });

  it("allows the legacy fallback only in a fully marked production runtime", () => {
    expect(resolveSupabaseConfig({ vercelEnvironment: "production", nodeEnvironment: "production" }).url)
      .toBe("https://kedohmbtpegupndldkex.supabase.co");
    expect(() => resolveSupabaseConfig({ vercelEnvironment: "production", nodeEnvironment: "production", url: "" }))
      .toThrow("NEXT_PUBLIC_SUPABASE_URL");
    expect(() => resolveSupabaseConfig({ target: "production", vercelEnvironment: "production", nodeEnvironment: "development" }))
      .toThrow("NEXT_PUBLIC_SUPABASE_URL");
    expect(() => resolveSupabaseConfig({ ...safe, target: "production", nodeEnvironment: "development" }))
      .toThrow("only valid in a production Node.js runtime");
  });

  it("ties Vercel deployment environment to the explicit target", () => {
    expect(() => resolveSupabaseConfig({ ...safe, target: "test", vercelEnvironment: "production" })).toThrow("requires NEXT_PUBLIC_SUPABASE_TARGET=production");
    expect(() => resolveSupabaseConfig({ ...safe, target: "test", vercelEnvironment: "preview" })).toThrow("requires NEXT_PUBLIC_SUPABASE_TARGET=preview");
    expect(() => resolveSupabaseConfig({ ...safe, target: "production", vercelEnvironment: "preview" })).toThrow("only valid in a Vercel production");
  });
});
