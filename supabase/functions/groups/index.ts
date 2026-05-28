/**
 * Monali — groups Edge Function
 *
 * 라우팅:
 *   POST  /api/groups                    → 그룹 생성
 *   POST  /api/groups/:groupId/members   → 그룹에 동반자(들) 추가 (배열 upsert)
 *   GET   /api/groups                    → 내 그룹 목록 (members 포함)
 *
 * - Deno runtime, TypeScript strict
 * - Supabase service_role client (RLS 우회, user_id 직접 강제)
 * - Zod 검증, 에러: 400(Zod), 401(미인증), 403(타인 그룹), 404, 409, 500
 */

// @ts-ignore Deno runtime
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
// @ts-ignore Deno runtime
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// @ts-ignore Deno runtime
import { z } from "https://esm.sh/zod@3.23.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const UUID_RE = /^[0-9a-f-]{36}$/i;
const HEX_COLOR_RE = /^#[0-9A-Fa-f]{6}$/;

const CreateGroupSchema = z.object({
  name: z.string().min(1).max(100),
  color: z.string().regex(HEX_COLOR_RE, "7자리 HEX 색상이어야 합니다").optional(),
});

const AddMembersSchema = z.object({
  companionIds: z.array(z.string().regex(UUID_RE)).min(1).max(50),
});

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

async function handleListGroups(userId: string): Promise<Response> {
  const { data, error } = await adminClient
    .from("groups")
    .select("*, group_members(*, companion:companions(*))")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error) return json({ error: "DBError", message: error.message }, 500);
  return json({ groups: data ?? [] });
}

async function handleCreateGroup(
  req: Request,
  userId: string,
): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  const parsed = CreateGroupSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      { error: "ValidationError", issues: parsed.error.issues },
      400,
    );
  }

  const insertRow: Record<string, unknown> = {
    user_id: userId,
    name: parsed.data.name,
  };
  if (parsed.data.color) insertRow.color = parsed.data.color;

  const { data, error } = await adminClient
    .from("groups")
    .insert(insertRow)
    .select()
    .single();
  if (error) return json({ error: "DBError", message: error.message }, 500);

  return json({ group: data }, 201);
}

async function handleAddMembers(
  req: Request,
  userId: string,
  groupId: string,
): Promise<Response> {
  if (!UUID_RE.test(groupId)) {
    return json({ error: "Invalid group id" }, 400);
  }

  // 그룹 소유권 확인
  const { data: group, error: gErr } = await adminClient
    .from("groups")
    .select("group_id, user_id")
    .eq("group_id", groupId)
    .single();
  if (gErr) {
    if ((gErr as { code?: string }).code === "PGRST116") {
      return json({ error: "NotFound" }, 404);
    }
    return json({ error: "DBError", message: gErr.message }, 500);
  }
  if (group.user_id !== userId) {
    return json({ error: "Forbidden" }, 403);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  const parsed = AddMembersSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      { error: "ValidationError", issues: parsed.error.issues },
      400,
    );
  }

  // 동반자가 모두 본인 소유인지 확인
  const { data: owned, error: cErr } = await adminClient
    .from("companions")
    .select("profile_id")
    .eq("user_id", userId)
    .in("profile_id", parsed.data.companionIds);
  if (cErr) return json({ error: "DBError", message: cErr.message }, 500);

  const ownedIds = new Set((owned ?? []).map((c) => c.profile_id));
  const invalid = parsed.data.companionIds.filter((id) => !ownedIds.has(id));
  if (invalid.length > 0) {
    return json({ error: "Forbidden", invalid_companion_ids: invalid }, 403);
  }

  const rows = parsed.data.companionIds.map((id) => ({
    group_id: groupId,
    companion_id: id,
  }));

  const { data, error } = await adminClient
    .from("group_members")
    .upsert(rows, { onConflict: "group_id,companion_id" })
    .select();
  if (error) {
    if ((error as { code?: string }).code === "23505") {
      return json({ error: "Conflict", message: error.message }, 409);
    }
    return json({ error: "DBError", message: error.message }, 500);
  }

  return json({ members: data ?? [] }, 201);
}

// ─── 라우팅 ─────────────────────────────────────────────────────────────────

function matchRoute(pathname: string): {
  type: "groups_collection" | "group_members" | "unknown";
  groupId?: string;
} {
  const segments = pathname.split("/").filter(Boolean);
  // .../groups/:groupId/members
  if (
    segments.length >= 3 &&
    segments[segments.length - 1] === "members" &&
    UUID_RE.test(segments[segments.length - 2]) &&
    segments[segments.length - 3] === "groups"
  ) {
    return { type: "group_members", groupId: segments[segments.length - 2] };
  }
  // .../groups
  if (segments[segments.length - 1] === "groups") {
    return { type: "groups_collection" };
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

    if (req.method === "GET" && route.type === "groups_collection") {
      return await handleListGroups(userId);
    }
    if (req.method === "POST" && route.type === "groups_collection") {
      return await handleCreateGroup(req, userId);
    }
    if (req.method === "POST" && route.type === "group_members") {
      return await handleAddMembers(req, userId, route.groupId!);
    }

    return json({ error: "Not Found", path: url.pathname }, 404);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return json({ error: "InternalServerError", message }, 500);
  }
});
