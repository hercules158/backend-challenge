FROM oven/bun:1.2-alpine AS base
WORKDIR /usr/src/app

# Estágio de dependências
FROM base AS dependencies
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

# Estágio de build
FROM base AS build
COPY --from=dependencies /usr/src/app/node_modules ./node_modules
COPY . .
RUN bun run build

# Estágio de execução de produção
FROM base AS production
ENV NODE_ENV=production
COPY package.json bun.lock* ./
COPY --from=dependencies /usr/src/app/node_modules ./node_modules
COPY --from=build /usr/src/app/dist ./dist
COPY --from=build /usr/src/app/src/infrastructure/database/mikro-orm/migrations ./dist/infrastructure/database/mikro-orm/migrations

EXPOSE 3000

CMD ["bun", "dist/main.js"]
