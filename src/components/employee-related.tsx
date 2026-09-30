"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveBankAccountAction, saveDocumentAction, saveEmergencyContactAction } from "@/app/workspace/employees/actions";
import { emptyActionState } from "@/lib/employees";
import type { ActionState } from "@/lib/employees";
import styles from "@/app/workspace/workspace.module.css";
import { EmployeeSubmit } from "@/components/employee-submit";

type Row = Record<string, string | number | boolean | null | undefined>;
export function RelatedForm({ kind, employeeId, employeeUpdatedAt, row }: { kind:"document"|"bank"|"contact"; employeeId:string; employeeUpdatedAt:string; row?:Row }) {
  const router = useRouter(); const [open,setOpen] = useState(false); const [pending,setPending] = useState(false);
  const [state,setState] = useState<ActionState>(emptyActionState);
  const action = kind === "document" ? saveDocumentAction : kind === "bank" ? saveBankAccountAction : saveEmergencyContactAction;
  const fields:Record<string,string> = kind === "document" ? {document_type:"ชนิดเอกสาร",document_number:"เลขเอกสาร",issuing_country:"ประเทศผู้ออก",expires_on:"วันหมดอายุ"} : kind === "bank" ? {bank_name:"ธนาคาร",account_name:"ชื่อบัญชี",account_number:"เลขบัญชี"} : {name:"ชื่อผู้ติดต่อ",relationship:"ความสัมพันธ์",phone:"เบอร์โทร",priority:"ลำดับความสำคัญ"};
  const keys = Object.keys(fields);
  const submit = async (event:React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setPending(true);
    try { const next = await action(state,new FormData(event.currentTarget)); setState(next); if(next.success) router.refresh(); }
    catch { setState({message:"บันทึกข้อมูลไม่สำเร็จ กรุณาลองอีกครั้ง",errors:{},success:false}); }
    finally { setPending(false); }
  };
  return <div className={styles.relatedEditor}>
    {!open && <button type="button" onClick={()=>setOpen(true)}>{row ? "แก้ไข" : `เพิ่ม${kind === "document" ? "เอกสาร" : kind === "bank" ? "บัญชีธนาคาร" : "ผู้ติดต่อ"}`}</button>}
    {open && !state.success && <form onSubmit={submit} className={styles.inlineForm}>
      <input type="hidden" name="employee_id" value={employeeId}/>{row?.id && <input type="hidden" name="id" value={String(row.id)}/>} {row?.updated_at && <input type="hidden" name="expected_updated_at" value={String(row.updated_at)}/>} {kind === "bank" && <input type="hidden" name="expected_employee_updated_at" value={employeeUpdatedAt}/>}
      {keys.map((key)=><label key={key}>{fields[key]}<input name={key} type={key==="expires_on"?"date":key==="priority"?"number":"text"} required={["document_type","document_number","bank_name","account_name","account_number","name","phone"].includes(key)} defaultValue={String(row?.[key] ?? "")} aria-invalid={state.errors[key]?true:undefined}/>{state.errors[key]?.map((error,i)=><span className={styles.formError} key={i}>{error}</span>)}</label>)}
      {row && (kind === "document" || kind === "bank") && <p>เพื่อความปลอดภัย ให้กรอกเลขเอกสารหรือเลขบัญชีเดิมอีกครั้ง หรือใส่เลขใหม่</p>}
      {kind === "bank" && <label>บัญชีหลัก<input type="checkbox" name="is_primary" value="true" defaultChecked={Boolean(row?.is_primary)}/></label>}
      <div className={styles.formActions}><EmployeeSubmit pending={pending}>บันทึก</EmployeeSubmit><button type="button" className={styles.secondaryButton} onClick={()=>setOpen(false)}>ยกเลิก</button></div>
      {state.message && <p role="status" className={state.success?undefined:styles.formError}>{state.message}{state.message.includes("โหลด") && <button type="button" onClick={()=>router.refresh()}>โหลดข้อมูลล่าสุด</button>}</p>}
    </form>}
    {state.success && <p role="status">บันทึกแล้ว</p>}
  </div>;
}
