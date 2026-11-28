#!/usr/bin/env bash
# Teste do semgrep-gate.py (#153): reprova achado ERROR; WARNING e INFO só relatam; nada varrido reprova.
set -uo pipefail
AQUI=$(cd "$(dirname "$0")" && pwd); GATE="$AQUI/semgrep-gate.py"
acertos=0; falhas=0
verifica() {
  if [ "$2" = 0 ]; then acertos=$((acertos+1)); printf '  ok     %s\n' "$1"
  else falhas=$((falhas+1)); printf '  FALHA  %s\n' "$1"; fi
}
BASE=$(mktemp -d); trap 'rm -rf -- "$BASE"' EXIT
achado() { printf '{"check_id":"regras.%s","path":"src/a.ts","start":{"line":7},"extra":{"severity":"%s"}}' "$1" "$2"; }
caso() { # caso <descrição> <esperado: 0|1> <json>
  printf '%s' "$3" > "$BASE/s.json"; python3 "$GATE" "$BASE/s.json" > "$BASE/saida" 2>&1; rc=$?
  [ "$rc" = "$2" ]; verifica "$1" $?
}
VARRIDOS='"paths":{"scanned":["src/a.ts","src/b.ts"]}'
caso "sem achado passa e diz quanto varreu" 0 "{\"results\":[],$VARRIDOS}"
grep -q '0 achado(s) em 2 arquivo(s)' "$BASE/saida"; verifica "o resumo mostra os arquivos varridos" $?
caso "achado ERROR reprova" 1 "{\"results\":[$(achado sql-injection ERROR)],$VARRIDOS}"
grep -q 'sql-injection | ERROR | src/a.ts:7' "$BASE/saida"; verifica "e a tabela traz regra, severidade e linha" $?
caso "WARNING e INFO só relatam" 0 "{\"results\":[$(achado x WARNING),$(achado y INFO)],$VARRIDOS}"
grep -q '2 achado(s)' "$BASE/saida"; verifica "e aparecem no relatório" $?
caso "nenhum arquivo varrido reprova (não mediu)" 1 '{"results":[],"paths":{"scanned":[]}}'
caso "erro do Semgrep (regra não baixou) reprova" 1 "{\"results\":[],$VARRIDOS,\"errors\":[{\"level\":\"error\",\"type\":\"Network error\"}]}"
caso "JSON quebrado reprova" 1 '{"results":'
printf '\n%s acertos, %s falhas\n' "$acertos" "$falhas"
[ "$falhas" = 0 ]
