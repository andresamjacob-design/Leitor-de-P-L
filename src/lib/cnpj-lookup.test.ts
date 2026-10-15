import { afterEach, describe, expect, it, vi } from "vitest";
import { lookupCnpj } from "@/lib/cnpj-lookup";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("lookupCnpj", () => {
  it("CPF não chama a rede — só CNPJ (14 dígitos) é consultado", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(await lookupCnpj("123.456.789-00")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("resposta boa devolve razão social, nome fantasia e situação", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          razao_social: "FULANO CONSULTORIA LTDA",
          nome_fantasia: "Fulano Consultoria",
          descricao_situacao_cadastral: "ATIVA",
        }),
      }),
    );

    expect(await lookupCnpj("50050390000182")).toEqual({
      razaoSocial: "FULANO CONSULTORIA LTDA",
      nomeFantasia: "Fulano Consultoria",
      situacao: "ATIVA",
    });
  });

  it("nome fantasia em branco vira null, não string vazia", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ razao_social: "FULANO LTDA", nome_fantasia: "   " }),
      }),
    );

    expect((await lookupCnpj("50050390000182"))?.nomeFantasia).toBeNull();
  });

  it("CNPJ não encontrado (404) devolve null, não lança", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    expect(await lookupCnpj("50050390000182")).toBeNull();
  });

  it("resposta sem razão social devolve null", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }),
    );
    expect(await lookupCnpj("50050390000182")).toBeNull();
  });

  it("rede fora devolve null, nunca lança — enriquecimento não pode travar quem chama", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    await expect(lookupCnpj("50050390000182")).resolves.toBeNull();
  });
});
