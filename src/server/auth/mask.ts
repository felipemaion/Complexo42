// E-mail mascarado para o próprio dono ver em qual conta entrou (#9, revisão M1): quem foi
// logado na conta de outra pessoa (link de terceiro) percebe. Nunca o e-mail inteiro na tela.
// Ex.: fulano@gmail.com → fu***@g***.com
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1) return "***";
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const dot = domain.lastIndexOf(".");
  const tld = dot > 0 ? domain.slice(dot) : "";
  const name = dot > 0 ? domain.slice(0, dot) : domain;
  // Local curto mostra menos, para não revelar o endereço quase inteiro.
  const keep = local.length > 3 ? 2 : 1;
  return `${Array.from(local).slice(0, keep).join("")}***@${Array.from(name)[0] ?? ""}***${tld}`;
}
