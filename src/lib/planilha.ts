/**
 * As planilhas do Andre, lidas para serem copiadas para dentro do app (D141).
 *
 * Em 24/09/2026 ele pediu, com todas as letras: *"copia elas em suas respectivas abas do app
 * seguindo a mesma ordem que tá lá"*. Então este arquivo **não interpreta nada**: não soma,
 * não recategoriza, não decide qual linha é custo. Ele percorre a planilha de cima para
 * baixo e devolve cada linha com o rótulo dela, os doze meses como estão na célula e o total
 * que a própria planilha declara.
 *
 * O único julgamento aqui é **visual** — qual linha é título de grupo, qual é total, qual é
 * percentual —, para a tela dar peso a elas como a planilha dá. Nenhum número depende disso.
 *
 * Tudo é puro: recebe as abas já lidas e devolve linhas. Quem lê o arquivo e quem grava no
 * banco é o `scripts/importar-planilhas.ts`.
 */

import type { Cell, Sheet } from "@/lib/import/xlsx";
import { fromNumeric, toNumeric } from "@/lib/money";

export type TipoLinha = "secao" | "grupo" | "linha" | "total" | "percentual";

export type LinhaPlanilha = {
  /** Posição, começando em 1. A tela ordena por isto e por nada mais. */
  ordem: number;
  tipo: TipoLinha;
  rotulo: string;
  /** O que a planilha diz ao lado do rótulo: `Projeto · Kickoff · Aberto`, `cartão`. */
  detalhe: string | null;
  /** Janeiro a dezembro, texto decimal simples (`30714.28571`). Célula vazia é `null`. */
  valores: (string | null)[];
  /** O total que a planilha declara na linha, quando declara. */
  total: string | null;
};

export type Leitura = {
  linhas: LinhaPlanilha[];
  /** Célula de mês com texto que não é número. Não entra — e o importador a mostra. */
  ignoradas: string[];
};

const MESES = 12;

// ---------------------------------------------------------------------------
// Célula
// ---------------------------------------------------------------------------

/**
 * Anda com a vírgula decimal `casas` posições para a direita (ou esquerda, se negativo),
 * **em texto**. Serve a duas coisas que não podem passar por `float`: expandir notação
 * científica (`1.16e-10`) e transformar razão em percentual (`0.1331` → `13.31`).
 */
export function deslocarDecimal(texto: string, casas: number): string {
  const negativo = texto.startsWith("-");
  const corpo = negativo ? texto.slice(1) : texto;
  const [inteiro = "0", fracao = ""] = corpo.split(".");
  let digitos = `${inteiro}${fracao}`;
  let ponto = inteiro.length + casas;
  if (ponto <= 0) {
    digitos = "0".repeat(1 - ponto) + digitos;
    ponto = 1;
  } else if (ponto > digitos.length) {
    digitos = digitos + "0".repeat(ponto - digitos.length);
  }
  const novoInteiro = digitos.slice(0, ponto).replace(/^0+(?=\d)/, "");
  const novaFracao = digitos.slice(ponto).replace(/0+$/, "");
  const resultado = novaFracao ? `${novoInteiro}.${novaFracao}` : novoInteiro;
  return negativo && /[1-9]/.test(resultado) ? `-${resultado}` : resultado;
}

/**
 * A célula como número decimal em texto, ou `null` se estiver vazia ou não for número.
 *
 * O leitor de xlsx devolve o que o arquivo guarda: `30714.28571`, `-37.5`, e às vezes
 * notação científica para restos de fórmula (`1.164153218e-10` na linha `Diferença`).
 */
export function celulaNumerica(celula: Cell | undefined): string | null {
  const texto = (celula ?? "").trim();
  if (texto === "") return null;
  const m = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(texto);
  if (!m) return null;
  const base = `${m[1]}${m[2]}${m[3] ? `.${m[3]}` : ""}`;
  return m[4] ? deslocarDecimal(base, Number(m[4])) : base;
}

/** Razão da planilha (`0.1331032629`) em percentual decimal (`13.31032629`). */
export function razaoEmPercentual(texto: string): string {
  return deslocarDecimal(texto, 2);
}

function texto(celula: Cell | undefined): string {
  return (celula ?? "").trim();
}

function mesesDe(
  linha: readonly Cell[],
  primeira: number,
  onde: string,
  ignoradas: string[],
): (string | null)[] {
  return Array.from({ length: MESES }, (_, i) => {
    const bruto = texto(linha[primeira + i]);
    const numero = celulaNumerica(bruto);
    if (bruto !== "" && numero === null) ignoradas.push(`${onde}, mês ${i + 1}: "${bruto}"`);
    return numero;
  });
}

// ---------------------------------------------------------------------------
// DRE Geral
// ---------------------------------------------------------------------------

/**
 * As linhas que a `DRE Geral` usa como total. É a estrutura da planilha dele, escrita aqui
 * porque o xlsx não carrega negrito: sem esta lista, "Receita Liquida" e "Impostos" pareceriam
 * a mesma coisa. Mudar esta lista muda o peso visual, nunca um valor.
 */
const TOTAIS_DRE = new Set([
  "Receita",
  "Receita Liquida",
  "Custos Operacionais Diretos",
  "Lucro Bruto",
  "Custos Operacionais",
]);

/** `Receita (dd+gsj)` é o total `Receita` das duas empresas somadas: tira o sufixo e confere. */
function ehTotalDre(rotulo: string): boolean {
  const semSufixo = rotulo.replace(/\s*\(dd\s*\+\s*gsj\)\s*$/i, "");
  return TOTAIS_DRE.has(semSufixo) || rotulo.startsWith("OPBB (");
}

export function lerDre(aba: Sheet): Leitura {
  const ignoradas: string[] = [];
  const linhas: LinhaPlanilha[] = [];
  const vazio = (): (string | null)[] => Array.from({ length: MESES }, () => null);

  const cabecalho = aba.rows.findIndex((r) => texto(r[4]) === "Janeiro");
  if (cabecalho < 0) throw new Error("a aba `DRE Geral` não tem a linha de cabeçalho com `Janeiro`");
  if (texto(aba.rows[cabecalho]?.[15]) !== "Dezembro") {
    throw new Error("a aba `DRE Geral` mudou de forma: `Dezembro` não está na coluna P");
  }

  for (let i = cabecalho; i < aba.rows.length; i += 1) {
    const r = aba.rows[i] ?? [];

    // Cada empresa tem o próprio cabeçalho de meses, com o nome dela na coluna A —
    // `DDGROUP` em cima, `GSJACOB` no segundo bloco (versão de 01/09). Vira título de seção.
    if (texto(r[4]) === "Janeiro") {
      const nome = texto(r[0]);
      if (nome !== "") {
        linhas.push({
          ordem: linhas.length + 1,
          tipo: "secao",
          rotulo: nome,
          detalhe: null,
          valores: vazio(),
          total: null,
        });
      }
      continue;
    }

    const bruto = texto(r[2]);
    if (bruto === "") continue;

    // `- Salários` é o recuo da planilha; a tela recua sozinha.
    const rotulo = bruto.replace(/^-\s*/, "");
    const tipo: TipoLinha = rotulo.startsWith("OPBB %")
      ? "percentual"
      : ehTotalDre(rotulo)
        ? "total"
        : "linha";

    // Ao lado do cliente a planilha diz o tipo de receita, o ritmo e se o projeto está
    // aberto; ao lado do custo, se é cartão ou boleto. Total não tem detalhe.
    const detalhe =
      tipo === "linha"
        ? [texto(r[1]), texto(r[3]), texto(r[0])].filter((t) => t !== "").join(" · ") || null
        : null;

    linhas.push({
      ordem: linhas.length + 1,
      tipo,
      rotulo,
      detalhe,
      valores: mesesDe(r, 4, `DRE Geral linha ${i + 1} (${rotulo})`, ignoradas),
      total: celulaNumerica(r[16]),
    });

    // A DRE acaba no OPBB %. Abaixo dele a planilha guarda premissas de cálculo — alíquota
    // de ISS, rateio por colaborador —, que não são linha de relatório.
    if (tipo === "percentual") break;
  }

  return { linhas, ignoradas };
}

// ---------------------------------------------------------------------------
// Fluxo de caixa
// ---------------------------------------------------------------------------

/** O fluxo usa três abas: o detalhe vem de `Income` e `Expenses`, o fechamento de `Summary`. */
export type AbasFluxo = { income: Sheet; expenses: Sheet; summary: Sheet };

/** As linhas do fechamento, na ordem da aba `Summary`, e quais delas são total. */
const FECHAMENTO: { rotulo: string; tipo: TipoLinha }[] = [
  { rotulo: "Inadimplencia", tipo: "linha" },
  { rotulo: "Net savings", tipo: "total" },
  { rotulo: "Ending balance", tipo: "total" },
  { rotulo: "Valor Itaú", tipo: "linha" },
  { rotulo: "Diferença", tipo: "linha" },
];

/**
 * Uma linha da `Summary` pelo rótulo da coluna D. A aba repete `Income` e `Expenses` mais
 * abaixo como título de bloco, sem número; vale a primeira ocorrência que tem valor.
 */
function linhaDoResumo(aba: Sheet, rotulo: string, ignoradas: string[]) {
  for (const [i, r] of aba.rows.entries()) {
    if (texto(r[3]) !== rotulo) continue;
    const valores = mesesDe(r, 4, `Summary linha ${i + 1} (${rotulo})`, ignoradas);
    if (valores.some((v) => v !== null)) return { valores, total: celulaNumerica(r[16]) };
  }
  return null;
}

/**
 * O detalhe de uma aba de fluxo (`Income` ou `Expenses`): cada grupo com o subtotal que a
 * própria aba declara (`Monthly totals:`), e as linhas de dentro na ordem em que aparecem.
 *
 * Linha só com `-` no rótulo é espaço reservado da planilha e fica de fora. Linha com nome
 * e sem valor — `Commissions & Fees`, `Travel Meals` — entra: está na planilha dele.
 */
function lerDetalhe(aba: Sheet, nome: string, ignoradas: string[]): Omit<LinhaPlanilha, "ordem">[] {
  const saida: Omit<LinhaPlanilha, "ordem">[] = [];
  let grupo = "";
  for (const [i, r] of aba.rows.entries()) {
    if (texto(r[1]) !== "") grupo = texto(r[1]);
    const rotulo = texto(r[4]);
    if (rotulo === "" || rotulo === "-" || rotulo === nome) continue;
    const onde = `${nome} linha ${i + 1} (${rotulo === "Monthly totals:" ? grupo : rotulo})`;
    saida.push({
      tipo: rotulo === "Monthly totals:" ? "grupo" : "linha",
      rotulo: rotulo === "Monthly totals:" ? grupo : rotulo,
      detalhe: null,
      valores: mesesDe(r, 5, onde, ignoradas),
      total: celulaNumerica(r[17]),
    });
  }
  return saida;
}

export function lerFluxo({ income, expenses, summary }: AbasFluxo): Leitura {
  const ignoradas: string[] = [];
  const saida: Omit<LinhaPlanilha, "ordem">[] = [];
  const vazio = (): (string | null)[] => Array.from({ length: MESES }, () => null);
  const secao = (rotulo: string) =>
    saida.push({ tipo: "secao", rotulo, detalhe: null, valores: vazio(), total: null });

  for (const [nome, aba] of [
    ["Income", income],
    ["Expenses", expenses],
  ] as const) {
    secao(nome);
    saida.push(...lerDetalhe(aba, nome, ignoradas));
    // O total da seção é o da `Summary`, que é o número que ele confere — não uma soma nova.
    const total = linhaDoResumo(summary, nome, ignoradas);
    if (total) saida.push({ tipo: "total", rotulo: `Total ${nome}`, detalhe: null, ...total });
  }

  secao("Summary");
  for (const { rotulo, tipo } of FECHAMENTO) {
    const linha = linhaDoResumo(summary, rotulo, ignoradas);
    saida.push({
      tipo,
      rotulo,
      detalhe: null,
      valores: linha?.valores ?? vazio(),
      total: linha?.total ?? null,
    });
  }

  return { linhas: saida.map((l, i) => ({ ordem: i + 1, ...l })), ignoradas };
}

// ---------------------------------------------------------------------------
// Corte: os meses que o app vai gerar sozinho
// ---------------------------------------------------------------------------

/**
 * Esvazia os meses depois de `ultimoMes` (1 = janeiro), para o app preenchê-los a partir do
 * extrato. Pedido do Andre em 24/09: *"deixe os valores dos meses seguintes zerados que a
 * intenção é testar o app com eles"* — setembro a dezembro na planilha são projeção.
 *
 * O total da linha deixa de ser o da planilha, que somava a projeção junto, e passa a ser a
 * soma dos meses que ficaram. É a única conta feita sobre a cópia, e só existe porque o
 * número dele deixou de valer para o que está na tela. Linha em que a planilha não declara
 * total continua sem total — `Ending balance` não se soma — e percentual também não.
 */
export function cortarDepoisDe(linhas: readonly LinhaPlanilha[], ultimoMes: number): LinhaPlanilha[] {
  if (ultimoMes < 1 || ultimoMes > MESES) throw new Error(`mês de corte inválido: ${ultimoMes}`);
  return linhas.map((l) => {
    const valores = l.valores.map((v, i) => (i < ultimoMes ? v : null));
    const total =
      l.tipo === "percentual" || l.total === null
        ? null
        : toNumeric(valores.reduce((soma, v) => soma + (v === null ? 0n : fromNumeric(v)), 0n));
    return { ...l, valores, total };
  });
}
