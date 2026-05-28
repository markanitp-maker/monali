/**
 * Monali — share Edge Function
 *
 * 라우팅 (Deno serve, path 기반 분기):
 *   POST   /api/trips/:planId/share             → 호스트 share_token 발급 (JWT 필수)
 *   GET    /api/share/:token                    → 비회원 공유 페이지 조회 (anon)
 *   POST   /api/share/:token/identify           → 비회원 이름 등록 + guest_token 발급
 *   POST   /api/share/:token/vote               → 장소별 찬반 투표 (upsert)
 *   POST   /api/share/:token/process-consent    → Silent Consent 일괄 처리 (cron)
 *
 * - Deno runtime, TypeScript strict
 * - anon key 공개 엔드포인트 / service_role key 내부 처리
 * - share-voting 스킬 패턴 1:1 준수
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
const IP_HASH_SALT = getEnv("IP_HASH_SALT");
// @ts-ignore Deno
const PUBLIC_URL = Deno.env.get("PUBLIC_URL") ?? "https://monali.app";

// service_role: RLS 우회 (서버 측 검증 후 사용)
const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// anon 클라이언트 (공유 페이지 RLS 검증용)
const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ─── 유틸 ───────────────────────────────────────────────────────────────────
async function hashSHA256(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function clientIp(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    req.headers.get("x-real-ip") ??
    "unknown"
  );
}

// JWT 검증 → user_id
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
const CreateShareLinkSchema = z.object({
  consensusDeadlineHours: z.number().int().min(1).max(48),
});

const IdentifySchema = z.object({
  guest_name: z.string().trim().min(1).max(50),
});

const VoteInputSchema = z.object({
  course_id: z.string().uuid(),
  item_id: z.string().uuid(),
  is_positive: z.boolean(),
  comment: z.string().max(200).optional(),
});

const VoteRequestSchema = z.object({
  guest_token: z.string().uuid(),
  votes: z.array(VoteInputSchema).min(1).max(100),
});

// ─── 합의 상태 집계 ─────────────────────────────────────────────────────────
async function getConsensusStatus(planId: string) {
  // 1) trip 정보
  const { data: trip } = await adminClient
    .from("trips")
    .select("consensus_deadline")
    .eq("plan_id", planId)
    .single();

  // 2) plan_members 집계
  const { data: members } = await adminClient
    .from("plan_members")
    .select("member_id, is_agreed, responded_at")
    .eq("plan_id", planId);

  const total = members?.length ?? 0;
  const responded = members?.filter((m) => m.responded_at != null).length ?? 0;
  const agreed = members?.filter((m) => m.is_agreed === true).length ?? 0;

  const deadline = trip?.consensus_deadline ?? null;
  const isExpired = deadline ? new Date(deadline) < new Date() : false;

  // 3) item_id 별 찬반 집계 → 반대율 50% 이상 추출
  const memberIds = (members ?? []).map((m) => m.member_id);
  let rejectedItemIds: string[] = [];
  if (memberIds.length > 0) {
    const { data: voteRows } = await adminClient
      .from("votes")
      .select("item_id, is_positive")
      .in("member_id", memberIds);

    const itemMap = new Map<string, { pos: number; neg: number }>();
    for (const v of voteRows ?? []) {
      const cur = itemMap.get(v.item_id) ?? { pos: 0, neg: 0 };
      if (v.is_positive) cur.pos += 1;
      else cur.neg += 1;
      itemMap.set(v.item_id, cur);
    }
    rejectedItemIds = Array.from(itemMap.entries())
      .filter(([, { pos, neg }]) => pos + neg > 0 && neg / (pos + neg) >= 0.5)
      .map(([id]) => id);
  }

  return {
    total_members: total,
    responded,
    agreed,
    deadline: deadline ?? "",
    is_expired: isExpired,
    rejected_item_ids: rejectedItemIds,
  };
}

// ─── 장소별 투표 집계 (UI 초기값) ───────────────────────────────────────────
async function getItemVoteSummaries(planId: string) {
  // course_options → items → votes 조인
  const { data: members } = await adminClient
    .from("plan_members")
    .select("member_id, guest_name")
    .eq("plan_id", planId);
  const memberMap = new Map(
    (members ?? []).map((m) => [m.member_id, m.guest_name ?? "익명"]),
  );
  const memberIds = (members ?? []).map((m) => m.member_id);
  if (memberIds.length === 0) return [];

  const { data: voteRows } = await adminClient
    .from("votes")
    .select("item_id, member_id, is_positive, comment")
    .in("member_id", memberIds);

  const map = new Map<
    string,
    { positive: number; negative: number; comments: { guest_name: string; text: string }[] }
  >();
  for (const v of voteRows ?? []) {
    const cur = map.get(v.item_id) ?? { positive: 0, negative: 0, comments: [] };
    if (v.is_positive) cur.positive += 1;
    else cur.negative += 1;
    if (v.comment) {
      cur.comments.push({
        guest_name: memberMap.get(v.member_id) ?? "익명",
        text: v.comment,
      });
    }
    map.set(v.item_id, cur);
  }
  return Array.from(map.entries()).map(([item_id, s]) => ({ item_id, ...s }));
}

// ─── Silent Consent 처리 ────────────────────────────────────────────────────
async function processSilentConsent(planId?: string): Promise<number> {
  // 마감 도래한 trip 의 plan_members.is_agreed = NULL → true
  let tripQuery = adminClient
    .from("trips")
    .select("plan_id, consensus_deadline")
    .not("consensus_deadline", "is", null)
    .lt("consensus_deadline", new Date().toISOString());
  if (planId) tripQuery = tripQuery.eq("plan_id", planId);

  const { data: expiredTrips } = await tripQuery;
  if (!expiredTrips?.length) return 0;

  const tripIds = expiredTrips.map((t) => t.plan_id);
  const { data: updated, error } = await adminClient
    .from("plan_members")
    .update({ is_agreed: true, responded_at: new Date().toISOString() })
    .in("plan_id", tripIds)
    .is("is_agreed", null)
    .select("member_id");

  if (error) {
    console.error("[silent-consent] error", error);
    return 0;
  }
  return updated?.length ?? 0;
}

// ============================================================================
// 핸들러: POST /api/trips/:planId/share — 호스트 share_token 발급
// ============================================================================
async function handleCreateShareLink(
  req: Request,
  planId: string,
): Promise<Response> {
  const userId = await getAuthUserId(req);
  if (!userId) return errJson("UNAUTHORIZED", "로그인이 필요합니다.", 401);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errJson("VALIDATION_ERROR", "JSON 파싱 실패", 400);
  }
  const parsed = CreateShareLinkSchema.safeParse(body);
  if (!parsed.success) {
    return errJson(
      "VALIDATION_ERROR",
      parsed.error.issues.map((i) => i.message).join(", "),
      400,
    );
  }

  // trips 존재 + 호스트 본인 확인
  const { data: trip } = await adminClient
    .from("trips")
    .select("plan_id, creator_id, share_token")
    .eq("plan_id", planId)
    .single();
  if (!trip) return errJson("VALIDATION_ERROR", "계획을 찾을 수 없습니다.", 404);
  if (trip.creator_id !== userId) {
    return errJson("UNAUTHORIZED", "호스트만 공유 링크를 발급할 수 있습니다.", 403);
  }

  // 재호출 시 기존 share_token 유지, 마감만 갱신
  const shareToken = trip.share_token ?? crypto.randomUUID();
  const consensusDeadline = new Date(
    Date.now() + parsed.data.consensusDeadlineHours * 60 * 60 * 1000,
  );

  const { error: upErr } = await adminClient
    .from("trips")
    .update({
      share_token: shareToken,
      consensus_deadline: consensusDeadline.toISOString(),
    })
    .eq("plan_id", planId);

  if (upErr) {
    console.error("[create-share] update error", upErr);
    return errJson("INTERNAL_ERROR", upErr.message, 500);
  }

  return json({
    shareToken,
    shareUrl: `${PUBLIC_URL}/share/${shareToken}`,
    consensusDeadline: consensusDeadline.toISOString(),
  });
}

// ============================================================================
// 핸들러: GET /api/share/:token — 비회원 공유 페이지 조회
// ============================================================================
async function handleGetShare(
  req: Request,
  token: string,
): Promise<Response> {
  // anon 클라이언트 → RLS 적용 (trips_share_read 정책)
  const { data: trip, error: tErr } = await anonClient
    .from("trips")
    .select(
      `
      plan_id, title, scheduled_date, status, duration_days, consensus_deadline,
      course_options (
        course_id, plan_id, course_name, total_estimated_minutes,
        ai_reasoning, ai_model_used, is_selected,
        itinerary_items (
          item_id, course_id, place_id, sequence_order,
          stay_duration_minutes, transport_mode, transport_duration_minutes, notes,
          place:places (
            place_id, external_id, name, category, address,
            wheelchair_accessible, stroller_accessible,
            dietary_options, operating_hours, phone,
            accessibility_score, last_verified_at
          )
        )
      )
    `,
    )
    .eq("share_token", token)
    .maybeSingle();

  if (tErr) {
    console.error("[get-share] select error", tErr);
    return errJson("INTERNAL_ERROR", tErr.message, 500);
  }
  if (!trip) {
    return errJson(
      "SHARE_TOKEN_NOT_FOUND",
      "링크가 만료되었거나 존재하지 않습니다.",
      410,
    );
  }

  // 본인 식별 (Cookie 또는 X-Guest-Token 헤더)
  const guestToken =
    req.headers.get("x-guest-token") ??
    (req.headers.get("cookie")?.match(/guest_token=([^;]+)/)?.[1] ?? null);

  let yourResponses: unknown[] = [];
  let yourMember: { member_id: string; guest_name: string | null } | null = null;
  if (guestToken) {
    const { data: m } = await adminClient
      .from("plan_members")
      .select("member_id, guest_name, plan_id")
      .eq("guest_token", guestToken)
      .eq("plan_id", trip.plan_id)
      .maybeSingle();
    if (m) {
      yourMember = { member_id: m.member_id, guest_name: m.guest_name };
      const { data: votes } = await adminClient
        .from("votes")
        .select("*")
        .eq("member_id", m.member_id);
      yourResponses = votes ?? [];
    }
  }

  const voteSummaries = await getItemVoteSummaries(trip.plan_id);

  // itinerary_items의 sequence_order 정렬
  const courses = (trip.course_options ?? []).map((c: any) => ({
    ...c,
    items: (c.itinerary_items ?? []).sort(
      (a: any, b: any) => a.sequence_order - b.sequence_order,
    ),
    itinerary_items: undefined,
  }));

  return json({
    plan: {
      plan_id: trip.plan_id,
      title: trip.title,
      scheduled_date: trip.scheduled_date,
      status: trip.status,
      duration_days: trip.duration_days,
    },
    courses,
    consensusDeadline: trip.consensus_deadline,
    your_responses: yourResponses,
    your_member: yourMember,
    vote_summaries: voteSummaries,
  });
}

// ============================================================================
// 핸들러: POST /api/share/:token/identify
// ============================================================================
async function handleIdentify(
  req: Request,
  token: string,
): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errJson("VALIDATION_ERROR", "JSON 파싱 실패", 400);
  }
  const parsed = IdentifySchema.safeParse(body);
  if (!parsed.success) {
    return errJson(
      "VALIDATION_ERROR",
      parsed.error.issues.map((i) => i.message).join(", "),
      400,
    );
  }
  const guestName = parsed.data.guest_name;

  // 토큰 유효성 + 마감 확인
  const { data: trip } = await adminClient
    .from("trips")
    .select("plan_id, consensus_deadline")
    .eq("share_token", token)
    .maybeSingle();
  if (!trip) {
    return errJson("SHARE_TOKEN_NOT_FOUND", "링크가 만료되었습니다.", 410);
  }
  if (
    trip.consensus_deadline &&
    new Date(trip.consensus_deadline) < new Date()
  ) {
    return errJson("VOTING_CLOSED", "투표 기간이 종료되었습니다.", 410);
  }

  // IP rate limit
  const ip = clientIp(req);
  const ipHash = await hashSHA256(ip + IP_HASH_SALT);
  const windowStart = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count: recentCount } = await adminClient
    .from("plan_members")
    .select("member_id", { count: "exact", head: true })
    .eq("ip_hash", ipHash)
    .gte("created_at", windowStart);
  if (recentCount !== null && recentCount >= 10) {
    return errJson(
      "RATE_LIMITED",
      "1시간 내 너무 많은 요청이 발생했습니다.",
      429,
    );
  }

  // 동일 plan_id + guest_name 재방문이면 기존 member 반환
  const { data: existing } = await adminClient
    .from("plan_members")
    .select("member_id, guest_token")
    .eq("plan_id", trip.plan_id)
    .eq("guest_name", guestName)
    .maybeSingle();

  if (existing) {
    return json({
      member_id: existing.member_id,
      guest_token: existing.guest_token,
      is_returning: true,
    });
  }

  // 신규 등록 — guest_token / member_id 는 DB default(gen_random_uuid)
  const { data: inserted, error: insErr } = await adminClient
    .from("plan_members")
    .insert({
      plan_id: trip.plan_id,
      guest_name: guestName,
      ip_hash: ipHash,
    })
    .select("member_id, guest_token")
    .single();

  if (insErr || !inserted) {
    console.error("[identify] insert error", insErr);
    return errJson("INTERNAL_ERROR", insErr?.message ?? "insert failed", 500);
  }

  return json({
    member_id: inserted.member_id,
    guest_token: inserted.guest_token,
    is_returning: false,
  });
}

// ============================================================================
// 핸들러: POST /api/share/:token/vote
// ============================================================================
async function handleVote(req: Request, token: string): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errJson("VALIDATION_ERROR", "JSON 파싱 실패", 400);
  }
  const parsed = VoteRequestSchema.safeParse(body);
  if (!parsed.success) {
    return errJson(
      "VALIDATION_ERROR",
      parsed.error.issues.map((i) => i.message).join(", "),
      400,
    );
  }
  const { guest_token, votes } = parsed.data;

  // 토큰 유효성
  const { data: trip } = await adminClient
    .from("trips")
    .select("plan_id, consensus_deadline")
    .eq("share_token", token)
    .maybeSingle();
  if (!trip) {
    return errJson("SHARE_TOKEN_NOT_FOUND", "링크가 만료되었습니다.", 410);
  }

  // 마감 확인 — 만료라면 Silent Consent 처리 후 410
  if (
    trip.consensus_deadline &&
    new Date(trip.consensus_deadline) < new Date()
  ) {
    await processSilentConsent(trip.plan_id);
    return errJson("VOTING_CLOSED", "투표 기간이 종료되었습니다.", 410);
  }

  // guest_token 으로 member 재조회 (위조 방지)
  const { data: member } = await adminClient
    .from("plan_members")
    .select("member_id, plan_id")
    .eq("guest_token", guest_token)
    .maybeSingle();
  if (!member || member.plan_id !== trip.plan_id) {
    return errJson("INVALID_GUEST_TOKEN", "유효하지 않은 게스트 토큰입니다.", 401);
  }

  // 기존 투표 존재 여부 → 메시지 분기
  const itemIds = votes.map((v) => v.item_id);
  const { data: prior } = await adminClient
    .from("votes")
    .select("item_id")
    .eq("member_id", member.member_id)
    .in("item_id", itemIds);
  const isUpdate = (prior?.length ?? 0) > 0;

  // upsert
  const nowIso = new Date().toISOString();
  const { data: saved, error: upErr } = await adminClient
    .from("votes")
    .upsert(
      votes.map((v) => ({
        member_id: member.member_id,
        course_id: v.course_id,
        item_id: v.item_id,
        is_positive: v.is_positive,
        comment: v.comment ?? null,
        updated_at: nowIso,
      })),
      { onConflict: "member_id,item_id" },
    )
    .select();

  if (upErr) {
    console.error("[vote] upsert error", upErr);
    return errJson("INTERNAL_ERROR", upErr.message, 500);
  }

  // plan_members.responded_at + is_agreed 갱신 (찬성/반대 혼합 시 부분 동의로 true)
  // 정책: 한 표라도 응답하면 responded_at 기록, 모두 찬성이면 is_agreed=true, 하나라도 반대면 false
  const allPositive = votes.every((v) => v.is_positive);
  await adminClient
    .from("plan_members")
    .update({
      responded_at: nowIso,
      is_agreed: allPositive,
    })
    .eq("member_id", member.member_id);

  const consensus = await getConsensusStatus(trip.plan_id);

  return json({
    saved_votes: saved ?? [],
    consensus_status: consensus,
    message: isUpdate ? "의견을 변경하셨습니다." : "투표가 저장되었습니다.",
  });
}

// ============================================================================
// 핸들러: POST /api/share/:token/process-consent — cron 호출용
// ============================================================================
async function handleProcessConsent(
  _req: Request,
  token: string | null,
): Promise<Response> {
  let planId: string | undefined;
  if (token) {
    const { data: trip } = await adminClient
      .from("trips")
      .select("plan_id")
      .eq("share_token", token)
      .maybeSingle();
    if (!trip) {
      return errJson("SHARE_TOKEN_NOT_FOUND", "토큰을 찾을 수 없습니다.", 410);
    }
    planId = trip.plan_id;
  }
  const updated = await processSilentConsent(planId);
  return json({ updated_members: updated });
}

// ============================================================================
// 라우터
// ============================================================================
serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const url = new URL(req.url);
  // path 예시:
  //   /share/api/trips/{planId}/share        (POST)
  //   /share/api/share/{token}               (GET)
  //   /share/api/share/{token}/identify      (POST)
  //   /share/api/share/{token}/vote          (POST)
  //   /share/api/share/{token}/process-consent (POST)
  const parts = url.pathname.replace(/^\/+|\/+$/g, "").split("/");
  // Supabase 는 /functions/v1/share/... 로 진입. 함수명 앞 세그먼트 모두 제거
  const apiIdx = parts.indexOf("api");
  const seg = apiIdx >= 0 ? parts.slice(apiIdx + 1) : parts;
  // seg 후보:
  //   ["trips", planId, "share"]
  //   ["share", token]
  //   ["share", token, "identify" | "vote" | "process-consent"]

  try {
    if (seg[0] === "trips" && seg[2] === "share" && req.method === "POST") {
      return await handleCreateShareLink(req, seg[1]);
    }
    if (seg[0] === "share" && seg[1]) {
      const token = seg[1];
      if (seg.length === 2 && req.method === "GET") {
        return await handleGetShare(req, token);
      }
      if (seg[2] === "identify" && req.method === "POST") {
        return await handleIdentify(req, token);
      }
      if (seg[2] === "vote" && req.method === "POST") {
        return await handleVote(req, token);
      }
      if (seg[2] === "process-consent" && req.method === "POST") {
        return await handleProcessConsent(req, token);
      }
    }
    if (seg[0] === "process-consent" && req.method === "POST") {
      return await handleProcessConsent(req, null);
    }

    return errJson("VALIDATION_ERROR", `Not Found: ${url.pathname}`, 404);
  } catch (e) {
    console.error("[share] uncaught", e);
    return errJson(
      "INTERNAL_ERROR",
      e instanceof Error ? e.message : "unknown",
      500,
    );
  }
});
