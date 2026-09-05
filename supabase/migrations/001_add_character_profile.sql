-- Migration 001: people 테이블에 character_profile JSONB 컬럼 추가
-- 되돌리기: ALTER TABLE public.people DROP COLUMN IF EXISTS character_profile;

ALTER TABLE public.people
  ADD COLUMN IF NOT EXISTS character_profile JSONB;

COMMENT ON COLUMN public.people.character_profile
  IS '인물 연구 심층 프로필: identity_and_position, character_traits, relationships, narrative_or_argument_function, theological_significance, interpretive_caution, reading_questions 를 JSONB 객체로 저장.';
