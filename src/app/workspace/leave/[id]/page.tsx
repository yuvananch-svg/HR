import Link from "next/link";
import { notFound, unstable_rethrow } from "next/navigation";
import { getLeaveEntry, getLeaveFormData } from "@/lib/leave-server";
import { LeaveEntryForm } from "@/components/leave-entry-form";
import { LeaveCancelForm } from "@/components/leave-cancel-form";
import styles from "../../workspace.module.css";

export default async function LeaveEntryPage({params}:{params:Promise<{id:string}>}) {
 const {id}=await params;if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))notFound();
 let data;try{data=await getLeaveEntry(id);}catch(error){unstable_rethrow(error);return <section className={styles.panel} role="alert"><h1>โหลดรายการลาไม่ได้</h1><p>กรุณาลองอีกครั้ง</p></section>;}if(!data)notFound();
 const {entry,days,audit}=data;const employee=entry.employees as {id:string;employee_code:string;first_name:string;last_name:string;status:string;start_date:string;termination_date:string|null}|null;const type=entry.leave_types as {name:string;is_active:boolean}|null;
 const {employees,types}=await getLeaveFormData();
 const person=employee?`${employee.first_name} ${employee.last_name} (${employee.employee_code})`:"ไม่พบพนักงาน";
 return <><p className={styles.kicker}><Link href="/workspace/leave">ประวัติวันลา</Link> / รายละเอียด</p><h1>{person}</h1><p className={styles.subtitle}>{type?.name} · {entry.start_date} ถึง {entry.end_date} · {entry.status==="cancelled"?"ยกเลิกแล้ว":"บันทึกแล้ว"}</p>
 <section className={styles.panel}><h2>วันที่หัก</h2><ul>{days.map(day=><li key={day.leave_date}>{day.leave_date} · {day.days} วัน{day.half_period?` · ${day.half_period==="morning"?"ครึ่งเช้า":"ครึ่งบ่าย"}`:""}</li>)}</ul>{entry.reason&&<p>เหตุผล: {entry.reason}</p>}<p>บันทึกเมื่อ {new Date(entry.created_at).toLocaleString("th-TH",{timeZone:"Asia/Bangkok"})}</p></section>
 {entry.status==="recorded"&&<section className={styles.panel}><h2>แก้ไขรายการ</h2><LeaveEntryForm employees={employees} types={types} editing initial={{employee_id:entry.employee_id,leave_type_id:entry.leave_type_id,start_date:entry.start_date,end_date:entry.end_date,unit:entry.day_unit==="full"?"full":entry.half_period,reason:entry.reason??"",entry_id:entry.id,expected_revision:entry.updated_at,oldDays:days}}/></section>}
 {entry.status==="recorded"&&<section className={styles.panel}><h2>ยกเลิกรายการ</h2><LeaveCancelForm id={entry.id} revision={entry.updated_at}/></section>}
 <section className={styles.panel}><h2>ประวัติการเปลี่ยนแปลง</h2>{!audit.length?<p>ยังไม่มีรายการตรวจสอบเพิ่มเติม</p>:<ol className={styles.auditList}>{audit.map(row=>{const before=(row.before_values??{}) as Record<string,unknown>;const after=(row.after_values??{}) as Record<string,unknown>;const snapshot=(after.actor_snapshot??before.actor_snapshot) as {id?:string;display_name?:string;role?:string}|undefined;const actor=snapshot?.display_name||`${snapshot?.role==="owner"?"เจ้าของ":"ฝ่าย HR"}${snapshot?.id?` · บัญชี ${snapshot.id.slice(0,8)}`:""}`;const cancelled=after.status==="cancelled";return <li key={row.id}><strong>{row.action==="INSERT"?"บันทึก":cancelled?"ยกเลิก":row.action==="UPDATE"?"แก้ไข":"ลบ"}</strong><span>{actor} · {new Date(row.occurred_at).toLocaleString("th-TH",{timeZone:"Asia/Bangkok"})}{row.reason?` · ${row.reason}`:""}</span><p>{auditChangeSummary(before,after,new Map(employees.map(e=>[e.id,`${e.first_name} ${e.last_name}`])),new Map(types.map(t=>[t.id,t.name])))}</p></li>;})}</ol>}</section></>;
}
function auditChangeSummary(before:Record<string,unknown>,after:Record<string,unknown>,employeeNames:Map<string,string>,typeNames:Map<string,string>) {
 const labels:Record<string,string>={start_date:"วันเริ่มลา",end_date:"วันสิ้นสุด",day_unit:"หน่วยลา",half_period:"ช่วงครึ่งวัน",reason:"เหตุผล",status:"สถานะ",leave_type_id:"ประเภทลา",employee_id:"พนักงาน"};
 const format=(key:string,value:unknown)=>{if(key==="day_unit")return value==="full"?"เต็มวัน":value==="half"?"ครึ่งวัน":String(value??"—");if(key==="half_period")return value==="morning"?"เช้า":value==="afternoon"?"บ่าย":String(value??"—");if(key==="status")return value==="cancelled"?"ยกเลิก":value==="recorded"?"บันทึกแล้ว":String(value??"—");if(key==="employee_id")return employeeNames.get(String(value))??"พนักงานเดิม";if(key==="leave_type_id")return typeNames.get(String(value))??"ประเภทลาเดิม";return value==null||value===""?"—":String(value);};
 const changes=Object.keys(labels).filter(key=>key in before||key in after).map(key=>`${labels[key]}: ${format(key,before[key])} → ${format(key,after[key])}`);
 const days=(obj:Record<string,unknown>)=>Array.isArray(obj.days)?obj.days.reduce((sum,item)=>sum+Number((item as {days?:number}).days??0),0):null;
 const oldTotal=days(before),newTotal=days(after);if(after.status==="cancelled"&&oldTotal!==null)changes.push(`คืนยอด ${oldTotal} วัน`);else if(oldTotal!==null||newTotal!==null)changes.push(`จำนวนวัน: ${oldTotal??0} → ${newTotal??0} วัน`);
 return changes.length?changes.join(" · "):"บันทึกรายการตรวจสอบแล้ว";
}
