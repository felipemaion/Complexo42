# ADR 0003 — Proteção dos dados: criptografia de campo + hash

- **Status:** Aceito
- **Data:** 2026-11-09

## Contexto

Requisito do projeto: os dados devem ser salvos protegidos ("em hash") para que, se alguém
invadir, não tenha nada para levar.

**Hash e criptografia não são a mesma coisa:**

| | Hash (ex.: HMAC-SHA256) | Criptografia (ex.: AES-256-GCM) |
|---|---|---|
| Volta ao original? | **Não** | Sim, com a chave |
| Serve para | Comparar ("esse WhatsApp já existe?") | Guardar algo que alguém precisa ler depois |
| Exemplo aqui | Detectar cadastro duplicado | Monitor ler o WhatsApp para contatar |

O monitor precisa **ler** o WhatsApp, portanto só hash não basta: guardamos **os dois**.

## Decisão

### 1. O que é cifrado

| Dado | Como fica no banco | Por quê |
|---|---|---|
| Nome | `display_name_enc` (AES-256-GCM) | Identifica a pessoa |
| WhatsApp | `whatsapp_enc` (AES-256-GCM) + `whatsapp_hmac` (HMAC-SHA256) | Contato. O HMAC garante unicidade e busca exata |
| Redes sociais | `social_links_enc` (AES-256-GCM, JSON) | Identificam a pessoa |
| Bairro (opcional, texto livre) | `profiles.neighborhood_enc` (AES-256-GCM) | Texto livre pode virar endereço (#179) |
| Formação e atividade profissional (opcionais) | `profile_background.education_level_enc`, `education_detail_enc`, `occupation_enc` (AES-256-GCM) | Dizem quem a pessoa é e onde trabalha (#304) |
| Totem e respostas do questionário (ADR 0014) | `questionnaire_results.totem_enc`, `house_analysis_requests.answers_enc` (AES-256-GCM; AAD `tabela.coluna.<profile_id>`) | Perfil da pessoa; só o servidor decifra |
| Município, UF, habilidades, tarefas, badges | Texto puro | Precisam de filtro e agregação. **Sem nome ou contato, não identificam ninguém** |
| Senha | **Não existe** | Login por Google ou link mágico: não há senha para vazar |
| E-mail de login | `auth.users` (Supabase, texto puro) | **Risco residual** — ver item 6 |

**Resultado:** um dump do banco mostra "alguém em Osasco que sabe design e fez 12 tarefas",
mas não quem é nem como contatar.

### 2. Onde fica a chave

- `FIELD_ENCRYPTION_KEY` (32 bytes) e `BLIND_INDEX_KEY` (32 bytes, **diferente**) ficam
  **apenas nos secrets da hospedagem de produção**. Nunca no banco, no repositório nem no
  navegador.
- Só o gestor do projeto tem acesso. Guarde uma cópia offline em cofre de senhas: **se a chave
  se perder, os dados se perdem**.
- Local e staging usam chaves próprias, de teste.

### 3. Formato do valor cifrado (especificação)

```
v1.<iv base64url, 12 bytes aleatórios>.<ciphertext+tag base64url>
```

- AES-256-GCM via **Web Crypto API** (`crypto.subtle`), nativa do Node 20+.
- **AAD** (dado associado) = `"<tabela>.<coluna>.<id da linha>"`. Isso impede copiar o valor
  cifrado de uma linha para outra.
- O prefixo de versão (`v1`) permite **rotacionar a chave**. A nova chave vira `v2`, e um
  script recifra as linhas aos poucos.
  - As chaves antigas saem do ambiente assim que a recifragem termina, porque uma chave
    antiga vazada permitiria forjar valores.
  - A chave e a versão (`FIELD_ENCRYPTION_KEY_VERSION`) sempre mudam juntas.
- HMAC: `HMAC-SHA256(BLIND_INDEX_KEY, "<domínio>:" + valor)` em hex.
  - Domínios: `wa` para o WhatsApp em E.164 e `em` para o e-mail em minúsculas e sem
    espaços.
  - O prefixo impede que valores de domínios diferentes se confundam.
  - O índice é único por organização.
  - Trocar a `BLIND_INDEX_KEY` invalida todos os HMACs. Como a lista de autorizados
    (`access_allowlist`) só guarda HMACs, a coordenação precisa **reimportá-la** com a chave
    nova (ADR 0008 §1).

### 4. Onde cifra e decifra

- **Somente** no módulo `src/server/crypto/` (com marcação `server-only`), protegido por
  CODEOWNERS.
- O navegador **nunca** lê as tabelas de dados pessoais direto. Ele chama o servidor; o
  servidor consulta o Supabase **com o JWT do usuário** (a RLS continua valendo, nunca
  `service_role`) e decifra apenas as linhas que a RLS liberou.
- São **duas barreiras independentes**: se a RLS falhar, sai texto cifrado; se a chave vazar,
  a RLS ainda bloqueia o acesso pela API.

### 5. Outras camadas

- O disco do Supabase já é cifrado em repouso, mas isso **não** protege contra quem consegue
  fazer SQL. Por isso existe a criptografia de campo.
- `audit_log` de `contact_viewed`, `export`, `role_granted`. Sem dados pessoais no payload.
- **Exportação** de planilha só pelo gestor nacional, sem WhatsApp, e auditada.
- Logs e mensagens de erro nunca contêm valores decifrados (regra R11).

### 6. Riscos residuais (honestidade)

| Risco | Situação |
|---|---|
| Invasor que controla o **servidor** em execução | Tem chave e sessão: consegue decifrar. Mitigação: secrets só no provedor, MFA, poucas pessoas com acesso, dependências revisadas |
| E-mail em `auth.users` | Fica em texto puro (gerenciado pelo Supabase). Mitigação: só é exibido pela função auditada do ADR 0010 e não é exportado em massa |
| Monitor mal-intencionado copiando contatos | Ele vê só o seu escopo, e cada visualização fica auditada |
| Busca por habilidade | Sem impacto: habilidades, região e turma ficam em texto puro e indexadas; o filtro roda no banco e só a página exibida é decifrada |
| Busca por nome | Não dá para buscar texto cifrado no banco: o servidor decifra o conjunto do escopo e filtra em memória. Funciona até dezenas de milhares de registros; reavaliar na expansão |

## Alternativas consideradas

- **Só hash:** impossível, porque ninguém conseguiria contatar o aluno.
- **pgsodium/TCE do Supabase:** descontinuado pelo próprio Supabase, e a chave ficaria no mesmo
  sistema que os dados.
- **Só a criptografia de disco do provedor:** não protege contra SQL indevido nem contra uma
  chave de API vazada.

## Consequências

- (+) Um vazamento do banco ou do backup expõe apenas texto cifrado.
- (−) Sem `ORDER BY` ou `LIKE` no nome dentro do SQL; ordenar e filtrar acontece no servidor.
- (−) Um módulo crítico a mais: precisa de testes (ida e volta, AAD errada falha, chave errada
  falha, versão desconhecida falha).
