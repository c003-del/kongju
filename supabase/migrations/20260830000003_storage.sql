-- Private Storage buckets. The database remains the source of truth for reads.
-- Direct overwrite/delete is intentionally unavailable to authenticated users.

insert into storage.buckets (
  id, name, public, file_size_limit, allowed_mime_types
)
values (
  'photos', 'photos', false, 52428800,
  array[
    'image/jpeg','image/png','image/webp','image/gif','image/avif'
  ]::text[]
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (
  id, name, public, file_size_limit, allowed_mime_types
)
values (
  'thumbs', 'thumbs', false, 5242880, array['image/webp']::text[]
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy family_objects_select on storage.objects
  for select to authenticated
  using (
    private.has_aal2()
    and (
      (
        bucket_id = 'photos'
        and exists (
          select 1 from public.photos p
           where p.storage_path = name
             and p.family_id = private.current_family_id()
             and p.deleted_at is null
             and p.purge_started_at is null
        )
      )
      or
      (
        bucket_id = 'thumbs'
        and exists (
          select 1 from public.photos p
           where p.thumb_path = name
             and p.family_id = private.current_family_id()
             and p.deleted_at is null
             and p.purge_started_at is null
        )
      )
    )
  );

-- No authenticated INSERT policy: the server validates membership, creates a
-- short-lived reservation, and issues service-role signed upload tokens.
