const IST_MS = 330 * 60_000;

/** Minutes after midnight, India time */
export const istClockMinutes = (d: Date) => {
  const t = new Date(d.getTime() + IST_MS);
  return t.getUTCHours() * 60 + t.getUTCMinutes();
};
/** 0 = Sunday, India time */
export const istWeekday = (d: Date) => new Date(d.getTime() + IST_MS).getUTCDay();
export const parseHHMM = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
export const fmtMinutes = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
