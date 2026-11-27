// "Baixar meus dados" (issue #20; LGPD art. 18, II e V). Regras puras: o formato que o banco
// devolve (`public.export_own_data`, ainda cifrado) e o arquivo que a pessoa recebe. A
// decifragem é injetada (o servidor passa src/server/crypto; os testes, um falso).
//
// O arquivo é para a própria pessoa ler: chaves em português e só dado legível. Fica de fora o
// que é interno ou de terceiros (o banco já não devolve): HMACs, ids de quem concedeu papel ou
// fez a ação, colegas de unidade. Também o próprio id interno, que não diz nada à pessoa.
import { z } from "zod";

/** Rota do download (POST do botão na página inicial). */
export const MY_DATA_PATH = "/meus-dados";
/** Parâmetro da página inicial que diz por que o download não saiu. */
export const MY_DATA_STATUS_PARAM = "dados";
export const myDataStatuses = ["limite", "erro"] as const;
export type MyDataStatus = (typeof myDataStatuses)[number];

/** Lê o parâmetro da página inicial; qualquer outro valor é ignorado. */
export function parseMyDataStatus(raw: unknown): MyDataStatus | null {
  return (myDataStatuses as readonly unknown[]).includes(raw) ? (raw as MyDataStatus) : null;
}

/** Versão do formato do arquivo. Mudou um campo? Suba a versão. */
export const exportFormatVersion = 8;

const timestamp = z.string().min(1);

/** O que `public.export_own_data()` devolve. */
export const ownDataRowsSchema = z.object({
  profile: z
    .object({
      display_name_enc: z.string(),
      municipality_code: z.number().int(),
      municipality_name: z.string().nullable(),
      state_code: z.string(),
      district_code: z.number().int().nullable(),
      district_name: z.string().nullable(),
      neighborhood_enc: z.string().nullable(),
      status: z.string(),
      access_status: z.string(),
      consent_version: z.string(),
      consent_at: timestamp.nullable(),
      created_at: timestamp,
      updated_at: timestamp,
    })
    .nullable(),
  contact: z
    .object({
      whatsapp_enc: z.string(),
      social_links_enc: z.string().nullable(),
      updated_at: timestamp,
    })
    .nullable(),
  memberships: z.array(
    z.object({
      unit_name: z.string(),
      unit_type: z.string(),
      member_role: z.string(),
      joined_at: timestamp,
      left_at: timestamp.nullable(),
    }),
  ),
  /** Vínculos de casa (ADR 0011, #132): a casa é a chave da config. */
  house_memberships: z.array(
    z.object({
      house_key: z.string(),
      join_method: z.string(),
      consent_version: z.string().nullable(),
      joined_at: timestamp,
      accepted_at: timestamp.nullable(),
      left_at: timestamp.nullable(),
    }),
  ),
  /** Aceites do termo do questionário (versão e data; nunca as respostas). */
  questionnaire_consents: z.array(z.object({ term_version: z.string(), consented_at: timestamp })),
  /**
   * Resultado do questionário (ADR 0014, #172): a casa sugerida e o totem (cifrado no banco, ADR
   * 0003; o servidor decifra aqui). O totem é interno e só aparece aqui (LGPD art. 18), nunca na
   * tela da casa. Nulo sem resultado (ou com análise aberta).
   */
  questionnaire_result: z
    .object({
      house_key: z.string(),
      /** Nulo enquanto o totem está pendente (empate só no totem, #197). */
      totem_enc: z.string().nullable(),
      /** `decided`, `pending` ou `undecided` (o pedido de totem venceu ou foi encerrado sem decisão). */
      totem_state: z.enum(["decided", "pending", "undecided"]),
      /** Notas dos 4 eixos (JSON cifrado, ADR 0003); nulo em resultado antigo, de antes da escala. */
      scores_enc: z.string().nullable(),
      term_version: z.string(),
      source: z.string(),
      created_at: timestamp,
    })
    .nullable(),
  /** Pedidos de análise do resultado inconclusivo; as respostas só existem com o pedido aberto. */
  house_analysis_requests: z.array(
    z.object({
      status: z.string(),
      resolution: z.string().nullable(),
      term_version: z.string(),
      tied_axes: z.array(z.string()),
      /** JSON das respostas, cifrado (ADR 0003); nulo depois de resolvido. */
      answers_enc: z.string().nullable(),
      created_at: timestamp,
      resolved_at: timestamp.nullable(),
    }),
  ),
  /** Concessões que a pessoa (gestor) recebeu da coordenação nacional para ver totem e pedidos do escopo dela. */
  questionnaire_access_grants: z.array(
    z.object({ unit_name: z.string(), unit_type: z.string(), granted_at: timestamp, revoked_at: timestamp.nullable() }),
  ),
  /** Aceites do termo de consentimento (#11): versão e data. */
  consent_acceptances: z.array(z.object({ version: z.string(), accepted_at: timestamp })),
  roles: z.array(
    z.object({
      role: z.string(),
      unit_name: z.string(),
      unit_type: z.string(),
      /** Só no papel de coordenador de casa. */
      house_key: z.string().nullable(),
      granted_at: timestamp,
      revoked_at: timestamp.nullable(),
    }),
  ),
  audit_events: z.array(
    z.object({
      event: z.string(),
      reason: z.string().nullable(),
      term_version: z.string().nullable(),
      house_key: z.string().nullable(),
      created_at: timestamp,
    }),
  ),
  /** Quem acessou o contato (#119, ADR 0010). O id serve só para decifrar o nome. */
  contact_views: z.array(
    z.object({
      viewer_id: z.string().nullable(),
      viewer_name_enc: z.string().nullable(),
      kind: z.string(),
      viewed_at: timestamp,
    }),
  ),
});

export type OwnDataRows = z.output<typeof ownDataRowsSchema>;

/** Onde o valor cifrado mora (vira o AAD da decifragem, ADR 0003 §3). */
export type CipherContext = { table: string; column: string; rowId: string };
export type DecryptFn = (value: string, context: CipherContext) => Promise<string>;

/** O arquivo entregue à pessoa. */
export type OwnDataExport = {
  sobre: { formato: number; geradoEm: string; descricao: string };
  conta: { emailDeLogin: string | null };
  perfil: {
    nome: string | null;
    municipio: { codigoIbge: number; nome: string | null; uf: string };
    distrito: { codigoIbge: number; nome: string | null } | null;
    bairro: string | null;
    situacaoDaConta: string;
    liberacaoDeAcesso: string;
    termoDeConsentimento: { versao: string | null; aceitoEm: string | null };
    criadoEm: string;
    atualizadoEm: string;
  } | null;
  contato: { whatsapp: string | null; redesSociais: string[] | null; atualizadoEm: string } | null;
  vinculos: { unidade: string; tipo: string; papelNoGrupo: string; entrouEm: string; saiuEm: string | null }[];
  /** Casas (ADR 0011): o nome vem da config; casa que saiu da config aparece pela chave. */
  casas: {
    casa: string;
    formaDeEntrada: string;
    versaoDoTermo: string | null;
    entrouEm: string;
    aceitaEm: string | null;
    saiuEm: string | null;
  }[];
  /** Aceites do termo do questionário das casas. */
  termosDeConsentimento: { versao: string; aceitoEm: string }[];
  termosDoQuestionario: { versao: string; aceitoEm: string }[];
  /** Casa sugerida e totem (ADR 0014). O totem é interno: só aparece neste arquivo. */
  resultadoDoQuestionario: {
    casaSugerida: string;
    /** Nulo se o valor cifrado não decifra (o resto do arquivo sai). */
    totem: string | null;
    /** Situação do totem: decided, pending (a coordenação vai decidir) ou undecided (pedido encerrado sem decisão). */
    situacaoDoTotem: "decided" | "pending" | "undecided";
    /** Nota de cada eixo, de -100 (muito polo "a") a 100 (muito polo "b"); nula sem notas. */
    notasPorEixo: { eixo1: number; eixo2: number; eixo3: number; eixo4: number } | null;
    versaoDoTermo: string;
    origem: string;
    em: string;
  } | null;
  /** Concessões recebidas da coordenação nacional (delegação do acesso ao totem e aos pedidos do escopo). */
  acessosDelegados: { unidade: string; tipo: string; concedidoEm: string; revogadoEm: string | null }[];
  /** Pedidos de análise do resultado inconclusivo; `respostas` só com o pedido aberto. */
  pedidosDeAnalise: {
    situacao: string;
    resolucao: string | null;
    versaoDoTermo: string;
    eixosEmpatados: string[];
    respostas: Record<string, number> | null;
    criadoEm: string;
    resolvidoEm: string | null;
  }[];
  papeis: {
    papel: string;
    unidade: string;
    tipo: string;
    casa: string | null;
    concedidoEm: string;
    revogadoEm: string | null;
  }[];
  /** Registros da auditoria sobre a pessoa e os eventos de casa e do termo feitos por ela (#132). */
  registrosSobreVoce: { evento: string; motivo: string | null; versaoDoTermo: string | null; casa: string | null; em: string }[];
  /**
   * Quem acessou o contato (#119, ADR 0010): o nome de quem viu (nulo se a conta foi excluída
   * ou o nome não decifra), qual contato e quando. Nunca o id de quem viu.
   */
  quemViuSeuContato: { quem: string | null; contato: string; em: string }[];
};

export type BuildExportInput = {
  rows: OwnDataRows;
  /** Id de quem pediu: só para o AAD da decifragem, não vai para o arquivo. */
  userId: string;
  /** E-mail de login, da sessão (não fica em tabela nossa). */
  loginEmail: string | null;
  generatedAt: Date;
  /** Texto do campo `sobre.descricao` (vem de config/, R17). */
  description: string;
  /** Nome de cada casa pela chave (vem de config/, R17). */
  houseNames: Readonly<Record<string, string>>;
  decrypt: DecryptFn;
  /** Chamado com o nome da coluna (nunca o valor) quando um campo não decifra. */
  onDecryptError?: (column: string, error: unknown) => void;
};

const socialLinks = z.array(z.string());
const answersJson = z.record(z.string(), z.number().int());
const axisScoresJson = z.strictObject({
  house1: z.number().int(),
  house2: z.number().int(),
  totem1: z.number().int(),
  totem2: z.number().int(),
});

/**
 * Monta o arquivo a partir do que o banco devolveu. Um valor que não decifra vira `null` (o
 * resto do arquivo sai), e quem chama registra só o nome da coluna.
 */
export async function buildOwnDataExport(input: BuildExportInput): Promise<OwnDataExport> {
  const { rows, userId: rowId, decrypt } = input;
  const open = async (value: string | null | undefined, table: string, column: string) => {
    if (value === null || value === undefined) return null;
    try {
      return await decrypt(value, { table, column, rowId });
    } catch (error) {
      input.onDecryptError?.(column, error);
      return null;
    }
  };

  // O nome de quem viu o contato é de outra linha de `profiles`: o AAD usa o id dela.
  const openAs = async (value: string, viewerId: string) => {
    try {
      return await decrypt(value, { table: "profiles", column: "display_name_enc", rowId: viewerId });
    } catch (error) {
      input.onDecryptError?.("viewer_name_enc", error);
      return null;
    }
  };

  // Respostas do pedido de análise: JSON cifrado; só existem com o pedido aberto.
  const openAnswers = async (value: string | null) => {
    const raw = await open(value, "house_analysis_requests", "answers_enc");
    if (raw === null) return null;
    try {
      return answersJson.parse(JSON.parse(raw));
    } catch (error) {
      input.onDecryptError?.("answers_enc", error);
      return null;
    }
  };

  // Notas dos eixos: JSON cifrado, nulo em resultado antigo (de antes da escala de intensidade).
  const openScores = async (value: string | null) => {
    const raw = await open(value, "questionnaire_results", "scores_enc");
    if (raw === null) return null;
    try {
      const scores = axisScoresJson.parse(JSON.parse(raw));
      return { eixo1: scores.house1, eixo2: scores.house2, eixo3: scores.totem1, eixo4: scores.totem2 };
    } catch (error) {
      input.onDecryptError?.("scores_enc", error);
      return null;
    }
  };

  const p = rows.profile;
  const c = rows.contact;
  const houseName = (key: string | null) => (key === null ? null : (input.houseNames[key] ?? key));
  let links: string[] | null = null;
  if (c?.social_links_enc) {
    const raw = await open(c.social_links_enc, "profile_contacts", "social_links_enc");
    if (raw !== null) {
      try {
        links = socialLinks.parse(JSON.parse(raw));
      } catch (error) {
        input.onDecryptError?.("social_links_enc", error);
      }
    }
  } else if (c) {
    links = [];
  }

  return {
    sobre: { formato: exportFormatVersion, geradoEm: input.generatedAt.toISOString(), descricao: input.description },
    conta: { emailDeLogin: input.loginEmail },
    perfil: p && {
      nome: await open(p.display_name_enc, "profiles", "display_name_enc"),
      municipio: { codigoIbge: p.municipality_code, nome: p.municipality_name, uf: p.state_code },
      distrito: p.district_code === null ? null : { codigoIbge: p.district_code, nome: p.district_name },
      bairro: await open(p.neighborhood_enc, "profiles", "neighborhood_enc"),
      situacaoDaConta: p.status,
      liberacaoDeAcesso: p.access_status,
      // `none` = ainda sem aceite (o perfil nasce assim; só o aceite, #11, avança).
      termoDeConsentimento: {
        versao: p.consent_version === "none" ? null : p.consent_version,
        aceitoEm: p.consent_version === "none" ? null : p.consent_at,
      },
      criadoEm: p.created_at,
      atualizadoEm: p.updated_at,
    },
    contato: c && {
      whatsapp: await open(c.whatsapp_enc, "profile_contacts", "whatsapp_enc"),
      redesSociais: links,
      atualizadoEm: c.updated_at,
    },
    vinculos: rows.memberships.map((m) => ({
      unidade: m.unit_name,
      tipo: m.unit_type,
      papelNoGrupo: m.member_role,
      entrouEm: m.joined_at,
      saiuEm: m.left_at,
    })),
    casas: rows.house_memberships.map((h) => ({
      casa: houseName(h.house_key) ?? h.house_key,
      formaDeEntrada: h.join_method,
      versaoDoTermo: h.consent_version,
      entrouEm: h.joined_at,
      aceitaEm: h.accepted_at,
      saiuEm: h.left_at,
    })),
    resultadoDoQuestionario: rows.questionnaire_result && {
      casaSugerida: houseName(rows.questionnaire_result.house_key) ?? rows.questionnaire_result.house_key,
      totem: await open(rows.questionnaire_result.totem_enc, "questionnaire_results", "totem_enc"),
      situacaoDoTotem: rows.questionnaire_result.totem_state,
      notasPorEixo: await openScores(rows.questionnaire_result.scores_enc),
      versaoDoTermo: rows.questionnaire_result.term_version,
      origem: rows.questionnaire_result.source,
      em: rows.questionnaire_result.created_at,
    },
    acessosDelegados: rows.questionnaire_access_grants.map((g) => ({
      unidade: g.unit_name,
      tipo: g.unit_type,
      concedidoEm: g.granted_at,
      revogadoEm: g.revoked_at,
    })),
    pedidosDeAnalise: await Promise.all(
      rows.house_analysis_requests.map(async (q) => ({
        situacao: q.status,
        resolucao: q.resolution,
        versaoDoTermo: q.term_version,
        eixosEmpatados: q.tied_axes,
        respostas: await openAnswers(q.answers_enc),
        criadoEm: q.created_at,
        resolvidoEm: q.resolved_at,
      })),
    ),
    termosDeConsentimento: rows.consent_acceptances.map((c) => ({ versao: c.version, aceitoEm: c.accepted_at })),
    termosDoQuestionario: rows.questionnaire_consents.map((q) => ({ versao: q.term_version, aceitoEm: q.consented_at })),
    papeis: rows.roles.map((r) => ({
      papel: r.role,
      unidade: r.unit_name,
      tipo: r.unit_type,
      casa: houseName(r.house_key),
      concedidoEm: r.granted_at,
      revogadoEm: r.revoked_at,
    })),
    registrosSobreVoce: rows.audit_events.map((e) => ({
      evento: e.event,
      motivo: e.reason,
      versaoDoTermo: e.term_version,
      casa: houseName(e.house_key),
      em: e.created_at,
    })),
    quemViuSeuContato: await Promise.all(
      rows.contact_views.map(async (v) => ({
        quem: v.viewer_id && v.viewer_name_enc ? await openAs(v.viewer_name_enc, v.viewer_id) : null,
        contato: v.kind,
        em: v.viewed_at,
      })),
    ),
  };
}

/** JSON legível (indentado), terminando em quebra de linha. */
export function serializeExport(data: OwnDataExport): string {
  return `${JSON.stringify(data, null, 2)}\n`;
}

/** `meus-dados-AAAA-MM-DD.json`, com a data de Brasília (não a do servidor). */
export function exportFilename(at: Date): string {
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
  return `meus-dados-${day}.json`;
}

/**
 * O pedido veio de uma página do próprio site? O botão é um POST de formulário; o cookie
 * `SameSite=Lax` já não vai em POST de outro site, e isto é a segunda barreira (como a checagem
 * de origem das server actions). Sem `Origin`, recusa.
 */
export function isSameOrigin(origin: string | null, siteUrl: string): boolean {
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(siteUrl).origin;
  } catch {
    return false;
  }
}
