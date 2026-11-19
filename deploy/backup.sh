#!/usr/bin/env bash
# Backup cifrado do Postgres (issue #84, ADR 0009 §4, ADR 0003).
#
# REGRA DE OURO: o dump em claro NUNCA toca o disco. O `pg_dump` sai do
# container do banco por um pipe e entra direto no `age`; o que chega ao disco
# já está cifrado. Por isso não há arquivo intermediário, nem mesmo em /tmp.
#
# Só a chave PÚBLICA fica no servidor. A privada nasce e vive fora dele
# (ADR 0003 §7): quem cifra não consegue decifrar, e um servidor comprometido
# não entrega o conteúdo dos backups.
#
# Caminhos e nomes do ambiente vêm do ambiente, nunca deste arquivo: este
# repositório é público e não carrega endereço, usuário nem caminho de servidor.
#
# Uso:
#   COMPOSE_FILE=... ENV_FILE=... PROJECT_DIR=... BACKUP_DIR=... \
#   AGE_RECIPIENT=age1... ./backup.sh
set -euo pipefail
umask 077

DB_SERVICO=${DB_SERVICO:-db}
DB_USER=${DB_USER:-supabase_admin}
DB_NOME=${DB_NOME:-postgres}
MANTER_DIARIOS=${MANTER_DIARIOS:-7}
MANTER_SEMANAIS=${MANTER_SEMANAIS:-4}
# Imagem com o `age`, para o caso de ele não existir no host. Fixada por digest
# como o resto do deploy; sem digest, "a mesma tag" pode virar outra imagem.
AGE_IMAGEM=${AGE_IMAGEM:-}
TAM_MINIMO=${TAM_MINIMO:-2048}   # bytes; dump menor que isto é suspeito

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

# ── como cifrar: `age` no host, se existir; senão, container descartável ──
cifrador() {
  if command -v age > /dev/null 2>&1; then
    age -r "$AGE_RECIPIENT"
  elif [ -n "$AGE_IMAGEM" ]; then
    docker run --rm -i "$AGE_IMAGEM" age -r "$AGE_RECIPIENT"
  else
    log "ERRO: sem \`age\` no host e sem AGE_IMAGEM definida"
    exit 2
  fi
}

# ── poda: 7 diários, 4 semanais. Função separada para poder ser testada ──
podar() {
  local dir=$1 manter=$2 n=0 f
  [ -d "$dir" ] || return 0
  # mais novo primeiro; a partir do (manter+1), apaga
  for f in $(ls -1t "$dir"/*.age 2> /dev/null || true); do
    n=$((n + 1))
    if [ "$n" -gt "$manter" ]; then
      rm -f -- "$f"
      log "podado $(basename "$f")"
    fi
  done
}

# Quando carregado por outro script (o teste), para por aqui: só as funções,
# sem exigir ambiente nenhum. Por isso as exigências vêm DEPOIS desta linha.
case "${1:-}" in --funcoes) return 0 2>/dev/null || exit 0 ;; esac

: "${COMPOSE_FILE:?falta COMPOSE_FILE (compose do Supabase do ambiente)}"
: "${ENV_FILE:?falta ENV_FILE (arquivo de segredos do ambiente)}"
: "${PROJECT_DIR:?falta PROJECT_DIR (diretório de deploy do ambiente)}"
: "${BACKUP_DIR:?falta BACKUP_DIR (onde guardar os .age)}"
: "${AGE_RECIPIENT:?falta AGE_RECIPIENT (chave PÚBLICA age1...)}"

# A chave pública tem formato conhecido. Errar aqui produziria arquivo cifrado
# para um destinatário que ninguém controla -- backup perdido sem aviso.
case "$AGE_RECIPIENT" in
  age1*) : ;;
  *) log "ERRO: AGE_RECIPIENT nao parece chave publica age (age1...)"; exit 2 ;;
esac

DIARIO="$BACKUP_DIR/diario"
SEMANAL="$BACKUP_DIR/semanal"
mkdir -p "$DIARIO" "$SEMANAL"
chmod 700 "$BACKUP_DIR" "$DIARIO" "$SEMANAL"

CARIMBO=$(date -u +%Y%m%dT%H%M%SZ)
ALVO="$DIARIO/postgres-$CARIMBO.dump.age"
PARCIAL="$ALVO.parcial"
trap 'rm -f "$PARCIAL"' EXIT

log "inicio ($DB_NOME via servico $DB_SERVICO)"

# O status do pg_dump importa mais que o do age: sem PIPESTATUS, um dump que
# falha no meio vira um .age pequeno e "bem-sucedido".
set +e
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" \
  --project-directory "$PROJECT_DIR" \
  exec -T "$DB_SERVICO" pg_dump -U "$DB_USER" -d "$DB_NOME" -Fc \
  | cifrador > "$PARCIAL"
ESTADO=("${PIPESTATUS[@]}")
set -e
if [ "${ESTADO[0]}" -ne 0 ] || [ "${ESTADO[1]}" -ne 0 ]; then
  log "ERRO: pg_dump saiu ${ESTADO[0]}, cifrador saiu ${ESTADO[1]}"
  exit 1
fi

# Duas conferências baratas que pegam o desastre silencioso:
TAM=$(wc -c < "$PARCIAL")
if [ "$TAM" -lt "$TAM_MINIMO" ]; then
  log "ERRO: arquivo de $TAM bytes, abaixo do minimo de $TAM_MINIMO"
  exit 1
fi
if ! head -c 21 "$PARCIAL" | grep -q "age-encryption.org"; then
  log "ERRO: cabecalho nao e de arquivo age -- o conteudo pode estar em claro"
  exit 1
fi

chmod 600 "$PARCIAL"
mv "$PARCIAL" "$ALVO"
trap - EXIT
log "gravado $(basename "$ALVO") ($TAM bytes)"

# Domingo também entra na série semanal. Link duro: não gera segundo dump nem
# ocupa espaço a mais, e some sozinho quando as duas pontas forem podadas.
if [ "$(date -u +%u)" = "7" ]; then
  ln -f "$ALVO" "$SEMANAL/$(basename "$ALVO")"
  log "semanal: $(basename "$ALVO")"
fi

podar "$DIARIO" "$MANTER_DIARIOS"
podar "$SEMANAL" "$MANTER_SEMANAIS"

log "fim (diarios=$(ls -1 "$DIARIO"/*.age 2>/dev/null | wc -l | tr -d ' ') semanais=$(ls -1 "$SEMANAL"/*.age 2>/dev/null | wc -l | tr -d ' '))"
