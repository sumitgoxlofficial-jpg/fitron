import { describe, expect, it } from "vitest";
import { choosePrimary, conflicting, extractPhones, parsePhone, parsePublished, phoneStatusFor } from "./phone";

describe("phone numbers", () => {
  it("parses Indian mobiles and landlines, in any common format, to one form", () => {
    for (const raw of ["+91 98765 43210", "09876543210", "98765-43210", "(+91) 9876543210"]) expect(parsePhone(raw)).toMatchObject({ e164: "+919876543210", kind: "MOBILE" });
    expect(parsePhone("0651 2345678")).toMatchObject({ e164: "+916512345678", kind: "LANDLINE" });
  });

  it("rejects what isn't a valid number, and numbers from other countries", () => {
    for (const raw of ["12345", "", "abcdefghij", "+1 650 253 0000", "0000000000"]) expect(parsePhone(raw), raw).toBeNull();
  });

  it("keeps the original text and splits a value that lists several numbers", () => {
    const r = parsePublished("+91 98765 43210; 0651 2345678 / 9876543210");
    expect(r.valid.map((p) => p.e164)).toEqual(["+919876543210", "+916512345678"]);
    expect(r.valid[0]!.original).toBe("+91 98765 43210");
    expect(parsePublished("12345").invalid).toEqual(["12345"]);
  });

  it("reads tel: links and numbers printed in text, and nothing else", () => {
    const found = extractPhones("Call us on 98765 43210 or order #123456 today", ["tel:+916512345678"]);
    expect(found.map((p) => p.e164).sort()).toEqual(["+916512345678", "+919876543210"]);
    expect(extractPhones("No numbers here, only 2024 and 15 stores.")).toEqual([]);
  });

  describe("status", () => {
    const base = { hasNumber: true, validFormat: true, sourceSets: [["+919876543210"]], primary: "+919876543210", lastChecked: new Date("2026-10-01"), staleDays: 365, now: new Date("2026-10-24") };
    it("is source-confirmed when a source printed the number, never reachability-confirmed by itself", () => {
      expect(phoneStatusFor(base)).toBe("SOURCE_CONFIRMED");
      expect(phoneStatusFor({ ...base, reachabilityConfirmed: true })).toBe("REACHABILITY_CONFIRMED");
    });
    it("covers the other cases", () => {
      expect(phoneStatusFor({ ...base, hasNumber: false, primary: null, sourceSets: [] })).toBe("UNTESTED");
      expect(phoneStatusFor({ ...base, validFormat: false })).toBe("INVALID_FORMAT");
      expect(phoneStatusFor({ ...base, sourceSets: [] })).toBe("FORMAT_VALID");
      expect(phoneStatusFor({ ...base, lastChecked: new Date("2024-01-01") })).toBe("STALE");
      expect(phoneStatusFor({ ...base, unavailable: true })).toBe("UNAVAILABLE");
      expect(phoneStatusFor({ ...base, sourceSets: [["+919876543210"], ["+919000000000"]] })).toBe("CONFLICTING_SOURCES");
    });
  });

  it("calls two sources that share no number a conflict, and not two that overlap", () => {
    expect(conflicting([["+911"], ["+912"]])).toBe(true);
    expect(conflicting([["+911", "+913"], ["+913"]])).toBe(false);
    expect(conflicting([["+911"], []])).toBe(false);
  });

  it("picks the number more sources agree on, then a mobile", () => {
    const kinds = new Map([["+911", "LANDLINE"], ["+912", "MOBILE"]] as const);
    expect(choosePrimary([["+911", "+912"], ["+911"]], kinds as never)).toBe("+911");
    expect(choosePrimary([["+911", "+912"]], kinds as never)).toBe("+912");
    expect(choosePrimary([], new Map())).toBeNull();
  });
});
