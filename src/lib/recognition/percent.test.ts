import { describe, expect, it } from "vitest";
import {
  formatPercent,
  fromNumericPercent,
  isWithinRange,
  parsePercent,
  toNumericPercent,
  FULL,
} from "@/lib/recognition/percent";

describe("parsePercent", () => {
  it("lê inteiro, decimal com vírgula e com ponto", () => {
    expect(parsePercent("30")).toBe(30_000n);
    expect(parsePercent("30,5")).toBe(30_500n);
    expect(parsePercent("30.5")).toBe(30_500n);
    expect(parsePercent("100")).toBe(FULL);
  });

  it("aceita o símbolo e o espaço", () => {
    expect(parsePercent(" 42,5 % ")).toBe(42_500n);
  });

  it("guarda as três casas que a coluna permite, e corta o resto", () => {
    expect(parsePercent("0,001")).toBe(1n);
    expect(parsePercent("0,0009")).toBe(0n);
  });

  it("recusa o que não é percentual", () => {
    expect(() => parsePercent("")).toThrow();
    expect(() => parsePercent("trinta")).toThrow();
  });
});

describe("formatPercent", () => {
  it("não mostra decimal que não existe", () => {
    expect(formatPercent(30_000n)).toBe("30");
    expect(formatPercent(30_500n)).toBe("30,5");
    expect(formatPercent(30_050n)).toBe("30,05");
    expect(formatPercent(0n)).toBe("0");
  });

  it("formata negativo, que é o que uma correção produz", () => {
    expect(formatPercent(-5_000n)).toBe("-5");
  });
});

describe("ida e volta pelo banco", () => {
  it("sobrevive a numeric(6,3)", () => {
    for (const value of [0n, 1n, 20_000n, 30_500n, FULL]) {
      expect(fromNumericPercent(toNumericPercent(value))).toBe(value);
    }
  });

  it("escreve a coluna com três casas", () => {
    expect(toNumericPercent(30_500n)).toBe("30.500");
    expect(toNumericPercent(FULL)).toBe("100.000");
  });
});

describe("isWithinRange", () => {
  it("0 a 100 passa, fora disso não", () => {
    expect(isWithinRange(0n)).toBe(true);
    expect(isWithinRange(FULL)).toBe(true);
    expect(isWithinRange(-1n)).toBe(false);
    expect(isWithinRange(FULL + 1n)).toBe(false);
  });
});
