-- ======================================================
-- 001_initial_schema.sql
-- 모두의 나들이 (Monali) — Plan.md v1.0 기준
-- 15개 테이블 + PostGIS + ENUM 8종 + GRANT + RLS Enable
-- ======================================================

-- 1. Extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "postgis";

-- ======================================================
-- 2. ENUM 타입
-- ======================================================
CREATE TYPE public.mobility_constraint_type AS ENUM ('NONE', 'WHEELCHAIR', 'STROLLER', 'LIMITED');
CREATE TYPE public.dietary_restriction_type AS ENUM ('NONE', 'VEGETARIAN', 'VEGAN', 'HALAL', 'KOSHER', 'ALLERGY');
CREATE TYPE public.digital_level_type       AS ENUM ('HIGH', 'MID', 'LOW');
CREATE TYPE public.trip_status              AS ENUM ('PLANNING', 'AGREED', 'STARTED', 'COMPLETED', 'MISSED');
CREATE TYPE public.ai_task_status           AS ENUM ('RUNNING', 'COMPLETED', 'FAILED', 'PAUSED');
CREATE TYPE public.ai_pipeline_step         AS ENUM ('skeleton', 'places', 'verify', 'details', 'route', 'assemble');
CREATE TYPE public.credit_source            AS ENUM ('BONUS', 'PURCHASE', 'SUBSCRIPTION', 'CONSUMPTION');
CREATE TYPE public.subscription_status      AS ENUM ('ACTIVE', 'CANCELLED', 'EXPIRED', 'PAUSED');

-- ======================================================
-- 3. updated_at 자동 갱신 함수
-- ======================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ======================================================
-- 4. 테이블 (의존 관계 순)
-- ======================================================

-- 4.1 profiles
CREATE TABLE public.profiles (
  user_id        UUID         PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email          VARCHAR(255) NOT NULL,
  nickname       VARCHAR(50),
  oauth_provider VARCHAR(20),
  credit_balance INT          NOT NULL DEFAULT 60,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 4.2 companions
CREATE TABLE public.companions (
  profile_id          UUID                              PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID                              NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  name                VARCHAR(50)                       NOT NULL,
  mobility_constraint public.mobility_constraint_type  NOT NULL DEFAULT 'NONE',
  dietary_restriction public.dietary_restriction_type  NOT NULL DEFAULT 'NONE',
  digital_level       public.digital_level_type        NOT NULL DEFAULT 'MID',
  preference_tags     JSONB                             NOT NULL DEFAULT '[]',
  allergies           JSONB                             NOT NULL DEFAULT '[]',
  constraint_details  JSONB                             NOT NULL DEFAULT '{}',
  created_at          TIMESTAMPTZ                       NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ                       NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, name)
);
CREATE TRIGGER trg_companions_updated_at
  BEFORE UPDATE ON public.companions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE INDEX idx_companions_user ON public.companions(user_id);

-- 4.3 groups
CREATE TABLE public.groups (
  group_id   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID         NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  name       VARCHAR(100) NOT NULL,
  color      VARCHAR(7)   NOT NULL DEFAULT '#3B82F6',
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE TRIGGER trg_groups_updated_at
  BEFORE UPDATE ON public.groups FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE INDEX idx_groups_user ON public.groups(user_id);

-- 4.4 group_members
CREATE TABLE public.group_members (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id     UUID        NOT NULL REFERENCES public.groups(group_id) ON DELETE CASCADE,
  companion_id UUID        NOT NULL REFERENCES public.companions(profile_id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(group_id, companion_id)
);
CREATE INDEX idx_group_members_group     ON public.group_members(group_id);
CREATE INDEX idx_group_members_companion ON public.group_members(companion_id);

-- 4.5 plans (구독 요금제 마스터)
CREATE TABLE public.plans (
  plan_master_id  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name            VARCHAR(50)  NOT NULL,
  monthly_price   INT          NOT NULL DEFAULT 0,
  monthly_credits INT          NOT NULL DEFAULT 0,
  features        JSONB        NOT NULL DEFAULT '{}',
  is_active       BOOLEAN      NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- 4.6 subscriptions
CREATE TABLE public.subscriptions (
  subscription_id       UUID                        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID                        NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  plan_master_id        UUID                        NOT NULL REFERENCES public.plans(plan_master_id),
  status                public.subscription_status  NOT NULL DEFAULT 'ACTIVE',
  current_period_start  TIMESTAMPTZ,
  current_period_end    TIMESTAMPTZ,
  toss_subscription_key VARCHAR(255),
  created_at            TIMESTAMPTZ                 NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ                 NOT NULL DEFAULT NOW()
);
CREATE TRIGGER trg_subscriptions_updated_at
  BEFORE UPDATE ON public.subscriptions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE INDEX idx_subscriptions_user ON public.subscriptions(user_id);

-- 4.7 credit_transactions
CREATE TABLE public.credit_transactions (
  transaction_id  UUID                 PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID                 NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  amount          INT                  NOT NULL,
  source          public.credit_source NOT NULL,
  related_plan_id UUID,
  balance_after   INT                  NOT NULL,
  memo            VARCHAR(255),
  created_at      TIMESTAMPTZ          NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_credits_user_time ON public.credit_transactions(user_id, created_at DESC);

-- 4.8 trips
CREATE TABLE public.trips (
  plan_id            UUID               PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id         UUID               NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  group_id           UUID               REFERENCES public.groups(group_id) ON DELETE SET NULL,
  title              VARCHAR(200)       NOT NULL,
  origin_address     VARCHAR(500),
  origin_lat         DECIMAL(10, 7),
  origin_lng         DECIMAL(10, 7),
  radius_km          INT                NOT NULL DEFAULT 20,
  scheduled_date     DATE,
  duration_days      INT                NOT NULL DEFAULT 1,
  status             public.trip_status NOT NULL DEFAULT 'PLANNING',
  mood_tags          JSONB              NOT NULL DEFAULT '[]',
  additional_notes   TEXT,
  share_token        VARCHAR(64)        UNIQUE,
  consensus_deadline TIMESTAMPTZ,
  started_at         TIMESTAMPTZ,
  credits_consumed   INT                NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ        NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ        NOT NULL DEFAULT NOW()
);
CREATE TRIGGER trg_trips_updated_at
  BEFORE UPDATE ON public.trips FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE INDEX idx_trips_creator_date  ON public.trips(creator_id, scheduled_date DESC);
CREATE UNIQUE INDEX idx_trips_share_token ON public.trips(share_token) WHERE share_token IS NOT NULL;
CREATE INDEX idx_trips_status        ON public.trips(status);

-- 4.9 ai_tasks (5단계 파이프라인 추적)
CREATE TABLE public.ai_tasks (
  task_id      UUID                     PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id      UUID                     NOT NULL REFERENCES public.trips(plan_id) ON DELETE CASCADE,
  current_step public.ai_pipeline_step,
  status       public.ai_task_status    NOT NULL DEFAULT 'RUNNING',
  retry_count  INT                      NOT NULL DEFAULT 0,
  step_results JSONB                    NOT NULL DEFAULT '{}',
  last_error   TEXT,
  started_at   TIMESTAMPTZ              NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ              NOT NULL DEFAULT NOW()
);
CREATE TRIGGER trg_ai_tasks_updated_at
  BEFORE UPDATE ON public.ai_tasks FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE INDEX idx_ai_tasks_plan ON public.ai_tasks(plan_id, updated_at DESC);

-- 4.10 plan_members
CREATE TABLE public.plan_members (
  member_id    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id      UUID        NOT NULL REFERENCES public.trips(plan_id) ON DELETE CASCADE,
  companion_id UUID        REFERENCES public.companions(profile_id) ON DELETE SET NULL,
  guest_name   VARCHAR(50),
  guest_token  UUID        NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  ip_hash      CHAR(64),
  responded_at TIMESTAMPTZ,
  is_agreed    BOOLEAN,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_plan_members_plan      ON public.plan_members(plan_id);
CREATE INDEX idx_plan_members_companion ON public.plan_members(companion_id) WHERE companion_id IS NOT NULL;

-- 4.11 places (PostGIS)
CREATE TABLE public.places (
  place_id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id           VARCHAR(100),
  name                  VARCHAR(200)  NOT NULL,
  category              VARCHAR(50),
  address               VARCHAR(500),
  location              GEOGRAPHY(POINT, 4326),
  wheelchair_accessible BOOLEAN,
  stroller_accessible   BOOLEAN,
  dietary_options       JSONB         NOT NULL DEFAULT '{}',
  operating_hours       JSONB         NOT NULL DEFAULT '{}',
  phone                 VARCHAR(20),
  accessibility_score   DECIMAL(3, 2) NOT NULL DEFAULT 0.50,
  last_verified_at      TIMESTAMPTZ,
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE TRIGGER trg_places_updated_at
  BEFORE UPDATE ON public.places FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE INDEX idx_places_location ON public.places USING GIST(location);
CREATE INDEX idx_places_external ON public.places(external_id) WHERE external_id IS NOT NULL;

-- 4.12 course_options
CREATE TABLE public.course_options (
  course_id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id                 UUID         NOT NULL REFERENCES public.trips(plan_id) ON DELETE CASCADE,
  course_name             VARCHAR(200) NOT NULL,
  total_estimated_minutes INT,
  ai_reasoning            TEXT,
  ai_model_used           VARCHAR(50),
  is_selected             BOOLEAN      NOT NULL DEFAULT false,
  created_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_course_options_plan ON public.course_options(plan_id);

-- 4.13 itinerary_items
CREATE TABLE public.itinerary_items (
  item_id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id                  UUID        NOT NULL REFERENCES public.course_options(course_id) ON DELETE CASCADE,
  place_id                   UUID        NOT NULL REFERENCES public.places(place_id),
  sequence_order             INT         NOT NULL,
  stay_duration_minutes      INT         NOT NULL DEFAULT 60,
  transport_mode             VARCHAR(20) NOT NULL DEFAULT 'car',
  transport_duration_minutes INT,
  notes                      TEXT,
  UNIQUE(course_id, sequence_order)
);
CREATE INDEX idx_items_course ON public.itinerary_items(course_id);
CREATE INDEX idx_items_place  ON public.itinerary_items(place_id);

-- 4.14 votes (장소별 찬반 — item_id 기준)
CREATE TABLE public.votes (
  vote_id     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id   UUID        NOT NULL REFERENCES public.plan_members(member_id) ON DELETE CASCADE,
  course_id   UUID        NOT NULL REFERENCES public.course_options(course_id) ON DELETE CASCADE,
  item_id     UUID        NOT NULL REFERENCES public.itinerary_items(item_id) ON DELETE CASCADE,
  is_positive BOOLEAN     NOT NULL,
  comment     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(member_id, item_id)
);
CREATE TRIGGER trg_votes_updated_at
  BEFORE UPDATE ON public.votes FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE INDEX idx_votes_member ON public.votes(member_id);
CREATE INDEX idx_votes_item   ON public.votes(item_id);
CREATE INDEX idx_votes_course ON public.votes(course_id);

-- 4.15 outing_archives
CREATE TABLE public.outing_archives (
  archive_id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id                UUID          NOT NULL REFERENCES public.trips(plan_id) ON DELETE CASCADE UNIQUE,
  overall_score          DECIMAL(2, 1),
  actual_visited_places  JSONB         NOT NULL DEFAULT '[]',
  accessibility_feedback JSONB         NOT NULL DEFAULT '[]',
  memo                   TEXT,
  photos                 JSONB         NOT NULL DEFAULT '[]',
  completed_at           TIMESTAMPTZ,
  created_at             TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE TRIGGER trg_outing_archives_updated_at
  BEFORE UPDATE ON public.outing_archives FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE INDEX idx_archives_plan ON public.outing_archives(plan_id);

-- ======================================================
-- 5. GRANT ALL — 15개 테이블
-- ======================================================
GRANT ALL ON public.profiles            TO anon, authenticated;
GRANT ALL ON public.companions          TO anon, authenticated;
GRANT ALL ON public.groups              TO anon, authenticated;
GRANT ALL ON public.group_members       TO anon, authenticated;
GRANT ALL ON public.plans               TO anon, authenticated;
GRANT ALL ON public.subscriptions       TO anon, authenticated;
GRANT ALL ON public.credit_transactions TO anon, authenticated;
GRANT ALL ON public.trips               TO anon, authenticated;
GRANT ALL ON public.ai_tasks            TO anon, authenticated;
GRANT ALL ON public.plan_members        TO anon, authenticated;
GRANT ALL ON public.places              TO anon, authenticated;
GRANT ALL ON public.course_options      TO anon, authenticated;
GRANT ALL ON public.itinerary_items     TO anon, authenticated;
GRANT ALL ON public.votes               TO anon, authenticated;
GRANT ALL ON public.outing_archives     TO anon, authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;

-- ======================================================
-- 6. RLS ENABLE — 15개 테이블
-- ======================================================
ALTER TABLE public.profiles            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.companions          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.groups              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_members       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plans               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trips               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_tasks            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plan_members        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.places              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.course_options      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.itinerary_items     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.votes               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outing_archives     ENABLE ROW LEVEL SECURITY;
