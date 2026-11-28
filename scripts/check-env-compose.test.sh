#!/usr/bin/env bash
# Teste da guarda check-env-compose.py, com arquivos de mentira e com os de
# verdade. O caso que importa e o ultimo: a guarda tem de APROVAR o compose
# real -- e, antes do conserto de 2026-11-28, ela o REPROVAVA, porque
# FIELD_ENCRYPTION_KEY e BLIND_INDEX_KEY nao eram repassadas.
set -uo pipefail
AQUI=$(cd "$(dirname "$0")" && pwd)
GUARDA="$AQUI/check-env-compose.py"
RAIZ=$(cd "$AQUI/.." && pwd)
acertos=0; falhas=0
verifica() {
  if [ "$2" = 0 ]; then acertos=$((acertos+1)); printf '  ok     %s\n' "$1"
  else falhas=$((falhas+1)); printf '  FALHA  %s\n' "$1"; fi
}

BASE=$(mktemp -d); trap 'rm -rf -- "$BASE"' EXIT

cat > "$BASE/env.ts" << 'TS'
const REQUIRED_IN_PRODUCTION = ["A_KEY", "B_KEY"] as const;
TS

cat > "$BASE/falta.yml" << 'YML'
services:
  app:
    environment:
      A_KEY: ${A_KEY:?obrigatorio}
      OUTRA: valor
YML

cat > "$BASE/completo.yml" << 'YML'
services:
  app:
    environment:
      A_KEY: ${A_KEY:?obrigatorio}
      B_KEY: ${B_KEY:?obrigatorio}
YML

# `environment:` tambem aceita lista. A guarda le YAML justamente para nao
# depender da forma.
cat > "$BASE/lista.yml" << 'YML'
services:
  app:
    environment:
      - A_KEY=${A_KEY:?obrigatorio}
      - B_KEY=${B_KEY:?obrigatorio}
YML

cat > "$BASE/sem-app.yml" << 'YML'
services:
  outro:
    image: x
YML

echo "== a guarda reprova o que falta, e diz o nome"
saida=$(python3 "$GUARDA" --env-ts "$BASE/env.ts" --compose "$BASE/falta.yml" 2>&1); codigo=$?
[ "$codigo" -ne 0 ] && r=0 || r=1
verifica "variavel obrigatoria ausente do compose REPROVA" $r
grep -q 'B_KEY' <<< "$saida" && r=0 || r=1
verifica "e diz qual variavel falta" $r
grep -q 'A_KEY' <<< "${saida#*AUSENTES}" && r=1 || r=0
verifica "e nao acusa a que esta presente" $r

echo "== e aprova o que esta completo, nas duas formas de escrever"
python3 "$GUARDA" --env-ts "$BASE/env.ts" --compose "$BASE/completo.yml" > /dev/null 2>&1
verifica "mapa completo passa" $?
python3 "$GUARDA" --env-ts "$BASE/env.ts" --compose "$BASE/lista.yml" > /dev/null 2>&1
verifica "lista completa passa (environment: aceita as duas formas)" $?

echo "== falha FECHADO quando nao consegue ler"
python3 "$GUARDA" --env-ts "$BASE/env.ts" --compose "$BASE/sem-app.yml" > /dev/null 2>&1
[ $? -ne 0 ] && r=0 || r=1
verifica "compose sem services.app.environment REPROVA (nao passa calado)" $r
python3 "$GUARDA" --env-ts "$BASE/falta.yml" --compose "$BASE/completo.yml" > /dev/null 2>&1
[ $? -ne 0 ] && r=0 || r=1
verifica "env.ts sem REQUIRED_IN_PRODUCTION REPROVA" $r

echo "== e o caso de verdade: os arquivos do repositorio"
saida=$(cd "$RAIZ" && python3 "$GUARDA" 2>&1); codigo=$?
[ "$codigo" = 0 ] && r=0 || r=1
verifica "o compose do app repassa tudo o que e obrigatorio em producao" $r
[ "$r" = 1 ] && printf '%s\n' "$saida" | sed 's/^/         /'

printf '\n%s acertos, %s falhas\n' "$acertos" "$falhas"
[ "$falhas" = 0 ]
