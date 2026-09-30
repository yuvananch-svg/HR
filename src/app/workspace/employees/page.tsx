import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { listEmployees } from "@/lib/employees-server";
import styles from "../workspace.module.css";

type Search = Record<string, string | string[] | undefined>;
const one = (v: Search[string], fallback = "") => typeof v === "string" ? v : fallback;
export default async function EmployeesPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const query = one(sp.q).trim();
  const status = one(sp.status, "all");
  const sort = one(sp.sort, "employee_code");
  const direction = one(sp.direction, "asc");
  const page = Math.max(1, Number.parseInt(one(sp.page, "1"), 10) || 1);
  let result;
  try { result = await listEmployees({ query, status, sort, direction, page, pageSize: 20 }); }
  catch (error) { unstable_rethrow(error); return <><h1>พนักงาน</h1><p className={styles.subtitle}>ทะเบียนพนักงานขององค์กร</p><section className={styles.panel} role="alert"><h2>โหลดรายชื่อไม่ได้</h2><p>ระบบอ่านข้อมูลไม่สำเร็จ ลองอีกครั้งในภายหลัง</p><Link href="/workspace/employees">โหลดใหม่</Link></section></>; }
  const pages = Math.max(1, Math.ceil(result.total / result.pageSize));
  const href = (p: number) => `/workspace/employees?${new URLSearchParams({ ...(query ? {q:query} : {}), status, sort, direction, page:String(p) }).toString()}`;
  return <>
    <div className={styles.employeeHeader}><div><h1>พนักงาน</h1><p className={styles.subtitle}>ทะเบียนพนักงานขององค์กร</p></div><Link className={styles.primaryLink} href="/workspace/employees/new">เพิ่มพนักงาน</Link></div>
    <section className={`${styles.panel} ${styles.employeePanel}`}>
      <form className={styles.employeeFilters} method="get" action="/workspace/employees">
        <label>ค้นหา<input name="q" defaultValue={query} placeholder="ชื่อ นามสกุล รหัส หรือแผนก" /></label>
        <label>สถานะ<select name="status" defaultValue={status}><option value="all">ทั้งหมด</option><option value="active">ทำงานอยู่</option><option value="terminated">พ้นสภาพ</option></select></label>
        <label>เรียงตาม<select name="sort" defaultValue={sort}><option value="employee_code">รหัสพนักงาน</option><option value="first_name">ชื่อ</option><option value="department">แผนก</option><option value="start_date">วันเริ่มงาน</option></select></label>
        <label>ทิศทาง<select name="direction" defaultValue={direction}><option value="asc">น้อยไปมาก</option><option value="desc">มากไปน้อย</option></select></label>
        <button type="submit">ค้นหา</button>
      </form>
      <p className={styles.employeeCount}>พบ {result.total} คน · หน้า {result.page} จาก {pages}</p>
      {!result.rows.length ? <p className={styles.employeeEmpty}>ไม่พบพนักงาน ลองเปลี่ยนคำค้นหาหรือตัวกรอง</p> : <div className={styles.employeeCards}>
        {result.rows.map((row) => <Link className={styles.employeeRow} href={`/workspace/employees/${row.id}`} key={row.id}>
          <span className={styles.employeeCode}>{row.employee_code}</span><strong>{row.first_name} {row.last_name}</strong><span>{row.department || "ไม่ระบุแผนก"}{row.position ? ` · ${row.position}` : ""}</span><span>{row.status === "active" ? "ทำงานอยู่" : "พ้นสภาพ"}</span>
        </Link>)}
      </div>}
      <nav className={styles.pagination} aria-label="แบ่งหน้ารายชื่อ"><span>{result.page > 1 ? <Link href={href(result.page - 1)}>← ก่อนหน้า</Link> : <span>← ก่อนหน้า</span>}</span><span>{result.page < pages ? <Link href={href(result.page + 1)}>ถัดไป →</Link> : <span>ถัดไป →</span>}</span></nav>
    </section>
  </>;
}
