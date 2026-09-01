# Handover — 28/08/2026

Onde tudo está, o que foi feito, e o que falta. Escrito para quem chega sem contexto
nenhum, inclusive eu mesmo numa conversa nova.

Leia junto quando precisar do detalhe: `docs/PLAN.md` (o roteiro original),
`docs/DECISIONS.md` (decisões numeradas D1–D122 e pendências Q2–Q18) e `README.md`.

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

### O documento de ações do Andre

**https://claude.ai/code/artifact/921c9b4d-41fa-45c5-b98e-3966672097f7**

É o **único lugar onde o Andre vê a lista** do que depende dele. Republique o mesmo arquivo
para manter o link — publicar sem passar a URL cria um artefato novo e ele fica com a versão
velha na mão. Atualize sempre que o estado mudar; uma lista desatualizada é pior que
nenhuma, porque ele age em cima dela.

> O portão de publicação exige ter **lido o arquivo salvo inteiro** (inclusive a linha 1, que
> é o runtime injetado) *depois* da última leitura da URL, e na mesma sequência. Ler, publicar,
> ler de novo não destrava — é buscar, ler tudo, publicar.

### Os dados reais

`docs/reference/` — **está no `.gitignore` e nunca entra no git.** Tem extrato bancário,
CNPJ de cliente e saldo.

- `Claude de DRE - Dynamics Data 2026.xlsx` — a planilha mestre. Abas: `DRE Geral`
  (receita nas linhas 2–90, custo nas 95–140), `Colaboradores`, `New Squads`, `Cargos`,
  `Organograma Projetos`, `Vendas e Perdas`.
- `Fluxo de Caixa - 2026.xlsx` — **a segunda planilha, chegou em 24/08.** É de fluxo, não
  de DRE. Abas: `Setup`, `Income`, `Clientes`, `Expenses`, `Pessoas`, `Summary`. A aba
  `Clientes` tem **CNPJ e e-mail** de 32 clientes e duas seções — `Emissão de NF` e
  `Pagamento de NF` —, e é a segunda que responde pergunta de caixa, porque é sobre
  dinheiro recebido. **A marcação azul nas colunas de mês é a Gabriel Sampaio Jacob**
  (D104): 24 clientes, R$ 1.486.782,66, tudo de agosto em diante.
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
npm run check               # typecheck + lint + 402 testes
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
npm run import:sispag       # troca os lotes SISPAG pelos pagamentos de dentro (D96)
npm run recategorize        # aplica o motor ao que já está no razão (D97)
npm run boletos             # os BOLETOS RECEBIDOS da Mash (--ensaio / --aplicar, D109)
npm run lotes               # os últimos lotes SISPAG, nomeados pelo banco (D118)
npm run corrigir            # conta errada em linha que já tem conta (D119)
npm run folha               # a folha em competência, lida da Colaboradores (D120)
npm run socios              # separa distribuição de lucro do salário dos sócios (D110)
npm run comparar            # a DRE do app contra a da planilha, linha a linha (D114)
npm run comparar:fluxo      # o fluxo do app contra a aba Expenses, linha a linha (D116)

npm run propose:rules       # regras de texto vindas da planilha
npm run propose:parties     # casa nome da planilha ↔ contraparte do extrato
npm run propose:suppliers   # promove a documento a conta que o razão já decidiu (D100)
npm run propose:contracts   # contratos do bloco de receita
npm run recognize:manual    # plano mensal dos contratos manuais
npm run import:invoices     # faturas de cartão em massa
```

---

## 3. O que o sistema tem hoje

| | |
|---|---|
| Razão de caixa | **1.067 lançamentos**, 06/08/2025 a 31/07/2026 |
| Categorizados | **1.044 (97,8%)** — 23 sem conta |
| Competência | 284 de receita (206 do motor + 78 manuais) · 823 de custo, sendo **593 espelho de caixa e 230 de folha lida da planilha** (D120) |
| Receita reconhecida | **R$ 3.556.736,91** (jan–ago/2026) |
| Contratos | 80 (65 ativos, 15 concluídos), 95 parcelas mensais |
| Clientes / pessoas | 73 / 40 |
| Regras | 223 |
| Importações | 23 |
| Notas fiscais | **0** |

### Contas

| Conta | Tipo | Abertura | Lançamentos | Situação |
|---|---|---|---|---|
| Itaú — conta corrente | banco | 142.469,28 em 01/01/2026 | 546 | ✅ bate com o extrato |
| Itaú — CDB DI | aplicação | 367.735,49 em 01/01/2026 | 5 | ✅ as duas pernas existem (§5.1) |
| Contabilizei | banco | 0,00 | 0 | inativa |
| Itaucard 5780 | cartão | 0,00 | 468 | |
| Itaucard 8299 | cartão | 0,00 | 48 | |

**Sete conferências que fecham hoje.** As três primeiras são o sistema conferindo contra si
mesmo e contra o banco; as quatro últimas são o sistema conferindo contra **as planilhas do
Andre**, que têm critério próprio — e é por isso que nenhuma delas é um `verify:`. Transformar
a escolha dele em regra de código seria tirá-la dele.

- A conta corrente marca **226.916,33**, que é o `SALDO TOTAL DISPONÍVEL` declarado pelo
  banco em 31/07/2026. Ao centavo.
- A receita reconhecida bate com a planilha **mês a mês** — R$ 0,03 de diferença acumulada
  em oito meses, puro arredondamento dela mesma.
- **A DRE e o fluxo de caixa fecham nos 13 meses, com resíduo zero** (`verify:reconcile`,
  D85). Os dois razões não batem — não é para baterem —, mas toda diferença entre eles tem
  nome.
- **Nenhuma saída de caixa fica sem competência** (D120, D121). Essa linha da ponte valia
  **R$ 1.281.607,12** em 20/08 — era a lista de tarefas do projeto em forma de número — e hoje
  tem **zero linhas**.
- **As saídas do fluxo batem com a aba `Summary` da planilha de caixa** em cinco dos sete
  meses, **ao centavo** (D108). Nos outros dois sobram R$ 169,00 e R$ 218,88, dois estornos
  pequenos sem documento para parear. A distância somada é **R$ 387,88**, e ela **não se moveu
  quando a D116 quebrou a fatura nas compras** — o que prova que a quebra só mudou composição.
- **As 31 linhas de custo da `DRE Geral` fecham com as do app** (D114, D120), e nenhuma delas
  fica de fora em qualquer alinhamento. `- Salários` marca **R$ 1.368.044,69 dos dois lados,
  nos sete meses**.
- **A linha de sócios do fluxo bate com a linha `Distribuição de Lucro` da planilha de
  caixa, mês a mês, nos sete meses, com distância somada R$ 0,00** (D110 e D112). `6.11`
  marca **R$ 313.014,93** e `99.04` marca **R$ 442.500,00**; somados, **R$ 755.514,93**. A
  D110 provou a soma; a D112 provou **cada mês**, que é mais forte — uma soma pode fechar com
  dois erros que se cancelam.

> **A que ainda não fecha é o fluxo por sub-linha** — 23 das linhas da aba `Expenses` fecham
> os sete meses, e a distância somada é R$ 26.082,92. A causa é agrupamento, não conta, e o
> conserto é o passo 1 da §6.

---

## 4. O que foi feito

**58 commits** na branch, de `aa9250d` (onde o `main` está). Por tema, não por
ordem — e o fio que liga quase tudo é o mesmo: **o dado real chegou e mostrou onde o
sistema mentia.**

### O SISPAG, que era o maior buraco do projeto

De janeiro a março de 2026 o extrato em XLSX entregava os pagamentos **agregados em lotes**:
34 linhas de `SISPAG FORNECEDORES` somando **R$ 1.221.679,97**, sem contraparte nenhuma. Era
95% de todo o custo que não aparecia na DRE, e nenhuma regra resolvia — o nome não estava no
arquivo.

- **O PDF "ilegível" era legível** (D96). A Q13 dava três PDFs como perdidos por "fonte sem
  mapa Unicode". A fonte é mesmo um subset sem `cmap`, mas o problema real é outro: **o
  `/ToUnicode` do próprio arquivo está errado** — declara que os glifos `0x1c`–`0x25` são os
  dígitos `0`–`9`, e são as letras `G`–`P`. O arquivo mente sobre si mesmo, e é por isso que
  toda ferramenta falha. O mapa verdadeiro é contíguo e trivial depois de visto.
- **A decomposição fecha ao centavo.** 19 de 19 datas, R$ 1.221.679,97 contra
  R$ 1.221.679,97. Os 34 lotes viraram **116 pagamentos com nome e CPF/CNPJ**, 49
  contrapartes. O saldo da conta corrente não se moveu.
- **O motor alcançou o razão** (D97). As 63 regras por documento que o Andre respondeu uma a
  uma não chegavam nas linhas já aprovadas (D88). `recategorize` resolveu isso separando
  **regra de palpite**: regra entra com `--aplicar`, histórico exige `--incluir-historico`.
  Aplicadas as 63 → **R$ 863.414 de custo entrando na DRE**, todas em 6.10 Freelancers, que
  é o que os lotes sempre foram: a folha de terceiros.

### A D88 tinha um segundo andar: quem propõe também lia só o staging

- **Sete colaboradores estavam invisíveis** (D98). A D97 consertou o motor; ficaram
  `propose:parties` e `propose:rules`, que liam da mesma `staged_transactions`. Como o
  `import:sispag` escreve **direto no razão**, 13 contrapartes existiam sem que quem deveria
  identificá-las pudesse vê-las — 102 documentos no staging contra 115 no razão.
- **O silêncio não foi o pior.** Sem o documento verdadeiro no universo, o casamento estrito
  não achava nada e a parte caía na regra aproximada, que exige **um** token distintivo.
  `Vitor Oliveira`, `Anna Flavia de Oliveira` e `Jonailson Junior` foram todos reivindicar
  `ROBERTO PASCOAL DE OLIVEIRA JUNIOR`, pelo sobrenome, e o relatório imprimiu uma **disputa
  de três vias que nunca existiu**. Com o razão no universo, ela desaparece sozinha.
- **Resultado:** 7 partes cadastradas, 7 regras por documento, e o `recategorize` levou
  **9 lançamentos, R$ 32.370,00** para 6.10 Freelancers. Cobertura 78,2% → **79,0%**.

### O que o razão já sabia, mas não alcançava

- **Promover ao documento a decisão já tomada** (D100). Regra de texto nunca vai alcançar
  uma linha cuja descrição é `PAGAMENTOS A FORNECEDORES` — o nome do fornecedor não está
  ali. Mas o mesmo CNPJ aparece em linhas que o banco *nomeou*, já categorizadas há tempo
  pela regra de texto da planilha. `propose:suppliers` promove essa conta a **regra por
  documento**: 5 regras, **17 lançamentos, R$ 27.945**.
- **A guarda que torna isso seguro** é exigir que uma **regra explícita** já explique as
  linhas decididas. Sem ela, o script lavaria palpite do histórico em regra. Ela reteve
  sozinha `Hold Beauty` e `Hogrefe` — que são justamente as perguntas de contrato em aberto
  no `decisoes` §2 — e marcou o `PDG IT` como ambíguo.
- As três linhas da **Ciclo** foram para **8.03 Agência**, a conta certa. O histórico as
  mandaria para 6.10, que é o erro que a D99 mediu.

### As respostas do Andre, e o que elas ensinaram (D104–D107)

O dado real acabou; o que destravou o resto foram respostas dele, e três mudaram o **desenho**:

- **Quem paga não é quem contrata.** `APARECIDO` é o João Beato, `ETG` é o CNPJ do Esdras,
  `MARA THAYSA` pagou pela Iled e `ROBERTO PASCOAL` pela B2B Câmbio. Nenhum casamento
  automático chegaria a nenhum deles — e o `vincular` ganhou uma tabela **`PAGADORES`**
  separada da `CONFIRMADOS`, porque *"este documento é o cliente"* e *"este documento paga
  por ele"* são afirmações diferentes.
- **A pergunta do contrato estava mal feita** (D104). Não era *qual conta é esse cliente*,
  era **qual conta é esse recebimento** — Hold Beauty e Hogrefe caem **nas duas**. A regra
  agora prende **valor** além de documento e sentido, e envelhece mal de propósito: quando o
  retainer da Hold Beauty cair para R$ 7.200 em agosto, nenhuma regra casa e a linha aparece
  pedindo decisão, em vez de entrar calada na conta errada.
- **A regra existia; o apelido é que faltava** (D106). A planilha nomeia *categorias*
  (`Hotels`, `Passagem`, `Alimentação`); o cartão só traz *loja*. A tabela `ALIASES` é a
  ponte, e só tinha as lojas visíveis no dia em que foi escrita. 52 apelidos novos → **77
  lançamentos, R$ 71.671,64**, e a cobertura saltou de 84,2% para 91,4%.
- **O fluxo mostra o que saiu e não voltou** (D107). Pagamento estornado some das duas
  colunas. O par exige documento, valor **e categoria** iguais — a terceira condição é a D83,
  e é o que impede a Ciclo de ter um recebimento anulado contra um pagamento legítimo.

### As duas últimas respostas, e o que elas custaram para executar (D108–D109)

- **Uma transferência só é transferência quando as duas pernas estão no relatório** (D108).
  O Andre respondeu que a fatura do cartão conta como saída. O que quase entrou no código
  foi uma exceção — *"`99.02` é o caso especial"*. A regra verdadeira já estava escrita em
  `CASH_ACCOUNT_TYPES`: o CDB está dentro do relatório, o cartão não está. Cinco dos sete
  meses foram a **R$ 0,00** contra a aba `Summary`, e a distância somada caiu de
  R$ 224.672,43 para **R$ 387,88**. A DRE não se mexeu — lá o custo é a compra, não a fatura.
- **Os boletos se identificaram por eliminação** (D109). Das quatro candidatas a dona da
  parcela de R$ 5.000, três **já estão no razão com nome próprio** nos mesmos meses — se
  fossem o boleto, teriam pago duas vezes. Sobrou a Mash, e o contrato `project` dela fecha
  em R$ 20.000 = 4 × 5.000. Não é o script adivinhando identidade (D87): é medir quem não
  pode ser, sobrar um, e o dono confirmar.
- **Três boletos eram uma linha de extrato com duas contas dentro.** R$ 8.300 é 3.300 do
  Ongoing mais 5.000 do Projeto, e por isso o banco escreve "boletos" no plural. O Andre
  mandou partir; `npm run boletos` faz isso com **trava de saldo como condição de saída**, e
  a filha que sobrevive **herda o `dedup_hash` da mãe** — sem isso, reimportar o extrato
  dobraria os R$ 8.300 em silêncio.

### A resposta que mudou o tamanho da DRE (D110)

A pergunta aberta desde 20/08 — *a folha de terceiros é salário ou freelancer?* — estava mal
feita, como a da D104. O Andre respondeu que o balde `Pessoas` da planilha de caixa tem
**três coisas dentro**: salário interno, freelancers e **distribuição de lucro dos sócios**;
e que na DRE dele *só os salários* entram, enquanto no fluxo entra tudo.

- **R$ 442.500 de distribuição de lucro estavam dentro de `6.10 Freelancers`**, que é conta
  de custo. O SISPAG entrega CPF e valor, nunca a natureza do pagamento, e a D97 levou tudo
  para a mesma conta porque ninguém tinha como separar olhando um CPF.
- **A conta certa já existia e estava vazia desde a D24.** `99.04 Distribuição de lucros` é
  `owner_draw`, e o `src/lib/pl.ts` já a punha abaixo do EBITDA. Não faltava desenho;
  faltava a informação que só o dono tinha.
- **O método é dele:** a aba `Colaboradores` traz o salário mensal de cada sócio
  (`CUSTODIO`, `JACOB`, `LEONARDO`); o que passa disso é distribuição. De março em diante ela
  é **zero** — os R$ 15.000 mensais são só salário.
- **Ele chamou os R$ 15.000 mensais de pró-labore**, e o app tinha `6.11 Pró-labore` vazia
  desde o seed — eles estavam em `6.10 Freelancers`, que é o nome errado para o que são.
- **Três dos oito lotes SISPAG anônimos ficaram identificados:** 46.250 + 15.000 + 15.000 =
  R$ 76.250. O R$ 46.250 reaparece **nomeado no Leonardo em 10/02**, e é essa repetição — não
  a soma — que prova a leitura.
- **Aplicado em duas rodadas:** 50 lançamentos ao todo. `99.04` ficou com R$ 442.500,00,
  `6.11` com R$ 313.014,93, e `6.10` com R$ 901.092,02, que é o time sem sócios dentro. O
  resultado acumulado subiu de R$ 1.156.625,50 para **R$ 1.522.875,50**, e o saldo não se
  moveu em nenhuma das duas.
- **Retirada devolvida não é entrada** (D113): ela abate a distribuição em vez de aparecer
  do lado das entradas, na ponte e no fluxo. Somadas as duas linhas davam o número certo;
  separadas, cada uma mentia.
- **No fluxo de caixa as duas viraram uma linha só** (D112), porque o caixa não distingue o
  que a DRE precisa distinguir — é como a planilha dele já lança, dentro do bloco `Pessoas`.
  Agrupar não move dinheiro, e há teste provando que o total da seção e o fechamento do mês
  são idênticos com e sem.
- **A FDN Telecom era o Nicholas Forte** (D111) — a D101 tinha recusado escrevendo *"o nome
  está mentindo sobre a natureza, ou é outra coisa"*, e era outra coisa. Mais 2 lançamentos,
  R$ 10.000, e o resultado fechou em **R$ 1.512.875,50**.

### As duas planilhas viraram critério de aceitação (D111–D122)

Em 27/08 o Andre estreitou o que o app tem de entregar, e a frase é o critério:

> *"O app tem que me dar duas coisas apenas: um fluxo de caixa igual ao que tenho na planilha
> e, em outra aba, o DRE igual à planilha de DRE que tenho."*

Isso transformou "comparar as duas DREs" de curiosidade em obrigação, e o que se seguiu saiu
quase todo de **medir uma contra a outra**:

- **A comparação linha a linha existe** — `npm run comparar` (competência) e
  `npm run comparar:fluxo` (caixa), D114 e D116. A hipótese com que construí o primeiro
  estava errada: eu esperava a DRE do app ser a dele deslocada um mês, e **31 linhas fecham
  alinhadas** contra 6 defasadas. A defasagem é de boleto e folha, não de tudo.
- **A fatura do cartão deixou de ser uma linha e virou as compras dentro dela** (D116), no mês
  em que foi paga, como a planilha dele faz. Cada arquivo de fatura importado é uma fatura, e
  13 dos 14 pagamentos casam com uma delas ao centavo. **Antes disso, `Gsuite` no fluxo valia
  zero.**
- **A folha em competência passou a ser lida da aba `Colaboradores`** (D120) e o pagamento
  deixou de espelhar. `- Salários` fecha **7 de 7 meses, R$ 1.368.044,69 dos dois lados**, e o
  comparador foi de uma linha que não fechava em nenhum alinhamento para **zero**.
- **O bloco SISPAG acabou** (D118): dos oito lotes sem nome, três eram pró-labore e
  distribuição de sócio e cinco o banco nomeou. Dois vinham ambíguos e se resolveram por
  eliminação, como na D109.
- **As 31 contrapartes sem dono viraram uma** (D111, D115, D117). Santa Monica e WCommerce
  ganharam conta própria — `6.12`, criada porque ele separa freelancer-empresa do time nos
  dois arquivos. Sobrou a Keepclear, R$ 0,01, sem conta de propósito.
- **Duas linhas estavam na conta errada e nenhuma ferramenta as alcançava** (D119). O
  `recategorize` e o `propose:suppliers` filtram `category_id is null`: linha categorizada
  errada sobrevivia a tudo. Corrigir as duas derrubou a distância do fluxo em R$ 31 mil **sem
  um centavo de dinheiro novo** na DRE.
- **A pergunta dele sobre R$ 169 achou 21 estornos** (D121). Aquilo era a *cobrança*, não o
  estorno, e a conta de tarifas tinha R$ 1.861,50 cobrados e nenhum dos R$ 1.288,73 devolvidos.
- **E o construtor de regras jogava o sentido fora** (D122), em dois lugares. Toda regra de
  entrada cujo texto já viesse do bloco de custo da planilha sumia em silêncio.

> **O número que fecha o arco:** `Saídas de caixa sem competência` valia **R$ 1.281.607,12**
> em 20/08 e hoje tem **zero linhas**. Não sobra um centavo que tenha saído do caixa sem
> destino declarado na DRE.

### A ponte entre os dois razões

- **`verify:reconcile`** (D85). Mês a mês, prova que o resultado da DRE é o caixa
  operacional mais um conjunto de diferenças **todas nomeadas**, e que não sobra centavo.
  Sai com código 1 se sobrar. Os dois razões não batem — não é para baterem —, mas nenhuma
  diferença entre eles é anônima.
- Foi a ponte que **previu** o efeito do SISPAG antes de ele acontecer, e que **provou**
  depois que nada se perdeu: a linha "saídas de caixa sem competência" caiu exatamente os
  R$ 863.414.

### Categorização determinística

- **Regra por sentido** (migration `0004`). A regra `CICLO` → Agência pegava cinco
  recebimentos da Ciclo: receita virando despesa. É o mesmo problema da Salesforce, que é
  cliente e fornecedora ao mesmo tempo.
- **Entrada parada em conta de custo** (`fix:credits`, D83). No cartão, um crédito só pode
  ser estorno de compra. No banco, é devolução só se o pagamento que ela reverte estiver na
  mesma categoria. Tirou **R$ 218.800 de custo fantasma** da DRE sem mover o saldo.
- **Trava no motor para o defeito não voltar** (D86). Medindo o que o motor decidiria para
  as linhas sem conta, ele decidiria 5 — e as 5 eram exatamente as que a D83 tinha acabado
  de corrigir, pela camada de histórico. O histórico aprende com o passado e não sabe nada
  sobre sentido, então perdeu o direito de pôr **entrada** em conta de custo. De 5 sugestões
  erradas para 0.
- **Identidade por documento** (`propose:receipts`, D87/D89/D94), com recusas deliberadas:
  **CPF nunca é cliente**; o script **não cadastra cliente** (o dry run mostrou a Ciclo a
  caminho de ser duplicada); e o desempate mais forte entre contratos é a **vigência** —
  dinheiro não paga contrato que ainda não existia.
- **Um cliente pode pagar de mais de um CNPJ** (D94). Center Norte paga pela Associação dos
  Lojistas *e* por uma SPE. `clients.tax_id` guarda um; o segundo vira **regra por
  documento**, que já era o mecanismo do projeto para isso.
- **Casamento aproximado com corte em seis letras.** Token de 6+ a uma letra de distância é
  evidência; cinco letras é coincidência.

### Importação

- **19 faturas de cartão** (516 lançamentos) em massa, identidade lida de dentro do PDF.
- **Leitor da Contabilizei** — uma terceira conta bancária que ninguém tinha citado, achada
  procurando nota fiscal.
- **Leitor do extrato em PDF** (`itau-statement-pdf.ts`), que só existe por causa do SISPAG.

### Competência

- **80 contratos** lidos da planilha, fechando com o total do ano declarado nela.
- **Contrato pode declarar sua conta de receita** (migration `0005`).
- **`recognize-manual`** grava o plano mês a mês dos contratos de valor variável.

### Diligência

- **A conta CDB ganhou as duas pernas** (D84). Tinha saldo de abertura e zero lançamentos;
  o caixa total estava **subestimado em R$ 117.264,51**, não superestimado como o handover
  anterior dizia.
- **`verify:rls` 7/7** depois de cada escrita, sem exceção.
- **`origin/main` empurrado**, de `60ad19f` ("fase 2") para `aa9250d`.
- **2025 removido do razão** a pedido, com o saldo provando o corte ao não mudar.

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

> **Fechado de vez em 24/08/2026 (D103).** A D83 tirou a categoria das duas devoluções do
> Ricardo porque a perna de saída estava dentro de um lote SISPAG e a condição que ela mesma
> escreveu — *"é devolução só se o pagamento que ela reverte estiver na mesma categoria"* —
> era **inverificável**. O `import:sispag` abriu os lotes e mostrou **pagamento em
> duplicidade**: 115.000 saiu duas vezes em 08/01 e uma voltou; 50.000 saiu duas vezes em
> 09/02 e uma voltou. Confirmado pelo Andre. Com a regra por documento em `direction = 'in'`
> → 6.10, o resultado **subiu R$ 165.000** — custo que a empresa nunca teve.

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

### 5.4 O que a ponte mostra que ainda vai mexer no resultado

Os dois razões fecham hoje, mas fechar não é o mesmo que estar completo. Somadas as
diferenças dos 13 meses:

| | |
|---|---|
| Receita reconhecida no mês | + R$ 3.556.736,91 |
| Entradas de caixa sem competência | − R$ 2.831.308,69 |
| Custo sem caixa nenhum | − R$ 1.368.044,69 |
| Folha paga, com competência na planilha | + R$ 1.224.299,02 |
| Distribuição de lucro aos sócios | + R$ 442.500,00 |
| Custo de compra no cartão | − R$ 219.356,95 |
| **Saídas de caixa sem competência** | **R$ 0,00** |

> **A linha de baixo era a lista de tarefas do projeto, e acabou de vez.** Ela valia
> **R$ 1.281.607,12** em 20/08 e hoje tem **zero linhas**: não sobra um centavo de dinheiro
> que saiu do caixa e não tenha destino declarado na DRE. O que a esvaziou foram duas coisas
> — a D120 tirando a folha de dentro dela, e a D121 achando que os últimos R$ 169 eram uma
> **cobrança** que o banco estornou, não o estorno.

> **A linha dos sócios é líquida de propósito (D113).** Ela chegou a ser duas — distribuição
> bruta e devolução —, e separadas as duas mentiam: a empresa não distribuiu R$ 607.500, e
> devolução de retirada não é dinheiro ganho. O que houve foi uma distribuição de
> R$ 442.500.

> **As duas linhas de sócios nasceram na D110, e a razão é a lição da D109.** Depois de mover
> a distribuição para `99.04`, a linha do meio saltou para R$ 724.234,67 — e ela é lida como
> lista de tarefas, dinheiro que *ainda* vai pesar na DRE. R$ 501.250 dela nunca vão pesar:
> estão fora por decisão. Os 13 meses fechavam e o resíduo era zero, e mesmo assim o número
> tinha passado a mentir. Com as duas linhas próprias, as antigas voltaram aos valores
> exatos de antes, que é a prova de que nada vazou.

A linha do meio é a lista de tarefas em forma de número: **R$ 222.984,67 que saiu do caixa
e ainda não pesa na DRE**, porque essas linhas não têm categoria. Conforme forem
categorizadas, o custo cresce e o resultado cai, **sem o caixa mudar um centavo**.

> Ela era **R$ 1.281.607,12** até 20/08. O SISPAG levou R$ 863.414 embora de uma vez, a
> D98 mais R$ 32.370, a D100 mais R$ 27.945 e a D101 mais R$ 72.493 — e essas quedas,
> medidas na ponte, são a prova de que nada se perdeu pelo caminho.

> **Os boletos da D109 não a moveram, e está certo.** São entrada, não saída; e receita
> nasce de contrato e NF (SPEC §5), então categorizar recebimento não cria espelho de
> competência. É o mesmo comportamento da D102 e da D105.

---

## 6. O que falta, e em que ordem

**23 lançamentos, R$ 8.352,10** — R$ 6.552,08 líquidos. É só descrição de cartão que ninguém
reconhece. **Nenhum outro bloco de categorização resta.**

Rode **`npm run pendencias`** (o quadro por dinheiro) e **`npm run decisoes`** (as perguntas
com a evidência do lado). Para medir contra as planilhas: **`npm run comparar`** e
**`npm run comparar:fluxo`**.

> ℹ️ Depois de responder qualquer coisa: **`npm run vincular`** grava identidade,
> **`npm run propose:suppliers`** promove a regra por documento e **`npm run recategorize`**
> leva ao razão. Para linha **já categorizada** e errada, é **`npm run corrigir`** (D119) —
> nenhum dos outros alcança.

### Onde as duas abas estão hoje

| | |
|---|---|
| **DRE × planilha de DRE** | **31 de 31 linhas fecham**; zero não fecham em nenhum alinhamento |
| **Fluxo × aba `Expenses`, por grupo** | nenhum grupo fecha os 7 meses; distância somada **R$ 8.250,50**. `Pessoas` fecha 6/7, errando os R$ 218,88 do estorno de julho (D126) |
| Fluxo × aba `Expenses`, por sub-linha | 23 linhas fecham os 7 meses; distância somada R$ 26.082,92. Maior que a de cima **porque a Agência Ciclo não tem linha na planilha** — é altura de medição, não erro |
| Saídas do fluxo × aba `Summary` | 5 dos 7 meses ao centavo, distância R$ 387,88 (D108) |

### O que falta, por natureza

| bloco | quem resolve | valor | o que é |
|---|---|---|---|
| **23 descrições de cartão** | **o Andre** | R$ 8.352,10 | `SQ *DREAMFORCE SF`, `ASA*MARIA CLARA` ×3, `APPLE.COM/US`, `PIU R E P L EP`. Três faturas resolvem quase tudo: **out/2025, mai/2026 e jun/2026**. |
| **Extrato do Itaú da Gabriel** | **o Andre** | R$ 259.845,85 | Q2. Destrava mover a receita de agosto para a segunda empresa. Sem ele, ela ficaria com receita e nenhum caixa para conferir. |
| **`ANTHROPIC_API_KEY`** | **o Andre** | — | Q18. Não bloqueia nada, mas o caminho de IA **quebra na primeira chamada real** — ver abaixo. |
| ~~Os grupos do fluxo~~ | ~~eu~~ | — | **Feito** — D125 na tela, D126 na medição. |
| ~~O prefill do provider~~ | ~~eu~~ | — | **Feito** — D124, `output_config.format` no lugar do prefill. |

### Próximos passos, em ordem

> ~~**1. Construir os grupos do fluxo.**~~ **Feito em 31/08 (D125)** e **medido em
> 01/09 (D126)**: a aba de Saídas tem grupo com sub-linha e subtotal, e o `comparar:fluxo`
> ganhou uma tabela por grupo além da que já tinha por sub-linha. A Agência Ciclo dentro de
> `Pessoas` fecha 6 dos 7 meses, como estava previsto.
>
> ~~**2. Consertar o prefill antes de pedir a chave.**~~ **Feito (D124):** `output_config.format`
> no lugar do `prefill: "["`, que retornava 400 em todo modelo atual. **Modelo recomendado:
> `claude-opus-5`** — o razão inteiro, do zero, custa ~US$ 1,75, e `ANTHROPIC_MODEL` troca sem
> mexer em código.

**Os dois passos que eram meus acabaram. O que resta depende de arquivo que não chegou.**

1. **As 23 descrições**, quando ele abrir as três faturas (out/2025, mai/2026, jun/2026).

2. **O extrato da Gabriel**, quando chegar.

### O que a comparação com o fluxo ainda mostra, e por quê

Dos **R$ 8.250,50** que sobram no nível do grupo, tudo tem causa nomeada — e a leitura por
sub-linha, que dá R$ 26.082,92, é maior só porque a Agência Ciclo não tem linha lá (D126):

- ~~**`Time`**: a planilha dele conta a Agência Ciclo dentro; o app ainda não.~~ **Resolvido
  pela D125** — `8.03` entra em `Pessoas`, e o grupo fecha 6 dos 7 meses.
- **`Passagem`, `Hotels`, `Alimentação`**: parte das 23 descrições do cartão.
- **`Legal` e `Imposto`**: o app está **R$ 440 acima** e a planilha R$ 440 abaixo — é o
  **INPI** (D117), registro de marca pago em maio, enquanto o `- Juridico` dele é zero de
  março em diante. **O app tem um fato que a planilha lança em outro lugar**, e tirar de lá
  para melhorar o número seria otimizar para a planilha em vez de para o razão.
- **`IOF` e `Tarefy`**: mês de corte diferente.

### Julho não fecha com a planilha, e vale olhar

Conferido na D107: a planilha diz ter recebido em julho **R$ 18.800 que o banco não mostra**
— CSO R$ 3.000, Medcom R$ 5.000 e **GM Promo R$ 10.800 (o Andre já confirmou o pagamento)**.
Em compensação, a **RiHappy pagou R$ 12.000 duas vezes** em 29/07 e a planilha conta uma só
(o Andre já corrigiu do lado dele).

`18.800 − 12.000 = 6.800`, mais o rendimento de R$ 36,54, fecha a diferença exata.

> **A convenção para pagamento dobrado**, dada pelo Andre: na **DRE**, R$ 12.000 em cada mês;
> no **fluxo**, R$ 24.000 no mês em que foi pago. É exatamente como os dois razões já se
> separam (D2).

### A folha dos próximos meses, combinada e ainda aberta

A D120 cobre **jan–jul/2026 e só**. O Andre disse *"ajustamos os próximos meses juntos"*, e o
`npm run folha` **recusa rodar de novo no mesmo período** em vez de duplicar. Como a folha
entra de agosto em diante é decisão que continua aberta — e é a única coisa do desenho que
está pendente.

### Depende de arquivo ou chave que não chegou

| # | O que falta |
|---|---|
| **Q2** | **Extrato do Itaú da Gabriel Sampaio Jacob.** Só o que é de agosto em diante migra, e ela recebe no Itaú. A conta é nova e pode não ter movimento ainda. |
| **Q18** | `ANTHROPIC_API_KEY` vazia. O Andre resolve com o chefe, por causa do pagamento. Não bloqueia nada — mas ver o passo 2. |
| **NFs** | Zero cadastradas. A Fase 5 concilia NF contra caixa e não tem dado nenhum. |
| ~~Faturas 8299~~ | **set/out/nov de 2025 — sem acesso, buraco permanente.** Não procure de novo. |
| **Fatura 8299 de maio/2026** | Nunca importada. É o único pagamento de fatura que a D116 não quebra: R$ 830,97 continua como linha única. |

> **Sobre o rendimento do CDB:** R$ 485.000 aplicados desde junho renderam R$ 28,43 (jun) e
> R$ 38,59 (jul) **visíveis** — isso é a varredura automática, não o CDB. O rendimento dele
> provavelmente só credita no resgate, então o saldo é **só principal**. Não é urgente.

### Decisões antigas ainda abertas

`Q4` (metas na tela), `Q8` (a aba `Vendas e Perdas` é um CRM — nenhuma fase cobre),
`Q9` (documento escolar alheio na pasta — apagar?), `Q16` (contratos), `Q17` (arquivo do
contrato no Storage).

> ~~**3.05 Receita financeira**~~ — **o Andre decidiu em 25/08 não criar.** Os rendimentos
> ficam em `99.03`, que é transferência, e seguem **fora da DRE**. É decisão, não esquecimento.


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
- **Trava de sentido tem duas pontas, e é fácil travar só uma.** A D86 impediu **entrada em
  conta de custo** e deixou **saída em conta de receita** passar — mesma causa, mesmo
  contribuinte dos dois lados do balcão, e três pagamentos viravam R$ 12.000 de receita
  (D99). Depois de travar um sentido, escreva o teste do sentido oposto no mesmo dia.
- **Um ensaio vale mais que uma leitura.** A D99 não apareceu lendo o motor; apareceu ao
  rodar `--incluir-historico --ensaio` e estranhar uma **conta de receita** numa lista que
  só deveria ter custo. O ensaio é revertido: olhar sai de graça.
- **Na tela de aprovação, clique por referência de elemento não submete o formulário.** Só
  coordenada funciona, e ela precisa vir de um screenshot tirado antes da chamada.
- **"Ilegível" costuma ser diagnóstico, não fato.** Três PDFs ficaram cinco dias marcados
  como perdidos por uma explicação que estava meio certa. O `/ToUnicode` deles era **falso**,
  não ausente — e quem confia num mapa errado erra com mais confiança do que quem não tem
  mapa. Antes de aceitar que um arquivo não dá, vale abrir a estrutura dele.
- **Ferramenta boa atrapalha quando o arquivo mente.** O pdf.js aplica o `/ToUnicode` e faz
  a letra `G` virar o dígito `0`; sem ele, cai numa heurística de fonte padrão e inventa
  outra coisa. Nos dois casos o texto sai errado **parecendo certo**. A leitura correta
  estava uma camada abaixo, nos CIDs do content stream.
- **Agrupar por coordenada `y` parte a linha ao meio.** O nome da contraparte quebra em duas
  e fica *centralizado* sobre a transação: metade acima do `y` da data, metade abaixo.
  Agrupar por `y` fez 14 dos 19 lotes fecharem e 5 não. A montagem certa é por proximidade.
- **A árvore de páginas de um PDF aninha.** Ler só o primeiro `/Kids` perdeu a última
  página, justamente onde estavam as transações do maior lote.
- **Conferir contra o razão foi o que achou os três erros acima.** Cada um produzia saída
  plausível; o que os expôs foi somar por data e exigir que fechasse ao centavo.
- **As duas tabelas não concordam sobre o que é sinal.** `staged_transactions.amount` é
  **assinado**, como o extrato imprime; `cash_entries` guarda **magnitude** e põe o sentido
  em `direction`. Unir as duas lendo o valor do razão como assinado transformou os 15
  pagamentos do CUSTODIO em 26 recebimentos e levantou `sentido invertido` na folha inteira.
  Sentido é o que a D82 e a D86 existem para proteger: restaure no `case`, nunca presuma.
- **Quem lê `staged_transactions` está lendo o passado.** Desde que o `import:sispag`
  escreve direto no razão, staging e razão divergem — e a divergência é silenciosa, porque
  a consulta continua devolvendo linhas. Ao unir os dois, `status = 'pending'` é o que
  impede a dupla contagem *e* exclui `duplicate`/`rejected`, que nunca foram dinheiro.
- **Evidência ausente não se lê como ausente — se lê como resposta errada, com confiança.**
  Faltando o documento verdadeiro, o casamento estrito falha, a regra aproximada assume, e
  um sobrenome comum vira identificação. Foi assim que três pessoas diferentes
  reivindicaram o mesmo CPF. É a mesma lição do `/ToUnicode` mentiroso da D96.
- **A planilha nomeia categoria; o extrato nomeia loja.** A ponte entre as duas é uma tabela
  de apelidos escrita à mão, e ela só tem o que era visível quando alguém a escreveu. Regra
  que marca **zero linhas** quase sempre é apelido errado, não regra errada — `Railway
  Corporation` × `RAILWAY`, `Tactic` × `TACTIQ`, `Maquinas` × `MERCADO*2ELETROINF`.
- **Sufixo de extrato não é categoria.** O `-CT` do cartão parece marcar restaurante e não
  marca nada: aparece igual em hotel, táxi e posto. É separador de campo.
- **`clients.tax_id` é a identidade do cliente, não de quem paga por ele.** Gravar ali o CPF
  de um terceiro faz o `propose:receipts` recusar a linha em silêncio, e a recusa está certa
  (D94). Quem paga por um cliente vira **regra**, com `client_id` e conta juntos.
- **Antes de dizer "o app está errado", confira o que a tela soma.** A comparação com a
  planilha do Andre parecia mostrar erro grosso; era SQL cru contra uma tela que já separa
  transferência em seção própria. Meia hora de diferença entre acusar e medir.
- **Diferença idêntica nos dois lados é transferência.** Quando entrada e saída sobem pelo
  mesmo valor, ninguém ganhou nem gastou: o dinheiro trocou de bolso.
- **Backtick dentro de comentário SQL fecha o template literal.** Comentar `--` dentro de
  uma query em template string é seguro; citar um nome de coluna com crase, não.
- **Partir um lançamento em dois exige herdar o `dedup_hash`.** O hash existe para que
  reimportar o mesmo extrato não crie o mesmo movimento duas vezes. Se as duas filhas
  ganhassem hash honesto do próprio conteúdo, o arquivo original — que traz a linha inteira
  — voltaria a entrar como novidade, e ninguém veria. A filha que sobrevive fica com o hash
  da mãe: ele deixa de descrever o conteúdo dela e passa a dizer o que o campo existe para
  dizer, *"aquele movimento já está representado aqui"*.
- **Um número que ninguém reconhece não é conferência, é decoração.** A trava de saldo do
  `boletos` começou somando só os movimentos e imprimiu **R$ −25.460,21**; com a abertura
  mas com os cartões dentro, **R$ 484.744,56**; só com as contas de caixa, R$ 711.916,33.
  Nas três versões o *delta* era zero e a trava passava — o errado era o número impresso,
  que **parecia** saldo. Só se soube qual era o certo porque R$ 711.916,33 já estava neste
  handover, e essa conta não tinha entrado na consulta.
- **Comparar duas DREs exige alinhar onde cada uma põe o imposto.** A planilha do Andre põe
  imposto **acima** do lucro bruto; o app põe em `4.01` **dentro** do custo. Medi sem tirar
  os dois lados e concluí que o SISPAG *afastava* o app da planilha; alinhado, ele
  **aproxima**. A conclusão inverteu de sinal por causa da fronteira de uma linha.
- **Uma recusa bem escrita é o que faz a resposta certa ser possível depois.** A D101 olhou
  a FDN Telecom e não chutou `- Claro e TIM` pelo nome: escreveu **o que não fechava** —
  *"R$ 5.000 por mês não é conta de telefone"* — e deixou a pergunta aberta. Dois dias depois
  o Andre disse que é por onde o Nicholas Forte recebe (D111). Se ela tivesse chutado, teria
  errado a conta **e** a pessoa, e ninguém teria voltado a olhar.
- **Diferença negativa não é mês ilegível — é mês sem distribuição.** Junho do Custodio não
  movia porque a planilha arredonda 14.599,00 e o razão tem 14.598,93: a subtração dava
  −R$ 0,07 e o mês inteiro era pulado, deixando pró-labore preso em 6.10. **A saída não é
  tolerância**, que seria pôr um limiar em cima de dinheiro. É notar que a conclusão não
  depende do tamanho da diferença: se não sobra nada acima do salário, não houve distribuição,
  e é só isso que a linha precisa dizer.
- **Recusar um mês inteiro por causa de um lançamento é mais caro do que parece.** A primeira
  versão do `socios` pulava o mês quando a distribuição não casava, e com isso deixava para
  trás também o pró-labore daquele mês, que não tinha problema nenhum. Separe o que a dúvida
  alcança do que ela não alcança.
- **Chave de deduplicação sem sentido descarta regra em silêncio.** O `propose:rules`
  deduplicava por texto em dois lugares — ao montar as propostas e ao gravar —, e o bloco de
  custo da planilha produz sempre `out`. Toda regra de **entrada** cujo texto já viesse de lá
  sumia sem aviso, e o relatório ainda mostrava a seta da regra sobrevivente. É a D82/D86/D99
  outra vez, agora em quem escreve as regras (D122).
- **`null = null` é nulo em SQL, e por isso a consulta de existência usa `is not distinct
  from`.** Com `=`, toda regra sem sentido declarado passa por inexistente e duplica a cada
  execução.
- **`0 regras criadas` é uma saída plausível, e por isso perigosa.** Na maioria das execuções
  ela significa "já está tudo lá". Só olhando *quais* linhas continuavam sem conta é que a
  ausência virou pergunta — contador de sucesso não é conferência.
- **Um padrão que fecha aritmeticamente ainda pode estar particionado no lugar errado.**
  Cada sócio recebe R$ 2.000 no dia 5 e ~R$ 13.000 no dia 20 — a forma exata de pró-labore
  mínimo mais distribuição, e a soma batia com a planilha nos seis meses. Eu ia separar por
  aí e teria tirado **R$ 643.264,93** da DRE em vez de R$ 442.500, levando salário junto. O
  que decidiu foi a aba `Colaboradores` dizer R$ 15.000 inteiros. Forma de pagamento não é
  natureza de pagamento; quem responde isso é o documento contábil, não o extrato.
- **O CPF diz quem recebeu, nunca por quê.** O SISPAG entrega documento e valor, e a mesma
  pessoa recebe salário e distribuição pelo mesmo CPF, no mesmo mês, às vezes no mesmo dia.
  Nenhuma regra por documento vai separar isso, e é por isso que a D110 precisou de uma
  segunda fonte — a planilha do dono — em vez de mais uma camada de inferência.
- **Recategorizar uma linha que já tem conta exige apagar o espelho de competência à mão.**
  O `recategorize` nunca precisou disso porque só toca em linha **sem** conta, então o padrão
  do projeto é enganoso aqui. `planCashMirror` devolver `null` significa *apague o que
  existe* — mas alguém tem que executar o apagar. Sem isso o custo continua na DRE depois da
  mudança, **em silêncio**, e as três conferências continuam passando.
- **Uma linha da ponte pode passar a mentir sem que o resíduo mude.** Mover R$ 501.250 para
  `owner_draw` fez `Saídas de caixa sem competência` saltar de R$ 222.984,67 para
  R$ 724.234,67, com os 13 meses fechando e resíduo zero o tempo todo. O número estava certo
  e o **rótulo** tinha ficado errado: aquela linha é lida como lista de tarefas, e metade
  dela nunca ia virar custo. Resíduo zero prova que nada sumiu, não que os nomes ainda
  descrevem o que carregam.
- **Nome de sócio pega a pessoa e a empresa homônima.** `GABRIEL SAMPAIO JACOB%` casa com o
  CPF da pessoa e com o CNPJ da empresa de mesmo nome. A trava que salva é exigir que o
  padrão resolva para **um documento só, e que ele seja CPF** — 11 dígitos. É a D100 cobrando
  de novo, e desta vez o dado para errar estava a um `ilike` de distância.
- **Data lida como `Date` num script de diagnóstico anda um dia para trás.** A regra do
  projeto — data é string `YYYY-MM-DD` — vale também para consulta de investigação: os oito
  lotes SISPAG apareceram como 08/01 e 19/01 num rascunho e são 09/01 e 20/01. `::text` na
  query resolve, e é o que evita descrever ao Andre uma data que o extrato dele não tem.

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

### O estado real do ruflo, conferido em 20/08/2026

**As ferramentas do ruflo não são chamáveis nesta sessão**, e vale saber por quê antes de
alguém reinvestigar. São **dois servidores**, com dois problemas diferentes:

| | |
|---|---|
| `claude-flow` (o do `.mcp.json`) | **⏸ pending approval** — tem `autoStart: false` e nunca foi aprovado |
| `plugin:ruflo-core:ruflo` | **✔ conectado**, serve ~60 ferramentas |

O plugin responde de verdade — sondando o stdio dele direto vêm `memory_store`,
`swarm_init`, `agent_spawn`, `hooks_route`, `task_*`, `workflow_*`. **Mesmo assim o
`ToolSearch` não as encontra**, nem por `+ruflo` nem por `select:memory_store`. Elas não
entram no conjunto chamável, então não dá para usá-las mesmo querendo.

**São dois portões, e só um está aberto.** O `~/.claude/settings.json` já tem
`"mcp__claude-flow__*"` em `permissions.allow` — isso é permissão de **uso da ferramenta**.
O que trava é a **aprovação do servidor**: em `~/.claude.json`, `enabledMcpjsonServers` está
`[]` em todo projeto. Um não substitui o outro.

**Não existe "aprovar `.mcp.json` para todos os projetos"**, e é de propósito: um
`.mcp.json` viaja dentro do repositório, então aprovar globalmente deixaria qualquer repo
clonado rodar comando na primeira abertura. Existe `enableAllProjectMcpServers: true`
(confirmado no binário 2.1.238), que faz isso e derruba justamente essa proteção.

**Recomendação, e é a razão de nada ter sido mudado:** o caminho limpo para os outros
projetos é `claude mcp add --scope local ...` em cada um que realmente quiser, e **não**
`--scope user` — escopo de usuário ligaria o ruflo aqui também. Este repositório é dos
piores casos para swarm: o trabalho é investigação serial sobre dinheiro real, cada achado
(D96, D98, D99) veio de ler uma coisa com atenção e testar contra o banco, e o `CLAUDE.md`
do projeto proíbe a parte perigosa — *"Never allow two writers in one worktree."* Memória
vetorial também não ajuda: o `DECISIONS.md` é uma versão melhor dela, e foi lendo o
raciocínio da D86 em prosa que a D99 apareceu.

Comandos úteis: `claude mcp list`, `claude mcp get <nome>`,
`claude mcp reset-project-choices`, `claude mcp remove <nome>`.

> O processo `claude daemon run` que aparece no `ps` é o **daemon do próprio Claude Code**
> sustentando o job em background, não o daemon do ruflo. `workers: {}` — não há sweep
> gastando token.
