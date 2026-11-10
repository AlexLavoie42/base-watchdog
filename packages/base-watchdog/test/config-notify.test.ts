import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig, formatMessage } from "../src/config.js";
import { notify, notifyAll } from "../src/notify.js";

test("loadConfig requires a valid address", () => {
  assert.throws(() => loadConfig({}), /WATCH_ADDRESS/);
  assert.throws(() => loadConfig({ WATCH_ADDRESS: "0x123" }), /WATCH_ADDRESS/);
  const cfg = loadConfig({ WATCH_ADDRESS: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" });
  assert.equal(cfg.rpcUrls.length >= 1, true);
  assert.equal(cfg.pollSeconds, 30);
  assert.equal(cfg.webhookUrl, null);
});

test("loadConfig parses rpc list, webhook, overrides", () => {
  const cfg = loadConfig({
    WATCH_ADDRESS: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
    RPC_URLS: "https://a.example , https://b.example ",
    WEBHOOK_URL: "https://discord.example/hook",
    POLL_SECONDS: "10",
  });
  assert.deepEqual(cfg.rpcUrls, ["https://a.example", "https://b.example"]);
  assert.equal(cfg.webhookUrl, "https://discord.example/hook");
  assert.equal(cfg.pollSeconds, 10);
});

test("formatMessage renders known and unknown tokens", () => {
  const known = formatMessage({
    kind: "erc20",
    tokenContract: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    tokenSymbol: "USDC",
    decimals: 6,
    txHash: "0xabc",
    from: "0x1",
    to: "0x2",
    amountRaw: 2500000n,
    blockNumber: 1n,
  });
  assert.ok(known.includes("2.5 USDC"));
  assert.ok(known.includes("basescan.org/tx/0xabc"));
  const unknown = formatMessage({
    kind: "erc20",
    tokenContract: "0x9999999999999999999999999999999999999999",
    tokenSymbol: "UNKNOWN",
    decimals: 18,
    txHash: "0xdef",
    from: "0x1",
    to: "0x2",
    amountRaw: 1n,
    blockNumber: 1n,
  });
  assert.ok(unknown.includes("UNKNOWN(0x9999"));
});

function mockFetch(status: number, log: string[] = []) {
  return (async (url: any, init: any) => {
    log.push(`${init.method} ${url} ${init.body}`);
    return new Response(status === 200 ? "ok" : "err", { status });
  }) as unknown as typeof fetch;
}

test("notify posts Discord-compatible JSON and reports failure without throwing", async () => {
  const log: string[] = [];
  const ok = await notify("https://hook.example/x", "hello", mockFetch(200, log));
  assert.equal(ok.ok, true);
  assert.deepEqual(JSON.parse(log[0]!.split(" ").slice(2).join(" ")), { content: "hello" });

  const fail = await notify("https://hook.example/x", "hello", mockFetch(500));
  assert.equal(fail.ok, false);
  assert.equal(fail.status, 500);

  const none = await notify(null, "hello");
  assert.equal(none.ok, false);
  assert.equal(none.status, 0);
});

test("notifyAll maps over transfers", async () => {
  const log: string[] = [];
  const results = await notifyAll(
    "https://hook.example/x",
    [
      {
        kind: "native" as const,
        tokenContract: "",
        tokenSymbol: "ETH",
        decimals: 18,
        txHash: "0x1",
        from: "0xa",
        to: "0xb",
        amountRaw: 1n,
        blockNumber: null,
      },
      {
        kind: "native" as const,
        tokenContract: "",
        tokenSymbol: "ETH",
        decimals: 18,
        txHash: "0x2",
        from: "0xa",
        to: "0xb",
        amountRaw: 2n,
        blockNumber: null,
      },
    ],
    mockFetch(200, log)
  );
  assert.equal(results.length, 2);
  assert.ok(results.every((r) => r.ok));
  assert.equal(log.length, 2);
});


test("invalid configuration is rejected", () => {
  const WATCH_ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
  assert.throws(() => loadConfig({ WATCH_ADDRESS: "0xf39fd6e51aad88F6F4ce6aB8827279cffFb92266" }), /WATCH_ADDRESS/);
  for (const value of ["0", "NaN", "1.5"]) assert.throws(() => loadConfig({ WATCH_ADDRESS, POLL_SECONDS: value }), /POLL_SECONDS/);
  assert.throws(() => loadConfig({ WATCH_ADDRESS, MAX_NATIVE_SCAN: "0" }), /MAX_NATIVE_SCAN/);
  assert.throws(() => loadConfig({ WATCH_ADDRESS, RPC_URLS: "" }), /RPC_URLS/);
});
