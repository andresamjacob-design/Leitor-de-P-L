# Handover — 21/08/2026

Onde tudo está, o que foi feito, e o que falta. Escrito para quem chega sem contexto
nenhum, inclusive eu mesmo numa conversa nova.

Leia junto quando precisar do detalhe: `docs/PLAN.md` (o roteiro original),
`docs/DECISIONS.md` (decisões numeradas D1–D103 e pendências Q2–Q18) e `README.md`.

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
npm run check               # typecheck + lint + 391 testes
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
| Razão de caixa | **1.064 lançamentos**, 06/08/2025 a 31/07/2026 |
| Categorizados | **877 (82,4%)** — 187 sem conta |
| Competência | 284 linhas de receita + 640 de custo |
| Receita reconhecida | **R$ 3.556.736,91** (jan–ago/2026) |
| Contratos | 80 (65 ativos, 15 concluídos), 95 parcelas mensais |
| Clientes / pessoas | 73 / 40 |
| Regras | 131 |
| Importações | 23 |
| Notas fiscais | **0** |

### Contas

| Conta | Tipo | Abertura | Lançamentos | Situação |
|---|---|---|---|---|
| Itaú — conta corrente | banco | 142.469,28 em 01/01/2026 | 543 | ✅ bate com o extrato |
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

**44 commits** na branch, de `aa9250d` (onde o `main` está). Por tema, não por
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
| Entradas de caixa sem competência | − R$ 2.830.308,69 |
| **Saídas de caixa sem competência** | **+ R$ 285.384,67** |
| Custo de compra no cartão | − R$ 147.685,31 |

A linha do meio é a lista de tarefas em forma de número: **R$ 285 mil que saiu do caixa e
ainda não pesa na DRE**, porque essas linhas não têm categoria. Conforme forem
categorizadas, o custo cresce e o resultado cai, **sem o caixa mudar um centavo**.

> Ela era **R$ 1.281.607,12** até 20/08. O SISPAG levou R$ 863.414 embora de uma vez, a
> D98 mais R$ 32.370 e a D100 mais R$ 27.945 — e essas quedas, medidas na ponte, são a
> prova de que nada se perdeu pelo caminho.

---

## 6. O que falta

### Depende de você

Rode **`npm run decisoes`** — lista cada pergunta em aberto com a evidência do lado, feito
para você responder de uma sentada. `npm run pendencias` dá o quadro por dinheiro.

Uma resposta sua costuma resolver várias linhas de uma vez: a regra por documento pega todo
o histórico daquela contraparte, e o `recategorize` a aplica ao razão inteiro.

> ℹ️ **O motor não roda sozinho sobre o razão** (D88): ele só olha `staged_transactions`, e
> o staging está vazio porque tudo foi aprovado. Isso deixou de ser bloqueio — **`npm run
> recategorize` aplica o motor ao razão** (D97), separando regra de palpite. Depois de
> responder qualquer coisa abaixo, é ele que entrega o resultado.

**Na ordem do dinheiro:**

| | O que é | Como destrava |
|---|---|---|
| **12 contrapartes sem dono** ← *o próximo passo* | R$ 269 mil do lado dos **pagamentos** (Santa Monica Criação R$ 84.620, Aparecido Ribeiro R$ 62.472, ETG R$ 60.000, Taliêco R$ 36.000, Conex & Result R$ 7.200…) e R$ 15 mil do lado dos recebimentos (Mara Thaysa, Roberto Pascoal). Eram **31**: a D98 resolveu 7 lendo o razão, a D100 mais 4 — inclusive a **Senseilabs, que era o CNPJ do Escola.i** —, a D101 mais 6 pela aritmética da planilha, e a D102 mais 2 respondidas pelo Andre. | **O que sobrou é o que a planilha não explica.** Dizer quem é cada uma. Se for um dos clientes que já existem sem documento, o certo é pôr o CNPJ nele — casar nome duplica cliente (D87). Depois: `npm run vincular` e `npm run recategorize`. |
| **`OP REC EXT`** | 4 entradas, ~R$ 408 mil, sem documento nenhum | Parecem câmbio. Em qual receita caem é decisão. |
| **19 linhas que o histórico resolveria** | R$ 205.311,97. O motor sabe a resposta, mas por inferência, não por regra | Estão paradas de propósito (D97). Eram 42; a D100 tirou 17 de lá promovendo-as a **decisão**. **Ainda não recomendo aplicar o resto em bloco:** as 6 linhas de receita (Hogrefe, Hold Beauty, PDG IT) responderiam sozinhas a pergunta que o `decisoes` §2 diz estar em aberto. |
| **`PAGAMENTOS A FORNECEDORES SISPAG`** | 8 saídas, **R$ 95.950** | **Nenhum arquivo do Itaú resolve**: o próprio PDF itemizado não nomeia essas oito. Só o detalhe do lote no internet banking. |
| **PDG IT, Hold Beauty, Hogrefe** | 6 recebimentos, R$ 73.400 — projeto *e* retainer vigentes ao mesmo tempo | Dizer qual contrato é qual. A vigência já resolveu 7 dos 13 sozinha (D89). |
| **`BOLETOS RECEBIDOS`** | 8 entradas, R$ 43.100, sem documento | O extrato não nomeia o sacado. |
| **Conta de receita financeira** | Não existe no plano. Os rendimentos de aplicação (38 linhas, R$ 202,31) estão em `99.03`, que é **transferência**, e ficam fora da DRE — com R$ 485.000 no CDB isso cresce (D95) | Criar `3.05 Receita financeira`? E em qual grupo da DRE — `receita_bruta` infla o OPBB, então provavelmente um grupo não operacional. É pergunta de contador. |

### As que a planilha respondeu por aritmética — feitas (D101)

Maruri, Danillo (os dois), Bradesco Saúde, Intermédica e Prudential **já entraram**: a
planilha prova a conta de cada uma por valor e por mês, e a chave foi descobrir que a
`DRE Geral` lança **um mês à frente do caixa**. Detalhe e conferência na D101.

Ficaram três de fora **de propósito**, e o motivo importa:

- **INPI, R$ 440** — só se paga taxa de marca ao Instituto Nacional da Propriedade
  Industrial, mas o `- Juridico` da planilha é zero de março em diante e o pagamento é de
  maio. Sei o que a empresa é; não sei onde você lança. Isso é conhecimento de mundo, não
  aritmética.
- **FDN Telecom, R$ 10.000 em 2 linhas** — o nome diz telecom, mas `- Claro e TIM` vale
  R$ 394,92 no ano inteiro. R$ 5.000 por mês não é conta de telefone.
- **Keepclear, +R$ 0,01** — o centavo de teste, sem conta de propósito.

- **Maruri → `11.03 Multas e acordos`.** A linha `- Penalties & Settlements` da `DRE Geral`
  vale **R$ 45.000,00, só em fevereiro, e R$ 45.000 no ano inteiro**. No razão há um único
  pagamento à Maruri, de **R$ 45.000,00, em 09/02/2026**. Valor exato, mês exato, único dos
  dois lados — e a Maruri aparece na aba `Vendas e Perdas`, que é onde um acordo com um
  negócio perdido apareceria. A conta já existe no plano.
- **Danillo → `8.02 Jurídico`.** São duas contrapartes com o mesmo sobrenome, a
  advocacia (CNPJ) e a pessoa (CPF). O caixa de fevereiro soma
  **5.000 + 3.242 + 6.347 = R$ 14.589,00**, que é exatamente o `- Juridico` de **janeiro**
  na planilha; e o pagamento de março, R$ 5.000, é o `- Juridico` de **fevereiro**. A
  competência anda um mês à frente do caixa, e com esse deslocamento os dois lados fecham.
- ~~**`ATTENTIVE` por texto**~~ — **resolvido pela D100.** As 49 regras de texto da planilha
  já estavam todas gravadas e já funcionavam; o que faltava era **alcance**, não regra. As
  linhas do SISPAG têm por descrição o rótulo do lote, `PAGAMENTOS A FORNECEDORES`, e regra
  de texto não as alcança por definição. `npm run propose:suppliers` promoveu a conta a
  **regra por documento** e fechou Attentive, Tarefy, Ciclo e Escola.i — 17 linhas.

### A planilha em `docs/reference/` está velha — vale pedir a atual

O Andre citou um cliente na **linha 86** do bloco de clientes. Na cópia de **12/08** esse
bloco termina na **83** e a 86 é `Impostos`; `Conex` não aparece em nenhuma das seis abas.
A dele tem pelo menos três linhas de cliente a mais.

Uma cópia atualizada é barata e resolve várias coisas de uma vez: provavelmente nomeia
**Mara Thaysa** e **Roberto Pascoal**, e ainda refresca contratos, receita e o bloco de
custo — que é de onde a D101 tirou a conta de seis contrapartes.

### Depende de arquivo ou chave que não chegou

| # | O que falta |
|---|---|
| **Q18** | `ANTHROPIC_API_KEY` existe no `.env.local` mas está **vazia**. Todo o caminho de IA está testado com modelo mockado; nenhuma chamada real aconteceu. |
| **Q15** | Fatura de junho/2026 da conta 8384 não está na pasta. |
| **NFs** | Zero cadastradas. A Fase 5 concilia NF contra caixa e não tem dado nenhum. |
| **Q2** | Nada chegou da entidade Gabriel Sampaio Jacob. |
| — | **Extrato do CDB** — confirmaria se houve rendimento retido dentro dele. R$ 485.000 é o principal (D84). |
| — | **Detalhe do lote SISPAG** no internet banking, só para as 8 saídas de R$ 95.950 que nem o PDF nomeia. |

> ~~**Q13**~~ **fechada em 19/08/2026** (D96): o `/ToUnicode` do PDF é que estava errado, não
> a fonte. `readItauStatementPdf` lê esses arquivos, e o de jan–mar decompôs o SISPAG
> inteiro. Não precisa reexportar nada.

### Decisões antigas ainda abertas

`Q4` (metas na tela), `Q8` (a aba `Vendas e Perdas` é um CRM — 6 negócios ganhos, R$ 221
mil; nenhuma fase cobre), `Q9` (documento escolar alheio na pasta — apagar?), `Q16`
(contratos), `Q17` (arquivo do contrato no Storage).

### Se for fazer só três coisas

1. **Responder as 12 contrapartes** (`npm run decisoes`). É o maior bloco que não depende de
   arquivo nenhum, e a maioria provavelmente já está cadastrada sem documento — como
   aconteceu com as oito de 19/08, em que **nenhuma era cliente novo**. Eram 31: as
   D98/D100/D101 tiraram 17 sem ninguém adivinhar nada. **O que sobrou é justamente o que a
   planilha não explica** — começa por Santa Monica Criação (R$ 84.620), Aparecido
   (R$ 62.472), ETG (R$ 60.000) e Taliêco (R$ 36.000), que são R$ 243 mil dos R$ 269 mil.
2. **Rodar `npm run vincular` e `npm run recategorize`** depois de responder. É o que
   converte resposta em custo na DRE.
3. **Decidir a conta de receita financeira** com o contador, junto de `OP REC EXT`. São as
   duas únicas pendências que mexem em como o resultado é *estruturado*, não só em quanto
   ele é.

O que **não** vale a pena esperar: o retorno CNAB do SISPAG. Ele resolveria R$ 95.950 de 8
linhas, e o resto já entrou pelo PDF.

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
- **Backtick dentro de comentário SQL fecha o template literal.** Comentar `--` dentro de
  uma query em template string é seguro; citar um nome de coluna com crase, não.

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
