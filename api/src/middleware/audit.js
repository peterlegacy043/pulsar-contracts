'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Audit log middleware for the off-chain API layer.
 *
 * Records a structured, append-only audit entry for every request that flows
 * through the API. Each entry captures:
 *   - timestamp (ISO 8601)
 *   - caller IP (req.ip, falling back to x-forwarded-for)
 *   - endpoint (req.originalUrl, falling back to req.path)
 *   - HTTP method
 *   - response status (recorded on the res 'finish' event)
 *   - wallet address(es) when present (business-critical PII)
 *
 * Entries are written as single JSON lines (JSONL) to an append-only file.
 * The destination is configurable via the AUDIT_LOG_PATH environment variable
 * and defaults to `audit.log` in the current working directory.
 *
 * Retention policy: audit logs are retained for 90 days (see documentation).
 */

const DEFAULT_AUDIT_LOG_PATH = 'audit.log';

/**
 * Resolve the audit log destination path.
 * @returns {string}
 */
function resolveAuditLogPath() {
  const configured = process.env.AUDIT_LOG_PATH;
  if (configured && configured.trim().length > 0) {
    return configured.trim();
  }
  return path.resolve(process.cwd(), DEFAULT_AUDIT_LOG_PATH);
}

const AUDIT_LOG_PATH = resolveAuditLogPath();

/**
 * Lazily-created append-mode write stream. Using a single stream in append
 * mode keeps writes ordered and avoids opening the file on every request.
 * @type {fs.WriteStream|null}
 */
let auditStream = null;

/**
 * Get (or create) the append-only write stream for the audit log.
 * @returns {fs.WriteStream}
 */
function getAuditStream() {
  if (!auditStream) {
    auditStream = fs.createWriteStream(AUDIT_LOG_PATH, {
      flags: 'a', // append-only
      encoding: 'utf8',
    });
    auditStream.on('error', (err) => {
      // Never let audit logging crash the process; surface to stderr instead.
      // eslint-disable-next-line no-console
      console.error('[audit] failed to write audit log entry:', err);
    });
  }
  return auditStream;
}

/**
 * Extract the caller IP address from the request.
 * @param {import('express').Request} req
 * @returns {string}
 */
function extractCallerIp(req) {
  if (req.ip) {
    return req.ip;
  }
  const forwarded = req.headers && req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    // x-forwarded-for may contain a comma-separated list; take the first.
    return forwarded.split(',')[0].trim();
  }
  if (Array.isArray(forwarded) && forwarded.length > 0) {
    return String(forwarded[0]).split(',')[0].trim();
  }
  if (req.socket && req.socket.remoteAddress) {
    return req.socket.remoteAddress;
  }
  return 'unknown';
}

/**
 * Extract the endpoint from the request.
 * @param {import('express').Request} req
 * @returns {string}
 */
function extractEndpoint(req) {
  return req.originalUrl || req.path || req.url || 'unknown';
}

/**
 * Collect wallet addresses from the request body and query params.
 * Wallet addresses are business-critical PII and are intentionally included.
 * @param {import('express').Request} req
 * @returns {string[]}
 */
function extractWalletAddresses(req) {
  const addresses = new Set();

  const addIfString = (value) => {
    if (typeof value === 'string' && value.trim().length > 0) {
      addresses.add(value.trim());
    }
  };

  const body = req.body || {};
  addIfString(body.merchant_address);
  addIfString(body.payer);
  if (body.order && typeof body.order === 'object') {
    addIfString(body.order.payer);
  }

  const query = req.query || {};
  addIfString(query.caller);
  addIfString(query.merchant);

  return Array.from(addresses);
}

/**
 * Build a structured audit log entry for the given request/response.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @returns {object}
 */
function buildAuditEntry(req, res) {
  const walletAddresses = extractWalletAddresses(req);
  const entry = {
    timestamp: new Date().toISOString(),
    ip: extractCallerIp(req),
    endpoint: extractEndpoint(req),
    method: req.method,
    status: res.statusCode,
  };

  if (walletAddresses.length > 0) {
    entry.wallet_addresses = walletAddresses;
  }

  return entry;
}

/**
 * Append a single audit entry as a JSON line to the append-only log.
 * @param {object} entry
 */
function writeAuditEntry(entry) {
  try {
    const line = `${JSON.stringify(entry)}\n`;
    getAuditStream().write(line);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[audit] failed to serialize audit log entry:', err);
  }
}

/**
 * Express middleware that writes a structured audit log entry once the
 * response has finished (so the final status code is captured).
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function auditLog(req, res, next) {
  res.on('finish', () => {
    try {
      const entry = buildAuditEntry(req, res);
      writeAuditEntry(entry);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[audit] failed to record audit log entry:', err);
    }
  });

  next();
}

module.exports = auditLog;
module.exports.auditLog = auditLog;
module.exports.default = auditLog;
module.exports.buildAuditEntry = buildAuditEntry;
module.exports.extractCallerIp = extractCallerIp;
module.exports.extractEndpoint = extractEndpoint;
module.exports.extractWalletAddresses = extractWalletAddresses;
module.exports.resolveAuditLogPath = resolveAuditLogPath;
module.exports.AUDIT_LOG_PATH = AUDIT_LOG_PATH;