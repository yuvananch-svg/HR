import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { bangkokToday } from "@/lib/workspace";
import styles from "./workspace.module.css";
export default async function Overview() {
  const { client } = await requireStaff();
  const today = bangkokToday();
  const results = await Promise.all([
    client.from("employees").select("id", { count: "exact", head: true }).eq("status", "active"),
    client.from("leave_entry_days").select("leave_entries!inner(employee_id,status)").eq("leave_date", today).eq("leave_entries.status", "recorded"),
    client.from("leave_entries").select("id,start_date,end_date,status,employees(first_name,last_name),leave_types(name)").order("created_at", { ascending: false }).limit(5),
    client.from("holidays").select("holiday_date,name").gte("holiday_date", today).order("holiday_date").limit(1),
  ]);
  if (results.some(result => result.error)) throw new Error("โหลดภาพรวมไม่ได้");
  const people = new Set((results[1].data ?? []).map(row => (row.leave_entries as unknown as { employee_id: string }).employee_id));
  const holiday = results[3].data?.[0];
  return <><p className={styles.kicker}>HR WORKSPACE</p><h1>ภาพรวม</h1><p className={styles.subtitle}>ข้อมูลล่าสุดขององค์กร · {today}</p>
    <div className={styles.cards}><article><span>พนักงานที่ทำงานอยู่</span><strong>{results[0].count ?? 0}</strong></article><article><span>คนลาวันนี้</span><strong>{people.size}</strong></article><article><span>วันหยุดถัดไป</span><strong className={styles.smallValue}>{holiday?.holiday_date ?? "ยังไม่ได้กำหนด"}</strong><span>{holiday?.name}</span></article></div>
    <section className={styles.panel}><h2>รายการลาล่าสุด</h2>{!results[2].data?.length ? <p>ยังไม่มีรายการลา</p> : <ul>{results[2].data.map(row => {
      const employee = row.employees as unknown as { first_name: string; last_name: string } | null;
      const type = row.leave_types as unknown as { name: string } | null;
      return <li key={row.id}>{employee?.first_name} {employee?.last_name} · {type?.name} · {row.start_date} ถึง {row.end_date} · {row.status === "cancelled" ? "ยกเลิก" : "บันทึกแล้ว"}</li>;
    })}</ul>}<Link href="/workspace/leave">ดูประวัติวันลา →</Link></section>
  </>;
}
