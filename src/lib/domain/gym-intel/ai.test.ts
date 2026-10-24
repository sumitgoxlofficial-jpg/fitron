import { describe, expect, it } from "vitest";
import { acceptWebsite, pageMentionsGym, parseFinderAnswer, parseSelection } from "./ai";
import { extractFromHtml } from "./website";

describe("what the AI may return", () => {
  it("accepts a gym's own website and refuses directories, maps, social pages and downloads", () => {
    expect(acceptWebsite("https://www.ironparadise.in/contact")).toBe("https://www.ironparadise.in/contact");
    expect(acceptWebsite("ironparadise.in")).toBe("https://ironparadise.in/");
    // a gym's own site is not blocked because its name contains a blocked word
    for (const ok of ["https://fitbox.com", "https://yoga.co", "https://mapsfitness.in", "https://googlefit-gym.in", "https://sulekha-fitness.in"]) expect(acceptWebsite(ok), ok).not.toBeNull();
    for (const bad of ["https://www.justdial.com/Ranchi/Iron-Paradise", "https://www.facebook.com/ironparadise", "https://instagram.com/x", "https://maps.google.com/?q=x", "https://g.co/x", "https://sulekha.com/x", "https://x.com/y", "https://wa.me/919876543210", "https://site.in/brochure.pdf", "javascript:alert(1)", "not a url", "", null, 42]) expect(acceptWebsite(bad), String(bad)).toBeNull();
  });

  it("reads only a clean JSON answer, and ignores any number the model wrote", () => {
    expect(parseFinderAnswer('{"url":"https://ironparadise.in","reason":"Official site"}')).toEqual({ url: "https://ironparadise.in/", reason: "Official site" });
    expect(parseFinderAnswer('Here you go: {"url": null, "reason": "not sure"}').url).toBeNull();
    expect(parseFinderAnswer('{"url":"https://justdial.com/x"}').url).toBeNull();
    expect(parseFinderAnswer("Call them on 98765 43210").url).toBeNull();
    expect(parseFinderAnswer("{broken").url).toBeNull();
    expect(JSON.stringify(parseFinderAnswer('{"url":"https://a.in","phone":"9876543210","reason":"x"}'))).not.toContain("9876543210");
  });

  it("lets the model only choose among the numbers it was shown", () => {
    expect(parseSelection('{"keep":[0,2]}', 3)).toEqual([0, 2]);
    expect(parseSelection('{"keep":[0,7,-1,1.5,"x"]}', 3)).toEqual([0]);
    expect(parseSelection('{"keep":[]}', 3)).toEqual([0, 1, 2]);
    expect(parseSelection("nonsense", 2)).toEqual([0, 1]);
    expect(parseSelection('{"keep":"all"}', 2)).toEqual([0, 1]);
  });

  it("checks a found page is about the gym", () => {
    expect(pageMentionsGym("Welcome to Iron Paradise Gym, Ranchi's best", "Iron Paradise Gym & Fitness Centre")).toBe(true);
    expect(pageMentionsGym("Muscle Factory: join today", "Iron Paradise Gym")).toBe(false);
    expect(pageMentionsGym("Paradise Spa and Resort", "Iron Paradise Gym")).toBe(false);
  });
});

describe("page contact details", () => {
  it("keeps a little of the text around each number, for the AI to choose with", () => {
    const r = extractFromHtml(`<p>Front desk: 98765 43210. Franchise enquiries: 0651 2345678</p>`);
    expect(Object.values(r.contexts).join(" | ")).toContain("Front desk");
    expect(r.text).toContain("Franchise enquiries");
  });
});
