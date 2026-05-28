---
name: family-outing-planner
description: AI 맞춤형 가족 나들이 플래너 전체 개발을 조율하는 오케스트레이터. DB 스키마부터 프로필 관리, AI 코스 설계(5단계 비동기 파이프라인), 비회원 투표(Silent Consent), 일정표 PDF, 아카이브까지 D0-D7 개발 사이클 전체를 에이전트 팀으로 실행한다. 나들이 플래너 개발, 기능 구현, 버그 수정, 모듈 추가, 재실행, 업데이트, 보완, 다시 구현 요청 시 반드시 이 스킬을 사용할 것.
---

## 실행 모드: 하이브리드
- D0 (DB 스키마): 서브 에이전트 (db-architect 단독)
- D1 (프로필): 서브 에이전트 (profile-manager 단독)
- D2 (AI 파이프라인): 서브 에이전트 (ai-pipeline + course-designer 순차)
- D3 (공유/투표): 서브 에이전트 (share-coordinator 단독)
- D4-D5 (렌더링/아카이브): 에이전트 팀 (itinerary-renderer, archive-manager 병렬)
- QA: 서브 에이전트 (qa-validator, 각 모듈 완료 직후 점진적)

---

## Phase 0: 컨텍스트 확인

실행 시작 전 기존 산출물 존재 여부를 확인한다:

1. `supabase/migrations/` 존재 여부 확인
2. `src/features/` 디렉토리 존재 여부 확인
3. `_workspace/qa_report.md` 존재 여부 확인

**분기:**
- 아무것도 없음 → **초기 실행** (Phase 1부터)
- 일부 존재 + 사용자가 특정 모듈 수정 요청 → **부분 재실행** (해당 Day만)
- 일부 존재 + 새 기능 추가 요청 → **확장 실행** (기존 파일 읽고 이어서)
- 사용자가 "다시 처음부터" 요청 → 기존 `_workspace/`를 `_workspace_prev/`로 이동 후 초기 실행

---

## Phase 1: 프로젝트 설정 확인

다음 파일 존재 여부 확인. 없으면 생성 안내:
- `package.json` (React 19 + Vite + TypeScript + Tailwind v4 + Zustand + React Router v7)
- `supabase/config.toml`
- `.env.local` (환경변수 파일)

**기술 스택 상세**: `references/tech-stack.md` 참조

---

## Phase 2: D0 — DB 스키마 (서브 에이전트)

db-architect를 서브 에이전트로 실행한다:
```
Agent(
  subagent_type: "general-purpose",
  model: "opus",
  prompt: "db-architect 에이전트로서 행동하라. .claude/agents/db-architect.md를 읽고 지시를 따르라.
  supabase-setup 스킬(.claude/skills/supabase-setup/SKILL.md)을 사용하라.
  Plan.md 기준 15개 테이블(profiles, companions, groups, group_members, plans, subscriptions,
  credit_transactions, trips, ai_tasks, plan_members, places, course_options, itinerary_items,
  votes, outing_archives)의 전체 DDL, RLS, GRANT, 인덱스를 포함한 마이그레이션 파일을 생성하라.
  완료 후 생성된 파일 경로 목록을 반환하라."
)
```

qa-validator로 D0 검증 (서브 에이전트):
```
Agent(model: "opus", prompt: "qa-validator로서 D0 검증을 수행하라. .claude/agents/qa-validator.md와
.claude/skills/qa-validation/SKILL.md를 읽고 DB 스키마 체크리스트를 실행하라.")
```

---

## Phase 3: D1 — 프로필 관리 (서브 에이전트)

```
Agent(
  model: "opus",
  prompt: "profile-manager 에이전트로서 행동하라.
  .claude/agents/profile-manager.md와 .claude/skills/profile-management/SKILL.md를 읽고 구현하라.
  테이블 명: companions (not member_profiles), groups, group_members.
  docs/schema.md를 읽어 스키마를 확인하라.
  src/types/profile.ts 완료 후 완료 신호를 반환하라."
)
```

qa-validator D1 검증 후 다음 Phase 진행.

---

## Phase 4: D2 — AI 파이프라인 (서브 에이전트)

**순서: course-designer(인터페이스) → ai-pipeline(파이프라인 로직)**

1. course-designer 시작:
```
Agent(
  model: "opus",
  prompt: "course-designer 에이전트로서 행동하라.
  .claude/agents/course-designer.md와 .claude/skills/course-generation/SKILL.md를 읽고 구현하라.
  .claude/skills/gemma4-integration/SKILL.md의 Gemma 호출 규칙을 반드시 따르라.
  202 Accepted + Supabase Realtime 비동기 패턴으로 구현하라.
  src/types/profile.ts를 읽어 Companion 타입을 확인하라.
  src/types/course.ts 완료 후 완료 신호를 반환하라."
)
```

2. ai-pipeline 시작 (course-designer 완료 후):
```
Agent(
  model: "opus",
  prompt: "ai-pipeline 에이전트로서 행동하라.
  .claude/agents/ai-pipeline.md와 .claude/skills/course-generation/SKILL.md를 읽고 구현하라.
  .claude/skills/gemma4-integration/SKILL.md의 Gemma 호출 규칙을 반드시 따르라.
  src/lib/ai-client.ts를 읽고 callGemma, extractJSON, withTimeout을 사용하라.
  skeleton 단계: quality='premium'(31B), 나머지 AI 호출: quality='standard'.
  Promise.allSettled 필수, Promise.all 금지.
  supabase/functions/planner/index.ts 완료 후 완료 신호를 반환하라."
)
```

qa-validator D2 검증.

---

## Phase 5: D3 — 공유/투표 (서브 에이전트)

```
Agent(
  model: "opus",
  prompt: "share-coordinator 에이전트로서 행동하라.
  .claude/agents/share-coordinator.md와 .claude/skills/share-voting/SKILL.md를 읽고 구현하라.
  투표 단위: item_id(장소) 기준 (course_option 아님).
  consensus_deadline + Silent Consent 자동 동의 처리를 반드시 포함하라.
  ip_hash rate limiting 포함하라.
  src/types/course.ts를 읽어 ItineraryItem 타입을 확인하라."
)
```

qa-validator D3 검증.

---

## Phase 6: D4-D5 — 렌더링 & 아카이브 (에이전트 팀)

D3 완료 후 병렬 시작:

```
Agent(model: "opus", prompt: "itinerary-renderer 에이전트로서 행동하라.
.claude/agents/itinerary-renderer.md와 .claude/skills/itinerary-export/SKILL.md를 읽고 구현하라.
SimpleView.tsx를 ItineraryView.tsx와 완전히 분리된 파일로 생성하라.
digital_level='low' 구성원이 있으면 SimpleView 자동 선택하라.")

Agent(model: "opus", prompt: "archive-manager 에이전트로서 행동하라.
.claude/agents/archive-manager.md와 .claude/skills/archive/SKILL.md를 읽고 구현하라.
피드백 루프(places.accessibility_score 업데이트)를 반드시 포함하라.",
run_in_background: true)
```

---

## Phase 7: D7 — 최종 QA

```
Agent(model: "opus", prompt: "qa-validator 에이전트로서 최종 통합 QA를 수행하라.
.claude/agents/qa-validator.md와 .claude/skills/qa-validation/SKILL.md를 읽고
전체 체크리스트를 실행하라. _workspace/qa_report.md를 생성하라.")
```

QA 리포트의 CRITICAL 이슈는 해당 에이전트를 재호출하여 수정 후 재검증.

---

## 데이터 전달 경로

```
db-architect
  └─ docs/schema.md (15 테이블)
       └─ profile-manager → src/types/profile.ts (Companion, Group)
            └─ course-designer → src/types/course.ts (CourseOption, ItineraryItem)
                 │── ai-pipeline → supabase/functions/planner/index.ts
                 └─ share-coordinator → src/types/share.ts (Vote, PlanMember)
                      ├── itinerary-renderer (src/types/course.ts 참조)
                      └── archive-manager (src/types/course.ts 참조)

_workspace/qa_report.md ← qa-validator (각 단계 후 갱신)
```

---

## 에러 핸들링

- 에이전트 실패 시: 1회 재시도, 재실패 시 해당 모듈 누락으로 진행 (리포트에 명시)
- CRITICAL QA 이슈: 해당 에이전트 재호출, 수정 확인 후 다음 Phase 진행
- 타임아웃: qa_report.md에 미완료 항목 기록

---

## 테스트 시나리오

### 정상 흐름
1. "나들이 플래너 개발 시작해줘" → Phase 0~7 전체 실행
2. "AI 코스 생성 엔진만 다시 구현해줘" → Phase 0(컨텍스트 확인) → D2만 재실행
3. "비회원 투표 페이지 UI 수정해줘" → share-coordinator 단독 재호출

### 에러 흐름
1. ai-pipeline 실패 → 1회 재시도 → 실패 시 qa_report.md에 "D2 ai-pipeline 미완료" 기록 후 D3 진행
2. QA에서 CRITICAL 발견 → 해당 에이전트 수정 요청 → 재검증

---

## 상세 참조
- 기술 스택 및 아키텍처 제약: `references/tech-stack.md`
- Gemma 호출 규칙: `.claude/skills/gemma4-integration/SKILL.md`
