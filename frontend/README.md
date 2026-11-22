# Pulsar Frontend — Payer Dashboard

React + Vite UI for payers to view payment history and track refund status.

## Setup

```bash
cd frontend
cp .env.example .env        # fill in CONTRACT_ID
npm install
npm run dev
```

## Features
- Freighter wallet connection
- Paginated payment history table (cursor-based)
- Filter by status, amount range
- Sort by date or amount (ascending/descending)
- Refund status displayed inline per payment

## Security headers

The Vite dev server sends the following security headers (configured in `vite.config.ts`). Production deployments **must** send the same headers from the web server or CDN — the dev-server configuration does not apply to the production build.

| Header | Value |
| --- | --- |
| `Content-Security-Policy` | `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://soroban-testnet.stellar.org https://horizon-testnet.stellar.org; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'` |
| `X-Frame-Options` | `DENY` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |

Adjust the `connect-src` origins to match the Stellar/Soroban RPC and Horizon endpoints used in your environment. Keep `frame-ancestors 'none'` and `X-Frame-Options: DENY` together for clickjacking protection across browsers.

### Example: nginx

```nginx
server {
    listen 443 ssl;
    server_name app.example.com;

    # ... ssl_certificate, root, location blocks, etc.

    add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://soroban-testnet.stellar.org https://horizon-testnet.stellar.org; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" always;
    add_header X-Frame-Options "DENY" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
}
```

The `always` flag ensures the headers are sent on error responses too. If you use a CDN or managed host (Cloudflare, Netlify, Vercel, S3 + CloudFront, etc.), configure the equivalent response headers there — e.g. a `_headers` file on Netlify, `vercel.json` `headers` entries, or a CloudFront response-headers policy. The CDN/host must be configured equivalently; do not rely on the Vite dev-server headers in production.

### Verifying the headers

1. Open the deployed app in a browser and open DevTools (F12).
2. Go to the **Network** tab and reload the page.
3. Select the top-level document request and inspect the **Response Headers** section.
4. Confirm `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, and `Referrer-Policy` are present with the values above.

CI also runs a header check against the deployed preview URL (see the `security-headers` workflow) to catch regressions.