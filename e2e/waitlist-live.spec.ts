import { expect, test, type Page } from "@playwright/test";

// Tela /espera (#195) contra um Supabase local: quem espera vê a espera e pode sair (volta ao
// login, para trocar de conta); quem já está ativo e abre /espera é levado para dentro.
// Para rodar localmente, com o banco de pé:
//   E2E_LIVE_SUPABASE_URL=<API_URL> E2E_LIVE_ANON_KEY=<ANON_KEY> \
//   E2E_LIVE_SERVICE_ROLE_KEY=<SERVICE_ROLE_KEY> npm run test:e2e -- waitlist-live
const API = process.env.E2E_LIVE_SUPABASE_URL;
const SERVICE = process.env.E2E_LIVE_SERVICE_ROLE_KEY;
test.skip(!API || !SERVICE, "precisa do Supabase local e da chave service_role");

const admin = (path: string, init: RequestInit = {}) =>
  fetch(`${API}${path}`, {
    ...init,
    headers: { apikey: SERVICE!, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json", ...init.headers },
  });

/** Pessoa com perfil no estado de SP, com o `access_status` dado; `active` já aceitou o termo. */
async function createPerson(tag: string, accessStatus: "active" | "waitlisted"): Promise<string> {
  const email = `espera.${tag}.${Date.now()}@exemplo.org`;
  const user = await (await admin("/auth/v1/admin/users", { method: "POST", body: JSON.stringify({ email, email_confirm: true }) })).json();
  const res = await admin("/rest/v1/profiles", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      id: user.id,
      display_name_enc: "v1.AAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBB",
      municipality_code: 3550308,
      consent_version: "v1",
      access_status: accessStatus,
      status: "active",
    }),
  });
  expect(res.status).toBe(201);
  if (accessStatus === "active") {
    await admin("/rest/v1/consent_acceptances", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ user_id: user.id, version: "v1" }) });
  }
  return email;
}

async function openLoginLink(page: Page, email: string): Promise<void> {
  const link = await (await admin("/auth/v1/admin/generate_link", { method: "POST", body: JSON.stringify({ type: "magiclink", email }) })).json();
  await page.goto(`/auth/confirmar?token_hash=${link.hashed_token ?? link.properties?.hashed_token}&type=email`);
  await page.getByRole("button", { name: "Entrar" }).click();
}

test("quem espera vê a espera e sai para trocar de conta", async ({ page }) => {
  await openLoginLink(page, await createPerson("a", "waitlisted"));
  await expect(page).toHaveURL(/\/espera$/);
  await expect(page.getByRole("heading", { name: "Seu cadastro está em análise" })).toBeVisible();
  // Recarregar continua na espera (a regra de redirecionamento não tira quem ainda espera).
  await page.reload();
  await expect(page).toHaveURL(/\/espera$/);

  await page.getByRole("button", { name: "Sair" }).click();
  await expect(page).toHaveURL(/\/entrar/);
  // A sessão acabou: uma página de dentro volta ao login.
  await page.goto("/inicio");
  await expect(page).toHaveURL(/\/entrar/);
});

test("quem já está ativo e abre /espera é levado para dentro", async ({ page }) => {
  await openLoginLink(page, await createPerson("b", "active"));
  await expect(page).toHaveURL(/\/inicio$/);
  await page.goto("/espera");
  await expect(page).toHaveURL(/\/inicio$/);
  await expect(page.getByRole("heading", { name: "Seu cadastro está em análise" })).toHaveCount(0);
});

test("sem sessão, /espera continua pública, com o texto e o botão Sair", async ({ page }) => {
  await page.goto("/espera");
  await expect(page).toHaveURL(/\/espera$/);
  await expect(page.getByRole("heading", { name: "Seu cadastro está em análise" })).toBeVisible();
  await page.getByRole("button", { name: "Sair" }).click();
  await expect(page).toHaveURL(/\/entrar/);
});
