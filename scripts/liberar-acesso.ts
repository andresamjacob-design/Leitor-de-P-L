/**
 * Libera uma pessoa pela linha de comando (D155) — o caminho para o primeiro administrador,
 * antes de existir alguém que possa usar a tela de Acessos.
 *
 * Mesma regra das funções do banco: só @ddgroup.com.br (ou quem já tem conta), e a pessoa
 * que ainda não entrou fica em `acessos_pendentes` até o primeiro login.
 *
 *   npm run liberar -- --email nome@ddgroup.com.br --papel owner            # mostra
 *   npm run liberar -- --email nome@ddgroup.com.br --papel owner --aplicar
 *
 * Papéis: viewer (vê), member (vê e edita), owner (também libera outras pessoas).
 */

import postgres from "postgres";
import { loadEnvLocal } from "./load-env.ts";

loadEnvLocal();

const arg = (nome: string) => {
  const i = process.argv.indexOf(nome);
  return i === -1 ? undefined : process.argv[i + 1];
};
const email = arg("--email")?.trim().toLowerCase();
const papel = arg("--papel");
const APPLY = process.argv.includes("--aplicar");
if (!email || !papel || !["viewer", "member", "owner"].includes(papel)) {
  throw new Error("uso: --email <e-mail> --papel viewer|member|owner [--aplicar]");
}

const sql = postgres(process.env.DATABASE_URL as string, { max: 1, connect_timeout: 20 });

try {
  const [entity] = await sql<{ id: string }[]>`select id from entities where slug = 'dd-group'`;
  const [usuario] = await sql<{ id: string }[]>`select id from auth.users where lower(email) = ${email}`;
  if (!usuario && !email.endsWith("@ddgroup.com.br")) {
    throw new Error("só e-mails @ddgroup.com.br podem ser liberados");
  }

  const destino = usuario ? "acesso ativo (a conta já existe)" : "aguardando primeiro login";
  console.log(`\n${email} → ${papel} na DD Group · ${destino}`);
  if (!APPLY) {
    console.log("nada foi gravado. --aplicar para gravar.\n");
  } else if (usuario) {
    await sql`insert into user_entities (user_id, entity_id, role) values (${usuario.id}, ${entity!.id}, ${papel})
              on conflict (user_id, entity_id) do update set role = excluded.role`;
    console.log("gravado.\n");
  } else {
    await sql`insert into acessos_pendentes (email, entity_id, role) values (${email}, ${entity!.id}, ${papel})
              on conflict (email, entity_id) do update set role = excluded.role`;
    console.log("gravado. O acesso vale no primeiro login com o código.\n");
  }
} finally {
  await sql.end();
}
