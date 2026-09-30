"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "../lib/supabase/client";
import styles from "../app/login.module.css";
export function ResetPasswordForm() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const router = useRouter();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage("");
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password"));
    if (password !== form.get("confirm")) { setMessage("รหัสผ่านทั้งสองช่องไม่ตรงกัน"); setBusy(false); return; }
    try {
      const client = createClient();
      const { error } = await client.auth.updateUser({ password });
      if (error) { setMessage("เปลี่ยนรหัสผ่านไม่ได้ กรุณาลองใหม่หรือขอลิงก์ใหม่"); return; }
      router.replace("/workspace"); router.refresh();
    } catch { setMessage("เชื่อมต่อระบบไม่ได้ กรุณาลองใหม่"); }
    finally { setBusy(false); }
  }
  return <form className={styles.form} onSubmit={submit}>
    <label htmlFor="password">รหัสผ่านใหม่</label><input id="password" name="password" type="password" minLength={12} required autoComplete="new-password" disabled={busy} />
    <label htmlFor="confirm">ยืนยันรหัสผ่านใหม่</label><input id="confirm" name="confirm" type="password" minLength={12} required autoComplete="new-password" disabled={busy} />
    <button disabled={busy}>{busy ? "กำลังบันทึก…" : "บันทึกรหัสผ่าน"}</button>
    {message && <p role="status">{message}</p>}
  </form>;
}
