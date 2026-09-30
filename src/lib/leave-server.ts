import "server-only";
import { requireStaff } from "./auth";
import { readAll } from "./data";

export async function getLeaveFormData() {
  const { client } = await requireStaff();
  const [employees, types] = await Promise.all([
    readAll((from,to)=>client.from("employees").select("id,employee_code,first_name,last_name,status,start_date,termination_date").order("employee_code").range(from,to)),
    readAll((from,to)=>client.from("leave_types").select("id,name,is_active,sort_order").order("sort_order").order("name").range(from,to)),
  ]);
  return { employees, types };
}

export async function getLeaveEntry(id: string) {
  const { client } = await requireStaff();
  const [entry, days, audit] = await Promise.all([
    client.from("leave_entries").select("*,employees(id,employee_code,first_name,last_name,status,start_date,termination_date),leave_types(name,is_active)").eq("id",id).maybeSingle(),
    readAll((from,to)=>client.from("leave_entry_days").select("leave_date,days,half_period").eq("leave_entry_id",id).order("leave_date").range(from,to)),
    readAll((from,to)=>client.from("audit_events").select("id,actor_id,occurred_at,action,changed_fields,reason,before_values,after_values").eq("table_name","leave_entries").eq("record_id",id).order("occurred_at",{ascending:false}).range(from,to)),
  ]);
  if (entry.error) throw new Error("ไม่สามารถโหลดรายการลาได้");
  return entry.data ? { entry: entry.data, days, audit } : null;
}

export type PreviewInput = { employeeId:string; leaveTypeId:string; startDate:string; endDate:string; unit:"full"|"morning"|"afternoon"; entryId?:string };
export async function previewLeave(input: PreviewInput) {
  const { client } = await requireStaff();
  const { data, error } = await client.rpc("preview_leave_entry", {
    p_employee_id:input.employeeId,p_leave_type_id:input.leaveTypeId,p_start_date:input.startDate,p_end_date:input.endDate,
    p_unit:input.unit,p_entry_id:input.entryId ?? null,
  });
  if (error) throw new Error(error.message);
  return data as {days:{leave_date:string;days:number;half_period:string|null;counts:boolean;reason:string|null}[];balances:{year:number;quota_days:number;used_before:number;requested_days:number;used_after:number;remaining_after:number}[];fingerprint:string};
}
