---
name: supabase-setup
description: Supabase PostgreSQL 스키마 설계, RLS 정책, GRANT 구문, Deno Edge Function 구조를 생성한다. 나들이 플래너 DB 테이블 생성, 마이그레이션 파일 작성, 인증 설정 작업 시 반드시 이 스킬을 사용할 것.
---

## 핵심 규칙

모든 테이블 생성 SQL에 다음 3줄을 반드시 포함한다:
```sql
ALTER TABLE public.<테이블명> ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.<테이블명> TO anon, authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
```

## 스키마 패턴

### 기본 테이블 구조
```sql
CREATE TABLE public.<테이블명> (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
  -- 추가 컬럼
);

CREATE TRIGGER update_<테이블명>_updated_at
  BEFORE UPDATE ON public.<테이블명>
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
```

### ENUM 정의
```sql
CREATE TYPE public.mobility_type AS ENUM ('wheelchair', 'stroller', 'none');
CREATE TYPE public.dietary_type AS ENUM ('allergy', 'vegan', 'vegetarian', 'halal', 'none');
CREATE TYPE public.plan_status AS ENUM ('draft', 'voting', 'confirmed', 'completed');
```

### 인덱스 패턴
```sql
-- 외래 키 컬럼
CREATE INDEX idx_<테이블>_<컬럼> ON public.<테이블>(<컬럼>);
-- 공유 토큰 (유일 조회)
CREATE UNIQUE INDEX idx_outing_plans_share_token ON public.outing_plans(share_token) WHERE share_token IS NOT NULL;
```

## RLS 정책 패턴

### 일반 사용자 데이터 (본인만 접근)
```sql
CREATE POLICY "<테이블>_owner_policy" ON public.<테이블>
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
```

### 공유 토큰 기반 공개 접근 (비회원 투표)
```sql
CREATE POLICY "outing_plans_share_read" ON public.outing_plans
  FOR SELECT TO anon, authenticated
  USING (share_token IS NOT NULL AND expires_at > NOW());
```

### 비회원 투표 허용
```sql
CREATE POLICY "votes_insert_anon" ON public.votes
  FOR INSERT TO anon
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.outing_plans
      WHERE id = (SELECT outing_plan_id FROM public.course_options WHERE id = course_option_id)
      AND share_token IS NOT NULL AND expires_at > NOW()
    )
  );
```

## Edge Function 구조

### Deno Edge Function 기본 구조
```typescript
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      req.headers.get("authorization")?.includes("anon") 
        ? Deno.env.get("SUPABASE_ANON_KEY")!
        : Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // 비즈니스 로직

    return new Response(JSON.stringify({ data }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
```

### 150초 타임아웃 보호 (AI 함수 전용)
```typescript
const TIMEOUT_MS = 140_000; // 안전 마진 10초

const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> => {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("TIMEOUT")), ms)
    ),
  ]);
};
```

## 마이그레이션 파일 구조
```
supabase/
├── migrations/
│   ├── 001_initial_schema.sql   # ENUM + 테이블 DDL + 인덱스 + GRANT
│   ├── 002_rls_policies.sql     # RLS 활성화 + 정책
│   └── 003_seed_data.sql        # 초기 데이터 (선택)
└── functions/
    ├── profiles/index.ts
    ├── planner/index.ts
    ├── share/index.ts
    ├── vote/index.ts
    ├── itinerary-export/index.ts
    └── archive/index.ts
```

## 자주 하는 실수
- GRANT 없이 테이블 생성 → anon 접근 불가 → 비회원 투표 실패
- RLS 활성화 없이 정책 정의 → 정책 무시됨
- Service Role Key를 비회원 엔드포인트에 사용 → 보안 취약점
- updated_at 트리거 누락 → 자동 업데이트 안 됨
