#!/usr/bin/env bash
# Cópia do backup cifrado para fora da VPS (issue #84, ADR 0009 §4).
#
# POR QUE EXISTE: backup que mora no mesmo disco do banco não é backup. Se a
# instância sumir, ele some junto. Só a cópia fora da VPS sobrevive a isso.
#
# O arquivo sai do servidor JÁ CIFRADO, então o destino é tratado como não
# confiável por desenho: quem obtiver os arquivos no destino não obtém os
# dados, porque a chave privada nunca esteve no servidor nem no destino.
#
# Destino: Google Drive via rclone com escopo `drive.file` -- o rclone só vê os
# arquivos que ele mesmo criou, não a conta inteira. Essa escolha é o que
# limita o estrago de um token roubado do servidor.
#
# O `rclone` tem de estar no host (não há variante em container como no `age`):
# a autorização OAuth é interativa e o token fica no arquivo de configuração do
# host, então um container descartável não teria onde guardá-lo.
#
# Caminhos e nomes do ambiente vêm do ambiente, nunca deste arquivo: este
# repositório é público e não carrega endereço, usuário nem caminho de servidor.
#
# Uso:
#   BACKUP_DIR=<dir local> RCLONE_REMOTO=<remoto:pasta> ./enviar-backup.sh
#   RCLONE_REMOTO=<remoto:pasta> ./enviar-backup.sh --baixar-ultimo <dir>
set -euo pipefail
umask 077

MANTER_DIARIOS=${MANTER_DIARIOS:-7}
MANTER_SEMANAIS=${MANTER_SEMANAIS:-4}

# Diagnóstico vai para o stderr, não para o stdout: o modo --baixar-ultimo
# imprime o caminho baixado no stdout, e o chamador lê isso. Misturar as duas
# coisas faria o teste de restauração receber log no lugar do caminho.
log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2; }

# ── nomes dos .age de uma pasta remota, MAIS NOVO PRIMEIRO ──
# Ordena pelo NOME, não pela data do destino: o nome carrega o carimbo UTC
# (postgres-20261119T060000Z...), e data de modificação no destino pode ser
# reescrita por quem hospeda. Ordem lexical desses nomes é ordem cronológica.
remoto_lista() {
  rclone lsf --files-only "$1" 2> /dev/null | grep '\.age$' | sort -r || true
}

# ── poda no destino: mesma retenção do local ──
podar_remoto() {
  local pasta=$1 manter=$2 n=0 f
  while read -r f; do
    [ -n "$f" ] || continue
    n=$((n + 1))
    [ "$n" -gt "$manter" ] || continue
    rclone deletefile "$pasta/$f" && log "remoto podado $f"
  done < <(remoto_lista "$pasta")
}

# ── envio de uma pasta, com conferência explícita ──
enviar() {
  local origem=$1 destino=$2
  [ -d "$origem" ] || { log "sem pasta local $origem, nada a enviar"; return 0; }
  rclone copy "$origem" "$destino" --include '*.age' --checksum
  # O `copy` já confere o que transfere; o `check` confere o conjunto todo,
  # inclusive o que ele julgou que já estava lá. É o que pega um arquivo
  # truncado numa execução anterior, que o `copy` daria por pronto.
  rclone check "$origem" "$destino" --include '*.age' --one-way
  log "conferido $origem -> $destino"
}

case "${1:-}" in --funcoes) return 0 2> /dev/null || exit 0 ;; esac

command -v rclone > /dev/null 2>&1 || {
  log "ERRO: \`rclone\` nao esta no host (instale com: sudo apt install rclone)"
  exit 2
}
: "${RCLONE_REMOTO:?falta RCLONE_REMOTO (ex.: meu-drive:pasta/do/ambiente)}"

REMOTO_DIARIO="$RCLONE_REMOTO/diario"
REMOTO_SEMANAL="$RCLONE_REMOTO/semanal"

# ── modo usado pelo teste de restauração: baixa o .age mais novo ──
if [ "${1:-}" = "--baixar-ultimo" ]; then
  DESTINO=${2:?uso: --baixar-ultimo <diretorio>}
  NOME=$(remoto_lista "$REMOTO_DIARIO" | head -1)
  [ -n "$NOME" ] || { log "ERRO: nenhum .age em $REMOTO_DIARIO"; exit 1; }
  mkdir -p "$DESTINO"
  rclone copyto "$REMOTO_DIARIO/$NOME" "$DESTINO/$NOME" --checksum
  log "baixado $NOME"
  printf '%s\n' "$DESTINO/$NOME"
  exit 0
fi

: "${BACKUP_DIR:?falta BACKUP_DIR (o mesmo que o backup.sh usou)}"

log "inicio (destino $RCLONE_REMOTO)"
enviar "$BACKUP_DIR/diario" "$REMOTO_DIARIO"
enviar "$BACKUP_DIR/semanal" "$REMOTO_SEMANAL"

# A poda vem DEPOIS da conferência, nunca antes: podar primeiro e descobrir
# depois que o envio falhou apagaria a única cópia boa.
podar_remoto "$REMOTO_DIARIO" "$MANTER_DIARIOS"
podar_remoto "$REMOTO_SEMANAL" "$MANTER_SEMANAIS"

log "fim (remoto: diarios=$(remoto_lista "$REMOTO_DIARIO" | wc -l | tr -d ' ') semanais=$(remoto_lista "$REMOTO_SEMANAL" | wc -l | tr -d ' '))"
