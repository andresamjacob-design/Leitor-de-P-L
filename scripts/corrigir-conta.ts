/**
 * Corrige a conta de lançamentos que já têm uma, e estão na errada (D119).
 *
 * ## O buraco que este script preenche
 *
 * O `recategorize` e o `propose:suppliers` **só preenchem lacuna**: os dois filtram
 * `category_id is null`. Isso é uma escolha certa — decidir por cima de uma decisão existente
 * é diferente de decidir onde não havia nada — e tem um efeito colateral: **uma linha
 * categorizada errada não tem ferramenta nenhuma.** Ela sobrevive a tudo.
 *
 * Dois casos apareceram na comparação com as planilhas (D114, D116), e nenhum é uma decisão
 * nova: os dois são decisão já tomada que não alcançou o razão.
 *
 * ## Por que a tabela é escrita, e não uma varredura
 *
 * A pergunta óbvia é *"por que não aplicar automaticamente toda regra explícita ao que
 * contradiz ela?"*. Porque isso foi medido, e o resultado assusta: **R$ 1.014.064,93 em
 * lançamentos contradizem alguma regra explícita por documento**, e quase tudo são os sócios
 * em `6.11`, que a D110 pôs lá de propósito. As regras que dizem `6.10` são as antigas, do
 * tempo em que a folha inteira era uma conta só.
 *
 * **Uma varredura automática teria desfeito a D110 inteira, em silêncio.** Regra explícita
 * não é prova de estar atualizada — é prova de que alguém decidiu aquilo *um dia*. A
 * diferença entre as duas coisas é o que este comentário existe para lembrar.
 *
 *   npm run corrigir              # dry run
 *   npm run corrigir -- --ensaio  # grava numa transação revertida e mede
 *   npm run corrigir -- --aplicar
 */

import postgres from "postgres";
import { loadEnvLocal } from "./load-env.ts";
import { formatBRL, fromNumeric, parseMoney, toNumeric, type Cents } from "@/lib/money";
import { planCashMirror } from "@/lib/recognition/mirror";
import { formatTaxId } from "@/lib/tax-id";
import type { CategoryKind } from "@/lib/ledger-types";
import type { IsoDate } from "@/lib/dates";

loadEnvLocal();

const APPLY = process.argv.includes("--aplicar");
const REHEARSE = process.argv.includes("--ensaio");

const GREEN = "\u001b[32m";
const YELLOW = "\u001b[33m";
const RED = "\u001b[31m";
const BOLD = "\u001b[1m";
const DIM = "\u001b[2m";
const RESET = "\u001b[0m";

const CORRECOES: readonly {
  /** Casa por CNPJ da contraparte, ou por descrição quando não há documento. */
  taxId?: string;
  /**
   * Trecho da descrição, para compra de cartão — que não traz CNPJ nenhum (D138). Casa com
   * `ilike %trecho%`, e a trava de quantidade e soma vale igual: se achar linha demais ou de
   * menos, nada se move.
   */
  descricao?: string;
  /**
   * O valor exato, quando a descrição sozinha não distingue.
   *
   * `PAGAMENTOS PIX QR-CODE` é o caso que obrigou a existir: casa com a Vai de Promo de
   * R$ 999,91 **e** com uma Tarefy de R$ 800 — as duas pagas por PIX QR-Code, as duas na
   * mesma conta errada pelo mesmo motivo. A trava de quantidade pegou isso antes de
   * qualquer escrita, que é para o que ela existe.
   */
  valor?: Cents;
  de: string;
  para: string;
  quantas: number;
  total: Cents;
  porque: string;
}[] = [
  {
    // A regra por documento diz **8.01** desde 24/08 (D104, resposta do Andre: *"Conex &
    // Result é contabilidade"*). Janeiro, fevereiro e março obedecem; abril a julho ficaram
    // em 6.10, categorizados pelo histórico do SISPAG **antes** da regra existir — e o
    // `recategorize` nunca voltou para eles porque eles já tinham conta.
    //
    // A planilha mede o estrago ao centavo: a linha `Contabilidade (Boleto)` do fluxo vale
    // R$ 2.400 em abril, maio e julho e R$ 3.450 em junho, e o app tinha exatamente
    // R$ 1.200 a menos **em cada um dos quatro meses**.
    taxId: "37380874000121",
    de: "6.10",
    para: "8.01",
    quantas: 4,
    total: parseMoney("4.800,00"),
    porque: "a regra do documento já diz 8.01; estas quatro são anteriores a ela",
  },
  {
    // A `- Viagem e evento (boleto)` da planilha vale R$ 26.507,94 em **abril** e zero nos
    // outros seis meses. O razão tem um único pagamento nessa ordem: R$ 26.507,93 à
    // `B.HUB - CORPORATE EVENTS` em 10/04, sentado em `6.10 Freelancers`. Mês exato, valor
    // exato a menos do centavo que a planilha arredonda, único dos dois lados — o padrão da
    // Maruri na D101. E o nome da contraparte diz o que ela é.
    taxId: "24568696000115",
    de: "6.10",
    para: "9.05",
    quantas: 1,
    total: parseMoney("26.507,93"),
    porque: "B.HUB é fornecedor de eventos; o app contava como folha de terceiros",
  },
  {
    // A sua planilha denunciou, e é prova melhor que o banco. A linha `Hotels` dela vale
    // R$ 14.332,08 e a do app valia R$ 13.282,14 — diferença de **R$ 1.049,94 ao centavo**,
    // que é esta compra.
    //
    // Ela tinha ido para Brindes por duas razões que se somaram e erraram juntas: o banco
    // classificou o ramo como `VESTUÁRIO` (D130) e o Andre respondeu que roupa é brinde
    // (D132). O credenciador descreve o lojista, não o gasto — e `HS` antes de `ANALIA FR`
    // é prefixo de hotel, não de loja. Quando ele disse "roupas são brindes", esta linha
    // não era roupa.
    descricao: "HS ANALIA FR",
    de: "10.02",
    para: "9.02",
    quantas: 1,
    total: parseMoney("1.049,94"),
    porque: "a linha Hotels da planilha bate ao centavo com esta compra; VESTUÁRIO era o ramo errado",
  },
  {
    // `PAGAMENTOS PIX QR-CODE` é descrição genérica, e o histórico casou com a Tarefy —
    // que também é paga por PIX QR-Code todo mês. As outras duas compras da Vai de Promo,
    // em 01/06, o banco nomeou (`VAI DE PROMO*PROMO`) e foram para 9.01 sozinhas.
    //
    // Vai para 9.01 junto delas. A planilha lança em `Travel · Outros (pix)`, que é
    // sub-linha diferente dentro do mesmo grupo — a distância do grupo fecha igual, e
    // escolher a conta que o próprio razão já usa para esse fornecedor vale mais que
    // espelhar a sub-linha dela.
    descricao: "PAGAMENTOS PIX QR-CODE",
    valor: parseMoney("999,91"),
    de: "7.08",
    para: "9.01",
    quantas: 1,
    total: parseMoney("999,91"),
    porque: "é a Vai de Promo; a Tarefy veio do histórico porque as duas pagam por PIX QR-Code",
  },
];

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL não definido — veja o README.");
const sql = postgres(url, { max: 1, connect_timeout: 20 });

const mask = (t: string) => {
  const f = formatTaxId(t);
  return `${"•".repeat(Math.max(f.length - 6, 0))}${f.slice(-6)}`;
};

type Linha = {
  id: string;
  occurredOn: IsoDate;
  competencePeriod: string | null;
  amount: Cents;
  direction: "in" | "out";
};
type Conta = { id: string; code: string; kind: CategoryKind };

/** Como a linha aparece no relatório: o documento mascarado, ou o trecho da descrição. */
const rotulo = (c: { taxId?: string; descricao?: string }) =>
  c.taxId ? mask(c.taxId) : `“${c.descricao}”`;

try {
  const [entity] = await sql<{ id: string }[]>`select id from entities where slug = 'dd-group'`;
  if (!entity) throw new Error("entidade dd-group não encontrada");

  const codes = [...new Set(CORRECOES.flatMap((c) => [c.de, c.para]))];
  const contas = await sql<Conta[]>`
    select id, code, kind from categories
     where entity_id = ${entity.id} and code = any(${codes})`;
  const byCode = new Map(contas.map((c) => [c.code, c]));
  for (const code of codes) if (!byCode.has(code)) throw new Error(`conta ${code} não encontrada`);

  console.log(`\n${BOLD}Lançamentos na conta errada${RESET}`);
  console.log(`${DIM}decisão já tomada que não alcançou o razão — não é decisão nova${RESET}\n`);

  const mover: { linha: Linha; para: Conta }[] = [];
  const recusas: string[] = [];

  for (const c of CORRECOES) {
    const de = byCode.get(c.de) as Conta;
    const para = byCode.get(c.para) as Conta;
    const achadas = await sql<Record<string, string | null>[]>`
      select id, occurred_on::text as "occurredOn",
             competence_period::text as "competencePeriod",
             amount::text as amount, direction
        from cash_entries
       where entity_id = ${entity.id}
         and category_id = ${de.id}
         and ${
           c.taxId
             ? sql`counterparty_tax_id = ${c.taxId}`
             : sql`description ilike ${"%" + (c.descricao ?? "") + "%"}`
         }
         ${c.valor === undefined ? sql`` : sql`and amount = ${toNumeric(c.valor)}`}
       order by occurred_on::text`;

    const soma = achadas.reduce((a, x) => a + fromNumeric(x.amount as string), 0n);
    if (achadas.length !== c.quantas || soma !== c.total) {
      recusas.push(
        `${rotulo(c)} ${c.de}→${c.para}: achei ${achadas.length} linha(s) somando ` +
          `${formatBRL(soma)}, esperava ${c.quantas} somando ${formatBRL(c.total)}. Nada movido.`,
      );
      console.log(
        `  ${YELLOW}${rotulo(c)}  ${c.de} → ${c.para}  ${achadas.length} linha(s), ${formatBRL(soma)} — recusado${RESET}`,
      );
      continue;
    }

    for (const a of achadas) {
      mover.push({
        linha: {
          id: a.id as string,
          occurredOn: a.occurredOn as IsoDate,
          competencePeriod: a.competencePeriod ?? null,
          amount: fromNumeric(a.amount as string),
          direction: a.direction as "in" | "out",
        },
        para,
      });
    }
    console.log(
      `  ${GREEN}${rotulo(c)}  ${c.de} → ${c.para}  ${c.quantas} linha(s), ${formatBRL(c.total)}${RESET}`,
    );
    console.log(`    ${DIM}${c.porque}${RESET}`);
  }

  console.log("");
  for (const r of recusas) console.log(`${YELLOW}recusado${RESET} ${r}\n`);

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

  // As duas correções trocam expense por expense, então o custo total não deve mudar — só a
  // linha em que ele aparece. É a conferência mais forte que este script tem.
  const previsto = 0n;

  if (mover.length === 0) {
    console.log(`${DIM}nada a corrigir.${RESET}\n`);
  } else if (!APPLY && !REHEARSE) {
    console.log(
      `${DIM}${mover.length} linha(s). As duas trocam despesa por despesa, então o custo total\n` +
        `não deve mudar — só a linha em que ele aparece.\n` +
        `nada foi gravado. Rode com --ensaio para medir, ou com --aplicar.${RESET}\n`,
    );
  } else {
    const write = async (db: postgres.TransactionSql) => {
      let trocados = 0;
      for (const m of mover) {
        await db`
          update cash_entries set category_id = ${m.para.id}, updated_at = now()
           where id = ${m.linha.id}`;
        await db`delete from recognition_entries where cash_entry_id = ${m.linha.id}`;
        const plano = planCashMirror({
          categoryId: m.para.id,
          categoryKind: m.para.kind,
          direction: m.linha.direction,
          occurredOn: m.linha.occurredOn,
          competencePeriod: m.linha.competencePeriod as never,
          amount: m.linha.amount,
        });
        if (plano) {
          await db`insert into recognition_entries ${db({
            entity_id: entity.id,
            period: plano.period,
            category_id: plano.categoryId,
            kind: plano.kind,
            amount: toNumeric(plano.amount),
            source: "cash_mirror",
            cash_entry_id: m.linha.id,
          })}`;
          trocados += 1;
        }
      }
      return { trocados, saldo: await saldoDe(db), custo: await custoDe(db) };
    };

    let out = { trocados: 0, saldo: saldoAntes, custo: custoAntes };
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
    const mudou = out.custo - custoAntes;
    console.log(`  ${mover.length} linha(s) corrigidas · ${out.trocados} espelho(s) refeitos`);
    console.log(
      moveu === 0n
        ? `  ${GREEN}o saldo não se moveu${RESET} ${DIM}— ${formatBRL(saldoAntes)}, antes e depois${RESET}`
        : `  ${RED}${BOLD}o saldo se moveu ${formatBRL(moveu)}${RESET}`,
    );
    console.log(
      mudou === previsto
        ? `  ${GREEN}o custo total não mudou${RESET} ${DIM}— só a linha em que ele aparece${RESET}`
        : `  ${RED}o custo mudou ${formatBRL(mudou)} e não devia mudar${RESET}`,
    );
    if (moveu !== 0n || mudou !== previsto) {
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
