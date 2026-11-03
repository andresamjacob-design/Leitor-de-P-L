/**
 * O bloco `Emissão de NF` da aba `Clientes` da planilha de fluxo, copiado para o app (D170).
 *
 * O Andre em 03/11: *"adicione uma página de emissão de NF que nem no meu fluxo de caixa"*.
 * Na planilha é uma linha por cliente e uma coluna por mês com o valor da nota emitida — de
 * dezembro de 2025 a dezembro de 2026 —, e logo abaixo um bloco `Pagamento de NF`, que é a
 * previsão de quando o dinheiro entra. Só o primeiro é copiado: o pagamento de verdade está
 * no extrato, e é contra ele que a `inadimplencia` confere.
 *
 * Como o resto da D141, a cópia não interpreta: rótulo como está, valor como está. Fica na
 * `planilha_linhas` com `relatorio = 'nf'`, em duas formas de linha:
 *
 *   - a primeira, `secao`, diz **de que mês é cada coluna** (`valores` são os períodos). A
 *     planilha começa em dezembro do ano anterior, e guardar o mês junto evita que a tela
 *     dependa de uma convenção escrita em outro lugar;
 *   - as demais, `linha`, uma por cliente, com `detalhe` = escopo · cobrança · CNPJ.
 *
 * O CNPJ vem da coluna `Dados (CNPJ e Email)` e é o que liga a nota ao recebimento: o
 * extrato do Itaú traz o documento de quem pagou, e a maioria das entradas não tem cliente.
 */

import { cents } from "@/lib/contratos-da-planilha";
import type { Cell, Sheet } from "@/lib/import/xlsx";
import { toNumeric, type Cents } from "@/lib/money";
import type { LinhaPlanilha } from "@/lib/planilha";
import type { Period } from "@/lib/dates";

export const TITULO = "Emissão de NF";
const FIM_DO_BLOCO = "Pagamento de NF";

const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

const COLUNA_ROTULO = 0;
const COLUNA_DADOS = 2;
const COLUNA_COBRANCA = 4;
const COLUNA_ESCOPO = 5;

const texto = (cell: Cell | undefined): string => (cell ?? "").toString().trim();

/** `04.203.891/0001-34 - isis@…` → `04203891000134`. O primeiro CNPJ da célula, se houver. */
export function cnpjDaCelula(cell: string | null): string | null {
  const achado = /(\d{2})\.?(\d{3})\.?(\d{3})\/?(\d{4})-?(\d{2})/.exec(cell ?? "");
  return achado ? achado.slice(1).join("") : null;
}

function formatarCnpj(cnpj: string): string {
  return `${cnpj.slice(0, 2)}.${cnpj.slice(2, 5)}.${cnpj.slice(5, 8)}/${cnpj.slice(8, 12)}-${cnpj.slice(12)}`;
}

/**
 * As colunas de mês do cabeçalho, em ordem. `Dezembro 2025` traz o ano; `Janeiro` em diante
 * não, e o ano vira quando o mês volta para trás.
 */
function colunasDeMes(cabecalho: readonly Cell[]): { coluna: number; periodo: Period }[] {
  const colunas: { coluna: number; periodo: Period }[] = [];
  let ano: number | null = null;
  let ultimoMes = 0;
  cabecalho.forEach((cell, coluna) => {
    const [nome = "", anoEscrito] = texto(cell).toLowerCase().split(/\s+/);
    const mes = MESES.indexOf(nome) + 1;
    if (mes === 0) return;
    if (anoEscrito && /^\d{4}$/.test(anoEscrito)) ano = Number(anoEscrito);
    else if (ano !== null && mes <= ultimoMes) ano += 1;
    if (ano === null) throw new Error(`o cabeçalho de \`${TITULO}\` não diz o ano do primeiro mês`);
    ultimoMes = mes;
    colunas.push({ coluna, periodo: `${ano}-${String(mes).padStart(2, "0")}-01` });
  });
  return colunas;
}

export type LeituraNf = {
  linhas: LinhaPlanilha[];
  /** Célula de mês com texto que não é número. Não entra — e o importador a mostra. */
  ignoradas: string[];
};

export function lerEmissaoDeNf(aba: Sheet): LeituraNf {
  const inicio = aba.rows.findIndex((row) => texto(row[COLUNA_ROTULO]) === TITULO);
  if (inicio < 0) throw new Error(`a aba \`${aba.name}\` não tem o bloco \`${TITULO}\``);
  const colunas = colunasDeMes(aba.rows[inicio] ?? []);
  if (colunas.length === 0) throw new Error(`o bloco \`${TITULO}\` não tem colunas de mês`);

  const linhas: LinhaPlanilha[] = [
    {
      ordem: 1,
      tipo: "secao",
      rotulo: TITULO,
      detalhe: null,
      valores: colunas.map((c) => c.periodo),
      total: null,
    },
  ];
  const ignoradas: string[] = [];

  // A linha logo abaixo do título é a soma (`Receita`); os clientes vêm depois dela.
  for (const row of aba.rows.slice(inicio + 2)) {
    const rotulo = texto(row[COLUNA_ROTULO]);
    if (rotulo === FIM_DO_BLOCO) break;
    if (rotulo === "") continue;

    const valores = colunas.map(({ coluna, periodo }) => {
      const celula = texto(row[coluna]);
      if (celula === "") return null;
      if (!Number.isFinite(Number(celula))) {
        ignoradas.push(`${rotulo}, ${periodo.slice(0, 7)}: “${celula}”`);
        return null;
      }
      const valor = cents(celula);
      return valor === null ? null : toNumeric(valor);
    });
    if (valores.every((v) => v === null)) continue;

    const cnpj = cnpjDaCelula(texto(row[COLUNA_DADOS]));
    const detalhe = [texto(row[COLUNA_ESCOPO]), texto(row[COLUNA_COBRANCA]), cnpj ? formatarCnpj(cnpj) : ""]
      .filter((parte) => parte !== "")
      .join(" · ");

    linhas.push({
      ordem: linhas.length + 1,
      tipo: "linha",
      rotulo,
      detalhe: detalhe === "" ? null : detalhe,
      valores,
      total: null,
    });
  }

  return { linhas, ignoradas };
}

/** Uma linha da cópia, de volta em forma de notas: uma por mês com valor. */
export type LinhaDeNf = {
  ordem: number;
  rotulo: string;
  /** Só os dígitos, quando a planilha diz. */
  cnpj: string | null;
  /** `Projeto`, `Ongoing`, `Referral` — a primeira parte do `detalhe`. */
  escopo: string | null;
  notas: { periodo: Period; valor: Cents }[];
};

/** O inverso da cópia: o que a tela e a `inadimplencia` usam. */
export function notasDaCopia(linhas: readonly LinhaPlanilha[]): { periodos: Period[]; linhas: LinhaDeNf[] } {
  const cabecalho = linhas.find((l) => l.tipo === "secao");
  if (!cabecalho) return { periodos: [], linhas: [] };
  const periodos = cabecalho.valores.filter((v): v is string => v !== null);

  return {
    periodos,
    linhas: linhas
      .filter((l) => l.tipo === "linha")
      .map((l) => ({
        ordem: l.ordem,
        rotulo: l.rotulo,
        cnpj: cnpjDaCelula(l.detalhe),
        escopo: l.detalhe?.split(" · ")[0] ?? null,
        notas: periodos.flatMap((periodo, i) => {
          const v = l.valores[i];
          return v ? [{ periodo, valor: cents(v) ?? 0n }] : [];
        }).filter((n) => n.valor > 0n),
      })),
  };
}
