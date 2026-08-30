export type Photo = {
  id: string; url: string; thumbUrl: string; blurhash: string | null;
  width: number; height: number; takenAt: string; caption: string | null;
  favorite: boolean; people: Person[]; tags: Tag[]; uploadedBy: Member;
};
export type Person = { id: string; name: string; coverUrl: string | null };
export type Tag = { id: string; label: string };
export type Member = { id: string; displayName: string; avatarUrl: string | null };
export type Album = {
  id: string; title: string; kind: 'auto' | 'manual';
  coverUrl: string | null; photoCount: number;
  startDate: string | null; endDate: string | null;
};
export type Reaction = { id: string; emoji: string; member: Member; createdAt: string };
export type Comment = { id: string; body: string; member: Member; createdAt: string };

export type PersonWithCount = Person & { count: number };

export type TimelineFilters = {
  year?: number | null;
  personId?: string | null;
  tagId?: string | null;
  albumId?: string | null;
  favorite?: boolean;
};

export type TimelineMonth = { key: string; photos: Photo[] };

export type TimelinePage = {
  months: TimelineMonth[];
  photos: Photo[];
  nextCursor: string | null;
  total: number;
};

export type PhotoDetail = Photo & { reactions: Reaction[]; comments: Comment[] };

export type AlbumDetail = Album & { photos: Photo[] };

export type InitialData = {
  member: Member;
  role: 'owner' | 'member';
  timeline: TimelinePage;
  albums: Album[];
  people: PersonWithCount[];
  tags: Tag[];
  memories: Photo[];
  years: number[];
  currentYear: number;
  favCount: number;
};
