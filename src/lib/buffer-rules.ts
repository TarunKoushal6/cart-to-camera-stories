export const MAX_SLOTS = 6;
export const SLOT_WINDOW_MINUTES = 30;
export const RECOMMENDED_SLOTS = ["12:00", "17:00", "20:30"];

export function normalizeSlots(slots: string[]) {
  const ok = slots.map(s => s.trim()).filter(s => /^([01]\d|2[0-3]):[0-5]\d$/.test(s));
  return [...new Set(ok)].sort().slice(0, MAX_SLOTS);
}

function localParts(now: Date, timeZone: string) {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const p = Object.fromEntries(f.formatToParts(now).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

/** Returns a unique key ("YYYY-MM-DD HH:MM") for the slot due now, or null. A slot fires once, within 30 minutes after its time. */
export function dueSlotKey(slots: string[], timeZone: string, now: Date, lastKey: string | null) {
  const { date, minutes } = localParts(now, timeZone);
  for (const s of normalizeSlots(slots).reverse()) {
    const [h, m] = s.split(":").map(Number);
    const diff = minutes - (h * 60 + m);
    if (diff >= 0 && diff < SLOT_WINDOW_MINUTES) {
      const key = `${date} ${s}`;
      return key === lastKey ? null : key;
    }
  }
  return null;
}

export function pickRandom<T>(items: T[], rand: () => number = Math.random): T | null {
  return items.length ? items[Math.floor(rand() * items.length) % items.length] : null;
}
