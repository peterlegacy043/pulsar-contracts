import https from "https";
import http from "http";
import { URL } from "url";
import * as dlq from "./dlq";

export interface WebhookPayload {
  event: string;
  contractId: string;
  ledger: number;
  timestamp: number;
  data: Record<string, unknown>;
}

/**
 * Explicit allowlist of `data` fields per event type.
 *
 * Only fields listed here are forwarded to merchants; any other field present
 * on the raw Soroban event value is stripped before delivery (and before the
 * payload is stored in the DLQ).  Events not present in this map receive an
 * empty `data` object.
 */
export const EVENT_DATA_ALLOWLIST: Record<string, readonly string[]> = {
  payment_processed: ["id", "payer", "merchant", "amount", "token", "orderId"],
  refund_requested: ["id", "paymentId", "amount", "reason"],
  refund_completed: ["id", "paymentId", "amount", "reason"],
  refund_failed: ["id", "paymentId", "amount", "reason"],
  multisig_created: ["id", "signers", "threshold", "approvals"],
  multisig_approved: ["id", "signers", "threshold", "approvals"],
  multisig_executed: ["id", "signers", "threshold", "approvals"],
};

/**
 * Return only the fields of `raw` that are on the allowlist for `event`.
 * Unknown events yield an empty object.
 */
export function filterEventData(
  event: string,
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const allowed = EVENT_DATA_ALLOWLIST[event];
  if (!allowed) return {};

  const filtered: Record<string, unknown> = {};
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(raw, key)) {
      filtered[key] = raw[key];
    }
  }
  return filtered;
}

const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 1_000;

/**
 * Attempt to deliver `payload` to `url` with exponential-backoff retries.
 *
 * If all attempts are exhausted, the delivery is moved to the Dead Letter
 * Queue (DLQ) instead of being silently dropped.  The DLQ can be inspected
 * and replayed via the admin API endpoints:
 *
 *   GET  /admin/dlq           — list all failed deliveries
 *   GET  /admin/dlq/:id       — inspect a single entry
 *   POST /admin/dlq/:id/replay — replay a single entry
 */
export async function deliver(
  url: string,
  payload: WebhookPayload,
): Promise<void> {
  // Strip any fields not on the per-event allowlist before serialising so that
  // internal contract data is never exposed to merchants (or the DLQ).
  const safePayload: WebhookPayload = {
    ...payload,
    data: filterEventData(payload.event, payload.data),
  };

  const body = JSON.stringify(safePayload);
  const firstAttemptAt = new Date().toISOString();
  let lastError = "unknown error";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await post(url, body);
      return; // success — nothing to DLQ
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);

      if (attempt === MAX_ATTEMPTS) {
        // All attempts exhausted — move to DLQ (with the filtered payload).
        dlq.enqueue(url, safePayload, attempt, lastError, firstAttemptAt);
        return;
      }

      const delay = BASE_DELAY_MS * 2 ** (attempt - 1);
      console.warn(
        `[webhook] Attempt ${attempt}/${MAX_ATTEMPTS} failed for ${url} (${lastError}). Retrying in ${delay}ms…`,
      );
      await sleep(delay);
    }
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function post(url: string, body: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === "https:" ? https : http;
    const req = lib.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          "User-Agent": "pulsar-webhook/0.1",
        },
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve();
        } else {
          reject(new Error(`HTTP ${res.statusCode}`));
        }
        res.resume();
      },
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
