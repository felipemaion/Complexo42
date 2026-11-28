#!/usr/bin/env bash
# Vigia do servidor (issue #85): disco, memória dos containers, saúde dos containers, idade do backup
# e validade do certificado. Roda por timer do systemd a cada 5 min (docs/OPERACAO.md, "Vigia");
# fica FORA da imagem e é instalado à mão, como os outros scripts de operador.
#
# Contra alerta falso: cada checagem tem um arquivo de estado em $ESTADO_DIR. Só alerta na 2ª
# medição ruim SEGUIDA, avisa na TRANSIÇÃO (ALERTA, RESOLVIDO) e, se o problema continua, manda um
# LEMBRETE a cada $LEMBRETE_HORAS. Nunca um e-mail a cada 5 minutos.
# Não conseguir medir (Docker fora, por exemplo) conta como medição ruim: "não sei" não é "tudo ok".
#
# O alerta sai por e-mail pelo relay SMTP do ambiente (SMTP_* do arquivo de segredos, o mesmo do
# GoTrue). A senha vai ao curl por arquivo temporário (-K), nunca por argumento. Com ALERTA_PARA
# vazio, nada é enviado: só registrado. É assim que se instala antes de o remetente existir.
#
# Configuração (ambiente, normalmente do EnvironmentFile do timer):
#   AMBIENTE      nome do ambiente no assunto (obrigatório)
#   ESTADO_DIR    onde guardar o estado (obrigatório)          REGISTRO   arquivo de log (obrigatório)
#   DISCOS        caminhos a medir, separados por espaço       DISCO_LIMITE   % (80)
#   PROJETOS      projetos Compose cujos containers vigiar     MEM_LIMITE     % do mem_limit (90)
#   BACKUP_DIR    pasta do backup.sh (vazio: não confere)      BACKUP_MAX_HORAS (26)
#   CERT_HOST     domínio do certificado (vazio: não confere)  CERT_DIAS (15)
#   ENV_FILE      arquivo de segredos com SMTP_*               ALERTA_DE, ALERTA_PARA (vírgulas)
#   LEMBRETE_HORAS (6)
# Saídas: 0 rodou (com ou sem alerta), 2 configuração faltando.
set -euo pipefail
umask 077
{ set +x; } 2> /dev/null

for v in AMBIENTE ESTADO_DIR REGISTRO; do
  [ -n "${!v:-}" ] || { echo "falta $v" >&2; exit 2; }
done
DISCOS=${DISCOS:-/}
DISCO_LIMITE=${DISCO_LIMITE:-80}
PROJETOS=${PROJETOS:-}
MEM_LIMITE=${MEM_LIMITE:-90}
BACKUP_DIR=${BACKUP_DIR:-}
BACKUP_MAX_HORAS=${BACKUP_MAX_HORAS:-26}
CERT_HOST=${CERT_HOST:-}
CERT_DIAS=${CERT_DIAS:-15}
LEMBRETE_HORAS=${LEMBRETE_HORAS:-6}
ALERTA_DE=${ALERTA_DE:-}
ALERTA_PARA=${ALERTA_PARA:-}
ENV_FILE=${ENV_FILE:-}
# Relógio injetável só para o teste; em produção, o de sempre.
AGORA=${VIGIA_AGORA:-$(date +%s)}

mkdir -p "$ESTADO_DIR"
registra() { printf '%s vigia %s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$AMBIENTE" "$*" >> "$REGISTRO"; }

# ── envio: só se ALERTA_PARA e o relay estiverem configurados ──
envia() { # envia <assunto> <corpo>
  [ -n "$ALERTA_PARA" ] || return 0
  local host porta usuario senha url cfg r
  local -a rcpt args
  [ -r "$ENV_FILE" ] || { registra "ERRO envio: sem arquivo de segredos"; return 0; }
  host=$(sed -n 's/^SMTP_HOST=//p' "$ENV_FILE" | head -n1); porta=$(sed -n 's/^SMTP_PORT=//p' "$ENV_FILE" | head -n1)
  usuario=$(sed -n 's/^SMTP_USER=//p' "$ENV_FILE" | head -n1); senha=$(sed -n 's/^SMTP_PASS=//p' "$ENV_FILE" | head -n1)
  if [ -z "$host" ] || [ -z "$ALERTA_DE" ]; then registra "ERRO envio: SMTP_HOST ou ALERTA_DE vazio"; return 0; fi
  porta=${porta:-587}
  # 465 é TLS direto; o resto (587) é STARTTLS, que o --ssl-reqd torna obrigatório.
  if [ "$porta" = 465 ]; then url="smtps://$host:$porta"; else url="smtp://$host:$porta"; fi
  cfg=$(mktemp)
  # Aspas e barras escapadas: a senha pode tê-las.
  printf 'user = "%s:%s"\n' "$(printf '%s' "$usuario" | sed 's/[\\"]/\\&/g')" "$(printf '%s' "$senha" | sed 's/[\\"]/\\&/g')" > "$cfg"
  args=(-sS --ssl-reqd --url "$url" -K "$cfg" --mail-from "$ALERTA_DE" --upload-file -)
  IFS=',' read -r -a rcpt <<< "$ALERTA_PARA"
  for r in "${rcpt[@]}"; do args+=(--mail-rcpt "${r// /}"); done
  if ! printf 'From: %s\r\nTo: %s\r\nSubject: %s\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n%s\r\n' \
       "$ALERTA_DE" "$ALERTA_PARA" "$1" "$2" | curl "${args[@]}" > /dev/null 2>&1; then
    registra "ERRO envio: o relay recusou ($1)"
  fi
  rm -f "$cfg"
}

# ── estado por checagem: <ruins seguidas> <alertado 0|1> <último aviso em epoch> ──
avalia() { # avalia <chave> <ok|ruim> <mensagem>
  local chave=$1 situacao=$2 msg=$3 arq ruins=0 alertado=0 ultimo=0
  arq="$ESTADO_DIR/$(printf '%s' "$chave" | tr -c 'a-z0-9_.-' '_')"
  if [ -f "$arq" ]; then read -r ruins alertado ultimo < "$arq"; fi
  if [ "$situacao" = ruim ]; then
    ruins=$((ruins + 1))
    if [ "$alertado" = 0 ] && [ "$ruins" -ge 2 ]; then
      registra "ALERTA $chave: $msg"
      envia "[complexo42 $AMBIENTE] ALERTA: $chave" "$msg"
      alertado=1; ultimo=$AGORA
    elif [ "$alertado" = 1 ] && [ $((AGORA - ultimo)) -ge $((LEMBRETE_HORAS * 3600)) ]; then
      registra "LEMBRETE $chave: $msg"
      envia "[complexo42 $AMBIENTE] LEMBRETE: $chave" "Continua: $msg"
      ultimo=$AGORA
    elif [ "$alertado" = 0 ]; then
      registra "ruim (1a medicao) $chave: $msg"
    fi
  else
    if [ "$alertado" = 1 ]; then
      registra "RESOLVIDO $chave"
      envia "[complexo42 $AMBIENTE] RESOLVIDO: $chave" "Voltou ao normal: $msg"
    fi
    ruins=0; alertado=0; ultimo=0
  fi
  printf '%s %s %s\n' "$ruins" "$alertado" "$ultimo" > "$arq"
}

# ── disco ──
for d in $DISCOS; do
  uso=$(df -P "$d" 2> /dev/null | awk 'NR==2 { gsub("%", "", $5); print $5 }' || true)
  if [ -z "$uso" ]; then avalia "disco $d" ruim "não consegui medir o disco de $d"
  elif [ "$uso" -ge "$DISCO_LIMITE" ]; then avalia "disco $d" ruim "disco de $d em ${uso}% (limite ${DISCO_LIMITE}%)"
  else avalia "disco $d" ok "disco de $d em ${uso}%"; fi
done

# ── containers e memória (só dos projetos deste ambiente) ──
# Só os que estão rodando (`docker ps`, sem -a): os do perfil admin (studio, meta) ficam parados de
# propósito e dariam alerta falso. App parado de vez é o que o monitor externo do healthz pega.
if [ -n "$PROJETOS" ]; then
  if lista=$(for p in $PROJETOS; do docker ps --filter "label=com.docker.compose.project=$p" --format '{{.Names}} {{.Status}}' || exit 1; done 2> /dev/null); then
    avalia docker ok "Docker respondendo"
    com_problema=$(printf '%s\n' "$lista" | awk 'NF && ($0 ~ /\(unhealthy\)/ || $2 != "Up") { print $1 }' | tr '\n' ' ')
    if [ -n "$com_problema" ]; then avalia container ruim "container com problema (unhealthy ou reiniciando): $com_problema"
    else avalia container ok "containers de pé"; fi
    nomes=$(printf '%s\n' "$lista" | awk 'NF { print $1 }')
    # shellcheck disable=SC2086 # nomes de container, um por palavra
    if [ -n "$nomes" ] && mem=$(docker stats --no-stream --format '{{.Name}} {{.MemPerc}}' $nomes 2> /dev/null); then
      altos=$(printf '%s\n' "$mem" | awk -v l="$MEM_LIMITE" 'NF { gsub("%", "", $2); if ($2 + 0 >= l) print $1 "=" $2 "%" }' | tr '\n' ' ')
      if [ -n "$altos" ]; then avalia memoria ruim "memória perto do mem_limit (limite ${MEM_LIMITE}%): $altos"
      else avalia memoria ok "memória dos containers abaixo de ${MEM_LIMITE}%"; fi
    fi
  else
    avalia docker ruim "não consegui falar com o Docker (containers e memória sem medição)"
  fi
fi

# ── backup: o .age mais novo tem de ter menos de BACKUP_MAX_HORAS ──
if [ -n "$BACKUP_DIR" ]; then
  if [ -n "$(find "$BACKUP_DIR/diario" -name '*.age' -mmin -$((BACKUP_MAX_HORAS * 60)) 2> /dev/null | head -n1)" ]; then
    avalia backup ok "backup recente"
  else
    avalia backup ruim "nenhum backup nas últimas ${BACKUP_MAX_HORAS} h em $BACKUP_DIR/diario"
  fi
fi

# ── certificado: vale por mais de CERT_DIAS? ──
if [ -n "$CERT_HOST" ]; then
  if openssl s_client -connect "$CERT_HOST:443" -servername "$CERT_HOST" < /dev/null 2> /dev/null \
       | openssl x509 -noout -checkend $((CERT_DIAS * 86400)) > /dev/null 2>&1; then
    avalia certificado ok "certificado de $CERT_HOST vale por mais de ${CERT_DIAS} dias"
  else
    avalia certificado ruim "certificado de $CERT_HOST vence em menos de ${CERT_DIAS} dias (ou não consegui ler)"
  fi
fi
exit 0
