import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { bangkokToday, summarizeLeaveTypes, type LeaveDay } from "@/lib/workspace";
import { readAll } from "@/lib/data";
import { parseCalendarYear } from "@/lib/leave-history";
import styles from "./workspace.module.css";
export default async function Overview({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  const { client } = await requireStaff();
  const sp=await searchParams;
  const today = bangkokToday();
  const parsedYear=parseCalendarYear(sp.year,Number(today.slice(0,4)));
  const year=parsedYear.year;
  const [activeEmployees, todayDays, recentEntries, upcomingHolidays, entitlements, annualDays, allTypes] = await Promise.all([
    client.from("employees").select("id", { count: "exact", head: true }).eq("status", "active"),
    readAll((from,to)=>client.from("leave_entry_days").select("id,leave_entries!inner(employee_id,status)").eq("leave_date", today).eq("leave_entries.status", "recorded").order("id").range(from,to)),
    client.from("leave_entries").select("id,start_date,end_date,status,day_unit,half_period,created_at,employees(id,first_name,last_name),leave_types(name)").order("created_at", { ascending: false }).order("id",{ascending:false}).limit(5),
    client.from("holidays").select("holiday_date,name").gte("holiday_date", today).order("holiday_date").limit(1),
    readAll((from,to)=>client.from("leave_entitlements").select("employee_id,leave_type_id,quota_days,leave_types(name,is_active)").eq("year",year).order("leave_type_id").order("employee_id").range(from,to)),
    readAll((from,to)=>client.from("leave_entry_days").select("leave_date,days,leave_entries!inner(employee_id,leave_type_id,status,leave_types(name,is_active))").gte("leave_date",`${year}-01-01`).lte("leave_date",`${year}-12-31`).eq("leave_entries.status","recorded").order("leave_date").order("id").range(from,to)),
    readAll((from,to)=>client.from("leave_types").select("id,name,is_active").order("sort_order").order("id").range(from,to)),
  ]);
  if (activeEmployees.error || recentEntries.error || upcomingHolidays.error) throw new Error("โหลดภาพรวมไม่ได้");
  const people = new Set((todayDays as unknown as {id:string;leave_entries:{employee_id:string}}[]).map(row => row.leave_entries.employee_id));
  const holiday = upcomingHolidays.data?.[0];
  const typeSummary=summarizeLeaveTypes(year,allTypes,entitlements,annualDays as unknown as LeaveDay[]);
  return <><p className={styles.kicker}>HR WORKSPACE</p><h1>ภาพรวม</h1><p className={styles.subtitle}>ข้อมูลล่าสุดขององค์กร · {today}</p>{parsedYear.error&&<p role="alert" className={styles.historyError}>{parsedYear.error}</p>}
    <div className={styles.cards}><article><span>พนักงานที่ทำงานอยู่</span><strong>{activeEmployees.count ?? 0}</strong></article><article><span>คนลาวันนี้</span><strong>{people.size}</strong></article><article><span>วันหยุดถัดไป</span><strong className={styles.smallValue}>{holiday?.holiday_date ?? "ยังไม่ได้กำหนด"}</strong><span>{holiday?.name}</span></article></div>
    <section className={styles.panel}><div className={styles.sectionHeading}><h2>สิทธิ์และการใช้วันลา · {year}</h2><form method="get"><label>ปี ค.ศ. <input name="year" type="number" min="1900" max="9999" defaultValue={year}/></label><button type="submit">ดูปี</button></form></div>{parsedYear.error?<p role="status">ตรวจสอบตัวกรองปีก่อนแสดงยอด</p>:!typeSummary.length?<p>ยังไม่มีข้อมูลสิทธิ์หรือวันที่หักในปีนี้</p>:<div className={styles.tableWrap}><table><thead><tr><th>ประเภทลา</th><th>โควตารวม</th><th>ใช้แล้ว</th><th>คงเหลือ</th><th>คนมีสิทธิ์</th></tr></thead><tbody>{typeSummary.sort((a,b)=>a.name.localeCompare(b.name,"th")).map(item=><tr key={item.id}><td>{item.name}{!item.active?" · ปิดใช้งาน":""}</td><td>{item.hasEntitlement?item.quota:"ยังไม่กำหนดสิทธิ์"}</td><td>{item.used}</td><td>{item.hasEntitlement?item.quota-item.used:"ยังไม่กำหนดสิทธิ์"}</td><td>{item.entitledPeople}</td></tr>)}</tbody></table></div>}<p>ยอดแยกตามประเภท; แสดงประเภทย้อนหลังที่มีการบันทึกไว้ แม้ปิดใช้งานแล้ว</p></section>
    <section className={styles.panel}><h2>รายการลาล่าสุด</h2>{!recentEntries.data?.length ? <p>ยังไม่มีรายการลา</p> : <ul>{recentEntries.data.map(row => {
      const employee = row.employees as unknown as { first_name: string; last_name: string } | null;
      const type = row.leave_types as unknown as { name: string } | null;
      return <li key={row.id}><Link href={`/workspace/leave/${row.id}`}>{employee?.first_name} {employee?.last_name} · {type?.name} · {row.start_date}{row.end_date!==row.start_date?` ถึง ${row.end_date}`:""} · {row.day_unit==="half"?`ครึ่งวัน (${row.half_period==="morning"?"เช้า":"บ่าย"})`:"เต็มวัน"} · {row.status === "cancelled" ? "ยกเลิก" : "บันทึกแล้ว"}</Link></li>;
    })}</ul>}<Link href="/workspace/leave">ดูประวัติวันลา →</Link></section>
  </>;
}
