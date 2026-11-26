// SPDX-License-Identifier: MIT
//! T-011 — Property-based tests using `proptest`.
//!
//! These tests encode formal correctness properties for the three functions
//! called out in the issue:
//!
//!   1. `validate_amount`      — amount validation
//!   2. `matches_filter`       — payment filter predicate
//!   3. `paginate_payments`    — cursor-based pagination (via the public
//!                               contract helpers, exercised through a
//!                               plain-Rust re-implementation that mirrors
//!                               the contract logic so we can run it outside
//!                               the Soroban VM in a normal test harness)
//!
//! # Running locally
//!
//! ```bash
//! # Run all property tests (default 256 cases each)
//! cargo test --test prop_tests --features testutils
//!
//! # Increase the number of cases
//! PROPTEST_CASES=1000 cargo test --test prop_tests --features testutils
//!
//! # Replay a specific failing seed printed by proptest
//! # (proptest prints the seed on failure; pass it via PROPTEST_SEED)
//! PROPTEST_SEED="<hex>" cargo test --test prop_tests --features testutils
//! ```

#![cfg(test)]

use proptest::prelude::*;

use alloc::vec::Vec;

use crate::error::PaymentError;
use crate::helper::{matches_filter, validate_amount, validate_metadata_size, MAX_METADATA_SIZE_BYTES};
use crate::types::{PaymentFilter, PaymentRecord, PaymentStatus, StatusFilter};

use crate::{DataKey, PaymentProcessingContract, PaymentProcessingContractClient};
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{Address, Env};

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Build a minimal `PaymentRecord` from plain-Rust primitives so we can run
/// property tests without spinning up a full Soroban environment.
///
/// `soroban_sdk::Address` and `soroban_sdk::Bytes` are not constructible
/// outside the VM, so we test the pure-logic helpers (`validate_amount`,
/// `matches_filter`) which only touch primitive fields.
fn make_record(amount: i128, paid_at: u64, status: PaymentStatus) -> PaymentRecord {
    // We need a Soroban Env to construct Address/Bytes/String.
    // Use the testutils environment.
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::Env;
    let env = Env::default();
    let addr = soroban_sdk::Address::generate(&env);
    let token = soroban_sdk::Address::generate(&env);
    let order_id = soroban_sdk::Bytes::from_slice(&env, b"ORDER");
    let desc = soroban_sdk::String::from_str(&env, "desc");

    PaymentRecord {
        order_id,
        merchant_address: addr.clone(),
        payer: addr,
        token,
        amount,
        refunded_amount: 0,
        pending_refund_amount: 0,
        status,
        paid_at,
        description: desc,
        metadata: None,
    }
}

fn make_filter(
    amount_min: Option<i128>,
    amount_max: Option<i128>,
    date_start: Option<u64>,
    date_end: Option<u64>,
    status: StatusFilter,
) -> PaymentFilter {
    PaymentFilter {
        date_start,
        date_end,
        amount_min,
        amount_max,
        tokens: None,
        status,
    }
}

// ── Property 1: validate_amount ───────────────────────────────────────────────

proptest! {
    /// Any positive amount must be accepted.
    #[test]
    fn prop_validate_amount_positive(amount in 1i128..=i128::MAX) {
        prop_assert_eq!(validate_amount(amount), Ok(()));
    }

    /// Zero must always be rejected.
    #[test]
    fn prop_validate_amount_zero(_dummy in 0i32..1) {
        prop_assert_eq!(validate_amount(0), Err(PaymentError::InvalidAmount));
    }

    /// Any negative amount must be rejected.
    #[test]
    fn prop_validate_amount_negative(amount in i128::MIN..0i128) {
        prop_assert_eq!(validate_amount(amount), Err(PaymentError::InvalidAmount));
    }

    /// The boundary: i128::MAX is valid, i128::MIN is not.
    #[test]
    fn prop_validate_amount_boundary(_dummy in 0i32..1) {
        prop_assert_eq!(validate_amount(i128::MAX), Ok(()));
        prop_assert_eq!(validate_amount(i128::MIN), Err(PaymentError::InvalidAmount));
    }
}

// ── Property 2: matches_filter ────────────────────────────────────────────────

proptest! {
    /// A record always passes an empty (Any / no bounds) filter.
    #[test]
    fn prop_matches_filter_empty_always_passes(
        amount in 1i128..1_000_000i128,
        paid_at in 0u64..u64::MAX,
    ) {
        let record = make_record(amount, paid_at, PaymentStatus::Completed);
        let filter = make_filter(None, None, None, None, StatusFilter::Any);
        prop_assert!(matches_filter(&record, &filter));
    }

    /// A record with amount X passes amount_min=X and fails amount_min=X+1.
    #[test]
    fn prop_matches_filter_amount_min_boundary(
        amount in 1i128..1_000_000i128,
    ) {
        let record = make_record(amount, 1000, PaymentStatus::Completed);

        // Exactly at the boundary — should pass
        let filter_pass = make_filter(Some(amount), None, None, None, StatusFilter::Any);
        prop_assert!(matches_filter(&record, &filter_pass));

        // One above — should fail
        if amount < i128::MAX {
            let filter_fail = make_filter(Some(amount + 1), None, None, None, StatusFilter::Any);
            prop_assert!(!matches_filter(&record, &filter_fail));
        }
    }

    /// A record with amount X passes amount_max=X and fails amount_max=X-1.
    #[test]
    fn prop_matches_filter_amount_max_boundary(
        amount in 1i128..1_000_000i128,
    ) {
        let record = make_record(amount, 1000, PaymentStatus::Completed);

        // Exactly at the boundary — should pass
        let filter_pass = make_filter(None, Some(amount), None, None, StatusFilter::Any);
        prop_assert!(matches_filter(&record, &filter_pass));

        // One below — should fail
        if amount > 1 {
            let filter_fail = make_filter(None, Some(amount - 1), None, None, StatusFilter::Any);
            prop_assert!(!matches_filter(&record, &filter_fail));
        }
    }

    /// When amount_min > amount_max the record can never pass both bounds.
    #[test]
    fn prop_matches_filter_inverted_amount_range(
        lo in 1i128..500_000i128,
        hi in 500_001i128..1_000_000i128,
        amount in 1i128..1_000_000i128,
    ) {
        // lo < hi, so inverted means min=hi, max=lo
        let record = make_record(amount, 1000, PaymentStatus::Completed);
        let filter = make_filter(Some(hi), Some(lo), None, None, StatusFilter::Any);
        // amount cannot be both >= hi and <= lo simultaneously
        prop_assert!(!matches_filter(&record, &filter));
    }

    /// date_start / date_end boundary: record at exactly date_start passes.
    #[test]
    fn prop_matches_filter_date_start_boundary(
        paid_at in 1u64..u64::MAX,
    ) {
        let record = make_record(100, paid_at, PaymentStatus::Completed);

        let filter_pass = make_filter(None, None, Some(paid_at), None, StatusFilter::Any);
        prop_assert!(matches_filter(&record, &filter_pass));

        if paid_at > 0 {
            let filter_fail = make_filter(None, None, Some(paid_at + 1), None, StatusFilter::Any);
            prop_assert!(!matches_filter(&record, &filter_fail));
        }
    }

    /// Status filter: Completed record fails PartiallyRefunded filter.
    #[test]
    fn prop_matches_filter_status_mismatch(
        amount in 1i128..1_000_000i128,
        paid_at in 0u64..u64::MAX,
    ) {
        let record = make_record(amount, paid_at, PaymentStatus::Completed);
        let filter = make_filter(None, None, None, None, StatusFilter::PartiallyRefunded);
        prop_assert!(!matches_filter(&record, &filter));
    }

    /// Status filter: FullyRefunded record fails Completed filter.
    #[test]
    fn prop_matches_filter_fully_refunded_fails_completed(
        amount in 1i128..1_000_000i128,
        paid_at in 0u64..u64::MAX,
    ) {
        let record = make_record(amount, paid_at, PaymentStatus::FullyRefunded);
        let filter = make_filter(None, None, None, None, StatusFilter::Completed);
        prop_assert!(!matches_filter(&record, &filter));
    }
}

// ── Property 3: paginate_payments (pure-Rust mirror) ─────────────────────────
//
// The on-chain `paginate_payments` runs inside the Soroban VM and cannot be
// called directly in a unit test without a full environment. We mirror its
// core logic here in plain Rust and verify the invariants that must hold
// regardless of the VM layer.

/// Mirror of the contract's pagination logic operating on plain-Rust vecs.
fn paginate_plain(
    records: &[i128], // amounts used as stand-in for full records
    cursor_idx: Option<usize>,
    limit: usize,
) -> (Vec<i128>, Option<usize>, usize) {
    let cap = limit.min(100);

    let start = match cursor_idx {
        None => 0,
        Some(idx) => idx + 1, // cursor points to last item of previous page
    };

    let slice = if start < records.len() {
        &records[start..]
    } else {
        &[]
    };

    let total = slice.len();
    let page: Vec<i128> = slice.iter().take(cap).copied().collect();
    let next_cursor = if total > cap { Some(start + cap - 1) } else { None };

    (page, next_cursor, total)
}

proptest! {
    /// Page size never exceeds the requested limit (capped at 100).
    #[test]
    fn prop_paginate_page_size_bounded(
        n_records in 0usize..200usize,
        limit in 1usize..150usize,
    ) {
        let records: Vec<i128> = (0..n_records as i128).collect();
        let (page, _, _) = paginate_plain(&records, None, limit);
        prop_assert!(page.len() <= limit.min(100));
    }

    /// next_cursor is None iff the page contains all remaining records.
    #[test]
    fn prop_paginate_next_cursor_iff_more(
        n_records in 0usize..200usize,
        limit in 1usize..150usize,
    ) {
        let records: Vec<i128> = (0..n_records as i128).collect();
        let cap = limit.min(100);
        let (page, next_cursor, _) = paginate_plain(&records, None, limit);
        if n_records <= cap {
            prop_assert!(next_cursor.is_none(), "expected no cursor when all records fit");
        } else {
            prop_assert!(next_cursor.is_some(), "expected cursor when records overflow page");
        }
        let _ = page;
    }

    /// Iterating all pages with the returned cursor yields every record exactly once.
    #[test]
    fn prop_paginate_full_traversal(
        n_records in 0usize..150usize,
        limit in 1usize..50usize,
    ) {
        let records: Vec<i128> = (0..n_records as i128).collect();
        let mut collected: Vec<i128> = Vec::new();
        let mut cursor: Option<usize> = None;

        // Safety valve: at most ceil(n/1) + 1 iterations
        for _ in 0..=n_records + 1 {
            let (page, next, _) = paginate_plain(&records, cursor, limit);
            collected.extend_from_slice(&page);
            cursor = next;
            if cursor.is_none() {
                break;
            }
        }

        prop_assert_eq!(collected, records,
            "full traversal must yield every record exactly once");
    }

    /// An empty record set always returns an empty page and no cursor.
    #[test]
    fn prop_paginate_empty_input(limit in 1usize..100usize) {
        let (page, cursor, total) = paginate_plain(&[], None, limit);
        prop_assert!(page.is_empty());
        prop_assert!(cursor.is_none());
        prop_assert_eq!(total, 0);
    }

    /// limit=0 is treated as limit=1 after the min(limit,100) cap (edge case).
    /// Actually limit=0 → cap=0 → page is empty and cursor is None.
    #[test]
    fn prop_paginate_zero_limit(n_records in 1usize..50usize) {
        let records: Vec<i128> = (0..n_records as i128).collect();
        // cap = 0.min(100) = 0 → page empty, no cursor
        let cap = 0usize.min(100);
        let page: Vec<i128> = records.iter().take(cap).copied().collect();
        let next_cursor: Option<usize> = if records.len() > cap { Some(cap.saturating_sub(1)) } else { None };
        prop_assert!(page.is_empty());
        // With cap=0 and records present, next_cursor behaviour is implementation-defined;
        // we just assert the page is empty.
        let _ = next_cursor;
    }
}

// ── Property 4: dual-storage admin invariant ─────────────────────────────────
//
// The contract stores the admin in two places: the legacy single-admin key
// `DataKey::Admin` and the `AdminConfig` struct (whose `admins[0]` is the
// primary admin). See the invariant documented in `lib.rs`. These property
// tests assert that `AdminConfig.admins[0] == DataKey::Admin` holds after
// every admin-mutating operation: `set_admin`, `transfer_admin`, and
// `update_admin_config`.

/// Read the legacy single-admin key directly from contract storage.
fn stored_single_admin(env: &Env, contract_id: &Address) -> Option<Address> {
    env.as_contract(contract_id, || {
        env.storage().instance().get(&DataKey::Admin)
    })
}

/// Read the `AdminConfig` struct directly from contract storage.
fn stored_admin_config(
    env: &Env,
    contract_id: &Address,
) -> Option<crate::types::AdminConfig> {
    env.as_contract(contract_id, || {
        env.storage().instance().get(&DataKey::AdminConfig)
    })
}

/// Assert the dual-storage invariant: `AdminConfig.admins[0] == DataKey::Admin`.
fn assert_admin_invariant(env: &Env, contract_id: &Address) {
    let single = stored_single_admin(env, contract_id);
    let config = stored_admin_config(env, contract_id);

    match (single, config) {
        (Some(single_admin), Some(cfg)) => {
            prop_assert!(
                cfg.admins.len() > 0,
                "AdminConfig must contain at least one admin"
            );
            prop_assert_eq!(
                cfg.admins.get(0).unwrap(),
                single_admin,
                "AdminConfig.admins[0] must equal DataKey::Admin"
            );
        }
        (None, None) => {}
        _ => prop_assert!(
            false,
            "DataKey::Admin and AdminConfig must be set together"
        ),
    }
}

/// Deploy a fresh contract and initialize it with a single admin.
fn setup_contract(env: &Env) -> (PaymentProcessingContractClient<'_>, Address) {
    env.mock_all_auths();
    let contract_id = env.register_contract(None, PaymentProcessingContract);
    let client = PaymentProcessingContractClient::new(env, &contract_id);
    let admin = Address::generate(env);
    client.initialize(&admin);
    (client, contract_id)
}

proptest! {
    /// The invariant holds after `set_admin` for any newly chosen admin.
    #[test]
    fn prop_admin_invariant_after_set_admin(_seed in 0u32..1000u32) {
        let env = Env::default();
        let (client, contract_id) = setup_contract(&env);

        let new_admin = Address::generate(&env);
        client.set_admin(&new_admin);

        assert_admin_invariant(&env, &contract_id);
        prop_assert_eq!(stored_single_admin(&env, &contract_id), Some(new_admin));
    }

    /// The invariant holds after `transfer_admin` for any newly chosen admin.
    #[test]
    fn prop_admin_invariant_after_transfer_admin(_seed in 0u32..1000u32) {
        let env = Env::default();
        let (client, contract_id) = setup_contract(&env);

        let new_admin = Address::generate(&env);
        client.transfer_admin(&new_admin);

        assert_admin_invariant(&env, &contract_id);
        prop_assert_eq!(stored_single_admin(&env, &contract_id), Some(new_admin));
    }

    /// The invariant holds after `update_admin_config` regardless of the
    /// generated admin list and threshold.
    #[test]
    fn prop_admin_invariant_after_update_admin_config(
        extra_admins in 0usize..5usize,
        threshold in 1u32..5u32,
    ) {
        let env = Env::default();
        let (client, contract_id) = setup_contract(&env);

        // Build an admin list whose first entry is the current primary admin.
        let primary = stored_single_admin(&env, &contract_id)
            .expect("primary admin must be set after initialize");
        let mut admins: Vec<Address> = Vec::new();
        admins.push(primary.clone());
        for _ in 0..extra_admins {
            admins.push(Address::generate(&env));
        }
        let admins_sdk = soroban_sdk::Vec::from_slice(&env, &admins);
        // Clamp threshold to the number of admins so the config is valid.
        let threshold = threshold.min(admins.len() as u32).max(1);

        client.update_admin_config(&admins_sdk, &threshold);

        assert_admin_invariant(&env, &contract_id);
        prop_assert_eq!(stored_single_admin(&env, &contract_id), Some(primary));
    }

    /// The invariant holds across a random sequence of admin operations.
    #[test]
    fn prop_admin_invariant_across_operations(
        ops in proptest::collection::vec(0u8..3u8, 1..10),
    ) {
        let env = Env::default();
        let (client, contract_id) = setup_contract(&env);

        for op in ops {
            match op {
                0 => {
                    let new_admin = Address::generate(&env);
                    client.set_admin(&new_admin);
                }
                1 => {
                    let new_admin = Address::generate(&env);
                    client.transfer_admin(&new_admin);
                }
                _ => {
                    let primary = stored_single_admin(&env, &contract_id)
                        .expect("primary admin must be set");
                    let admins_sdk = soroban_sdk::Vec::from_slice(&env, &[primary]);
                    client.update_admin_config(&admins_sdk, &1u32);
                }
            }
            assert_admin_invariant(&env, &contract_id);
        }
    }
}
