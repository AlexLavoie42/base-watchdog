# Receive-only Base wallet

Uses viem for public address validation, balances, block and event reads. No signer or key handling is included.

From this directory, `npm run cli -- balance [address] [--token address]` reads Base mainnet; `npm run cli -- watch [address] --from N --blocks N` scans a bounded range of direct native transfers and ERC-20 Transfer events; `npm run cli -- ledger --summary` groups recorded raw amounts by chain, contract, and classification. Without an address, balance and watch read `production-address.txt`. `BASE_RPC_URL` overrides the public mainnet RPC; the CLI checks chain ID. `LEDGER_PATH` overrides `../LEDGER.csv`.

The scan captures direct native transactions with successful receipts and ERC-20 Transfer logs, not contract-internal native transfers, all possible token standards, outgoing transactions, or complete historical activity. Unknown token events can be misleading, including NFTs and spoofed logs. Amounts for unknown tokens assume 18 decimals and are not valuations. Check the explorer and token contract independently. Public RPCs may rate-limit, omit history, or disagree; scans may fail and should be retried. The scan does not wait for finality or reconcile chain reorganizations. Review confirmations before relying on a receipt.

Observed receipts default to `unverified`, never automatically earned. Only classify a confirmed independent payment for legitimate work as `earned` after checking counterparty, source, costs and evidence; self-funding, testnet and spam are not earnings. The summary lists raw units, not net fiat income. Do not run multiple writers against the CSV concurrently.
