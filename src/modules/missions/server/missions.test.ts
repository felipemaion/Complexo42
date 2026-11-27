import { describe, expect, it } from "vitest";
import type { MissionClient, MissionQuery, MissionStep } from "../types";
import { parsePublishInput, publishMission, readMyRuns, reviewSubmission, startRun, submitStep } from "./missions";

type Call = { fn: string; args?: Record<string, unknown> };

/** Cliente falso: grava as chamadas de rpc e devolve o que o teste mandar. */
function fakeClient(rpcResult: { data?: unknown; error?: unknown } = {}, rows: unknown = []): { client: MissionClient; calls: Call[] } {
  const calls: Call[] = [];
  const query: MissionQuery = {
    eq: () => query,
    is: () => query,
    order: () => query,
    maybeSingle: async () => ({ data: rows, error: null }),
    then: (resolve, reject) => Promise.resolve({ data: rows, error: null }).then(resolve, reject),
  };
  const client: MissionClient = {
    rpc: async (fn, args) => {
      calls.push({ fn, args });
      return { data: rpcResult.data ?? null, error: rpcResult.error ?? null };
    },
    from: () => ({ select: () => query }),
  };
  return { client, calls };
}

const runId = "11111111-1111-4111-8111-111111111111";
const missionId = "22222222-2222-4222-8222-222222222222";
const linkStep: MissionStep = {
  id: "33333333-3333-4333-8333-333333333333",
  position: 1,
  title: "Escrever",
  description: "",
  points: 10,
  evidenceType: "link",
  requiresPrevious: false,
};

describe("submitStep", () => {
  it("comprovante fora do formato → recusado sem chamar o banco", async () => {
    // Arrange
    const { client, calls } = fakeClient();

    // Act
    const result = await submitStep(client, { runId, step: linkStep, url: "http://inseguro.exemplo", text: null });

    // Assert
    expect(result).toEqual({ ok: false, error: "invalid_evidence" });
    expect(calls).toHaveLength(0);
  });

  it("etapa ainda fechada no banco (C7611) → motivo 'locked'", async () => {
    const { client } = fakeClient({ error: { code: "C7611" } });

    const result = await submitStep(client, { runId, step: linkStep, url: "https://exemplo.org", text: null });

    expect(result).toEqual({ ok: false, error: "locked" });
  });

  it("entrega válida chama submit_step com o tipo da etapa lida no servidor", async () => {
    const { client, calls } = fakeClient();

    const result = await submitStep(client, { runId, step: linkStep, url: " https://exemplo.org/texto ", text: "ignorado" });

    expect(result).toEqual({ ok: true });
    expect(calls).toEqual([
      {
        fn: "submit_step",
        args: { p_run: runId, p_step: linkStep.id, p_evidence_url: "https://exemplo.org/texto", p_evidence_text: null },
      },
    ]);
  });
});

describe("startRun", () => {
  it("id inválido → indisponível, sem chamar o banco", async () => {
    const { client, calls } = fakeClient();

    expect(await startRun(client, "abc")).toEqual({ ok: false, error: "unavailable" });
    expect(calls).toHaveLength(0);
  });

  it("sem permissão no banco (42501) → 'not_allowed'", async () => {
    const { client } = fakeClient({ error: { code: "42501" } });

    expect(await startRun(client, missionId)).toEqual({ ok: false, error: "not_allowed" });
  });
});

describe("reviewSubmission", () => {
  it("decisão fora da lista → recusada sem chamar o banco", async () => {
    const { client, calls } = fakeClient();

    expect(await reviewSubmission(client, { submissionId: runId, decision: "talvez" })).toEqual({ ok: false, error: "failed" });
    expect(calls).toHaveLength(0);
  });

  it("validar manda p_approve = true e devolve 'approved'", async () => {
    const { client, calls } = fakeClient();

    const result = await reviewSubmission(client, { submissionId: runId, decision: "approve", note: "  " });

    expect(result).toEqual({ ok: true, value: "approved" });
    expect(calls[0]).toEqual({ fn: "review_submission", args: { p_submission: runId, p_approve: true, p_note: null } });
  });

  it("entrega já validada (C7612) → 'already_done'", async () => {
    const { client } = fakeClient({ error: { code: "C7612" } });

    expect(await reviewSubmission(client, { submissionId: runId, decision: "reject" })).toEqual({ ok: false, error: "already_done" });
  });
});

describe("publicação", () => {
  const valid = {
    title: "Texto sobre o orçamento",
    description: "Prazo: 28/11",
    category: "escrita",
    scopeUnitId: missionId,
    mode: "team",
    steps: [{ title: "Escrever o texto", points: "10", evidenceType: "link" }],
  };

  it("tipo de missão fora da config ou sem etapas → inválido", () => {
    expect(parsePublishInput({ ...valid, category: "outra" }, ["escrita"]).success).toBe(false);
    expect(parsePublishInput({ ...valid, steps: [] }, ["escrita"]).success).toBe(false);
    expect(parsePublishInput({ ...valid, steps: [{ title: "x", points: "10", evidenceType: "link" }] }, ["escrita"]).success).toBe(false);
  });

  it("formulário válido vira uma chamada só ao publish_mission, com pontos em número", async () => {
    const { client, calls } = fakeClient({ data: missionId });

    const result = await publishMission(client, valid, ["escrita"]);

    expect(result).toEqual({ ok: true, value: missionId });
    expect(calls[0]?.fn).toBe("publish_mission");
    expect(calls[0]?.args?.p_steps).toEqual([{ title: "Escrever o texto", points: 10, evidence_type: "link" }]);
  });
});

describe("readMyRuns", () => {
  it("na mesma missão, a execução em andamento vence a concluída", async () => {
    const userId = "44444444-4444-4444-8444-444444444444";
    const { client } = fakeClient({}, [
      { run: { id: "r1", mission_id: "m1", status: "completed" } },
      { run: { id: "r2", mission_id: "m1", status: "active" } },
      { run: { id: "r3", mission_id: "m2", status: "completed" } },
    ]);

    const runs = await readMyRuns(client, userId);

    expect(runs.get("m1")?.id).toBe("r2");
    expect(runs.get("m2")?.status).toBe("completed");
  });
});
