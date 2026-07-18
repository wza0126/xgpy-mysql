# 后端说明

后端是 Node.js + Express 服务，使用 MariaDB/MySQL 存储数据，数据库结构通过原生 SQL 迁移管理。

## 环境变量

后端会根据 `NODE_ENV` 自动读取对应文件：

```text
.env.development   NODE_ENV=development 时读取
.env.production    NODE_ENV=production 时读取
.env               可选的通用兜底文件，适合 exe 同目录部署
```

常用变量：

```env
PORT=3101
HOST=127.0.0.1
DB_HOST=127.0.0.1
DB_PORT=3307
DB_USER=root
DB_PASSWORD=xgpy_test_password
DB_NAME=xgpy
TOKEN_SECRET=xgpy_development_secret_change_me
```

生产环境必须修改 `.env.production` 里的数据库密码和 `TOKEN_SECRET`。

## 开发环境

先启动本地 MariaDB。示例：

```bash
docker run -d --name xgpy-mariadb-dev \
  -e MARIADB_ROOT_PASSWORD=xgpy_test_password \
  -e MARIADB_DATABASE=xgpy \
  -p 127.0.0.1:3307:3306 \
  mariadb:11.4
```

然后启动后端：

```bash
npm install
npm run dev
```

`npm run dev` 会设置 `NODE_ENV=development`，读取 `.env.development`，并使用 nodemon 热重启。

## 生产环境

```bash
npm install
npm start
```

`npm start` 会设置 `NODE_ENV=production`，读取 `.env.production`。

## 构建单文件后端

后端可以构建成单个 CommonJS 文件：

```bash
npm run build
```

构建产物：

```text
dist/server.cjs
```

这个文件已经打包了后端运行依赖和数据库迁移 SQL。部署时可以只带 `dist/server.cjs`，目标机器只需要有 Node.js 和可访问的 MariaDB/MySQL。

运行示例：

```bash
NODE_ENV=production \
PORT=3001 \
HOST=0.0.0.0 \
DB_HOST=127.0.0.1 \
DB_PORT=3306 \
DB_USER=root \
DB_PASSWORD=你的数据库密码 \
DB_NAME=xgpy \
TOKEN_SECRET=请替换为足够长的随机字符串 \
node dist/server.cjs
```

如果把 `.env.production` 放在 `server.cjs` 同级目录，也可以省略大部分命令行环境变量。命令行环境变量优先级高于 `.env.production`。

## 构建 Windows exe

可以构建一个 Windows x64 exe：

```bash
npm run build:exe
```

构建产物：

```text
dist/xgpy.exe
```

这个 exe 会在同一个端口同时提供前端页面和后端 `/api`。部署目录最少需要：

```text
xgpy.exe
.env
```

`.env` 从 `.env.exe.example` 复制后修改即可：

```env
NODE_ENV=production
PORT=3001
HOST=0.0.0.0
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=你的数据库密码
DB_NAME=xgpy
TOKEN_SECRET=请替换为足够长的随机字符串
```

运行：

```powershell
.\xgpy.exe
```

访问：

```text
http://127.0.0.1:3001/
http://127.0.0.1:3001/api/health
```

exe 已包含前端静态文件、后端依赖和数据库迁移 SQL，不需要 Node.js 或 `node_modules`。数据库服务不包含在 exe 内，必须提供可访问的 MariaDB/MySQL。

## 数据库迁移

后端启动时会自动执行未应用的迁移。也可以手动执行：

```bash
npm run migrate:dev
npm run migrate:prod
```

迁移文件在：

```text
database/migrations/
```

已应用迁移和校验值记录在数据库表 `schema_migrations` 中。

## 健康检查

```bash
curl http://127.0.0.1:3101/api/health
```

返回：

```json
{"status":"ok"}
```

## 默认账号

种子数据会创建以下账号，默认密码都是 `meoo.local`：

- 教师：`teacher`
- 学生：`student`
- 学生：`zhangsan`
