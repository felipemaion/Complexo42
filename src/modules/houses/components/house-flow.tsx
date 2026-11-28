"use client";
// Tela da escolha da casa (#76, ADR 0008 §2 e §2.1). Só apresentação e eventos: a lógica do
// fluxo está em domain/flow.ts, e quem fala com o banco são as server actions.
//
// Privacidade: as respostas do questionário ficam só no estado deste componente, em memória.
// Não vão para o localStorage/sessionStorage nem para a URL. Ao fim das perguntas vão ao
// servidor, que pontua com a chave real (que o navegador nunca recebe, ADR 0014 §1) e só as
// guarda no pedido de análise do resultado inconclusivo. O navegador não manda casa nem totem.
// tests/house-privacy.test.ts e e2e/house-live.spec.ts conferem.
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import type { InstanceConfig } from "@/modules/instance";
import { IntensityScale } from "@/modules/questionnaire/components/intensity-scale";
import { SpiderChart } from "@/modules/questionnaire/components/spider-chart";
import type { ChartAxis, HouseByPoles, PublicQuestionnaire } from "@/modules/questionnaire";
import { changeHouseFlow, formatProgress, initialFlow, nextFlow, type FlowContext, type FlowEvent, type FlowState } from "../domain/flow";
import { guardAction } from "../domain/guard-action";
import { refusalMessage } from "../domain/refusal";
import { acceptHouseAction, recordConsentAction, submitAnswersAction } from "../server/actions";
import type { HouseErrorCode } from "../types";
import { CompareHouses } from "./compare-houses";
import { HousePresentation, type HouseView } from "./house-presentation";
import { buttonClass, cardClass, noticeClass } from "@/modules/ui";

type Props = {
  houses: readonly HouseView[];
  questionnaire: PublicQuestionnaire;
  text: InstanceConfig["houseSelection"];
  /**
   * Troca de casa depois do prazo (ADR 0016, #268): começa na comparação das casas, com a casa atual em destaque. O servidor
   * monta o resto do que está guardado (sugerida, perfil, token selado); o navegador não manda respostas.
   */
  change?: { currentId: string; suggestedId?: string; chart?: readonly ChartAxis[]; byPoles?: HouseByPoles; compareToken?: string };
};

// Botões pelos tokens (#324): voltar pequeno no topo, alternativas largas e as ações lado a lado no computador.
const backClass = `${buttonClass("secondary")} self-start`;
const choice = buttonClass("choice", "lg");
const primary = `${buttonClass("primary", "lg")} sm:flex-1`;
const secondary = `${buttonClass("secondary", "lg")} sm:flex-1`;
const actions = "flex flex-col gap-3 sm:flex-row";

export function HouseFlow({ houses, questionnaire, text, change }: Readonly<Props>) {
  const router = useRouter();
  const [state, setState] = useState<FlowState>(() => (change ? changeHouseFlow(change) : initialFlow));
  const [error, setError] = useState<HouseErrorCode | null>(null);
  const [pending, startTransition] = useTransition();

  const ctx = useMemo<FlowContext>(
    () => ({ questionIds: questionnaire.items.map((item) => item.id) }),
    [questionnaire],
  );
  const dispatch = (event: FlowEvent) => {
    setError(null);
    setState((current) => nextFlow(current, event, ctx));
  };

  const acceptConsent = () =>
    startTransition(async () => {
      const result = await guardAction(() => recordConsentAction({ termVersion: questionnaire.consentTermVersion }));
      if (result.ok) dispatch({ type: "consent_accepted" });
      else setError(result.error);
    });

  // Depois da última pergunta as respostas vão ao servidor, que pontua e grava o resultado. A
  // ação é idempotente, então repetir o efeito (modo estrito do React) não duplica nada.
  const { step } = state;
  const answers = state.answers;
  useEffect(() => {
    if (step.kind !== "submit") return;
    let cancelled = false;
    void (async () => {
      const response = await guardAction(() => submitAnswersAction({ answers }));
      if (cancelled) return;
      // A recusa vai no estado do fluxo (#199): setError e dispatch na mesma hora apagariam o motivo.
      if (!response.ok) dispatch({ type: "submit_failed", error: response.error, retryAfterSeconds: response.retryAfterSeconds });
      else dispatch({ type: "result_recorded", houseId: response.houseId, chart: response.chart, byPoles: response.byPoles, compareToken: response.compareToken });
    })();
    return () => {
      cancelled = true;
    };
    // `dispatch` só troca o estado; o efeito roda uma vez por entrada no passo "submit".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const acceptHouse = (houseId: string, joinMethod: "self" | "questionnaire") =>
    startTransition(async () => {
      const result = await guardAction(() => acceptHouseAction({ houseId, joinMethod }));
      if (result.ok) {
        router.replace("/casa");
        router.refresh();
      } else setError(result.error);
    });

  const back = (
    <button type="button" className={backClass} onClick={() => dispatch({ type: "back" })} disabled={pending}>
      ← {text.backButton}
    </button>
  );

  let body: React.ReactNode;
  switch (step.kind) {
    case "activities":
      body = (
        <>
          {back}
          <h2 className="text-2xl font-bold sm:text-3xl">{text.activitiesTitle}</h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {houses.flatMap((house) =>
              house.activities.map((activity) => (
                <li key={activity}>
                  <button
                    type="button"
                    className={`${choice} h-full`}
                    onClick={() => dispatch({ type: "activity_chosen", houseId: house.id })}
                  >
                    {activity}
                  </button>
                </li>
              )),
            )}
          </ul>
        </>
      );
      break;
    case "consent":
      body = (
        <>
          {back}
          <h2 className="text-2xl font-bold sm:text-3xl">{text.consentTitle}</h2>
          <p className="max-w-prose whitespace-pre-line text-lg" data-testid="consent-term">
            {questionnaire.consentTerm}
          </p>
          {/* O aviso é texto da tela (config), junto ao botão; o termo vem da config privada e não muda. */}
          <p className={noticeClass("info")} data-testid="consent-stored-notice">
            {text.consentStoredNotice}
          </p>
          <div className={actions}>
            <button type="button" className={primary} onClick={acceptConsent} disabled={pending}>
              {text.consentAccept}
            </button>
            <button type="button" className={secondary} onClick={() => dispatch({ type: "consent_declined" })} disabled={pending}>
              {text.consentDecline}
            </button>
          </div>
        </>
      );
      break;
    case "question": {
      const item = questionnaire.items[step.index]!;
      const chosen = state.answers[item.id];
      const isLast = step.index === questionnaire.items.length - 1;
      body = (
        <>
          {back}
          <p className="text-base font-semibold text-ink-muted" data-testid="question-progress">
            {formatProgress(text.progress, step.index + 1, questionnaire.items.length)}
          </p>
          {/* Pergunta grande e centralizada; a escala embaixo, com largura limitada (#324). */}
          <h2 className="mx-auto max-w-prose text-center text-2xl font-bold sm:text-3xl">{item.text}</h2>
          {/* `key`: cada pergunta começa com a escala vazia e o foco no começo. */}
          <IntensityScale
            key={item.id}
            legend={text.scaleLegend}
            intensities={text.scaleIntensities}
            poleA={item.a.text}
            poleB={item.b.text}
            value={chosen}
            onChange={(value) => dispatch({ type: "answer", value })}
          />
          <button type="button" className={`${buttonClass("primary", "lg")} mx-auto sm:max-w-sm`} onClick={() => dispatch({ type: "next" })} disabled={chosen === undefined}>
            {isLast ? text.finishButton : text.nextButton}
          </button>
        </>
      );
      break;
    }
    case "submit":
      body = (
        <p className="text-lg font-semibold" role="status">
          {text.submitting}
        </p>
      );
      break;
    case "compare":
      body = (
        <CompareHouses
          houses={houses}
          suggestedId={step.suggestedId}
          currentId={step.currentId}
          selectedId={step.selectedId}
          chart={step.chart}
          byPoles={step.byPoles}
          compareToken={step.compareToken}
          text={text}
          disabled={pending}
          onSelect={(houseId) => dispatch({ type: "house_selected", houseId })}
          onConfirm={() => dispatch({ type: "house_confirmed" })}
          // Na troca de casa a comparação é a primeira tela: voltar leva à página da casa atual.
          onBack={() => (step.currentId === undefined ? dispatch({ type: "back" }) : router.replace("/casa"))}
        />
      );
      break;
    case "presentation": {
      const house = houses.find((h) => h.id === step.houseId);
      body = (
        <>
          {back}
          {step.chart && step.chart.length > 0 && (
            <section className="flex flex-col gap-2" aria-labelledby="profile-chart-title">
              <h2 id="profile-chart-title" className="text-2xl font-bold">
                {text.chartTitle}
              </h2>
              <SpiderChart
                chart={step.chart}
                title={text.chartTitle}
                houses={
                  step.byPoles && {
                    byPoles: step.byPoles,
                    houses,
                    currentHouseId: step.houseId,
                    currentLabel: text.chartCurrentHouse,
                  }
                }
              />
            </section>
          )}
          {house && (
            <HousePresentation
              house={house}
              title={step.method === "questionnaire" ? text.suggestedTitle : text.chosenTitle}
              firstStepsTitle={text.firstStepsTitle}
              videosTitle={text.videosTitle}
            />
          )}
          <div className={actions}>
            <button
              type="button"
              className={primary}
              onClick={() => acceptHouse(step.houseId, step.method)}
              disabled={pending || !house}
            >
              {text.acceptButton}
            </button>
            <button type="button" className={secondary} onClick={() => dispatch({ type: "choose_other" })} disabled={pending}>
              {text.chooseOtherButton}
            </button>
          </div>
        </>
      );
      break;
    }
  }

  return (
    <div className={cardClass()}>
      {body}
      {(state.refusal || error) && (
        <p role="alert" className={noticeClass("error")} data-testid="refusal-message">
          {state.refusal ? refusalMessage(text, state.refusal) : text.errors[error!]}
        </p>
      )}
    </div>
  );
}
