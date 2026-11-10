/**
 * base-watchdog main loop.
 *
 *   WATCH_ADDRESS=0x… WEBHOOK_URL=https://… npm start
 *
 * Polls public Base RPCs for incoming native/ERC-20 transfers, appends each to
 * the CSV ledger (deduped), fires the webhook, and advances the last-seen
 * block pointer (stored beside the ledger as watchdog-state.json).
 */
import { loadConfig, makeClients, pollRange, formatMessage } from "./config.js";
import { appendEntry, initLedger, toLedgerEntry, loadPermissionConfig, checkPermission } from "zero-wallet";
import { notify } from "./notify.js";
import { readState, writeState, resumeBlock } from "./state.js";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  const clients = makeClients(cfg.rpcUrls);
  initLedger(cfg.ledgerPath);
  console.log(
    `base-watchdog: watching ${cfg.watchAddress} on Base every ${cfg.pollSeconds}s ` +
      `(RPC endpoints: ${cfg.rpcUrls.length}; webhook: ${cfg.webhookUrl ? "configured" : "off"})`
  );

  // first iteration: find current head
  let lastBlock: bigint | null = null;
  for (const client of clients) {
    try {
      if (await client.getChainId() !== 8453) throw new Error("wrong chain");
      lastBlock = await client.getBlockNumber();
      break;
    } catch {
      /* try next */
    }
  }
  if (lastBlock === null) throw new Error("no RPC reachable at startup");
  const saved = readState(cfg.ledgerPath);
  lastBlock = resumeBlock(saved, cfg.watchAddress, lastBlock);
  if (!saved) writeState(cfg.ledgerPath, { address: cfg.watchAddress, chain: 8453, lastBlock: lastBlock.toString() });
  console.log(`starting from block ${lastBlock + 1n}`);

  for (;;) {
    await sleep(cfg.pollSeconds * 1000);
    let head: bigint | null = null;
    for (const client of clients) {
      try {
        if (await client.getChainId() !== 8453) throw new Error("wrong chain");
        head = await client.getBlockNumber();
        break;
      } catch {
        /* rotate */
      }
    }
    if (head === null) {
      console.error(`${new Date().toISOString()} all RPCs unreachable; retrying`);
      continue;
    }
    const from: bigint = (lastBlock ?? head - 1n) + 1n;
    if (head < from) continue;
    // native scan range cap: don't fall behind unboundedly on public RPCs
    const to: bigint = head - from >= cfg.maxNativeScan ? from + cfg.maxNativeScan - 1n : head;
    try {
      const transfers = await pollRange(clients, cfg.watchAddress, from, to);
      for (const t of transfers) {
        const entry = toLedgerEntry(t, 8453);
        if (appendEntry(cfg.ledgerPath, entry)) {
          console.log(`${new Date().toISOString()} ${formatMessage(t).replace(/\n/, " ")}`);
          if (cfg.webhookUrl) {
            try {
              const decision = checkPermission(loadPermissionConfig(), "webhooks", "payment-notifications");
              if (decision.allowed) {
                const wh = await notify(cfg.webhookUrl, formatMessage(t));
                if (!wh.ok) console.error(`webhook failed: ${wh.status}`);
              } else console.error(`blocked ${decision.blockedAction}; monitoring continues`);
            } catch { console.error("permissions unavailable; webhook blocked; monitoring continues"); }
          }
        }
      }
    } catch (e) {
      console.error(`${new Date().toISOString()} poll failed: ${(e as Error).message}`);
      continue; // do not advance lastBlock on failure — retry the range
    }
    lastBlock = to;
    writeState(cfg.ledgerPath, { address: cfg.watchAddress, chain: 8453, lastBlock: to.toString() });
  }
}

// allow one-shot run for tests/CI: WATCHDOG_ONCE=1 runs a single poll then exits
if (process.env.WATCHDOG_ONCE === "1") {
  const cfg = loadConfig();
  const clients = makeClients(cfg.rpcUrls);
  if (await clients[0]!.getChainId() !== 8453) throw new Error("RPC is not Base mainnet");
  const head = await clients[0]!.getBlockNumber();
  const from = head > 5n ? head - 5n : 0n;
  const transfers = await pollRange(clients, cfg.watchAddress, from, head);
  console.log(`one-shot: ${transfers.length} transfers in blocks ${from}..${head}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
