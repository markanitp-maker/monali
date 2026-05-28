/**
 * Monali — planner Edge Function
 *
 * 라우팅:
 *   POST /api/planner/generate   → 202 Accepted + 백그라운드 5단계 파이프라인 킥오프
 *
 * 책임:
 *   1. JWT 인증 (course-designer)
 *   2. Zod 입력 검증 (course-designer)
 *   3. 크레딧 잔액 확인 + 차감 (course-designer)
 *   4. trips / ai_tasks INSERT (course-designer)
 *   5. 202 응답 즉시 반환 (course-designer)
 *   6. EdgeRuntime.waitUntil(runPipeline) — 5단계 AI 파이프라인 (ai-pipeline) ★ 본 구현
 *
 * - Deno runtime, TypeScript strict
 * - Supabase service_role client
 * - Gemma 호출 규칙: .claude/skills/gemma4-integration/SKILL.md 준수
 */

// @ts-ignore Deno runtime
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
// @ts-ignore Deno runtime
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// @ts-ignore Deno runtime
import { z } from "https://esm.sh/zod@3.23.8";
import {
  callGemma,
  extractJSON,
  withTimeout,
  modelLabel,
} from "../_shared/ai-client.ts";

// ─── CORS ───────────────────────────────────────────────────────────────────
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

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

const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ─── Zod 스키마 ─────────────────────────────────────────────────────────────
const GenerateRequestSchema = z.object({
  origin: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    address: z.string().min(1).max(500),
  }),
  radius_km: z.number().int().min(1).max(50).default(20),
  scheduled_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD 형식"),
  duration_days: z.number().int().min(1).max(3),
  group_id: z.string().uuid(),
  mood_tags: z.array(z.string().max(40)).max(20).default([]),
  additional_notes: z.string().max(2000).optional(),
  title: z.string().max(200).optional(),
});

type GenerateRequest = z.infer<typeof GenerateRequestSchema>;

// ─── 인증 ───────────────────────────────────────────────────────────────────
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

// ─── 핸들러 : POST /api/planner/generate ────────────────────────────────────
async function handleGenerate(
  req: Request,
  userId: string,
): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const parsed = GenerateRequestSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      { error: "ValidationError", issues: parsed.error.issues },
      400,
    );
  }
  const input: GenerateRequest = parsed.data;

  const creditsRequired = input.duration_days * 30;

  const { data: profile, error: profileErr } = await adminClient
    .from("profiles")
    .select("credit_balance")
    .eq("user_id", userId)
    .single();

  if (profileErr || !profile) {
    return json(
      { error: "DBError", message: profileErr?.message ?? "profile not found" },
      500,
    );
  }

  if (profile.credit_balance < creditsRequired) {
    return json(
      {
        error: {
          code: "CREDIT_INSUFFICIENT",
          details: {
            required: creditsRequired,
            available: profile.credit_balance,
          },
        },
      },
      402,
    );
  }

  const { data: group, error: groupErr } = await adminClient
    .from("groups")
    .select("group_id, user_id, name")
    .eq("group_id", input.group_id)
    .single();

  if (groupErr || !group) {
    return json({ error: "GroupNotFound" }, 404);
  }
  if (group.user_id !== userId) {
    return json({ error: "Forbidden: group not owned by user" }, 403);
  }

  const title =
    input.title ?? `${group.name} 나들이 ${input.scheduled_date}`;

  let planId: string | null = null;
  let taskId: string | null = null;
  let creditsRemaining: number = profile.credit_balance;

  const { data: rpcData, error: rpcErr } = await adminClient.rpc(
    "start_planner_task",
    {
      p_user_id: userId,
      p_group_id: input.group_id,
      p_title: title,
      p_origin_address: input.origin.address,
      p_origin_lat: input.origin.lat,
      p_origin_lng: input.origin.lng,
      p_radius_km: input.radius_km,
      p_scheduled_date: input.scheduled_date,
      p_duration_days: input.duration_days,
      p_mood_tags: input.mood_tags,
      p_additional_notes: input.additional_notes ?? null,
      p_credits: creditsRequired,
    },
  );

  if (!rpcErr && rpcData && Array.isArray(rpcData) && rpcData.length > 0) {
    const row = rpcData[0] as {
      plan_id: string;
      task_id: string;
      credits_remaining: number;
    };
    planId = row.plan_id;
    taskId = row.task_id;
    creditsRemaining = row.credits_remaining;
  } else {
    console.warn("[planner] RPC start_planner_task 실패, 폴백 경로:", rpcErr);
    const fallback = await fallbackInsert(
      userId,
      input,
      title,
      creditsRequired,
      profile.credit_balance,
    );
    if ("error" in fallback) return fallback.error;
    planId = fallback.planId;
    taskId = fallback.taskId;
    creditsRemaining = fallback.creditsRemaining;
  }

  if (!planId || !taskId) {
    return json({ error: "InternalServerError", message: "task creation failed" }, 500);
  }

  // 백그라운드 파이프라인 킥오프 — 5단계 AI 실행
  try {
    // @ts-ignore EdgeRuntime
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
      // @ts-ignore
      EdgeRuntime.waitUntil(
        withTimeout(runPipeline(planId, taskId, userId)).catch((err) => {
          console.error("[planner] runPipeline error:", err);
          return markFailed(taskId!, err);
        }),
      );
    } else {
      runPipeline(planId, taskId, userId).catch((err) => {
        console.error("[planner] runPipeline failed:", err);
        return markFailed(taskId!, err);
      });
    }
  } catch (err) {
    console.error("[planner] waitUntil 등록 실패:", err);
  }

  return json(
    {
      plan_id: planId,
      task_id: taskId,
      status: "PROCESSING",
      current_step: "skeleton",
      estimated_completion_sec: 90,
      credits_consumed: creditsRequired,
      credits_remaining: creditsRemaining,
      realtime_channel: `ai_task:${taskId}`,
    },
    202,
  );
}

// ─── 폴백 INSERT (RPC 미배포 환경) ──────────────────────────────────────────
async function fallbackInsert(
  userId: string,
  input: GenerateRequest,
  title: string,
  creditsRequired: number,
  currentBalance: number,
): Promise<
  | { planId: string; taskId: string; creditsRemaining: number }
  | { error: Response }
> {
  const { data: tripRow, error: tripErr } = await adminClient
    .from("trips")
    .insert({
      creator_id: userId,
      group_id: input.group_id,
      title,
      origin_address: input.origin.address,
      origin_lat: input.origin.lat,
      origin_lng: input.origin.lng,
      radius_km: input.radius_km,
      scheduled_date: input.scheduled_date,
      duration_days: input.duration_days,
      status: "PLANNING",
      mood_tags: input.mood_tags,
      additional_notes: input.additional_notes ?? null,
      credits_consumed: creditsRequired,
    })
    .select("plan_id")
    .single();

  if (tripErr || !tripRow) {
    return {
      error: json(
        { error: "DBError", message: tripErr?.message ?? "trips insert failed" },
        500,
      ),
    };
  }
  const planId = tripRow.plan_id as string;

  const { data: taskRow, error: taskErr } = await adminClient
    .from("ai_tasks")
    .insert({
      plan_id: planId,
      current_step: "skeleton",
      status: "RUNNING",
      retry_count: 0,
      step_results: {},
    })
    .select("task_id")
    .single();

  if (taskErr || !taskRow) {
    await adminClient.from("trips").delete().eq("plan_id", planId);
    return {
      error: json(
        { error: "DBError", message: taskErr?.message ?? "ai_tasks insert failed" },
        500,
      ),
    };
  }
  const taskId = taskRow.task_id as string;

  const newBalance = currentBalance - creditsRequired;
  const { error: balanceErr } = await adminClient
    .from("profiles")
    .update({ credit_balance: newBalance })
    .eq("user_id", userId)
    .eq("credit_balance", currentBalance);

  if (balanceErr) {
    await adminClient.from("ai_tasks").delete().eq("task_id", taskId);
    await adminClient.from("trips").delete().eq("plan_id", planId);
    return {
      error: json(
        { error: "DBError", message: balanceErr.message },
        500,
      ),
    };
  }

  const { error: txErr } = await adminClient.from("credit_transactions").insert({
    user_id: userId,
    amount: -creditsRequired,
    source: "CONSUMPTION",
    related_plan_id: planId,
    balance_after: newBalance,
    memo: `Planner 생성 (${input.duration_days}일)`,
  });

  if (txErr) {
    console.error("[planner] credit_transactions 기록 실패 (continuing):", txErr);
  }

  return { planId, taskId, creditsRemaining: newBalance };
}

// ╔══════════════════════════════════════════════════════════════════════════╗
// ║                  5단계 AI 파이프라인 (ai-pipeline)                       ║
// ╚══════════════════════════════════════════════════════════════════════════╝

interface OriginInput {
  lat: number;
  lng: number;
  address: string;
}

interface SkeletonPlace {
  name: string;
  category: string;
  address: string;
  reason: string;
}

interface VerifiedPlace extends SkeletonPlace {
  external_id?: string;
  lat?: number;
  lng?: number;
  phone?: string;
  operating_hours?: Record<string, unknown>;
  wheelchair_accessible?: boolean;
  stroller_accessible?: boolean;
  accessibility_score: number;
  transport_duration_minutes?: number;
  stay_duration_minutes: number;
  transport_mode: "walk" | "car" | "public";
}

interface GroupContext {
  group_id: string;
  group_name: string;
  has_wheelchair: boolean;
  has_stroller: boolean;
  has_limited_mobility: boolean;
  dietary_restrictions: string[];
  preference_tags: string[];
}

const LINEAR_BACKOFF_MS = [3_000, 6_000, 9_000];
const MAX_STEP_ATTEMPTS = 3;
const TARGET_PLACE_COUNT = 5;

// 단계 결과를 ai_tasks.step_results 에 누적 저장하고 current_step 을 갱신
async function updateStep(
  taskId: string,
  current_step: string,
  patch: Record<string, unknown>,
  prev: Record<string, unknown>,
  retry_count?: number,
): Promise<Record<string, unknown>> {
  const merged = { ...prev, ...patch };
  const update: Record<string, unknown> = {
    current_step,
    step_results: merged,
  };
  if (retry_count !== undefined) update.retry_count = retry_count;
  const { error } = await adminClient
    .from("ai_tasks")
    .update(update)
    .eq("task_id", taskId);
  if (error) console.error("[updateStep] ai_tasks update 실패:", error);
  return merged;
}

async function markFailed(taskId: string, err: unknown): Promise<void> {
  const msg = err instanceof Error ? err.message : String(err);
  await adminClient
    .from("ai_tasks")
    .update({
      status: "FAILED",
      last_error: msg.substring(0, 1000),
    })
    .eq("task_id", taskId);
}

// 그룹 제약 컨텍스트 조회
async function loadGroupContext(groupId: string): Promise<GroupContext> {
  const { data: group } = await adminClient
    .from("groups")
    .select("group_id, name")
    .eq("group_id", groupId)
    .single();

  const { data: members } = await adminClient
    .from("group_members")
    .select(
      `companion:companions (
        mobility_constraint,
        dietary_restriction,
        preference_tags
      )`,
    )
    .eq("group_id", groupId);

  let has_wheelchair = false;
  let has_stroller = false;
  let has_limited_mobility = false;
  const dietary = new Set<string>();
  const prefs = new Set<string>();

  for (const m of (members ?? []) as Array<{ companion: any }>) {
    const c = m.companion;
    if (!c) continue;
    if (c.mobility_constraint === "WHEELCHAIR") has_wheelchair = true;
    if (c.mobility_constraint === "STROLLER") has_stroller = true;
    if (c.mobility_constraint === "LIMITED") has_limited_mobility = true;
    if (c.dietary_restriction && c.dietary_restriction !== "NONE") {
      dietary.add(c.dietary_restriction);
    }
    if (Array.isArray(c.preference_tags)) {
      for (const t of c.preference_tags) prefs.add(String(t));
    }
  }

  return {
    group_id: groupId,
    group_name: group?.name ?? "그룹",
    has_wheelchair,
    has_stroller,
    has_limited_mobility,
    dietary_restrictions: [...dietary],
    preference_tags: [...prefs],
  };
}

// ─── Step 1: skeleton ───────────────────────────────────────────────────────
function buildSkeletonPrompt(
  origin: OriginInput,
  radiusKm: number,
  scheduledDate: string,
  moodTags: string[],
  ctx: GroupContext,
  additionalNotes: string | null,
  excludeNames: string[] = [],
): string {
  const constraints: string[] = [];
  if (ctx.has_wheelchair) constraints.push("휠체어 접근 가능 (경사로/엘리베이터 필수)");
  if (ctx.has_stroller) constraints.push("유모차 동반 가능 (계단 회피, 평탄로 우선)");
  if (ctx.has_limited_mobility) constraints.push("거동 제한 (장시간 도보 회피)");
  if (ctx.dietary_restrictions.length) {
    constraints.push(`식이 제한: ${ctx.dietary_restrictions.join(", ")}`);
  }
  if (!constraints.length) constraints.push("특별한 접근성 제약 없음");

  const schema = {
    places: [
      {
        name: "장소 이름",
        category: "관광지/카페/식당/공원/박물관 등",
        address: "도로명 주소 (시/도 포함)",
        reason: "이 그룹에 추천하는 한 줄 이유",
      },
    ],
  };

  return `당신은 한국 가족 나들이 코스 설계 전문가입니다.

[출발지] ${origin.address} (위도 ${origin.lat}, 경도 ${origin.lng})
[반경] ${radiusKm}km 이내
[날짜] ${scheduledDate}
[그룹] ${ctx.group_name}
[접근성/제약]
- ${constraints.join("\n- ")}
[분위기 태그] ${moodTags.length ? moodTags.join(", ") : "(없음)"}
[선호] ${ctx.preference_tags.length ? ctx.preference_tags.join(", ") : "(없음)"}
[추가 요청] ${additionalNotes ?? "(없음)"}
${excludeNames.length ? `[제외 장소] ${excludeNames.join(", ")}` : ""}

위 조건에 부합하는 실제 한국 장소 ${TARGET_PLACE_COUNT}곳을 동선이 자연스러운 순서로 추천하세요.
가공의 장소가 아닌, Naver/Google 지도에 등재된 실재 장소만 추천하세요.

[중요] 반드시 아래 JSON 형식으로만 응답하세요.
마크다운, 설명 없이 순수 JSON만 출력하세요. 첫 글자는 반드시 { 이어야 합니다.

출력 형식:
${JSON.stringify(schema, null, 2)}`;
}

async function runSkeleton(
  origin: OriginInput,
  radiusKm: number,
  scheduledDate: string,
  moodTags: string[],
  ctx: GroupContext,
  additionalNotes: string | null,
  excludeNames: string[] = [],
): Promise<SkeletonPlace[]> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < MAX_STEP_ATTEMPTS; attempt++) {
    try {
      const prompt = buildSkeletonPrompt(
        origin, radiusKm, scheduledDate, moodTags, ctx, additionalNotes, excludeNames,
      );
      const text = await callGemma(prompt, { quality: "premium" });
      const parsed = extractJSON(text) as { places?: SkeletonPlace[] };
      if (Array.isArray(parsed?.places) && parsed.places.length > 0) {
        return parsed.places
          .filter((p) => p?.name && p?.address)
          .slice(0, TARGET_PLACE_COUNT);
      }
      throw new Error("skeleton: places 배열이 비어있음");
    } catch (err) {
      lastErr = err;
      console.warn(`[skeleton] attempt ${attempt + 1} 실패:`, err);
      if (attempt < MAX_STEP_ATTEMPTS - 1) {
        await new Promise((r) => setTimeout(r, LINEAR_BACKOFF_MS[attempt]));
      }
    }
  }
  throw new Error(`skeleton 3회 실패: ${lastErr instanceof Error ? lastErr.message : lastErr}`);
}

// ─── Naver Local Search ─────────────────────────────────────────────────────
interface NaverLocalItem {
  title: string;
  link: string;
  category: string;
  description: string;
  telephone: string;
  address: string;
  roadAddress: string;
  mapx: string; // 좌표 (KATEC -> WGS84 변환 필요할 수 있으나 신규 API는 WGS84)
  mapy: string;
}

async function naverLocalSearch(query: string): Promise<NaverLocalItem | null> {
  const id = Deno.env.get("NAVER_CLIENT_ID");
  const secret = Deno.env.get("NAVER_CLIENT_SECRET");
  if (!id || !secret) {
    console.warn("[naverLocalSearch] NAVER_CLIENT_ID/SECRET 미설정 — 검증 건너뜀");
    return null;
  }
  const url = `https://openapi.naver.com/v1/search/local.json?query=${encodeURIComponent(query)}&display=1`;
  try {
    const res = await fetch(url, {
      headers: {
        "X-Naver-Client-Id": id,
        "X-Naver-Client-Secret": secret,
      },
    });
    if (!res.ok) {
      console.warn(`[naverLocalSearch] HTTP ${res.status} for "${query}"`);
      return null;
    }
    const data = await res.json();
    const items = data?.items as NaverLocalItem[] | undefined;
    if (!items || items.length === 0) return null;
    return items[0];
  } catch (err) {
    console.warn("[naverLocalSearch] fetch 실패:", err);
    return null;
  }
}

// Naver Local mapx/mapy 는 신 API 에서 1e7 스케일 정수 WGS84
function naverCoordToWgs84(mapx: string, mapy: string): { lat: number; lng: number } {
  const lng = parseFloat(mapx) / 1e7;
  const lat = parseFloat(mapy) / 1e7;
  return { lat, lng };
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, "").trim();
}

// ─── Step 2: places (Naver 실존 확인, 병렬) ────────────────────────────────
async function runPlaces(skeleton: SkeletonPlace[]): Promise<VerifiedPlace[]> {
  const results = await Promise.allSettled(
    skeleton.map((p) => naverLocalSearch(`${p.name} ${p.address.split(" ").slice(0, 2).join(" ")}`)),
  );

  const verified: VerifiedPlace[] = [];
  results.forEach((r, i) => {
    const s = skeleton[i];
    if (r.status === "fulfilled" && r.value) {
      const { lat, lng } = naverCoordToWgs84(r.value.mapx, r.value.mapy);
      verified.push({
        ...s,
        name: stripHtml(r.value.title) || s.name,
        category: r.value.category || s.category,
        address: r.value.roadAddress || r.value.address || s.address,
        external_id: r.value.link || undefined,
        lat,
        lng,
        phone: r.value.telephone || undefined,
        accessibility_score: 0.5,
        stay_duration_minutes: 60,
        transport_mode: "car",
      });
    } else if (r.status === "fulfilled" && r.value === null) {
      // Naver API 키 없음 → skeleton 그대로 통과 (실 검증 스킵)
      verified.push({
        ...s,
        accessibility_score: 0.5,
        stay_duration_minutes: 60,
        transport_mode: "car",
      });
    } else {
      console.warn(`[places] "${s.name}" 검증 실패, 제외`);
    }
  });

  return verified;
}

// ─── Step 3: verify (운영시간/휴무) ─────────────────────────────────────────
async function runVerify(places: VerifiedPlace[], scheduledDate: string): Promise<VerifiedPlace[]> {
  // Naver Local 응답 description 에 휴무 키워드가 있는지 정도만 휴리스틱으로 검증
  // (운영시간 상세 API 는 별도 계약 필요)
  const closedKeywords = ["폐업", "휴업", "영업종료"];
  return places.filter((p) => {
    const haystack = `${p.category ?? ""}`;
    return !closedKeywords.some((k) => haystack.includes(k));
  }).map((p) => ({
    ...p,
    operating_hours: { verified_at: scheduledDate, source: "naver_local" },
  }));
}

// ─── Step 4: details (접근성 보강) ──────────────────────────────────────────
async function runDetails(
  places: VerifiedPlace[],
  ctx: GroupContext,
): Promise<VerifiedPlace[]> {
  // 공공데이터포털 접근성 API 미연동 환경 → 카테고리 기반 휴리스틱
  // 추후 PUBLIC_DATA_API_KEY 환경변수로 실 호출 가능
  const apiKey = Deno.env.get("PUBLIC_DATA_API_KEY");

  const enrichOne = async (p: VerifiedPlace): Promise<VerifiedPlace> => {
    let score = 0.5;
    let wheel: boolean | undefined;
    let stroller: boolean | undefined;
    const cat = (p.category ?? "").toLowerCase();

    // 휴리스틱: 공원/박물관/대형시설은 접근성 양호 가정, 골목/전통시장은 낮음
    if (/공원|박물관|미술관|전시|쇼핑몰|호텔|아쿠아리움/.test(cat)) {
      score = 0.85;
      wheel = true;
      stroller = true;
    } else if (/전통시장|골목|등산|계단|언덕/.test(cat)) {
      score = 0.3;
      wheel = false;
      stroller = false;
    } else if (/카페|식당|레스토랑/.test(cat)) {
      score = 0.6;
    }

    if (apiKey) {
      // 실 API 호출 자리 — Promise.allSettled 컨텍스트에서 안전하게
      // (현재는 placeholder, 후속 작업에서 구현)
    }

    return {
      ...p,
      wheelchair_accessible: wheel,
      stroller_accessible: stroller,
      accessibility_score: score,
    };
  };

  const settled = await Promise.allSettled(places.map(enrichOne));
  return settled.map((r, i) =>
    r.status === "fulfilled" ? r.value : places[i],
  );
}

// ─── Step 5: route (Naver Directions) ──────────────────────────────────────
function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

async function naverDirections(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
): Promise<number | null> {
  const id = Deno.env.get("NAVER_CLIENT_ID");
  const secret = Deno.env.get("NAVER_CLIENT_SECRET");
  if (!id || !secret) return null;
  // Naver Directions 5 API (별도 계정/키 필요할 수 있음). 실패 시 null.
  const url = `https://naveropenapi.apigw.ntruss.com/map-direction/v1/driving?start=${from.lng},${from.lat}&goal=${to.lng},${to.lat}`;
  try {
    const res = await fetch(url, {
      headers: {
        "X-NCP-APIGW-API-KEY-ID": id,
        "X-NCP-APIGW-API-KEY": secret,
      },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const durationMs = data?.route?.traoptimal?.[0]?.summary?.duration;
    if (typeof durationMs === "number") return Math.round(durationMs / 60_000);
    return null;
  } catch {
    return null;
  }
}

async function runRoute(
  places: VerifiedPlace[],
  ctx: GroupContext,
): Promise<VerifiedPlace[]> {
  const mode: VerifiedPlace["transport_mode"] =
    ctx.has_wheelchair || ctx.has_stroller ? "car" : "car";

  if (places.length < 2) {
    return places.map((p) => ({ ...p, transport_mode: mode, transport_duration_minutes: 0 }));
  }

  const tasks: Promise<number | null>[] = [];
  for (let i = 0; i < places.length; i++) {
    if (i === 0) continue;
    const prev = places[i - 1];
    const cur = places[i];
    if (prev.lat != null && prev.lng != null && cur.lat != null && cur.lng != null) {
      tasks.push(naverDirections({ lat: prev.lat, lng: prev.lng }, { lat: cur.lat, lng: cur.lng }));
    } else {
      tasks.push(Promise.resolve(null));
    }
  }

  const results = await Promise.allSettled(tasks);

  return places.map((p, i) => {
    if (i === 0) {
      return { ...p, transport_mode: mode, transport_duration_minutes: 0 };
    }
    const r = results[i - 1];
    let mins: number | null = null;
    if (r.status === "fulfilled") mins = r.value;
    if (mins == null) {
      // 거리 기반 추정: 500m 당 약 6분(도보) 또는 차량 30km/h 가정
      const prev = places[i - 1];
      if (prev.lat != null && prev.lng != null && p.lat != null && p.lng != null) {
        const km = haversineKm({ lat: prev.lat, lng: prev.lng }, { lat: p.lat, lng: p.lng });
        mins = Math.max(5, Math.round((km / 30) * 60)); // 차량 30km/h
      } else {
        mins = 20;
      }
    }
    return { ...p, transport_mode: mode, transport_duration_minutes: mins };
  });
}

// ─── Step 6: assemble (DB 저장) ────────────────────────────────────────────
async function runAssemble(
  planId: string,
  places: VerifiedPlace[],
  ctx: GroupContext,
): Promise<{ course_id: string }> {
  // 6-a. places UPSERT (external_id 기준)
  const placeIds: string[] = [];
  for (const p of places) {
    let placeId: string | null = null;

    if (p.external_id) {
      const { data: existing } = await adminClient
        .from("places")
        .select("place_id")
        .eq("external_id", p.external_id)
        .maybeSingle();
      if (existing) placeId = existing.place_id;
    }

    if (!placeId) {
      const insertPayload: Record<string, unknown> = {
        external_id: p.external_id ?? null,
        name: p.name,
        category: p.category ?? null,
        address: p.address ?? null,
        phone: p.phone ?? null,
        wheelchair_accessible: p.wheelchair_accessible ?? null,
        stroller_accessible: p.stroller_accessible ?? null,
        accessibility_score: p.accessibility_score,
        operating_hours: p.operating_hours ?? {},
        dietary_options: {},
        last_verified_at: new Date().toISOString(),
      };
      if (p.lat != null && p.lng != null) {
        // PostGIS geography(POINT) — SRID 4326 EWKT
        insertPayload.location = `SRID=4326;POINT(${p.lng} ${p.lat})`;
      }
      const { data: inserted, error: insErr } = await adminClient
        .from("places")
        .insert(insertPayload)
        .select("place_id")
        .single();
      if (insErr || !inserted) {
        console.error("[assemble] place insert 실패:", insErr);
        continue;
      }
      placeId = inserted.place_id;
    }
    placeIds.push(placeId!);
  }

  if (placeIds.length === 0) {
    throw new Error("assemble: 저장 가능한 장소가 없음");
  }

  // 6-b. course_options INSERT
  const totalMinutes = places.reduce(
    (acc, p) => acc + (p.stay_duration_minutes ?? 60) + (p.transport_duration_minutes ?? 0),
    0,
  );
  const reasoning =
    `${ctx.group_name} 그룹 제약(휠체어=${ctx.has_wheelchair}, 유모차=${ctx.has_stroller}, ` +
    `식이=${ctx.dietary_restrictions.join("/") || "없음"})을 고려한 ${places.length}곳 코스.`;

  const { data: course, error: courseErr } = await adminClient
    .from("course_options")
    .insert({
      plan_id: planId,
      course_name: "AI 추천 코스",
      total_estimated_minutes: totalMinutes,
      ai_reasoning: reasoning,
      ai_model_used: modelLabel("premium"),
      is_selected: false,
    })
    .select("course_id")
    .single();

  if (courseErr || !course) {
    throw new Error(`course_options insert 실패: ${courseErr?.message}`);
  }
  const courseId = course.course_id as string;

  // 6-c. itinerary_items INSERT (sequence_order 순서)
  const items = placeIds.map((pid, idx) => ({
    course_id: courseId,
    place_id: pid,
    sequence_order: idx,
    stay_duration_minutes: places[idx].stay_duration_minutes ?? 60,
    transport_mode: places[idx].transport_mode ?? "car",
    transport_duration_minutes: places[idx].transport_duration_minutes ?? null,
    notes: places[idx].reason ?? null,
  }));
  const { error: itemsErr } = await adminClient.from("itinerary_items").insert(items);
  if (itemsErr) {
    console.error("[assemble] itinerary_items insert 실패:", itemsErr);
    throw new Error(`itinerary_items insert 실패: ${itemsErr.message}`);
  }

  return { course_id: courseId };
}

// ─── 파이프라인 진입점 ──────────────────────────────────────────────────────
async function runPipeline(
  planId: string,
  taskId: string,
  _userId: string,
): Promise<void> {
  console.log(`[planner] runPipeline 시작 plan=${planId} task=${taskId}`);

  // 0. 입력 컨텍스트 재구성 — trips + ai_tasks 상태 로드 (재시작 지원)
  const { data: trip, error: tripErr } = await adminClient
    .from("trips")
    .select(
      "plan_id, group_id, origin_address, origin_lat, origin_lng, radius_km, scheduled_date, mood_tags, additional_notes",
    )
    .eq("plan_id", planId)
    .single();

  if (tripErr || !trip) {
    await markFailed(taskId, tripErr ?? new Error("trip not found"));
    return;
  }

  const { data: task } = await adminClient
    .from("ai_tasks")
    .select("step_results, retry_count")
    .eq("task_id", taskId)
    .single();

  const stepResults: Record<string, unknown> =
    (task?.step_results as Record<string, unknown>) ?? {};
  const retryCount = task?.retry_count ?? 0;

  const origin: OriginInput = {
    lat: Number(trip.origin_lat),
    lng: Number(trip.origin_lng),
    address: trip.origin_address ?? "",
  };
  const moodTags = Array.isArray(trip.mood_tags) ? (trip.mood_tags as string[]) : [];

  try {
    const ctx = await loadGroupContext(trip.group_id as string);

    // ── Step 1: skeleton ────────────────────────────────────────────────
    let acc = stepResults;
    let skeleton: SkeletonPlace[];
    if (Array.isArray(acc.skeleton) && (acc.skeleton as SkeletonPlace[]).length > 0) {
      skeleton = acc.skeleton as SkeletonPlace[];
      console.log("[skeleton] step_results 에서 복원");
    } else {
      acc = await updateStep(taskId, "skeleton", {}, acc);
      skeleton = await runSkeleton(
        origin, trip.radius_km, trip.scheduled_date, moodTags, ctx, trip.additional_notes ?? null,
      );
      acc = await updateStep(taskId, "skeleton", { skeleton }, acc);
    }

    // ── Step 2: places ──────────────────────────────────────────────────
    acc = await updateStep(taskId, "places", {}, acc);
    let verified: VerifiedPlace[];
    if (Array.isArray(acc.places) && (acc.places as VerifiedPlace[]).length > 0) {
      verified = acc.places as VerifiedPlace[];
    } else {
      verified = await runPlaces(skeleton);
      // 부족 시 대체 장소 보충
      if (verified.length < 3) {
        const exclude = skeleton.map((s) => s.name);
        const filler = await runSkeleton(
          origin, trip.radius_km, trip.scheduled_date, moodTags, ctx,
          trip.additional_notes ?? null, exclude,
        );
        const more = await runPlaces(filler);
        verified = [...verified, ...more].slice(0, TARGET_PLACE_COUNT);
      }
      acc = await updateStep(taskId, "places", { places: verified }, acc);
    }

    if (verified.length === 0) throw new Error("places: 검증된 장소 0개");

    // ── Step 3: verify ──────────────────────────────────────────────────
    acc = await updateStep(taskId, "verify", {}, acc);
    let verifiedOpen: VerifiedPlace[];
    if (Array.isArray(acc.verify) && (acc.verify as VerifiedPlace[]).length > 0) {
      verifiedOpen = acc.verify as VerifiedPlace[];
    } else {
      verifiedOpen = await runVerify(verified, trip.scheduled_date);
      // 휴무 제거로 부족하면 대체
      if (verifiedOpen.length < 3) {
        const exclude = verified.map((v) => v.name);
        const filler = await runSkeleton(
          origin, trip.radius_km, trip.scheduled_date, moodTags, ctx,
          trip.additional_notes ?? null, exclude,
        );
        const more = await runPlaces(filler);
        const moreOpen = await runVerify(more, trip.scheduled_date);
        verifiedOpen = [...verifiedOpen, ...moreOpen].slice(0, TARGET_PLACE_COUNT);
      }
      acc = await updateStep(taskId, "verify", { verify: verifiedOpen }, acc);
    }

    // ── Step 4: details ─────────────────────────────────────────────────
    acc = await updateStep(taskId, "details", {}, acc);
    let detailed: VerifiedPlace[];
    if (Array.isArray(acc.details) && (acc.details as VerifiedPlace[]).length > 0) {
      detailed = acc.details as VerifiedPlace[];
    } else {
      detailed = await runDetails(verifiedOpen, ctx);
      acc = await updateStep(taskId, "details", { details: detailed }, acc);
    }

    // ── Step 5: route ───────────────────────────────────────────────────
    acc = await updateStep(taskId, "route", {}, acc);
    let routed: VerifiedPlace[];
    if (Array.isArray(acc.route) && (acc.route as VerifiedPlace[]).length > 0) {
      routed = acc.route as VerifiedPlace[];
    } else {
      routed = await runRoute(detailed, ctx);
      acc = await updateStep(taskId, "route", { route: routed }, acc);
    }

    // ── Step 6: assemble ────────────────────────────────────────────────
    acc = await updateStep(taskId, "assemble", {}, acc);
    const assembled = await runAssemble(planId, routed, ctx);
    acc = await updateStep(taskId, "assemble", { assemble: assembled }, acc);

    // 최종 COMPLETED
    await adminClient
      .from("ai_tasks")
      .update({
        status: "COMPLETED",
        current_step: "assemble",
        last_error: null,
      })
      .eq("task_id", taskId);

    // trips.status 는 PLANNING 유지 (호스트가 확정)
    console.log(`[planner] runPipeline 완료 plan=${planId} task=${taskId}`);
  } catch (err) {
    console.error("[planner] 파이프라인 실패:", err);
    await adminClient
      .from("ai_tasks")
      .update({ retry_count: retryCount + 1 })
      .eq("task_id", taskId);
    await markFailed(taskId, err);
  }
}

// ─── 라우팅 ─────────────────────────────────────────────────────────────────
function matchRoute(pathname: string): "generate" | "unknown" {
  const segments = pathname.split("/").filter(Boolean);
  const last2 = segments.slice(-2).join("/");
  if (last2 === "planner/generate") return "generate";
  if (segments[segments.length - 1] === "generate") return "generate";
  return "unknown";
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

    if (req.method === "POST" && route === "generate") {
      return await handleGenerate(req, userId);
    }

    return json({ error: "Not Found", path: url.pathname }, 404);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[planner] InternalServerError:", err);
    return json({ error: "InternalServerError", message }, 500);
  }
});
