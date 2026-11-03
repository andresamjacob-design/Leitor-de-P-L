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
 * 25 MB cabia um mês com folga. Os prints do BS2 (D168) mudaram a conta: um mês são vários
 * prints de 1–3 MB cada, enviados juntos. 40 MB. O limite por arquivo continua sendo conferido
 * na ação (15 MB por arquivo, 5 MB por print).
 */
const nextConfig: NextConfig = {
  experimental: {
    serverActions: { bodySizeLimit: "40mb" },
    proxyClientMaxBodySize: "40mb",
  },
};

export default nextConfig;
