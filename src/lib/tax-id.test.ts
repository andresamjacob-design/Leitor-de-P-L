import { describe, expect, it } from "vitest";
import { formatTaxId, isSameTaxId, isValidTaxId, normalizeTaxId } from "./tax-id";

describe("tax ids", () => {
  it("normalises to digits", () => {
    expect(normalizeTaxId("50.050.390/0001-82")).toBe("50050390000182");
    expect(normalizeTaxId("50050390000182")).toBe("50050390000182");
  });

  it("formats CNPJ and CPF", () => {
    expect(formatTaxId("50050390000182")).toBe("50.050.390/0001-82");
    expect(formatTaxId("45207742000120")).toBe("45.207.742/0001-20");
    expect(formatTaxId("12345678909")).toBe("123.456.789-09");
    expect(formatTaxId(null)).toBe("—");
  });

  it("leaves an unrecognised length untouched rather than mangling it", () => {
    expect(formatTaxId("123")).toBe("123");
  });

  it("matches a statement CNPJ against a stored one", () => {
    // Left side as it arrives in the Itaú XLSX, right side as stored.
    expect(isSameTaxId("06.278.750/0001-06", "06278750000106")).toBe(true);
    expect(isSameTaxId("06.278.750/0001-06", "41661994000174")).toBe(false);
    expect(isSameTaxId(null, "06278750000106")).toBe(false);
    expect(isSameTaxId("", "")).toBe(false);
  });
});

describe("isValidTaxId", () => {
  it("aceita os CNPJs reais das duas entidades", () => {
    expect(isValidTaxId("50.050.390/0001-82")).toBe(true);
    expect(isValidTaxId("45.207.742/0001-20")).toBe(true);
  });

  it("recusa um dígito trocado", () => {
    expect(isValidTaxId("50.050.390/0001-83")).toBe(false);
  });

  it("aceita CPF válido e recusa inválido", () => {
    expect(isValidTaxId("529.982.247-25")).toBe(true);
    expect(isValidTaxId("529.982.247-26")).toBe(false);
  });

  it("recusa dígito repetido, que passa na conta mas nunca é real", () => {
    expect(isValidTaxId("111.111.111-11")).toBe(false);
    expect(isValidTaxId("00.000.000/0000-00")).toBe(false);
  });

  it("recusa o que não tem o tamanho certo", () => {
    expect(isValidTaxId("123")).toBe(false);
    expect(isValidTaxId("")).toBe(false);
  });
});
