/**
 * Monali — itinerary-export Edge Function
 *
 * 라우팅 (Deno serve, path 기반):
 *   GET   /api/itinerary/:planId/export?view=simple|normal   → 일정표 JSON (PDF 렌더 클라이언트가 사용)
 *   POST  /api/trips/:planId/start                            → started_at + status=STARTED 기록 (JWT 필수)
 *
 * 책임:
 *   - JWT 인증 → 본인의 trip 만 조회/수정 가능 (course-designer 정합)
 *   - trips + 선택된 course_options + itinerary_items + places 조인 후 JSON 응답
 *   - PDF 자체 생성은 클라이언트(window.print 또는 차후 @react-pdf/renderer) 가 담당
 *
 * - Deno runtime, TypeScript strict
 * - Promise.all 금지 — Promise.allSettled 사용
 */

// @ts-ignore Deno runtime
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
// @ts-ignore Deno runtime
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── CORS ───────────────────────────────────────────────────────────────────
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

const err = (code: string, message: string, status: number): Response =>
  json({ error: { code, message } }, status);

// ─── env ────────────────────────────────────────────────────────────────────
function getEnv(name: string): string {
  // @ts-ignore Deno
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

const SUPABASE_URL = getEnv("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = getEnv("SUPABASE_SERVICE_ROLE_KEY");

const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ─── JWT → user_id 추출 ─────────────────────────────────────────────────────
async function requireUserId(req: Request): Promise<string | Response> {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return err("UNAUTHORIZED", "로그인이 필요합니다.", 401);

  const { data, error } = await adminClient.auth.getUser(token);
  if (error || !data.user) {
    return err("UNAUTHORIZED", "세션이 유효하지 않습니다.", 401);
  }
  return data.user.id;
}

// ─── 경로 매칭 ──────────────────────────────────────────────────────────────
interface RouteMatch {
  kind: "export" | "start";
  planId: string;
}

function matchRoute(method: string, pathname: string): RouteMatch | null {
  const exportMatch = pathname.match(
    /\/api\/itinerary\/([0-9a-fA-F-]{36})\/export\/?$/,
  );
  if (method === "GET" && exportMatch) {
    return { kind: "export", planId: exportMatch[1] };
  }

  const startMatch = pathname.match(
    /\/api\/trips\/([0-9a-fA-F-]{36})\/start\/?$/,
  );
  if (method === "POST" && startMatch) {
    return { kind: "start", planId: startMatch[1] };
  }
  return null;
}

// ─── GET /api/itinerary/:planId/export ──────────────────────────────────────
async function handleExport(
  req: Request,
  planId: string,
  userId: string,
): Promise<Response> {
  const url = new URL(req.url);
  const view = (url.searchParams.get("view") ?? "normal") === "simple"
    ? "simple"
    : "normal";

  // Promise.allSettled 로 trip / course 병렬 조회
  const [tripRes, courseRes] = await Promise.allSettled([
    adminClient
      .from("trips")
      .select("*")
      .eq("plan_id", planId)
      .eq("creator_id", userId)
      .single(),
    adminClient
      .from("course_options")
      .select(
        `
          course_id,
          plan_id,
          course_name,
          total_estimated_minutes,
          ai_reasoning,
          ai_model_used,
          is_selected,
          items:itinerary_items (
            item_id,
            course_id,
            place_id,
            sequence_order,
            stay_duration_minutes,
            transport_mode,
            transport_duration_minutes,
            notes,
            place:places (
              place_id,
              name,
              category,
              address,
              location,
              wheelchair_accessible,
              stroller_accessible,
              dietary_options,
              operating_hours,
              phone,
              accessibility_score,
              last_verified_at
            )
          )
        `,
      )
      .eq("plan_id", planId)
      .eq("is_selected", true)
      .limit(1),
  ]);

  if (tripRes.status !== "fulfilled" || tripRes.value.error || !tripRes.value.data) {
    return err("NOT_FOUND", "나들이를 찾을 수 없습니다.", 404);
  }

  const trip = tripRes.value.data;
  let course: unknown = null;
  if (courseRes.status === "fulfilled" && !courseRes.value.error) {
    const list = (courseRes.value.data ?? []) as unknown[];
    course = list[0] ?? null;
  }

  return json({ view, trip, course });
}

// ─── POST /api/trips/:planId/start ──────────────────────────────────────────
async function handleStart(
  planId: string,
  userId: string,
): Promise<Response> {
  // 본인 소유 확인
  const { data: trip, error: tripErr } = await adminClient
    .from("trips")
    .select("plan_id, creator_id, started_at")
    .eq("plan_id", planId)
    .single();

  if (tripErr || !trip) {
    return err("NOT_FOUND", "나들이를 찾을 수 없습니다.", 404);
  }
  if (trip.creator_id !== userId) {
    return err("FORBIDDEN", "권한이 없습니다.", 403);
  }
  if (trip.started_at) {
    return json({ plan_id: planId, started_at: trip.started_at, already: true });
  }

  const startedAt = new Date().toISOString();
  const { error: updErr } = await adminClient
    .from("trips")
    .update({ started_at: startedAt, status: "STARTED" })
    .eq("plan_id", planId);

  if (updErr) {
    return err("INTERNAL_ERROR", `출발 처리 실패: ${updErr.message}`, 500);
  }

  return json({ plan_id: planId, started_at: startedAt, status: "STARTED" });
}

// ─── 메인 핸들러 ────────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const url = new URL(req.url);
  const route = matchRoute(req.method, url.pathname);
  if (!route) return err("NOT_FOUND", "경로를 찾을 수 없습니다.", 404);

  // 두 엔드포인트 모두 인증 필수
  const userIdOrRes = await requireUserId(req);
  if (typeof userIdOrRes !== "string") return userIdOrRes;
  const userId = userIdOrRes;

  try {
    if (route.kind === "export") {
      return await handleExport(req, route.planId, userId);
    }
    return await handleStart(route.planId, userId);
  } catch (e) {
    return err(
      "INTERNAL_ERROR",
      e instanceof Error ? e.message : "알 수 없는 오류",
      500,
    );
  }
});
