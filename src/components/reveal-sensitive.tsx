"use client";
import { useState } from "react";
import { revealSensitiveAction } from "@/app/workspace/employees/actions";
export function RevealSensitive({ employeeId, section, rowId, revision, label }: {employeeId:string;section:"document"|"bank";rowId:string;revision:string;label:string}) {
  const [visible,setVisible]=useState(false);
  const [pending,setPending]=useState(false); const [value,setValue]=useState<string>(); const [message,setMessage]=useState("");
  const toggle = async () => {
    if(value){setVisible(v=>!v);return;}
    setPending(true);setMessage("");
    const form=new FormData();form.set("employee_id",employeeId);form.set("section",section);form.set("row_id",rowId);
    try { const result=await revealSensitiveAction({success:false,message:""},form); if(result.success && result.value){setValue(result.value);setVisible(true);} else setMessage(result.message); }
    catch {setMessage("เปิดเผยข้อมูลไม่ได้ กรุณาลองอีกครั้ง");}
    finally {setPending(false);}
  };
  return <span data-revision={revision}><button type="button" disabled={pending} onClick={toggle} aria-expanded={visible}>{pending?"กำลังโหลด…":visible?`ซ่อน${label}`:`เปิดเผย${label}`}</button>{visible && value && <span className="sensitiveValue"> {value}</span>}{message && <span role="status">{message}</span>}</span>;
}
