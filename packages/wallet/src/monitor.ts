import {
  createPublicClient,
  custom,
  http,
  erc20Abi,
  formatUnits,
  getAddress,
  parseAbiItem,
  toHex,
  type PublicClient,
  type Transport,
} from "viem";
import { RPC_URL_MAINNET, RPC_URL_TESTNET, BASE_CHAIN_ID, chainById, KNOWN_TOKENS } from "./config.js";
import type { LedgerEntry, Classification } from "./ledger.js";

export const TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)"
);

/**
 * Build a read-only public client over any transport (http or a custom mock).
 * The chain is intentionally NOT pinned into the client: every network call is
 * read-only, and chain identity is asserted separately via eth_chainId.
 */
export function makeClient(transport: Transport): PublicClient {
  return createPublicClient({ transport });
}

export function publicClientMainnet(): PublicClient {
  return makeClient(http(RPC_URL_MAINNET));
}

export function publicClientTestnet(): PublicClient {
  return makeClient(http(RPC_URL_TESTNET));
}

export async function chainIdOf(client: PublicClient): Promise<number> {
  return (await client.getChainId()) as number;
}

export function assertChainSupported(chainId: number): void {
  chainById(chainId); // throws for anything but Base / Base Sepolia
}

export async function nativeBalance(client: PublicClient, address: string): Promise<bigint> {
  return client.getBalance({ address: getAddress(address) });
}

export async function erc20Balance(
  client: PublicClient,
  address: string,
  token: string
): Promise<bigint> {
  return client.readContract({
    address: getAddress(token),
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [getAddress(address)],
  }) as Promise<bigint>;
}

export interface IncomingTransfer {
  kind: "native" | "erc20";
  eventId?: string;
  tokenContract: string; // "" for native
  tokenSymbol: string; // "ETH" for native; resolved or "UNKNOWN" (never trusted blindly)
  decimals: number;
  txHash: string;
  from: string;
  to: string;
  amountRaw: bigint;
  blockNumber: bigint | null;
}

/**
 * ERC-20 Transfer logs where `to` is our address.
 * Unknown token contracts are labeled UNKNOWN — balances of unknown tokens are
 * treated as unverified and are never interacted with (no approvals, no swaps).
 */
export async function fetchIncomingErc20(
  client: PublicClient,
  address: string,
  fromBlock: bigint,
  toBlock: bigint
): Promise<IncomingTransfer[]> {
  const addr = getAddress(address);
  const logs = await client.getLogs({
    event: TRANSFER_EVENT,
    args: { to: addr },
    fromBlock,
    toBlock,
  });
  const chainId = await chainIdOf(client);
  const out: IncomingTransfer[] = [];
  for (const log of logs) {
    const token = getAddress(log.address);
    const known = KNOWN_TOKENS[chainId]?.[token.toLowerCase()];
    const args = log.args as { from?: string; to?: string; value?: bigint } | undefined;
    const raw = log.data === "0x" ? 0n : BigInt(log.data);
    out.push({
      kind: "erc20",
      eventId: String(log.logIndex),
      tokenContract: token,
      tokenSymbol: known?.symbol ?? "UNKNOWN",
      decimals: known?.decimals ?? 18,
      txHash: log.transactionHash ?? "",
      from: args?.from ?? "",
      to: args?.to ?? addr,
      amountRaw: (args?.value ?? raw) as bigint,
      blockNumber: log.blockNumber ?? null,
    });
  }
  return out;
}

interface MinimalTx {
  hash: string;
  from: string;
  to: string | null;
  value: bigint;
}

/**
 * Native ETH received: scan a bounded block range, filtering full-block
 * transactions whose `to` is our address and value > 0.
 * Keep ranges modest on public RPCs.
 */
export async function fetchIncomingNative(
  client: PublicClient,
  address: string,
  fromBlock: bigint,
  toBlock: bigint
): Promise<IncomingTransfer[]> {
  const addr = getAddress(address);
  const out: IncomingTransfer[] = [];
  const MAX_RANGE = 2000n;
  if (toBlock - fromBlock > MAX_RANGE) {
    throw new Error(
      `Block range too large for native scan (${fromBlock}..${toBlock} > ${MAX_RANGE}); narrow the range.`
    );
  }
  for (let b = fromBlock; b <= toBlock; b++) {
    const block = await client.getBlock({ blockNumber: b, includeTransactions: true });
    const txs = (block.transactions ?? []) as unknown as MinimalTx[];
    for (const tx of txs) {
      if (tx.to && tx.to.toLowerCase() === addr.toLowerCase() && tx.value > 0n) {
        const receipt = await client.getTransactionReceipt({ hash: tx.hash as `0x${string}` });
        if (receipt.status !== "success") continue;
        out.push({
          kind: "native",
          eventId: "native",
          tokenContract: "",
          tokenSymbol: "ETH",
          decimals: 18,
          txHash: tx.hash,
          from: tx.from,
          to: tx.to,
          amountRaw: tx.value,
          blockNumber: b,
        });
      }
    }
  }
  return out;
}

/** Convert an observed transfer into a ledger entry (always starts as unverified). */
export function toLedgerEntry(
  t: IncomingTransfer,
  chainId: number,
  classification: Classification = "unverified"
): LedgerEntry {
  return {
    eventId: t.eventId,
    timestamp: new Date().toISOString(),
    chain: chainId,
    direction: "in",
    tokenSymbol: t.tokenSymbol,
    tokenContract: t.tokenContract,
    txHash: t.txHash,
    fromAddress: t.from,
    toAddress: t.to,
    amountRaw: t.amountRaw.toString(),
    amountDecimal: formatUnits(t.amountRaw, t.decimals),
    classification,
    note: t.kind === "native" ? "native transfer" : `erc20 transfer; token=${t.tokenContract}`,
  };
}

export { toHex };
