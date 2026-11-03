import { describe, expect, it } from "vitest";
import { chaveDoPagador, clienteJaVisto, clientePeloNome, type ClienteCadastrado } from "@/lib/import/cliente-pelo-nome";

const CLIENTES: ClienteCadastrado[] = [
  { id: "hold", name: "Hold Beauty", taxId: "48200079000120" },
  { id: "fast", name: "Fast Escova", taxId: "34243495000100" },
  { id: "danke", name: "Danke", taxId: "05634508000165" },
  { id: "carflix", name: "Carflix", taxId: "27750422000130" },
  { id: "ms", name: "MS Tecnologia", taxId: "11111111000111" },
  { id: "semdoc", name: "Insider", taxId: null },
];

const id = (nome: string | null, clientes = CLIENTES) => clientePeloNome(nome, clientes)?.id ?? null;

describe("clientePeloNome (D169)", () => {
  it("o nome cadastrado é o começo do nome de quem pagou", () => {
    expect(id("HOLD BEAUTY IMPORTACAO LTDA")).toBe("hold");
    expect(id("FAST ESCOVA FRANCHISING LTDA")).toBe("fast");
    expect(id("DANKE DO BRASIL COMERCIO IMPORTACAO E EXPORTACAO...")).toBe("danke");
    expect(id("CARFLIX FRANCHISING S.A.")).toBe("carflix");
  });

  it("parecido no meio do nome não casa — o caso da D87", () => {
    expect(id("FULANO MARKETING E TECNOLOGIA")).toBeNull();
    expect(id("BEAUTY SUPPLY COSMETICS SOCIEDADE UNIPESSOAL LTDA")).toBeNull();
  });

  it("sigla curta não identifica ninguém", () => {
    expect(id("FE FRANCHISING LTDA", [{ id: "fe", name: "FE", taxId: "1" }])).toBeNull();
  });

  it("cliente sem CNPJ também casa — o vínculo é pelo cliente, não pelo documento", () => {
    expect(id("INSIDER BRASIL LICENCIAMENTO")).toBe("semdoc");
  });

  it("nome cortado pelo banco casa com o nome cadastrado inteiro", () => {
    const longo = [{ id: "ins", name: "Insider Brasil Licenciamento e Servicos de Softwar", taxId: null }];
    expect(id("INSIDER BRASIL LICENCIAMENTO E SERVICOS DE SOFTWAR", longo)).toBe("ins");
    expect(id("INSIDER BRASIL LICENCIAMENTO", longo)).toBe("ins");
    expect(id("INSIDER", longo)).toBeNull();
  });

  it("dois clientes casando: não decide", () => {
    const dois = [...CLIENTES, { id: "hold2", name: "Hold", taxId: "2" }];
    expect(id("HOLD BEAUTY IMPORTACAO LTDA", dois)).toBeNull();
  });

  it("sem nome, sem cliente", () => {
    expect(id(null)).toBeNull();
    expect(id("   ")).toBeNull();
  });
});

describe("clienteJaVisto", () => {
  const historico = new Map([
    [chaveDoPagador("INSIDER BRASIL LICENCIAMENTO E SERVICOS DE SOFTWAR"), "vasco"],
    [chaveDoPagador("FE FRANCHISING LTDA"), "fast"],
  ]);

  it("pagador já ligado a um cliente volta para o mesmo cliente, mesmo sem nome parecido", () => {
    expect(clienteJaVisto("INSIDER BRASIL LICENCIAMENTO E SERVICOS DE SOFTWAR", historico)).toBe("vasco");
    expect(clienteJaVisto("Fe Franchising Ltda.", historico)).toBe("fast");
  });

  it("pagador nunca visto não tem cliente — ninguém é cadastrado sozinho", () => {
    expect(clienteJaVisto("BEAUTY SUPPLY COSMETICS", historico)).toBeNull();
    expect(clienteJaVisto(null, historico)).toBeNull();
    expect(clienteJaVisto("  ", historico)).toBeNull();
  });
});
