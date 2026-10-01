export function bangkokToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
export type Entitlement = { employee_id: string; leave_type_id: string; year: number; quota_days: number | string };
export type LeaveDay = { leave_date: string; days: number | string; leave_entries: { employee_id: string; leave_type_id: string; status: string } | Array<{ employee_id: string; leave_type_id: string; status: string }> | null };
export function hasEntitlement(entitlements: Entitlement[], employeeId: string, leaveTypeId: string, year: number) {
  return entitlements.some(item => item.employee_id === employeeId && item.leave_type_id === leaveTypeId && item.year === year);
}
export function uniquePeopleOnLeave(rows: Array<{ leave_entries: { employee_id: string } | null }>) {
  return new Set(rows.flatMap(row => row.leave_entries?.employee_id ? [row.leave_entries.employee_id] : [])).size;
}
export function recordedUsageByEmployeeTypeYear(days: LeaveDay[]) {
  const totals = new Map<string, number>();
  for (const day of days) {
    const entry = Array.isArray(day.leave_entries) ? day.leave_entries[0] : day.leave_entries;
    if (!entry || entry.status !== "recorded") continue;
    const key = `${entry.employee_id}:${entry.leave_type_id}:${day.leave_date.slice(0, 4)}`;
    totals.set(key, (totals.get(key) ?? 0) + Number(day.days));
  }
  return totals;
}
export function remainingDays(entitlement: Entitlement, days: LeaveDay[]) {
  return remainingDaysFromUsage(entitlement, recordedUsageByEmployeeTypeYear(days));
}
export function remainingDaysFromUsage(entitlement: Entitlement, usage: Map<string, number>) {
  const used = usage.get(`${entitlement.employee_id}:${entitlement.leave_type_id}:${entitlement.year}`) ?? 0;
  return { quota: Number(entitlement.quota_days), used, remaining: Number(entitlement.quota_days) - used };
}
export function summarizeLeaveTypes(year:number, types: Array<{id:string;name:string;is_active:boolean}>, entitlements: Array<{employee_id:string;leave_type_id:string;quota_days:number|string}>, days: LeaveDay[]) {
  const summary = new Map<string,{id:string;name:string;active:boolean;quota:number;used:number;employees:Set<string>}>();
  for (const type of types) if(type.is_active) summary.set(type.id,{id:type.id,name:type.name,active:true,quota:0,used:0,employees:new Set()});
  for (const entitlement of entitlements) {
    const type=types.find(candidate=>candidate.id===entitlement.leave_type_id);
    if(!type)continue;
    const row=summary.get(type.id)??{id:type.id,name:type.name,active:type.is_active,quota:0,used:0,employees:new Set<string>()};
    row.quota+=Number(entitlement.quota_days);row.employees.add(entitlement.employee_id);summary.set(type.id,row);
  }
  const usage=recordedUsageByEmployeeTypeYear(days);
  for (const [key,used] of usage) {
    const [,typeId,keyYear]=key.split(":");
    if(Number(keyYear)!==year)continue;
    const type=types.find(candidate=>candidate.id===typeId);
    if(!type)continue;
    const row=summary.get(type.id)??{id:type.id,name:type.name,active:type.is_active,quota:0,used:0,employees:new Set<string>()};
    row.used+=used;summary.set(type.id,row);
  }
  return [...summary.values()].map(({employees,...row})=>({...row,entitledPeople:employees.size,hasEntitlement:employees.size>0}));
}
