export type EmployeeStatus = "active" | "terminated";

export type EmployeeInput = {
  employee_code: string;
  first_name: string;
  last_name: string;
  start_date: string;
  address: string | null;
  position: string | null;
  department: string | null;
  phone: string | null;
  status: EmployeeStatus;
  termination_date: string | null;
};

export type EmployeeRow = EmployeeInput & {
  id: string;
  created_at: string;
  updated_at: string;
};

export type ActionState = {
  message: string;
  errors: Record<string, string[]>;
  success: boolean;
  id?: string;
};

export const emptyActionState: ActionState = { message: "", errors: {}, success: false };

const text = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
const optional = (form: FormData, key: string) => text(form, key) || null;
export const isValidCalendarDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return year >= 1 && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
};

export function validateEmployeeForm(form: FormData): { data?: EmployeeInput; errors: Record<string, string[]> } {
  const fields = {
    employee_code: text(form, "employee_code"), first_name: text(form, "first_name"),
    last_name: text(form, "last_name"), start_date: text(form, "start_date"),
    status: text(form, "status") || "active", termination_date: text(form, "termination_date"),
  };
  const errors: Record<string, string[]> = {};
  for (const key of ["employee_code", "first_name", "last_name"] as const) {
    if (!fields[key]) errors[key] = ["กรุณากรอกข้อมูล"];
  }
  if (!isValidCalendarDate(fields.start_date)) errors.start_date = ["กรุณาระบุวันที่ถูกต้อง"];
  if (fields.status !== "active" && fields.status !== "terminated") errors.status = ["สถานะไม่ถูกต้อง"];
  if (fields.status === "terminated") {
    if (!isValidCalendarDate(fields.termination_date)) errors.termination_date = ["กรุณาระบุวันที่พ้นสภาพ"];
    else if (isValidCalendarDate(fields.start_date) && fields.termination_date < fields.start_date) errors.termination_date = ["วันพ้นสภาพต้องไม่ก่อนวันเริ่มงาน"];
  } else if (fields.termination_date) errors.termination_date = ["พนักงานที่ยังทำงานอยู่ต้องไม่มีวันพ้นสภาพ"];
  if (Object.keys(errors).length) return { errors };
  return { errors, data: {
    employee_code: fields.employee_code, first_name: fields.first_name, last_name: fields.last_name,
    start_date: fields.start_date, address: optional(form, "address"), position: optional(form, "position"),
    department: optional(form, "department"), phone: optional(form, "phone"),
    status: fields.status as EmployeeStatus, termination_date: fields.status === "terminated" ? fields.termination_date : null,
  } };
}

export function safePage(value: number, fallback = 1) {
  return Number.isSafeInteger(value) && value > 0 ? Math.min(value, 1_000_000) : fallback;
}

export function safePageSize(value: number, fallback = 25) {
  return Number.isSafeInteger(value) && value > 0 ? Math.min(value, 100) : fallback;
}

export function normalizeRelatedRows<T>(value: T | T[] | null | undefined): T[] {
  return value == null ? [] : Array.isArray(value) ? value : [value];
}
