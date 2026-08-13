# Financeiro

Plataforma de gestão financeira multi-entidade: fluxo de caixa (regime de caixa), DRE
gerencial (regime de competência) e reconhecimento de receita, para **DD Group** e
**Gabriel Sampaio Jacob**.

- `docs/finance-platform-spec.md` — a especificação
- `docs/DECISIONS.md` — as decisões tomadas, e onde elas contrariam a spec
- `docs/PLAN.md` — o plano por fase, com checklist e status

**Fase atual: 1 concluída.** Autenticação, entidades, schema, migrations, seed e shell
vazio. Nenhum relatório calcula nada ainda — isso é a Fase 2 em diante.

## Como rodar

Precisa de Node 22+ (testado no 24.15) e de um projeto Supabase.

```bash
npm install
cp .env.example .env.local     # preencha URL, chave anônima e DATABASE_URL
npm run db:migrate             # cria as tabelas, as policies de RLS e os gatilhos
npm run db:seed                # entidades, plano de contas e contas do Itaú
npm run dev
```

Para conseguir entrar, o seu usuário precisa existir no Supabase Auth e ter uma linha em
`user_entities` — não existe auto-cadastro. Convide o e-mail pelo painel do Supabase
(Authentication › Users › Invite) e depois rode:

```bash
SEED_USER_EMAIL=voce@empresa.com npm run db:seed
```

## Comandos

| Comando | O que faz |
|---|---|
| `npm run dev` | sobe o app em http://localhost:3000 |
| `npm run check` | typecheck + lint + testes unitários |
| `npm test` | testes unitários (Vitest) |
| `npm run test:e2e` | teste de ponta a ponta (Playwright) |
| `npm run db:generate` | gera uma migration a partir do schema |
| `npm run db:migrate` | aplica as migrations pendentes |
| `npm run db:seed` | popula entidades, plano de contas e contas |

## Como o código está organizado

```
src/lib/money.ts        centavos inteiros em bigint — nenhum float toca dinheiro
src/lib/dates.ts        datas como YYYY-MM-DD, sem objeto Date no domínio
src/lib/tax-id.ts       CPF/CNPJ normalizado, para casar com o extrato
src/lib/db/schema.ts    fonte única do schema; toda mudança vira migration
src/lib/entities.ts     resolução de /[entidade]/... e do escopo consolidado
src/lib/supabase/       clientes que sempre carregam o JWT do usuário
drizzle/                migrations versionadas, incluindo RLS e auditoria
scripts/seed.ts         seed idempotente
```

Três regras que valem para o código inteiro:

1. **Dinheiro é `bigint` em centavos.** `numeric(14,2)` no banco, conversão só na borda.
   `valor * 0.17` é um TypeError, não um bug silencioso.
2. **Toda query do app roda com o JWT do usuário.** Não existe cliente com service role.
   O RLS é a fronteira real entre as entidades, não a interface.
3. **Nada de dado falso.** Tela sem dado mostra estado vazio dizendo o que falta e em
   qual fase é construída.

## Dois razões, nunca um

O ponto central do desenho: `cash_entries` e `recognition_entries` são tabelas separadas
e **não fecham entre si mês a mês** — isso é o comportamento correto, não um bug.

- Fluxo de caixa lê só `cash_entries` (data real do dinheiro).
- DRE lê só `recognition_entries` (mês de competência).
- O relatório de **receita diferida** é a ponte entre os dois, e é o número que denuncia
  erro de cálculo.

## O que ainda falta para a Fase 1 fechar de verdade

- **Saldo de abertura das contas.** O seed grava 0,00 porque o extrato disponível é de
  julho/2026 e o backfill começa em janeiro. Precisa do saldo real de 01/01/2026.
- **Teste de RLS automatizado** (teste 6 da §11). Está pendente da decisão Q5 em
  `docs/DECISIONS.md`: sem Docker nesta máquina, a opção recomendada é PGlite.
- **Projeto Supabase.** Sem URL e chave, o app sobe e mostra a tela de "não configurado",
  mas ninguém entra.
