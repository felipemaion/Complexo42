#!/usr/bin/env bash
# Teste do trivy-gate.py (#153): reprova só alto/crítico com correção; varredura vazia reprova.
set -uo pipefail
AQUI=$(cd "$(dirname "$0")" && pwd); GATE="$AQUI/trivy-gate.py"
acertos=0; falhas=0
verifica() {
  if [ "$2" = 0 ]; then acertos=$((acertos+1)); printf '  ok     %s\n' "$1"
  else falhas=$((falhas+1)); printf '  FALHA  %s\n' "$1"; fi
}
BASE=$(mktemp -d); trap 'rm -rf -- "$BASE"' EXIT
PKGS='"Packages":[{"Name":"openssl"},{"Name":"next"}]'
vuln() { printf '{"VulnerabilityID":"%s","Severity":"%s","PkgName":"openssl","InstalledVersion":"3.0.0","FixedVersion":"%s"}' "$1" "$2" "$3"; }
caso() { # caso <descrição> <esperado: 0|1> <json>
  printf '%s' "$3" > "$BASE/t.json"; python3 "$GATE" "$BASE/t.json" > "$BASE/saida" 2>&1; rc=$?
  [ "$rc" = "$2" ]; verifica "$1" $?
}
caso "imagem limpa passa e diz quanto varreu" 0 "{\"Results\":[{\"Target\":\"alpine\",$PKGS}]}"
grep -q '1 alvo(s), 2 pacote(s)' "$BASE/saida"; verifica "o resumo mostra alvos e pacotes varridos" $?
caso "alto com correção reprova" 1 "{\"Results\":[{\"Target\":\"alpine\",$PKGS,\"Vulnerabilities\":[$(vuln CVE-2026-1111 HIGH 3.0.9)]}]}"
grep -q 'CVE-2026-1111 | HIGH' "$BASE/saida"; verifica "e a tabela traz o CVE" $?
caso "crítico sem correção só relata" 0 "{\"Results\":[{\"Target\":\"alpine\",$PKGS,\"Vulnerabilities\":[$(vuln CVE-2026-2222 CRITICAL '')]}]}"
grep -q 'Só relatório' "$BASE/saida" && grep -q 'CVE-2026-2222' "$BASE/saida"; verifica "e aparece no relatório" $?
caso "sem alvo nenhum reprova (não mediu)" 1 '{"Results":[]}'
caso "sem Results reprova" 1 '{}'
caso "alvo sem pacote listado reprova (não mediu)" 1 '{"Results":[{"Target":"alpine","Packages":[]}]}'
caso "JSON quebrado reprova" 1 '{"Results":'
printf '\n%s acertos, %s falhas\n' "$acertos" "$falhas"
[ "$falhas" = 0 ]
