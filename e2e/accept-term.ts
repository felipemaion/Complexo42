import type { Page } from "@playwright/test";

/**
 * Quem entra sem aceitar o termo atual cai em /termo (#11). Marca a caixa e continua; se a
 * pessoa já tinha aceitado, não faz nada. Para quem ainda não tem perfil: chame logo depois do login, antes de conferir a tela
 * seguinte.
 */
export async function acceptTermIfAsked(page: Page): Promise<void> {
  await page.waitForURL(/\/(termo|perfil)(\?.*)?$/);
  if (new URL(page.url()).pathname !== "/termo") return;
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Continuar" }).click();
}
