FROM node:20-slim AS builder

WORKDIR /app

# Build dependencies (includes TypeScript + @types from devDependencies)
COPY package.json ./
COPY prisma ./prisma
RUN npm install
RUN npx prisma generate --schema ./prisma/schema.prisma

# Copy source and compile
COPY . .
RUN npm run build

# Keep only runtime deps for final image
RUN npm prune --omit=dev


FROM node:20-slim

WORKDIR /app

# Puppeteer dependencies
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    xdg-utils \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

CMD ["npm", "start"]
