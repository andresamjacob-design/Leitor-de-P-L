/**
 * Quem não pagou a nota (D170).
 *
 * O Andre em 03/11: *"preciso saber quais clientes não pagaram… sabendo que a NF pode
 * demorar até 1 mês para ser paga, precisaremos classificar se tem algum cliente com
 * pagamento atrasado"*.
 *
 * As notas vêm do bloco `Emissão de NF` da planilha; os pagamentos, do razão — o extrato, não
 * a previsão de pagamento da planilha. Três decisões fazem a conta:
 *
 *   - **Quem pagou é identificado pelo CNPJ, e o cliente vem depois.** Das entradas de receita
 *     de setembro, 25 de 39 não têm cliente no razão, mas todas as do Itaú trazem o documento
 *     de quem pagou. A raiz do CNPJ (8 dígitos) basta: a Hogrefe paga por duas filiais, e a
 *     Sonda da planilha é a filial `0010-73` de quem o Itaú mostra a matriz.
 *   - **O pagamento quita a nota aberta mais antiga daquele pagador.** Ninguém escreve no
 *     extrato qual nota está pagando, e pagamento junto (a Danke pagou duas de 12.375 num Pix
 *     só) sobra para a seguinte. Uma nota que recebeu **93% ou mais** está paga: é a retenção
 *     de impostos na fonte (IRRF 1,5% + PIS/COFINS/CSLL 4,65%), e a diferença não passa para a
 *     próxima nota — senão a retenção de cada mês somaria e inventaria um atraso no fim.
 *   - **A nota vence no último dia do mês seguinte ao da emissão.** "Até 1 mês" sem o dia de
 *     emissão — a planilha não guarda o dia de cada nota — é o fim do mês seguinte: nota de
 *     agosto pode ser paga até 30/09, e em 01/10 está atrasada. É a leitura que não acusa
 *     ninguém cedo demais.
 *
 * E duas coisas que o razão real pediu:
 *
 *   - **Nota de antes do razão não entra.** O extrato do Itaú começa em 01/01/2026, e a nota
 *     de dezembro de 2025 foi paga em dezembro. Com ela na conta, o pagamento de janeiro
 *     quitava a de dezembro e o Gringo aparecia com R$ 208 mil em atraso que não existem.
 *   - **Linha antiga sem CNPJ pega o CNPJ da mesma descrição.** `RECEBIMENTOS STAR PALESTRAS
 *     E EVE` de março veio sem documento; as de abril em diante, com a mesma descrição, vêm
 *     com. Só quando a descrição aponta para um CNPJ só — `RECEBIMENTOS` sozinho não serve.
 *
 * `Smartbrain (NF para Salesforce)` é contada no cliente final: a Salesforce paga, mas o
 * razão liga esses recebimentos ao cliente (`invoice 125` está na Medika, na Harpix…).
 *
 * Linha da planilha que não chega a cliente nem a CNPJ não é classificada: sem saber quem
 * paga, não há como dizer que não pagou. Ela aparece à parte, para ser identificada — e o
 * recebimento que não chega a ninguém também.
 */

import type { ClienteCadastrado } from "@/lib/import/cliente-pelo-nome";
import { clientePeloNome } from "@/lib/import/cliente-pelo-nome";
import { addMonths, compareDates, periodOf, type IsoDate, type Period } from "@/lib/dates";
import { mulRatio, sum, type Cents } from "@/lib/money";
import type { LinhaDeNf } from "@/lib/nf-da-planilha";

/** Recebeu isto da nota, ou mais, e a nota está paga — a retenção na fonte é o resto. */
export const PAGA_A_PARTIR_DE = { numerador: 93n, denominador: 100n };

export type Recebimento = {
  id: string;
  data: IsoDate;
  valor: Cents;
  clientId: string | null;
  /** Só dígitos, como o extrato traz. */
  cnpj: string | null;
  descricao: string;
};

export type SituacaoDaNota = "paga" | "a vencer" | "atrasada" | "prevista";

export type NotaAvaliada = {
  /** A linha da planilha de onde a nota veio — o mesmo cliente pode ter duas. */
  ordem: number;
  rotulo: string;
  periodo: Period;
  valor: Cents;
  pago: Cents;
  vencimento: IsoDate;
  situacao: SituacaoDaNota;
  /** Dias depois do vencimento, para a atrasada. */
  diasDeAtraso: number;
};

export type SituacaoDoCliente = "atrasado" | "a vencer" | "em dia";

export type Pagador = {
  chave: string;
  nome: string;
  clientId: string | null;
  rotulos: string[];
  notas: NotaAvaliada[];
  recebimentos: Recebimento[];
  emAtraso: Cents;
  aVencer: Cents;
  /** Recebido além do que as notas da planilha somam — nota que não está lá, ou adiantamento. */
  credito: Cents;
  diasDeAtraso: number;
  situacao: SituacaoDoCliente;
};

export type Inadimplencia = {
  pagadores: Pagador[];
  /** Linhas da planilha sem cliente nem CNPJ: não dá para saber quem paga. */
  semIdentificacao: LinhaDeNf[];
  /** Recebimentos desde `desde` que não chegaram a pagador nenhum. Ligue o cliente no razão. */
  recebimentosSemPagador: Recebimento[];
};

const raiz = (cnpj: string | null): string | null => {
  const digitos = (cnpj ?? "").replace(/\D/g, "");
  return digitos.length === 14 ? digitos.slice(0, 8) : null;
};

const normal = (texto: string) =>
  texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** O nome antes do parêntese e do ` - `: `Mary kay - B2B` → `Mary kay`. */
const nomeBase = (rotulo: string) =>
  rotulo.replace(/\(.*?\)/g, " ").split(/\s+-\s+/)[0]!.replace(/\s+/g, " ").trim();

/**
 * O cliente de uma linha da planilha, pelo nome antes do parêntese: o nome igual, ou o
 * cadastrado como começo do rótulo (`Denise Marques Midia` → `Denise Marques`), ou um cortado do outro letra a letra
 * (`Ilumini Clini` → `Ilumini Clinic`) — sempre um cliente só.
 */
export function clienteDoRotulo(
  rotulo: string,
  clientes: readonly ClienteCadastrado[],
): ClienteCadastrado | null {
  const alvo = normal(nomeBase(rotulo));
  if (alvo === "") return null;

  const iguais = clientes.filter((c) => normal(c.name) === alvo);
  if (iguais.length === 1) return iguais[0]!;
  const pelaPalavra = clientePeloNome(alvo, clientes);
  if (pelaPalavra) return pelaPalavra;

  const MINIMO = 6;
  const cortados = clientes.filter((c) => {
    const nome = normal(c.name);
    const curto = nome.length < alvo.length ? nome : alvo;
    return curto.length >= MINIMO && (nome.startsWith(alvo) || alvo.startsWith(nome));
  });
  return cortados.length === 1 ? cortados[0]! : null;
}

/** Último dia do mês seguinte ao da nota. */
export function vencimentoDe(periodo: Period): IsoDate {
  return diaAnterior(addMonths(periodo, 2));
}

function diaAnterior(data: IsoDate): IsoDate {
  const d = new Date(`${data}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function diasEntre(de: IsoDate, ate: IsoDate): number {
  return Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / 86_400_000);
}

export function avaliarInadimplencia({
  linhas,
  clientes,
  recebimentos,
  hoje,
  desde,
}: {
  linhas: readonly LinhaDeNf[];
  clientes: readonly ClienteCadastrado[];
  recebimentos: readonly Recebimento[];
  hoje: IsoDate;
  /** O primeiro mês com o razão completo. Nota e recebimento de antes ficam de fora. */
  desde: Period;
}): Inadimplencia {
  const mesAtual = periodOf(hoje);

  // ---- Linha da planilha → pagador ---------------------------------------
  const pagadores = new Map<string, { chave: string; nome: string; clientId: string | null; rotulos: string[]; notas: { ordem: number; rotulo: string; periodo: Period; valor: Cents }[] }>();
  const chavePorRaiz = new Map<string, string>();
  const semIdentificacao: LinhaDeNf[] = [];

  for (const linha of linhas) {
    const cliente = clienteDoRotulo(linha.rotulo, clientes);
    const raizDaLinha = raiz(linha.cnpj);
    const chave = cliente ? `cliente:${cliente.id}` : raizDaLinha ? `cnpj:${raizDaLinha}` : null;
    if (chave === null) {
      semIdentificacao.push(linha);
      continue;
    }
    const pagador = pagadores.get(chave) ?? {
      chave,
      nome: cliente?.name ?? nomeBase(linha.rotulo),
      clientId: cliente?.id ?? null,
      rotulos: [],
      notas: [],
    };
    pagador.rotulos.push(linha.rotulo);
    pagador.notas.push(
      ...linha.notas.filter((n) => n.periodo >= desde).map((n) => ({ ordem: linha.ordem, rotulo: linha.rotulo, ...n })),
    );
    pagadores.set(chave, pagador);

    if (raizDaLinha && !chavePorRaiz.has(raizDaLinha)) chavePorRaiz.set(raizDaLinha, chave);
    const raizDoCliente = raiz(cliente?.taxId ?? null);
    if (raizDoCliente && !chavePorRaiz.has(raizDoCliente)) chavePorRaiz.set(raizDoCliente, chave);
  }

  // ---- Recebimento → pagador ---------------------------------------------
  const noPeriodo = recebimentos.filter((r) => r.data >= desde);
  const raizPorDescricao = new Map<string, Set<string>>();
  for (const r of noPeriodo) {
    const raizDoRecebimento = raiz(r.cnpj);
    if (!raizDoRecebimento) continue;
    const descricao = normal(r.descricao);
    raizPorDescricao.set(descricao, (raizPorDescricao.get(descricao) ?? new Set()).add(raizDoRecebimento));
  }
  const raizDe = (r: Recebimento): string | null => {
    const propria = raiz(r.cnpj);
    if (propria) return propria;
    const pelaDescricao = raizPorDescricao.get(normal(r.descricao));
    return pelaDescricao?.size === 1 ? [...pelaDescricao][0]! : null;
  };

  const recebidos = new Map<string, Recebimento[]>();
  const recebimentosSemPagador: Recebimento[] = [];
  for (const r of noPeriodo) {
    const peloCliente = r.clientId && pagadores.has(`cliente:${r.clientId}`) ? `cliente:${r.clientId}` : null;
    const raizDoRecebimento = raizDe(r);
    const chave = peloCliente ?? (raizDoRecebimento ? chavePorRaiz.get(raizDoRecebimento) : undefined);
    if (!chave) {
      recebimentosSemPagador.push(r);
      continue;
    }
    recebidos.set(chave, [...(recebidos.get(chave) ?? []), r]);
  }

  // ---- A conta, pagador a pagador ----------------------------------------
  const resultado: Pagador[] = [];
  for (const p of pagadores.values()) {
    if (p.notas.length === 0) continue;
    const notas = [...p.notas].sort((a, b) => a.periodo.localeCompare(b.periodo));
    const emitidas = notas.filter((n) => n.periodo <= mesAtual);
    const pago = emitidas.map(() => 0n);
    const lista = [...(recebidos.get(p.chave) ?? [])].sort((a, b) => compareDates(a.data, b.data));

    let aberta = 0;
    let credito = 0n;
    for (const r of lista) {
      let resta = r.valor;
      while (resta > 0n && aberta < emitidas.length) {
        const nota = emitidas[aberta]!;
        const falta = nota.valor - pago[aberta]!;
        const usado = resta < falta ? resta : falta;
        pago[aberta]! += usado;
        resta -= usado;
        if (pago[aberta]! >= mulRatio(nota.valor, PAGA_A_PARTIR_DE.numerador, PAGA_A_PARTIR_DE.denominador)) {
          aberta += 1;
        }
      }
      credito += resta;
    }

    const avaliadas: NotaAvaliada[] = notas.map((nota) => {
      const i = emitidas.indexOf(nota);
      const vencimento = vencimentoDe(nota.periodo);
      if (i < 0) return { ...nota, pago: 0n, vencimento, situacao: "prevista", diasDeAtraso: 0 };
      const recebido = pago[i]!;
      const quitada = i < aberta;
      if (quitada) return { ...nota, pago: recebido, vencimento, situacao: "paga", diasDeAtraso: 0 };
      const atraso = diasEntre(vencimento, hoje);
      return atraso > 0
        ? { ...nota, pago: recebido, vencimento, situacao: "atrasada", diasDeAtraso: atraso }
        : { ...nota, pago: recebido, vencimento, situacao: "a vencer", diasDeAtraso: 0 };
    });

    const emAtraso = sum(avaliadas.filter((n) => n.situacao === "atrasada").map((n) => n.valor - n.pago));
    const aVencer = sum(avaliadas.filter((n) => n.situacao === "a vencer").map((n) => n.valor - n.pago));
    const diasDeAtraso = Math.max(0, ...avaliadas.map((n) => n.diasDeAtraso));
    resultado.push({
      chave: p.chave,
      nome: p.nome,
      clientId: p.clientId,
      rotulos: [...new Set(p.rotulos)],
      notas: avaliadas,
      recebimentos: lista,
      emAtraso,
      aVencer,
      credito,
      diasDeAtraso,
      situacao: emAtraso > 0n ? "atrasado" : aVencer > 0n ? "a vencer" : "em dia",
    });
  }

  resultado.sort((a, b) => (a.emAtraso === b.emAtraso ? a.nome.localeCompare(b.nome) : a.emAtraso > b.emAtraso ? -1 : 1));
  recebimentosSemPagador.sort((a, b) => compareDates(a.data, b.data));
  return { pagadores: resultado, semIdentificacao, recebimentosSemPagador };
}
