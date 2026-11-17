import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { addDays } from "./dates.js";

// UK bank holidays, bundled from gov.uk so the server never needs the internet.
// Contains public sector information licensed under the Open Government Licence v3.0.

export const REGIONS = ["england-and-wales", "scotland", "northern-ireland"] as const;
export type Region = (typeof REGIONS)[number];

export const REGION_NAMES: Record<Region, string> = {
  "england-and-wales": "England and Wales",
  scotland: "Scotland",
  "northern-ireland": "Northern Ireland",
};

export interface BankHoliday {
  date: string;
  title: string;
}

interface HolidayFile {
  source: string;
  fetched: string;
  regions: Record<Region, BankHoliday[]>;
}

const here = path.dirname(fileURLToPath(import.meta.url));
let cache: HolidayFile | undefined;

function data(): HolidayFile {
  cache ??= JSON.parse(fs.readFileSync(path.join(here, "..", "data", "uk-bank-holidays.json"), "utf-8")) as HolidayFile;
  return cache;
}

export function isRegion(value: unknown): value is Region {
  return typeof value === "string" && (REGIONS as readonly string[]).includes(value);
}

/**
 * Read a region the way a person might type it: "Scotland", "northern ireland", "NI", "Wales",
 * "England" or the exact ids. Anything else gives undefined.
 */
export function parseRegion(value: string | undefined): Region | undefined {
  const v = (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z]+/g, " ")
    .trim();
  if (!v) return undefined;
  if (v === "scotland") return "scotland";
  if (v === "northern ireland" || v === "ni") return "northern-ireland";
  if (["england", "wales", "england and wales", "england wales"].includes(v)) return "england-and-wales";
  return isRegion(value?.trim()) ? (value!.trim() as Region) : undefined;
}

/** The region from LIFE_ADMIN_REGION, defaulting to England and Wales. */
export function defaultRegion(env: NodeJS.ProcessEnv = process.env): Region {
  return parseRegion(env.LIFE_ADMIN_REGION) ?? "england-and-wales";
}

export function holidays(region: Region): BankHoliday[] {
  return data().regions[region] ?? [];
}

/** Last date the bundled list covers, e.g. "2028-12-26". */
export function coverageEnd(region: Region): string {
  const list = holidays(region);
  return list.length ? list[list.length - 1]!.date.slice(0, 4) + "-12-31" : "";
}

export function bankHolidayOn(date: string, region: Region): BankHoliday | undefined {
  return holidays(region).find((h) => h.date === date);
}

export function isWeekend(date: string): boolean {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

export function isWorkingDay(date: string, region: Region): boolean {
  return !isWeekend(date) && !bankHolidayOn(date, region);
}

/** The date itself if it is a working day, otherwise the working day before it. */
export function workingDayOnOrBefore(date: string, region: Region): string {
  let d = date;
  for (let i = 0; i < 14 && !isWorkingDay(d, region); i++) d = addDays(d, -1);
  return d;
}

/** Why a date is not a working day: "Saturday", "Sunday" or the bank holiday's name. */
export function nonWorkingReason(date: string, region: Region): string | undefined {
  const holiday = bankHolidayOn(date, region);
  if (holiday) return holiday.title;
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 ? "Sunday" : day === 6 ? "Saturday" : undefined;
}

export function upcomingHolidays(from: string, days: number, region: Region): BankHoliday[] {
  const to = addDays(from, days);
  return holidays(region).filter((h) => h.date >= from && h.date <= to);
}
