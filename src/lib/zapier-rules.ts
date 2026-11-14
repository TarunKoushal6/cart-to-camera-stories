export const MAX_SLOTS = 6;
export const RECOMMENDED_SLOTS = ["12:00", "17:00", "20:30"];
export const wantsZapier = (email?: string | null) => (email ?? "").trim().toLowerCase() === "koushaltarun5@gmail.com";

export function zapierWebhook(value: string) {
  const url = new URL(value.trim());
  if (url.protocol !== "https:" || url.hostname !== "hooks.zapier.com" || url.port || url.username || url.password || url.search || url.hash || !/^\/hooks\/catch\/\d+\/[\w-]+\/$/.test(url.pathname)) {
    throw new Error("Use the HTTPS Catch Hook URL from Zapier.");
  }
  return url.toString();
}
export function normalizeSlots(slots: string[]) {
  return [...new Set(slots.map(s => s.trim()).filter(s => /^([01]\d|2[0-3]):[0-5]\d$/.test(s)))].sort().slice(0, MAX_SLOTS);
}
export function dueSlotKey(slots: string[], timeZone: string, now: Date, lastKey: string | null) {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const p = Object.fromEntries(f.formatToParts(now).map(x => [x.type, x.value]));
  const date = `${p["year"]}-${p["month"]}-${p["day"]}`, minutes = Number(p["hour"]) * 60 + Number(p["minute"]);
  for (const s of normalizeSlots(slots)) {
    const [h = 0, m = 0] = s.split(":").map(Number), diff = minutes - h * 60 - m;
    const key = `${date} ${s}`;
    if (diff >= 0 && diff < 30 && (!lastKey || key > lastKey)) return key;
  }
  return null;
}
export function pickRandom<T>(items: T[], rand: () => number = Math.random): T | null {
  return items.length ? items[Math.floor(rand() * items.length)] ?? null : null;
}
export function requireZapierConsent(consent: boolean) {
  if (!consent) throw new Error("Approve sending your reels to Zapier first.");
}