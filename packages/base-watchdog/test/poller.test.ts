import { test } from "node:test";
import assert from "node:assert/strict";
import { custom, createPublicClient, pad, toHex, parseEther, type PublicClient, type Transport } from "viem";
import { pollRange } from "../src/config.js";
import { TRANSFER_EVENT } from "zero-wallet";

const ADDR = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

function erc20Log(txHash: string, to: string, value: bigint) {
  const sender = "0x1111111111111111111111111111111111111111";
  return {
    address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", // known USDC
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

function clientWith(handlers: Record<string, (params: any) => unknown>): PublicClient {
  return createPublicClient({
    transport: custom({
      async request({ method, params }: { method: string; params: any }) {
        if (method === "eth_chainId" && !handlers[method]) return "0x2105";
        if (method === "eth_getTransactionReceipt" && !handlers[method]) return { status: "0x1" };
        const h = handlers[method];
        if (!h) throw new Error(`mock: unexpected rpc ${method}`);
        return h(params);
      },
    }) as Transport,
  });
}

test("pollRange falls back to the next RPC when the first fails (real-world 429 case)", async () => {
  const bad = clientWith({
    eth_getLogs: () => {
      throw new Error("429 request limit reached");
    },
  });
  const good = clientWith({
    eth_getLogs: () => [erc20Log("0xtx1", ADDR, 1500000n)],
    eth_getBlockByNumber: () => ({ number: "0x64", hash: "0xb", transactions: [] }),
  });
  const found = await pollRange([bad, good], ADDR, 100n, 100n);
  assert.equal(found.length, 1);
  assert.equal(found[0]!.tokenSymbol, "USDC");
  assert.equal(found[0]!.amountRaw, 1500000n);
});

test("pollRange chunks native scans over long ranges and dedupes nothing", async () => {
  const blocksSeen: string[] = [];
  const client = clientWith({
    eth_getLogs: () => [],
    eth_getBlockByNumber: (p: any) => {
      const tag = Array.isArray(p) ? p[0] : p;
      blocksSeen.push(tag);
      // one native transfer in block 0xc8 (200)
      if (tag === "0xc8") {
        return {
          number: tag,
          hash: "0xb",
          transactions: [
            {
              hash: "0xn1",
              from: "0x1111111111111111111111111111111111111111",
              to: ADDR,
              value: toHex(parseEther("0.5")),
            },
          ],
        };
      }
      return { number: tag, hash: "0xb", transactions: [] };
    },
  });
  // range 0x64..0x12b = 100..299 → chunks of 100: 100..199, 200..299
  const found = await pollRange([client], ADDR, 100n, 299n);
  assert.equal(found.filter((t) => t.kind === "native").length, 1);
  assert.equal(found.find((t) => t.kind === "native")!.txHash, "0xn1");
  // chunking actually happened (≥3 getBlockByNumber calls across 200 blocks)
  assert.ok(blocksSeen.length >= 200, `expected per-block scans, got ${blocksSeen.length}`);
});

test("pollRange throws only when ALL rpcs fail", async () => {
  const bad1 = clientWith({ eth_getLogs: () => { throw new Error("429"); } });
  const bad2 = clientWith({ eth_getLogs: () => { throw new Error("503"); } });
  await assert.rejects(() => pollRange([bad1, bad2], ADDR, 1n, 2n), /all RPCs failed[\s\S]*429[\s\S]*503/);
});

// silence unused-import lint in some setups
void TRANSFER_EVENT;


test("pollRange refuses a wrong chain", async () => {
  const wrong = clientWith({ eth_chainId: () => "0x1" });
  await assert.rejects(() => pollRange([wrong], ADDR, 1n, 1n), /not Base mainnet/);
});
