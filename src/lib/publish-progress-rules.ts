// Pure helpers for the live publishing progress shown on the clip page.
export type PublishPhase = "uploading" | "processing" | "published" | "scheduled" | "failed";
export type PostRow = { status: string; error?: string | null; media_id?: string | null; scheduled_at?: string | null };

export const PHASES = [
  { id: "uploading", label: "Uploading video" },
  { id: "processing", label: "Processing on platform" },
  { id: "published", label: "Published" },
] as const;

/** Map a stored post row to a visible phase. No row yet means the upload is still in flight. */
export function publishPhase(row: PostRow | null | undefined): PublishPhase {
  if (!row) return "uploading";
  if (row.status === "failed") return "failed";
  if (row.status === "published") return "published";
  if (row.status === "processing") return "processing";
  // Meta rows start as "scheduled"; one whose time has passed is about to upload.
  if (row.status === "scheduled") return row.scheduled_at && Date.parse(row.scheduled_at) > Date.now() ? "scheduled" : "uploading";
  return "uploading";
}

export function phasePercent(phase: PublishPhase): number {
  return phase === "uploading" ? 25 : phase === "processing" ? 65 : 100;
}

export const isFinalPhase = (p: PublishPhase) => p === "published" || p === "scheduled" || p === "failed";

/** True when the error means the account connection must be renewed rather than simply retried. */
export function needsReconnect(error: string | null | undefined): boolean {
  if (!error) return false;
  return /code 190|access token|token (has )?expired|session has expired|reconnect|connect (instagram|a facebook page|your youtube)|invalid_grant|permission|code 10\b|code 200/i.test(error);
}
