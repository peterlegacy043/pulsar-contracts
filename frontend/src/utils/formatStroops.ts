/**
 * Formats a raw stroop amount into a human-readable decimal string.
 *
 * Stellar assets use 7 decimal places by default (1 XLM = 10,000,000 stroops).
 *
 * @param amount - The raw amount in stroops (as a number or numeric string).
 * @param decimals - The token's decimal precision. Defaults to 7 (XLM/native).
 * @returns The formatted amount as a fixed-precision decimal string.
 */
export function formatStroops(
  amount: number | string,
  decimals: number = 7,
): string {
  const numericAmount =
    typeof amount === "string" ? Number(amount) : amount;

  if (!Number.isFinite(numericAmount)) {
    return (0).toFixed(decimals);
  }

  return (numericAmount / Math.pow(10, decimals)).toFixed(decimals);
}

export default formatStroops;
```

File: frontend/src/utils/formatStroops.test.ts
Current content:


Change type: create
Step: Create a formatStroops(amount, decimals) utility that returns (amount / 10^decimals).toFixed(decimals), plus unit tests covering default 7-decimal XLM formatting (e.g. 10000000 -> '1.0000000'), zero, and custom decimals.

```ts
import { describe, it, expect } from "vitest";
import { formatStroops } from "./formatStroops";

describe("formatStroops", () => {
  it("formats 7-decimal XLM by default (10000000 -> '1.0000000')", () => {
    expect(formatStroops(10000000)).toBe("1.0000000");
  });

  it("formats zero with default decimals", () => {
    expect(formatStroops(0)).toBe("0.0000000");
  });

  it("formats fractional XLM amounts with default decimals", () => {
    expect(formatStroops(15000000)).toBe("1.5000000");
    expect(formatStroops(1)).toBe("0.0000001");
  });

  it("accepts numeric strings", () => {
    expect(formatStroops("10000000")).toBe("1.0000000");
  });

  it("respects custom decimals", () => {
    expect(formatStroops(1000000, 6)).toBe("1.000000");
    expect(formatStroops(100, 2)).toBe("1.00");
    expect(formatStroops(12345, 0)).toBe("12345");
  });

  it("handles non-finite input gracefully", () => {
    expect(formatStroops(NaN)).toBe("0.0000000");
    expect(formatStroops(Infinity)).toBe("0.0000000");
  });
});