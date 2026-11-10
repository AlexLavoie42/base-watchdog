import { defineChain } from "viem";
import { base, baseSepolia } from "viem/chains";

export const BASE_CHAIN_ID = 8453;
export const BASE_SEPOLIA_CHAIN_ID = 84532;

/** Default public read-only RPC. Override with BASE_RPC_URL (or TESTNET_RPC_URL). */
export const RPC_URL_MAINNET =
  process.env.BASE_RPC_URL ?? "https://mainnet.base.org";
export const RPC_URL_TESTNET =
  process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org";

export function chainById(chainId: number) {
  if (chainId === BASE_CHAIN_ID) return base;
  if (chainId === BASE_SEPOLIA_CHAIN_ID) return baseSepolia;
  throw new Error(`Unsupported chain id ${chainId}; this wallet targets Base.`);
}

/** Canonical explorer URL builders (no API key, plain links). */
export function explorerBase(chainId: number): string {
  if (chainId === BASE_CHAIN_ID) return "https://basescan.org";
  if (chainId === BASE_SEPOLIA_CHAIN_ID) return "https://sepolia.basescan.org";
  throw new Error(`Unsupported chain id ${chainId}`);
}

export const KNOWN_TOKENS: Record<
  number,
  Record<string, { symbol: string; decimals: number; name: string }>
> = {
  [BASE_CHAIN_ID]: {
    "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": {
      symbol: "USDC",
      decimals: 6,
      name: "USD Coin (Bridged)",
    },
    "0x4200000000000000000000000000000000000006": {
      symbol: "WETH",
      decimals: 18,
      name: "Wrapped Ether",
    },
    "0x0000000000000000000000000000000000000000": {
      symbol: "ETH",
      decimals: 18,
      name: "Ether (native)",
    },
  },
  [BASE_SEPOLIA_CHAIN_ID]: {
    "0x0000000000000000000000000000000000000000": {
      symbol: "ETH",
      decimals: 18,
      name: "Ether (native)",
    },
  },
};
