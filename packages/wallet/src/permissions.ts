import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Explicit, scope-limited grants for actions that affect external services.
 * Empty lists deny. An explicit "*" grants the whole action class.
 */
export interface PermissionConfig {
  version: 1;
  grants: Record<PermissionClass, string[]>;
}

export type PermissionClass =
  | "registrations"
  | "publishing"
  | "repoContributions"
  | "outreach"
  | "webhooks";

export interface PermissionDecision {
  allowed: boolean;
  action: string;
  scope: string;
  blockedAction: string | null;
  reason: string;
  /** A denied action does not end the economic mission. */
  continueMission: true;
}

export const EMPTY_PERMISSION_CONFIG: PermissionConfig = {
  version: 1,
  grants: {
    registrations: [],
    publishing: [],
    repoContributions: [],
    outreach: [],
    webhooks: [],
  },
};

const PERMISSION_FILE = fileURLToPath(new URL("../../PERMISSIONS.json", import.meta.url));
const PERMISSION_CLASSES: PermissionClass[] = [
  "registrations",
  "publishing",
  "repoContributions",
  "outreach",
  "webhooks",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parse strictly so typos and unknown permission classes cannot grant access. */
export function parsePermissionConfig(value: unknown): PermissionConfig {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.grants)) {
    throw new Error("Permission config must have version 1 and a grants object.");
  }
  const keys = Object.keys(value.grants);
  if (keys.some((key) => !PERMISSION_CLASSES.includes(key as PermissionClass))) {
    throw new Error("Permission config contains an unknown permission class.");
  }

  const grants = { ...EMPTY_PERMISSION_CONFIG.grants };
  for (const permissionClass of PERMISSION_CLASSES) {
    const scopes = value.grants[permissionClass];
    if (scopes === undefined) continue;
    if (!Array.isArray(scopes) || scopes.some((scope) => typeof scope !== "string" || !scope.trim())) {
      throw new Error(`Permission grant '${permissionClass}' must be an array of non-empty scope strings.`);
    }
    grants[permissionClass] = [...new Set((scopes as string[]).map((scope) => scope.trim()))];
  }
  return { version: 1, grants };
}

/** Load the repo-root all-deny config by default; parse/read errors fail closed. */
export function loadPermissionConfig(path = PERMISSION_FILE): PermissionConfig {
  return parsePermissionConfig(JSON.parse(readFileSync(path, "utf8")) as unknown);
}

/** Exact scope or explicit class-wide grant. Unknown classes and empty scopes are denied. */
export function checkPermission(
  config: PermissionConfig,
  action: string,
  scope: string
): PermissionDecision {
  const cleanScope = scope.trim();
  const validClass = PERMISSION_CLASSES.includes(action as PermissionClass);
  const allowed = validClass && cleanScope.length > 0 &&
    config.grants[action as PermissionClass]?.some((grant) => grant === "*" || grant.toLowerCase() === cleanScope.toLowerCase()) === true;
  const label = `${action}:${cleanScope || "<empty scope>"}`;
  return {
    allowed,
    action,
    scope: cleanScope,
    blockedAction: allowed ? null : label,
    reason: allowed ? "Explicit scope grant." : "No explicit grant for this action and scope.",
    continueMission: true,
  };
}

