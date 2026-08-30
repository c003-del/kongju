import type { InitialData, Photo } from "./contracts";
import { seoulDateParts } from "./date-time";

const member = {
  id: "00000000-0000-4000-8000-000000000001",
  displayName: "연습 사용자",
  avatarUrl: null,
};

const people = [
  {
    id: "00000000-0000-4000-8000-000000000101",
    name: "유진",
    coverUrl: "/demo/family-photo.jpg",
    count: 6,
  },
  {
    id: "00000000-0000-4000-8000-000000000102",
    name: "가족",
    coverUrl: "/demo/family-photo.jpg",
    count: 6,
  },
];

const tags = [
  { id: "00000000-0000-4000-8000-000000000201", label: "여행" },
  { id: "00000000-0000-4000-8000-000000000202", label: "일상" },
];

const photo = (
  index: number,
  takenAt: string,
  caption: string,
  favorite = false,
): Photo => ({
  id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
  url: "/demo/family-photo.jpg",
  thumbUrl: "/demo/family-photo.jpg",
  blurhash: null,
  width: 951,
  height: 665,
  takenAt,
  caption,
  favorite,
  people,
  tags: index % 2 === 0 ? [tags[0]] : [tags[1]],
  uploadedBy: member,
});

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

function seoulTimestamp(
  year: number,
  month: number,
  day: number,
  hour: number,
): string {
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const safeDay = Math.min(Math.max(day, 1), daysInMonth);
  return new Date(
    Date.UTC(year, month - 1, safeDay, hour) - KST_OFFSET_MS,
  ).toISOString();
}

function dateOnly(iso: string): string {
  const value = seoulDateParts(iso);
  return `${value.year}-${String(value.month).padStart(2, "0")}-${String(value.day).padStart(2, "0")}`;
}

export function createTrainingPreviewData(now: Date = new Date()): InitialData {
  const today = seoulDateParts(now);
  const currentYear = today.year;
  const previousYear = currentYear - 1;
  let memoryYear = currentYear - 2;
  while (
    today.day > new Date(Date.UTC(memoryYear, today.month, 0)).getUTCDate()
  ) {
    memoryYear -= 1;
  }
  const priorDay = Math.max(1, today.day - 1);
  const earlierDay = Math.max(1, today.day - 2);

  const photos = [
    photo(
      1,
      seoulTimestamp(currentYear, today.month, today.day, 0),
      "가족과 함께한 오늘",
      true,
    ),
    photo(
      2,
      seoulTimestamp(currentYear, today.month, priorDay, 0),
      "함께한 오후",
    ),
    photo(
      3,
      seoulTimestamp(currentYear, today.month, earlierDay, 0),
      "아침 산책",
    ),
    photo(4, seoulTimestamp(previousYear, 12, 25, 12), "겨울의 추억", true),
    photo(5, seoulTimestamp(previousYear, 5, 5, 9), "봄날"),
    photo(
      6,
      seoulTimestamp(memoryYear, today.month, today.day, 11),
      `${currentYear - memoryYear}년 전 오늘`,
    ),
  ];

  return {
    member,
    role: "owner",
    timeline: {
      months: [],
      photos,
      nextCursor: null,
      total: photos.length,
    },
    albums: [
      {
        id: "00000000-0000-4000-8000-000000000301",
        title: String(currentYear),
        kind: "auto",
        coverUrl: "/demo/family-photo.jpg",
        photoCount: 3,
        startDate: dateOnly(photos[2].takenAt),
        endDate: dateOnly(photos[0].takenAt),
      },
      {
        id: "00000000-0000-4000-8000-000000000302",
        title: "가족 여행",
        kind: "manual",
        coverUrl: "/demo/family-photo.jpg",
        photoCount: 2,
        startDate: dateOnly(photos[1].takenAt),
        endDate: dateOnly(photos[0].takenAt),
      },
    ],
    people,
    tags,
    memories: [photos[5]],
    years: [currentYear, previousYear, memoryYear],
    currentYear,
    favCount: 1,
  };
}
