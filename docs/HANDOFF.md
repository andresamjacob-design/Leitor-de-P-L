# Handover — 18/08/2026

Onde tudo está, o que foi feito, e o que falta. Escrito para quem chega sem contexto
nenhum, inclusive eu mesmo numa conversa nova.

Leia junto quando precisar do detalhe: `docs/PLAN.md` (o roteiro original),
`docs/DECISIONS.md` (decisões numeradas D1–D81 e pendências Q2–Q18) e `README.md`.

---

## 1. O que é

Plataforma financeira multi-entidade que substitui três planilhas, para duas pessoas
jurídicas:

- **DD Group / Dynamics Data** (`dd-group`) — tem dados de verdade
- **Gabriel Sampaio Jacob LTDA - ME** (`gabriel-sampaio-jacob`) — cadastrada, vazia (Q2)

Next.js 16.3 (App Router; a convenção `middleware` virou `proxy`), React 19, TypeScript
strict com `noUncheckedIndexedAccess`, Supabase (Postgres + Auth magic link + RLS),
Drizzle ORM. Interface toda em português.

As oito fases do SPEC estão construídas. O trabalho recente não é construir fase nova — é
pôr dado real dentro do que já existe, e consertar o que só aparece quando o dado entra.

---

## 2. Onde as coisas estão

### O código

| | |
|---|---|
| **Repositório** | `github.com/andresamjacob-design/Leitor-de-P-L` |
| **Branch com este trabalho** | `worktree-auto-categorizacao`, empurrada |
| **Worktree em disco** | `/Users/andre/financeiro/.claude/worktrees/auto-categorizacao` |
| **Checkout principal** | `/Users/andre/financeiro` |

> ⚠️ **`origin/main` está em `60ad19f` ("fase 2")** — muito atrás. O main local tem oito
> fases que nunca foram empurradas. Abrir PR desta branch contra `main` mostraria um diff
> gigante. **Empurre o main primeiro.**

### Os dados reais

`docs/reference/` — **está no `.gitignore` e nunca entra no git.** Tem extrato bancário,
CNPJ de cliente e saldo.

- `Claude de DRE - Dynamics Data 2026.xlsx` — a planilha mestre. Abas: `DRE Geral`
  (receita nas linhas 2–90, custo nas 95–140), `Colaboradores`, `New Squads`, `Cargos`,
  `Organograma Projetos`, `Vendas e Perdas`.
- 6 extratos de conta corrente em xlsx, 19 faturas de cartão em PDF (34 arquivos, 9 são a
  mesma fatura sob outro nome), 1 extrato Contabilizei em PDF.

### O banco

Supabase real, `.env.local` preenchido. O `DATABASE_URL` usa o **session pooler
`sa-east-1`** — o host direto `db.<ref>.supabase.co` é só IPv6 e o macOS não resolve.

> **Nunca cole o `DATABASE_URL` no chat**: carrega a senha do Postgres, que passa por cima
> da RLS. `NEXT_PUBLIC_*` e a anon key são públicas por design.

### Os comandos

Todos os scripts que gravam têm dry run por padrão e pedem `--aplicar`. Vários aceitam
`--ensaio`, que grava numa transação revertida e mede o resultado antes de você decidir.

```
npm run dev
npm run check               # typecheck + lint + 327 testes
npm run test:e2e            # Playwright, 25 testes
npm run db:migrate          # aplica migrations
npm run db:seed             # 62 categorias × 2 entidades

npm run verify:import       # todos os arquivos reais reconciliam contra si mesmos
npm run verify:rls          # SPEC §11 teste 6 — isolamento entre entidades, 7/7

npm run pendencias          # ← COMECE POR AQUI: o que falta decidir, por dinheiro
npm run inspect:staged      # composição do que está parado
npm run preview:categorize  # o que o "Categorizar" decidiria agora (--aplicar grava)

npm run propose:rules       # regras de texto vindas da planilha
npm run propose:parties     # casa nome da planilha ↔ contraparte do extrato
npm run propose:contracts   # contratos do bloco de receita
npm run recognize:manual    # plano mensal dos contratos manuais
npm run import:invoices     # faturas de cartão em massa
```

---

## 3. O que o sistema tem hoje

| | |
|---|---|
| Razão de caixa | **977 lançamentos**, 06/08/2025 a 31/07/2026 |
| Categorizados | **737 (75,4%)** — 240 sem conta |
| Competência | 284 linhas de receita + 587 de custo |
| Receita reconhecida | **R$ 3.556.736,91** (jan–ago/2026) |
| Contratos | 80 (65 ativos, 15 concluídos), 95 parcelas mensais |
| Clientes / pessoas | 72 / 33 |
| Regras | 110 |
| Importações | 22 |
| Notas fiscais | **0** |

### Contas

| Conta | Tipo | Abertura | Lançamentos | Situação |
|---|---|---|---|---|
| Itaú — conta corrente | banco | 142.469,28 em 01/01/2026 | 461 | ✅ bate com o extrato |
| Itaú — CDB DI | aplicação | 367.735,49 em 01/01/2026 | **0** | ⚠️ ver §5.1 |
| Contabilizei | banco | 0,00 | 0 | inativa |
| Itaucard 5780 | cartão | 0,00 | 468 | |
| Itaucard 8299 | cartão | 0,00 | 48 | |

**Duas conferências que fecham hoje:**

- A conta corrente marca **226.916,33**, que é o `SALDO TOTAL DISPONÍVEL` declarado pelo
  banco em 31/07/2026. Ao centavo.
- A receita reconhecida bate com a planilha **mês a mês** — R$ 0,03 de diferença acumulada
  em oito meses, puro arredondamento dela mesma.

---

## 4. O que foi feito

29 commits, de `2bb994e` a `aab0730`. Por tema, não por ordem.

### Categorização determinística

- **Regra por sentido** (migration `0004`). A regra `CICLO` → Agência pegava cinco
  recebimentos da Ciclo: receita virando despesa. `categorization_rules.direction` resolve,
  e é o mesmo problema da Salesforce, que é cliente e fornecedora ao mesmo tempo.
- **Casamento por documento** (`propose-parties`): liga o nome da planilha ao nome legal do
  extrato e daí ao CNPJ/CPF. Trata ambiguidade como motivo para não propor.
- **Duas classes de falha de texto:** truncamento (`ATTENTIVE CONTABILIDADE` chega como
  `ATTENTIVE CO`) e separador (`Escola.i` ≠ `ESCOLAI`; `Enutri` ≠ `E NUTRI`).
- **Casamento aproximado com corte em seis letras.** Um token de 6+ a uma letra de
  distância é evidência; cinco letras é coincidência. Foi o que deixou Pasolini, Medcom e
  Migani entrarem e manteve `SANTA MONICA` × `Santa Lucia` de fora.
- **Relatório `pendencias`**, que ordena o que falta por dinheiro e diz o que o sistema já
  sabe de cada grupo.

### Importação

- **19 faturas de cartão** (516 lançamentos) em massa, com identidade lida de dentro do PDF
  e dedup por conteúdo.
- **Leitor da Contabilizei** (`src/lib/import/contabilizei-statement.ts`, 7 testes) — uma
  terceira conta bancária que ninguém tinha citado, achada procurando nota fiscal. Confere
  de três jeitos independentes.
- Dois extratos curtos de julho/agosto, com 69 duplicatas detectadas sozinhas pelo hash.

### Competência

- **80 contratos** lidos do bloco de receita da planilha, fechando com o total do ano
  declarado nela (R$ 5.033.061,88 contra 5.033.061,87).
- **Contrato pode declarar sua conta de receita** (migration `0005`). O tipo tem dois
  valores e o plano tem quatro receitas; `contracts.category_id` vence o tipo. Sem isso,
  R$ 378.848 de indicação e parceria cairiam em suporte contínuo.
- **`recognize-manual`** grava o plano mês a mês dos contratos cujo valor varia — o motor
  não gera nada para método `manual`, e sem isso metade do ano ficava invisível.

### Diligência

- **Q11 exercitada**: o caminho de escrita do razão rodou pela primeira vez, e o espelho de
  competência nasceu só para as linhas com conta, que é a D2a exatamente como escrita.
- **`verify:rls` 7/7** depois de todas as escritas.
- **2025 removido do razão** a pedido, com o saldo provando o corte ao não mudar.

---

## 5. O que está errado agora

### 5.1 A conta CDB nunca se move ⚠️ **o maior**

O `Itaú — CDB DI` tem saldo de abertura de R$ 367.735,49 e **zero lançamentos**. Todos os
movimentos do CDB estão só na conta corrente, como transferência 99.03:

| | |
|---|---|
| `APLICACAO CDB DI` | 4× saindo, R$ 485.000,00 |
| `RESGATE CDB` | 1× entrando, R$ 367.735,49 |
| `RENDIMENTOS` | 38× entrando, R$ 202,31 |

**A transferência tem uma perna só.** O resgate de janeiro trouxe o CDB inteiro para a
conta corrente — esse dinheiro já está nos 226.916,33 **e continua contado no saldo
congelado do CDB**. É dobra de R$ 367.735,49 no "Caixa hoje".

Pelos números, o CDB deveria ter os R$ 485.000 aplicados depois. Não há extrato do CDB na
pasta para confirmar.

**Como resolver:** um extrato do CDB (importo e a conta ganha as duas pernas), ou tratar o
CDB como conta fora do relatório de caixa. É anterior a este trabalho — a conta foi semeada
com saldo e nunca recebeu movimento; só ficou visível agora que há aplicação e resgate de
verdade no razão.

### 5.2 `PIX DEVOLVIDO RICARDO`, R$ 115.000

Entrada em 09/01/2026, classificada em **6.10 Freelancers** pela camada de histórico — e
**não existe o pagamento de saída que ela estornaria**. Põe um crédito de R$ 115 mil na
folha sem o débito correspondente, e é o que deixa o custo de janeiro/2026 negativo em
R$ 54.680.

**Como resolver:** se estornou um pagamento que não está no razão, deixe-o sem categoria.
A correção é na tela de Lançamentos — tirar a categoria exige tirar o espelho de
competência junto, e é ela que faz as duas coisas pelo caminho certo.

### 5.3 Categorias de custo recebendo entrada

No fluxo de caixa, **6.10 Freelancers (R$ 166.000)** e **8.03 Agência (R$ 53.800)**
aparecem em ENTRADAS. São devoluções e estornos caindo em contas de despesa, e inflam o
total de entradas sem serem receita. O 5.2 é o maior deles.

---

## 6. O que falta

### Depende de você

Rode **`npm run pendencias`** — lista as 240 linhas sem conta agrupadas por contraparte,
ordenadas por dinheiro. Uma resposta sua costuma resolver várias linhas, porque a regra por
documento pega todo o histórico daquela contraparte de uma vez.

| | O que é | Como destrava |
|---|---|---|
| **SISPAG** | ~101 linhas, **R$ 2,9 mi**, sem contraparte nenhuma — cada uma é um lote pagando vários fornecedores | O **arquivo de retorno do SISPAG** (CNAB) ou o detalhe do lote no internet banking. Maior bloco isolado. |
| **`OP REC EXT`** | 5 entradas, ~R$ 470 mil | Parecem câmbio. Em qual receita caem é decisão. |
| **Clientes fora da planilha** | A. F. Comércio, CN INC, Cidade Center Norte, Maruri, DB Genética, Brazil Wind, Ligavit, AIDC | Dizer quem é cada um. Vira uma regra por documento. |
| **PDG IT, Hold Beauty, CSO, Hogrefe** | Têm contrato de projeto *e* de retainer, e o recebimento não sabe onde cair | `contracts.category_id` já existe — basta dizer qual contrato é qual. |

### Depende de arquivo ou chave que não chegou

| # | O que falta |
|---|---|
| **Q18** | `ANTHROPIC_API_KEY` existe no `.env.local` mas está **vazia**. Todo o caminho de IA está testado com modelo mockado; nenhuma chamada real aconteceu. |
| **Q15** | Fatura de junho/2026 da conta 8384 não está na pasta. |
| **Q13** | Os três PDFs **têm** texto (26 mil chars), mas a fonte é subconjunto sem mapa Unicode — cada glifo vem como código arbitrário, em substituição específica do documento. Reexportar do banco resolve. Cobrem jan–jul/2026, já importado por outra via. |
| **NFs** | Zero cadastradas. A Fase 5 concilia NF contra caixa e não tem dado nenhum. |
| **Q2** | Nada chegou da entidade Gabriel Sampaio Jacob. |
| — | **Extrato do CDB**, que resolve o §5.1. |

### Decisões antigas ainda abertas

`Q4` (metas na tela), `Q8` (a aba `Vendas e Perdas` é um CRM — 6 negócios ganhos, R$ 221
mil; nenhuma fase cobre), `Q9` (documento escolar alheio na pasta — apagar?), `Q16`
(contratos), `Q17` (arquivo do contrato no Storage).

---

## 7. Armadilhas já pagas — não repetir

Regras que valem em todo o código:

- **Dinheiro é `bigint` de centavos.** Nunca float. No banco, `numeric(14,2)`. A conversão
  vive só em `src/lib/money.ts`.
- **Data é string `YYYY-MM-DD`.** Nunca `Date`.
- **Percentual é `bigint` em milipercentual** (100% = `100_000n`).
- **Dois razões que não batem de propósito:** `cash_entries` (caixa) e
  `recognition_entries` (competência). São ligados, nunca fundidos.
- **Nenhum `service_role`.** A RLS é a fronteira de verdade (D16).
- **Nenhuma chamada de LLM escreve em tabela de razão** (SPEC §9).
- **Nunca inventar número.** Sem dado real, travessão e o motivo.
- **Não instalar dependência fora da seção 3 do SPEC sem perguntar.**

Erros que custaram tempo antes:

- **`exceljs` falha em 3 de 3 extratos do Itaú.** Removido; leitor próprio em
  `src/lib/import/xlsx.ts` (D34).
- **PostgREST serializa `numeric` como número JSON.** `800.00` chega como `800`, e isso
  transformou R$ 800,00 em R$ 80,80 em 327 de 426 linhas (D77).
- **Filtro do PostgREST vai na query string.** 300 hashes dão 19 KB de URL e o servidor
  recusa em ~8 KB. Use `src/lib/data/batching.ts` (D79).
- **Hash de dedup precisa da contraparte e de um índice de ocorrência** (D78).
- **O export do Itaú vem do mais novo para o mais antigo** (D81).
- **Nome de arquivo de fatura não significa nada.** A identidade vem de dentro do PDF.
- **React 19 limpa formulário não controlado depois de uma action.** Use `kept()`.
- **`APL/RES APLIC AUT` é varredura automática e é descartado** (D35); `REND PAGO` fica.

Aprendidos neste trabalho:

- **`cash_entries.import_id` é `set null`, não `cascade`.** Apagar a importação primeiro
  deixa lançamentos órfãos no razão. A ordem é lançamentos, depois importação.
- **Existe um gatilho `cash_entries_audit`** que já registra toda exclusão com a linha
  inteira. Escrever auditoria à mão duplica o registro.
- **O saldo de abertura de uma conta é uma data, não só um número.** Importar período
  anterior à abertura exige mover as duas coisas, ou o caixa mente pelo valor da abertura.
  Pergunta padrão depois de import retroativo: *quantos lançamentos são anteriores à data
  de abertura da própria conta?*
- **Identidade vence texto, inclusive dentro dos guardas.** Meu guarda de intercompany
  comparava nome e segurou sete pagamentos legítimos: a pessoa Gabriel Sampaio Jacob tem
  CPF, a empresa homônima tem CNPJ.
- **Um filtro de ruído por nome come dado real.** O rodapé da Contabilizei repete o nome do
  banco, e o banco também é contraparte: linha que tem valor e saldo é movimento, quaisquer
  que sejam as palavras nela.
- **Linha cujo saldo não anda não moveu dinheiro**, por mais que ela imprima um valor.
- **Na tela de aprovação, clique por referência de elemento não submete o formulário.** Só
  coordenada funciona, e ela precisa vir de um screenshot tirado antes da chamada.

---

## 8. Ferramentas de terceiro no diretório

`npx ruflo init` foi rodado **dentro do worktree** em 17/08 e deixou 110 arquivos:
`.claude/`, `.claude-flow/`, `.agents/`, `.swarm/`, `.mcp.json`, `ruvector.db`. Nada disso
está commitado; o `.gitignore` ganhou regras próprias dele, aditivas, sem tocar na proteção
de `docs/reference/`.

Dois efeitos que valem saber:

- **10 tipos de hook** em `.claude/settings.json`, incluindo `PreToolUse` — código do ruflo
  roda a cada ação de qualquer sessão do Claude Code neste diretório.
- **O `.mcp.json` anuncia 333 ferramentas ≈ 61,5 mil tokens** de contexto por sessão.
  Limite com `CLAUDE_FLOW_MCP_TOOLS` se for manter.

O `eslint.config.mjs` passou a ignorar esses diretórios — os helpers em CommonJS quebravam
o `npm run check`, que é o portão do projeto.
