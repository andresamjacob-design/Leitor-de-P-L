/**
 * Põe os contratos do app em dia com a receita da DRE do Andre, de um mês em diante (D162).
 *
 * O Andre em 15/10 escolheu que a receita da DRE nasce dos **contratos no app**. Os contratos
 * vieram da planilha em agosto, e a planilha mudou depois: contrato novo (o `propose:contracts`
 * cria), valor que mudou e contrato que acabou. Este script cuida dos dois últimos.
 *
 * A regra é uma só, e vale só **do mês de corte em diante** — o passado já reconhecido não
 * muda (SPEC §9, "nunca retroativo"):
 *
 *   - contrato `manual`: os meses a partir do corte passam a ser os da planilha
 *     (`contract_items`), e nada antes dele muda;
 *   - contrato de valor fixo que difere: **aditivo** (D13) a partir do corte, `manual`, com os
 *     meses da planilha — sem nenhum mês, o aditivo encerra o contrato no mês anterior;
 *   - linha da planilha sem contrato de mesmo nome e tipo: contrato novo.
 *
 * A planilha tem a mesma linha nos dois blocos (DD e GSJACOB) às vezes; as linhas de mesmo
 * nome e tipo somam, porque o app tem um contrato só (D144). Diferença antes do corte é só
 * listada.
 *
 * `--encerrar "Eskala;Audens (valor cliente)"`: contratos que saíram da planilha e o Andre
 * confirmou que acabaram — aditivo vazio a partir do corte, e a receita já reconhecida do corte
 * em diante é removida.
 *
 *   npm run contratos:sincronizar -- --planilha <DRE.xlsx> --desde 2026-09
 *   ... --ensaio | --aplicar
 */

import { readFileSync } from "node:fs";
import postgres from "postgres";
import { loadEnvLocal } from "./load-env.ts";
import { readXlsx } from "@/lib/import/xlsx";
import { lastDayOf, lerContratosDaDre, MONTH_NAMES, pad, YEAR } from "@/lib/contratos-da-planilha";
import { planContract } from "@/lib/recognition/engine";
import { formatBRL, fromNumeric, toNumeric, type Cents } from "@/lib/money";

loadEnvLocal();

const arg = (nome: string) => {
  const i = process.argv.indexOf(nome);
  return i === -1 ? undefined : process.argv[i + 1];
};
const APPLY = process.argv.includes("--aplicar");
const REHEARSE = process.argv.includes("--ensaio");
const planilha = arg("--planilha");
const desde = arg("--desde");
if (!planilha || !desde || !/^\d{4}-(0[1-9]|1[0-2])$/.test(desde)) {
  throw new Error("uso: --planilha <DRE.xlsx> --desde AAAA-MM [--ensaio|--aplicar]");
}
const CORTE = Number(desde.slice(5, 7)) - 1;
const encerrar = new Set((arg("--encerrar") ?? "").split(";").map((n) => n.trim().toLowerCase()).filter(Boolean));

class Rollback extends Error {}
const iso = (d: unknown) => (d ? (d instanceof Date ? d.toISOString().slice(0, 10) : String(d)) : null);

const dre = readXlsx(new Uint8Array(readFileSync(planilha))).find((s) => s.name === "DRE Geral");
if (!dre) throw new Error("aba “DRE Geral” não encontrada");
const { drafts } = lerContratosDaDre(dre.rows);

// Mesmo nome e tipo nos dois blocos: um contrato só, os meses somados.
const linhas = new Map<string, (typeof drafts)[number]>();
for (const d of drafts) {
  const k = `${d.label.toLowerCase()}|${d.type}`;
  const ja = linhas.get(k);
  if (!ja) linhas.set(k, { ...d, months: [...d.months] });
  else ja.months = ja.months.map((v, i) => ((v ?? 0n) + (d.months[i] ?? 0n)) || null);
}

const sql = postgres(process.env.DATABASE_URL as string, { max: 1, connect_timeout: 20 });

type Acao =
  | { tipo: "itens"; nome: string; contratoId: string; meses: (Cents | null)[] }
  | { tipo: "aditivo"; nome: string; contrato: Record<string, unknown>; meses: (Cents | null)[] }
  | { tipo: "novo"; nome: string; draft: (typeof drafts)[number] };

try {
  const [entity] = await sql<{ id: string }[]>`select id from entities where slug = 'dd-group'`;
  const entityId = entity!.id;
  const contratos = await sql<Record<string, unknown>[]>`
    select * from contracts where entity_id = ${entityId} and superseded_at is null`;

  const acoes: Acao[] = [];
  const passado: string[] = [];
  for (const nome of encerrar) {
    const c = contratos.find((x) => String(x.name).toLowerCase() === nome);
    if (!c) throw new Error(`--encerrar: contrato "${nome}" não encontrado`);
    acoes.push({ tipo: "aditivo", nome: String(c.name), contrato: c, meses: Array(12).fill(null) });
  }

  for (const d of linhas.values()) {
    const c = contratos.find((x) => String(x.name).toLowerCase() === d.label.toLowerCase() && x.type === d.type);
    const daPlanilha = d.months.map((v) => v ?? 0n);
    if (!c) {
      if (daPlanilha.slice(CORTE).some((v) => v > 0n)) acoes.push({ tipo: "novo", nome: d.label, draft: d });
      continue;
    }
    const doApp: Cents[] = Array(12).fill(0n);
    if (c.recognition_method === "manual") {
      for (const it of await sql<{ description: string; v: string }[]>`
        select description, value::text as v from contract_items where contract_id = ${c.id as string}`) {
        const m = MONTH_NAMES.findIndex((n) => it.description.startsWith(n));
        if (m >= 0) doApp[m] = (doApp[m] ?? 0n) + fromNumeric(it.v);
      }
    } else {
      const plano = planContract(
        {
          id: String(c.id), clientId: String(c.client_id), categoryId: "x",
          type: c.type as "retainer" | "project", status: c.status as "active",
          totalValue: c.total_value === null ? null : fromNumeric(String(c.total_value)),
          monthlyValue: c.monthly_value === null ? null : fromNumeric(String(c.monthly_value)),
          startDate: iso(c.start_date), endDate: iso(c.end_date),
          recognitionMethod: c.recognition_method as "straight_line",
          prorateFirstLastMonth: Boolean(c.prorate_first_last_month), isIntercompany: Boolean(c.is_intercompany),
        },
        { through: `${YEAR}-12-01`, pocReports: [] },
      );
      for (const r of plano.rows) {
        const m = Number(r.period.slice(5, 7)) - 1;
        doApp[m] = (doApp[m] ?? 0n) + r.amount;
      }
    }
    const antes = daPlanilha.slice(0, CORTE).some((v, i) => v !== doApp[i]);
    const depois = daPlanilha.slice(CORTE).some((v, i) => v !== doApp[CORTE + i]);
    if (antes) passado.push(d.label);
    if (!depois) continue;
    acoes.push(
      c.recognition_method === "manual"
        ? { tipo: "itens", nome: d.label, contratoId: String(c.id), meses: d.months }
        : { tipo: "aditivo", nome: d.label, contrato: c, meses: d.months },
    );
  }

  const mostrar = (m: (Cents | null)[]) =>
    m.slice(CORTE).map((v, i) => `${MONTH_NAMES[CORTE + i]!.slice(0, 3)} ${v ? formatBRL(v) : "—"}`).join(" · ");
  console.log(`\nContratos a partir de ${desde}:\n`);
  for (const a of acoes) {
    const meses = a.tipo === "novo" ? a.draft.months : a.meses;
    const rotulo = a.tipo === "novo" ? "novo     " : a.tipo === "aditivo" ? "aditivo  " : "meses    ";
    console.log(`  ${rotulo} ${a.nome.slice(0, 30).padEnd(30)} ${mostrar(meses)}`);
  }
  if (passado.length) console.log(`\n  antes de ${desde}, diferente e não mexido: ${passado.join(", ")}`);

  const write = async (db: postgres.TransactionSql) => {
    const clientes = await db<{ id: string; name: string }[]>`select id, name from clients where entity_id = ${entityId}`;
    for (const a of acoes) {
      if (a.tipo === "itens") {
        for (let m = CORTE; m < 12; m++) {
          await db`delete from contract_items where contract_id = ${a.contratoId} and description = ${`${MONTH_NAMES[m]}/${YEAR}`}`;
          const v = a.meses[m];
          if (v) await db`insert into contract_items (entity_id, contract_id, description, value)
                          values (${entityId}, ${a.contratoId}, ${`${MONTH_NAMES[m]}/${YEAR}`}, ${toNumeric(v)})`;
        }
      } else if (a.tipo === "aditivo") {
        const c = a.contrato;
        const meses = a.meses.map((v, i) => ({ v, i })).filter((x) => x.i >= CORTE && x.v);
        const fim = meses.length ? meses[meses.length - 1]!.i : CORTE;
        const total = meses.reduce((s, x) => s + (x.v ?? 0n), 0n);
        const [novo] = await db<{ id: string }[]>`
          insert into contracts (entity_id, client_id, name, type, status, category_id, total_value, monthly_value,
                                 start_date, end_date, billing_terms, recognition_method, prorate_first_last_month,
                                 parent_contract_id, version, is_intercompany)
          values (${entityId}, ${c.client_id as string}, ${c.name as string}, ${c.type as string},
                  ${meses.length ? "active" : "completed"}, ${(c.category_id as string | null) ?? null},
                  ${toNumeric(total)}, null, ${`${YEAR}-${pad(CORTE + 1)}-01`},
                  ${`${YEAR}-${pad(fim + 1)}-${pad(lastDayOf(fim))}`}, ${(c.billing_terms as string | null) ?? null},
                  'manual', false, ${(c.parent_contract_id as string | null) ?? (c.id as string)},
                  ${Number(c.version) + 1}, ${Boolean(c.is_intercompany)})
          returning id`;
        for (const x of meses) {
          await db`insert into contract_items (entity_id, contract_id, description, value)
                   values (${entityId}, ${novo!.id}, ${`${MONTH_NAMES[x.i]}/${YEAR}`}, ${toNumeric(x.v!)})`;
        }
        await db`update contracts set superseded_at = now() where id = ${c.id as string}`;
        // A versão antiga não reconhece mais nada do corte em diante; o que já tinha sido
        // reconhecido nesse trecho sai, e o anterior fica.
        await db`delete from recognition_entries where contract_id = ${c.id as string} and period >= ${`${YEAR}-${pad(CORTE + 1)}-01`}`;
      } else {
        const d = a.draft;
        const cliente = clientes.find((k) => k.name.toLowerCase() === d.clientLabel.toLowerCase());
        if (!cliente) throw new Error(`${d.label}: cliente ${d.clientLabel} não cadastrado`);
        const meses = d.months.map((v, i) => ({ v, i })).filter((x) => x.v);
        const [novo] = await db<{ id: string }[]>`
          insert into contracts (entity_id, client_id, name, type, status, total_value, monthly_value,
                                 start_date, end_date, billing_terms, recognition_method, prorate_first_last_month)
          values (${entityId}, ${cliente.id}, ${d.label}, ${d.type}, ${d.status}, ${toNumeric(d.total)}, null,
                  ${`${YEAR}-${pad(d.firstMonth + 1)}-01`}, ${`${YEAR}-${pad(d.lastMonth + 1)}-${pad(lastDayOf(d.lastMonth))}`},
                  ${d.billing || null}, 'manual', false)
          returning id`;
        for (const x of meses) {
          await db`insert into contract_items (entity_id, contract_id, description, value)
                   values (${entityId}, ${novo!.id}, ${`${MONTH_NAMES[x.i]}/${YEAR}`}, ${toNumeric(x.v!)})`;
        }
      }
    }
    console.log(`\n  ${acoes.length} contrato(s) postos em dia.`);
  };

  if (acoes.length === 0) console.log("\nnada a fazer.\n");
  else if (!APPLY && !REHEARSE) console.log("\nnada foi gravado. --ensaio para ensaiar, --aplicar para gravar.\n");
  else if (REHEARSE) {
    await sql.begin(async (tx) => { await write(tx); throw new Rollback(); })
      .catch((e: unknown) => { if (!(e instanceof Rollback)) throw e; });
    console.log("ensaio: revertido, nada foi gravado.\n");
  } else {
    await sql.begin(write);
    console.log("gravado. Rode o reconhecimento até o mês atual.\n");
  }
} finally {
  await sql.end();
}
