import { notFound } from "next/navigation";
import Link from "next/link";
import { readAll } from "@/lib/data";
import { requireStaff } from "@/lib/auth";
import { saveLeaveTypeAction, saveLeavePolicyAction, copyLeavePolicyAction, generateEntitlementsAction, saveHolidayAction, deleteHolidayAction } from "../settings-actions";
import { bangkokToday, remainingDays, type LeaveDay, type Entitlement } from "@/lib/workspace";
import styles from "../workspace.module.css";
import { ConfirmSubmit } from "@/components/confirm-submit";
export default async function Section({ params, searchParams }: { params: Promise<{ section: string }>; searchParams: Promise<Record<string,string|string[]|undefined>> }) {
  const { section } = await params;
  if (!["leave", "settings"].includes(section)) notFound();
  const query = await searchParams;
  const parsedYear = typeof query.year === "string" ? Number(query.year) : NaN;
  const defaultYear = Number(bangkokToday().slice(0,4));
  const year = Number.isInteger(parsedYear) && parsedYear >= 1900 && parsedYear <= 9999 ? parsedYear : defaultYear;
  const { client } = await requireStaff();
  if (section === "settings") {
    const results = await Promise.all([
      readAll((from,to)=>client.from("leave_types").select("id,name,is_active,sort_order,updated_at").order("sort_order").order("name").range(from,to)),
      readAll((from,to)=>client.from("leave_policy_defaults").select("id,leave_type_id,year,quota_days,updated_at,leave_types(name,is_active)").eq("year",year).order("leave_type_id").range(from,to)),
      readAll((from,to)=>client.from("holidays").select("id,holiday_date,name,updated_at").gte("holiday_date",year+"-01-01").lte("holiday_date",year+"-12-31").order("holiday_date").range(from,to)),
      readAll((from,to)=>client.from("leave_policy_defaults").select("leave_type_id,quota_days,leave_types(name)").eq("year",year-1).order("leave_type_id").range(from,to)),
      readAll((from,to)=>client.from("employees").select("id").eq("status","active").order("id").range(from,to)),
      readAll((from,to)=>client.from("leave_entitlements").select("id,employee_id,leave_type_id").eq("year",year).order("employee_id").order("id").range(from,to)),
    ]);
    const types=results[0], policies=results[1], holidays=results[2], priorPolicies=results[3], activeEmployees=results[4], existingEntitlements=results[5];
    const missingStandards=types.filter(t=>t.is_active&&!policies.some(p=>p.leave_type_id===t.id));
    const generatedPairs=types.filter(t=>t.is_active&&policies.some(p=>p.leave_type_id===t.id));
    const missingEntitlements=activeEmployees.reduce((count,e)=>count+generatedPairs.filter(t=>!existingEntitlements.some(row=>row.employee_id===e.id&&row.leave_type_id===t.id)).length,0);
    const copyPreview=priorPolicies.filter(p=>!policies.some(current=>current.leave_type_id===p.leave_type_id));
    const notice=typeof query.notice==="string"?query.notice:"";
    return <><h1>ตั้งค่า</h1><p className={styles.subtitle}>นโยบายวันลาและวันหยุดขององค์กร · ไม่มีค่าเริ่มต้นที่อ้างเป็นนโยบายจริง</p>
      {notice&&<p role="status">{notice}</p>}
      <section className={styles.panel}><h2>ประเภทลา</h2>
        {types.map(row=><form key={`${row.id}:${row.updated_at}`} action={saveLeaveTypeAction} className={styles.policyForm}><input type="hidden" name="id" value={row.id}/><input type="hidden" name="revision" value={row.updated_at}/><label>ชื่อประเภท<input name="name" required maxLength={120} defaultValue={row.name}/></label><label>ลำดับ<input name="sort_order" type="number" min="0" defaultValue={row.sort_order}/></label><label>เปิดใช้งาน<input name="active" type="checkbox" defaultChecked={row.is_active}/></label><button type="submit">บันทึก</button></form>)}
        {!types.length&&<p>ยังไม่ได้กำหนดประเภทลา</p>}<form action={saveLeaveTypeAction} className={styles.policyForm}><label>ชื่อประเภทใหม่<input name="name" required maxLength={120}/></label><label>ลำดับ<input name="sort_order" type="number" min="0" defaultValue="0"/></label><label>เปิดใช้งาน<input name="active" type="checkbox" defaultChecked/></label><button type="submit">เพิ่มประเภท</button></form>
      </section>
      <section className={styles.panel}><div className={styles.sectionHeading}><h2>โควตามาตรฐานรายปี</h2><form method="get"><label>ปี ค.ศ. <input type="number" name="year" defaultValue={year} min="1900" max="9999"/></label><button type="submit">ดูปี</button></form></div>
        {types.map(type=>{const row=policies.find(p=>p.leave_type_id===type.id); return type.is_active?<form key={`${type.id}:${row?.updated_at??"new"}`} action={saveLeavePolicyAction} className={styles.policyForm}><strong>{type.name}</strong><input type="hidden" name="leave_type_id" value={type.id}/><input type="hidden" name="year" value={year}/>{row&&<><input type="hidden" name="id" value={row.id}/><input type="hidden" name="revision" value={row.updated_at}/></>}<label>โควตา (วัน)<input type="number" name="quota_days" min="0" step="0.5" max="99999.5" required defaultValue={row?.quota_days??""}/></label><button type="submit">{row?"บันทึก":"กำหนดโควตา"}</button></form>:row?<p key={type.id}>{type.name} · ปิดใช้งาน · โควตาปี {year}: {row.quota_days} วัน</p>:null})}
        {!types.some(t=>t.is_active)&&<p>ยังไม่มีประเภทลาที่เปิดใช้งาน</p>}
        <p>ตัวอย่างจากปี {year-1}: {priorPolicies.length?priorPolicies.map(p=>(p.leave_types as unknown as {name:string})?.name+" "+p.quota_days+" วัน").join(" · "):"ไม่มีโควตามาตรฐาน"}{copyPreview.length?" · จะเพิ่ม: "+copyPreview.map(p=>(p.leave_types as unknown as {name:string})?.name+" "+p.quota_days+" วัน").join(" · "):" · ไม่มีรายการใหม่"}</p>
        <ConfirmSubmit action={copyLeavePolicyAction} message={"ยืนยันคัดลอกค่าที่แสดงจากปี "+(year-1)+" เฉพาะประเภทที่ยังไม่มีในปี "+year+"? ค่าที่มีอยู่จะไม่ถูกเขียนทับ."}><div className={styles.policyForm}><strong>คัดลอกโควตาปีก่อน</strong><input type="hidden" name="from_year" value={year-1}/><input type="hidden" name="to_year" value={year}/><button type="submit" disabled={year<=1900||!copyPreview.length}>ยืนยันคัดลอก</button></div></ConfirmSubmit>
        <p>ตัวอย่างสิทธิ์ที่ขาด: {missingEntitlements} รายการ สำหรับพนักงาน active {activeEmployees.length} คนในปี {year}.{missingStandards.length>0&&" ยังไม่มีค่ามาตรฐานสำหรับ: "+missingStandards.map(t=>t.name).join(", ")+"; การสร้างจะไม่ทำรายการใดจนกว่าจะกำหนดครบ."}</p>
        <form action={generateEntitlementsAction} className={styles.policyForm}><input type="hidden" name="year" value={year}/><p>รวมพนักงาน active ทุกคนในปีนี้ รวมผู้เริ่มงานใหม่; เรียกซ้ำได้และไม่เขียนทับ override</p><button type="submit" disabled={!missingEntitlements||missingStandards.length>0}>สร้างสิทธิ์พนักงานปี {year}</button></form>
        {!policies.length&&<p>ยังไม่มีโควตามาตรฐานสำหรับปี {year}</p>}
      </section>
      <section className={styles.panel}><h2>วันหยุด · {year}</h2><p>แก้ไขหรือลบวันหยุดมีผลกับการคำนวณรายการลาใหม่เท่านั้น ไม่แก้วันที่บันทึกไว้แล้ว</p>{holidays.map(row=><div key={`${row.id}:${row.updated_at}`} className={styles.holidayRow}><form action={saveHolidayAction} className={styles.policyForm}><input type="hidden" name="id" value={row.id}/><input type="hidden" name="revision" value={row.updated_at}/><label>วันที่<input type="date" name="holiday_date" required defaultValue={row.holiday_date}/></label><label>ชื่อ<input name="name" required maxLength={160} defaultValue={row.name}/></label><button type="submit">บันทึก</button></form><ConfirmSubmit action={deleteHolidayAction} message="ยืนยันลบวันหยุดนี้? ประวัติวันลาที่บันทึกแล้วจะไม่เปลี่ยน"><input type="hidden" name="id" value={row.id}/><input type="hidden" name="revision" value={row.updated_at}/><input type="hidden" name="year" value={year}/><button type="submit">ลบ</button></ConfirmSubmit></div>)}
        {!holidays.length&&<p>ยังไม่มีวันหยุดในปีนี้</p>}<form action={saveHolidayAction} className={styles.policyForm}><label>วันที่<input type="date" name="holiday_date" required defaultValue={year+"-01-01"}/></label><label>ชื่อวันหยุด<input name="name" required maxLength={160}/></label><button type="submit">เพิ่มวันหยุด</button></form>
      </section>
    </>;
  }
  const [entriesResult, entitlements, days] = await Promise.all([
    client.from("leave_entries").select("id,start_date,end_date,status,employees(id,first_name,last_name),leave_types(name)").lte("start_date",year+"-12-31").gte("end_date",year+"-01-01").order("start_date", { ascending: false }).limit(100),
    readAll((from,to)=>client.from("leave_entitlements").select("id,employee_id,leave_type_id,year,quota_days,employees(first_name,last_name),leave_types(name)").eq("year",year).order("employee_id").order("id").range(from,to)),
    readAll((from,to) => client.from("leave_entry_days").select("leave_date,days,leave_entries!inner(employee_id,leave_type_id,status)").gte("leave_date",year+"-01-01").lte("leave_date",year+"-12-31").order("id").range(from,to)),
  ]);
  if (entriesResult.error) throw new Error("โหลดวันลาไม่ได้");
  const typedDays=days as unknown as LeaveDay[];
  return <><div className={styles.employeeHeader}><div><h1>วันลา</h1><p className={styles.subtitle}>ยอดสิทธิ์ปี {year} และรายการล่าสุด 100 รายการ</p></div><Link href="/workspace/leave" className={styles.primaryLink}>บันทึกวันลา</Link></div><form method="get" className={styles.yearPicker}><label>ปี ค.ศ. <input type="number" name="year" min="1900" max="9999" defaultValue={year}/></label><button type="submit">ดูปี</button></form>
    <section className={styles.panel}><h2>ยอดคงเหลือ</h2>{!entitlements.length ? <p>ยังไม่ได้กำหนดสิทธิ์วันลา</p> : <div className={styles.tableWrap}><table><thead><tr><th>พนักงาน</th><th>ประเภท</th><th>โควตา</th><th>ใช้แล้ว</th><th>คงเหลือ</th></tr></thead><tbody>{entitlements.map(row => {
      const balance = remainingDays(row as Entitlement, typedDays);
      const employee = row.employees as unknown as {first_name:string;last_name:string};
      return <tr key={row.employee_id+row.leave_type_id}><td>{employee?.first_name} {employee?.last_name}</td><td>{(row.leave_types as unknown as {name:string})?.name}</td><td>{balance.quota}</td><td>{balance.used}</td><td>{balance.remaining}</td></tr>;
    })}</tbody></table></div>}</section>
    <section className={styles.panel}><h2>ประวัติวันลา</h2>{!entriesResult.data?.length ? <p>ยังไม่มีรายการลา</p> : <ul>{entriesResult.data.map(row => {
      const emp= row.employees as unknown as {id:string;first_name:string;last_name:string};
      return <li key={row.id}><Link href={`/workspace/leave/${row.id}`}>{emp?.first_name} {emp?.last_name} · {(row.leave_types as unknown as {name:string})?.name} · {row.start_date} ถึง {row.end_date} · {row.status === "cancelled" ? "ยกเลิก" : "บันทึกแล้ว"}</Link></li>;
    })}</ul>}</section>
  </>;
}
