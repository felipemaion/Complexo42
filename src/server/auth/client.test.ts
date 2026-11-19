import { describe, expect, it, vi } from "vitest";
import { AUTH_COOKIE_NAME, createAuthClient, hasAuthCookie, type CookieToSet } from "./client";

// Usa o @supabase/ssr de verdade, sem rede: montar o endereço do Google não chama o GoTrue.
describe("createAuthClient (#9)", () => {
  const anonKey = "sb_publishable_teste";

  it("Google: endereço na origem pública, com PKCE e verificador em cookie httpOnly de nome fixo", async () => {
    const set: CookieToSet[] = [];
    const client = createAuthClient({
      url: "https://app.exemplo.org",
      anonKey,
      secure: true,
      cookies: { getAll: () => [], setAll: (list) => void set.push(...list) },
    });
    const { data, error } = await client.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: "https://app.exemplo.org/auth/callback", skipBrowserRedirect: true },
    });
    expect(error).toBeNull();
    const url = new URL(data.url as string);
    expect(url.origin + url.pathname).toBe("https://app.exemplo.org/auth/v1/authorize");
    expect(url.searchParams.get("provider")).toBe("google");
    expect(url.searchParams.get("redirect_to")).toBe("https://app.exemplo.org/auth/callback");
    expect(url.searchParams.get("code_challenge")).toMatch(/^[\w-]{43}$/);
    expect(url.searchParams.get("code_challenge_method")).toBe("s256");

    const verifier = set.find((c) => c.name.startsWith(`${AUTH_COOKIE_NAME}-code-verifier`));
    expect(verifier?.options).toMatchObject({ httpOnly: true, secure: true, sameSite: "lax", path: "/" });
  });

  it("sem cookie de sessão, getUser não chama a rede", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const client = createAuthClient({ url: "http://127.0.0.1:9", anonKey, secure: false, cookies: { getAll: () => [], setAll: () => {} } });
    const { data } = await client.auth.getUser();
    expect(data.user).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("reconhece o cookie de sessão, inclusive em pedaços", () => {
    expect(hasAuthCookie([`${AUTH_COOKIE_NAME}.0`, "outro"])).toBe(true);
    expect(hasAuthCookie(["sb-outro-auth-token"])).toBe(false);
  });
});
