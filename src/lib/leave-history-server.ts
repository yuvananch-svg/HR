import "server-only";
import { requireStaff } from "./auth";
import { employeeSearchFilter, HISTORY_PAGE_SIZE, historyRange, type HistoryFilters } from "./leave-history";

export async function listLeaveHistory(filters: HistoryFilters) {
  const { client } = await requireStaff();
  const employeeFilter = filters.query ? employeeSearchFilter(filters.query) : "";
  const dateRange = historyRange(filters);
  if (dateRange.start && dateRange.end && dateRange.start > dateRange.end) return { rows: [], total: 0, page: 1, pageSize: HISTORY_PAGE_SIZE };
  const build = () => {
    let query = client.from("leave_entries").select("id,employee_id,leave_type_id,start_date,end_date,status,day_unit,half_period,created_at,employees!inner(employee_code,first_name,last_name),leave_types(name,is_active)", { count: "exact" });
    if (filters.employeeId) query = query.eq("employee_id", filters.employeeId);
    if (employeeFilter) query = query.or(employeeFilter, { referencedTable: "employees" });
    if (filters.leaveTypeId) query = query.eq("leave_type_id", filters.leaveTypeId);
    if (filters.status) query = query.eq("status", filters.status);
    if (dateRange.start) query = query.gte("end_date", dateRange.start);
    if (dateRange.end) query = query.lte("start_date", dateRange.end);
    return query;
  };
  const countResult = await build().range(0, 0);
  if (countResult.error) throw new Error("ไม่สามารถโหลดประวัติวันลาได้");
  const total = countResult.count ?? 0;
  const pages = Math.max(1, Math.ceil(total / HISTORY_PAGE_SIZE));
  const page = Math.min(filters.page, pages);
  const { data, error } = await build().order("created_at", { ascending: false }).order("id", { ascending: false }).range((page - 1) * HISTORY_PAGE_SIZE, page * HISTORY_PAGE_SIZE - 1);
  if (error) throw new Error("ไม่สามารถโหลดประวัติวันลาได้");
  return { rows: data ?? [], total, page, pageSize: HISTORY_PAGE_SIZE };
}
