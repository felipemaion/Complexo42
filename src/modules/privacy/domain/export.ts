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
export const exportFormatVersion = 1;

const timestamp = z.string().min(1);

/** O que `public.export_own_data()` devolve. */
export const ownDataRowsSchema = z.object({
  profile: z
    .object({
      display_name_enc: z.string(),
      municipality_code: z.number().int(),
      municipality_name: z.string().nullable(),
      state_code: z.string(),
      district: z.string().nullable(),
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
  roles: z.array(
    z.object({
      role: z.string(),
      unit_name: z.string(),
      unit_type: z.string(),
      granted_at: timestamp,
      revoked_at: timestamp.nullable(),
    }),
  ),
  audit_events: z.array(
    z.object({
      event: z.string(),
      reason: z.string().nullable(),
      created_at: timestamp,
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
    distrito: string | null;
    situacaoDaConta: string;
    liberacaoDeAcesso: string;
    termoDeConsentimento: { versao: string | null; aceitoEm: string | null };
    criadoEm: string;
    atualizadoEm: string;
  } | null;
  contato: { whatsapp: string | null; redesSociais: string[] | null; atualizadoEm: string } | null;
  vinculos: { unidade: string; tipo: string; papelNoGrupo: string; entrouEm: string; saiuEm: string | null }[];
  papeis: { papel: string; unidade: string; tipo: string; concedidoEm: string; revogadoEm: string | null }[];
  /**
   * Registros da auditoria sobre a pessoa. Quem acessou o contato (ADR 0010) entra com a #119:
   * ela acrescenta aqui o que mostrar de quem viu, sem mudar o resto do formato.
   */
  registrosSobreVoce: { evento: string; motivo: string | null; em: string }[];
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
  decrypt: DecryptFn;
  /** Chamado com o nome da coluna (nunca o valor) quando um campo não decifra. */
  onDecryptError?: (column: string, error: unknown) => void;
};

const socialLinks = z.array(z.string());

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

  const p = rows.profile;
  const c = rows.contact;
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
      distrito: p.district,
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
    papeis: rows.roles.map((r) => ({
      papel: r.role,
      unidade: r.unit_name,
      tipo: r.unit_type,
      concedidoEm: r.granted_at,
      revogadoEm: r.revoked_at,
    })),
    registrosSobreVoce: rows.audit_events.map((e) => ({ evento: e.event, motivo: e.reason, em: e.created_at })),
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
