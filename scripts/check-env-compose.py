#!/usr/bin/env python3
"""Toda variavel obrigatoria em producao tem de ser repassada pelo compose do app.

Por que isto existe: em 2026-11-28 o login do staging falhou com
`auth_access_check_failed reason=missing_key`. As chaves FIELD_ENCRYPTION_KEY e
BLIND_INDEX_KEY estavam no secrets/env, com valor -- e o `environment:` do
docker-compose.app.yml simplesmente nao as listava, entao nunca chegavam ao
container. O `gen-secrets.sh` as gerava e o `env.example` as documentava: tres
lugares concordando e um discordando, em silencio.

Nada pegava porque o container sobe sem elas e so falha no PRIMEIRO USO de
cifra, que e o login. Esta guarda transforma isso em erro de CI.

Uso:
  check-env-compose.py [--env-ts ARQ] [--compose ARQ]
"""

from __future__ import annotations

import argparse
import re
import sys

import yaml

PADRAO_ENV_TS = "src/server/env.ts"
PADRAO_COMPOSE = "deploy/docker-compose.app.yml"


def obrigatorias(caminho: str) -> list[str]:
    """Le a lista REQUIRED_IN_PRODUCTION do env.ts."""
    texto = open(caminho, encoding="utf-8").read()
    m = re.search(r"REQUIRED_IN_PRODUCTION\s*=\s*\[(.*?)\]", texto, re.S)
    if not m:
        sys.exit(f"ERRO: nao achei REQUIRED_IN_PRODUCTION em {caminho}")
    nomes = re.findall(r'"([A-Z_][A-Z0-9_]*)"', m.group(1))
    if not nomes:
        sys.exit(f"ERRO: REQUIRED_IN_PRODUCTION em {caminho} esta vazia -- isso nao e esperado")
    return nomes


def ambiente(caminho: str) -> dict[str, str]:
    """Mapa chave -> valor literal de `services.app.environment` (sem interpolar)."""
    doc = yaml.safe_load(open(caminho, encoding="utf-8"))
    try:
        amb = doc["services"]["app"]["environment"]
    except (KeyError, TypeError):
        sys.exit(f"ERRO: nao achei services.app.environment em {caminho}")
    if isinstance(amb, dict):
        return {str(k): "" if v is None else str(v) for k, v in amb.items()}
    if isinstance(amb, list):
        itens = {}
        for item in amb:
            nome, _, valor = str(item).partition("=")
            itens[nome.strip()] = valor
        return itens
    sys.exit(f"ERRO: services.app.environment em {caminho} nao e mapa nem lista")


# `${VAR:-...}` tolera vazio; `${VAR:?...}` recusa. Valor literal nao interpola
# nada e esta sempre presente.
TOLERA_VAZIO = re.compile(r"\$\{[A-Za-z_][A-Za-z0-9_]*:-")
EXIGE = re.compile(r"\$\{[A-Za-z_][A-Za-z0-9_]*:\?")


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--env-ts", default=PADRAO_ENV_TS)
    p.add_argument("--compose", default=PADRAO_COMPOSE)
    args = p.parse_args()

    exigidas = obrigatorias(args.env_ts)
    amb = ambiente(args.compose)
    passadas = list(amb.keys())

    print("obrigatorias em producao:", ", ".join(sorted(exigidas)))
    print("repassadas pelo compose: ", ", ".join(sorted(passadas)))

    erro = False

    # ── estado 1: obrigatoria e ausente ──
    faltando = sorted(set(exigidas) - set(passadas))
    if faltando:
        print("ERRO: exigidas em producao e AUSENTES do compose do app:", ", ".join(faltando))
        print("      o container sobe e falha no primeiro uso -- foi o login do")
        print("      staging em 2026-11-28, com reason=missing_key.")
        erro = True

    # ── estado 2: obrigatoria, repassada, mas tolerando vazio ──
    # `${VAR:-}` resolve para vazio e o compose sobe feliz; o app entao recusa
    # subir (vazio conta como ausente). A falha so muda de lugar, para mais
    # longe de quem configurou. Obrigatoria pede `:?` ou valor literal.
    frouxas = sorted(k for k in exigidas if k in amb and TOLERA_VAZIO.search(amb[k]))
    if frouxas:
        print("ERRO: obrigatorias em producao repassadas com `:-` (tolera vazio):", ", ".join(frouxas))
        print("      use `${VAR:?obrigatorio}` ou valor literal: assim o COMPOSE")
        print("      recusa, com o nome da variavel, em vez de o app morrer depois.")
        erro = True

    # ── estado 3: exigida pelo compose e desconhecida do env.ts ──
    # NAO e erro, e de proposito. Ha caso legitimo: SUPABASE_PUBLIC_URL recebe
    # ${SITE_URL:?}, e quem e obrigatoria e a SITE_URL. Mas vale listar: `:?` no
    # compose e uma obrigatoriedade que nao aparece para quem le o env.ts --
    # o espelho do bug de 2026-11-28, trocado de lado.
    escondidas = sorted(k for k, v in amb.items() if EXIGE.search(v) and k not in exigidas)
    if escondidas:
        print("aviso: exigidas pelo COMPOSE (`:?`) e fora do REQUIRED_IN_PRODUCTION:", ", ".join(escondidas))
        print("       confira se alguma devia estar na lista do env.ts. Algumas sao")
        print("       legitimas (chave do compose != variavel do env, ex. SUPABASE_PUBLIC_URL).")

    if erro:
        return 1
    print("ok: tudo que e obrigatorio em producao chega ao container, sem tolerar vazio")
    return 0


if __name__ == "__main__":
    sys.exit(main())
