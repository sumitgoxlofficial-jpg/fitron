// The register of permitted sources. A source starts switched off; a Super Admin turns it on only after reading its terms
// (the register records who and when). Nothing here collects anything: the adapters in src/lib/services/gym-intel do.

export const SOURCE_KEYS = ["osm_overpass", "osm_extract", "public_website", "ai_assisted", "licensed_directory", "manual_entry"] as const;
export type SourceKey = (typeof SOURCE_KEYS)[number];

export type SourceInfo = {
  key: SourceKey;
  name: string;
  type: string;
  /** Where the data comes from */
  location: string;
  access: string;
  license: string;
  licenseUrl: string;
  /** What may and may not be done with it */
  permitted: string;
  /** Needs a person to have reviewed the terms before it can be enabled */
  needsReview: boolean;
  /** Default requests per minute */
  defaultRate: number;
  /** The collector fetches from the internet */
  live: boolean;
};

export const SOURCES: Record<SourceKey, SourceInfo> = {
  osm_overpass: {
    key: "osm_overpass",
    name: "OpenStreetMap (Overpass API)",
    type: "Open map data",
    location: "https://overpass-api.de/api/interpreter (or a mirror you set)",
    access: "Overpass API queries by state, a few at a time. Not the public Nominatim geocoder, which forbids bulk use.",
    license: "Open Database Licence (ODbL) 1.0: credit “© OpenStreetMap contributors”; share-alike for derived databases",
    licenseUrl: "https://www.openstreetmap.org/copyright",
    permitted: "Reading gym records with a phone tag, within the Overpass usage policy (https://wiki.openstreetmap.org/wiki/Overpass_API#Public_Overpass_API_instances). Keep source ids and attribution. No bulk geocoding.",
    needsReview: true,
    defaultRate: 6,
    live: true,
  },
  osm_extract: {
    key: "osm_extract",
    name: "OpenStreetMap extract (file you upload)",
    type: "Open map data",
    location: "An Overpass JSON export, or a regional extract converted to the same JSON, uploaded by a Super Admin",
    access: "File upload; nothing is fetched from the internet by FITRON",
    license: "Open Database Licence (ODbL) 1.0",
    licenseUrl: "https://www.openstreetmap.org/copyright",
    permitted: "Same as the Overpass source. Use this to work from a Geofabrik regional extract without any live queries.",
    needsReview: true,
    defaultRate: 0,
    live: false,
  },
  public_website: {
    key: "public_website",
    name: "Gym's own public website",
    type: "Public website",
    location: "The website address already on a gym record",
    access: "One page fetch per site plus its contact page, after reading robots.txt. Identifies itself with a user agent and a contact address.",
    license: "Each site's own terms. Only visible contact details are read.",
    licenseUrl: "https://www.robotstxt.org/",
    permitted: "Sites whose robots.txt allows it. Never bypasses a CAPTCHA, login or anti-bot control; gives up on a 403 or 429.",
    needsReview: true,
    defaultRate: 6,
    live: true,
  },
  ai_assisted: {
    key: "ai_assisted",
    name: "AI website finder (Claude web search)",
    type: "AI-assisted search",
    location: "Anthropic's Claude API with its web search tool, using this server's own key",
    access: "For a gym with no website, Claude searches the public web for the gym's own website and returns an address. Nothing else from the model is kept: no phone number it writes is ever used.",
    license: "Anthropic's commercial terms and usage policy; the pages it points to keep their own terms",
    licenseUrl: "https://www.anthropic.com/legal/commercial-terms",
    permitted: "Finding a gym's own site. Directory and social pages (Google, Facebook, Instagram, Justdial, Sulekha, IndiaMART…) are refused because their terms forbid automated reading. The site is then read by the website reader, which obeys robots.txt and keeps only numbers printed on the page. Costs money per search; a daily cap applies.",
    needsReview: true,
    defaultRate: 10,
    live: true,
  },
  licensed_directory: {
    key: "licensed_directory",
    name: "Licensed directory dataset (file you upload)",
    type: "Directory dataset",
    location: "A CSV from a directory or data provider you hold a licence for",
    access: "File upload with the licence reference recorded on every row",
    license: "Whatever your licence with the provider says. It is recorded, not assumed.",
    licenseUrl: "",
    permitted: "Only data you are licensed to use for this purpose. No directory is scraped by FITRON.",
    needsReview: true,
    defaultRate: 0,
    live: false,
  },
  manual_entry: {
    key: "manual_entry",
    name: "Entered by a person",
    type: "Manual",
    location: "Typed in by an authorised user",
    access: "A form in the Super Admin pages",
    license: "Collected by FITRON staff from the gym itself",
    licenseUrl: "",
    permitted: "Business contact details the gym has given or published.",
    needsReview: false,
    defaultRate: 0,
    live: false,
  },
};

export const isSourceKey = (v: unknown): v is SourceKey => typeof v === "string" && (SOURCE_KEYS as readonly string[]).includes(v);
