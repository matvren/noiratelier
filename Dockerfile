FROM node:18-alpine

WORKDIR /app

# Install dependencies (production)
COPY package.json package-lock.json ./
RUN npm ci --production --silent

# Copy app
COPY . .

# Ensure start script exists that will mount persistent DB
RUN chmod +x /app/start.sh || true

ENV PORT=3000
EXPOSE 3000

CMD ["/app/start.sh"]
