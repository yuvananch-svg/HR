"use server";
import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { isValidCalendarDate, validateEmployeeForm, type ActionState } from "@/lib/employees";
import { insertEmployee, updateEmployeeRecord } from "@/lib/employees-server";

const value = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
const fail = (message: string, errors: Record<string, string[]> = {}): ActionState => ({ message, errors, success: false });
const done = (id: string): ActionState => ({ message: "บันทึกข้อมูลแล้ว", errors: {}, success: true, id });
const safeGeneralMessages = new Set([
  "รหัสพนักงานนี้มีอยู่แล้ว", "บันทึกข้อมูลพนักงานไม่สำเร็จ", "แก้ไขข้อมูลไม่สำเร็จ",
  "ข้อมูลถูกแก้ไขโดยผู้ใช้อื่นแล้ว กรุณาโหลดข้อมูลใหม่",
]);
function generalFailure(error: unknown, fallback: string) {
  return fail(error instanceof Error && safeGeneralMessages.has(error.message) ? error.message : fallback);
}

export async function createEmployeeAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  await requireStaff();
  const validated = validateEmployeeForm(formData);
  if (!validated.data) return fail("กรุณาตรวจสอบข้อมูล", validated.errors);
  try {
    const row = await insertEmployee(validated.data);
    revalidatePath("/workspace/employees");
    return done(row.id);
  } catch (error) { return generalFailure(error, "ระบบขัดข้องขณะบันทึกข้อมูลพนักงาน กรุณาลองอีกครั้ง"); }
}

export async function updateEmployeeAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  await requireStaff();
  const id = value(formData, "id");
  const revision = value(formData, "expected_updated_at");
  if (!id || !revision) return fail("ข้อมูลแก้ไขไม่ครบ กรุณาโหลดหน้าใหม่");
  const validated = validateEmployeeForm(formData);
  if (!validated.data) return fail("กรุณาตรวจสอบข้อมูล", validated.errors);
  try {
    await updateEmployeeRecord(id, revision, validated.data);
    revalidatePath("/workspace/employees"); revalidatePath(`/workspace/employees/${id}`);
    return done(id);
  } catch (error) { return generalFailure(error, "ระบบขัดข้องขณะแก้ไขข้อมูลพนักงาน กรุณาลองอีกครั้ง"); }
}

async function saveRelated(table: "identity_documents" | "emergency_contacts", formData: FormData, fields: Record<string, unknown>) {
  const { client } = await requireStaff();
  const id = value(formData, "id"), employeeId = value(formData, "employee_id"), expected = value(formData, "expected_updated_at");
  if (!employeeId) return fail("ไม่พบรหัสพนักงาน");
  try {
    let result;
    if (id) {
      if (!expected) return fail("ข้อมูลถูกแก้ไขแล้ว กรุณาโหลดข้อมูลใหม่");
      result = await client.from(table).update(fields).eq("id", id).eq("employee_id", employeeId).eq("updated_at", expected).select("id").maybeSingle();
    } else {
      result = await client.from(table).insert({ ...fields, employee_id: employeeId }).select("id").single();
    }
    if (result.error) {
      if (result.error.code === "23505" && table === "identity_documents") return fail("เอกสารชนิดและเลขนี้มีอยู่แล้ว", { document_number: ["เอกสารนี้มีอยู่แล้ว"] });
      if (result.error.code === "23505") return fail("ลำดับผู้ติดต่อซ้ำ", { priority: ["ลำดับนี้มีผู้ติดต่อแล้ว"] });
      return fail("บันทึกข้อมูลไม่สำเร็จ กรุณาลองอีกครั้ง");
    }
    if (!result.data) return fail("ข้อมูลถูกแก้ไขโดยผู้ใช้อื่นแล้ว กรุณาโหลดข้อมูลใหม่");
    revalidatePath(`/workspace/employees/${employeeId}`); revalidatePath("/workspace/employees");
    return done(result.data.id);
  } catch {
    return fail("ระบบขัดข้องขณะบันทึก กรุณาลองอีกครั้ง");
  }
}

export async function saveDocumentAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const document_type = value(formData, "document_type"), document_number = value(formData, "document_number");
  const errors: Record<string, string[]> = {};
  if (!document_type) errors.document_type = ["กรุณาระบุชนิดเอกสาร"];
  if (!document_number) errors.document_number = ["กรุณาระบุเลขเอกสาร"];
  if (Object.keys(errors).length) return fail("กรุณาตรวจสอบข้อมูล", errors);
  const expires = value(formData, "expires_on");
  if (expires && !isValidCalendarDate(expires)) return fail("กรุณาตรวจสอบวันที่หมดอายุ", { expires_on: ["กรุณาระบุวันที่ที่ถูกต้อง"] });
  return saveRelated("identity_documents", formData, { document_type, document_number, issuing_country: value(formData, "issuing_country") || null, expires_on: expires || null });
}

export async function saveEmergencyContactAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const name = value(formData, "name"), relationship = value(formData, "relationship"), phone = value(formData, "phone"), priority = Number(value(formData, "priority") || 1);
  const errors: Record<string, string[]> = {};
  if (!name) errors.name = ["กรุณาระบุชื่อ"];
  if (!phone) errors.phone = ["กรุณาระบุเบอร์โทร"];
  if (!Number.isInteger(priority) || priority < 1) errors.priority = ["ลำดับต้องเป็นจำนวนเต็มบวก"];
  if (Object.keys(errors).length) return fail("กรุณาตรวจสอบข้อมูล", errors);
  return saveRelated("emergency_contacts", formData, { name, relationship, phone, priority });
}

export async function saveBankAccountAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const { client } = await requireStaff();
  const employee_id = value(formData, "employee_id"), id = value(formData, "id") || null;
  const expected_updated_at = value(formData, "expected_updated_at") || null;
  const expected_employee_updated_at = value(formData, "expected_employee_updated_at");
  const bank_name = value(formData, "bank_name"), account_name = value(formData, "account_name"), account_number = value(formData, "account_number");
  const errors: Record<string, string[]> = {};
  if (!bank_name) errors.bank_name = ["กรุณาระบุธนาคาร"];
  if (!account_name) errors.account_name = ["กรุณาระบุชื่อบัญชี"];
  if (!account_number) errors.account_number = ["กรุณาระบุเลขบัญชี"];
  if (Object.keys(errors).length) return fail("กรุณาตรวจสอบข้อมูล", errors);
  if (!employee_id || !expected_employee_updated_at || (id && !expected_updated_at)) return fail("ข้อมูลธนาคารไม่ครบ กรุณาโหลดหน้าใหม่");
  try {
    const { data, error } = await client.rpc("save_employee_bank_account", {
      p_employee_id: employee_id, p_account_id: id, p_expected_updated_at: expected_updated_at,
      p_expected_employee_updated_at: expected_employee_updated_at, p_bank_name: bank_name,
      p_account_name: account_name, p_account_number: account_number, p_is_primary: value(formData, "is_primary") === "true" || value(formData, "is_primary") === "on",
    });
    if (error) return fail(error.message.includes("revision_conflict") ? "ข้อมูลธนาคารถูกแก้ไขแล้ว กรุณาโหลดหน้าใหม่" : "บันทึกข้อมูลธนาคารไม่สำเร็จ กรุณาลองอีกครั้ง");
    revalidatePath(`/workspace/employees/${employee_id}`); revalidatePath("/workspace/employees");
    return done(String(data));
  } catch {
    return fail("ระบบขัดข้องขณะบันทึกข้อมูลธนาคาร กรุณาลองอีกครั้ง");
  }
}

export type RevealSensitiveState = { success: boolean; value?: string; message: string };
export async function revealSensitiveAction(_state: RevealSensitiveState, formData: FormData): Promise<RevealSensitiveState> {
  await requireStaff();
  const employee_id = value(formData, "employee_id"), row_id = value(formData, "row_id"), section = value(formData, "section");
  if (!employee_id || !row_id || (section !== "document" && section !== "bank")) return { success: false, message: "ไม่พบข้อมูลที่ต้องการเปิดเผย" };
  const { client } = await requireStaff();
  if (section === "document") {
    const result = await client.from("identity_documents").select("document_number").eq("id", row_id).eq("employee_id", employee_id).maybeSingle();
    if (result.error || !result.data) return { success: false, message: "ไม่สามารถเปิดเผยข้อมูลนี้ได้" };
    return { success: true, value: result.data.document_number, message: "" };
  }
  const result = await client.from("bank_accounts").select("account_number").eq("id", row_id).eq("employee_id", employee_id).maybeSingle();
  if (result.error || !result.data) return { success: false, message: "ไม่สามารถเปิดเผยข้อมูลนี้ได้" };
  return { success: true, value: result.data.account_number, message: "" };
}
