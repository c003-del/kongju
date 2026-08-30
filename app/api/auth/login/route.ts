import { createHash, randomInt } from "node:crypto";
import { handle, readJson } from "@/lib/api/handler";
import { siteUrl } from "@/lib/env";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { createSupabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const GENERIC_RESPONSE = { ok: true } as const;
const MIN_RESPONSE_MS = 650;

async function genericResponse(startedAt: number) {
  const remaining = MIN_RESPONSE_MS + randomInt(0, 151) - (Date.now() - startedAt);
  if (remaining > 0) {
    await new Promise((resolve) => setTimeout(resolve, remaining));
  }
  return GENERIC_RESPONSE;
}

function isAllowedBrowserOrigin(request: Request): boolean {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site") return false;

  const origin = request.headers.get("origin");
  if (!origin) return true;
  const allowed = new Set([new URL(request.url).origin]);
  try {
    allowed.add(new URL(siteUrl(new URL(request.url).origin)).origin);
  } catch {
    return false;
  }
  return allowed.has(origin);
}

function hashRateKey(scope: "ip" | "email", value: string): string {
  return createHash("sha256").update(`${scope}\0${value}`).digest("hex");
}

function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip") || "unknown";
}

export async function POST(request: Request) {
  return handle(async () => {
    const startedAt = Date.now();
    const finish = () => genericResponse(startedAt);
    if (!isAllowedBrowserOrigin(request)) return finish();

    let body: { email: string };
    try {
      body = await readJson<{ email: string }>(request);
    } catch {
      return finish();
    }
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      return finish();
    }

    const admin = createSupabaseAdmin();
    const [ipLimit, emailLimit] = await Promise.all([
      admin.rpc("consume_login_rate_limit", {
        p_key_hash: hashRateKey("ip", clientIp(request)),
      }),
      admin.rpc("consume_login_rate_limit", {
        p_key_hash: hashRateKey("email", email),
      }),
    ]);
    if (
      ipLimit.error ||
      emailLimit.error ||
      ipLimit.data !== true ||
      emailLimit.data !== true
    ) {
      return finish();
    }

    try {
      // Exact normalized equality avoids PostgREST ILIKE wildcard probes.
      const { data: invited, error } = await admin
        .from("family_members")
        .select("id, user_id")
        .eq("invited_email", email)
        .eq("is_active", true)
        .maybeSingle();
      if (error || !invited) return finish();

      if (!invited.user_id) {
        const { data: created, error: createError } =
          await admin.auth.admin.createUser({
            email,
            email_confirm: true,
            app_metadata: { family_invited: true },
          });
        const alreadyExists =
          createError &&
          (createError.code === "email_exists" || createError.status === 422);

        if (created.user) {
          const { data: bound, error: bindError } = await admin
            .from("family_members")
            .update({ user_id: created.user.id })
            .eq("id", invited.id)
            .is("user_id", null)
            .select("user_id")
            .maybeSingle();
          if (bindError || bound?.user_id !== created.user.id) {
            const { data: current } = await admin
              .from("family_members")
              .select("user_id")
              .eq("id", invited.id)
              .maybeSingle();
            // A concurrent request may already have bound this same account.
            // Delete only a genuinely unreferenced account created by this call.
            if (current?.user_id !== created.user.id) {
              await admin.auth.admin.deleteUser(created.user.id);
            }
            console.error("[auth/login] failed to bind newly created user");
            return finish();
          }
        } else if (alreadyExists) {
          const { error: bindError } = await admin.rpc(
            "link_invited_member_by_email",
            { p_member_id: invited.id },
          );
          if (bindError) {
            console.error("[auth/login] failed to bind existing user");
            return finish();
          }
        } else {
          console.error("[auth/login] failed to create invited user");
          return finish();
        }
      }

      const origin = new URL(request.url).origin;
      const sb = await createSupabaseServer();
      const { error: otpError } = await sb.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: false,
          emailRedirectTo: new URL("/auth/confirm", siteUrl(origin)).toString(),
        },
      });
      if (otpError) console.error("[auth/login] OTP delivery failed");
    } catch {
      // A generic success response prevents invite/account enumeration.
      console.error("[auth/login] login request failed");
    }

    return finish();
  });
}
