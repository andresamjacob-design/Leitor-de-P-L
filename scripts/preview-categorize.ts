/**
 * What "Categorizar" would decide right now, without deciding anything.
 *
 * The two proposal scripts each report their own reach, but adding those numbers up is
 * wrong: a line named `BOLETO PAGO TAREFY` is claimed by a text rule *and* by Tarefy's
 * CNPJ, and the engine only ever applies one. The honest figure comes from running the
 * real engine — the same `suggestCategory` the review screen calls — over the same rules
 * the database actually holds.
 *
 * Reads only. Nothing is written, so it is safe to run before deciding whether to write.
 *
 *   npm run preview:categorize
 */

import postgres from "postgres";
import { loadEnvLocal } from "./load-env.ts";
import { runPreview, report } from "./engine-preview.ts";

loadEnvLocal();

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL não definido — veja o README.");

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

  report(await runPreview(sql, entity.id), names);
  console.log(`\n${DIM}nada foi gravado — isto só lê.${RESET}\n`);
} finally {
  await sql.end();
}
