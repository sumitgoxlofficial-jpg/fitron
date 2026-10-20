import { addDays, membershipEndDate, type IsoDate } from "@/lib/domain/dates";

/**
 * A plan length and start date that make a membership end exactly on `end`. Months differ in length and a start on the
 * 29th to 31st clamps, so "end minus 29 days" is only right for a 30-day span, and a few end dates (28 to 30 March, for
 * one) cannot be reached by a one-month plan at all: those are reached with two or three months. This asks the real
 * end-date rule (membershipEndDate) rather than guessing it.
 */
export function planEndingOn(end: IsoDate): { months: number; start: IsoDate } {
  for (const months of [1, 2, 3]) {
    for (let back = months * 28 - 2; back <= months * 31; back++) {
      const start = addDays(end, -back);
      if (membershipEndDate(start, months) === end) return { months, start };
    }
  }
  throw new Error(`No plan of 1 to 3 months ends on ${end}`);
}
