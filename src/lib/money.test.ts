import { describe, expect, it } from "vitest";
import {
  allocate,
  formatBRL,
  formatMoney,
  fromNumeric,
  mulRatio,
  parseMoney,
  sum,
  toNumeric,
} from "./money";

describe("parseMoney", () => {
  it("reads pt-BR notation", () => {
    expect(parseMoney("1.234,56")).toBe(123456n);
    expect(parseMoney("R$ 1.234,56")).toBe(123456n);
    expect(parseMoney("0,01")).toBe(1n);
    expect(parseMoney("-50,00")).toBe(-5000n);
    expect(parseMoney("(50,00)")).toBe(-5000n);
  });

  it("reads en-US notation when both separators are present", () => {
    expect(parseMoney("1,234.56")).toBe(123456n);
  });

  it("reads the D/C suffix Brazilian statements use", () => {
    expect(parseMoney("1.200,00 D")).toBe(-120000n);
    expect(parseMoney("1.200,00 C")).toBe(120000n);
  });

  it("treats a lone dot with three digits as a thousands separator", () => {
    expect(parseMoney("1.234")).toBe(123400n);
    expect(parseMoney("1.5")).toBe(150n);
  });

  it("honours an explicitly declared separator over inference", () => {
    expect(parseMoney("1.234", { decimalSeparator: "." })).toBe(123n);
  });

  it("rounds spreadsheet float noise once, half-up", () => {
    // Values straight out of the DRE spreadsheet.
    expect(parseMoney("30714.28571", { decimalSeparator: "." })).toBe(3071429n);
    expect(parseMoney("8166.666667", { decimalSeparator: "." })).toBe(816667n);
    expect(parseMoney("1848.851667", { decimalSeparator: "." })).toBe(184885n);
  });

  it("rejects anything that is not a number", () => {
    expect(() => parseMoney("SALDO EM CONTA CORRENTE")).toThrow();
    expect(() => parseMoney("")).toThrow();
  });
});

describe("formatting", () => {
  it("formats pt-BR", () => {
    expect(formatMoney(123456n)).toBe("1.234,56");
    expect(formatMoney(1n)).toBe("0,01");
    expect(formatMoney(0n)).toBe("0,00");
    expect(formatMoney(-5000n)).toBe("-50,00");
    expect(formatMoney(100000000n)).toBe("1.000.000,00");
    expect(formatBRL(123456n)).toBe("R$ 1.234,56");
  });

  it("round-trips through the Postgres numeric representation", () => {
    for (const value of [0n, 1n, -1n, 123456n, -98765432n]) {
      expect(fromNumeric(toNumeric(value))).toBe(value);
    }
    expect(toNumeric(123456n)).toBe("1234.56");
    expect(toNumeric(-1n)).toBe("-0.01");
  });
});

describe("SPEC §11.8 — money precision", () => {
  it("sums 1.000 entries of R$ 0,01 to exactly R$ 10,00", () => {
    const entries = Array.from({ length: 1000 }, () => parseMoney("0,01"));
    const total = sum(entries);
    expect(total).toBe(1000n);
    expect(formatBRL(total)).toBe("R$ 10,00");
  });

  it("does not drift over a hundred thousand additions", () => {
    const entries = Array.from({ length: 100_000 }, () => 1n);
    expect(sum(entries)).toBe(100_000n);
  });
});

describe("mulRatio", () => {
  it("prorates a retainer by days — SPEC §11.3", () => {
    // R$ 6.000/month starting 15/04: 16 of April's 30 days.
    expect(mulRatio(600000n, 16n, 30n)).toBe(320000n);
    expect(formatBRL(mulRatio(600000n, 16n, 30n))).toBe("R$ 3.200,00");
  });

  it("computes a POC delta — SPEC §11.1", () => {
    // R$ 50.000 project, 20 percentage points recognised this month.
    expect(mulRatio(5000000n, 20n, 100n)).toBe(1000000n);
  });

  it("computes a negative POC delta — SPEC §11.2, rewritten (DECISIONS D-E)", () => {
    // Cumulative went from 30% to 25% with the correction flag.
    expect(mulRatio(5000000n, -5n, 100n)).toBe(-250000n);
    expect(formatBRL(mulRatio(5000000n, -5n, 100n))).toBe("R$ -2.500,00");
  });

  it("rounds half-up away from zero", () => {
    expect(mulRatio(1n, 1n, 2n)).toBe(1n);
    expect(mulRatio(-1n, 1n, 2n)).toBe(-1n);
    expect(mulRatio(1n, 4n, 10n)).toBe(0n);
  });
});

describe("allocate", () => {
  it("spreads a project over its months without losing a cent — SPEC §11.1", () => {
    const months = allocate(5000000n, [1n, 1n, 1n, 1n, 1n]);
    expect(months).toEqual([1000000n, 1000000n, 1000000n, 1000000n, 1000000n]);
    expect(sum(months)).toBe(5000000n);
  });

  it("gives leftover cents away deterministically", () => {
    const parts = allocate(100n, [1n, 1n, 1n]);
    expect(parts).toEqual([34n, 33n, 33n]);
    expect(sum(parts)).toBe(100n);
  });

  it("never loses a cent, whatever the split", () => {
    for (const total of [1n, 7n, 99n, 100001n, 5000000n]) {
      for (const count of [2, 3, 7, 12, 13]) {
        const parts = allocate(total, Array.from({ length: count }, () => 1n));
        expect(sum(parts)).toBe(total);
      }
    }
  });

  it("respects uneven weights", () => {
    // Exploding a R$ 1.200 card invoice across three purchases — SPEC §11.4.
    const parts = allocate(120000n, [50000n, 40000n, 30000n]);
    expect(sum(parts)).toBe(120000n);
    expect(parts).toEqual([50000n, 40000n, 30000n]);
  });

  it("handles negative totals", () => {
    const parts = allocate(-100n, [1n, 1n, 1n]);
    expect(sum(parts)).toBe(-100n);
  });

  it("refuses to allocate across zero weight", () => {
    expect(() => allocate(100n, [0n, 0n])).toThrow();
  });
});
