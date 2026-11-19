#!/usr/bin/env bash
# Teste do enviar-backup.sh (issue #84). Usa um `rclone` DUBLÊ no PATH: não
# precisa de rede, de conta no Drive nem de token. O que importa aqui é a
# lógica -- ordem das operações, retenção e o que acontece quando falha.
set -uo pipefail

AQUI=$(cd "$(dirname "$0")" && pwd)
SCRIPT="$AQUI/enviar-backup.sh"
acertos=0
falhas=0

verifica() {
  if [ "$2" = 0 ]; then
    acertos=$((acertos + 1)); printf '  ok     %s\n' "$1"
  else
    falhas=$((falhas + 1)); printf '  FALHA  %s\n' "$1"
  fi
}

BASE=$(mktemp -d)
trap 'rm -rf "$BASE"' EXIT
mkdir -p "$BASE/bin" "$BASE/backups/diario" "$BASE/backups/semanal"
: > "$BASE/backups/diario/postgres-20261119T060000Z.dump.age"
: > "$BASE/backups/semanal/postgres-20261115T060000Z.dump.age"

# ── o dublê: registra o que foi chamado e obedece ao roteiro do teste ──
cat > "$BASE/bin/rclone" << 'DUBLE'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$STUB_CHAMADAS"
[ "$1" = lsf ] && { cat "$STUB_LSF" 2> /dev/null; exit 0; }
case "${STUB_FALHA:-}" in "$1") exit 1 ;; esac
exit 0
DUBLE
chmod +x "$BASE/bin/rclone"
export PATH="$BASE/bin:$PATH"
export STUB_CHAMADAS="$BASE/chamadas" STUB_LSF="$BASE/lista" STUB_FALHA=
: > "$STUB_CHAMADAS"
printf 'postgres-20261119T060000Z.dump.age\npostgres-20261118T060000Z.dump.age\n' > "$STUB_LSF"

echo "== exigências de ambiente"

( . "$SCRIPT" --funcoes ) > /dev/null 2>&1
verifica "--funcoes carrega sem exigir ambiente nenhum" $?

( unset RCLONE_REMOTO; BACKUP_DIR="$BASE/backups" bash "$SCRIPT" ) > /dev/null 2>&1
[ $? -ne 0 ] && r=0 || r=1
verifica "recusa rodar sem RCLONE_REMOTO" $r

( unset BACKUP_DIR; RCLONE_REMOTO=d:x bash "$SCRIPT" ) > /dev/null 2>&1
[ $? -ne 0 ] && r=0 || r=1
verifica "recusa rodar sem BACKUP_DIR" $r

# PATH vazio e bash por caminho absoluto: assim o teste não depende de o
# rclone estar ou não instalado na máquina que roda o teste. `printf` e
# `command -v` são embutidos do bash, então a mensagem de erro ainda sai.
saida=$(PATH= RCLONE_REMOTO=d:x BACKUP_DIR="$BASE/backups" \
  /bin/bash "$SCRIPT" 2>&1); est=$?
[ $est -eq 2 ] && echo "$saida" | grep -q 'rclone' && r=0 || r=1
verifica "sem rclone no host, sai 2 dizendo o que instalar" $r

echo "== envio e conferência"

: > "$STUB_CHAMADAS"
RCLONE_REMOTO=d:x BACKUP_DIR="$BASE/backups" bash "$SCRIPT" > /dev/null 2>&1
verifica "execução completa sai 0" $?
grep -q '^copy .*/diario d:x/diario' "$STUB_CHAMADAS" && r=0 || r=1
verifica "envia a pasta diario" $r
grep -q '^copy .*/semanal d:x/semanal' "$STUB_CHAMADAS" && r=0 || r=1
verifica "envia a pasta semanal" $r
grep -q '^check .*/diario d:x/diario .*--one-way' "$STUB_CHAMADAS" && r=0 || r=1
verifica "confere o diario depois de enviar, de um lado só" $r
# A ordem é a proteção: conferir antes de podar. Se o check vier depois do
# deletefile, uma falha de envio apaga a única cópia boa.
[ "$(grep -n 'check' "$STUB_CHAMADAS" | head -1 | cut -d: -f1)" \
  -lt "$(grep -c '' "$STUB_CHAMADAS")" ] && r=0 || r=1
verifica "o check vem antes do fim do script" $r

echo "== falha no envio não poda nada"

: > "$STUB_CHAMADAS"
STUB_FALHA=check RCLONE_REMOTO=d:x BACKUP_DIR="$BASE/backups" \
  bash "$SCRIPT" > /dev/null 2>&1
[ $? -ne 0 ] && r=0 || r=1
verifica "conferência reprovada derruba o script" $r
grep -q 'deletefile' "$STUB_CHAMADAS" && r=1 || r=0
verifica "e NÃO apaga nada no destino" $r

echo "== retenção no destino"

STUB_FALHA=
for d in 01 02 03 04 05 06 07 08 09; do
  printf 'postgres-202611%sT060000Z.dump.age\n' "$d"
done > "$STUB_LSF"
: > "$STUB_CHAMADAS"
# shellcheck source=/dev/null
. "$SCRIPT" --funcoes
set +e   # o script traz `set -e`; aqui ele mataria o teste no primeiro erro
podar_remoto "d:x/diario" 7
[ "$(grep -c '^deletefile' "$STUB_CHAMADAS")" = 2 ] && r=0 || r=1
verifica "9 no destino com retenção 7 apaga exatamente 2" $r
grep -q 'deletefile d:x/diario/postgres-20261101' "$STUB_CHAMADAS" \
  && grep -q 'deletefile d:x/diario/postgres-20261102' "$STUB_CHAMADAS" && r=0 || r=1
verifica "e apaga os 2 mais ANTIGOS (ordem pelo nome, não pela data remota)" $r

echo "== download para o teste de restauração"

: > "$STUB_CHAMADAS"
dest=$BASE/baixado
saida=$(RCLONE_REMOTO=d:x bash "$SCRIPT" --baixar-ultimo "$dest" 2> /dev/null)
[ "$saida" = "$dest/postgres-20261109T060000Z.dump.age" ] && r=0 || r=1
verifica "--baixar-ultimo escolhe o mais novo e imprime só o caminho" $r

echo "== repositório público"

grep -nEq '([0-9]{1,3}\.){3}[0-9]{1,3}|/home/[a-z]|ubuntu@' "$SCRIPT" && r=1 || r=0
verifica "o script não carrega IP, usuário nem caminho de servidor" $r

printf '\n%s acertos, %s falhas\n' "$acertos" "$falhas"
[ "$falhas" = 0 ]
