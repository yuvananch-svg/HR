"use client";
import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { cancelLeaveAction } from "@/app/workspace/leave/actions";
import styles from "@/app/workspace/workspace.module.css";
import type { LeaveActionState } from "@/app/workspace/leave/actions";
const initial:LeaveActionState={success:false,message:"",errors:{}};
export function LeaveCancelForm({id,revision}:{id:string;revision:string}) {
 const router=useRouter();const [state,action,pending]=useActionState(cancelLeaveAction,initial);const [key,setKey]=useState("");const [reason,setReason]=useState("");
 useEffect(()=>{if(state.success)router.refresh();},[state,router]);
 return <form action={action} className={styles.leaveCancel} onSubmit={e=>{if(!window.confirm("ยืนยันยกเลิกรายการลานี้? ระบบจะคืนยอดและเก็บประวัติไว้"))e.preventDefault();}}><input type="hidden" name="entry_id" value={id}/><input type="hidden" name="expected_revision" value={revision}/><input type="hidden" name="request_key" value={key}/><label>เหตุผลการยกเลิก<textarea name="reason" required minLength={3} maxLength={500} rows={2} value={reason} onChange={e=>{setReason(e.currentTarget.value);setKey(crypto.randomUUID());}}/></label><button type="submit" disabled={pending||!key}>{pending?"กำลังยกเลิก…":"ยกเลิกรายการ"}</button>{state.message&&<p role={state.success?"status":"alert"}>{state.message}</p>}</form>;
}
