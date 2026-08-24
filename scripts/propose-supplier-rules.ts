/**
 * Turns a decision the ledger already carries into a rule keyed on the document.
 *
 * The SISPAG lines (D96) print `PAGAMENTOS A FORNECEDORES` as their description — the
 * label of the batch, not the name of anyone. A rule on text cannot reach them and never
 * will: the supplier's name is simply not in the string. It is in `counterparty_tax_id`.
 *
 * But the ledger frequently already knows the answer. The same CNPJ also appears on lines
 * the bank *did* name — `BOLETO PAGO ATTENTIVE CO` — and those were categorised long ago
 * by a text rule read off the spreadsheet's cost block. So the account is not in doubt;
 * only the reach is. This promotes that settled account to a **document** rule, which is
 * the strong form of D40 and reaches the batch lines.
 *
 * Three guards, and the middle one is the whole reason this is safe to run:
 *
 *   - **Unanimous.** Every categorised line of that document *in that direction* must
 *     agree on one account. One dissent and it is reported, not used.
 *   - **Explained by an explicit rule.** Some rule a human wrote must already match those
 *     lines. Without this the script would happily launder the *history* layer's guesses
 *     into rules — a palpite wearing the clothes of a decision, which is exactly the line
 *     D97 drew and the mistake D83 paid for.
 *   - **Direction-scoped.** The rule carries `direction`, because a counterparty can sit
 *     on both sides of the counter. Ciclo is the case D99 was written about: one CNPJ that
 *     is a client on the way in and the contracted agency on the way out.
 *
 * It **proposes**. Nothing is written unless `--aplicar` is passed, and even then a rule
 * only produces a suggestion — it never approves anything by itself. Run `recategorize`
 * afterwards to carry it into the razão.
 *
 *   npm run propose:suppliers              # mostra o que faria
 *   npm run propose:suppliers -- --aplicar # grava as regras por documento
 */

import postgres from "postgres";
import { loadEnvLocal } from "./load-env.ts";
import { formatTaxId } from "@/lib/tax-id";

loadEnvLocal();

const APPLY = process.argv.includes("--aplicar");

const GREEN = "[32m";
const YELLOW = "[33m";
const RED = "[31m";
const BOLD = "[1m";
const DIM = "[2m";
const RESET = "[0m";

/**
 * A segunda via de evidência: a planilha prova a conta por **aritmética**.
 *
 * A primeira via — a de baixo — só promove o que o razão já decidiu. Ela não alcança o
 * fornecedor que **nunca** foi categorizado, porque não há nada a promover. Para esses
 * sobra a planilha, e sobra num sentido forte: quando uma linha do bloco de custo tem um
 * valor que só um pagamento do razão poderia ter produzido, a conta deixa de ser opinião.
 *
 * Cada entrada aqui foi conferida contra `DRE Geral` **por valor e por mês**, e o que a
 * conferência revelou é que a planilha lança por **competência, um mês à frente do caixa**
 * — o pagamento de fevereiro aparece em janeiro. O padrão apareceu duas vezes, sozinho, em
 * dois blocos que não se conhecem, e é ele que faz as contas fecharem ao centavo.
 *
 * Isto **não** é adivinhar identidade (D87): ninguém está sendo cadastrado como cliente por
 * semelhança de nome. É dizer em que conta do plano um pagamento cai, que é escrituração, e
 * a evidência é a própria planilha do Andre.
 */
const CONFIRMADOS: { taxId: string; code: string; why: string }[] = [
  {
    // `- Penalties & Settlements` vale 45.000,00 em fevereiro e 45.000,00 no ano inteiro.
    // No razão há um único pagamento à Maruri: 45.000,00 em 09/02/2026. Valor exato, mês
    // exato, e único dos dois lados. A Maruri ainda aparece na aba `Vendas e Perdas`, que
    // é onde um acordo com negócio perdido apareceria.
    taxId: "01220005000192",
    code: "11.03",
    why: "Penalties & Settlements: 45.000,00 em fev, único do ano dos dois lados",
  },
  {
    // `- Plano de Saude` é zero até junho e vale 2.702,37 em julho (e de novo em agosto,
    // que o razão ainda não alcança). Julho no razão: Bradesco 1.924,85 + Intermédica
    // 388,76 + 388,76 = 2.702,37. Ao centavo.
    taxId: "92693118000160",
    code: "6.06",
    why: "Plano de Saude: jul 2.702,37 = Bradesco 1.924,85 + Intermédica 2× 388,76",
  },
  {
    taxId: "44649812000138",
    code: "6.06",
    why: "Plano de Saude: compõe os 2.702,37 de julho com a Bradesco",
  },
  {
    // `- Seguro Saúde (estag)`, mês a mês, contra os boletos da Prudential, com a
    // defasagem de um mês: 25/05 R$ 51,02 → abril; 24/06 R$ 50,00 → maio; 26/07 R$ 50,00
    // → junho. Três de quatro ao centavo; o de 27/04 sai 51,06 contra 51,00, arredondamento
    // da própria planilha.
    taxId: "21986074000119",
    code: "6.07",
    why: "Seguro Saúde (estag): série mensal casa com defasagem de um mês, 3 de 4 ao centavo",
  },
  {
    // `- Juridico` vale 14.589,00 em janeiro e 5.000,00 em fevereiro. O caixa de fevereiro
    // soma 6.347,00 + 5.000,00 + 3.242,00 = 14.589,00, e o pagamento de março é 5.000,00 —
    // a mesma defasagem de um mês, ao centavo nos dois meses. O pagamento de janeiro
    // (5.000,00) é competência de dez/2025, fora desta planilha.
    taxId: "54606092000187",
    code: "8.02",
    why: "Juridico: caixa de fev soma 14.589,00 = janeiro da planilha, ao centavo",
  },
  {
    taxId: "00058442154",
    code: "8.02",
    why: "Juridico: os 6.347,00 compõem os 14.589,00 de fevereiro",
  },
];

type Candidate = {
  taxId: string;
  name: string;
  direction: "in" | "out";
  pending: number;
  pendingTotal: string;
  decided: number;
  codes: string[];
  code: string;
  categoryId: string;
  categoryName: string;
  explainedBy: string | null;
  hasDocRule: boolean;
};

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL não definido — veja o README.");
const sql = postgres(url, { max: 1, connect_timeout: 20 });

function mask(taxId: string): string {
  const formatted = formatTaxId(taxId);
  return `${"•".repeat(Math.max(formatted.length - 6, 0))}${formatted.slice(-6)}`;
}

const brl = (cents: string) =>
  Math.abs(Number(cents)).toLocaleString("pt-BR", { minimumFractionDigits: 2 });

try {
  const [entity] = await sql<{ id: string }[]>`
    select id from entities where slug = 'dd-group'`;
  if (!entity) throw new Error("entidade dd-group não encontrada — rode npm run db:seed");
  const entityId = entity.id;

  /**
   * Grouped by document **and direction**, never by name. Two spellings of one CNPJ are one
   * party; two directions of one CNPJ are two different questions.
   */
  const rows = await sql<Candidate[]>`
    with pendente as (
      select regexp_replace(counterparty_tax_id, '\\D', '', 'g') as tax_id,
             direction,
             count(*)::int  as pending,
             sum(amount)::text as pending_total,
             (array_agg(counterparty_name order by length(counterparty_name) desc))[1] as name
      from cash_entries
      where entity_id = ${entityId}
        and category_id is null
        and counterparty_tax_id is not null
        and counterparty_name is not null
      group by 1, 2
    ),
    decidido as (
      select regexp_replace(ce.counterparty_tax_id, '\\D', '', 'g') as tax_id,
             ce.direction,
             count(*)::int as decided,
             array_agg(distinct c.code) as codes
      from cash_entries ce
      join categories c on c.id = ce.category_id
      where ce.entity_id = ${entityId}
        and ce.counterparty_tax_id is not null
      group by 1, 2
    )
    select p.tax_id as "taxId", p.name, p.direction,
           p.pending, p.pending_total as "pendingTotal",
           coalesce(d.decided, 0) as decided,
           coalesce(d.codes, '{}') as codes
    from pendente p
    left join decidido d on d.tax_id = p.tax_id and d.direction = p.direction
    order by abs(p.pending_total::numeric) desc`;

  const categories = await sql<{ id: string; code: string; name: string }[]>`
    select id, code, name from categories where entity_id = ${entityId}`;
  const byCode = new Map(categories.map((c) => [c.code, c]));

  const ready: Candidate[] = [];
  const ambiguous: Candidate[] = [];
  const unexplained: Candidate[] = [];
  const unknown: Candidate[] = [];

  for (const row of rows) {
    const codes = row.codes ?? [];
    if (codes.length === 0) {
      unknown.push(row);
      continue;
    }
    if (codes.length > 1) {
      ambiguous.push(row);
      continue;
    }

    const code = codes[0]!;
    const category = byCode.get(code);
    if (!category) continue;

    // Already a document rule on this CNPJ? Then there is nothing to promote.
    const [existing] = await sql<{ n: number }[]>`
      select count(*)::int as n from categorization_rules
      where entity_id = ${entityId}
        and regexp_replace(counterparty_tax_id, '\\D', '', 'g') = ${row.taxId}`;
    if ((existing?.n ?? 0) > 0) continue;

    /**
     * The guard that keeps this out of circular reasoning: is the settled account the work
     * of a rule someone wrote, or just the history layer agreeing with itself?
     *
     * A text rule whose pattern appears in a *categorised* line of this document, landing
     * on this same account, is the evidence. Anything else and the account may well be
     * right — it is simply not this script's to promote.
     */
    const [explained] = await sql<{ pattern: string }[]>`
      select distinct r.pattern
      from categorization_rules r
      join categories c on c.id = r.category_id
      join cash_entries ce on ce.entity_id = ${entityId}
        and ce.category_id = c.id
        and ce.direction = ${row.direction}
        and regexp_replace(ce.counterparty_tax_id, '\\D', '', 'g') = ${row.taxId}
        and upper(ce.description) like '%' || upper(r.pattern) || '%'
      where r.entity_id = ${entityId}
        and r.counterparty_tax_id is null
        and r.active
        and c.code = ${code}
      limit 1`;

    const candidate: Candidate = {
      ...row,
      code,
      categoryId: category.id,
      categoryName: category.name,
      explainedBy: explained?.pattern ?? null,
      hasDocRule: false,
    };
    if (explained) ready.push(candidate);
    else unexplained.push(candidate);
  }

  /**
   * A segunda via, conferida contra o razão antes de aparecer. Uma entrada da tabela que
   * não encontra linha sem conta é entrada obsoleta — já foi resolvida por outro caminho —
   * e some do relatório sozinha, em vez de virar uma regra sobre nada.
   */
  const confirmed: (Candidate & { why: string })[] = [];
  for (const item of CONFIRMADOS) {
    const category = byCode.get(item.code);
    if (!category) {
      console.log(`${DIM}sem conta ${item.code} no plano — ${item.taxId} ignorado${RESET}`);
      continue;
    }

    const [existing] = await sql<{ n: number }[]>`
      select count(*)::int as n from categorization_rules
      where entity_id = ${entityId}
        and regexp_replace(counterparty_tax_id, '\\D', '', 'g') = ${item.taxId}`;
    if ((existing?.n ?? 0) > 0) continue;

    const [agg] = await sql<
      { name: string; direction: "in" | "out"; pending: number; pendingTotal: string }[]
    >`
      select (array_agg(counterparty_name order by length(counterparty_name) desc))[1] as name,
             direction,
             count(*)::int as pending,
             sum(amount)::text as "pendingTotal"
      from cash_entries
      where entity_id = ${entityId}
        and category_id is null
        and regexp_replace(counterparty_tax_id, '\\D', '', 'g') = ${item.taxId}
      group by direction`;
    if (!agg) continue;

    confirmed.push({
      taxId: item.taxId,
      name: agg.name,
      direction: agg.direction,
      pending: agg.pending,
      pendingTotal: agg.pendingTotal,
      decided: 0,
      codes: [item.code],
      code: item.code,
      categoryId: category.id,
      categoryName: category.name,
      explainedBy: null,
      hasDocRule: false,
      why: item.why,
    });
  }

  console.log(
    `\n${BOLD}${rows.length} pares documento+sentido ainda sem conta no razão${RESET}\n`,
  );

  if (confirmed.length > 0) {
    console.log(
      `${BOLD}a planilha prova a conta por aritmética — ${confirmed.length} documentos${RESET}`,
    );
    for (const c of confirmed) {
      console.log(
        `  ${GREEN}${String(c.pending).padStart(2)}${RESET} ${c.direction === "out" ? "saída  " : "entrada"} ` +
          `${brl(c.pendingTotal).padStart(11)}  ${c.name.slice(0, 38).padEnd(38)} ` +
          `${DIM}${mask(c.taxId)}${RESET}  → ${c.code} ${c.categoryName}`,
      );
      console.log(`      ${DIM}${c.why}${RESET}`);
    }
    const lines = confirmed.reduce((s, c) => s + c.pending, 0);
    const total = confirmed.reduce((s, c) => s + Math.abs(Number(c.pendingTotal)), 0);
    console.log(
      `\n  ${BOLD}${lines} linhas, R$ ${total.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}.${RESET}\n`,
    );
  }

  if (ready.length > 0) {
    console.log(
      `${BOLD}decisão já tomada, esperando alcance — ${ready.length} documentos${RESET}`,
    );
    for (const c of ready) {
      console.log(
        `  ${GREEN}${String(c.pending).padStart(2)}${RESET} ${c.direction === "out" ? "saída  " : "entrada"} ` +
          `${brl(c.pendingTotal).padStart(11)}  ${c.name.slice(0, 38).padEnd(38)} ` +
          `${DIM}${mask(c.taxId)}${RESET}  → ${c.code} ${c.categoryName}`,
      );
      console.log(
        `      ${DIM}${c.decided} linha(s) já nessa conta, pela regra “${c.explainedBy}”${RESET}`,
      );
    }
    const lines = ready.reduce((s, c) => s + c.pending, 0);
    const total = ready.reduce((s, c) => s + Math.abs(Number(c.pendingTotal)), 0);
    console.log(
      `\n${BOLD}${ready.length} regras por documento alcançariam ${lines} linhas, ` +
        `R$ ${total.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}.${RESET}`,
    );
  } else {
    console.log(`${DIM}nada a promover.${RESET}`);
  }

  if (unexplained.length > 0) {
    console.log(
      `\n${BOLD}${YELLOW}o razão concorda, mas nenhuma regra explica${RESET} ` +
        `${DIM}— pode ser palpite do histórico, então não promovo${RESET}`,
    );
    for (const c of unexplained) {
      console.log(
        `  ${String(c.pending).padStart(2)} ${c.direction === "out" ? "saída  " : "entrada"} ` +
          `${brl(c.pendingTotal).padStart(11)}  ${c.name.slice(0, 38).padEnd(38)} ${DIM}→ ${c.code}${RESET}`,
      );
    }
  }

  if (ambiguous.length > 0) {
    console.log(
      `\n${BOLD}${RED}o mesmo documento e sentido em duas contas${RESET} ${DIM}— é pergunta, não regra${RESET}`,
    );
    for (const c of ambiguous) {
      console.log(
        `  ${String(c.pending).padStart(2)} ${c.direction === "out" ? "saída  " : "entrada"} ` +
          `${brl(c.pendingTotal).padStart(11)}  ${c.name.slice(0, 38).padEnd(38)} ` +
          `${DIM}${c.codes.join(", ")}${RESET}`,
      );
    }
  }

  if (unknown.length > 0) {
    const lines = unknown.reduce((s, c) => s + c.pending, 0);
    const total = unknown.reduce((s, c) => s + Math.abs(Number(c.pendingTotal)), 0);
    console.log(
      `\n${DIM}${unknown.length} documentos o razão nunca viu categorizados — ` +
        `${lines} linhas, R$ ${total.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}. ` +
        `Esses são as perguntas do npm run decisoes.${RESET}`,
    );
  }

  if (!APPLY) {
    console.log(
      `\n${DIM}nada foi gravado. Rode com --aplicar para criar as regras, ` +
        `e depois npm run recategorize.${RESET}`,
    );
  } else {
    let created = 0;
    for (const c of [...confirmed, ...ready]) {
      // Priority 10, like every document rule: ahead of every text rule, which is D40.
      // The pattern `*` means "this counterparty, whatever the description says".
      await sql`
        insert into categorization_rules
          (entity_id, priority, match_type, pattern, counterparty_tax_id, direction,
           category_id, active)
        values (${entityId}, 10, 'contains', '*', ${c.taxId}, ${c.direction},
                ${c.categoryId}, true)`;
      created += 1;
    }
    console.log(
      `\n${GREEN}${created} regras por documento criadas.${RESET} ` +
        `Rode ${BOLD}npm run recategorize${RESET} para levá-las ao razão.`,
    );
  }
} finally {
  await sql.end();
}
