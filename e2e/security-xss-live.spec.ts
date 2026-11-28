import { expect, test, type Page } from "@playwright/test";
import { instance } from "@config/instance";
import { acceptTermIfAsked } from "./accept-term";
import { chooseCity } from "./choose-city";
import { giveHouse } from "./give-house";

// #156, parte 1: payloads de XSS nos campos de texto livre que o app tem hoje (nome, bairro, formação "qual?", atividade,
// redes sociais e a sugestão de habilidade) contra um Supabase local. O que se confere: o texto volta como TEXTO
// (o campo mostra o payload escrito, e `.toHaveValue` o lê), nenhum diálogo abre, nenhum script do payload roda e nenhum
// elemento do payload (`<img src=x>`, `<script>`) entra na página. Para rodar (stack local de pé, `site_url` do
// supabase/config.toml apontando para a porta do E2E):
//   E2E_LIVE_SUPABASE_URL=<API_URL> E2E_LIVE_ANON_KEY=<ANON_KEY> \
//   E2E_LIVE_SERVICE_KEY=<SERVICE_ROLE_KEY> npm run test:e2e -- security-xss-live
// A chave de serviço do stack LOCAL fica só neste processo de teste; o app nunca a recebe (R6).
const API = process.env.E2E_LIVE_SUPABASE_URL;
const SERVICE_KEY = process.env.E2E_LIVE_SERVICE_KEY;
test.skip(!API || !SERVICE_KEY, "precisa do Supabase local e da chave de serviço local (ver o topo do arquivo)");

const SCRIPT_PAYLOAD = "<script>window.__xss=1</script>";
const IMG_PAYLOAD = '<img src=x onerror="window.__xss=1">';
const profile = instance.profile;

const admin = (path: string, init: RequestInit) =>
  fetch(`${API}${path}`, {
    ...init,
    headers: { apikey: SERVICE_KEY!, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", ...init.headers },
  });

/** O que NÃO pode acontecer em nenhuma tela depois de um payload. */
async function expectInert(page: Page, dialogs: string[]) {
  expect(dialogs, "nenhum diálogo (alert/confirm/prompt) pode abrir").toEqual([]);
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss), "o script do payload não pode rodar").toBeUndefined();
  await expect(page.locator("img[src='x']"), "o <img> do payload não pode entrar na página").toHaveCount(0);
  await expect(page.locator("script", { hasText: "__xss" }), "o <script> do payload não pode entrar na página").toHaveCount(0);
}

test("payloads de XSS nos campos de texto voltam como texto e não executam", async ({ browser, baseURL }) => {
  test.setTimeout(150_000);
  const email = `xss.${Date.now()}@exemplo.org`;
  const link = await (await admin("/auth/v1/admin/generate_link", { method: "POST", body: JSON.stringify({ type: "magiclink", email }) })).json();
  const page = await (await browser.newContext()).newPage();
  const dialogs: string[] = [];
  page.on("dialog", (dialog) => {
    dialogs.push(dialog.message());
    void dialog.dismiss();
  });
  await page.goto(`/auth/confirmar?token_hash=${link.hashed_token}&type=${link.verification_type}`);
  await page.getByRole("button", { name: "Entrar" }).click();
  await acceptTermIfAsked(page);
  await expect(page).toHaveURL(`${baseURL}/perfil`);

  const name = page.getByLabel(profile.nameLabel);
  const neighborhood = page.getByLabel(profile.neighborhoodLabel);
  const educationDetail = page.getByLabel(profile.educationDetailLabel);
  const occupation = page.getByLabel(profile.occupationLabel);
  const firstLink = page.locator("#perfil-rede-1");
  const save = page.getByRole("button", { name: profile.saveButton });

  // 1) Envio inválido com payload em todo campo de texto: o servidor devolve o que recebeu, e a tela o mostra como texto.
  await chooseCity(page, "São Paulo");
  await name.fill(SCRIPT_PAYLOAD);
  await page.getByLabel(profile.whatsappLabel).fill("11987654321");
  await neighborhood.fill(IMG_PAYLOAD);
  await educationDetail.fill(SCRIPT_PAYLOAD);
  await occupation.fill(IMG_PAYLOAD);
  await firstLink.fill(IMG_PAYLOAD);
  const answered = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/perfil");
  await save.click();
  await answered;
  await expect(save).toBeEnabled();
  await expectInert(page, dialogs);
  // Como TEXTO: o campo guarda o payload escrito, sem que ele tenha virado marcação.
  await expect(name).toHaveValue(SCRIPT_PAYLOAD);
  await expect(occupation).toHaveValue(IMG_PAYLOAD);

  // 2) Perfil válido com o payload só nos campos que aceitam texto livre; depois, reabrir as telas que o mostram.
  await name.fill("Maria Souza");
  await neighborhood.fill("Vila Exemplo");
  await educationDetail.fill(SCRIPT_PAYLOAD);
  await occupation.fill(IMG_PAYLOAD);
  await firstLink.fill("");
  const saved = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/perfil");
  await save.click();
  await saved;
  await expectInert(page, dialogs);
  const sawProfile = await admin(`/rest/v1/profiles?id=eq.${link.id}`, {
    method: "PATCH",
    body: JSON.stringify({ access_status: "active", status: "active" }),
  });
  expect(sawProfile.ok).toBe(true);
  await giveHouse(admin, link.id);
  for (const path of ["/perfil", "/inicio"]) {
    await page.goto(path);
    await expectInert(page, dialogs);
  }
  // Se o servidor guardou o texto, ele volta ao campo como texto.
  await page.goto("/perfil");
  const stored = await occupation.inputValue();
  if (stored !== "") expect(stored).toBe(IMG_PAYLOAD);

  // 3) Sugestão de habilidade (texto livre que a coordenação lê): vira texto na lista de sugestões da própria pessoa.
  await page.goto("/perfil/habilidades");
  await page.getByLabel("Nome da habilidade").fill(IMG_PAYLOAD);
  await page.getByRole("button", { name: "Sugerir habilidade" }).click();
  await expect(page.getByRole("main")).toBeVisible();
  await expectInert(page, dialogs);
  const mine = page.getByTestId("my-suggestion");
  if ((await mine.count()) > 0) await expect(mine.first()).toContainText(IMG_PAYLOAD);
});
