import { formatMessage } from "./config.js";

export interface WebhookResult {
  ok: boolean;
  status: number;
  body?: string;
}

/**
 * Post a notification. Discord/Slack-compatible: sends {"content": message} JSON.
 * Returns failure info instead of throwing — notification is best-effort; the
 * CSV ledger remains the source of truth.
 */
export async function notify(
  webhookUrl: string | null,
  message: string,
  fetchImpl: typeof fetch = fetch
): Promise<WebhookResult> {
  if (!webhookUrl) return { ok: false, status: 0, body: "no webhook configured" };
  try {
    const res = await fetchImpl(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: message }),
    });
    return { ok: res.ok, status: res.status, body: res.ok ? undefined : await res.text() };
  } catch (e) {
    return { ok: false, status: -1, body: (e as Error).message };
  }
}

export function notifyAll(
  webhookUrl: string | null,
  transfers: Parameters<typeof formatMessage>[0][],
  fetchImpl: typeof fetch = fetch
): Promise<WebhookResult[]> {
  return Promise.all(transfers.map((t) => notify(webhookUrl, formatMessage(t), fetchImpl)));
}
