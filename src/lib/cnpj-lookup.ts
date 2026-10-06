/**
 * CNPJ → razão social, via BrasilAPI (dado público do CNPJ, sem chave).
 *
 * Existe para `npm run decisoes`: quando um documento aparece num lançamento e não é
 * cliente, nem pessoa, nem regra, hoje a pergunta "quem é" só tem o nome que o banco
 * mandou — que costuma vir truncado ou abreviado. Isso troca o número por um nome de
 * verdade, para reconhecer mais rápido.
 *
 * Não decide identidade nenhuma (D87): é dado público da Receita Federal, não um palpite
 * sobre qual cliente ou contrato o CNPJ é. Se a chamada falhar — rede fora, CNPJ não
 * encontrado, tempo esgotado — devolve `null` e quem chamou segue exatamente como antes;
 * o enriquecimento nunca pode travar um script que só lê.
 */

const ENDPOINT = "https://brasilapi.com.br/api/cnpj/v1";
const TIMEOUT_MS = 8_000;

export type CnpjInfo = {
  razaoSocial: string;
  nomeFantasia: string | null;
  situacao: string | null;
};

type BrasilApiCnpjResponse = {
  razao_social?: string;
  nome_fantasia?: string;
  descricao_situacao_cadastral?: string;
};

export async function lookupCnpj(cnpj: string): Promise<CnpjInfo | null> {
  const digits = cnpj.replace(/\D/g, "");
  if (digits.length !== 14) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    // Sem `user-agent`, o Node manda a requisição sem cabeçalho nenhum e o CDN da
    // BrasilAPI devolve 403 — curl manda um por padrão, e foi por isso que o teste manual
    // com curl funcionou e a primeira versão deste arquivo, silenciosamente, não.
    const response = await fetch(`${ENDPOINT}/${digits}`, {
      signal: controller.signal,
      headers: { "user-agent": "financeiro-app/1.0" },
    });
    if (!response.ok) return null;

    const body = (await response.json()) as BrasilApiCnpjResponse;
    if (!body.razao_social) return null;

    return {
      razaoSocial: body.razao_social,
      nomeFantasia: body.nome_fantasia?.trim() || null,
      situacao: body.descricao_situacao_cadastral ?? null,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
