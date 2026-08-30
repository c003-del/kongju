-- Auth claim, automatic albums, read RPCs, login throttling, and purge queue.

create table private.login_rate_limits (
  key_hash       text primary key check (key_hash ~ '^[0-9a-f]{64}$'),
  window_started timestamptz not null default now(),
  attempts       int not null default 1 check (attempts > 0)
);
revoke all on table private.login_rate_limits from public, anon, authenticated, service_role;

create table private.photo_upload_reservations (
  photo_id          uuid primary key,
  family_id         uuid not null references public.families(id) on delete cascade,
  member_id         uuid not null references public.family_members(id) on delete cascade,
  storage_path      text not null unique,
  thumb_path        text not null unique,
  mime              text not null check (mime in (
                      'image/jpeg','image/png','image/webp','image/gif','image/avif'
                    )),
  bytes             bigint not null check (bytes between 1 and 52428800),
  hash              text not null check (hash ~ '^[0-9a-f]{64}$'),
  taken_at          timestamptz not null,
  created_at        timestamptz not null default now(),
  -- Supabase signed upload tokens are valid for two hours. Keep the reservation
  -- until the token has expired, plus a cleanup grace period, so a still-valid
  -- token cannot recreate an already-cleaned orphan object.
  expires_at        timestamptz not null default now() + interval '2 hours 15 minutes',
  cleanup_started_at timestamptz,
  cleanup_claim_id   uuid,
  constraint photo_upload_reservation_expiry check (expires_at > created_at),
  constraint photo_upload_reservation_cleanup_lease check (
    (cleanup_started_at is null and cleanup_claim_id is null)
    or (cleanup_started_at is not null and cleanup_claim_id is not null)
  ),
  constraint photo_upload_reservation_canonical_year check (
    taken_at >= timestamptz '0001-01-01 00:00:00+00'
    and taken_at < timestamptz '10000-01-01 00:00:00+00'
  )
);
create index photo_upload_reservations_expiry_idx
  on private.photo_upload_reservations (expires_at, photo_id)
  where cleanup_started_at is null;
create index photo_upload_reservations_stale_claim_idx
  on private.photo_upload_reservations (cleanup_started_at, photo_id)
  where cleanup_started_at is not null;
create index photo_upload_reservations_family_idx
  on private.photo_upload_reservations (family_id, expires_at);
create index photo_upload_reservations_member_idx
  on private.photo_upload_reservations (member_id, expires_at);
revoke all on table private.photo_upload_reservations from public, anon, authenticated, service_role;

create function public.create_photo_upload_reservation(
  p_family_id uuid,
  p_member_id uuid,
  p_photo_id uuid,
  p_mime text,
  p_bytes bigint,
  p_hash text,
  p_taken_at timestamptz
)
returns table (is_duplicate boolean, photo_id uuid, storage_path text, thumb_path text)
language plpgsql security definer set search_path = '' as $$
declare
  v_existing uuid;
  v_pending private.photo_upload_reservations%rowtype;
  v_ext text;
  v_prefix text;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service role required';
  end if;
  if p_bytes not between 1 and 52428800 or p_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid upload metadata';
  end if;
  if p_taken_at < timestamptz '0001-01-01 00:00:00+00'
     or p_taken_at >= timestamptz '10000-01-01 00:00:00+00' then
    raise exception 'upload timestamp has a non-canonical year';
  end if;
  if not exists (
    select 1 from public.family_members m
     where m.id = p_member_id and m.family_id = p_family_id and m.is_active
  ) then
    raise exception 'active family member required';
  end if;

  -- Serialize both the live-photo check and pending reservation creation for a
  -- family/hash pair. A second member cannot race a parallel canonical upload.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'photo-hash:' || p_family_id::text || ':' || p_hash,
      0
    )
  );

  select p.id into v_existing
    from public.photos p
   where p.family_id = p_family_id
     and p.hash = p_hash
     and p.deleted_at is null
     and p.purge_started_at is null
   limit 1;
  if v_existing is not null then
    return query select true, v_existing, null::text, null::text;
    return;
  end if;

  select r.* into v_pending
    from private.photo_upload_reservations r
   where r.family_id = p_family_id
     and r.hash = p_hash
     and r.expires_at > now()
     and r.cleanup_started_at is null
   order by r.created_at
   limit 1
   for update;
  if found then
    if v_pending.member_id <> p_member_id
       or v_pending.mime <> p_mime
       or v_pending.bytes <> p_bytes
       or v_pending.taken_at <> p_taken_at then
      raise exception 'an upload for this photo is already in progress';
    end if;
    -- Every newly issued signed token is valid for two hours. Move cleanup past
    -- the newest token's lifetime so a replay cannot recreate a cleaned orphan.
    update private.photo_upload_reservations r
       set expires_at = now() + interval '2 hours 15 minutes'
     where r.photo_id = v_pending.photo_id
    returning r.* into v_pending;
    return query select false, v_pending.photo_id, v_pending.storage_path, v_pending.thumb_path;
    return;
  end if;

  -- Serialize incomplete-ticket accounting per member. Completed uploads delete
  -- their reservation, so this limits abandoned/replayed tickets without
  -- restricting normal sequential batch uploads.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('photo-upload:' || p_member_id::text, 0)
  );
  if (
    select count(*) >= 20
       or coalesce(sum(r.bytes), 0) + p_bytes > 536870912
      from private.photo_upload_reservations r
     where r.member_id = p_member_id
       and r.expires_at > now()
       and r.cleanup_started_at is null
  ) then
    raise exception 'too many incomplete uploads';
  end if;

  v_ext := case p_mime
    when 'image/jpeg' then 'jpg'
    when 'image/png'  then 'png'
    when 'image/webp' then 'webp'
    when 'image/gif'  then 'gif'
    when 'image/avif' then 'avif'
    else null
  end;
  if v_ext is null then raise exception 'unsupported upload mime'; end if;

  v_prefix := p_family_id::text || '/' ||
    to_char(p_taken_at at time zone 'UTC', 'YYYY/MM') || '/' || p_photo_id::text;

  insert into private.photo_upload_reservations (
    photo_id, family_id, member_id, storage_path, thumb_path,
    mime, bytes, hash, taken_at
  ) values (
    p_photo_id, p_family_id, p_member_id, v_prefix || '.' || v_ext,
    v_prefix || '.webp', p_mime, p_bytes, p_hash, p_taken_at
  );

  return query select false, p_photo_id, v_prefix || '.' || v_ext, v_prefix || '.webp';
end;
$$;

create function public.finalize_photo_upload(
  p_photo_id uuid,
  p_family_id uuid,
  p_member_id uuid,
  p_storage_path text,
  p_thumb_path text,
  p_mime text,
  p_bytes bigint,
  p_width int,
  p_height int,
  p_blurhash text,
  p_hash text,
  p_taken_at timestamptz,
  p_caption text
)
returns table (is_duplicate boolean, photo_id uuid)
language plpgsql security definer set search_path = '' as $$
declare
  v_res private.photo_upload_reservations%rowtype;
  v_existing uuid;
  v_original_meta jsonb;
  v_thumb_meta jsonb;
  v_original_size bigint;
  v_thumb_size bigint;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service role required';
  end if;

  select r.* into v_res
    from private.photo_upload_reservations r
   where r.photo_id = p_photo_id
   for update;
  if not found then
    -- Idempotent retry after a successful commit/lost HTTP response. Never treat
    -- an unrelated photo as success: immutable reservation fields must match.
    if exists (
      select 1 from public.photos p
       where p.id = p_photo_id
         and p.family_id = p_family_id
         and p.uploaded_by = p_member_id
         and p.storage_path = p_storage_path
         and p.thumb_path = p_thumb_path
         and p.mime = p_mime
         and p.bytes = p_bytes
         and p.width = p_width
         and p.height = p_height
         and p.blurhash is not distinct from p_blurhash
         and p.hash = p_hash
         and p.taken_at = p_taken_at
         and p.deleted_at is null
         and p.purge_started_at is null
    ) then
      return query select false, p_photo_id;
      return;
    end if;
    raise exception 'upload reservation is missing or expired';
  end if;
  if v_res.expires_at <= now() or v_res.cleanup_started_at is not null then
    raise exception 'upload reservation is missing or expired';
  end if;
  if v_res.family_id is distinct from p_family_id
     or v_res.member_id is distinct from p_member_id
     or v_res.storage_path is distinct from p_storage_path
     or v_res.thumb_path is distinct from p_thumb_path
     or v_res.mime is distinct from p_mime
     or v_res.bytes is distinct from p_bytes
     or v_res.hash is distinct from p_hash
     or v_res.taken_at is distinct from p_taken_at then
    raise exception 'upload does not match its reservation';
  end if;

  select o.metadata into v_original_meta
    from storage.objects o
   where o.bucket_id = 'photos' and o.name = v_res.storage_path;
  select o.metadata into v_thumb_meta
    from storage.objects o
   where o.bucket_id = 'thumbs' and o.name = v_res.thumb_path;
  -- Validate text representations before casting. SQL does not promise an OR
  -- evaluation order, so a crafted/nonstandard metadata value must never reach
  -- an unchecked bigint cast.
  if v_original_meta is null or v_thumb_meta is null
     or coalesce(v_original_meta ->> 'mimetype', '') <> v_res.mime
     or coalesce(v_thumb_meta ->> 'mimetype', '') <> 'image/webp'
     or coalesce(v_original_meta ->> 'size', '') !~ '^[0-9]{1,18}$'
     or coalesce(v_thumb_meta ->> 'size', '') !~ '^[0-9]{1,18}$' then
    raise exception 'uploaded object metadata does not match reservation';
  end if;
  v_original_size := (v_original_meta ->> 'size')::bigint;
  v_thumb_size := (v_thumb_meta ->> 'size')::bigint;
  if v_original_size <> v_res.bytes or v_thumb_size not between 1 and 5242880 then
    raise exception 'uploaded object metadata does not match reservation';
  end if;

  select p.id into v_existing
    from public.photos p
   where p.family_id = p_family_id
     and p.hash = p_hash
     and p.deleted_at is null
     and p.purge_started_at is null
   limit 1;
  if v_existing is not null then
    return query select true, v_existing;
    return;
  end if;

  begin
    insert into public.photos (
      id, family_id, storage_path, thumb_path, mime, bytes, width, height,
      blurhash, hash, taken_at, uploaded_by, caption
    ) values (
      p_photo_id, p_family_id, p_storage_path, p_thumb_path, p_mime, p_bytes,
      p_width, p_height, p_blurhash, p_hash, p_taken_at, p_member_id,
      nullif(btrim(p_caption), '')
    );
  exception when unique_violation then
    select p.id into v_existing
      from public.photos p
     where p.family_id = p_family_id
       and p.hash = p_hash
       and p.deleted_at is null
       and p.purge_started_at is null
     limit 1;
    if v_existing is null then raise; end if;
    return query select true, v_existing;
    return;
  end;

  delete from private.photo_upload_reservations r where r.photo_id = p_photo_id;
  return query select false, p_photo_id;
end;
$$;

-- Fallback claim for an app-created Auth account. Public signups cannot claim an
-- invitation because the server-only login flow sets family_invited app metadata.
create function public.claim_membership() returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_invited boolean;
begin
  if v_uid is null or not private.has_aal2() then
    raise exception 'verified AAL2 session required';
  end if;

  select lower(u.email),
         coalesce((u.raw_app_meta_data ->> 'family_invited') = 'true', false)
    into v_email, v_invited
    from auth.users u
   where u.id = v_uid
     and u.email_confirmed_at is not null;

  if v_email is null or not v_invited then
    return;
  end if;
  if exists (select 1 from public.family_members m where m.user_id = v_uid) then
    return;
  end if;

  update public.family_members m
     set user_id = v_uid
   where m.user_id is null
     and m.is_active
     and lower(m.invited_email) = v_email;
end;
$$;

-- Service-role fallback when an invited email already has an Auth account.
create function public.link_invited_member_by_email(p_member_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_user_id uuid;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service role required';
  end if;

  update public.family_members m
     set user_id = u.id
    from auth.users u
   where m.id = p_member_id
     and m.user_id is null
     and m.is_active
     and u.email_confirmed_at is not null
     and lower(u.email) = m.invited_email
  returning u.id into v_user_id;
  if not found then
    raise exception 'matching active invitation or confirmed auth user not found';
  end if;
  return v_user_id;
end;
$$;

create function public.consume_login_rate_limit(p_key_hash text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_attempts int;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     or p_key_hash !~ '^[0-9a-f]{64}$' then
    return false;
  end if;

  insert into private.login_rate_limits as r (key_hash, window_started, attempts)
  values (p_key_hash, now(), 1)
  on conflict (key_hash) do update set
    window_started = case
      when r.window_started < now() - interval '10 minutes' then now()
      else r.window_started
    end,
    attempts = case
      when r.window_started < now() - interval '10 minutes' then 1
      else r.attempts + 1
    end
  returning attempts into v_attempts;

  return v_attempts <= 5;
end;
$$;

create function private.photos_auto_album() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_year int := extract(year from new.taken_at at time zone 'Asia/Seoul')::int;
  v_album_id uuid;
begin
  select a.id into v_album_id
    from public.albums a
   where a.family_id = new.family_id and a.kind = 'auto' and a.title = v_year::text
   for update;

  if v_album_id is null then
    insert into public.albums (family_id, title, kind, cover_photo_id, start_date, end_date)
    values (
      new.family_id, v_year::text, 'auto', new.id,
      make_date(v_year, 1, 1), make_date(v_year, 12, 31)
    )
    on conflict (family_id, title) where kind = 'auto' do nothing
    returning id into v_album_id;

    if v_album_id is null then
      select a.id into v_album_id
        from public.albums a
       where a.family_id = new.family_id and a.kind = 'auto' and a.title = v_year::text
       for update;
    end if;
  end if;

  insert into public.album_photos (album_id, photo_id, position)
  values (
    v_album_id,
    new.id,
    coalesce((select max(ap.position) + 1 from public.album_photos ap where ap.album_id = v_album_id), 0)
  )
  on conflict do nothing;

  update public.albums
     set cover_photo_id = new.id
   where id = v_album_id and cover_photo_id is null;
  return new;
end;
$$;

create trigger photos_auto_album
  after insert on public.photos
  for each row execute function private.photos_auto_album();

-- Atomically append a bounded photo set to a manual album. Direct junction
-- INSERT/UPDATE ACLs are closed, so this carefully checked routine is the only
-- authenticated position allocator.
create function public.add_photos_to_album(p_album_id uuid, p_photo_ids uuid[])
returns table (
  added_count integer,
  photo_count bigint,
  start_date date,
  end_date date,
  cover_photo_id uuid
)
language plpgsql security definer set search_path = '' as $$
declare
  v_family_id uuid;
  v_album_kind text;
  v_old_cover uuid;
  v_cover uuid;
  v_ids uuid[];
  v_photo_id uuid;
  v_locked_count integer := 0;
  v_new_count integer;
  v_base bigint;
  v_inserted integer := 0;
  v_photo_count bigint;
  v_start date;
  v_end date;
begin
  if (select auth.uid()) is null or not private.has_aal2() then
    raise exception 'verified_aal2_session_required';
  end if;

  v_family_id := private.current_family_id();
  if v_family_id is null then
    raise exception 'active_membership_required';
  end if;

  if p_album_id is null or p_photo_ids is null
     or pg_catalog.cardinality(p_photo_ids) not between 1 and 200
     or pg_catalog.array_position(p_photo_ids, null) is not null then
    raise exception 'invalid_photo_ids';
  end if;

  -- Deduplicate while retaining the first-seen order.
  select pg_catalog.array_agg(d.photo_id order by d.first_ord)
    into v_ids
    from (
      select u.photo_id, pg_catalog.min(u.ord) as first_ord
        from pg_catalog.unnest(p_photo_ids)
             with ordinality as u(photo_id, ord)
       group by u.photo_id
    ) d;

  -- The parent-row lock is the per-album serialization primitive. Missing and
  -- cross-family identifiers intentionally have the same externally visible
  -- result.
  select a.kind, a.cover_photo_id
    into v_album_kind, v_old_cover
    from public.albums a
   where a.id = p_album_id and a.family_id = v_family_id
   for update;
  if not found then
    raise exception 'album_not_found';
  end if;
  if v_album_kind <> 'manual' then raise exception 'auto_album_readonly'; end if;

  -- Lock accepted photos in deterministic order, preventing a concurrent
  -- soft-delete between validation and junction/cover updates.
  for v_photo_id in
    select p.id
    from public.photos p
   where p.id = any(v_ids)
     and p.family_id = v_family_id
     and p.deleted_at is null
     and p.purge_started_at is null
   order by p.id
   for update
  loop
    v_locked_count := v_locked_count + 1;
  end loop;
  if v_locked_count <> pg_catalog.cardinality(v_ids) then
    raise exception 'invalid_photo_ids';
  end if;

  select pg_catalog.coalesce(pg_catalog.max(ap.position), -1)::bigint
    into v_base
    from public.album_photos ap
   where ap.album_id = p_album_id;

  select pg_catalog.count(*)::integer
    into v_new_count
    from pg_catalog.unnest(v_ids) requested(photo_id)
   where not exists (
     select 1 from public.album_photos ap
      where ap.album_id = p_album_id and ap.photo_id = requested.photo_id
   );
  if v_base + v_new_count > 2147483647 then
    raise exception 'album_position_exhausted';
  end if;

  with requested as (
    select u.photo_id, u.ord
      from pg_catalog.unnest(v_ids) with ordinality as u(photo_id, ord)
  ), missing as (
    select r.photo_id, r.ord
      from requested r
     where not exists (
       select 1 from public.album_photos ap
        where ap.album_id = p_album_id and ap.photo_id = r.photo_id
     )
  )
  insert into public.album_photos (album_id, photo_id, position)
  select
      p_album_id,
      m.photo_id,
      (v_base + pg_catalog.row_number() over (order by m.ord))::integer
    from missing m
   order by m.ord;
  get diagnostics v_inserted = row_count;

  select
      pg_catalog.count(*)::bigint,
      pg_catalog.min((p.taken_at at time zone 'Asia/Seoul')::date),
      pg_catalog.max((p.taken_at at time zone 'Asia/Seoul')::date)
    into v_photo_count, v_start, v_end
    from public.album_photos ap
    join public.photos p on p.id = ap.photo_id
   where ap.album_id = p_album_id
     and p.deleted_at is null
     and p.purge_started_at is null;

  select p.id into v_cover
    from public.album_photos ap
    join public.photos p on p.id = ap.photo_id
   where ap.album_id = p_album_id
     and p.deleted_at is null
     and p.purge_started_at is null
   order by
     case when p.id = v_old_cover then 0 else 1 end,
     ap.position,
     p.id
   limit 1;

  update public.albums a
     set cover_photo_id = v_cover,
         start_date = v_start,
         end_date = v_end
   where a.id = p_album_id;

  return query select v_inserted, v_photo_count, v_start, v_end, v_cover;
end;
$$;

create function public.photos_on_this_day(p_month int, p_day int, p_year int)
returns setof public.photos
language sql stable security invoker set search_path = '' as $$
  select p.*
    from public.photos p
   where p.family_id = private.current_family_id()
     and p.deleted_at is null
     and p.purge_started_at is null
     and extract(month from p.taken_at at time zone 'Asia/Seoul') = p_month
     and extract(day from p.taken_at at time zone 'Asia/Seoul') = p_day
     and extract(year from p.taken_at at time zone 'Asia/Seoul') <> p_year
   order by p.taken_at desc
$$;

create function public.photo_years()
returns setof int
language sql stable security invoker set search_path = '' as $$
  select distinct extract(year from p.taken_at at time zone 'Asia/Seoul')::int
    from public.photos p
   where p.family_id = private.current_family_id()
     and p.deleted_at is null
     and p.purge_started_at is null
   order by 1 desc
$$;

create function public.album_photo_counts()
returns table (album_id uuid, photo_count bigint)
language sql stable security invoker set search_path = '' as $$
  select ap.album_id, count(*)::bigint
    from public.album_photos ap
    join public.photos p on p.id = ap.photo_id
   where p.deleted_at is null and p.purge_started_at is null
   group by ap.album_id
$$;

create function public.person_photo_counts()
returns table (person_id uuid, photo_count bigint)
language sql stable security invoker set search_path = '' as $$
  select pp.person_id, count(*)::bigint
    from public.photo_people pp
    join public.photos p on p.id = pp.photo_id
   where p.deleted_at is null and p.purge_started_at is null
   group by pp.person_id
$$;

-- Claim rows first so a restore cannot race Storage deletion. Completion only
-- removes rows that were claimed by a purge worker.
create function public.claim_expired_photos(p_cutoff timestamptz, p_limit int default 200)
returns table (id uuid, family_id uuid, storage_path text, thumb_path text, claim_id uuid)
language plpgsql security definer set search_path = '' as $$
declare
  v_claim_id uuid := gen_random_uuid();
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service role required';
  end if;
  return query
  with candidates as (
    select p.id
      from public.photos p
     where p.deleted_at < p_cutoff
       and (
         p.purge_started_at is null
         or p.purge_started_at < now() - interval '1 hour'
       )
     order by p.deleted_at, p.id
     for update skip locked
     limit least(greatest(coalesce(p_limit, 200), 1), 200)
  )
  update public.photos p
     set purge_started_at = now(), purge_claim_id = v_claim_id
    from candidates c
   where p.id = c.id
  returning p.id, p.family_id, p.storage_path, p.thumb_path, p.purge_claim_id;
end;
$$;

create function public.complete_photo_purge(p_ids uuid[], p_claim_id uuid) returns setof uuid
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service role required';
  end if;
  return query
    delete from public.photos p
     where p.id = any(p_ids)
       and p.purge_claim_id = p_claim_id
    returning p.id;
end;
$$;

create function public.release_photo_purge(p_ids uuid[], p_claim_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service role required';
  end if;
  update public.photos p
     set purge_started_at = null, purge_claim_id = null
   where p.id = any(p_ids) and p.purge_claim_id = p_claim_id;
end;
$$;

create function public.claim_expired_uploads(p_limit int default 200)
returns table (photo_id uuid, storage_path text, thumb_path text, claim_id uuid)
language plpgsql security definer set search_path = '' as $$
declare
  v_claim_id uuid := gen_random_uuid();
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service role required';
  end if;
  return query
  with candidates as (
    select r.photo_id
      from private.photo_upload_reservations r
     where r.expires_at < now()
       and (
         r.cleanup_started_at is null
         or r.cleanup_started_at < now() - interval '1 hour'
       )
     order by r.expires_at, r.photo_id
     for update skip locked
     limit least(greatest(coalesce(p_limit, 200), 1), 200)
  )
  update private.photo_upload_reservations r
     set cleanup_started_at = now(), cleanup_claim_id = v_claim_id
    from candidates c
   where r.photo_id = c.photo_id
  returning r.photo_id, r.storage_path, r.thumb_path, r.cleanup_claim_id;
end;
$$;

create function public.complete_upload_cleanup(p_ids uuid[], p_claim_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service role required';
  end if;
  delete from private.photo_upload_reservations r
   where r.photo_id = any(p_ids) and r.cleanup_claim_id = p_claim_id;
end;
$$;

create function public.release_upload_cleanup(p_ids uuid[], p_claim_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service role required';
  end if;
  update private.photo_upload_reservations r
     set cleanup_started_at = null, cleanup_claim_id = null
   where r.photo_id = any(p_ids) and r.cleanup_claim_id = p_claim_id;
end;
$$;

create function public.cleanup_login_rate_limits() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service role required';
  end if;
  delete from private.login_rate_limits r
   where r.window_started < now() - interval '1 day';
end;
$$;

revoke all on function public.claim_membership() from public, anon;
revoke all on function public.create_photo_upload_reservation(uuid, uuid, uuid, text, bigint, text, timestamptz) from public, anon, authenticated;
revoke all on function public.finalize_photo_upload(uuid, uuid, uuid, text, text, text, bigint, int, int, text, text, timestamptz, text) from public, anon, authenticated;
revoke all on function public.link_invited_member_by_email(uuid) from public, anon, authenticated;
revoke all on function public.consume_login_rate_limit(text) from public, anon, authenticated;
revoke all on function private.photos_auto_album() from public, anon, authenticated;
revoke all on function public.add_photos_to_album(uuid, uuid[]) from public, anon;
revoke all on function public.photos_on_this_day(int, int, int) from public, anon;
revoke all on function public.photo_years() from public, anon;
revoke all on function public.album_photo_counts() from public, anon;
revoke all on function public.person_photo_counts() from public, anon;
revoke all on function public.claim_expired_photos(timestamptz, int) from public, anon, authenticated;
revoke all on function public.complete_photo_purge(uuid[], uuid) from public, anon, authenticated;
revoke all on function public.release_photo_purge(uuid[], uuid) from public, anon, authenticated;
revoke all on function public.claim_expired_uploads(int) from public, anon, authenticated;
revoke all on function public.complete_upload_cleanup(uuid[], uuid) from public, anon, authenticated;
revoke all on function public.release_upload_cleanup(uuid[], uuid) from public, anon, authenticated;
revoke all on function public.cleanup_login_rate_limits() from public, anon, authenticated;

grant execute on function public.claim_membership() to authenticated;
grant execute on function public.add_photos_to_album(uuid, uuid[]) to authenticated;
grant execute on function public.create_photo_upload_reservation(uuid, uuid, uuid, text, bigint, text, timestamptz) to service_role;
grant execute on function public.finalize_photo_upload(uuid, uuid, uuid, text, text, text, bigint, int, int, text, text, timestamptz, text) to service_role;
grant execute on function public.photos_on_this_day(int, int, int) to authenticated;
grant execute on function public.photo_years() to authenticated;
grant execute on function public.album_photo_counts() to authenticated;
grant execute on function public.person_photo_counts() to authenticated;
grant execute on function public.link_invited_member_by_email(uuid) to service_role;
grant execute on function public.consume_login_rate_limit(text) to service_role;
grant execute on function public.claim_expired_photos(timestamptz, int) to service_role;
grant execute on function public.complete_photo_purge(uuid[], uuid) to service_role;
grant execute on function public.release_photo_purge(uuid[], uuid) to service_role;
grant execute on function public.claim_expired_uploads(int) to service_role;
grant execute on function public.complete_upload_cleanup(uuid[], uuid) to service_role;
grant execute on function public.release_upload_cleanup(uuid[], uuid) to service_role;
grant execute on function public.cleanup_login_rate_limits() to service_role;
