# Imagem do app (ADR 0009 §3, #80): várias etapas, saída standalone do Next.js,
# usuário não-root e nenhum .env dentro. Construída nativamente em ARM64 (#81).
#
#   docker build --build-arg GIT_SHA=$(git rev-parse HEAD) --build-arg APP_VERSION=vAAAA.MM.DD -t complexo42 .
#
# Bases fixadas por tag + digest (índices multiarquitetura). O runtime é o Alpine
# puro com só o binário do Node copiado da imagem oficial, da MESMA versão do
# Alpine (musl): sem npm, yarn nem headers. Economiza ~40 MB e superfície.
ARG NODE_IMAGE=node:22.23.5-alpine3.24@sha256:1314fb30ec37592d5845e5a160d522c0e680972aa534549940b8d73bde88481a
ARG ALPINE_IMAGE=alpine:3.24.4@sha256:f59abe656b692d901e184be3445e084786602108599d2a51d229c0f5a48c71bf

FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM ${NODE_IMAGE} AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM ${ALPINE_IMAGE} AS runtime
COPY --from=deps /usr/local/bin/node /usr/local/bin/node
COPY --from=deps /usr/lib/libstdc++.so.6* /usr/lib/libgcc_s.so.1 /usr/lib/
RUN addgroup -g 1000 node && adduser -u 1000 -G node -s /sbin/nologin -D -H node
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
# As migrations viajam NA IMAGEM (#81): o deploy recebe só a tag, e o que
# aplica o schema tem de ser exatamente o que veio com aquela tag. Mantê-las
# num checkout do repositório no servidor criaria uma segunda fonte de
# verdade, que diverge em silêncio. São arquivos .sql já públicos e o
# container do app não os lê -- quem lê é o passo de migrations do deploy.
COPY --from=build /app/supabase/migrations ./supabase/migrations
# Infra que o deploy sincroniza no servidor (ADR 0015): a imagem e a fonte, e
# o deploy compara sha256 antes de trocar. Sao arquivos ja publicos, e o
# container do app nao os le -- quem le e o passo de sincronia do deploy.
COPY --from=build /app/deploy ./deploy
# Único diretório gravável da imagem: os logs, montados como volume no servidor.
# O resto roda com o sistema de arquivos só leitura (`read_only` + tmpfs em /tmp).
RUN mkdir -p data/logs && chown node:node data/logs
# Versão por último, para não invalidar o cache das camadas acima a cada commit.
ARG GIT_SHA=""
ARG APP_VERSION=""
ENV GIT_SHA=${GIT_SHA} APP_VERSION=${APP_VERSION}
LABEL org.opencontainers.image.source="https://github.com/felipemaion/Complexo42" \
      org.opencontainers.image.revision="${GIT_SHA}" \
      org.opencontainers.image.version="${APP_VERSION}"
USER node
EXPOSE 3000
CMD ["node", "server.js"]
