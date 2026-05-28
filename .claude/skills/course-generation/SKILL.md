---
name: course-generation
description: AI 5단계 파이프라인(skeleton→places→verify→details→route→assemble)으로 가족 제약 기반 무장애 나들이 코스를 비동기 생성한다. POST /api/planner/generate(202 Accepted + Realtime), ai_tasks 상태 추적, Naver Local/Directions API 검증, 코스 생성/편집 UI 작업 시 반드시 이 스킬을 사용할 것. Gemma 호출 상세는 gemma4-integration 스킬을 함께 읽을 것.
---

## AI 호출 원칙

**모든 Gemma 호출은 `.claude/skills/gemma4-integration/SKILL.md` 기준을 따른다.**
- `@google/genai` SDK만 사용
- `extractJSON()` 으로 JSON 파싱 (`responseMimeType` 금지)
- `Promise.allSettled` 병렬 처리
- `callWithBackoff` + `RateLimiter`
- `src/lib/ai-client.ts` 의 `callGemma`, `extractJSON`, `withTimeout` 사용

## 5단계 파이프라인 (비동기 202 + Realtime)

```
POST /api/planner/generate
  → 202 Accepted { plan_id, task_id, realtime_channel }
  → ai_tasks.current_step 순차 갱신
  → Supabase Realtime 채널: "ai_task:{task_id}"

단계:
  skeleton  → AI가 5곳 후보 장소 목록 생성 (31B premium)
  places    → Naver Local Search로 장소 실존 확인
  verify    → 운영시간·휴무일 검증 (폐업 시 자동 교체)
  details   → 공공데이터포털 접근성 정보 조회
  route     → Naver Directions API 동선 계산
  assemble  → course_options + itinerary_items DB 저장
```

## ai_tasks 상태 관리

```typescript
// 단계 시작 시
await supabase.from("ai_tasks").update({
  current_step: "places",
  step_results: { ...prev, skeleton: skeletonResult },
}).eq("task_id", taskId);

// 실패 시 재시작 가능 — step_results에서 완료된 단계 복원
const { data: task } = await supabase
  .from("ai_tasks")
  .select("current_step, step_results, retry_count")
  .eq("plan_id", planId)
  .order("updated_at", { ascending: false })
  .limit(1)
  .single();

// 이미 완료된 단계는 step_results에서 복원
const skeletonResult = task.step_results.skeleton ?? await runSkeleton();
```

## 재시도 정책 (Plan.md R-02)

- 단계별 실패 시 동일 단계 재시도 (최대 3회)
- 3회 실패 시 대체 장소로 교체 후 계속
- 전체 3라운드 가능 (최대 12회 재시도)
- 백오프: 3초 → 6초 → 9초 (지수 아닌 선형, Plan.md 명시)

## 크레딧 차감

```typescript
// duration_days × 30 크레딧
const creditsRequired = tripData.duration_days * 30;

// 잔액 확인 후 차감
const { data: profile } = await supabase
  .from("profiles")
  .select("credit_balance")
  .eq("user_id", userId)
  .single();

if (profile.credit_balance < creditsRequired) {
  return Response.json({ error: { code: "CREDIT_INSUFFICIENT",
    details: { required: creditsRequired, available: profile.credit_balance }
  }}, { status: 402 });
}
```

## Naver API 연동 (외부 검증)

```typescript
// Naver Local Search — 장소 실존 확인
const verifyPlace = async (placeName: string, address: string) => {
  const url = `https://openapi.naver.com/v1/search/local.json?query=${encodeURIComponent(placeName)}`;
  const res = await fetch(url, {
    headers: {
      "X-Naver-Client-Id": Deno.env.get("NAVER_CLIENT_ID")!,
      "X-Naver-Client-Secret": Deno.env.get("NAVER_CLIENT_SECRET")!,
    },
  });
  return res.json();
};

// 병렬 검증 — Promise.allSettled 필수
const verifyResults = await Promise.allSettled(
  candidates.map(p => verifyPlace(p.name, p.address))
);
```

## 타입 정의 (src/types/course.ts)

```typescript
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
  accessibility_score: number;   // 0.0~1.0
  last_verified_at?: string;
}

export interface ItineraryItem {
  item_id: string;
  course_id: string;
  place_id: string;
  place: Place;
  sequence_order: number;
  stay_duration_minutes: number;
  transport_mode: "walk" | "car" | "public";
  transport_duration_minutes?: number;
}

export interface CourseOption {
  course_id: string;
  plan_id: string;
  course_name: string;
  total_estimated_minutes?: number;
  ai_reasoning?: string;
  ai_model_used?: string;
  is_selected: boolean;
  items: ItineraryItem[];
  vote_summary?: { positive: number; negative: number };
}

export interface AiTask {
  task_id: string;
  plan_id: string;
  current_step: "skeleton" | "places" | "verify" | "details" | "route" | "assemble";
  status: "RUNNING" | "COMPLETED" | "FAILED" | "PAUSED";
  retry_count: number;
  step_results: Record<string, unknown>;
}
```

## React 컴포넌트 구조

```
src/features/planner/
├── PlannerHome.tsx          # 플래너 홈 (최근 일정 + 신규 생성)
├── GeneratorForm.tsx        # 코스 생성 요청 폼
├── AiProgressView.tsx       # Realtime 진행 상태 (단계별 표시)
├── CourseCard.tsx           # 코스 후보 카드
├── CourseComparison.tsx     # 코스 나란히 비교
└── usePlannerGenerate.ts    # 생성 요청 + Realtime 구독 훅
```

## 상세 참조
- Gemma 호출 패턴: `.claude/skills/gemma4-integration/SKILL.md`
- AI 프롬프트 템플릿: `references/ai-prompts.md`
- 타임아웃 계산: gemma4-integration §10
