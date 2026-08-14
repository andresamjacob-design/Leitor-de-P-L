import { describe, expect, it } from "vitest";
import {
  buildConsolidatedPl,
  buildPl,
  ELIMINATION_KEY,
  findLine,
  TOTAL_KEY,
  type PlCategory,
  type PlEntry,
} from "@/lib/pl";
import { formatMoney, parseMoney } from "@/lib/money";
import { formatPeriodShort } from "@/lib/dates";

const CATEGORIES: PlCategory[] = [
  { id: "rev", code: "3.01", name: "Receita — Suporte contínuo", dreGroup: "receita_bruta", sortOrder: 0 },
  { id: "iss", code: "4.02", name: "ISS", dreGroup: "deducoes", sortOrder: 10 },
  { id: "maq", code: "5.01", name: "Máquinas", dreGroup: "custos_diretos", sortOrder: 20 },
  { id: "sal", code: "6.02", name: "Salários", dreGroup: "pessoal", sortOrder: 30 },
  { id: "tool", code: "7.01", name: "Google Workspace", dreGroup: "ferramentas", sortOrder: 40 },
  { id: "luc", code: "99.04", name: "Distribuição de lucros", dreGroup: "socios", sortOrder: 90 },
  { id: "trf", code: "99.01", name: "Transferência", dreGroup: "transferencias", sortOrder: 91 },
  { id: "orfa", code: "0.00", name: "Sem grupo", dreGroup: null, sortOrder: 99 },
];

function entry(
  categoryId: string,
  amount: string,
  {
    period = "2026-01-01",
    entityId = "A",
    kind = "cost" as const,
    isIntercompany = false,
  }: Partial<Omit<PlEntry, "categoryId" | "amount">> = {},
): PlEntry {
  return { period, entityId, categoryId, amount: parseMoney(amount), kind, isIntercompany };
}

function revenue(amount: string, options: Partial<PlEntry> = {}) {
  return entry("rev", amount, { kind: "revenue", ...options });
}

function pl(entries: PlEntry[], periods = ["2026-01-01"]) {
  return buildPl({ periods, entries, categories: CATEGORIES, formatColumn: formatPeriodShort });
}

function value(report: ReturnType<typeof pl>, key: string, column = 0): string {
  return formatMoney(findLine(report, key)?.values[column] ?? 0n);
}

describe("buildPl — a ordem do DRE", () => {
  const report = pl([
    revenue("100.000,00"),
    entry("iss", "3.400,00"),
    entry("maq", "5.000,00"),
    entry("sal", "40.000,00"),
    entry("tool", "4.000,00"),
    entry("luc", "10.000,00"),
  ]);

  it("receita líquida é a bruta menos as deduções", () => {
    expect(value(report, "net-revenue")).toBe("96.600,00");
  });

  it("margem bruta desconta os custos diretos", () => {
    expect(value(report, "gross-margin")).toBe("91.600,00");
  });

  it("EBITDA desconta as despesas operacionais", () => {
    expect(value(report, "operating")).toBe("44.000,00");
    expect(value(report, "ebitda")).toBe("47.600,00");
  });

  it("distribuição de lucros fica abaixo do EBITDA", () => {
    expect(value(report, "result")).toBe("37.600,00");
  });

  it("as linhas saem na ordem do plano de contas", () => {
    const keys = report.lines.map((line) => line.key);
    expect(keys.indexOf("net-revenue")).toBeLessThan(keys.indexOf("gross-margin"));
    expect(keys.indexOf("gross-margin")).toBeLessThan(keys.indexOf("ebitda"));
    expect(keys.indexOf("ebitda")).toBeLessThan(keys.indexOf("result"));
  });
});

describe("o que o DRE não mostra", () => {
  it("transferência não entra em lugar nenhum — não é resultado", () => {
    const report = pl([revenue("1.000,00"), entry("trf", "50.000,00")]);
    expect(value(report, "result")).toBe("1.000,00");
    expect(report.lines.some((line) => line.label.includes("Transferência"))).toBe(false);
  });

  it("categoria sem grupo aparece numa linha própria e avisa", () => {
    const report = pl([revenue("1.000,00"), entry("orfa", "300,00")]);
    expect(findLine(report, "no-group")).toBeDefined();
    expect(report.warnings[0]).toContain("sem grupo de DRE");
  });

  it("uma linha de categoria apagada não some da conta", () => {
    const report = pl([revenue("1.000,00"), entry("fantasma", "77,00")]);
    expect(formatMoney(findLine(report, "no-group")?.values[0] ?? 0n)).toBe("77,00");
  });
});

describe("meses em coluna", () => {
  const report = pl(
    [
      revenue("100.000,00", { period: "2026-01-01" }),
      revenue("120.000,00", { period: "2026-02-01" }),
      entry("sal", "40.000,00", { period: "2026-01-01" }),
      entry("sal", "40.000,00", { period: "2026-02-01" }),
    ],
    ["2026-01-01", "2026-02-01"],
  );

  it("cada mês tem sua coluna, e o total soma as duas", () => {
    expect(value(report, "ebitda", 0)).toBe("60.000,00");
    expect(value(report, "ebitda", 1)).toBe("80.000,00");
    expect(formatMoney(findLine(report, "ebitda")?.total ?? 0n)).toBe("140.000,00");
  });

  it("os rótulos das colunas são os meses", () => {
    expect(report.columns.map((column) => column.label)).toEqual(["jan/26", "fev/26"]);
  });

  it("um estorno entra negativo e reduz o mês", () => {
    const comEstorno = pl([entry("tool", "-500,00", { period: "2026-01-01" })]);
    expect(value(comEstorno, "ebitda")).toBe("500,00");
  });
});

describe("§11.7 — consolidação", () => {
  const report = buildConsolidatedPl({
    entities: [
      { id: "A", name: "Entidade A" },
      { id: "B", name: "Entidade B" },
    ],
    entries: [
      revenue("100.000,00", { entityId: "A" }),
      revenue("40.000,00", { entityId: "B" }),
    ],
    categories: CATEGORIES,
  });

  const columnIndex = (key: string) => report.columns.findIndex((column) => column.key === key);

  it("o consolidado mostra R$ 140.000", () => {
    const line = findLine(report, "group-receita_bruta");
    expect(formatMoney(line?.values[columnIndex(TOTAL_KEY)] ?? 0n)).toBe("140.000,00");
  });

  it("as colunas por entidade continuam intactas", () => {
    const line = findLine(report, "group-receita_bruta");
    expect(formatMoney(line?.values[columnIndex("A")] ?? 0n)).toBe("100.000,00");
    expect(formatMoney(line?.values[columnIndex("B")] ?? 0n)).toBe("40.000,00");
  });
});

describe("eliminação de intercompany", () => {
  const report = buildConsolidatedPl({
    entities: [
      { id: "A", name: "Entidade A" },
      { id: "B", name: "Entidade B" },
    ],
    entries: [
      revenue("100.000,00", { entityId: "A" }),
      // A cobra R$ 10.000 de B: receita para A, custo para B, nada para o grupo.
      revenue("10.000,00", { entityId: "A", isIntercompany: true }),
      entry("tool", "10.000,00", { entityId: "B", isIntercompany: true }),
      revenue("40.000,00", { entityId: "B" }),
    ],
    categories: CATEGORIES,
  });

  const columnIndex = (key: string) => report.columns.findIndex((column) => column.key === key);
  const at = (key: string, column: string) =>
    formatMoney(findLine(report, key)?.values[columnIndex(column)] ?? 0n);

  it("cada entidade continua vendo o seu próprio número", () => {
    expect(at("group-receita_bruta", "A")).toBe("110.000,00");
    expect(at("group-ferramentas", "B")).toBe("10.000,00");
  });

  it("o consolidado não conta a receita que o grupo cobrou de si mesmo", () => {
    expect(at("group-receita_bruta", TOTAL_KEY)).toBe("140.000,00");
    expect(at("group-ferramentas", TOTAL_KEY)).toBe("0,00");
  });

  it("a coluna de eliminações mostra o que saiu, em vez de as contas não fecharem", () => {
    expect(at("group-receita_bruta", ELIMINATION_KEY)).toBe("-10.000,00");
    expect(at("group-ferramentas", ELIMINATION_KEY)).toBe("-10.000,00");
  });

  it("o resultado do grupo não muda por uma cobrança interna", () => {
    const semIntercompany = buildConsolidatedPl({
      entities: [
        { id: "A", name: "A" },
        { id: "B", name: "B" },
      ],
      entries: [revenue("100.000,00", { entityId: "A" }), revenue("40.000,00", { entityId: "B" })],
      categories: CATEGORIES,
    });

    expect(at("result", TOTAL_KEY)).toBe(
      formatMoney(
        findLine(semIntercompany, "result")?.values[
          semIntercompany.columns.findIndex((column) => column.key === TOTAL_KEY)
        ] ?? 0n,
      ),
    );
  });

  it("avisa quando não houve nada a eliminar", () => {
    const limpo = buildConsolidatedPl({
      entities: [{ id: "A", name: "A" }],
      entries: [revenue("1,00", { entityId: "A" })],
      categories: CATEGORIES,
    });
    expect(limpo.warnings.some((warning) => warning.includes("intercompany"))).toBe(true);
  });
});

describe("§11.8 — precisão no DRE", () => {
  it("mil linhas de R$ 0,01 dão exatamente R$ 10,00", () => {
    const entries = Array.from({ length: 1000 }, () => revenue("0,01"));
    expect(formatMoney(findLine(pl(entries), "result")?.values[0] ?? 0n)).toBe("10,00");
  });
});
