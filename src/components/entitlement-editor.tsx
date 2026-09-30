"use client";
import { useState } from "react";
import type { FormEvent } from "react";
import { overrideEntitlementAction, resetEntitlementAction } from "@/app/workspace/settings-actions";
import styles from "@/app/workspace/workspace.module.css";

type Entitlement = {id:string; employee_id:string; leave_type_id:string; year:number; quota_days:number; policy_quota:number|null; updated_at:string; source:"policy"|"override"; override_reason:string|null; used:number; remaining:number; leave_types:{name:string}|null};
export function EntitlementEditor({row}:{row:Entitlement}) {
  const [editing,setEditing]=useState(false);
  const confirmOverride=(event:FormEvent<HTMLFormElement>)=>{
    const data=new FormData(event.currentTarget), newQuota=String(data.get("quota_days")??"").trim(), reason=String(data.get("reason")??"").trim();
    if(!confirm("ยืนยันปรับสิทธิ์จาก "+row.quota_days+" เป็น "+newQuota+" วัน? ใช้แล้ว "+row.used+" วัน. เหตุผล: "+reason)) event.preventDefault();
  };
  return <div className={styles.entitlementCard}>
    <p><strong>{row.leave_types?.name??"ประเภทลา"}</strong> · สิทธิ์ {row.quota_days} วัน · ใช้แล้ว {row.used} วัน · คงเหลือ {row.remaining} วัน · {row.source==="override"?"ปรับรายคน":"มาตรฐาน"}
      {row.override_reason&&<><br/>เหตุผลล่าสุด: {row.override_reason}</>}
    </p>
    {!editing?<button type="button" className={styles.secondaryButton} onClick={()=>setEditing(true)}>ปรับโควตา</button>:<form action={overrideEntitlementAction} onSubmit={confirmOverride} className={styles.policyForm}>
      <input type="hidden" name="employee_id" value={row.employee_id}/><input type="hidden" name="leave_type_id" value={row.leave_type_id}/><input type="hidden" name="year" value={row.year}/><input type="hidden" name="revision" value={row.updated_at}/>
      <label>โควตาใหม่<input name="quota_days" type="number" min="0" step="0.5" max="99999.5" required defaultValue={row.quota_days}/></label><label>เหตุผล<input name="reason" required maxLength={500} placeholder="ระบุเหตุผลการปรับ"/></label><button type="submit">บันทึกการปรับ</button><button type="button" onClick={()=>setEditing(false)}>ยกเลิก</button>
    </form>}
    {row.source==="override"&&(Number.isFinite(row.policy_quota)?<form action={resetEntitlementAction} className={styles.resetForm} onSubmit={(event)=>{if(!confirm("ยืนยันคืนสิทธิ์จาก "+row.quota_days+" เป็นโควตามาตรฐาน "+row.policy_quota+" วันสำหรับปี "+row.year+"? ใช้แล้ว "+row.used+" วัน."))event.preventDefault()}}>
      <input type="hidden" name="employee_id" value={row.employee_id}/><input type="hidden" name="leave_type_id" value={row.leave_type_id}/><input type="hidden" name="year" value={row.year}/><input type="hidden" name="revision" value={row.updated_at}/><button type="submit">คืนค่าโควตามาตรฐาน</button>
    </form>:<p>ปีนี้ไม่มีโควตามาตรฐานสำหรับคืนค่า</p>)}
  </div>;
}
