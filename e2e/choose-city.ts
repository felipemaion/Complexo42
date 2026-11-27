import type { Page } from "@playwright/test";

/**
 * Escolhe estado e cidade no formulário do perfil (#175). A lista de cidades só carrega depois do
 * estado; o `selectOption` espera a opção aparecer. Por padrão, o estado de São Paulo.
 */
export async function chooseCity(page: Page, city: string, state = "São Paulo"): Promise<void> {
  await page.getByLabel("Seu estado").selectOption({ label: state });
  await page.getByLabel("Sua cidade", { exact: true }).selectOption({ label: city });
}
