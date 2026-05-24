/**
 * Sanitize a free-text fragment for use in a filename. Strips characters
 * that filesystems on Windows, macOS or Linux reject, plus whitespace.
 *
 * "Booth Event Q3" → "Booth_Event_Q3"
 * "v0/draft"        → "v0_draft"
 * ""                → "untitled"
 */
export function safeFileNamePart(raw: string): string {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return "untitled";
  return trimmed
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 80);
}
