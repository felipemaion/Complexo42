// Roda uma vez na subida do servidor Next.js (só no runtime Node).
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") await import("./server/boot");
}
