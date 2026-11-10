import { readFileSync, writeFileSync, existsSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
export interface State { address: string; chain: number; lastBlock: string }
function statePath(ledgerPath: string): string { return join(dirname(ledgerPath), "watchdog-state.json"); }
export function readState(ledgerPath: string): State | null {
  const path = statePath(ledgerPath);
  if (!existsSync(path)) return null;
  const parsed = JSON.parse(readFileSync(path, "utf8")) as State;
  if (parsed.chain !== 8453 || !/^0x[0-9a-fA-F]{40}$/.test(parsed.address) || !/^(0|[1-9][0-9]*)$/.test(parsed.lastBlock)) throw new Error("invalid watchdog state; inspect it before restarting");
  return parsed;
}
export function writeState(ledgerPath: string, state: State): void {
  const path = statePath(ledgerPath);
  writeFileSync(path + ".tmp", JSON.stringify(state, null, 2) + "\n");
  renameSync(path + ".tmp", path);
}
export function resumeBlock(saved: State | null, address: string, head: bigint): bigint {
  if (!saved) return head;
  if (saved.address.toLowerCase() !== address.toLowerCase()) throw new Error("watchdog state belongs to another address");
  const cursor = BigInt(saved.lastBlock);
  if (cursor > head) throw new Error("saved cursor is ahead of chain head");
  return cursor;
}
