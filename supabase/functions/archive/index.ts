/**
 * Monali — archive Edge Function
 *
 * 라우팅 (Deno serve, path 기반 분기):
 *   POST   /api/archive                      → 아카이브 upsert (JWT 필수, 1 plan = 1 archive)
 *   GET    /api/archive                      → 사용자의 아카이브 목록 (JWT 필수)
 *   GET    /api/archive/:id                  → 아카이브 상세 (JWT 필수)
 *   POST   /api/archive/:id/photos           → Supabase Storage 업로드용 signed URL 발급
 *
 * - Deno runtime, TypeScript strict
 * - Promise.all 금지, Promise.allSettled 사용
 * - 피드백 루프: 아카이브 저장 후 places.accessibility_score 비동기 업데이트
 *   (실패해도 아카이브 저장은 성공으로 처리)
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
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const errJson = (
  code: string,
  message: string,
  status: number,
): Response => json({ error: { code, message } }, status);

// ─── env ────────────────────────────────────────────────────────────────────
function getEnv(name: string): string {
  // @ts-ignore Deno
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

const SUPABASE_URL = getEnv("SUPABASE_URL");
const SUPABASE_ANON_KEY = getEnv("SUPABASE_ANON_KEY");
const SUPABASE_SERVICE_ROLE_KEY = getEnv("SUPABASE_SERVICE_ROLE_KEY");

// service_role: RLS 우회 (서버 측 권한 검증 후 사용)
const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ─── 인증 ───────────────────────────────────────────────────────────────────
async function getAuthUserId(req: Request): Promise<string | null> {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const token = auth.slice(7);
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await userClient.auth.getUser();
  if (error || !data.user) return null;
  return data.user.id;
}

// ─── Zod 스키마 ─────────────────────────────────────────────────────────────
const AccessibilityFeedbackSchema = z.object({
  placeId: z.string().uuid(),
  placeName: z.string().min(1).max(200),
  actualAccessible: z.boolean(),
  notes: z.string().max(500).optional(),
});

const ArchiveUpsertSchema = z.object({
  planId: z.string().uuid(),
  overallRating: z.number().int().min(1).max(5),
  accessibilityFeedback: z.array(AccessibilityFeedbackSchema).max(50),
  memo: z.string().max(2000).optional(),
  photoUrls: z.array(z.string().url()).max(5).optional(),
});

// ─── 피드백 루프: Place accessibility_score 업데이트 ───────────────────────
/**
 * 새 아카이브 저장 후 호출. accessibility_feedback JSONB에서 해당 placeId
 * 관련 행을 모두 끌어와 (actualAccessible true 비율) 평균을 places.accessibility_score
 * 에 반영. 실패해도 아카이브 저장 자체는 성공으로 본다.
 */
async function updatePlaceScores(
  feedbacks: { placeId: string; actualAccessible: boolean }[],
): Promise<void> {
  // 중복 placeId 제거
  const uniquePlaceIds = Array.from(
    new Set(feedbacks.map((f) => f.placeId)),
  );

  const tasks = uniquePlaceIds.map(async (placeId) => {
    // 1) 모든 아카이브에서 이 placeId 에 대한 피드백 집계
    const { data: archives, error } = await adminClient
      .from("outing_archives")
      .select("accessibility_feedback");
    if (error) throw error;

    let total = 0;
    let accessibleCount = 0;
    for (const row of archives ?? []) {
      const fbs = (row.accessibility_feedback ?? []) as {
        placeId: string;
        actualAccessible: boolean;
      }[];
      for (const fb of fbs) {
        if (fb.placeId === placeId) {
          total += 1;
          if (fb.actualAccessible) accessibleCount += 1;
        }
      }
    }

    if (total === 0) return;
    const score = Math.max(0, Math.min(1, accessibleCount / total));

    // 2) places.accessibility_score 업데이트
    const { error: updErr } = await adminClient
      .from("places")
      .update({
        accessibility_score: score,
        last_verified_at: new Date().toISOString(),
      })
      .eq("place_id", placeId);
    if (updErr) throw updErr;
  });

  // Promise.allSettled — 일부 실패해도 다른 업데이트는 계속
  const results = await Promise.allSettled(tasks);
  for (const r of results) {
    if (r.status === "rejected") {
      console.error("[archive] updatePlaceScores failed:", r.reason);
    }
  }
}

// ─── 핸들러: POST /api/archive ──────────────────────────────────────────────
async function handleUpsertArchive(req: Request): Promise<Response> {
  const userId = await getAuthUserId(req);
  if (!userId) return errJson("UNAUTHORIZED", "로그인이 필요합니다.", 401);

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return errJson("INVALID_JSON", "JSON 파싱 실패", 400);
  }

  const parsed = ArchiveUpsertSchema.safeParse(raw);
  if (!parsed.success) {
    return errJson(
      "INVALID_INPUT",
      parsed.error.errors.map((e) => e.message).join(", "),
      400,
    );
  }
  const body = parsed.data;

  // 권한: 해당 plan 의 creator 인지 확인
  const { data: trip, error: tripErr } = await adminClient
    .from("trips")
    .select("plan_id, creator_id, status")
    .eq("plan_id", body.planId)
    .single();
  if (tripErr || !trip) {
    return errJson("PLAN_NOT_FOUND", "나들이 계획을 찾을 수 없습니다.", 404);
  }
  if (trip.creator_id !== userId) {
    return errJson("FORBIDDEN", "본인 계획만 기록할 수 있습니다.", 403);
  }

  // upsert (onConflict: plan_id)
  const { data: archive, error: upErr } = await adminClient
    .from("outing_archives")
    .upsert(
      {
        plan_id: body.planId,
        overall_score: body.overallRating,
        accessibility_feedback: body.accessibilityFeedback,
        memo: body.memo ?? null,
        photo_urls: body.photoUrls ?? [],
      },
      { onConflict: "plan_id" },
    )
    .select()
    .single();

  if (upErr || !archive) {
    return errJson(
      "ARCHIVE_UPSERT_FAILED",
      upErr?.message ?? "아카이브 저장 실패",
      500,
    );
  }

  // trips.status → COMPLETED (실패해도 무시)
  void adminClient
    .from("trips")
    .update({ status: "COMPLETED" })
    .eq("plan_id", body.planId)
    .then(({ error }) => {
      if (error) console.error("[archive] trip status update failed:", error);
    });

  // 피드백 루프: 비동기 (응답 차단 X). 실패해도 아카이브 저장은 성공.
  void updatePlaceScores(body.accessibilityFeedback).catch((e) => {
    console.error("[archive] updatePlaceScores top-level error:", e);
  });

  return json({ archive }, 200);
}

// ─── 핸들러: GET /api/archive ───────────────────────────────────────────────
async function handleListArchives(req: Request): Promise<Response> {
  const userId = await getAuthUserId(req);
  if (!userId) return errJson("UNAUTHORIZED", "로그인이 필요합니다.", 401);

  // 사용자가 creator 인 trip → outing_archives 조인
  const { data: trips, error: tripErr } = await adminClient
    .from("trips")
    .select("plan_id, title, scheduled_date")
    .eq("creator_id", userId);
  if (tripErr) {
    return errJson("DB_ERROR", tripErr.message, 500);
  }

  const planIds = (trips ?? []).map((t) => t.plan_id);
  if (planIds.length === 0) {
    return json({ archives: [], total: 0 });
  }

  const { data: archives, error: arcErr } = await adminClient
    .from("outing_archives")
    .select("*")
    .in("outing_plan_id", planIds)
    .order("completed_at", { ascending: false });
  if (arcErr) {
    return errJson("DB_ERROR", arcErr.message, 500);
  }

  // 메타 조인
  const tripMap = new Map(
    (trips ?? []).map((t) => [t.plan_id, t] as const),
  );
  const enriched = (archives ?? []).map((a) => {
    const trip = tripMap.get(a.outing_plan_id);
    const photos = (a.photo_urls ?? []) as string[];
    const fbs = (a.accessibility_feedback ?? []) as { placeId: string }[];
    const uniquePlaces = new Set(fbs.map((f) => f.placeId));
    return {
      ...a,
      trip_title: trip?.title,
      scheduled_date: trip?.scheduled_date ?? null,
      place_count: uniquePlaces.size,
      thumbnail_url: photos[0] ?? null,
    };
  });

  return json({ archives: enriched, total: enriched.length });
}

// ─── 핸들러: GET /api/archive/:id ───────────────────────────────────────────
async function handleGetArchive(
  req: Request,
  archiveId: string,
): Promise<Response> {
  const userId = await getAuthUserId(req);
  if (!userId) return errJson("UNAUTHORIZED", "로그인이 필요합니다.", 401);

  const { data: archive, error } = await adminClient
    .from("outing_archives")
    .select("*")
    .eq("archive_id", archiveId)
    .single();
  if (error || !archive) {
    return errJson("NOT_FOUND", "아카이브를 찾을 수 없습니다.", 404);
  }

  // 권한 검증
  const { data: trip } = await adminClient
    .from("trips")
    .select("creator_id, title, scheduled_date")
    .eq("plan_id", archive.outing_plan_id)
    .single();
  if (!trip || trip.creator_id !== userId) {
    return errJson("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }

  return json({
    archive: {
      ...archive,
      trip_title: trip.title,
      scheduled_date: trip.scheduled_date ?? null,
    },
  });
}

// ─── 핸들러: POST /api/archive/:id/photos ───────────────────────────────────
async function handleCreatePhotoUploadUrl(
  req: Request,
  archiveId: string,
): Promise<Response> {
  const userId = await getAuthUserId(req);
  if (!userId) return errJson("UNAUTHORIZED", "로그인이 필요합니다.", 401);

  // 권한
  const { data: archive } = await adminClient
    .from("outing_archives")
    .select("archive_id, outing_plan_id")
    .eq("archive_id", archiveId)
    .single();
  if (!archive) return errJson("NOT_FOUND", "아카이브를 찾을 수 없습니다.", 404);

  const { data: trip } = await adminClient
    .from("trips")
    .select("creator_id")
    .eq("plan_id", archive.outing_plan_id)
    .single();
  if (!trip || trip.creator_id !== userId) {
    return errJson("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }

  const ts = Date.now();
  const path = `archive/${archiveId}/${ts}.jpg`;

  const { data, error } = await adminClient.storage
    .from("archive-photos")
    .createSignedUploadUrl(path);

  if (error || !data) {
    return errJson(
      "UPLOAD_URL_FAILED",
      error?.message ?? "업로드 URL 생성 실패",
      500,
    );
  }

  return json({
    path,
    signed_url: data.signedUrl,
    token: data.token,
  });
}

// ─── 라우팅 ─────────────────────────────────────────────────────────────────
serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const url = new URL(req.url);
  // /api/archive 또는 /archive 모두 허용 (Edge Function path 정규화)
  const path = url.pathname.replace(/^\/api/, "").replace(/^\/archive/, "");
  // path 가 ""  → 컬렉션, "/<id>" → 단건, "/<id>/photos" → 사진 업로드

  try {
    if (path === "" || path === "/") {
      if (req.method === "POST") return await handleUpsertArchive(req);
      if (req.method === "GET") return await handleListArchives(req);
      return errJson("METHOD_NOT_ALLOWED", "허용되지 않은 메서드", 405);
    }

    // /<id>/photos
    const photoMatch = path.match(/^\/([0-9a-fA-F-]{36})\/photos\/?$/);
    if (photoMatch && req.method === "POST") {
      return await handleCreatePhotoUploadUrl(req, photoMatch[1]);
    }

    // /<id>
    const idMatch = path.match(/^\/([0-9a-fA-F-]{36})\/?$/);
    if (idMatch && req.method === "GET") {
      return await handleGetArchive(req, idMatch[1]);
    }

    return errJson("NOT_FOUND", `Not found: ${url.pathname}`, 404);
  } catch (e) {
    console.error("[archive] unhandled error:", e);
    return errJson(
      "INTERNAL_ERROR",
      e instanceof Error ? e.message : "Internal error",
      500,
    );
  }
});
