// NOTE: This file is auto-generated from the contract ABI.
// Do not edit by hand. Regenerate with:
//   npm run generate:contract
// (which runs `stellar contract bindings typescript` against docs/contract-abi.json)
import { Contract, Networks, rpc } from "@stellar/stellar-sdk";

import type {
  PaymentRecord,
  PaymentPage,
  PaymentFilter,
} from "./generated/contract-types";

export type { PaymentRecord, PaymentPage, PaymentFilter };

export const CONTRACT_ID = import.meta.env.VITE_CONTRACT_ID as string;
export const NETWORK_PASSPHRASE = import.meta.env.VITE_NETWORK_PASSPHRASE ?? Networks.TESTNET;
export const RPC_URL = import.meta.env.VITE_RPC_URL ?? "https://soroban-testnet.stellar.org";

export const server = new rpc.Server(RPC_URL);
export const contract = new Contract(CONTRACT_ID);

export async function fetchPayerHistory(
  payer: string,
  cursor: string | null,
  limit: number,
  filter: PaymentFilter,
  sort_field: "Date" | "Amount",
  sort_order: "Ascending" | "Descending"
): Promise<PaymentPage> {
  const tx = contract.call(
    "get_payer_payment_history",
    ...[payer, cursor, limit, filter, sort_field, sort_order].map((v) =>
      JSON.stringify(v)
    )
  );
  const result = await server.simulateTransaction(
    await server.prepareTransaction(tx as any)
  );
  // @ts-expect-error result shape varies by SDK version
  return result.result?.retval?.value() ?? { records: [], next_cursor: null };
}
