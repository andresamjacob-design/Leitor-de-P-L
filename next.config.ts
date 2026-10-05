import type { NextConfig } from "next";

/**
 * O envio de arquivos do mês (D143) manda vários de uma vez — um extrato e duas ou três
 * faturas de ~300 KB — numa única Server Action. Os dois padrões do Next cortariam isso:
 *
 *   - `serverActions.bodySizeLimit` recusa acima de **1 MB**, e o formulário prometia 15 MB
 *     por arquivo desde a Fase 3 — uma fatura grande já não passaria;
 *   - `proxyClientMaxBodySize` **corta em silêncio** acima de 10 MB, porque o `proxy.ts` (o
 *     antigo middleware) cobre todas as rotas e guarda o corpo da requisição em memória.
 *
 * 25 MB cabe um mês com folga. O limite por arquivo continua sendo 15 MB, conferido na ação.
 */
const nextConfig: NextConfig = {
  experimental: {
    serverActions: { bodySizeLimit: "25mb" },
    proxyClientMaxBodySize: "25mb",
  },
};

export default nextConfig;
