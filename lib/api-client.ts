"use client";
import type {
  Album,
  AlbumDetail,
  Comment,
  InitialData,
  Person,
  Photo,
  PhotoDetail,
  Reaction,
  TimelineFilters,
  TimelinePage,
} from "@/lib/contracts";

// UI data access stays behind Route Handlers so server validation remains central.
async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw new Error(json.error ?? `http_${res.status}`);
  }
  return json;
}

export function timelineQuery(
  filters: TimelineFilters,
  cursor?: string | null,
  limit?: number,
): string {
  const params = new URLSearchParams();
  if (filters.year) params.set("year", String(filters.year));
  if (filters.personId) params.set("personId", filters.personId);
  if (filters.tagId) params.set("tagId", filters.tagId);
  if (filters.albumId) params.set("albumId", filters.albumId);
  if (filters.favorite) params.set("favorite", "true");
  if (cursor) params.set("cursor", cursor);
  if (limit) params.set("limit", String(limit));
  return params.toString();
}

export const fetchBootstrap = () => req<InitialData>("/api/bootstrap");

export const fetchTimeline = (
  filters: TimelineFilters,
  cursor?: string | null,
  limit?: number,
) => req<TimelinePage>(`/api/timeline?${timelineQuery(filters, cursor, limit)}`);

export const fetchPhoto = (id: string) =>
  req<PhotoDetail>(`/api/photos/${id}`);

export const refreshPhotoUrls = (photoIds: string[]) =>
  req<Photo[]>("/api/photos/refresh-urls", {
    method: "POST",
    body: JSON.stringify({ photoIds }),
  });

export const toggleFavorite = (id: string) =>
  req<{ favorite: boolean }>(`/api/photos/${id}/favorite`, { method: "POST" });

export const updateCaption = (id: string, caption: string | null) =>
  req<{ ok: true }>(`/api/photos/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ caption }),
  });

export const softDeletePhotos = (photoIds: string[]) =>
  req<{ deleted: string[] }>("/api/photos/delete", {
    method: "POST",
    body: JSON.stringify({ photoIds }),
  });

export const addComment = (photoId: string, body: string) =>
  req<Comment>(`/api/photos/${photoId}/comments`, {
    method: "POST",
    body: JSON.stringify({ body }),
  });

export const addReaction = (photoId: string, emoji: string) =>
  req<Reaction>(`/api/photos/${photoId}/reactions`, {
    method: "POST",
    body: JSON.stringify({ emoji }),
  });

export const removeReaction = (photoId: string, emoji: string) =>
  req<{ ok: true }>(`/api/photos/${photoId}/reactions`, {
    method: "DELETE",
    body: JSON.stringify({ emoji }),
  });

export const tagPerson = (
  photoId: string,
  input: { personId?: string; name?: string },
) =>
  req<Person>(`/api/photos/${photoId}/people`, {
    method: "POST",
    body: JSON.stringify(input),
  });

export const createAlbum = (title: string, photoIds: string[] = []) =>
  req<Album>("/api/albums", {
    method: "POST",
    body: JSON.stringify({ title, photoIds }),
  });

export const addPhotosToAlbum = (albumId: string, photoIds: string[]) =>
  req<{ ok: true }>(`/api/albums/${albumId}/photos`, {
    method: "POST",
    body: JSON.stringify({ photoIds }),
  });

export const fetchAlbum = (id: string) => req<AlbumDetail>(`/api/albums/${id}`);

export const login = (email: string) =>
  req<{ ok: true }>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email }),
  });

export const logout = () =>
  req<{ ok: true }>("/api/auth/logout", { method: "POST" });
