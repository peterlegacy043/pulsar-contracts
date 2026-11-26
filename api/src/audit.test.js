'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const request = require('supertest');

describe('audit log middleware', () => {
  let tmpDir;
  let auditLogPath;
  let app;
  let auditMiddleware;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-test-'));
    auditLogPath = path.join(tmpDir, 'audit.log');
    process.env.AUDIT_LOG_PATH = auditLogPath;

    // Re-require the middleware so it picks up the temp AUDIT_LOG_PATH.
    jest.resetModules();
    auditMiddleware = require('./audit');

    app = express();
    app.use(express.json());
    app.use(auditMiddleware);

    // Admin-equivalent endpoint that echoes the wallet address.
    app.post('/api/merchants', (req, res) => {
      res.status(201).json({ ok: true, wallet: req.body && req.body.wallet });
    });

    // Another admin-equivalent endpoint.
    app.get('/api/payments', (req, res) => {
      res.status(200).json({ ok: true });
    });
  });

  afterEach(() => {
    delete process.env.AUDIT_LOG_PATH;
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {
      // ignore cleanup errors
    }
  });

  function readAuditLines() {
    if (!fs.existsSync(auditLogPath)) {
      return [];
    }
    const content = fs.readFileSync(auditLogPath, 'utf8');
    return content
      .split('\n')
      .filter((line) => line.trim().length > 0);
  }

  test('writes exactly one JSON line per request with required fields', async () => {
    const wallet = '0x1234567890abcdef1234567890abcdef12345678';

    const res = await request(app)
      .post('/api/merchants')
      .set('X-Forwarded-For', '203.0.113.7')
      .send({ wallet });

    expect(res.status).toBe(201);

    // Allow the append stream to flush.
    await new Promise((resolve) => setTimeout(resolve, 50));

    const lines = readAuditLines();
    expect(lines).toHaveLength(1);

    const entry = JSON.parse(lines[0]);

    // Timestamp present and parseable.
    expect(entry.timestamp).toBeDefined();
    expect(Number.isNaN(Date.parse(entry.timestamp))).toBe(false);

    // Caller IP.
    expect(entry.ip).toBeDefined();
    expect(typeof entry.ip).toBe('string');

    // Endpoint and method.
    expect(entry.endpoint).toBe('/api/merchants');
    expect(entry.method).toBe('POST');

    // Response status.
    expect(entry.status).toBe(201);

    // PII: wallet address included.
    expect(entry.wallet).toBe(wallet);
  });

  test('logs GET requests with response status', async () => {
    const res = await request(app).get('/api/payments');

    expect(res.status).toBe(200);

    await new Promise((resolve) => setTimeout(resolve, 50));

    const lines = readAuditLines();
    expect(lines).toHaveLength(1);

    const entry = JSON.parse(lines[0]);
    expect(entry.endpoint).toBe('/api/payments');
    expect(entry.method).toBe('GET');
    expect(entry.status).toBe(200);
    expect(entry.timestamp).toBeDefined();
    expect(entry.ip).toBeDefined();
  });

  test('appends one line per request across multiple requests', async () => {
    await request(app).get('/api/payments');
    await request(app).post('/api/merchants').send({ wallet: '0xabc' });
    await request(app).get('/api/payments');

    await new Promise((resolve) => setTimeout(resolve, 50));

    const lines = readAuditLines();
    expect(lines).toHaveLength(3);

    for (const line of lines) {
      const entry = JSON.parse(line);
      expect(entry.timestamp).toBeDefined();
      expect(entry.ip).toBeDefined();
      expect(entry.endpoint).toBeDefined();
      expect(entry.method).toBeDefined();
      expect(entry.status).toBeDefined();
    }
  });
});