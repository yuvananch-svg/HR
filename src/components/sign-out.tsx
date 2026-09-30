"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "../lib/supabase/client";
export function SignOut() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  async function signOut() {
    setBusy(true); setError(false);
    try {
      const { error } = await createClient().auth.signOut();
      if (error) { setError(true); return; }
      router.replace("/"); router.refresh();
    } catch { setError(true); } finally { setBusy(false); }
  }
  return <div><button type="button" onClick={signOut} disabled={busy}>{busy ? "กำลังออก…" : "ออกจากระบบ"}</button>{error && <p role="alert">ออกจากระบบไม่ได้ กรุณาลองใหม่</p>}</div>;
}
