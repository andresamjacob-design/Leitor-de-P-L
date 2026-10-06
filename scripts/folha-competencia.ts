/**
 * A folha em competência, lida da aba `Colaboradores` (D120).
 *
 * ## O que mudou de premissa
 *
 * Até aqui a DRE do app tirava o custo de folha do **caixa**: o `planCashMirror` (D2a)
 * espelha cada pagamento no mês em que o dinheiro saiu. Isso serve para quase tudo e **não
 * serve para folha**, porque a DRE do Andre lança por competência — o trabalho de janeiro é
 * custo de janeiro, ainda que só seja pago em fevereiro.
 *
 * Medido, nem alinhado nem defasado fecha: o app erra R$ 163.652 em janeiro no mesmo mês e
 * R$ 15.156 em abril no mês anterior. Não existe um deslocamento único que sirva, porque
 * **cada pessoa tem o seu ritmo de pagamento**.
 *
 * O Andre escolheu o caminho em 27/08/2026: *"para esses meses que já foram, você faz lendo
 * e criando a partir da planilha que já está certa do jeito que construí"*.
 *
 * ## O desenho, e por que ele é o do projeto e não um atalho
 *
 * O sistema já tem **dois razões separados** (D2), e `recognition_entries` já aceita
 * `source = 'accrual'` — competência que não nasce do caixa. O `recognize:manual` já usa o
 * mesmo caminho para contratos de valor variável. A folha passa a entrar assim:
 *
 *   - **Competência**: uma linha por pessoa por mês, lida da `Colaboradores`, `accrual`.
 *   - **Caixa**: os pagamentos, exatamente como estão. Nenhum lançamento é tocado.
 *   - **A ponte (D85) nomeia a diferença** entre os dois, e ela passa a ser informação em
 *     vez de resíduo.
 *
 * **O espelho de caixa da folha tem de sair, ou o custo entra duas vezes.** É a única
 * escrita destrutiva aqui, e ela é reversível: reaplicar o `planCashMirror` a essas linhas
 * recria o que havia.
 *
 * ## A consequência que vale saber
 *
 * A DRE deixa de derivar do caixa para a folha. Se existir um pagamento que a
 * `Colaboradores` não tem — ou uma pessoa na planilha que nunca foi paga —, **os dois não
 * se cancelam**, e a ponte mostra isso em vez de esconder. É o comportamento que se quer:
 * antes, um pagamento a mais virava custo silenciosamente.
 *
 * ## As travas
 *
 *   - **A soma criada por mês tem de bater com a linha de total da própria aba**, ao
 *     centavo. As 58 linhas de pessoa somam exatamente o total nos sete meses, então esta
 *     trava não depende de eu ter somado certo — depende da planilha ser consistente
 *     consigo mesma, e ela é.
 *   - **Só os três sócios vão para `6.11`.** A `Colaboradores` os traz como `CUSTODIO`,
 *     `JACOB` e `LEONARDO`, sem colaborador nomeado, e são os mesmos rótulos que a D110 já
 *     usa. Todo o resto é time e vai para `6.10`.
 *   - **Nenhum `cash_entries` é tocado**, então o saldo não pode se mover. Se mover, é
 *     defeito.
 *   - **Roda só uma vez por período**: se já houver folha `accrual` no intervalo, o script
 *     recusa em vez de duplicar.
 *
 *   npm run folha              # dry run
 *   npm run folha -- --ensaio  # grava numa transação revertida e mede
 *   npm run folha -- --aplicar
 */

import { readFileSync } from "node:fs";
import postgres from "postgres";
import { loadEnvLocal } from "./load-env.ts";
import { readXlsx } from "@/lib/import/xlsx";
import { formatBRL, fromNumeric, toNumeric, type Cents } from "@/lib/money";

loadEnvLocal();

const APPLY = process.argv.includes("--aplicar");
const REHEARSE = process.argv.includes("--ensaio");

const GREEN = "\u001b[32m";
const YELLOW = "\u001b[33m";
const RED = "\u001b[31m";
const BOLD = "\u001b[1m";
const DIM = "\u001b[2m";
const RESET = "\u001b[0m";

const PLANILHA = "docs/reference/Claude de DRE - Dynamics Data 2026.xlsx";
/** `Janeiro` é a coluna 7 da aba `Colaboradores`; a linha 4 é a de totais. */
const PRIMEIRA_COLUNA = 7;
const LINHA_TOTAIS = 3;
const PRIMEIRA_PESSOA = 5;
const MESES = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07"];

/** Os três sócios, pelos rótulos que a própria aba usa (D110). */
const SOCIOS = new Set(["CUSTODIO", "JACOB", "LEONARDO"]);
const CONTA_TIME = "6.10";
const CONTA_SOCIO = "6.11";

const centavos = (bruto: unknown): Cents => {
  const t = String(bruto ?? "").trim();
  return t === "" ? 0n : BigInt(Math.round(Number(t) * 100));
};

type Lancamento = { periodo: string; code: string; quem: string; valor: Cents };

function lerFolha(): { linhas: Lancamento[]; totais: Cents[] } {
  const aba = readXlsx(readFileSync(PLANILHA)).find((s) => s.name === "Colaboradores");
  if (!aba) throw new Error("aba `Colaboradores` não encontrada");

  const totais = MESES.map((_, i) => centavos(aba.rows[LINHA_TOTAIS]?.[PRIMEIRA_COLUNA + i]));
  const linhas: Lancamento[] = [];

  for (let i = PRIMEIRA_PESSOA; i < aba.rows.length; i++) {
    const row = aba.rows[i] as (string | null)[] | undefined;
    if (!row) continue;
    // Só linhas com VÍNCULO preenchido são pessoa; o resto é cabeçalho repetido ou branco.
    if (String(row[0] ?? "").trim() === "") continue;

    const cliente = String(row[2] ?? "").trim();
    const colaborador = String(row[5] ?? "").trim();
    const socio = colaborador === "" && SOCIOS.has(cliente.toUpperCase());
    const quem = colaborador !== "" ? colaborador : cliente;

    MESES.forEach((periodo, j) => {
      const valor = centavos(row[PRIMEIRA_COLUNA + j]);
      if (valor === 0n) return;
      linhas.push({ periodo, code: socio ? CONTA_SOCIO : CONTA_TIME, quem, valor });
    });
  }
  return { linhas, totais };
}

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL não definido — veja o README.");
const sql = postgres(url, { max: 1, connect_timeout: 20 });

try {
  const [entity] = await sql<{ id: string }[]>`select id from entities where slug = 'dd-group'`;
  if (!entity) throw new Error("entidade dd-group não encontrada");

  const contas = await sql<{ id: string; code: string }[]>`
    select id, code from categories
     where entity_id = ${entity.id} and code in (${CONTA_TIME}, ${CONTA_SOCIO})`;
  const byCode = new Map(contas.map((c) => [c.code, c.id]));
  if (!byCode.has(CONTA_TIME) || !byCode.has(CONTA_SOCIO)) {
    throw new Error(`contas ${CONTA_TIME}/${CONTA_SOCIO} não encontradas`);
  }

  const { linhas, totais } = lerFolha();

  console.log(`\n${BOLD}A folha em competência, lida da aba \`Colaboradores\`${RESET}\n`);
  console.log(`${DIM}mês       vou criar          a aba declara${RESET}`);

  let tudoBate = true;
  MESES.forEach((periodo, i) => {
    const soma = linhas
      .filter((l) => l.periodo === periodo)
      .reduce((a, l) => a + l.valor, 0n);
    const total = totais[i] as Cents;
    const ok = soma === total;
    if (!ok) tudoBate = false;
    console.log(
      `${periodo}  ${formatBRL(soma).padStart(16)}  ${formatBRL(total).padStart(16)}` +
        `  ${ok ? `${GREEN}ok${RESET}` : `${RED}difere ${formatBRL(soma - total)}${RESET}`}`,
    );
  });

  if (!tudoBate) {
    throw new Error("a soma das pessoas não bate com a linha de totais da própria aba");
  }

  const totalGeral = linhas.reduce((a, l) => a + l.valor, 0n);
  const time = linhas.filter((l) => l.code === CONTA_TIME).reduce((a, l) => a + l.valor, 0n);
  const socios = totalGeral - time;
  console.log(
    `\n${BOLD}${linhas.length} linhas${RESET} · ${formatBRL(totalGeral)} ` +
      `${DIM}(${formatBRL(time)} em ${CONTA_TIME}, ${formatBRL(socios)} em ${CONTA_SOCIO})${RESET}`,
  );

  // ---- O que sai: os espelhos de caixa da folha -----------------------------
  const [espelhos] = await sql<{ n: number; total: string }[]>`
    select count(*)::int as n, coalesce(sum(r.amount), 0)::text as total
      from recognition_entries r
      join categories c on c.id = r.category_id
      join cash_entries e on e.id = r.cash_entry_id
     where r.entity_id = ${entity.id} and r.source = 'cash_mirror'
       and c.code in (${CONTA_TIME}, ${CONTA_SOCIO})
       and e.occurred_on::text between '2026-01-01' and '2026-07-31'`;
  const saiEspelho = fromNumeric(espelhos?.total ?? "0");
  console.log(
    `${DIM}saem ${espelhos?.n ?? 0} espelho(s) de caixa, ${formatBRL(saiEspelho)} — ` +
      `senão o custo entra duas vezes${RESET}`,
  );

  const [jaTem] = await sql<{ n: number }[]>`
    select count(*)::int as n from recognition_entries
     where entity_id = ${entity.id} and source = 'accrual'
       and period::text between '2026-01-01' and '2026-07-01'`;
  if ((jaTem?.n ?? 0) > 0) {
    console.log(
      `\n${RED}já existem ${jaTem?.n} linha(s) de folha \`accrual\` no período.${RESET} ` +
        `Apague-as antes de rodar de novo, ou o custo dobra.\n`,
    );
    process.exitCode = 1;
  } else {
    const previsto = totalGeral - saiEspelho;
    console.log(
      `${DIM}o custo deve ${previsto < 0n ? "cair" : "subir"} ` +
        `${formatBRL(previsto < 0n ? -previsto : previsto)}${RESET}\n`,
    );

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

    if (!APPLY && !REHEARSE) {
      console.log(
        `${DIM}nada foi gravado. Rode com --ensaio para medir numa transação revertida,\n` +
          `ou com --aplicar para gravar.${RESET}\n`,
      );
    } else {
      const write = async (db: postgres.TransactionSql) => {
        const apagados = await db`
          delete from recognition_entries r
           using categories c, cash_entries e
           where r.category_id = c.id and r.cash_entry_id = e.id
             and r.entity_id = ${entity.id} and r.source = 'cash_mirror'
             and c.code in (${CONTA_TIME}, ${CONTA_SOCIO})
             and e.occurred_on::text between '2026-01-01' and '2026-07-31'
           returning r.id`;

        for (const l of linhas) {
          await db`insert into recognition_entries ${db({
            entity_id: entity.id,
            period: `${l.periodo}-01`,
            category_id: byCode.get(l.code) as string,
            kind: "cost",
            amount: toNumeric(l.valor),
            source: "accrual",
          })}`;
        }
        return {
          apagados: apagados.length,
          criados: linhas.length,
          saldo: await saldoDe(db),
          custo: await custoDe(db),
        };
      };

      let out = { apagados: 0, criados: 0, saldo: saldoAntes, custo: custoAntes };
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
      console.log(`  ${out.criados} linha(s) de competência criadas · ${out.apagados} espelho(s) removidos`);
      console.log(
        moveu === 0n
          ? `  ${GREEN}o saldo não se moveu${RESET} ${DIM}— ${formatBRL(saldoAntes)}; nenhum lançamento de caixa foi tocado${RESET}`
          : `  ${RED}${BOLD}o saldo se moveu ${formatBRL(moveu)}${RESET} — este script não escreve em cash_entries`,
      );
      console.log(
        mudou === previsto
          ? `  ${GREEN}o custo mudou ${formatBRL(mudou)}${RESET} ${DIM}— exatamente o previsto${RESET}`
          : `  ${RED}o custo mudou ${formatBRL(mudou)} e o previsto era ${formatBRL(previsto)}${RESET}`,
      );
      if (moveu !== 0n || mudou !== previsto) {
        console.log(`\n${RED}Grave: a conferência falhou. Confira antes de seguir.${RESET}\n`);
        process.exitCode = 1;
      } else {
        console.log(
          APPLY
            ? `\n${DIM}rode agora: npm run verify:rls, npm run verify:reconcile e npm run comparar${RESET}\n`
            : `\n${DIM}nada foi gravado. Rode com --aplicar quando estiver satisfeito.${RESET}\n`,
        );
      }
    }
  }
} finally {
  await sql.end();
}
