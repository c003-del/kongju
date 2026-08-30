import "server-only";
import { ApiError } from "@/lib/data/member";

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function uuid(value: unknown, error = "invalid_id"): string {
  if (typeof value !== "string" || !UUID.test(value)) {
    throw new ApiError(400, error);
  }
  return value;
}

export function optionalUuid(value: string | null, error: string): string | null {
  return value === null ? null : uuid(value, error);
}

export function boundedInteger(
  value: string | null,
  options: { min: number; max: number; error: string },
): number | null {
  if (value === null) return null;
  if (!/^(?:0|[1-9]\d*)$/.test(value)) throw new ApiError(400, options.error);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < options.min || parsed > options.max) {
    throw new ApiError(400, options.error);
  }
  return parsed;
}

export function uuidList(value: unknown, max = 200): string[] {
  if (!Array.isArray(value) || value.length > max) {
    throw new ApiError(400, "invalid_photo_ids");
  }
  const result = Array.from(new Set(value));
  if (result.some((id) => typeof id !== "string" || !UUID.test(id))) {
    throw new ApiError(400, "invalid_photo_ids");
  }
  return result as string[];
}

export function boundedString(
  value: unknown,
  options: { min?: number; max: number; error: string; trim?: boolean },
): string {
  if (typeof value !== "string") throw new ApiError(400, options.error);
  const result = options.trim ? value.trim() : value;
  if (result.length < (options.min ?? 0) || result.length > options.max) {
    throw new ApiError(400, options.error);
  }
  return result;
}

export function nullableBoundedString(
  value: unknown,
  options: { max: number; error: string },
): string | null {
  if (value === null) return null;
  return boundedString(value, options);
}
