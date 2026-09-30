import Link from "next/link";
import { notFound, unstable_rethrow } from "next/navigation";
import { getEmployeeDetail } from "@/lib/employees-server";
import { EmployeeGeneralForm } from "@/components/employee-general-form";
import { RelatedForm } from "@/components/employee-related";
import { EmployeeSensitiveControls } from "@/components/employee-sensitive-controls";
import styles from "../../workspace.module.css";
type Search = Record<string, string | string[] | undefined>;
type DocumentRow = {id:string;document_type:string;document_number:null;issuing_country:string|null;expires_on:string|null;updated_at:string};
type BankRow = {id:string;bank_name:string;account_name:string;account_number:null;is_primary:boolean;updated_at:string};
type ContactRow = {id:string;name:string;relationship:string|null;phone:string;priority:number;updated_at:string};
type BalanceRow = {id:string;year:number;quota_days:number;used:number;remaining:number;leave_types:{name:string}|null};
type HistoryRow = {id:string;start_date:string;end_date:string;status:string;leave_types:{name:string}|null};
export default async function EmployeeDetailPage({ params, searchParams }: { params: Promise<{id:string}>; searchParams: Promise<Search> }) {
  const { id } = await params; const sp = await searchParams;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) notFound();
  const parsedYear = typeof sp.year === "string" ? Number(sp.year) : undefined;
  const requestedYear = parsedYear && Number.isInteger(parsedYear) && parsedYear >= 2000 && parsedYear <= 2200 ? parsedYear : undefined;
  let detail;
  try { detail = await getEmployeeDetail(id, requestedYear); }
  catch (error) { unstable_rethrow(error); return <section className={styles.panel} role="alert"><h1>โหลดข้อมูลพนักงานไม่ได้</h1><p>ระบบอ่านข้อมูลไม่สำเร็จ ลองอีกครั้งในภายหลัง</p><Link href={`/workspace/employees/${id}`}>โหลดใหม่</Link></section>; }
  if (!detail) notFound();
  const { employee, year } = detail;
  const documents = detail.documents as unknown as DocumentRow[];
  const bankAccounts = detail.bankAccounts as unknown as BankRow[];
  const emergencyContacts = detail.emergencyContacts as unknown as ContactRow[];
  const balances = detail.balances as unknown as BalanceRow[];
  const history = detail.history as unknown as HistoryRow[];
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  const yearHistory = history.filter((entry)=>entry.start_date <= yearEnd && entry.end_date >= yearStart);
  return <>
    <p className={styles.kicker}><Link href="/workspace/employees">พนักงาน</Link> / {employee.employee_code}</p>
    <h1>{employee.first_name} {employee.last_name}</h1><p className={styles.subtitle}>รายละเอียดพนักงาน · {employee.status === "active" ? "ทำงานอยู่" : "พ้นสภาพ"}</p>
    <div className={styles.detailMeta}><span>รหัส {employee.employee_code}</span><span>แผนก {employee.department || "ไม่ระบุ"}</span><span>ตำแหน่ง {employee.position || "ไม่ระบุ"}</span><span>เริ่มงาน {employee.start_date}</span><span>เบอร์โทร {employee.phone || "ไม่ระบุ"}</span><span>ที่อยู่ {employee.address || "ไม่ระบุ"}</span>{employee.termination_date && <span>พ้นสภาพ {employee.termination_date}</span>}</div>
    <section className={styles.panel}><h2>ข้อมูลทั่วไป</h2><details><summary>แก้ไขข้อมูลทั่วไป</summary><EmployeeGeneralForm key={employee.updated_at} employee={employee} /></details></section>
    <section className={styles.panel}><div className={styles.sectionHeading}><h2>เอกสารประจำตัว</h2><RelatedForm key={`new:${documents.map((r)=>`${r.id}:${r.updated_at}`).join("|")}`} kind="document" employeeId={id} employeeUpdatedAt={employee.updated_at}/></div>{documents.length ? <ul>{documents.map((doc)=><li key={doc.id}>{doc.document_type} · {mask(doc.document_number || "")} · {doc.issuing_country || "ไม่ระบุประเทศ"} · หมดอายุ {doc.expires_on || "ไม่ระบุ"} · <EmployeeSensitiveControls employeeId={id} employeeUpdatedAt={employee.updated_at} section="document" row={doc} label="เลขเอกสาร" /></li>)}</ul> : <p>ยังไม่มีเอกสารประจำตัว</p>}</section>
    <section className={styles.panel}><div className={styles.sectionHeading}><h2>บัญชีธนาคาร</h2><RelatedForm key={`new:${employee.updated_at}:${bankAccounts.map((r)=>`${r.id}:${r.updated_at}`).join("|")}`} kind="bank" employeeId={id} employeeUpdatedAt={employee.updated_at}/></div>{bankAccounts.length ? <ul>{bankAccounts.map((account)=><li key={account.id}>{account.bank_name} · {account.account_name} · {mask(account.account_number || "")} · <EmployeeSensitiveControls employeeId={id} employeeUpdatedAt={employee.updated_at} section="bank" row={account} label="เลขบัญชี" />{account.is_primary ? " · บัญชีหลัก" : ""}</li>)}</ul> : <p>ยังไม่มีบัญชีธนาคาร</p>}</section>
    <section className={styles.panel}><div className={styles.sectionHeading}><h2>ผู้ติดต่อฉุกเฉิน</h2><RelatedForm key={`new:${emergencyContacts.map((r)=>`${r.id}:${r.updated_at}`).join("|")}`} kind="contact" employeeId={id} employeeUpdatedAt={employee.updated_at}/></div>{emergencyContacts.length ? <ul>{emergencyContacts.map((contact)=><li key={contact.id}>{contact.name} · {contact.relationship || "ไม่ระบุความสัมพันธ์"} · {contact.phone} · ลำดับ {contact.priority}<RelatedForm key={`${contact.id}:${contact.updated_at}`} kind="contact" employeeId={id} employeeUpdatedAt={employee.updated_at} row={contact}/></li>)}</ul> : <p>ยังไม่มีผู้ติดต่อฉุกเฉิน</p>}</section>
    <section className={styles.panel}><div className={styles.sectionHeading}><h2>โควตาวันลา</h2><form method="get"><label>ปี <input type="number" name="year" defaultValue={year} min="2000" max="2200" /></label><button type="submit">ดูปี</button></form></div>{balances.filter((b)=>b.year===year).length ? <ul>{balances.filter((b)=>b.year===year).map((b)=><li key={b.id}>{b.leave_types?.name} · สิทธิ์ {b.quota_days} วัน · ใช้แล้ว {b.used} วัน · คงเหลือ {b.remaining} วัน</li>)}</ul> : <p>ยังไม่มีโควตาวันลาสำหรับปี {year}</p>}</section>
    <section className={styles.panel}><h2>ประวัติการลา · {year}</h2>{yearHistory.length ? <ul>{yearHistory.map((entry)=><li key={entry.id}>{entry.leave_types?.name} · {entry.start_date} ถึง {entry.end_date} · {entry.status === "cancelled" ? "ยกเลิก" : "บันทึกแล้ว"}</li>)}</ul> : <p>ยังไม่มีประวัติการลาในปี {year}</p>}</section>
  </>;
}
function mask(value:string) { return value.length < 5 ? "•".repeat(Math.max(4,value.length)) : `${"•".repeat(Math.max(4,value.length-4))}${value.slice(-4)}`; }
