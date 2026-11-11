export const ITEM_TYPES = ["renewal", "bill", "subscription", "warranty", "policy", "vehicle", "document"] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

export const PERIODS = ["one-off", "weekly", "monthly", "quarterly", "yearly"] as const;
export type Period = (typeof PERIODS)[number];

/** One thing to keep track of: a bill, a policy, a warranty, a passport... */
export interface Item {
  slug: string;
  title: string;
  type: ItemType;
  provider?: string;
  /** Cost per period, in `currency`. */
  cost?: number;
  currency: string;
  period: Period;
  /** Next renewal, payment or expiry date, YYYY-MM-DD. */
  due?: string;
  /**
   * Day of the month a monthly, quarterly or yearly schedule really falls on (29-31), kept when a short
   * month clamps the date, so 31 Jan -> 28 Feb -> 31 Mar. Managed by the server.
   */
  anchor_day?: number;
  /** How many days before `due` to start reminding. */
  remind_days: number;
  auto_renews: boolean;
  /** A short, masked reference such as "…7731". Never a full account or card number. */
  ref?: string;
  tags: string[];
  created: string;
  updated: string;
  /** Free-form notes and the dated history log. */
  body: string;
  path: string;
}

/** Item fields a caller can set. Bookkeeping fields (slug, created, updated, path) are managed by the store. */
export type ItemInput = Omit<
  Item,
  "slug" | "created" | "updated" | "path" | "currency" | "period" | "remind_days" | "auto_renews" | "tags" | "body"
> &
  Partial<Pick<Item, "currency" | "period" | "remind_days" | "auto_renews" | "tags" | "body">>;
