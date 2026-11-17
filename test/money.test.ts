import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { csvCell, parseCsv, toCsv, unguardCell } from "../src/csv.js";
import {
  MoneyStore,
  categorise,
  matchesPhrase,
  parseAmount,
  parseBankCsv,
  parseUkDate,
  parseDate,
  detectDateOrder,
  usesDecimalComma,
  transactionId,
  type Transaction,
} from "../src/money.js";
import { maskCardNumbers } from "../src/util.js";

test("parseCsv handles quotes, escaped quotes, commas, CRLF and a BOM", () => {
  const text = '﻿a,b,c\r\n"x, y","say ""hi""",3\r\n\r\nlast,,\n';
  assert.deepEqual(parseCsv(text), [
    ["a", "b", "c"],
    ["x, y", 'say "hi"', "3"],
    ["last", "", ""],
  ]);
  assert.deepEqual(parseCsv('"multi\nline",2'), [["multi\nline", "2"]]);
});

test("writing CSV neutralises spreadsheet formulas but leaves numbers alone", () => {
  assert.equal(csvCell('=HYPERLINK("http://evil")'), `"'=HYPERLINK(""http://evil"")"`);
  assert.equal(csvCell("+44 shop"), "'+44 shop");
  assert.equal(csvCell("@SUM(A1)"), "'@SUM(A1)");
  assert.equal(csvCell("-32.47"), "-32.47", "a negative amount is data, not a formula");
  assert.equal(csvCell(-32.47), "-32.47");
  assert.equal(unguardCell("'=SUM(A1)"), "=SUM(A1)");
  assert.equal(unguardCell("'quoted text"), "'quoted text", "a real apostrophe is kept");
  const round = parseCsv(toCsv([["d"], ["=1+1"], ["Tesco, Leeds"]])).map((r) => unguardCell(r[0]!));
  assert.deepEqual(round, ["d", "=1+1", "Tesco, Leeds"]);
});

test("parseUkDate reads UK formats day first and rejects impossible dates", () => {
  assert.equal(parseUkDate("16/11/2026"), "2026-11-16");
  assert.equal(parseUkDate("1/2/26"), "2026-02-01", "1 February, not 2 January");
  assert.equal(parseUkDate("2026-11-16"), "2026-11-16");
  assert.equal(parseUkDate("2026-11-16T09:30:00Z"), "2026-11-16");
  assert.equal(parseUkDate("01 Nov 2026"), "2026-11-01");
  assert.equal(parseUkDate("1-Sep-26"), "2026-09-01");
  assert.equal(parseUkDate("16.11.2026"), "2026-11-16");
  assert.equal(parseUkDate("11/16/2026"), null, "US order is not accepted: there is no month 16");
  assert.equal(parseUkDate("30/02/2026"), null);
  assert.equal(parseUkDate("Balance brought forward"), null);
});

test("parseDate reads month-first and year-first dates when asked", () => {
  assert.equal(parseDate("11/16/2026", "MDY"), "2026-11-16");
  assert.equal(parseDate("1/2/26", "MDY"), "2026-01-02");
  assert.equal(parseDate("2026/11/16", "MDY"), "2026-11-16");
  assert.equal(parseDate("Nov 16, 2026", "DMY"), "2026-11-16");
  assert.equal(parseDate("16/11/2026", "MDY"), null, "no month 16");
});

test("a file's date order is worked out from its dates", () => {
  assert.equal(detectDateOrder(["03/04/2026", "11/16/2026"], "DMY"), "MDY");
  assert.equal(detectDateOrder(["03/04/2026", "16/11/2026"], "MDY"), "DMY");
  assert.equal(detectDateOrder(["03/04/2026"], "MDY"), "MDY", "ambiguous: the country's usual order");
  assert.equal(detectDateOrder(["03/04/2026"], "DMY"), "DMY");
});

test("decimal commas are recognised", () => {
  assert.ok(usesDecimalComma(["-12,50", "1.234,56", "3,00"]));
  assert.ok(!usesDecimalComma(["-12.50", "1,234.56"]));
  assert.equal(parseAmount("-1.234,56 €", true), -1234.56);
  assert.equal(parseAmount("12,5", true), 12.5);
  assert.equal(parseAmount("$1,234.56"), 1234.56);
});

test("European and American statements import correctly", () => {
  const de = parseBankCsv(
    "Buchungstag;Empfänger;Verwendungszweck;Betrag\n03.11.2026;Example Strom GmbH;Abschlag;-85,40\n16.11.2026;Example Arbeitgeber;Gehalt;2.450,00\n",
    []
  );
  assert.equal(de.transactions.length, 2);
  assert.deepEqual(
    de.transactions.map((t) => [t.date, t.amount]),
    [
      ["2026-11-03", -85.4],
      ["2026-11-16", 2450],
    ]
  );
  const us = parseBankCsv(
    'Posting Date,Description,Amount\n11/03/2026,EXAMPLE POWER CO,-85.40\n11/16/2026,EXAMPLE EMPLOYER PAYROLL,"2,450.00"\n',
    [],
    "MDY"
  );
  assert.deepEqual(
    us.transactions.map((t) => [t.date, t.amount]),
    [
      ["2026-11-03", -85.4],
      ["2026-11-16", 2450],
    ]
  );
  // A US file read with a UK default still works out month-first from the 16th
  const guessed = parseBankCsv("Date,Description,Amount\n11/03/2026,A,-1.00\n11/16/2026,B,-2.00\n", [], "DMY");
  assert.equal(guessed.transactions[0]!.date, "2026-11-03");
});

test("parseAmount reads the ways banks write money", () => {
  assert.equal(parseAmount("£1,234.56"), 1234.56);
  assert.equal(parseAmount("-12.30"), -12.3);
  assert.equal(parseAmount("(12.30)"), -12.3);
  assert.equal(parseAmount("12.30 DR"), -12.3);
  assert.equal(parseAmount("12.30CR"), 12.3);
  assert.ok(Number.isNaN(parseAmount("")));
  assert.ok(Number.isNaN(parseAmount("n/a")));
});

test("matchesPhrase and categorise use whole words, the person's rules first, longest match wins", () => {
  assert.ok(matchesPhrase("RENT PAYMENT MARCH", "RENT"));
  assert.ok(!matchesPhrase("TRANSFER FROM CURRENT ACCOUNT", "RENT"));
  assert.ok(!matchesPhrase("PARENTS GIFT", "RENT"));
  assert.ok(matchesPhrase("BP CONNECT 1123", "BP"));
  assert.ok(matchesPhrase("apple.com/bill", "APPLE.COM/BILL"));
  assert.equal(categorise("UBER EATS ORDER", []), "going-out");
  assert.equal(categorise("UBER TRIP", []), "transport");
  assert.equal(categorise("TESCO STORES 2041", []), "groceries");
  assert.equal(categorise("TESCO STORES 2041", [["TESCO", "shopping"]]), "shopping", "own rule wins");
  assert.equal(categorise("THE RED LION", []), "other");
  assert.equal(categorise("TRANSFER FROM CURRENT ACCOUNT", []), "other");
});

test("maskCardNumbers keeps only the last four digits of a card number", () => {
  assert.equal(maskCardNumbers("PAYMENT 4111 1111 1111 1111 ONLINE"), "PAYMENT …1111 ONLINE");
  assert.equal(maskCardNumbers("REF 12345678"), "REF 12345678", "not a card number");
});

// Statement layouts modelled on common UK bank exports.
const SIGNED = `Transaction ID,Date,Time,Type,Name,Category,Amount,Currency,Description
tx_1,16/11/2026,09:12:01,Card payment,Tesco,Groceries,-23.40,GBP,TESCO STORES 2041
tx_2,16/11/2026,12:40:55,Card payment,Costa Coffee,Eating out,-3.45,GBP,COSTA COFFEE
tx_3,15/11/2026,08:00:00,Faster payment,Example Employer,Income,2400.00,GBP,SALARY NOV
`;

const SPLIT_WITH_PREAMBLE = `"Account Name:","FlexAccount ****1234"
"Account Balance:","£1,234.56"

"Date","Transaction type","Description","Paid out","Paid in","Balance"
"01 Nov 2026","Contactless Payment","TESCO STORES 2041","£23.40","","£1,211.16"
"01 Nov 2026","Contactless Payment","TESCO STORES 2041","£23.40","","£1,187.76"
"02 Nov 2026","Bank credit","SALARY EXAMPLE LTD","","£2,400.00","£3,587.76"
"03 Nov 2026","Balance brought forward","","","","£3,587.76"
`;

const DEBIT_CREDIT = `Transaction Date,Transaction Type,Sort Code,Account Number,Transaction Description,Debit Amount,Credit Amount,Balance
04/11/2026,DD,'11-22-33,12345678,EXAMPLE ENERGY,96.00,,1000.00
05/11/2026,DEB,'11-22-33,12345678,AMAZON.CO.UK*MK2LP4,24.99,,975.01
06/11/2026,FPI,'11-22-33,12345678,REFUND AMAZON,,24.99,1000.00
`;

const MEMO = `Number,Date,Account,Amount,Subcategory,Memo
,07/11/2026,20-00-00 12345678,-18.00,Direct Debit,EXAMPLE MOBILE DD
,08/11/2026,20-00-00 12345678,-12.50,Card Payment,PRET A MANGER
`;

test("reads a signed-amount statement, using the merchant name", () => {
  const r = parseBankCsv(SIGNED, []);
  assert.deepEqual(
    r.transactions.map((t) => [t.date, t.amount, t.description, t.category]),
    [
      ["2026-11-16", -23.4, "Tesco", "groceries"],
      ["2026-11-16", -3.45, "Costa Coffee", "going-out"],
      ["2026-11-15", 2400, "Example Employer", "other"],
    ]
  );
  assert.deepEqual(r.columns, { date: "Date", description: "Name", amount: "Amount" });
});

test("reads a statement with account details above the header and paid out / paid in columns", () => {
  const r = parseBankCsv(SPLIT_WITH_PREAMBLE, []);
  assert.deepEqual(
    r.transactions.map((t) => [t.date, t.amount, t.category]),
    [
      ["2026-11-01", -23.4, "groceries"],
      ["2026-11-01", -23.4, "groceries"],
      ["2026-11-02", 2400, "income"],
    ]
  );
  assert.notEqual(r.transactions[0]!.id, r.transactions[1]!.id, "two identical shops on one day are both kept");
  assert.equal(r.skippedRows, 1, "the balance line is ignored");
  assert.equal(r.columns.amount, "Paid out / Paid in");
});

test("reads debit/credit amount columns and a memo-style description", () => {
  const dc = parseBankCsv(DEBIT_CREDIT, [["EXAMPLE ENERGY", "bills"]]);
  assert.deepEqual(
    dc.transactions.map((t) => [t.amount, t.category]),
    [
      [-96, "bills"],
      [-24.99, "shopping"],
      [24.99, "shopping"],
    ]
  );
  const memo = parseBankCsv(MEMO, []);
  assert.deepEqual(
    memo.transactions.map((t) => [t.date, t.amount, t.description, t.category]),
    [
      ["2026-11-07", -18, "EXAMPLE MOBILE DD", "other"],
      ["2026-11-08", -12.5, "PRET A MANGER", "going-out"],
    ]
  );
});

test("a file that isn't a statement gets a helpful error", () => {
  assert.throws(() => parseBankCsv("name,age\nAnn,90\n", []), /Could not find the date, description and amount/);
});

test("the store saves, reloads, de-duplicates, keeps rules and the pot", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "la-money-"));
  const store = new MoneyStore(dir);
  const t = (date: string, amount: number, description: string, n = 0): Transaction => ({
    id: transactionId(date, amount, description, n),
    date,
    amount,
    description,
    category: "other",
    source: "bank",
  });
  const first = await store.addTransactions([
    t("2026-11-01", -5, "=CMD|' /C calc'!A0"),
    t("2026-11-02", -9.99, "SHOP"),
  ]);
  assert.equal(first.added.length, 2);
  const again = await store.addTransactions([t("2026-11-02", -9.99, "SHOP"), t("2026-11-02", -9.99, "SHOP", 1)]);
  assert.equal(again.added.length, 1, "the repeat is skipped, the genuine second purchase kept");
  assert.equal(again.skipped, 1);

  const loaded = await store.loadTransactions();
  assert.equal(loaded.length, 3);
  assert.equal(loaded[0]!.description, "=CMD|' /C calc'!A0", "round-trips exactly");
  const raw = await fs.readFile(path.join(dir, "money", "transactions.csv"), "utf-8");
  assert.match(raw, /'=CMD/, "but is stored so Excel won't run it");

  await store.saveRule("RED LION", "going-out");
  await store.saveRule("red lion", "other");
  assert.deepEqual(await store.loadRules(), [["red lion", "other"]], "same words replace the old rule");

  assert.equal(await store.loadPot(), null);
  await store.savePot({ saved: 340, target: 1000, updated: "2026-11-16" });
  assert.deepEqual(await store.loadPot(), { saved: 340, target: 1000, updated: "2026-11-16" });
  await fs.rm(dir, { recursive: true, force: true });
});
