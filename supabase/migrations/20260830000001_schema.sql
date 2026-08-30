-- Fresh-project schema for the private family archive.
-- Authorization helpers live in the non-exposed private schema (00002).

create schema if not exists private;
revoke all on schema private from public, anon;

create table public.families (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(btrim(name)) between 1 and 120),
  created_at timestamptz not null default now()
);

create table public.family_members (
  id            uuid primary key default gen_random_uuid(),
  family_id     uuid not null references public.families(id) on delete cascade,
  user_id       uuid references auth.users(id) on delete restrict,
  invited_email text not null,
  display_name  text not null check (char_length(btrim(display_name)) between 1 and 120),
  avatar_url    text,
  birth_date    date,
  role          text not null default 'member' check (role in ('owner','member')),
  is_active     boolean not null default true,
  revoked_at    timestamptz,
  created_at    timestamptz not null default now(),
  constraint family_members_email_normalized
    check (
      invited_email = lower(btrim(invited_email))
      and position('@' in invited_email) > 1
      and char_length(invited_email) <= 254
    ),
  constraint family_members_avatar_url_length
    check (avatar_url is null or char_length(avatar_url) <= 2048),
  constraint family_members_revocation_consistent
    check ((is_active and revoked_at is null) or (not is_active and revoked_at is not null)),
  unique (family_id, id)
);

-- One account belongs to one family. Invitations are case-insensitively unique
-- across the whole service so an Auth user can never be claimed twice.
create unique index family_members_user_id_key
  on public.family_members (user_id) where user_id is not null;
create unique index family_members_invited_email_key
  on public.family_members (lower(invited_email));
create index family_members_family_active_idx
  on public.family_members (family_id, is_active);

create table public.photos (
  id               uuid primary key default gen_random_uuid(),
  family_id        uuid not null references public.families(id) on delete cascade,
  storage_path     text not null unique,
  thumb_path       text not null unique,
  mime             text not null check (mime in (
                     'image/jpeg','image/png','image/webp','image/gif','image/avif'
                   )),
  bytes            bigint not null check (bytes between 1 and 52428800),
  width            int not null check (width between 1 and 100000),
  height           int not null check (height between 1 and 100000),
  blurhash         text check (blurhash is null or char_length(blurhash) <= 200),
  hash             text not null check (hash ~ '^[0-9a-f]{64}$'),
  taken_at         timestamptz not null,
  uploaded_at      timestamptz not null default now(),
  uploaded_by      uuid not null references public.family_members(id) on delete restrict,
  caption          text check (caption is null or char_length(caption) <= 5000),
  favorite         boolean not null default false,
  deleted_at       timestamptz,
  purge_started_at timestamptz,
  purge_claim_id   uuid,
  constraint photos_purge_requires_soft_delete
    check (
      (purge_started_at is null and purge_claim_id is null)
      or (purge_started_at is not null and purge_claim_id is not null and deleted_at is not null)
    ),
  constraint photos_taken_at_canonical_year
    check (
      taken_at >= timestamptz '0001-01-01 00:00:00+00'
      and taken_at < timestamptz '10000-01-01 00:00:00+00'
    ),
  unique (family_id, id)
);

create index photos_family_taken_idx on public.photos (family_id, taken_at desc, id desc)
  where deleted_at is null;
create index photos_family_favorite_idx on public.photos (family_id, taken_at desc)
  where favorite = true and deleted_at is null;
create unique index photos_family_live_hash_key on public.photos (family_id, hash)
  where deleted_at is null;
create index photos_purge_idx on public.photos (deleted_at, id)
  where deleted_at is not null and purge_started_at is null;
create index photos_stale_purge_claim_idx on public.photos (purge_started_at, id)
  where purge_started_at is not null;
create index photos_uploaded_by_idx on public.photos (uploaded_by);

create table public.albums (
  id             uuid primary key default gen_random_uuid(),
  family_id      uuid not null references public.families(id) on delete cascade,
  title          text not null check (char_length(btrim(title)) between 1 and 200),
  kind           text not null check (kind in ('auto','manual')),
  cover_photo_id uuid references public.photos(id) on delete set null,
  start_date     date,
  end_date       date,
  created_at     timestamptz not null default now(),
  constraint albums_date_order check (start_date is null or end_date is null or start_date <= end_date),
  unique (family_id, id)
);

create unique index albums_auto_year_key on public.albums (family_id, title) where kind = 'auto';
create index albums_cover_photo_idx on public.albums (cover_photo_id);

create table public.album_photos (
  album_id uuid not null references public.albums(id) on delete cascade,
  photo_id uuid not null references public.photos(id) on delete cascade,
  position int not null default 0 check (position >= 0),
  primary key (album_id, photo_id)
);

-- Position is a per-album ordering key. Enforce uniqueness in addition to the
-- row-locking RPC so direct Data API writes cannot create ambiguous ordering.
create unique index album_photos_album_position_key
  on public.album_photos (album_id, position);
create index album_photos_photo_idx on public.album_photos (photo_id);

create table public.people (
  id             uuid primary key default gen_random_uuid(),
  family_id      uuid not null references public.families(id) on delete cascade,
  name           text not null check (char_length(btrim(name)) between 1 and 120),
  member_id      uuid references public.family_members(id) on delete set null,
  cover_photo_id uuid references public.photos(id) on delete set null,
  unique (family_id, id)
);

create index people_member_idx on public.people (member_id);
create index people_cover_photo_idx on public.people (cover_photo_id);

create table public.photo_people (
  photo_id  uuid not null references public.photos(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  primary key (photo_id, person_id)
);

create index photo_people_person_idx on public.photo_people (person_id);

create table public.tags (
  id        uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  label     text not null check (char_length(btrim(label)) between 1 and 100),
  unique (family_id, label),
  unique (family_id, id)
);

create table public.photo_tags (
  photo_id uuid not null references public.photos(id) on delete cascade,
  tag_id   uuid not null references public.tags(id) on delete cascade,
  primary key (photo_id, tag_id)
);

create index photo_tags_tag_idx on public.photo_tags (tag_id);

create table public.reactions (
  id         uuid primary key default gen_random_uuid(),
  photo_id   uuid not null references public.photos(id) on delete cascade,
  member_id  uuid not null references public.family_members(id) on delete cascade,
  emoji      text not null check (char_length(emoji) between 1 and 32),
  created_at timestamptz not null default now(),
  unique (photo_id, member_id, emoji)
);

create index reactions_photo_idx on public.reactions (photo_id, created_at);
create index reactions_member_idx on public.reactions (member_id);

create table public.comments (
  id         uuid primary key default gen_random_uuid(),
  photo_id   uuid not null references public.photos(id) on delete cascade,
  member_id  uuid not null references public.family_members(id) on delete cascade,
  body       text not null check (char_length(btrim(body)) between 1 and 5000),
  created_at timestamptz not null default now()
);

create index comments_photo_idx on public.comments (photo_id, created_at);
create index comments_member_idx on public.comments (member_id);
