import "server-only";
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/data/member";

// Route Handler 공통 래퍼 — ApiError는 상태코드 그대로, 그 외는 500
export async function handle<T>(fn: () => Promise<T>): Promise<NextResponse> {
  try {
    const result = await fn();
    return NextResponse.json(result ?? { ok: true });
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    console.error("[api]", error);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

export async function readJson<T>(request: Request): Promise<T> {
  const mediaType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType !== "application/json") {
    throw new ApiError(415, "application_json_required");
  }
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    throw new ApiError(400, "invalid_json");
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(400, "json_object_required");
  }
  return value as T;
}
