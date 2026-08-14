import { describe, expect, it } from "vitest";
import {
  buildContractPrompt,
  draftToFormDefaults,
  parseContractDraft,
} from "@/lib/ai/contract";

function reply(fields: Record<string, unknown>): string {
  return JSON.stringify(fields);
}

const FULL = {
  clientName: { value: "Mary Kay do Brasil", snippet: "CONTRATANTE: MARY KAY DO BRASIL LTDA" },
  name: { value: "Suporte Salesforce", snippet: "objeto: suporte contínuo à plataforma" },
  type: { value: "retainer", snippet: "prestação continuada" },
  monthlyValue: { value: "R$ 12.000,00", snippet: "mensalidade de R$ 12.000,00" },
  startDate: { value: "01/03/2026", snippet: "vigência a partir de 01/03/2026" },
};

describe("buildContractPrompt", () => {
  it("manda o contrato inteiro quando ele cabe", () => {
    expect(buildContractPrompt("Cláusula primeira...")).toContain("Cláusula primeira...");
  });

  it("trunca documento gigante e diz que truncou", () => {
    const prompt = buildContractPrompt("x".repeat(80_000));
    expect(prompt).toContain("documento truncado");
    expect(prompt.length).toBeLessThan(70_000);
  });
});

describe("parseContractDraft", () => {
  it("guarda o valor como texto, junto do trecho de origem", () => {
    const draft = parseContractDraft(reply(FULL));

    expect(draft.fields.monthlyValue).toEqual({
      value: "R$ 12.000,00",
      snippet: "mensalidade de R$ 12.000,00",
    });
    expect(draft.fields.clientName?.value).toBe("Mary Kay do Brasil");
  });

  it("nunca converte o valor em número — isso é trabalho do formulário", () => {
    const draft = parseContractDraft(reply(FULL));
    expect(typeof draft.fields.monthlyValue?.value).toBe("string");
    expect(draft.fields.monthlyValue?.value).toBe("R$ 12.000,00");
  });

  it("lista o que a IA não achou, em vez de preencher com palpite", () => {
    const draft = parseContractDraft(reply(FULL));
    expect(draft.missing).toContain("totalValue");
    expect(draft.missing).toContain("endDate");
    expect(draft.fields.totalValue).toBeUndefined();
  });

  it("avisa quando um campo veio sem o trecho de origem", () => {
    const draft = parseContractDraft(reply({ monthlyValue: { value: "R$ 1,00" } }));
    expect(draft.fields.monthlyValue?.snippet).toBeNull();
    expect(draft.warnings[0]).toContain("trecho de origem");
  });

  it("aceita um campo que veio como string solta", () => {
    const draft = parseContractDraft(reply({ clientName: "Acme" }));
    expect(draft.fields.clientName?.value).toBe("Acme");
  });

  it("recusa um tipo que não é contínuo nem projeto", () => {
    const draft = parseContractDraft(reply({ type: { value: "guarda-chuva", snippet: "x" } }));
    expect(draft.fields.type).toBeUndefined();
    expect(draft.missing).toContain("type");
    expect(draft.warnings[0]).toContain("não é reconhecido");
  });

  it("ignora campo que a IA inventou fora da lista", () => {
    const draft = parseContractDraft(
      reply({ ...FULL, multaRescisoria: { value: "10%", snippet: "x" } }),
    );
    expect(Object.keys(draft.fields)).not.toContain("multaRescisoria");
  });

  it("corta trecho absurdamente longo", () => {
    const draft = parseContractDraft(
      reply({ scope: { value: "x", snippet: "y".repeat(2000) } }),
    );
    expect((draft.fields.scope?.snippet ?? "").length).toBeLessThanOrEqual(400);
  });

  it("resposta que não é JSON vira rascunho vazio, com aviso", () => {
    const draft = parseContractDraft("Não consegui ler o documento.");
    expect(Object.keys(draft.fields)).toHaveLength(0);
    expect(draft.warnings).toHaveLength(1);
  });

  it("um array em vez de objeto é recusado", () => {
    const draft = parseContractDraft("[]");
    expect(draft.warnings[0]).toContain("não é um objeto");
  });

  it("objeto vazio avisa que nada foi encontrado", () => {
    const draft = parseContractDraft("{}");
    expect(draft.warnings.some((warning) => warning.includes("nenhum campo"))).toBe(true);
  });
});

describe("draftToFormDefaults", () => {
  it("entrega só texto, para o formulário validar de novo", () => {
    const defaults = draftToFormDefaults(parseContractDraft(reply(FULL)));
    expect(defaults.monthlyValue).toBe("R$ 12.000,00");
    expect(defaults.totalValue).toBeUndefined();
  });
});
