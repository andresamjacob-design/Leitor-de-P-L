/**
 * Põe o CNPJ do extrato no cliente que já existe.
 *
 * O `propose:receipts` se recusa a decidir isto sozinho, e com razão (D87): **41 dos 72
 * clientes estão sem documento**, e casar nome de empresa automaticamente cria duplicata —
 * `Windlog` e `BRAZIL WIND LOGISTICS AGENCIAMENTO INTERNACIONAL` são a mesma empresa e não
 * se parecem; `MS Tecnologia` e `FULANO MARKETING E TECNOLOGIA` se parecem e não são.
 * Cliente duplicado estraga a margem por cliente em silêncio.
 *
 * Então a decisão vem de fora, e este script só a executa. A tabela abaixo é a memória
 * dessas respostas: cada linha foi confirmada pelo Andre, e fica registrada aqui para a
 * próxima conversa não perguntar de novo.
 *
 * Depois de ligado, o CNPJ passa a valer para sempre: o `propose:receipts` reconhece a
 * contraparte, e se o cliente tiver contratos apontando todos para a mesma conta de
 * receita, a categoria sai junto sem ninguém escolher nada.
 *
 *   npm run vincular
 *   npm run vincular -- --aplicar
 */

import postgres from "postgres";
import { loadEnvLocal } from "./load-env.ts";
import { formatBRL, fromNumeric } from "@/lib/money";

loadEnvLocal();

const APPLY = process.argv.includes("--aplicar");

const GREEN = "[32m";
const YELLOW = "[33m";
const BOLD = "[1m";
const DIM = "[2m";
const RESET = "[0m";

/**
 * Confirmado pelo Andre em 18/08/2026.
 *
 * `cliente` é o nome exato como está cadastrado. `contraparte` é como o **extrato** escreve
 * a empresa — e é de lá que o documento é lido, nunca digitado aqui: um CNPJ escrito à mão
 * num arquivo de código é um número que ninguém confere e que cola no cliente errado em
 * silêncio. `porque` fica registrado porque daqui a seis meses ninguém lembra por que
 * "Windlog" e "BRAZIL WIND LOGISTICS" são a mesma coisa.
 */
const CONFIRMADOS: readonly { cliente: string; contraparte: string; porque: string }[] = [
  {
    cliente: "Windlog",
    contraparte: "BRAZIL WIND LOGISTICS%",
    porque: "Windlog é o nome curto de BRAZIL WIND LOGISTICS AGENCIAMENTO INTERNACIONAL",
  },
  {
    cliente: "Ciclo",
    contraparte: "CICLO INTELIGENCIA%",
    porque: "Ciclo é CICLO INTELIGENCIA EM E - COMMERCE; também é fornecedora, ver D83",
  },
  // Confirmados pelo Andre em 19/08/2026. Nenhum era cliente novo: todos já estavam
  // cadastrados sem documento, que é exatamente o motivo de o script não adivinhar (D87).
  {
    cliente: "FK Partners",
    contraparte: "A. F. COMERCIO DE LIVROS%",
    porque: "razão social da FK Partners",
  },
  { cliente: "Danbred", contraparte: "DB GENETICA SUINA%", porque: "razão social da Danbred" },
  {
    cliente: "Center Norte",
    contraparte: "CN INC 01 EMPREENDIMENTOS%",
    porque:
      "SPE do grupo Center Norte. O cliente já carrega o CNPJ da Associação dos Lojistas, " +
      "então este entra como regra por documento — ver o comentário sobre segundo CNPJ",
  },
  {
    cliente: "Liga Vitoria",
    contraparte: "LIGAVIT CORRETORA%",
    porque: "Ligavit é a razão social da Liga Vitoria",
  },
  {
    cliente: "Match",
    contraparte: "FULANO MARKETING%",
    porque: "razão social da Match Marketdata",
  },
  {
    cliente: "Smartbrain",
    contraparte: "BRAIN SOLUCOES INTEGRADAS%",
    porque: "razão social da Smartbrain",
  },
  {
    cliente: "Sewe Consultoria",
    contraparte: "SW SERVICOS%",
    porque: "razão social da Sewe Consultoria",
  },
  {
    cliente: "UMI SAN",
    contraparte: "UMI SAN SERVICOS%",
    porque: "mesmo nome, só a razão social é mais longa",
  },
  // Confirmado pelo Andre em 24/08/2026.
  //
  // Vale registrar a ironia: o comentário no topo deste arquivo usa `MS Tecnologia` como
  // exemplo do que **não** casar por semelhança de nome. A resposta verdadeira não se
  // parece nem um pouco — e o contrato confirma sozinho, sem ninguém ter procurado por
  // isso: a MS Tecnologia tem um `project` de R$ 20.000 com **monthly_value de R$ 5.000**,
  // vigente de 01/04 a 31/07/2026, e a ISM pagou exatamente 3× R$ 5.000 dentro da janela.
  // Conta única, então a categoria sai junto do vínculo.
  {
    cliente: "MS Tecnologia",
    contraparte: "ISM SERVICOS DE IMAGEM%",
    porque:
      "ISM Serviços de Imagem é a MS Tecnologia; o contrato dela é mensal de R$ 5.000, " +
      "que é exatamente o valor dos três recebimentos",
  },
];

/**
 * Documento que **paga por** um cliente sem ser o documento **dele**.
 *
 * Isto não é o mesmo que a tabela de cima, e confundir os dois foi um erro de verdade —
 * cometido aqui em 24/08/2026 e corrigido no dia seguinte. Pedido para ligar a B2B Câmbio ao
 * Roberto Pascoal, o `CONFIRMADOS` fez o que sabe fazer: gravou **o CPF dele em
 * `clients.tax_id`**. Empresa não tem CPF. O CNPJ da B2B Câmbio é 32.648.450/0001-81, e
 * estava na planilha o tempo todo.
 *
 * O sintoma apareceu sozinho e foi o que denunciou: a linha continuou **sem conta**, porque
 * o `propose:receipts` recusa CPF como receita de cliente (D94) — a trava certa, funcionando.
 *
 * A D94 já tinha escrito o caminho para o segundo documento: **vira regra**, com
 * `client_id` e conta juntos, e a identidade do cliente fica intacta. É o que esta tabela
 * faz. A diferença entre as duas não é técnica, é sobre o que a linha afirma: `CONFIRMADOS`
 * diz *"este documento é o cliente"*; `PAGADORES` diz *"este documento paga por ele"*.
 */
const PAGADORES: readonly {
  cliente: string;
  contraparte: string;
  code: string;
  porque: string;
}[] = [
  {
    cliente: "Iled",
    contraparte: "22072161 MARA THAYSA%",
    code: "3.02",
    porque: "a Mara Thaysa pagou pela Iled; o contrato da Iled é projeto",
  },
  {
    // A planilha nova reforça sem provar: o contato da B2B Câmbio é
    // `roberto.pascoal@b2bcambio.com.br`, NF emitida em 15/06, dinheiro em 19/07.
    cliente: "B2B Cambio",
    contraparte: "ROBERTO PASCOAL%",
    code: "3.02",
    porque: "o Roberto Pascoal pagou pela B2B Câmbio; o contrato dela é projeto",
  },
];

/**
 * Cliente que **não existe ainda** e o Andre disse que é cliente.
 *
 * Isto é o outro lado da mesma moeda da tabela acima. A D87 proíbe o script de *adivinhar*
 * que uma contraparte é cliente novo — foi assim que a Ciclo quase virou duplicata. Não
 * proíbe **executar** a resposta de quem sabe. A diferença entre as duas coisas é quem
 * decidiu, e aqui quem decidiu foi o dono da empresa.
 *
 * Duas travas, porque criar cliente é a operação que estraga a margem em silêncio:
 *
 *   - **um cliente com esse nome já existente cancela a criação.** Se existe, o certo é
 *     `CONFIRMADOS`, que liga o documento no que está lá.
 *   - **o documento vem do extrato**, como na tabela de cima e pelo mesmo motivo: CNPJ
 *     digitado à mão é número que ninguém confere.
 *
 * O `code` é necessário porque cliente recém-criado não tem contrato, e é do contrato que
 * o `propose:receipts` tira a conta. Sem ele o cliente nasceria ligado e mudo.
 */
const NOVOS: readonly {
  nome: string;
  contraparte: string;
  code: string;
  porque: string;
}[] = [
  {
    nome: "Conexão Marketing",
    contraparte: "CONEXAO MARKETING E SERVICOS%",
    code: "3.02",
    porque:
      "confirmado pelo Andre em 24/08/2026: é cliente, só não teve NF emitida. " +
      "Projeto e não Ongoing porque é um recebimento único de R$ 5.000 em 05/03, e o " +
      "razão tem cinco meses completos depois disso sem nenhuma repetição",
  },
];

/**
 * Uma empresa pode pagar de mais de um CNPJ — SPE, holding, associação de lojistas — e
 * `clients.tax_id` guarda um só. Quando o cliente já tem documento e o extrato traz outro,
 * sobrescrever perderia o primeiro; criar um cliente novo duplicaria a margem.
 *
 * O caminho certo já existe no projeto: **regra por documento** (D40). `categorization_rules`
 * carrega `counterparty_tax_id`, `client_id` e `category_id` juntos, que é exatamente
 * "esse CNPJ é desse cliente e cai nessa conta". É o que o `propose-parties` cria.
 *
 * Só funciona quando o cliente tem uma conta de receita única — com projeto e retainer ao
 * mesmo tempo a regra não saberia qual escolher, e aí para.
 */
const SEGUNDO_CNPJ_VIRA_REGRA = true;

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL não definido — veja o README.");

const sql = postgres(url, { max: 1, connect_timeout: 20 });

try {
  console.log(`\n${BOLD}${CONFIRMADOS.length} vínculos confirmados${RESET}\n`);

  const pendentes: { id: string; cliente: string; documento: string }[] = [];
  const pagadores: {
    entityId: string;
    clientId: string;
    cliente: string;
    documento: string;
    categoryId: string;
    conta: string;
    /** Id do cliente que ficou com este documento por engano, se houver. */
    limparDe: string | null;
    jaTemRegra: boolean;
  }[] = [];
  const regrasNovas: {
    entityId: string;
    clientId: string;
    cliente: string;
    documento: string;
    categoryId: string;
    conta: string;
  }[] = [];

  for (const link of CONFIRMADOS) {
    const [cliente] = await sql<
      { id: string; name: string; tax_id: string | null; entity_id: string }[]
    >`
      select id, name, tax_id, entity_id from clients where name = ${link.cliente}`;

    if (!cliente) {
      console.log(`  ${YELLOW}?${RESET} cliente “${link.cliente}” não existe — nada a fazer`);
      continue;
    }

    // O documento vem do extrato. Se a contraparte aparece com mais de um CNPJ, isso é
    // ambiguidade e não se resolve escolhendo um — é exatamente o caso de parar.
    const documentos = await sql<{ doc: string }[]>`
      select distinct regexp_replace(counterparty_tax_id, '\D', '', 'g') as doc
      from cash_entries
      where upper(coalesce(counterparty_name, '')) like ${link.contraparte}
        and counterparty_tax_id is not null`;

    console.log(`  ${BOLD}${cliente.name}${RESET} ${DIM}← ${link.contraparte}${RESET}`);
    console.log(`     ${DIM}${link.porque}${RESET}`);

    if (documentos.length === 0) {
      console.log(`     ${YELLOW}nenhum lançamento com esse nome no extrato${RESET}\n`);
      continue;
    }
    if (documentos.length > 1) {
      console.log(
        `     ${YELLOW}esse nome aparece com ${documentos.length} documentos diferentes — não dá para escolher${RESET}\n`,
      );
      continue;
    }

    const doc = documentos[0]!.doc;

    // A partir daqui é o **documento** que manda, não o nome. A Ciclo aparece no extrato
    // com três grafias — `CICLO INTELIGENCIA`, `CICLO - ASSESSORIA…`, `CICLO - A. M. I.
    // D. P.` — todas no mesmo CNPJ. Contar pelo nome contaria um terço do movimento.
    const [mov] = await sql<
      { entrou: string; entradas: string; saiu: string; saidas: string; grafias: string }[]
    >`
      select coalesce(sum(amount) filter (where direction = 'in'), 0)  as entrou,
             count(*) filter (where direction = 'in')                  as entradas,
             coalesce(sum(amount) filter (where direction = 'out'), 0) as saiu,
             count(*) filter (where direction = 'out')                 as saidas,
             count(distinct counterparty_name)                         as grafias
      from cash_entries
      where regexp_replace(coalesce(counterparty_tax_id, ''), '\D', '', 'g') = ${doc}`;

    const entrou = fromNumeric(mov?.entrou ?? "0");
    const saiu = fromNumeric(mov?.saiu ?? "0");

    console.log(
      `     documento …${doc.slice(-6)}   ` +
        `entrou ${formatBRL(entrou).padStart(14)} em ${mov?.entradas ?? 0} linhas` +
        `   ·   saiu ${formatBRL(saiu).padStart(14)} em ${mov?.saidas ?? 0} linhas`,
    );
    if (Number(mov?.grafias ?? 1) > 1) {
      console.log(
        `     ${DIM}o extrato escreve esse CNPJ de ${mov?.grafias} maneiras — por isso o documento manda, e não o nome${RESET}`,
      );
    }

    if (cliente.tax_id) {
      const atual = cliente.tax_id.replace(/\D/g, "");
      if (atual === doc) {
        console.log(`     ${GREEN}já vinculado${RESET}\n`);
        continue;
      }

      console.log(
        `     ${YELLOW}o cliente já tem outro CNPJ (…${atual.slice(-6)})${RESET} — nunca sobrescrito`,
      );

      if (!SEGUNDO_CNPJ_VIRA_REGRA) {
        console.log("");
        continue;
      }

      // Uma conta de receita única, ou a regra não saberia qual escolher.
      const contas = await sql<{ id: string; code: string; name: string }[]>`
        select distinct c.id, c.code, c.name
        from contracts ct
        join categories c on c.id = coalesce(
          ct.category_id,
          (select c2.id from categories c2
            where c2.entity_id = ct.entity_id
              and c2.code = case ct.type when 'retainer' then '3.01' else '3.02' end
            limit 1))
        where ct.client_id = ${cliente.id}`;

      if (contas.length !== 1) {
        console.log(
          `     ${YELLOW}o cliente alcança ${contas.length} contas de receita — a regra não saberia qual usar${RESET}\n`,
        );
        continue;
      }

      const conta = contas[0]!;
      const [jaExiste] = await sql<{ id: string }[]>`
        select id from categorization_rules
        where regexp_replace(coalesce(counterparty_tax_id, ''), '\D', '', 'g') = ${doc}`;

      if (jaExiste) {
        console.log(`     ${GREEN}já existe regra por documento para esse CNPJ${RESET}\n`);
        continue;
      }

      regrasNovas.push({
        entityId: cliente.entity_id,
        clientId: cliente.id,
        cliente: cliente.name,
        documento: doc,
        categoryId: conta.id,
        conta: `${conta.code} ${conta.name}`,
      });
      console.log(
        `     ${GREEN}vira regra por documento${RESET} → ${conta.code} ${conta.name}` +
          `  ${DIM}(segundo CNPJ do mesmo cliente)${RESET}\n`,
      );
      continue;
    }

    pendentes.push({ id: cliente.id, cliente: cliente.name, documento: doc });
    console.log(`     ${GREEN}vai receber o documento${RESET}\n`);
  }

  // ---------------------------------------------------------------------------
  // Pagadores — documento que paga por um cliente sem ser o documento dele
  // ---------------------------------------------------------------------------

  if (PAGADORES.length > 0) {
    console.log(`${BOLD}${PAGADORES.length} pagador(es) confirmado(s)${RESET}\n`);
  }

  for (const pag of PAGADORES) {
    console.log(`  ${BOLD}${pag.cliente}${RESET} ${DIM}← pago por ${pag.contraparte}${RESET}`);
    console.log(`     ${DIM}${pag.porque}${RESET}`);

    const [cliente] = await sql<{ id: string; name: string; entity_id: string }[]>`
      select id, name, entity_id from clients where name = ${pag.cliente}`;
    if (!cliente) {
      console.log(`     ${YELLOW}cliente “${pag.cliente}” não existe${RESET}\n`);
      continue;
    }

    const documentos = await sql<{ doc: string }[]>`
      select distinct regexp_replace(counterparty_tax_id, '\D', '', 'g') as doc
      from cash_entries
      where upper(coalesce(counterparty_name, '')) like ${pag.contraparte}
        and counterparty_tax_id is not null`;
    if (documentos.length !== 1) {
      console.log(
        `     ${YELLOW}${documentos.length} documento(s) no extrato para esse nome${RESET}\n`,
      );
      continue;
    }
    const doc = documentos[0]!.doc;

    const [conta] = await sql<{ id: string; code: string; name: string }[]>`
      select id, code, name from categories
      where code = ${pag.code} and entity_id = ${cliente.entity_id}`;
    if (!conta) {
      console.log(`     ${YELLOW}conta ${pag.code} não existe${RESET}\n`);
      continue;
    }

    /**
     * A correção do erro de 24/08: se este documento foi parar em `clients.tax_id`, ele sai
     * de lá. Um CPF nunca é a identidade de uma empresa, e um CNPJ de terceiro também não —
     * quem paga não é quem contrata.
     */
    const [usurpado] = await sql<{ id: string; name: string }[]>`
      select id, name from clients
      where entity_id = ${cliente.entity_id}
        and regexp_replace(coalesce(tax_id, ''), '\D', '', 'g') = ${doc}`;

    const [jaTemRegra] = await sql<{ id: string }[]>`
      select id from categorization_rules
      where entity_id = ${cliente.entity_id}
        and regexp_replace(coalesce(counterparty_tax_id, ''), '\D', '', 'g') = ${doc}`;

    if (jaTemRegra && !usurpado) {
      console.log(`     ${GREEN}já existe regra por documento${RESET}\n`);
      continue;
    }

    if (usurpado) {
      console.log(
        `     ${YELLOW}esse documento está em clients.tax_id de “${usurpado.name}” — vai sair de lá${RESET}`,
      );
    }
    console.log(
      `     ${GREEN}vira regra por documento${RESET} → ${conta.code} ${conta.name}` +
        `  ${DIM}(pagador, não identidade)${RESET}\n`,
    );

    pagadores.push({
      entityId: cliente.entity_id,
      clientId: cliente.id,
      cliente: cliente.name,
      documento: doc,
      categoryId: conta.id,
      conta: `${conta.code} ${conta.name}`,
      limparDe: usurpado?.id ?? null,
      jaTemRegra: !!jaTemRegra,
    });
  }

  // ---------------------------------------------------------------------------
  // Clientes novos
  // ---------------------------------------------------------------------------

  const novos: {
    entityId: string;
    nome: string;
    documento: string;
    categoryId: string;
    conta: string;
  }[] = [];

  if (NOVOS.length > 0) {
    console.log(`${BOLD}${NOVOS.length} cliente(s) novo(s) confirmado(s)${RESET}\n`);
  }

  for (const novo of NOVOS) {
    console.log(`  ${BOLD}${novo.nome}${RESET} ${DIM}← ${novo.contraparte}${RESET}`);
    console.log(`     ${DIM}${novo.porque}${RESET}`);

    const [existente] = await sql<{ id: string }[]>`
      select id from clients where name = ${novo.nome}`;
    if (existente) {
      console.log(
        `     ${YELLOW}já existe cliente com esse nome — use CONFIRMADOS, não crie outro${RESET}\n`,
      );
      continue;
    }

    const documentos = await sql<{ doc: string }[]>`
      select distinct regexp_replace(counterparty_tax_id, '\D', '', 'g') as doc
      from cash_entries
      where upper(coalesce(counterparty_name, '')) like ${novo.contraparte}
        and counterparty_tax_id is not null`;
    if (documentos.length !== 1) {
      console.log(
        `     ${YELLOW}${documentos.length} documento(s) no extrato para esse nome — não dá para criar${RESET}\n`,
      );
      continue;
    }
    const doc = documentos[0]!.doc;

    const [jaTem] = await sql<{ id: string }[]>`
      select id from clients
      where regexp_replace(coalesce(tax_id, ''), '\D', '', 'g') = ${doc}`;
    if (jaTem) {
      console.log(`     ${YELLOW}esse CNPJ já está em outro cliente${RESET}\n`);
      continue;
    }

    const [conta] = await sql<{ id: string; code: string; name: string; entity_id: string }[]>`
      select id, code, name, entity_id from categories
      where code = ${novo.code}
        and entity_id = (select id from entities where slug = 'dd-group')`;
    if (!conta) {
      console.log(`     ${YELLOW}conta ${novo.code} não existe no plano${RESET}\n`);
      continue;
    }

    novos.push({
      entityId: conta.entity_id,
      nome: novo.nome,
      documento: doc,
      categoryId: conta.id,
      conta: `${conta.code} ${conta.name}`,
    });
    console.log(
      `     ${GREEN}vai ser criado${RESET} com o documento do extrato → ${conta.code} ${conta.name}\n`,
    );
  }

  if (
    pendentes.length === 0 &&
    regrasNovas.length === 0 &&
    novos.length === 0 &&
    pagadores.length === 0
  ) {
    console.log(`${DIM}nada a fazer.${RESET}\n`);
  } else if (!APPLY) {
    console.log(
      `${DIM}nada foi gravado — ${pendentes.length} documentos, ${regrasNovas.length} regras,` +
        ` ${novos.length} cliente(s) novo(s) e ${pagadores.length} pagador(es).` +
        ` Rode com --aplicar.${RESET}\n`,
    );
  } else {
    await sql.begin(async (db) => {
      for (const item of pendentes) {
        await db`update clients set tax_id = ${item.documento} where id = ${item.id}`;
      }
      for (const pag of pagadores) {
        // Primeiro devolve a identidade: o documento de quem paga sai do cliente.
        if (pag.limparDe) {
          await db`update clients set tax_id = null where id = ${pag.limparDe}`;
        }
        if (pag.jaTemRegra) continue;
        await db`insert into categorization_rules ${db({
          entity_id: pag.entityId,
          priority: 50,
          match_type: "contains",
          pattern: "*",
          counterparty_tax_id: pag.documento,
          direction: "in",
          category_id: pag.categoryId,
          client_id: pag.clientId,
        })}`;
      }
      for (const novo of novos) {
        const [criado] = await db<{ id: string }[]>`
          insert into clients ${db({
            entity_id: novo.entityId,
            name: novo.nome,
            tax_id: novo.documento,
          })} returning id`;
        // Sem contrato não há de onde tirar a conta, então ela vem junto na regra.
        await db`insert into categorization_rules ${db({
          entity_id: novo.entityId,
          priority: 50,
          match_type: "contains",
          pattern: "*",
          counterparty_tax_id: novo.documento,
          direction: "in",
          category_id: novo.categoryId,
          client_id: criado!.id,
        })}`;
      }
      for (const regra of regrasNovas) {
        // `pattern: '*'` é a convenção do projeto para regra que casa por documento e
        // ignora a descrição — a mesma que o `propose-parties` grava.
        await db`insert into categorization_rules ${db({
          entity_id: regra.entityId,
          priority: 50,
          match_type: "contains",
          pattern: "*",
          counterparty_tax_id: regra.documento,
          category_id: regra.categoryId,
          client_id: regra.clientId,
        })}`;
      }
    });
    console.log(
      `${GREEN}${BOLD}${pendentes.length} clientes ganharam documento` +
        `${regrasNovas.length > 0 ? `, ${regrasNovas.length} regra(s) por documento criada(s)` : ""}` +
        `${novos.length > 0 ? `, ${novos.length} cliente(s) criado(s)` : ""}` +
        `${pagadores.length > 0 ? `, ${pagadores.length} pagador(es) virou regra` : ""}.${RESET}`,
    );
    console.log(
      `${DIM}Rode ${RESET}npm run propose:receipts${DIM} — a contraparte agora é reconhecida, e a\n` +
        `conta de receita sai junto quando os contratos do cliente apontam todos para a mesma.${RESET}\n`,
    );
  }
} finally {
  await sql.end();
}
