import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Append-only CSV ledger. One row per observed/sent transfer, preserving
 * provenance. Classifications:
 *   unverified — value seen on-chain, counterparty/basis unknown (default for
 *                anything received; NEVER auto-counted as income)
 *   earned     — confirmed independent payment for legitimate value (requires
 *                human-verified economic basis; classification is upgraded
 *                deliberately, never automatically)
 *   self       — self-transfer or operator funding; explicitly NOT revenue
 *   test       — testnet or play money
 *   junk       — dust/spam/airdrop-farming tokens
 */
export type Classification = "unverified" | "earned" | "self" | "test" | "junk";

export interface LedgerEntry {
  timestamp: string; // ISO 8601 of observation (or on-chain block time if known)
  chain: number;
  direction: "in" | "out";
  tokenSymbol: string; // "ETH" for native
  tokenContract: string; // "" for native; checksummed address for ERC-20
  txHash: string;
  fromAddress: string;
  toAddress: string;
  amountRaw: string; // integer string of smallest unit
  amountDecimal: string; // human decimal string at token decimals
  classification: Classification;
  eventId?: string; // log index for token events; native for direct transfers
  note: string; // provenance / counterparty / evidence link
}

const HEADER = [
  "timestamp",
  "chain",
  "direction",
  "token_symbol",
  "token_contract",
  "tx_hash",
  "from",
  "to",
  "amount_raw",
  "amount_decimal",
  "classification",
  "note",
  "event_id",
].join(",");

function csvField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function initLedger(path: string): void {
  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, HEADER + "\n", "utf8");
  } else {
    const text = readFileSync(path, "utf8");
    const oldHeader = HEADER.replace(",event_id", "");
    if (text.startsWith(oldHeader + "\n") || text.startsWith(oldHeader + "\r\n")) {
      writeFileSync(path, HEADER + text.slice(oldHeader.length), "utf8");
    }
  }
}

/** Append one entry; silently skips exact duplicates (same tx+token+direction). */
export function appendEntry(path: string, entry: LedgerEntry): boolean {
  initLedger(path);
  const existing = readEntries(path);
  const dup = existing.some(
    (e) =>
      e.chain === entry.chain &&
      e.txHash.toLowerCase() === entry.txHash.toLowerCase() &&
      e.tokenContract.toLowerCase() === entry.tokenContract.toLowerCase() &&
      e.direction === entry.direction &&
      (e.eventId ?? "") === (entry.eventId ?? "")
  );
  if (dup) return false;
  const row = [
    entry.timestamp,
    String(entry.chain),
    entry.direction,
    entry.tokenSymbol,
    entry.tokenContract,
    entry.txHash,
    entry.fromAddress,
    entry.toAddress,
    entry.amountRaw,
    entry.amountDecimal,
    entry.classification,
    entry.note,
    entry.eventId ?? "",
  ]
    .map(csvField)
    .join(",");
  appendFileSync(path, row + "\n", "utf8");
  return true;
}

/** Minimal CSV reader adequate for the controlled format we write. */
export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQuotes = false;
      } else cur += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

export function readEntries(path: string): LedgerEntry[] {
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, "utf8").split(/\r?\n/).filter((l) => l.trim() !== "");
  const rows = lines.slice(1); // drop header
  return rows.map((line) => {
    const f = parseCsvLine(line);
    return {
      timestamp: f[0] ?? "",
      chain: Number(f[1] ?? 0),
      direction: (f[2] === "out" ? "out" : "in") as "in" | "out",
      tokenSymbol: f[3] ?? "",
      tokenContract: f[4] ?? "",
      txHash: f[5] ?? "",
      fromAddress: f[6] ?? "",
      toAddress: f[7] ?? "",
      amountRaw: f[8] ?? "0",
      amountDecimal: f[9] ?? "0",
      classification: (f[10] ?? "unverified") as Classification,
      note: f[11] ?? "",
      eventId: f[12] ?? "",
    };
  });
}

/** Totals per (token, classification) using decimal strings summed as BigInt at a fixed exponent. */
export function summarize(path: string): string {
  const entries = readEntries(path);
  const buckets = new Map<string, { raw: bigint; decimals: number; count: number }>();
  for (const e of entries) {
    const classification = e.chain !== 8453 && e.classification === "earned" ? "test" : e.classification;
    const key = `${e.chain}:${e.tokenContract.toLowerCase() || "native"}:${e.tokenSymbol}|${classification}`;
    const b = buckets.get(key) ?? { raw: 0n, decimals: 18, count: 0 };
    b.raw += BigInt(e.amountRaw || "0");
    b.count += 1;
    buckets.set(key, b);
  }
  const lines = ["chain:contract:symbol | classification | entries | total_raw"];
  for (const [key, b] of [...buckets.entries()].sort()) {
    lines.push(`${key.replace("|", " | ")} | ${b.count} | ${b.raw.toString()}`);
  }
  lines.push("");
  lines.push("NOTE: only classification=earned counts as income. unverified/self/test/junk are not revenue.");
  return lines.join("\n");
}
