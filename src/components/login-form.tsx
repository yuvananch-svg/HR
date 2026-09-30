"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "../lib/supabase/client";
import styles from "../app/login.module.css";

export function LoginForm() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "setup" | "recover">("login");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setMessage("");
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim().toLowerCase();
    const password = String(form.get("password") ?? "");
    try {
      const client = createClient();
      if (mode === "recover") {
        const { error } = await client.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin + "/auth/callback?flow=recovery",
        });
        setMessage(error ? "ยังส่งอีเมลไม่ได้ กรุณารอสักครู่แล้วลองใหม่" : "หากอีเมลนี้มีบัญชี คุณจะได้รับลิงก์ตั้งรหัสผ่านใหม่");
      } else if (mode === "setup") {
        const { error } = await client.auth.signUp({ email, password,
          options: { emailRedirectTo: window.location.origin + "/auth/callback" },
        });
        setMessage(error ? "ยังเปิดบัญชีไม่ได้ ตรวจว่าใช้อีเมลที่ได้รับสิทธิ์ หรือใช้ลืมรหัสผ่านหากมีบัญชีแล้ว" : "ตรวจกล่องอีเมลและยืนยันอีเมลก่อนเข้าสู่ระบบ หากมีบัญชีแล้วให้ใช้ลืมรหัสผ่าน");
      } else {
        const { data, error } = await client.auth.signInWithPassword({ email, password });
        if (error || !data.user) { setMessage("เข้าสู่ระบบไม่ได้ ตรวจอีเมล รหัสผ่าน และการยืนยันอีเมล"); return; }
        const { data: member, error: memberError } = await client.from("app_users")
          .select("role,is_active").eq("id", data.user.id).maybeSingle();
        if (memberError || !member?.is_active || !["owner", "hr"].includes(member.role)) {
          await client.auth.signOut();
          setMessage("บัญชีนี้ยังไม่มีสิทธิ์ใช้งาน กรุณาติดต่อเจ้าของระบบ"); return;
        }
        router.replace("/workspace"); router.refresh();
      }
    } catch { setMessage("ไม่สามารถเชื่อมต่อระบบได้ กรุณาลองใหม่"); }
    finally { setBusy(false); }
  }
  return <>
    <div className={styles.notice}><p>ใช้บัญชีที่เจ้าของระบบกำหนดไว้เท่านั้น<br />ครั้งแรกให้ตั้งรหัสผ่านและยืนยันอีเมลของคุณ</p></div>
    <form className={styles.form} onSubmit={submit} aria-label="แบบฟอร์มเข้าสู่ระบบ">
      <label htmlFor="email">อีเมล</label>
      <input id="email" name="email" type="email" autoComplete="username" placeholder="name@company.com" required disabled={busy} />
      {mode !== "recover" && <><label htmlFor="password">รหัสผ่าน</label>
      <input id="password" name="password" type="password" autoComplete={mode === "setup" ? "new-password" : "current-password"}
        minLength={mode === "setup" ? 12 : undefined} placeholder={mode === "setup" ? "อย่างน้อย 12 ตัวอักษร" : "กรอกรหัสผ่าน"} required disabled={busy} /></>}
      <button type="submit" disabled={busy}>{busy ? "กำลังดำเนินการ…" : mode === "login" ? "เข้าสู่ระบบ" : mode === "setup" ? "ตั้งรหัสผ่านครั้งแรก" : "ส่งลิงก์ตั้งรหัสผ่านใหม่"}</button>
      {message && <p role="status" className={styles.feedback}>{message}</p>}
    </form>
    <div className={styles.authLinks}>
      <button type="button" disabled={busy} onClick={() => { setMode(mode === "setup" ? "login" : "setup"); setMessage(""); }}>{mode === "setup" ? "กลับไปเข้าสู่ระบบ" : "ตั้งรหัสผ่านครั้งแรก"}</button>
      <button type="button" disabled={busy} onClick={() => { setMode(mode === "recover" ? "login" : "recover"); setMessage(""); }}>{mode === "recover" ? "กลับไปเข้าสู่ระบบ" : "ลืมรหัสผ่าน"}</button>
    </div>
  </>;
}
