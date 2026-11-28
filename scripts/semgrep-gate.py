#!/usr/bin/env python3
"""Portão do Semgrep (#153). Lê o JSON de `semgrep scan --json` e reprova achado de severidade
ERROR; WARNING e INFO vão só para o relatório. Varredura sem arquivo ou com erro do próprio Semgrep
(regra que não baixou, por exemplo) também reprova: não medir não é "limpo".
Supressão é na linha (`nosemgrep: <regra> -- motivo`), que o Semgrep já tira do `results`.
Uso: semgrep-gate.py <semgrep.json>"""
import json
import sys


def avalia(saida):
    varridos = saida["paths"]["scanned"]
    if not varridos:
        raise ValueError("o Semgrep não varreu nenhum arquivo")
    erros = [e for e in saida.get("errors") or [] if e.get("level") == "error"]
    if erros:
        raise ValueError(f"o Semgrep terminou com erro: {', '.join(e.get('type', '?') for e in erros)}")
    achados = saida["results"]
    reprova = [a for a in achados if a["extra"]["severity"] == "ERROR"]
    return {"varridos": len(varridos), "achados": achados, "reprova": reprova}


def resumo(r):
    linhas = [f"### Semgrep: {len(r['achados'])} achado(s) em {r['varridos']} arquivo(s); {len(r['reprova'])} reprova(m) (ERROR)"]
    if r["achados"]:
        linhas += ["| regra | severidade | arquivo:linha |", "|---|---|---|"]
        linhas += [f"| {a['check_id'].split('.')[-1]} | {a['extra']['severity']} | {a['path']}:{a['start']['line']} |" for a in r["achados"]]
    return "\n".join(linhas)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("uso: semgrep-gate.py <semgrep.json>")
    try:
        with open(sys.argv[1], encoding="utf-8") as f:
            r = avalia(json.load(f))
    except (ValueError, KeyError, TypeError, json.JSONDecodeError) as erro:
        sys.exit(f"ERRO: {erro}")
    print(resumo(r))
    sys.exit(1 if r["reprova"] else 0)
