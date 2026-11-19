/** Chicago-local time helpers. The backend treats a zone-less ISO time as Chicago local time. */
export const CHICAGO_TZ = "America/Chicago";

function hour12(h: number): string {
  const hh = ((h + 11) % 12) + 1;
  return `${hh} ${h % 24 < 12 ? "AM" : "PM"}`;
}

/** Bucket b covers hours 2b..2b+2, e.g. 11 -> "10 PM–12 AM". */
export function bucketLabel(b: number): string {
  return `${hour12(2 * b)}–${hour12((2 * b + 2) % 24)}`;
}

function parts(d: Date): Record<string, string> {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: CHICAGO_TZ, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
  return Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
}

/** "YYYY-MM-DDTHH:mm" in Chicago local time (value for <input type="datetime-local">). */
export function chicagoLocalInput(d: Date = new Date()): string {
  const p = parts(d);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/** Current Chicago 2-hour bucket (0..11). */
export function chicagoBucket(d: Date = new Date()): number {
  return Math.floor(Number(parts(d).hour) / 2);
}

/** Format an ISO time (with offset) as Chicago clock time, e.g. "4:21 PM". */
export function chicagoClock(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { timeZone: CHICAGO_TZ, hour: "numeric", minute: "2-digit" });
}

/** Short label for a chosen departure ("YYYY-MM-DDTHH:mm" Chicago local), e.g. "Fri 10:30 PM". */
export function departLabel(local: string): string {
  const [date, time] = local.split("T");
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
  const h12 = ((hh + 11) % 12) + 1;
  return `${day} ${h12}:${String(mm).padStart(2, "0")} ${hh < 12 ? "AM" : "PM"}`;
}
