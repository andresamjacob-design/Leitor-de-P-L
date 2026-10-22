/**
 * Reconhece a receita dos contratos de valor fixo até um mês (D162) — o mesmo que o botão
 * "Reconhecer" da tela de Contratos faz (`applyRecognition`), pelo terminal.
 *
 * Mesma função (`planContract`) e mesmas regras: cada mês é gravado uma vez, linha editada à
 * mão é preservada, mês que o contrato deixou de cobrir é removido. Versões substituídas por
 * aditivo ficam de fora. Os contratos `manual` são do `recognize:manual`.
 *
 *   npm run reconhecer -- --ate 2026-10              # mostra
 *   npm run reconhecer -- --ate 2026-10 --ensaio
 *   npm run reconhecer -- --ate 2026-10 --aplicar
 */

import postgres from "postgres";
import { loadEnvLocal } from "./load-env.ts";
import { planContract } from "@/lib/recognition/engine";
import { fromNumericPercent } from "@/lib/recognition/percent";
import { formatBRL, fromNumeric, toNumeric } from "@/lib/money";

loadEnvLocal();

const arg = (nome: string) => {
  const i = process.argv.indexOf(nome);
  return i === -1 ? undefined : process.argv[i + 1];
};
const APPLY = process.argv.includes("--aplicar");
const REHEARSE = process.argv.includes("--ensaio");
const ate = arg("--ate");
if (!ate || !/^\d{4}-(0[1-9]|1[0-2])$/.test(ate)) throw new Error("uso: --ate AAAA-MM [--ensaio|--aplicar]");
const through = `${ate}-01`;
const REVENUE_CODE: Record<string, string> = { retainer: "3.01", project: "3.02" };
const iso = (d: unknown) => (d ? (d instanceof Date ? d.toISOString().slice(0, 10) : String(d)) : null);

class Rollback extends Error {}
const sql = postgres(process.env.DATABASE_URL as string, { max: 1, connect_timeout: 20 });

try {
  const [entity] = await sql<{ id: string }[]>`select id from entities where slug = 'dd-group'`;
  const entityId = entity!.id;
  const categorias = new Map(
    (await sql<{ id: string; code: string }[]>`select id, code from categories where entity_id = ${entityId}`).map((c) => [c.code, c.id]),
  );
  const contratos = await sql<Record<string, unknown>[]>`
    select * from contracts where entity_id = ${entityId} and superseded_at is null and recognition_method <> 'manual'`;

  const write = async (db: postgres.Sql | postgres.TransactionSql, gravar: boolean) => {
    const porMes = new Map<string, bigint>();
    let gravadas = 0, preservadas = 0, removidas = 0;
    for (const c of contratos) {
      const categoryId = (c.category_id as string | null) ?? categorias.get(REVENUE_CODE[String(c.type)] ?? "") ?? "";
      const reportes = await db<{ period: string; p: string; is_correction: boolean }[]>`
        select period::text, percent_complete_cumulative::text as p, is_correction from poc_reports where contract_id = ${c.id as string} order by period`;
      const plano = planContract(
        {
          id: String(c.id), clientId: String(c.client_id), categoryId,
          type: c.type as "retainer", status: c.status as "active",
          totalValue: c.total_value === null ? null : fromNumeric(String(c.total_value)),
          monthlyValue: c.monthly_value === null ? null : fromNumeric(String(c.monthly_value)),
          startDate: iso(c.start_date), endDate: iso(c.end_date),
          recognitionMethod: c.recognition_method as "straight_line",
          prorateFirstLastMonth: Boolean(c.prorate_first_last_month), isIntercompany: Boolean(c.is_intercompany),
        },
        { through, pocReports: reportes.map((r) => ({ period: r.period, cumulative: fromNumericPercent(r.p), isCorrection: r.is_correction })) },
      );
      const existentes = new Map(
        (await db<{ id: string; period: string; manually_edited: boolean }[]>`
          select id, period::text, manually_edited from recognition_entries
           where contract_id = ${c.id as string} and source = 'engine' and kind = 'revenue'`).map((r) => [r.period, r]),
      );
      for (const r of plano.rows) {
        porMes.set(r.period, (porMes.get(r.period) ?? 0n) + r.amount);
        const atual = existentes.get(r.period);
        existentes.delete(r.period);
        if (atual?.manually_edited) { preservadas++; continue; }
        if (!gravar) { gravadas++; continue; }
        if (atual) {
          await db`update recognition_entries set amount = ${toNumeric(r.amount)}, category_id = ${r.categoryId},
                   client_id = ${r.clientId}, method = ${r.method}, notes = ${r.basis}, updated_at = now() where id = ${atual.id}`;
        } else {
          await db`insert into recognition_entries (entity_id, contract_id, client_id, category_id, period, kind, amount, method, source, is_intercompany, notes)
                   values (${entityId}, ${c.id as string}, ${r.clientId}, ${r.categoryId}, ${r.period}, ${r.kind}, ${toNumeric(r.amount)},
                           ${r.method}, 'engine', ${r.isIntercompany}, ${r.basis})`;
        }
        gravadas++;
      }
      for (const [, r] of existentes) {
        if (r.manually_edited) { preservadas++; continue; }
        if (gravar) await db`delete from recognition_entries where id = ${r.id}`;
        removidas++;
      }
    }
    console.log(`\nReceita dos contratos de valor fixo até ${ate}:`);
    for (const [m, v] of [...porMes].sort().filter(([m]) => m >= "2026-08-01")) console.log(`  ${m.slice(0, 7)}  ${formatBRL(v).padStart(16)}`);
    console.log(`\n  ${gravadas} linha(s) ${gravar ? "gravadas" : "a gravar"}, ${preservadas} preservada(s) por edição manual, ${removidas} ${gravar ? "removida(s)" : "a remover"}.`);
  };

  if (!APPLY && !REHEARSE) {
    await write(sql, false);
    console.log("nada foi gravado. --ensaio para ensaiar, --aplicar para gravar.\n");
  } else if (REHEARSE) {
    await sql.begin(async (tx) => { await write(tx, true); throw new Rollback(); })
      .catch((e: unknown) => { if (!(e instanceof Rollback)) throw e; });
    console.log("ensaio: revertido, nada foi gravado.\n");
  } else {
    await sql.begin((tx) => write(tx, true));
    console.log("gravado.\n");
  }
} finally {
  await sql.end();
}
