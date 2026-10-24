import { describe, expect, it } from "vitest";
import { compareGyms } from "./match";
import { addressSimilarity, domainOf, nameCore, nameSimilarity, normalizeName, webUrl } from "./text";

const iron = { name: "Iron Paradise Gym & Fitness Centre", phones: ["+919876543210"], pin: "834001", city: "Ranchi", lat: 23.3441, lon: 85.3096, address: "12 Main Road, Ranchi" };

describe("names and addresses", () => {
  it("reduces a name to what tells it apart", () => {
    expect(normalizeName("  Iron Paradise Gym & Fitness  ")).toBe("iron paradise gym and fitness");
    expect(nameCore("Iron Paradise Gym & Fitness Centre")).toBe("iron paradise");
    expect(nameSimilarity("Iron Paradise Gym", "IRON PARADISE FITNESS CENTRE")).toBe(1);
    expect(nameSimilarity("Iron Paradise", "Muscle Factory")).toBeLessThan(0.6);
    expect(nameSimilarity("Iron Paradize", "Iron Paradise")).toBeGreaterThan(0.9);
  });
  it("compares addresses and sites", () => {
    expect(addressSimilarity("12 Main Road, Ranchi", "12, Main Rd Ranchi")).toBeGreaterThan(0.6);
    expect(domainOf("https://www.ironparadise.in/contact")).toBe("ironparadise.in");
    expect(domainOf("javascript:alert(1)")).toBeNull();
    expect(webUrl("ironparadise.in")).toBe("https://ironparadise.in/");
    expect(webUrl("ftp://x.in")).toBeNull();
  });
});

describe("are these two records the same gym?", () => {
  it("says yes for the same place and name, even with another phone", () => {
    const b = { ...iron, name: "Iron Paradise Gym", phones: ["+916512345678"], lat: 23.3442, lon: 85.3097 };
    expect(compareGyms(iron, b).decision).toBe("SAME");
  });

  it("says yes for the same number, name and PIN", () => {
    expect(compareGyms({ ...iron, lat: null, lon: null }, { name: "Iron Paradise Fitness", phones: ["+919876543210"], pin: "834001", city: "Ranchi" }).decision).toBe("SAME");
  });

  it("keeps two branches apart: the same name and number in two places goes to a person, never a merge", () => {
    const branch = { ...iron, pin: "831001", city: "Jamshedpur", lat: 22.8046, lon: 86.2029, address: "5 Bistupur" };
    const r = compareGyms(iron, branch);
    expect(r.decision).toBe("AMBIGUOUS");
    expect(r.reasons.join(" ")).toContain("branches");
  });

  it("does not link gyms only because they share a number when the names differ", () => {
    expect(compareGyms(iron, { name: "Blue Lagoon Spa", phones: ["+919876543210"], pin: "834001" }).decision).not.toBe("SAME");
  });

  it("says no for different gyms", () => {
    expect(compareGyms(iron, { name: "Muscle Factory", phones: ["+919123456780"], pin: "834002", city: "Ranchi" }).decision).toBe("DIFFERENT");
  });

  it("treats the same source record as the same gym", () => {
    expect(compareGyms({ ...iron, sourceKeys: ["osm_overpass:node/1"] }, { name: "Renamed", phones: [], sourceKeys: ["osm_overpass:node/1"] }).decision).toBe("SAME");
  });
});
