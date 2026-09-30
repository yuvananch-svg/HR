"use client";
import { useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { EmployeeSubmit } from "@/components/employee-submit";
import { createEmployeeAction, updateEmployeeAction } from "@/app/workspace/employees/actions";
import { emptyActionState, type ActionState, type EmployeeRow, validateEmployeeForm } from "@/lib/employees";
import styles from "@/app/workspace/workspace.module.css";

export function EmployeeGeneralForm({ employee }: { employee?: EmployeeRow }) {
  const router = useRouter();
  const action = employee ? updateEmployeeAction : createEmployeeAction;
  const [state,setState] = useState<ActionState>(emptyActionState);
  const [pending,setPending] = useState(false);
  const [clientErrors,setClientErrors] = useState<Record<string,string[]>>({});
  const errors = {...state.errors,...clientErrors};
  const field = (name: string, label: string, required = false, type = "text") => <label>{label}{required && " *"}<input name={name} type={type} required={required} defaultValue={employee?.[name as keyof EmployeeRow] as string ?? ""} aria-invalid={errors[name] ? true : undefined} aria-describedby={errors[name]?.map((_,i)=>`${name}-error-${i}`).join(" ")} />{errors[name]?.map((e, i) => <span className={styles.formError} id={`${name}-error-${i}`} key={i}>{e}</span>)}</label>;
  const submit = async (event:FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const formData = new FormData(event.currentTarget);
    const validated = validateEmployeeForm(formData);
    if (!validated.data) { setClientErrors(validated.errors); return; }
    setClientErrors({}); setPending(true);
    try { const next = await action(state,formData); setState(next); if(next.success){if(next.id && !employee) router.push(`/workspace/employees/${next.id}`); else router.refresh();} }
    catch { setState({...emptyActionState,message:"บันทึกข้อมูลไม่สำเร็จ กรุณาลองอีกครั้ง"}); }
    finally { setPending(false); }
  };
  return <form onSubmit={submit} className={styles.employeeForm}>
    {employee && <><input type="hidden" name="id" value={employee.id}/><input type="hidden" name="expected_updated_at" value={employee.updated_at}/></>}
    <div className={styles.fieldGrid}>{field("employee_code", "รหัสพนักงาน", true)}{field("first_name", "ชื่อ", true)}{field("last_name", "นามสกุล", true)}{field("start_date", "วันเริ่มงาน", true, "date")}{field("department", "แผนก")}{field("position", "ตำแหน่ง")}{field("phone", "เบอร์โทรศัพท์", false, "tel")}{field("address", "ที่อยู่")}
      <label>สถานะ<select name="status" defaultValue={employee?.status ?? "active"}><option value="active">ทำงานอยู่</option><option value="terminated">พ้นสภาพ</option></select></label>{field("termination_date", "วันพ้นสภาพ", false, "date")}</div>
    {state.message && <p className={state.success ? undefined : styles.formError} role="status">{state.message}{!state.success && state.message.includes("โหลดข้อมูลใหม่") && <button type="button" onClick={()=>router.refresh()}>โหลดข้อมูลล่าสุด</button>}{state.success && state.id && !employee && <Link href={`/workspace/employees/${state.id}`}>เปิดรายละเอียดพนักงาน</Link>}</p>}
    <div className={styles.formActions}><EmployeeSubmit pending={pending}>บันทึกข้อมูลทั่วไป</EmployeeSubmit><Link href={employee ? `/workspace/employees/${employee.id}` : "/workspace/employees"}>ยกเลิก</Link></div>
  </form>;
}
