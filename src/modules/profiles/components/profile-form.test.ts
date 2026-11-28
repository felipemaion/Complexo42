// @vitest-environment jsdom
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { instance } from "@config/instance";
import { states } from "@config/states";
import type { ProfileFormState, ProfileFormValues } from "../types";
import { ProfileForm } from "./profile-form";

// #349: depois de um envio com erro, a resposta devolvia aos campos os valores ENVIADOS. Quem continuava digitando
// antes de a resposta chegar (celular lento) via o texto voltar ao que enviou e perdia a edição.
const empty: ProfileFormValues = {
  displayName: "",
  whatsapp: "",
  stateCode: "",
  municipalityCode: "",
  district: "",
  neighborhood: "",
  socialLinks: [],
  educationLevel: "",
  educationDetail: "",
  occupation: "",
};
const text = instance.profile;

function mount(action: (previous: ProfileFormState, data: FormData) => Promise<ProfileFormState>) {
  return render(
    createElement(ProfileForm, {
      action,
      initial: empty,
      states,
      initialMunicipalities: [],
      initialDistricts: [],
      loadMunicipalities: async () => [],
      loadDistricts: async () => [],
      text,
    }),
  );
}

/** Uma action que só responde quando o teste manda, como uma rede lenta. */
function slowAction() {
  let answer: (state: ProfileFormState) => void = () => undefined;
  const action = vi.fn(() => new Promise<ProfileFormState>((resolve) => (answer = resolve)));
  return { action, answer: (state: ProfileFormState) => act(async () => answer(state)) };
}

afterEach(cleanup);

describe("ProfileForm com resposta atrasada (#349)", () => {
  it("quem edita depois de enviar não perde a edição quando a resposta com erro chega", async () => {
    const { action, answer } = slowAction();
    mount(action);
    const name = screen.getByLabelText(text.nameLabel) as HTMLInputElement;
    fireEvent.change(name, { target: { value: "Maria" } });
    await act(async () => fireEvent.submit(name.form!));
    // A resposta ainda não chegou: a pessoa corrige o nome.
    fireEvent.change(name, { target: { value: "Maria Souza" } });
    await answer({ status: "invalid", fields: ["displayName"], values: { ...empty, displayName: "Maria" } });
    expect(name.value).toBe("Maria Souza");
  });

  it("sem edição depois de enviar, a resposta com erro devolve os valores do servidor", async () => {
    const { action, answer } = slowAction();
    mount(action);
    const name = screen.getByLabelText(text.nameLabel) as HTMLInputElement;
    fireEvent.change(name, { target: { value: "  Maria  " } });
    await act(async () => fireEvent.submit(name.form!));
    await answer({ status: "invalid", fields: ["displayName"], values: { ...empty, displayName: "Maria" } });
    expect(name.value).toBe("Maria");
  });
});
