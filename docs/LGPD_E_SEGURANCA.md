# LGPD e segurança

> Não é parecer jurídico. Os pontos marcados **[jurídico]** precisam de validação.

## 1. Princípio: "se invadirem, que não tenham nada pra roubar"

Na prática, isso vira quatro camadas:

1. **Não coletar:** só os campos de `MODELO_DADOS.md`. Sem CPF, endereço ou data de nascimento.
2. **Não expor:** RLS negada por padrão; o WhatsApp só aparece para quem precisa.
3. **Não acumular:** exclusão real da conta; retenção limitada; sem exportações soltas.
4. **Não guardar segredos no lugar errado:** nada de chave no repositório nem no navegador.

### Decisões que materializam isso

- **ADR 0003:** nome, WhatsApp e redes ficam **cifrados** (AES-256-GCM), com a chave fora do
  banco. Um dump do banco não identifica ninguém.
- **ADR 0002:** cada monitor e gestor vê só o seu escopo (turma/equipe, UF, nacional), com
  ver contato auditado.
- **ADR 0005:** cada uso do código é uma instância separada (outro banco, outras chaves);
  a base da Academia nunca é compartilhada com outra instância.

## 2. LGPD — checklist

| Item | Como atendemos |
|---|---|
| Base legal | Consentimento (art. 7º, I) ao entrar [jurídico]. Tela `/termo` antes do perfil: caixa desmarcada, botão só habilita depois de marcar; o aceite (versão e data) fica na conta, em `consent_acceptances`, com auditoria, e o banco só deixa gravar o perfil de quem aceitou a versão vigente; versão nova pede novo aceite. Baixar os dados e excluir a conta funcionam sem aceite (#11) |
| Finalidade | Organizar alunos em equipes e ações da Academia. Texto no termo |
| Minimização | Lista fechada de campos + checagem no CI |
| Transparência | Página "Seus dados": o que guardamos, por quê e quem vê |
| Acesso e portabilidade | Botão "Baixar meus dados" (JSON) na página inicial, só com os dados de quem pede, auditado e limitado a 5 por hora (#20; detalhes em `MODELO_DADOS.md`) |
| Respostas do questionário (#256) | **Finalidade:** comparar casas na troca de casa (o que se espera em cada uma, a partir das respostas da própria pessoa). **Retenção:** só a última resposta válida; um novo resultado a substitui e um resultado decidido pela coordenação a apaga; nada de histórico. **Exclusão:** some com a conta (cascata) junto do resultado. **Exportação:** entram em "Baixar meus dados" (`respostasGuardadas`, decifradas só no servidor, formato 10). **Acesso:** cifradas (AES-256-GCM, AAD com o id da pessoa), coluna sem leitura pela API; a coordenação não vê respostas individuais; nunca vão ao log. O termo do questionário ainda precisa mencionar a guarda (texto do Cortez: decisão do orquestrador/Felipe). **Uso na troca de casa (#268):** o servidor lê, decifra e usa só para montar o "o que se espera" da própria pessoa; sem elas, a tela mostra só o gráfico, sem expectativas. Nada chega ao navegador além do texto e da intensidade. |
| Foto do perfil (#308, ADR 0006 revisão 2026-11-28) | **Finalidade:** a coordenação reconhecer a pessoa na vida real. **Guarda:** só uma miniatura (~256 px, WebP, ~20 KB), sem EXIF e sem o original. **Regras:** foto da própria pessoa, real, estilo 3x4, sem anime nem imagem de IA; é **opcional** por ora; a coordenação confere conversando com a pessoa (sem fluxo de moderação no sistema). **Quem vê:** só membros logados. **Consentimento:** envio por ato da pessoa, com aviso; ela troca ou remove quando quiser. **Exclusão:** some com a conta e entra em "Baixar meus dados". Dado biométrico (art. 5º, II) só se a foto for usada para identificar a pessoa por máquina, o que não fazemos [jurídico: confirmar]. |
| Formação e atividade profissional (#304) | **Finalidade:** encaixar a pessoa num eixo da casa e achar quem pode ajudar. **Opcional**, cifrada, e vista só pela própria pessoa e pela coordenação do escopo; nada no perfil público sem a escolha do dono (#305). Entra em "Baixar meus dados" e some com a conta. |
| Eliminação | Botão "Excluir minha conta" (#18): apaga na hora a conta (`auth.users`), o perfil, o contato e os vínculos, com confirmação escrita e login de no máximo 10 minutos (conferido no banco), sem `service_role`; preserva só a contagem anônima de ações e um `account_deleted` sem dado pessoal. Detalhes e regra para tabelas novas em `MODELO_DADOS.md` |
| Menores | Bloqueio de menores de 18 no piloto [?] [jurídico] |
| Dado sensível | Uma lista de membros de um movimento político pode indicar opinião política (art. 5º, II) [jurídico] |
| Controlador e encarregado | Definir quem é [?] |
| Incidente | Plano em `SECURITY.md`; comunicação à ANPD em prazo razoável (art. 48) |
| Operadores | Supabase e a hospedagem: verificar a região dos dados e os termos (transferência internacional, art. 33) [jurídico] |

## 3. Modelo de ameaças (resumo)

| Ameaça | Controle |
|---|---|
| Leitura direta da API do Supabase com a chave pública | RLS em todas as tabelas + teste no CI que **falha se existir tabela sem RLS** |
| Aluno lê dados de outro aluno | Testes pgTAP por política ("usuário A não lê B") |
| Aluno se promove a admin | Papéis só em `role_assignments`, concedidos de cima para baixo (ADR 0002) + teste |
| Monitor ou gestor acessa fora do seu escopo | Funções `app.can_*` em todas as políticas + matriz de testes de permissão |
| Dump do banco ou backup vazado | Nome, WhatsApp e redes cifrados; chave só nos secrets da hospedagem (ADR 0003) |
| Monitor copia contatos em massa | Contato fora da listagem; "ver contato" auditado; exportação só nacional e sem WhatsApp |
| Base da Academia reaproveitada em outro uso | Instâncias separadas: banco, chaves e domínio próprios (ADR 0005) |
| Avaliação reservada vazada ou usada para disputa interna | Cifrada; só quem avaliou lê a própria; gestor só por pedido com motivo, auditado; desligada até parecer jurídico (ADR 0007 §4) |
| Portfólio usado para injetar conteúdo | Sem upload; prévia só de domínios de lista fechada com `frame-src` restrito; demais links como link comum (ADR 0007 §5) |
| Segredo commitado | gitleaks no CI + `.gitignore` + rotação de chaves |
| Conta de admin roubada | MFA obrigatório nas contas do GitHub, Supabase e hospedagem; no máximo 3 admins |
| Injeção (XSS) via redes sociais ou "feitos" | Escape padrão do React; proibido `dangerouslySetInnerHTML`; links só `https://` e com `rel="noopener noreferrer"` |
| Cadastro em massa por robô | Lista de autorizados: quem não está nela fica em espera (ADR 0008 §1, #26); rate limit do Auth por IP e de e-mails por hora (`supabase/config.toml` e `GOTRUE_RATE_LIMIT_*`, #9); regra de rate limit da Cloudflare em `/auth/v1/*` (ADR 0009 §6) |
| Sessão roubada por script injetado | Cookie de sessão `httpOnly`, `SameSite=Lax` e `Secure`; não há cliente Supabase no navegador (#9) |
| Link de login usado para mandar a pessoa a outro site | Destino pós-login só por caminho interno (`safeNextPath`, #9); mensagens de erro só por código conhecido |
| Senha opcional (ADR 0018): sequestro prévio da conta, força bruta, senha fraca ou vazada, senha em log | Senha só definida por quem já está logado (`updateUser`); `/auth/v1/signup` responde 404 no Kong e `/token`, `/recover`, `/otp`, `/user` só atendem o app (404 vindo de fora, `deploy/kong.test.sh`); política de 12 a 72 bytes com lista local e HIBP no GoTrue; mesma mensagem para senha errada, e-mail sem conta e e-mail não confirmado; Turnstile conferido antes de cada tentativa; troca exige a senha atual ou a sessão de recuperação, e reautenticação se a sessão tem mais de 24 h; o acesso segue por `requireUser` e pela lista de autorizados depois de qualquer login; o log leva só o código do erro, nunca a senha nem o e-mail |
| Token de uso único (link do e-mail, `code`, tokens de sessão) vazando na URL do login | O destino pós-login (`next`) leva só o caminho, nunca query nem fragmento; caminhos de link antigo (`/verify`, `/callback`, ...) e `/entrar` com credencial na query viram `/entrar?erro=legacy_link` sem ecoar nada; lista central de parâmetros de credencial em `src/server/auth/routes.ts`; o log do app registra só códigos, nunca URL nem query de auth (#231) |
| Planilha exportada vazando | Exportação sem WhatsApp, ou só para admin, com registro no `audit_log` |
| Dependência maliciosa | Dependabot; regra R9 (justificar toda dependência); `npm ci` com lockfile |
| Voluntário com acesso a produção | Voluntários **não** têm acesso a produção; usam o Supabase local com dados fictícios |

## 4. Controles operacionais

- MFA obrigatório na organização ou conta do GitHub, no Supabase e na hospedagem.
- Chaves de produção: só os mantenedores, como *secrets* da hospedagem.
- Backups: o plano gratuito do Supabase **não tem backup diário automático confiável**.
  Fazer `pg_dump` semanal criptografado, guardado só pelos mantenedores [?].
- Revisão de acessos mensal: quem é admin ou coordenador.
