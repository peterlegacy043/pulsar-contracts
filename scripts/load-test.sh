#!/usr/bin/env bash
#
# scripts/load-test.sh
#
# Load test for the Soroban payment contract (#342 / T-028).
#
# Submits N concurrent payment transactions (default 100) against a deployed
# contract, classifies each result as success or an expected PaymentError,
# then verifies that GlobalStats.total_payments matches the number of
# successful payments.
#
# This is intended to be run MANUALLY against testnet (see docs/testing guide).
# It exits non-zero on any panic, unexpected error, or stats mismatch.
#
# Requirements:
#   - stellar CLI (https://developers.stellar.org/docs/tools/developer-tools/cli)
#   - jq
#   - A funded admin account (ADMIN_SECRET) that is the contract admin
#   - A deployed contract (CONTRACT_ID) whose admin is ADMIN_SECRET
#
# Usage:
#   CONTRACT_ID=C... ADMIN_SECRET=S... NETWORK=testnet ./scripts/load-test.sh
#
# Environment variables:
#   CONTRACT_ID   (required) Deployed contract ID (C...)
#   ADMIN_SECRET  (required) Secret key of the contract admin / payer
#   NETWORK       (optional) Stellar network: testnet|futurenet|mainnet (default: testnet)
#   CONCURRENCY   (optional) Number of concurrent payments to submit (default: 100)
#   RPC_URL       (optional) Soroban RPC URL (default derived from NETWORK)
#   NETWORK_PASSPHRASE (optional) Overrides passphrase derived from NETWORK
#   PAYMENT_AMOUNT (optional) Amount per payment in stroops (default: 1000)
#   MERCHANT      (optional) Merchant address; generated if unset
#   KEEP_TEMP     (optional) If set, do not delete temp dir on exit
#
set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
CONTRACT_ID="${CONTRACT_ID:-}"
ADMIN_SECRET="${ADMIN_SECRET:-}"
NETWORK="${NETWORK:-testnet}"
CONCURRENCY="${CONCURRENCY:-100}"
PAYMENT_AMOUNT="${PAYMENT_AMOUNT:-1000}"

if [[ -z "$CONTRACT_ID" ]]; then
  echo "ERROR: CONTRACT_ID is required" >&2
  exit 2
fi
if [[ -z "$ADMIN_SECRET" ]]; then
  echo "ERROR: ADMIN_SECRET is required" >&2
  exit 2
fi
if ! [[ "$CONCURRENCY" =~ ^[0-9]+$ ]] || [[ "$CONCURRENCY" -lt 1 ]]; then
  echo "ERROR: CONCURRENCY must be a positive integer (got: $CONCURRENCY)" >&2
  exit 2
fi

case "$NETWORK" in
  testnet)
    DEFAULT_RPC_URL="https://soroban-testnet.stellar.org"
    DEFAULT_PASSPHRASE="Test SDF Network ; September 2015"
    ;;
  futurenet)
    DEFAULT_RPC_URL="https://rpc-futurenet.stellar.org"
    DEFAULT_PASSPHRASE="Test SDF Future Network ; October 2022"
    ;;
  mainnet|public)
    DEFAULT_RPC_URL="https://soroban-mainnet.stellar.org"
    DEFAULT_PASSPHRASE="Public Global Stellar Network ; September 2015"
    ;;
  *)
    echo "ERROR: unknown NETWORK '$NETWORK' (expected testnet|futurenet|mainnet)" >&2
    exit 2
    ;;
esac

RPC_URL="${RPC_URL:-$DEFAULT_RPC_URL}"
NETWORK_PASSPHRASE="${NETWORK_PASSPHRASE:-$DEFAULT_PASSPHRASE}"

# ---------------------------------------------------------------------------
# Dependency checks
# ---------------------------------------------------------------------------
for bin in stellar jq; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    echo "ERROR: required binary '$bin' not found in PATH" >&2
    exit 2
  fi
done

# ---------------------------------------------------------------------------
# Temp workspace
# ---------------------------------------------------------------------------
WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/soroban-loadtest.XXXXXX")"
cleanup() {
  if [[ -z "${KEEP_TEMP:-}" ]]; then
    rm -rf "$WORKDIR"
  else
    echo "Temp dir preserved at: $WORKDIR"
  fi
}
trap cleanup EXIT

RESULTS_DIR="$WORKDIR/results"
mkdir -p "$RESULTS_DIR"

log() { echo "[load-test] $*" >&2; }

# ---------------------------------------------------------------------------
# Resolve admin / payer address
# ---------------------------------------------------------------------------
ADMIN_ADDR="$(stellar keys address "$ADMIN_SECRET" 2>/dev/null || true)"
if [[ -z "$ADMIN_ADDR" ]]; then
  # Fall back to deriving from the secret via the CLI's public key helper.
  ADMIN_ADDR="$(stellar keys public-key "$ADMIN_SECRET" 2>/dev/null || true)"
fi
if [[ -z "$ADMIN_ADDR" ]]; then
  echo "ERROR: could not derive public address from ADMIN_SECRET" >&2
  exit 2
fi
log "Admin/payer address: $ADMIN_ADDR"

# ---------------------------------------------------------------------------
# Merchant setup
# ---------------------------------------------------------------------------
if [[ -z "${MERCHANT:-}" ]]; then
  MERCHANT="$(stellar keys generate --network "$NETWORK" --fund 2>/dev/null | tail -n1 || true)"
fi
if [[ -z "$MERCHANT" ]]; then
  # Fall back to a deterministic merchant derived from a fresh key.
  MERCHANT="$(stellar keys generate --network "$NETWORK" --fund 2>/dev/null | tail -n1 || true)"
fi
if [[ -z "$MERCHANT" ]]; then
  echo "ERROR: could not create/fund merchant account" >&2
  exit 2
fi
log "Merchant address: $MERCHANT"

# ---------------------------------------------------------------------------
# Helper: invoke a read-only contract function and return raw JSON
# ---------------------------------------------------------------------------
invoke_read() {
  local fn="$1"
  shift
  stellar contract invoke \
    --id "$CONTRACT_ID" \
    --rpc-url "$RPC_URL" \
    --network-passphrase "$NETWORK_PASSPHRASE" \
    --source "$ADMIN_SECRET" \
    -- "$fn" "$@"
}

# ---------------------------------------------------------------------------
# Helper: classify a single payment submission result.
# Writes one of: SUCCESS | EXPECTED_ERROR | UNEXPECTED_ERROR to stdout.
# ---------------------------------------------------------------------------
classify_result() {
  local out_file="$1"
  local rc="$2"

  if [[ "$rc" -eq 0 ]]; then
    echo "SUCCESS"
    return
  fi

  local body
  body="$(cat "$out_file" 2>/dev/null || true)"

  # Panics / traps are never acceptable.
  if echo "$body" | grep -qiE 'panic|unreachable|wasm trap|VM trap|host trap'; then
    echo "UNEXPECTED_ERROR"
    return
  fi

  # Expected PaymentError variants surfaced by the contract. These are the
  # errors the contract is designed to return under contention (e.g. duplicate
  # order id, insufficient balance, unauthorized, etc.).
  if echo "$body" | grep -qiE 'PaymentError|Error\(Contract, ?#[0-9]+\)|Error\(Contract, ?Some\([0-9]+\)\)'; then
    echo "EXPECTED_ERROR"
    return
  fi

  # Any other failure (network, RPC, simulation, etc.) is unexpected for the
  # purposes of this test.
  echo "UNEXPECTED_ERROR"
}

# ---------------------------------------------------------------------------
# Fire one payment
# ---------------------------------------------------------------------------
submit_payment() {
  local idx="$1"
  local order_id="loadtest-${RUN_ID}-${idx}"
  local out_file="$RESULTS_DIR/${idx}.out"

  local rc=0
  stellar contract invoke \
    --id "$CONTRACT_ID" \
    --rpc-url "$RPC_URL" \
    --network-passphrase "$NETWORK_PASSPHRASE" \
    --source "$ADMIN_SECRET" \
    --send=yes \
    -- process_payment \
    --payer "$ADMIN_ADDR" \
    --merchant "$MERCHANT" \
    --amount "$PAYMENT_AMOUNT" \
    --order_id "$order_id" \
    >"$out_file" 2>&1 || rc=$?

  local classification
  classification="$(classify_result "$out_file" "$rc")"
  echo "$classification" >"$RESULTS_DIR/${idx}.class"
  echo "$order_id" >"$RESULTS_DIR/${idx}.order"
}

# ---------------------------------------------------------------------------
# Run the load test
# ---------------------------------------------------------------------------
RUN_ID="$(date +%s)-$$"
log "Starting load test: $CONCURRENCY concurrent payments"
log "Contract: $CONTRACT_ID"
log "Network:  $NETWORK ($RPC_URL)"

# Snapshot stats before the run (informational).
log "Fetching pre-run global stats..."
PRE_STATS="$(invoke_read get_global_payment_stats 2>/dev/null || echo '{}')"
log "Pre-run stats: $PRE_STATS"

log "Submitting $CONCURRENCY payments concurrently..."
pids=()
for ((i = 1; i <= CONCURRENCY; i++)); do
  submit_payment "$i" &
  pids+=("$!")
done

# Wait for all submissions to finish.
for pid in "${pids[@]}"; do
  wait "$pid" || true
done

# ---------------------------------------------------------------------------
# Tally results
# ---------------------------------------------------------------------------
success=0
expected_err=0
unexpected_err=0
unexpected_list=()

for ((i = 1; i <= CONCURRENCY; i++)); do
  class_file="$RESULTS_DIR/${i}.class"
  if [[ ! -f "$class_file" ]]; then
    unexpected_err=$((unexpected_err + 1))
    unexpected_list+=("$i:missing-result")
    continue
  fi
  case "$(cat "$class_file")" in
    SUCCESS) success=$((success + 1)) ;;
    EXPECTED_ERROR) expected_err=$((expected_err + 1)) ;;
    *)
      unexpected_err=$((unexpected_err + 1))
      unexpected_list+=("$i:$(cat "$class_file")")
      ;;
  esac
done

log "Results: success=$success expected_error=$expected_err unexpected_error=$unexpected_err"

if [[ "$unexpected_err" -gt 0 ]]; then
  echo "FAIL: $unexpected_err unexpected result(s) (panic or non-PaymentError failure):" >&2
  for item in "${unexpected_list[@]}"; do
    echo "  - $item" >&2
    idx="${item%%:*}"
    echo "    --- output ---" >&2
    sed 's/^/    /' "$RESULTS_DIR/${idx}.out" >&2 || true
  done
  exit 1
fi

# ---------------------------------------------------------------------------
# Verify GlobalStats.total_payments
# ---------------------------------------------------------------------------
log "Fetching post-run global stats..."
POST_STATS="$(invoke_read get_global_payment_stats 2>/dev/null || true)"
if [[ -z "$POST_STATS" ]]; then
  echo "FAIL: could not read get_global_payment_stats after run" >&2
  exit 1
fi
log "Post-run stats: $POST_STATS"

# Extract total_payments. The CLI may return either a JSON object or a plain
# number depending on version; handle both.
TOTAL_PAYMENTS="$(echo "$POST_STATS" | jq -r '
  if type == "object" then
    (.total_payments // .totalPayments // .total // empty)
  elif type == "number" then
    .
  else
    empty
  end' 2>/dev/null || true)"

if [[ -z "$TOTAL_PAYMENTS" || "$TOTAL_PAYMENTS" == "null" ]]; then
  echo "FAIL: could not parse total_payments from stats output:" >&2
  echo "$POST_STATS" >&2
  exit 1
fi

# If we captured a pre-run baseline, the delta should equal successes.
EXPECTED_TOTAL="$success"
if [[ -n "$PRE_STATS" && "$PRE_STATS" != "{}" ]]; then
  PRE_TOTAL="$(echo "$PRE_STATS" | jq -r '
    if type == "object" then
      (.total_payments // .totalPayments // .total // empty)
    elif type == "number" then
      .
    else
      empty
    end' 2>/dev/null || true)"
  if [[ -n "$PRE_TOTAL" && "$PRE_TOTAL" != "null" ]]; then
    EXPECTED_TOTAL=$((PRE_TOTAL + success))
    log "Baseline total_payments=$PRE_TOTAL, expected after run=$EXPECTED_TOTAL"
  fi
fi

if [[ "$TOTAL_PAYMENTS" != "$EXPECTED_TOTAL" ]]; then
  echo "FAIL: GlobalStats.total_payments mismatch" >&2
  echo "  expected: $EXPECTED_TOTAL (successful payments: $success)" >&2
  echo "  actual:   $TOTAL_PAYMENTS" >&2
  exit 1
fi

log "PASS: total_payments=$TOTAL_PAYMENTS matches successful payments ($success)"
log "Load test completed successfully."
exit 0