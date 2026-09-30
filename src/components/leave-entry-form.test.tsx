import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  previewLeaveAction: vi.fn(),
  saveLeaveAction: vi.fn(),
  push: vi.fn(),
}));
vi.mock("@/app/workspace/leave/actions", () => ({
  previewLeaveAction: mocks.previewLeaveAction,
  saveLeaveAction: mocks.saveLeaveAction,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));

import { LeaveEntryForm } from "./leave-entry-form";

const employeeId = "11111111-1111-4111-8111-111111111111";
const typeId = "22222222-2222-4222-8222-222222222222";
const preview = {
  days: [{ leave_date: "2026-10-01", days: 1, half_period: null, counts: true, reason: null }],
  balances: [{ year: 2026, quota_days: 10, used_before: 2, requested_days: 1, used_after: 3, remaining_after: 7 }],
  fingerprint: "fingerprint-v1",
};
const employees = [{ id: employeeId, employee_code: "E-1", first_name: "Ada", last_name: "Lovelace", status: "active", start_date: "2020-01-01", termination_date: null }];
const types = [{ id: typeId, name: "พักร้อน", is_active: true }];

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}
function formElement() { return screen.getByRole("button", { name: /ตัวอย่างวันลา/ }).closest("form") as HTMLFormElement; }
async function previewAndConfirm() {
  fireEvent.click(screen.getByRole("button", { name: /ดูตัวอย่างวันลา/ }));
  await screen.findByRole("region", { name: "ตัวอย่างวันลา" });
  fireEvent.click(screen.getByRole("checkbox", { name: /ตรวจสอบวันที่และยอดคงเหลือแล้ว/ }));
}

describe("LeaveEntryForm preview gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.previewLeaveAction.mockResolvedValue({ success: true, preview });
    mocks.saveLeaveAction.mockResolvedValue({ success: false, message: "บันทึกไม่สำเร็จ", errors: {} });
  });

  it("requires a fresh preview and explicit confirmation before enabling save", async () => {
    render(<LeaveEntryForm employees={employees} types={types} />);
    const submit = screen.getByRole("button", { name: /ยืนยันบันทึกวันลา/ });
    expect(submit).toBeDisabled();
    await previewAndConfirm();
    expect(submit).toBeEnabled();
    expect(screen.getByText("2026-10-01 · 1 วัน")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
  });

  it("ignores a preview response that finishes after the form has changed", async () => {
    const request = deferred<{ success: boolean; preview: typeof preview }>();
    mocks.previewLeaveAction.mockReturnValueOnce(request.promise);
    render(<LeaveEntryForm employees={employees} types={types} />);
    fireEvent.click(screen.getByRole("button", { name: /ดูตัวอย่างวันลา/ }));
    expect(screen.getByRole("button", { name: /ดูตัวอย่างวันลา/ })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("เหตุผลการลา"), { target: { value: "เปลี่ยนเหตุผลหลังเริ่มตรวจ" } });
    request.resolve({ success: true, preview });
    await waitFor(() => expect(screen.queryByRole("region", { name: "ตัวอย่างวันลา" })).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: /ยืนยันบันทึกวันลา/ })).toBeDisabled();
  });

  it("invalidates a displayed preview when any leave input changes", async () => {
    render(<LeaveEntryForm employees={employees} types={types} />);
    await previewAndConfirm();
    fireEvent.change(screen.getByLabelText("วันที่เริ่มต้น"), { target: { value: "2026-10-03" } });
    await waitFor(() => expect(screen.queryByRole("region", { name: "ตัวอย่างวันลา" })).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: /ยืนยันบันทึกวันลา/ })).toBeDisabled();
  });

  it("clears confirmation after a stale-preview save error and requires a fresh preview", async () => {
    mocks.saveLeaveAction.mockResolvedValueOnce({
      success: false, code: "preview_changed", message: "ข้อมูลวันลาเปลี่ยนหลังดูตัวอย่าง กรุณาตรวจสอบตัวอย่างใหม่", errors: {},
    });
    render(<LeaveEntryForm employees={employees} types={types} />);
    await previewAndConfirm();
    fireEvent.submit(formElement());
    await screen.findByRole("alert");
    await waitFor(() => expect(screen.queryByRole("region", { name: "ตัวอย่างวันลา" })).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: /ยืนยันบันทึกวันลา/ })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /ดูตัวอย่างวันลา/ }));
    await screen.findByRole("region", { name: "ตัวอย่างวันลา" });
    const confirmation = screen.getByRole("checkbox", { name: /ตรวจสอบวันที่และยอดคงเหลือแล้ว/ });
    expect(confirmation).not.toBeChecked();
    expect(screen.getByRole("button", { name: /ยืนยันบันทึกวันลา/ })).toBeDisabled();
    fireEvent.click(confirmation);
    expect(screen.getByRole("button", { name: /ยืนยันบันทึกวันลา/ })).toBeEnabled();
  });

  it("limits the leave reason to the same 500 characters accepted by storage", () => {
    render(<LeaveEntryForm employees={employees} types={types} />);
    expect(screen.getByLabelText("เหตุผลการลา")).toHaveAttribute("maxLength", "500");
  });

  it("keeps entered values and the request key after a failed save so retry is idempotent", async () => {
    render(<LeaveEntryForm employees={employees} types={types} />);
    fireEvent.change(screen.getByLabelText("เหตุผลการลา"), { target: { value: "เหตุผลที่กรอกไว้" } });
    await previewAndConfirm();
    const key = (formElement().elements.namedItem("request_key") as HTMLInputElement).value;
    fireEvent.submit(formElement());
    await screen.findByRole("alert");
    expect((screen.getByLabelText("เหตุผลการลา") as HTMLTextAreaElement).value).toBe("เหตุผลที่กรอกไว้");
    expect((formElement().elements.namedItem("request_key") as HTMLInputElement).value).toBe(key);
    expect(mocks.saveLeaveAction).toHaveBeenCalled();
    expect((mocks.saveLeaveAction.mock.calls[0][1] as FormData).get("request_key")).toBe(key);
    fireEvent.submit(formElement());
    await waitFor(() => expect(mocks.saveLeaveAction).toHaveBeenCalledTimes(2));
    expect((mocks.saveLeaveAction.mock.calls[1][1] as FormData).get("request_key")).toBe(key);
  });

  it("disables the save control while a write is pending", async () => {
    const write = deferred<{ success: boolean; message: string; errors: Record<string, string[]> }>();
    mocks.saveLeaveAction.mockReturnValueOnce(write.promise);
    render(<LeaveEntryForm employees={employees} types={types} />);
    await previewAndConfirm();
    fireEvent.submit(formElement());
    await waitFor(() => expect(screen.getByRole("button", { name: /กำลังบันทึก/ })).toBeDisabled());
    write.resolve({ success: false, message: "ลองใหม่", errors: {} });
  });

  it("forwards the existing revision on edits while keeping actor identity server-owned", async () => {
    render(<LeaveEntryForm employees={employees} types={types} editing initial={{
      employee_id: employeeId, leave_type_id: typeId, start_date: "2026-10-01", end_date: "2026-10-01",
      entry_id: "33333333-3333-4333-8333-333333333333", expected_revision: "revision-8",
    }} />);
    await previewAndConfirm();
    fireEvent.change(screen.getByLabelText("เหตุผลการแก้ไข"), { target: { value: "แก้ไขวันลา" } });
    // Editing the reason invalidates the preview, so preview again with the final form values.
    await previewAndConfirm();
    fireEvent.submit(formElement());
    await screen.findByRole("alert");
    const submitted = mocks.saveLeaveAction.mock.calls[0][1] as FormData;
    expect(submitted.get("entry_id")).toBe("33333333-3333-4333-8333-333333333333");
    expect(submitted.get("expected_revision")).toBe("revision-8");
    expect(submitted.get("change_reason")).toBe("แก้ไขวันลา");
    expect(submitted.has("actor_id")).toBe(false);
  });
});
