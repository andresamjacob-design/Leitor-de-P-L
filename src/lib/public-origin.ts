import type { NextRequest } from "next/server";

/**
 * O endereço público do site, como o navegador o vê.
 *
 * No Render a requisição chega ao Next por um proxy, e `request.nextUrl.origin` é o endereço
 * interno — `http://localhost:10000`. Redirecionar para ele manda o usuário para a máquina
 * dele mesmo: foi o que aconteceu em 11/11, quando o link de acesso do Gabriel voltou para
 * `localhost:10000/login` e o navegador recusou a conexão.
 *
 * O proxy informa o host e o protocolo originais em `x-forwarded-host` e
 * `x-forwarded-proto`; sem eles (desenvolvimento local), vale a origem da própria requisição.
 */
export function publicOrigin(request: NextRequest): string {
  const host = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  if (!host) return request.nextUrl.origin;
  const proto =
    request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ||
    request.nextUrl.protocol.replace(":", "");
  return `${proto}://${host}`;
}
