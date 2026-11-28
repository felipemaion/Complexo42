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


def repassadas(caminho: str) -> list[str]:
    """Le as chaves de `services.app.environment` do compose do app.

    Via YAML, nao por texto: `environment:` aceita mapa ou lista, e casar
    texto confundiria comentario com configuracao.
    """
    doc = yaml.safe_load(open(caminho, encoding="utf-8"))
    try:
        amb = doc["services"]["app"]["environment"]
    except (KeyError, TypeError):
        sys.exit(f"ERRO: nao achei services.app.environment em {caminho}")
    if isinstance(amb, dict):
        return list(amb.keys())
    if isinstance(amb, list):
        # Forma `- NOME=valor` ou `- NOME`
        return [str(item).split("=", 1)[0].strip() for item in amb]
    sys.exit(f"ERRO: services.app.environment em {caminho} nao e mapa nem lista")


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--env-ts", default=PADRAO_ENV_TS)
    p.add_argument("--compose", default=PADRAO_COMPOSE)
    args = p.parse_args()

    exigidas = obrigatorias(args.env_ts)
    passadas = repassadas(args.compose)

    print("obrigatorias em producao:", ", ".join(sorted(exigidas)))
    print("repassadas pelo compose: ", ", ".join(sorted(passadas)))

    faltando = sorted(set(exigidas) - set(passadas))
    if faltando:
        print("ERRO: exigidas em producao e AUSENTES do compose do app:", ", ".join(faltando))
        print("      o container sobe e falha no primeiro uso -- foi o login do")
        print("      staging em 2026-11-28, com reason=missing_key.")
        return 1
    print("ok: tudo que e obrigatorio em producao chega ao container")
    return 0


if __name__ == "__main__":
    sys.exit(main())
