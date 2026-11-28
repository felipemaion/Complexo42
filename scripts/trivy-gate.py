#!/usr/bin/env python3
"""Portão do Trivy (#153). Lê o JSON de `trivy image --severity HIGH,CRITICAL --list-all-pkgs` (já com
o security/trivyignore.yaml aplicado) e reprova SÓ alto ou crítico COM correção (FixedVersion). O resto
vai para o relatório. Imagem sem nenhum alvo ou sem pacotes listados reprova: não medir não é "limpo".
Uso: trivy-gate.py <trivy.json>"""
import json
import sys


def avalia(relatorio):
    alvos = relatorio.get("Results") or []
    pacotes = sum(len(a.get("Packages") or []) for a in alvos)
    if not alvos or pacotes == 0:
        raise ValueError("o Trivy não achou alvo nem pacote na imagem: a varredura não mediu nada")
    reprova, relatorio_so = [], []
    for alvo in alvos:
        for v in alvo.get("Vulnerabilities") or []:
            item = (v["VulnerabilityID"], v["Severity"], v["PkgName"], v.get("InstalledVersion", ""), v.get("FixedVersion", ""), alvo["Target"])
            (reprova if v.get("FixedVersion") else relatorio_so).append(item)
    return {"alvos": len(alvos), "pacotes": pacotes, "reprova": reprova, "relatorio": relatorio_so}


def resumo(r):
    linhas = [f"### Trivy (imagem): {r['alvos']} alvo(s), {r['pacotes']} pacote(s) varridos"]
    for titulo, itens in (("Reprova (alto/crítico com correção)", r["reprova"]), ("Só relatório (sem correção)", r["relatorio"])):
        if not itens:
            linhas.append(f"**{titulo}:** nenhum")
            continue
        linhas += [f"**{titulo}:**", "", "| id | severidade | pacote | instalada | corrigida em | alvo |", "|---|---|---|---|---|---|"]
        linhas += [f"| {' | '.join(i)} |" for i in itens]
    return "\n".join(linhas)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("uso: trivy-gate.py <trivy.json>")
    try:
        with open(sys.argv[1], encoding="utf-8") as f:
            r = avalia(json.load(f))
    except (ValueError, KeyError, json.JSONDecodeError) as erro:
        sys.exit(f"ERRO: {erro}")
    print(resumo(r))
    sys.exit(1 if r["reprova"] else 0)
