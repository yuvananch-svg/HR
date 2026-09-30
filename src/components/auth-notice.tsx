"use client";
import { useSearchParams } from "next/navigation";
export function AuthNotice() {
  const notice = useSearchParams().get("notice");
  const messages: Record<string, string> = {
    login: "กรุณาเข้าสู่ระบบก่อนเปิดหน้าข้อมูล",
    denied: "บัญชีนี้ยังไม่มีสิทธิ์ใช้งาน กรุณาติดต่อเจ้าของระบบ",
    expired: "ลิงก์ยืนยันหมดอายุหรือใช้ไม่ได้ กรุณาเข้าสู่ระบบหรือขอลิงก์ใหม่",
  };
  return notice && messages[notice] ? <p role="alert">{messages[notice]}</p> : null;
}
