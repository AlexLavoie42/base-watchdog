import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readState, writeState, resumeBlock } from "../src/state.js";
test("saved cursor resumes after downtime and rejects mismatched state", () => {
 const dir = mkdtempSync(join(tmpdir(), "watchdog-")); const ledger = join(dir, "ledger.csv");
 const address = "0x1111111111111111111111111111111111111111";
 assert.equal(resumeBlock(readState(ledger), address, 100n), 100n);
 writeState(ledger, { address, chain: 8453, lastBlock: "100" });
 const state = readState(ledger);
 assert.equal(resumeBlock(state, address, 150n), 100n);
 assert.throws(() => resumeBlock(state, "0x2222222222222222222222222222222222222222", 150n));
 assert.throws(() => resumeBlock(state, address, 99n));
 writeFileSync(join(dir, "watchdog-state.json"), "{}");
 assert.throws(() => readState(ledger), /invalid watchdog state/);
});
