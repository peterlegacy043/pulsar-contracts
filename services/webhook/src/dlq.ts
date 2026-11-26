/**
 * Dead Letter Queue (DLQ) for permanently failed webhook deliveries.
 *
 * Architecture
 * ------------
 * When a webhook delivery exhausts all retry attempts without a 2xx
 * response, the delivery is moved here instead of being silently dropped.
 *
 * Storage
 * -------
 * Entries are persisted to the `dlq_entries` database table (see
 * services/webhook/migrations/001_create_dlq_entries.sql) via the shared
 * pg Pool.  This ensures permanently failed deliveries survive process
 * restarts and can still be replayed through the admin API afterwards.
 *
 * On startup, call `loadOpenEntries()` to warm the in-process cache of
 * open (non-replayed) entries.  All read/write operations go to the DB;
 * the cache is only used for fast depth checks and alerting.
 *
 * Alert threshold
 * ---------------
 * Set DLQ_ALERT_THRESHOLD (environment variable or compile-time constant)
 * to emit a console warning / emit a metric whenever the DLQ depth
 * exceeds that value.  Wire the warning to your alerting system (e.g.
 * CloudWatch, Datadog, PagerDuty).
 */

import { Pool } from "pg";
import { WebhookPayload } from "./deliver";

// ── Constants ──────────────────────────────────────────────────────────────────

/**
 * DLQ depth that triggers an alert.
 * Override via environment variable DLQ_ALERT_THRESHOLD.
 */
export const DLQ_ALERT_THRESHOLD =
  Number(process.env.DLQ_ALERT_THRESHOLD ?? 10);

// ── Types ──────────────────────────────────────────────────────────────────────

export interface DlqEntry {
  /** Unique identifier for this DLQ entry. */
  id: string;
  /** The target URL that could not be reached. */
  url: string;
  /** The payload that failed to deliver. */
  payload: WebhookPayload;
  /** ISO-8601 timestamp of the first delivery attempt. */
  firstAttemptAt: string;
  /** ISO-8601 timestamp when it was moved to the DLQ. */
  failedAt: string;
  /** Number of delivery attempts that were made. */
  attempts: number;
  /** Last error message encountered. */
  lastError: string;
  /** ISO-8601 timestamp of the last replay attempt, if any. */
  lastReplayAt?: string;
  /** Number of replay attempts made from the DLQ. */
  replayAttempts: number;
}

// ── Database connection ────────────────────────────────────────────────────────

/**
 * Shared pg Pool.  Reuses DATABASE_URL from the environment.  A single
 * pool is created lazily so importing this module does not require a
 * live database (useful for unit tests that inject a mock pool).
 */
let _pool: Pool | undefined;

export function getPool(): Pool {
  if (!_pool) {
    _pool = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return _pool;
}

/** Override the pool (used by tests). */
export function setPool(pool: Pool | undefined): void {
  _pool = pool;
}

// ── In-process cache of open entries ──────────────────────────────────────────

// Mirrors non-replayed rows so depth()/alerting avoid a DB round-trip.
const openEntries = new Map<string, DlqEntry>();
let _sequenceCounter = 0;

function generateId(): string {
  _sequenceCounter += 1;
  return `dlq_${Date.now()}_${_sequenceCounter}`;
}

// ── Row mapping ───────────────────────────────────────────────────────────────

interface DlqRow {
  id: string;
  url: string;
  payload: WebhookPayload;
  first_attempt_at: string | Date;
  failed_at: string | Date;
  attempts: number;
  last_error: string;
  last_replay_at: string | Date | null;
  replay_attempts: number;
  replayed: boolean;
}

function toIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function rowToEntry(row: DlqRow): DlqEntry {
  return {
    id: row.id,
    url: row.url,
    payload: row.payload,
    firstAttemptAt: toIso(row.first_attempt_at),
    failedAt: toIso(row.failed_at),
    attempts: row.attempts,
    lastError: row.last_error,
    lastReplayAt: row.last_replay_at ? toIso(row.last_replay_at) : undefined,
    replayAttempts: row.replay_attempts,
  };
}

// ── Startup loading ───────────────────────────────────────────────────────────

/**
 * Load all open (non-replayed) DLQ entries from the database into the
 * in-process cache.  Call once on service startup so alerting and depth
 * checks reflect persisted state after a restart.
 */
export async function loadOpenEntries(): Promise<DlqEntry[]> {
  const { rows } = await getPool().query<DlqRow>(
    `SELECT id, url, payload, first_attempt_at, failed_at, attempts,
            last_error, last_replay_at, replay_attempts, replayed
       FROM dlq_entries
      WHERE replayed = false
      ORDER BY failed_at DESC`,
  );
  openEntries.clear();
  const entries = rows.map(rowToEntry);
  for (const entry of entries) {
    openEntries.set(entry.id, entry);
  }
  return entries;
}

// ── Core DLQ operations ────────────────────────────────────────────────────────

/**
 * Move a permanently failed delivery into the DLQ.
 *
 * Emits a console error (visible in structured logging / CloudWatch).
 * If the DLQ depth exceeds DLQ_ALERT_THRESHOLD a warning is also emitted —
 * wire this to your alerting integration.
 */
export async function enqueue(
  url: string,
  payload: WebhookPayload,
  attempts: number,
  lastError: string,
  firstAttemptAt: string,
): Promise<DlqEntry> {
  const entry: DlqEntry = {
    id: generateId(),
    url,
    payload,
    firstAttemptAt,
    failedAt: new Date().toISOString(),
    attempts,
    lastError,
    replayAttempts: 0,
  };

  await getPool().query(
    `INSERT INTO dlq_entries
       (id, url, payload, first_attempt_at, failed_at, attempts,
        last_error, last_replay_at, replay_attempts, replayed)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      entry.id,
      entry.url,
      JSON.stringify(entry.payload),
      entry.firstAttemptAt,
      entry.failedAt,
      entry.attempts,
      entry.lastError,
      entry.lastReplayAt ?? null,
      entry.replayAttempts,
      false,
    ],
  );

  openEntries.set(entry.id, entry);

  console.error(
    `[dlq] Permanent delivery failure — enqueued id=${entry.id} url=${url} attempts=${attempts} error="${lastError}"`,
  );

  checkAlertThreshold();

  return entry;
}

/**
 * Retrieve a single DLQ entry by ID.
 */
export async function getEntry(id: string): Promise<DlqEntry | undefined> {
  const { rows } = await getPool().query<DlqRow>(
    `SELECT id, url, payload, first_attempt_at, failed_at, attempts,
            last_error, last_replay_at, replay_attempts, replayed
       FROM dlq_entries
      WHERE id = $1`,
    [id],
  );
  return rows.length > 0 ? rowToEntry(rows[0]) : undefined;
}

/**
 * List all DLQ entries, newest first.
 *
 * Optionally filter to entries for a specific merchant URL prefix.
 */
export async function listEntries(urlPrefix?: string): Promise<DlqEntry[]> {
  const { rows } = urlPrefix
    ? await getPool().query<DlqRow>(
        `SELECT id, url, payload, first_attempt_at, failed_at, attempts,
                last_error, last_replay_at, replay_attempts, replayed
           FROM dlq_entries
          WHERE url LIKE $1
          ORDER BY failed_at DESC`,
        [`${urlPrefix}%`],
      )
    : await getPool().query<DlqRow>(
        `SELECT id, url, payload, first_attempt_at, failed_at, attempts,
                last_error, last_replay_at, replay_attempts, replayed
           FROM dlq_entries
          ORDER BY failed_at DESC`,
      );
  return rows.map(rowToEntry);
}

/**
 * Current DLQ depth (number of open, non-replayed entries).
 */
export function depth(): number {
  return openEntries.size;
}

/**
 * Remove a DLQ entry after a successful replay.
 */
export async function remove(id: string): Promise<boolean> {
  const result = await getPool().query(
    `DELETE FROM dlq_entries WHERE id = $1`,
    [id],
  );
  openEntries.delete(id);
  return (result.rowCount ?? 0) > 0;
}

/**
 * Mark a replay attempt on an entry (before the attempt is made).
 */
export async function markReplayAttempt(
  id: string,
): Promise<DlqEntry | undefined> {
  const { rows } = await getPool().query<DlqRow>(
    `UPDATE dlq_entries
        SET last_replay_at = $2,
            replay_attempts = replay_attempts + 1
      WHERE id = $1
      RETURNING id, url, payload, first_attempt_at, failed_at, attempts,
                last_error, last_replay_at, replay_attempts, replayed`,
    [id, new Date().toISOString()],
  );
  if (rows.length === 0) return undefined;
  const updated = rowToEntry(rows[0]);
  openEntries.set(id, updated);
  return updated;
}

/**
 * Mark an entry as replayed (kept for audit) and drop it from the open cache.
 */
export async function markReplayed(id: string): Promise<boolean> {
  const result = await getPool().query(
    `UPDATE dlq_entries SET replayed = true WHERE id = $1`,
    [id],
  );
  openEntries.delete(id);
  return (result.rowCount ?? 0) > 0;
}

// ── Alert helper ──────────────────────────────────────────────────────────────

function checkAlertThreshold(): void {
  const current = openEntries.size;
  if (current >= DLQ_ALERT_THRESHOLD) {
    console.warn(
      `[dlq] ALERT: DLQ depth ${current} has reached or exceeded threshold ${DLQ_ALERT_THRESHOLD}. ` +
        `Inspect and replay entries via the admin API: GET /admin/dlq`,
    );
    // TODO: emit metric to your alerting backend here, e.g.:
    //   cloudwatch.putMetricData({ ... dlqDepth: current ... })
  }
}
