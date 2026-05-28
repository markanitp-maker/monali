# Monali 데이터베이스 스키마

가족 나들이 플래너(Monali)의 Supabase PostgreSQL 스키마 문서입니다. 본 문서는 `supabase/migrations/001_initial_schema.sql` (Plan.md v1.0 기준) 의 실 스키마를 그대로 반영합니다.

- 마이그레이션 파일
  - `supabase/migrations/001_initial_schema.sql` (Extensions, ENUM, 15개 테이블, GRANT, RLS Enable)
  - `supabase/migrations/002_rls_policies.sql` (Row Level Security 정책)
  - `supabase/migrations/003_seed.sql` (시드 데이터)

---

## 0. Extensions

- `pgcrypto` — `gen_random_uuid()`
- `postgis` — `places.location GEOGRAPHY(POINT, 4326)` 공간 인덱스

---

## 1. ENUM 타입 (8종)

| ENUM 타입명 | 값 |
|---|---|
| `mobility_constraint_type` | `NONE`, `WHEELCHAIR`, `STROLLER`, `LIMITED` |
| `dietary_restriction_type` | `NONE`, `VEGETARIAN`, `VEGAN`, `HALAL`, `KOSHER`, `ALLERGY` |
| `digital_level_type` | `HIGH`, `MID`, `LOW` |
| `trip_status` | `PLANNING`, `AGREED`, `STARTED`, `COMPLETED`, `MISSED` |
| `ai_task_status` | `RUNNING`, `COMPLETED`, `FAILED`, `PAUSED` |
| `ai_pipeline_step` | `skeleton`, `places`, `verify`, `details`, `route`, `assemble` |
| `credit_source` | `BONUS`, `PURCHASE`, `SUBSCRIPTION`, `CONSUMPTION` |
| `subscription_status` | `ACTIVE`, `CANCELLED`, `EXPIRED`, `PAUSED` |

> ENUM 값은 모두 대문자(파이프라인 step 제외). 클라이언트/Edge Function에서도 동일한 대문자 문자열을 사용합니다.

---

## 2. 엔티티 관계 다이어그램

```
auth.users (Supabase Auth)
   │ 1:1
   ▼
profiles ──┬─ 1:N ─► companions ──┐
           │                       │ N:M (via group_members)
           ├─ 1:N ─► groups ──────┤
           │                       │
           ├─ 1:N ─► trips ◄──────┘ (group_id 옵션)
           │           │
           │           ├─ 1:N ─► ai_tasks
           │           ├─ 1:N ─► plan_members ─ 1:N ─► votes
           │           ├─ 1:N ─► course_options ─ 1:N ─► itinerary_items ─ N:1 ─► places
           │           │                                       │
           │           │                                       └─ 1:N ─► votes (item_id)
           │           └─ 1:1 ─► outing_archives
           │
           ├─ 1:N ─► subscriptions ─ N:1 ─► plans
           └─ 1:N ─► credit_transactions
```

핵심 카디널리티
- `profiles(1) → companions(N)` — `UNIQUE(user_id, name)`
- `profiles(1) → groups(N)`
- `groups(1) ↔ companions(N)` via `group_members` — `UNIQUE(group_id, companion_id)`
- `profiles(1) → trips(N)` (`trips.creator_id`)
- `trips(1) → course_options(N) → itinerary_items(N) → places(N:1)`
- `plan_members(1) → votes(N)` (`votes.item_id` 기준, `UNIQUE(member_id, item_id)`)

---

## 3. 테이블 상세 (총 15개)

### 3.1 `profiles`
회원(보호자) 본인. `auth.users` 와 1:1.

| 컬럼 | 타입 | 비고 |
|---|---|---|
| `user_id` | UUID PK FK→`auth.users` | ON DELETE CASCADE |
| `email` | VARCHAR(255) NOT NULL | |
| `nickname` | VARCHAR(50) | |
| `oauth_provider` | VARCHAR(20) | google, kakao 등 |
| `credit_balance` | INT NOT NULL DEFAULT 60 | 가입 보너스 60 크레딧 |
| `created_at` / `updated_at` | TIMESTAMPTZ | trigger 자동 갱신 |

### 3.2 `companions`
가족 구성원(동반자). 보호자가 등록한 가족 1인.

| 컬럼 | 타입 | 비고 |
|---|---|---|
| `profile_id` | UUID PK DEFAULT `gen_random_uuid()` | 컬럼명이 PK |
| `user_id` | UUID FK→`profiles.user_id` | NOT NULL, CASCADE |
| `name` | VARCHAR(50) NOT NULL | |
| `mobility_constraint` | `mobility_constraint_type` NOT NULL DEFAULT `'NONE'` | 단일 값 |
| `dietary_restriction` | `dietary_restriction_type` NOT NULL DEFAULT `'NONE'` | 단일 값 |
| `digital_level` | `digital_level_type` NOT NULL DEFAULT `'MID'` | Simple View 판단 |
| `preference_tags` | JSONB NOT NULL DEFAULT `'[]'` | 선호 태그 배열 |
| `allergies` | JSONB NOT NULL DEFAULT `'[]'` | 알러지 상세 배열 (예: `["땅콩","새우"]`) |
| `constraint_details` | JSONB NOT NULL DEFAULT `'{}'` | 추가 제약 메타데이터 |
| `created_at` / `updated_at` | TIMESTAMPTZ | trigger 자동 갱신 |

제약: `UNIQUE(user_id, name)` — 동일 보호자 내 동명이인 불가
인덱스: `idx_companions_user(user_id)`

### 3.3 `groups`
나들이 그룹(예: "친가 가족", "둘째네").

| 컬럼 | 타입 | 비고 |
|---|---|---|
| `group_id` | UUID PK | |
| `user_id` | UUID FK→`profiles.user_id` | NOT NULL, CASCADE |
| `name` | VARCHAR(100) NOT NULL | |
| `color` | VARCHAR(7) NOT NULL DEFAULT `'#3B82F6'` | Tailwind HEX |
| `created_at` / `updated_at` | TIMESTAMPTZ | |

인덱스: `idx_groups_user(user_id)`

### 3.4 `group_members`
그룹↔동반자 N:M 매핑.

| 컬럼 | 타입 | 비고 |
|---|---|---|
| `id` | UUID PK | |
| `group_id` | UUID FK→`groups.group_id` | NOT NULL, CASCADE |
| `companion_id` | UUID FK→`companions.profile_id` | NOT NULL, CASCADE |
| `created_at` | TIMESTAMPTZ | |

제약: `UNIQUE(group_id, companion_id)`
인덱스: `idx_group_members_group`, `idx_group_members_companion`

### 3.5 `plans` (구독 요금제 마스터)

| 컬럼 | 타입 | 비고 |
|---|---|---|
| `plan_master_id` | UUID PK | |
| `name` | VARCHAR(50) NOT NULL | |
| `monthly_price` | INT NOT NULL DEFAULT 0 | |
| `monthly_credits` | INT NOT NULL DEFAULT 0 | |
| `features` | JSONB NOT NULL DEFAULT `'{}'` | |
| `is_active` | BOOLEAN NOT NULL DEFAULT `true` | |
| `created_at` | TIMESTAMPTZ | |

### 3.6 `subscriptions`

| 컬럼 | 타입 | 비고 |
|---|---|---|
| `subscription_id` | UUID PK | |
| `user_id` | UUID FK→`profiles.user_id` | CASCADE |
| `plan_master_id` | UUID FK→`plans.plan_master_id` | |
| `status` | `subscription_status` NOT NULL DEFAULT `'ACTIVE'` | |
| `current_period_start` / `current_period_end` | TIMESTAMPTZ | |
| `toss_subscription_key` | VARCHAR(255) | TossPayments 빌링키 |
| `created_at` / `updated_at` | TIMESTAMPTZ | |

### 3.7 `credit_transactions`
크레딧 입출금 원장.

| 컬럼 | 타입 | 비고 |
|---|---|---|
| `transaction_id` | UUID PK | |
| `user_id` | UUID FK→`profiles.user_id` | CASCADE |
| `amount` | INT NOT NULL | +/- |
| `source` | `credit_source` NOT NULL | |
| `related_plan_id` | UUID | trip/구독 연관 |
| `balance_after` | INT NOT NULL | 거래 직후 잔액 |
| `memo` | VARCHAR(255) | |
| `created_at` | TIMESTAMPTZ | |

인덱스: `idx_credits_user_time(user_id, created_at DESC)`

### 3.8 `trips`
나들이 계획(이전 `outing_plans`).

| 컬럼 | 타입 | 비고 |
|---|---|---|
| `plan_id` | UUID PK | |
| `creator_id` | UUID FK→`profiles.user_id` | CASCADE |
| `group_id` | UUID FK→`groups.group_id` | NULLABLE, ON DELETE SET NULL |
| `title` | VARCHAR(200) NOT NULL | |
| `origin_address` | VARCHAR(500) | |
| `origin_lat` / `origin_lng` | DECIMAL(10,7) | |
| `radius_km` | INT NOT NULL DEFAULT 20 | |
| `scheduled_date` | DATE | |
| `duration_days` | INT NOT NULL DEFAULT 1 | |
| `status` | `trip_status` NOT NULL DEFAULT `'PLANNING'` | |
| `mood_tags` | JSONB NOT NULL DEFAULT `'[]'` | |
| `additional_notes` | TEXT | |
| `share_token` | VARCHAR(64) UNIQUE | NULL=비공유 |
| `consensus_deadline` | TIMESTAMPTZ | Silent Consent 마감 |
| `started_at` | TIMESTAMPTZ | |
| `credits_consumed` | INT NOT NULL DEFAULT 0 | |
| `created_at` / `updated_at` | TIMESTAMPTZ | |

인덱스: `idx_trips_creator_date`, `idx_trips_share_token (WHERE NOT NULL)`, `idx_trips_status`

### 3.9 `ai_tasks` (5단계 파이프라인 추적)

| 컬럼 | 타입 | 비고 |
|---|---|---|
| `task_id` | UUID PK | |
| `plan_id` | UUID FK→`trips.plan_id` | CASCADE |
| `current_step` | `ai_pipeline_step` | skeleton/places/verify/details/route/assemble |
| `status` | `ai_task_status` NOT NULL DEFAULT `'RUNNING'` | |
| `retry_count` | INT NOT NULL DEFAULT 0 | |
| `step_results` | JSONB NOT NULL DEFAULT `'{}'` | 단계별 산출물 캐시 |
| `last_error` | TEXT | |
| `started_at` / `updated_at` | TIMESTAMPTZ | |

인덱스: `idx_ai_tasks_plan(plan_id, updated_at DESC)`

### 3.10 `plan_members`
나들이 참여자(회원 동반자 또는 비회원 게스트).

| 컬럼 | 타입 | 비고 |
|---|---|---|
| `member_id` | UUID PK | |
| `plan_id` | UUID FK→`trips.plan_id` | CASCADE |
| `companion_id` | UUID FK→`companions.profile_id` | NULLABLE, SET NULL |
| `guest_name` | VARCHAR(50) | 비회원 표시 이름 |
| `guest_token` | UUID UNIQUE DEFAULT `gen_random_uuid()` | 비회원 접근 토큰 |
| `ip_hash` | CHAR(64) | SHA-256 IP 핫시 (중복 투표 방지) |
| `responded_at` | TIMESTAMPTZ | |
| `is_agreed` | BOOLEAN | 동의 여부 |
| `created_at` | TIMESTAMPTZ | |

### 3.11 `places` (PostGIS)

| 컬럼 | 타입 | 비고 |
|---|---|---|
| `place_id` | UUID PK | |
| `external_id` | VARCHAR(100) | Kakao/Google 외부 ID |
| `name` | VARCHAR(200) NOT NULL | |
| `category` | VARCHAR(50) | |
| `address` | VARCHAR(500) | |
| `location` | `GEOGRAPHY(POINT, 4326)` | GIST 인덱스 |
| `wheelchair_accessible` | BOOLEAN | |
| `stroller_accessible` | BOOLEAN | |
| `dietary_options` | JSONB NOT NULL DEFAULT `'{}'` | |
| `operating_hours` | JSONB NOT NULL DEFAULT `'{}'` | |
| `phone` | VARCHAR(20) | |
| `accessibility_score` | DECIMAL(3,2) NOT NULL DEFAULT 0.50 | |
| `last_verified_at` | TIMESTAMPTZ | |
| `created_at` / `updated_at` | TIMESTAMPTZ | |

인덱스: `idx_places_location` (GIST), `idx_places_external (WHERE NOT NULL)`

### 3.12 `course_options`
AI가 제시한 코스 후보(보통 3개).

| 컬럼 | 타입 | 비고 |
|---|---|---|
| `course_id` | UUID PK | |
| `plan_id` | UUID FK→`trips.plan_id` | CASCADE |
| `course_name` | VARCHAR(200) NOT NULL | |
| `total_estimated_minutes` | INT | |
| `ai_reasoning` | TEXT | |
| `ai_model_used` | VARCHAR(50) | gemma-3-4b 등 |
| `is_selected` | BOOLEAN NOT NULL DEFAULT `false` | |
| `created_at` | TIMESTAMPTZ | |

### 3.13 `itinerary_items`
코스를 구성하는 개별 방문 지점.

| 컬럼 | 타입 | 비고 |
|---|---|---|
| `item_id` | UUID PK | |
| `course_id` | UUID FK→`course_options.course_id` | CASCADE |
| `place_id` | UUID FK→`places.place_id` | |
| `sequence_order` | INT NOT NULL | 1, 2, 3... |
| `stay_duration_minutes` | INT NOT NULL DEFAULT 60 | |
| `transport_mode` | VARCHAR(20) NOT NULL DEFAULT `'car'` | car/public/walk |
| `transport_duration_minutes` | INT | |
| `notes` | TEXT | |

제약: `UNIQUE(course_id, sequence_order)`

### 3.14 `votes` (장소별 찬반)
**투표 기준은 `item_id`**(코스 내 개별 장소). Silent Consent 알고리즘 입력.

| 컬럼 | 타입 | 비고 |
|---|---|---|
| `vote_id` | UUID PK | |
| `member_id` | UUID FK→`plan_members.member_id` | CASCADE |
| `course_id` | UUID FK→`course_options.course_id` | CASCADE |
| `item_id` | UUID FK→`itinerary_items.item_id` | CASCADE |
| `is_positive` | BOOLEAN NOT NULL | |
| `comment` | TEXT | |
| `created_at` / `updated_at` | TIMESTAMPTZ | |

제약: `UNIQUE(member_id, item_id)` — 1인 1장소 1표

### 3.15 `outing_archives`
나들이 완료 후 회고/아카이브.

| 컬럼 | 타입 | 비고 |
|---|---|---|
| `archive_id` | UUID PK | |
| `plan_id` | UUID FK→`trips.plan_id` UNIQUE | 1:1 |
| `overall_score` | DECIMAL(2,1) | 1.0~5.0 |
| `actual_visited_places` | JSONB NOT NULL DEFAULT `'[]'` | |
| `accessibility_feedback` | JSONB NOT NULL DEFAULT `'[]'` | |
| `memo` | TEXT | |
| `photos` | JSONB NOT NULL DEFAULT `'[]'` | URL 배열 |
| `completed_at` | TIMESTAMPTZ | |
| `created_at` / `updated_at` | TIMESTAMPTZ | |

---

## 4. GRANT & RLS

- 15개 테이블 모두 `GRANT ALL ... TO anon, authenticated`
- `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated`
- 15개 테이블 모두 `ENABLE ROW LEVEL SECURITY` (정책은 `002_rls_policies.sql`)

---

## 5. updated_at 자동 갱신 트리거

`update_updated_at_column()` PL/pgSQL 함수를 `BEFORE UPDATE` 트리거로 다음 테이블에 부착:
`profiles`, `companions`, `groups`, `subscriptions`, `trips`, `ai_tasks`, `places`, `votes`, `outing_archives`
