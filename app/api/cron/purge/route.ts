import { NextResponse } from "next/server";
import { softDeleteRetentionDays } from "@/lib/env";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const BATCH = 200;
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";

type PurgeRow = {
  id: string;
  family_id: string;
  storage_path: string;
  thumb_path: string;
  claim_id: string;
};

type ExpiredUploadRow = {
  photo_id: string;
  storage_path: string;
  thumb_path: string;
  claim_id: string;
};

function batchClaimId(rows: { claim_id: string }[]): string | null {
  if (rows.length === 0) return null;
  const claimId = rows[0].claim_id;
  const valid = new RegExp(`^${UUID}$`, "i").test(claimId);
  return valid && rows.every((row) => row.claim_id === claimId) ? claimId : null;
}

function hasCanonicalPaths(row: PurgeRow): boolean {
  const original = new RegExp(
    `^${row.family_id}/([0-9]{4})/(0[1-9]|1[0-2])/(${UUID})\\.(jpg|png|webp|gif|avif)$`,
    "i",
  );
  const match = row.storage_path.match(original);
  if (!match || match[3].toLowerCase() !== row.id.toLowerCase()) return false;
  return row.thumb_path === `${row.family_id}/${match[1]}/${match[2]}/${row.id}.webp`;
}

function hasCanonicalUploadPaths(row: ExpiredUploadRow): boolean {
  const original = new RegExp(
    `^(${UUID})/([0-9]{4})/(0[1-9]|1[0-2])/(${UUID})\\.(jpg|png|webp|gif|avif)$`,
    "i",
  );
  const match = row.storage_path.match(original);
  if (!match || match[4].toLowerCase() !== row.photo_id.toLowerCase()) return false;
  return row.thumb_path === `${match[1]}/${match[2]}/${match[3]}/${row.photo_id}.webp`;
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createSupabaseAdmin();
  const cutoff = new Date(
    Date.now() - softDeleteRetentionDays() * 24 * 60 * 60 * 1000,
  ).toISOString();

  const { data, error } = await admin.rpc("claim_expired_photos", {
    p_cutoff: cutoff,
    p_limit: BATCH,
  });
  if (error) {
    return NextResponse.json({ error: "purge_claim_failed" }, { status: 500 });
  }

  const rows = (data ?? []) as PurgeRow[];
  await admin.rpc("cleanup_login_rate_limits");
  let purged = 0;
  if (rows.length > 0) {
    const ids = rows.map((row) => row.id);
    const claimId = batchClaimId(rows);
    if (!claimId) {
      return NextResponse.json({ error: "invalid_purge_claim" }, { status: 500 });
    }
    if (!rows.every(hasCanonicalPaths)) {
      await admin.rpc("release_photo_purge", {
        p_ids: ids,
        p_claim_id: claimId,
      });
      console.error("[cron/purge] rejected non-canonical storage path");
      return NextResponse.json({ error: "invalid_purge_path" }, { status: 500 });
    }

    const [originals, thumbs] = await Promise.all([
      admin.storage.from("photos").remove(rows.map((row) => row.storage_path)),
      admin.storage.from("thumbs").remove(rows.map((row) => row.thumb_path)),
    ]);
    if (originals.error || thumbs.error) {
      await admin.rpc("release_photo_purge", {
        p_ids: ids,
        p_claim_id: claimId,
      });
      return NextResponse.json({ error: "storage_purge_failed" }, { status: 500 });
    }

    const { data: deleted, error: completeError } = await admin.rpc(
      "complete_photo_purge",
      { p_ids: ids, p_claim_id: claimId },
    );
    if (completeError) {
      await admin.rpc("release_photo_purge", {
        p_ids: ids,
        p_claim_id: claimId,
      });
      return NextResponse.json({ error: "purge_complete_failed" }, { status: 500 });
    }
    purged = (deleted ?? []).length;
  }

  const { data: expiredData, error: expiredError } = await admin.rpc(
    "claim_expired_uploads",
    { p_limit: BATCH },
  );
  if (expiredError) {
    return NextResponse.json({ error: "upload_cleanup_claim_failed" }, { status: 500 });
  }
  const expired = (expiredData ?? []) as ExpiredUploadRow[];
  let expiredUploadsRemoved = 0;
  if (expired.length > 0) {
    const ids = expired.map((row) => row.photo_id);
    const claimId = batchClaimId(expired);
    if (!claimId) {
      return NextResponse.json(
        { error: "invalid_upload_cleanup_claim" },
        { status: 500 },
      );
    }
    if (!expired.every(hasCanonicalUploadPaths)) {
      await admin.rpc("release_upload_cleanup", {
        p_ids: ids,
        p_claim_id: claimId,
      });
      return NextResponse.json({ error: "invalid_upload_cleanup_path" }, { status: 500 });
    }
    const [originals, thumbs] = await Promise.all([
      admin.storage.from("photos").remove(expired.map((row) => row.storage_path)),
      admin.storage.from("thumbs").remove(expired.map((row) => row.thumb_path)),
    ]);
    if (originals.error || thumbs.error) {
      await admin.rpc("release_upload_cleanup", {
        p_ids: ids,
        p_claim_id: claimId,
      });
      return NextResponse.json({ error: "upload_cleanup_failed" }, { status: 500 });
    }
    const { error: completeError } = await admin.rpc("complete_upload_cleanup", {
      p_ids: ids,
      p_claim_id: claimId,
    });
    if (completeError) {
      await admin.rpc("release_upload_cleanup", {
        p_ids: ids,
        p_claim_id: claimId,
      });
      return NextResponse.json({ error: "upload_cleanup_complete_failed" }, { status: 500 });
    }
    expiredUploadsRemoved = ids.length;
  }

  return NextResponse.json({ purged, expiredUploadsRemoved });
}
