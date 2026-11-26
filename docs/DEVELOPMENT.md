# Development Guide

This guide provides instructions for setting up a development environment and working with the Pulsar payment processing contract.

## Table of Contents

- [Quick Start](#quick-start)
- [Development Setup](#development-setup)
- [Building](#building)
- [Testing](#testing)
- [Local Network](#local-network)
- [Docker Compose Health Checks](#docker-compose-health-checks)
- [Environment Seeding](#environment-seeding)
- [Debugging](#debugging)
- [Common Tasks](#common-tasks)

## Quick Start

```bash
# 1. Clone the repository
git clone https://github.com/devEunicee/pulsar-contracts.git
cd pulsar-contracts

# 2. Install prerequisites
rustup target add wasm32-unknown-unknown

# 3. Build the contract
cd contracts/payment-processing-contract
cargo build --target wasm32-unknown-unknown --release

# 4. Run tests
cargo test

# 5. Start local network
stellar network container start local

# 6. Deploy contract
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/payment_processing_contract.wasm \
  --source-account admin \
  --network local

# 7. Seed test environment
export CONTRACT_ID="<returned_contract_id>"
bash scripts/seed.sh config/local.toml
```

## Development Setup

### Prerequisites

- **Rust** (stable) — https://www.rust-lang.org/tools/install
- **Stellar CLI** — https://developers.stellar.org/docs/tools/stellar-cli
- **Docker Desktop** — https://www.docker.com/products/docker-desktop
- **Git** — https://git-scm.com/

### Installation

```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Add WASM target
rustup target add wasm32-unknown-unknown

# Install Stellar CLI (macOS)
brew install stellar-cli

# Install Stellar CLI (Linux)
curl -L https://github.com/stellar/stellar-cli/releases/download/v21.0.0/stellar-cli-21.0.0-x86_64-unknown-linux-gnu.tar.gz | tar xz
sudo mv stellar /usr/local/bin/

# Verify installations
rustc --version
cargo --version
stellar --version
docker --version
```

## Building

### Build WASM

```bash
cd contracts/payment-processing-contract

# Debug build
cargo build --target wasm32-unknown-unknown

# Release build (optimized)
cargo build --target wasm32-unknown-unknown --release
```

### Build Output

- **Debug**: `target/wasm32-unknown-unknown/debug/payment_processing_contract.wasm`
- **Release**: `target/wasm32-unknown-unknown/release/payment_processing_contract.wasm`

## Testing

### Run All Tests

```bash
cd contracts/payment-processing-contract
cargo test
```

### Run Specific Test

```bash
cargo test test_register_merchant_success
```

### Run Tests with Output

```bash
cargo test -- --nocapture
```

### Run Tests in Parallel

```bash
cargo test -- --test-threads=4
```

### Generate Test Coverage

```bash
# Install tarpaulin
cargo install cargo-tarpaulin

# Generate coverage report
cargo tarpaulin --out Html --output-dir coverage
```

### Load Testing (Concurrent Payments)

The contract must behave correctly under concurrent payment submissions. A load
test submits many payments in parallel and verifies that the global payment
index and `GlobalStats.total_payments` stay consistent.

#### Prerequisites

- A deployed contract on **testnet** (see [Common Tasks](#deploy-contract))
- A funded admin account secret on testnet
- Node.js 18+ (for the `@stellar/stellar-sdk` script) or the Stellar CLI

#### Required Environment Variables

| Variable        | Description                                              |
| --------------- | -------------------------------------------------------- |
| `CONTRACT_ID`   | Deployed contract ID (`C...`)                            |
| `ADMIN_SECRET`  | Secret key (`S...`) of the funded admin/payer account    |
| `NETWORK`       | Network to target, e.g. `testnet`                        |
| `CONCURRENCY`   | Number of concurrent payments to submit (default `100`)  |

#### Run the Load Test

```bash
export CONTRACT_ID="<testnet_contract_id>"
export ADMIN_SECRET="<funded_testnet_secret>"
export NETWORK="testnet"
export CONCURRENCY=100

# Shell wrapper (invokes the Node script)
bash scripts/load-test.sh

# Or run the Node script directly
node scripts/load-test.js
```

#### Interpreting Results

- **Every transaction must either succeed or fail with an expected contract
  error** (e.g. duplicate order ID, expired order, insufficient balance). A
  panic, trap, or unexpected host error indicates a bug and the test fails.
- The script prints a summary of successes, expected failures, and unexpected
  failures. Any unexpected failure is reported with the transaction hash and
  error for triage.

#### Verifying `GlobalStats.total_payments`

After the run, query the global stats and confirm `total_payments` equals the
number of successful payments reported by the load test:

```bash
stellar contract invoke --id $CONTRACT_ID --source-account admin --network testnet \
  -- get_global_payment_stats --admins '["<ADMIN_ADDRESS>"]' --date_start null --date_end null
```

The `total_payments` field must match the success count from the load test
summary. A mismatch means the global index or stats increment is not
concurrency-safe.

#### Manual CI Step

The load test is **not** run on every push (it targets testnet and consumes
funds). It is exposed as a manual `workflow_dispatch` CI job. Trigger it from
the GitHub Actions tab (**Run workflow**) or via the CLI:

```bash
gh workflow run load-test.yml -f concurrency=100
```

## Local Network

### Start Local Network

```bash
stellar network container start local
```

### Stop Local Network

```bash
stellar network container stop local
```

### Restart Local Network

```bash
stellar network container restart local
```

### View Local Network Logs

```bash
stellar network container logs local
```

## Docker Compose Health Checks

The `docker-compose.yml` stack uses health checks to prevent services from starting before their dependencies are ready.

### PostgreSQL Health Check

The `postgres` service defines a `healthcheck` that runs `pg_isready` inside the container:

```yaml
services:
  postgres:
    image: postgres:16-alpine
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-pulsar} -d ${POSTGRES_DB:-pulsar}"]
      interval: 5s
      timeout: 5s
      retries: 10
      start_period: 10s
```

Postgres is only marked `healthy` once `pg_isready` succeeds, so dependent services never connect to a database that is still initializing.

### Service Dependencies

The `indexer` and `api` services wait for PostgreSQL to become healthy before starting:

```yaml
services:
  indexer:
    depends_on:
      postgres:
        condition: service_healthy

  api:
    depends_on:
      postgres:
        condition: service_healthy
```

If the database fails to become healthy within the configured retries, `docker compose up` reports the failure instead of leaving services in a crash loop that requires manual restarts.

### Health Endpoints

The `indexer` and `webhook` services expose an HTTP `/health` endpoint that returns `200 OK` when the service is ready:

```bash
# Indexer health
curl -f http://localhost:3001/health

# Webhook service health
curl -f http://localhost:3002/health
```

These endpoints are also used by the containers' own `healthcheck` blocks, so `docker compose ps` reflects their readiness.

### Inspecting Health Status

```bash
# Show container status, including health
docker compose ps

# Inspect the raw health state of a specific service
docker inspect --format '{{json .State.Health}}' $(docker compose ps -q postgres)

# Follow health check logs
docker compose logs -f postgres indexer webhook
```

A healthy stack shows `(healthy)` next to each service in `docker compose ps`. Services still starting show `(health: starting)`, and failing checks show `(unhealthy)`.

## Environment Seeding

### Seed Local Environment

```bash
# Set contract ID
export CONTRACT_ID="CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4"

# Run seeding script
bash scripts/seed.sh config/local.toml
```

### Seed Testnet Environment

```bash
export CONTRACT_ID="<testnet_contract_id>"
bash scripts/seed.sh config/testnet.toml
```

### Custom Seeding

Edit `config/local.toml` to customize:
- Number of merchants
- Number of payments
- Number of refunds
- Merchant categories
- Payment amounts

See [SEEDING_GUIDE.md](SEEDING_GUIDE.md) for detailed instructions.

## Debugging

### Enable Debug Logging

```bash
# Set Rust backtrace
export RUST_BACKTRACE=1

# Run tests with backtrace
cargo test -- --nocapture
```

### Inspect Contract State

```bash
# Query merchant
stellar contract invoke --id $CONTRACT_ID --source-account admin --network local \
  -- get_merchant --merchant_address <ADDRESS>

# Query payment
stellar contract invoke --id $CONTRACT_ID --source-account admin --network local \
  -- get_payment_by_id --caller <ADDRESS> --order_id "ORDER_001"

# Query global stats
stellar contract invoke --id $CONTRACT_ID --source-account admin --network local \
  -- get_global_payment_stats --admins '["<ADMIN_ADDRESS>"]' --date_start null --date_end null
```

### Check Contract Version

```bash
stellar contract invoke --id $CONTRACT_ID --source-account admin --network local \
  -- get_version
```

## Common Tasks

### Deploy Contract

```bash
# Build
cargo build --target wasm32-unknown-unknown --release

# Deploy to local network
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/payment_processing_contract.wasm \
  --source-account admin \
  --network local
```

### Initialize Admin

```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --source-account admin \
  --network local \
  -- set_admin \
  --admin <ADMIN_ADDRESS>
```

### Register Merchant

```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --source-account merchant \
  --network local \
  -- register_merchant \
  --merchant_address <MERCHANT_ADDRESS> \
  --name "My Store" \
  --description "Store description" \
  --contact_info "contact@store.com" \
  --category Retail \
  --signing_public_key null
```

### Process Payment

```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --source-account payer \
  --network local \
  -- process_payment_with_signature \
  --payer <PAYER_ADDRESS> \
  --order '{"order_id":"ORDER_001","merchant_address":"<MERCHANT>","payer":"<PAYER>","token":"<TOKEN>","amount":1000,"description":"Test","expires_at":0}' \
  --signature <64_BYTE_HEX> \
  --merchant_public_key <32_BYTE_HEX>
```

### Query Merchant Stats

```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --source-account merchant \
  --network local \
  -- get_merchant_stats \
  --merchant <MERCHANT_ADDRESS> \
  --date_start null \
  --date_end null
```

## Code Standards

- **Formatting**: `cargo fmt`
- **Linting**: `cargo clippy -- -D warnings`
- **License headers**: All `.rs` files must start with `// SPDX-License-Identifier: MIT`
- **Tests**: Every new function must have at least one unit test
- **No unsafe**: Do not use `unsafe` blocks
- **No std**: Keep `#![no_std]` for contract crate

## Useful Resources

- [Soroban Documentation](https://developers.stellar.org/docs/learn/soroban)
- [Stellar CLI Reference](https://developers.stellar.org/docs/tools/stellar-cli)
- [Rust Book](https://doc.rust-lang.org/book/)
- [Soroban SDK](https://docs.rs/soroban-sdk/)

## Getting Help

- Check [CONTRIBUTING.md](../CONTRIBUTING.md) for contribution guidelines
- Review [README.md](../README.md) for API documentation
- See [SEEDING_GUIDE.md](SEEDING_GUIDE.md) for environment setup
- Open an issue on GitHub for bugs or feature requests
