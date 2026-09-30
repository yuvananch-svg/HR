import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireStaff: vi.fn(),
  previewLeave: vi.fn(),
  revalidatePath: vi.fn(),
  client: { rpc: vi.fn(), from: vi.fn() },
}));
vi.mock("@/lib/auth", () => ({ requireStaff: mocks.requireStaff }));
vi.mock("@/lib/leave-server", () => ({ previewLeave: mocks.previewLeave }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import { cancelLeaveAction, previewLeaveAction, saveLeaveAction } from "./actions";

const employeeId = "11111111-1111-4111-8111-111111111111";
const leaveTypeId = "22222222-2222-4222-8222-222222222222";
const entryId = "33333333-3333-4333-8333-333333333333";
const requestKey = "44444444-4444-4444-8444-444444444444";
const revision = "2026-09-30T12:00:00Z";
const fingerprint = "preview-fingerprint";
const blank = { success: false, message: "", errors: {} };

function form(values: Record<string, string>) {
  const result = new FormData();
  for (const [key, value] of Object.entries(values)) result.set(key, value);
  return result;
}
function valid(values: Record<string, string> = {}) {
  return form({
    employee_id: employeeId, leave_type_id: leaveTypeId,
    start_date: "2026-10-01", end_date: "2026-10-02", unit: "full",
    reason: "พักผ่อน", preview_fingerprint: fingerprint, request_key: requestKey,
    ...values,
  });
}

describe("leave server actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireStaff.mockResolvedValue({ client: mocks.client });
    mocks.client.rpc.mockResolvedValue({ data: entryId, error: null });
    mocks.previewLeave.mockResolvedValue({ days: [], balances: [], fingerprint });
  });

  it("requires staff before previewing or saving", async () => {
    mocks.requireStaff.mockRejectedValue(new Error("NEXT_REDIRECT"));
    await expect(previewLeaveAction(valid())).rejects.toThrow("NEXT_REDIRECT");
    await expect(saveLeaveAction(blank, valid())).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.previewLeave).not.toHaveBeenCalled();
    expect(mocks.client.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["impossible calendar dates", { start_date: "2026-02-30" }],
    ["half-day ranges spanning multiple dates", { unit: "morning", start_date: "2026-10-01", end_date: "2026-10-02" }],
    ["reasons over the 500-character limit", { reason: "x".repeat(501) }],
  ])("rejects %s before calling the write RPC", async (_label, values) => {
    const result = await saveLeaveAction(blank, valid(values));
    expect(result.success).toBe(false);
    expect(mocks.client.rpc).not.toHaveBeenCalled();
  });

  it("returns field errors for an impossible date without previewing", async () => {
    const result = await previewLeaveAction(valid({ end_date: "2026-02-30" }));
    expect(result.success).toBe(false);
    expect((result as { errors: Record<string, string[]> }).errors.end_date).toBeTruthy();
    expect(mocks.previewLeave).not.toHaveBeenCalled();
  });

  it("rejects ranges longer than 3,660 days with a Thai field error before preview or write", async () => {
    const longRange = valid({ start_date: "2010-01-01", end_date: "2021-01-01" });
    const previewResult = await previewLeaveAction(longRange);
    expect(previewResult.success).toBe(false);
    expect((previewResult as { errors: Record<string, string[]> }).errors.end_date[0]).toContain("3,660 วันปฏิทิน");
    expect(mocks.previewLeave).not.toHaveBeenCalled();

    const saveResult = await saveLeaveAction(blank, longRange);
    expect(saveResult.success).toBe(false);
    expect(saveResult.errors.end_date?.[0]).toContain("3,660 วันปฏิทิน");
    expect(mocks.client.rpc).not.toHaveBeenCalled();
  });

  it("maps a plain Supabase leave-range error to a clear Thai technical message", async () => {
    mocks.previewLeave.mockRejectedValue({ code: "P0001", message: "leave_range_too_long" });
    const result = await previewLeaveAction(valid());
    expect(result.success).toBe(false);
    expect(result.message).toBe("ระบบรับช่วงวันที่ไม่เกิน 3,660 วันปฏิทินต่อรายการ เพื่อควบคุมการประมวลผล");
    expect(result.message).not.toContain("leave_range_too_long");
  });

  it("maps a plain Supabase quota error to a safe Thai message", async () => {
    mocks.client.rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "quota_exceeded" } });
    const result = await saveLeaveAction(blank, valid());
    expect(result.message).toBe("ยอดสิทธิ์คงเหลือไม่เพียงพอ");
    expect(result.message).not.toContain("quota_exceeded");
  });

  it("requires an accepted preview and confirmation fingerprint before saving", async () => {
    const result = await saveLeaveAction(blank, valid({ preview_fingerprint: "" }));
    expect(result.success).toBe(false);
    expect(result.message).toContain("ตัวอย่าง");
    expect(mocks.client.rpc).not.toHaveBeenCalled();
  });

  it("forwards edit revision and change reason without accepting an actor field", async () => {
    const result = await saveLeaveAction(blank, valid({
      entry_id: entryId, expected_revision: revision, change_reason: "แก้วันที่ตามคำขอ",
      actor_id: "99999999-9999-4999-8999-999999999999",
    }));
    expect(result.success).toBe(true);
    expect(mocks.client.rpc).toHaveBeenCalledWith("save_leave_entry", expect.objectContaining({
      p_entry_id: entryId, p_expected_revision: revision, p_change_reason: "แก้วันที่ตามคำขอ",
    }));
    const args = mocks.client.rpc.mock.calls[0][1];
    expect(args).not.toHaveProperty("actor_id");
  });

  it("revalidates leave balances for the employee and workspace after a save", async () => {
    await saveLeaveAction(blank, valid());
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/workspace/leave");
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/workspace/leave/${entryId}`);
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/workspace/employees/${employeeId}`);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/workspace");
  });

  it("forwards cancellation revision and reason, then revalidates the employee balance", async () => {
    const builder = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn() };
    builder.select.mockReturnValue(builder); builder.eq.mockReturnValue(builder);
    builder.maybeSingle.mockResolvedValue({ data: { employee_id: employeeId }, error: null });
    mocks.client.from.mockReturnValue(builder);
    const result = await cancelLeaveAction(blank, form({
      entry_id: entryId, expected_revision: revision, reason: "พนักงานยกเลิก", request_key: requestKey,
      actor_id: "99999999-9999-4999-8999-999999999999",
    }));
    expect(result.success).toBe(true);
    expect(mocks.client.rpc).toHaveBeenCalledWith("cancel_leave_entry", expect.objectContaining({
      p_entry_id: entryId, p_expected_revision: revision, p_reason: "พนักงานยกเลิก", p_request_key: requestKey,
    }));
    expect(mocks.client.rpc.mock.calls[0][1]).not.toHaveProperty("actor_id");
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/workspace/employees/${employeeId}`);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/workspace");
  });
});
