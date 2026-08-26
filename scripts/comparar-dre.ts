/**
 * A DRE do app contra a DRE da planilha, linha a linha (D114).
 *
 * ## Por que isto só ficou possível agora
 *
 * A pergunta *"a DRE do app bate com a minha?"* estava travada por um defeito, não por
 * critério: **R$ 442.500 de distribuição de lucro estavam dentro de `6.10 Freelancers`**, e
 * comparar uma linha que carrega retirada de sócio contra uma que não carrega não diz nada.
 * A D110 separou, a D111 fechou a última contraparte de folha, e a comparação passou a ter
 * sentido.
 *
 * ## O que este script mede, e o que ele não mede
 *
 * Ele compara **só o bloco de custo** — as linhas `- xxx` da `DRE Geral`, mais `Maquinas` —,
 * e de propósito:
 *
 *   - **Receita fica de fora.** Ela já tem conferência própria, e mais forte: a receita
 *     reconhecida bate com a planilha **mês a mês** desde julho.
 *   - **Imposto fica de fora dos dois lados.** A planilha o põe **acima** do lucro bruto
 *     (linha `Impostos`) e o app em `4.01`, **dentro** do custo. Comparar sem tirar os dois
 *     inverte o sinal da conclusão — foi o erro que a D101 quase publicou, e ele está
 *     anotado no handover como armadilha paga.
 *
 * ## A hipótese que ele testa
 *
 * A D101 achou que a planilha lança **um mês à frente do caixa**, e provou em quatro linhas
 * (jurídico, seguro saúde, plano de saúde, imposto). O app, por outro lado, espelha custo no
 * mês do `occurred_on` (D2a) — ou seja, no mês em que o dinheiro saiu, salvo override.
 *
 * Se a D101 vale em geral, então **a DRE do app é a da planilha deslocada um mês**, e não
 * uma DRE diferente. Este script conta, linha a linha, em quantos meses cada alinhamento
 * fecha ao centavo:
 *
 *     alinhado    planilha[mês]  ==  app[mês]
 *     defasado    planilha[mês]  ==  app[mês seguinte]
 *
 * Uma linha que fecha melhor defasada é uma linha em que os dois sistemas concordam sobre o
 * dinheiro e discordam só sobre a data. Uma que não fecha em nenhum dos dois é a que vale
 * olhar.
 *
 * Só lê. Nada aqui escreve no banco.
 *
 *   npm run comparar
 *   npm run comparar -- --detalhe    # mês a mês de cada linha
 */

import { readFileSync } from "node:fs";
import postgres from "postgres";
import { loadEnvLocal } from "./load-env.ts";
import { TO_CODE } from "./plano-de-contas.ts";
import { readXlsx } from "@/lib/import/xlsx";
import { formatBRL, fromNumeric, type Cents } from "@/lib/money";

loadEnvLocal();

const DETALHE = process.argv.includes("--detalhe");
const FLUXO = process.argv.includes("--fluxo");

const GREEN = "[32m";
const YELLOW = "[33m";
const BOLD = "[1m";
const DIM = "[2m";
const RESET = "[0m";

const PLANILHA = "docs/reference/Claude de DRE - Dynamics Data 2026.xlsx";
/** `Janeiro` é a coluna 4 da `DRE Geral`; daí em diante, um mês por coluna. */
const PRIMEIRA_COLUNA = 4;
const MESES = ["01", "02", "03", "04", "05", "06", "07"] as const;
const NOMES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul"] as const;

/**
 * Onde o `TO_CODE` do `propose:rules` não serve para **comparar**, e por quê.
 *
 * Aquele mapa existe para escrever regra de texto, e ali `Salários → 6.02` é o destino
 * *nominal* da linha. Para comparar, o que importa é onde o dinheiro **está**: a D110 mostrou
 * que a folha inteira vive em `6.10` e o pró-labore dos sócios em `6.11`, e `6.02` está
 * vazia. Usar o mapa cru aqui compararia a linha de R$ 1,37 milhão contra uma conta zerada.
 */
const AJUSTES: Record<string, { codes: string[]; porque: string }> = {
  Salários: {
    codes: ["6.10", "6.11"],
    porque: "a linha é a aba `Colaboradores` inteira — time mais pró-labore dos sócios (D110)",
  },
  Freelancers: {
    codes: [],
    porque: "vale 20.134,72 idêntico todo mês: é média contábil, não pagamento — nada a comparar",
  },
};

type Linha = { rotulo: string; codes: string[]; porque: string | null; planilha: Cents[] };

/** `- Gsuite (cartão de credito)` → `Gsuite`. */
function normalizar(bruto: string): string {
  return bruto
    .replace(/^-\s*/, "")
    .replace(/\s*\([^)]*\)\s*$/, "")
    .trim();
}

/** A planilha escreve número com ponto decimal; centavos são bigint (§7 do handover). */
function centavos(bruto: string | null): Cents {
  const t = (bruto ?? "").trim();
  if (t === "") return 0n;
  return BigInt(Math.round(Number(t) * 100));
}

function lerPlanilha(): Linha[] {
  const aba = readXlsx(readFileSync(PLANILHA)).find((s) => s.name === "DRE Geral");
  if (!aba) throw new Error("aba `DRE Geral` não encontrada");

  const linhas: Linha[] = [];
  for (const row of aba.rows) {
    const bruto = String(row[2] ?? "").trim();
    // O bloco de custo é o das linhas que começam com `-`; `Maquinas` é custo direto e
    // vem sem o traço, então entra pelo nome.
    if (!bruto.startsWith("-") && bruto !== "Maquinas") continue;
    const rotulo = normalizar(bruto);
    const ajuste = AJUSTES[rotulo];
    const code = TO_CODE[rotulo];
    if (!ajuste && !code) continue; // linha da planilha que o plano de contas não tem

    linhas.push({
      rotulo,
      codes: ajuste ? ajuste.codes : [code as string],
      porque: ajuste ? ajuste.porque : null,
      planilha: MESES.map((_, i) => centavos(row[PRIMEIRA_COLUNA + i] ?? null)),
    });
  }
  return linhas;
}

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL não definido — veja o README.");
const sql = postgres(url, { max: 1, connect_timeout: 20 });

try {
  const [entity] = await sql<{ id: string }[]>`select id from entities where slug = 'dd-group'`;
  if (!entity) throw new Error("entidade dd-group não encontrada");

  // O app precisa de um mês a mais: a hipótese defasada olha `app[mês seguinte]`, e para
  // julho isso é agosto.
  const doApp = await sql<{ code: string; mes: string; total: string }[]>`
    select c.code, substr(r.period::text, 6, 2) as mes, sum(r.amount)::text as total
      from recognition_entries r
      join categories c on c.id = r.category_id
     where r.entity_id = ${entity.id}
       and r.kind = 'cost'
       and r.period::text between '2026-01-01' and '2026-08-31'
     group by 1, 2`;

  const appPorCode = new Map<string, Map<string, Cents>>();
  for (const r of doApp) {
    const porMes = appPorCode.get(r.code) ?? new Map<string, Cents>();
    porMes.set(r.mes, fromNumeric(r.total));
    appPorCode.set(r.code, porMes);
  }
  const valorApp = (codes: string[], mes: string): Cents =>
    codes.reduce((a, code) => a + (appPorCode.get(code)?.get(mes) ?? 0n), 0n);

  // Duas linhas da planilha podem cair na mesma conta — `Alimentação` e `Travel Meals` são
  // as duas 9.03 (D106, confirmado pelo Andre). Comparadas em separado, cada uma leria o
  // mesmo valor do app e as duas pareceriam erradas. Somam-se antes de comparar.
  const linhas: Linha[] = [];
  for (const linha of lerPlanilha()) {
    const chave = linha.codes.join("+");
    const igual = chave === "" ? undefined : linhas.find((l) => l.codes.join("+") === chave);
    if (!igual) {
      linhas.push(linha);
      continue;
    }
    igual.rotulo = `${igual.rotulo} + ${linha.rotulo}`;
    igual.planilha = igual.planilha.map((v, i) => v + (linha.planilha[i] as Cents));
  }
  const soma = (v: Cents[]) => v.reduce((a, b) => a + b, 0n);

  console.log(`\n${BOLD}A DRE do app contra a sua, linha a linha${RESET}`);
  console.log(
    `${DIM}só o bloco de custo; imposto fora dos dois lados, porque a planilha o põe acima\n` +
      `do lucro bruto e o app dentro do custo (D101).${RESET}\n`,
  );
  console.log(
    `${DIM}${"linha".padEnd(26)}${"sua planilha".padStart(15)}${"o app".padStart(15)}` +
      `${"alinhado".padStart(11)}${"defasado".padStart(11)}${RESET}`,
  );

  let mesmaCoisa = 0;
  let sofremDefasagem = 0;
  const naoFecham: Linha[] = [];

  for (const linha of linhas) {
    const app = MESES.map((mes) => valorApp(linha.codes, mes));
    const appSeguinte = MESES.map((_, i) =>
      i + 1 < 8 ? valorApp(linha.codes, String(i + 2).padStart(2, "0")) : 0n,
    );

    const totalPlan = soma(linha.planilha);
    const totalApp = soma(app);
    if (totalPlan === 0n && totalApp === 0n) continue;

    const alinhado = linha.planilha.filter((v, i) => v === app[i]).length;
    const defasado = linha.planilha.filter((v, i) => v === appSeguinte[i]).length;

    if (linha.codes.length === 0) {
      console.log(
        `${linha.rotulo.padEnd(26)}${formatBRL(totalPlan).padStart(15)}` +
          `${"—".padStart(15)}${YELLOW}${"não comparável".padStart(22)}${RESET}`,
      );
      console.log(`  ${DIM}${linha.porque}${RESET}`);
      continue;
    }

    const melhor = defasado > alinhado ? "defasado" : alinhado > 0 ? "alinhado" : "nenhum";
    if (melhor === "defasado") sofremDefasagem += 1;
    else if (melhor === "alinhado") mesmaCoisa += 1;
    else naoFecham.push(linha);

    const cor = melhor === "nenhum" ? YELLOW : GREEN;
    console.log(
      `${linha.rotulo.padEnd(26)}${formatBRL(totalPlan).padStart(15)}` +
        `${formatBRL(totalApp).padStart(15)}` +
        `${cor}${`${alinhado}/7`.padStart(11)}${`${defasado}/7`.padStart(11)}${RESET}`,
    );
    if (linha.porque) console.log(`  ${DIM}${linha.porque}${RESET}`);

    if (DETALHE) {
      console.log(
        `  ${DIM}${NOMES.map((n, i) => `${n} ${formatBRL(linha.planilha[i] as Cents)} × ${formatBRL(app[i] as Cents)}`).join("\n  ")}${RESET}`,
      );
    }
  }

  console.log(`\n${BOLD}O que isso diz${RESET}`);
  console.log(`  ${sofremDefasagem} linha(s) fecham melhor ${BOLD}defasadas um mês${RESET}` +
    ` ${DIM}— os dois concordam sobre o dinheiro e discordam sobre a data${RESET}`);
  console.log(`  ${mesmaCoisa} linha(s) fecham melhor ${BOLD}alinhadas${RESET}`);
  console.log(
    `  ${naoFecham.length} linha(s) não fecham em nenhum dos dois` +
      `${naoFecham.length > 0 ? `: ${naoFecham.map((l) => l.rotulo).join(", ")}` : ""}`,
  );
  if (!DETALHE) console.log(`\n${DIM}--detalhe mostra o mês a mês de cada linha.${RESET}\n`);
} finally {
  await sql.end();
}
