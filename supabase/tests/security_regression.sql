-- Run after a fresh `supabase db reset`:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/security_regression.sql
--
-- These tests are catalog-only and run in a rollback-only transaction. They do
-- not require production data, Auth users, pgTAP, or Storage objects.

begin;

create function pg_temp.assert_true(ok boolean, p_message text) returns void
language plpgsql as $$
begin
  if not coalesce(ok, false) then
    raise exception 'security regression: %', p_message;
  end if;
end;
$$;

-- Data API grants: photos cannot be created or hard-deleted by a user token.
select pg_temp.assert_true(
  has_table_privilege('authenticated', 'public.photos', 'SELECT')
  and not has_table_privilege('authenticated', 'public.photos', 'UPDATE')
  and has_any_column_privilege('authenticated', 'public.photos', 'UPDATE')
  and has_column_privilege('authenticated', 'public.photos', 'caption', 'UPDATE')
  and has_column_privilege('authenticated', 'public.photos', 'favorite', 'UPDATE')
  and has_column_privilege('authenticated', 'public.photos', 'deleted_at', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.photos', 'storage_path', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.photos', 'uploaded_by', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.photos', 'INSERT')
  and not has_table_privilege('authenticated', 'public.photos', 'DELETE'),
  'authenticated photo privileges are too broad'
);

select pg_temp.assert_true(
  has_table_privilege('authenticated', 'public.album_photos', 'SELECT')
  and not has_table_privilege('authenticated', 'public.album_photos', 'INSERT')
  and not has_table_privilege('authenticated', 'public.album_photos', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.album_photos', 'DELETE'),
  'direct album position writes bypass the serialized RPC'
);

select pg_temp.assert_true(
  has_column_privilege('authenticated', 'public.albums', 'title', 'INSERT')
  and not has_column_privilege('authenticated', 'public.albums', 'cover_photo_id', 'INSERT')
  and not has_column_privilege('authenticated', 'public.albums', 'start_date', 'UPDATE'),
  'derived album fields are client-writable'
);

select pg_temp.assert_true(
  not has_table_privilege('anon', 'public.photos', 'SELECT')
  and not has_table_privilege('anon', 'public.photos', 'INSERT')
  and not has_table_privilege('anon', 'public.photos', 'UPDATE')
  and not has_table_privilege('anon', 'public.photos', 'DELETE'),
  'anon can access photos'
);

-- Family-member reads expose display identity, not invitation/private audit data.
select pg_temp.assert_true(
  has_column_privilege('authenticated', 'public.family_members', 'id', 'SELECT')
  and has_column_privilege('authenticated', 'public.family_members', 'user_id', 'SELECT')
  and has_column_privilege('authenticated', 'public.family_members', 'display_name', 'SELECT')
  and not has_column_privilege('authenticated', 'public.family_members', 'invited_email', 'SELECT')
  and not has_column_privilege('authenticated', 'public.family_members', 'birth_date', 'SELECT')
  and not has_column_privilege('authenticated', 'public.family_members', 'revoked_at', 'SELECT'),
  'family member PII column grants regressed'
);

select pg_temp.assert_true(
  has_column_privilege('service_role', 'public.family_members', 'invited_email', 'SELECT')
  and has_column_privilege('service_role', 'public.family_members', 'user_id', 'UPDATE')
  and not has_table_privilege('service_role', 'public.photos', 'SELECT')
  and not has_table_privilege('service_role', 'public.photos', 'INSERT')
  and not has_table_privilege('service_role', 'public.photos', 'UPDATE')
  and not has_table_privilege('service_role', 'public.photos', 'DELETE'),
  'server login ACLs are missing or service_role table access is too broad'
);

-- Every app table must have RLS and every authenticated policy must require AAL2.
select pg_temp.assert_true(
  not exists (
    select 1
      from unnest(array[
        'families','family_members','photos','albums','album_photos','people',
        'photo_people','tags','photo_tags','reactions','comments'
      ]) as expected(name)
     where not exists (
       select 1 from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = expected.name and c.relrowsecurity
     )
  ),
  'an app table is missing RLS'
);

select pg_temp.assert_true(
  not exists (
    select 1
      from pg_policies p
     where p.schemaname = 'public'
       and 'authenticated' = any(p.roles)
       and (coalesce(p.qual, '') || ' ' || coalesce(p.with_check, ''))
           not like '%private.has_aal2()%'
  ),
  'an authenticated public-table policy does not require AAL2'
);

select pg_temp.assert_true(
  not exists (
    select 1 from pg_policies p
     where p.schemaname = 'public' and p.tablename = 'photos' and p.cmd in ('INSERT','DELETE')
  ),
  'direct photo insert/delete policy exists'
);

-- Storage permits only live-photo reads. Signed upload tokens need no INSERT policy.
select pg_temp.assert_true(
  (select count(*) = 1 from pg_policies p
    where p.schemaname = 'storage' and p.tablename = 'objects'
      and p.policyname = 'family_objects_select' and p.cmd = 'SELECT')
  and not exists (
    select 1 from pg_policies p
     where p.schemaname = 'storage' and p.tablename = 'objects'
       and p.policyname in ('family_objects_insert','family_objects_update','family_objects_delete')
  ),
  'authenticated Storage write policy exists'
);

select pg_temp.assert_true(
  exists (
    select 1 from pg_policies p
     where p.schemaname = 'storage' and p.tablename = 'objects'
       and p.policyname = 'family_objects_select'
       and p.qual like '%deleted_at IS NULL%'
       and p.qual like '%purge_started_at IS NULL%'
  ),
  'Storage read policy does not hide deleted/purging photos'
);

select pg_temp.assert_true(
  (select not b.public
          and b.file_size_limit = 52428800
          and b.allowed_mime_types <@ array[
            'image/jpeg','image/png','image/webp','image/gif','image/avif'
          ]::text[]
          and array[
            'image/jpeg','image/png','image/webp','image/gif','image/avif'
          ]::text[] <@ b.allowed_mime_types
     from storage.buckets b where b.id = 'photos'),
  'photos bucket privacy, size, or MIME allowlist regressed'
);

-- Canonical object paths must be globally unique.
select pg_temp.assert_true(
  exists (
    select 1 from pg_indexes i
     where i.schemaname = 'public' and i.tablename = 'photos'
       and i.indexdef like 'CREATE UNIQUE INDEX%storage_path%'
  )
  and exists (
    select 1 from pg_indexes i
     where i.schemaname = 'public' and i.tablename = 'photos'
       and i.indexdef like 'CREATE UNIQUE INDEX%thumb_path%'
  ),
  'photo object paths are not unique'
);

select pg_temp.assert_true(
  exists (
    select 1 from pg_indexes i
     where i.schemaname = 'public' and i.tablename = 'photos'
       and i.indexname = 'photos_family_live_hash_key'
       and i.indexdef like 'CREATE UNIQUE INDEX%family_id%hash%WHERE (deleted_at IS NULL)'
  ),
  'live photo hash uniqueness or soft-delete re-upload behavior regressed'
);

select pg_temp.assert_true(
  exists (
    select 1 from pg_indexes i
     where i.schemaname = 'public' and i.tablename = 'album_photos'
       and i.indexname = 'album_photos_album_position_key'
       and i.indexdef like 'CREATE UNIQUE INDEX%album_id%position%'
  ),
  'album positions are not unique'
);

-- All tenant junctions must have a database-level same-family guard.
select pg_temp.assert_true(
  (select count(*) = 5
     from pg_trigger t
     join pg_class c on c.oid = t.tgrelid
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and t.tgname in (
        'album_photos_same_family','photo_people_same_family',
        'photo_tags_same_family','reactions_same_family','comments_same_family'
      )
      and not t.tgisinternal and t.tgenabled <> 'D'),
  'a cross-family relation guard is missing'
);

select pg_temp.assert_true(
  (select count(*) = 3
     from pg_trigger t
     join pg_class c on c.oid = t.tgrelid
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and t.tgname in (
        'albums_family_id_immutable','people_family_id_immutable',
        'tags_family_id_immutable'
      )
      and not t.tgisinternal and t.tgenabled <> 'D'),
  'a tenant parent family_id is mutable'
);

-- SECURITY DEFINER routines must pin search_path, and service routines must not
-- be executable by anon/authenticated.
select pg_temp.assert_true(
  not exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public','private')
       and p.prosecdef
       and not exists (
         select 1
           from pg_depend d
          where d.classid = 'pg_proc'::regclass
            and d.objid = p.oid
            and d.deptype = 'e'
       )
       and not exists (
         select 1 from unnest(coalesce(p.proconfig, array[]::text[])) setting
          where setting like 'search_path=%'
       )
  ),
  'a SECURITY DEFINER function has no fixed search_path'
);

select pg_temp.assert_true(
  not has_function_privilege(
    'authenticated',
    'public.create_photo_upload_reservation(uuid,uuid,uuid,text,bigint,text,timestamptz)',
    'EXECUTE'
  )
  and has_function_privilege(
    'service_role',
    'public.create_photo_upload_reservation(uuid,uuid,uuid,text,bigint,text,timestamptz)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon', 'public.claim_expired_photos(timestamptz,integer)', 'EXECUTE'
  )
  and has_function_privilege(
    'authenticated', 'public.add_photos_to_album(uuid,uuid[])', 'EXECUTE'
  )
  and not has_function_privilege(
    'anon', 'public.add_photos_to_album(uuid,uuid[])', 'EXECUTE'
  ),
  'service-only RPC execute grants regressed'
);

select pg_temp.assert_true(
  not has_schema_privilege('anon', 'private', 'USAGE')
  and not has_schema_privilege('anon', 'public', 'USAGE')
  and has_schema_privilege('authenticated', 'public', 'USAGE')
  and not has_table_privilege('authenticated', 'private.photo_upload_reservations', 'SELECT')
  and not has_table_privilege('authenticated', 'private.photo_upload_reservations', 'INSERT')
  and not has_table_privilege('authenticated', 'private.photo_upload_reservations', 'UPDATE')
  and not has_table_privilege('authenticated', 'private.photo_upload_reservations', 'DELETE'),
  'private upload reservations are exposed'
);

select pg_temp.assert_true(
  exists (
    select 1 from information_schema.columns c
     where c.table_schema = 'private'
       and c.table_name = 'photo_upload_reservations'
       and c.column_name = 'expires_at'
       and c.column_default like '%02:15:00%'
  ),
  'reservation lifetime no longer outlives a two-hour signed token'
);

select pg_temp.assert_true(
  exists (
    select 1
      from pg_constraint c
      join pg_class r on r.oid = c.conrelid
      join pg_namespace n on n.oid = r.relnamespace
     where n.nspname = 'public'
       and r.relname = 'family_members'
       and c.contype = 'f'
       and c.confrelid = 'auth.users'::regclass
       and c.confdeltype = 'r'
  ),
  'Auth user deletion can clear an append-only membership binding'
);

select pg_temp.assert_true(
  pg_get_functiondef('private.photos_auto_album()'::regprocedure) like '%Asia/Seoul%'
  and pg_get_functiondef(
    'public.photos_on_this_day(integer,integer,integer)'::regprocedure
  ) like '%Asia/Seoul%'
  and pg_get_functiondef('public.photo_years()'::regprocedure) like '%Asia/Seoul%',
  'photo year/day classification is session-timezone dependent'
);

rollback;
