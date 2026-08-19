# Handover — 18/08/2026

Onde tudo está, o que foi feito, e o que falta. Escrito para quem chega sem contexto
nenhum, inclusive eu mesmo numa conversa nova.

Leia junto quando precisar do detalhe: `docs/PLAN.md` (o roteiro original),
`docs/DECISIONS.md` (decisões numeradas D1–D95 e pendências Q2–Q18) e `README.md`.

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

> ✅ **`origin/main` foi empurrado em 18/08/2026**, de `60ad19f` ("fase 2") para `aa9250d` —
> 16 commits, avanço limpo, sem force. As oito fases estão no GitHub. Conferido antes:
> `docs/reference/` e `.env` nunca entraram no histórico.
>
> A branch `worktree-auto-categorizacao` tem o trabalho posterior a isso e ainda não foi
> mesclada; agora um PR dela contra `main` mostra só o que ela realmente mudou.

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
npm run check               # typecheck + lint + 373 testes
npm run test:e2e            # Playwright, 25 testes
npm run db:migrate          # aplica migrations
npm run db:seed             # 62 categorias × 2 entidades

npm run verify:import       # todos os arquivos reais reconciliam contra si mesmos
npm run verify:rls          # SPEC §11 teste 6 — isolamento entre entidades, 7/7
npm run verify:reconcile    # a DRE e o fluxo de caixa fecham? (--detalhe abre a ponte)

npm run pendencias          # ← COMECE POR AQUI: o que falta decidir, por dinheiro
npm run inspect:staged      # composição do que está parado
npm run preview:categorize  # o que o "Categorizar" decidiria agora (--aplicar grava)

npm run fix:credits         # entrada parada em conta de custo (--ensaio / --aplicar)
npm run propose:receipts    # de quem é o dinheiro que entrou (--ensaio / --aplicar)
npm run decisoes            # ← o que falta decidir, com a evidência de cada caso
npm run vincular            # põe o CNPJ do extrato no cliente que já existe (--aplicar)

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
| Razão de caixa | **982 lançamentos**, 06/08/2025 a 31/07/2026 |
| Categorizados | **769 (78,3%)** — 213 sem conta |
| Competência | 284 linhas de receita + 577 de custo |
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
| Itaú — CDB DI | aplicação | 367.735,49 em 01/01/2026 | 5 | ✅ as duas pernas existem (§5.1) |
| Contabilizei | banco | 0,00 | 0 | inativa |
| Itaucard 5780 | cartão | 0,00 | 468 | |
| Itaucard 8299 | cartão | 0,00 | 48 | |

**Três conferências que fecham hoje:**

- A conta corrente marca **226.916,33**, que é o `SALDO TOTAL DISPONÍVEL` declarado pelo
  banco em 31/07/2026. Ao centavo.
- A receita reconhecida bate com a planilha **mês a mês** — R$ 0,03 de diferença acumulada
  em oito meses, puro arredondamento dela mesma.
- **A DRE e o fluxo de caixa fecham nos 13 meses, com resíduo zero** (`verify:reconcile`,
  D85). Os dois razões não batem — não é para baterem —, mas toda diferença entre eles tem
  nome.

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
- **Entrada parada em conta de custo** (`fix:credits`, D83). O cartão é prova por si —
  crédito na fatura só pode ser estorno de compra. No banco, é devolução só se o pagamento
  que ela reverte estiver na mesma categoria. Tirou R$ 218.800 de custo fantasma da DRE
  sem mover o saldo.
- **Trava no motor para o defeito não voltar** (D86). Medindo o que o motor decidiria para
  as linhas sem conta, ele decidiria 5 — e as 5 eram exatamente as que a D83 corrigira,
  pela camada de histórico. O histórico aprende com o passado e não sabe nada sobre
  sentido, então perdeu o direito de pôr uma **entrada** numa conta de custo. Regra
  explícita continua podendo, porque tem `direction` para dizer que quis. De 5 sugestões
  erradas para 0.
- **De quem é o dinheiro que entrou** (`propose:receipts`, D87). Identidade por documento,
  com duas recusas deliberadas: **CPF nunca é cliente** (são as devoluções do Ricardo, e
  tratá-las como recebimento inventaria R$ 170 mil de receita), e **o script não cadastra
  cliente** — o dry run mostrou a Ciclo a caminho de ser duplicada.

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
- **A ponte entre os dois razões** (`verify:reconcile`, D85). Mês a mês, prova que o
  resultado da DRE é o caixa operacional mais um conjunto de diferenças **todas nomeadas**,
  e que não sobra centavo. Falha com código 1 se sobrar.

---

## 5. O que estava errado, e está consertado

Os três defeitos que o handover anterior listava foram resolvidos em 18/08/2026, e o
`verify:reconcile` passou a provar que não voltaram.

### ~~5.1 A conta CDB nunca se move~~

**Resolvido em 18/08/2026.** Ver D84. O `Itaú — CDB DI` tinha saldo de abertura e **zero
lançamentos**: todo movimento dele vivia só na conta corrente, como transferência 99.03.
Uma transferência com uma perna só mente duas vezes — o resgate de janeiro ficava contado
na conta corrente **e** congelado na abertura do CDB, e os R$ 485.000 aplicados desde junho
saíam da conta corrente e não chegavam a lugar nenhum.

As cinco pernas que faltavam foram derivadas das linhas que o banco já imprimiu — mesma
data, mesmo valor, sentido oposto, outra conta — pelo mesmo mecanismo da tela
(`transfer_pairs.kind = 'investment'`). Não precisou do extrato do CDB. A conta fecha em
número redondo, que é o sinal de que a leitura está certa:

```
367.735,49 − 367.735,49 + 485.000,00 = 485.000,00
```

O CDB passou a marcar **R$ 485.000,00**, a conta corrente não se moveu, e o caixa total foi
de R$ 594.651,82 para **R$ 711.916,33**.

> O handover anterior descrevia só metade do problema, a dobra. Somadas as duas pontas, o
> sistema **subestimava** o caixa em R$ 117.264,51, e não o contrário.

**O que continua em aberto é pequeno e tem nome:** rendimento que tenha ficado dentro do
CDB em vez de ser varrido para a conta corrente não aparece. R$ 485.000,00 é o principal;
só um extrato do CDB prova o centavo.

### ~~5.2 `PIX DEVOLVIDO RICARDO`~~ e ~~5.3 categorias de custo recebendo entrada~~

**Resolvido em 18/08/2026.** Ver D82 e D83. As duas eram o mesmo defeito visto de ângulos
diferentes: entrada parada numa conta de custo vira custo negativo, e isso só é verdade
quando o pagamento estornado também está naquela categoria.

Dez linhas perderam a categoria, R$ 218.800 — as duas devoluções do Ricardo (R$ 165.000,
cuja perna de saída está dentro de um lote SISPAG) e oito recebimentos de cliente que a
camada de identidade tinha arquivado em 8.03 Agência (R$ 53.800). Janeiro deixou de ter
−R$ 115.000 de custo de freelancer, fevereiro −R$ 50.000, e o saldo da conta corrente não
se moveu um centavo.

Ficaram de pé, conferidos um a um: 18 estornos de cartão e a devolução do Inaldo, que tem
o pagamento correspondente na mesma categoria no mesmo dia.

> **O pedido era "apagar de tudo", e apagar teria sido errado.** A devolução é uma linha do
> extrato: a conta corrente só fecha nos R$ 226.916,33 porque ela está lá. `npm run
> fix:credits` nunca apaga `cash_entries` — tira a categoria, e o espelho de competência
> sai junto pelo caminho que o `planCashMirror` já tinha.

### 5.4 O que a ponte mostrou que ainda vai mexer no resultado

Os dois razões fecham hoje, mas fechar não é o mesmo que estar completo. Somadas as
diferenças dos 13 meses:

| | |
|---|---|
| Receita reconhecida no mês | + R$ 3.556.736,91 |
| Entradas de caixa sem competência | − R$ 2.995.308,69 |
| **Saídas de caixa sem competência** | **+ R$ 1.281.607,12** |
| Custo de compra no cartão | − R$ 147.685,31 |

A linha do meio é a lista de tarefas em forma de número: **R$ 1,28 milhão que saiu do caixa
e ainda não pesa na DRE**, porque essas linhas não têm categoria — em maioria os lotes
SISPAG. Conforme forem categorizadas, o custo da DRE cresce e o resultado cai, sem que o
caixa mude um centavo. Isso é esperado, e agora é visível antes de acontecer em vez de
aparecer como surpresa no fechamento.

---

## 6. O que falta

### Depende de você

Rode **`npm run decisoes`** — ele lista cada pergunta em aberto com a evidência do lado,
e é feito para você responder de uma sentada. `npm run pendencias` dá o quadro por dinheiro. Uma resposta sua costuma resolver várias linhas, porque a regra
por documento pega todo o histórico daquela contraparte de uma vez.

> ⚠️ **O motor não alcança o que já está no razão** (D88). Ele só roda sobre
> `staged_transactions`, e o staging está vazio porque tudo foi aprovado. Toda regra criada
> depois da aprovação é peso morto para essas 248 linhas — não adianta criar regra
> esperando que elas sejam pegas sozinhas. Recategorizar em massa foi medido e recuperaria
> 2%; antes da D86, os 2% eram justamente as sugestões erradas.

**Na ordem do dinheiro:**

| | O que é | Como destrava |
|---|---|---|
| **SISPAG** ← *o próximo passo* | 34 linhas, **R$ 1.221.679,97** — **95% de todo o custo que ainda falta na DRE**. Cada uma é um lote pagando vários fornecedores, e o extrato não nomeia nenhum | O **arquivo de retorno do SISPAG** (CNAB) ou o detalhe do lote no internet banking. Nenhuma regra, camada de identidade ou IA resolve: **a informação não está no arquivo que temos**. **Também é onde estão as duas pernas de saída do Ricardo** (D82). |
| **12 CNPJs sem dono** | 26 entradas, R$ 463.513,49 — A. F. Comércio (R$ 213 mil), DB Genética, CN INC, Ligavit, Fulano, Brain, SW, ISM, UMI SAN, Conexão, Mara Thaysa, Keepclear | Dizer se cada um é cliente novo ou um dos **39 clientes que já existem sem documento**. O script não decide isso sozinho de propósito (D87): casar nome de empresa duplica cliente. |
| **`OP REC EXT`** | 4 entradas, ~R$ 408 mil, sem documento | Parecem câmbio. Em qual receita caem é decisão. |
| **PDG IT, Hold Beauty, CSO, Hogrefe** | 13 entradas, R$ 150.400 — têm contrato de projeto *e* de retainer, e o recebimento não sabe onde cair | `contracts.category_id` já existe — basta dizer qual contrato é qual. As duas em que o valor bate com a mensalidade já foram resolvidas sozinhas. |
| **`BOLETOS RECEBIDOS`** | 8 entradas, R$ 43.100, sem documento | O extrato não nomeia o sacado. |
| **Conta de receita financeira** | Não existe no plano. Os rendimentos de aplicação (38 linhas, R$ 202,31) estão em `99.03`, que é **transferência**, e ficam fora da DRE — com R$ 485.000 no CDB isso cresce (D95) | Criar `3.05 Receita financeira`? E em qual grupo da DRE — `receita_bruta` infla o OPBB, então provavelmente um grupo não operacional. |

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
- **Categoria errada se corrige tirando a categoria, nunca apagando o lançamento.** A linha
  do extrato é o que faz a conta fechar; a categoria é opinião sobre ela. Apagar troca um
  erro visível, que aparece em `pendencias`, por um razão que não bate mais com o banco.
- **Identidade sozinha não sabe o sentido.** A D40 põe identidade acima de texto, e por
  isso o `direction` das regras não teve voz quando a camada de identidade arquivou
  recebimento de cliente na despesa que a empresa paga a esse mesmo cliente.
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
