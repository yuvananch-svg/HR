export type SupabaseEnvironment = "development" | "preview" | "production" | "test";

export interface SupabaseConfigInput {
  url?: string;
  key?: string;
  target?: string;
  vercelEnvironment?: string;
  nodeEnvironment?: string;
}

export interface SupabaseConfig {
  url: string;
  key: string;
  target: SupabaseEnvironment;
}

const productionProjectHost = "kedohmbtpegupndldkex.supabase.co";
// Temporary production continuity bridge; remove after deployment env verification.
const legacyProductionUrl = "https://kedohmbtpegupndldkex.supabase.co";
const legacyProductionKey = "sb_publishable_Mc7jlowpsmEIW33y7UmSeQ_X1Xov0d9";

function normalizedTarget(value: string | undefined): SupabaseEnvironment {
  if (value === "development" || value === "preview" || value === "production" || value === "test") return value;
  throw new Error("Set NEXT_PUBLIC_SUPABASE_TARGET to development, preview, production, or test.");
}

function isUnsafeKey(key: string): boolean {
  const lower = key.toLowerCase();
  if (lower.startsWith("sb_secret_") || lower.includes("service_role")) return true;
  if (key.split(".").length !== 3) return false;
  try {
    const payload = JSON.parse(atob(key.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))) as { role?: unknown };
    return payload.role !== "anon";
  } catch {
    return true;
  }
}

export function resolveSupabaseConfig(input: SupabaseConfigInput): SupabaseConfig {
  const productionRuntime = input.vercelEnvironment === "production" && input.nodeEnvironment === "production";
  const target = normalizedTarget(input.target ?? (productionRuntime ? "production" : undefined));
  let url = input.url?.trim();
  let key = input.key?.trim();
  if (input.url === undefined && input.key === undefined && productionRuntime && target === "production") {
    url = legacyProductionUrl;
    key = legacyProductionKey;
  } else if (!url || !key) {
    throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY explicitly.");
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL must be a valid HTTPS URL.");
  }
  const localHttp = parsed.protocol === "http:" && ["localhost", "127.0.0.1"].includes(parsed.hostname) && ["development", "test"].includes(target);
  if ((parsed.protocol !== "https:" && !localHttp) || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL must be a valid HTTPS project URL (HTTP is allowed only for local development/test) without credentials, path, query, or fragment.");
  }
  if (isUnsafeKey(key)) {
    throw new Error("A service_role or secret key cannot be used by the browser-facing Supabase client.");
  }
  if (!key.startsWith("sb_publishable_") && key.split(".").length !== 3) {
    throw new Error("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be a publishable key or legacy anon JWT.");
  }
  if (key.startsWith("sb_publishable_") && key.length <= "sb_publishable_".length) {
    throw new Error("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must contain a key value.");
  }

  const host = parsed.hostname.toLowerCase();
  const pointsAtProduction = host === productionProjectHost;
  if (target === "production") {
    if (input.nodeEnvironment && input.nodeEnvironment !== "production") {
      throw new Error("Production Supabase target is only valid in a production Node.js runtime.");
    }
    if (input.vercelEnvironment && input.vercelEnvironment !== "production") {
      throw new Error("Production Supabase target is only valid in a Vercel production deployment.");
    }
    if (!pointsAtProduction) {
      throw new Error("Production target must use the approved production Supabase project URL.");
    }
  } else if (pointsAtProduction) {
    throw new Error(`${target} Supabase target cannot use the production project.`);
  }

  if (input.vercelEnvironment === "production" && target !== "production") {
    throw new Error("A Vercel production deployment requires NEXT_PUBLIC_SUPABASE_TARGET=production.");
  }
  if (input.vercelEnvironment === "preview" && target !== "preview") {
    throw new Error("A Vercel preview deployment requires NEXT_PUBLIC_SUPABASE_TARGET=preview.");
  }
  return { url: parsed.origin, key, target };
}

export function getSupabaseConfig(): SupabaseConfig {
  return resolveSupabaseConfig({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    key: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    target: process.env.NEXT_PUBLIC_SUPABASE_TARGET,
    // NEXT_PUBLIC_* values are statically inlined into browser bundles by Next.js.
    vercelEnvironment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.VERCEL_ENV,
    nodeEnvironment: process.env.NODE_ENV,
  });
}
