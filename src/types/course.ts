/**
 * Monali — Course/Planner 공유 타입
 *
 * course-designer 에이전트 관리. ai-pipeline, share-coordinator 등 타 에이전트에서 import.
 *
 * ENUM 값은 supabase/migrations/001_initial_schema.sql 의 ENUM 정의와 1:1 일치.
 *   - ai_task_status      : RUNNING | COMPLETED | FAILED | PAUSED
 *   - ai_pipeline_step    : skeleton | places | verify | details | route | assemble (소문자)
 *   - trip_status         : PLANNING | AGREED | STARTED | COMPLETED | MISSED
 */

// ─── ENUM 타입 (DB와 1:1) ────────────────────────────────────────────────────
export type AiTaskStatus = "RUNNING" | "COMPLETED" | "FAILED" | "PAUSED";

export type AiPipelineStep =
  | "skeleton"
  | "places"
  | "verify"
  | "details"
  | "route"
  | "assemble";

export type TripStatus =
  | "PLANNING"
  | "AGREED"
  | "STARTED"
  | "COMPLETED"
  | "MISSED";

export type TransportMode = "walk" | "car" | "public";

export const AI_PIPELINE_STEPS: readonly AiPipelineStep[] = [
  "skeleton",
  "places",
  "verify",
  "details",
  "route",
  "assemble",
] as const;

/** 단계별 한국어 진행 메시지 — AiProgressView 에서 사용 */
export const AI_PIPELINE_STEP_LABEL: Record<AiPipelineStep, string> = {
  skeleton: "AI가 장소 후보를 고르는 중...",
  places: "장소 실존 확인 중...",
  verify: "운영시간 검증 중...",
  details: "접근성 정보 수집 중...",
  route: "이동 경로 계산 중...",
  assemble: "코스 최종 조합 중...",
};

/** 단계 순서 인덱스 (0~5) — 진행률 계산 */
export const stepIndex = (step: AiPipelineStep): number =>
  AI_PIPELINE_STEPS.indexOf(step);

/** 진행률 0.0~1.0 (COMPLETED 면 1.0) */
export const computeProgress = (
  step: AiPipelineStep,
  status: AiTaskStatus,
): number => {
  if (status === "COMPLETED") return 1.0;
  if (status === "FAILED") return 0;
  const idx = stepIndex(step);
  // 6단계 → 각 단계 시작 시점 = idx / 6, 완료 시 (idx+1)/6
  return (idx + 0.5) / AI_PIPELINE_STEPS.length;
};

// ─── places ─────────────────────────────────────────────────────────────────
export interface Place {
  place_id: string;
  external_id?: string;
  name: string;
  category?: string;
  address?: string;
  location?: { lat: number; lng: number };
  wheelchair_accessible?: boolean;
  stroller_accessible?: boolean;
  dietary_options: Record<string, unknown>;
  operating_hours: Record<string, unknown>;
  phone?: string;
  /** 0.0 ~ 1.0 */
  accessibility_score: number;
  last_verified_at?: string;
}

// ─── itinerary_items ────────────────────────────────────────────────────────
export interface ItineraryItem {
  item_id: string;
  course_id: string;
  place_id: string;
  place: Place;
  sequence_order: number;
  stay_duration_minutes: number;
  transport_mode: TransportMode;
  transport_duration_minutes?: number;
  notes?: string;
}

// ─── course_options ─────────────────────────────────────────────────────────
export interface CourseOption {
  course_id: string;
  plan_id: string;
  course_name: string;
  total_estimated_minutes?: number;
  ai_reasoning?: string;
  ai_model_used?: string;
  is_selected: boolean;
  items: ItineraryItem[];
  /** share-coordinator 가 채우는 투표 집계 (선택) */
  vote_summary?: { positive: number; negative: number };
}

// ─── ai_tasks ───────────────────────────────────────────────────────────────
export interface AiTask {
  task_id: string;
  plan_id: string;
  current_step: AiPipelineStep;
  status: AiTaskStatus;
  retry_count: number;
  step_results: Record<string, unknown>;
  last_error?: string | null;
  started_at?: string;
  updated_at?: string;
}

// ─── trips ──────────────────────────────────────────────────────────────────
export interface Trip {
  plan_id: string;
  creator_id: string;
  group_id: string | null;
  title: string;
  origin_address: string | null;
  origin_lat: number | null;
  origin_lng: number | null;
  radius_km: number;
  scheduled_date: string | null;
  duration_days: number;
  status: TripStatus;
  mood_tags: string[];
  additional_notes: string | null;
  share_token: string | null;
  consensus_deadline: string | null;
  started_at: string | null;
  credits_consumed: number;
  created_at: string;
  updated_at: string;
}

// ─── API: POST /api/planner/generate ────────────────────────────────────────
export interface GeneratePlanRequest {
  origin: {
    lat: number;
    lng: number;
    address: string;
  };
  /** 기본 20km, 최대 50km */
  radius_km: number;
  /** YYYY-MM-DD */
  scheduled_date: string;
  /** 1 ~ 3 */
  duration_days: number;
  group_id: string;
  mood_tags: string[];
  additional_notes?: string;
  /** trips.title 미지정 시 클라이언트가 보낼 수 있음 */
  title?: string;
}

export interface GeneratePlanResponse202 {
  plan_id: string;
  task_id: string;
  status: "PROCESSING";
  current_step: AiPipelineStep;
  /** 예상 완료 초 (UI 카운트다운용) */
  estimated_completion_sec: number;
  credits_consumed: number;
  credits_remaining: number;
  /** Supabase Realtime 채널명 */
  realtime_channel: string;
}

export interface CreditInsufficientError {
  error: {
    code: "CREDIT_INSUFFICIENT";
    details: {
      required: number;
      available: number;
    };
  };
}

export interface AiPipelineFailedError {
  error: {
    code: "AI_PIPELINE_FAILED";
    message?: string;
  };
}

// ─── UI 상태 ────────────────────────────────────────────────────────────────
export interface PlannerGenerateState {
  /** 요청 진행 중 */
  submitting: boolean;
  /** 202 응답 수신 후 Realtime 구독 중 */
  taskId: string | null;
  planId: string | null;
  currentStep: AiPipelineStep | null;
  status: AiTaskStatus | null;
  progress: number; // 0.0 ~ 1.0
  lastError: string | null;
}

// ─── mood_tags 프리셋 ───────────────────────────────────────────────────────
export const MOOD_TAG_PRESETS: readonly string[] = [
  "힐링",
  "체험",
  "맛집",
  "자연",
  "문화/예술",
  "쇼핑",
  "야경",
  "포토스팟",
  "조용함",
  "활기참",
] as const;
