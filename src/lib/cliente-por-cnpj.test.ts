import { describe, expect, it } from "vitest";
import { clientePorCnpj } from "./cliente-por-cnpj";

describe("clientePorCnpj", () => {
  const achar = clientePorCnpj([
    { id: "salesforce", taxId: "01.080.512/0001-78" },
    { id: "diagnose", taxId: "87505632000195" },
    { id: "sem-cnpj", taxId: null },
    { id: "dup-a", taxId: "11111111000111" },
    { id: "dup-b", taxId: "11.111.111/0001-11" },
  ]);

  it("liga pelo CNPJ ignorando a formatação", () => {
    expect(achar("01080512000178")).toBe("salesforce");
    expect(achar("87.505.632/0001-95")).toBe("diagnose");
  });

  it("não liga quando não há CNPJ ou ele não está cadastrado", () => {
    expect(achar(null)).toBeNull();
    expect(achar("")).toBeNull();
    expect(achar("99999999000199")).toBeNull();
  });

  it("não escolhe quando dois clientes têm o mesmo CNPJ", () => {
    expect(achar("11111111000111")).toBeNull();
  });
});
