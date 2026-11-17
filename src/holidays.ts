import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Holidays from "date-holidays";

import { addDays } from "./dates.js";
import { weekendDays, type Place } from "./locale.js";

// Public holidays for the person's country, worked out on this computer (no internet).
//  - United Kingdom: the official gov.uk list, bundled (Open Government Licence v3.0). It is more
//    reliable than the general library for UK one-off holidays and substitute days.
//  - Everywhere else, and the UK beyond the bundled years: the date-holidays library (ISC code,
//    CC-BY-SA 4.0 data), public and bank holidays only.

export interface PublicHoliday {
  date: string;
  title: string;
}

type GovRegion = "england-and-wales" | "scotland" | "northern-ireland";

interface GovFile {
  regions: Record<GovRegion, PublicHoliday[]>;
}

const here = path.dirname(fileURLToPath(import.meta.url));
let gov: GovFile | undefined;

function govData(): GovFile {
  gov ??= JSON.parse(fs.readFileSync(path.join(here, "..", "data", "uk-bank-holidays.json"), "utf-8")) as GovFile;
  return gov;
}

function govRegion(place: Place): GovRegion {
  return place.region === "SCT" ? "scotland" : place.region === "NIR" ? "northern-ireland" : "england-and-wales";
}

/** Last date the bundled UK list covers. */
export function govCoverageEnd(): string {
  const list = govData().regions["england-and-wales"];
  return `${list[list.length - 1]!.date.slice(0, 4)}-12-31`;
}

const libraries = new Map<string, Holidays>();
const yearCache = new Map<string, PublicHoliday[]>();

function libraryFor(place: Place): Holidays {
  const key = `${place.country}-${place.region ?? ""}`;
  let lib = libraries.get(key);
  if (!lib) {
    lib = place.region
      ? new Holidays(place.country, place.region, { languages: ["en"] })
      : new Holidays(place.country, { languages: ["en"] });
    libraries.set(key, lib);
  }
  return lib;
}

/** Public and bank holidays from the library for one year, without the weekend date of a moved holiday. */
function libraryYear(place: Place, year: number): PublicHoliday[] {
  const key = `${place.country}-${place.region ?? ""}-${year}`;
  const cached = yearCache.get(key);
  if (cached) return cached;
  const raw = (libraryFor(place).getHolidays(year, "en") || []).filter((h) => h.type === "public" || h.type === "bank");
  const substituted = new Set(raw.filter((h) => h.substitute).map((h) => h.name.replace(/\s*\(substitute day\)/i, "")));
  const weekend = weekendDays(place.country);
  const list: PublicHoliday[] = [];
  const seen = new Set<string>();
  for (const h of raw) {
    const date = h.date.slice(0, 10);
    const day = new Date(`${date}T00:00:00Z`).getUTCDay();
    // A holiday falling on a weekend that has a substitute weekday listed separately is shown once, on the weekday.
    if (!h.substitute && weekend.includes(day) && substituted.has(h.name)) continue;
    if (seen.has(date)) continue;
    seen.add(date);
    list.push({ date, title: h.name });
  }
  list.sort((a, b) => a.date.localeCompare(b.date));
  yearCache.set(key, list);
  return list;
}

/** Holidays between two dates (inclusive), for the person's place. */
export function holidaysBetween(place: Place, from: string, to: string): PublicHoliday[] {
  const out: PublicHoliday[] = [];
  const govEnd = place.country === "GB" ? govCoverageEnd() : "";
  if (place.country === "GB") {
    out.push(...govData().regions[govRegion(place)].filter((h) => h.date >= from && h.date <= to));
  }
  const firstYear = Number(from.slice(0, 4));
  const lastYear = Number(to.slice(0, 4));
  for (let y = firstYear; y <= lastYear && y - firstYear < 50; y++) {
    for (const h of libraryYear(place, y)) {
      if (h.date < from || h.date > to) continue;
      if (place.country === "GB" && h.date <= govEnd) continue; // gov.uk is the source for these years
      out.push(h);
    }
  }
  return out;
}

export function holidayOn(date: string, place: Place): PublicHoliday | undefined {
  return holidaysBetween(place, date, date)[0];
}

export function isWeekend(date: string, place: Place = { country: "GB" }): boolean {
  return weekendDays(place.country).includes(new Date(`${date}T00:00:00Z`).getUTCDay());
}

export function isWorkingDay(date: string, place: Place): boolean {
  return !isWeekend(date, place) && !holidayOn(date, place);
}

/** The date itself if it is a working day, otherwise the working day before it. */
export function workingDayOnOrBefore(date: string, place: Place): string {
  let d = date;
  for (let i = 0; i < 14 && !isWorkingDay(d, place); i++) d = addDays(d, -1);
  return d;
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Why a date is not a working day: the weekday name or the holiday's name. */
export function nonWorkingReason(date: string, place: Place): string | undefined {
  const holiday = holidayOn(date, place);
  if (holiday) return holiday.title;
  return isWeekend(date, place) ? DAY_NAMES[new Date(`${date}T00:00:00Z`).getUTCDay()] : undefined;
}

export function upcomingHolidays(from: string, days: number, place: Place): PublicHoliday[] {
  return holidaysBetween(place, from, addDays(from, days));
}

/** "bank holidays" where that is the local term, "public holidays" elsewhere. */
export function holidayWord(place: Place): string {
  return place.country === "GB" || place.country === "IE" ? "bank holidays" : "public holidays";
}
