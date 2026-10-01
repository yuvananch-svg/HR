import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const runner = path.join(root, "database/scripts/web-release-rollback.mjs");
const secret = "synthetic-guard-secret-must-not-print";
const baseEnv = {
  ...process.env,
  LOCAL_TEST_CONFIRM: "I_UNDERSTAND_LOCAL_SYNTHETIC_ONLY",
  LOCAL_SUPABASE_URL: "http://127.0.0.1:54321",
  LOCAL_SUPABASE_ANON_KEY: "eyJhbGciOiJub25lIn0.eyJyb2xlIjoiYW5vbiJ9.synthetic",
  LOCAL_TEST_OWNER_EMAIL: "browser-owner@example.invalid",
  LOCAL_TEST_OWNER_PASSWORD: secret,
};
function invoke(env) {
  const result = spawnSync(process.execPath, [runner], { cwd: root, env, encoding: "utf8", timeout: 10_000 });
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

test("runner refuses to start without explicit synthetic-only confirmation", () => {
  const env = { ...baseEnv };
  delete env.LOCAL_TEST_CONFIRM;
  const output = invoke(env);
  assert.match(output, /Set LOCAL_TEST_CONFIRM/);
  assert.doesNotMatch(output, new RegExp(secret));
});

test("runner refuses remote Supabase hosts before starting worktrees or servers", () => {
  const output = invoke({ ...baseEnv, LOCAL_SUPABASE_URL: "https://production-project.supabase.co" });
  assert.match(output, /LOCAL_SUPABASE_URL must be exactly a loopback HTTP Supabase API on port 54321/);
  assert.doesNotMatch(output, new RegExp(secret));
});

test("runner refuses loopback URLs using an unexpected port", () => {
  const output = invoke({ ...baseEnv, LOCAL_SUPABASE_URL: "http://127.0.0.1:54322" });
  assert.match(output, /LOCAL_SUPABASE_URL must be exactly a loopback HTTP Supabase API on port 54321/);
  assert.doesNotMatch(output, new RegExp(secret));
});

test("runner refuses URL query or credential redirects", () => {
  const output = invoke({ ...baseEnv, LOCAL_SUPABASE_URL: "http://127.0.0.1:54321?host=production-project.supabase.co" });
  assert.match(output, /LOCAL_SUPABASE_URL must be exactly a loopback HTTP Supabase API on port 54321/);
  assert.doesNotMatch(output, new RegExp(secret));
});

test("runner refuses privileged keys in its browser-facing configuration", () => {
  const output = invoke({ ...baseEnv, LOCAL_SUPABASE_ANON_KEY: "service_role" });
  assert.match(output, /browser key must be an anon\/publishable key/);
  assert.doesNotMatch(output, new RegExp(secret));
});

test("runner requires a synthetic .invalid owner identity", () => {
  const output = invoke({ ...baseEnv, LOCAL_TEST_OWNER_EMAIL: "owner@example.com" });
  assert.match(output, /synthetic \.invalid email/);
  assert.doesNotMatch(output, new RegExp(secret));
});
