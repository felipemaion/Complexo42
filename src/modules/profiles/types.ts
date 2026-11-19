import type { z } from "zod";
import type { accessStatuses, profileContactInputSchema, profileInputSchema, profileStatuses } from "./domain/schema";
import type { AuthClient } from "@/server/auth/client";
import type { ProfileFormField } from "./domain/form";

/** Dados do perfil já validados, em texto (antes de cifrar no servidor). */
export type ProfileInput = z.output<typeof profileInputSchema>;

/** Contato já validado, em texto (antes de cifrar no servidor). */
export type ProfileContactInput = z.output<typeof profileContactInputSchema>;

export type ProfileStatus = (typeof profileStatuses)[number];

/** Liberação pela lista de autorizados (ADR 0008 §1). */
export type AccessStatus = (typeof accessStatuses)[number];

/** O que o formulário mostra (e devolve preenchido depois de um erro): texto da própria pessoa. */
export type ProfileFormValues = {
  displayName: string;
  /** Como a pessoa digitou (com máscara), ou o número salvo já formatado. */
  whatsapp: string;
  /** Código IBGE em texto, ou "" se ainda não escolheu. */
  municipalityCode: string;
  district: string;
};

/**
 * Resposta da server action do formulário. Nunca traz texto do banco nem dado de outra pessoa:
 * `duplicate_whatsapp` não diz de quem é o número.
 */
export type ProfileFormState =
  | { status: "idle" }
  | { status: "invalid"; fields: ProfileFormField[]; values: ProfileFormValues }
  | { status: "duplicate_whatsapp"; values: ProfileFormValues }
  | { status: "failed"; values: ProfileFormValues };

/** Resultado de gravar o perfil no servidor. */
export type SaveProfileResult =
  | { status: "saved" }
  | { status: "invalid"; fields: ProfileFormField[] }
  | { status: "duplicate_whatsapp" }
  | { status: "forbidden" }
  | { status: "failed" };

/** Município da lista de escolha. */
export type MunicipalityOption = { code: number; name: string };

/** O próprio perfil, decifrado no servidor, para preencher o formulário. */
export type OwnProfile = {
  displayName: string;
  /** E.164 (`+5511912345678`). */
  whatsapp: string;
  municipalityCode: number;
  district: string | null;
};

/**
 * O cliente do Supabase que este módulo usa: **o cliente do servidor com o JWT de quem está
 * logado** (R14), para a RLS e `app.can_edit_profile` valerem (R15). Nunca um cliente com
 * `service_role`. Só `rpc` e `from`; nos testes, um falso com o mesmo formato.
 */
export type ProfileDbClient = Pick<AuthClient, "rpc" | "from">;
