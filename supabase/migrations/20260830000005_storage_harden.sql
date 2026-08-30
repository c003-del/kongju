-- ─────────────────────────────────────────────────────────────────────────────
-- Storage 권한 강화
-- 클라이언트는 스토리지 객체를 직접 수정·삭제하지 않는다:
--   * 업로드는 service role이 발급한 createSignedUploadUrl 토큰으로만
--   * 조회는 createSignedUrls(select 권한)로만
--   * 삭제는 soft delete(photos.deleted_at) 후 cron이 service role로 정리
-- 따라서 authenticated의 update/delete 정책을 제거해, 같은 가족 구성원이
-- 타인이 올린 객체를 덮어쓰거나 삭제하는 경로를 차단한다.
-- (photos 테이블의 삭제 권한 규칙 — 업로더 본인 또는 owner — 와 정합)
-- ─────────────────────────────────────────────────────────────────────────────

drop policy if exists family_objects_update on storage.objects;
drop policy if exists family_objects_delete on storage.objects;
drop policy if exists family_objects_insert on storage.objects;
