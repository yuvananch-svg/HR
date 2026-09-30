import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const client = await createClient();
  if (code) {
    const { error } = await client.auth.exchangeCodeForSession(code);
    if (!error) {
      const path = request.nextUrl.searchParams.get("flow") === "recovery" ? "/auth/reset" : "/workspace";
      return NextResponse.redirect(new URL(path, request.url));
    }
  }
  return NextResponse.redirect(new URL("/?notice=expired", request.url));
}
