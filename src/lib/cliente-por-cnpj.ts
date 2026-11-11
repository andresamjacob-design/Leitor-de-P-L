/**
 * Quem pagou, pelo CNPJ.
 *
 * O CNPJ que o banco mostra na entrada é o mesmo cadastrado no cliente: quando batem, o
 * dinheiro é desse cliente, sem precisar de regra. Comparamos só os dígitos, porque o
 * extrato e o cadastro formatam diferente ("01.080.512/0001-78" × "01080512000178").
 *
 * Um CNPJ em dois clientes é ambíguo, e então não escolhemos nenhum: ligar errado é pior
 * do que deixar a entrada esperando alguém escolher.
 */
export type ClienteComCnpj = { id: string; taxId: string | null };

const digitos = (valor: string | null | undefined) => (valor ?? "").replace(/\D/g, "");

export function clientePorCnpj(clientes: readonly ClienteComCnpj[]): (cnpj: string | null) => string | null {
  const porCnpj = new Map<string, string | null>();
  for (const cliente of clientes) {
    const chave = digitos(cliente.taxId);
    if (chave === "") continue;
    porCnpj.set(chave, porCnpj.has(chave) ? null : cliente.id);
  }
  return (cnpj) => {
    const chave = digitos(cnpj);
    return chave === "" ? null : (porCnpj.get(chave) ?? null);
  };
}
