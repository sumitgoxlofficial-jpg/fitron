import { describe, expect, it } from "vitest";
import fixture from "./fixtures/overpass-jharkhand.json";
import { overpassQuery, parseOverpass } from "./osm";

// The data below is a test fixture in Overpass's format, not data collected from OpenStreetMap.
describe("OpenStreetMap parsing", () => {
  const r = parseOverpass(fixture, "osm_extract", "Jharkhand");

  it("keeps named gyms, with the source id, URL and the numbers exactly as published", () => {
    expect(r.observations.map((o) => o.sourceRecordId)).toEqual(["node/900000001", "way/900000002", "node/900000003", "node/900000006"]);
    const iron = r.observations[0]!;
    expect(iron).toMatchObject({ name: "Iron Paradise Gym & Fitness Centre", sourceUrl: "https://www.openstreetmap.org/node/900000001", pin: "834001", state: "Jharkhand", city: "Ranchi", website: "https://www.ironparadise.example/" });
    expect(iron.phonesRaw).toEqual(["+91 98765 43210; 0651 2345678"]);
    expect(iron.evidence).toMatchObject({ attribution: expect.stringContaining("OpenStreetMap") });
  });

  it("uses a way's centre, falls back to the job's state, and leaves a missing phone missing", () => {
    const way = r.observations[1]!;
    expect(way).toMatchObject({ lat: 23.3702, lon: 85.325, state: "Jharkhand", phonesRaw: ["9123456780"] });
    expect(r.observations[2]!.phonesRaw).toEqual([]);
  });

  it("counts what it skipped instead of guessing", () => {
    expect(r.skipped).toEqual({ unnamed: 1, notGym: 1, invalid: 0 });
  });

  it("refuses a file that isn't an Overpass answer", () => {
    expect(() => parseOverpass({ hello: 1 }, "osm_extract")).toThrow(/elements/);
  });

  it("builds a query for one state only, and refuses anything else", () => {
    const q = overpassQuery("IN-JH", ["gym"]);
    expect(q).toContain(`area["ISO3166-2"="IN-JH"]`);
    expect(q).toContain(`nwr["leisure"="fitness_centre"](area.a)`);
    expect(() => overpassQuery(`IN-JH"];foo`, ["gym"])).toThrow();
    expect(() => overpassQuery("IN-JH", [])).toThrow();
  });
});
