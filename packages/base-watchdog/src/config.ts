import { http, createPublicClient, isAddress, getAddress, type PublicClient } from "viem";
import { RPC_URL_MAINNET, BASE_CHAIN_ID, KNOWN_TOKENS, type LedgerEntry } from "zero-wallet";
import { fetchIncomingErc20, fetchIncomingNative, toLedgerEntry, TRANSFER_EVENT, type IncomingTransfer } from "zero-wallet";

/**
 * base-watchdog config — all via env, nothing secret:
 *   WATCH_ADDRESS   (required) address to monitor
 *   RPC_URLS        comma-separated fallback list (default: drpc + publicnode quirks applied)
 *   POLL_SECONDS    poll interval (default 30; be polite to public RPCs)
 *   WEBHOOK_URL     optional Discord/Slack-compatible webhook; POSTs JSON per new transfer
 *   LEDGER_PATH     CSV ledger path (default ./watchdog-ledger.csv)
 *   MAX_NATIVE_SCAN max blocks per native-ETH scan chunk (default 100)
 */

export interface Config {
  watchAddress: string;
  rpcUrls: string[];
  pollSeconds: number;
  webhookUrl: string | null;
  ledgerPath: string;
  maxNativeScan: bigint;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const watchAddress = env.WATCH_ADDRESS ?? "";
  if (!isAddress(watchAddress)) {
    throw new Error("WATCH_ADDRESS must be a 0x… 20-byte address");
  }
  const pollSeconds = Number(env.POLL_SECONDS ?? 30);
  const maxNativeScan = BigInt(env.MAX_NATIVE_SCAN ?? 100);
  const rpcUrls = (env.RPC_URLS ?? "https://base.drpc.org,https://mainnet.base.org").split(",").map(s => s.trim()).filter(Boolean);
  if (!Number.isInteger(pollSeconds) || pollSeconds < 1 || pollSeconds > 86400) throw new Error("POLL_SECONDS must be an integer from 1 to 86400");
  if (maxNativeScan < 1n || maxNativeScan > 2000n) throw new Error("MAX_NATIVE_SCAN must be from 1 to 2000");
  if (!rpcUrls.length || rpcUrls.some(s => { try { return !["https:", "http:"].includes(new URL(s).protocol); } catch { return true; } })) throw new Error("RPC_URLS must contain HTTP(S) URLs");
  return {
    watchAddress: getAddress(watchAddress),
    rpcUrls,
    pollSeconds,
    webhookUrl: env.WEBHOOK_URL?.trim() || null,
    ledgerPath: env.LEDGER_PATH ?? "./watchdog-ledger.csv",
    maxNativeScan,
  };
}

/** Public-RPC quirk handling learned in the field (verified live against Base mainnet):
 *  - mainnet.base.org: 429s address-less eth_getLogs → erc20 scans should prefer other RPCs
 *  - 1rpc.io/base: 410s historical full-tx blocks → native scans should avoid it
 *  - base.drpc.org: allows both.
 * Clients are tried in order; caller rotates on failure. */
export function makeClients(rpcUrls: string[]): PublicClient[] {
  return rpcUrls.map((url) => createPublicClient({ transport: http(url) }));
}

/** One poll: fetch new incoming transfers in (fromBlock..toBlock], bounded for native scans. */
export async function pollRange(
  clients: PublicClient[],
  watchAddress: string,
  fromBlock: bigint,
  toBlock: bigint
): Promise<IncomingTransfer[]> {
  const errors: string[] = [];
  for (const client of clients) {
    try {
      if (await client.getChainId() !== BASE_CHAIN_ID) throw new Error("RPC is not Base mainnet");
      const erc20 = await client.getLogs({
        event: TRANSFER_EVENT,
        args: { to: watchAddress as `0x${string}` },
        fromBlock,
        toBlock,
      });
      const out: IncomingTransfer[] = [];
      const chainId = BASE_CHAIN_ID;
      for (const log of erc20) {
        const args = log.args as { from?: string; to?: string; value?: bigint } | undefined;
        const token = log.address;
        const known = KNOWN_TOKENS[chainId]?.[token.toLowerCase()];
        // non-indexed `value` lives in log.data; decode defensively either way
        const raw = log.data === "0x" || !log.data ? 0n : BigInt(log.data);
        out.push({
          kind: "erc20",
          eventId: String(log.logIndex),
          tokenContract: token,
          tokenSymbol: known?.symbol ?? "UNKNOWN",
          decimals: known?.decimals ?? 18,
          txHash: log.transactionHash ?? "",
          from: args?.from ?? "",
          to: args?.to ?? watchAddress,
          amountRaw: (args?.value ?? raw) as bigint,
          blockNumber: log.blockNumber ?? null,
        });
      }
      // native scan in bounded chunks
      let cursor = fromBlock;
      while (cursor <= toBlock) {
        const chunkEnd = cursor + 99n > toBlock ? toBlock : cursor + 99n;
        const nat = await fetchIncomingNative(client, watchAddress, cursor, chunkEnd);
        out.push(...nat);
        cursor = chunkEnd + 1n;
      }
      return out;
    } catch (e) {
      const err = e as Error & { details?: string };
      const msg = `${err.message}${err.details ? ` ${err.details}` : ""}`;
      errors.push(msg.slice(0, 160));
    }
  }
  throw new Error(`all RPCs failed: ${errors.join(" | ")}`);
}

/** Format one transfer as a human-readable webhook message. */
export function formatMessage(t: IncomingTransfer): string {
  const sym = t.tokenSymbol === "UNKNOWN" ? `UNKNOWN(${t.tokenContract})` : t.tokenSymbol;
  const amount = formatUnitsSafe(t.amountRaw, t.decimals);
  return `📥 Base payment: ${amount} ${sym} to ${t.to}\ntx: https://basescan.org/tx/${t.txHash}`;
}

function formatUnitsSafe(raw: bigint, decimals: number): string {
  try {
    // viem's formatUnits via zero-wallet's toLedgerEntry path; keep local to avoid import churn
    const neg = raw < 0n;
    const abs = neg ? -raw : raw;
    const base = 10n ** BigInt(decimals);
    const whole = abs / base;
    const frac = abs % base;
    const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
    return `${neg ? "-" : ""}${whole.toString()}${fracStr ? "." + fracStr : ""}`;
  } catch {
    return raw.toString();
  }
}

export { RPC_URL_MAINNET };
export type { LedgerEntry };
export { toLedgerEntry, fetchIncomingErc20, fetchIncomingNative };
