// Avaliação e conversa da equipe ficam desligadas na configuração da instância até o jurídico
// (ADR 0007 §4) e a decisão da #120. Na DEMONSTRAÇÃO (DEMO_MODE=1, só pessoas fictícias) elas
// aparecem para o time ver como funcionam; nenhum dado real passa por ali.
import { instance } from "@config/instance";

const isDemo = (): boolean => process.env.DEMO_MODE === "1";

export function evaluationsEnabled(): boolean {
  return instance.evaluations.enabled || isDemo();
}

export function teamChatEnabled(): boolean {
  return instance.teamChat.enabled || isDemo();
}
