#!/usr/bin/env python3
"""Confere o security/trivyignore.yaml (#153): cada exceção é UMA vulnerabilidade, com motivo e
validade. Nada de curinga nem de silenciar em massa: exceção sem motivo, sem data, vencida ou
repetida reprova o build. Uso: check-trivyignore.py <arquivo>"""
import datetime
import re
import sys

import yaml

MOTIVO_MINIMO = 20  # motivo de verdade, não "falso positivo"
ID = re.compile(r"^(CVE-\d{4}-\d{4,}|GHSA(-[a-z0-9]{4}){3})$")


def problemas(conteudo, hoje):
    if not isinstance(conteudo, dict) or set(conteudo) != {"vulnerabilities"}:
        return ["o arquivo só pode ter a chave `vulnerabilities` (nada de misconfigurations, secrets ou licenses em massa)"]
    lista = conteudo["vulnerabilities"]
    if not isinstance(lista, list):
        return ["`vulnerabilities` tem de ser uma lista"]
    erros, vistos = [], set()
    for i, e in enumerate(lista):
        onde = f"vulnerabilities[{i}]"
        if not isinstance(e, dict):
            erros.append(f"{onde}: não é um item"); continue
        vid = e.get("id")
        if not isinstance(vid, str) or not ID.match(vid):
            erros.append(f"{onde}: id tem de ser um CVE ou GHSA")
        elif vid in vistos:
            erros.append(f"{onde}: {vid} repetido")
        vistos.add(vid)
        if not isinstance(e.get("statement"), str) or len(e["statement"].strip()) < MOTIVO_MINIMO:
            erros.append(f"{onde}: statement (o motivo) ausente ou curto demais")
        validade = e.get("expired_at")
        if isinstance(validade, str):
            try:
                validade = datetime.date.fromisoformat(validade)
            except ValueError:
                validade = None
        if not isinstance(validade, datetime.date):
            erros.append(f"{onde}: expired_at tem de ser uma data AAAA-MM-DD")
        elif validade < hoje:
            erros.append(f"{onde}: venceu em {validade}; revise ou remova")
        if "paths" in e or "purls" in e:
            erros.append(f"{onde}: sem `paths`/`purls`: a exceção é da vulnerabilidade, revisada inteira")
    return erros


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("uso: check-trivyignore.py <arquivo>")
    with open(sys.argv[1], encoding="utf-8") as f:
        erros = problemas(yaml.safe_load(f), datetime.date.today())
    for erro in erros:
        print(f"ERRO: {erro}")
    if erros:
        sys.exit(1)
    print("ok: trivyignore com exceções uma a uma, com motivo e validade")
