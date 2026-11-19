# ADR 0001: Stack tecnológica

- **Status:** Aceito (pelo gestor, em 2026-11-19)
- **Data:** 2026-11-09, revisado em 2026-11-19 para refletir o ADR 0009

## Contexto

- **Custo zero.** O teto é de R$ 100/mês, e qualquer gasto exige ADR.
- **Segurança forte** com um time de pouca experiência.
- **Uma stack que as IAs dos voluntários conheçam bem.**
- **Escala:** de 50 a 2.000 pessoas no piloto, podendo chegar a dezenas de milhares.

## Decisão

| Camada | Escolha |
|---|---|
| App (front + servidor) | Next.js (App Router) + TypeScript estrito |
| Banco + Auth | Supabase **auto-hospedado no servidor do mantenedor** (Postgres, GoTrue, PostgREST), sem plano em nuvem; detalhes no ADR 0009 |
| UI | Tailwind CSS + shadcn/ui |
| Validação | Zod |
| Testes | Vitest, Playwright, pgTAP (`supabase test db`) |
| CI e imagem | GitHub Actions (gratuito em repositório público) e GHCR |

Localmente, cada voluntário roda o mesmo Supabase com `supabase start`, só com dados
fictícios. As migrations valem igual nos dois lugares.

## Alternativas descartadas

| Opção | Motivo |
|---|---|
| Google Forms + Planilhas | Não tem permissões finas, e a planilha inteira vaza num link. Fica como plano B só para o cadastro |
| Firebase | É NoSQL, o que dificulta os filtros por região e habilidade, e as regras de acesso são menos testáveis |
| Backend próprio (Django/Express) | Exigiria refazer o login e as regras de acesso que o Supabase já entrega |
| Supabase em nuvem, Vercel ou Cloudflare | Os motivos estão no ADR 0009 |

## Consequências

- (+) Os voluntários nunca tocam a produção.
- (+) A RLS é testada no CI.
- (−) A RLS é o ponto mais fácil de errar. A mitigação é um teste obrigatório: toda tabela
  precisa ter RLS.
