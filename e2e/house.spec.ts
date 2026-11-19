import { expect, test } from "@playwright/test";

// Escolha da casa (#76). Sem Supabase (o CI): só a proteção da rota. O fluxo completo, com a
// inspeção das requisições, está em e2e/house-live.spec.ts.
test("/casa exige login e volta para ela depois", async ({ page }) => {
  await page.goto("/casa");
  await expect(page).toHaveURL(/\/entrar\?next=%2Fcasa$/);
});
