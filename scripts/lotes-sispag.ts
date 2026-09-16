/**
 * Os últimos lotes SISPAG, nomeados pelo banco (D118).
 *
 * ## O que são
 *
 * A D96 abriu 34 lotes de `SISPAG FORNECEDORES` e decompôs R$ 1.221.679,97 em 116 pagamentos
 * com nome e documento. **Oito não tinham nome nem no PDF itemizado** — R$ 95.950. Três
 * deles se identificaram por aritmética na D110 (eram pró-labore e distribuição de sócio) e
 * cinco sobraram, R$ 19.700, dependendo do detalhe no internet banking.
 *
 * O Andre trouxe esse detalhe em 27/08/2026. Os cinco somam **exatamente R$ 19.700,00**.
 *
 * ## Por que estes vêm escritos em vez de derivados
 *
 * Um lote anônimo não tem contraparte: regra por documento não alcança, regra por texto lê
 * `PAGAMENTOS A FORNECEDORES` e o razão não tem nada a promover. A única fonte é o banco, e
 * ela chegou como uma lista. Escrever a lista é honesto; inferi-la seria adivinhar.
 *
 * ## Dois que o banco deixou ambíguos, e a medição resolveu
 *
 * Sobre o de R$ 10.000 o Andre escreveu *"aqui pode ser o pagamento do Aparecido Ribeiro
 * (João Beato) ou da Angela Nascimento"*. É a D109 de novo — medir quem **não pode** ser:
 *
 *   - **O Aparecido já tem R$ 10.000 nomeado em março** no razão. Se o lote fosse dele, ele
 *     teria recebido duas vezes no mesmo mês.
 *   - **A Angela tem fevereiro e abril e não tem março** — e a aba `Pessoas` diz que ela
 *     recebeu R$ 10.000 nos três.
 *
 * Sobra uma. E o mesmo teste confirma o João Ruocco: R$ 3.000 em fev e abr, **março
 * faltando**, e a planilha diz que havia.
 *
 * > Vale dizer o que **não** muda com a desambiguação: os dois caem em **6.10** de qualquer
 * > jeito. A escolha entre Aparecido e Angela move o nome, não a conta — então nenhum número
 * > deste script depende dela. Registrar isso é o que impede a próxima pessoa de achar que a
 * > contabilidade estava pendurada num palpite.
 *
 * ## Dois fechamentos que ninguém foi procurar
 *
 *   - **`Time - Freelancers` de janeiro vale R$ 3.500** na planilha de fluxo, e é
 *     Erick Nogueira (500) mais o Ricardo backend (3.000, D115). O lote de 20/01 completa a
 *     linha ao centavo.
 *   - **`Legal & Professional Fees` de janeiro vale R$ 10.000** e o razão só tinha R$ 5.000
 *     nomeados ao Danillo. O lote de 21/01 é exatamente a metade que faltava.
 *
 * ## As travas
 *
 *   - **Data e valor exatos, sem conta e sem documento**, e o número de candidatos tem de ser
 *     o declarado. Um lote que já ganhou dono não é tocado.
 *   - **O total tem de bater com R$ 19.700,00**, que é a soma que o banco entregou. Se a
 *     tabela deixar de somar isso, o script recusa antes de olhar o banco de dados — é o
 *     mesmo tipo de trava da D109, uma conferência que não depende de mim ter somado certo.
 *   - **O saldo não pode se mover.** Categorizar não move dinheiro.
 *   - **A contraparte continua vazia.** O banco mandou nomes, não documentos, e este projeto
 *     casa por documento (D40). Nome no `counterparty_name` viraria base para casamento
 *     automático depois, que é exatamente a armadilha da D100.
 *
 *   npm run lotes              # dry run
 *   npm run lotes -- --ensaio  # grava numa transação revertida e mede
 *   npm run lotes -- --aplicar
 */

import postgres from "postgres";
import { loadEnvLocal } from "./load-env.ts";
import { formatBRL, fromNumeric, parseMoney, toNumeric, type Cents } from "@/lib/money";
import { planCashMirror } from "@/lib/recognition/mirror";
import type { CategoryKind } from "@/lib/ledger-types";
import type { IsoDate } from "@/lib/dates";

loadEnvLocal();

const APPLY = process.argv.includes("--aplicar");
const REHEARSE = process.argv.includes("--ensaio");

const GREEN = "[32m";
const YELLOW = "[33m";
const RED = "[31m";
const BOLD = "[1m";
const DIM = "[2m";
const RESET = "[0m";

/** A soma que o banco entregou. Se a tabela não der isto, algo foi transcrito errado. */
const TOTAL = parseMoney("19.700,00");

const LOTES: readonly {
  data: IsoDate;
  valor: Cents;
  code: string;
  quem: string;
  porque: string;
}[] = [
  {
    data: "2026-01-20",
    valor: parseMoney("500,00"),
    code: "6.10",
    quem: "Erick Nogueira Alvarez",
    porque:
      "aba `Pessoas` linha 30, FREELANCER · Tableau, R$ 500 só em janeiro — e com o Ricardo " +
      "backend (3.000) fecha os R$ 3.500 de `Time - Freelancers` daquele mês",
  },
  {
    data: "2026-01-21",
    valor: parseMoney("5.000,00"),
    code: "8.02",
    quem: "Danillo Costa (advogado)",
    porque:
      "`Legal & Professional Fees` de janeiro vale R$ 10.000 e o razão só tinha R$ 5.000 " +
      "nomeados ao Danillo; este lote é a metade que faltava",
  },
  {
    data: "2026-02-05",
    valor: parseMoney("1.200,00"),
    code: "8.01",
    quem: "contabilidade",
    porque: "o banco nomeou como contabilidade",
  },
  {
    data: "2026-03-05",
    valor: parseMoney("10.000,00"),
    code: "6.10",
    quem: "Angela Nascimento Vaz",
    porque:
      "o banco deu Aparecido ou Angela; o Aparecido já tem R$ 10.000 nomeado em março e teria " +
      "recebido duas vezes, e é a Angela que tem fev e abr e não tem março (D109)",
  },
  {
    data: "2026-03-05",
    valor: parseMoney("3.000,00"),
    code: "6.10",
    quem: "João Ruocco",
    porque:
      "tem R$ 3.000 em fev e abr no razão e março faltando, e a aba `Pessoas` diz que havia",
  },
];

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL não definido — veja o README.");
const sql = postgres(url, { max: 1, connect_timeout: 20 });

type Linha = {
  id: string;
  occurredOn: IsoDate;
  competencePeriod: string | null;
  amount: Cents;
  direction: "in" | "out";
};
type Conta = { id: string; code: string; kind: CategoryKind };

try {
  const somaDeclarada = LOTES.reduce((a, l) => a + l.valor, 0n);
  if (somaDeclarada !== TOTAL) {
    throw new Error(
      `a tabela soma ${formatBRL(somaDeclarada)} e o banco entregou ${formatBRL(TOTAL)} — ` +
        `algo foi transcrito errado`,
    );
  }

  const [entity] = await sql<{ id: string }[]>`select id from entities where slug = 'dd-group'`;
  if (!entity) throw new Error("entidade dd-group não encontrada");

  const codes = [...new Set(LOTES.map((l) => l.code))];
  const contas = await sql<Conta[]>`
    select id, code, kind from categories
     where entity_id = ${entity.id} and code = any(${codes})`;
  const byCode = new Map(contas.map((c) => [c.code, c]));
  for (const code of codes) {
    if (!byCode.has(code)) throw new Error(`conta ${code} não encontrada`);
  }

  console.log(`\n${BOLD}Os últimos lotes SISPAG${RESET} ${DIM}nomeados pelo banco${RESET}\n`);

  const mover: { linha: Linha; para: Conta; quem: string }[] = [];
  const recusas: string[] = [];

  for (const lote of LOTES) {
    const conta = byCode.get(lote.code) as Conta;
    const achadas = await sql<Record<string, string | null>[]>`
      select id, occurred_on::text as "occurredOn",
             competence_period::text as "competencePeriod",
             amount::text as amount, direction
        from cash_entries
       where entity_id = ${entity.id}
         and occurred_on::text = ${lote.data}
         and amount::numeric = ${toNumeric(lote.valor)}
         and category_id is null
         and counterparty_tax_id is null`;

    if (achadas.length !== 1) {
      recusas.push(
        `${lote.data} × ${formatBRL(lote.valor)} (${lote.quem}): achei ${achadas.length} lote(s) ` +
          `sem conta e sem documento, esperava 1. Não movido.`,
      );
      console.log(
        `  ${YELLOW}${lote.data}  ${formatBRL(lote.valor).padStart(13)}  ${lote.quem} — ${achadas.length} candidato(s), recusado${RESET}`,
      );
      continue;
    }

    const a = achadas[0] as Record<string, string | null>;
    mover.push({
      linha: {
        id: a.id as string,
        occurredOn: a.occurredOn as IsoDate,
        competencePeriod: a.competencePeriod ?? null,
        amount: fromNumeric(a.amount as string),
        direction: a.direction as "in" | "out",
      },
      para: conta,
      quem: lote.quem,
    });
    console.log(
      `  ${GREEN}${lote.data}  ${formatBRL(lote.valor).padStart(13)} → ${lote.code}${RESET}  ${lote.quem}`,
    );
    console.log(`    ${DIM}${lote.porque}${RESET}`);
  }

  const total = mover.reduce((a, m) => a + m.linha.amount, 0n);
  console.log(`\n${BOLD}${mover.length} de ${LOTES.length} lotes · ${formatBRL(total)}${RESET}\n`);
  for (const r of recusas) console.log(`${YELLOW}recusado${RESET} ${r}`);
  if (recusas.length > 0) console.log("");

  const previsto = mover.reduce((acc, m) => {
    const plano = planCashMirror({
      categoryId: m.para.id,
      categoryKind: m.para.kind,
      direction: m.linha.direction,
      occurredOn: m.linha.occurredOn,
      competencePeriod: m.linha.competencePeriod as never,
      amount: m.linha.amount,
    });
    return acc + (plano ? plano.amount : 0n);
  }, 0n);

  // O caixa de verdade: abertura mais movimentos, só nas contas que guardam dinheiro (D-C).
  const saldoDe = async (db: postgres.TransactionSql | postgres.Sql) => {
    const [r] = await db<{ total: string }[]>`
      with caixa as (
        select id, opening_balance from accounts
         where entity_id = ${entity.id} and type in ('bank', 'cash', 'investment')
      )
      select (
        coalesce((select sum(opening_balance) from caixa), 0)
        + coalesce((select sum(case when direction = 'in' then amount else -amount end)
                      from cash_entries
                     where entity_id = ${entity.id} and account_id in (select id from caixa)), 0)
      )::text as total`;
    return fromNumeric(r?.total ?? "0");
  };
  const custoDe = async (db: postgres.TransactionSql | postgres.Sql) => {
    const [r] = await db<{ total: string }[]>`
      select coalesce(sum(amount), 0)::text as total from recognition_entries
       where entity_id = ${entity.id} and kind = 'cost'`;
    return fromNumeric(r?.total ?? "0");
  };

  const saldoAntes = await saldoDe(sql);
  const custoAntes = await custoDe(sql);

  if (mover.length === 0) {
    console.log(`${DIM}nada a mover.${RESET}\n`);
  } else if (!APPLY && !REHEARSE) {
    console.log(
      `${DIM}o custo deve subir ${formatBRL(previsto)}.\n` +
        `nada foi gravado. Rode com --ensaio para medir, ou com --aplicar para gravar.${RESET}\n`,
    );
  } else {
    const write = async (db: postgres.TransactionSql) => {
      let criados = 0;
      for (const m of mover) {
        await db`
          update cash_entries set category_id = ${m.para.id}, updated_at = now()
           where id = ${m.linha.id}`;
        const plano = planCashMirror({
          categoryId: m.para.id,
          categoryKind: m.para.kind,
          direction: m.linha.direction,
          occurredOn: m.linha.occurredOn,
          competencePeriod: m.linha.competencePeriod as never,
          amount: m.linha.amount,
        });
        if (!plano) continue;
        await db`insert into recognition_entries ${db({
          entity_id: entity.id,
          period: plano.period,
          category_id: plano.categoryId,
          kind: plano.kind,
          amount: toNumeric(plano.amount),
          source: "cash_mirror",
          cash_entry_id: m.linha.id,
        })}`;
        criados += 1;
      }
      return { criados, saldo: await saldoDe(db), custo: await custoDe(db) };
    };

    let out = { criados: 0, saldo: saldoAntes, custo: custoAntes };
    if (REHEARSE) {
      const ROLLBACK = Symbol("ensaio");
      try {
        await sql.begin(async (db) => {
          out = await write(db as postgres.TransactionSql);
          throw ROLLBACK;
        });
      } catch (error) {
        if (error !== ROLLBACK) throw error;
      }
      console.log(`${YELLOW}ensaio: gravado e revertido.${RESET}`);
    } else {
      out = await sql.begin(write);
      console.log(`${GREEN}aplicado.${RESET}`);
    }

    const moveu = out.saldo - saldoAntes;
    const subiu = out.custo - custoAntes;
    console.log(`  ${mover.length} lote(s) categorizados · ${out.criados} espelho(s) criados`);
    console.log(
      moveu === 0n
        ? `  ${GREEN}o saldo não se moveu${RESET} ${DIM}— ${formatBRL(saldoAntes)}, antes e depois${RESET}`
        : `  ${RED}${BOLD}o saldo se moveu ${formatBRL(moveu)}${RESET} — categorizar não pode fazer isso`,
    );
    console.log(
      subiu === previsto
        ? `  ${GREEN}o custo subiu ${formatBRL(subiu)}${RESET} ${DIM}— exatamente o previsto; o resultado cai o mesmo${RESET}`
        : `  ${RED}o custo subiu ${formatBRL(subiu)} e o previsto era ${formatBRL(previsto)}${RESET}`,
    );
    if (moveu !== 0n || subiu !== previsto) {
      console.log(`\n${RED}Grave: a conferência falhou. Confira antes de seguir.${RESET}\n`);
      process.exitCode = 1;
    } else {
      console.log(
        APPLY
          ? `\n${DIM}rode agora: npm run verify:rls e npm run verify:reconcile${RESET}\n`
          : `\n${DIM}nada foi gravado. Rode com --aplicar quando estiver satisfeito.${RESET}\n`,
      );
    }
  }
} finally {
  await sql.end();
}
