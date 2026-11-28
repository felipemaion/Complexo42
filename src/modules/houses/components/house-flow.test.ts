// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { instance } from "@config/instance";
import example from "@config/questionnaire.example.json";
import { parseQuestionnaire, toPublicQuestionnaire } from "@/modules/questionnaire";

const actions = vi.hoisted(() => ({
  recordConsentAction: vi.fn(),
  submitAnswersAction: vi.fn(),
  acceptHouseAction: vi.fn(),
}));
vi.mock("../server/actions", () => actions);
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));

import { HouseFlow } from "./house-flow";

// #315: um deploy troca o app no meio do questionário e o Next recusa a Server Action antiga
// ("Failed to find Server Action"): a promessa REJEITA. A tela nunca pode ficar em "Calculando".
const text = instance.houseSelection;
const questionnaire = toPublicQuestionnaire(parseQuestionnaire(example, instance.houses.map((house) => house.id)));
const outdated = () => Promise.reject(new Error('Failed to find Server Action "abc". This request might be from an older or newer deployment.'));

const mount = () => render(createElement(HouseFlow, { houses: instance.houses, questionnaire, text }));
const click = (name: string) => fireEvent.click(screen.getByRole("button", { name }));

async function answerEverything() {
  click(text.consentAccept);
  for (let i = 0; i < questionnaire.items.length; i++) {
    const circles = await screen.findAllByRole("radio");
    fireEvent.click(circles[0]!);
    click(i === questionnaire.items.length - 1 ? text.finishButton : text.nextButton);
  }
}

describe("HouseFlow com a Server Action rejeitada (#315)", () => {
  beforeEach(() => {
    actions.recordConsentAction.mockResolvedValue({ ok: true });
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("envio das respostas rejeitado: sai do 'Calculando' e mostra o aviso de recarregar", async () => {
    actions.submitAnswersAction.mockImplementation(outdated);
    mount();
    await answerEverything();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(text.errors.app_updated);
    expect(screen.queryByText(text.submitting)).toBeNull();
    // Fica na última pergunta, com a resposta marcada, e dá para enviar de novo.
    expect(screen.getByTestId("question-progress").textContent).toContain(String(questionnaire.items.length));
  });

  it("termo (consentimento) rejeitado: mostra o aviso e continua no termo", async () => {
    actions.recordConsentAction.mockImplementation(outdated);
    mount();
    click(text.consentAccept);
    expect((await screen.findByRole("alert")).textContent).toBe(text.errors.app_updated);
    expect(screen.getByTestId("consent-term")).toBeTruthy();
  });

  it("aceite da casa rejeitado: mostra o aviso e o botão volta a funcionar", async () => {
    actions.acceptHouseAction.mockImplementation(outdated);
    mount();
    click(text.consentDecline);
    fireEvent.click(screen.getAllByRole("button", { name: instance.houses[0]!.activities[0]! })[0]!);
    click(text.acceptButton);
    expect((await screen.findByRole("alert")).textContent).toBe(text.errors.app_updated);
    await waitFor(() => expect((screen.getByRole("button", { name: text.acceptButton }) as HTMLButtonElement).disabled).toBe(false));
  });
});
