import { createRateLimiter } from "@/server/rate-limit";

// Freio simples por coordenador para autorizar e-mail à mão: 30 inclusões a cada 10 minutos.
// (O import em lote não passa por aqui: é um arquivo, com seus próprios tetos.)
export const addEmailLimit = { max: 30, windowMs: 10 * 60 * 1000 } as const;
const limiter = createRateLimiter(addEmailLimit);

export const takeAddEmail = (userId: string) => limiter.take(userId);
export const resetAddEmailLimit = () => limiter.reset();
