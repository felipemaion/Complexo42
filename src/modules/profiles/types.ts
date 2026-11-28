import type { z } from "zod";
import type { accessStatuses, profileBackgroundInputSchema, profileContactInputSchema, profileInputSchema, profileStatuses } from "./domain/schema";
import type { AuthClient } from "@/server/auth/client";
import type { ProfileFormField } from "./domain/form";

/** Dados do perfil já validados, em texto (antes de cifrar no servidor). */
export type ProfileInput = z.output<typeof profileInputSchema>;

/** Contato já validado, em texto (antes de cifrar no servidor). */
export type ProfileContactInput = z.output<typeof profileContactInputSchema>;

/** Formação e atividade já validadas, em texto (antes de cifrar no servidor, #304). */
export type ProfileBackgroundInput = z.output<typeof profileBackgroundInputSchema>;

export type ProfileStatus = (typeof profileStatuses)[number];

/** Liberação pela lista de autorizados (ADR 0008 §1). */
export type AccessStatus = (typeof accessStatuses)[number];

/** O que o formulário mostra (e devolve preenchido depois de um erro): texto da própria pessoa. */
export type ProfileFormValues = {
  displayName: string;
  /** Como a pessoa digitou (com máscara), ou o número salvo já formatado. */
  whatsapp: string;
  /** Sigla da UF (só ajuda a carregar os municípios; o servidor ignora), ou "". */
  stateCode: string;
  /** Código IBGE em texto, ou "" se ainda não escolheu. */
  municipalityCode: string;
  /** Código IBGE do distrito (9 dígitos) em texto, ou "" (sem escolha). */
  district: string;
  /** Bairro como digitado (texto livre, opcional), ou "". */
  neighborhood: string;
  /** As caixas de link de rede (#17), como digitadas, ou os links salvos. */
  socialLinks: string[];
  /** Nível de formação (chave da lista fechada, #304), ou "" (sem resposta). */
  educationLevel: string;
  /** "Qual?" da formação, texto livre, ou "". */
  educationDetail: string;
  /** Atividade profissional, texto livre, ou "". */
  occupation: string;
};

/**
 * Resposta da server action do formulário. Nunca traz texto do banco nem dado de outra pessoa:
 * `duplicate_whatsapp` não diz de quem é o número; `too_many_attempts` (limite da #127) não diz
 * se o número tentado está livre ou não.
 */
export type ProfileFormState =
  | { status: "idle" }
  | { status: "invalid"; fields: ProfileFormField[]; badLinks?: number[]; values: ProfileFormValues }
  | { status: "duplicate_whatsapp"; values: ProfileFormValues }
  | { status: "too_many_attempts"; values: ProfileFormValues }
  | { status: "failed"; values: ProfileFormValues };

/** Resultado de gravar o perfil no servidor. */
export type SaveProfileResult =
  | { status: "saved" }
  | { status: "invalid"; fields: ProfileFormField[]; badLinks?: number[] }
  | { status: "duplicate_whatsapp" }
  | { status: "too_many_attempts" }
  | { status: "forbidden" }
  | { status: "failed" };

/** Município da lista de escolha. */
export type MunicipalityOption = { code: number; name: string };

/** Distrito da lista de escolha (código IBGE de 9 dígitos). */
export type DistrictOption = { code: number; name: string };

/** O próprio perfil, decifrado no servidor, para preencher o formulário. */
export type OwnProfile = {
  displayName: string;
  /** E.164 (`+5511912345678`). */
  whatsapp: string;
  municipalityCode: number;
  /** UF do município, derivada pelo banco. */
  stateCode: string;
  districtCode: number | null;
  /** Bairro decifrado, ou "" se não informou ou não abriu (ver `neighborhoodUnreadable`). */
  neighborhood: string;
  /** O bairro guardado existe mas não abriu: o formulário não o envia e o servidor o mantém. */
  neighborhoodUnreadable: boolean;
  /** Links de rede (#17), já normalizados (só os que abriram e passam na regra). */
  socialLinks: string[];
  /**
   * O valor guardado existe mas não abriu inteiro. O formulário não envia os links (o servidor
   * mantém o valor cifrado) até a pessoa pedir para substituí-los.
   */
  socialLinksUnreadable: boolean;
  /** Formação e atividade (#304), decifradas; "" se não informou ou não abriu (a pessoa preenche de novo). */
  educationLevel: string;
  educationDetail: string;
  occupation: string;
};

/**
 * O cliente do Supabase que este módulo usa: **o cliente do servidor com o JWT de quem está
 * logado** (R14), para a RLS e `app.can_edit_profile` valerem (R15). Nunca um cliente com
 * `service_role`. Só `rpc` e `from`; nos testes, um falso com o mesmo formato.
 */
export type ProfileDbClient = Pick<AuthClient, "rpc" | "from">;
