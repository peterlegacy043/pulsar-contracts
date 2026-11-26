import React, { useState } from "react";
import { Spinner } from "./ContractCallStatus";
import type { PaymentRecord } from "../contract";
import { formatStroops } from "../utils/formatStroops";
import "./PaymentTable.css";

interface Props {
  records: PaymentRecord[];
  loading: boolean;
  tokenDecimals?: number;
  tokenSymbol?: string;
}

const STATUS_COLOR: Record<string, string> = {
  Completed: "#22c55e",
  PartiallyRefunded: "#f59e0b",
  FullyRefunded: "#3b82f6",
};

export function PaymentTable({
  records,
  loading,
  tokenDecimals = 7,
  tokenSymbol = "XLM",
}: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const toggleExpanded = (orderId: string) => {
    setExpandedId((current) => (current === orderId ? null : orderId));
  };

  const handleKeyDown = (event: React.KeyboardEvent, orderId: string) => {
    if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
      event.preventDefault();
      toggleExpanded(orderId);
    }
  };

  const formatAmount = (amount: string | number) =>
    `${formatStroops(amount, tokenDecimals)} ${tokenSymbol}`;
  if (loading) {
    return (
      <div style={{ padding: "24px 0", display: "flex", justifyContent: "center" }}>
        <Spinner label="Loading payments…" />
      </div>
    );
  }
  if (!records.length) return <p>No payments found.</p>;

  return (
    <>
      <div className="payment-table__desktop" role="region" aria-label="Payment history">
        <table className="payment-table">
          <thead>
            <tr>
              {["Order ID", "Merchant", "Token", "Amount", "Date", "Status"].map((heading) => (
                <th key={heading} scope="col">{heading}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {records.map((record) => {
              const isExpanded = expandedId === record.order_id;
              return (
                <React.Fragment key={record.order_id}>
                  <tr
                    className="payment-table__row"
                    tabIndex={0}
                    aria-expanded={isExpanded}
                    onClick={() => toggleExpanded(record.order_id)}
                    onKeyDown={(event) => handleKeyDown(event, record.order_id)}
                  >
                    <td className="payment-table__mono">{record.order_id}</td>
                    <td className="payment-table__mono">
                      {record.merchant_address.slice(0, 8)}…{record.merchant_address.slice(-4)}
                    </td>
                    <td className="payment-table__mono">
                      {record.token.slice(0, 8)}…{record.token.slice(-4)}
                    </td>
                    <td>{formatAmount(record.amount)}</td>
                    <td>{new Date(record.paid_at * 1000).toLocaleString()}</td>
                    <td>
                      <span style={{ color: STATUS_COLOR[record.status] ?? "#64748b", fontWeight: 600 }}>
                        {record.status}
                      </span>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr className="payment-table__detail">
                      <td colSpan={6}>
                        <dl className="payment-table__detail-list">
                          <div><dt>Order ID</dt><dd className="payment-table__mono">{record.order_id}</dd></div>
                          <div><dt>Merchant</dt><dd className="payment-table__mono">{record.merchant_address}</dd></div>
                          <div><dt>Token</dt><dd className="payment-table__mono">{record.token}</dd></div>
                          <div><dt>Amount</dt><dd>{formatAmount(record.amount)}</dd></div>
                          <div><dt>Date</dt><dd>{new Date(record.paid_at * 1000).toLocaleString()}</dd></div>
                          <div>
                            <dt>Status</dt>
                            <dd style={{ color: STATUS_COLOR[record.status] ?? "#64748b", fontWeight: 600 }}>
                              {record.status}
                            </dd>
                          </div>
                        </dl>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <ul className="payment-table__cards" aria-label="Payment history">
        {records.map((record) => {
          const isExpanded = expandedId === record.order_id;
          return (
            <li
              className="payment-table__card"
              key={record.order_id}
              tabIndex={0}
              aria-expanded={isExpanded}
              onClick={() => toggleExpanded(record.order_id)}
              onKeyDown={(event) => handleKeyDown(event, record.order_id)}
            >
              <dl>
                <div><dt>Order ID</dt><dd className="payment-table__mono">{record.order_id}</dd></div>
                <div><dt>Merchant</dt><dd className="payment-table__mono">{record.merchant_address}</dd></div>
                <div><dt>Token</dt><dd className="payment-table__mono">{record.token}</dd></div>
                <div><dt>Amount</dt><dd>{formatAmount(record.amount)}</dd></div>
                <div><dt>Date</dt><dd>{new Date(record.paid_at * 1000).toLocaleString()}</dd></div>
                <div>
                  <dt>Status</dt>
                  <dd style={{ color: STATUS_COLOR[record.status] ?? "#64748b", fontWeight: 600 }}>
                    {record.status}
                  </dd>
                </div>
              </dl>
              {isExpanded && (
                <div className="payment-table__card-detail">
                  <p><strong>Full order ID:</strong> <span className="payment-table__mono">{record.order_id}</span></p>
                  <p><strong>Full merchant address:</strong> <span className="payment-table__mono">{record.merchant_address}</span></p>
                  <p><strong>Full token address:</strong> <span className="payment-table__mono">{record.token}</span></p>
                  <p><strong>Amount:</strong> {formatAmount(record.amount)}</p>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
