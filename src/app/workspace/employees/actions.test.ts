import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyActionState } from "@/lib/employees";

const mocks = vi.hoisted(() => ({
  requireStaff: vi.fn(), insertEmployee: vi.fn(), updateEmployeeRecord: vi.fn(), revalidatePath: vi.fn(),
  client: { from: vi.fn(), rpc: vi.fn() },
}));
vi.mock("@/lib/auth", () => ({ requireStaff: mocks.requireStaff }));
vi.mock("@/lib/employees-server", () => ({ insertEmployee: mocks.insertEmployee, updateEmployeeRecord: mocks.updateEmployeeRecord }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import {
  createEmployeeAction, saveBankAccountAction, saveDocumentAction, saveEmergencyContactAction, updateEmployeeAction,
} from "./actions";

function form(values: Record<string, string>) {
  const result = new FormData();
  for (const [key, value] of Object.entries(values)) result.set(key, value);
  return result;
}
const validEmployee = { employee_code: "E-1", first_name: "Ada", last_name: "Lovelace", start_date: "2020-01-01" };

describe("employee server actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireStaff.mockResolvedValue({ client: mocks.client });
    mocks.client.from.mockReset(); mocks.client.rpc.mockReset();
  });

  it.each(["unauthenticated", "disabled staff"])("rejects %s before a general write", async () => {
    mocks.requireStaff.mockRejectedValue(new Error("NEXT_REDIRECT"));
    await expect(createEmployeeAction(emptyActionState, form(validEmployee))).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.insertEmployee).not.toHaveBeenCalled();
    expect(mocks.updateEmployeeRecord).not.toHaveBeenCalled();
  });

  it("returns a friendly duplicate employee-code error", async () => {
    mocks.insertEmployee.mockRejectedValue(new Error("รหัสพนักงานนี้มีอยู่แล้ว"));
    const result = await createEmployeeAction(emptyActionState, form(validEmployee));
    expect(result.message).toBe("รหัสพนักงานนี้มีอยู่แล้ว");
  });

  it("reports an optimistic update conflict", async () => {
    mocks.updateEmployeeRecord.mockRejectedValue(new Error("ข้อมูลถูกแก้ไขโดยผู้ใช้อื่นแล้ว กรุณาโหลดข้อมูลใหม่"));
    const result = await updateEmployeeAction(emptyActionState, form({ ...validEmployee, id: "e1", expected_updated_at: "2026-01-01T00:00:00Z" }));
    expect(result.message).toContain("ผู้ใช้อื่น");
  });

  it("hides unexpected create transport errors behind a Thai message", async () => {
    mocks.insertEmployee.mockRejectedValue(new Error("FetchError secret-host.internal"));
    const result = await createEmployeeAction(emptyActionState, form(validEmployee));
    expect(result.message).toContain("ระบบขัดข้อง");
    expect(result.message).not.toContain("secret-host");
  });

  it("rejects impossible document expiry dates before accessing the database", async () => {
    const result = await saveDocumentAction(emptyActionState, form({ employee_id: "e1", document_type: "Passport", document_number: "AB-1", expires_on: "2025-02-30" }));
    expect(result.errors.expires_on).toBeTruthy();
    expect(mocks.requireStaff).not.toHaveBeenCalled();
  });

  it("maps duplicate emergency-contact priorities to a field error", async () => {
    const builder = {
      insert: vi.fn(), update: vi.fn(), select: vi.fn(), eq: vi.fn(), single: vi.fn(), maybeSingle: vi.fn(),
    };
    builder.insert.mockReturnValue(builder); builder.select.mockReturnValue(builder);
    builder.single.mockResolvedValue({ data: null, error: { code: "23505" } });
    mocks.client.from.mockReturnValue(builder);
    const result = await saveEmergencyContactAction(emptyActionState, form({ employee_id: "e1", name: "A", relationship: "friend", phone: "0001", priority: "1" }));
    expect(result.message).toBe("ลำดับผู้ติดต่อซ้ำ");
    expect(result.errors.priority).toBeTruthy();
  });

  it("returns a safe Thai message when the bank RPC transport fails", async () => {
    mocks.client.rpc.mockRejectedValue(new Error("FetchError secret-host.internal"));
    const result = await saveBankAccountAction(emptyActionState, form({
      employee_id: "e1", expected_employee_updated_at: "2026-01-01T00:00:00Z", bank_name: "Bank", account_name: "Ada", account_number: "0001",
    }));
    expect(result.message).toContain("ระบบขัดข้อง");
    expect(result.message).not.toContain("secret-host");
  });
});
