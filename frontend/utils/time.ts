/**
 * Shared date/time helpers — all display times use Asia/Singapore (SGT, UTC+8).
 */

const SGT = "Asia/Singapore";

/** Format a raw timestamp string to "DD/MM HH:MM" in SGT */
export function fmtDateTimeSGT(raw: string): string {
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    // fallback: try replacing space with T
    const d2 = new Date(raw.replace(" ", "T"));
    if (Number.isNaN(d2.getTime())) return raw.slice(5, 16);
    return fmtDateObj(d2);
  }
  return fmtDateObj(d);
}

function fmtDateObj(d: Date): string {
  return d.toLocaleString("en-GB", {
    timeZone: SGT,
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).replace(",", "");
}

/** Format a raw timestamp string to "DD/MM/YYYY" in SGT */
export function fmtDateSGT(raw: string): string {
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw.slice(0, 10);
  return d.toLocaleDateString("en-GB", {
    timeZone: SGT,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

/** Format a raw timestamp string to "HH:MM:SS" in SGT */
export function fmtTimeSGT(raw: string): string {
  if (!raw) return "";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw.slice(0, 16);
  return d.toLocaleString("en-GB", {
    timeZone: SGT,
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).replace(",", "");
}

/** Get today's date string "YYYY-MM-DD" in SGT */
export function todaySGT(d: Date = new Date()): string {
  const parts = d.toLocaleDateString("en-CA", { timeZone: SGT }); // en-CA gives YYYY-MM-DD
  return parts;
}

/** Convert a raw timestamp to "YYYY-MM-DD" in SGT (for date comparison) */
export function toDateSGT(raw: string): string {
  if (!raw) return "";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw.slice(0, 10);
  return todaySGT(d);
}

/** Format a Date object to "YYYY-MM-DD" in SGT (for input[type=date] values) */
export function fmtInputDateSGT(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: SGT });
}

/**
 * SGT offset in seconds for lightweight-charts (UTC+8 = 28800s).
 * lightweight-charts expects Unix seconds in "local" time, so we add this offset
 * to UTC timestamps to display them in SGT.
 */
export const SGT_OFFSET_SEC = 8 * 3600;

/** Convert a UTC epoch (seconds) to SGT epoch for lightweight-charts */
export function toSGT(utcSec: number): number {
  return utcSec + SGT_OFFSET_SEC;
}
