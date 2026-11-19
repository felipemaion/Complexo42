#!/usr/bin/env bash
# Teste do backup.sh (R2). Roda em diretório temporário, sem Docker e sem
# precisar de banco: exercita a poda, as exigências de ambiente e a regra de
# que nada operacional do servidor pode estar escrito nos scripts públicos.
set -uo pipefail
AQUI=$(cd "$(dirname "$0")" && pwd)
TMPD=$(mktemp -d); trap 'rm -rf "$TMPD"' EXIT
FALHAS=0
ok()    { printf "  ok   %s\n" "$1"; }
falha() { printf "  FALHA %s\n" "$1"; FALHAS=$((FALHAS+1)); }
checa() { if [ "$2" = "$3" ]; then ok "$1"; else falha "$1 (esperado $3, obtido $2)"; fi; }

# shellcheck source=/dev/null
. "$AQUI/backup.sh" --funcoes
# ARMADILHA: carregar o script traz o `set -euo pipefail` DELE para este shell.
# Com `-e` ligado, o primeiro comando que retorna != 0 -- e aqui vários retornam
# de propósito, porque é o que estamos testando -- mata o teste no meio, sem
# mensagem. Desligar logo após carregar.
set +e

# ── poda ──────────────────────────────────────────────────────────────────
D="$TMPD/diario"; mkdir -p "$D"
for i in 1 2 3 4 5 6 7 8 9 10; do
  f="$D/postgres-$i.dump.age"; : > "$f"
  touch -t "20261101120$(printf %01d $((i % 10)))" "$f" 2>/dev/null || touch "$f"
  sleep 0.01
done
podar "$D" 7 > /dev/null
checa "poda deixa exatamente 7" "$(ls -1 "$D"/*.age 2>/dev/null | wc -l | tr -d ' ')" "7"

# o mais NOVO tem de sobreviver; apagar o novo e guardar o velho é o pior erro
NOVO=$(ls -1t "$D"/*.age | head -1)
[ -f "$NOVO" ] && ok "o mais novo sobreviveu" || falha "o mais novo foi podado"

podar "$TMPD/nao-existe" 7 > /dev/null 2>&1
checa "poda em diretorio inexistente nao falha" "$?" "0"

VAZIO="$TMPD/vazio"; mkdir -p "$VAZIO"
podar "$VAZIO" 4 > /dev/null 2>&1
checa "poda em diretorio vazio nao falha" "$?" "0"

# ── exigências de ambiente ────────────────────────────────────────────────
# Sem ambiente nenhum, o script tem de recusar, e nao sair 0 calado.
( env -i PATH="$PATH" bash "$AQUI/backup.sh" ) > /dev/null 2>&1
[ "$?" -ne 0 ] && ok "recusa rodar sem as variaveis de ambiente" \
               || falha "rodou sem ambiente nenhum"

# Chave pública malformada tem de parar ANTES de cifrar qualquer coisa.
saida=$(COMPOSE_FILE=/x ENV_FILE=/x PROJECT_DIR=/x BACKUP_DIR="$TMPD/b" \
        AGE_RECIPIENT="chave-errada" bash "$AQUI/backup.sh" 2>&1)
if [ "$?" -eq 2 ] && printf '%s' "$saida" | grep -q "age1"; then
  ok "recusa chave publica malformada, com mensagem util"
else
  falha "aceitou chave publica malformada"
fi

# ── o repositório é público: nada de servidor escrito nos scripts ─────────
# (R7 e a regra do projeto: nem IP, nem usuário, nem caminho do servidor)
# O próprio teste fica de fora: é ele que CARREGA o padrão, e se incluir a si
# mesmo acusa a si mesmo. Falso positivo clássico de varredura de segredo.
for arq in backup.sh restore-test.sh; do
  if grep -nE '(^|[^0-9])(167\.|/home/[a-z]|ubuntu@|maionesys\.com)' "$AQUI/$arq" > /dev/null; then
    falha "$arq tem endereco, usuario ou caminho de servidor"
  else
    ok "$arq sem dado operacional do servidor"
  fi
done

# ── o dump nunca pode ir para o disco em claro ────────────────────────────
# Guarda contra alguém "simplificar" o pipe para um arquivo intermediário.
if grep -nE 'pg_dump[^|]*>' "$AQUI/backup.sh" | grep -v '|' > /dev/null; then
  falha "backup.sh parece gravar o pg_dump direto em arquivo"
else
  ok "o pg_dump so sai por pipe, nunca para arquivo em claro"
fi

echo
[ "$FALHAS" -eq 0 ] && { echo "TODOS OS TESTES PASSARAM"; exit 0; } || { echo "$FALHAS teste(s) falharam"; exit 1; }
