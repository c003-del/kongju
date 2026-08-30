-- ─────────────────────────────────────────────────────────────────────────────
-- 초기 시드 예시 — {{FAMILY_MEMBER_COUNT_AND_EMAILS}} 확정 후 값을 채워
-- service role(SQL Editor 또는 supabase db 연결)로 1회 실행한다.
-- 이 파일은 예시이며 자동 실행되지 않는다. 실제 값은 커밋하지 않는다.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) 가족 생성
-- insert into public.families (name) values ('우리 가족') returning id;

-- 2) 구성원 선삽입 (user_id는 null — /api/auth/login 이 최초 로그인 때 연결)
--    첫 구성원은 role='owner'
-- insert into public.family_members (family_id, invited_email, display_name, role)
-- values
--   ('<위에서 반환된 family id>', 'owner@example.com',  '아빠', 'owner'),
--   ('<위에서 반환된 family id>', 'member1@example.com', '엄마', 'member');
