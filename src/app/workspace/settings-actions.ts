"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { readAll } from "@/lib/data";

const text = (fd: FormData, key: string) => String(fd.get(key) ?? "").trim();
const yearOk = (y: number) => Number.isInteger(y) && y >= 1900 && y <= 9999;
const quotaOk = (q: number) => Number.isFinite(q) && q >= 0 && q <= 99999.9 && q * 2 % 1 === 0;
const validDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year,month,day]=value.split("-").map(Number);
  if(year<1||year>9999)return false;
  const date=new Date(0); date.setUTCHours(0,0,0,0); date.setUTCFullYear(year,month-1,day);
  return date.getUTCFullYear()===year&&date.getUTCMonth()===month-1&&date.getUTCDate()===day;
};
function finish(message: string, year?: number, path = "/workspace/settings"): never {
  revalidatePath("/workspace", "layout");
  revalidatePath("/workspace/employees/[id]", "page");
  redirect(path + "?notice=" + encodeURIComponent(message) + (year ? "&year=" + year : ""));
}
export async function saveLeaveTypeAction(fd: FormData) {
  const { client } = await requireStaff();
  const name=text(fd,"name"), id=text(fd,"id")||null, revision=text(fd,"revision")||null;
  const active=fd.get("active")==="on", order=Number(text(fd,"sort_order")||"0");
  if (!name || name.length>120 || !Number.isInteger(order) || order<0) finish("กรุณาระบุชื่อประเภทลาและลำดับที่ถูกต้อง");
  const { error } = await client.rpc("save_leave_type", {p_id:id,p_name:name,p_is_active:active,p_sort_order:order,p_expected_updated_at:revision});
  if (error) finish(error.code==="23505" ? "ชื่อประเภทลานี้มีอยู่แล้ว" : error.message.includes("revision_conflict") ? "ข้อมูลถูกแก้ไขแล้ว กรุณาโหลดหน้าใหม่" : "บันทึกประเภทลาไม่สำเร็จ");
  finish("บันทึกประเภทลาแล้ว");
}
export async function saveLeavePolicyAction(fd: FormData) {
  const { client }=await requireStaff();
  const rawQuota=text(fd,"quota_days"), id=text(fd,"id")||null, revision=text(fd,"revision")||null, type=text(fd,"leave_type_id"), year=Number(text(fd,"year")), quota=Number(rawQuota);
  if (!rawQuota || !type || !yearOk(year) || !quotaOk(quota)) finish("ปีต้องอยู่ระหว่าง ค.ศ. 1900–9999 และโควตาต้องเป็น 0 หรือเพิ่มครั้งละ 0.5 วัน");
  const {error}=await client.rpc("save_leave_policy_default",{p_id:id,p_leave_type_id:type,p_year:year,p_quota_days:quota,p_expected_updated_at:revision});
  if(error) finish(error.code==="23505"?"มีโควตามาตรฐานประเภทนี้ในปีดังกล่าวแล้ว":error.message.includes("revision_conflict")?"ข้อมูลถูกแก้ไขแล้ว กรุณาโหลดหน้าใหม่":"บันทึกโควตาไม่สำเร็จ",year);
  finish("บันทึกโควตามาตรฐานแล้ว",year);
}
export async function copyLeavePolicyAction(fd: FormData) {
  const {client}=await requireStaff();
  const from=Number(text(fd,"from_year")), to=Number(text(fd,"to_year"));
  if(!yearOk(from)||!yearOk(to)||from===to) finish("กรุณาตรวจสอบปีต้นทางและปีปลายทาง");
  let source: {leave_type_id:string;quota_days:number}[], target: {leave_type_id:string}[];
  try {
    [source,target]=await Promise.all([
      readAll((start,end)=>client.from("leave_policy_defaults").select("leave_type_id,quota_days").eq("year",from).order("leave_type_id").range(start,end)),
      readAll((start,end)=>client.from("leave_policy_defaults").select("leave_type_id").eq("year",to).order("leave_type_id").range(start,end)),
    ]);
  } catch { finish("อ่านโควตามาตรฐานไม่สำเร็จ",to); }
  if(!source!.length) finish("ปีก่อนยังไม่มีโควตามาตรฐาน",to);
  const present=new Set(target!.map(row=>row.leave_type_id));
  const missing=source!.filter(row=>!present.has(row.leave_type_id));
  if(!missing.length) finish("ไม่มีค่าใหม่ให้คัดลอก; ระบบไม่เขียนทับค่าที่มี",to);
  const result=await client.rpc("copy_leave_policy_defaults",{p_from_year:from,p_to_year:to});
  if(result.error) finish("คัดลอกโควตาไม่สำเร็จ กรุณาโหลดใหม่",to);
  finish("คัดลอก "+Number(result.data??0)+" ค่าแล้ว; ค่าที่มีอยู่เดิมคงเดิม",to);
}
export async function generateEntitlementsAction(fd: FormData) {
  const {client}=await requireStaff(); const year=Number(text(fd,"year"));
  if(!yearOk(year)) finish("กรุณาระบุปีที่ถูกต้อง",year);
  const {data,error}=await client.rpc("generate_leave_entitlements",{p_year:year});
  if(error) finish(error.message.includes("missing_policy_defaults")?"ยังมีประเภทลาเปิดใช้งานที่ไม่มีโควตามาตรฐาน": "สร้างสิทธิ์ไม่สำเร็จ กรุณาตรวจสอบสิทธิ์และลองใหม่",year);
  revalidatePath("/workspace/employees/[id]", "page");
  finish("สร้างสิทธิ์ที่ขาด "+Number(data??0)+" รายการแล้ว",year);
}
export async function saveHolidayAction(fd: FormData) {
  const {client}=await requireStaff();
  const id=text(fd,"id")||null, revision=text(fd,"revision")||null, date=text(fd,"holiday_date"), name=text(fd,"name");
  if(!validDate(date)||!name||name.length>160) finish("กรุณาระบุวันที่และชื่อวันหยุดให้ถูกต้อง");
  const {error}=await client.rpc("save_holiday",{p_id:id,p_holiday_date:date,p_name:name,p_expected_updated_at:revision});
  if(error) finish(error.code==="23505"?"มีวันหยุดในวันนี้แล้ว":error.message.includes("revision_conflict")?"ข้อมูลถูกแก้ไขแล้ว กรุณาโหลดหน้าใหม่":"บันทึกวันหยุดไม่สำเร็จ",Number(date.slice(0,4)));
  finish("บันทึกวันหยุดแล้ว",Number(date.slice(0,4)));
}
export async function deleteHolidayAction(fd: FormData) {
  const {client}=await requireStaff(); const id=text(fd,"id"), revision=text(fd,"revision"),year=Number(text(fd,"year"));
  if(!id||!revision) finish("ข้อมูลวันหยุดไม่ครบ กรุณาโหลดหน้าใหม่",year);
  const {error}=await client.rpc("delete_holiday",{p_id:id,p_expected_updated_at:revision});
  if(error) finish(error.message.includes("revision_conflict")?"วันหยุดถูกแก้ไขแล้ว กรุณาโหลดใหม่":"ลบวันหยุดไม่สำเร็จ",year);
  finish("ลบวันหยุดแล้ว; ประวัติวันที่ลาที่บันทึกไว้เดิมไม่เปลี่ยน",year);
}
export async function overrideEntitlementAction(fd: FormData) {
  const {client}=await requireStaff(); const employee=text(fd,"employee_id"), type=text(fd,"leave_type_id"), year=Number(text(fd,"year")), revision=text(fd,"revision"), reason=text(fd,"reason"), rawQuota=text(fd,"quota_days"), quota=Number(rawQuota);
  if(!employee||!type||!yearOk(year)||!revision||!reason||reason.length>500||!rawQuota||!quotaOk(quota)) finish("กรุณาระบุโควตาที่เพิ่มครั้งละ 0.5 วันและเหตุผลไม่เกิน 500 ตัวอักษร",year,employee?"/workspace/employees/"+employee:"/workspace/settings");
  const {error}=await client.rpc("save_leave_entitlement",{p_employee_id:employee,p_leave_type_id:type,p_year:year,p_quota_days:quota,p_reason:reason,p_expected_updated_at:revision});
  if(error) finish(error.message.includes("quota_below_used")?"โควตาต้องไม่น้อยกว่าวันที่ใช้แล้ว":error.message.includes("revision_conflict")?"สิทธิ์ถูกแก้ไขโดยผู้ใช้อื่น กรุณาโหลดข้อมูลใหม่":"ปรับสิทธิ์ไม่สำเร็จ",year,"/workspace/employees/"+employee);
  revalidatePath("/workspace/employees/"+employee);
  finish("ปรับสิทธิ์แล้ว",year,"/workspace/employees/"+employee);
}
export async function resetEntitlementAction(fd: FormData) {
  const {client}=await requireStaff(); const employee=text(fd,"employee_id"), type=text(fd,"leave_type_id"), year=Number(text(fd,"year")), revision=text(fd,"revision");
  if(!employee||!type||!yearOk(year)||!revision) finish("ข้อมูลสิทธิ์ไม่ครบ",year,employee?"/workspace/employees/"+employee:"/workspace/settings");
  const {error}=await client.rpc("reset_leave_entitlement",{p_employee_id:employee,p_leave_type_id:type,p_year:year,p_expected_updated_at:revision});
  if(error) finish(error.message.includes("quota_below_used")?"โควตามาตรฐานต่ำกว่าวันที่ใช้แล้ว จึงคืนค่าไม่ได้":error.message.includes("policy_not_found")?"ปีนี้ไม่มีโควตามาตรฐาน":"คืนค่าโควตาไม่สำเร็จ",year,"/workspace/employees/"+employee);
  revalidatePath("/workspace/employees/"+employee);
  finish("คืนค่าโควตามาตรฐานแล้ว",year,"/workspace/employees/"+employee);
}
