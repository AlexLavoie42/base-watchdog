import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  initLedger,
  appendEntry,
  readEntries,
  summarize,
  parseCsvLine,
  type LedgerEntry,
} from "../src/ledger.js";

function tmpLedger(): string {
  return join(mkdtempSync(join(tmpdir(), "ledger-")), "LEDGER.csv");
}

function entry(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    timestamp: "2026-11-10T00:00:00.000Z",
    chain: 8453,
    direction: "in",
    tokenSymbol: "ETH",
    tokenContract: "",
    txHash: "0xabc",
    fromAddress: "0xfrom",
    toAddress: "0xto",
    amountRaw: "1000000000000000000",
    amountDecimal: "1.0",
    classification: "unverified",
    note: "test note",
    ...overrides,
  };
}

test("init creates header; read of missing file is empty", () => {
  const p = join(mkdtempSync(join(tmpdir(), "ledger-")), "LEDGER.csv");
  assert.equal(readEntries(p).length, 0);
  initLedger(p);
  assert.ok(existsSync(p));
  const first = readFileSync(p, "utf8").split("\n")[0];
  assert.ok(first!.startsWith("timestamp,chain,direction"));
});

test("append then read round-trips; duplicates skipped", () => {
  const p = tmpLedger();
  assert.equal(appendEntry(p, entry()), true);
  assert.equal(appendEntry(p, entry()), false, "identical tx+token+direction is a duplicate");
  assert.equal(
    appendEntry(p, entry({ tokenContract: "0x1234567890123456789012345678901234567890", tokenSymbol: "USDC" })),
    true,
    "same tx different token is NOT a duplicate"
  );
  const rows = readEntries(p);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]!.txHash, "0xabc");
  assert.equal(rows[1]!.tokenSymbol, "USDC");
});

test("csv escaping survives commas and quotes in notes", () => {
  const p = tmpLedger();
  appendEntry(p, entry({ note: 'paid for "job, urgent", source=xyz' }));
  const rows = readEntries(p);
  assert.equal(rows[0]!.note, 'paid for "job, urgent", source=xyz');
});

test("parseCsvLine handles quoted commas and doubled quotes", () => {
  assert.deepEqual(parseCsvLine('a,"b,c","d""e"'), ["a", "b,c", 'd"e']);
});

test("summarize buckets by token+classification and never counts unverified as earned", () => {
  const p = tmpLedger();
  appendEntry(p, entry({ amountRaw: "1000000000000000000" })); // 1 ETH unverified
  appendEntry(
    p,
    entry({
      txHash: "0xdef",
      classification: "earned",
      amountRaw: "5000000",
      amountDecimal: "5.0",
      tokenSymbol: "USDC",
      tokenContract: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    })
  );
  const s = summarize(p);
  assert.ok(s.includes("USDC | earned | 1 | 5000000"));
  assert.ok(s.includes("ETH | unverified | 1 | 1000000000000000000"));
  assert.ok(s.includes("only classification=earned counts as income"));
});


test("separate logs and chains remain distinct and testnet is never summarized as income", () => {
  const path = tmpLedger();
  assert.equal(appendEntry(path, entry({ eventId: "0" })), true);
  assert.equal(appendEntry(path, entry({ eventId: "1" })), true);
  assert.equal(appendEntry(path, entry({ eventId: "0" })), false);
  assert.equal(appendEntry(path, entry({ chain: 84532, eventId: "0", classification: "earned" })), true);
  assert.match(summarize(path), /84532:native:ETH \| test \| 1/);
});
