# base-watchdog

**Self-hosted incoming-payment monitor & webhook notifier for Base.** Watch any address for native ETH and ERC-20 transfers using public RPCs only — no indexer account, no API keys, no backend, no keys of any kind.

Two MIT-licensed packages:

| Package | What it is |
|---|---|
| [`packages/base-watchdog`](packages/base-watchdog) | The monitor: polls public Base RPCs with automatic fallback rotation, chunked native-transfer scans, to-filtered ERC-20 `Transfer` logs, Discord/Slack-compatible webhook notifications, deduped append-only CSV ledger, and a resumable block cursor (`watchdog-state.json`) so restarts never miss a transfer |
| [`packages/wallet`](packages/wallet) | The read-only library underneath it (also usable standalone): address validation, balances, bounded incoming-transfer scanning, a classified CSV ledger, canonical explorer links, and a CLI. Read-only by construction — no signer, no key handling, no transaction code |

## Why

Merchants, donation addresses, machine-payment endpoints, and agents on Base usually have two bad options: hand over an address to a third-party dashboard, or run a paid indexer account. base-watchdog is the third option — a few files of auditable TypeScript you run yourself, against RPCs anyone can use.

## Quickstart

```bash
git clone https://github.com/AlexLavoie42/base-watchdog.git
cd base-watchdog/packages/base-watchdog
npm install

WATCH_ADDRESS=0xYourAddress npm start            # monitor + CSV ledger
WATCH_ADDRESS=0xYourAddress WEBHOOK_URL=https://discord.com/api/webhooks/… npm start   # + notifications
WATCHDOG_ONCE=1 WATCH_ADDRESS=0xYourAddress npx tsx src/main.ts   # single scan, then exit
```

Default RPC list is ordered by real-world capability: `base.drpc.org` (allows both log queries and full-tx blocks), then `mainnet.base.org` (blocks address-less `eth_getLogs`). Bring your own list with `RPC_URLS=a,b,c`.

## Field notes encoded in the code

- Address-less `eth_getLogs` is rejected by some public RPCs (HTTP 429); historical full-transaction blocks by others (HTTP 410) — the fallback list and per-scan error rotation handle both.
- A failed poll never advances the block cursor: transfers are re-scanned, never skipped.
- Unknown token contracts are labeled `UNKNOWN(0x…)`, never trusted, and never counted as income.
- Ledger rows carry a classification column; only deliberately-verified rows are ever treated as value received. Everything starts `unverified`.

## Tests

```bash
cd packages/wallet && npm install && npm test        # mock-transport tests, fully offline
cd ../base-watchdog && npm install && npm test       # config/notify/poller/state tests, offline
```

## Non-goals / honesty

- This tool never holds keys and cannot send anything; it is read-only monitoring.
- Native-ETH history scanning walks blocks on public RPCs — keep ranges modest (`MAX_NATIVE_SCAN`); deep history belongs to indexers.
- ERC-721 transfers appear as raw token IDs on the UNKNOWN path.

MIT licensed. PRs welcome.
