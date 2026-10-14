/**
 * Para onde mandar a pessoa depois do login, sem nunca sair do app (D155).
 *
 * O `redirect` vem da URL, então qualquer um escreve o que quiser nele. Conferir "começa com
 * uma barra só" não basta: `/\outro.site` passa, e o navegador troca a contrabarra por barra;
 * `@outro.site` colado depois da origem vira credencial de outro host. A regra certa é
 * resolver contra a origem do app e aceitar só se a origem continuar a mesma.
 */
export function destinoInterno(redirect: string | null | undefined, origem: string): string {
  if (!redirect) return "/";
  try {
    const url = new URL(redirect, origem);
    if (url.origin !== new URL(origem).origin) return "/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}
