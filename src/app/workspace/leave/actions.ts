"use server";
import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { previewLeave, type PreviewInput } from "@/lib/leave-server";

export type LeaveActionState = { success:boolean; message:string; errors:Record<string,string[]>; id?:string; code?:string };
const fail=(message:string,errors:Record<string,string[]>={},code?:string):LeaveActionState=>({success:false,message,errors,...(code?{code}:{})});
const val=(form:FormData,key:string)=>String(form.get(key)??"").trim();
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function safeError(e:unknown) {
  const m=e instanceof Error?e.message:e&&typeof e==="object"&&"message" in e?String((e as {message:unknown}).message):"";
  const map:Record<string,string>={quota_exceeded:"ยอดสิทธิ์คงเหลือไม่เพียงพอ",overlap_conflict:"ช่วงวันลาทับซ้อนกับรายการอื่น",no_working_days:"ช่วงวันที่เลือกไม่มีวันทำงาน",preview_changed:"ข้อมูลวันลาเปลี่ยนหลังดูตัวอย่าง กรุณาตรวจสอบตัวอย่างใหม่",revision_conflict:"รายการนี้ถูกแก้ไขแล้ว กรุณาโหลดข้อมูลใหม่",request_key_conflict:"คำขอเดิมมีข้อมูลไม่ตรงกัน กรุณาโหลดหน้าใหม่",entry_cancelled:"รายการนี้ถูกยกเลิกแล้ว",employee_not_found:"ไม่พบพนักงาน",leave_type_not_found:"ไม่พบประเภทลา",entitlement_not_found:"ยังไม่ได้กำหนดสิทธิ์วันลาสำหรับปีนี้",missing_entitlement:"ยังไม่ได้กำหนดสิทธิ์วันลา",invalid_leave_entry:"ข้อมูลวันลาไม่ถูกต้อง",active_staff_required:"ไม่มีสิทธิ์ดำเนินการ",inactive_reason_required:"การลงย้อนหลังให้พนักงานหรือประเภทลาที่ปิดใช้งานต้องระบุเหตุผล",outside_employment:"วันที่ลาอยู่นอกช่วงการจ้างงาน",inactive_type_future_date:"ประเภทลาที่ปิดใช้งานใช้กับวันลาในอดีตได้เท่านั้น",employee_change_not_allowed:"ไม่สามารถเปลี่ยนพนักงานของรายการเดิมได้",entry_not_found:"ไม่พบรายการลา",leave_range_too_long:"ระบบรับช่วงวันที่ไม่เกิน 3,660 วันปฏิทินต่อรายการ เพื่อควบคุมการประมวลผล"};
  const token=Object.keys(map).find(k=>m.includes(k)); return token?map[token]:"ระบบบันทึกวันลาไม่สำเร็จ กรุณาลองอีกครั้ง";
}
function validDate(s:string) { if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return false;const d=new Date(`${s}T00:00:00Z`);return !Number.isNaN(d.valueOf())&&d.toISOString().slice(0,10)===s; }
function parse(form:FormData):{input?:PreviewInput;errors:Record<string,string[]>;reason:string} {
 const employeeId=val(form,"employee_id"),leaveTypeId=val(form,"leave_type_id"),startDate=val(form,"start_date"),endDate=val(form,"end_date"),unit=val(form,"unit"),entryId=val(form,"entry_id")||undefined,reason=val(form,"reason");
 const errors:Record<string,string[]>={}; if(!uuid.test(employeeId))errors.employee_id=["กรุณาเลือกพนักงาน"];if(!uuid.test(leaveTypeId))errors.leave_type_id=["กรุณาเลือกประเภทลา"];
 if(!validDate(startDate))errors.start_date=["กรุณาระบุวันที่เริ่มต้นให้ถูกต้อง"];if(!validDate(endDate))errors.end_date=["กรุณาระบุวันที่สิ้นสุดให้ถูกต้อง"];if(validDate(startDate)&&validDate(endDate)&&startDate>endDate)errors.end_date=["วันที่สิ้นสุดต้องไม่ก่อนวันที่เริ่มต้น"];
 if(!["full","morning","afternoon"].includes(unit))errors.unit=["กรุณาเลือกหน่วยลา"];if(entryId&&!uuid.test(entryId))errors.entry_id=["รายการลาไม่ถูกต้อง"];
 if(validDate(startDate)&&validDate(endDate)&&startDate.slice(0,4)<"1900")errors.start_date=["รองรับวันที่ตั้งแต่ปี ค.ศ. 1900"];
 if(validDate(startDate)&&validDate(endDate)&&startDate<=endDate&&(Date.parse(`${endDate}T00:00:00Z`)-Date.parse(`${startDate}T00:00:00Z`))/86400000+1>3660)errors.end_date=["ช่วงวันที่ไม่เกิน 3,660 วันปฏิทินต่อรายการ เพื่อควบคุมการประมวลผล"];
 if(["morning","afternoon"].includes(unit)&&validDate(startDate)&&validDate(endDate)&&startDate!==endDate)errors.end_date=["การลาครึ่งวันต้องเป็นวันเดียว"];
 return {input:Object.keys(errors).length?undefined:{employeeId,leaveTypeId,startDate,endDate,unit:unit as PreviewInput["unit"],entryId},errors,reason};
}
export async function previewLeaveAction(form:FormData) {
 await requireStaff();const {input,errors,reason}=parse(form);if(!input)return {success:false,message:"กรุณาตรวจสอบข้อมูล",errors,preview:null,reason};
 try { const preview=await previewLeave(input);return {success:true,message:"ตรวจสอบวันลาแล้ว",errors:{},preview,reason}; }
 catch(e){return {success:false,message:safeError(e),errors:{},preview:null,reason};}
}
export async function saveLeaveAction(_state:LeaveActionState,form:FormData):Promise<LeaveActionState> {
 const {client}=await requireStaff();const {input,errors,reason}=parse(form);
 if(!input)return fail("กรุณาตรวจสอบข้อมูล",errors);
 const fingerprint=val(form,"preview_fingerprint"),requestKey=val(form,"request_key"),expected=val(form,"expected_revision"),changeReason=val(form,"change_reason");
 if(!fingerprint||!uuid.test(requestKey))return fail("กรุณาดูตัวอย่างวันลาก่อนยืนยัน");
 if(input.entryId&&!expected)return fail("ไม่พบข้อมูลรุ่นของรายการ กรุณาโหลดหน้าใหม่");
 if(input.entryId&&!changeReason)return fail("กรุณาระบุเหตุผลการแก้ไข",{change_reason:["กรุณาระบุเหตุผล"]});
 if(reason.length>500||changeReason.length>500)return fail("เหตุผลยาวเกินกำหนด",{reason:reason.length>500?["ไม่เกิน 500 ตัวอักษร"]:[],change_reason:changeReason.length>500?["ไม่เกิน 500 ตัวอักษร"]:[]});
 try {
   const {data,error}=await client.rpc("save_leave_entry",{p_request_key:requestKey,p_employee_id:input.employeeId,p_leave_type_id:input.leaveTypeId,p_start_date:input.startDate,p_end_date:input.endDate,p_unit:input.unit,p_reason:reason||null,p_preview_fingerprint:fingerprint,p_entry_id:input.entryId??null,p_expected_revision:expected||null,p_change_reason:changeReason||null});
   if(error)throw error;const id=String(data);revalidatePath("/workspace/leave");revalidatePath(`/workspace/leave/${id}`);revalidatePath(`/workspace/employees/${input.employeeId}`);revalidatePath("/workspace");
   return {success:true,message:"บันทึกวันลาแล้ว",errors:{},id};
 }catch(e){const conflict=e&&typeof e==="object"&&"message" in e&&String((e as {message:unknown}).message).includes("preview_changed");return fail(safeError(e),{},conflict?"preview_changed":undefined);}
}
export async function cancelLeaveAction(_state:LeaveActionState,form:FormData):Promise<LeaveActionState> {
 const {client}=await requireStaff();const id=val(form,"entry_id"),expected=val(form,"expected_revision"),reason=val(form,"reason"),key=val(form,"request_key");
 if(!uuid.test(id)||!expected||!uuid.test(key))return fail("ข้อมูลยกเลิกไม่ครบ กรุณาโหลดหน้าใหม่");if(reason.length<3)return fail("กรุณาระบุเหตุผลการยกเลิก",{reason:["กรุณาระบุเหตุผลอย่างน้อย 3 ตัวอักษร"]});if(reason.length>500)return fail("เหตุผลยาวเกินกำหนด",{reason:["ไม่เกิน 500 ตัวอักษร"]});
 try{const {data:entry}=await client.from("leave_entries").select("employee_id").eq("id",id).maybeSingle();const {data,error}=await client.rpc("cancel_leave_entry",{p_entry_id:id,p_expected_revision:expected,p_reason:reason,p_request_key:key});if(error)throw error;revalidatePath("/workspace/leave");revalidatePath(`/workspace/leave/${id}`);if(entry?.employee_id)revalidatePath(`/workspace/employees/${entry.employee_id}`);revalidatePath("/workspace");return {success:true,message:"ยกเลิกรายการแล้ว",errors:{},id:String(data)};}catch(e){return fail(safeError(e));}
}
