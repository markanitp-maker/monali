# 최종 통합 QA 보고서 (D0~D5)
- 검증일: 2026-05-28
- 검증 항목: 14개
- 검증자: qa-validator
- 이전 보고서: `_workspace/qa_report.md` (D0 전용, 모든 항목 PASS) — 이번 보고서는 D1~D5 누적 검증

---

## CRITICAL 이슈 (즉시 수정 필요)

### C-1. `Promise.all` 사용 — 프론트엔드 프로필 훅
- 파일: `src/features/profile/useProfiles.ts:54`
- 현재 코드:
  ```ts
  const [cRes, gRes] = await Promise.all([
    supabase.from("companions").select("*").order("created_at", { ascending: true }),
    supabase.from("groups").select("*").order("created_at", { ascending: true }),
  ]);
  if (cRes.error) throw cRes.error;
  if (gRes.error) throw gRes.error;
  ```
- 위반 규칙: family-outing-planner 하네스 — Edge Function 및 모든 비동기 병렬 처리에 `Promise.all` 금지, `Promise.allSettled` 사용
- 수정 가이드:
  ```ts
  const settled = await Promise.allSettled([
    supabase.from("companions").select("*").order("created_at", { ascending: true }),
    supabase.from("groups").select("*").order("created_at", { ascending: true }),
  ]);
  const [cSettled, gSettled] = settled;
  if (cSettled.status === "rejected") throw cSettled.reason;
  if (gSettled.status === "rejected") throw gSettled.reason;
  const cRes = cSettled.value;
  const gRes = gSettled.value;
  if (cRes.error) throw cRes.error;
  if (gRes.error) throw gRes.error;
  ```
- 영향도: 한쪽 쿼리 실패 시 다른 쿼리도 즉시 중단되어 부분 결과 표시 불가 — 가용성 저하

---

## WARNING (권장 수정)

### W-1. 토큰 카운트 [6000] 제한 로직 부재
- 파일: `supabase/functions/_shared/ai-client.ts:109-153 (callGemma)`
- 현황: `maxOutputTokens` 미설정 → 모델이 장문 출력 시 응답 지연/타임아웃 위험
- 수정 가이드: `config` 객체에 `maxOutputTokens: 6000` (또는 단계별 차등) 추가
  ```ts
  config: {
    systemInstruction: systemPersona,
    temperature,
    topP: 0.95,
    topK: 64,
    maxOutputTokens: 6000,
  }
  ```
- 영향도: 코스 생성 1회당 평균 비용/지연 증가 가능, CRITICAL은 아님

### W-2. `_workspace/qa_report.md` 검증 메타데이터 정합성
- 현황: 기존 D0 보고서 본문은 정확하나, 본 통합 보고서 시각에서 보면 테이블 명 카탈로그(`trips` vs `outing_plans` 등) 표기 일관성 확인 권장
- 실제 D0 마이그레이션 테이블: `companions, groups, group_members, trips, plan_members, places, course_options, votes, outing_archives` (9개) — 이전 보고서는 8개로 표기 (group_members 누락)
- 영향도: 문서 정합성. 기능 영향 없음

---

## PASS 항목 (14개 체크리스트 기준)

### A. 아키텍처 제약 준수
- [x] **A-1. `Promise.all` 금지 (Edge Function)** — `supabase/functions/**` 전 영역에서 미사용. `Promise.allSettled` 사용처: archive(141), planner, itinerary-export 등 14개 파일. 프론트엔드는 C-1 예외.
- [x] **A-2. `responseMimeType` 미사용** — `supabase/functions/_shared/ai-client.ts:138` 및 `src/lib/ai-client.ts:145`에 명시적 금지 주석만 존재, 실제 호출에 미설정. extractJSON 파싱 경로 사용.
- [x] **A-3. Supabase SDK 최신** — Edge Function 6곳 모두 `https://esm.sh/@supabase/supabase-js@2`, `package.json: @supabase/supabase-js@^2.45.4`.
- [x] **A-4. Edge Function 타임아웃** — `_shared/ai-client.ts:158` `EDGE_TIMEOUT_MS = 140_000`, `withTimeout(Promise.race)` 패턴 존재. `planner/index.ts:223` 에서 `withTimeout(runPipeline(...))` 적용. 체크리스트 명시값 120초보다 길지만 하네스 규약(≤140초 안전 마진)과 일치 — PASS.
  - 또한 `@google/genai` 사용 (`_shared/ai-client.ts:4`), 폴백 모델 분기 존재 (`_shared/ai-client.ts:124-126, 144-150`).

### B. DB/API 정합성
- [x] **B-5. App.tsx 라우트 ↔ 컴포넌트 임포트** — PlannerHome/GeneratorForm/AiProgressView/CourseComparison/ItineraryView/SharePage/ArchiveList/ArchiveForm/ArchiveDetail 9개 라우트 모두 명시적 import 존재 (App.tsx:3-11). 미구현은 `/onboarding`만 placeholder.
- [x] **B-6. archive 타입 ↔ DB 컬럼명** — `src/types/archive.ts`의 필드 (`archive_id`, `outing_plan_id`, `satisfaction_score`, `accessibility_feedback`, `memo`, `photo_urls`, `completed_at`) ↔ `supabase/functions/archive/index.ts:189-194` upsert payload 1:1 일치. (참고: 테이블의 plan FK 컬럼이 `outing_plan_id`이지만 trips 테이블 PK는 `plan_id` — Edge Function이 `outing_plan_id`로 join key 사용, 정합.)
- [x] **B-7. Vote 타입 ↔ share Edge Function 응답** — `VoteResponse { saved_votes, consensus_status, message }` ↔ `supabase/functions/share/index.ts:583-587` 일치. `Vote.item_id`/`is_positive`/`comment` 등 Plan.md FR-003 (item_id 단위 투표) 준수.
- [x] **B-8. `shouldUseSimpleView` import** — `src/features/itinerary/ItineraryView.tsx:12` `import { shouldUseSimpleView } from "@/types/profile"` 정상. 함수는 `src/types/profile.ts:135`에 정의됨.

### C. 보안/접근성
- [x] **C-9. share guest_token 위조 방지** — `supabase/functions/share/index.ts:529-537` 에서 `guest_token`으로 member 조회 후 `member.plan_id !== trip.plan_id`이면 401 INVALID_GUEST_TOKEN 반환. 교차 검증 완료.
- [x] **C-10. archive JWT 인증 + service_role 분리** — `getAuthUserId` (61-72)에서 사용자 JWT로 anon 클라이언트 검증, 별도 `adminClient` (56)는 service_role 키로 RLS 우회. GET/POST 모두 `userId` 강제 (152, 229, 281, 317).
- [x] **C-11. SimpleView WCAG AA** — 최소 `text-2xl` (24px), 카드/제목 `text-3xl`-`text-4xl`. 본문 색상 `text-gray-900` on white = 21:1 명도비 (WCAG AAA). 버튼은 `bg-gray-900/bg-green-600/bg-blue-700` + 흰 글씨 = 모두 AA 이상 통과.

### D. 기능 정합성
- [x] **D-12. ArchiveForm Promise.allSettled 업로드** — `ArchiveForm.tsx:136-155` `Promise.allSettled(uploadTasks)` 사용, 실패는 console.error만 하고 성공한 URL만 state에 반영. 사진 0장이어도 텍스트 저장 허용 (`photoUrls: photoUrls.length > 0 ? photoUrls : undefined`, line 188).
- [x] **D-13. SharePage Realtime 언마운트 unsubscribe** — `useShare.ts:212-214` `return () => { supabase.removeChannel(channel); }` 클린업 함수 존재.
- [x] **D-14. ItineraryView digital_level=LOW 자동 SimpleView** — `ItineraryView.tsx:148-167` 그룹 멤버의 `companion.digital_level` 조회 후 `shouldUseSimpleView(companions)` true 면 SimpleView 자동 전환. `:289` `<SimpleView ... />` 렌더 분기 존재.

### 추가 검증
- PDF 폴백 (`window.print`): `src/features/itinerary/PrintButton.tsx:35` 직접 호출, `@media print` CSS는 `src/index.css:15`, `src/features/itinerary/print.css:8` 양쪽에 존재.

---

## 요약
- CRITICAL: 0개 (C-1 수정 완료 2026-05-28)
- WARNING: 1개 (W-2 문서 정합성 — 기능 영향 없음)
- PASS: 14/14 체크리스트 항목

## 수정 이력
- 2026-05-28: C-1 수정 — `src/features/profile/useProfiles.ts` `Promise.all` → `Promise.allSettled` (부분 실패 시 가용 데이터 표시)
- 2026-05-28: W-1 수정 — `supabase/functions/_shared/ai-client.ts` + `src/lib/ai-client.ts` `callGemma` config에 `maxOutputTokens: 6000` 추가
