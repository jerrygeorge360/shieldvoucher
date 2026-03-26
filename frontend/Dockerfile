FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

# Build-time environment variables for Vite
ARG VITE_CONTRACT_ADDRESS
ARG VITE_RPC_URL
ARG VITE_ATLANTIC_API_KEY

ENV VITE_CONTRACT_ADDRESS=$VITE_CONTRACT_ADDRESS
ENV VITE_RPC_URL=$VITE_RPC_URL
ENV VITE_ATLANTIC_API_KEY=$VITE_ATLANTIC_API_KEY

RUN npm run build

# Serve with Nginx
FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
