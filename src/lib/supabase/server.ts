import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabaseKey, supabaseUrl } from "./config";
export async function createClient() {
  const store = await cookies();
  return createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() { return store.getAll(); },
      setAll(values) {
        try { values.forEach(({ name, value, options }) => store.set(name, value, options)); }
        catch { /* Server Components cannot write cookies; proxy refreshes them. */ }
      },
    },
  });
}
