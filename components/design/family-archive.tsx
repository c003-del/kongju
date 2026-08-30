"use client";
import React from "react";
import Image from "next/image";
import AccountControls from "@/components/design/account-controls";
import type {
  Album,
  InitialData,
  PersonWithCount,
  Photo,
  PhotoDetail,
  Tag,
  TimelineFilters,
} from "@/lib/contracts";
import * as api from "@/lib/api-client";
import {
  currentSeoulDateParts,
  seoulDateParts,
  type SeoulDateParts,
} from "@/lib/date-time";

type CSS = React.CSSProperties;
type View = "timeline" | "albums" | "people" | "upload";

type Filter = {
  year: number | null;
  person: string | null;
  album: string | null;
  tag: string | null;
  fav: boolean;
};

type QueueItem = { id: string; name: string; pct: number; error?: string };
type UploadedItem = { name: string; thumbUrl: string };

type Props = {
  initial: InitialData;
  demoMode?: boolean;
  grayscaleIdle?: boolean;
  showHighlight?: boolean;
  slideshowMs?: number;
};

type State = {
  view: View;
  lightboxId: string | null;
  infoOpen: boolean;
  slideshow: boolean;
  selected: Record<string, boolean>;
  selecting: boolean;
  activeYear: number;
  count: number;
  filter: Filter;
  dragOver: boolean;
  queue: QueueItem[];
  uploaded: UploadedItem[];
  photos: Photo[];
  nextCursor: string | null;
  total: number;
  albums: Album[];
  people: PersonWithCount[];
  tags: Tag[];
  memories: Photo[];
  years: number[];
  favCount: number;
  detail: Record<string, PhotoDetail>;
  detailStatus: Record<string, "loading" | "ready" | "error">;
  today: SeoulDateParts | null;
  filterBusy: boolean;
  statusMessage: string | null;
  errorMessage: string | null;
};

const GRID_SIZES = "(min-width:1100px) 14vw, (min-width:720px) 20vw, 33vw";
const CARD_SIZES = "(min-width:720px) 240px, 90vw";

export default class FamilyArchive extends React.Component<Props, State> {
  fileInput = React.createRef<HTMLInputElement>();
  sentinel = React.createRef<HTMLDivElement>();
  dialog = React.createRef<HTMLDivElement>();
  infoButton = React.createRef<HTMLButtonElement>();
  infoPanel = React.createRef<HTMLElement>();
  ruleObs: IntersectionObserver | null = null;
  moreObs: IntersectionObserver | null = null;
  ssTimer: ReturnType<typeof setInterval> | null = null;
  countTimer: ReturnType<typeof setInterval> | null = null;
  urlRefreshTimer: ReturnType<typeof setInterval> | null = null;
  onScroll: (() => void) | null = null;
  onKey: ((e: KeyboardEvent) => void) | null = null;
  onVisibilityChange: (() => void) | null = null;
  fetchSeq = 0;
  detailFetchSeq = 0;
  detailRequests = new Map<string, number>();
  favoriteVersions = new Map<string, number>();
  favoritePending = new Set<string>();
  loadingMore = false;
  refreshingUrls = false;
  lastUrlRefreshAt = Date.now();
  mounted = false;
  lastFocusedElement: HTMLElement | null = null;
  previousBodyOverflow = "";

  constructor(props: Props) {
    super(props);
    const { initial } = props;
    const demoPhotos = Array.from(
      new Map(
        initial.timeline.photos
          .concat(initial.memories)
          .map((photo) => [photo.id, photo]),
      ).values(),
    );
    const demoDetail = props.demoMode
      ? Object.fromEntries(
          demoPhotos.map((photo) => [
            photo.id,
            { ...photo, reactions: [], comments: [] },
          ]),
        )
      : {};
    this.state = {
      view: "timeline",
      lightboxId: null,
      infoOpen: false,
      slideshow: false,
      selected: {},
      selecting: false,
      activeYear: initial.years[0] ?? initial.currentYear,
      count: 0,
      filter: { year: null, person: null, album: null, tag: null, fav: false },
      dragOver: false,
      queue: [],
      uploaded: [],
      photos: initial.timeline.photos,
      nextCursor: initial.timeline.nextCursor,
      total: initial.timeline.total,
      albums: initial.albums,
      people: initial.people,
      tags: initial.tags,
      memories: initial.memories,
      years: initial.years,
      favCount: initial.favCount,
      detail: demoDetail,
      detailStatus: props.demoMode
        ? Object.fromEntries(demoPhotos.map((photo) => [photo.id, "ready"]))
        : {},
      today: null,
      filterBusy: false,
      statusMessage: null,
      errorMessage: null,
    };
  }

  imgClass(): string {
    return this.props.grayscaleIdle === false ? "gsimg color" : "gsimg";
  }

  filterParams(f: Filter): TimelineFilters {
    return {
      year: f.year,
      personId: f.person,
      tagId: f.tag,
      albumId: f.album,
      favorite: f.fav,
    };
  }

  setError(message: string): void {
    this.setState({ errorMessage: message, statusMessage: null });
  }

  setStatus(message: string): void {
    this.setState({ statusMessage: message, errorMessage: null });
  }

  stopCountAnimation(): void {
    if (!this.countTimer) return;
    clearInterval(this.countTimer);
    this.countTimer = null;
  }

  showDemoReadOnlyMessage(): void {
    this.setStatus(
      "연습용 미리보기에서는 변경사항을 저장하지 않습니다. 실제 환경에서 이 기능을 연습해 주세요.",
    );
  }

  changeView(view: View): void {
    this.setState({
      view,
      lightboxId: null,
      selected: {},
      selecting: false,
      errorMessage: null,
      statusMessage: null,
    });
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  applyFilter(partial: Partial<Filter>): void {
    this.stopCountAnimation();
    const previousTotal = this.state.total;
    const filter = { ...this.state.filter, ...partial };
    if (this.props.demoMode) {
      let photos = this.props.initial.timeline.photos.slice();
      if (filter.year !== null) {
        photos = photos.filter(
          (photo) => seoulDateParts(photo.takenAt).year === filter.year,
        );
      }
      if (filter.person) {
        photos = photos.filter((photo) =>
          photo.people.some((person) => person.id === filter.person),
        );
      }
      if (filter.tag) {
        photos = photos.filter((photo) =>
          photo.tags.some((tag) => tag.id === filter.tag),
        );
      }
      if (filter.fav) {
        photos = photos.filter((photo) => photo.favorite);
      }
      if (filter.album) {
        const album = this.props.initial.albums.find(
          (candidate) => candidate.id === filter.album,
        );
        if (album?.kind === "auto") {
          const albumYear = Number.parseInt(album.title, 10);
          if (Number.isFinite(albumYear)) {
            photos = photos.filter(
              (photo) => seoulDateParts(photo.takenAt).year === albumYear,
            );
          }
        } else if (album) {
          photos = photos.slice(0, album.photoCount);
        }
      }
      this.setState({
        filter,
        selected: {},
        selecting: false,
        photos,
        nextCursor: null,
        total: photos.length,
        count: photos.length,
        filterBusy: false,
        errorMessage: null,
        statusMessage: `${photos.length}장의 연습용 사진을 표시합니다.`,
      });
      return;
    }
    this.setState({
      filter,
      count: previousTotal,
      selected: {},
      selecting: false,
      filterBusy: true,
      errorMessage: null,
      statusMessage: null,
    });
    const seq = ++this.fetchSeq;
    api
      .fetchTimeline(this.filterParams(filter))
      .then((page) => {
        if (seq !== this.fetchSeq) return;
        this.setState({
          photos: page.photos,
          nextCursor: page.nextCursor,
          total: page.total,
          count: page.total,
          filterBusy: false,
          statusMessage: `${page.total}장의 사진을 불러왔습니다.`,
        });
      })
      .catch(() => {
        if (seq !== this.fetchSeq) return;
        this.setState({
          filterBusy: false,
          errorMessage: "사진을 불러오지 못했습니다. 잠시 후 다시 시도하세요.",
        });
      });
  }

  loadMore(): void {
    if (this.props.demoMode) return;
    const { nextCursor, view } = this.state;
    if (!nextCursor || this.loadingMore || view !== "timeline") return;
    this.loadingMore = true;
    const seq = this.fetchSeq;
    api
      .fetchTimeline(this.filterParams(this.state.filter), nextCursor)
      .then((page) => {
        if (seq !== this.fetchSeq) return;
        this.setState((s) => {
          const seen = new Set(s.photos.map((p) => p.id));
          const merged = s.photos.concat(
            page.photos.filter((p) => !seen.has(p.id)),
          );
          return { ...s, photos: merged, nextCursor: page.nextCursor };
        });
      })
      .catch(() => {
        if (seq !== this.fetchSeq) return;
        this.setError("다음 사진을 불러오지 못했습니다. 다시 스크롤해 주세요.");
      })
      .finally(() => {
        this.loadingMore = false;
      });
  }

  refreshAll(): void {
    if (this.props.demoMode) return;
    this.stopCountAnimation();
    this.setState((state) => ({ count: state.total }));
    const seq = ++this.fetchSeq;
    api
      .fetchBootstrap()
      .then((initial) => {
        if (seq !== this.fetchSeq) return;
        this.setState({
          albums: initial.albums,
          people: initial.people,
          tags: initial.tags,
          memories: initial.memories,
          years: initial.years,
          favCount: initial.favCount,
        });
        const f = this.state.filter;
        if (f.year || f.person || f.album || f.tag || f.fav) {
          this.applyFilter({});
        } else {
          this.setState({
            photos: initial.timeline.photos,
            nextCursor: initial.timeline.nextCursor,
            total: initial.timeline.total,
            count: initial.timeline.total,
          });
        }
      })
      .catch(() => {
        this.setError("사진 보관함을 새로고침하지 못했습니다.");
      });
  }

  photosByIds(ids: string[]): Photo[] {
    const pool = new Map<string, Photo>();
    for (const p of this.state.photos) pool.set(p.id, p);
    for (const m of this.state.memories) if (!pool.has(m.id)) pool.set(m.id, m);
    return ids.flatMap((id) => {
      const p = pool.get(id);
      return p ? [p] : [];
    });
  }

  updatePhotoEverywhere(id: string, patch: Partial<Photo>): void {
    const map = (p: Photo) => (p.id === id ? { ...p, ...patch } : p);
    this.setState((s) => ({
      ...s,
      photos: s.photos.map(map),
      memories: s.memories.map(map),
      detail: s.detail[id]
        ? { ...s.detail, [id]: { ...s.detail[id], ...patch } }
        : s.detail,
    }));
  }

  removePhotosLocally(ids: string[]): void {
    this.stopCountAnimation();
    const gone = new Set(ids);
    const closesLightbox = Boolean(
      this.state.lightboxId && gone.has(this.state.lightboxId),
    );
    if (closesLightbox && this.ssTimer) {
      clearInterval(this.ssTimer);
      this.ssTimer = null;
    }
    this.setState(
      (s) => {
        const total = Math.max(0, s.total - ids.length);
        return {
          ...s,
          photos: s.photos.filter((p) => !gone.has(p.id)),
          memories: s.memories.filter((p) => !gone.has(p.id)),
          total,
          count: total,
          selected: {},
          selecting: false,
          lightboxId: closesLightbox ? null : s.lightboxId,
          infoOpen: closesLightbox ? false : s.infoOpen,
          slideshow: closesLightbox ? false : s.slideshow,
        };
      },
      () => {
        if (!closesLightbox) return;
        document.body.style.overflow = this.previousBodyOverflow;
        this.lastFocusedElement?.focus();
        this.lastFocusedElement = null;
      },
    );
  }

  deletePhotos(ids: string[]): void {
    if (ids.length === 0) return;
    if (this.props.demoMode) {
      this.showDemoReadOnlyMessage();
      return;
    }
    if (!window.confirm(`${ids.length}장을 삭제할까요?`)) return;
    api
      .softDeletePhotos(ids)
      .then(({ deleted }) => {
        this.removePhotosLocally(deleted);
        this.setStatus(`${deleted.length}장의 사진을 삭제했습니다.`);
        this.refreshAll();
      })
      .catch(() => {
        this.setError("사진을 삭제하지 못했습니다. 권한과 연결 상태를 확인하세요.");
      });
  }

  addToAlbum(ids: string[]): void {
    if (ids.length === 0) return;
    if (this.props.demoMode) {
      this.showDemoReadOnlyMessage();
      return;
    }
    const title = window.prompt("앨범 제목");
    if (!title || !title.trim()) return;
    const trimmed = title.trim();
    const existing = this.state.albums.find(
      (a) => a.kind === "manual" && a.title === trimmed,
    );
    const done = () => {
      this.setState({
        selected: {},
        selecting: false,
        statusMessage: `선택한 사진을 '${trimmed}' 앨범에 추가했습니다.`,
        errorMessage: null,
      });
      this.refreshAll();
    };
    const failed = () => {
      this.setError("앨범에 사진을 추가하지 못했습니다. 다시 시도하세요.");
    };
    if (existing) {
      api.addPhotosToAlbum(existing.id, ids).then(done).catch(failed);
    } else {
      api.createAlbum(trimmed, ids).then(done).catch(failed);
    }
  }

  downloadPhotos(photos: Photo[]): void {
    if (!this.props.demoMode) {
      photos.forEach((photo) => {
        const frame = document.createElement("iframe");
        frame.hidden = true;
        frame.title = "";
        frame.src = `/api/photos/${encodeURIComponent(photo.id)}/download`;
        document.body.appendChild(frame);
        window.setTimeout(() => frame.remove(), 60_000);
      });
      return;
    }
    photos.forEach((photo) => {
      const a = document.createElement("a");
      const url = new URL(photo.url, window.location.href);
      a.href = url.href;
      a.rel = "noopener noreferrer";
      a.download = photo.caption ?? photo.id;
      document.body.appendChild(a);
      a.click();
      a.remove();
    });
  }

  enqueueFiles(files: File[]): void {
    if (this.props.demoMode) {
      this.showDemoReadOnlyMessage();
      return;
    }
    const supportedTypes = new Set([
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/gif",
      "image/avif",
    ]);
    const images = files.filter(
      (file) =>
        supportedTypes.has(file.type) ||
        (!file.type && /\.(?:jpe?g|png|webp|gif|avif)$/i.test(file.name)),
    );
    const rejected = files.length - images.length;
    if (rejected > 0) {
      this.setError(
        "HEIC/HEIF를 포함한 일부 형식은 브라우저에서 바로 올릴 수 없습니다. JPG, PNG, WebP, GIF 또는 AVIF로 변환해 주세요.",
      );
    }
    if (images.length === 0) return;
    const base = Date.now();
    const items = images.map((file, i) => ({
      item: { id: `up${base}${i}`, name: file.name, pct: 0 },
      file,
    }));
    this.setState((s) => ({
      ...s,
      queue: s.queue.concat(items.map((x) => x.item)),
    }));

    const run = async () => {
      let uploadPhotoFile: typeof import("@/lib/upload/pipeline")["uploadPhotoFile"];
      try {
        ({ uploadPhotoFile } = await import("@/lib/upload/pipeline"));
      } catch {
        if (!this.mounted) return;
        this.setState((state) => ({
          queue: state.queue.map((queued) =>
            items.some(({ item }) => item.id === queued.id)
              ? { ...queued, error: "업로드 기능을 불러오지 못했습니다." }
              : queued,
          ),
          errorMessage:
            "업로드 기능을 불러오지 못했습니다. 새로고침 후 다시 시도하세요.",
          statusMessage: null,
        }));
        return;
      }
      for (const { item, file } of items) {
        try {
          const outcome = await uploadPhotoFile(file, (pct) => {
            if (!this.mounted) return;
            this.setState((s) => ({
              ...s,
              queue: s.queue.map((q) =>
                q.id === item.id ? { ...q, pct: Math.round(pct) } : q,
              ),
            }));
          });
          if (!this.mounted) {
            URL.revokeObjectURL(outcome.previewUrl);
            continue;
          }
          this.setState((s) => ({
            ...s,
            queue: s.queue.filter((q) => q.id !== item.id),
            uploaded: s.uploaded.concat([
              { name: file.name, thumbUrl: outcome.previewUrl },
            ]),
            statusMessage: `${file.name} 업로드를 완료했습니다.`,
            errorMessage: null,
          }));
        } catch {
          if (!this.mounted) continue;
          this.setState((s) => ({
            ...s,
            queue: s.queue.map((q) =>
              q.id === item.id
                ? {
                    ...q,
                    error: "업로드하지 못했습니다. 파일 형식과 연결 상태를 확인하세요.",
                  }
                : q,
            ),
            errorMessage: `${file.name} 업로드에 실패했습니다.`,
            statusMessage: null,
          }));
        }
      }
      if (this.mounted) this.refreshAll();
    };
    void run();
  }

  navBtnStyle(active: boolean): CSS {
    return {
      border: "none",
      background: "transparent",
      cursor: "pointer",
      padding: "10px 2px",
      minHeight: "44px",
      fontSize: "14px",
      fontWeight: active ? 800 : 500,
      color: "var(--color-text)",
      textAlign: "left",
      letterSpacing: "0.02em",
      borderBottom: active
        ? "2px solid var(--color-accent)"
        : "2px solid transparent",
    };
  }

  chip(active: boolean): CSS {
    return {
      border: "2px solid var(--color-text)",
      background: active ? "var(--color-accent)" : "transparent",
      color: active ? "#fff" : "var(--color-text)",
      borderColor: active ? "var(--color-accent)" : "var(--color-text)",
      fontSize: "13px",
      fontWeight: 700,
      padding: "8px 14px",
      cursor: "pointer",
      minHeight: "40px",
      letterSpacing: "0.02em",
    };
  }

  filteredPhotos(): Photo[] {
    return this.state.photos;
  }

  shortCaption(c: string | null): string {
    if (!c) return "";
    const max = /[가-힣ㄱ-ㆎ]/.test(c) ? 15 : 30;
    return c.length > max ? c.slice(0, max) + "…" : c;
  }

  fmtDate(iso: string): string {
    const date = seoulDateParts(iso);
    return `${date.year}년 ${date.month}월 ${date.day}일`;
  }

  fmtTime(iso: string): string {
    const date = seoulDateParts(iso);
    const hour = String(date.hour).padStart(2, "0");
    const minute = String(date.minute).padStart(2, "0");
    return `${hour}:${minute}`;
  }

  fmtShortDate(iso: string): string {
    const date = seoulDateParts(iso);
    return `${String(date.month).padStart(2, "0")}.${String(date.day).padStart(2, "0")}`;
  }

  mergeFreshAssets<T extends Photo>(existing: T, fresh: Photo): T {
    return {
      ...existing,
      url: fresh.url,
      thumbUrl: fresh.thumbUrl,
      blurhash: fresh.blurhash,
      width: fresh.width,
      height: fresh.height,
    };
  }

  loadPhotoDetail(id: string): void {
    if (this.props.demoMode) return;
    const request = ++this.detailFetchSeq;
    const favoriteVersion = this.favoriteVersions.get(id) ?? 0;
    this.detailRequests.set(id, request);
    this.setState((state) => ({
      detailStatus: { ...state.detailStatus, [id]: "loading" },
    }));
    api
      .fetchPhoto(id)
      .then((detail) => {
        if (this.detailRequests.get(id) !== request) return;
        this.setState((state) => ({
          detail: {
            ...state.detail,
            [id]: (() => {
              const current =
                state.detail[id] ??
                state.photos.find((photo) => photo.id === id) ??
                state.memories.find((photo) => photo.id === id);
              const preserveFavorite =
                this.favoritePending.has(id) ||
                (this.favoriteVersions.get(id) ?? 0) !== favoriteVersion;
              return preserveFavorite && current
                ? { ...detail, favorite: current.favorite }
                : detail;
            })(),
          },
          detailStatus: { ...state.detailStatus, [id]: "ready" },
          photos: state.photos.map((photo) =>
            photo.id === id ? this.mergeFreshAssets(photo, detail) : photo,
          ),
          memories: state.memories.map((photo) =>
            photo.id === id ? this.mergeFreshAssets(photo, detail) : photo,
          ),
        }));
      })
      .catch(() => {
        if (this.detailRequests.get(id) !== request) return;
        this.setState((state) => ({
          detailStatus: { ...state.detailStatus, [id]: "error" },
        }));
      });
  }

  refreshVisiblePhotoUrls(): void {
    if (
      this.props.demoMode ||
      this.refreshingUrls ||
      Date.now() - this.lastUrlRefreshAt < 45 * 60 * 1000
    ) {
      return;
    }
    const ids = Array.from(
      new Set(
        this.state.photos
          .concat(this.state.memories)
          .map((photo) => photo.id),
      ),
    );
    this.refreshingUrls = true;
    const batches: string[][] = [];
    for (let index = 0; index < ids.length; index += 200) {
      batches.push(ids.slice(index, index + 200));
    }
    const refreshBatches = async () => {
      const photosPromise = (async () => {
        const photos: Photo[] = [];
        for (const batch of batches) {
          photos.push(...(await api.refreshPhotoUrls(batch)));
        }
        return photos;
      })();
      const [initial, photos] = await Promise.all([
        api.fetchBootstrap(),
        photosPromise,
      ]);
      return { photos, initial };
    };
    void refreshBatches()
      .then(({ photos, initial }) => {
        if (!this.mounted) return;
        this.lastUrlRefreshAt = Date.now();
        const refreshed = new Map(photos.map((photo) => [photo.id, photo]));
        const albumCovers = new Map(
          initial.albums.map((album) => [album.id, album.coverUrl]),
        );
        const peopleCovers = new Map(
          initial.people.map((person) => [person.id, person.coverUrl]),
        );
        const merge = (photo: Photo) => {
          const fresh = refreshed.get(photo.id);
          return fresh ? this.mergeFreshAssets(photo, fresh) : photo;
        };
        this.setState((state) => ({
          photos: state.photos.map(merge),
          memories: state.memories.map(merge),
          albums: state.albums.map((album) =>
            albumCovers.has(album.id)
              ? { ...album, coverUrl: albumCovers.get(album.id) ?? null }
              : album,
          ),
          people: state.people.map((person) =>
            peopleCovers.has(person.id)
              ? { ...person, coverUrl: peopleCovers.get(person.id) ?? null }
              : person,
          ),
          detail: Object.fromEntries(
            Object.entries(state.detail).map(([id, detail]) => {
              const fresh = refreshed.get(id);
              return [
                id,
                fresh ? this.mergeFreshAssets(detail, fresh) : detail,
              ];
            }),
          ),
        }));
      })
      .catch(() => {})
      .finally(() => {
        this.refreshingUrls = false;
      });
  }

  showLightboxPhoto(id: string): void {
    this.setState({ lightboxId: id });
    this.loadPhotoDetail(id);
  }

  openLightbox(id: string): void {
    this.lastFocusedElement = document.activeElement as HTMLElement | null;
    const open = () =>
      this.setState(
        { lightboxId: id, infoOpen: false, slideshow: false },
        () => {
          this.previousBodyOverflow = document.body.style.overflow;
          document.body.style.overflow = "hidden";
          this.dialog.current?.focus();
        },
      );
    if (
      document.startViewTransition &&
      !matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      try {
        const vt = document.startViewTransition(open);
        if (vt && vt.finished) vt.finished.catch(() => {});
        if (vt && vt.ready) vt.ready.catch(() => {});
      } catch {
        open();
      }
    } else {
      open();
    }
    this.loadPhotoDetail(id);
  }

  cellClick(p: Photo, ev: React.MouseEvent): void {
    if (this.state.selecting || ev.shiftKey) {
      const sel = Object.assign({}, this.state.selected);
      if (sel[p.id]) delete sel[p.id];
      else sel[p.id] = true;
      this.setState({
        selected: sel,
        selecting: true,
        statusMessage: `${Object.keys(sel).length}장의 사진을 선택했습니다.`,
        errorMessage: null,
      });
    } else this.openLightbox(p.id);
  }

  timelineVals() {
    const s = this.state;
    const f = s.filter;
    const photos = this.filteredPhotos();
    const byMonth: Record<string, Photo[]> = {};
    photos.forEach((p) => {
      const date = seoulDateParts(p.takenAt);
      const k = `${date.year}-${String(date.month).padStart(2, "0")}`;
      (byMonth[k] = byMonth[k] || []).push(p);
    });
    const months = Object.keys(byMonth)
      .sort()
      .reverse()
      .map((k) => {
        const list = byMonth[k];
        return {
          key: k,
          year: k.slice(0, 4),
          label: k.slice(0, 4) + "년 " + parseInt(k.slice(5), 10) + "월",
          count: list.length,
          cells: list.map((p, i) => ({
            id: p.id,
            thumbUrl: p.thumbUrl,
            favorite: p.favorite,
            hasCaption: !!p.caption,
            captionShort: this.shortCaption(p.caption),
            alt: p.caption || this.fmtDate(p.takenAt),
            cls: "pcell" + (s.selected[p.id] ? " sel" : ""),
            selected: Boolean(s.selected[p.id]),
            click: (ev: React.MouseEvent) => this.cellClick(p, ev),
            style: {
              border: "none",
              padding: 0,
              cursor: "pointer",
              background: "var(--color-bg)",
              position: "relative",
              display: "block",
              animationDelay: Math.min(i, 12) * 40 + "ms",
              viewTransitionName:
                s.lightboxId === p.id ? "photo-" + p.id : "none",
            } as CSS,
          })),
        };
      });
    const today = s.today;
    const currentYear = today?.year ?? this.props.initial.currentYear;
    const memories = s.memories.map((m) => ({
      id: m.id,
      thumbUrl: m.thumbUrl,
      alt: m.caption || this.fmtDate(m.takenAt),
      badge:
        currentYear - seoulDateParts(m.takenAt).year + "년 전 오늘",
      open: () => this.openLightbox(m.id),
    }));
    const years = s.years;
    const yearBtn = (y: number, active: boolean) => ({
      label: String(y),
      go: () => this.applyFilter({ year: f.year === y ? null : y }),
      style: this.chip(active),
      active,
    });
    const railIx = years.indexOf(s.activeYear);
    return {
      hasMemories: memories.length > 0,
      memories,
      todayLabel: today ? `${today.month}월 ${today.day}일` : "오늘",
      showHighlight: this.props.showHighlight ?? true,
      currentYear,
      favCount: s.favCount,
      yearChips: years.map((y) => yearBtn(y, f.year === y)),
      tagChips: s.tags.map((t) => ({
        id: t.id,
        label: t.label,
        go: () => this.applyFilter({ tag: f.tag === t.id ? null : t.id }),
        style: this.chip(f.tag === t.id),
        active: f.tag === t.id,
      })),
      toggleFav: () => this.applyFilter({ fav: !f.fav }),
      favStyle: this.chip(f.fav),
      favActive: f.fav,
      personFilterOn: !!(f.person || f.album),
      personFilterName: f.person
        ? (s.people.find((p) => p.id === f.person) || { name: "" }).name
        : f.album
          ? (s.albums.find((a) => a.id === f.album) || { title: "" }).title
          : "",
      personChipStyle: this.chip(true),
      clearPerson: () => this.applyFilter({ person: null, album: null }),
      railYears: years.map((y) => ({
        label: String(y),
        go: () => {
          const el = document.querySelector('[data-year="' + y + '"]');
          if (el) {
            window.scrollTo({
              top: el.getBoundingClientRect().top + window.scrollY - 120,
              behavior: "smooth",
            });
          }
        },
        style: {
          border: "none",
          background: "transparent",
          cursor: "pointer",
          padding: "0 4px 0 14px",
          minHeight: "28px",
          fontSize: "13px",
          fontWeight: s.activeYear === y ? 800 : 500,
          color:
            s.activeYear === y
              ? "var(--color-text)"
              : "var(--color-neutral-600)",
          textAlign: "left",
          fontFeatureSettings: '"tnum" 1',
        } as CSS,
        current: s.activeYear === y,
      })),
      yearMarkStyle: {
        position: "absolute",
        left: "0px",
        top: "10px",
        width: "8px",
        height: "8px",
        background: "var(--color-accent)",
        transition: "transform 380ms cubic-bezier(0.16,1,0.3,1)",
        transform: "translateY(" + (railIx < 0 ? 0 : railIx * 42) + "px)",
      } as CSS,
      months,
      countUp: s.count,
    };
  }

  componentDidMount(): void {
    this.mounted = true;
    this.setState({ today: currentSeoulDateParts() });
    const total = this.state.total;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      this.setState({ count: total });
    } else {
      const t0 = Date.now();
      this.countTimer = setInterval(() => {
        const p = Math.min(1, (Date.now() - t0) / 900);
        const e = 1 - Math.pow(1 - p, 3);
        this.setState({ count: Math.round(total * e) });
        if (p >= 1) {
          if (this.countTimer) clearInterval(this.countTimer);
          this.countTimer = null;
          this.setState({ count: total });
        }
      }, 40);
    }
    this.ruleObs = new IntersectionObserver(
      (es) =>
        es.forEach((e) => {
          if (e.isIntersecting) {
            const r = e.target.querySelector(".rule");
            if (r) r.classList.add("in");
            this.ruleObs?.unobserve(e.target);
          }
        }),
      { threshold: 0.1 },
    );
    this.observeRules();
    this.moreObs = new IntersectionObserver(
      (es) =>
        es.forEach((e) => {
          if (e.isIntersecting) this.loadMore();
        }),
      { rootMargin: "800px" },
    );
    this.observeSentinel();
    this.onScroll = () => {
      const secs = document.querySelectorAll("[data-year]");
      let last: number | null = null;
      secs.forEach((el) => {
        if (el.getBoundingClientRect().top < 200)
          last = parseInt(el.getAttribute("data-year") ?? "", 10);
      });
      if (last && last !== this.state.activeYear)
        this.setState({ activeYear: last });
    };
    window.addEventListener("scroll", this.onScroll, { passive: true });
    this.onKey = (e: KeyboardEvent) => {
      if (!this.state.lightboxId) {
        return;
      }
      const target = e.target as HTMLElement | null;
      const interactive = Boolean(
        target?.closest(
          "button, input, textarea, select, a[href], [contenteditable='true']",
        ),
      );
      if (e.key === "Tab") {
        const focusRoot = this.state.infoOpen
          ? this.infoPanel.current
          : this.dialog.current;
        const focusable = Array.from(
          focusRoot?.querySelectorAll<HTMLElement>(
            "button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])",
          ) ?? [],
        ).filter((element) => !element.hasAttribute("hidden"));
        if (focusable.length === 0) {
          e.preventDefault();
          focusRoot?.focus();
          return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (
          e.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === focusRoot)
        ) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
        return;
      }
      if (e.key === "Escape") {
        if (this.state.infoOpen) this.toggleInfo(false);
        else this.closeLightbox();
      } else if (!interactive && e.key === "ArrowRight") this.stepLightbox(1);
      else if (!interactive && e.key === "ArrowLeft") this.stepLightbox(-1);
      else if (!interactive && (e.key === "f" || e.key === "F"))
        this.toggleFavCurrent();
      else if (!interactive && (e.key === "i" || e.key === "I"))
        this.toggleInfo();
      else if (!interactive && e.key === " ") {
        e.preventDefault();
        this.toggleSlideshow();
      }
    };
    window.addEventListener("keydown", this.onKey);
    if (!this.props.demoMode) {
      this.urlRefreshTimer = setInterval(
        () => this.refreshVisiblePhotoUrls(),
        5 * 60 * 1000,
      );
      this.onVisibilityChange = () => {
        if (document.visibilityState === "visible") {
          this.refreshVisiblePhotoUrls();
        }
      };
      document.addEventListener("visibilitychange", this.onVisibilityChange);
    }
  }

  componentDidUpdate(): void {
    this.observeRules();
    this.observeSentinel();
  }

  componentWillUnmount(): void {
    this.mounted = false;
    if (this.onScroll) window.removeEventListener("scroll", this.onScroll);
    if (this.onKey) window.removeEventListener("keydown", this.onKey);
    if (this.ruleObs) this.ruleObs.disconnect();
    if (this.moreObs) this.moreObs.disconnect();
    if (this.ssTimer) clearInterval(this.ssTimer);
    if (this.countTimer) clearInterval(this.countTimer);
    if (this.urlRefreshTimer) clearInterval(this.urlRefreshTimer);
    if (this.onVisibilityChange) {
      document.removeEventListener("visibilitychange", this.onVisibilityChange);
    }
    document.body.style.overflow = this.previousBodyOverflow;
    for (const item of this.state.uploaded) {
      URL.revokeObjectURL(item.thumbUrl);
    }
  }

  observeRules(): void {
    document.querySelectorAll(".rulewrap").forEach((el) => {
      if (!el.querySelector(".rule.in")) this.ruleObs?.observe(el);
    });
  }

  observeSentinel(): void {
    if (!this.moreObs) return;
    this.moreObs.disconnect();
    if (this.sentinel.current) this.moreObs.observe(this.sentinel.current);
  }

  closeLightbox(): void {
    if (this.ssTimer) {
      clearInterval(this.ssTimer);
      this.ssTimer = null;
    }
    const id = this.state.lightboxId;
    this.setState(
      { lightboxId: null, infoOpen: false, slideshow: false },
      () => {
        document.body.style.overflow = this.previousBodyOverflow;
        if (this.lastFocusedElement?.isConnected) {
          this.lastFocusedElement.focus();
          this.lastFocusedElement = null;
          return;
        }
        const el = document.querySelector(
          '[data-cellid="' + id + '"]',
        ) as HTMLElement | null;
        if (el) el.focus();
        this.lastFocusedElement = null;
      },
    );
  }

  toggleInfo(forceOpen?: boolean): void {
    const open = forceOpen ?? !this.state.infoOpen;
    this.setState({ infoOpen: open }, () => {
      if (open) {
        this.infoPanel.current?.focus();
      } else {
        this.infoButton.current?.focus();
      }
    });
  }

  lbList(): Photo[] {
    const list = this.filteredPhotos();
    const id = this.state.lightboxId;
    if (id && !list.some((p) => p.id === id)) {
      const memory = this.state.memories.find((m) => m.id === id);
      if (memory) return this.state.memories;
    }
    return list;
  }

  stepLightbox(dir: number): void {
    const list = this.lbList();
    const ix = list.findIndex((p) => p.id === this.state.lightboxId);
    if (ix < 0 || !list.length) return;
    const next = list[(ix + dir + list.length) % list.length];
    this.showLightboxPhoto(next.id);
  }

  toggleFavCurrent(): void {
    const id = this.state.lightboxId;
    if (!id) return;
    const photo = this.state.detail[id] ?? this.photosByIds([id])[0];
    if (!photo) return;
    if (this.props.demoMode) {
      this.showDemoReadOnlyMessage();
      return;
    }
    if (this.favoritePending.has(id)) {
      this.setStatus("즐겨찾기를 변경하는 중입니다.");
      return;
    }
    this.favoritePending.add(id);
    this.favoriteVersions.set(id, (this.favoriteVersions.get(id) ?? 0) + 1);
    const previousFav = photo.favorite;
    const nextFav = !photo.favorite;
    this.updatePhotoEverywhere(id, { favorite: nextFav });
    const year = seoulDateParts(photo.takenAt).year;
    const adjustFavoriteCount = (from: boolean, to: boolean) => {
      if (year !== this.props.initial.currentYear || from === to) return;
      this.setState((s) => ({
        ...s,
        favCount: Math.max(0, s.favCount + (to ? 1 : -1)),
      }));
    };
    adjustFavoriteCount(previousFav, nextFav);
    api
      .toggleFavorite(id)
      .then(({ favorite }) => {
        this.favoritePending.delete(id);
        this.favoriteVersions.set(
          id,
          (this.favoriteVersions.get(id) ?? 0) + 1,
        );
        this.updatePhotoEverywhere(id, { favorite });
        adjustFavoriteCount(nextFav, favorite);
        this.setStatus(favorite ? "즐겨찾기에 추가했습니다." : "즐겨찾기에서 뺐습니다.");
      })
      .catch(() => {
        this.favoritePending.delete(id);
        this.favoriteVersions.set(
          id,
          (this.favoriteVersions.get(id) ?? 0) + 1,
        );
        this.updatePhotoEverywhere(id, { favorite: previousFav });
        adjustFavoriteCount(nextFav, previousFav);
        this.setError("즐겨찾기를 변경하지 못했습니다.");
      });
  }

  toggleSlideshow(): void {
    if (this.ssTimer) {
      clearInterval(this.ssTimer);
      this.ssTimer = null;
      this.setState({ slideshow: false });
    } else {
      this.setState({ slideshow: true });
      this.ssTimer = setInterval(
        () => this.stepLightbox(1),
        this.props.slideshowMs ?? 7000,
      );
    }
  }

  albumCard(a: Album) {
    return {
      id: a.id,
      title: a.title,
      coverUrl: a.coverUrl,
      meta: a.photoCount + "장",
      period:
        a.kind === "manual" && a.startDate
          ? a.startDate.replaceAll("-", ".") +
            (a.endDate && a.endDate !== a.startDate
              ? " — " + a.endDate.replaceAll("-", ".")
              : "")
          : a.title + ".01 — " + a.title + ".12",
      open: () => {
        if (a.kind === "auto") {
          this.changeView("timeline");
          this.applyFilter({ year: parseInt(a.title, 10), album: null });
        } else {
          this.changeView("timeline");
          this.applyFilter({ album: a.id, year: null });
        }
      },
    };
  }

  albumVals() {
    return {
      autoAlbums: this.state.albums
        .filter((a) => a.kind === "auto")
        .map((a) => this.albumCard(a)),
      manualAlbums: this.state.albums
        .filter((a) => a.kind === "manual")
        .map((a) => this.albumCard(a)),
    };
  }

  peopleVals() {
    return {
      personTotal: this.state.people.length,
      persons: this.state.people.map((p) => ({
        id: p.id,
        name: p.name,
        coverUrl: p.coverUrl,
        count: p.count,
        open: () => {
          this.changeView("timeline");
          this.applyFilter({ person: p.id, album: null });
        },
      })),
    };
  }

  uploadVals() {
    const s = this.state;
    return {
      dzStyle: {
        minHeight: "70vh",
        outline: s.dragOver
          ? "2px solid var(--color-accent)"
          : "2px solid transparent",
        outlineOffset: "-8px",
      } as CSS,
      dzOver: (e: React.DragEvent) => {
        e.preventDefault();
        if (!s.dragOver) this.setState({ dragOver: true });
      },
      dzLeave: () => this.setState({ dragOver: false }),
      dzDrop: (e: React.DragEvent) => {
        e.preventDefault();
        this.setState({ dragOver: false });
        this.enqueueFiles(Array.from(e.dataTransfer?.files ?? []));
      },
      pickFiles: () => {
        if (this.props.demoMode) this.showDemoReadOnlyMessage();
        else this.fileInput.current?.click();
      },
      queue: s.queue.map((q) => ({
        id: q.id,
        name: q.name,
        pct: Math.round(q.pct),
        error: q.error,
        barStyle: {
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: "100%",
          background: "var(--color-accent)",
          transform: "scaleX(" + q.pct / 100 + ")",
          transformOrigin: "left",
          transition: "transform 200ms linear",
        } as CSS,
      })),
      hasUploaded: s.uploaded.length > 0,
      uploadedCount: s.uploaded.length,
      uploadedCells: s.uploaded.map((u) => ({
        name: u.name,
        style: {
          width: "100%",
          aspectRatio: "1/1",
          backgroundImage: "url(" + u.thumbUrl + ")",
          backgroundSize: "cover",
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
        } as CSS,
      })),
    };
  }

  lightboxVals() {
    const s = this.state;
    if (!s.lightboxId) return null;
    const list = this.lbList();
    const ix = list.findIndex((p) => p.id === s.lightboxId);
    const p = list[ix] ?? this.photosByIds([s.lightboxId])[0];
    if (!p) return null;
    const detail = s.detail[p.id];
    const current = detail ?? p;
    const detailStatus = s.detailStatus[p.id];
    const detailReady = detailStatus === "ready";
    const wbtn: CSS = {
      border: "2px solid #fff",
      background: "transparent",
      color: "#fff",
      fontWeight: 700,
      fontSize: "13px",
      padding: "8px 14px",
      cursor: "pointer",
      minHeight: "44px",
      letterSpacing: "0.02em",
    };
    return {
      lbAlt: current.caption || this.fmtDate(current.takenAt),
      lbIndexLabel: (ix < 0 ? 1 : ix + 1) + " / " + Math.max(list.length, 1),
      lbImgs: [
        {
          key: `${p.id}:${current.url}`,
          alt: current.caption || this.fmtDate(current.takenAt),
          src: current.url,
          width: Math.max(1, current.width),
          height: Math.max(1, current.height),
          style: {
            viewTransitionName: "photo-" + p.id,
            animation: s.slideshow ? "kenburns 7000ms linear both" : "none",
          } as CSS,
        },
      ],
      lbClose: () => this.closeLightbox(),
      lbPrev: () => this.stepLightbox(-1),
      lbNext: () => this.stepLightbox(1),
      lbActions: [
        {
          label: current.favorite ? "★ 즐겨찾기" : "☆ 즐겨찾기",
          go: () => this.toggleFavCurrent(),
          style: Object.assign(
            {},
            wbtn,
            current.favorite
              ? { background: "#fff", color: "var(--color-text)" }
              : {},
          ) as CSS,
          pressed: current.favorite,
        },
        { label: "앨범 추가", go: () => this.addToAlbum([p.id]), style: wbtn },
        {
          label: "다운로드",
          go: () => this.downloadPhotos([current]),
          style: wbtn,
        },
        {
          label: "삭제",
          go: () => this.deletePhotos([p.id]),
          style: Object.assign({}, wbtn, {
            borderColor: "var(--color-accent-2)",
            color: "var(--color-accent-2)",
          }) as CSS,
          pressed: undefined,
        },
      ],
      lbInfoToggle: () => this.toggleInfo(),
      lbSlideshow: () => this.toggleSlideshow(),
      ssLabel: s.slideshow ? "정지" : "슬라이드쇼",
      ssBtnStyle: Object.assign(
        {},
        wbtn,
        s.slideshow ? { background: "#fff", color: "var(--color-text)" } : {},
      ) as CSS,
      infoOpen: s.infoOpen,
      detailLoading: detailStatus === "loading" || !detailStatus,
      detailError: detailStatus === "error",
      retryDetail: () => this.loadPhotoDetail(p.id),
      lbTaken: this.fmtDate(current.takenAt) + " " + this.fmtTime(current.takenAt),
      lbPeople: current.people.map((x) => x.name).join(", ") || "—",
      lbTags: current.tags.map((x) => "#" + x.label).join(" ") || "—",
      lbUploader: current.uploadedBy.displayName,
      lbSize: current.width + " × " + current.height,
      lbReactions: (detailReady ? (detail?.reactions ?? []) : []).map((r) => ({
        id: r.id,
        emoji: r.emoji,
        name: r.member.displayName,
      })),
      lbComments: (detailReady ? (detail?.comments ?? []) : []).map((c) => ({
        id: c.id,
        name: c.member.displayName,
        body: c.body,
        time: this.fmtShortDate(c.createdAt),
      })),
      filmstrip: list
        .slice(Math.max(0, ix - 8), ix + 9)
        .map((f) => ({
          id: f.id,
          thumbUrl: f.thumbUrl,
          alt: f.caption || this.fmtDate(f.takenAt),
          go: () => this.showLightboxPhoto(f.id),
          current: f.id === p.id,
          style: {
            border: "none",
            padding: 0,
            cursor: "pointer",
            flex: "0 0 auto",
            background: "transparent",
            outline:
              f.id === p.id ? "2px solid var(--color-accent)" : "none",
            outlineOffset: "-2px",
            opacity: f.id === p.id ? 1 : 0.55,
          } as CSS,
        })),
    };
  }

  selVals() {
    const s = this.state;
    const btn: CSS = {
      border: "2px solid var(--color-bg)",
      background: "transparent",
      color: "var(--color-bg)",
      fontWeight: 700,
      fontSize: "13px",
      padding: "8px 14px",
      cursor: "pointer",
      minHeight: "44px",
    };
    const clear = () => this.setState({ selected: {}, selecting: false });
    const ids = Object.keys(s.selected);
    return {
      selCount: ids.length,
      selBtnStyle: btn,
      selDelStyle: Object.assign({}, btn, {
        borderColor: "var(--color-accent)",
        color: "#fff",
        background: "var(--color-accent)",
      }) as CSS,
      selAlbum: () => this.addToAlbum(ids),
      selDownload: () => {
        this.downloadPhotos(this.photosByIds(ids));
        clear();
      },
      selDelete: () => this.deletePhotos(ids),
      selClear: clear,
    };
  }

  render() {
    const s = this.state;
    const views: [View, string][] = [
      ["timeline", "타임라인"],
      ["albums", "앨범"],
      ["people", "인물"],
    ];
    const navItems = views.map((v) => ({
      key: v[0],
      label: v[1],
      go: () => this.changeView(v[0]),
      style: this.navBtnStyle(s.view === v[0]),
    }));
    const t = this.timelineVals();
    const a = this.albumVals();
    const pe = this.peopleVals();
    const u = this.uploadVals();
    const lb = this.lightboxVals();
    const sel = this.selVals();
    const imgClass = this.imgClass();

    return (
      <div
        style={{
          minHeight: "100vh",
          background: "var(--color-bg)",
          color: "var(--color-text)",
          fontFamily: "var(--font-body)",
        }}
      >
        {!lb && (
          <a className="skip-link" href="#archive-main">
            본문으로 바로가기
          </a>
        )}
        <header
          className="app-header"
          data-screen-label="Nav"
          aria-hidden={lb ? true : undefined}
          inert={Boolean(lb)}
        >
          <div className="brand-lockup">
            <span
              style={{
                width: "12px",
                height: "12px",
                background: "var(--color-accent)",
                display: "inline-block",
                transform: "translateY(1px)",
              }}
            ></span>
            <strong
              style={{
                fontFamily: "var(--font-heading)",
                fontWeight: 800,
                fontSize: "18px",
                letterSpacing: "-0.01em",
                textTransform: "uppercase",
              }}
            >
              FAMILY PHOTO
            </strong>
          </div>
          <nav className="desktop-nav" aria-label="주요 화면">
            {navItems.map((nav) => (
              <button
                key={nav.key}
                onClick={nav.go}
                style={nav.style}
                aria-current={s.view === nav.key ? "page" : undefined}
              >
                {nav.label}
              </button>
            ))}
          </nav>
          <button
            className="desktop-upload-button"
            onClick={() => this.changeView("upload")}
            aria-current={s.view === "upload" ? "page" : undefined}
            style={{
              border: "2px solid var(--color-text)",
              background: "var(--color-text)",
              color: "var(--color-bg)",
              fontWeight: 700,
              fontSize: "13px",
              padding: "10px 18px",
              cursor: "pointer",
              letterSpacing: "0.04em",
              minHeight: "44px",
            }}
          >
            업로드
          </button>
          {this.props.demoMode ? (
            <span className="training-badge">연습용 · 읽기 전용</span>
          ) : (
            <AccountControls
              displayName={this.props.initial.member.displayName}
              role={this.props.initial.role}
            />
          )}
        </header>

        {(s.errorMessage || s.statusMessage) && (
          <div
            className={`app-feedback ${s.errorMessage ? "error" : "success"}`}
            role={s.errorMessage ? "alert" : "status"}
            aria-live="polite"
            aria-hidden={lb ? true : undefined}
            inert={Boolean(lb)}
          >
            <span>{s.errorMessage ?? s.statusMessage}</span>
            <button
              type="button"
              onClick={() =>
                this.setState({ errorMessage: null, statusMessage: null })
              }
              aria-label="알림 닫기"
            >
              닫기
            </button>
          </div>
        )}

        <main
          id="archive-main"
          className="archive-main"
          aria-hidden={lb ? true : undefined}
          inert={Boolean(lb)}
        >
          <h1 className="sr-only">가족 사진 보관함</h1>

        {s.view === "timeline" && (
          <div data-screen-label="타임라인">
            <h2 className="sr-only">타임라인</h2>
            {t.hasMemories && (
              <section data-screen-label="오늘의 기억" style={{ padding: "24px 24px 0 24px" }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    gap: "12px",
                    marginBottom: "8px",
                  }}
                >
                  <span
                    style={{
                      fontFamily: "var(--font-heading)",
                      fontWeight: 800,
                      fontSize: "14px",
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                    }}
                  >
                    오늘의 기억
                  </span>
                  <span
                    style={{
                      fontSize: "13px",
                      color: "var(--color-neutral-600)",
                      fontFeatureSettings: "'tnum' 1",
                    }}
                  >
                    {t.todayLabel}
                  </span>
                </div>
                <div className="rulewrap">
                  <div className="rule"></div>
                </div>
                <div
                  className="memstrip"
                  style={{
                    display: "flex",
                    gap: "2px",
                    overflowX: "auto",
                    marginTop: "2px",
                  }}
                >
                  {t.memories.map((m) => (
                    <button
                      key={m.id}
                      className="pcell"
                      onClick={m.open}
                      data-cellid={m.id}
                      style={{
                        border: "none",
                        padding: 0,
                        cursor: "pointer",
                        background: "var(--color-bg)",
                        flex: "0 0 auto",
                        position: "relative",
                      }}
                    >
                      <Image
                        unoptimized
                        className={imgClass}
                        src={m.thumbUrl}
                        alt={m.alt}
                        width={180}
                        height={180}
                        style={{ width: "180px", height: "180px", objectFit: "cover" }}
                        loading="lazy"
                      />
                      <span
                        style={{
                          position: "absolute",
                          left: "8px",
                          bottom: "8px",
                          background: "var(--color-text)",
                          color: "var(--color-bg)",
                          fontSize: "11px",
                          fontWeight: 700,
                          padding: "3px 7px",
                          letterSpacing: "0.04em",
                        }}
                      >
                        {m.badge}
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {t.showHighlight && (
              <section
                data-screen-label="올해의 하이라이트"
                style={{
                  margin: "24px",
                  background: "var(--color-accent)",
                  color: "#fff",
                  padding: "40px 32px",
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "flex-end",
                  justifyContent: "space-between",
                  gap: "24px",
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: "13px",
                      fontWeight: 700,
                      letterSpacing: "0.1em",
                      textTransform: "uppercase",
                      marginBottom: "12px",
                    }}
                  >
                    Highlights {t.currentYear}
                  </div>
                  <div
                    style={{
                      fontFamily: "var(--font-heading)",
                      fontWeight: 900,
                      fontSize: "clamp(32px,6vw,64px)",
                      lineHeight: 0.95,
                      letterSpacing: "-0.02em",
                    }}
                  >
                    올해의
                    <br />
                    <br />
                    하이라이트
                  </div>
                </div>
                <div style={{ textAlign: "left" }}>
                  <div
                    style={{
                      fontFamily: "var(--font-heading)",
                      fontWeight: 800,
                      fontSize: "clamp(28px,4vw,48px)",
                      fontFeatureSettings: "'tnum' 1",
                      lineHeight: 1,
                    }}
                  >
                    {t.favCount}
                  </div>
                  <div
                    style={{
                      fontSize: "13px",
                      fontWeight: 600,
                      letterSpacing: "0.06em",
                      marginTop: "6px",
                    }}
                  >
                    즐겨찾기 사진
                  </div>
                </div>
              </section>
            )}

            <section
              data-screen-label="필터 바"
              aria-label="사진 필터"
              aria-busy={s.filterBusy}
              style={{
                padding: "0 24px",
                display: "flex",
                flexWrap: "wrap",
                gap: "8px",
                alignItems: "center",
              }}
            >
              {t.yearChips.map((y) => (
                <button
                  key={y.label}
                  onClick={y.go}
                  style={y.style}
                  aria-pressed={y.active}
                  disabled={s.filterBusy}
                >
                  {y.label}
                </button>
              ))}
              <span
                aria-hidden="true"
                style={{
                  width: "2px",
                  height: "20px",
                  background: "var(--color-divider)",
                  margin: "0 6px",
                }}
              ></span>
              {t.tagChips.map((tag) => (
                <button
                  key={tag.id}
                  onClick={tag.go}
                  style={tag.style}
                  aria-pressed={tag.active}
                  disabled={s.filterBusy}
                >
                  {tag.label}
                </button>
              ))}
              <button
                onClick={t.toggleFav}
                style={t.favStyle}
                aria-pressed={t.favActive}
                disabled={s.filterBusy}
              >
                즐겨찾기
              </button>
              {t.personFilterOn && (
                <button
                  onClick={t.clearPerson}
                  style={t.personChipStyle}
                  aria-pressed="true"
                  disabled={s.filterBusy}
                >
                  {t.personFilterName} ✕
                </button>
              )}
              <button
                type="button"
                onClick={() =>
                  this.setState((state) => ({
                    selecting: !state.selecting,
                    selected: {},
                    statusMessage: state.selecting
                      ? "선택 모드를 종료했습니다."
                      : "사진을 눌러 선택하세요.",
                    errorMessage: null,
                  }))
                }
                style={this.chip(s.selecting)}
                aria-pressed={s.selecting}
                disabled={s.filterBusy}
              >
                {s.selecting ? "선택 종료" : "사진 선택"}
              </button>
              {s.filterBusy && (
                <span role="status" aria-live="polite" className="filter-status">
                  사진 불러오는 중…
                </span>
              )}
            </section>

            <div style={{ display: "flex", padding: "8px 24px 80px 24px", gap: "20px" }}>
              <aside
                className="yearrail"
                data-screen-label="연도 레일"
                style={{
                  position: "sticky",
                  top: "96px",
                  alignSelf: "flex-start",
                  gap: "12px",
                  paddingTop: "24px",
                }}
              >
                <div
                  style={{
                    width: "2px",
                    background: "var(--color-text)",
                    alignSelf: "stretch",
                  }}
                ></div>
                <div
                  style={{
                    position: "relative",
                    display: "flex",
                    flexDirection: "column",
                    gap: "14px",
                  }}
                >
                  <div style={t.yearMarkStyle}></div>
                  {t.railYears.map((ry) => (
                    <button
                      key={ry.label}
                      onClick={ry.go}
                      style={ry.style}
                      aria-current={ry.current ? "true" : undefined}
                    >
                      {ry.label}
                    </button>
                  ))}
                </div>
              </aside>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    gap: "10px",
                    padding: "16px 0 4px 0",
                  }}
                >
                  <span
                    style={{
                      fontFamily: "var(--font-heading)",
                      fontWeight: 800,
                      fontSize: "24px",
                      fontFeatureSettings: "'tnum' 1",
                    }}
                  >
                    {t.countUp}
                  </span>
                  <span
                    style={{
                      fontSize: "13px",
                      fontWeight: 600,
                      color: "var(--color-neutral-600)",
                      letterSpacing: "0.04em",
                    }}
                  >
                    PHOTOS
                  </span>
                </div>
                {t.months.map((mo) => (
                  <section key={mo.key} data-year={mo.year} style={{ marginTop: "28px" }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "baseline",
                        gap: "12px",
                        marginBottom: "6px",
                      }}
                    >
                      <span
                        style={{
                          fontFamily: "var(--font-heading)",
                          fontWeight: 800,
                          fontSize: "17px",
                        }}
                      >
                        {mo.label}
                      </span>
                      <span
                        style={{
                          fontSize: "13px",
                          color: "var(--color-neutral-600)",
                          fontFeatureSettings: "'tnum' 1",
                        }}
                      >
                        {mo.count}장
                      </span>
                    </div>
                    <div className="rulewrap">
                      <div className="rule"></div>
                    </div>
                    <div className="pgrid" style={{ marginTop: "2px", padding: "2px 0" }}>
                      {mo.cells.map((c) => (
                        <button
                          key={c.id}
                          className={c.cls}
                          onClick={c.click}
                          style={c.style}
                          aria-label={c.alt}
                          aria-pressed={s.selecting ? c.selected : undefined}
                          data-cellid={c.id}
                        >
                          <Image
                            unoptimized
                            className={imgClass}
                            src={c.thumbUrl}
                            alt={c.alt}
                            width={512}
                            height={512}
                            sizes={GRID_SIZES}
                            style={{
                              width: "100%",
                              aspectRatio: "1/1",
                              objectFit: "cover",
                            }}
                            loading="lazy"
                          />
                          {c.favorite && (
                            <span
                              style={{
                                position: "absolute",
                                top: "6px",
                                right: "6px",
                                width: "8px",
                                height: "8px",
                                background: "var(--color-accent)",
                              }}
                            ></span>
                          )}
                          {c.hasCaption && (
                            <span
                              style={{
                                display: "block",
                                fontSize: "9pt",
                                lineHeight: 1.3,
                                padding: "4px 6px 6px 6px",
                                textAlign: "left",
                                color: "var(--color-neutral-700)",
                                overflow: "hidden",
                                whiteSpace: "nowrap",
                                textOverflow: "ellipsis",
                              }}
                            >
                              {c.captionShort}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  </section>
                ))}
                {!s.filterBusy && t.months.length === 0 && (
                  <p className="empty-state">
                    조건에 맞는 사진이 없습니다. 다른 필터를 선택해 보세요.
                  </p>
                )}
                <div ref={this.sentinel} aria-hidden="true"></div>
              </div>
            </div>
          </div>
        )}

        {s.view === "albums" && (
          <div data-screen-label="앨범">
            <h2 className="sr-only">앨범</h2>
            <div style={{ padding: "24px 24px 80px 24px" }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: "12px",
                  marginBottom: "6px",
                }}
              >
                <span
                  style={{
                    fontFamily: "var(--font-heading)",
                    fontWeight: 800,
                    fontSize: "17px",
                  }}
                >
                  연도별
                </span>
              </div>
              <div className="rulewrap">
                <div className="rule"></div>
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))",
                  gap: "16px",
                  marginTop: "16px",
                }}
              >
                {a.autoAlbums.map((al) => (
                  <button
                    key={al.id}
                    onClick={al.open}
                    style={{
                      border: "none",
                      padding: 0,
                      cursor: "pointer",
                      background: "var(--color-surface)",
                      textAlign: "left",
                      display: "block",
                    }}
                  >
                    {al.coverUrl ? (
                      <Image
                        unoptimized
                        className={imgClass}
                        src={al.coverUrl}
                        alt={al.title}
                        width={600}
                        height={450}
                        sizes={CARD_SIZES}
                        style={{
                          width: "100%",
                          aspectRatio: "4/3",
                          objectFit: "cover",
                        }}
                        loading="lazy"
                      />
                    ) : (
                      <div
                        className={imgClass}
                        style={{
                          width: "100%",
                          aspectRatio: "4/3",
                          background: "var(--color-neutral-300)",
                        }}
                      ></div>
                    )}
                    <div style={{ padding: "12px 14px 14px 14px" }}>
                      <div
                        style={{
                          fontFamily: "var(--font-heading)",
                          fontWeight: 800,
                          fontSize: "16px",
                        }}
                      >
                        {al.title}
                      </div>
                      <div
                        style={{
                          fontSize: "12px",
                          color: "var(--color-neutral-600)",
                          marginTop: "4px",
                          fontFeatureSettings: "'tnum' 1",
                        }}
                      >
                        {al.meta} · {al.period}
                      </div>
                    </div>
                  </button>
                ))}
                {a.autoAlbums.length === 0 && (
                  <p className="empty-state grid-empty">연도별 앨범이 아직 없습니다.</p>
                )}
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: "12px",
                  margin: "36px 0 6px 0",
                }}
              >
                <span
                  style={{
                    fontFamily: "var(--font-heading)",
                    fontWeight: 800,
                    fontSize: "17px",
                  }}
                >
                  이벤트
                </span>
              </div>
              <div className="rulewrap">
                <div className="rule"></div>
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))",
                  gap: "16px",
                  marginTop: "16px",
                }}
              >
                {a.manualAlbums.map((al) => (
                  <button
                    key={al.id}
                    onClick={al.open}
                    style={{
                      border: "none",
                      padding: 0,
                      cursor: "pointer",
                      background: "var(--color-surface)",
                      textAlign: "left",
                      display: "block",
                    }}
                  >
                    {al.coverUrl ? (
                      <Image
                        unoptimized
                        className={imgClass}
                        src={al.coverUrl}
                        alt={al.title}
                        width={600}
                        height={450}
                        sizes={CARD_SIZES}
                        style={{
                          width: "100%",
                          aspectRatio: "4/3",
                          objectFit: "cover",
                        }}
                        loading="lazy"
                      />
                    ) : (
                      <div
                        className={imgClass}
                        style={{
                          width: "100%",
                          aspectRatio: "4/3",
                          background: "var(--color-neutral-300)",
                        }}
                      ></div>
                    )}
                    <div style={{ padding: "12px 14px 14px 14px" }}>
                      <div
                        style={{
                          fontFamily: "var(--font-heading)",
                          fontWeight: 800,
                          fontSize: "16px",
                        }}
                      >
                        {al.title}
                      </div>
                      <div
                        style={{
                          fontSize: "12px",
                          color: "var(--color-neutral-600)",
                          marginTop: "4px",
                          fontFeatureSettings: "'tnum' 1",
                        }}
                      >
                        {al.meta} · {al.period}
                      </div>
                    </div>
                  </button>
                ))}
                {a.manualAlbums.length === 0 && (
                  <p className="empty-state grid-empty">
                    선택한 사진으로 첫 이벤트 앨범을 만들어 보세요.
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {s.view === "people" && (
          <div data-screen-label="인물">
            <h2 className="sr-only">인물</h2>
            <div style={{ padding: "24px 24px 80px 24px" }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: "12px",
                  marginBottom: "6px",
                }}
              >
                <span
                  style={{
                    fontFamily: "var(--font-heading)",
                    fontWeight: 800,
                    fontSize: "17px",
                  }}
                >
                  인물
                </span>
                <span
                  style={{
                    fontSize: "13px",
                    color: "var(--color-neutral-600)",
                    fontFeatureSettings: "'tnum' 1",
                  }}
                >
                  {pe.personTotal}명
                </span>
              </div>
              <div className="rulewrap">
                <div className="rule"></div>
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill,minmax(160px,1fr))",
                  gap: "16px",
                  marginTop: "16px",
                }}
              >
                {pe.persons.map((p) => (
                  <button
                    key={p.id}
                    onClick={p.open}
                    style={{
                      border: "none",
                      padding: 0,
                      cursor: "pointer",
                      background: "var(--color-surface)",
                      textAlign: "left",
                      display: "block",
                    }}
                  >
                    {p.coverUrl ? (
                      <Image
                        unoptimized
                        className={imgClass}
                        src={p.coverUrl}
                        alt={p.name}
                        width={400}
                        height={400}
                        sizes="(min-width:720px) 200px, 45vw"
                        style={{
                          width: "100%",
                          aspectRatio: "1/1",
                          objectFit: "cover",
                        }}
                        loading="lazy"
                      />
                    ) : (
                      <div
                        className={imgClass}
                        style={{
                          width: "100%",
                          aspectRatio: "1/1",
                          background: "var(--color-neutral-300)",
                        }}
                      ></div>
                    )}
                    <div style={{ padding: "10px 12px 12px 12px" }}>
                      <div
                        style={{
                          fontFamily: "var(--font-heading)",
                          fontWeight: 800,
                          fontSize: "15px",
                        }}
                      >
                        {p.name}
                      </div>
                      <div
                        style={{
                          fontSize: "12px",
                          color: "var(--color-neutral-600)",
                          marginTop: "3px",
                          fontFeatureSettings: "'tnum' 1",
                        }}
                      >
                        {p.count}장
                      </div>
                    </div>
                  </button>
                ))}
                {pe.persons.length === 0 && (
                  <p className="empty-state grid-empty">
                    사진에 인물을 지정하면 여기에 모아 보여드려요.
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {s.view === "upload" && (
          <div data-screen-label="업로드">
            <h2 className="sr-only">사진 업로드</h2>
            <div
              onDragOver={u.dzOver}
              onDragLeave={u.dzLeave}
              onDrop={u.dzDrop}
              style={u.dzStyle}
            >
              <div style={{ padding: "24px" }}>
                <div
                  style={{
                    fontFamily: "var(--font-heading)",
                    fontWeight: 900,
                    fontSize: "clamp(28px,5vw,52px)",
                    letterSpacing: "-0.02em",
                    lineHeight: 1,
                  }}
                >
                  사진 올리기
                </div>
                <div className="rulewrap" style={{ marginTop: "16px" }}>
                  <div className="rule"></div>
                </div>
                <input
                  ref={this.fileInput}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
                  multiple
                  hidden
                  aria-describedby="upload-format-help"
                  onChange={(e) => {
                    this.enqueueFiles(Array.from(e.target.files ?? []));
                    e.target.value = "";
                  }}
                />
                <button
                  type="button"
                  onClick={u.pickFiles}
                  aria-describedby="upload-format-help"
                  style={{
                    marginTop: "20px",
                    border: "2px solid var(--color-text)",
                    background: "transparent",
                    color: "var(--color-text)",
                    fontWeight: 700,
                    fontSize: "14px",
                    padding: "12px 22px",
                    cursor: "pointer",
                    minHeight: "44px",
                    letterSpacing: "0.04em",
                  }}
                >
                  파일 선택
                </button>
                <p id="upload-format-help" className="upload-format-help">
                  JPG, PNG, WebP, GIF, AVIF 형식 · HEIC/HEIF는 사진 앱에서 JPG로
                  변환한 뒤 올려주세요.
                </p>
                <div
                  style={{
                    marginTop: "32px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "2px",
                  }}
                >
                  {u.queue.map((q) => (
                    <div
                      key={q.id}
                      className={`upload-queue-item ${q.error ? "error" : ""}`}
                    >
                      <span
                        style={{
                          fontSize: "13px",
                          fontWeight: 600,
                          flex: 1,
                          minWidth: 0,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {q.name}
                      </span>
                      <span
                        style={{
                          fontSize: "12px",
                          color: "var(--color-neutral-600)",
                          fontFeatureSettings: "'tnum' 1",
                          width: "44px",
                          textAlign: "right",
                        }}
                      >
                        {q.error ? "실패" : `${q.pct}%`}
                      </span>
                      <div
                        role="progressbar"
                        aria-label={`${q.name} 업로드 진행률`}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={q.pct}
                        style={{
                          width: "180px",
                          height: "2px",
                          background: "var(--color-neutral-300)",
                          position: "relative",
                        }}
                      >
                        <div style={q.barStyle}></div>
                      </div>
                      {q.error && <span className="sr-only">{q.error}</span>}
                    </div>
                  ))}
                </div>
                {u.hasUploaded && (
                  <div style={{ marginTop: "32px" }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "baseline",
                        gap: "12px",
                        marginBottom: "6px",
                      }}
                    >
                      <span
                        style={{
                          fontFamily: "var(--font-heading)",
                          fontWeight: 800,
                          fontSize: "17px",
                        }}
                      >
                        완료
                      </span>
                      <span
                        style={{
                          fontSize: "13px",
                          color: "var(--color-neutral-600)",
                          fontFeatureSettings: "'tnum' 1",
                        }}
                      >
                        {u.uploadedCount}장
                      </span>
                    </div>
                    <div className="rulewrap">
                      <div className="rule in"></div>
                    </div>
                    <div className="pgrid" style={{ marginTop: "2px", padding: "2px 0" }}>
                      {u.uploadedCells.map((up, i) => (
                        <div key={i} className="pcell" style={{ background: "var(--color-bg)" }}>
                          <div
                            className={imgClass}
                            role="img"
                            aria-label={up.name}
                            style={up.style}
                          ></div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
        </main>

        {!s.selecting && !lb && (
          <nav className="mobile-nav" aria-label="모바일 주요 화면">
            {[...navItems, {
              key: "upload" as View,
              label: "업로드",
              go: () => this.changeView("upload"),
              style: this.navBtnStyle(s.view === "upload"),
            }].map((nav) => (
              <button
                key={nav.key}
                type="button"
                onClick={nav.go}
                aria-current={s.view === nav.key ? "page" : undefined}
              >
                {nav.label}
              </button>
            ))}
          </nav>
        )}

        {s.selecting && (
          <div
            data-screen-label="선택 바"
            aria-hidden={lb ? true : undefined}
            inert={Boolean(lb)}
          >
            <div className="selection-bar">
              <span
                style={{
                  fontFamily: "var(--font-heading)",
                  fontWeight: 800,
                  fontSize: "15px",
                  fontFeatureSettings: "'tnum' 1",
                }}
              >
                {sel.selCount}장 선택
              </span>
              <div className="selection-actions">
                <button
                  onClick={sel.selAlbum}
                  style={sel.selBtnStyle}
                  disabled={sel.selCount === 0}
                >
                  앨범 추가
                </button>
                <button
                  onClick={sel.selDownload}
                  style={sel.selBtnStyle}
                  disabled={sel.selCount === 0}
                >
                  다운로드
                </button>
                <button
                  onClick={sel.selDelete}
                  style={sel.selDelStyle}
                  disabled={sel.selCount === 0}
                >
                  삭제
                </button>
              </div>
              <button onClick={sel.selClear} style={sel.selBtnStyle}>
                선택 종료
              </button>
            </div>
          </div>
        )}

        {lb && (
          <div data-screen-label="라이트박스">
            <div
              ref={this.dialog}
              className="lightbox-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="lightbox-title"
              tabIndex={-1}
              style={{
                position: "fixed",
                inset: 0,
                zIndex: 100,
                display: "flex",
                flexDirection: "column",
                background:
                  "color-mix(in srgb, var(--color-neutral-900) 62%, transparent)",
                backdropFilter: "blur(24px) saturate(0.6)",
                animation: "veilIn 320ms both",
              }}
            >
              <h2 id="lightbox-title" className="sr-only">
                사진 상세 보기: {lb.lbAlt}
              </h2>
              <div className="lightbox-layout">
                <div
                  className="lightbox-main"
                  aria-hidden={lb.infoOpen ? true : undefined}
                  inert={lb.infoOpen}
                  style={{
                    flex: 1,
                    display: "flex",
                    flexDirection: "column",
                    minWidth: 0,
                  }}
                >
                  <div
                    className="lightbox-header"
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: "14px 20px",
                    }}
                  >
                    <span
                      style={{
                        color: "#fff",
                        fontSize: "13px",
                        fontWeight: 600,
                        fontFeatureSettings: "'tnum' 1",
                      }}
                    >
                      {lb.lbIndexLabel}
                    </span>
                    <button
                      onClick={lb.lbClose}
                      aria-label="닫기"
                      style={{
                        border: "2px solid #fff",
                        background: "transparent",
                        color: "#fff",
                        fontWeight: 700,
                        fontSize: "13px",
                        padding: "8px 14px",
                        cursor: "pointer",
                        minHeight: "44px",
                      }}
                    >
                      <span className="desktop-key-hint" aria-hidden="true">
                        ESC{" "}
                      </span>
                      닫기
                    </button>
                  </div>
                  {this.props.demoMode && s.statusMessage && (
                    <div className="lightbox-demo-feedback" role="status">
                      {s.statusMessage}
                    </div>
                  )}
                  <div
                    className="lightbox-stage"
                    style={{
                      flex: 1,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      minHeight: 0,
                      padding: "0 12px",
                      position: "relative",
                      overflow: "hidden",
                    }}
                  >
                    <button
                      onClick={lb.lbPrev}
                      aria-label="이전 사진"
                      style={{
                        position: "absolute",
                        left: "12px",
                        zIndex: 2,
                        border: "none",
                        background: "var(--color-text)",
                        color: "#fff",
                        fontSize: "18px",
                        width: "44px",
                        height: "44px",
                        cursor: "pointer",
                      }}
                    >
                      ←
                    </button>
                    {lb.lbImgs.map((li) => (
                      <Image
                        key={li.key}
                        unoptimized
                        className="lightbox-image"
                        src={li.src}
                        alt={li.alt}
                        width={li.width}
                        height={li.height}
                        sizes="(max-width: 720px) 100vw, (max-width: 1100px) 80vw, 70vw"
                        style={li.style}
                        priority
                      />
                    ))}
                    <button
                      onClick={lb.lbNext}
                      aria-label="다음 사진"
                      style={{
                        position: "absolute",
                        right: "12px",
                        zIndex: 2,
                        border: "none",
                        background: "var(--color-text)",
                        color: "#fff",
                        fontSize: "18px",
                        width: "44px",
                        height: "44px",
                        cursor: "pointer",
                      }}
                    >
                      →
                    </button>
                  </div>
                  <div
                    className="lightbox-actions"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                      padding: "12px 20px",
                    }}
                  >
                    {lb.lbActions.map((ac) => (
                      <button
                        key={ac.label}
                        onClick={ac.go}
                        style={ac.style}
                        aria-pressed={ac.pressed}
                      >
                        {ac.label}
                      </button>
                    ))}
                    <span style={{ flex: 1 }}></span>
                    <button
                      ref={this.infoButton}
                      onClick={lb.lbInfoToggle}
                      aria-expanded={lb.infoOpen}
                      aria-controls="lightbox-info"
                      style={{
                        border: "2px solid #fff",
                        background: "transparent",
                        color: "#fff",
                        fontWeight: 700,
                        fontSize: "13px",
                        padding: "8px 14px",
                        cursor: "pointer",
                        minHeight: "44px",
                      }}
                    >
                      정보
                    </button>
                    <button
                      onClick={lb.lbSlideshow}
                      style={lb.ssBtnStyle}
                      aria-pressed={s.slideshow}
                    >
                      {lb.ssLabel}
                    </button>
                  </div>
                  <div
                    className="lightbox-filmstrip"
                    style={{
                      display: "flex",
                      gap: "2px",
                      overflowX: "auto",
                      padding: "0 20px 16px 20px",
                    }}
                  >
                    {lb.filmstrip.map((fs) => (
                      <button
                        key={fs.id}
                        onClick={fs.go}
                        style={fs.style}
                        aria-label={fs.alt}
                        aria-current={fs.current ? "true" : undefined}
                      >
                        <Image
                          unoptimized
                          src={fs.thumbUrl}
                          alt=""
                          width={56}
                          height={56}
                          style={{
                            width: "56px",
                            height: "56px",
                            objectFit: "cover",
                            display: "block",
                          }}
                          loading="lazy"
                        />
                      </button>
                    ))}
                  </div>
                </div>
                {lb.infoOpen && (
                  <aside
                    ref={this.infoPanel}
                    id="lightbox-info"
                    className="lightbox-info"
                    tabIndex={-1}
                    aria-busy={lb.detailLoading}
                    style={{
                      width: "300px",
                      flex: "0 0 auto",
                      background: "var(--color-bg)",
                      color: "var(--color-text)",
                      padding: "20px",
                      overflowY: "auto",
                    }}
                  >
                    <div className="lightbox-info-heading">
                      <h3
                        style={{
                          fontFamily: "var(--font-heading)",
                          fontWeight: 800,
                          fontSize: "15px",
                          letterSpacing: "0.04em",
                          textTransform: "uppercase",
                        }}
                      >
                        정보
                      </h3>
                      <button
                        type="button"
                        onClick={lb.lbInfoToggle}
                        aria-label="사진 정보 닫기"
                      >
                        닫기
                      </button>
                    </div>
                    <div className="rule in" style={{ marginTop: "8px" }}></div>
                    {lb.detailLoading && (
                      <p className="lightbox-detail-status" role="status">
                        최신 사진 정보를 불러오는 중입니다.
                      </p>
                    )}
                    {lb.detailError && (
                      <div className="lightbox-detail-status error" role="alert">
                        <span>사진 정보를 불러오지 못했습니다.</span>
                        <button type="button" onClick={lb.retryDetail}>
                          다시 시도
                        </button>
                      </div>
                    )}
                    <dl
                      style={{
                        margin: "16px 0 0 0",
                        display: "grid",
                        gridTemplateColumns: "auto 1fr",
                        gap: "8px 16px",
                        fontSize: "13px",
                      }}
                    >
                      <dt style={{ fontWeight: 700 }}>촬영일시</dt>
                      <dd style={{ margin: 0, fontFeatureSettings: "'tnum' 1" }}>
                        {lb.lbTaken}
                      </dd>
                      <dt style={{ fontWeight: 700 }}>인물</dt>
                      <dd style={{ margin: 0 }}>{lb.lbPeople}</dd>
                      <dt style={{ fontWeight: 700 }}>태그</dt>
                      <dd style={{ margin: 0 }}>{lb.lbTags}</dd>
                      <dt style={{ fontWeight: 700 }}>올린 사람</dt>
                      <dd style={{ margin: 0 }}>{lb.lbUploader}</dd>
                      <dt style={{ fontWeight: 700 }}>크기</dt>
                      <dd style={{ margin: 0, fontFeatureSettings: "'tnum' 1" }}>
                        {lb.lbSize}
                      </dd>
                    </dl>
                    <div
                      style={{
                        fontFamily: "var(--font-heading)",
                        fontWeight: 800,
                        fontSize: "15px",
                        letterSpacing: "0.04em",
                        textTransform: "uppercase",
                        marginTop: "28px",
                      }}
                    >
                      반응
                    </div>
                    <div className="rule in" style={{ marginTop: "8px" }}></div>
                    <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
                      {lb.detailLoading ? (
                        <span>반응을 불러오는 중입니다.</span>
                      ) : lb.detailError ? (
                        <span>반응을 확인할 수 없습니다.</span>
                      ) : (
                        <>
                          {lb.lbReactions.map((rx) => (
                            <span
                              key={rx.id}
                              style={{
                                background: "var(--color-surface)",
                                padding: "6px 10px",
                                fontSize: "13px",
                              }}
                            >
                              {rx.emoji} {rx.name}
                            </span>
                          ))}
                          {lb.lbReactions.length === 0 && (
                            <span>아직 반응이 없습니다.</span>
                          )}
                        </>
                      )}
                    </div>
                    <div
                      style={{
                        fontFamily: "var(--font-heading)",
                        fontWeight: 800,
                        fontSize: "15px",
                        letterSpacing: "0.04em",
                        textTransform: "uppercase",
                        marginTop: "28px",
                      }}
                    >
                      코멘트
                    </div>
                    <div className="rule in" style={{ marginTop: "8px" }}></div>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "14px",
                        marginTop: "12px",
                      }}
                    >
                      {lb.detailLoading ? (
                        <span>코멘트를 불러오는 중입니다.</span>
                      ) : lb.detailError ? (
                        <span>코멘트를 확인할 수 없습니다.</span>
                      ) : (
                        <>
                          {lb.lbComments.map((cm) => (
                            <div key={cm.id}>
                              <div style={{ fontSize: "12px", fontWeight: 700 }}>
                                {cm.name}{" "}
                                <span
                                  style={{
                                    color: "var(--color-neutral-600)",
                                    fontWeight: 400,
                                  }}
                                >
                                  {cm.time}
                                </span>
                              </div>
                              <div style={{ fontSize: "13px", marginTop: "3px" }}>
                                {cm.body}
                              </div>
                            </div>
                          ))}
                          {lb.lbComments.length === 0 && (
                            <span>아직 코멘트가 없습니다.</span>
                          )}
                        </>
                      )}
                    </div>
                  </aside>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }
}
