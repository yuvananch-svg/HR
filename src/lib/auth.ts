import { redirect } from "next/navigation";
import { createClient } from "./supabase/server";
export async function requireStaff() {
  const client = await createClient();
  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError || !user) redirect("/?notice=login");
  const { data: member, error } = await client.from("app_users")
    .select("id,role,is_active").eq("id", user.id).maybeSingle();
  if (error) throw new Error("ไม่สามารถตรวจสิทธิ์ได้ กรุณาลองใหม่");
  if (!member?.is_active || !["owner", "hr"].includes(member.role)) redirect("/?notice=denied");
  return { client, user, member };
}
