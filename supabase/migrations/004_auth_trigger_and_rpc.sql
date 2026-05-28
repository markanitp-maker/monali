-- ============================================================
-- 004: auth 트리거 + start_planner_task RPC
-- ============================================================

-- ─── 1. 신규 유저 가입 시 profiles 자동 생성 ───────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, email, nickname, oauth_provider, credit_balance)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    NEW.app_metadata->>'provider',
    60  -- 신규 가입 기본 크레딧
  )
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ─── 2. start_planner_task — 원자적 크레딧 차감 + trips/ai_tasks INSERT ──
CREATE OR REPLACE FUNCTION public.start_planner_task(
  p_user_id         UUID,
  p_group_id        UUID,
  p_title           TEXT,
  p_origin_address  TEXT,
  p_origin_lat      NUMERIC,
  p_origin_lng      NUMERIC,
  p_radius_km       INT,
  p_scheduled_date  DATE,
  p_duration_days   INT,
  p_mood_tags       TEXT[],
  p_additional_notes TEXT,
  p_credits         INT
)
RETURNS TABLE (plan_id UUID, task_id UUID, credits_remaining INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance     INT;
  v_new_balance INT;
  v_plan_id     UUID;
  v_task_id     UUID;
BEGIN
  -- 잔액 조회 및 잠금
  SELECT credit_balance INTO v_balance
  FROM public.profiles
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile_not_found';
  END IF;

  IF v_balance < p_credits THEN
    RAISE EXCEPTION 'credit_insufficient: required=%, available=%', p_credits, v_balance;
  END IF;

  v_new_balance := v_balance - p_credits;

  -- 크레딧 차감
  UPDATE public.profiles
  SET credit_balance = v_new_balance
  WHERE user_id = p_user_id;

  -- credit_transactions 기록
  INSERT INTO public.credit_transactions (user_id, amount, source, balance_after, memo)
  VALUES (p_user_id, -p_credits, 'CONSUMPTION', v_new_balance,
          format('Planner 생성 (%s일)', p_duration_days));

  -- trips INSERT
  INSERT INTO public.trips (
    creator_id, group_id, title,
    origin_address, origin_lat, origin_lng,
    radius_km, scheduled_date, duration_days,
    status, mood_tags, additional_notes, credits_consumed
  )
  VALUES (
    p_user_id, p_group_id, p_title,
    p_origin_address, p_origin_lat, p_origin_lng,
    p_radius_km, p_scheduled_date, p_duration_days,
    'PLANNING', p_mood_tags, p_additional_notes, p_credits
  )
  RETURNING trips.plan_id INTO v_plan_id;

  -- ai_tasks INSERT
  INSERT INTO public.ai_tasks (plan_id, current_step, status, retry_count, step_results)
  VALUES (v_plan_id, 'skeleton', 'RUNNING', 0, '{}')
  RETURNING ai_tasks.task_id INTO v_task_id;

  RETURN QUERY SELECT v_plan_id, v_task_id, v_new_balance;
END;
$$;

GRANT EXECUTE ON FUNCTION public.start_planner_task TO service_role;
GRANT EXECUTE ON FUNCTION public.handle_new_user TO service_role;
