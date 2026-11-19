#!/usr/bin/env bash
# Teste de restauração (issue #84). "Backup que nunca foi restaurado não conta."
#
# Sobe um Postgres DESCARTÁVEL, decifra o backup, restaura, conta as linhas de
# controle e apaga tudo. Não toca o banco do ambiente em momento algum.
#
# A chave PRIVADA entra só aqui, só durante o teste, e o script não a copia,
# não a imprime e não a apaga -- quem manda nela é o operador (ADR 0003 §7).
#
# Uso: ./restore-test.sh <arquivo.age> <arquivo-de-identidade-age>
set -euo pipefail
umask 077

ARQ=${1:?uso: restore-test.sh <arquivo.age> <identidade-age>}
IDENT=${2:?falta o arquivo de identidade (chave privada age)}
# Mesma imagem do ambiente, por fidelidade: restaurar num Postgres diferente
# testa outra coisa. Fixada por digest, como no compose.
IMAGEM=${IMAGEM:-supabase/postgres:17.12.0.001@sha256:2543d8fb3889ff2ee514af39496f67c30edd1f1e0da923a560e7930d2f59ca16}
AGE_IMAGEM=${AGE_IMAGEM:-}
NOME=restore-test-$$
SENHA=$(head -c 30 /dev/urandom | od -An -tx1 | tr -d ' \n')

[ -r "$ARQ" ]   || { echo "ERRO: nao consigo ler $ARQ" >&2; exit 2; }
[ -r "$IDENT" ] || { echo "ERRO: nao consigo ler a identidade" >&2; exit 2; }

decifrador() {
  if command -v age > /dev/null 2>&1; then
    age -d -i "$IDENT"
  elif [ -n "$AGE_IMAGEM" ]; then
    # a identidade entra pelo stdin do container, nunca por argumento (que
    # apareceria em `ps` para qualquer usuário da máquina)
    docker run --rm -i -v "$(cd "$(dirname "$IDENT")" && pwd)":/k:ro \
      "$AGE_IMAGEM" age -d -i "/k/$(basename "$IDENT")"
  else
    echo "ERRO: sem \`age\` no host e sem AGE_IMAGEM" >&2
    exit 2
  fi
}

limpar() {
  docker rm -f "$NOME" > /dev/null 2>&1 || true
}
trap limpar EXIT

echo "== subindo Postgres descartavel"
docker run -d --name "$NOME" -e POSTGRES_PASSWORD="$SENHA" \
  -e POSTGRES_DB=postgres "$IMAGEM" \
  postgres -c listen_addresses=* > /dev/null

# Esperar o banco aceitar conexão de verdade (o mesmo erro da armadilha 52:
# `pg_isready` responde antes de o servidor estar pronto para consultas).
echo -n "   aguardando"
for i in $(seq 1 60); do
  if docker exec -e PGPASSWORD="$SENHA" "$NOME" \
       psql -h 127.0.0.1 -U supabase_admin -d postgres -c 'select 1' > /dev/null 2>&1; then
    echo " pronto em ${i}s"; break
  fi
  [ "$i" = 60 ] && { echo; echo "ERRO: banco nao ficou pronto" >&2; exit 1; }
  printf '.'; sleep 1
done

echo "== decifrando e restaurando"
INICIO=$(date +%s)
set +e
decifrador < "$ARQ" \
  | docker exec -i -e PGPASSWORD="$SENHA" "$NOME" \
      pg_restore -U supabase_admin -d postgres --no-owner --no-privileges \
      --exit-on-error > /tmp/restore-$$.log 2>&1
ESTADO=("${PIPESTATUS[@]}")
set -e
FIM_T=$(date +%s)
SEGUNDOS=$((FIM_T - INICIO))

if [ "${ESTADO[0]}" -ne 0 ]; then
  echo "ERRO: falha ao decifrar (chave errada?)" >&2
  rm -f /tmp/restore-$$.log; exit 1
fi
if [ "${ESTADO[1]}" -ne 0 ]; then
  echo "ERRO: pg_restore falhou:" >&2
  tail -20 /tmp/restore-$$.log >&2
  rm -f /tmp/restore-$$.log; exit 1
fi
rm -f /tmp/restore-$$.log

echo "== contagens de controle"
docker exec -e PGPASSWORD="$SENHA" "$NOME" \
  psql -h 127.0.0.1 -U supabase_admin -d postgres -At -F' ' -c "
    select 'perfis',    count(*) from public.profiles
    union all select 'unidades', count(*) from public.units
    union all select 'vinculos', count(*) from public.unit_members
    union all select 'papeis',   count(*) from public.role_assignments
    union all select 'municipios', count(*) from public.municipalities;
  " | while read -r rotulo n; do printf '   %-12s %s\n' "$rotulo" "$n"; done

echo
echo "RESTAURACAO OK em ${SEGUNDOS}s — anote o tempo na issue #84"
