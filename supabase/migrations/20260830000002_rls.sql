-- Authorization, integrity guards, explicit Data API grants, and RLS.
-- Every data path requires an active family member at AAL2.

revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;
revoke all on schema public from public, anon;
grant usage on schema public to authenticated, service_role;

-- Neutralize legacy project default ACLs. Future objects stay closed until a
-- migration explicitly grants the minimum API privileges and adds RLS.
alter default privileges for role postgres in schema public
  revoke all on tables from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke all on sequences from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke all on functions from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema private
  revoke all on tables from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema private
  revoke all on sequences from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema private
  revoke all on functions from public, anon, authenticated, service_role;

create function private.has_aal2() returns boolean
language sql stable set search_path = '' as $$
  select coalesce((auth.jwt() ->> 'aal') = 'aal2', false)
$$;

create function private.current_family_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select m.family_id
    from public.family_members m
   where m.user_id = (select auth.uid())
     and m.is_active
   limit 1
$$;

create function private.current_member_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select m.id
    from public.family_members m
   where m.user_id = (select auth.uid())
     and m.is_active
   limit 1
$$;

create function private.is_family_owner() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
      from public.family_members m
     where m.user_id = (select auth.uid())
       and m.is_active
       and m.role = 'owner'
  )
$$;

-- Enforce canonical object paths and bind a photo row to objects that already
-- exist. This is defense in depth for direct Data API calls.
create function private.photos_guard_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_ext text;
  v_prefix text;
begin
  if tg_op = 'INSERT' then
    v_ext := case new.mime
      when 'image/jpeg' then 'jpg'
      when 'image/png'  then 'png'
      when 'image/webp' then 'webp'
      when 'image/gif'  then 'gif'
      when 'image/avif' then 'avif'
      else null
    end;
    if v_ext is null then
      raise exception 'unsupported photo mime';
    end if;

    v_prefix := new.family_id::text || '/' ||
      to_char(new.taken_at at time zone 'UTC', 'YYYY/MM') || '/' || new.id::text;
    if new.storage_path <> v_prefix || '.' || v_ext
       or new.thumb_path <> v_prefix || '.webp' then
      raise exception 'non-canonical photo path';
    end if;

    if not exists (
      select 1 from storage.objects o
       where o.bucket_id = 'photos' and o.name = new.storage_path
    ) or not exists (
      select 1 from storage.objects o
       where o.bucket_id = 'thumbs' and o.name = new.thumb_path
    ) then
      raise exception 'uploaded objects do not exist';
    end if;

    if not exists (
      select 1 from public.family_members m
       where m.id = new.uploaded_by
         and m.family_id = new.family_id
         and m.is_active
    ) then
      raise exception 'uploader is not an active family member';
    end if;
  else
    if new.family_id is distinct from old.family_id
       or new.storage_path is distinct from old.storage_path
       or new.thumb_path is distinct from old.thumb_path
       or new.hash is distinct from old.hash
       or new.mime is distinct from old.mime
       or new.bytes is distinct from old.bytes
       or new.width is distinct from old.width
       or new.height is distinct from old.height
       or new.blurhash is distinct from old.blurhash
       or new.taken_at is distinct from old.taken_at
       or new.uploaded_at is distinct from old.uploaded_at
       or new.uploaded_by is distinct from old.uploaded_by then
      raise exception 'immutable photo metadata cannot be changed';
    end if;

    if (new.purge_started_at is distinct from old.purge_started_at
        or new.purge_claim_id is distinct from old.purge_claim_id)
       and (select auth.uid()) is not null then
      raise exception 'only the purge worker may change purge state';
    end if;

    if new.deleted_at is distinct from old.deleted_at then
      if old.purge_started_at is not null then
        raise exception 'photo purge is already in progress';
      end if;
      if (select auth.uid()) is not null
         and not (
           old.uploaded_by = private.current_member_id()
           or private.is_family_owner()
         ) then
        raise exception 'only the uploader or owner may soft-delete a photo';
      end if;
    end if;
  end if;
  return new;
end;
$$;

create trigger photos_guard_write
  before insert or update on public.photos
  for each row execute function private.photos_guard_write();

create function private.family_members_guard_update() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_is_service boolean := coalesce(auth.jwt() ->> 'role', '') = 'service_role';
begin
  -- Tenant identity and privilege never change after insertion, including in a
  -- service-role call. A maintenance mistake must not move a member between
  -- families or silently promote an account.
  if new.family_id is distinct from old.family_id
     or new.invited_email is distinct from old.invited_email
     or new.role is distinct from old.role then
    raise exception 'membership identity and role are immutable';
  end if;

  if new.user_id is distinct from old.user_id then
    if old.user_id is not null or new.user_id is null or not new.is_active then
      raise exception 'membership account binding is append-only';
    end if;
    if not exists (
      select 1 from auth.users u
       where u.id = new.user_id
         and u.email_confirmed_at is not null
         and lower(u.email) = old.invited_email
    ) then
      raise exception 'membership account does not match the confirmed invitation';
    end if;
    if not v_is_service and not (
      new.user_id = (select auth.uid())
      and private.has_aal2()
      and coalesce(auth.jwt() -> 'app_metadata' ->> 'family_invited', 'false') = 'true'
    ) then
      raise exception 'membership account binding is not authorized';
    end if;
  end if;

  if new.is_active is distinct from old.is_active
     or new.revoked_at is distinct from old.revoked_at then
    if not v_is_service
       and (not private.is_family_owner() or old.user_id = (select auth.uid())) then
      raise exception 'only an owner may revoke another member';
    end if;
  end if;
  return new;
end;
$$;

create trigger family_members_guard_update
  before update on public.family_members
  for each row execute function private.family_members_guard_update();

create function private.albums_guard_refs() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.cover_photo_id is not null and not exists (
    select 1 from public.photos p
     where p.id = new.cover_photo_id
       and p.family_id = new.family_id
       and p.deleted_at is null
  ) then
    raise exception 'album cover must belong to the same family';
  end if;
  return new;
end;
$$;

create trigger albums_guard_refs
  before insert or update on public.albums
  for each row execute function private.albums_guard_refs();

create function private.people_guard_refs() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.member_id is not null and not exists (
    select 1 from public.family_members m
     where m.id = new.member_id and m.family_id = new.family_id
  ) then
    raise exception 'linked member must belong to the same family';
  end if;
  if new.cover_photo_id is not null and not exists (
    select 1 from public.photos p
     where p.id = new.cover_photo_id
       and p.family_id = new.family_id
       and p.deleted_at is null
  ) then
    raise exception 'person cover must belong to the same family';
  end if;
  return new;
end;
$$;

create trigger people_guard_refs
  before insert or update on public.people
  for each row execute function private.people_guard_refs();

create function private.family_id_immutable_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.family_id is distinct from old.family_id then
    raise exception 'family identity is immutable';
  end if;
  return new;
end;
$$;

create trigger albums_family_id_immutable
  before update on public.albums
  for each row execute function private.family_id_immutable_guard();
create trigger people_family_id_immutable
  before update on public.people
  for each row execute function private.family_id_immutable_guard();
create trigger tags_family_id_immutable
  before update on public.tags
  for each row execute function private.family_id_immutable_guard();

-- Foreign keys prove that each endpoint exists, but the junction tables do not
-- carry family_id themselves. Enforce the tenant relationship in one trusted
-- trigger as a database invariant, including writes made by server workers.
create function private.same_family_relation_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'album_photos' then
    if not exists (
      select 1
        from public.albums a
        join public.photos p on p.family_id = a.family_id
       where a.id = new.album_id and p.id = new.photo_id
    ) then
      raise exception 'album and photo must belong to the same family';
    end if;
  elsif tg_table_name = 'photo_people' then
    if not exists (
      select 1
        from public.photos p
        join public.people pe on pe.family_id = p.family_id
       where p.id = new.photo_id and pe.id = new.person_id
    ) then
      raise exception 'photo and person must belong to the same family';
    end if;
  elsif tg_table_name = 'photo_tags' then
    if not exists (
      select 1
        from public.photos p
        join public.tags t on t.family_id = p.family_id
       where p.id = new.photo_id and t.id = new.tag_id
    ) then
      raise exception 'photo and tag must belong to the same family';
    end if;
  elsif tg_table_name = 'reactions' or tg_table_name = 'comments' then
    if not exists (
      select 1
        from public.photos p
        join public.family_members m on m.family_id = p.family_id
       where p.id = new.photo_id and m.id = new.member_id
    ) then
      raise exception 'photo and member must belong to the same family';
    end if;
  else
    raise exception 'unsupported relation guard table';
  end if;
  return new;
end;
$$;

create trigger album_photos_same_family
  before insert or update on public.album_photos
  for each row execute function private.same_family_relation_guard();
create trigger photo_people_same_family
  before insert or update on public.photo_people
  for each row execute function private.same_family_relation_guard();
create trigger photo_tags_same_family
  before insert or update on public.photo_tags
  for each row execute function private.same_family_relation_guard();
create trigger reactions_same_family
  before insert or update on public.reactions
  for each row execute function private.same_family_relation_guard();
create trigger comments_same_family
  before insert or update on public.comments
  for each row execute function private.same_family_relation_guard();

revoke all on function private.has_aal2() from public, anon;
revoke all on function private.current_family_id() from public, anon;
revoke all on function private.current_member_id() from public, anon;
revoke all on function private.is_family_owner() from public, anon;
revoke all on function private.photos_guard_write() from public, anon, authenticated;
revoke all on function private.family_members_guard_update() from public, anon, authenticated;
revoke all on function private.albums_guard_refs() from public, anon, authenticated;
revoke all on function private.people_guard_refs() from public, anon, authenticated;
revoke all on function private.family_id_immutable_guard() from public, anon, authenticated;
revoke all on function private.same_family_relation_guard() from public, anon, authenticated;
grant execute on function private.has_aal2() to authenticated, service_role;
grant execute on function private.current_family_id() to authenticated, service_role;
grant execute on function private.current_member_id() to authenticated, service_role;
grant execute on function private.is_family_owner() to authenticated, service_role;

alter table public.families       enable row level security;
alter table public.family_members enable row level security;
alter table public.photos         enable row level security;
alter table public.albums         enable row level security;
alter table public.album_photos   enable row level security;
alter table public.people         enable row level security;
alter table public.photo_people   enable row level security;
alter table public.tags           enable row level security;
alter table public.photo_tags     enable row level security;
alter table public.reactions      enable row level security;
alter table public.comments       enable row level security;

create policy families_select on public.families
  for select to authenticated
  using (private.has_aal2() and id = private.current_family_id());

create policy family_members_select on public.family_members
  for select to authenticated
  using (private.has_aal2() and family_id = private.current_family_id());

create policy family_members_insert on public.family_members
  for insert to authenticated
  with check (
    private.has_aal2()
    and family_id = private.current_family_id()
    and private.is_family_owner()
    and user_id is null
    and role = 'member'
    and is_active
    and revoked_at is null
  );

create policy family_members_update_self on public.family_members
  for update to authenticated
  using (
    private.has_aal2()
    and id = private.current_member_id()
    and is_active
  )
  with check (
    private.has_aal2()
    and id = private.current_member_id()
    and family_id = private.current_family_id()
    and is_active
    and revoked_at is null
  );

create policy family_members_update_owner on public.family_members
  for update to authenticated
  using (
    private.has_aal2()
    and family_id = private.current_family_id()
    and private.is_family_owner()
    and user_id is distinct from (select auth.uid())
  )
  with check (
    private.has_aal2()
    and family_id = private.current_family_id()
    and private.is_family_owner()
    and user_id is distinct from (select auth.uid())
  );

create policy photos_select on public.photos
  for select to authenticated
  using (
    private.has_aal2()
    and family_id = private.current_family_id()
    and deleted_at is null
    and purge_started_at is null
  );

create policy photos_update on public.photos
  for update to authenticated
  using (
    private.has_aal2()
    and family_id = private.current_family_id()
    and deleted_at is null
    and purge_started_at is null
  )
  with check (
    private.has_aal2()
    and family_id = private.current_family_id()
    and purge_started_at is null
  );

create policy albums_select on public.albums
  for select to authenticated
  using (private.has_aal2() and family_id = private.current_family_id());
create policy albums_insert on public.albums
  for insert to authenticated
  with check (private.has_aal2() and family_id = private.current_family_id() and kind = 'manual');
create policy albums_update on public.albums
  for update to authenticated
  using (private.has_aal2() and family_id = private.current_family_id() and kind = 'manual')
  with check (private.has_aal2() and family_id = private.current_family_id() and kind = 'manual');
create policy albums_delete on public.albums
  for delete to authenticated
  using (private.has_aal2() and family_id = private.current_family_id() and kind = 'manual');

create policy album_photos_select on public.album_photos
  for select to authenticated using (
    private.has_aal2() and exists (
      select 1 from public.albums a
       where a.id = album_id and a.family_id = private.current_family_id()
    )
    and exists (
      select 1 from public.photos p
       where p.id = photo_id
         and p.family_id = private.current_family_id()
         and p.deleted_at is null
         and p.purge_started_at is null
    )
  );
create policy album_photos_insert on public.album_photos
  for insert to authenticated with check (
    private.has_aal2()
    and exists (
      select 1 from public.albums a
       where a.id = album_id and a.family_id = private.current_family_id() and a.kind = 'manual'
    )
    and exists (
      select 1 from public.photos p
       where p.id = photo_id and p.family_id = private.current_family_id() and p.deleted_at is null
    )
  );
create policy album_photos_update on public.album_photos
  for update to authenticated
  using (
    private.has_aal2() and exists (
      select 1 from public.albums a
       where a.id = album_id and a.family_id = private.current_family_id() and a.kind = 'manual'
    )
  )
  with check (
    private.has_aal2()
    and exists (
      select 1 from public.albums a
       where a.id = album_id and a.family_id = private.current_family_id() and a.kind = 'manual'
    )
    and exists (
      select 1 from public.photos p
       where p.id = photo_id and p.family_id = private.current_family_id() and p.deleted_at is null
    )
  );
create policy album_photos_delete on public.album_photos
  for delete to authenticated using (
    private.has_aal2() and exists (
      select 1 from public.albums a
       where a.id = album_id and a.family_id = private.current_family_id() and a.kind = 'manual'
    )
  );

create policy people_select on public.people
  for select to authenticated
  using (private.has_aal2() and family_id = private.current_family_id());
create policy people_insert on public.people
  for insert to authenticated
  with check (private.has_aal2() and family_id = private.current_family_id());
create policy people_update on public.people
  for update to authenticated
  using (private.has_aal2() and family_id = private.current_family_id())
  with check (private.has_aal2() and family_id = private.current_family_id());
create policy people_delete on public.people
  for delete to authenticated
  using (private.has_aal2() and family_id = private.current_family_id());

create policy photo_people_select on public.photo_people
  for select to authenticated using (
    private.has_aal2() and exists (
      select 1 from public.photos p
       where p.id = photo_id and p.family_id = private.current_family_id() and p.deleted_at is null
    )
  );
create policy photo_people_insert on public.photo_people
  for insert to authenticated with check (
    private.has_aal2()
    and exists (
      select 1 from public.photos p
       where p.id = photo_id and p.family_id = private.current_family_id() and p.deleted_at is null
    )
    and exists (
      select 1 from public.people pe
       where pe.id = person_id and pe.family_id = private.current_family_id()
    )
  );
create policy photo_people_delete on public.photo_people
  for delete to authenticated using (
    private.has_aal2() and exists (
      select 1 from public.photos p
       where p.id = photo_id and p.family_id = private.current_family_id() and p.deleted_at is null
    )
  );

create policy tags_select on public.tags
  for select to authenticated
  using (private.has_aal2() and family_id = private.current_family_id());
create policy tags_insert on public.tags
  for insert to authenticated
  with check (private.has_aal2() and family_id = private.current_family_id());
create policy tags_update on public.tags
  for update to authenticated
  using (private.has_aal2() and family_id = private.current_family_id())
  with check (private.has_aal2() and family_id = private.current_family_id());
create policy tags_delete on public.tags
  for delete to authenticated
  using (private.has_aal2() and family_id = private.current_family_id());

create policy photo_tags_select on public.photo_tags
  for select to authenticated using (
    private.has_aal2() and exists (
      select 1 from public.photos p
       where p.id = photo_id and p.family_id = private.current_family_id() and p.deleted_at is null
    )
  );
create policy photo_tags_insert on public.photo_tags
  for insert to authenticated with check (
    private.has_aal2()
    and exists (
      select 1 from public.photos p
       where p.id = photo_id and p.family_id = private.current_family_id() and p.deleted_at is null
    )
    and exists (
      select 1 from public.tags t
       where t.id = tag_id and t.family_id = private.current_family_id()
    )
  );
create policy photo_tags_delete on public.photo_tags
  for delete to authenticated using (
    private.has_aal2() and exists (
      select 1 from public.photos p
       where p.id = photo_id and p.family_id = private.current_family_id() and p.deleted_at is null
    )
  );

create policy reactions_select on public.reactions
  for select to authenticated using (
    private.has_aal2() and exists (
      select 1 from public.photos p
       where p.id = photo_id and p.family_id = private.current_family_id() and p.deleted_at is null
    )
  );
create policy reactions_insert on public.reactions
  for insert to authenticated with check (
    private.has_aal2()
    and member_id = private.current_member_id()
    and exists (
      select 1 from public.photos p
       where p.id = photo_id and p.family_id = private.current_family_id() and p.deleted_at is null
    )
  );
create policy reactions_update on public.reactions
  for update to authenticated
  using (private.has_aal2() and member_id = private.current_member_id())
  with check (private.has_aal2() and member_id = private.current_member_id());
create policy reactions_delete on public.reactions
  for delete to authenticated
  using (private.has_aal2() and member_id = private.current_member_id());

create policy comments_select on public.comments
  for select to authenticated using (
    private.has_aal2() and exists (
      select 1 from public.photos p
       where p.id = photo_id and p.family_id = private.current_family_id() and p.deleted_at is null
    )
  );
create policy comments_insert on public.comments
  for insert to authenticated with check (
    private.has_aal2()
    and member_id = private.current_member_id()
    and exists (
      select 1 from public.photos p
       where p.id = photo_id and p.family_id = private.current_family_id() and p.deleted_at is null
    )
  );
create policy comments_update on public.comments
  for update to authenticated
  using (private.has_aal2() and member_id = private.current_member_id())
  with check (private.has_aal2() and member_id = private.current_member_id());
create policy comments_delete on public.comments
  for delete to authenticated
  using (private.has_aal2() and member_id = private.current_member_id());

-- Explicit grants are required when automatic Data API exposure is disabled.
-- Remove any grants inherited from either legacy or secure project defaults,
-- then add only the explicit app/server privileges below.
revoke all on table public.families from anon, authenticated, service_role;
revoke all on table public.family_members from anon, authenticated, service_role;
revoke all on table public.photos from anon, authenticated, service_role;
revoke all on table public.albums from anon, authenticated, service_role;
revoke all on table public.album_photos from anon, authenticated, service_role;
revoke all on table public.people from anon, authenticated, service_role;
revoke all on table public.photo_people from anon, authenticated, service_role;
revoke all on table public.tags from anon, authenticated, service_role;
revoke all on table public.photo_tags from anon, authenticated, service_role;
revoke all on table public.reactions from anon, authenticated, service_role;
revoke all on table public.comments from anon, authenticated, service_role;

grant select on table public.families to authenticated;
-- Do not expose invitation emails, birth dates, or revocation audit fields to
-- every family member. user_id remains readable because requireMember filters
-- by it; all visible UI joins use only id/display_name/avatar_url.
grant select (id, family_id, user_id, display_name, avatar_url, role)
  on table public.family_members to authenticated;
grant insert (family_id, invited_email, display_name, avatar_url, birth_date, role)
  on table public.family_members to authenticated;
grant update (display_name, avatar_url, birth_date, is_active, revoked_at)
  on table public.family_members to authenticated;

-- The server login flow performs the invitation lookup/bind directly. New
-- secure-default projects do not implicitly grant table ACLs to service_role.
grant select (id, user_id, invited_email, is_active)
  on table public.family_members to service_role;
grant update (user_id) on table public.family_members to service_role;

grant select on table public.photos to authenticated;
grant update (caption, favorite, deleted_at) on table public.photos to authenticated;

grant select, delete on table public.albums to authenticated;
-- Cover/range are derived from junction rows and maintained only by trusted DB
-- routines. Client writes are limited to the manual album's base fields.
grant insert (family_id, title, kind) on table public.albums to authenticated;
grant update (title) on table public.albums to authenticated;

-- Position allocation and derived album fields are serialized by
-- add_photos_to_album(); keep all direct junction writes closed.
grant select on table public.album_photos to authenticated;

grant select, insert, delete on table public.people to authenticated;
grant update (name, member_id, cover_photo_id) on table public.people to authenticated;
grant select, insert, delete on table public.photo_people to authenticated;
grant select, insert, delete on table public.tags to authenticated;
grant update (label) on table public.tags to authenticated;
grant select, insert, delete on table public.photo_tags to authenticated;
grant select, insert, delete on table public.reactions to authenticated;
grant update (emoji) on table public.reactions to authenticated;
grant select, insert, delete on table public.comments to authenticated;
grant update (body) on table public.comments to authenticated;
