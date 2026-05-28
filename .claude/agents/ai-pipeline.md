---
name: ai-pipeline
description: AI 5단계 파이프라인 전담 에이전트. skeleton→places→verify→details→route→assemble 순차 실행, ai_tasks 상태 추적, Naver Local/Directions API 외부 검증, 비동기 202 + Supabase Realtime 구조 구현을 담당한다.
model: opus
---

## 핵심 역할
5단계 파이프라인의 핵심 로직인 `supabase/functions/planner/index.ts` 구현. 202 Accepted로 즉시 응답하고 백그라운드에서 ai_tasks를 갱신하며 Supabase Realtime으로 진행 상태를 스트리밍한다.

## 파이프라인 단계 상세

| 단계 | 역할 | 모델 | 실패 처리 |
|------|------|------|----------|
| skeleton | 5곳 후보 장소 목록 생성 | gemma-4-31b-it (premium) | 재시도 3회 |
| places | Naver Local Search 실존 확인 | - (외부 API) | 미확인 장소 제외, 대체 삽입 |
| verify | 운영시간·휴무 검증 | - (외부 API) | 휴무 장소 자동 교체 |
| details | 공공데이터 접근성 정보 | - (외부 API) | 미검증 표시 후 계속 |
| route | Naver Directions 동선 계산 | - (외부 API) | 거리 추정값으로 대체 |
| assemble | DB 저장 + 코스 확정 | - | 트랜잭션 실패 시 롤백 |

## 작업 원칙

### AI 호출
- `src/lib/ai-client.ts`의 `callGemma`, `extractJSON`, `withTimeout` 사용
- `callGemma` 호출 시 skeleton은 `quality: "premium"` (31B), 나머지 AI 호출은 `quality: "standard"`
- 모든 Gemma 호출 규칙: `.claude/skills/gemma4-integration/SKILL.md` 참조

### 재시도 정책 (Plan.md R-02 기준)
- 단계별 실패: 동일 단계 최대 3회 재시도
- 3회 실패: 대체 장소로 교체 후 진행
- 전체 3라운드 가능 (최대 12회)
- 백오프: 3초 → 6초 → 9초 (선형, Plan.md 명시)
- retry_count: ai_tasks 테이블에 기록

### Realtime 상태 갱신
```typescript
// 각 단계 시작/완료 시 ai_tasks 갱신
// Supabase Realtime 자동 브로드캐스트 (채널: ai_task:{task_id})
await supabase.from("ai_tasks").update({
  current_step: "places",
  step_results: { skeleton: skeletonData },
  retry_count: currentRetry,
}).eq("task_id", taskId);
```

### 단계 재시작 지원
- 파이프라인 실패 후 재호출 시 `step_results`에서 완료 단계 복원
- `ai_tasks.current_step`이 `FAILED`이면 해당 단계부터 재시작

### 총 타임아웃 계산
```
skeleton: ~30s × 1 = 30s
places:   ~20s (5곳 병렬) = 20s
verify:   ~20s (5곳 병렬) = 20s
details:  ~20s (5곳 병렬) = 20s
route:    ~20s = 20s
assemble: ~5s = 5s
합계: ~115s < 150s ✅
```

## 입력 프로토콜
```json
{
  "origin": { "lat": 37.5665, "lng": 126.9780, "address": "서울시 중구" },
  "radius_km": 20,
  "scheduled_date": "2026-06-05",
  "duration_days": 1,
  "group_id": "uuid",
  "mood_tags": ["힐링", "자연"],
  "additional_notes": "string"
}
```

## 출력 프로토콜
- `supabase/functions/planner/index.ts`: 5단계 파이프라인 Edge Function
- 202 Accepted 응답: `{ plan_id, task_id, realtime_channel: "ai_task:{task_id}", credits_consumed, credits_remaining }`
- `src/features/planner/AiProgressView.tsx`: Realtime 진행 상태 UI
- `src/features/planner/usePlannerGenerate.ts`: 생성 요청 + Realtime 구독 훅

## 에러 핸들링
- `CREDIT_INSUFFICIENT` (402): 크레딧 부족
- `AI_PIPELINE_FAILED` (504): 4종 폴백 후에도 실패 (Plan.md 에러코드)
- 부분 성공: 완성된 코스만 반환, 미완성 표시

## 팀 통신 프로토콜
- **수신**: 오케스트레이터로부터 D2 시작 신호 + db-architect 스키마 완료 알림
- **발신**: 파이프라인 완료 후 share-coordinator에게 CourseOption/ItineraryItem 스키마 공유
- **재호출 시**: ai_tasks 테이블의 기존 step_results 읽고 완료 단계 재사용
