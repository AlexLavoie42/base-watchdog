import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { custom, hexToBigInt, toHex, parseEther, stringToHex, pad } from "viem";
import {
  makeClient,
  chainIdOf,
  assertChainSupported,
  nativeBalance,
  erc20Balance,
  fetchIncomingErc20,
  fetchIncomingNative,
  toLedgerEntry,
} from "../src/monitor.js";
import { addressUrl, txUrl } from "../src/explorer.js";
import * as wallet from "../src/index.js";

const ADDR = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const TOKEN = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"; // USDC on Base (known list)
const UNKNOWN_TOKEN = "0x9999999999999999999999999999999999999999";

/** Encode an ABI string return value (e.g. for symbol()). */
function abiString(s: string): `0x${string}` {
  const body = stringToHex(s).slice(2).padEnd(64 * (1 + Math.ceil(s.length / 64)), "0");
  return ("0x" +
    pad("0x20").slice(2) +
    toHex(BigInt(s.length)).slice(2).padStart(64, "0") +
    body) as `0x${string}`;
}

function mockTransport(handlers: Record<string, (params: any) => unknown>) {
  return custom({
    async request({ method, params }: { method: string; params: any }) {
      const h = handlers[method];
      if (!h) throw new Error(`mock: unexpected rpc ${method}`);
      return h(params);
    },
  });
}

function erc20Log(txHash: string, to: string, value: bigint, token: string) {
  const sender = "0x1111111111111111111111111111111111111111";
  return {
    address: token,
    topics: [
      "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
      pad(sender.toLowerCase() as `0x${string}`, { size: 32 }),
      pad(to.toLowerCase() as `0x${string}`, { size: 32 }),
    ],
    data: toHex(value),
    transactionHash: txHash,
    blockNumber: "0x64",
    blockHash: "0xblockhash",
    logIndex: "0x0",
    removed: false,
  };
}

test("chainId + native balance via mock transport", async () => {
  const client = makeClient(
    mockTransport({
      eth_chainId: () => "0x2105",
      eth_getBalance: (p) => toHex(parseEther("1.5")),
    })
  );
  assert.equal(await chainIdOf(client), 8453);
  assert.equal(await nativeBalance(client, ADDR), parseEther("1.5"));
});

test("only Base mainnet and Base Sepolia are supported", () => {
  assert.doesNotThrow(() => assertChainSupported(8453));
  assert.doesNotThrow(() => assertChainSupported(84532));
  assert.throws(() => assertChainSupported(1), /Unsupported chain id/);
});

test("erc20 balanceOf via mock transport", async () => {
  const client = makeClient(
    mockTransport({
      eth_chainId: () => "0x2105",
      eth_call: (p: any) => {
        // viem passes eth_call params as an array: [{ to, data }, blockTag]
        const call = Array.isArray(p) ? p[0] : p;
        if (call?.data?.startsWith("0x70a08231")) return pad(toHex(1500000n), { size: 32 }); // balanceOf -> 1.5 USDC
        throw new Error(`mock: unexpected call ${call?.data}`);
      },
    })
  );
  const bal = await erc20Balance(client, ADDR, TOKEN);
  assert.equal(bal, 1500000n);
});

test("incoming ERC-20 logs parsed; known token labeled, unknown token flagged", async () => {
  const client = makeClient(
    mockTransport({
      eth_chainId: () => "0x2105",
      eth_getLogs: () => [
        erc20Log("0xtx1", ADDR, 2500000n, TOKEN),
        erc20Log("0xtx2", ADDR, 777n, UNKNOWN_TOKEN),
      ],
    })
  );
  const found = await fetchIncomingErc20(client, ADDR, 10n, 20n);
  assert.equal(found.length, 2);
  assert.equal(found[0]!.tokenSymbol, "USDC");
  assert.equal(found[0]!.decimals, 6);
  assert.equal(found[0]!.amountRaw, 2500000n);
  assert.equal(found[1]!.tokenSymbol, "UNKNOWN", "unknown contract must be flagged, not trusted");
});

test("incoming native scan filters to-address, value, and reverted transactions", async () => {
  const client = makeClient(
    mockTransport({
      eth_getTransactionReceipt: (p: any) => {
        const hash = Array.isArray(p) ? p[0] : p;
        return { status: hash === "0xreverted" ? "0x0" : "0x1" };
      },
      eth_getBlockByNumber: (p: any) => {
        // return a block with txs only for the requested number
        const tag = Array.isArray(p) ? p[0] : p;
        if (tag !== "0x64") return { number: tag, hash: "0xb", transactions: [] };
        return {
          number: tag,
          hash: "0xb",
          transactions: [
            { hash: "0xin1", from: "0x1111111111111111111111111111111111111111", to: ADDR, value: toHex(parseEther("0.2")) },
            { hash: "0xreverted", from: "0x1111111111111111111111111111111111111111", to: ADDR, value: toHex(parseEther("0.4")) },
            { hash: "0xskip0", from: "0x1111111111111111111111111111111111111111", to: ADDR, value: "0x0" },
            { hash: "0xskip1", from: ADDR, to: "0x2222222222222222222222222222222222222222", value: toHex(1n) },
          ],
        };
      },
    })
  );
  const found = await fetchIncomingNative(client, ADDR, 100n, 100n); // single block
  assert.equal(found.length, 1);
  assert.equal(found[0]!.txHash, "0xin1");
  assert.equal(found[0]!.amountRaw, parseEther("0.2"));
  assert.equal(found[0]!.tokenSymbol, "ETH");
});

test("receive-only wallet exports no account generation or signing surface", () => {
  assert.equal("generateDevAccount" in wallet, false);
  assert.equal("devAccountFromKey" in wallet, false);
  assert.equal("requestTransfer" in wallet, false);
  assert.equal("assertTransferAllowed" in wallet, false);
});

test("CLI rejects a malformed public address before contacting an RPC", () => {
  const cli = resolve(import.meta.dirname, "../node_modules/tsx/dist/cli.mjs");
  const result = spawnSync(
    process.execPath,
    [cli, "src/cli.ts", "balance", "not-an-address"],
    {
      cwd: resolve(import.meta.dirname, ".."),
      env: { ...process.env, BASE_RPC_URL: "http://127.0.0.1:1" },
      encoding: "utf8",
    }
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /not a valid address/);
  assert.doesNotMatch(result.stderr, /ECONNREFUSED/);
});

test("native scan refuses oversized ranges", async () => {
  const client = makeClient(mockTransport({ eth_chainId: () => "0x2105" }));
  await assert.rejects(() => fetchIncomingNative(client, ADDR, 0n, 5000n), /range too large/i);
});

test("toLedgerEntry defaults to unverified and formats decimals", () => {
  const e = toLedgerEntry(
    { kind: "erc20", tokenContract: TOKEN, tokenSymbol: "USDC", decimals: 6, txHash: "0xtx9", from: "0xa", to: ADDR, amountRaw: 1234567n, blockNumber: 5n },
    8453
  );
  assert.equal(e.classification, "unverified");
  assert.equal(e.amountDecimal, "1.234567");
});

test("explorer links are canonical basescan URLs", () => {
  assert.equal(addressUrl(8453, ADDR), `https://basescan.org/address/${ADDR}`);
  assert.equal(addressUrl(84532, ADDR), `https://sepolia.basescan.org/address/${ADDR}`);
  assert.equal(txUrl(8453, "0xdeadbeef"), "https://basescan.org/tx/0xdeadbeef");
});
