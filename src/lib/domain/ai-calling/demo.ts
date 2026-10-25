import { istWeekday, istClockMinutes, parseHHMM } from "./time";
import type { AcSettings } from "./settings";

/** Whether a demo may be booked at this instant: a day and time the team works, far enough ahead, not on the clock's odd minutes. Returns the reason if not. */
export function demoSlotProblem(slot: Date, s: AcSettings, now = new Date()): string | null {
  if (Number.isNaN(slot.getTime())) return "That isn't a valid time.";
  if (slot.getTime() < now.getTime() + s.demoMinHours * 3_600_000) return `A demo needs at least ${s.demoMinHours} hours' notice.`;
  if (slot.getTime() > now.getTime() + 60 * 86_400_000) return "That is too far ahead.";
  if (!s.demoDays.includes(istWeekday(slot))) return "The team doesn't give demos on that day.";
  const m = istClockMinutes(slot);
  if (m < parseHHMM(s.demoFrom) || m + 30 > parseHHMM(s.demoTo)) return `Demos run between ${s.demoFrom} and ${s.demoTo} India time.`;
  if (m % 30 !== 0) return "Demos start on the hour or half hour.";
  return null;
}

/** The next few free times, for the agent to offer when its first choice isn't possible. */
export function nextSlots(taken: Date[], s: AcSettings, now = new Date(), n = 3): Date[] {
  const out: Date[] = [];
  const t = new Date(Math.ceil((now.getTime() + s.demoMinHours * 3_600_000) / 1_800_000) * 1_800_000);
  for (let i = 0; out.length < n && i < 60 * 48; i++, t.setTime(t.getTime() + 1_800_000)) {
    if (!demoSlotProblem(t, s, now) && !taken.some((x) => x.getTime() === t.getTime())) out.push(new Date(t));
  }
  return out;
}
