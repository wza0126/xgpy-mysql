# XGPY 学习平台

这是 XGPY 学习平台的最小源码包，包含前端、后端和数据库迁移脚本。

## 技术栈

- 前端：React 18、TypeScript、Vite、Tailwind CSS、React Router、Zustand。
- 后端：Node.js、Express、MariaDB/MySQL、原生 SQL 迁移。
- 数据库：MariaDB/MySQL，不使用 ORM。

## 目录结构

```text
frontend/   前端源码、Vite 配置、前端环境变量
backend/    后端源码、Express 服务、数据库迁移
```

更多说明：

- 前端运行方式见 `frontend/README.md`。
- 后端运行方式见 `backend/README.md`。
- 数据库迁移说明见 `backend/database/README.md`。

## 开发环境联调

1. 启动本地 MariaDB。示例：

```bash
docker run -d --name xgpy-mariadb-dev \
  -e MARIADB_ROOT_PASSWORD=xgpy_test_password \
  -e MARIADB_DATABASE=xgpy \
  -p 127.0.0.1:3307:3306 \
  mariadb:11.4
```

2. 启动后端：

```bash
cd backend
npm install
npm run dev
```

后端会读取 `backend/.env.development`，默认监听 `127.0.0.1:3101`，并自动执行数据库迁移。

3. 启动前端：

```bash
cd frontend
npm install
npm run dev
```

前端会读取 `frontend/.env.development`，默认访问 `http://127.0.0.1:3101` 的后端接口。

访问地址：

- 前端：`http://127.0.0.1:3266`
- 后端健康检查：`http://127.0.0.1:3101/api/health`

## 生产环境联调

1. 按实际部署环境修改：

```text
backend/.env.production
frontend/.env.production
```

2. 启动后端：

```bash
cd backend
npm install
npm start
```

3. 构建并预览前端：

```bash
cd frontend
npm install
npm run build
npm run preview
```

注意：前端的 `VITE_API_URL` 会在构建时写入产物，所以生产地址变更后需要重新执行 `npm run build`。如果不设置 `VITE_API_URL`，生产前端默认使用同源 `/api`，适合由后端或 exe 同端口托管前端。

## 正式部署

### 前端部署

1. 修改前端生产接口地址：

```bash
cd frontend
```

编辑 `.env.production`：

```env
VITE_API_URL=https://你的后端域名或地址
```

2. 构建前端：

```bash
npm install
npm run build
```

3. 部署静态文件：

把 `frontend/dist/` 目录挂到静态网站服务即可，例如 Nginx、静态网站托管、对象存储静态站点等。

### 后端部署

后端推荐部署单文件产物。

1. 构建后端：

```bash
cd backend
npm install
npm run build
```

2. 准备部署文件：

```text
backend/dist/server.cjs
backend/.env.production
```

其中 `server.cjs` 已经包含后端运行依赖和数据库迁移 SQL，不需要把 `node_modules` 或 `database/migrations/` 一起部署。

3. 修改后端生产配置：

编辑 `.env.production`：

```env
NODE_ENV=production
PORT=3001
HOST=0.0.0.0

DB_HOST=你的数据库地址
DB_PORT=3306
DB_USER=你的数据库用户
DB_PASSWORD=你的数据库密码
DB_NAME=xgpy

TOKEN_SECRET=请替换为足够长的随机字符串
```

4. 在服务器上运行：

```bash
NODE_ENV=production node server.cjs
```

后端启动时会自动执行未应用的数据库迁移。

部署机器需要：

- Node.js
- 可访问的 MariaDB/MySQL
- `server.cjs`
- `.env.production` 或等价的系统环境变量

### Windows exe 一体化部署

也可以构建一个 Windows x64 exe。这个 exe 会在同一个端口同时提供前端页面和后端 `/api`，但数据库仍然需要外部 MariaDB/MySQL。

1. 构建 exe：

```bash
cd backend
npm install
npm run build:exe
```

2. 准备部署目录：

```text
xgpy.exe
.env
```

`xgpy.exe` 来自 `backend/dist/xgpy.exe`，`.env` 可以从 `backend/.env.exe.example` 复制后修改。

3. 修改 `.env`：

```env
NODE_ENV=production
PORT=3001
HOST=0.0.0.0

DB_HOST=你的数据库地址
DB_PORT=3306
DB_USER=你的数据库用户
DB_PASSWORD=你的数据库密码
DB_NAME=xgpy

TOKEN_SECRET=请替换为足够长的随机字符串
```

4. 在 Windows 上双击或命令行运行：

```powershell
.\xgpy.exe
```

访问地址：

```text
http://127.0.0.1:3001/
http://127.0.0.1:3001/api/health
```

exe 已包含前端静态文件、后端依赖和数据库迁移 SQL，不需要 Node.js、`node_modules` 或 `database/migrations/`。它不包含数据库服务，启动时会连接 `.env` 配置的数据库并自动执行未应用的迁移。

## 默认账号

数据库种子数据会创建以下账号，默认密码都是：

```text
meoo.local
```

- 教师：`teacher`
- 学生：`student`
- 学生：`zhangsan`
