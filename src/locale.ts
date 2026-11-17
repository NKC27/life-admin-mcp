import Holidays from "date-holidays";

// Where the person lives: country (ISO 3166 code), optional state or region, currency and how dates are
// written locally. Read from LIFE_ADMIN_COUNTRY, LIFE_ADMIN_REGION and LIFE_ADMIN_CURRENCY, which the
// one-click installer fills from the person's answers. With nothing set, the UK (England and Wales) and
// pounds, as in every version before 1.1.

export interface Place {
  /** ISO 3166-1 alpha-2, e.g. "GB", "IE", "US". */
  country: string;
  /** Subdivision code as used by date-holidays, e.g. "SCT", "CA", "NSW". */
  region?: string;
}

export type DateOrder = "DMY" | "MDY" | "YMD";

export interface Settings {
  place: Place;
  currency: string;
  dateOrder: DateOrder;
  /** "England and Wales", "California, United States", "Ireland". */
  label: string;
  /** What the input said that could not be matched, so doctor can warn about it. */
  unrecognised: string[];
}

const lookup = new Holidays();
const COUNTRIES: Record<string, string> = lookup.getCountries("en") ?? {};

function clean(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Names people commonly type that are not the official English country name. */
const COUNTRY_ALIASES: Record<string, string> = {
  uk: "GB",
  "u k": "GB",
  "united kingdom": "GB",
  britain: "GB",
  "great britain": "GB",
  england: "GB",
  scotland: "GB",
  wales: "GB",
  "northern ireland": "GB",
  ni: "GB",
  usa: "US",
  "u s a": "US",
  us: "US",
  america: "US",
  "united states of america": "US",
  "united states": "US",
  "the united states": "US",
  "ivory coast": "CI",
  "cote d ivoire": "CI",
  "north macedonia": "MK",
  czechia: "CZ",
  "new zealand aotearoa": "NZ",
  "the netherlands": "NL",
  holland: "NL",
  "republic of ireland": "IE",
  eire: "IE",
  "south korea": "KR",
  korea: "KR",
  uae: "AE",
  "czech republic": "CZ",
};

/** UK nations typed as a country become the UK plus that region. */
const UK_NATION_REGION: Record<string, string> = {
  england: "ENG",
  wales: "WLS",
  scotland: "SCT",
  "northern ireland": "NIR",
  ni: "NIR",
};

export function parseCountry(value: string | undefined): string | undefined {
  const raw = (value ?? "").trim();
  if (!raw) return undefined;
  if (/^[A-Za-z]{2}$/.test(raw) && COUNTRIES[raw.toUpperCase()]) return raw.toUpperCase();
  const v = clean(raw);
  if (COUNTRY_ALIASES[v]) return COUNTRY_ALIASES[v];
  for (const [code, name] of Object.entries(COUNTRIES)) if (clean(name) === v) return code;
  return undefined;
}

export function regionsOf(country: string): Record<string, string> {
  return (lookup.getStates(country, "en") as Record<string, string> | undefined) ?? {};
}

/** A region code or name for the given country ("Scotland", "SCT", "california", "CA"). */
export function parseRegion(country: string, value: string | undefined): string | undefined {
  const raw = (value ?? "").trim();
  if (!raw) return undefined;
  const regions = regionsOf(country);
  const code = raw.toUpperCase().replace(/^[A-Z]{2}-/, "");
  if (regions[code]) return code;
  const v = clean(raw);
  if (country === "GB") {
    if (UK_NATION_REGION[v]) return UK_NATION_REGION[v];
    if (v === "england and wales" || v === "england wales") return "ENG";
  }
  for (const [c, name] of Object.entries(regions)) if (clean(name) === v) return c;
  return undefined;
}

/** Everyday names where the data's official one is long. */
const SHORT_NAMES: Record<string, string> = {
  GB: "United Kingdom",
  US: "United States",
  CI: "Côte d'Ivoire",
  MK: "North Macedonia",
};

export function countryName(code: string): string {
  return SHORT_NAMES[code] ?? COUNTRIES[code] ?? code;
}

export function placeLabel(place: Place): string {
  if (place.country === "GB") {
    if (place.region === "SCT") return "Scotland";
    if (place.region === "NIR") return "Northern Ireland";
    return "England and Wales";
  }
  const region = place.region ? regionsOf(place.country)[place.region] : undefined;
  return region ? `${region}, ${countryName(place.country)}` : countryName(place.country);
}

// ---------------------------------------------------------------------------
// currency and date order
// ---------------------------------------------------------------------------

const EURO = [
  "AT",
  "BE",
  "HR",
  "CY",
  "EE",
  "FI",
  "FR",
  "DE",
  "GR",
  "IE",
  "IT",
  "LV",
  "LT",
  "LU",
  "MT",
  "NL",
  "PT",
  "SK",
  "SI",
  "ES",
  "AD",
  "MC",
  "SM",
  "VA",
  "ME",
  "XK",
];

const CURRENCY: Record<string, string> = {
  ...Object.fromEntries(EURO.map((c) => [c, "EUR"])),
  GB: "GBP",
  IM: "GBP",
  JE: "GBP",
  GG: "GBP",
  GI: "GIP",
  US: "USD",
  PR: "USD",
  EC: "USD",
  SV: "USD",
  PA: "USD",
  CA: "CAD",
  AU: "AUD",
  NZ: "NZD",
  ZA: "ZAR",
  IN: "INR",
  PK: "PKR",
  BD: "BDT",
  LK: "LKR",
  NP: "NPR",
  SG: "SGD",
  MY: "MYR",
  PH: "PHP",
  ID: "IDR",
  TH: "THB",
  VN: "VND",
  HK: "HKD",
  CN: "CNY",
  JP: "JPY",
  KR: "KRW",
  TW: "TWD",
  AE: "AED",
  SA: "SAR",
  QA: "QAR",
  KW: "KWD",
  BH: "BHD",
  OM: "OMR",
  IL: "ILS",
  TR: "TRY",
  EG: "EGP",
  MA: "MAD",
  NG: "NGN",
  KE: "KES",
  GH: "GHS",
  TZ: "TZS",
  UG: "UGX",
  ET: "ETB",
  CH: "CHF",
  LI: "CHF",
  NO: "NOK",
  SE: "SEK",
  DK: "DKK",
  IS: "ISK",
  PL: "PLN",
  CZ: "CZK",
  HU: "HUF",
  RO: "RON",
  BG: "BGN",
  RS: "RSD",
  UA: "UAH",
  RU: "RUB",
  BY: "BYN",
  MD: "MDL",
  AL: "ALL",
  MK: "MKD",
  BA: "BAM",
  GE: "GEL",
  AM: "AMD",
  AZ: "AZN",
  KZ: "KZT",
  MX: "MXN",
  BR: "BRL",
  AR: "ARS",
  CL: "CLP",
  CO: "COP",
  PE: "PEN",
  UY: "UYU",
  PY: "PYG",
  BO: "BOB",
  VE: "VES",
  CR: "CRC",
  GT: "GTQ",
  HN: "HNL",
  NI: "NIO",
  DO: "DOP",
  JM: "JMD",
  TT: "TTD",
  BS: "BSD",
  BB: "BBD",
  BZ: "BZD",
};

/** Countries where bank statements and forms usually write dates month first. */
const MONTH_FIRST = new Set(["US", "PH", "BZ", "FM", "MH", "PW", "PR", "GU", "AS", "VI", "UM"]);
/** Countries where dates are usually written year first. */
const YEAR_FIRST = new Set(["CN", "JP", "KR", "TW", "HU", "LT", "MN", "IR"]);

export function currencyFor(country: string): string | undefined {
  return CURRENCY[country];
}

export function dateOrderFor(country: string): DateOrder {
  return MONTH_FIRST.has(country) ? "MDY" : YEAR_FIRST.has(country) ? "YMD" : "DMY";
}

/** Countries whose weekend is Friday and Saturday rather than Saturday and Sunday. */
const FRI_SAT_WEEKEND = new Set(["SA", "EG", "KW", "QA", "BH", "OM", "JO", "IL"]);

export function weekendDays(country: string): [number, number] {
  return FRI_SAT_WEEKEND.has(country) ? [5, 6] : [6, 0];
}

// ---------------------------------------------------------------------------

let cache: { key: string; value: Settings } | undefined;

/** The person's place, currency and date order from the environment. */
export function settings(env: NodeJS.ProcessEnv = process.env): Settings {
  const key = `${env.LIFE_ADMIN_COUNTRY ?? ""}|${env.LIFE_ADMIN_REGION ?? ""}|${env.LIFE_ADMIN_CURRENCY ?? ""}`;
  if (cache?.key === key) return cache.value;

  const unrecognised: string[] = [];
  const countryInput = (env.LIFE_ADMIN_COUNTRY ?? "").trim();
  const regionInput = (env.LIFE_ADMIN_REGION ?? "").trim();
  let country = parseCountry(countryInput);
  if (countryInput && !country) unrecognised.push(`country "${countryInput}"`);
  // Before 1.1 only a UK region could be set; a region alone still means the UK.
  country ??= "GB";

  let region = parseRegion(country, regionInput);
  if (!region && country === "GB" && UK_NATION_REGION[clean(countryInput)])
    region = UK_NATION_REGION[clean(countryInput)];
  if (regionInput && !region) unrecognised.push(`region "${regionInput}"`);

  const currencyInput = (env.LIFE_ADMIN_CURRENCY ?? "").trim().toUpperCase();
  let currency = currencyFor(country) ?? "USD";
  if (currencyInput) {
    if (/^[A-Z]{3}$/.test(currencyInput)) currency = currencyInput;
    else unrecognised.push(`currency "${env.LIFE_ADMIN_CURRENCY}"`);
  } else if (!currencyFor(country)) {
    unrecognised.push(`no currency known for ${countryName(country)}, using USD (set LIFE_ADMIN_CURRENCY)`);
  }

  const place: Place = { country, region };
  const value: Settings = { place, currency, dateOrder: dateOrderFor(country), label: placeLabel(place), unrecognised };
  cache = { key, value };
  return value;
}

// ---------------------------------------------------------------------------
// free help to point to
// ---------------------------------------------------------------------------

/** Free, impartial money guidance. Named only where it has been checked (the UK); generic elsewhere. */
export function guidanceService(country = settings().place.country): string {
  return country === "GB"
    ? "MoneyHelper (moneyhelper.org.uk)"
    : "your country's government or non-profit money guidance service";
}

/** Free debt advice. Named only where it has been checked (the UK); generic elsewhere. */
export function debtService(country = settings().place.country): string {
  return country === "GB"
    ? "StepChange (stepchange.org) gives free, confidential debt advice"
    : "a free, non-profit debt advice service in your country can help, confidentially";
}
