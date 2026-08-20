/**
 * Aplica o motor de categorização ao que **já está no razão**.
 *
 * A D88 registrou o buraco: o motor só roda sobre `staged_transactions`, e o staging está
 * vazio porque tudo foi aprovado. Toda regra criada depois da aprovação é peso morto para
 * as linhas que já entraram — inclusive as 63 regras por documento que o Andre respondeu
 * uma a uma.
 *
 * Na primeira medição isso não valia a pena: o motor decidia 2% das linhas paradas, e os
 * 2% eram justamente as sugestões erradas que a D83 tinha acabado de corrigir. Duas coisas
 * mudaram desde então:
 *
 *   - **A D86 fechou o vazamento.** O histórico perdeu o direito de pôr entrada em conta de
 *     custo, então uma passada em massa não desfaz mais a D83.
 *   - **O SISPAG entrou itemizado** (D96). São 116 pagamentos com CPF/CNPJ onde antes havia
 *     34 lotes anônimos, e a maioria das contrapartes já é pessoa ou cliente cadastrado.
 *
 * **A separação que este script faz, e que é o ponto dele:**
 *
 *   - **Regra é decisão já tomada.** `rule_tax_id` e `rule_text` vêm de uma regra que
 *     alguém escreveu. Aplicar é entregar o que já foi decidido, não decidir.
 *   - **Histórico é inferência.** `history_tax_id` e `history_description` dizem "esse
 *     documento já foi categorizado assim antes". Costuma acertar, e foi exatamente o que
 *     errou na D83. Só entra com `--incluir-historico`, dito em voz alta.
 *
 * ⚠️ **Isto move a DRE.** Categorizar uma saída cria o espelho de competência (D2a), então
 * custo que hoje está só no caixa passa a pesar no resultado do mês. É o objetivo — mas por
 * isso o script mede o resultado antes e depois, e manda rodar o `verify:reconcile`.
 *
 *   npm run recategorize
 *   npm run recategorize -- --ensaio
 *   npm run recategorize -- --aplicar
 *   npm run recategorize -- --aplicar --incluir-historico
 */

import postgres from "postgres";
import { loadEnvLocal } from "./load-env.ts";
import { formatBRL, fromNumeric, parseMoney, toNumeric, type Cents } from "@/lib/money";
import { suggestCategory } from "@/lib/categorize/engine";
import type { EngineInput } from "@/lib/categorize/engine";
import type { Rule, Subject, Suggestion } from "@/lib/categorize/types";
import { planCashMirror } from "@/lib/recognition/mirror";
import type { CategoryKind } from "@/lib/ledger-types";

loadEnvLocal();

const APPLY = process.argv.includes("--aplicar");
const REHEARSE = process.argv.includes("--ensaio");
const WITH_HISTORY = process.argv.includes("--incluir-historico");

const GREEN = "[32m";
const YELLOW = "[33m";
const RED = "[31m";
const BOLD = "[1m";
const DIM = "[2m";
const RESET = "[0m";

/** As camadas que vêm de uma regra escrita por alguém. */
const FROM_RULE = new Set(["rule_tax_id", "rule_text"]);
const PAYROLL_CODE = "6.02";
const COST_KINDS: CategoryKind[] = ["cost", "expense", "tax"];
/** O outro lado da mesma trava: o histórico não põe saída em conta de receita (D99). */
const REVENUE_KINDS: CategoryKind[] = ["revenue"];

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL não definido — veja o README.");

const sql = postgres(url, { max: 1, connect_timeout: 20 });
const money = (v: string) => parseMoney(v, { decimalSeparator: "." });
const iso = (v: unknown) =>
  v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);

try {
  const [entity] = await sql<{ id: string }[]>`select id from entities where slug = 'dd-group'`;
  if (!entity) throw new Error("entidade dd-group não encontrada");

  const categories = await sql<{ id: string; code: string; name: string; kind: CategoryKind }[]>`
    select id, code, name, kind from categories where entity_id = ${entity.id}`;
  const byId = new Map(categories.map((c) => [c.id, c]));
  const costCategoryIds = new Set(
    categories.filter((c) => COST_KINDS.includes(c.kind)).map((c) => c.id),
  );
  const revenueCategoryIds = new Set(
    categories.filter((c) => REVENUE_KINDS.includes(c.kind)).map((c) => c.id),
  );

  const ruleRows = await sql<Record<string, string | number | boolean | null>[]>`
    select id, priority, match_type, pattern, counterparty_tax_id, direction,
           amount_min::text as amount_min, amount_max::text as amount_max,
           account_id, category_id, client_id, person_id, active, hit_count
    from categorization_rules where entity_id = ${entity.id}`;

  const rules: Rule[] = ruleRows.map((row) => ({
    id: row["id"] as string,
    priority: row["priority"] as number,
    matchType: row["match_type"] as Rule["matchType"],
    pattern: row["pattern"] as string,
    counterpartyTaxId: row["counterparty_tax_id"] as string | null,
    direction: row["direction"] as Rule["direction"],
    amountMin: row["amount_min"] === null ? null : money(row["amount_min"] as string),
    amountMax: row["amount_max"] === null ? null : money(row["amount_max"] as string),
    accountId: row["account_id"] as string | null,
    categoryId: row["category_id"] as string,
    clientId: row["client_id"] as string | null,
    personId: row["person_id"] as string | null,
    active: row["active"] as boolean,
    hitCount: row["hit_count"] as number,
  }));

  const people = await sql<{ id: string; name: string; taxId: string | null }[]>`
    select id, name, tax_id as "taxId" from people where entity_id = ${entity.id} and active`;

  const history = await sql<
    {
      description: string; counterpartyTaxId: string | null; categoryId: string;
      clientId: string | null; personId: string | null; occurredOn: string;
    }[]
  >`
    select description, counterparty_tax_id as "counterpartyTaxId",
           category_id as "categoryId", client_id as "clientId", person_id as "personId",
           occurred_on::text as "occurredOn"
    from cash_entries where entity_id = ${entity.id} and category_id is not null
    order by occurred_on desc limit 5000`;

  const input: EngineInput = {
    rules,
    history,
    people,
    payrollCategoryId: categories.find((c) => c.code === PAYROLL_CODE)?.id ?? null,
    costCategoryIds,
    revenueCategoryIds,
  };

  const pendentes = await sql<
    {
      id: string; description: string; amount: string; direction: "in" | "out";
      accountId: string; counterpartyTaxId: string | null; counterpartyName: string | null;
      occurred_on: Date; competence_period: Date | null;
    }[]
  >`
    select e.id, e.description, e.amount::text as amount, e.direction,
           e.account_id as "accountId", e.counterparty_tax_id as "counterpartyTaxId",
           e.counterparty_name as "counterpartyName", e.occurred_on, e.competence_period
    from cash_entries e
    where e.entity_id = ${entity.id} and e.category_id is null
    order by e.amount desc`;

  type Decision = {
    id: string;
    suggestion: Suggestion;
    magnitude: Cents;
    direction: "in" | "out";
    occurredOn: string;
    competencePeriod: string | null;
  };

  const decisions: Decision[] = [];
  for (const row of pendentes) {
    const amount = money(row.amount);
    const subject: Subject = {
      description: row.description,
      amount,
      direction: row.direction,
      accountId: row.accountId,
      counterpartyTaxId: row.counterpartyTaxId,
      counterpartyName: row.counterpartyName,
    };
    const suggestion = suggestCategory(subject, input);
    if (!suggestion) continue;
    decisions.push({
      id: row.id,
      suggestion,
      magnitude: amount < 0n ? -amount : amount,
      direction: row.direction,
      occurredOn: iso(row.occurred_on),
      competencePeriod: row.competence_period ? iso(row.competence_period) : null,
    });
  }

  const porRegra = decisions.filter((d) => FROM_RULE.has(d.suggestion.source));
  const porHistorico = decisions.filter((d) => !FROM_RULE.has(d.suggestion.source));
  const soma = (list: Decision[]) => list.reduce((a, d) => a + d.magnitude, 0n);

  console.log(`\n${BOLD}${pendentes.length} lançamentos sem conta no razão${RESET}\n`);
  console.log(
    `  ${GREEN}por regra${RESET}      ${String(porRegra.length).padStart(4)} linhas  ${formatBRL(soma(porRegra)).padStart(16)}  ${DIM}decisão já tomada${RESET}`,
  );
  console.log(
    `  ${YELLOW}por histórico${RESET}  ${String(porHistorico.length).padStart(4)} linhas  ${formatBRL(soma(porHistorico)).padStart(16)}  ${DIM}inferência — só com --incluir-historico${RESET}`,
  );
  console.log(
    `  ${DIM}sem decisão    ${String(pendentes.length - decisions.length).padStart(4)} linhas${RESET}`,
  );

  const escolhidas = WITH_HISTORY ? decisions : porRegra;

  const porConta = new Map<string, { n: number; total: Cents }>();
  for (const d of escolhidas) {
    const cur = porConta.get(d.suggestion.categoryId) ?? { n: 0, total: 0n };
    porConta.set(d.suggestion.categoryId, { n: cur.n + 1, total: cur.total + d.magnitude });
  }
  console.log(`\n${BOLD}contas que receberiam${RESET}`);
  for (const [id, v] of [...porConta].sort((a, b) => Number(b[1].total - a[1].total))) {
    const c = byId.get(id);
    console.log(
      `  ${(c ? `${c.code} ${c.name}` : id).padEnd(34)} ${String(v.n).padStart(4)} linhas  ${formatBRL(v.total).padStart(16)}`,
    );
  }

  async function resultado(db: postgres.Sql | postgres.TransactionSql): Promise<Cents> {
    const [row] = await db<{ total: string | null }[]>`
      select coalesce(sum(case when kind = 'revenue' then amount else -amount end), 0) as total
      from recognition_entries where entity_id = ${entity!.id}`;
    return fromNumeric(row?.total ?? "0");
  }

  const antes = await resultado(sql);

  if (escolhidas.length === 0) {
    console.log(`\n${DIM}nada a aplicar.${RESET}\n`);
  } else if (!APPLY && !REHEARSE) {
    console.log(
      `\n${DIM}nada foi gravado. Rode com --ensaio para medir, ou --aplicar.` +
        `${WITH_HISTORY ? "" : " Acrescente --incluir-historico para levar também a inferência."}${RESET}\n`,
    );
  } else {
    const write = async (db: postgres.TransactionSql) => {
      let espelhos = 0;
      for (const d of escolhidas) {
        await db`
          update cash_entries
          set category_id = ${d.suggestion.categoryId},
              client_id   = coalesce(${d.suggestion.clientId}, client_id),
              person_id   = coalesce(${d.suggestion.personId}, person_id)
          where id = ${d.id}`;

        // D2a: a saída de custo nasce com o espelho de competência. É o mesmo plano que a
        // tela usa — nada de regra paralela.
        const kind = byId.get(d.suggestion.categoryId)?.kind ?? null;
        const plan = planCashMirror({
          categoryId: d.suggestion.categoryId,
          categoryKind: kind,
          direction: d.direction,
          occurredOn: d.occurredOn,
          competencePeriod: d.competencePeriod,
          amount: d.magnitude,
        });
        if (!plan) continue;

        await db`insert into recognition_entries ${db({
          entity_id: entity!.id,
          period: plan.period,
          category_id: plan.categoryId,
          kind: plan.kind,
          amount: toNumeric(plan.amount),
          source: "cash_mirror",
          cash_entry_id: d.id,
          client_id: d.suggestion.clientId,
          person_id: d.suggestion.personId,
        })}`;
        espelhos += 1;
      }
      return { depois: await resultado(db), espelhos };
    };

    let out = { depois: antes, espelhos: 0 };
    if (REHEARSE) {
      const ROLLBACK = Symbol("ensaio");
      try {
        await sql.begin(async (db) => {
          out = await write(db);
          throw ROLLBACK;
        });
      } catch (error) {
        if (error !== ROLLBACK) throw error;
      }
    } else {
      out = await sql.begin(write);
    }

    console.log(
      `\n${BOLD}${REHEARSE ? "Ensaio (revertido)" : "Aplicado"}${RESET} — ` +
        `${escolhidas.length} lançamentos categorizados, ${out.espelhos} espelhos de competência criados.`,
    );
    console.log(`  resultado acumulado antes .... ${formatBRL(antes)}`);
    console.log(`  resultado acumulado depois ... ${formatBRL(out.depois)}`);
    console.log(
      `  ${YELLOW}o resultado caiu ${formatBRL(antes - out.depois)}${RESET} ${DIM}— é custo que estava só no caixa entrando na DRE${RESET}`,
    );
    if (!REHEARSE) {
      console.log(`\n${DIM}Rode ${RESET}npm run verify:reconcile${DIM} para confirmar que a ponte continua em zero.${RESET}\n`);
    } else {
      console.log("");
    }
  }
} finally {
  await sql.end();
}
