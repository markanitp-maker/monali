-- 005: outing_archives 에 photo_urls 컬럼 추가
ALTER TABLE public.outing_archives
  ADD COLUMN IF NOT EXISTS photo_urls JSONB NOT NULL DEFAULT '[]';
