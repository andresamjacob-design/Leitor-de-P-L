/**
 * What "Categorizar" would decide right now, without deciding anything.
 *
 * The two proposal scripts each report their own reach, but adding those numbers up is
 * wrong: a line named `BOLETO PAGO TAREFY` is claimed by a text rule *and* by Tarefy's
 * CNPJ, and the engine only ever applies one. The honest figure comes from running the
 * real engine — the same `suggestCategory` the review screen calls — over the same rules
 * the database actually holds.
 *
 * Reads only, unless `--aplicar` is passed — and then it does exactly what the
 * “Categorizar” button does: writes `suggested_*` onto the pending staged rows so the
 * review screen can show each line with its reason. A suggestion is still not an
 * approval; every line stays `pending`, waiting for a human (SPEC §7).
 *
 *   npm run preview:categorize
 *   npm run preview:categorize -- --aplicar
 */

import postgres from "postgres";
import { loadEnvLocal } from "./load-env.ts";
import { runPreview, report, writeSuggestions } from "./engine-preview.ts";

loadEnvLocal();

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL não definido — veja o README.");

const GREEN = "[32m";
const DIM = "[2m";
const RESET = "[0m";

const sql = postgres(url, { max: 1, connect_timeout: 20 });

try {
  const entities = await sql<{ id: string }[]>`
    select id from entities where slug = 'dd-group'`;
  const entity = entities[0];
  if (!entity) throw new Error("entidade dd-group não encontrada — rode npm run db:seed");

  const categories = await sql<{ id: string; code: string; name: string }[]>`
    select id, code, name from categories where entity_id = ${entity.id}`;
  const names = new Map(categories.map((category) => [category.id, category]));

  const preview = await runPreview(sql, entity.id);
  report(preview, names);

  if (process.argv.includes("--aplicar")) {
    const written = await writeSuggestions(sql, preview.decisions);
    console.log(
      `\n${GREEN}${written} sugestões gravadas${RESET} nas linhas paradas. ` +
        `Elas continuam pendentes — aprovar é outra decisão.\n`,
    );
  } else {
    console.log(`\n${DIM}nada foi gravado. Rode com --aplicar para gravar as sugestões.${RESET}\n`);
  }
} finally {
  await sql.end();
}
