import Link from "next/link";
import { LeaveEntryForm } from "@/components/leave-entry-form";
import { getLeaveFormData } from "@/lib/leave-server";
import { requireStaff } from "@/lib/auth";
import { readAll } from "@/lib/data";
import { bangkokToday, recordedUsageByEmployeeTypeYear, remainingDaysFromUsage, type Entitlement, type LeaveDay } from "@/lib/workspace";
import { HISTORY_PAGE_SIZE, historyPageHref, parseCalendarYear, parseHistoryFilters } from "@/lib/leave-history";
import { listLeaveHistory } from "@/lib/leave-history-server";
import styles from "../workspace.module.css";

type Search = Record<string, string | string[] | undefined>;
export default async function LeavePage({ searchParams }: { searchParams: Promise<Search> }) {
  const query = await searchParams;
  const parsed = parseHistoryFilters(query);
  const { employees, types } = await getLeaveFormData();
  const { client } = await requireStaff();
  const defaultYear = Number(bangkokToday().slice(0, 4));
  const balanceYearParse = parseCalendarYear(query.year,defaultYear);
  const balanceYear = balanceYearParse.year;
  const [entitlements, rawDays, history] = await Promise.all([
    readAll((from, to) => { let request=client.from("leave_entitlements").select("id,employee_id,leave_type_id,year,quota_days,employees(first_name,last_name),leave_types(name,is_active)").eq("year", balanceYear); if(parsed.filters?.employeeId)request=request.eq("employee_id",parsed.filters.employeeId); if(parsed.filters?.leaveTypeId)request=request.eq("leave_type_id",parsed.filters.leaveTypeId); return request.order("employee_id").order("id").range(from, to); }),
    readAll((from, to) => client.from("leave_entry_days").select("leave_date,days,leave_entries!inner(employee_id,leave_type_id,status)").gte("leave_date", `${balanceYear}-01-01`).lte("leave_date", `${balanceYear}-12-31`).eq("leave_entries.status", "recorded").order("leave_date").order("id").range(from, to)),
    parsed.filters ? listLeaveHistory(parsed.filters) : Promise.resolve(null),
  ]);
  const days = rawDays as unknown as LeaveDay[];
  const usage = recordedUsageByEmployeeTypeYear(days);
  const rows = history?.rows ?? [];
  return <><h1>บันทึกวันลา</h1><p className={styles.subtitle}>เลือกพนักงานและตรวจวันที่หักกับยอดคงเหลือก่อนบันทึก</p>
    <section className={styles.panel}><LeaveEntryForm employees={employees} types={types} initial={{ employee_id: parsed.filters?.employeeId }} returnTo={parsed.filters?historyPageHref(parsed.filters,history?.page??1):"/workspace/leave"}/><p className={styles.leaveNotice}>สำหรับพนักงานพ้นสภาพหรือประเภทลาที่ปิดใช้งาน ต้องลงวันที่ย้อนหลังในช่วงการจ้าง ไม่เกินวันนี้ตามเวลาไทย และระบุเหตุผล</p></section>
    <form method="get" className={styles.yearPicker}>{parsed.filters?.employeeId&&<input type="hidden" name="employee_id" value={parsed.filters.employeeId}/>}{parsed.filters?.leaveTypeId&&<input type="hidden" name="leave_type_id" value={parsed.filters.leaveTypeId}/>}{parsed.filters?.status&&<input type="hidden" name="status" value={parsed.filters.status}/>}{parsed.filters?.startDate&&<input type="hidden" name="start_date" value={parsed.filters.startDate}/>}{parsed.filters?.endDate&&<input type="hidden" name="end_date" value={parsed.filters.endDate}/>}{parsed.filters?.query&&<input type="hidden" name="q" value={parsed.filters.query}/>}<label>ปี ค.ศ. <input type="number" name="year" min="1900" max="9999" defaultValue={balanceYear}/></label><button type="submit">ดูปี</button></form>
    <section className={styles.panel}><h2>ยอดคงเหลือ · {balanceYear}</h2><p>เลือกพนักงาน ประเภท และปีเพื่อดูยอด; ช่วงวันที่ สถานะ และคำค้นใช้กรองประวัติ ไม่เปลี่ยนยอดรายปี</p>{parsed.errors.length>0?<p role="alert" className={styles.historyError}>ตรวจสอบตัวกรองก่อนแสดงยอด</p>:balanceYearParse.error?<p role="alert" className={styles.historyError}>{balanceYearParse.error}</p>:parsed.filters?.employeeId && parsed.filters.leaveTypeId && !entitlements.some(row => row.employee_id===parsed.filters!.employeeId && row.leave_type_id===parsed.filters!.leaveTypeId) ? <p role="status">ยังไม่กำหนดสิทธิ์วันลาประเภทนี้สำหรับพนักงานและปีที่เลือก</p>:!entitlements.length ? <p>ยังไม่ได้กำหนดสิทธิ์วันลาในปีนี้</p> : <div className={styles.tableWrap}><table><thead><tr><th>พนักงาน</th><th>ประเภท</th><th>โควตา</th><th>ใช้แล้ว</th><th>คงเหลือ</th></tr></thead><tbody>{entitlements.map(row => { const balance = remainingDaysFromUsage(row as Entitlement, usage); const employee = row.employees as unknown as { first_name: string; last_name: string } | null; const type = row.leave_types as unknown as { name: string; is_active: boolean } | null; return <tr key={row.id}><td>{employee?.first_name} {employee?.last_name}</td><td>{type?.name}{type && !type.is_active ? " · ปิดใช้งาน" : ""}</td><td>{balance.quota}</td><td>{balance.used}</td><td>{balance.remaining}</td></tr>; })}</tbody></table></div>}</section>
    <section className={styles.panel}><h2>ประวัติวันลา</h2><p>ปีและช่วงวันที่กรองช่วงรายการลา (วันที่เริ่ม–สิ้นสุดรวมปลายทั้งสอง); ยอดใช้แล้วนับวันที่หักจริงในปีที่เลือก</p>
      <form method="get" className={styles.historyFilters}>
        <label>ค้นหาชื่อหรือรหัส<input name="q" maxLength={100} defaultValue={parsed.filters?.query}/></label>
        <label>พนักงาน<select name="employee_id" defaultValue={parsed.filters?.employeeId ?? ""}><option value="">ทุกคน</option>{employees.map(employee => <option key={employee.id} value={employee.id}>{employee.first_name} {employee.last_name} ({employee.employee_code})</option>)}</select></label>
        <label>ประเภทลา<select name="leave_type_id" defaultValue={parsed.filters?.leaveTypeId ?? ""}><option value="">ทุกประเภท</option>{types.map(type => <option key={type.id} value={type.id}>{type.name}{!type.is_active ? " · ปิดใช้งาน" : ""}</option>)}</select></label>
        <label>สถานะ<select name="status" defaultValue={parsed.filters?.status ?? ""}><option value="">ทุกสถานะ</option><option value="recorded">บันทึกแล้ว</option><option value="cancelled">ยกเลิก</option></select></label>
        <label>ปี ค.ศ.<input name="year" type="number" min="1900" max="9999" defaultValue={parsed.filters?.year}/></label>
        <label>ตั้งแต่วันที่<input name="start_date" type="date" defaultValue={parsed.filters?.startDate}/></label><label>ถึงวันที่<input name="end_date" type="date" defaultValue={parsed.filters?.endDate}/></label>
        <button type="submit">กรอง</button><Link href="/workspace/leave">ล้างตัวกรอง</Link>
      </form>
      {parsed.errors.length > 0 ? <div role="alert" className={styles.historyError}><strong>ตัวกรองไม่ถูกต้อง</strong><ul>{parsed.errors.map(error => <li key={error}>{error}</li>)}</ul></div> : history && <>
        <p className={styles.employeeCount}>พบ {history.total} รายการ · หน้า {history.page} จาก {Math.max(1, Math.ceil(history.total / HISTORY_PAGE_SIZE))}</p>
        {!rows.length ? <p>ไม่พบรายการลาตามตัวกรอง</p> : <div className={styles.leaveHistory}>{rows.map((entry: typeof rows[number]) => { const employee = entry.employees as unknown as { employee_code: string; first_name: string; last_name: string } | null; const type = entry.leave_types as unknown as { name: string; is_active: boolean } | null; const dayLabel = entry.day_unit === "half" ? `ครึ่งวัน (${entry.half_period === "morning" ? "เช้า" : "บ่าย"})` : "เต็มวัน"; const back = historyPageHref(parsed.filters!, history.page); return <Link key={entry.id} href={`/workspace/leave/${entry.id}?returnTo=${encodeURIComponent(back)}`}><strong>{employee?.first_name} {employee?.last_name} ({employee?.employee_code})</strong><span>{type?.name}{type && !type.is_active ? " · ปิดใช้งาน" : ""} · {entry.start_date}{entry.end_date !== entry.start_date ? ` ถึง ${entry.end_date}` : ""} · {dayLabel} · {entry.status === "cancelled" ? "ยกเลิก" : "บันทึกแล้ว"} · {new Date(entry.created_at).toLocaleDateString("th-TH", {timeZone:"Asia/Bangkok"})}</span></Link>; })}</div>}
        <nav className={styles.pagination} aria-label="หน้าประวัติวันลา">{history.page > 1 ? <Link href={historyPageHref(parsed.filters!, history.page - 1)}>← ก่อนหน้า</Link> : <span/>}<span>หน้า {history.page} / {Math.max(1, Math.ceil(history.total / HISTORY_PAGE_SIZE))}</span>{history.page * history.pageSize < history.total ? <Link href={historyPageHref(parsed.filters!, history.page + 1)}>ถัดไป →</Link> : <span/>}</nav>
      </>}
    </section>
  </>;
}
