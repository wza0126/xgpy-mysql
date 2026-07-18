# XGPY 学习平台（西高中趣味学习平台）

前后端一体的高中信息科技趣味学习平台：虚拟桌面、题库与组卷、课堂任务、点名、AI 问答、积分装备体系等。

- 生产部署（发给学校服务器用）：见 **[DEPLOY.md](DEPLOY.md)**
- 本文档面向开发者：本地环境搭建、目录结构、迁移与构建

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | React 18、TypeScript、Vite、Tailwind CSS、React Router、Zustand、TipTap 富文本 |
| 后端 | Node.js、Express、mysql2（原生 SQL，无 ORM） |
| 数据库 | MariaDB 10.4+ / MySQL 5.7+ |
| 打包 | @vercel/ncc（server.cjs）、@yao-pkg/pkg（Windows exe） |

## 目录结构

```text
frontend/            前端源码（Vite + React）
backend/
  src/               后端源码（index.js 为入口）
  migrations/        SQL 迁移文件（按序号执行，启动时自动跑）
  scripts/           embed-migrations.js（把 SQL 内嵌进代码）等构建脚本
  uploads/           上传文件（题目图片、任务资料，运行时生成，勿删）
  .env.development   开发环境配置（本地数据库账号等）
  .env.exe.example   exe 部署的 .env 模板
dev.bat / dev.ps1    本地前后端一键管理脚本
DEPLOY.md            生产部署指南
```

## 一、新电脑上手（5 分钟）

前置要求：

- Node.js 20 及以上
- 本机或局域网可用的 MariaDB / MySQL（本项目开发库在 `127.0.0.1:3306`）

步骤：

```bat
:: 1. 克隆仓库
git clone https://github.com/wza0126/xgpy-m.git
cd xgpy-m

:: 2. 安装依赖
cd backend && npm install
cd ..\frontend && npm install

:: 3. 配置开发环境变量
cd ..\backend
copy .env.example .env.development
:: 然后编辑 .env.development，填入本机数据库账号密码
```

`.env.development` 关键项：

```ini
NODE_ENV=development
PORT=3101
HOST=127.0.0.1
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=你的数据库密码
DB_NAME=xgpy
TOKEN_SECRET=开发用随机字符串
```

> ⚠️ 不配 `DB_HOST` 时代码里的默认值是 `192.168.10.110`（旧服务器地址），新环境务必显式配置。

```bat
:: 4. 建库（空库即可，迁移会自动建表）
::    用任意 MySQL 客户端执行：
::    CREATE DATABASE xgpy CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

:: 5. 一键启动前后端
cd ..
dev.bat start
```

启动成功后：

- 前端（教师/学生入口）：http://127.0.0.1:3266
- 后端健康检查：http://127.0.0.1:3101/api/health

前端 Vite 已配置代理：`/api` 和 `/uploads` 自动转发到 3101，无需额外配置。

## 二、dev.bat 常用命令

```bat
dev.bat start      启动前后端（默认全部）
dev.bat stop       停止
dev.bat restart    重启
dev.bat status     查看运行状态
dev.bat logs       看日志（dev.bat logs backend 实时跟踪后端日志）
dev.bat open       浏览器打开前端
```

后端日志在 `backend\server.log`，前端在 `frontend\vite.log`。
后端用 nodemon 运行，改代码自动重启；前端 Vite 热更新。

## 三、数据库迁移

- 迁移文件在 `backend/migrations/`，纯 SQL，按文件名序号执行；
- `npm run dev` / `npm start` / 构建前都会先自动执行 `scripts/embed-migrations.js`，把 SQL 内嵌进 `src/embedded-migrations.js`；
- 服务启动时自动比对 `schema_migrations` 表，只执行未应用过的迁移（含 checksum 校验，改过的旧迁移会报错而不是悄悄重跑）；
- 手工执行迁移：`cd backend && npm run migrate`。

**新增迁移的流程**：在 `migrations/` 新建 `0XX_描述.sql`（序号递增）→ 重启后端即可，无需其他操作。

## 四、默认账号

种子数据创建的账号，初始密码均为 `meoo.local`：

| 角色 | 账号 |
|---|---|
| 教师 | `teacher` |
| 学生 | `student` |
| 学生 | `zhangsan` |

> 生产部署后请第一时间在系统内修改密码。

## 五、构建与部署产物

```bat
cd backend

npm run build        :: 产出 dist\server.cjs（单文件后端，需服务器装 Node）
npm run build:exe    :: 产出 dist\xgpy.exe（含前端+后端+迁移，免 Node）
```

**推送到 main 分支时，GitHub Actions 会自动构建 exe**（Actions → Build Windows EXE → Artifacts 下载）。exe 的详细部署方法见 [DEPLOY.md](DEPLOY.md)。

## 六、前端单独部署（可选）

如果不走 exe 一体化，前端也可单独构建后挂 Nginx：

```bat
cd frontend
npm run build    :: 产物在 frontend\dist\
```

- 不设置 `VITE_API_URL` 时，生产前端默认请求同源 `/api`（适合后端同端口托管或反向代理）；
- 如前后端分离部署，在 `frontend/.env.production` 设置 `VITE_API_URL=https://后端地址` 后**重新构建**（该值在构建时写死进产物）。

## 七、常见约定

- **上传文件路径**：数据库统一存相对路径 `/uploads/...`，代码内有归一化逻辑兼容历史脏数据（完整 URL、Windows 绝对路径），新代码不要往里写绝对路径或完整 URL；
- **exe 环境判断**：`process.pkg` 为真时 `__dirname` 是只读快照，运行时要读写的路径（如 uploads）必须用 `path.dirname(process.execPath)`，参考 `backend/src/env.js` 和 `index.js` 顶部；
- **AI 配置**（DeepSeek 密钥、模型名等）存在数据库系统配置表中，由管理员在后台界面维护，不要写进 .env 或代码；
- 后端主要业务代码都在 `backend/src/index.js`（单文件约 1 万行），改功能前先全文搜索相关路由前缀（如 `/api/teacher/tasks`）。
