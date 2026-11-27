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
import type { PublicQuestionnaire } from "@/modules/questionnaire";
import { formatProgress, initialFlow, nextFlow, type FlowContext, type FlowEvent } from "../domain/flow";
import { acceptHouseAction, recordConsentAction, submitAnswersAction } from "../server/actions";
import type { HouseErrorCode } from "../types";
import { HousePresentation, type HouseView } from "./house-presentation";

type Props = {
  houses: readonly HouseView[];
  questionnaire: PublicQuestionnaire;
  text: InstanceConfig["houseSelection"];
};

const big = "min-h-14 w-full rounded-xl border-2 border-current px-5 py-3 text-left text-lg font-semibold";
const primary =
  "min-h-14 w-full rounded-xl bg-[var(--color-primary)] px-5 py-3 text-lg font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40";

export function HouseFlow({ houses, questionnaire, text }: Readonly<Props>) {
  const router = useRouter();
  const [state, setState] = useState(initialFlow);
  const [error, setError] = useState<HouseErrorCode | null>(null);
  const [pending, startTransition] = useTransition();

  const ctx = useMemo<FlowContext>(
    () => ({ itemIds: questionnaire.items.map((item) => item.id) }),
    [questionnaire],
  );
  const dispatch = (event: FlowEvent) => {
    setError(null);
    setState((current) => nextFlow(current, event, ctx));
  };

  const acceptConsent = () =>
    startTransition(async () => {
      const result = await recordConsentAction({ termVersion: questionnaire.consentTermVersion });
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
      const response = await submitAnswersAction({ answers });
      if (cancelled) return;
      if (!response.ok) {
        setError(response.error);
        dispatch({ type: "submit_failed" });
      } else if (response.outcome === "recorded") dispatch({ type: "result_recorded", houseId: response.houseId, chart: response.chart });
      else dispatch({ type: "analysis_requested" });
    })();
    return () => {
      cancelled = true;
    };
    // `dispatch` só troca o estado; o efeito roda uma vez por entrada no passo "submit".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const acceptHouse = (houseId: string, joinMethod: "self" | "questionnaire") =>
    startTransition(async () => {
      const result = await acceptHouseAction({ houseId, joinMethod });
      if (result.ok) router.refresh();
      else setError(result.error);
    });

  const back = (
    <button type="button" className={big} onClick={() => dispatch({ type: "back" })} disabled={pending}>
      ← {text.backButton}
    </button>
  );

  let body: React.ReactNode;
  switch (step.kind) {
    case "ask":
      body = (
        <>
          <h2 className="text-2xl font-bold">{text.knowsQuestion}</h2>
          <button type="button" className={big} onClick={() => dispatch({ type: "knows", value: true })}>
            {text.knowsYes}
          </button>
          <button type="button" className={big} onClick={() => dispatch({ type: "knows", value: false })}>
            {text.knowsNo}
          </button>
        </>
      );
      break;
    case "activities":
      body = (
        <>
          {back}
          <h2 className="text-2xl font-bold">{text.activitiesTitle}</h2>
          <ul className="flex flex-col gap-3">
            {houses.flatMap((house) =>
              house.activities.map((activity) => (
                <li key={activity}>
                  <button
                    type="button"
                    className={big}
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
          <h2 className="text-2xl font-bold">{text.consentTitle}</h2>
          <p className="whitespace-pre-line text-lg" data-testid="consent-term">
            {questionnaire.consentTerm}
          </p>
          <button type="button" className={primary} onClick={acceptConsent} disabled={pending}>
            {text.consentAccept}
          </button>
          <button type="button" className={big} onClick={() => dispatch({ type: "consent_declined" })} disabled={pending}>
            {text.consentDecline}
          </button>
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
          <p className="text-lg font-semibold" data-testid="question-progress">
            {formatProgress(text.progress, step.index + 1, questionnaire.items.length)}
          </p>
          <h2 className="text-2xl font-bold">{item.text}</h2>
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
          <button type="button" className={primary} onClick={() => dispatch({ type: "next" })} disabled={chosen === undefined}>
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
    case "analysis":
      body = (
        <>
          {back}
          <h2 className="text-2xl font-bold">{text.analysisTitle}</h2>
          <p className="text-lg">{text.analysisMessage}</p>
          <button type="button" className={primary} onClick={() => dispatch({ type: "choose_other" })}>
            {text.analysisChooseButton}
          </button>
        </>
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
              <SpiderChart axes={step.chart} title={text.chartTitle} />
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
          <button
            type="button"
            className={primary}
            onClick={() => acceptHouse(step.houseId, step.method)}
            disabled={pending || !house}
          >
            {text.acceptButton}
          </button>
          <button type="button" className={big} onClick={() => dispatch({ type: "choose_other" })} disabled={pending}>
            {text.chooseOtherButton}
          </button>
        </>
      );
      break;
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {body}
      {error && (
        <p role="alert" className="rounded-xl border-2 border-red-700 p-4 text-lg">
          {text.errors[error]}
        </p>
      )}
    </div>
  );
}
