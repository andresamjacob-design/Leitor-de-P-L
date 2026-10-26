/**
 * Aprova as linhas paradas de uma importação, levando-as ao razão (D134).
 *
 * O último passo do caminho que o `import:extrato` começou. A tela faz isto desde sempre,
 * uma caixinha por vez; este script existe porque **82 linhas não são um trabalho de
 * caixinha**, e porque um `--ensaio` mostra o efeito no resultado antes de qualquer escrita.
 *
 * ## O que ele faz, e é o mesmo que a tela faz
 *
 * Insere em `cash_entries` **com o `dedup_hash` que já estava no staging** — recalcular aqui
 * perderia o índice de ocorrência (D78) e uma reimportação deixaria de reconhecer a linha. E
 * cria o **espelho de competência** pelo `planCashMirror`, a mesma função pura da tela: saída
 * de custo nasce com o espelho, ou a DRE nunca vê o gasto (D2a).
 *
 * ## O que ele recusa
 *
 * **Linha sem conta não entra.** É a trava que importa: 82 linhas sem categoria no razão
 * derrubariam a cobertura de 99,1% para 91%, e cada uma viraria trabalho de garimpo depois.
 * Rode `npm run preview:categorize -- --aplicar` antes — ele põe a sugestão do motor em cada
 * linha — e o que sobrar sem conta fica em staging, visível, esperando decisão.
 *
 * Isso é diferente da tela de propósito: lá um humano vê a linha e pode aprová-la em branco
 * sabendo o que faz. Um script não vê nada, então não recebe esse direito.
 *
 *   npm run aprovar                        # lista as importações com linha parada
 *   npm run aprovar -- --import <trecho>   # mostra o que faria
 *   npm run aprovar -- --import <trecho> --ensaio
 *   npm run aprovar -- --import <trecho> --aplicar
 */

import postgres, { type Sql } from "postgres";
import { loadEnvLocal } from "./load-env.ts";
import { formatBRL, fromNumeric, toNumeric } from "@/lib/money";
import { planCashMirror } from "@/lib/recognition/mirror";
import type { CategoryKind } from "@/lib/ledger-types";
import type { IsoDate } from "@/lib/dates";

loadEnvLocal();

const APPLY = process.argv.includes("--aplicar");
const REHEARSE = process.argv.includes("--ensaio");
const ONLY = (() => {
  const at = process.argv.indexOf("--import");
  return at >= 0 ? (process.argv[at + 1] ?? null) : null;
})();

const GREEN = "[32m";
const RED = "[31m";
const YELLOW = "[33m";
const BOLD = "[1m";
const DIM = "[2m";
const RESET = "[0m";

class Rollback extends Error {}

const sql = postgres(process.env.DATABASE_URL as string, { max: 1, connect_timeout: 20 });

try {
  const [entity] = await sql<{ id: string }[]>`select id from entities where slug = 'dd-group'`;
  if (!entity) throw new Error("entidade dd-group não encontrada");
  const entityId = entity.id;

  const [user] = await sql<{ id: string }[]>`
    select user_id as id from user_entities where entity_id = ${entityId} limit 1`;
  const userId = user?.id ?? null;

  const imports = await sql<
    { id: string; filename: string; accountId: string; pendentes: number }[]
  >`
    select si.id, si.filename, si.account_id as "accountId",
           count(st.id) filter (where st.status = 'pending')::int as pendentes
      from statement_imports si
      left join staged_transactions st on st.import_id = si.id
     where si.entity_id = ${entityId}
     group by si.id, si.filename, si.account_id
    having count(st.id) filter (where st.status = 'pending') > 0
     order by si.created_at desc`;

  console.log(`\n${BOLD}${imports.length} importação(ões) com linha parada${RESET}\n`);
  for (const i of imports) {
    const escolhida = ONLY !== null && i.filename.includes(ONLY);
    console.log(
      `  ${i.filename.slice(0, 46).padEnd(46)} ${String(i.pendentes).padStart(3)} linha(s)  ` +
        `${escolhida ? `${GREEN}escolhida${RESET}` : `${DIM}não escolhida${RESET}`}`,
    );
  }

  const alvo = imports.find((i) => ONLY !== null && i.filename.includes(ONLY));
  if (!alvo) {
    console.log(`\n${DIM}nenhuma escolhida. Use --import <trecho do nome>.${RESET}\n`);
  } else {
    const linhas = await sql<
      {
        id: string; occurredOn: string; description: string; amount: string;
        categoryId: string | null; kind: string | null; code: string | null;
        clientId: string | null; personId: string | null;
        counterpartyName: string | null; counterpartyTaxId: string | null;
        installmentCurrent: number | null; installmentTotal: number | null;
        dedupHash: string;
      }[]
    >`
      select st.id, st.occurred_on::text as "occurredOn", st.description, st.amount::text as amount,
             st.suggested_category_id as "categoryId", c.kind::text as kind, c.code,
             st.suggested_client_id as "clientId", st.suggested_person_id as "personId",
             st.counterparty_name as "counterpartyName", st.counterparty_tax_id as "counterpartyTaxId",
             st.installment_current as "installmentCurrent", st.installment_total as "installmentTotal",
             st.dedup_hash as "dedupHash"
        from staged_transactions st
        left join categories c on c.id = st.suggested_category_id
       where st.import_id = ${alvo.id} and st.status = 'pending'
       order by st.occurred_on`;

    const comConta = linhas.filter((l) => l.categoryId !== null);
    const semConta = linhas.filter((l) => l.categoryId === null);

    console.log(
      `\n${BOLD}${comConta.length} linha(s) com conta entram no razão${RESET}` +
        `${semConta.length > 0 ? `, ${YELLOW}${semConta.length} sem conta ficam paradas${RESET}` : ""}.`,
    );
    for (const l of semConta) {
      console.log(
        `  ${DIM}fica:${RESET} ${l.occurredOn} ${formatBRL(fromNumeric(l.amount)).padStart(13)} ` +
          `${l.description.slice(0, 32)}`,
      );
    }

    async function write(db: Sql): Promise<{ entradas: number; espelhos: number }> {
      let entradas = 0;
      let espelhos = 0;

      for (const l of comConta) {
        const assinado = fromNumeric(l.amount);
        const magnitude = assinado < 0n ? -assinado : assinado;
        const direction = assinado < 0n ? "out" : "in";

        const [row] = await db<{ id: string }[]>`
          insert into cash_entries ${db({
            entity_id: entityId,
            account_id: alvo!.accountId,
            occurred_on: l.occurredOn,
            amount: toNumeric(magnitude),
            direction,
            description: l.description,
            category_id: l.categoryId,
            client_id: l.clientId,
            person_id: l.personId,
            counterparty_name: l.counterpartyName,
            counterparty_tax_id: l.counterpartyTaxId,
            installment_current: l.installmentCurrent,
            installment_total: l.installmentTotal,
            // O razão guarda exatamente o hash que foi preparado: recalcular aqui perderia
            // o índice de ocorrência e a reimportação deixaria de reconhecer a linha (D78).
            dedup_hash: l.dedupHash,
            import_id: alvo!.id,
            created_by: userId,
          })} returning id`;
        if (!row) throw new Error(`não foi possível criar o lançamento de ${l.description}`);
        entradas += 1;

        const plan = planCashMirror({
          categoryId: l.categoryId!,
          categoryKind: (l.kind as CategoryKind | null) ?? null,
          direction,
          occurredOn: l.occurredOn as IsoDate,
          competencePeriod: null,
          amount: magnitude,
        });
        if (plan) {
          await db`insert into recognition_entries ${db({
            entity_id: entityId,
            period: plan.period,
            category_id: plan.categoryId,
            kind: plan.kind,
            amount: toNumeric(plan.amount),
            source: "cash_mirror",
            cash_entry_id: row.id,
            client_id: l.clientId,
            person_id: l.personId,
          })}`;
          espelhos += 1;
        }

        await db`update staged_transactions set status = 'approved' where id = ${l.id}`;
      }

      return { entradas, espelhos };
    }

    if (comConta.length === 0) {
      console.log(`\n${RED}nenhuma linha tem conta — rode o preview:categorize antes.${RESET}\n`);
    } else if (!APPLY && !REHEARSE) {
      console.log(
        `\n${DIM}nada foi gravado. Rode com --ensaio para ensaiar numa transação revertida, ` +
          `ou --aplicar para aprovar.${RESET}\n`,
      );
    } else {
      const done = await (REHEARSE
        ? sql
            .begin(async (tx) => {
              const counts = await write(tx as unknown as Sql);
              throw new Rollback(JSON.stringify(counts));
            })
            .catch((error: unknown) => {
              if (error instanceof Rollback) {
                return JSON.parse(error.message) as { entradas: number; espelhos: number };
              }
              throw error;
            })
        : write(sql));

      console.log(
        `\n${GREEN}${done.entradas} lançamento(s) ${REHEARSE ? "entrariam" : "entraram"} no razão` +
          `${RESET}, ${done.espelhos} espelho(s) de competência.`,
      );
      if (REHEARSE) console.log(`${DIM}ensaio: a transação foi revertida, nada foi gravado.${RESET}\n`);
      else console.log(`${DIM}Rode npm run verify:reconcile para confirmar a ponte.${RESET}\n`);
    }
  }
} finally {
  await sql.end();
}
