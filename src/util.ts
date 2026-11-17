import { settings } from "./locale.js";

export function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "untitled";
}

export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[m][n];
}

/** True for a real calendar date written as YYYY-MM-DD (so 2027-02-30 is rejected). */
export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** Luhn checksum, used to recognise card numbers. */
function luhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = Number(digits[i]);
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/**
 * Does the text contain something that looks like a payment card number
 * (13-19 digits, optionally split by spaces or dashes, passing the Luhn check)?
 */
export function containsCardNumber(text: string): boolean {
  for (const m of text.matchAll(/\b\d(?:[ -]?\d){12,18}\b/g)) {
    const digits = m[0].replace(/[ -]/g, "");
    if (digits.length >= 13 && digits.length <= 19 && luhn(digits)) return true;
  }
  return false;
}

/**
 * Reduce a reference to its last four characters, e.g. "12345678" -> "…5678".
 * Short references (four characters or fewer, or already masked) are kept as they are.
 */
export function maskRef(ref: string): string {
  const trimmed = ref.trim();
  if (trimmed.startsWith("…")) return trimmed;
  const compact = trimmed.replace(/[\s-]/g, "");
  return compact.length <= 4 ? trimmed : `…${compact.slice(-4)}`;
}

/** A three-letter currency code that this Node.js can format, such as GBP or EUR. */
export function isCurrencyCode(value: unknown): value is string {
  if (typeof value !== "string" || !/^[A-Z]{3}$/.test(value)) return false;
  try {
    new Intl.NumberFormat("en-GB", { style: "currency", currency: value });
    return true;
  } catch {
    return false;
  }
}

const localeTags = new Map<string, string>();

/** An English number-formatting locale for the country ("en-GB", "en-US", "en-IE"), falling back to en-GB. */
export function numberLocale(country: string): string {
  let tag = localeTags.get(country);
  if (!tag) {
    const wanted = `en-${country}`;
    let supported: string[] = [];
    try {
      supported = Intl.NumberFormat.supportedLocalesOf([wanted]);
    } catch {
      // invalid tag
    }
    tag = supported.length ? wanted : "en-GB";
    localeTags.set(country, tag);
  }
  return tag;
}

/** £412.00, $9.99, €12.50 ... with two decimal places, in the person's country's English style. */
export function formatMoney(amount: number, currency: string, country = settings().place.country): string {
  return new Intl.NumberFormat(numberLocale(country), { style: "currency", currency }).format(amount);
}

/** Like formatMoney, but whole amounts drop the decimals: £100, $9.99. Uses the person's currency by default. */
export function money(amount: number, currency = settings().currency, country = settings().place.country): string {
  const whole = Math.round(amount * 100) % 100 === 0;
  return new Intl.NumberFormat(numberLocale(country), {
    style: "currency",
    currency,
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(amount);
}

/** Percentage change from `before` to `after`, as "+9%" / "-12%" / "no change", or "" when `before` is 0. */
export function percentChange(before: number, after: number): string {
  if (before === 0) return "";
  const pct = Math.round(((after - before) / before) * 100);
  if (pct === 0) return after === before ? "no change" : after > before ? "+<1%" : "-<1%";
  return `${pct > 0 ? "+" : ""}${pct}%`;
}

/**
 * Add a `- line` to the "## History" section of an item body, creating the section at the end if
 * it does not exist. Other sections are left exactly as they were.
 */
export function appendHistory(body: string, line: string): string {
  const entry = `- ${line}`;
  const lines = body.split("\n");
  const start = lines.findIndex((l) => /^##\s+History\s*$/i.test(l));
  if (start < 0) {
    const trimmed = body.trim();
    return `${trimmed}${trimmed ? "\n\n" : ""}## History\n${entry}`;
  }
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^#{1,2}\s/.test(lines[i]!)) {
      end = i;
      break;
    }
  }
  let insertAt = end;
  while (insertAt > start + 1 && lines[insertAt - 1]!.trim() === "") insertAt--;
  lines.splice(insertAt, 0, entry);
  return lines.join("\n");
}

/** Replace anything that looks like a full card number with its last four digits, e.g. "…1111". */
export function maskCardNumbers(text: string): string {
  return text.replace(/\b\d(?:[ -]?\d){12,18}\b/g, (match) => {
    const digits = match.replace(/[ -]/g, "");
    return containsCardNumber(digits) ? `…${digits.slice(-4)}` : match;
  });
}
