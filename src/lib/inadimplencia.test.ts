import { describe, expect, it } from "vitest";
import { avaliarInadimplencia, clienteDoRotulo, vencimentoDe, type Recebimento } from "@/lib/inadimplencia";
import type { LinhaDeNf } from "@/lib/nf-da-planilha";

const CLIENTES = [
  { id: "santa", name: "Santa Lucia", taxId: "06278750000106" },
  { id: "danke", name: "Danke", taxId: "05634508000165" },
  { id: "ilumini", name: "Ilumini Clinic", taxId: null },
  { id: "denise", name: "Denise Marques", taxId: null },
  { id: "medika", name: "Medika", taxId: null },
  { id: "orc", name: "ORC", taxId: null },
];

function linha(ordem: number, rotulo: string, cnpj: string | null, notas: [string, bigint][]): LinhaDeNf {
  return { ordem, rotulo, cnpj, escopo: "Projeto", notas: notas.map(([p, valor]) => ({ periodo: `2026-${p}-01`, valor })) };
}

let id = 0;
function recebido(data: string, valor: bigint, over: Partial<Recebimento> = {}): Recebimento {
  id += 1;
  return { id: `r${id}`, data, valor, clientId: null, cnpj: null, descricao: "RECEBIMENTOS", ...over };
}

const avaliar = (linhas: LinhaDeNf[], recebimentos: Recebimento[], hoje = "2026-11-03") =>
  avaliarInadimplencia({ linhas, clientes: CLIENTES, recebimentos, hoje, desde: "2026-01-01" });

describe("vencimentoDe", () => {
  it("nota do mês vence no último dia do mês seguinte", () => {
    expect(vencimentoDe("2026-08-01")).toBe("2026-09-30");
    expect(vencimentoDe("2026-01-01")).toBe("2026-02-28");
    expect(vencimentoDe("2026-12-01")).toBe("2027-01-31");
  });
});

describe("clienteDoRotulo", () => {
  const nome = (rotulo: string) => clienteDoRotulo(rotulo, CLIENTES)?.id ?? null;
  it("acha o cliente pelo nome antes do parêntese e do traço", () => {
    expect(nome("Santa Lucia")).toBe("santa");
    expect(nome("Medika (NF para Salesforce)")).toBe("medika");
    expect(nome("Denise Marques Midia")).toBe("denise");
    expect(nome("Ilumini Clini")).toBe("ilumini");
  });
  it("sigla curta não é palpite", () => {
    expect(nome("ORC Orçamentos")).toBeNull();
  });
});

describe("avaliarInadimplencia", () => {
  it("nota vencida e não paga é atraso; a do mês passado ainda está no prazo", () => {
    const r = avaliar([linha(1, "Santa Lucia", "06278750000106", [["08", 3_500_000n], ["09", 3_500_000n], ["10", 3_500_000n]])], [
      recebido("2026-09-10", 3_500_000n, { cnpj: "06278750000106" }),
    ]);
    const santa = r.pagadores[0]!;
    expect(santa.notas.map((n) => n.situacao)).toEqual(["paga", "atrasada", "a vencer"]);
    expect(santa.emAtraso).toBe(3_500_000n);
    expect(santa.diasDeAtraso).toBe(3);
    expect(santa.situacao).toBe("atrasado");
  });

  it("a raiz do CNPJ basta: filial paga pela matriz", () => {
    const r = avaliar([linha(1, "Santa Lucia", "06278750001080", [["09", 100_000n]])], [
      recebido("2026-10-01", 100_000n, { cnpj: "06278750000106" }),
    ]);
    expect(r.pagadores[0]!.situacao).toBe("em dia");
  });

  it("pagamento junto quita duas notas", () => {
    const r = avaliar([linha(1, "Danke", null, [["08", 1_237_500n], ["09", 1_237_500n]])], [
      recebido("2026-10-19", 2_475_000n, { clientId: "danke" }),
    ]);
    expect(r.pagadores[0]!.notas.every((n) => n.situacao === "paga")).toBe(true);
  });

  it("retenção na fonte não vira atraso, nem se acumula de um mês para o outro", () => {
    const mensal: [string, bigint][] = [["05", 1_000_000n], ["06", 1_000_000n], ["07", 1_000_000n], ["08", 1_000_000n]];
    const pagos = ["2026-06-10", "2026-07-10", "2026-08-10", "2026-09-10"].map((d) => recebido(d, 938_500n, { clientId: "danke" }));
    const r = avaliar([linha(1, "Danke", null, mensal)], pagos);
    expect(r.pagadores[0]!.notas.map((n) => n.situacao)).toEqual(["paga", "paga", "paga", "paga"]);
  });

  it("nota de antes do extrato não entra, e o pagamento de janeiro não quita dezembro", () => {
    const r = avaliarInadimplencia({
      linhas: [{ ordem: 1, rotulo: "Danke", cnpj: null, escopo: null, notas: [{ periodo: "2025-12-01", valor: 500n }, { periodo: "2026-01-01", valor: 500n }] }],
      clientes: CLIENTES,
      recebimentos: [recebido("2026-01-20", 500n, { clientId: "danke" })],
      hoje: "2026-11-03",
      desde: "2026-01-01",
    });
    expect(r.pagadores[0]!.notas).toHaveLength(1);
    expect(r.pagadores[0]!.situacao).toBe("em dia");
  });

  it("linha antiga sem CNPJ pega o da mesma descrição, quando é um só", () => {
    const r = avaliar([linha(1, "Santa Lucia", "06278750000106", [["03", 500n], ["04", 500n]])], [
      recebido("2026-03-25", 500n, { descricao: "RECEBIMENTOS SANTA LUCIA DIST" }),
      recebido("2026-04-25", 500n, { descricao: "RECEBIMENTOS SANTA LUCIA DIST", cnpj: "06278750000106" }),
    ]);
    expect(r.pagadores[0]!.situacao).toBe("em dia");
    expect(r.recebimentosSemPagador).toHaveLength(0);
  });

  it("nota para a Salesforce conta no cliente final, como o razão liga", () => {
    const r = avaliar([linha(1, "Medika (NF para Salesforce)", null, [["08", 7_168_000n]])], [
      recebido("2026-09-18", 7_000_000n, { clientId: "medika", descricao: "OP REC EXT · invoice 125" }),
    ]);
    expect(r.pagadores[0]!.nome).toBe("Medika");
    expect(r.pagadores[0]!.situacao).toBe("em dia");
  });

  it("mês que ainda não chegou é previsão, não cobrança", () => {
    const r = avaliar([linha(1, "Danke", null, [["12", 500n]])], []);
    expect(r.pagadores[0]!.notas[0]!.situacao).toBe("prevista");
    expect(r.pagadores[0]!.situacao).toBe("em dia");
  });

  it("sem saber quem paga, não acusa ninguém — e o dinheiro sem dono aparece à parte", () => {
    const r = avaliar([linha(1, "ORC Orçamentos", null, [["01", 500n]])], [recebido("2026-02-04", 500n, { descricao: "BOLETOS RECEBIDOS" })]);
    expect(r.pagadores).toHaveLength(0);
    expect(r.semIdentificacao.map((l) => l.rotulo)).toEqual(["ORC Orçamentos"]);
    expect(r.recebimentosSemPagador).toHaveLength(1);
  });
});
