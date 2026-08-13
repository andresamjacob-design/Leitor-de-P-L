# DECISIONS

Registro das decisões tomadas antes do código. Cada uma tem a resposta do Andre e a
consequência de implementação. Quando uma decisão contraria o `SPEC.md`, isso está
marcado explicitamente — o SPEC não é reescrito, este arquivo prevalece sobre ele.

Data da rodada de decisões: 12/08/2026.

---

## Parte 1 — Perguntas da seção 12 do SPEC

### D1 — Quem reporta % de conclusão (POC)
**Uma pessoa para todos os projetos.**
→ Sem `owner_user_id` em `contracts`. A tela de POC lista todos os projetos abertos
de uma vez, para um único responsável preencher em lote.

### D2 — Custos em competência
**Os dois regimes, sempre.** Fluxo de caixa usa a data real do pagamento; P&L usa a
competência.
→ Todo custo existe nas duas tabelas: `cash_entries` (data do pagamento) e
`recognition_entries` (mês de competência). A regra da §5 do SPEC — "P&L lê apenas
`recognition_entries`" — passa a valer integralmente, para receita e custo.

**D2a — Espelho automático.** Ao aprovar um `cash_entry` de custo, o sistema gera
automaticamente a `recognition_entry` correspondente no mês do `occurred_on`, com
`source = 'cash_mirror'`. O usuário só intervém quando a competência difere.

**D2b — Override de competência.** Casos reais de divergência informados: **salários**
e **pagamentos de cartão de crédito**. O lançamento tem campo de competência
sobreponível. O mecanismo subjacente (um `cash_entry` → N `recognition_entries` com
períodos e valores arbitrários) também cobre rateio em N meses, sem schema adicional.

**D2c — Provisões.** A empresa não paga 13º → sem tabela `accruals` por ora.
⚠️ Ver Q3 em "Pendências": a planilha `Colaboradores` provisiona **férias** a
1/12 + 1/36 ao mês (R$ 204.032,56 no ano), o que contradiz esta decisão.

### D3 — Orçado vs. realizado
**Só realizado.** Sem tabela `budgets`.
⚠️ A planilha tem coluna `METAS` (meta de receita 2026 = R$ 7.000.000) e `OPBB %`
contra meta de 36%. Isso é orçado. Ver Q4 em "Pendências".

### D4 — Bancos e cartões
**Só Itaú.** Conta corrente exportada em CSV/XLSX; fatura do cartão em PDF.
→ Inverte a prioridade da §7 do SPEC (que manda fazer OFX primeiro e PDF por último).
Ver D-B na Parte 2.

### D5 — Moeda estrangeira
**Existe** (Salesforce, Medika, Harpix pagam em dólar), **mas o banco converte antes de
creditar**, então o caixa é sempre BRL.
→ `contracts` e `invoices` ganham `currency`, `amount_original`, `fx_rate`,
`fx_rate_date` (nuláveis, preenchidos à mão, sem API externa). `cash_entries` é
BRL-only. Nenhuma lógica de variação cambial na v1; se um dia o dinheiro entrar em USD
sem conversão, o campo já existe e a lógica entra sem migração de retrofit.

### D6 — Notas fiscais
**Sim, modelar.** É preciso saber quando a NF foi emitida e casar com quando foi paga.
→ Nova tabela `invoices`. **A NF define a competência** (`service_period`), não a data
de emissão. Retenções na fonte: Andre acredita que não há — campos criados nuláveis,
sem UI, para não exigir migração se aparecerem.
→ Não conflita com o não-objetivo "emissão para sistemas do governo" da §13: o sistema
apenas **registra** NFs emitidas em outro lugar, nunca emite.

### D7 — Usuários e papéis
**Só os sócios e o Andre, todos com acesso total.**
→ Coluna `role` mantida em `user_entities` para o futuro, mas nada é barrado hoje.
O teste 6 da §11 (isolamento entre entidades) continua valendo e é testado com um
usuário sintético com acesso a uma entidade só, no nível do RLS.

### D8 — Mistura pessoal/empresarial
**Não mistura.** Sem flag `is_personal`.

### D9 — Backfill histórico
**2026.** Saldo de abertura das contas em 01/01/2026.

### D10 — Fechamento de período
**Não haverá trava.** "Às vezes é necessário editar."
→ Ver D-A na Parte 2. Sem tabela `period_closings`.

---

## Parte 2 — Conflitos com o SPEC e como foram resolvidos

Propostos por mim, não contestados pelo Andre. **Se algum estiver errado, corrigir agora
é barato; depois da Fase 2 não é.**

### D-A — Nada trava (contraria §5 e §9)
O SPEC diz `cash_entries` imutável após aprovação e períodos fechados travados. A
resposta D10 diz o contrário.
→ Tudo editável. Em troca: toda edição grava `before_json`/`after_json` no `audit_log`,
e a linha mostra "editado em X por Y" na tela. O motor de reconhecimento continua
idempotente e **nunca sobrescreve linha marcada `manually_edited`**.

### D-B — CSV/XLSX primeiro, PDF obrigatório (contraria §7)
→ Ordem de construção: XLSX/CSV do extrato Itaú → PDF da fatura Itaú → OFX (adiado,
possivelmente nunca).
→ Para respeitar "nunca adivinhe número de PDF" da §7: o parser da fatura **só aceita a
importação se a soma das compras extraídas bater exatamente com o total impresso no
PDF**. Não bateu, recusa e explica.

### D-C — Cartão de crédito (contraria o teste 4 da §11)
Fluxo de caixa = data em que a fatura é paga. P&L = data da compra.
→ As compras entram numa conta `credit_card`; o débito no banco é o movimento de caixa.
No fluxo de caixa, a fatura é **explodida nas categorias das compras, na data do
pagamento** — assim o fluxo mostra o valor já quebrado por categoria, sem virar um
lump de "pagamento de fatura".

**Teste 4 reescrito:** 3 compras somando R$ 1.200 em fevereiro + débito de R$ 1.200 em
10/03 → P&L fev = R$ 1.200 · P&L mar = R$ 0 · Fluxo fev = R$ 0 · Fluxo mar = R$ 1.200 ·
despesa total = R$ 1.200, nunca R$ 2.400.

### D-D — Multi-moeda parcial (contraria §13)
Ver D5. A §13 diz "sem multi-moeda"; passa a valer "sem *relatório* multi-moeda". Todo
relatório continua em BRL.

### D-E — Teste 2 da §11 é impossível como escrito
O teste referencia fevereiro num contrato que começa em 01/03/2026. Reescrito por mim,
conforme autorizado:

> Projeto de R$ 50.000, 5 meses, início **01/02/2026**. Fevereiro reportado 30%
> cumulativo → R$ 15.000. Março reportado 25% cumulativo com flag "correção" → março
> reconhece **−R$ 2.500**, acumulado fica R$ 12.500, e a linha de fevereiro não é tocada.

---

## Parte 3 — Correções de schema (aprovadas)

### D11 — `entity_id` em todas as tabelas
`staged_transactions`, `contract_items` e `poc_reports` não tinham. Passam a ter, com
RLS direta, sem depender de join.

### D12 — Unique de `recognition_entries`
`unique(contract_id, period, source)` → **`unique(contract_id, period, source, kind)`**.
Sem isso, receita e custo do mesmo contrato no mesmo mês colidiriam.

### D13 — Versionamento de contrato
`contracts` ganha `parent_contract_id`, `version`, `superseded_at`. Aditivo cria versão
nova; períodos já reconhecidos nunca são reescritos.

### D14 — Outras decisões menores
- **D14a** Receita diferida negativa aparece em coluna própria ("Receita a faturar"),
  não como número negativo escondido.
- **D14b** Pareamento explícito de transferência (`transfer_pairs`) — "nem sempre o
  débito é fatura".
- **D14c** Impostos: só o que veio no extrato, sem cálculo de alíquota.
  ⚠️ Contradiz a planilha. Ver Q1 em "Pendências".
- **D14d** POC aceita reporte depois do fim do contrato ("às vezes as coisas atrasam").
- **D14e** `is_intercompany` em `contracts`, `cash_entries` e `recognition_entries`.
- **D14f** Proração: dias corridos reais do mês, contando o dia de início.
  Abril: 16/30. Março: 17/31. Decisão reversível, não confirmada pelo Andre.
- **D14g** `audit_log.actor` = id do usuário, ou a string `'system'` para o motor.
- **D14h** Salário: competência = mês anterior ao pagamento, por padrão. Exceção real:
  o salário de janeiro às vezes é adiantado para dezembro → resolvido pelo override D2b.

---

## Parte 4 — Decisões técnicas

### D15 — Migrations
**Drizzle ORM + drizzle-kit**, com as policies de RLS escritas como SQL nos mesmos
arquivos de migration. Nunca alterar tabela pelo painel do Supabase.

### D16 — RLS de verdade
Todas as queries do app rodam com o **JWT do usuário** (`@supabase/ssr`), nunca com
service role — senão o RLS é ignorado e o teste 6 da §11 passa falsamente. A service
role fica restrita a duas operações server-side explícitas e isoladas: motor de
reconhecimento e gravação de importação.

### D17 — Dinheiro
**Inteiro em centavos (`bigint`)** em todo o domínio TS. `numeric(14,2)` no Postgres.
Conversão só na borda: parser na entrada, formatação pt-BR na saída. Sem `decimal.js`.

### D18 — Datas
`occurred_on` e `period` são `DATE` puro, nunca `timestamptz`, para não sofrer
deslocamento de fuso. `created_at` continua `timestamptz`.

### D19 — Troca de entidade
Segmento na URL: `/[entity]/fluxo-de-caixa`, com `consolidado` como valor especial.

### D20 — Auth
Supabase Auth com magic link por e-mail. Sem auto-cadastro: usuários são convidados e
vinculados à mão em `user_entities`.

### D21 — Gerenciador de pacotes — **mudou**
Eu havia proposto pnpm e foi aprovado, mas **pnpm não está instalado nesta máquina** e
`npm` 11.12.1 está. Uso **npm**, para não exigir instalação global. Node 24.15.0.

### D22 — Ambiente de testes — **mudou**
Eu havia proposto Supabase local via Docker, mas **não há Docker nesta máquina**.
Ver Q5 em "Pendências". Testes que não precisam de banco (precisão de dinheiro, motor
de reconhecimento, proração, parsers) rodam sem nada disso.

### D23 — Dependências autorizadas fora da §3
- `exceljs` — ler o XLSX do Itaú e gerar os exports XLSX da §10.
- `unpdf` — extrair texto do PDF da fatura. Confirmado que o PDF é texto (71 fontes com
  encoding próprio), não escaneado; precisa de extrator com CMap de verdade.

---

## Parte 6 — Decisões tomadas na Fase 2

Propostas por mim durante a construção. Todas são reversíveis, mas ficam mais caras
depois da Fase 3, quando o importador começar a gravar em cima delas.

### D24 — Pró-labore é despesa, não retirada
A conta `6.11 Pró-labore` estava com `kind = owner_draw`, o que a deixaria fora do DRE.
A planilha `DRE Geral` a carrega **dentro de Pessoal**, acima da linha. Passou a
`expense`. `owner_draw` fica só para `99.04 Distribuição de lucros`, que é abaixo da
linha. Consequência prática: pró-labore agora gera competência automática; distribuição
de lucros, não.

### D25 — O fluxo de caixa só olha conta de dinheiro
Contas de tipo `bank`, `cash` e `investment` entram; `credit_card` fica de fora. Uma
compra no cartão não é saída de caixa — é dívida. Somar as duas coisas é exatamente o
erro que a D-C existe para evitar. A tela diz quais contas entraram e quais ficaram
de fora, em vez de omitir em silêncio.

### D26 — Transferência tem seção própria e mexe no saldo
A D-C manda tirar transferência de entrada e de saída. Mas o dinheiro **saiu da conta**,
então ela continua no saldo final. O relatório tem, nesta ordem: saldo inicial ·
entradas · saídas · **resultado de caixa** (entradas − saídas) · transferências ·
**movimento líquido** (com transferências) · saldo final.

`saldo final = saldo inicial + entradas − saídas + transferências líquidas`, e essa
identidade é testada.

### D27 — Consolidado é só de leitura
Um lançamento pertence a um CNPJ, e "as duas entidades somadas" não é um CNPJ. Relatório
funciona consolidado; formulário não — a tela oferece o link para escolher a entidade.
No consolidado, as linhas são unidas **pelo código** da categoria, senão "Salários"
apareceria duas vezes, uma por entidade.

### D28 — Lançamento manual usa o mesmo hash de dedup do importador
`sha256(conta | data | valor | sentido | descrição normalizada)`. Se você digitar um
movimento que o importador já trouxe, o banco recusa e o formulário pergunta se era
mesmo uma segunda ocorrência. Marcando "gravar mesmo assim", o hash ganha um sufixo e
passa. Isso mantém a §7 valendo para dado digitado, não só para dado importado.

### D29 — Lançamento e espelho não são atômicos
O REST do Supabase não tem transação de várias instruções. Mitigação: o espelho é
**idempotente** (é derivado inteiro do lançamento, então salvar de novo conserta
qualquer divergência) e, se o espelho falhar num lançamento novo, o lançamento é
desfeito em vez de virar órfão. Numa **edição**, se o espelho falhar, o lançamento fica
salvo e o erro aparece na tela — salvar de novo resolve. A alternativa seria uma função
plpgsql, que duplicaria a regra de competência em duas linguagens; a regra está testada
em TypeScript e é melhor que ela exista uma vez só.

### D30 — A competência é uma coluna do lançamento
`cash_entries.competence_period`, nulável, sempre primeiro dia do mês. Nulo significa
"o mês da data do movimento". Guardar no lançamento (e não só na linha de competência)
deixa o motor de espelho derivável e permite, sem migração nova, o rateio em N meses:
um `cash_entry` → N `recognition_entries`.

### D31 — O seed preenche saldo de abertura, nunca sobrescreve
O saldo de 01/01/2026 da conta corrente (R$ 510.204,78) está no seed. Rodar o seed de
novo só preenche um saldo que ainda esteja zerado — um valor corrigido na tela de Contas
é preservado. Sobrescrever moveria em silêncio todos os saldos de fechamento do
relatório.

---

## Parte 7 — Pendências abertas

Precisam de resposta antes da fase indicada.

| # | Pendência | Bloqueia |
|---|---|---|
| Q1 | **Impostos.** D14c diz "só o que veio no extrato", mas a planilha calcula imposto como alíquota sobre a receita (`Imposto Total` 17% + `ISS` 3,4%, com ajuste manual — jan: receita 398.891,56 → imposto 77.667,59, que não é 17% exatos). Qual dos dois vale? | Fase 6 |
| Q2 | **Segunda entidade.** Não chegou nenhuma planilha nem extrato da `GABRIEL SAMPAIO JACOB LTDA - ME`. O SPEC fala em três planilhas; chegou uma. | Fase 2 |
| Q3 | **Férias.** D2c diz "sem provisão", mas a aba `Colaboradores` provisiona férias a 1/12 + 1/36 ao mês (R$ 204.032,56 no ano) — e a aba `DRE Geral` mostra R$ 0 na linha de férias. As duas abas discordam entre si. Qual vale? | Fase 6 |
| Q4 | **Metas.** D3 diz "só realizado", mas a planilha tem meta de receita (R$ 7.000.000) e meta de OPBB (36%). Quer isso na tela ou fica fora? | Fase 8 |
| Q5 | **Onde rodam os testes de RLS.** Sem Docker, as opções são: (a) `@electric-sql/pglite` — Postgres real em WASM, roda no Vitest, sem Docker, precisa de autorização de dependência; (b) instalar Docker Desktop; (c) um projeto Supabase de teste na nuvem. Recomendo (a). | Fase 1 (fechamento) |
| Q6 | **Projeto Supabase.** Preciso da URL e das chaves de um projeto Supabase para o login funcionar de ponta a ponta. | Fase 1 (fechamento) |
| Q7 | **Rateio de pessoas por cliente/squad.** A aba `Colaboradores` aloca cada pessoa a um cliente e a um squad. Isso permite margem por cliente, que é mais do que o "payroll por pessoa" da §10. Quer? | Fase 6 |
| Q8 | **Pipeline de vendas.** A aba `Vendas e Perdas` é um CRM (cliente, status, responsável, valor). Nenhuma fase do SPEC cobre isso. Fica fora? | — |
| Q9 | **Arquivo alheio na pasta.** `docs/reference/Cópia de Autorização de saída - Saint Paul 21_08.docx.pdf` é uma autorização de saída escolar, não tem relação com o financeiro. Não abri. Apagar? | — |
| ~~Q10~~ | ~~**Saldo de abertura de 01/01/2026.**~~ **Respondido em 13/08/2026:** a conta corrente Itaú tinha **R$ 510.204,78** em 01/01/2026. Está no seed. A dívida do cartão Itaucard na mesma data continua desconhecida e segue em 0,00. | — |
| Q11 | **Nada do caminho de escrita foi executado contra um Postgres.** Sem projeto Supabase (Q6) e sem Docker/PGlite (Q5), o que está testado é a lógica pura: 83 testes cobrindo dinheiro, datas, dedup, espelho de competência e o relatório inteiro. As migrations 0002/0003 nunca rodaram. Isto é o que mais me preocupa hoje. | Fase 3 |
