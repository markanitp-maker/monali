-- ======================================================
-- 003_seed_plans.sql
-- 기본 요금제 시드 데이터 (Plan.md FR-005 기준)
-- ======================================================

INSERT INTO public.plans (name, monthly_price, monthly_credits, features) VALUES
  (
    'Free',
    0,
    0,
    '{"ads": true, "max_companions": 5, "description": "신규 가입 시 60크레딧 무료 제공"}'
  ),
  (
    'Standard',
    4900,
    500,
    '{"ads": false, "max_companions": 20, "priority_support": false, "description": "월 4,900원 / 500크레딧 + 광고 제거"}'
  );
