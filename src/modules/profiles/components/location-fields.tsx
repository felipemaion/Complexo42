"use client";

import { useRef, useState, type ReactNode } from "react";
import type { StateOption } from "@config/states";
import {
  filterMunicipalities,
  hasDistrictChoice,
  patchOnMunicipalityChange,
  patchOnStateChange,
  type LocationPatch,
} from "../domain/localities";
import type { DistrictOption, MunicipalityOption, ProfileFormValues } from "../types";

// Localização do perfil em três passos (issue #175): estado → cidade (com busca) → distrito.
// A lista de cidades vem por UF, de uma server action: o navegador nunca recebe as 5.570 de uma
// vez. O distrito só aparece onde há mais de um. Só apresentação e eventos.

export type LocationText = {
  stateLabel: string;
  statePlaceholder: string;
  municipalitySearchLabel: string;
  municipalitySearchHint: string;
  municipalityNoMatch: string;
  municipalityLabel: string;
  municipalityPlaceholder: string;
  localitiesLoading: string;
  localitiesFailed: string;
  districtLabel: string;
  districtHint: string;
  districtNone: string;
};

type LocationValues = Pick<ProfileFormValues, "stateCode" | "municipalityCode" | "district">;

type Props = {
  values: LocationValues;
  onChange: (patch: LocationPatch) => void;
  states: readonly StateOption[];
  /** Listas já carregadas no servidor para quem tem perfil salvo; vazias para quem começa agora. */
  initialMunicipalities: readonly MunicipalityOption[];
  initialDistricts: readonly DistrictOption[];
  loadMunicipalities: (stateCode: string) => Promise<MunicipalityOption[]>;
  loadDistricts: (municipalityCode: number) => Promise<DistrictOption[]>;
  text: LocationText;
  ids: { state: string; municipalitySearch: string; municipality: string; district: string };
  inputClass: string;
  /** `aria-describedby` e mensagem de erro dos campos que o servidor valida (mesmos do formulário). */
  describedBy: (field: "municipalityCode" | "district", hasHint: boolean) => string | undefined;
  errorText: (field: "municipalityCode" | "district") => ReactNode;
  isInvalid: (field: "municipalityCode" | "district") => boolean;
};

type LoadStatus = "idle" | "loading" | "failed";

export function LocationFields({
  values,
  onChange,
  states,
  initialMunicipalities,
  initialDistricts,
  loadMunicipalities,
  loadDistricts,
  text,
  ids,
  inputClass,
  describedBy,
  errorText,
  isInvalid,
}: Props) {
  const [municipalities, setMunicipalities] = useState<readonly MunicipalityOption[]>(initialMunicipalities);
  const [districts, setDistricts] = useState<readonly DistrictOption[]>(initialDistricts);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<LoadStatus>("idle");
  // Só a última carga vale: trocar de estado depressa não deixa a lista antiga chegar por cima.
  const latestRequest = useRef(0);

  async function load<T>(request: () => Promise<T>, apply: (result: T) => void) {
    const requestId = ++latestRequest.current;
    setStatus("loading");
    try {
      const result = await request();
      if (requestId !== latestRequest.current) return;
      apply(result);
      setStatus("idle");
    } catch {
      // O erro técnico fica no servidor; aqui a pessoa vê o aviso e pode tentar de novo.
      if (requestId === latestRequest.current) setStatus("failed");
    }
  }

  function chooseState(stateCode: string) {
    onChange(patchOnStateChange(stateCode));
    setSearch("");
    setMunicipalities([]);
    setDistricts([]);
    if (stateCode === "") {
      latestRequest.current++;
      setStatus("idle");
      return;
    }
    void load(() => loadMunicipalities(stateCode), setMunicipalities);
  }

  function chooseMunicipality(municipalityCode: string) {
    onChange(patchOnMunicipalityChange(municipalityCode));
    setDistricts([]);
    if (municipalityCode === "") {
      latestRequest.current++;
      setStatus("idle");
      return;
    }
    void load(() => loadDistricts(Number(municipalityCode)), setDistricts);
  }

  const selectedCode = values.municipalityCode === "" ? null : Number(values.municipalityCode);
  const visibleMunicipalities = filterMunicipalities(municipalities, search, selectedCode);
  const hasMatches = visibleMunicipalities.length > 0;
  const noStateYet = values.stateCode === "";

  return (
    <>
      <div className="flex flex-col gap-2">
        <label htmlFor={ids.state} className="text-lg font-semibold">
          {text.stateLabel}
        </label>
        <select
          id={ids.state}
          name="stateCode"
          value={values.stateCode}
          onChange={(event) => chooseState(event.target.value)}
          className={inputClass}
        >
          <option value="">{text.statePlaceholder}</option>
          {states.map((state) => (
            <option key={state.code} value={state.code}>
              {state.name}
            </option>
          ))}
        </select>
      </div>

      {/* Sempre na tela (o erro do formulário aponta para ela), mas só se usa depois do estado. */}
      <div className="flex flex-col gap-2">
        <label htmlFor={ids.municipalitySearch} className="text-lg font-semibold">
          {text.municipalitySearchLabel}
        </label>
        <p id={`${ids.municipalitySearch}-dica`} className="text-base text-ink-muted">
          {text.municipalitySearchHint}
        </p>
        <input
          id={ids.municipalitySearch}
          type="search"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={80}
          disabled={noStateYet}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          aria-describedby={`${ids.municipalitySearch}-dica`}
          className={inputClass}
        />
        <label htmlFor={ids.municipality} className="text-lg font-semibold">
          {text.municipalityLabel}
        </label>
        <select
          id={ids.municipality}
          name="municipalityCode"
          required
          disabled={noStateYet}
          value={values.municipalityCode}
          onChange={(event) => chooseMunicipality(event.target.value)}
          aria-invalid={isInvalid("municipalityCode")}
          aria-describedby={describedBy("municipalityCode", false)}
          className={inputClass}
        >
          <option value="">{text.municipalityPlaceholder}</option>
          {visibleMunicipalities.map((municipality) => (
            <option key={municipality.code} value={String(municipality.code)}>
              {municipality.name}
            </option>
          ))}
        </select>
        {status === "idle" && municipalities.length > 0 && !hasMatches && (
          <p role="status" className="text-lg">
            {text.municipalityNoMatch}
          </p>
        )}
        {errorText("municipalityCode")}
      </div>

      <p role="status" className="text-lg">
        {status === "loading" ? text.localitiesLoading : status === "failed" ? text.localitiesFailed : null}
      </p>

      {hasDistrictChoice(districts) && (
        <div className="flex flex-col gap-2">
          <label htmlFor={ids.district} className="text-lg font-semibold">
            {text.districtLabel}
          </label>
          <p id={`${ids.district}-dica`} className="text-base text-ink-muted">
            {text.districtHint}
          </p>
          <select
            id={ids.district}
            name="district"
            value={values.district}
            onChange={(event) => onChange({ district: event.target.value })}
            aria-invalid={isInvalid("district")}
            aria-describedby={describedBy("district", true)}
            className={inputClass}
          >
            <option value="">{text.districtNone}</option>
            {districts.map((district) => (
              <option key={district.code} value={String(district.code)}>
                {district.name}
              </option>
            ))}
          </select>
          {errorText("district")}
        </div>
      )}
    </>
  );
}
