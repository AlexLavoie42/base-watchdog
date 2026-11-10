import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  checkPermission,
  EMPTY_PERMISSION_CONFIG,
  loadPermissionConfig,
  parsePermissionConfig,
} from "../src/permissions.js";

test("empty configuration denies each external action class and keeps mission active", () => {
  for (const action of ["registrations", "publishing", "repoContributions", "outreach", "webhooks"]) {
    const decision = checkPermission(EMPTY_PERMISSION_CONFIG, action, "example");
    assert.equal(decision.allowed, false);
    assert.equal(decision.blockedAction, `${action}:example`);
    assert.equal(decision.continueMission, true);
  }
});

test("only an exact explicitly granted scope is allowed", () => {
  const config = parsePermissionConfig({
    version: 1,
    grants: { publishing: ["account:demo"], webhooks: ["https://hooks.example.test/abc"] },
  });
  assert.equal(checkPermission(config, "publishing", "account:demo").allowed, true);
  assert.equal(checkPermission(config, "publishing", "account:other").allowed, false);
  assert.equal(checkPermission(config, "unknown", "account:demo").allowed, false);
  assert.equal(checkPermission(config, "webhooks", "").allowed, false);
});

test("invalid config fails closed and unknown classes are rejected", () => {
  assert.throws(() => parsePermissionConfig({ version: 1, grants: { publish: ["x"] } }), /unknown permission class/);
  assert.throws(() => parsePermissionConfig({ version: 1, grants: { outreach: [""] } }), /non-empty/);

  const dir = mkdtempSync(join(tmpdir(), "money-permissions-"));
  try {
    const path = join(dir, "permissions.json");
    writeFileSync(path, "{invalid", "utf8");
    assert.throws(() => loadPermissionConfig(path));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});


test("an explicit class-wide grant is limited to that class", () => {
  const config = parsePermissionConfig({ version: 1, grants: { publishing: ["*"] } });
  assert.equal(checkPermission(config, "publishing", "account:demo").allowed, true);
  assert.equal(checkPermission(config, "repoContributions", "owner/repo").allowed, false);
  assert.equal(checkPermission(config, "publishing", "").allowed, false);
});
