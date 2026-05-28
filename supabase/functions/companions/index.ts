/**
 * Monali — companions Edge Function
 *
 * 라우팅:
 *   GET    /api/profiles/me                    → 현재 사용자 profile + companions 조회
 *   POST   /api/profiles/companions            → 동반자 배열 upsert (UNIQUE(user_id,name))
 *   PATCH  /api/profiles/companions/:id        → 동반자 단건 부분 수정
 *
 * - Deno runtime, TypeScript strict
 * - Supabase service_role client
 * - Zod 검증, 에러: 400(Zod), 401(미인증), 404(미존재), 409(UNIQUE 위반), 500(DB)
 */

// @ts-ignore Deno runtime
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
// @ts-ignore Deno runtime
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// @ts-ignore Deno runtime
import { z } from "https://esm.sh/zod@3.23.8";

// ─── CORS ───────────────────────────────────────────────────────────────────
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// ─── Zod 스키마 (DB ENUM 대문자와 1:1) ──────────────────────────────────────
const MobilityEnum = z.enum(["NONE", "WHEELCHAIR", "STROLLER", "LIMITED"]);
const DietaryEnum = z.enum([
  "NONE",
  "VEGETARIAN",
  "VEGAN",
  "HALAL",
  "KOSHER",
  "ALLERGY",
]);
const DigitalLevelEnum = z.enum(["HIGH", "MID", "LOW"]);

const CompanionInputSchema = z.object({
  name: z.string().min(1, "이름은 필수입니다").max(50),
  mobility_constraint: MobilityEnum.default("NONE"),
  dietary_restriction: DietaryEnum.default("NONE"),
  digital_level: DigitalLevelEnum.default("MID"),
  preference_tags: z.array(z.string().max(40)).max(20).default([]),
  allergies: z.array(z.string().max(40)).max(20).default([]),
  constraint_details: z.record(z.unknown()).default({}),
});

const CreateCompanionsSchema = z.object({
  companions: z.array(CompanionInputSchema).min(1).max(20),
});

const UpdateCompanionSchema = CompanionInputSchema.partial();

// ─── Supabase clients (auth용 anon, 쓰기용 service_role) ────────────────────
function getEnv(name: string): string {
  // @ts-ignore Deno
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

const SUPABASE_URL = getEnv("SUPABASE_URL");
const SUPABASE_ANON_KEY = getEnv("SUPABASE_ANON_KEY");
const SUPABASE_SERVICE_ROLE_KEY = getEnv("SUPABASE_SERVICE_ROLE_KEY");

const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function authenticate(
  req: Request,
): Promise<{ userId: string } | Response> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return json({ error: "Unauthorized: missing Authorization header" }, 401);
  }
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user },
    error,
  } = await userClient.auth.getUser();
  if (error || !user) return json({ error: "Unauthorized" }, 401);
  return { userId: user.id };
}

// ─── 핸들러 ─────────────────────────────────────────────────────────────────

async function handleGetMe(userId: string): Promise<Response> {
  const { data: profile, error: pErr } = await adminClient
    .from("profiles")
    .select("*")
    .eq("user_id", userId)
    .single();
  if (pErr) {
    if (pErr.code === "PGRST116") return json({ error: "NotFound" }, 404);
    return json({ error: "DBError", message: pErr.message }, 500);
  }

  const { data: companions, error: cErr } = await adminClient
    .from("companions")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (cErr) return json({ error: "DBError", message: cErr.message }, 500);

  return json({ profile, companions: companions ?? [] });
}

async function handleUpsertCompanions(
  req: Request,
  userId: string,
): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const parsed = CreateCompanionsSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      { error: "ValidationError", issues: parsed.error.issues },
      400,
    );
  }

  const rows = parsed.data.companions.map((c) => ({
    user_id: userId,
    name: c.name,
    mobility_constraint: c.mobility_constraint,
    dietary_restriction: c.dietary_restriction,
    digital_level: c.digital_level,
    preference_tags: c.preference_tags,
    allergies: c.allergies,
    constraint_details: c.constraint_details,
  }));

  const { data, error } = await adminClient
    .from("companions")
    .upsert(rows, { onConflict: "user_id,name" })
    .select();

  if (error) {
    if ((error as { code?: string }).code === "23505") {
      return json({ error: "Conflict", message: error.message }, 409);
    }
    return json({ error: "DBError", message: error.message }, 500);
  }

  const companions = data ?? [];
  const recommendSimpleView = companions.some(
    (c: { digital_level: string }) => c.digital_level === "LOW",
  );
  return json({
    companions,
    updatedAt: new Date().toISOString(),
    recommendSimpleView,
  });
}

async function handlePatchCompanion(
  req: Request,
  userId: string,
  companionId: string,
): Promise<Response> {
  // 간단 UUID 검증
  if (!/^[0-9a-f-]{36}$/i.test(companionId)) {
    return json({ error: "Invalid companion id" }, 400);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  const parsed = UpdateCompanionSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      { error: "ValidationError", issues: parsed.error.issues },
      400,
    );
  }
  if (Object.keys(parsed.data).length === 0) {
    return json({ error: "Empty patch" }, 400);
  }

  const { data, error } = await adminClient
    .from("companions")
    .update(parsed.data)
    .eq("profile_id", companionId)
    .eq("user_id", userId) // 본인 데이터만 수정
    .select()
    .single();

  if (error) {
    if ((error as { code?: string }).code === "23505") {
      return json({ error: "Conflict", message: error.message }, 409);
    }
    if ((error as { code?: string }).code === "PGRST116") {
      return json({ error: "NotFound" }, 404);
    }
    return json({ error: "DBError", message: error.message }, 500);
  }

  return json({ companion: data });
}

// ─── 라우팅 ─────────────────────────────────────────────────────────────────

function matchRoute(pathname: string): {
  type: "me" | "companions_collection" | "companion_item" | "unknown";
  id?: string;
} {
  // 함수 prefix(/companions, /functions/v1/companions 등)를 무시하고
  // 의미있는 마지막 세그먼트만 본다.
  const segments = pathname.split("/").filter(Boolean);
  // 우리가 관심있는 마지막 1~3개 세그먼트 검사
  // case: .../profiles/me
  if (segments.length >= 2) {
    const [a, b] = segments.slice(-2);
    if (a === "profiles" && b === "me") return { type: "me" };
  }
  // case: .../profiles/companions/:id  또는  .../companions/:id
  if (segments.length >= 2) {
    const last2 = segments.slice(-2);
    if (last2[0] === "companions" && /^[0-9a-f-]{36}$/i.test(last2[1])) {
      return { type: "companion_item", id: last2[1] };
    }
  }
  // case: .../profiles/companions  또는  .../companions  (배열 upsert)
  if (segments[segments.length - 1] === "companions") {
    return { type: "companions_collection" };
  }
  return { type: "unknown" };
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const auth = await authenticate(req);
  if (auth instanceof Response) return auth;
  const { userId } = auth;

  try {
    const url = new URL(req.url);
    const route = matchRoute(url.pathname);

    if (req.method === "GET" && route.type === "me") {
      return await handleGetMe(userId);
    }
    if (req.method === "POST" && route.type === "companions_collection") {
      return await handleUpsertCompanions(req, userId);
    }
    if (req.method === "PATCH" && route.type === "companion_item") {
      return await handlePatchCompanion(req, userId, route.id!);
    }

    return json({ error: "Not Found", path: url.pathname }, 404);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return json({ error: "InternalServerError", message }, 500);
  }
});
