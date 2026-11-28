#!/usr/bin/env bash
# Teste da guarda check-trivyignore.py (#153): exceção do Trivy só uma a uma, com motivo e validade.
# O último caso é o arquivo de verdade, que tem de passar.
set -uo pipefail
AQUI=$(cd "$(dirname "$0")" && pwd); GUARDA="$AQUI/check-trivyignore.py"; RAIZ=$(cd "$AQUI/.." && pwd)
acertos=0; falhas=0
verifica() {
  if [ "$2" = 0 ]; then acertos=$((acertos+1)); printf '  ok     %s\n' "$1"
  else falhas=$((falhas+1)); printf '  FALHA  %s\n' "$1"; fi
}
BASE=$(mktemp -d); trap 'rm -rf -- "$BASE"' EXIT
FUTURO=$(( $(date +%Y) + 1 ))-12-31
MOTIVO="só alcançável no build; a imagem final não leva o pacote"

caso() { # caso <descrição> <esperado: passa|reprova> <conteúdo>
  printf '%s\n' "$3" > "$BASE/t.yaml"
  python3 "$GUARDA" "$BASE/t.yaml" > "$BASE/saida" 2>&1; rc=$?
  if [ "$2" = passa ]; then [ "$rc" = 0 ]; else [ "$rc" != 0 ]; fi
  verifica "$1" $?
}

caso "lista vazia passa" passa 'vulnerabilities: []'
caso "uma exceção com id, motivo e validade passa" passa "vulnerabilities:
  - id: CVE-2026-12345
    statement: $MOTIVO
    expired_at: $FUTURO"
caso "GHSA também é id" passa "vulnerabilities:
  - id: GHSA-abcd-efgh-ijkl
    statement: $MOTIVO
    expired_at: $FUTURO"
caso "sem motivo reprova" reprova "vulnerabilities:
  - id: CVE-2026-12345
    expired_at: $FUTURO"
caso "motivo curto reprova" reprova "vulnerabilities:
  - id: CVE-2026-12345
    statement: falso positivo
    expired_at: $FUTURO"
caso "sem validade reprova" reprova "vulnerabilities:
  - id: CVE-2026-12345
    statement: $MOTIVO"
caso "validade vencida reprova" reprova "vulnerabilities:
  - id: CVE-2026-12345
    statement: $MOTIVO
    expired_at: 2020-01-01"
caso "id curinga reprova" reprova "vulnerabilities:
  - id: '*'
    statement: $MOTIVO
    expired_at: $FUTURO"
caso "id repetido reprova" reprova "vulnerabilities:
  - id: CVE-2026-12345
    statement: $MOTIVO
    expired_at: $FUTURO
  - id: CVE-2026-12345
    statement: $MOTIVO
    expired_at: $FUTURO"
caso "exceção limitada a caminho (paths) reprova" reprova "vulnerabilities:
  - id: CVE-2026-12345
    statement: $MOTIVO
    expired_at: $FUTURO
    paths: [usr/lib/x]"
caso "silenciar outras categorias em massa (misconfigurations) reprova" reprova "vulnerabilities: []
misconfigurations:
  - id: '*'"

python3 "$GUARDA" "$RAIZ/security/trivyignore.yaml" > /dev/null 2>&1; verifica "o security/trivyignore.yaml do repositório passa" $?

printf '\n%s acertos, %s falhas\n' "$acertos" "$falhas"
[ "$falhas" = 0 ]
