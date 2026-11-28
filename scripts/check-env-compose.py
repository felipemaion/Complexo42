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


def ambiente(caminho: str) -> dict[str, str | None]:
    """Mapa chave -> valor literal de `services.app.environment` (sem interpolar)."""
    doc = yaml.safe_load(open(caminho, encoding="utf-8"))
    try:
        amb = doc["services"]["app"]["environment"]
    except (KeyError, TypeError):
        sys.exit(f"ERRO: nao achei services.app.environment em {caminho}")
    # None = "repassada SEM valor": tanto `CHAVE:` no mapa quanto `- CHAVE` na
    # lista mandam o compose pegar do ambiente do host. Nao e string vazia, e
    # confundir os dois foi o falso negativo apontado em revisao.
    if isinstance(amb, dict):
        return {str(k): None if v is None else str(v) for k, v in amb.items()}
    if isinstance(amb, list):
        itens: dict[str, str | None] = {}
        for item in amb:
            texto = str(item)
            if "=" in texto:
                nome, _, valor = texto.partition("=")
                itens[nome.strip()] = valor
            else:
                itens[texto.strip()] = None
        return itens
    sys.exit(f"ERRO: services.app.environment em {caminho} nao e mapa nem lista")


REF = re.compile(r"\$\{([A-Za-z_][A-Za-z0-9_]*)([^}]*)\}")


def forma_garante_presenca(valor: str | None) -> tuple[bool, str]:
    """A forma escrita no compose GARANTE que a variavel chega com conteudo?

    Lista de PERMISSAO, nao de proibicao -- e a correcao do bloqueante na
    revisao do #284. Proibir `:-` deixava passar `${X}`, `${X-}` e `- X`, que
    resolvem para vazio do mesmo jeito; e o preflight nao salva, porque
    `compose config -q` sai **0** para variavel nao definida (so avisa:
    medido em 2026-11-28). Lista de proibicao envelhece a cada forma nova da
    sintaxe; lista de permissao recusa o que nao conhece.
    """
    if valor is None:
        return False, "repassada sem valor (`CHAVE:` ou `- CHAVE`): vem do ambiente do host"
    # `$$` e o escape do compose para um `$` literal -- nao e referencia.
    limpo = valor.replace("$$", "")
    refs = REF.findall(limpo)
    if "${" in limpo and not refs:
        return False, "interpolacao em forma que esta guarda nao sabe ler"
    if not refs:
        return True, "valor literal"
    for nome, resto in refs:
        # `${X:?}` e `${X?}` recusam; qualquer outra forma resolve calada --
        # inclusive `${X:-padrao}`, que entrega um padrao silencioso para uma
        # variavel declarada obrigatoria. Decisao registrada: isso e ERRO.
        if not resto.startswith(("?", ":?")):
            return False, f"referencia a {nome} sem `:?` -- resolve calada (vazio ou padrao)"
    return True, "referencia estrita"


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

    # ── estado 2: obrigatoria, repassada, mas em forma que resolve calada ──
    frouxas = [(k, forma_garante_presenca(amb[k])[1]) for k in sorted(exigidas) if k in amb]
    frouxas = [(k, m) for k, m in frouxas if not forma_garante_presenca(amb[k])[0]]
    if frouxas:
        print("ERRO: obrigatorias em producao em forma que NAO garante presenca:")
        for k, motivo in frouxas:
            print(f"      {k}: {motivo}")
        print("      use `${VAR:?obrigatorio}` ou valor literal. Assim o COMPOSE recusa,")
        print("      com o nome da variavel, em vez de o app morrer depois das migrations.")
        print("      Lembrete medido: `compose config -q` sai 0 para variavel nao definida.")
        erro = True

    # ── estado 3: exigida pelo compose e desconhecida do env.ts ──
    # NAO e erro, e de proposito. Ha caso legitimo: SUPABASE_PUBLIC_URL recebe
    # ${SITE_URL:?}, e quem e obrigatoria e a SITE_URL. Mas vale listar: `:?` no
    # compose e uma obrigatoriedade que nao aparece para quem le o env.ts --
    # o espelho do bug de 2026-11-28, trocado de lado.
    escondidas = sorted(
        k
        for k, v in amb.items()
        if v is not None and any(r.startswith(("?", ":?")) for _, r in REF.findall(v.replace("$$", ""))) and k not in exigidas
    )
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
