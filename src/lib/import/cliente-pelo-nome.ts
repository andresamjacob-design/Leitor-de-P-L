/**
 * O cliente de uma entrada que chegou só com o nome de quem pagou (D169).
 *
 * O print do BS2 mostra o nome do pagador do Pix e nenhum documento. O Andre em 03/11:
 * *"o app deve ser capaz de fazer isso sozinho"* e *"com o nome presente no print você
 * consegue linkar de quem foi o pagamento e aí adicionar"*.
 *
 * Então são duas peças:
 *
 *   - `clientePeloNome` acha o cliente já cadastrado. O nome cadastrado tem de ser o
 *     **começo** do nome do pagador, palavra por palavra (`Hold Beauty` casa com
 *     `HOLD BEAUTY IMPORTACAO LTDA`), ou o contrário quando o banco cortou o nome no meio.
 *     Um cliente só; com dois, não decide. Parecido no meio do nome nunca casa —
 *     `MS Tecnologia` e `FULANO MARKETING E TECNOLOGIA` continuam separados (D87).
 *   - `clienteJaVisto` acha o cliente a quem o mesmo pagador já foi ligado no razão, e vem
 *     antes: é decisão do Andre, não semelhança de nome.
 *
 * Ninguém é cadastrado sozinho. As três vezes que o app criou cliente pelo nome do print,
 * o pagador era um cliente que já existia com outro nome (03/11).
 */

export type ClienteCadastrado = { id: string; name: string; taxId: string | null };

function palavras(texto: string): string[] {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((p) => p !== "");
}

/** Abaixo disto o nome é curto demais para identificar alguém sozinho (`FE`, `GS`). */
const MINIMO_DE_LETRAS = 4;
/** Nome cortado pelo banco só vale se sobrarem pelo menos estas palavras. */
const MINIMO_DE_PALAVRAS_CORTADO = 2;

const comeca = (longo: readonly string[], curto: readonly string[]) =>
  curto.length <= longo.length && curto.every((p, i) => longo[i] === p);

export function clientePeloNome(
  pagador: string | null,
  clientes: readonly ClienteCadastrado[],
): ClienteCadastrado | null {
  if (pagador === null) return null;
  const doPagador = palavras(pagador);
  if (doPagador.length === 0) return null;

  const achados = clientes.filter((cliente) => {
    const doCliente = palavras(cliente.name);
    if (doCliente.join("").length < MINIMO_DE_LETRAS) return false;
    if (comeca(doPagador, doCliente)) return true;
    // O banco cortou o nome do pagador antes do fim do nome cadastrado.
    return doPagador.length >= MINIMO_DE_PALAVRAS_CORTADO && comeca(doCliente, doPagador);
  });
  return achados.length === 1 ? (achados[0] as ClienteCadastrado) : null;
}

/** O nome do pagador como chave: `INSIDER BRASIL LTDA` e `Insider Brasil Ltda` são o mesmo. */
export function chaveDoPagador(pagador: string): string {
  return palavras(pagador).join(" ");
}

/**
 * O cliente a quem este pagador já foi ligado no razão. Quem paga nem sempre é o cliente —
 * a Insider paga pelo Vasco da Gama, a Fe Franchising é a Fast Escova, a Beauty Supply é
 * a Braé (o Andre em 03/11) — e nenhum nome casa com o outro. Ligado uma vez, o app lembra.
 */
export function clienteJaVisto(
  pagador: string | null,
  historico: ReadonlyMap<string, string>,
): string | null {
  if (pagador === null) return null;
  const chave = chaveDoPagador(pagador);
  return chave === "" ? null : (historico.get(chave) ?? null);
}
