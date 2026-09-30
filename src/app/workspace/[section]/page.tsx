import { notFound } from "next/navigation";
import { readAll } from "@/lib/data";
import { requireStaff } from "@/lib/auth";
import { bangkokToday, remainingDays, type LeaveDay, type Entitlement } from "@/lib/workspace";
import styles from "../workspace.module.css";
export default async function Section({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  if (!["employees", "leave", "settings"].includes(section)) notFound();
  const { client } = await requireStaff();
  if (section === "employees") {
    const { data, error } = await client.from("employees").select("id,employee_code,first_name,last_name,department,position,start_date,status").order("employee_code");
    if (error) throw new Error("โหลดพนักงานไม่ได้");
    return <><h1>พนักงาน</h1><p className={styles.subtitle}>ทะเบียนพนักงานขององค์กร</p><section className={styles.panel}>
      {!data?.length ? <p>ยังไม่มีข้อมูลพนักงาน</p> : <div className={styles.tableWrap}><table><thead><tr><th>รหัส</th><th>ชื่อ–นามสกุล</th><th>แผนก</th><th>ตำแหน่ง</th><th>วันเริ่มงาน</th><th>สถานะ</th></tr></thead>
        <tbody>{data.map(row => <tr key={row.id}><td>{row.employee_code}</td><td>{row.first_name} {row.last_name}</td><td>{row.department ?? "—"}</td><td>{row.position ?? "—"}</td><td>{row.start_date}</td><td>{row.status === "active" ? "ทำงานอยู่" : "พ้นสภาพ"}</td></tr>)}</tbody></table></div>}
    </section></>;
  }
  if (section === "settings") {
    const results = await Promise.all([
      client.from("leave_types").select("id,name,is_active").order("sort_order"),
      client.from("leave_policy_defaults").select("id,year,quota_days,leave_types(name)").order("year", { ascending: false }),
      client.from("holidays").select("id,holiday_date,name").order("holiday_date"),
    ]);
    if (results.some(result => result.error)) throw new Error("โหลดตั้งค่าไม่ได้");
    return <><h1>ตั้งค่า</h1><p className={styles.subtitle}>นโยบายวันลาและวันหยุดขององค์กร</p>
      <section className={styles.panel}><h2>ประเภทลา</h2>{results[0].data?.length ? <ul>{results[0].data.map(row => <li key={row.id}>{row.name} · {row.is_active ? "เปิดใช้งาน" : "ปิดใช้งาน"}</li>)}</ul> : <p>ยังไม่ได้กำหนดประเภทลา</p>}</section>
      <section className={styles.panel}><h2>โควตามาตรฐานรายปี</h2>{results[1].data?.length ? <ul>{results[1].data.map(row => <li key={row.id}>{row.year} · {(row.leave_types as unknown as {name: string})?.name} · {row.quota_days} วัน</li>)}</ul> : <p>ยังไม่ได้กำหนดโควตา</p>}</section>
      <section className={styles.panel}><h2>วันหยุด</h2>{results[2].data?.length ? <ul>{results[2].data.map(row => <li key={row.id}>{row.holiday_date} · {row.name}</li>)}</ul> : <p>ยังไม่ได้กำหนดวันหยุด</p>}</section>
    </>;
  }
  const year = Number(bangkokToday().slice(0,4));
  const results = await Promise.all([
    client.from("leave_entries").select("id,start_date,end_date,status,employees(first_name,last_name),leave_types(name)").order("start_date", { ascending: false }).limit(100),
    client.from("leave_entitlements").select("employee_id,leave_type_id,year,quota_days,employees(first_name,last_name),leave_types(name)").eq("year",year),
    readAll((from,to) => client.from("leave_entry_days").select("leave_date,days,leave_entries!inner(employee_id,leave_type_id,status)").gte("leave_date",year+"-01-01").lte("leave_date",year+"-12-31").order("id").range(from,to)),
  ]);
  if (results.slice(0,2).some(result => "error" in result && result.error)) throw new Error("โหลดวันลาไม่ได้");
  const days = results[2] as unknown as LeaveDay[];
  return <><h1>วันลา</h1><p className={styles.subtitle}>ยอดสิทธิ์ปี {year} และรายการล่าสุด 100 รายการ</p>
    <section className={styles.panel}><h2>ยอดคงเหลือ</h2>{!results[1].data?.length ? <p>ยังไม่ได้กำหนดสิทธิ์วันลา</p> : <div className={styles.tableWrap}><table><thead><tr><th>พนักงาน</th><th>ประเภท</th><th>โควตา</th><th>ใช้แล้ว</th><th>คงเหลือ</th></tr></thead><tbody>{results[1].data.map(row => {
      const balance = remainingDays(row as Entitlement, days);
      const employee = row.employees as unknown as {first_name:string;last_name:string};
      return <tr key={row.employee_id+row.leave_type_id}><td>{employee?.first_name} {employee?.last_name}</td><td>{(row.leave_types as unknown as {name:string})?.name}</td><td>{balance.quota}</td><td>{balance.used}</td><td>{balance.remaining}</td></tr>;
    })}</tbody></table></div>}</section>
    <section className={styles.panel}><h2>ประวัติวันลา</h2>{!results[0].data?.length ? <p>ยังไม่มีรายการลา</p> : <ul>{results[0].data.map(row => {
      const employee = row.employees as unknown as {first_name:string;last_name:string};
      return <li key={row.id}>{employee?.first_name} {employee?.last_name} · {(row.leave_types as unknown as {name:string})?.name} · {row.start_date} ถึง {row.end_date} · {row.status === "cancelled" ? "ยกเลิก" : "บันทึกแล้ว"}</li>;
    })}</ul>}</section>
  </>;
}
