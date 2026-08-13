# PLAN

Plano de construção da plataforma financeira, dividido nas fases da §2 do `SPEC.md`.
As decisões que moldam cada fase estão em `DECISIONS.md` — quando este plano diverge do
SPEC, a divergência está registrada lá.

**Regra de sessão:** uma fase por sessão. Ao fim de cada fase: testes passando,
`README.md` atualizado, commit, e este arquivo atualizado com o que ficou pronto e o que
mudou.

**Status geral**

| Fase | Escopo | Status |
|---|---|---|
| 1 | Auth, entidades, schema, migrations, seed, shell vazio | ✅ construída — falta o teste de RLS (Q5) e o projeto Supabase (Q6) |
| 2 | CRUD manual de lançamentos + plano de contas + fluxo de caixa | ✅ construída — nenhuma escrita rodou contra um Postgres de verdade (Q11) |
| 3 | Importação de extrato: XLSX/CSV + PDF de fatura, dedup, tela de revisão | ⬜ |
| 4 | Categorização: motor de regras determinístico + aprendizado de regra | ⬜ |
| 5 | Clientes, contratos, NFs, cronogramas de reconhecimento, POC | ⬜ |
| 6 | P&L gerencial por entidade + consolidado | ⬜ |
| 7 | Camada de IA: sugestões e extração de contrato em PDF | ⬜ |
| 8 | Dashboards, exports (XLSX/CSV), tela de audit log | ⬜ |

---

## O que os arquivos reais mudaram no plano

Os arquivos em `docs/reference/` foram lidos antes deste plano. Achados que importam:

- **O extrato Itaú (XLSX) tem linhas que não são lançamentos.** `SALDO EM CONTA
  CORRENTE`, `SALDO TOTAL DISPONÍVEL DIA`, `SALDO MOVIMENTAÇÃO CONTA`, `SDO APLIC AUT
  MAIS AP`, `SALDO APLIC. AUT.` — todas têm saldo e não têm valor. O parser precisa
  descartá-las, ou o fluxo de caixa dobra.
- **Aplicação automática.** `APL APLIC AUT MAIS AP` (−57.150,00) é aplicação automática,
  não despesa. Vai para `transfer`. Existe o resgate correspondente.
- **O extrato traz `Razão Social` e `CPF/CNPJ`.** Isso permite casar cliente por CNPJ de
  forma determinística, sem IA nenhuma. É o melhor sinal de categorização que existe no
  arquivo e a Fase 4 deve usá-lo antes de qualquer regra por texto.
- **A planilha `DRE Geral` já é o cronograma de reconhecimento**, espalhado por mês e por
  contrato — com status (`Aberto`/`Finalizado`), tipo (`Ongoing`/`Projeto`/`Referral`/
  `Salesforce`) e forma de cobrança (`Mensal`/`Kickoff`/`1 NF`/`Ciclo`). É a fonte do
  seed da Fase 5, não algo a digitar de novo.
- **A coluna B do bloco de custos marca `cartão` ou `boleto`** em cada linha de despesa.
  Isso é exatamente a distinção da D-C e confirma que a maior parte do opex está no
  cartão — o parser de fatura da Fase 3 é caminho crítico, não acessório.
- **Valores da planilha têm sujeira de float** (`30714.28571`, `8166.666667`). Confirma
  a D17: centavos inteiros, e o import de seed arredonda uma vez, explicitamente.
- **Salesforce aparece como cliente e como fornecedor** (receita R$ 363.548 e custo
  R$ 58.380 no cartão). O mesmo nome em dois papéis; `clients` e vendor são espaços
  separados e não devem ser unificados por nome.

---

## Fase 1 — Auth, entidades, schema, migrations, seed, shell vazio

**Pronto quando:** eu consigo logar, trocar de entidade e ver páginas vazias.

### Fundação
- [x] `npm init` + Next.js 16 (App Router) + TypeScript em `strict` (D21)
- [x] Tailwind + shadcn/ui, tema base
- [x] Vitest configurado, `npm test` verde
- [x] Playwright instalado, um teste E2E de happy path
- [x] ESLint + `tsc --noEmit` no mesmo comando de teste
- [x] `.env.example` com todas as variáveis, `.env.local` no `.gitignore`

### Schema e migrations (D15)
- [x] Drizzle + drizzle-kit; **toda** mudança de schema vira migration versionada
- [x] Tabelas: `entities`, `user_entities`, `accounts`, `categories`, `clients`,
      `people`, `contracts`, `contract_items`, `invoices`, `statement_imports`,
      `staged_transactions`, `cash_entries`, `recognition_entries`, `poc_reports`,
      `categorization_rules`, `transfer_pairs`, `audit_log`
- [x] `entity_id` em **toda** tabela de negócio, inclusive `staged_transactions`,
      `contract_items` e `poc_reports` (D11)
- [x] Dinheiro em `numeric(14,2)`; datas de movimento em `DATE` (D17, D18)
- [x] `unique(entity_id, dedup_hash)` em `cash_entries`
- [x] `unique(contract_id, period, source, kind)` em `recognition_entries` (D12)
- [x] `parent_contract_id`, `version`, `superseded_at` em `contracts` (D13)
- [x] `currency`, `amount_original`, `fx_rate`, `fx_rate_date` em `contracts` e
      `invoices`, nuláveis (D5)
- [x] `is_intercompany` em `contracts`, `cash_entries`, `recognition_entries` (D14e)
- [x] `manually_edited` em `recognition_entries` (D-A)
- [x] RLS habilitada em todas as tabelas, policy via `user_entities` + `auth.uid()`
- [x] Trigger de `audit_log` em `cash_entries`, `recognition_entries`, `contracts`,
      `categorization_rules`

### Domínio
- [x] `lib/money.ts` — centavos inteiros, parse pt-BR, format pt-BR, sem float
- [x] `lib/dates.ts` — `America/Sao_Paulo`, dd/mm/aaaa, mês como primeiro dia

### Auth e navegação
- [x] Supabase Auth por magic link, sem auto-cadastro (D20)
- [x] Middleware de sessão; rota protegida redireciona para login
- [x] Cliente Supabase sempre com o JWT do usuário, nunca service role (D16)
- [x] Rotas `/[entity]/...` com `consolidado` como valor especial (D19)
- [x] Seletor de entidade no header, mostrando só as entidades do usuário

### Seed
- [x] `DD GROUP` — Dynamics Data Consulting Tecnologia LTDA, CNPJ 50.050.390/0001-82
- [x] `GABRIEL SAMPAIO JACOB LTDA - ME`, CNPJ 45.207.742/0001-20
- [x] Conta Itaú do DD GROUP: ag 0561, c/c 0098873-4 — saldo de abertura de 01/01/2026:
      **R$ 510.204,78** (informado em 13/08/2026, Q10 respondida)
- [x] Cartão Itaucard final 4460 — dívida em 01/01/2026 ainda desconhecida, segue 0,00
- [x] Plano de contas derivado da aba `DRE Geral` (receita, impostos, custos diretos,
      custos operacionais, com `dre_group` na ordem da planilha)

### Shell vazio
- [x] Páginas de Fluxo de Caixa, P&L, Contratos, Clientes, Pessoas, Importações,
      Assinaturas, Auditoria — todas com estado vazio honesto ("ainda não construído",
      nunca dado falso, §14)

### Testes desta fase
- [x] Precisão de dinheiro: somar 1.000 lançamentos de R$ 0,01 dá exatamente R$ 10,00
      (teste 8 da §11)
- [ ] Isolamento de entidade no nível do RLS, com usuário sintético restrito a uma
      entidade (teste 6 da §11) — **depende da Q5 do `DECISIONS.md`**
- [x] E2E: visitante anônimo nunca alcança uma entidade; o login responde
- [ ] E2E do caminho completo (login → troca de entidade) — depende da Q6

---

## Fase 2 — Lançamentos manuais + plano de contas + fluxo de caixa

**Pronto quando:** eu digito lançamentos à mão e o fluxo de caixa sai correto.

- [x] CRUD de `categories` com `dre_group` e hierarquia (`parent_id`) — desativa em vez
      de apagar, porque apagar mudaria a classificação de lançamento já feito
- [x] CRUD de `accounts` com saldo de abertura, mostrando o saldo atual de cada conta
- [x] CRUD de `cash_entries`, com edição liberada e trilha de auditoria na própria tela
      do lançamento (D-A)
- [x] Espelho automático para `recognition_entries` ao salvar custo (D2a) — idempotente,
      e nunca sobrescreve linha marcada `manually_edited`
- [x] Campo de override de competência no lançamento (D2b), como coluna
      `cash_entries.competence_period` (D30, migrations 0002 e 0003)
- [x] Pareamento de transferências (`transfer_pairs`), D14b — escolher a conta de destino
      cria a contrapartida e pareia as duas pontas
- [x] Relatório de fluxo de caixa: meses em coluna, categorias em linha, seções de
      entrada e saída, saldo de abertura e fechamento por mês
- [x] Drill-down de qualquer célula para os `cash_entries` que a compõem
- [x] Transferências em seção própria, sem somar em entrada nem saída (D-C, D26)
- [ ] Seed da segunda entidade — **depende da Q2**, nada chegou
- [x] Testes: fluxo de caixa de um mês fechado à mão; saldo de fechamento = abertura +
      entradas − saídas; teste 4 da §11 reescrito, atravessando os dois razões
- [ ] Executar as migrations 0002/0003 e o caminho de escrita contra um Postgres —
      **depende da Q5/Q6** (Q11)

**Decisões novas nesta fase:** D24 a D30 no `DECISIONS.md`.

---

## Fase 3 — Importação de extrato

**Pronto quando:** eu importo um extrato real e aprovo ele para o ledger.

> Os arquivos recebidos em 13/08/2026 mudaram bastante esta fase. Ver a Parte 8 do
> `DECISIONS.md` (achados A1 a A8). Em resumo: o nome do arquivo de fatura não vale nada,
> a fatura é de duas colunas, o layout do XLSX muda entre exportações, e o pagamento de
> fatura casa com a fatura pelo valor exato em 14 de 14 casos.

- [ ] Parser XLSX do extrato Itaú, casando **as colunas pelo cabeçalho** e não pela
      posição (A7), com descarte das linhas de saldo
- [ ] Parser CSV com UI de mapeamento de colunas, salvo como template por conta
- [ ] Tratamento de `1.234,56`, prefixo `R$`, sufixo `D`/`C`, colunas separadas de
      débito e crédito
- [ ] Parser do PDF da fatura Itaucard, trabalhando por **coordenadas** — a fatura é de
      duas colunas e a extração linear intercala as duas (A6)
- [ ] Ler conta, cartão e período **de dentro do PDF**; ignorar o nome do arquivo (A3)
- [ ] **Trava de segurança:** a soma das compras extraídas do PDF precisa bater exato
      com o total impresso; não bateu, recusa a importação e explica (D-B)
- [ ] Ignorar o bloco "Compras parceladas — próximas faturas": são parcelas futuras,
      não lançamentos do período
- [ ] Parear o débito `BUSINESS ...` da conta corrente com a fatura pelo valor exato,
      criando o `transfer_pair` do D14b (A4)
- [ ] Captura de `installment_current`/`installment_total` do parcelado
- [ ] Tudo entra em `staged_transactions`; nada chega em `cash_entries` sem clique
      humano de aprovação
- [ ] `dedup_hash = sha256(account_id | occurred_on | amount | descrição normalizada)`,
      mais dedup por `external_id` quando existir
- [ ] Tela de revisão com aprovar/rejeitar em lote
- [ ] Conferência de saldo importado vs. saldo de fechamento do extrato, com aviso
- [ ] Testes: reimportar o mesmo arquivo gera zero `cash_entries` novos e marca tudo
      como duplicata (teste 5 da §11); teste 4 reescrito (D-C)

---

## Fase 4 — Categorização determinística

**Pronto quando:** transação repetida se auto-categoriza sem IA.

- [ ] Camada 1: match exato por `external_id` ou descrição já vista → reusa a última
      categorização
- [ ] **Match por CNPJ**: o extrato traz `CPF/CNPJ`; casar com `clients.tax_id` antes de
      qualquer regra textual
- [ ] Camada 2: motor de `categorization_rules` por prioridade
      (`contains`/`regex`/`exact`/`amount_range`)
- [ ] "Criar regra a partir deste lançamento", pré-preenchida com o fragmento
      normalizado da descrição
- [ ] Contador de acerto por regra (`hit_count`)
- [ ] Match de salário contra `people` por fragmento de nome
- [ ] Detecção de recorrência (mesmo fornecedor normalizado, ±5 dias, valor parecido,
      3+ ocorrências) → tela de Assinaturas com custo mensal, anualizado e última cobrança
- [ ] Testes: conjunto de descrições reais do extrato de julho/2026 categorizando certo

---

## Fase 5 — Clientes, contratos, NFs e reconhecimento

**Pronto quando:** eu crio um contrato e vejo o cronograma de reconhecimento.

- [ ] CRUD de `clients` e `people` (com `vinculo`, `cargo`, `squad`, gestor — a aba
      `Colaboradores` tem tudo isso)
- [ ] CRUD de `contracts` com `retainer`/`project` e versionamento por aditivo (D13)
- [ ] CRUD de `invoices` (NF), com `service_period` definindo a competência (D6)
- [ ] Conciliação NF ↔ recebimento ↔ reconhecimento
- [ ] Motor de reconhecimento, idempotente, que não sobrescreve linha editada à mão
- [ ] Linha reta para retainer, com proração por dias corridos e toggle de "mês cheio"
      (D14f)
- [ ] Retainer sem data de fim reconhece enquanto `status = active`
- [ ] Tela de POC: lista todos os projetos abertos para uma pessoa preencher em lote (D1)
- [ ] POC cumulativo com delta calculado; flag de correção permite queda
- [ ] Mês sem POC = zero reconhecido + entra na lista de "relatórios faltando"
- [ ] Fechar projeto como `completed` força 100% e reconhece o resto
- [ ] Importador do `DRE Geral` para semear contratos e cronogramas de 2026
- [ ] Testes: testes 1 e 2 reescrito (D-E) e 3 da §11

---

## Fase 6 — P&L gerencial e consolidado

**Pronto quando:** os números batem com os testes de aceitação da §11.

- [ ] P&L por entidade: receita bruta → deduções → receita líquida → custos diretos →
      margem bruta → despesas operacionais agrupadas → EBITDA → impostos → resultado
      líquido, na ordem de `dre_group`
- [ ] Meses em coluna, drill-down para `recognition_entries`
- [ ] Consolidado: coluna por entidade + total, com eliminação de intercompany (D14e)
- [ ] Receita por cliente: reconhecida vs. recebida, por mês
- [ ] Receita diferida / backlog por contrato, com "Receita a faturar" em coluna própria
      (D14a) — **este é o relatório que caça bug entre os dois ledgers**
- [ ] Folha por pessoa
- [ ] Resolver Q1 (impostos), Q3 (férias), Q7 (rateio por cliente)
- [ ] Testes: testes 1, 3, 7 e 8 da §11, mais reconciliação dos dois ledgers

---

## Fase 7 — Camada de IA

**Pronto quando:** sugestões aparecem como rascunho que um humano confirma.

- [ ] `lib/ai/provider.ts` — interface única, modelo trocável, chave em env
- [ ] Sugestão de categoria em lote para o que sobrou sem categorizar, JSON estrito
- [ ] Todo id retornado é validado contra o banco; o que não resolve é descartado
- [ ] Grava só em `suggested_*`; **nenhuma chamada de LLM escreve em tabela de ledger**
- [ ] Confiança abaixo de 0,8 aparece mas não vem pré-selecionada
- [ ] Extração de contrato em PDF/DOCX → `contracts.extracted_json`, `status = 'draft'`,
      com o trecho de origem ao lado do valor extraído
- [ ] Nenhum valor usado em cálculo vem do LLM — número vem sempre do parser
- [ ] Testes: LLM mockado; id inválido é descartado; nada entra no ledger

---

## Fase 8 — Dashboards, exports, auditoria

**Pronto quando:** eu exporto qualquer coisa que eu consiga ver.

- [ ] Export XLSX e CSV de todo relatório, com os mesmos números da tela
- [ ] Dashboard com os indicadores que a planilha já acompanha (receita do mês, OPBB,
      margem) — depende da Q4 para as metas
- [ ] Tela de audit log com filtro por tabela, ator e período
- [ ] Diff antes/depois legível em cada linha do audit log
