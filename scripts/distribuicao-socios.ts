/**
 * Separa distribuição de lucro, pró-labore e folha de terceiros (D110).
 *
 * ## O defeito
 *
 * O SISPAG entrega CPF e valor, nunca a natureza do pagamento. Quando a D96 abriu os lotes
 * e a D97 levou as 63 regras ao razão, **tudo o que os três sócios receberam caiu em
 * `6.10 Freelancers`** — conta de custo, dentro da DRE. Aquilo eram três coisas:
 *
 *   - **pró-labore**, que é salário e pertence à DRE — mas em `6.11`, não em `6.10`;
 *   - **distribuição de lucro**, que **não é despesa** e não pode pesar no resultado;
 *   - e, no caso do Custodio, o **salário de outra pessoa** paga pela conta dele (D104).
 *
 * O desenho para os dois primeiros existe desde a D24 e nunca foi usado: `99.04 Distribuição
 * de lucros` é `owner_draw`, grupo `socios`, e o `src/lib/pl.ts` já a põe **abaixo do
 * EBITDA** — *"pró-labore is payroll and lives in `pessoal`"*. As duas contas estavam vazias
 * porque, olhando um CPF, ninguém tinha como saber qual parte era qual.
 *
 * ## Como se sabe qual é qual
 *
 * O método é do Andre, em 26/08/2026: *"olha na aba pessoas da planilha do DRE, procura o
 * nome deles e lá tem o salário de cada; aí subtrai do valor total e você vai ter o total"*.
 *
 * A aba `Colaboradores` traz três linhas sem colaborador nomeado — `CUSTODIO`, `JACOB` e
 * `LEONARDO` —, que são o salário mensal de cada sócio. **Este script lê essas linhas**, em
 * vez de trazer os valores escritos à mão: número copiado é número que ninguém confere.
 *
 *     pró-labore do mês   = o que a `Colaboradores` diz
 *     distribuição do mês = o que o sócio recebeu − o pró-labore
 *
 * E a leitura se prova sozinha: pró-labore R$ 313.014,93 mais distribuição R$ 442.500,00 dão
 * **R$ 755.514,93**, que é a linha `Distribuição de Lucro` da aba `Summary` do fluxo de
 * caixa, ao centavo, nos sete meses. De março em diante a distribuição é **zero** — os
 * R$ 15.000 mensais são só pró-labore.
 *
 * ## Janeiro é declarado, e o resto é derivado
 *
 * Janeiro é o único mês em que o dinheiro **não** segue o documento: dois dos três
 * pró-labores e uma das distribuições saíram dentro de lotes SISPAG que não nomeiam
 * ninguém. Derivar isso seria adivinhar, então janeiro vem escrito, dito pelo Andre:
 *
 *     15000 + 15000 + 15000 + (92500 + 82500 + 46250)
 *
 * Os três primeiros são pró-labore; o que está entre parênteses é distribuição, e soma
 * R$ 221.250. **A repartição entre os sócios não é a mesma coisa que quem recebeu** — o
 * Custodio recebeu R$ 115.000 e R$ 22.500 daquilo é do Jacob. O razão registra quem
 * recebeu, que é o que o extrato prova; a repartição fica na planilha, onde ela vive.
 *
 * A prova de que a leitura dos lotes anônimos está certa não é a soma: é que o R$ 46.250 de
 * 09/01 **reaparece nomeado no Leonardo em 10/02**, pelo mesmo valor. O mês seguinte prova a
 * leitura do anterior.
 *
 * ## As travas, e por que cada uma existe
 *
 *   - **Um padrão de nome tem de resolver para um documento só, e ele tem de ser CPF.**
 *     A D100 pagou caro por casar contraparte com `ilike` e pegar o CPF de outra pessoa, e
 *     o handover avisa que *a pessoa Gabriel Sampaio Jacob tem CPF e a empresa homônima tem
 *     CNPJ* — sem esta trava o padrão pegaria as duas. O documento vem do extrato; nenhum
 *     CPF é digitado aqui, como em `vincular-clientes.ts`.
 *   - **A distribuição tem de casar com um lançamento exato, ou o script recusa.** Nada de
 *     escolher o subconjunto que dá quase certo. O que sobra do mês é pró-labore.
 *   - **Cada lote de janeiro tem de casar por data e valor e estar sem conta e sem
 *     documento**, e o número de candidatos tem de ser exatamente o declarado. Um lote que
 *     já tenha dono não é tocado.
 *   - **Os R$ 1.300 mensais no CPF do Custodio não são dele.** São o salário da Manuella
 *     Cipryano, que a aba `Pessoas` mostra recebendo exatamente isso de fev a jul e que o
 *     razão nunca traz com documento próprio (D104; confirmado pelo Andre em 26/08). Sem
 *     excluí-los, seis meses passariam a ter R$ 1.300 de "distribuição" que não existe.
 *   - **O espelho de competência é recalculado, não presumido.** O `recategorize` nunca
 *     precisou apagar espelho porque só toca em linha sem conta; aqui a linha **já tem** um.
 *     `planCashMirror` devolver `null` significa *apague o que existe* — e devolver um plano
 *     novo significa *troque*. Sem isso o custo continuaria na conta velha, em silêncio.
 *   - **A trava de saldo é condição de saída** (D109): mudar de conta não move dinheiro.
 *   - **O efeito no custo é calculado lançamento a lançamento**, a partir do que
 *     `planCashMirror` diz de cada conta, e conferido contra o que o banco devolve depois.
 *     Um total escrito à mão aqui seria o número decorativo que a D109 descreve.
 *
 *   npm run socios              # dry run: mostra o plano e a conferência
 *   npm run socios -- --ensaio  # grava numa transação revertida e mede
 *   npm run socios -- --aplicar
 */

import { readFileSync } from "node:fs";
import postgres from "postgres";
import { loadEnvLocal } from "./load-env.ts";
import { readXlsx } from "@/lib/import/xlsx";
import { formatBRL, fromNumeric, parseMoney, toNumeric, type Cents } from "@/lib/money";
import { formatTaxId } from "@/lib/tax-id";
import { planCashMirror } from "@/lib/recognition/mirror";
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

const PLANILHA = "docs/reference/Claude de DRE - Dynamics Data 2026.xlsx";
const DISTRIBUICAO = "99.04";
const PRO_LABORE = "6.11";
const ORIGEM = "6.10";
const DE = "2026-01-01";
const ATE = "2026-07-31";

/**
 * Os três sócios, nomeados pelo Andre. O `rotulo` é como a aba `Colaboradores` os chama;
 * `contraparte` é o padrão que acha as linhas no razão — e o documento sai de lá.
 */
const SOCIOS: readonly { rotulo: string; contraparte: string }[] = [
  { rotulo: "CUSTODIO", contraparte: "RICARDO DE CARVALHO CUSTODIO%" },
  { rotulo: "JACOB", contraparte: "GABRIEL SAMPAIO JACOB%" },
  { rotulo: "LEONARDO", contraparte: "LEONARDO SANCHES ALVES DE OLIVEIRA%" },
];

/** Pagamento que sai no CPF de um sócio e não é dele (D104). Fica em 6.10, onde já está. */
const DE_TERCEIRO: readonly { rotulo: string; valor: Cents; quem: string }[] = [
  { rotulo: "CUSTODIO", valor: parseMoney("1.300,00"), quem: "Manuella Cipryano" },
];

/**
 * Sócio cujo pró-labore daquele mês **não** saiu no documento dele. Sem isto, a subtração
 * acha que ele recebeu menos do que devia e recusa o mês inteiro.
 */
const PRO_LABORE_FORA: readonly { rotulo: string; mes: string; onde: string }[] = [
  { rotulo: "JACOB", mes: "01", onde: "lote SISPAG anônimo de 20/01" },
  { rotulo: "LEONARDO", mes: "01", onde: "lote SISPAG anônimo de 20/01" },
];

/** Os lotes de janeiro que não nomeiam ninguém, ditos pelo Andre em 26/08/2026. */
const JANEIRO: readonly {
  data: IsoDate;
  valor: Cents;
  quantos: number;
  code: string;
  porque: string;
}[] = [
  {
    data: "2026-01-09",
    valor: parseMoney("46.250,00"),
    quantos: 1,
    code: DISTRIBUICAO,
    porque: "distribuição do Leonardo — o mesmo valor reaparece nomeado nele em 10/02",
  },
  {
    data: "2026-01-20",
    valor: parseMoney("15.000,00"),
    quantos: 2,
    code: PRO_LABORE,
    porque: "pró-labore do Jacob e do Leonardo — os outros dois dos três 15.000 de janeiro",
  },
];

const MESES = ["01", "02", "03", "04", "05", "06", "07"] as const;

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL não definido — veja o README.");
const sql = postgres(url, { max: 1, connect_timeout: 20 });

const mask = (t: string) => {
  const f = formatTaxId(t);
  return `${"•".repeat(Math.max(f.length - 6, 0))}${f.slice(-6)}`;
};

/** Só os dígitos: CPF tem 11, CNPJ tem 14. */
const isCpf = (t: string) => t.replace(/\D/g, "").length === 11;

type Linha = {
  id: string;
  occurredOn: IsoDate;
  competencePeriod: string | null;
  amount: Cents;
  direction: "in" | "out";
};

type Conta = { id: string; code: string; kind: CategoryKind };

/** O que um lançamento pesa no custo estando naquela conta. Zero quando não espelha. */
function pesoNoCusto(linha: Linha, conta: Conta | null): Cents {
  if (!conta) return 0n;
  const plano = planCashMirror({
    categoryId: conta.id,
    categoryKind: conta.kind,
    direction: linha.direction,
    occurredOn: linha.occurredOn,
    competencePeriod: linha.competencePeriod as never,
    amount: linha.amount,
  });
  return plano ? plano.amount : 0n;
}

/** Pró-labore mensal de cada sócio, lido da aba `Colaboradores`. */
function lerProLabore(): Map<string, Map<string, Cents>> {
  const aba = readXlsx(readFileSync(PLANILHA)).find((s) => s.name === "Colaboradores");
  if (!aba) throw new Error("aba `Colaboradores` não encontrada na planilha da DRE");

  const porRotulo = new Map<string, Map<string, Cents>>();
  for (const { rotulo } of SOCIOS) {
    const linhas = aba.rows.filter(
      (r) => (r[2] ?? "").trim().toUpperCase() === rotulo && (r[5] ?? "").trim() === "",
    );
    if (linhas.length !== 1) {
      throw new Error(
        `a aba \`Colaboradores\` tem ${linhas.length} linhas para ${rotulo}; esperava exatamente 1`,
      );
    }
    const linha = linhas[0] as (string | null)[];
    const meses = new Map<string, Cents>();
    MESES.forEach((mes, i) => {
      const bruto = (linha[7 + i] ?? "").trim();
      if (bruto === "") return;
      // A planilha escreve número com ponto decimal; centavos são bigint (§7 do handover).
      meses.set(mes, BigInt(Math.round(Number(bruto) * 100)));
    });
    porRotulo.set(rotulo, meses);
  }
  return porRotulo;
}

try {
  const [entity] = await sql<{ id: string }[]>`select id from entities where slug = 'dd-group'`;
  if (!entity) throw new Error("entidade dd-group não encontrada");

  const contas = await sql<Conta[]>`
    select id, code, kind from categories
     where entity_id = ${entity.id} and code in (${ORIGEM}, ${DISTRIBUICAO}, ${PRO_LABORE})`;
  const byCode = new Map(contas.map((c) => [c.code, c]));
  const origem = byCode.get(ORIGEM);
  const distribuicao = byCode.get(DISTRIBUICAO);
  const proLabore = byCode.get(PRO_LABORE);
  if (!origem || !distribuicao || !proLabore) throw new Error("contas não encontradas");
  if (distribuicao.kind !== "owner_draw") {
    throw new Error(`${DISTRIBUICAO} deveria ser owner_draw e é ${distribuicao.kind}`);
  }

  const salarios = lerProLabore();

  console.log(`\n${BOLD}Distribuição de lucro, pró-labore e folha${RESET}`);
  console.log(
    `${DIM}pró-labore lido de \`Colaboradores\`; ${ORIGEM} → ${DISTRIBUICAO} (fora da DRE) e → ${PRO_LABORE}${RESET}\n`,
  );

  type Mover = { linha: Linha; de: Conta | null; para: Conta; porque: string };
  const mover: Mover[] = [];
  const recusas: string[] = [];

  const campos = `id, occurred_on::text as "occurredOn", competence_period::text as "competencePeriod",
                  amount::text as amount, direction`;

  for (const { rotulo, contraparte } of SOCIOS) {
    // O padrão acha as linhas; o documento sai do extrato e tem de ser um só, e CPF.
    const docs = await sql<{ doc: string }[]>`
      select distinct counterparty_tax_id as doc from cash_entries
       where entity_id = ${entity.id}
         and counterparty_name ilike ${contraparte}
         and counterparty_tax_id is not null`;
    const cpfs = docs.map((d) => d.doc).filter(isCpf);
    if (docs.length !== cpfs.length) {
      recusas.push(
        `${rotulo}: o padrão pegou ${docs.length} documentos e só ${cpfs.length} são CPF — ` +
          `é a empresa homônima entrando junto. Nada movido.`,
      );
      continue;
    }
    if (cpfs.length !== 1) {
      recusas.push(
        `${rotulo}: o padrão resolveu para ${cpfs.length} CPFs; esperava 1. Nada movido.`,
      );
      continue;
    }
    const doc = cpfs[0] as string;

    const brutas = await sql<Record<string, string>[]>`
      select id, occurred_on::text as "occurredOn",
             competence_period::text as "competencePeriod",
             amount::text as amount, direction
        from cash_entries
       where entity_id = ${entity.id}
         and counterparty_tax_id = ${doc}
         and category_id = ${origem.id}
         and occurred_on::text between ${DE} and ${ATE}
       order by occurred_on::text`;
    const tipadas: Linha[] = brutas.map((l) => ({
      id: l.id as string,
      occurredOn: l.occurredOn as IsoDate,
      competencePeriod: l.competencePeriod ?? null,
      amount: fromNumeric(l.amount as string),
      direction: l.direction as "in" | "out",
    }));

    const excluir = DE_TERCEIRO.filter((t) => t.rotulo === rotulo);
    const proprias = tipadas.filter((l) => !excluir.some((t) => t.valor === l.amount));
    const alheias = tipadas.length - proprias.length;

    console.log(`${BOLD}${rotulo}${RESET} ${DIM}${mask(doc)}${RESET}`);
    if (alheias > 0) {
      const t = excluir[0] as { valor: Cents; quem: string };
      console.log(
        `  ${DIM}${alheias} linha(s) de ${formatBRL(t.valor)} fora da conta: salário da ${t.quem}, paga por ele (D104)${RESET}`,
      );
    }

    for (const mes of MESES) {
      const doMes = proprias.filter((l) => l.occurredOn.slice(5, 7) === mes);
      const fora = PRO_LABORE_FORA.find((f) => f.rotulo === rotulo && f.mes === mes);
      const salario = fora ? 0n : (salarios.get(rotulo)?.get(mes) ?? 0n);
      if (doMes.length === 0) continue;

      const recebido = doMes.reduce(
        (a, l) => a + (l.direction === "out" ? l.amount : -l.amount),
        0n,
      );
      const dif = recebido - salario;

      if (fora) {
        console.log(`  ${DIM}2026-${mes}  pró-labore saiu no ${fora.onde}${RESET}`);
      }

      let distribuidas: Linha[] = [];
      if (dif > 0n) {
        // A distribuição tem de ser exatamente um lançamento, ou um par de estorno (D103):
        // duas saídas iguais e uma devolução, que juntas valem uma saída só.
        const exatos = doMes.filter((l) => l.amount === dif);
        const liquido = exatos.reduce(
          (a, l) => a + (l.direction === "out" ? l.amount : -l.amount),
          0n,
        );
        if (exatos.length === 0 || liquido !== dif) {
          recusas.push(
            `${rotulo} 2026-${mes}: a distribuição seria ${formatBRL(dif)} e nenhum lançamento ` +
              `(nem grupo de estorno) fecha nesse valor. Mês inteiro não movido.`,
          );
          console.log(
            `  ${YELLOW}2026-${mes}  ${formatBRL(dif)} sem lançamento exato — mês recusado${RESET}`,
          );
          continue;
        }
        distribuidas = exatos;
      } else if (dif < 0n) {
        // Recebeu menos que o pró-labore da planilha. Isso não torna o mês ilegível: quer
        // dizer que **não houve distribuição**, e tudo o que saiu é pró-labore. Junho do
        // Custodio cai aqui por R$ 0,07 — a planilha arredonda 14.598,93 para 14.599,00.
        // Tratar isso com tolerância seria pôr um limiar em cima de dinheiro; a leitura
        // certa dispensa limiar, porque a conclusão não depende do tamanho da diferença.
        console.log(
          `  ${DIM}2026-${mes}  recebeu ${formatBRL(recebido)}, pró-labore ${formatBRL(salario)} — ` +
            `${formatBRL(-dif)} a menos; sem distribuição${RESET}`,
        );
      }

      const naDistribuicao = new Set(distribuidas.map((l) => l.id));
      const proLaboreLinhas = doMes.filter((l) => !naDistribuicao.has(l.id));

      for (const l of distribuidas) {
        mover.push({ linha: l, de: origem, para: distribuicao, porque: "distribuição" });
      }
      for (const l of proLaboreLinhas) {
        mover.push({ linha: l, de: origem, para: proLabore, porque: "pró-labore" });
      }

      const somaPro = proLaboreLinhas.reduce(
        (a, l) => a + (l.direction === "out" ? l.amount : -l.amount),
        0n,
      );
      const partes = [
        distribuidas.length > 0
          ? `${GREEN}${formatBRL(dif)}${RESET}${DIM} → ${DISTRIBUICAO}${RESET}`
          : null,
        somaPro !== 0n ? `${formatBRL(somaPro)}${DIM} → ${PRO_LABORE}${RESET}` : null,
      ].filter(Boolean);
      console.log(`  2026-${mes}  ${partes.join(`${DIM} · ${RESET}`)}`);
    }
    console.log("");
  }

  // ---- Janeiro, declarado -------------------------------------------------
  console.log(`${BOLD}Lotes anônimos de janeiro${RESET} ${DIM}ditos pelo Andre${RESET}`);
  for (const lote of JANEIRO) {
    const conta = byCode.get(lote.code) as Conta;
    const achadas = await sql<Record<string, string>[]>`
      select id, occurred_on::text as "occurredOn",
             competence_period::text as "competencePeriod",
             amount::text as amount, direction
        from cash_entries
       where entity_id = ${entity.id}
         and occurred_on::text = ${lote.data}
         and amount::numeric = ${toNumeric(lote.valor)}
         and category_id is null
         and counterparty_tax_id is null`;
    if (achadas.length !== lote.quantos) {
      recusas.push(
        `lote de ${lote.data} × ${formatBRL(lote.valor)}: achei ${achadas.length} sem conta e ` +
          `sem documento, esperava ${lote.quantos}. Não movido.`,
      );
      console.log(
        `  ${YELLOW}${lote.data}  ${formatBRL(lote.valor)} × ${achadas.length} (esperava ${lote.quantos}) — recusado${RESET}`,
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
        de: null,
        para: conta,
        porque: lote.porque,
      });
    }
    console.log(
      `  ${GREEN}${lote.data}  ${formatBRL(lote.valor)} × ${lote.quantos} → ${lote.code}${RESET}` +
        `\n    ${DIM}${lote.porque}${RESET}`,
    );
  }
  console.log("");

  // ---- Plano e conferências ----------------------------------------------
  const previsto = mover.reduce(
    (a, m) => a + pesoNoCusto(m.linha, m.para) - pesoNoCusto(m.linha, m.de),
    0n,
  );
  const paraDistribuicao = mover
    .filter((m) => m.para.code === DISTRIBUICAO)
    .reduce((a, m) => a + (m.linha.direction === "out" ? m.linha.amount : -m.linha.amount), 0n);
  const paraProLabore = mover
    .filter((m) => m.para.code === PRO_LABORE)
    .reduce((a, m) => a + (m.linha.direction === "out" ? m.linha.amount : -m.linha.amount), 0n);

  console.log(
    `${BOLD}${mover.length} linha(s)${RESET}: ${formatBRL(paraDistribuicao)} para ${DISTRIBUICAO}, ` +
      `${formatBRL(paraProLabore)} para ${PRO_LABORE}.`,
  );
  console.log(
    previsto === 0n
      ? `${DIM}o custo não deve se mover${RESET}\n`
      : `${DIM}o custo deve ${previsto < 0n ? "cair" : "subir"} ${formatBRL(previsto < 0n ? -previsto : previsto)}${RESET}\n`,
  );

  for (const r of recusas) console.log(`${YELLOW}recusado${RESET} ${r}`);
  if (recusas.length > 0) console.log("");

  // O caixa de verdade: abertura mais movimentos, só nas contas que guardam dinheiro (D-C).
  // R$ 711.916,33 é o número que o handover declara — se sair outro, a consulta é que está
  // errada, não o banco (D109).
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
      `${DIM}nada foi gravado. Rode com --ensaio para medir numa transação revertida,\n` +
        `ou com --aplicar para gravar.${RESET}\n`,
    );
  } else {
    const write = async (db: postgres.TransactionSql) => {
      let movidas = 0;
      let apagados = 0;
      let criados = 0;
      for (const m of mover) {
        await db`
          update cash_entries
             set category_id = ${m.para.id}, updated_at = now()
           where id = ${m.linha.id}`;
        // O espelho velho sai sempre; o novo nasce só se a conta de destino espelhar.
        const fora = await db`
          delete from recognition_entries where cash_entry_id = ${m.linha.id} returning id`;
        apagados += fora.length;

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
          criados += 1;
        }
        movidas += 1;
      }
      return { movidas, apagados, criados, saldo: await saldoDe(db), custo: await custoDe(db) };
    };

    let out = {
      movidas: 0,
      apagados: 0,
      criados: 0,
      saldo: saldoAntes,
      custo: custoAntes,
    };
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
    console.log(
      `  ${out.movidas} linha(s) movidas · ${out.apagados} espelho(s) apagados · ${out.criados} criados`,
    );
    console.log(
      moveu === 0n
        ? `  ${GREEN}o saldo não se moveu${RESET} ${DIM}— ${formatBRL(saldoAntes)}, antes e depois${RESET}`
        : `  ${RED}${BOLD}o saldo se moveu ${formatBRL(moveu)}${RESET} — mudar de conta não pode fazer isso`,
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
          ? `\n${DIM}rode agora: npm run verify:rls e npm run verify:reconcile${RESET}\n`
          : `\n${DIM}nada foi gravado. Rode com --aplicar quando estiver satisfeito.${RESET}\n`,
      );
    }
  }
} finally {
  await sql.end();
}
