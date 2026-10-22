/**
 * A DRE pronta: a planilha do Andre nos meses que ela tem, o cálculo do app nos meses que ela
 * ainda não tem — nas mesmas linhas, na mesma ordem (D163). É o fluxo pronto (D146) do lado da
 * competência.
 *
 * De onde vem cada linha:
 *
 *   - **Cliente** (linha com escopo `Ongoing`, `Projeto`, `Referral`, `Salesforce`): a receita
 *     reconhecida dos contratos de mesmo nome e tipo — todas as versões, porque o aditivo (D13)
 *     é outro contrato com o mesmo nome. O Andre escolheu em 15/10 que a receita nasce dos
 *     contratos no app (D162).
 *   - **Custo**: a competência da conta (`TO_CODE`), com as exceções de `CONTAS_DA_DRE`.
 *   - **Linhas que a planilha lança pelo pagamento do mês seguinte** (`DESLOCADAS`): medido
 *     contra janeiro a agosto — `Impostos` de agosto é a guia paga em 18 e 21/09 ao centavo, e
 *     `Tarefy` e `Escola.i` fecham deslocadas em 8 de 8 meses. O mês só se preenche quando o
 *     extrato do mês seguinte está completo; antes disso a célula fica vazia, e os totais que
 *     dependem dela também. Mês sem guia não é mês sem imposto.
 *
 * As regras do fluxo pronto valem aqui: célula que a planilha tem nunca é sobrescrita; cada
 * contrato e cada conta vão para uma linha só (`Alimentação` e `Travel Meals` são as duas a
 * `9.03`: o valor vai para a primeira); o que não tem linha vira `Outras receitas` / `Outros
 * custos (sem linha na planilha)`, para o total continuar sendo o do app.
 *
 * Puro: recebe as linhas e os números do app, devolve as linhas com `calculado` marcando cada
 * célula que veio do app.
 */

import { SCOPES } from "@/lib/contratos-da-planilha";
import { normalizarRotulo, TO_CODE } from "@/lib/linhas-da-planilha";
import { fromNumeric, toNumeric, type Cents } from "@/lib/money";
import type { LinhaPlanilha } from "@/lib/planilha";

export type LinhaDaDre = LinhaPlanilha & { calculado: boolean[] };

export type DadosDaDre = {
  /** Receita reconhecida por contrato, chave `nome|tipo` em minúsculas, doze meses. */
  receita: ReadonlyMap<string, readonly Cents[]>;
  /** Custo reconhecido por código de conta, doze meses. */
  custo: ReadonlyMap<string, readonly Cents[]>;
};

export type DreDoApp = {
  linhas: LinhaDaDre[];
  /** Mês (janeiro = 0) → as linhas que esperam o extrato do mês seguinte. */
  aguardando: Map<number, string[]>;
};

const MESES = 12;

/** Onde a linha da DRE não é a do `TO_CODE`, e por quê. */
export const CONTAS_DA_DRE: Record<string, string[]> = {
  // A aba `Colaboradores` inteira: time mais pró-labore (D110). Agosto fecha ao centavo
  // contra a folha cadastrada (D161).
  Salários: ["6.10", "6.11"],
  // O `TO_CODE` leva `Freelancers` para a `6.10`, que aqui já está em `Salários`. A linha da
  // DRE é a de empresa (D117).
  "Freelancers (Outras empresas)": ["6.12"],
  "Agência Ciclo": ["8.03"],
  Impostos: ["4.01"],
};

/** As linhas que a planilha lança pelo que foi pago no mês seguinte (D101, medido na D163). */
export const DESLOCADAS = new Set(["Impostos", "Contabilidade", "Tarefy", "Escola.i", "Agência Ciclo", "Juridico"]);

export function contasDaLinhaDaDre(rotulo: string): string[] | null {
  const limpo = normalizarRotulo(rotulo);
  const conta = TO_CODE[rotulo] ?? TO_CODE[limpo];
  return CONTAS_DA_DRE[rotulo] ?? CONTAS_DA_DRE[limpo] ?? (conta ? [conta] : null);
}

/** `Ongoing · Mensal` → a chave do contrato daquela linha, ou `null` se não é cliente. */
export function chaveDoContrato(linha: Pick<LinhaPlanilha, "rotulo" | "detalhe">): string | null {
  const escopo = SCOPES[(linha.detalhe ?? "").split(" · ")[0] ?? ""];
  return escopo ? `${linha.rotulo.toLowerCase()}|${escopo.type}` : null;
}

const somar = (valores: readonly (Cents | null)[]): Cents | null =>
  valores.some((v) => v === null) ? null : valores.reduce<Cents>((a, v) => a + (v as Cents), 0n);

/** Razão com seis casas, no formato que a planilha guarda o `OPBB %` (`0.302500`). */
function razao(parte: Cents, todo: Cents): string | null {
  if (todo === 0n) return null;
  const micro = (parte * 1_000_000n) / todo;
  const sinal = micro < 0n ? "-" : "";
  const abs = micro < 0n ? -micro : micro;
  return `${sinal}${abs / 1_000_000n}.${String(abs % 1_000_000n).padStart(6, "0")}`;
}

export function preencherDreComApp(
  linhas: readonly LinhaPlanilha[],
  dados: DadosDaDre,
  meses: readonly number[],
  /** O último mês (janeiro = 0) com extrato completo — as `DESLOCADAS` precisam do seguinte. */
  ultimoFechado: number,
): DreDoApp {
  const alvo = meses.filter((m) => m >= 0 && m < MESES);
  const saida: LinhaDaDre[] = linhas.map((l) => ({
    ...l,
    valores: Array.from({ length: MESES }, (_, i) => l.valores[i] ?? null),
    calculado: Array.from({ length: MESES }, () => false),
  }));
  const aguardando = new Map<number, string[]>();
  const pendentes = new Map<LinhaDaDre, Set<number>>();
  const contratosUsados = new Set<string>();
  const contasUsadas = new Set<string>();
  const vazio = (l: LinhaDaDre, m: number) => l.valores[m] === null;
  const escrever = (l: LinhaDaDre, m: number, v: Cents | string | null) => {
    if (!vazio(l, m) || v === null) return;
    l.valores[m] = typeof v === "string" ? v : toNumeric(v);
    l.calculado[m] = true;
  };

  // Onde cada linha está: receita (entre `Receita` e `Impostos`), custo direto, custo.
  type Bloco = "receita" | "direto" | "custo" | null;
  const blocos: Bloco[] = [];
  let bloco: Bloco = null;
  for (const l of saida) {
    if (l.tipo === "total") {
      if (l.rotulo === "Receita") bloco = "receita";
      else if (l.rotulo === "Custos Operacionais Diretos") bloco = "direto";
      else if (l.rotulo === "Custos Operacionais") bloco = "custo";
      else bloco = null;
    } else if (l.rotulo === "Impostos") bloco = null;
    blocos.push(l.tipo === "linha" ? bloco : null);
  }

  // As linhas, cada contrato e cada conta numa só.
  for (const l of saida) {
    if (l.tipo !== "linha") continue;
    const chave = chaveDoContrato(l);
    if (chave !== null) {
      if (contratosUsados.has(chave) || !dados.receita.has(chave)) continue;
      contratosUsados.add(chave);
      for (const m of alvo) escrever(l, m, dados.receita.get(chave)?.[m] ?? 0n);
      continue;
    }
    const contas = (contasDaLinhaDaDre(l.rotulo) ?? []).filter((c) => !contasUsadas.has(c));
    if (contas.length === 0) continue;
    for (const c of contas) contasUsadas.add(c);
    const deslocada = DESLOCADAS.has(normalizarRotulo(l.rotulo));
    for (const m of alvo) {
      const de = deslocada ? m + 1 : m;
      if (deslocada && de > ultimoFechado) {
        if (!vazio(l, m)) continue;
        aguardando.set(m, [...(aguardando.get(m) ?? []), normalizarRotulo(l.rotulo)]);
        pendentes.set(l, (pendentes.get(l) ?? new Set()).add(m));
        continue;
      }
      escrever(l, m, contas.reduce((a, c) => a + (dados.custo.get(c)?.[de] ?? 0n), 0n));
    }
  }

  // O que não tem linha: antes de `Impostos` e antes do `OPBB`, para os totais fecharem.
  const sobra = (rotulo: string, series: (readonly Cents[])[]): LinhaDaDre | null => {
    const valores: (string | null)[] = Array.from({ length: MESES }, () => null);
    const calculado = Array.from({ length: MESES }, () => false);
    let temAlgo = false;
    for (const m of alvo) {
      const v = series.reduce((a, s) => a + (s[m] ?? 0n), 0n);
      valores[m] = toNumeric(v);
      calculado[m] = true;
      if (v !== 0n) temAlgo = true;
    }
    return temAlgo ? { ordem: 0, tipo: "linha", rotulo, detalhe: null, valores, total: null, calculado } : null;
  };
  const outrasReceitas = sobra(
    "Outras receitas (sem linha na planilha)",
    [...dados.receita].filter(([k]) => !contratosUsados.has(k)).map(([, s]) => s),
  );
  const outrosCustos = sobra(
    "Outros custos (sem linha na planilha)",
    [...dados.custo].filter(([c]) => !contasUsadas.has(c)).map(([, s]) => s),
  );
  const ondeImpostos = saida.findIndex((l) => l.rotulo === "Impostos");
  const ondeOpbb = saida.findIndex((l) => l.tipo === "total" && l.rotulo.startsWith("OPBB"));
  if (outrosCustos && ondeOpbb >= 0) {
    saida.splice(ondeOpbb, 0, outrosCustos);
    blocos.splice(ondeOpbb, 0, "custo");
  }
  if (outrasReceitas && ondeImpostos >= 0) {
    saida.splice(ondeImpostos, 0, outrasReceitas);
    blocos.splice(ondeImpostos, 0, "receita");
  }

  // Os totais, só onde a planilha não tem e só com todas as partes.
  // Linha vazia vale zero; linha que espera o extrato do mês seguinte não vale nada ainda.
  const celula = (l: LinhaDaDre | undefined, m: number): Cents | null => {
    if (!l) return 0n;
    if (pendentes.get(l)?.has(m)) return null;
    return l.valores[m] === null ? 0n : fromNumeric(l.valores[m] as string);
  };
  const doBloco = (b: Bloco, m: number): Cents | null =>
    somar(saida.filter((_, i) => blocos[i] === b).map((l) => celula(l, m)));
  const total = (rotulo: string) => saida.find((l) => l.tipo === "total" && l.rotulo === rotulo);
  const impostos = saida.find((l) => l.rotulo === "Impostos");
  const opbb = saida.find((l) => l.tipo === "total" && l.rotulo.startsWith("OPBB"));
  const percentual = saida.find((l) => l.tipo === "percentual");
  for (const m of alvo) {
    const receita = doBloco("receita", m);
    const imposto = celula(impostos, m);
    const liquida = receita === null || imposto === null ? null : receita - imposto;
    const direto = doBloco("direto", m);
    const bruto = liquida === null || direto === null ? null : liquida - direto;
    const custo = doBloco("custo", m);
    const lucro = bruto === null || custo === null ? null : bruto - custo;
    const r = total("Receita");
    if (r) escrever(r, m, receita);
    const rl = total("Receita Liquida");
    if (rl) escrever(rl, m, liquida);
    const cd = total("Custos Operacionais Diretos");
    if (cd) escrever(cd, m, direto);
    const lb = total("Lucro Bruto");
    if (lb) escrever(lb, m, bruto);
    const co = total("Custos Operacionais");
    if (co) escrever(co, m, custo);
    if (opbb) escrever(opbb, m, lucro);
    if (percentual && lucro !== null && receita !== null) escrever(percentual, m, razao(lucro, receita));
  }

  // O total de cada linha passa a incluir os meses calculados; percentual não se soma.
  const linhasFinais = saida.map((l, i) => {
    const totalLinha =
      l.tipo === "percentual" || !l.calculado.some(Boolean)
        ? l.total
        : toNumeric(l.valores.reduce<Cents>((a, v) => a + (v === null ? 0n : fromNumeric(v)), 0n));
    return { ...l, ordem: i + 1, total: totalLinha };
  });
  return { linhas: linhasFinais, aguardando };
}

/** Uma linha de competência como a DRE pronta precisa dela. */
export type LinhaDeCompetencia = {
  /** Janeiro = 0. */
  mes: number;
  kind: "revenue" | "cost";
  amount: Cents;
  codigo: string | null;
  contrato: { nome: string; tipo: string } | null;
};

/**
 * A competência do ano agrupada como a DRE pronta lê: receita por contrato (`nome|tipo`), custo
 * por conta. Receita sem contrato — lançamento manual na competência — vai por conta, com a
 * chave `conta:3.0x`, e cai em `Outras receitas`.
 */
export function montarDadosDaDre(linhas: readonly LinhaDeCompetencia[]): DadosDaDre {
  const receita = new Map<string, Cents[]>();
  const custo = new Map<string, Cents[]>();
  const somarEm = (mapa: Map<string, Cents[]>, chave: string, mes: number, valor: Cents) => {
    const serie = mapa.get(chave) ?? Array.from({ length: MESES }, () => 0n);
    serie[mes] = (serie[mes] ?? 0n) + valor;
    mapa.set(chave, serie);
  };
  for (const l of linhas) {
    if (l.mes < 0 || l.mes >= MESES) continue;
    if (l.kind === "revenue") {
      const chave = l.contrato ? `${l.contrato.nome.toLowerCase()}|${l.contrato.tipo}` : `conta:${l.codigo ?? "?"}`;
      somarEm(receita, chave, l.mes, l.amount);
    } else if (l.codigo) {
      somarEm(custo, l.codigo, l.mes, l.amount);
    }
  }
  return { receita, custo };
}
