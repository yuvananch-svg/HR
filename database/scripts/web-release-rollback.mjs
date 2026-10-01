#!/usr/bin/env node
import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, lstat } from "node:fs/promises";
import { createServer } from "node:net";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "../..");
const priorRef = "819864cffa3bd72fa3229b2cea9c960893b0e74b";
const marker = "I_UNDERSTAND_LOCAL_SYNTHETIC_ONLY";
const required = ["LOCAL_SUPABASE_URL", "LOCAL_SUPABASE_ANON_KEY", "LOCAL_TEST_OWNER_EMAIL", "LOCAL_TEST_OWNER_PASSWORD"];

function fail(message) { throw new Error(message); }
function sanitized(text) {
  let value = String(text ?? "");
  for (const key of [...required, "LOCAL_TEST_CONFIRM"]) {
    const secret = process.env[key];
    if (secret) value = value.split(secret).join("[redacted]");
  }
  return value.replace(/https?:\/\/[^\s"']+/g, (raw) => {
    try { const u = new URL(raw); return `${u.origin}${u.pathname === "/" ? "" : u.pathname}`; } catch { return "[url]"; }
  });
}
function run(command, args, cwd, env = process.env) {
  const result = spawnSync(command, args, { cwd, env, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) fail(`${path.basename(command)} failed (${result.status ?? result.signal}):\n${sanitized((result.stderr || result.stdout).slice(-6000))}`);
  return result.stdout;
}
function parseLocalConfig() {
  if (process.env.LOCAL_TEST_CONFIRM !== marker) fail(`Set LOCAL_TEST_CONFIRM=${marker} to authorize the ephemeral synthetic-only rehearsal.`);
  for (const name of required) if (!process.env[name]) fail(`Missing required local test variable: ${name}`);
  const url = new URL(process.env.LOCAL_SUPABASE_URL);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname) || url.port !== "54321" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    fail("LOCAL_SUPABASE_URL must be exactly a loopback HTTP Supabase API on port 54321, without credentials, path, query, or fragment.");
  }
  if (!process.env.LOCAL_TEST_OWNER_EMAIL.toLowerCase().endsWith(".invalid")) fail("The test owner must use a synthetic .invalid email address.");
  const key = process.env.LOCAL_SUPABASE_ANON_KEY;
  if (key.toLowerCase().includes("service_role") || key.toLowerCase().startsWith("sb_secret_")) fail("The browser key must be an anon/publishable key.");
  if (key.split(".").length === 3) {
    try {
      const payload = JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString("utf8"));
      if (payload.role !== "anon") fail("The browser JWT key must have role=anon.");
    } catch (error) {
      if (String(error.message).includes("role=anon")) throw error;
      fail("The browser JWT key is malformed.");
    }
  } else if (!key.startsWith("sb_publishable_") || key.length <= "sb_publishable_".length) {
    fail("The browser key must be an anon JWT or a publishable key.");
  }
  return { url: url.origin, key, email: process.env.LOCAL_TEST_OWNER_EMAIL, password: process.env.LOCAL_TEST_OWNER_PASSWORD };
}
function safeBuildEnv(config) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith("LOCAL_")) delete env[key];
  for (const key of ["VERCEL_ENV", "NEXT_PUBLIC_VERCEL_ENV", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_TARGET", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "DATABASE_URL"]) delete env[key];
  env.NODE_ENV = "production";
  env.NEXT_TELEMETRY_DISABLED = "1";
  env.NEXT_PUBLIC_SUPABASE_URL = config.url;
  env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = config.key;
  env.NEXT_PUBLIC_SUPABASE_TARGET = "test";
  return env;
}
async function reservePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

async function rejectEnvironmentFiles(dir) {
  for (const file of [".env", ".env.local", ".env.production", ".env.production.local"]) {
    try {
      await lstat(path.join(dir, file));
      fail(`Refusing to build with environment file ${file}.`);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}
async function startWeb(dir, config) {
  const port = await reservePort();
  const env = safeBuildEnv(config);
  env.PORT = String(port);
  env.HOSTNAME = "127.0.0.1";
  const child = spawn("npm", ["run", "start", "--", "--hostname", "127.0.0.1", "--port", String(port)], { cwd: dir, env, stdio: "ignore", detached: process.platform !== "win32" });
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) fail("The isolated web server exited before becoming ready.");
    try { const response = await fetch(base, { redirect: "manual" }); if (response.status < 500) return { child, base }; } catch { /* server is still starting */ }
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  child.kill("SIGTERM");
  fail("The isolated web server did not become ready within 90 seconds.");
}
async function stopWeb(server) {
  if (!server || server.child.exitCode !== null) return;
  try { if (process.platform !== "win32") process.kill(-server.child.pid, "SIGTERM"); else server.child.kill("SIGTERM"); } catch { /* already stopped */ }
  await Promise.race([once(server.child, "exit"), new Promise(resolve => setTimeout(resolve, 5_000))]);
  if (server.child.exitCode === null) {
    try { if (process.platform !== "win32") process.kill(-server.child.pid, "SIGKILL"); else server.child.kill("SIGKILL"); } catch { /* already stopped */ }
  }
}
async function login(page, base, config, invalidAttempt = false) {
  await page.goto(`${base}/`);
  const email = page.getByLabel("อีเมล");
  const password = page.getByLabel("รหัสผ่าน");
  await email.fill(config.email);
  if (invalidAttempt) {
    await password.fill(`${config.password.slice(0, 2)}-intentionally-wrong`);
    await page.getByRole("button", { name: "เข้าสู่ระบบ" }).click();
    await page.getByRole("status").filter({ hasText: "เข้าสู่ระบบไม่ได้" }).waitFor({ state: "visible" });
    await password.fill(config.password);
  } else {
    await password.fill(config.password);
  }
  await password.press("Tab");
  const submit = page.getByRole("button", { name: "เข้าสู่ระบบ" });
  if (await submit.evaluate(el => el !== document.activeElement)) fail("Keyboard tab order did not reach the login submit button.");
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/workspace(?:$|\?)/, { timeout: 20_000 });
  await page.getByRole("heading", { name: "ภาพรวม" }).waitFor({ state: "visible" });
}
async function unauthenticatedDenial(base) {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await page.goto(`${base}/workspace`);
    await page.waitForURL(url => url.pathname === "/" || url.pathname.startsWith("/login"), { timeout: 15_000 });
    await page.getByRole("heading", { name: "เข้าสู่ระบบ" }).waitFor({ state: "visible" });
    await context.close();
  } finally { await browser.close(); }
}
function futureWorkDays(year) {
  const days = [];
  for (let day = 2; day <= 20 && days.length < 2; day++) {
    const date = new Date(Date.UTC(year, 0, day));
    if (date.getUTCDay() > 0 && date.getUTCDay() < 6) days.push(date.toISOString().slice(0, 10));
  }
  if (days.length !== 2) fail("Unable to select deterministic workdays for the synthetic leave record.");
  return days;
}
async function currentJourney(base, config) {
  const browser = await chromium.launch({ headless: true });
  const year = new Date().getUTCFullYear() + 1;
  const [leaveDate, editedLeaveDate] = futureWorkDays(year);
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
  const employeeCode = `PW-${suffix}`;
  const employeeName = `Browser${suffix}`;
  const leaveType = `Browser Leave ${suffix}`;
  const holidayName = `Synthetic Holiday ${suffix}`;
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    await login(page, base, config, true);

    await page.goto(`${base}/workspace/employees/new`);
    const employeeCodeInput = page.getByLabel("รหัสพนักงาน *");
    await employeeCodeInput.focus();
    await page.keyboard.press("Tab");
    if (await page.getByLabel("ชื่อ *").evaluate(el => el !== document.activeElement)) fail("Keyboard tab order skipped the employee name field.");
    await employeeCodeInput.fill(employeeCode);
    await page.getByLabel("ชื่อ *").fill(employeeName);
    await page.getByLabel("นามสกุล *").fill("Synthetic");
    await page.locator('input[name="start_date"]').fill(`${year}-01-01`);
    await page.getByRole("button", { name: "บันทึกข้อมูลทั่วไป" }).click();
    await page.getByRole("heading", { name: new RegExp(`${employeeName} Synthetic`) }).waitFor({ state: "visible" });
    await page.getByText(employeeCode, { exact: false }).first().waitFor({ state: "visible" });

    await page.goto(`${base}/workspace/settings?year=${year}`);
    const typeForm = page.getByLabel("ชื่อประเภทใหม่").locator("xpath=ancestor::form");
    await page.getByLabel("ชื่อประเภทใหม่").fill(leaveType);
    await typeForm.locator('input[name="sort_order"]').fill("80");
    await typeForm.getByRole("button", { name: "เพิ่มประเภท" }).click();
    await page.getByRole("status").filter({ hasText: "บันทึกประเภทลาแล้ว" }).waitFor({ state: "visible" });

    await page.goto(`${base}/workspace/settings?year=${year}`);
    // Give every active synthetic leave type a next-year standard so generation is enabled.
    for (let attempt = 0; attempt < 20; attempt++) {
      const defineQuota = page.getByRole("button", { name: "กำหนดโควตา" }).first();
      if (await defineQuota.count() === 0) break;
      const policyForm = defineQuota.locator("xpath=ancestor::form");
      await policyForm.locator('input[name="quota_days"]').fill("3");
      await defineQuota.click();
      await page.getByRole("status").filter({ hasText: "บันทึกโควตามาตรฐานแล้ว" }).waitFor({ state: "visible" });
      await page.goto(`${base}/workspace/settings?year=${year}`);
    }
    if (await page.getByRole("button", { name: "กำหนดโควตา" }).count() > 0) fail("Some active synthetic leave types still lack a next-year policy.");

    const holidayForm = page.getByLabel("ชื่อวันหยุด").locator("xpath=ancestor::form");
    await holidayForm.locator('input[name="holiday_date"]').fill(`${year}-01-01`);
    await holidayForm.getByLabel("ชื่อวันหยุด").fill(holidayName);
    await holidayForm.getByRole("button", { name: "เพิ่มวันหยุด" }).click();
    await page.getByRole("status").filter({ hasText: "บันทึกวันหยุดแล้ว" }).waitFor({ state: "visible" });
    await page.getByRole("button", { name: `สร้างสิทธิ์พนักงานปี ${year}` }).click();
    await page.getByRole("status").filter({ hasText: "สร้างสิทธิ์ที่ขาด" }).waitFor({ state: "visible" });

    await page.goto(`${base}/workspace/leave?year=${year}`);
    await page.getByRole("heading", { name: "บันทึกวันลา", exact: true }).waitFor({ state: "visible" });
    const leaveForm = page.locator("form").filter({ has: page.getByRole("button", { name: "ดูตัวอย่างวันลา" }) });
    const employeeSelect = leaveForm.locator('select[name="employee_id"]');
    const employeeOption = await employeeSelect.locator("option").filter({ hasText: employeeCode }).getAttribute("value");
    if (!employeeOption) fail("The created synthetic employee was not available in the leave form.");
    await employeeSelect.selectOption(employeeOption);
    await leaveForm.locator('select[name="leave_type_id"]').selectOption({ label: leaveType });
    await leaveForm.locator('input[name="start_date"]').fill(leaveDate);
    await leaveForm.locator('input[name="end_date"]').fill(leaveDate);
    await leaveForm.getByLabel("เหตุผลการลา").fill("synthetic browser release acceptance");
    await leaveForm.getByRole("button", { name: "ดูตัวอย่างวันลา" }).click();
    await page.getByRole("region", { name: "ตัวอย่างวันลา" }).waitFor({ state: "visible" });
    await page.getByLabel("ฉันตรวจสอบวันที่และยอดคงเหลือแล้ว").check();
    await page.getByRole("button", { name: "ยืนยันบันทึกวันลา" }).click();
    await page.getByRole("heading", { name: new RegExp(`${employeeName} Synthetic`) }).waitFor({ state: "visible" });
    const leaveId = new URL(page.url()).pathname.split("/").at(-1);
    if (!/^[0-9a-f-]{36}$/i.test(leaveId ?? "")) fail("The saved leave record did not open its detail page.");
    await page.locator("p").filter({ hasText: leaveType }).filter({ hasText: "บันทึกแล้ว" }).first().waitFor({ state: "visible" });

    await page.getByRole("heading", { name: "แก้ไขรายการ" }).scrollIntoViewIfNeeded();
    const editForm = page.locator("form").filter({ has: page.getByLabel("เหตุผลการแก้ไข") });
    await editForm.locator('input[name="start_date"]').fill(editedLeaveDate);
    await editForm.locator('input[name="end_date"]').fill(editedLeaveDate);
    await page.getByLabel("เหตุผลการแก้ไข").fill("synthetic edit rehearsal");
    await editForm.getByRole("button", { name: "ดูตัวอย่างวันลา" }).click();
    await page.getByRole("region", { name: "ตัวอย่างวันลา" }).waitFor({ state: "visible" });
    await page.getByLabel("ฉันตรวจสอบวันที่และยอดคงเหลือแล้ว").check();
    await page.getByRole("button", { name: "ยืนยันบันทึกวันลา" }).click();
    await page.locator("p").filter({ hasText: leaveType }).filter({ hasText: editedLeaveDate }).first().waitFor({ state: "visible" });

    page.once("dialog", dialog => dialog.accept());
    await page.getByLabel("เหตุผลการยกเลิก").fill("synthetic cancellation rehearsal");
    await page.getByRole("button", { name: "ยกเลิกรายการ" }).click();
    await page.locator("p").filter({ hasText: leaveType }).filter({ hasText: "ยกเลิกแล้ว" }).first().waitFor({ state: "visible" });
    await page.getByText("ประวัติการเปลี่ยนแปลง", { exact: true }).waitFor({ state: "visible" });

    await page.goto(`${base}/workspace/leave?year=${year}`);
    await page.getByLabel("ค้นหาชื่อหรือรหัส").fill(employeeCode);
    await page.getByRole("button", { name: "กรอง" }).click();
    await page.getByRole("link", { name: new RegExp(employeeCode) }).filter({ hasText: leaveType }).waitFor({ state: "visible" });
    await page.goto(`${base}/workspace`);
    await page.getByRole("heading", { name: "ภาพรวม" }).waitFor({ state: "visible" });
    await page.getByText(employeeName, { exact: false }).first().waitFor({ state: "visible" });
    await context.close();

    const mobile = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
    const mobilePage = await mobile.newPage();
    await login(mobilePage, base, config);
    for (const route of ["/workspace", "/workspace/employees", "/workspace/settings?year=" + year, "/workspace/leave?year=" + year]) {
      await mobilePage.goto(base + route);
      await mobilePage.waitForLoadState("domcontentloaded");
      const width = await mobilePage.evaluate(() => ({ viewport: document.documentElement.clientWidth, page: document.documentElement.scrollWidth }));
      if (width.page > width.viewport + 2) fail(`Mobile horizontal overflow on ${route}.`);
    }
    await mobilePage.getByRole("button", { name: "ออกจากระบบ" }).click();
    await mobilePage.waitForURL(url => url.pathname === "/", { timeout: 15_000 });
    await mobilePage.goto(`${base}/workspace`);
    await mobilePage.waitForURL(url => url.pathname === "/", { timeout: 15_000 });
    await mobile.close();
    return { employeeCode, employeeName, leaveType, holidayName, year, leaveDate: editedLeaveDate, leaveId };
  } finally { await browser.close(); }
}
async function smokeExisting(base, config, fixture) {
  await unauthenticatedDenial(base);
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    await login(page, base, config);
    await page.goto(`${base}/workspace`);
    await page.getByRole("heading", { name: "ภาพรวม" }).waitFor({ state: "visible" });
    await page.getByText(fixture.employeeName, { exact: false }).first().waitFor({ state: "visible" });
    await page.goto(`${base}/workspace/leave?year=${fixture.year}`);
    await page.getByLabel("ค้นหาชื่อหรือรหัส").fill(fixture.employeeCode);
    await page.locator('select[name="status"]').selectOption("cancelled");
    await page.getByRole("button", { name: "กรอง" }).click();
    await page.getByRole("link", { name: new RegExp(fixture.employeeCode) }).filter({ hasText: fixture.leaveType }).waitFor({ state: "visible" });
    const width = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, page: document.documentElement.scrollWidth }));
    if (width.page > width.viewport + 2) fail("Mobile history view overflows the viewport.");
    await context.close();
  } finally { await browser.close(); }
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
async function databaseInvariant(config, fixture) {
  const client = createClient(config.url, config.key, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: auth, error: authError } = await client.auth.signInWithPassword({ email: config.email, password: config.password });
  if (authError || !auth.session) fail("Database invariant login failed for the synthetic owner.");
  const memberResult = await client.from("app_users").select("id,role,is_active").eq("id", auth.user.id).maybeSingle();
  if (memberResult.error || !memberResult.data || memberResult.data.role !== "owner" || !memberResult.data.is_active) fail("The synthetic owner membership invariant failed.");
  const results = await Promise.all([
    client.from("employees").select("id,employee_code,first_name,last_name,status,start_date").order("employee_code"),
    client.from("leave_types").select("id,name,is_active,sort_order").order("name"),
    client.from("leave_policy_defaults").select("id,leave_type_id,year,quota_days").order("year").order("leave_type_id"),
    client.from("leave_entitlements").select("id,employee_id,leave_type_id,year,quota_days,source").order("year").order("employee_id").order("leave_type_id"),
    client.from("holidays").select("id,holiday_date,name").order("holiday_date"),
    client.from("leave_entries").select("id,employee_id,leave_type_id,start_date,end_date,day_unit,half_period,reason,status,change_reason").order("id"),
    client.from("leave_entry_days").select("id,leave_entry_id,leave_date,days,half_period").order("id"),
    client.from("audit_events").select("id,actor_id,table_name,record_id,action,reason,changed_fields,before_values,after_values").order("id"),
  ]);
  if (results.some(result => result.error)) fail("An authenticated PostgREST database invariant query failed.");
  const [employees, types, policies, entitlements, holidays, entries, days, audits] = results.map(result => result.data ?? []);
  const employee = employees.find(row => row.employee_code === fixture.employeeCode);
  const type = types.find(row => row.name === fixture.leaveType);
  const entry = entries.find(row => row.id === fixture.leaveId);
  const holiday = holidays.find(row => row.name === fixture.holidayName);
  if (!employee || !type || !entry || !holiday) fail("A synthetic employee, leave type, leave record, or holiday is missing after a version swap.");
  const policy = policies.find(row => row.leave_type_id === type.id && row.year === fixture.year);
  const entitlement = entitlements.find(row => row.employee_id === employee.id && row.leave_type_id === type.id && row.year === fixture.year);
  if (!policy || Number(policy.quota_days) !== 3 || !entitlement || Number(entitlement.quota_days) !== 3) fail("The synthetic policy/entitlement invariant failed after a version swap.");
  if (entry.status !== "cancelled" || entry.start_date !== fixture.leaveDate || entry.end_date !== fixture.leaveDate) fail("The synthetic leave state changed across a version swap.");
  const entryDays = days.filter(row => row.leave_entry_id === entry.id);
  if (entryDays.length !== 1 || Number(entryDays[0].days) !== 1 || entryDays[0].leave_date !== fixture.leaveDate) fail("The synthetic leave-day ledger changed across a version swap.");
  if (audits.filter(row => row.table_name === "leave_entries" && row.record_id === entry.id).length < 3) fail("The synthetic leave audit history is incomplete after a version swap.");
  const response = await fetch(`${config.url}/rest/v1/`, { headers: { apikey: config.key, authorization: `Bearer ${auth.session.access_token}`, accept: "application/openapi+json" } });
  if (!response.ok) fail(`Authenticated PostgREST schema surface returned HTTP ${response.status}.`);
  const openapi = await response.json();
  const schemaHash = createHash("sha256").update(JSON.stringify(canonical(openapi))).digest("hex");
  const graph = canonical({ membership: memberResult.data, employees, types, policies, entitlements, holidays, entries, days, audits });
  const dataHash = createHash("sha256").update(JSON.stringify(graph)).digest("hex");
  return { dataHash, schemaHash };
}
function assertInvariantEqual(expected, actual, stage) {
  if (expected.dataHash !== actual.dataHash) fail(`${stage} changed the authenticated synthetic application graph.`);
  if (expected.schemaHash !== actual.schemaHash) fail(`${stage} changed the authenticated PostgREST schema surface.`);
  console.log(`${stage}: data=${actual.dataHash.slice(0, 16)}, schema=${actual.schemaHash.slice(0, 16)} (stable)`);
}

async function main() {
  const config = parseLocalConfig();
  const available = run("git", ["cat-file", "-e", `${priorRef}^{commit}`], root);
  void available;
  const currentRef = run("git", ["rev-parse", "HEAD"], root).trim();
  run("git", ["merge-base", "--is-ancestor", priorRef, currentRef], root);
  const temp = await mkdtemp(path.join(os.tmpdir(), "hr-web-release-rollback-"));
  const currentDir = path.join(temp, "current");
  const priorDir = path.join(temp, "prior");
  let fixture;
  try {
    console.log(`Release rehearsal on isolated local Supabase (${new URL(config.url).host}); source=${currentRef.slice(0, 12)}, prior=${priorRef}.`);
    run("git", ["worktree", "add", "--detach", currentDir, currentRef], root);
    run("git", ["worktree", "add", "--detach", priorDir, priorRef], root);
    await rejectEnvironmentFiles(currentDir);
    await rejectEnvironmentFiles(priorDir);
    console.log("release: installing dependencies from the current source lockfile");
    run("npm", ["ci", "--include=dev", "--no-audit", "--no-fund"], currentDir, safeBuildEnv(config));
    console.log("release: building current candidate");
    run("npm", ["run", "build"], currentDir, safeBuildEnv(config));
    let server = await startWeb(currentDir, config);
    try {
      console.log("release: authenticated employee, policy, leave preview/save/edit/cancel/history/dashboard, mobile and keyboard journey");
      fixture = await currentJourney(server.base, config);
      fixture.invariants = await databaseInvariant(config, fixture);
    } finally { await stopWeb(server); }

    console.log(`rollback: installing dependencies from ${priorRef} lockfile`);
    run("npm", ["ci", "--include=dev", "--no-audit", "--no-fund"], priorDir, safeBuildEnv(config));
    run("npm", ["run", "build"], priorDir, safeBuildEnv(config));
    server = await startWeb(priorDir, config);
    try {
      console.log(`rollback: old source ${priorRef} against unchanged local schema and current synthetic rows`);
      await smokeExisting(server.base, config, fixture);
      assertInvariantEqual(fixture.invariants, await databaseInvariant(config, fixture), "rollback");
    } finally { await stopWeb(server); }

    console.log(`restore: rebuilding current candidate ${currentRef.slice(0, 12)} against the same database`);
    run("npm", ["run", "build"], currentDir, safeBuildEnv(config));
    server = await startWeb(currentDir, config);
    try {
      await smokeExisting(server.base, config, fixture);
      assertInvariantEqual(fixture.invariants, await databaseInvariant(config, fixture), "restore");
    } finally { await stopWeb(server); }
    console.log("PASS: current release journey, compatible prior-version rollback smoke, and current-version restoration smoke passed on one ephemeral local Supabase database.");
    console.log("Synthetic rows are confined to the disposable CI Supabase stack; fixture values are omitted from logs.");
  } finally {
    try { run("git", ["worktree", "remove", "--force", currentDir], root); } catch { /* remove the other worktree even if this one fails */ }
    try { run("git", ["worktree", "remove", "--force", priorDir], root); } catch { /* remove the other worktree even if this one fails */ }
    try { run("git", ["worktree", "prune"], root); } catch { /* temporary worktrees have already been removed */ }
    await rm(temp, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(sanitized(error?.stack ?? error)); process.exitCode = 1; });
