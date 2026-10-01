export const HISTORY_PAGE_SIZE = 25;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
export type HistoryFilters = { employeeId?: string; leaveTypeId?: string; status?: "recorded" | "cancelled"; year?: number; startDate?: string; endDate?: string; query?: string; page: number };
export type ParsedHistory = { filters?: HistoryFilters; errors: string[] };
function searchLiteral(value: string) {
  const pattern = value.replace(/[\\%_]/g, "\\$&");
  return `"%${pattern.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}%"`;
}
export function employeeSearchFilter(query: string) {
  const tokens = query.trim().split(/\s+/).filter(Boolean);
  const groups = tokens.map(token => `or(employee_code.ilike.${searchLiteral(token)},first_name.ilike.${searchLiteral(token)},last_name.ilike.${searchLiteral(token)})`);
  return groups.length > 1 ? `and(${groups.join(",")})` : groups[0] ?? "";
}
function validDate(value: string) {
  if (!datePattern.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}
export function parseHistoryFilters(params: Record<string, string | string[] | undefined>): ParsedHistory {
  const errors: string[] = [];
  const one = (key: string) => {
    const value = params[key];
    if (Array.isArray(value)) { errors.push(`ค่า ${key} ซ้ำ กรุณาเลือกค่าเดียว`); return ""; }
    return value?.trim() ?? "";
  };
  const employeeId = one("employee_id"), leaveTypeId = one("leave_type_id"), status = one("status"), rawYear = one("year");
  const startDate = one("start_date"), endDate = one("end_date"), rawQuery = one("q"), rawPage = one("page");
  if (rawQuery.length > 100) errors.push("คำค้นหาต้องไม่เกิน 100 ตัวอักษร");
  if (rawQuery.includes("*")) errors.push("คำค้นหาไม่รองรับเครื่องหมาย * กรุณาค้นด้วยชื่อหรือรหัสพนักงาน");
  const query = rawQuery;
  if (employeeId && !uuid.test(employeeId)) errors.push("ตัวกรองพนักงานไม่ถูกต้อง");
  if (leaveTypeId && !uuid.test(leaveTypeId)) errors.push("ตัวกรองประเภทลาไม่ถูกต้อง");
  if (status && status !== "recorded" && status !== "cancelled") errors.push("สถานะที่เลือกไม่ถูกต้อง");
  let year: number | undefined;
  if (rawYear) { year = Number(rawYear); if (!/^\d{4}$/.test(rawYear) || !Number.isInteger(year) || year < 1900 || year > 9999) errors.push("ปีต้องอยู่ระหว่าง ค.ศ. 1900–9999"); }
  if (startDate && !validDate(startDate)) errors.push("วันที่เริ่มกรองไม่ถูกต้อง");
  if (endDate && !validDate(endDate)) errors.push("วันที่สิ้นสุดกรองไม่ถูกต้อง");
  if (startDate && endDate && startDate > endDate) errors.push("วันที่เริ่มกรองต้องไม่หลังวันที่สิ้นสุด");
  let page = 1;
  if (rawPage) { page = Number(rawPage); if (!/^\d+$/.test(rawPage) || !Number.isSafeInteger(page) || page < 1 || page > 1000000) errors.push("เลขหน้าไม่ถูกต้อง"); }
  if (errors.length) return { errors };
  return { errors, filters: { employeeId: employeeId || undefined, leaveTypeId: leaveTypeId || undefined, status: status as HistoryFilters["status"] || undefined, year, startDate: startDate || undefined, endDate: endDate || undefined, query: query || undefined, page } };
}
export function parseCalendarYear(value: string | string[] | undefined, fallback: number) {
  if (value === undefined || value === "") return { year: fallback, error: "" };
  if (Array.isArray(value) || !/^\d{4}$/.test(value) || Number(value) < 1900 || Number(value) > 9999) return { year: fallback, error: "ปีต้องเป็นปี ค.ศ. 1900–9999 และระบุได้เพียงค่าเดียว" };
  return { year: Number(value), error: "" };
}
export function historyRange(filters: HistoryFilters) {
  const yearStart = filters.year ? `${filters.year}-01-01` : undefined;
  const yearEnd = filters.year ? `${filters.year}-12-31` : undefined;
  return { start: [filters.startDate, yearStart].filter(Boolean).sort().at(-1), end: [filters.endDate, yearEnd].filter(Boolean).sort()[0] };
}
export function historyPageHref(filters: HistoryFilters, page: number) {
  const params = new URLSearchParams();
  if (filters.employeeId) params.set("employee_id", filters.employeeId);
  if (filters.leaveTypeId) params.set("leave_type_id", filters.leaveTypeId);
  if (filters.status) params.set("status", filters.status);
  if (filters.year) params.set("year", String(filters.year));
  if (filters.startDate) params.set("start_date", filters.startDate);
  if (filters.endDate) params.set("end_date", filters.endDate);
  if (filters.query) params.set("q", filters.query);
  if (page > 1) params.set("page", String(page));
  return `/workspace/leave?${params.toString()}`;
}
export function safeHistoryReturnTo(value: string | undefined) {
  if (!value || !value.startsWith("/workspace/leave?") || value.startsWith("//") || value.includes("\\")) return "/workspace/leave";
  try {
    const parsed = new URL(value, "https://hr.invalid");
    if (parsed.origin !== "https://hr.invalid" || parsed.pathname !== "/workspace/leave") return "/workspace/leave";
    return parsed.pathname + parsed.search;
  } catch { return "/workspace/leave"; }
}
