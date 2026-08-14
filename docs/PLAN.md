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
| 3 | Importação de extrato: XLSX/CSV + PDF de fatura, dedup, tela de revisão | ✅ construída — parsers validados contra 34 arquivos reais; escrita ainda não rodou contra Postgres (Q11) |
| 4 | Categorização: motor de regras determinístico + aprendizado de regra | ✅ construída — nada rodou contra Postgres (Q11) |
| 5 | Clientes, contratos, NFs, cronogramas de reconhecimento, POC | ✅ construída — sem o importador da `DRE Geral` (D51/Q16); nada rodou contra Postgres (Q11) |
| 6 | P&L gerencial por entidade + consolidado | ✅ construída — Q1, Q3 e Q7 continuam abertas; nada rodou contra Postgres (Q11) |
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
- [x] Conta Itaú do DD GROUP: ag 0561, c/c 0098873-4 — abertura de 01/01/2026
      **R$ 142.469,28**, o número do próprio extrato (A1)
- [x] CDB DI como conta de aplicação, abertura **R$ 367.735,49** (D32). As duas somam a
      posição de R$ 510.204,77 que o Andre informou
- [x] Duas contas de cartão: `Itaucard Empresas — final 5780` e `Itaucard — final 8299`
      (A2). Dívida de 01/01/2026 ainda desconhecida nas duas, segue 0,00
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

- [x] Leitor de xlsx próprio — o `exceljs` autorizado falha em 3 de 3 extratos do Itaú
      (D34)
- [x] Parser XLSX do extrato Itaú, casando **as colunas pelo cabeçalho** e não pela
      posição (A7), com descarte das linhas de saldo
- [x] Descartar a varredura da aplicação automática, que não é movimento de dinheiro
      (D35) — é o que faz os quatro extratos reais fecharem todo dia
- [x] Parser CSV pelo mesmo casamento por cabeçalho
- [ ] UI de mapeamento de colunas salva como template por conta — **adiada** (D39):
      nenhum arquivo recebido precisa dela
- [x] Tratamento de `1.234,56`, prefixo `R$`, sufixo `D`/`C`, colunas separadas de
      débito e crédito
- [x] Parser do PDF da fatura por **coordenadas**, com detecção de coluna pela
      distribuição de posições (D38)
- [x] Ler conta, cartão e período **de dentro do PDF**; ignorar o nome do arquivo (A3)
- [x] **Trava de segurança:** a soma das compras precisa bater exato com o total
      impresso; não bateu, recusa e explica (D-B, D37)
- [x] Ignorar o bloco "Compras parceladas — próximas faturas"
- [ ] Parear o débito `BUSINESS ...` da conta corrente com a fatura pelo valor exato
      (A4) — o pareamento manual da Fase 2 já cobre; o automático fica para a Fase 4
- [x] Captura de `installment_current`/`installment_total` do parcelado
- [x] Tudo entra em `staged_transactions`; nada chega em `cash_entries` sem clique
      humano de aprovação
- [x] `dedup_hash = sha256(conta | data | valor | sentido | descrição normalizada)`
- [x] Tela de revisão com aprovar/rejeitar em lote e categoria por linha
- [x] Conferência de saldo importado vs. saldo declarado, com aviso (D37)
- [x] Recusar o mesmo arquivo duas vezes, pelo hash do conteúdo
- [x] Testes: 45 testes novos de parser, mais `npm run verify:import`, que roda os
      importadores sobre os arquivos reais — **34 de 34 conferem**
- [ ] Teste 5 da §11 (reimportar não cria nada) só é executável contra um Postgres (Q11)

---

## Fase 4 — Categorização determinística

**Pronto quando:** transação repetida se auto-categoriza sem IA.

> A ordem das camadas mudou em relação ao esboço acima — ver **D40**. Regra explícita
> passa na frente do histórico, e identidade (CNPJ) na frente de texto.

- [x] Motor determinístico com cinco camadas, puro e explicável: toda sugestão vem com o
      motivo em português e uma confiança
- [x] **Match por CNPJ** antes de qualquer regra textual — é o que separa a Salesforce
      cliente da Salesforce fornecedora
- [x] Reuso da última categorização, por CNPJ e por descrição normalizada
- [x] Motor de `categorization_rules` por prioridade
      (`contains`/`regex`/`exact`/`amount_range`), com escopo opcional por conta e por
      faixa de valor
- [x] "Criar regra a partir deste lançamento", já preenchida — com CNPJ vira regra de
      identidade (`*`), sem CNPJ vira o trecho da descrição sem o que muda todo mês
- [x] Contador de acerto por regra (`hit_count`)
- [x] Match de salário contra `people`, exigindo dois pedaços do nome, com confiança
      abaixo de 0,8 para não vir pré-selecionado
- [x] Sugestão automática nas linhas de uma importação, logo depois do staging
- [x] Varredura em lote do que está sem categoria — só sem categoria, e pelo caminho
      normal de escrita, para o espelho de competência ser criado (D41)
- [x] Detecção de recorrência → tela de Assinaturas com custo mensal, anualizado, última
      cobrança e marcação de encerrada (D42)
- [x] Testes: 47 testes de categorização, incluindo descrições reais de fatura
- [x] `npm run verify:import` também reconstrói as assinaturas dos arquivos reais —
      **9 encontradas, R$ 5.279,84 por mês**
- [ ] `external_id` não é usado: os arquivos do Itaú não trazem um (D44)

---

## Fase 5 — Clientes, contratos, NFs e reconhecimento

**Pronto quando:** eu crio um contrato e vejo o cronograma de reconhecimento.

- [x] CRUD de `clients` e `people` (com vínculo, cargo, squad, gestor), com validação de
      dígito de CPF/CNPJ na digitação (D50)
- [x] CRUD de `contracts` com `retainer`/`project` e versionamento por aditivo (D13)
- [x] CRUD de `invoices` (NF), com `service_period` definindo a competência (D6) — e a NF
      **não** gera reconhecimento, senão a receita entraria duas vezes (D45)
- [x] Conciliação reconhecido ↔ faturado ↔ recebido, mês a mês, na tela do contrato
- [x] Motor de reconhecimento puro e idempotente, que nunca sobrescreve linha editada à
      mão e remove o que deixou de sustentar (D49)
- [x] Linha reta para retainer, com proração por dias corridos e toggle de "mês cheio"
      (D14f, D47)
- [x] Retainer sem data de fim reconhece enquanto `status = active`
- [x] Tela de POC em lote: todos os projetos abertos numa tela só (D1)
- [x] POC cumulativo com delta calculado; flag de correção permite queda
- [x] Mês sem POC = zero reconhecido + aparece na lista de relatórios faltando
- [x] Fechar projeto como `completed` reconhece o saldo que faltava
- [x] Receita diferida por contrato, com "Receita a faturar" quando fica negativa (D14a)
- [ ] Importador do `DRE Geral` — **não construído** (D51): a aba não tem os campos que um
      contrato precisa, e inferi-los geraria cronograma errado em silêncio. Ver Q16
- [x] Testes: **testes 1, 2 (reescrito pela D-E) e 3 da §11**, com os números exatos da
      spec, mais 49 testes de motor e percentual

---

## Fase 6 — P&L gerencial e consolidado

**Pronto quando:** os números batem com os testes de aceitação da §11.

- [x] P&L por entidade na ordem de `dre_group`: receita bruta → deduções → receita
      líquida → custos diretos → margem bruta → despesas operacionais → EBITDA → sócios →
      resultado do período
- [x] Meses em coluna, com drill-down para `recognition_entries` na nova tela de
      **Competência** (D57)
- [x] Consolidado: coluna por entidade + **eliminações** + total (D53, D14e)
- [x] Receita por cliente: reconhecida contra recebida, mês a mês
- [x] Receita diferida por contrato, com "Receita a faturar" em coluna própria (D14a)
- [x] Folha por pessoa, dizendo quanto de custo ainda não tem pessoa amarrada (D56)
- [x] Os dois razões lado a lado, com o aviso de que não é para bater (D52)
- [x] Q1, Q3 e Q7 respondidas em 14/08/2026: imposto é o que foi pago (D58), férias não
      são provisionadas (D59) e margem por cliente entra na Fase 8 (D60)
- [x] Testes: **§11.7 (consolidação) e §11.8 (precisão)** no DRE, mais 19 testes de
      montagem, eliminação e ordem das linhas. Os testes 1 e 3 já estavam cobertos no
      motor de reconhecimento (Fase 5)

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
- [ ] **Margem por cliente**: receita do cliente menos o custo das pessoas alocadas nele,
      usando `people.client_id` (D60, respondendo à Q7)
- [ ] Tela de audit log com filtro por tabela, ator e período
- [ ] Diff antes/depois legível em cada linha do audit log
