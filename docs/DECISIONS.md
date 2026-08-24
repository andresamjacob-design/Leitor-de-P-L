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

### D32 — O CDB é uma conta de aplicação (respondendo à Q12)
Conta `Itaú — CDB DI`, tipo `investment`, abertura R$ 367.735,49 em 01/01/2026.
Aplicação e resgate são transferências entre ela e a conta corrente, pareadas pelo D14b
e classificadas em `99.03`. O fluxo de caixa passa a mostrar a **posição total de
caixa** — as duas contas somam R$ 510.204,77 na abertura, contra os R$ 510.204,78
informados. O centavo de diferença é herdado, não corrigido: o valor usado é o do
resgate de 07/01, que já embute alguns dias de rendimento, então o saldo exato de 01/01
seria alguns reais **menor**. Inventar o número certo seria pior do que carregar a
diferença à vista.

Consequência conhecida: entre um resgate e outro, o saldo do CDB fica defasado, porque
o rendimento fica dentro dele e só aparece quando é resgatado. A conta corrente continua
batendo com o banco ao centavo, que é o que importa para conciliação.

### D33 — Banco 301 fica fora (respondendo à Q14)
A conta `Banco 301, ag 0001, c/c 3111117-6` está encerrada. O extrato dela (jan–out/2025)
fica em `docs/reference/` como histórico e **não** entra no sistema. A D4 ("só Itaú")
segue valendo, agora confirmada em vez de suposta.

### D34 — Leitor de xlsx próprio, porque o `exceljs` não lê os arquivos
O `exceljs` estava autorizado (D23) e **falha em 3 de 3 extratos do Itaú**: o gerador do
banco escreve `<coreProperties>` com um `lastModifiedBy` sem o prefixo `cp:`, e a
biblioteca estoura com `Unexpected xml node in parseOpen`. Só abriu a planilha exportada
do Google Sheets. Uma biblioteca que não lê os arquivos que o sistema existe para
importar não vale a dependência.
→ `src/lib/import/xlsx.ts`: zip com `node:zlib`, SpreadsheetML na mão, só o necessário
(strings compartilhadas, texto embutido, números, serial de data). Testado contra um
xlsx montado no próprio teste, e rodado contra os arquivos reais pelo
`npm run verify:import`. O `exceljs` foi desinstalado; o `unpdf` ficou.

### D35 — A varredura da aplicação automática não é movimento
A conta corrente é varrida todo dia para uma aplicação automática, então fecha com
R$ 1,00 e o dinheiro aparece em `SALDO APLIC. AUT.`. O extrato traz três saldos:

    SALDO TOTAL DISPONÍVEL DIA = SALDO MOVIMENTAÇÃO CONTA + SALDO APLIC. AUT.

O saldo que responde "quanto a empresa tem" é o **total**, e é contra ele que a
importação confere. As linhas `APL APLIC AUT MAIS` e `RES APLIC AUT MAIS` são o mesmo
dinheiro trocando de prateleira dentro do mesmo saldo e **não viram lançamento** —
lançá-las dobraria o fluxo de caixa. Já `REND PAGO APLIC AUT MAIS` é rendimento de
verdade e entra.

Isso é diferente do CDB (D32), que é aplicação deliberada, em conta própria, com
transferência pareada.

Com essa regra os quatro extratos reais fecham **todo dia**: 175, 99, 13 e 9 dias
conferidos, zero divergências.

### D36 — `SALDO EM CONTA CORRENTE` não é ponto de conferência
É o saldo no instante da exportação, não o fechamento do dia: já embute rendimento
creditado depois do último movimento, e diferia por R$ 5,25 e R$ 4,82 nos arquivos reais.
Fica registrado, mas a conferência usa só `SALDO TOTAL DISPONÍVEL DIA`.

### D37 — Extrato avisa, fatura recusa
Assimetria proposital. Um extrato que não fecha ainda é o registro do próprio banco: a
importação segue com o aviso de quais dias divergem. Uma fatura que não bate com o
`Total dos lançamentos atuais` impresso significa que a **leitura das colunas errou**, e
uma leitura errada não pode virar lançamento — a importação é recusada (D-B).

### D38 — Colunas do PDF pela distribuição de posições
A fatura tem duas colunas e três layouts diferentes entre as contas 5780 e 8384. Detectar
coluna por onde começam as datas falha quando a coluna da direita só tem texto corrido —
e aí `Encargos cobrados nesta fatura`, impresso ao lado das compras, fecha a seção de
lançamentos no meio. Detectar por agrupamento encadeado falha ao contrário: a coluna de
valores fica a 172pt das datas e vira "coluna", arrancando o valor de cada linha.
→ Picos do histograma de posições de início de texto, com separação mínima de **190pt**,
que fica entre o maior falso positivo observado (172pt, a coluna de valores) e a menor
separação real (198pt).
→ E o valor de cada linha é escolhido pelo `VALOR EM R$` do cabeçalho da tabela, não pelo
último número da linha.

**Resultado:** as 28 faturas reais — 2 contas, 4 layouts, 2025 e 2026 — batem ao centavo
com o total que cada uma imprime.

### D39 — O mapeamento de colunas de CSV ficou de fora
A §7 pede uma tela de mapeamento de colunas salva como template por conta. Todo arquivo
real recebido é xlsx com cabeçalho que o parser já entende, e o CSV passa pelo mesmo
casamento por cabeçalho. Uma tela de mapeamento sem nada para mapear seria adivinhação.
Entra quando aparecer um arquivo que precise dela.

## Parte 14 — O banco de verdade (14/08/2026)

### D75 — O teste de RLS roda no projeto real, numa transação revertida
A Q5 listava PGlite, Docker ou um projeto de teste. Nenhuma foi necessária: o RLS lê
`auth.uid()`, que o Supabase deriva de `request.jwt.claims`, e esse ajuste pode ser feito
na própria conexão — que é exatamente o que uma sessão faz.

`scripts/verify-rls.ts` cria um usuário sintético com acesso a uma entidade só, insere
dado nas duas, confere que nada da outra aparece nem aceita escrita, e **reverte tudo**.
Rodar contra o banco de produção é seguro por construção. Zero dependência nova.

**Resultado:** 7 de 7 verificações passam. O teste 6 da §11 estava aberto desde a Fase 1.

Uma sutileza que a primeira versão errou: em Postgres, um comando que falha aborta a
transação inteira. A violação proposital de RLS precisa de um `savepoint`, senão as
verificações seguintes simplesmente não rodam — e o script termina "verde" tendo
conferido menos do que diz.

### D76 — A conexão é pelo session pooler, não pela direta
A Supabase moveu `db.<ref>.supabase.co` para **IPv6-only**. O registro AAAA existe, mas o
`getaddrinfo` do macOS devolve `ENOTFOUND`, então `drizzle-kit` e o seed não conectam. O
`.env.example` agora traz o formato do session pooler, que é IPv4.

A região do projeto (`sa-east-1`) foi descoberta sondando os poolers: as outras regiões
respondem "tenant não encontrado", e só a certa chega a reclamar da senha.

---

## Parte 15 — O que o primeiro import real quebrou (14/08/2026)

Cinco bugs em um arquivo. Nenhum aparecia nos 309 testes, porque todos moram na
fronteira entre o app e o PostgREST — a fronteira que a Q11 dizia não ter sido exercitada.

### D77 — `parseMoney` cortava um dígito de valor inteiro
**O mais grave.** O PostgREST serializa `numeric` como **número JSON**: `800.00` chega
como `800`, sem ponto. Com o separador declarado, `lastIndexOf(".")` devolvia −1 e
`slice(0, -1)` derrubava o último dígito — **R$ 800,00 virava R$ 80,80**.

327 das 426 linhas do primeiro extrato saíram erradas. Nenhum teste pegou porque o
`postgres.js` devolve `"800.00"` como string, com o ponto.

→ `parseMoney` trata separador ausente como "sem parte fracionária". Teste de ida e volta
agora cobre as duas formas que o banco devolve, string e número.

### D78 — O hash de dedup destruía folha de pagamento
O extrato escreve `PIX ENVIADO` na descrição e põe a pessoa em **outra coluna**. Quatro
pagamentos de R$ 4.000 no mesmo dia para quatro pessoas geravam o mesmo hash: um entrava e
três viravam "duplicata". 29 grupos afetados no primeiro arquivo.

→ A contraparte (CNPJ, ou nome) entra no hash.

E duas linhas **genuinamente idênticas** no mesmo extrato são dois movimentos, não uma
duplicata: cada repetição recebe o índice da sua ocorrência. Reimportar o mesmo arquivo
reproduz os mesmos índices e casa um a um, que é o que o teste 5 da §11 exige.

→ A aprovação carrega o hash que a linha já tinha; recalculá-lo perderia o índice e a
reimportação deixaria de reconhecer a linha.

### D79 — `in.(...)` com 300 hashes estourava a URL
O PostgREST põe filtro na query string. Trezentos sha256 dão **19 KB de URL**, e o
servidor recusa por volta de 8 KB — o erro chega como um `TypeError: fetch failed` seco,
sem nada apontando para o tamanho.

→ `lib/data/batching.ts` com os limites e o motivo. Mesmo risco existia em rejeitar uma
importação inteira (426 uuids) e em contar uso de categorias.

### D80 — Importação que falha no meio não pode bloquear a segunda tentativa
Quando o staging falhava, a linha de `statement_imports` ficava com status `reviewing` e
zero linhas — parecia um extrato vazio **e** fazia o `findImportByHash` recusar reimportar
o arquivo. O usuário ficava preso.

→ Qualquer falha depois da criação marca a importação como `failed`, e `failed` e
`discarded` não bloqueiam uma nova tentativa.

### D81 — O saldo de fechamento era o do primeiro dia
O extrato do Itaú vem em ordem **decrescente**, então o último saldo do arquivo é o mais
antigo. A tela mostrava o saldo de 05/01 rotulado como "saldo de fechamento".

→ Passa a escolher o de data máxima.

### O que o import real confirmou
- 426 linhas lidas, **zero duplicatas**, zero hashes repetidos;
- **o saldo confere em 99 dias** contra o próprio extrato;
- abertura 142.469,28 + movimentos 5.035,71 = **147.504,99**, contra 147.510,24 que o
  extrato declara em 15/07 — os 5,25 são o snapshot de exportação da D36;
- `BUSINESS 7502-5632` saiu como −13.067,87, exatamente o total da fatura de 05/01/2026
  lido do PDF na Fase 3 (A4).

---

## Parte 16 — Dinheiro que volta (18/08/2026)

### D82 — Categoria errada se corrige tirando a categoria, não apagando a linha
O pedido foi literal: *"esse pix do ricardo foi feito e devolvido, pode apagá-lo de tudo"*.
Apagar o lançamento era o caminho errado, e a aritmética diz por quê.

A devolução de **R$ 115.000 de 09/01/2026** é uma linha do extrato do banco. A conta
corrente só fecha nos **R$ 226.916,33** que o banco declara **porque ela está lá**. Apagá-la
trocaria uma categoria errada — que aparece em `pendencias` e um dia é resolvida — por um
razão que não bate mais com o extrato, que é o erro mais caro de achar depois.

→ **Nenhuma correção de categoria apaga `cash_entries`.** Tira-se a categoria; o
`planCashMirror` devolve `null` e o espelho de competência some junto. O dinheiro sai da
DRE e da folha e continua no caixa, que é exatamente onde um pagamento que saiu e voltou
pertence.

A perna de saída não sumiu: ela está **dentro de um lote `SISPAG FORNECEDORES`** —
R$ 290.000 no mesmo 09/01, R$ 276.250 no 10/02 — que paga vários fornecedores de uma vez e
não nomeia nenhum. Enquanto o retorno CNAB não chegar, as duas pontas ficam sem categoria,
e o efeito líquido na DRE é zero, que é o certo.

### D83 — Crédito em conta de custo: o cartão é a prova, o banco precisa de par
O espelho assina pelo sentido (`mirror.ts`): entrada numa conta de custo vira **custo
negativo**. Isso só é verdade quando o pagamento estornado também está naquela categoria.
Duas maneiras reais de quebrar isso apareceram, e o discriminador é a **conta**, não uma
heurística de texto:

- **Cartão de crédito:** um crédito na fatura só pode ser devolução de compra — ninguém
  paga a empresa na fatura do cartão dela. **Todos ficam**, com ou sem valor
  correspondente. Estorno parcial é comum, e casar por valor jogaria fora os honestos
  (Adobe R$ 11,43, Salesforce R$ 1.394,43).
- **Conta bancária:** dinheiro que chega é normalmente receita. Só é devolução quando o
  pagamento que ela reverte está visível na mesma categoria — mesma quantia, data próxima.
  Inaldo, R$ 1.000 fora e R$ 1.000 de volta em 05/05, é o formato de uma de verdade.

→ Regra pura e testada em `src/lib/recognition/cost-credits.ts` (9 testes);
`npm run fix:credits` aplica, com dry run por padrão e `--ensaio` em transação revertida.

**O que estava errado, e virou 10 linhas sem categoria (R$ 218.800):**

| Categoria | Linhas | Valor | O que era |
|---|---|---|---|
| 6.10 Freelancers | 2 | R$ 165.000 | As devoluções do Ricardo, sem a perna de saída no razão |
| 8.03 Agência | 8 | R$ 53.800 | **Receita** de Hold Beauty, Ciclo e Conexão arquivada na despesa que a DD Group paga *a eles* |

O caso 8.03 é a D40 mordendo a própria cauda: a camada de **identidade** reconheceu a
contraparte e arquivou pelo histórico dela, então o `direction` das regras (migration
`0004`) nunca teve voz. Identidade vence texto, mas identidade sozinha não sabe o sentido.

Efeito: janeiro/2026 deixou de ter −R$ 115.000 de custo de freelancer e fevereiro −R$
50.000. O saldo da conta corrente não se moveu um centavo, medido antes e depois.

### D84 — A perna que falta de uma transferência se deriva, não se espera
A conta `Itaú — CDB DI` foi semeada com R$ 367.735,49 e nunca recebeu um lançamento. Todo
movimento do CDB existe só na conta corrente, como transferência 99.03. Uma transferência
com uma perna só mente duas vezes: o resgate de janeiro esvaziou o CDB para a conta
corrente, então esse dinheiro está dentro dos R$ 226.916,33 **e** congelado na abertura do
CDB; e os R$ 485.000 aplicados desde junho saíram da conta corrente e não chegaram a lugar
nenhum.

O handover anterior descrevia só a primeira metade. **Somadas, o sistema subestima o caixa
em R$ 117.264,51**, não o contrário.

→ `npm run propose:cdb` cria a contrapartida a partir das linhas que o banco já imprimiu —
mesma data, mesmo valor, sentido oposto, outra conta — pelo mesmo mecanismo da tela
(99.03 → `transfer_pairs.kind = 'investment'`). Não precisa do extrato do CDB. A aritmética
fecha em número redondo, que é o sinal de que a leitura está certa:

```
367.735,49 − 367.735,49 + 485.000,00 = 485.000,00
```

**O limite, dito junto com o resultado:** rendimento que tenha ficado dentro do CDB em vez
de ser varrido para a conta corrente não aparece. R$ 485.000,00 é o principal; só um
extrato do CDB prova o centavo.

**Aplicado em 18/08/2026.** O CDB passou a marcar R$ 485.000,00 e o caixa total foi de
R$ 594.651,82 para R$ 711.916,33, com a conta corrente intocada. A dúvida sobre o
rendimento não impedia a decisão: uma transferência com uma perna só não é questão de
avaliação, é registro faltando, e o valor do principal não depende de saber o juro.

### D85 — Os dois razões não batem; o que se verifica é que toda diferença tem nome
Pedido: *"você precisa fazer os resultados baterem com o fluxo de caixa, para que
futuramente não tenha nenhum problema"*.

Fazer os dois **baterem** seria desfazer a D2. Caixa é quando o dinheiro se moveu,
competência é quando o resultado aconteceu; forçar igualdade faria os dois relatórios
concordarem por construção e destruiria o motivo de existirem dois. O que previne problema
futuro é mais forte: **nenhuma diferença entre eles pode ser anônima**.

→ `npm run verify:reconcile` escreve, mês a mês, a identidade

```
resultado da DRE = caixa operacional
                 + receita reconhecida no mês
                 − entradas de caixa sem competência
                 + saídas de caixa sem competência
                 + saídas cuja competência é de outro mês
                 − entradas cuja competência é de outro mês
                 − custo cujo caixa é de outro mês
                 − custo de compra no cartão
                 − custo sem caixa nenhum
                 − ajuste manual em espelho
```

e exige **resíduo exatamente zero**. Sai com código 1 se algum mês não fechar.

A decomposição é exaustiva de propósito, e é isso que dá sentido ao resíduo. Todo
lançamento de caixa do mês, numa conta de caixa e fora de `transfer`, é espelhado no
próprio mês, espelhado em outro, ou não espelhado. Toda linha de custo em competência é
espelho de caixa do mesmo mês, de outro mês, de compra no cartão, ou não tem caixa nenhum.
Os espelhos do próprio mês se cancelam contra o próprio caixa — é o único par que some da
ponte. Resíduo, portanto, só pode ser defeito: espelho que não nasceu, espelho duplicado,
espelho preso a um lançamento que virou transferência, custo contado duas vezes.

Regra pura e testada em `src/lib/reconcile.ts` (10 testes). Um dos testes teve de ser
reescrito a partir das primitivas: os baldes **não são livres**, e escolher números
arbitrários para eles não fecha — o que é a melhor prova de que a identidade aperta.

**Resultado em 18/08/2026: os 13 meses fecham, resíduo zero.** E a ponte entregou de brinde
o número que interessa para o futuro: **R$ 1.281.607,12 de saídas de caixa sem
competência** — dinheiro que saiu e ainda não pesa na DRE porque a linha não tem categoria,
em maioria os lotes SISPAG. Conforme forem categorizadas, o custo cresce e o resultado cai,
sem o caixa mudar. Fica previsto em vez de virar surpresa no fechamento.

### D86 — O histórico não pode pôr uma entrada em conta de custo
Medindo o que o motor decidiria para as 250 linhas sem conta **já aprovadas no razão**,
apareceu o pior tipo de resultado: ele decidiria **5 linhas (2%) — e as 5 eram exatamente
as que a D83 tinha acabado de corrigir**. As duas devoluções do Ricardo voltariam para 6.10
e três Ciclo para 8.03, todas pela camada `history_tax_id`.

O histórico aprende com o que já foi categorizado e **não sabe nada sobre sentido**. Ele
não tem como declarar intenção; uma regra explícita tem, desde a migration `0004`.

→ `EngineInput` ganhou `costCategoryIds`, e as duas camadas de histórico (`history_tax_id`
e `history_description`) passam a recusar uma sugestão que ponha uma **entrada** numa conta
de custo, despesa ou imposto — as mesmas espécies que o `planCashMirror` espelha. Regra
explícita continua podendo, e deve: o estorno de cartão em 7.02 é esse caso legítimo.

Opt-in de propósito: sem o conjunto, nada é bloqueado. Ligado em `loadEngineInput` (app) e
em `engine-preview` (scripts), que são todos os caminhos.

Medido de novo contra o banco depois da trava: **de 5 sugestões erradas para 0.**

> Sem isso, qualquer recategorização em massa — a tentação óbvia diante de 250 linhas
> paradas — desfaria a D83 em silêncio.

### D87 — Casar nome de empresa não se automatiza; CPF nunca é cliente
Sobravam 67 entradas sem conta, R$ 1,3 milhão. `propose:receipts` decide de quem é o
dinheiro por identidade, e a regra vive em `src/lib/receipts.ts` (12 testes).

Duas coisas que o dado ensinou, ambas caras se descobertas depois:

- **CPF nunca é cliente.** Três linhas, R$ 170 mil, são pessoa física: as duas devoluções
  do Ricardo e um Roberto. Tratá-las como recebimento inventaria R$ 170 mil de receita que
  não existe. O tipo do documento resolve por construção — 11 dígitos é pessoa, 14 é
  empresa — em vez de por lista de exceção.
- **Cadastrar cliente pelo nome legal do extrato parecia seguro, e não é.** O dry run
  mostrou `CICLO - A. M. I. D. P. E-COMMERCE` a caminho de virar um segundo "Ciclo", que
  já existe **com contrato**; e `UMI SAN SERVICOS…` um segundo "UMI SAN". **41 dos 72
  clientes estão sem documento**, e é a eles que esses CNPJs pertencem. Nenhum casador
  resolve: `Windlog` × `BRAZIL WIND LOGISTICS` escapa de qualquer um, e
  `MS Tecnologia` × `FULANO MARKETING E TECNOLOGIA` casa sendo coisas diferentes.

→ O script **não cria cliente**. Liga o CNPJ ao cliente que já existe, propõe conta de
receita só quando ela é inequívoca, e devolve os CNPJs sem dono como lista de decisão.
Duplicar cliente estragaria a margem por cliente em silêncio, que é o tipo de erro que
ninguém encontra depois.

Aplicado em 18/08/2026: 15 entradas ligadas ao cliente pelo CNPJ, 2 com conta de receita
(PDG IT e CSO, onde o valor bate exatamente com a mensalidade de um contrato). A ponte
continuou em zero, como tem de ser — categorizar entrada não cria competência.

**Fica em aberto, e é decisão sua:** a conta de receita de 47 entradas, R$ 670.713,49. Os
quatro clientes com projeto *e* retainer (Hold Beauty, PDG IT, Hogrefe, CSO) e os 14 CNPJs
sem dono.

### D88 — O motor não alcança o que já está no razão
Achado estrutural, encontrado ao investigar por que a cobertura não sobe: **o motor de
categorização só roda sobre `staged_transactions`**, e o staging está vazio porque tudo já
foi aprovado. `preview:categorize` escreve `suggested_*` em linhas paradas que não existem
mais, e `propose:parties` mede cobertura contra o mesmo lugar — por isso o ensaio dele
imprime `0 de 0 linhas`.

Consequência: **toda regra criada depois da aprovação é peso morto** para as linhas que já
estão no razão. As 110 regras e 33 pessoas não alcançam as 248 linhas sem conta.

Não foi construído um caminho de recategorização, e de propósito: medido, ele recuperaria
2% — e, antes da D86, os 2% eram justamente as sugestões erradas. O caminho certo continua
sendo resolver a identidade (D87) e conseguir o retorno do SISPAG, que sozinho é 95% do que
falta.

### D89 — Vigência desempata melhor que valor: dinheiro não paga contrato que não existia
Quatro clientes — Hold Beauty, PDG IT, Hogrefe e CSO — têm contrato de projeto *e* de
retainer, que alcançam contas de receita diferentes. O handover listava isso como decisão
do Andre desde o começo. Eram 13 recebimentos, R$ 150.400.

O casamento por valor resolvia 2. O que resolve de verdade é a **janela de vigência**, e
ela é a única regra aqui que é **impossibilidade, não probabilidade**: um recebimento
anterior ao início de um contrato não pode ser dele.

- Hogrefe, R$ 10.000 em 16/06 — o retainer dela só começa em **01/07**.
- CSO, R$ 8.000 em 06/02 — o retainer começa em **01/06**. E R$ 8.000 não bate com
  mensalidade nenhuma: só a vigência resolve esse.
- PDG IT, três de R$ 15.000 em março, abril e maio — o retainer começa em **01/06**.

→ `resolveRevenueCategory` passou a receber a data do recebimento e a data de início dos
contratos. Ordem dos desempates: conta única, **vigência**, valor igual à mensalidade.
Contrato sem data de início **não é descartado** — não declarar vigência não é o mesmo que
não estar vigente. E se nenhum contrato estava vigente, nada é eliminado: descartar tudo
devolveria uma resposta inventada.

**Resolveu 7 das 13.** Com as 2 anteriores, 9 de 15. Restam 6, em três clientes.

O que **não** virou regra, de propósito: *"o recebimento fecha o saldo em aberto do
contrato ao centavo"*. É evidência forte — PDG IT deve exatamente R$ 15.000 do projeto e
recebeu R$ 15.000; Hold Beauty deve exatamente R$ 4.500 e recebeu R$ 4.500 — mas depende de
os totais da planilha estarem completos, e um aumento de escopo não registrado quebraria a
inferência em silêncio. O `decisoes` imprime o saldo em aberto de cada contrato ao lado dos
recebimentos, e a última palavra é do Andre.

### D90 — Um relatório que faz a pergunta com a evidência do lado
`pendencias` ordena o que falta por dinheiro. `decisoes` faz a pergunta seguinte, que é a
que custa tempo: **o que o sistema já sabe de cada caso, para responder sem abrir o
extrato?**

Duas checagens que **mudam a pergunta** quando dão positivo, e por isso vêm antes da
resposta:

- **A contraparte também recebe pagamento da DD Group?** Aí é fornecedor *e* cliente, e a
  regra vai precisar de `direction` para não repetir a D83. Deu positivo na Ciclo: manda
  R$ 5.400 e recebe R$ 4.000.
- **A cadência é mensal e de valor fixo?** Assinatura de retainer. Impresso como evidência,
  nunca usado como decisão — pelo mesmo motivo da D89.

Para os CNPJs sem dono, mostra **candidatos entre os 41 clientes cadastrados sem
documento**, e diz explicitamente que se for um deles o certo é pôr o CNPJ nele, não criar
outro. Achou `Windlog` para `BRAZIL WIND LOGISTICS` e `Ciclo` para
`CICLO INTELIGENCIA EM E - COMMERCE` — os dois casos que teriam virado duplicata.

### D91 — O relatório é sobre o que entra e sai, não sobre quem deve o quê
O `decisoes` tinha começado a mostrar, para cada contrato, quanto já fora recebido e quanto
faltava. **Andre cortou isso em 18/08/2026:** *"não precisa saber quanto cada um deve, faça
apenas sobre o que entra e sai de valor na empresa"*.

Está certo, e o corte é mais do que estético. Saldo de contrato é **cobrança**; a pergunta
que o sistema precisa responder é de **classificação** — em qual conta o dinheiro cai. Ter
as duas juntas convidava a inferir uma pela outra, que é exatamente o que a D89 recusou a
transformar em regra.

→ Cada contraparte é apresentada por **entrou / saiu / líquido**, contando tudo. O alerta de
"também recebe pagamento da DD Group" deixou de ser exceção e virou consequência natural de
o líquido não ser igual ao que entrou.

### D92 — Windlog e Ciclo: os dois primeiros CNPJs confirmados
Andre confirmou em 18/08/2026 que `BRAZIL WIND LOGISTICS AGENCIAMENTO INTERNACIONAL` é o
cliente **Windlog**, e `CICLO INTELIGENCIA EM E - COMMERCE` é o **Ciclo** — os dois casos
que o `propose:receipts` tinha se recusado a decidir sozinho, e que teriam virado duplicata.

→ `npm run vincular` executa esse tipo de resposta e **guarda a memória dela**: a tabela
`CONFIRMADOS` registra cliente, como o extrato escreve o nome, e *por quê* — porque daqui a
seis meses ninguém lembra por que "Windlog" e "BRAZIL WIND LOGISTICS" são a mesma coisa.

Duas coisas que o script faz questão de não fazer:

- **Não digita CNPJ.** O documento é lido do extrato pelo nome da contraparte. Um CNPJ
  escrito à mão num arquivo de código é um número que ninguém confere e que cola no cliente
  errado em silêncio. (Escrevi a primeira versão com os dígitos na tabela e estava
  inventando os que não tinha visto.)
- **Conta pelo documento, nunca pelo nome.** A Ciclo aparece no extrato com **quatro
  grafias** sob o mesmo CNPJ; a primeira versão contava só uma delas e reportava um terço do
  movimento.

Efeito: as 8 entradas dos dois (R$ 56.400) ganharam conta **sozinhas**, sem ninguém escolher
— cada um tem um único contrato, então a conta de receita é única. Windlog cai em 3.02
Projeto; Ciclo em **3.03 Referral**, coerente com ela ser parceira e pagadora ao mesmo tempo.
Cobertura foi de 741 para **749 de 982 (76,3%)**.

### D93 — Nenhum era cliente novo, e é por isso que o script não adivinhava
Andre respondeu os CNPJs em 19/08/2026, e a resposta valida a D87 inteira: **nenhum dos que
ele nomeou era cliente novo.** Todos já estavam cadastrados, sem documento, com nome
comercial em vez de razão social.

| Extrato | Cliente | |
|---|---|---|
| A. F. COMERCIO DE LIVROS E CURSOS | **FK Partners** | R$ 213.400 |
| DB GENETICA SUINA | **Danbred** | R$ 66.500 |
| CN INC 01 EMPREENDIMENTOS | **Center Norte** | R$ 65.400,48 |
| LIGAVIT CORRETORA DE SEGUROS | **Liga Vitoria** | R$ 28.000 |
| FULANO MARKETING E TECNOLOGIA | **Match** (Marketdata) | R$ 21.000 |
| BRAIN SOLUCOES INTEGRADAS | **Smartbrain** | R$ 15.313 |
| SW SERVICOS | **Sewe Consultoria** | R$ 15.000 |
| UMI SAN SERVICOS | **UMI SAN** | R$ 9.300 |

Cadastrar pelo nome legal do extrato — que era o plano inicial — teria criado **oito
clientes duplicados**, e a margem por cliente passaria a mentir sem nenhum sinal.

Vale registrar o que o casamento automático teria acertado e errado: acertaria
`Ligavit` → `Liga Vitoria` e `Brain` → `Smartbrain`; **erraria feio** em
`FULANO MARKETING E TECNOLOGIA` → `MS Tecnologia` (casa em "TECNOLOGIA", são empresas
diferentes); e **não teria como acertar** `A. F. COMERCIO DE LIVROS` → `FK Partners`,
`DB GENETICA` → `Danbred`, `SW SERVICOS` → `Sewe`. Não existe casador que resolva isso: a
informação não está no nome.

Efeito: **20 entradas ganharam conta, cobertura de 749 para 769 de 982 (78,3%).**

⚠️ **O cadastro já tinha cinco pares duplicados de antes deste trabalho:** Danke, Enutri,
Medcom, RiHappy e Santa Lucia aparecem duas vezes cada, um com documento e outro sem. Não
mexi — juntar cliente é decisão do Andre.

### D94 — Um cliente pode pagar de mais de um CNPJ
O **Center Norte** já carregava o CNPJ da `ASSOCIAÇÃO DOS LOJISTAS DO CENTER NORTE`
(R$ 130.800,96), e o extrato trouxe um segundo: `CN INC 01 EMPREENDIMENTOS`, uma SPE do
grupo. `clients.tax_id` guarda um documento só.

Sobrescrever perderia o primeiro; cadastrar de novo duplicaria o cliente. As duas saídas
óbvias estavam erradas.

→ O segundo CNPJ vira **regra por documento**. `categorization_rules` já carrega
`counterparty_tax_id`, `client_id` e `category_id` juntos, que é exatamente a frase "esse
CNPJ é desse cliente e cai nessa conta" — é o que o `propose-parties` grava. O `vincular`
detecta o conflito sozinho e escolhe esse caminho, exigindo que o cliente tenha **uma conta
de receita única**: com projeto e retainer ao mesmo tempo, a regra não saberia qual usar, e
aí para.

`judgeReceipt` ganhou `rulesByDocument`, consultado **antes de tudo** — uma regra é decisão
humana já registrada, e vence qualquer inferência, pelo mesmo motivo da D40. Não salva CPF:
pessoa física continua barrada antes de qualquer regra ser olhada.

> Isso não é caso isolado. Holding, SPE e associação de lojistas são comuns, e agora o
> mecanismo existe para o próximo.

### Duas correções minhas, registradas porque quase viraram dado errado
- **Digitei CNPJ à mão** na primeira versão do `vincular`, inventando dígitos que eu só
  tinha visto mascarados. O documento passou a ser **lido do extrato** pelo nome da
  contraparte.
- **Contei movimento pelo nome, não pelo documento.** A Ciclo aparece com quatro grafias sob
  o mesmo CNPJ, e o dry run reportou um terço do movimento dela.

Nos dois casos foi o dry run que pegou — que é exatamente para isso que ele existe.

### D95 — O plano de contas não tem onde pôr dinheiro que entra e não é receita
Andre confirmou em 19/08/2026 que o `PIX RECEBIDO KEEPCLE29/01` de **R$ 0,01** é teste de
transferência. É uma linha só e não tem sequência. **Fica sem categoria de propósito**, e
fica registrado aqui para ninguém reinvestigar.

Recusei as saídas que o plano oferece, porque as duas seriam mentira: `10.05 Outros` é
**despesa**, e entrada em conta de custo é exatamente o defeito da D83; `99.01 Transferência
entre contas` é falso, porque o dinheiro veio de terceiro.

O centavo não importa. O que ele revelou importa: **não existe conta para receita que não
vem de cliente.** E já tem gente morando nesse vazio —

> **Os rendimentos de aplicação estão em `99.03 Aplicação e resgate automático`**, que é
> conta de **transferência**: 38 linhas, R$ 202,31, **fora da DRE inteira**. Rendimento
> financeiro classificado como movimentação entre contas próprias.

Em R$ 202 é irrelevante. Deixa de ser porque **o CDB passou a ter R$ 485.000 aplicados**
(D84) — esse rendimento cresce, e hoje não aparece no resultado.

**Pendência para o Andre, e é uma decisão só:** criar uma conta de receita financeira — algo
como `3.05 Receita financeira` — e, se sim, em qual grupo da DRE ela entra. Pôr em
`receita_bruta` infla a receita de serviço e distorce o OPBB, então provavelmente pede um
grupo próprio, não operacional. É pergunta de contador, não de programador.

Enquanto não houver resposta, o rendimento continua onde está — visível, nomeado e errado
de um jeito que está escrito.

### D96 — O PDF "ilegível" era legível, e ele contém o SISPAG inteiro
A Q13 dava três PDFs como perdidos: *"têm texto, mas a fonte é subconjunto sem mapa
Unicode; cada glifo vem como código arbitrário"*. A conclusão estava errada, e o diagnóstico
também — pela metade.

A fonte embutida é mesmo um subset **sem tabela `cmap`**. O que ninguém tinha visto é pior:

> **O `/ToUnicode` do próprio arquivo está incorreto.** Ele declara `<001c><0025><0030>` —
> que os glifos `0x1c`–`0x25` são os dígitos `0`–`9`. Texto conhecido prova que são as
> letras `G`–`P`. O arquivo mente sobre si mesmo, e é por isso que toda ferramenta falha:
> quem confia no mapa erra, e quem o ignora fica sem mapa nenhum.

O mapa real é trivial depois de visto — `0x06`–`0x0f` são os dígitos, `0x16`–`0x2f` são
`A`–`Z`, contíguos, mais a pontuação. Derivado casando texto que já se sabia estar ali:
`PAGAMENTOS A FORNECEDORES` (25 letras, 25 glifos, zero conflito) e `RICARDO DE CARVALHO
CUSTODIO JUNIOR`. A prova independente é o documento da contraparte sair formatado sozinho:
`398.805.388-03`, um CPF com pontos e traço nos lugares certos, que nenhuma tabela errada
produz por acaso.

**Duas armadilhas de leitura, ambas achadas errando primeiro:**

- **O pdf.js não serve aqui, e não por bug dele.** Com o `/ToUnicode` aplicado, a letra `G`
  e o dígito `0` chegam como o mesmo caractere — indistinguíveis. Sem ele, o pdf.js recorre
  a heurística de fonte padrão e inventa outra coisa. A leitura correta só existe uma camada
  abaixo, nos CIDs do content stream (`itau-pdf-cids.ts`).
- **A linha não é uma linha.** O nome da contraparte quebra em duas, *centralizado
  verticalmente* sobre a transação: metade acima do `y` da data, metade abaixo. Agrupar por
  `y` — o reflexo óbvio — fez **14 dos 19 lotes fecharem e 5 não**. A montagem certa é por
  proximidade: cada fragmento pertence à data mais próxima.
- **A árvore de páginas aninha.** O root aponta para dois nós, e ler só o primeiro `/Kids`
  perdia a última página — justamente onde estavam as transações do maior lote.

**Resultado, conferido contra o razão: 19 de 19 datas fecham exatamente.**
R$ 1.221.679,97 no razão contra R$ 1.221.679,97 no PDF, diferença **R$ 0,00**. Os 34 lotes
anônimos viram **116 pagamentos com nome e documento**, 49 contrapartes distintas — 26 já
cadastradas como pessoa ou cliente, 23 por cadastrar (R$ 346.265,97).

Sobram **R$ 95.950,00 em 8 pagamentos que o PDF também não nomeia**. Esses continuam
anônimos, e nenhum arquivo do Itaú vai resolvê-los.

> Isso muda o maior item aberto do projeto. O SISPAG deixou de depender de um arquivo que o
> chefe do Andre ia buscar: **o dado já estava aqui**, dentro de um PDF marcado como
> ilegível desde 13/08.

⚠️ **Nada foi importado ainda.** Trocar 34 linhas do razão por 116 é operação grande e é
decisão do Andre — ver a pendência no handover.

### D97 — Regra é decisão já tomada; histórico é palpite. Só a primeira entra sozinha
Com o SISPAG itemizado (D96), a D88 deixou de ser curiosidade e virou obstáculo: o motor só
roda sobre `staged_transactions`, e as **63 regras por documento que o Andre respondeu uma a
uma** não alcançavam as linhas que já estavam no razão.

Medido antes e depois, e a diferença é a história inteira deste trabalho:

| | o motor decidiria |
|---|---|
| antes da D86 e do SISPAG | **5 linhas (2%)** — e as 5 eram as sugestões erradas que a D83 tinha acabado de corrigir |
| agora | **94 linhas (31,9%)**, R$ 1.050.659,00 — 63 delas por regra explícita |

→ `npm run recategorize` aplica o motor ao razão, **separando o que é regra do que é
inferência**:

- **`rule_tax_id` e `rule_text` entram com `--aplicar`.** Vêm de uma regra que alguém
  escreveu; aplicar é entregar o que já foi decidido, não decidir.
- **`history_tax_id` e `history_description` exigem `--incluir-historico`.** Dizem "esse
  documento já foi categorizado assim antes". Costumam acertar, e foi exatamente o que
  errou na D83.

**Aplicado em 20/08/2026: 63 lançamentos, R$ 863.414,00, todos em 6.10 Freelancers** — que
é o que os lotes SISPAG sempre foram, a folha de terceiros. Nasceram com espelho de
competência pelo `planCashMirror`, o mesmo plano da tela, sem regra paralela.

**O resultado acumulado caiu de R$ 2.121.919,59 para R$ 1.258.505,59.** Não é perda nova: é
custo que estava só no caixa passando a pesar na DRE, exatamente o que a D85 previu ao
nomear a diferença.

A prova de que nada se perdeu no caminho está na ponte: **a linha "saídas de caixa sem
competência" caiu de R$ 1.281.607,12 para R$ 418.193,12**, os mesmos R$ 863.414, e os 13
meses continuam fechando com resíduo zero. O saldo da conta corrente não se moveu.

Ficaram **31 linhas por histórico, R$ 187.245,00**, esperando uma decisão explícita.

---

### D98 — A D88 não era só do motor: quem propõe também lia só o staging
A D97 consertou o motor, que enxergava apenas `staged_transactions`. Ficou faltando notar
que **os dois scripts que propõem** liam da mesma tabela — `propose:parties` na linha do
casamento de partes, `propose:rules` na hora de medir o alcance de cada regra.

Enquanto todo import passava pelo staging, staging e razão diziam a mesma coisa. O
`import:sispag` (D96) quebrou isso de propósito: ele troca um lote pelos pagamentos de
dentro e escreve **direto no razão**. Resultado medido: 102 documentos no staging contra
115 no razão — **13 contrapartes existiam e eram invisíveis para quem deveria identificá-las**,
enquanto apareciam em `pendencias` como "não cadastrada".

**O silêncio não foi o pior.** Sete das treze eram colaboradores que a aba `Colaboradores`
nomeia. Sem o documento verdadeiro no universo, o casamento estrito não achava nada, e a
parte caía na regra aproximada — que exige **um** token distintivo e ignora os outros. Aí
`Vitor Oliveira`, `Anna Flavia de Oliveira` e `Jonailson Junior` foram todos reivindicar
`ROBERTO PASCOAL DE OLIVEIRA JUNIOR`, pelo sobrenome, e o relatório imprimiu uma **disputa
de três vias que nunca existiu**. É a lição da D96 outra vez: evidência ausente não se lê
como ausente — se lê como uma resposta errada dada com confiança.

Com o razão no universo, os sete casam estritamente com o próprio documento e **a disputa
desaparece sozinha** — o estrito ganha do aproximado, como a regra já dizia.

**`status = 'pending'` é o que impede a dupla contagem**, e diz a coisa exata: um staged
*approved* já **é** uma linha de `cash_entries`; um `duplicate` ou `rejected` nunca foi
dinheiro. Hoje são 1.064 linhas de razão e nada pendente, contra as 1.046 que o staging
oferecia — 977 aprovadas e **69 duplicatas que estavam sendo contadas como alcance**.

**Uma armadilha nova, e cara, no meio do caminho:** as duas tabelas não concordam sobre o
que é sinal. `staged_transactions.amount` é **assinado**, como o extrato imprime;
`cash_entries` guarda **magnitude** e põe o sentido em `direction`. Unir as duas lendo o
valor do razão como se fosse assinado transformou os **15 pagamentos do CUSTODIO em 26
recebimentos** e levantou `sentido invertido` na folha inteira. Sentido é exatamente o que
a D82 e a D86 existem para proteger, e ele se restaura no `case`, nunca se presume.

**Aplicado em 20/08/2026:** 7 partes cadastradas, 7 regras por documento, e o
`recategorize` levou **9 lançamentos, R$ 32.370,00**, todos em 6.10 Freelancers. Na ponte,
"saídas de caixa sem competência" caiu de R$ 418.193,12 para **R$ 385.823,12** — os mesmos
R$ 32.370 —, os 13 meses continuam com resíduo zero, o `verify:rls` deu 7/7 e o razão
continua com 1.064 linhas. Cobertura: 832 → **841 de 1.064 (79,0%)**.

---

### D99 — A D86 travou uma ponta e deixou a outra aberta
Pedido para aplicar as regras de texto, o `--aplicar` respondeu **0 regras criadas**: as 49
já estavam gravadas e já tinham funcionado. O que sobrava não era regra faltando — era o
que **regra de texto não alcança por definição**. As linhas do SISPAG têm por descrição o
rótulo do lote, `PAGAMENTOS A FORNECEDORES`; o nome do fornecedor mora no documento, não no
texto.

Sobrou então medir o `--incluir-historico` num ensaio, e o ensaio mostrou outra coisa:

```
3.03 Receita — Referral        3 linhas       R$ 12.000,00
```

**Três pagamentos de R$ 4.000 virando receita.** É a Ciclo, que é cliente — paga referral
todo mês — *e* é a agência que a empresa contrata, sob **um CNPJ só** (…001-09). O
`history_tax_id` viu "esse documento já caiu em 3.03" e mandou para lá uma **saída**.

A trava da D86 existia e não pegou, porque ela olha uma direção só:

```ts
if (subject.direction !== "in") return true;   // ← saída passa sempre
```

A D83/D86 travou **entrada em conta de custo** — custo negativo, a devolução do Ricardo. O
espelho disso, **saída em conta de receita**, ficou aberto. O histórico não sabe nada sobre
sentido: quando a contraparte está dos dois lados do balcão, ele erra nas duas direções, e
cada erro inventa dinheiro que não existe.

→ `learnedSuggestionIsAllowed` passa a receber também `revenueCategoryIds`, e recusa saída
em conta de receita pela mesma regra e com as mesmas condições: **opt-in** (sem o conjunto,
nada é bloqueado) e **regra explícita continua podendo**, porque regra tem `direction` para
declarar intenção e histórico não tem. Quatro testes novos, 387 → **391**.

Medido depois, a linha de receita **desaparece do ensaio** e os R$ 12.000 vão para o custo.

**Mas não vão para a conta certa**, e isso é o argumento contra aplicar o histórico em
bloco: barrado o `history_tax_id`, a linha cai no `history_description`, que só enxerga
`PAGAMENTOS A FORNECEDORES` e responde **6.10 Freelancers**. A Ciclo é `8.03 Agência` — é o
que a planilha chama `- Agência Ciclo`, R$ 4.000 por mês. O total da DRE fica certo e a
linha fica errada.

O remédio exato para ela é uma **regra por documento** no CNPJ …001-09 com `direction =
'out'` → 8.03, que é identidade *mais* sentido, a forma forte da D40. Não criei: é decisão
de identidade, e identidade é do Andre (D87).

---

### D100 — Promover ao documento a decisão que o razão já carrega
A D99 fechou a pergunta errada e abriu a certa: as linhas do SISPAG imprimem
`PAGAMENTOS A FORNECEDORES`, o rótulo do lote. **Regra de texto não as alcança e nunca vai
alcançar** — o nome do fornecedor não está na string, está no `counterparty_tax_id`.

Mas o razão quase sempre já sabe a resposta. O mesmo CNPJ também aparece em linhas que o
banco *nomeou* — `BOLETO PAGO ATTENTIVE CO` —, e essas foram categorizadas há tempo por uma
regra de texto lida do bloco de custo da planilha. A conta não está em dúvida; o **alcance**
está. → `npm run propose:suppliers` promove essa conta a **regra por documento**, que é a
forma forte da D40 e chega no lote.

Três guardas, e a do meio é a razão de isto ser seguro:

- **Unânime.** Toda linha categorizada daquele documento *naquele sentido* tem de concordar
  numa conta só. Uma divergente e vira relatório, não regra.
- **Explicada por regra explícita.** Alguma regra que alguém escreveu já tem de casar com
  aquelas linhas. Sem isso o script lavaria os **palpites do histórico** em regras — palpite
  vestido de decisão, exatamente a linha que a D97 traçou e o erro que a D83 pagou.
- **Com sentido.** A regra carrega `direction`, porque contraparte fica dos dois lados do
  balcão. A Ciclo é o caso da D99.

**A guarda do meio se provou sozinha.** Ela reteve `Hold Beauty` e `Hogrefe`, cujas linhas
de receita o razão concorda em 3.02 — mas nenhuma regra explica, porque **são justamente as
perguntas de contrato que o `decisoes` §2 diz estarem em aberto**. Sem a guarda, o script
teria respondido sozinho o que o Andre não respondeu. Reteve também ETG, Taliêco, Aparecido
e Conex & Result, todos vindos de aprovação manual ou do histórico. E marcou o `PDG IT` como
ambíguo, com 3.01 e 3.02 no mesmo sentido.

**Aplicado em 21/08/2026:** 5 regras por documento → 17 lançamentos, **R$ 27.945,00**, em
8.03 Agência (3), 8.01 Contabilidade (9), 7.08 Tarefy (3) e 7.09 Escola.i (2). As três da
Ciclo foram para **8.03**, a conta certa — o histórico as mandaria para 6.10, que é o que a
D99 mediu. O histórico caiu de 42 para 25 linhas: dezessete saíram de palpite para decisão.

Na ponte, "saídas de caixa sem competência" caiu de R$ 385.823,12 para **R$ 357.878,12** —
os mesmos R$ 27.945 —, os 13 meses seguem com resíduo zero e o `verify:rls` deu 7/7.
Cobertura 79,0% → **80,6% (858 de 1.064)**.

> **Uma identificação de brinde:** o `SENSEILABS SERVICOS EDUCACIONAIS LTDA` estava na lista
> de contrapartes desconhecidas do `decisoes`. Ele é o CNPJ por trás do **Escola.i** — as
> linhas nomeadas dele já caíam em 7.09 pela regra `ESCOLAI`. Uma das 24 se respondeu
> sozinha, sem ninguém adivinhar nome.

> **Armadilha paga escrevendo isto:** ao investigar, casei contraparte por **nome**
> (`ilike '%ATTENTIVE%'`) e "achei" uma regra →6.10 conflitando com o 8.01 do razão. Não
> havia conflito: o documento era o **CPF do Jorge Freitag**, cuja linha no extrato vem
> escrita `JORGE HENRIQUE DOMINGUES FREITAG ATTENTIVE SERVICOS` — o banco concatena o nome
> do freelancer com o serviço. É a D40 cobrando de novo, agora de quem investiga: **consulta
> de diagnóstico também tem de casar por documento.**

---

### D101 — A planilha lança um mês à frente do caixa, e é isso que fecha as contas
A D100 promove ao documento o que o razão **já decidiu**. Sobrava o fornecedor que nunca foi
categorizado — não há o que promover. Para esses restava a planilha, e ela provou mais do
que parecia.

**O padrão, achado duas vezes em blocos que não se conhecem:** a `DRE Geral` lança por
**competência, um mês à frente do caixa**. O boleto pago em fevereiro aparece em janeiro.

- `- Juridico` vale **14.589,00** em janeiro. O caixa de **fevereiro** soma
  6.347,00 + 5.000,00 + 3.242,00 = **14.589,00**. E o pagamento de março, 5.000,00, é o
  `- Juridico` de **fevereiro**. Ao centavo nos dois meses.
- `- Seguro Saúde (estag)`, mês a mês, contra os boletos da Prudential: 25/05 R$ 51,02 →
  abril; 24/06 R$ 50,00 → maio; 26/07 R$ 50,00 → junho.

Achado o padrão, o resto caiu:

- `- Plano de Saude` é zero até junho e vale **2.702,37** em julho — e de novo em agosto,
  que o razão não alcança, o que explica o total do ano ser exatamente o dobro. Julho no
  razão: Bradesco 1.924,85 + Intermédica 388,76 + 388,76 = **2.702,37**.
- `- Penalties & Settlements` vale **45.000,00** em fevereiro e 45.000,00 no ano inteiro.
  Há um único pagamento à **Maruri**: 45.000,00 em 09/02. Único dos dois lados.

→ O `propose:suppliers` ganhou uma **segunda via de evidência**, separada da primeira: uma
tabela em que cada entrada carrega **por que** aquela conta, conferida por valor e por mês.
Vale a distinção: isto não é adivinhar identidade (D87) — ninguém vira cliente por
semelhança de nome. É dizer em que conta do plano um pagamento cai, que é escrituração, e a
evidência é a planilha do próprio Andre.

**Aplicado em 24/08/2026:** 6 regras → 13 lançamentos, **R$ 72.493,45**, em 11.03 Multas e
acordos (1), 8.02 Jurídico (5), 6.06 Plano de saúde (3) e 6.07 Seguro saúde (4). O ensaio
confirmou sozinho: o 6.06 recebeu **exatamente R$ 2.702,37** e o 8.02 **exatamente
R$ 24.589,00**, os números que a planilha tinha previsto.

Ponte: "saídas de caixa sem competência" caiu de R$ 357.878,12 para **R$ 285.384,67** — os
mesmos R$ 72.493,45 —, 13 meses com resíduo zero, `verify:rls` 7/7. Cobertura 80,6% →
**81,9% (871 de 1.064)**. Contrapartes desconhecidas: 20 → **14**.

**Três que eu não apliquei, e o motivo importa:**

- **INPI, R$ 440.** É o Instituto Nacional da Propriedade Industrial, e só se paga taxa de
  marca a ele — mas o `- Juridico` da planilha é **zero de março em diante**, e o pagamento
  é de maio. Sei o que a empresa é; não tenho evidência de onde o Andre lança. Decidir aqui
  seria conhecimento de mundo vestido de aritmética.
- **FDN Telecom, R$ 10.000 em 2 linhas.** O nome diz telecom, mas `- Claro e TIM` vale
  **R$ 394,92 no ano inteiro**. R$ 5.000 por mês não é conta de telefone. O nome está
  mentindo sobre a natureza, ou é outra coisa.
- **Keepclear, +R$ 0,01.** O centavo de teste. Continua sem conta de propósito.

---

### D102 — ISM é a MS Tecnologia, e a Conexão é cliente sem NF
Duas respostas do Andre em 24/08/2026, e as duas caem em caminhos diferentes de propósito.

**`ISM SERVICOS DE IMAGEM` é a `MS Tecnologia`** — cliente que já existia **sem documento**,
então o certo era pôr o CNPJ nele, nunca criar outro (D87). Entrou em `CONFIRMADOS` do
`vincular`.

Vale a ironia registrada no arquivo: o comentário no topo do `vincular-clientes.ts` usa
justamente `MS Tecnologia` como exemplo do que **não** casar por semelhança de nome. A
resposta verdadeira não se parece nem um pouco — nenhum casamento automático chegaria nela.

E o contrato confirmou sozinho, sem ninguém ter procurado por isso: a MS Tecnologia tem um
único contrato `project`, R$ 20.000 no total e **`monthly_value` de R$ 5.000**, vigente de
01/04 a 31/07/2026. A ISM pagou **3× R$ 5.000** dentro dessa janela. Conta única, então o
`propose:receipts` tirou a conta do contrato sem ninguém escolher: **3.02 Receita — Projeto**.

**`CONEXAO MARKETING E SERVICOS` é cliente que nunca teve NF emitida** — e não existia no
sistema. Aqui o `vincular` não servia: ele só liga documento em cliente existente, e se
recusa a criar, porque criar por semelhança é como a Ciclo quase virou duplicata.

→ O script ganhou uma tabela **`NOVOS`**, que é o outro lado da mesma moeda. A D87 proíbe o
script de **adivinhar** que uma contraparte é cliente novo; não proíbe **executar** a
resposta de quem sabe. A diferença é quem decidiu, e aqui decidiu o dono da empresa. Duas
travas: nome já existente **cancela** a criação (aí o certo é `CONFIRMADOS`), e o documento
vem do extrato, nunca digitado.

A conta veio junto na regra porque cliente recém-criado **não tem contrato**, e é do
contrato que o `propose:receipts` tira a conta — sem isso ele nasceria ligado e mudo.
**3.02 e não 3.01** porque é um recebimento único de R$ 5.000 em 05/03 e o razão tem cinco
meses completos depois sem repetição; retainer não se comporta assim.

**Resultado:** cobertura 81,9% → **82,2% (875 de 1.064)**, contrapartes desconhecidas
**14 → 12**. Os 13 meses seguem com resíduo zero e o `verify:rls` deu 7/7.

> **A receita não moveu o resultado, e está certo.** O ensaio marcou "0 espelhos de
> competência criados" e queda de R$ 0,00: receita nasce de contrato e NF (SPEC §5), não do
> caixa. A linha ganhou conta e cliente; a DRE não se mexeu.

> **Uma pendência que a planilha não resolve:** o Andre citou a Conexão na **linha 86** do
> bloco de clientes. Na cópia em `docs/reference/`, de 12/08, esse bloco termina na **83** e
> a 86 é `Impostos` — e `Conex` não aparece em nenhuma das seis abas. A planilha dele está
> mais nova. Uma cópia atualizada provavelmente resolve também ISM, Mara Thaysa e Roberto de
> uma vez, além de refrescar contratos e receita.

---

### D103 — A condição que a D83 escreveu e não podia testar
A D83 tirou a categoria de duas devoluções do Ricardo Custodio, R$ 165.000, e escreveu a
regra que justificava isso: **no banco, um crédito só é devolução se o pagamento que ele
estorna estiver na mesma categoria**. Na época a condição era **inverificável** — a perna de
saída estava dentro de um lote SISPAG e ninguém conseguia vê-la.

O `import:sispag` (D96) abriu os lotes, e o que apareceu foi:

```
08/01   saiu 115.000,00  ·  saiu 115.000,00  ·  voltou 115.000,00
09/02   saiu  50.000,00  ·  saiu  50.000,00  ·  voltou  50.000,00
```

**Pagamento em duplicidade com uma perna devolvida no mesmo dia**, confirmado pelo Andre em
24/08/2026. As quatro saídas já estavam em 6.10. A condição da D83 passou a valer, e o que
faltava era alguém poder responder — a soma do SISPAG fecha ao centavo (D96), então as
saídas dobradas são reais, não duplicata de importação.

Sem a categoria nas devoluções, **a DRE contava as duas saídas e ignorava o retorno**:
R$ 165.000 de custo que a empresa não teve.

→ Regra por documento no CPF, `direction = 'in'` → 6.10. É **entrada em conta de custo**,
exatamente o que a D86 barra — e exatamente a exceção que ela deixa escrita: regra explícita
pode, porque tem `direction` para declarar que quis. O histórico nunca chegaria aqui sozinho,
e não deveria.

**Duas correções que este caso obrigou:**

- **A trava de "já existe regra" era por documento; passou a ser por documento *e* sentido.**
  O motor recusa regra cujo `direction` discorda da linha (`engine.ts:117`), então a regra
  dos **pagamentos** ao Ricardo nunca alcançaria as **devoluções**. Guardar só por documento
  teria declarado o caso resolvido e pulado em silêncio. É a D99 escrita como consulta.
- **O `recategorize` dizia "o resultado caiu R$ -165.000,00".** Quase sempre o que entra é
  custo e o resultado cai; um estorno faz o contrário. Agora ele diz **"o resultado subiu"**,
  porque pedir para alguém ler o sinal de um negativo num número difícil é como se erra.

**Aplicado:** 2 lançamentos, **R$ 165.000,00**, e o resultado acumulado **subiu** de
R$ 1.125.697,14 para R$ 1.290.697,14. Na ponte, "entradas de caixa sem competência" caiu de
R$ 2.995.308,69 para **R$ 2.830.308,69** — os mesmos R$ 165.000 —, os 13 meses seguem com
resíduo zero e o `verify:rls` deu 7/7. Cobertura 82,2% → **82,4% (877 de 1.064)**, e o que
falta decidir caiu de R$ 1.090.411,72 para **R$ 925.411,72**.

> O saldo da conta corrente não se moveu, e não podia: as linhas sempre estiveram no extrato.
> O que mudou foi a opinião sobre elas — que é toda a diferença entre a D83 e apagar a linha.

---

## Parte 13 — Decisões da Fase 8

### D68 — Escritor de XLSX próprio, com entradas sem compressão
Mesma razão do leitor (D34): a biblioteca autorizada não abre os arquivos que este sistema
importa. O escritor usa `node:zlib` só para o CRC32 e grava as entradas **stored**, sem
deflate — o Excel aceita, os arquivos são pequenos, e some uma classe inteira de bug de um
escritor que existe para fazer número viajar intacto.

Dinheiro sai como **número**, não texto, para a planilha conseguir somar. O teste faz o
caminho de volta pelo próprio leitor, e o `zipfile` do Python confirma o CRC de todas as
entradas.

### D69 — O export chama o mesmo carregador da tela
Nenhum exportador recalcula nada: `buildReport` chama `loadCashFlow`, `loadPl` e os
mesmos `list*` das páginas, e só reformata. Recomputar com filtros ligeiramente diferentes
é exatamente como um export começa a discordar da tela de onde veio (§10).

### D70 — CSV exporta a primeira aba, e diz qual
Um CSV é uma tabela só. Relatório com mais de uma aba (DRE, Receita) exporta a primeira e
**põe o nome dela no arquivo**, para ninguém achar que o resto se perdeu. Quem quer tudo
baixa o XLSX.

### D71 — A rota de export repete a checagem de sessão
Um route handler não tem layout acima dele, então a verificação que protege toda página
não vale ali. O proxy já barra tráfego anônimo e o RLS não devolveria nada, mas a rota
confere o usuário mesmo assim — foi um teste E2E que mostrou o buraco.

### D72 — Margem por cliente é bruta, e a tela diz isso
Receita reconhecida do cliente menos o custo das pessoas alocadas a ele (`people.client_id`).
**Nada de overhead é rateado**: aluguel, ferramentas e contabilidade não são divididos
entre clientes por uma regra que ninguém combinou. Um número com rateio inventado dentro
parece mais preciso e é menos verdadeiro.

A tela informa quanto de folha é de gente sem cliente alocado, para o total não passar por
completo.

### D73 — O dashboard só mostra realizado
Sem meta e sem orçamento, conforme a D3. Todo cartão é um link para a tela que explica o
número — um painel cujos números não se abrem é um painel em que ninguém confia. A Q4
(metas de receita e de OPBB da planilha) continua aberta e não foi antecipada.

### D74 — A auditoria traduz o valor bruto
O gatilho grava valor de coluna: `amount` chega como `"60000.00"` e chave estrangeira como
uuid. A tela formata dinheiro, resolve booleano e encurta uuid. Um registro tecnicamente
completo e ilegível é o mesmo que não ter registro.

---

## Parte 12 — Decisões da Fase 7

### D61 — A IA fala por `fetch`, sem SDK
A §3 manda a chamada ficar atrás de `lib/ai/provider.ts` com o modelo trocável e a chave
em env. Não manda usar SDK nenhum, e a Messages API é um POST. Zero dependência nova —
o que também respeita a regra de perguntar antes de instalar.
→ Modelo padrão `claude-sonnet-5`, trocável por `ANTHROPIC_MODEL`. Variável vazia conta
como não definida (um `.env` cheio de linhas em branco não deve virar nome de modelo).

### D62 — A IA só é chamada sobre o que ninguém decidiu
A §8 diz que cada camada só roda se a anterior não produziu nada, e é literal aqui: o
motor recebe apenas as linhas `pending` **sem** `suggested_category_id`. Pagar um modelo
para redecidir o que uma regra já sabe é desperdício; deixá-lo sobrescrever a regra seria
pior.

### D63 — Sugestão de IA vive em `staged_transactions`, não no ledger
As colunas `suggested_*` só existem em `staged_transactions`, e é lá que a IA escreve. O
ledger é alcançado apenas quando um humano aprova a importação, pelo mesmo caminho de um
lançamento digitado.

Consequência assumida: lançamento **já aprovado** e sem categoria não recebe sugestão de
IA — não há coluna para guardá-la, e criar uma seria dar à IA um lugar no ledger. Para
esses, a varredura determinística da Fase 4 continua sendo o caminho.

`src/lib/data/ai-suggestions.test.ts` registra toda tabela tocada durante a execução e
falha se `cash_entries`, `recognition_entries`, `contracts` ou `invoices` aparecerem.

### D64 — O prompt não leva valor, e a validação não confia em nada
O modelo recebe descrição, contraparte e sentido. **Nunca um valor** (§8) — há teste que
falha se um `R$` ou um número com centavos entrar no prompt.

Na volta, tudo é conferido: `ref` que não foi perguntado, `ref` repetido, código de conta
que não existe, confiança que não é número entre 0 e 1 — cada um é descartado com motivo
visível na tela. Cliente ou pessoa inventados perdem só aquele campo, não a categoria
inteira, porque a categoria ainda é útil.

Os descartes aparecem na tela de propósito: é a única forma de perceber que um prompt
parou de funcionar.

### D65 — Extração de contrato guarda texto, nunca número
A §9 pede que a IA extraia valor total, mensalidade e datas. A §8 proíbe que qualquer
valor usado em cálculo venha do LLM. As duas convivem assim: a extração guarda **texto,
ao lado do trecho de onde saiu**, e nada é convertido. O valor só vira dinheiro quando uma
pessoa lê o trecho, concorda e envia o **mesmo formulário** usado para um contrato digitado
do zero — onde o `parseMoney` e a validação de data rodam igual.

A trava final já existia: contrato em `draft` não reconhece nada (o motor recusa). Um
contrato que ninguém confirmou não produz um centavo de receita.

### D66 — Ler `.docx` sem dependência nova
Um `.docx` é um zip de XML, igual ao `.xlsx`. O leitor de zip e o scanner de XML saíram de
`xlsx.ts` para `zip.ts` e `xml.ts`, e `docx.ts` reusa os dois. PDF continua pelo `unpdf`.

### D67 — Supabase Storage ficou de fora
A §9 manda guardar o contrato no Storage. Não foi feito: não existe projeto Supabase (Q6),
o bucket precisaria de policy própria, e nada disso poderia ser testado. A extração lê o
arquivo, produz o rascunho e o arquivo é descartado — o rascunho e os trechos ficam. Ver
Q17.

---

## Parte 11 — Decisões da Fase 6

### D52 — O DRE lê só competência, e mostra o caixa ao lado
A §5 manda o DRE ler apenas `recognition_entries`, e é o que ele faz. Mas a pergunta
"por que o DRE não bate com o banco?" ia aparecer na primeira semana, então a mesma tela
traz uma tabela **ao lado** — receita reconhecida contra entrada de caixa, custo
reconhecido contra saída — dizendo explicitamente que não é para bater. A diferença fica
legível em vez de virar desconfiança.

### D53 — Consolidado tem coluna de eliminações
O §11.7 pede coluna por entidade mais o total. Acrescentei uma coluna **Eliminações**
entre as duas: sem ela, o leitor soma as colunas das entidades, não bate com o
consolidado, e conclui que o relatório está errado. Cada entidade continua vendo o seu
próprio número, incluindo o intercompany — do ponto de vista dela é receita e custo de
verdade —, e só o total do grupo desconta (D14e).

### D54 — Transferência não existe no DRE
Nenhuma linha do grupo `transferencias` aparece, em nenhum nível. Mover dinheiro entre as
próprias contas não é resultado, e um DRE que a mostrasse estaria somando o mesmo dinheiro
a si mesmo.

### D55 — Categoria sem grupo aparece, não some
Uma linha de competência cuja categoria não tem `dre_group` cai numa linha "Sem grupo de
DRE" e o relatório avisa. A alternativa — descartar em silêncio — faria o resultado ficar
errado sem ninguém perceber. Ela não entra em nenhum subtotal, de propósito: o número
tem de incomodar até alguém classificar a categoria.

### D56 — A folha diz quanto ficou de fora
A tela de folha só mostra custo amarrado a uma pessoa, e o rodapé informa quanto de custo
do período **não** tem pessoa identificada. Sem isso, o total pareceria a folha inteira
quando na verdade é só a parte já amarrada.

### D57 — Nova tela: Competência
O drill-down do DRE precisa abrir `recognition_entries`, não `cash_entries` — é o outro
razão. Ganhou tela própria, com filtro por origem (motor de contrato, espelho do caixa,
manual) e marcação do que foi editado à mão. É onde se responde "de onde vem este número".

---

### D58 — Imposto é o que foi pago (respondendo à Q1)
A **D14c fica confirmada**: o DRE mostra imposto quando ele sai do banco e é
categorizado, sem cálculo de alíquota. A planilha calculava 17% + ISS 3,4% com ajuste
manual, e esse caminho fica de fora.

Consequência conhecida e aceita: o mês em que a receita foi ganha pode não carregar o
imposto dela, e a margem daquele mês sai otimista. Quem lê o DRE precisa saber disso — a
alternativa exigiria as alíquotas exatas e uma explicação para o ajuste manual de janeiro,
que ninguém tem hoje.

### D59 — Férias não são provisionadas (respondendo à Q3)
A **D2c fica confirmada**: férias entram no DRE quando são pagas. Entre as duas abas que
discordavam, vale a `DRE Geral` (R$ 0 na linha), não a `Colaboradores` (R$ 204.032,56 no
ano). Sem tabela `accruals`.

Consequência: o mês do pagamento leva a despesa inteira, e a margem oscila. É uma escolha,
não um esquecimento.

### D60 — Margem por cliente entra na Fase 8 (respondendo à Q7)
O campo `people.client_id` já existe e a tela de Pessoas já o preenche. O relatório de
margem por cliente — receita do cliente menos o custo das pessoas alocadas nele — é
trabalho da Fase 8, junto com os dashboards.

---

## Parte 10 — Decisões da Fase 5

### D45 — A NF não cria receita; o contrato cria
A D6 diz que a NF define a competência, e isso continua valendo — mas se a NF **também**
gerasse linha de reconhecimento, a mesma receita entraria duas vezes: uma pelo motor do
contrato e outra pela nota.

→ O reconhecimento vem sempre do contrato. A NF entra como a coluna **faturado** da
conciliação, ao lado de **reconhecido** (quando foi ganho) e **recebido** (quando o
dinheiro entrou). As três medem coisas diferentes e não têm obrigação de bater mês a mês;
é a diferença entre elas que vale olhar.

Consequência: receita sem contrato não é reconhecida. Se aparecer, o caminho é criar o
contrato — mesmo que de uma linha só — ou lançar a competência à mão.

### D46 — A conta de receita sai do código, não de uma coluna nova
`contracts` não tem coluna de categoria. Em vez de uma migração, o motor resolve pelo
código do plano de contas: **3.01** para suporte contínuo, **3.02** para projeto — os dois
já semeados da aba `DRE Geral`. Se a conta não existir na entidade, o motor recusa e diz
qual criar, em vez de reconhecer numa categoria errada.

### D47 — "Mês cheio" significa meses iguais
Distribuir um valor total com a proração desligada divide em partes **iguais**, não
proporcionais ao tamanho do mês. Ponderar por dias faria janeiro valer mais que fevereiro
sem que ninguém tivesse contratado isso. Com a proração ligada, o peso é o número de dias
que o contrato cobre — que é o que o teste 3 da §11 exige.

### D48 — Percentual é inteiro, como dinheiro
`Percent` é um `bigint` em **milipercentual** (100% = `100_000n`), guardando as três casas
que `numeric(6,3)` permite. Pelo mesmo motivo do dinheiro: um delta de POC multiplicado
pelo valor do contrato é exatamente onde um float perderia centavo.

### D49 — O motor remove o que deixou de sustentar
Se o prazo encurta ou um reporte de POC some, as linhas que o motor tinha escrito para
aqueles meses são apagadas. Deixá-las no DRE seria pior: números que ninguém mais consegue
explicar. **Linha marcada como editada à mão nunca é tocada** — nem atualizada, nem
removida; ela é contada e reportada (D-A).

### D50 — CNPJ se valida na digitação, nunca no casamento
`isValidTaxId` confere os dígitos de CPF e CNPJ nos formulários de cliente e de pessoa: um
dígito trocado ligaria silenciosamente o dinheiro de outra empresa a este cliente. No
**casamento** com o extrato nada é validado — um CNPJ que falha na conta ainda é o que o
banco mandou, e recusá-lo perderia o movimento.

### D51 — O importador da planilha `DRE Geral` ficou de fora
O PLAN previa semear os contratos de 2026 a partir da aba `DRE Geral`. Não foi construído.

A aba tem uma coluna por mês com o valor já espalhado, e não os campos que um contrato
precisa — início, fim, método de reconhecimento, se o valor é mensal ou total. Importar
isso significaria **inferir** cada um desses campos a partir do formato de cobrança
(`Mensal`/`Kickoff`/`1 NF`/`Ciclo`), e um contrato inferido errado gera cronograma errado
em silêncio, que é o oposto do que este sistema deve fazer.

O caminho honesto é cadastrar os contratos a partir da planilha com uma pessoa decidindo
cada campo, ou definirmos juntos as regras de inferência antes de eu escrever o importador.
Ver Q16.

---

## Parte 9 — Decisões da Fase 4

### D40 — A ordem da decisão: identidade antes de texto, explícito antes de aprendido
O PLAN esboçava "Camada 1: descrição já vista → reusa a última categorização" e as regras
depois. Inverti, e a ordem final é:

1. regra amarrada ao **CNPJ** da contraparte;
2. regra por **texto ou faixa de valor**, por prioridade;
3. o que foi feito da última vez com esse **mesmo CNPJ**;
4. o que foi feito da última vez com essa **mesma descrição**;
5. **nome de pessoa** cadastrada aparecendo na descrição.

Dois motivos.

**Identidade ganha de texto.** O extrato traz o CNPJ da contraparte, que diz *quem* pagou
ou recebeu. Uma descrição diz só como uma string se parece — e nesta empresa `SALESFORCE`
é cliente e fornecedor ao mesmo tempo (receita de R$ 363.548 e custo de R$ 58.380). Casar
por nome jogaria receita e custo no mesmo balde.

**Explícito ganha de aprendido.** Uma regra é como se corrige um erro. Se o histórico
passasse na frente, um lançamento categorizado errado se repetiria para sempre e a única
saída seria caçar o original.

Se você preferir o contrário, é uma linha de código — mas prefiro que a regra que você
escreveu valha mais do que uma decisão antiga que talvez tenha sido um engano.

### D41 — Categorizar em lote não reescreve o que já foi decidido
A varredura só toca em lançamento **sem categoria**, e só acima de 0,8 de confiança. Um
sistema automático que revisa decisões humanas é um sistema em que ninguém confia.

E ela grava pelo caminho normal de escrita, nunca direto na coluna: dar categoria a um
custo é o que cria a linha de competência (D2a). Um `UPDATE` direto deixaria o DRE cego
para toda despesa que a varredura tocasse.

### D42 — Assinatura sem cobrança há dois ciclos entra como encerrada
Rodando sobre as faturas reais, o Google Workspace aparece **duas vezes**: o fornecedor
mudou a descrição em fevereiro. Somar as duas inflava o custo mensal de R$ 5.279 para
R$ 10.075. Uma recorrência sem cobrança há dois intervalos é marcada como encerrada e sai
do total — ou ela parou, ou o nome mudou, e nos dois casos somá-la mente.

### D43 — O valor típico de uma assinatura é uma cobrança que existiu
A mediana de um número par de cobranças devolve a menor das duas do meio, não a média
delas. "Quanto isso custa normalmente" deve ser um valor que foi cobrado de verdade, não
um meio-termo que nunca apareceu em fatura nenhuma.

### D44 — `external_id` não é usado, porque os arquivos não têm
O PLAN previa dedup e match por `external_id`. Nem o extrato nem a fatura do Itaú trazem
identificador estável de transação. A coluna continua no schema; o casamento é por CNPJ e
por descrição normalizada, que é o que os arquivos oferecem.

---

### D31 — O seed preenche saldo de abertura, nunca sobrescreve
O saldo de 01/01/2026 da conta corrente (R$ 510.204,78) está no seed. Rodar o seed de
novo só preenche um saldo que ainda esteja zerado — um valor corrigido na tela de Contas
é preservado. Sobrescrever moveria em silêncio todos os saldos de fechamento do
relatório.

---

## Parte 8 — Achados dos arquivos do banco (13/08/2026)

31 arquivos distintos em `docs/reference/` (40 no disco, 9 são cópias byte a byte). Lidos
com o PDFKit do macOS e com um leitor de xlsx da biblioteca padrão do Python — nenhuma
dependência nova. O que eles mudam:

### A1 — O saldo de 01/01/2026 informado é a posição total, não a conta corrente
O extrato de 2026 abre com `31/12/2025 SALDO ANTERIOR 142.469,28`. Os R$ 510.204,78
informados são conta corrente **mais** o CDB resgatado em 07/01/2026:

    142.469,28 + 367.735,49 = 510.204,77   (1 centavo do informado)

Gravar 510.204,78 na conta corrente contaria o resgate duas vezes e deixaria todo saldo
de 2026 alto em ~R$ 367 mil. O seed usa **142.469,28**, que é o número do próprio banco.
O CDB virou conta própria (D32).

### A2 — São duas contas de cartão, e "4460" nunca foi uma delas
As faturas trazem por dentro a conta `5336.XXXX.XXXX.5780`, com sete cartões
(2227, 4200, 4460, 4740, 6256, 8993, 0063). 4460 é um cartão dentro dela, não a conta.
Existe ainda uma segunda conta de cartão, **8299**, separada. O seed passou a ter as
duas: `Itaucard Empresas — final 5780` e `Itaucard — final 8299`.

### A3 — O nome do arquivo de fatura não vale nada
`Itaucard_4460_fatura_062026.pdf` tem vencimento **05/01/2026**;
`Itaucard_4460_fatura_032026.pdf`, **05/07/2026**. Arquivos com nomes de cartões
diferentes são o mesmo PDF byte a byte. **Conta, cartão e período têm de sair de dentro
do PDF**, nunca do nome. O importador da Fase 3 deve ignorar o nome do arquivo por
completo.

### A4 — O pagamento de fatura casa com a fatura pelo valor exato
Na conta corrente, `BUSINESS 7502-5632` é a conta 5780 e `BUSINESS 4005-1044` é a 8299.
Em 14 de 14 casos entre janeiro e julho de 2026 o débito bate **exatamente** com o
`Total desta fatura` impresso no PDF. É um pareamento determinístico, sem heurística
nenhuma — e é o que liga o `transfer_pair` do D14b à fatura.

Também é o que revela buraco: em 05/06/2026 há um débito de R$ 830,97 da conta 8299 sem
a fatura correspondente na pasta.

### A5 — Três PDFs são ilegíveis por máquina
`Janeiro ate março_pdf (1).pdf`, `abril até junho_pdf.pdf` e `julho_pdf (2).pdf` foram
impressos pelo app do Itaú (`Creator: aplicativoitau Helper`). A fonte embutida é um
subconjunto **sem tabela `cmap` e sem `post`**, e o `ToUnicode` só mapeia dígitos,
espaço, ponto, vírgula e dois-pontos. Só 33% dos caracteres têm Unicode: **toda letra
está perdida**, e mesmo os números saem quebrados. Não há como recuperar sem OCR.
→ Precisam ser reexportados como XLSX/CSV pelo internet banking. Ver Q13.

### A6 — A fatura é de duas colunas e o texto sai intercalado
A extração linear mistura a coluna da esquerda com a da direita na mesma linha
(`19/01 Uber ... 07/01 POSTO DE SER-CT`). O parser da Fase 3 tem de trabalhar com as
**coordenadas** de cada fragmento, não com linhas. Isso torna a trava do D-B ainda mais
necessária: se a soma não bater com o total impresso, a leitura das colunas errou.

### A7 — O layout do extrato XLSX muda entre exportações
`6 (1).xlsx` tem uma coluna `Ag/origem` a mais, empurrando `Razão Social`, `CPF/CNPJ`,
`Valor` e `Saldo` uma posição. O parser tem de casar as colunas **pelo cabeçalho**, não
pela posição.

### A8 — Cobertura do que chegou
- **Conta corrente Itaú:** 2025 inteiro (664 linhas) e 2026 de 01/01 a 03/08, em cinco
  arquivos com sobreposição. O dedup por hash da §7 é o que resolve a sobreposição.
- **Faturas da conta 5780:** 05/09/2025 a 05/08/2026, doze faturas, sem buraco.
- **Faturas da conta 8299:** seis, faltando 05/06/2026 (R$ 830,97) e o segundo semestre
  de 2025.
- **Um terceiro banco:** `Extrato_Financeiro — DYNAMICS DATA` é do **Banco 301, agência
  0001, conta 3111117-6**, de 01/01/2025 a 07/10/2025 — saldo inicial R$ 45.999,99,
  entradas R$ 398.776,65, saídas R$ 444.776,64. **Conta encerrada — fica fora** (D33).

---

## Parte 7 — Pendências abertas

Precisam de resposta antes da fase indicada.

| # | Pendência | Bloqueia |
|---|---|---|
| ~~Q1~~ | ~~**Impostos.**~~ **Respondido em 14/08/2026:** vale o que foi pago. A D14c fica confirmada. Ver D58. | — |
| Q2 | **Segunda entidade.** Não chegou nenhuma planilha nem extrato da `GABRIEL SAMPAIO JACOB LTDA - ME`. O SPEC fala em três planilhas; chegou uma. | Fase 2 |
| ~~Q3~~ | ~~**Férias.**~~ **Respondido em 14/08/2026:** sem provisão. A D2c fica confirmada e a aba `DRE Geral` é a que vale. Ver D59. | — |
| Q4 | **Metas.** D3 diz "só realizado", mas a planilha tem meta de receita (R$ 7.000.000) e meta de OPBB (36%). Quer isso na tela ou fica fora? | Fase 8 |
| ~~Q5~~ | ~~**Onde rodam os testes de RLS.**~~ **Resolvido em 14/08/2026:** rodam contra o próprio projeto Supabase, numa transação revertida — sem Docker e sem dependência nova. `npm run verify:rls`. Ver D75. | — |
| ~~Q6~~ | ~~**Projeto Supabase.**~~ **Resolvido em 14/08/2026:** projeto criado, migrations aplicadas, seed rodado e usuário vinculado às duas entidades. | — |
| ~~Q7~~ | ~~**Rateio de pessoas por cliente/squad.**~~ **Respondido em 14/08/2026:** sim, margem por cliente. Entra na Fase 8. Ver D60. | — |
| Q8 | **Pipeline de vendas.** A aba `Vendas e Perdas` é um CRM (cliente, status, responsável, valor). Nenhuma fase do SPEC cobre isso. Fica fora? | — |
| Q9 | **Arquivo alheio na pasta.** `docs/reference/Cópia de Autorização de saída - Saint Paul 21_08.docx.pdf` é uma autorização de saída escolar, não tem relação com o financeiro. Não abri. Apagar? | — |
| ~~Q10~~ | ~~**Saldo de abertura de 01/01/2026.**~~ **Respondido em 13/08/2026:** a conta corrente Itaú tinha **R$ 510.204,78** em 01/01/2026. Está no seed. A dívida do cartão Itaucard na mesma data continua desconhecida e segue em 0,00. | — |
| ~~Q12~~ | ~~**O CDB vira conta própria?**~~ **Respondido em 13/08/2026:** sim, conta de aplicação separada. Ver D32. | — |
| Q13 | **Reexportar três extratos.** `Janeiro ate março`, `abril até junho` e `julho` são PDFs impressos pelo app do Itaú e não têm texto recuperável (A5). Preciso deles em XLSX/CSV. | Fase 3 |
| ~~Q14~~ | ~~**Banco 301, conta 3111117-6.**~~ **Respondido em 13/08/2026:** conta encerrada, fica fora. Ver D33. | — |
| Q15 | **Fatura 8299 de 05/06/2026** (R$ 830,97) não está na pasta, e faltam as de set–dez/2025 dessa conta. | Fase 3 |
| Q18 | **A API da Anthropic nunca foi chamada de verdade.** Todo o caminho de IA está testado com o modelo mockado; sem `ANTHROPIC_API_KEY` nenhuma chamada real aconteceu. O formato da resposta e a qualidade das sugestões só se conhecem rodando. | uso real |
| Q17 | **Guardar o arquivo do contrato no Supabase Storage?** Hoje a extração lê o arquivo e o descarta, ficando só o rascunho e os trechos. Guardar o original ajuda numa auditoria futura, mas precisa de bucket, policy e de um projeto Supabase para testar. Ver D67. | Fase 8 |
| Q16 | **Importar os contratos de 2026 da aba `DRE Geral`?** A aba tem o valor espalhado por mês, mas não início, fim, método nem se o valor é mensal ou total — tudo isso teria de ser inferido do formato de cobrança. Prefere cadastrar à mão a partir dela, ou definimos as regras de inferência? Ver D51. | Fase 6 |
| Q11 | **O caminho de escrita do app está sendo exercitado.** Migrations, seed, RLS e **importação** confirmados em 14/08/2026 — a importação sozinha revelou cinco bugs (D77–D81), um deles corrompendo todo valor inteiro. Falta exercitar: aprovar para o ledger, espelho de competência, reconhecimento de contrato e POC. | uso real |
