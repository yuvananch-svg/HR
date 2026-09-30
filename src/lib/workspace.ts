export function bangkokToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
export type Entitlement = { employee_id: string; leave_type_id: string; year: number; quota_days: number | string };
export type LeaveDay = { leave_date: string; days: number | string; leave_entries: { employee_id: string; leave_type_id: string; status: string } | null };
export function remainingDays(entitlement: Entitlement, days: LeaveDay[]) {
  const used = days.filter(day => day.leave_entries?.status === "recorded"
    && day.leave_entries.employee_id === entitlement.employee_id
    && day.leave_entries.leave_type_id === entitlement.leave_type_id
    && Number(day.leave_date.slice(0, 4)) === entitlement.year)
    .reduce((sum, day) => sum + Number(day.days), 0);
  return { quota: Number(entitlement.quota_days), used, remaining: Number(entitlement.quota_days) - used };
}
