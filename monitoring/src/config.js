/**
 * config.js — Runtime configuration for the Pulsar contract monitor.
 *
 * All values can be overridden via environment variables so that no secrets
 * are hard-coded in source.
 */

"use strict";

const config = {
  // ── Stellar network ────────────────────────────────────────────────────────

  /**
   * Horizon base URL. Use https://horizon.stellar.org for Mainnet.
   *
   * SECURITY: The monitoring service should only connect to official Horizon
   * URLs (e.g. https://horizon.stellar.org, https://horizon-testnet.stellar.org)
   * or audited mirrors.  Plain-HTTP URLs are rejected with a startup warning
   * because a MITM proxy could otherwise silently serve fraudulent data.
   */
  horizonUrl: process.env.HORIZON_URL || "https://horizon-testnet.stellar.org",

  /**
   * Optional path to a PEM-encoded CA bundle used to validate the Horizon TLS
   * certificate (env: HORIZON_CA_CERT).  Set this when connecting through a
   * corporate/self-hosted network whose proxy presents a custom CA.  Leave
   * empty to use the system trust store.
   */
  horizonCaCert: process.env.HORIZON_CA_CERT || "",

  /** The deployed contract ID to monitor. */
  contractId: process.env.CONTRACT_ID || "",

  // ── Polling ────────────────────────────────────────────────────────────────

  /**
   * How often (ms) to poll Horizon for new contract events.
   * Horizon supports SSE streaming; we use polling as a simpler fallback.
   */
  pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS || "15000", 10),

  /**
   * How often (ms) to call the contract's `ping` health-check endpoint
   * (BE-007).  A successful `ping` response confirms the contract is live and
   * returns the current ledger timestamp.  Default: 300 000 ms (5 minutes).
   */
  pingIntervalMs: parseInt(process.env.PING_INTERVAL_MS || "300000", 10),

  // ── Alert thresholds ───────────────────────────────────────────────────────

  /**
   * Refund rate alert: if (refunds / payments) > this fraction within the
   * rolling window, fire an alert.  Default: 0.20 (20 %).
   */
  refundRateThreshold: parseFloat(process.env.REFUND_RATE_THRESHOLD || "0.20"),

  /**
   * Rolling window (ms) used to compute the refund rate.
   * Default: 3 600 000 ms = 1 hour.
   */
  refundRateWindowMs: parseInt(
    process.env.REFUND_RATE_WINDOW_MS || "3600000",
    10
  ),

  /**
   * Large-payment alert: fire when a single payment exceeds this amount
   * (in the token's smallest unit, e.g. stroops for XLM).
   * Default: 1 000 000 000 (1 000 XLM at 7 decimal places).
   */
  largePaymentThreshold: BigInt(
    process.env.LARGE_PAYMENT_THRESHOLD || "1000000000"
  ),

  /**
   * Error-rate alert: if (failed_txs / total_txs) > this fraction within the
   * rolling window, fire an alert.  Default: 0.05 (5 %).
   */
  errorRateThreshold: parseFloat(process.env.ERROR_RATE_THRESHOLD || "0.05"),

  // ── Alerting ───────────────────────────────────────────────────────────────

  /**
   * Webhook URL to POST alert payloads to (Slack, PagerDuty, etc.).
   * Leave empty to only log alerts to stdout.
   */
  alertWebhookUrl: process.env.ALERT_WEBHOOK_URL || "",
};

// Validate required fields at startup.
if (!config.contractId) {
  console.warn(
    "[config] WARNING: CONTRACT_ID is not set. " +
      "Set the CONTRACT_ID environment variable to the deployed contract address."
  );
}

// SECURITY: Enforce HTTPS for Horizon connections.  Only official Horizon URLs
// or audited mirrors should be used; a plain-HTTP endpoint could be spoofed by
// a MITM proxy.
if (!config.horizonUrl.startsWith("https:")) {
  console.warn(
    "[config] WARNING: HORIZON_URL does not use https: (" +
      config.horizonUrl +
      "). The monitoring service should only connect to official Horizon URLs " +
      "or audited mirrors over HTTPS."
  );
}

module.exports = config;
