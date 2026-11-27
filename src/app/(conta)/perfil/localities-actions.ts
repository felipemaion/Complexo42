"use server";
// Leitura da referência de localidades para o formulário do perfil (#175): as cidades de uma UF e
// os distritos de uma cidade. Só composição: sessão (requireUserClient, com o JWT da pessoa) +
// serviço do módulo de perfis. A RLS de `municipalities` e `districts` continua valendo.
import { listDistricts, listMunicipalitiesByState, type DistrictOption, type MunicipalityOption } from "@/modules/profiles";
import { requireUserClient } from "@/server/auth/session";

export async function loadMunicipalitiesAction(stateCode: string): Promise<MunicipalityOption[]> {
  const { client } = await requireUserClient();
  return listMunicipalitiesByState(client, stateCode);
}

export async function loadDistrictsAction(municipalityCode: number): Promise<DistrictOption[]> {
  const { client } = await requireUserClient();
  return listDistricts(client, municipalityCode);
}
