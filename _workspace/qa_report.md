# D0 DB 스키마 검증 보고서

- 검증일: 2026-05-28
- 대상 파일:
  - `supabase/migrations/001_initial_schema.sql`
  - `supabase/migrations/002_rls_policies.sql`
- 검증자: qa-validator

---

## 검증 항목 결과

### 1. 테이블 수 ↔ GRANT ALL 일치 (8개)
- 상태: ✅ PASS
- 테이블 8개:
  1. `member_profiles` (001:41)
  2. `outing_plans` (001:69)
  3. `plan_members` (001:103)
  4. `places` (001:133)
  5. `course_options` (001:172)
  6. `itinerary_items` (001:203)
  7. `votes` (001:234)
  8. `outing_archives` (001:260)
- `GRANT ALL ... TO anon, authenticated` 8회:
  - 001:63, 001:96, 001:128, 001:166, 001:196, 001:227, 001:254, 001:281
- 비고: 001 헤더 주석은 "9개 엔티티"라 적혀 있으나, User는 `auth.users` 외부 테이블이며 애플리케이션 테이블은 8개. 정상.

### 2. 모든 테이블에 ENABLE ROW LEVEL SECURITY
- 상태: ✅ PASS
- `ENABLE ROW LEVEL SECURITY` 8회: 001:62, 001:95, 001:127, 001:165, 001:195, 001:226, 001:253, 001:280

### 3. ENUM 타입 정의
- 상태: ✅ PASS
- 6개 모두 정의됨 (001:25–30):
  - `mobility_type` (001:25)
  - `dietary_type` (001:26)
  - `digital_literacy_level` (001:27)
  - `plan_status` (001:28)
  - `vote_value` (001:29)
  - `place_category` (001:30)

### 4. `share_token` UNIQUE 인덱스 (WHERE NOT NULL)
- 상태: ✅ PASS
- `idx_outing_plans_share_token` (001:92–93): `CREATE UNIQUE INDEX ... ON public.outing_plans(share_token) WHERE share_token IS NOT NULL;`

### 5. OutingArchive.outing_plan_id UNIQUE constraint
- 상태: ✅ PASS
- `idx_outing_archives_plan_id` (001:278): `CREATE UNIQUE INDEX ... ON public.outing_archives(outing_plan_id);` — 1:1 관계 보장.

### 6. votes (plan_member_id, course_option_id) UNIQUE
- 상태: ✅ PASS
- `idx_votes_member_option_unique` (001:250–251): `CREATE UNIQUE INDEX ... ON public.votes(plan_member_id, course_option_id);`

### 7. updated_at 트리거 함수 및 각 테이블 트리거
- 상태: ✅ PASS
- 함수 `public.update_updated_at_column()` 정의됨 (001:14–20)
- 8개 테이블에 BEFORE UPDATE 트리거 각각 부착:
  - 001:56 member_profiles
  - 001:86 outing_plans
  - 001:118 plan_members
  - 001:157 places
  - 001:189 course_options
  - 001:219 itinerary_items
  - 001:244 votes
  - 001:274 outing_archives

### 8. 비회원(anon) 접근 RLS 정책 (share_token 기반)
- 상태: ✅ PASS
- `share_token IS NOT NULL AND expires_at > NOW()` 조건의 anon 정책 다수 존재:
  - `outing_plans_share_read` (002:26–28) — SELECT
  - `plan_members_share_read` (002:48–57) — SELECT
  - `plan_members_guest_insert` (002:59–69) — INSERT (게스트 참여)
  - `course_options_share_read` (002:105–114) — SELECT
  - `itinerary_items_share_read` (002:138–149) — SELECT
  - `votes_share_read` (002:173–184) — SELECT
  - `votes_share_insert` (002:186–197) — INSERT
  - `votes_share_update` (002:199–220) — UPDATE
  - `places_read_all` (002:74–76) — SELECT (마스터 공개)

---

## 추가 관찰 사항 (참고)

- ⚠️ 경미 관찰 1: `001_initial_schema.sql` L5 주석 "9개 엔티티"는 User(auth.users)를 포함한 표현. 실제 생성 테이블은 8개로 일관성 있음. 주석 수정 권장이나 기능 영향 없음.
- ⚠️ 경미 관찰 2: `votes_share_insert`/`votes_share_update` 정책은 share_token만 검증하고 `plan_member_id` 가 해당 플랜의 멤버인지는 강제하지 않음. 비회원이 다른 플랜의 plan_member_id로 표를 던지는 시나리오는 앱 레벨 검증이 필요할 수 있음. 스키마 정합성 자체는 통과.
- ⚠️ 경미 관찰 3: `places` 테이블에 DELETE 정책이 없음 (마스터 데이터 보호로는 타당하지만 명시적 의도면 OK).

---

## 요약
- ✅ PASS: 8 / 8 (모든 필수 항목)
- ❌ CRITICAL: 0
- ⚠️ WARNING: 3 (모두 비차단성 관찰)
