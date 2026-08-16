# Handoff — 14/08/2026 (atualizado ao fim da auto-categorização)

Estado do projeto para retomar numa conversa nova. O que existe, o que está no meio do
caminho, e o que fazer a seguir.

Leia junto: `docs/PLAN.md` (o roteiro), `docs/DECISIONS.md` (todas as decisões numeradas,
D1–D81, e as pendências Q2–Q18) e `README.md` (como rodar).

---

## 1. O que é

Plataforma financeira multi-entidade que substitui três planilhas, para duas pessoas
jurídicas:

- **DD Group / Dynamics Data** (`dd-group`) — tem dados de verdade
- **Gabriel Sampaio Jacob LTDA - ME** (`gabriel-sampaio-jacob`) — cadastrada, vazia (Q2)

Next.js 16.3 (App Router; a convenção `middleware` virou `proxy`), React 19, TypeScript
strict com `noUncheckedIndexedAccess`, Supabase (Postgres + Auth magic link + RLS),
Drizzle ORM. Interface toda em português.

### Regras que valem em todo o código

- **Dinheiro é `bigint` de centavos.** Nunca float. No banco, `numeric(14,2)`. A conversão
  vive só em `src/lib/money.ts`.
- **Data é string `YYYY-MM-DD`.** Nunca `Date`.
- **Percentual é `bigint` em milipercentual** (100% = `100_000n`).
- **Dois razões que não batem de propósito:** `cash_entries` (caixa) e
  `recognition_entries` (competência). São ligados, nunca fundidos.
- **Nenhum `service_role`** existe no projeto (D16). Toda query carrega o JWT do usuário;
  a RLS é a fronteira de verdade.
- **Nenhuma chamada de LLM escreve em tabela de razão** (SPEC §9). A IA só escreve em
  `suggested_*`, e há um teste que falha se alguém encostar nas tabelas proibidas.
- **Nunca inventar número.** Se não dá para calcular do dado real, mostra travessão e o
  motivo.
- **Não instalar dependência fora da seção 3 do SPEC sem perguntar.**

---

## 2. O que está pronto

As oito fases do SPEC estão construídas e commitadas.

| Fase | O que entrega | Commit |
|---|---|---|
| 1 | Schema, RLS, auth, entidades | anteriores |
| 2 | Lançamentos manuais, plano de contas, fluxo de caixa | — |
| 3 | Importação de extrato e de fatura | `42dff66` |
| 4 | Categorização determinística e assinaturas | `ccd4a12` |
| 5 | Contratos, NFs e reconhecimento de receita | `06b5338` |
| 6 | DRE gerencial, consolidação, razões lado a lado | `887a948` |
| 7 | Camada de IA com as travas da spec | `615c79a` |
| 8 | Exports, dashboard, auditoria, margem por cliente | `3bf82f6` |

Depois disso: `fe42ddb` (banco de verdade + teste 6 da §11), `aa9250d` (cinco bugs que só
o import real revelou) e os três da auto-categorização — `2bb994e` (regra por sentido),
`c6dcbf7` (regras de texto) e `382815c` (casamento por documento), detalhados na seção 3.

**Testes:** 316 no Vitest, 25 no Playwright. `npm run check` roda typecheck + lint + testes.

### Comandos

```
npm run dev
npm run check              # typecheck + lint + 316 testes
npm run test:e2e           # Playwright
npm run db:migrate         # aplica as migrations
npm run db:seed            # 62 categorias × 2 entidades, 4 contas
npm run verify:import      # 34 arquivos reais reconciliam
npm run verify:rls         # teste 6 da §11 do SPEC, 7/7, em transação revertida
npm run propose:rules      # dry run das regras de texto vindas da planilha
npm run propose:parties    # dry run do casamento planilha ↔ contraparte
npm run preview:categorize # o que o “Categorizar” decidiria agora, sem decidir
npm run inspect:staged     # composição do que está parado em staged_transactions
npm run import:invoices    # importa as faturas de cartão em massa
npm run propose:contracts  # lê os contratos do bloco de receita da planilha
npm run recognize:manual   # grava o plano mensal dos contratos manuais
```

Os dois `propose:*` aceitam `-- --aplicar` para gravar. O `propose:parties` aceita também
`-- --ensaio`, que grava dentro de uma transação, mede com o motor de verdade e reverte —
dá o número real do “depois” sem tocar no banco.

`.env.local` já está preenchido com o projeto Supabase real. O `DATABASE_URL` usa o
**session pooler `sa-east-1`** — o host direto `db.<ref>.supabase.co` é só IPv6 e o macOS
não resolve.

### O banco de verdade

Projeto Supabase criado, migrations aplicadas, seed rodado, usuário vinculado às duas
entidades.

- **Extrato** de janeiro a julho: 426 linhas, zero duplicata, saldo reconciliando em 99 dias.
- **19 faturas de cartão**: 516 lançamentos, todas fechando contra o total impresso nelas.
- **942 lançamentos no razão**, todos aprovados; 326 sem categoria.
- **492 linhas de espelho de custo** e 272 de receita na competência.
- **80 contratos** e **272 linhas de competência**, R$ 3.185.088,91 reconhecidos de janeiro
  a agosto.

---

## 3. A auto-categorização (feito em 14/08/2026)

O pedido em aberto era:

> "a partir dos dados que tem na planilha do fluxo de caixa que eu havia colocado no
> projeto, tente auto selecionar as categorias de cada gasto"

Está construído, testado, commitado e **aplicado no banco**: 54 partes e 95 regras. Na
época cobria 221 das 426 linhas; depois das faturas e da regra de rendimentos, cobre 616
de 942 (65,4%). Veja da §4.1 em diante.

### 3.1 A checagem que faltava, respondida

**308 das 426 linhas (72,3%) têm `counterparty_tax_id`** — 72 CNPJs cobrindo 216 linhas e
23 CPFs cobrindo 92. Identidade vale muito mais que texto aqui, e é por isso que a ordem
do trabalho mudou: as regras de texto alcançam 60 linhas; as por documento alcançam 161.

Duas correções ao que este documento dizia antes:

- No banco havia **zero** linhas categorizadas. As 55 do dry run eram projeção; `--aplicar`
  nunca rodou.
- Os 142 `PIX ENVIADO` **têm** documento na contraparte. A descrição é literalmente só
  "PIX ENVIADO", sem nome, então a camada 5 do motor (nome na descrição) nunca ia pegá-los.
  Quem os resolve é a camada 1, por documento.

Só 118 linhas ficam sem documento nenhum, e o topo delas é exatamente o que a §4.1 mandava
não chutar.

### 3.2 Regra por sentido — `2bb994e`

A coluna `direction` em `categorization_rules`, migration `0004` **aplicada no banco**. O
dry run agora filtra por sentido e informa quantas linhas cada regra barrou: `CICLO` casa
uma e barra quatro — as quatro receitas que viravam despesa de agência.

### 3.3 Regras de texto — `c6dcbf7`

O alias de Contabilidade virou só `ATTENTIVE` (o extrato trunca em `ATTENTIVE CO`), o que
recupera 9 linhas e ainda pega o `ATTENTIVE SERVICOS ADMINISTRAT`. Toda regra vinda do
bloco de custos nasce com `direction: "out"`; as do vocabulário do extrato declaram o seu
(`APLICACAO CDB` sai, `RESGATE CDB` entra).

**60 de 426 linhas por 10 regras**, contra 55 por 9 antes.

### 3.4 Casamento por documento — `382815c`

`propose-parties` liga o nome da planilha ao nome legal do extrato e daí ao documento.
Trata ambiguidade como motivo para não propor: todo token tem de casar em fronteira de
palavra, documento disputado por cliente e colaborador é reportado e não usado, nome curto
demais só casa na primeira palavra, e sentido invertido sai marcado com ⚠.

**Ensaiado numa transação revertida: 161 de 426 linhas, 37,8%**, todas por `rule_tax_id` —
90 em Freelancers, 41 em Receita — Projeto, 30 em Suporte contínuo. 54 partes e 50 regras
seriam criadas.

O que sobrou de fora, e por quê:

| Linhas | Contraparte | Por quê |
|---|---|---|
| 14 | `SIMPLES NACIONAL` / `DARF` | é o CNPJ da própria empresa pagando tributo |
| 13 | Ricardo de Carvalho Custodio Junior | na planilha o nome está na coluna *Cliente*, com `COLABORADOR` vazio |
| 7 | Gabriel Sampaio Jacob | idem — e é o nome da outra entidade, então pode ser transferência entre empresas (Q2), não pagamento |
| 7 | Leonardo Sanches Alves de Oliveira | idem |
| 5 | Pasolini Engenharia | a planilha diz "Anna Pasolini"; a empresa só carrega o sobrenome |
| 1 | `GM Promo` → `VAI DE PROMO` | casou, mas com ⚠ sentido invertido — provável falso positivo |


## 4. Próximos passos

### 4.1 Aplicado — falta clicar em “Categorizar”

O usuário mandou gravar, e está gravado: **54 partes cadastradas, 50 regras por documento
e 44 regras de texto.** A cobertura medida com o motor de verdade é

**221 de 426 linhas, 51,9%** — 161 por `rule_tax_id` e 60 por `rule_text`, sem nenhuma
sobreposição entre as duas fontes.

| Linhas | Conta | |
|---|---|---|
| 90 | 6.10 | Freelancers |
| 41 | 3.02 | Receita — Projeto |
| 30 | 3.01 | Receita — Suporte contínuo |
| 21 | 4.01 | Impostos sobre a receita |
| 14 | 99.02 | Pagamento de fatura de cartão |
| 9 | 8.01 | Contabilidade |
| 5 | 11.01 | Tarifas bancárias |
| 4 | 99.03 | Aplicação e resgate automático |
| 3 | 11.02 | IOF |
| 3 | 7.08 | Tarefy |
| 1 | 8.03 | Agência |

Aquela única linha em Agência é o caso Ciclo depois da correção: das cinco que a regra
pegava, quatro eram receita e foram barradas pelo sentido.

**As `staged_transactions` continuam com zero sugestão gravada, e isso é de propósito.**
Escrever `suggested_*` é trabalho do botão **“Categorizar”** na tela de Regras, que passa
pelo Supabase com o JWT do usuário e respeita a RLS. Os scripts daqui usam a conexão
direta, que passa por cima dela — gravar sugestão por ali contrariaria a D16, que diz que
a RLS é a fronteira de verdade. Então: abrir a tela de Regras e clicar em Categorizar.

Três casamentos que valem um olho na tela, todos visíveis em `npm run propose:parties`:

- `GM Promo` → `VAI DE PROMO` saiu marcado com ⚠ sentido invertido — 1 linha, provável
  falso positivo, e a regra foi criada;
- Ricardo Custodio, Gabriel Sampaio Jacob e Leonardo Sanches **não** viraram regra: na
  planilha o nome deles está na coluna *Cliente* com `COLABORADOR` vazio. São 27 linhas,
  e o segundo é o nome da outra entidade, então pode ser transferência (Q2);
- "Anna Pasolini" e `PASOLINI ENGENHARIA` (5 linhas) — a empresa só carrega o sobrenome,
  e o casamento exige todos os tokens, então ficou de fora.

**Não chutar** duas coisas, que seguem valendo:

- **`RENDIMENTOS REND PAGO APLIC AUT MAIS` (35 linhas)** — é rendimento de aplicação, e o
  plano de contas semeado **não tem conta de receita financeira**. A planilha também não
  tem. Precisa de decisão: criar a conta ou classificar como outra coisa.
- **`SISPAG FORNECEDORES` (18 linhas)** — genuinamente ambíguo, sem CNPJ útil na descrição.
  Depende de olhar a contraparte linha a linha.

### 4.2 Faturas importadas — 16/08/2026

**Feito.** 19 faturas distintas, 516 lançamentos, todas fechando contra o total impresso
nelas mesmas. Os 34 arquivos da pasta viram 19 faturas porque nove são a mesma fatura
salva com o nome de outro cartão, e cinco não são fatura.

Isso resolveu de passagem uma discrepância que parecia erro: os arquivos `8299` parseiam
como conta `8384`. Lendo os blocos de cartão de dentro dos PDFs, a conta 8384 tem um
cartão só, o 8299, e a semente nomeou a conta pelo cartão. A conta 5780 carrega sete
cartões — 2227, 4460, 4740, 8993, 6256, 0063 e 4200 —, que é de onde vêm os nomes de
arquivo. O mapa está em `scripts/import-invoices.ts` com a justificativa.

**Cobertura depois disso: 581 de 942 linhas, 61,7%** — `rule_text` saltou de 60 para 420,
que são exatamente as regras de fornecedor da planilha. Elas descreviam compra no cartão e
por isso não tinham o que casar no extrato.

As 581 sugestões estão **gravadas nas linhas** (`npm run preview:categorize -- --aplicar`,
que faz o que o botão “Categorizar” faz). Todas continuam `pending`.

Duas coisas que pareciam bug e não são:

- **`SALESFORCE TECNOLOGIA`, 16 linhas sem decisão.** Das 49 linhas Salesforce nas
  faturas, 33 são compra e as 33 receberam a sugestão 7.02. As outras 16 são estorno, e
  estorno de cobrança da Salesforce não é despesa da Salesforce.
- **`ESTORNO ANUIDADE`, 15 linhas.** A regra `ANUIDADE` é `out`; um estorno é entrada.

### 4.3 O caminho de escrita rodou — Q11

Decisão do usuário: uma fatura pequena primeiro. Aprovada pela interface a
`Itaucard_8299_fatura_002026`, 6 lançamentos, R$ 111,16. **Funcionou de ponta a ponta:**

- 6 linhas em `cash_entries`, com as categorias que o motor sugeriu (11.01 ×2, 7.04,
  11.02) e as duas de estorno sem conta;
- **4 linhas em `recognition_entries`** — o espelho nasceu só para as 4 que ganharam
  categoria, que é exatamente a D2a: dar categoria a um custo é o que cria a competência;
- auditoria registrando os três inserts.

A tela de Competência mostra as 4 como “espelho do caixa”: receita 0,00, custo 148,66.

Isso também confirmou que as sugestões gravadas por script aparecem certas na interface
real — a tela de revisão veio com 11.01, 7.04 e 11.02 já selecionadas.

Falta do Q11 o **reconhecimento de receita a partir de contrato** e o **POC**, que
dependem de haver contrato cadastrado (Q16).

**Restam 936 linhas paradas**, 610 com sugestão. Aprovar o resto é decisão de sempre.

Uma observação de tela, cosmética: depois de aprovar, a coluna Categoria da tela de
revisão mostra “—” mesmo nas linhas que foram para o razão com conta. O dado está certo;
é só o que a tela desenha depois que o select some.

### 4.4 Contratos e receita — 16/08/2026

O lado da competência saiu do zero. **80 contratos** lidos do bloco de receita da
`DRE Geral`, com 95 parcelas mensais e 41 clientes novos, e a leitura **fecha com o total
do ano da planilha**: R$ 5.033.061,88 contra 5.033.061,87 declarados, um centavo de
arredondamento dela mesma.

Depois disso, **272 linhas de competência, R$ 3.185.088,91 de janeiro a agosto** — 206 do
motor (linha reta) e 66 do plano mensal dos contratos manuais. A receita reconhecida
**bate com a planilha mês a mês, ao centavo**; a diferença que resta é exatamente Ciclo e
Salesforce, e está explicada abaixo.

A DRE gerencial passou a ter receita bruta separada em 3.01 e 3.02.

**Duas armadilhas encontradas, e como ficaram:**

- **3.03 e 3.04 não têm rota.** `applyRecognition` deriva a conta de receita do *tipo* do
  contrato, e o enum de tipo tem dois valores. Então `Referral / Ciclo` (R$ 15.300) e
  `Salesforce / Salesforce` (R$ 363.548) reconheceriam em 3.01, que é errado. Ficaram como
  **rascunho**: o motor não reconhece rascunho e diz por quê, o dinheiro segue visível na
  lista, e o ano continua fechando. **Rotear direito precisa de um override de categoria no
  contrato — é mudança no app.**
- **Contrato `manual` gera zero pelo motor**, o que deixaria metade do ano invisível (doze
  contratos, o Gringo entre eles). O `recognize-manual` grava o plano mensal que veio da
  planilha, sem passar do mês corrente e sem sobrescrever linha existente.

**Nenhum contrato é POC.** 68 lineares, 12 manuais. Se algum projeto deveria reconhecer por
avanço, é troca na tela.

### 4.5 Razão preenchido — 16/08/2026

**As 942 linhas foram aprovadas.** O razão de caixa tem 942 lançamentos — 426 do extrato,
468 do cartão 5780 e 48 do 8299 — e 326 deles entraram sem categoria, que é legítimo: são
movimentos reais, e o fluxo de caixa só reconcilia com o banco se todos entrarem.

O espelho de competência subiu para **492 linhas de custo**, e a DRE gerencial passou a ter
os dois lados: receita bruta, deduções, receita líquida, margem bruta, pessoal e
ferramentas, mês a mês.

Uma nota de operação, se alguém for repetir isso pela interface: a aprovação é uma tela por
importação, sem ação em massa. E clicar por referência de elemento **não** submete o
formulário — só clique por coordenada funciona, e a coordenada tem de vir de um screenshot
tirado antes da chamada.

### 4.6 O que falta

- **Categorizar as 326 linhas sem conta.** Estão no razão e no fluxo de caixa numa linha
  “Sem categoria”. As maiores: 52 `PIX ENVIADO`, 31 `SISPAG FORNECEDORES` (R$ 1,2 mi, sem
  CNPJ útil), 16 estornos da Salesforce e 15 `ESTORNO ANUIDADE`.
- **Rotear 3.03 e 3.04.** Um override de categoria no contrato, para tirar Ciclo e
  Salesforce do rascunho. É a única mudança de app que este trabalho deixou pendente.
- **NFs:** zero notas fiscais cadastradas. A Fase 5 concilia NF contra caixa e isso ainda
  não tem dado.
- **Clientes que pagam e não estão na planilha:** Brazil Wind, Ligavit, A. F. Comércio,
  AIDC, DB Genética e outros aparecem recebendo no extrato mas não estão no bloco de
  receita da `DRE Geral`.
- **Q18: chamar a API da Anthropic de verdade.** A variável `ANTHROPIC_API_KEY` existe no
  `.env.local` mas está **vazia**, então segue bloqueada. Todo o caminho de IA está
  testado com modelo mockado.
- **Q15** confirmada pelo import: falta mesmo a fatura de junho/2026 da conta 8384.

---

## 5. Pendências abertas

Detalhe completo na Parte 7 do `docs/DECISIONS.md`.

| # | Pendência |
|---|---|
| Q2 | Nada chegou da entidade Gabriel Sampaio Jacob |
| Q4 | Metas (receita R$ 7.000.000, OPBB 36%) entram na tela? |
| Q8 | A aba `Vendas e Perdas` é um CRM; nenhuma fase cobre |
| Q9 | `Cópia de Autorização de saída - Saint Paul` é documento escolar alheio. Não foi aberto. Apagar? |
| Q11 | Caminho de escrita parcialmente exercitado — falta aprovar, espelhar, reconhecer, POC |
| Q13 | Três extratos em PDF sem texto recuperável; precisa reexportar em XLSX/CSV |
| Q15 | Fatura 8299 de 05/06/2026 (R$ 830,97) não está na pasta |
| Q16 | Importar contratos de 2026 da `DRE Geral` ou cadastrar à mão? |
| Q17 | Guardar o arquivo do contrato no Supabase Storage? |
| Q18 | A API da Anthropic nunca foi chamada de verdade |

---

## 6. Armadilhas já pagas — não repetir

Cada uma custou tempo. Estão em `DECISIONS.md` com número.

- **`exceljs` falha em 3 de 3 extratos do Itaú** (`Unexpected xml node in parseOpen:
  lastModifiedBy`). Foi removido; há leitor próprio em `src/lib/import/xlsx.ts` (D34).
- **PostgREST serializa `numeric` como número JSON.** `800.00` chega como `800`. Isso fez
  `parseMoney` cortar um dígito de todo valor inteiro — **R$ 800,00 virou R$ 80,80 em 327
  de 426 linhas** (D77). Corrigido e coberto por teste; o comentário no código explica.
- **Filtro do PostgREST vai na query string.** 300 hashes num `in.(...)` dão 19 KB de URL,
  o servidor recusa em ~8 KB, e aparece como `TypeError: fetch failed`. Use
  `src/lib/data/batching.ts` (D79).
- **Hash de dedup precisa da contraparte e de um índice de ocorrência.** Sem isso, quatro
  PIX de R$ 4.000 no mesmo dia viram "uma linha e três duplicatas" (D78).
- **O export do Itaú vem do mais novo para o mais antigo.** O último elemento do array é a
  data mais velha, não o saldo final (D81).
- **`APL/RES APLIC AUT` é varredura automática e é descartado** (D35); `REND PAGO` fica.
- **Nome de arquivo de fatura não significa nada** — o mesmo PDF aparece com nomes de
  cartão e mês diferentes. A identidade vem de dentro do PDF.
- **React 19 limpa formulário não controlado depois de uma action.** Todo form usa
  `kept(name, fallback)` para devolver o que a pessoa digitou.
- **`docs/reference/` está no gitignore** — tem extrato real, CNPJ de cliente e saldo.
  Nunca entra no git.
- **Não colar `DATABASE_URL` no chat** — carrega a senha do Postgres, que passa por cima da
  RLS. `NEXT_PUBLIC_*` e a anon key são públicas por design.
