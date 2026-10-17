FROM node:24-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY lib ./lib
COPY scripts ./scripts
COPY tsconfig.json ./tsconfig.json
ENV NODE_ENV=production
CMD ["npm", "run", "regulatory:worker"]
