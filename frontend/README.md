# 前端说明

前端是 React 18 + TypeScript + Vite 应用，样式使用 Tailwind CSS。

## 环境变量

Vite 会自动按模式读取环境变量文件：

```text
.env.development   开发环境
.env.production    生产构建
```

当前使用的变量：

```env
VITE_API_URL=http://127.0.0.1:3101
```

前端只有 `VITE_` 开头的变量会暴露给浏览器。不要在前端环境变量里放数据库密码、后端密钥或其他敏感信息。

生产构建如果不设置 `VITE_API_URL`，前端会默认请求同源 `/api`，适合由后端或 Windows exe 同端口托管前端。如果前端部署到独立静态网站，需要在 `.env.production` 里设置完整后端地址。

## 开发环境

```bash
npm install
npm run dev
```

默认地址：

```text
http://127.0.0.1:3266
```

开发环境会读取 `.env.development`。

## 生产构建

```bash
npm run build
```

生产构建会读取 `.env.production`，并把 `VITE_API_URL` 写进 `dist/` 产物。如果删除或留空 `VITE_API_URL`，构建产物会使用同源 API。

本地预览生产产物：

```bash
npm run preview
```

## 常用脚本

```bash
npm run dev        启动开发服务器
npm run typecheck  TypeScript 类型检查
npm run build      构建生产产物
npm run preview    本地预览生产产物
npm run check      类型检查并构建
```

## 和后端联调

开发环境默认请求：

```text
http://127.0.0.1:3101
```

如果后端端口或域名变了，修改 `.env.development` 或 `.env.production` 里的 `VITE_API_URL`。生产环境修改后必须重新构建前端。

Windows exe 模式下前端由后端同端口托管，不需要单独启动 Vite，也不需要单独部署 `dist/`。
