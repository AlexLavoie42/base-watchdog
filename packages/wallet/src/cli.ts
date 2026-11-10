/**
 * Read-only wallet CLI.
 *
 * Commands (none of them can sign, send, or approve anything):
 *   balance <address> [--token <erc20>]      native (or ERC-20) balance on Base
 *   watch <address> [--from N] [--blocks N]  scan a bounded range for incoming
 *                                             transfers and append to ledger
 *   ledger [--summary]          show raw ledger rows or bucket summary
 *   explorer address <value>    canonical basescan link for an address
 *   explorer tx <hash>          canonical basescan link for a tx
 *
 * Env: BASE_RPC_URL (default public https://mainnet.base.org)
 */
import { readFileSync } from "node:fs";
import { getAddress, formatUnits, isAddress } from "viem";
import {
  BASE_CHAIN_ID,
  KNOWN_TOKENS,
} from "./config.js";
import {
  publicClientMainnet,
  chainIdOf,
  nativeBalance,
  erc20Balance,
  fetchIncomingErc20,
  fetchIncomingNative,
  toLedgerEntry,
} from "./monitor.js";
import { appendEntry, initLedger, readEntries, summarize } from "./ledger.js";
import { addressUrl, txUrl } from "./explorer.js";

const LEDGER_PATH = process.env.LEDGER_PATH ?? "../LEDGER.csv";

function die(msg: string): never {
  console.error(`error: ${msg}`);
  process.exit(1);
}

function configuredAddress(): string {
  try { return readFileSync(process.env.WALLET_ADDRESS_FILE ?? "production-address.txt", "utf8").trim(); }
  catch { return die("provide an address or configure wallet/production-address.txt"); }
}

function requireAddress(raw: string): string {
  if (!isAddress(raw)) die(`not a valid address: ${raw}`);
  return getAddress(raw);
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case "balance": {
      const addr = requireAddress((rest[0] && !rest[0].startsWith("--") ? rest[0] : configuredAddress()));
      const tokenIdx = rest.indexOf("--token");
      const client = publicClientMainnet();
      if (await chainIdOf(client) !== BASE_CHAIN_ID) die("RPC is not Base mainnet");
      if (tokenIdx >= 0) {
        const token = requireAddress(rest[tokenIdx + 1] ?? die("--token requires an address"));
        const bal = await erc20Balance(client, addr, token);
        const known = KNOWN_TOKENS[BASE_CHAIN_ID]?.[token.toLowerCase()];
        console.log(`${known?.symbol ?? "TOKEN"}: ${formatUnits(bal, known?.decimals ?? 18)} (raw ${bal})`);
      } else {
        const bal = await nativeBalance(client, addr);
        console.log(`ETH on Base (chain ${BASE_CHAIN_ID}): ${formatUnits(bal, 18)}`);
      }
      break;
    }
    case "watch": {
      const addr = requireAddress((rest[0] && !rest[0].startsWith("--") ? rest[0] : configuredAddress()));
      const fromIdx = rest.indexOf("--from");
      const blocksIdx = rest.indexOf("--blocks");
      const client = publicClientMainnet();
      if (await chainIdOf(client) !== BASE_CHAIN_ID) die("RPC is not Base mainnet");
      const head = await client.getBlockNumber();
      const blocks = blocksIdx >= 0 ? BigInt(rest[blocksIdx + 1] ?? die("--blocks requires a number")) : 500n;
      const from = fromIdx >= 0 ? BigInt(rest[fromIdx + 1] ?? die("--from requires a number")) : (head + 1n > blocks ? head + 1n - blocks : 0n);
      if (blocks < 1n || blocks > 2000n || from < 0n || from > head) die("invalid range: blocks must be 1..2000 and from must be between 0 and head");
      const to = from + blocks - 1n > head ? head : from + blocks - 1n;
      console.log(`scanning ${from}..${to} on chain ${BASE_CHAIN_ID}`);
      const erc20 = await fetchIncomingErc20(client, addr, from, to);
      const native = await fetchIncomingNative(client, addr, from, to);
      let added = 0;
      for (const t of [...native, ...erc20]) {
        const entry = toLedgerEntry(t, BASE_CHAIN_ID);
        if (appendEntry(LEDGER_PATH, entry)) {
          added++;
          console.log(`+in ${entry.amountDecimal} ${entry.tokenSymbol} tx=${entry.txHash} (${txUrl(BASE_CHAIN_ID, entry.txHash)})`);
        }
      }
      console.log(`${added} new ledger entries (${native.length} native, ${erc20.length} erc20 candidates, duplicates skipped)`);
      break;
    }
    case "ledger": {
      initLedger(LEDGER_PATH);
      if (rest.includes("--summary")) {
        console.log(summarize(LEDGER_PATH));
      } else {
        for (const e of readEntries(LEDGER_PATH)) {
          console.log(
            `${e.timestamp} ${e.direction} ${e.amountDecimal} ${e.tokenSymbol} ${e.classification} tx=${e.txHash}`
          );
        }
      }
      break;
    }
    case "explorer": {
      const kind = rest[0];
      const value = rest[1] ?? die("usage: explorer address|tx <value>");
      if (kind === "address") console.log(addressUrl(BASE_CHAIN_ID, requireAddress(value)));
      else if (kind === "tx") console.log(txUrl(BASE_CHAIN_ID, value));
      else die("usage: explorer address|tx <value>");
      break;
    }
    default:
      console.log(`zero-wallet (read-only). Commands: balance | watch | ledger | explorer`);
      if (cmd !== undefined) die(`unknown command: ${cmd}`);
  }
}

main().catch((e) => die(e instanceof Error ? e.message : String(e)));
