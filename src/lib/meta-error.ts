/** Turns a Meta Graph API error body into a readable message with code/subcode. */
export function metaErrorMessage(status: number, body: string, label = "Meta"): string {
  try {
    const e = JSON.parse(body)?.error;
    if (e?.message) {
      const codes = [e.code != null ? `code ${e.code}` : "", e.error_subcode != null ? `subcode ${e.error_subcode}` : ""].filter(Boolean).join(", ");
      return `${label}: ${e.message}${codes ? ` (${codes})` : ""}`;
    }
  } catch { /* not JSON */ }
  return `${label} request failed (${status})${body ? `: ${body.slice(0, 300)}` : ""}`;
}
