import Link from "next/link";
import { LeaveEntryForm } from "@/components/leave-entry-form";
import { getLeaveFormData } from "@/lib/leave-server";
import { requireStaff } from "@/lib/auth";
import { readAll } from "@/lib/data";
import { bangkokToday, remainingDays, type Entitlement, type LeaveDay } from "@/lib/workspace";
import styles from "../workspace.module.css";

type Search=Record<string,string|string[]|undefined>;
export default async function LeavePage({searchParams}:{searchParams:Promise<Search>}){
 const query=await searchParams;const candidate=typeof query.year==="string"?Number(query.year):NaN;const defaultYear=Number(bangkokToday().slice(0,4));const year=Number.isInteger(candidate)&&candidate>=1900&&candidate<=9999?candidate:defaultYear;const employeeId=typeof query.employee_id==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(query.employee_id)?query.employee_id:undefined;
 const [{employees,types},{client}]=await Promise.all([getLeaveFormData(),requireStaff()]);
 const [entries,entitlements,rawDays]=await Promise.all([
  readAll((from,to)=>client.from("leave_entries").select("id,start_date,end_date,status,day_unit,half_period,employees(employee_code,first_name,last_name),leave_types(name)").order("created_at",{ascending:false}).range(from,to)),
  readAll((from,to)=>client.from("leave_entitlements").select("id,employee_id,leave_type_id,year,quota_days,employees(first_name,last_name),leave_types(name)").eq("year",year).order("employee_id").order("id").range(from,to)),
  readAll((from,to)=>client.from("leave_entry_days").select("leave_date,days,leave_entries!inner(employee_id,leave_type_id,status)").gte("leave_date",`${year}-01-01`).lte("leave_date",`${year}-12-31`).order("id").range(from,to)),
 ]);
 const days=rawDays as unknown as LeaveDay[];
 type Row=typeof entries[number];
 return <><h1>บันทึกวันลา</h1><p className={styles.subtitle}>เลือกพนักงานและตรวจวันที่หักกับยอดคงเหลือก่อนบันทึก</p><section className={styles.panel}><LeaveEntryForm employees={employees} types={types} initial={{employee_id:employeeId}}/><p className={styles.leaveNotice}>สำหรับพนักงานพ้นสภาพหรือประเภทลาที่ปิดใช้งาน ต้องลงวันที่ย้อนหลังในช่วงการจ้าง ไม่เกินวันนี้ตามเวลาไทย และระบุเหตุผล</p></section><form method="get" className={styles.yearPicker}><label>ปี ค.ศ. <input type="number" name="year" min="1900" max="9999" defaultValue={year}/></label><button type="submit">ดูปี</button></form><section className={styles.panel}><h2>ยอดคงเหลือ · {year}</h2>{!entitlements.length?<p>ยังไม่ได้กำหนดสิทธิ์วันลา</p>:<div className={styles.tableWrap}><table><thead><tr><th>พนักงาน</th><th>ประเภท</th><th>โควตา</th><th>ใช้แล้ว</th><th>คงเหลือ</th></tr></thead><tbody>{entitlements.map(row=>{const balance=remainingDays(row as Entitlement,days);const emp=row.employees as unknown as {first_name:string;last_name:string}|null;const type=row.leave_types as unknown as {name:string}|null;return <tr key={row.employee_id+row.leave_type_id}><td>{emp?.first_name} {emp?.last_name}</td><td>{type?.name}</td><td>{balance.quota}</td><td>{balance.used}</td><td>{balance.remaining}</td></tr>;})}</tbody></table></div>}</section><section className={styles.panel}><h2>ประวัติวันลา</h2>{!entries.length?<p>ยังไม่มีรายการลา</p>:<div className={styles.leaveHistory}>{entries.map((entry:Row)=>{const employee=entry.employees as unknown as {employee_code:string;first_name:string;last_name:string}|null;const type=entry.leave_types as unknown as {name:string}|null;return <Link key={entry.id} href={`/workspace/leave/${entry.id}`}><strong>{employee?.first_name} {employee?.last_name} ({employee?.employee_code})</strong><span>{type?.name} · {entry.start_date}{entry.end_date!==entry.start_date?` ถึง ${entry.end_date}`:""} · {entry.status==="cancelled"?"ยกเลิก":"บันทึกแล้ว"}</span></Link>;})}</div>}</section></>;
}
