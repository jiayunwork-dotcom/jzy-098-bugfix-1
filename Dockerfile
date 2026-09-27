# 一键构建：容器内同时提供前端页面与后端接口
FROM node:20-bookworm-slim

WORKDIR /app

# 先拷贝依赖清单，尽量利用 Docker 层缓存
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/package.json
COPY frontend/package.json ./frontend/package.json
RUN npm ci

# 共享类型与源码
COPY shared ./shared
COPY backend ./backend
COPY frontend ./frontend

# 编译后端 TS、打包前端静态资源
RUN npm run build

ENV PORT=8080
ENV NODE_ENV=production
EXPOSE 8080

# 后端在同一端口托管前端打包产物
CMD ["node", "backend/dist/backend/src/index.js"]
