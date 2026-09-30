import "server-only";
import { requireStaff } from "./auth";
import { normalizeRelatedRows, safePage, safePageSize, type EmployeeInput, type EmployeeRow } from "./employees";
import { bangkokToday } from "./workspace";
import { readAll } from "./data";

export type EmployeeListOptions = {
  query?: string; status?: string; sort?: string; direction?: string; page?: number; pageSize?: number;
};

const err = (message: string): never => { throw new Error(message); };

export async function listEmployees(options: EmployeeListOptions = {}) {
  const { client } = await requireStaff();
  const page = safePage(options.page ?? 1);
  const pageSize = safePageSize(options.pageSize ?? 25);
  const allowedSort = ["employee_code", "first_name", "last_name", "department", "start_date", "status"];
  const sort = allowedSort.includes(options.sort ?? "") ? options.sort! : "employee_code";
  const direction = options.direction === "desc" ? "desc" : "asc";
  const status = ["active", "terminated"].includes(options.status ?? "") ? options.status! : "all";
  const { data, error } = await client.rpc("employee_search", {
    p_query: (options.query ?? "").trim().slice(0, 100), p_status: status,
    p_sort: sort, p_direction: direction, p_offset: (page - 1) * pageSize, p_limit: pageSize,
  });
  if (error) err("ไม่สามารถโหลดรายชื่อพนักงานได้");
  const result = data as { rows?: EmployeeRow[]; total?: number } | null;
  return { rows: result?.rows ?? [], total: Number(result?.total ?? 0), page, pageSize };
}

export async function getEmployeeDetail(id: string, year?: number) {
  const { client } = await requireStaff();
  const { data: employee, error } = await client.from("employees").select("*").eq("id", id).maybeSingle();
  if (error) err("ไม่สามารถโหลดข้อมูลพนักงานได้");
  if (!employee) return null;
  const selectedYear = year ?? Number(bangkokToday().slice(0, 4));
  const [documents, bankAccounts, emergencyContacts, entitlementsRows, history, leaveDays, policies] = await Promise.all([
    client.from("identity_documents").select("id,employee_id,document_type,issuing_country,expires_on,created_at,updated_at").eq("employee_id", id).order("created_at"),
    client.from("bank_accounts").select("id,employee_id,bank_name,account_name,is_primary,created_at,updated_at").eq("employee_id", id).order("is_primary", { ascending: false }).order("created_at"),
    client.from("emergency_contacts").select("id,employee_id,name,relationship,phone,priority,created_at,updated_at").eq("employee_id", id).order("priority"),
    readAll((from, to) => client.from("leave_entitlements").select("id,employee_id,leave_type_id,year,quota_days,source,override_reason,updated_at,leave_types(name)").eq("employee_id", id).order("year", { ascending: false }).order("id").range(from, to)),
    readAll((from, to) => client.from("leave_entries").select("id,employee_id,leave_type_id,start_date,end_date,status,reason,leave_types(name)").eq("employee_id", id).order("start_date", { ascending: false }).order("id").range(from, to)),
    readAll((from, to) => client.from("leave_entry_days").select("leave_date,days,leave_entries!inner(employee_id,leave_type_id,status)").eq("leave_entries.employee_id", id).eq("leave_entries.status", "recorded").order("id").range(from, to)),
    readAll((from,to)=>client.from("leave_policy_defaults").select("leave_type_id,quota_days").eq("year",selectedYear).order("leave_type_id").range(from,to)),
  ]);
  if ([documents, bankAccounts, emergencyContacts].some((r) => r.error)) err("ไม่สามารถโหลดประวัติพนักงานได้");
  const entitlements = entitlementsRows;
  const days = leaveDays;
  const balances = entitlements.map((quota) => {
    const used = days.filter((day) => Number(day.leave_date.slice(0, 4)) === quota.year
      && normalizeRelatedRows(day.leave_entries).some((entry) => entry.leave_type_id === quota.leave_type_id)).reduce((sum, day) => sum + Number(day.days), 0);
    const policy=quota.year===selectedYear?policies.find(p=>p.leave_type_id===quota.leave_type_id):undefined;
    return { ...quota, policy_quota: policy ? Number(policy.quota_days) : null, used, remaining: Number(quota.quota_days) - used };
  });
  return { employee: employee as EmployeeRow, documents: (documents.data ?? []).map(row => ({ ...row, document_number: null as string | null })),
    bankAccounts: (bankAccounts.data ?? []).map(row => ({ ...row, account_number: null as string | null })),
    emergencyContacts: emergencyContacts.data ?? [], balances, history,
    yearHistory: history.filter((entry) => entry.start_date <= `${selectedYear}-12-31` && entry.end_date >= `${selectedYear}-01-01`),
    year: selectedYear };
}

export async function insertEmployee(data: EmployeeInput) {
  const { client } = await requireStaff();
  const { data: row, error } = await client.from("employees").insert(data).select("id,updated_at").single();
  if (error) throw new Error(error.code === "23505" ? "รหัสพนักงานนี้มีอยู่แล้ว" : "บันทึกข้อมูลพนักงานไม่สำเร็จ");
  return row;
}

export async function updateEmployeeRecord(id: string, expectedUpdatedAt: string, data: EmployeeInput) {
  const { client } = await requireStaff();
  const { data: row, error } = await client.from("employees").update(data).eq("id", id).eq("updated_at", expectedUpdatedAt).select("id,updated_at").maybeSingle();
  if (error) throw new Error(error.code === "23505" ? "รหัสพนักงานนี้มีอยู่แล้ว" : "แก้ไขข้อมูลไม่สำเร็จ");
  if (!row) throw new Error("ข้อมูลถูกแก้ไขโดยผู้ใช้อื่นแล้ว กรุณาโหลดข้อมูลใหม่");
  return row;
}
