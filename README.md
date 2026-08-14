# Financeiro

Plataforma de gestão financeira multi-entidade: fluxo de caixa (regime de caixa), DRE
gerencial (regime de competência) e reconhecimento de receita, para **DD Group** e
**Gabriel Sampaio Jacob**.

- `docs/finance-platform-spec.md` — a especificação
- `docs/DECISIONS.md` — as decisões tomadas, e onde elas contrariam a spec
- `docs/PLAN.md` — o plano por fase, com checklist e status

**Fase atual: 5 concluída.** Dá para cadastrar contas e categorias, importar o extrato do
Itaú e a fatura do cartão, deixar o sistema categorizar sozinho o que reconhece, ler o
fluxo de caixa mês a mês, ver quanto a empresa paga de assinatura, e cadastrar clientes,
contratos e notas fiscais com a receita sendo reconhecida por competência. O que falta é
juntar tudo num DRE gerencial (Fase 6).

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
| `npm run verify:import` | roda os importadores sobre os arquivos reais de `docs/reference/` |

## Como o código está organizado

```
src/lib/money.ts            centavos inteiros em bigint — nenhum float toca dinheiro
src/lib/dates.ts            datas como YYYY-MM-DD, sem objeto Date no domínio
src/lib/tax-id.ts           CPF/CNPJ normalizado, para casar com o extrato
src/lib/dedup.ts            o hash que impede o mesmo movimento duas vezes
src/lib/import/             leitores de arquivo e parsers, todos puros e testáveis
src/lib/categorize/         o motor de categorização e a detecção de assinaturas
src/lib/cash-flow.ts        o relatório de caixa, função pura, sem banco
src/lib/recognition/mirror.ts  quando um custo de caixa vira competência (D2a/D2b)
src/lib/recognition/engine.ts  quando a receita de um contrato é considerada ganha
src/lib/ledger-types.ts     tipos e rótulos que servidor e cliente compartilham
src/lib/data/               leitura e escrita via Supabase, sempre com o JWT do usuário
src/lib/db/schema.ts        fonte única do schema; toda mudança vira migration
src/lib/entities.ts         resolução de /[entidade]/... e do escopo consolidado
src/lib/supabase/           clientes que sempre carregam o JWT do usuário
drizzle/                    migrations versionadas, incluindo RLS e auditoria
scripts/seed.ts             seed idempotente
```

O que é cálculo mora em função pura e é testado sem banco; o que é acesso mora em
`src/lib/data/` e passa por RLS. Nenhuma tela faz conta.

Três regras que valem para o código inteiro:

1. **Dinheiro é `bigint` em centavos.** `numeric(14,2)` no banco, conversão só na borda.
   `valor * 0.17` é um TypeError, não um bug silencioso.
2. **Toda query do app roda com o JWT do usuário.** Não existe cliente com service role.
   O RLS é a fronteira real entre as entidades, não a interface.
3. **Nada de dado falso.** Tela sem dado mostra estado vazio dizendo o que falta e em
   qual fase é construída. Relatório com ressalva mostra a ressalva.

## Dois razões, nunca um

O ponto central do desenho: `cash_entries` e `recognition_entries` são tabelas separadas
e **não fecham entre si mês a mês** — isso é o comportamento correto, não um bug.

- Fluxo de caixa lê só `cash_entries` (data real do dinheiro).
- DRE lê só `recognition_entries` (mês de competência).
- O relatório de **receita diferida** é a ponte entre os dois, e é o número que denuncia
  erro de cálculo.

Salvar um custo grava nos dois: o lançamento no caixa, e o espelho na competência do mês
em que ele aconteceu. Quando os dois meses discordam — salário de janeiro pago em
fevereiro, compra no cartão paga depois — o campo **Competência** do lançamento é o que
separa um do outro. Receita nunca espelha: ela vem do contrato, na Fase 5.

## O cartão de crédito

O caso que mais dá errado em planilha, e o motivo do desenho:

- a compra entra na conta do cartão, na data da compra → aparece no **DRE de fevereiro**;
- o débito da fatura entra na conta corrente, na data do pagamento → aparece no **caixa de
  março**;
- o fluxo de caixa **ignora contas de cartão**, senão os mesmos R$ 1.200 seriam contados
  como R$ 2.400.

Isso está no teste `src/lib/scenarios.test.ts`, que roda os dois razões lado a lado.

## Importação

Um arquivo nunca vira lançamento sozinho. Ele vira uma lista para conferir, e só um
clique humano cria as linhas do ledger (SPEC §7).

- **Extrato** (`.xlsx` ou `.csv`) — colunas casadas pelo cabeçalho, não pela posição,
  porque o layout muda entre exportações. As linhas de saldo são descartadas, e a
  varredura diária da aplicação automática também: é o mesmo dinheiro trocando de
  prateleira, e lançá-la dobraria o fluxo de caixa.
- **Fatura** (`.pdf`) — lida por coordenadas, porque são duas colunas e a leitura linear
  intercala as duas. Conta, cartão e período saem **de dentro do PDF**: o nome do arquivo
  não corresponde nem ao cartão nem ao mês.
- **O mesmo arquivo não entra duas vezes**, conferido pelo conteúdo. Linhas que já estão
  no ledger chegam marcadas como duplicata, então reimportar um período que se sobrepõe
  é um não-evento.

A trava que sustenta isso: **a fatura só é aceita se a soma das compras extraídas bater
exatamente com o total que ela imprime.** Um centavo de diferença significa que a leitura
das colunas errou, e uma leitura errada não vira lançamento. Um extrato que não fecha,
por outro lado, só avisa em quais dias — ele continua sendo o registro do banco.

`npm run verify:import` roda tudo isso sobre os arquivos reais em `docs/reference/`
(que nunca entram no git). Hoje: **34 de 34 arquivos conferem** — os 4 extratos fecham
o saldo em todos os 296 dias com saldo declarado, e as 28 faturas batem ao centavo.

## Categorização

Determinística e explicável. **Nenhuma IA** — isso é a Fase 7, e ela nunca vai escrever
numa tabela de ledger (SPEC §9). Toda sugestão vem com o motivo escrito e uma confiança;
abaixo de 0,8 ela aparece mas não vem marcada.

A ordem da decisão:

1. regra amarrada ao **CNPJ** da contraparte;
2. regra por **texto ou faixa de valor**, por prioridade;
3. o que foi feito da última vez com esse **mesmo CNPJ**;
4. o que foi feito da última vez com essa **mesma descrição**;
5. **nome de pessoa** cadastrada aparecendo na descrição.

**Identidade ganha de texto** porque o extrato traz o CNPJ, e nesta empresa a Salesforce é
cliente e fornecedora ao mesmo tempo — casar por nome jogaria receita e custo no mesmo
balde. **Regra ganha de histórico** porque a regra é como se corrige um erro que o
histórico repetiria para sempre.

O que o motor não reconhece fica sem categoria, e não com um chute. A varredura em lote só
toca em lançamento sem categoria — nada que você já decidiu é reescrito.

## Assinaturas

Ninguém mantém a lista do que a empresa paga todo mês; ela está espalhada por um ano de
faturas. A tela reconstrói: mesmo fornecedor, intervalo parecido, valor parecido, três
vezes ou mais. Uma cobrança sem repetição há dois ciclos entra como **encerrada** e sai do
total — o Google Workspace apareceu duas vezes nos arquivos reais porque o fornecedor
mudou a descrição, e somar as duas inflaria o custo mensal em quase o dobro.

## Reconhecimento de receita

O caixa diz quando o dinheiro chegou. O reconhecimento diz quando ele foi **ganho** — e a
distância entre os dois é a receita diferida, o número que denuncia erro em qualquer um
dos lados.

- **Suporte contínuo:** linha reta, com o primeiro e o último mês prorrateados pelos dias
  corridos. Um retainer de R$ 6.000 começando em 15/04 reconhece R$ 3.200 em abril (16 de
  30 dias) e R$ 6.000 daí em diante.
- **Projeto:** alguém reporta o **percentual acumulado** do mês, e o motor calcula a
  diferença. Guardar o acumulado é o que faz uma correção se resolver no mês seguinte em
  vez de se acumular: reportar 30% e depois 25% com a marca de correção reconhece
  −R$ 2.500, sem tocar no mês já fechado.
- **Mês sem reporte** reconhece zero e entra na lista de relatórios faltando.
- **Encerrar o projeto** reconhece o saldo que faltava.

O motor é idempotente: rodar de novo não duplica nada. E **nunca sobrescreve uma linha que
alguém editou à mão** — ela é preservada e contada à parte.

A nota fiscal **não** cria receita. O reconhecimento vem do contrato; a NF entra como a
coluna "faturado" da conciliação, ao lado de "reconhecido" e "recebido". Se a NF também
gerasse competência, a mesma receita entraria duas vezes.

## O que ainda falta

- **Saldo de abertura dos cartões.** A conta corrente abre em R$ 142.469,28 e o CDB em
  R$ 367.735,49, que somam a posição de 01/01/2026. A dívida das duas contas de cartão na
  mesma data ainda é desconhecida e segue em 0,00 — dá para corrigir na tela de Contas.
- **Nada do caminho de escrita rodou contra um Postgres.** Sem projeto Supabase e sem
  Docker, o que está verificado é a lógica pura (220 testes) e os importadores contra os
  arquivos reais. As migrations `0002` e `0003` nunca foram aplicadas; aprovar uma
  importação, varrer categorias e reconhecer receita nunca gravaram de verdade.
- **Os contratos de 2026 ainda não estão cadastrados.** O importador da aba `DRE Geral`
  não foi construído de propósito: a planilha tem o valor espalhado por mês, mas não
  início, fim nem método de reconhecimento, e inferir esses campos geraria cronograma
  errado em silêncio. Ver Q16 em `docs/DECISIONS.md`.
- **Três extratos ilegíveis.** `Janeiro ate março`, `abril até junho` e `julho` foram
  impressos pelo app do Itaú e não têm texto recuperável. Precisam ser reexportados em
  xlsx/csv pelo internet banking.
- **Teste de RLS automatizado** (teste 6 da §11), pendente da Q5 em `docs/DECISIONS.md`.
- **Projeto Supabase.** Sem URL e chave, o app sobe e mostra a tela de "não configurado",
  mas ninguém entra.
- **Segunda entidade.** Nada da `GABRIEL SAMPAIO JACOB LTDA - ME` chegou (Q2).
