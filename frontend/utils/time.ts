/**
 * Shared date/time helpers — display times use configurable timezone (default Asia/Singapore).
 * Set timezone via setTimezone(). Persisted in localStorage under "APP_TIMEZONE".
 */

const TZ_STORAGE_KEY = "APP_TIMEZONE";
const DEFAULT_TZ = "Asia/Singapore";

/** Get the currently configured timezone */
export function getTimezone(): string {
  if (typeof window === "undefined") return DEFAULT_TZ;
  return localStorage.getItem(TZ_STORAGE_KEY) || DEFAULT_TZ;
}

/** Set and persist the timezone (e.g. "Asia/Singapore", "America/New_York", "UTC") */
export function setTimezone(tz: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(TZ_STORAGE_KEY, tz);
}

/** Compute UTC offset in seconds for the configured timezone (for lightweight-charts) */
export function getTzOffsetSec(): number {
  const tz = getTimezone();
  const now = new Date();
  const utcStr = now.toLocaleString("en-US", { timeZone: "UTC" });
  const tzStr = now.toLocaleString("en-US", { timeZone: tz });
  return Math.round((new Date(tzStr).getTime() - new Date(utcStr).getTime()) / 1000);
}

/** @deprecated Use getTzOffsetSec() — kept for backward compat */
export const SGT_OFFSET_SEC = 8 * 3600;

/** Format a raw timestamp string to "DD/MM HH:MM" in configured timezone */
export function fmtDateTimeSGT(raw: string): string {
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    const d2 = new Date(raw.replace(" ", "T"));
    if (Number.isNaN(d2.getTime())) return raw.slice(5, 16);
    return fmtDateObj(d2);
  }
  return fmtDateObj(d);
}

function fmtDateObj(d: Date): string {
  return d.toLocaleString("en-GB", {
    timeZone: getTimezone(),
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).replace(",", "");
}

/** Format a raw timestamp string to "DD/MM/YYYY" in configured timezone */
export function fmtDateSGT(raw: string): string {
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw.slice(0, 10);
  return d.toLocaleDateString("en-GB", {
    timeZone: getTimezone(),
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

/** Format a raw timestamp string to "DD/MM HH:MM:SS" in configured timezone */
export function fmtTimeSGT(raw: string): string {
  if (!raw) return "";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw.slice(0, 16);
  return d.toLocaleString("en-GB", {
    timeZone: getTimezone(),
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).replace(",", "");
}

/** Get today's date string "YYYY-MM-DD" in configured timezone */
export function todaySGT(d: Date = new Date()): string {
  return d.toLocaleDateString("en-CA", { timeZone: getTimezone() });
}

/** Convert a raw timestamp to "YYYY-MM-DD" in configured timezone (for date comparison) */
export function toDateSGT(raw: string): string {
  if (!raw) return "";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw.slice(0, 10);
  return todaySGT(d);
}

/** Format a Date object to "YYYY-MM-DD" in configured timezone (for input[type=date] values) */
export function fmtInputDateSGT(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: getTimezone() });
}

/**
 * Timezone offset in seconds for lightweight-charts.
 * lightweight-charts expects Unix seconds in "local" time, so we add this offset
 * to UTC timestamps to display them in the configured timezone.
 */
export function toLocal(utcSec: number): number {
  return utcSec + getTzOffsetSec();
}

/** @deprecated Use toLocal() */
export function toSGT(utcSec: number): number {
  return toLocal(utcSec);
}
