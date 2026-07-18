# 西高中趣味学习平台 · 生产部署指南

本文档说明如何使用 GitHub Actions 构建的 `xgpy.exe` 在 Windows 服务器上部署整套系统（前端 + 后端 + 数据库迁移，单文件运行）。

---

## 一、环境要求

| 项目 | 要求 |
|---|---|
| 操作系统 | Windows 10 / 11 / Server 2016 及以上（64 位） |
| 数据库 | MariaDB 10.4+ 或 MySQL 5.7+ / 8.x |
| 其他依赖 | 无（exe 已内置 Node.js 运行时、前端页面和数据库迁移，无需安装 Node） |

> exe 内嵌了 46 个数据库迁移，首次启动会在空库中自动建表，无需手工导入 SQL。

---

## 二、获取 exe

每次 push 代码到 `main` 分支，GitHub Actions 会自动构建：

1. 打开仓库页面 → **Actions** → 最新的 **Build Windows EXE** 运行记录；
2. 在页面底部 **Artifacts** 下载 `xgpy-exe-x`；
3. 解压得到 `xgpy.exe`（约 62 MB）。

也可以本地构建（需要本机装有 Node.js 20+）：

```bat
cd backend
npm run build:exe
:: 产物在 backend\dist\xgpy.exe
```

---

## 三、准备数据库

在数据库服务器上创建一个空库（utf8mb4）：

```sql
CREATE DATABASE xgpy CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

> 建议生产环境创建专用账号而不是直接用 root：
> ```sql
> CREATE USER 'xgpy'@'%' IDENTIFIED BY '请换成强密码';
> GRANT ALL PRIVILEGES ON xgpy.* TO 'xgpy'@'%';
> FLUSH PRIVILEGES;
> ```

---

## 四、部署步骤

### 1. 建目录

在服务器上建一个目录，例如 `D:\xgpy\`，放入：

```
D:\xgpy\
├─ xgpy.exe      ← 下载的 exe
└─ .env          ← 按下方模板创建（注意没有文件名后缀，就是 .env）
```

### 2. 编写 .env

在 `D:\xgpy\` 下新建文本文件，重命名为 `.env`，内容如下：

```ini
NODE_ENV=production

# 服务监听地址与端口（0.0.0.0 表示允许局域网内访问）
HOST=0.0.0.0
PORT=3001

# 数据库连接（按实际情况修改）
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=xgpy
DB_PASSWORD=请换成强密码
DB_NAME=xgpy
DB_CONNECTION_LIMIT=100

# 登录令牌密钥：填一串足够长的随机字符串，且不要泄露
TOKEN_SECRET=请换成一串随机长字符串
```

> **注意**
> - exe 只读取**与 exe 同目录**下的 `.env`（或 `.env.production`）。
> - 不配 `DB_HOST` 时默认连 `192.168.10.110`，生产环境务必显式配置。
> - `.env` 含数据库密码和令牌密钥，不要提交到 Git，也不要外发。

### 3. 放行端口

首次运行 Windows 可能弹出防火墙提示，选择**允许**；或手工放行：

```bat
netsh advfirewall firewall add rule name="xgpy" dir=in action=allow protocol=TCP localport=3001
```

### 4. 启动

双击 `xgpy.exe`，或在目录下打开命令行运行：

```bat
cd /d D:\xgpy
xgpy.exe
```

看到类似以下输出即成功（首次启动会自动执行 46 个迁移，约几十秒）：

```
Applying migration 001_xxx ...
...
Database migrations are up to date
Server running at http://0.0.0.0:3001
```

> 如果打算长期运行，建议用 [NSSM](https://nssm.cc/) 把 exe 注册成 Windows 服务，实现开机自启、崩溃自动重启：
> ```bat
> nssm install xgpy D:\xgpy\xgpy.exe
> nssm set xgpy AppDirectory D:\xgpy
> nssm start xgpy
> ```

### 5. 验证

- 浏览器打开 `http://服务器IP:3001/`，能看到登录页；
- 接口健康检查：`http://服务器IP:3001/api/health` 返回 `{"status":"ok"}`。

---

## 五、目录结构（运行后）

```
D:\xgpy\
├─ xgpy.exe
├─ .env
└─ uploads\            ← 首次启动自动创建，存放全部上传文件
    ├─ questions\      ← 题目图片（content / choice / blank / judge 等子目录）
    └─ tasks\          ← 课堂任务资料
```

> **`uploads` 目录是全部用户上传资料的唯一存放处**，数据库里只存相对路径。迁移服务器时把 exe、.env、uploads 目录和数据库一起搬走即可完整还原。

---

## 六、日常运维

### 升级版本

1. 停止当前 exe（或 `nssm stop xgpy`）；
2. 用新构建的 `xgpy.exe` **覆盖**旧文件（.env 和 uploads 不动）；
3. 重新启动 —— 新增的数据库迁移会自动执行。

### 备份

需要备份两样东西：

```bat
:: 1. 数据库
mysqldump -u root -p xgpy > xgpy_backup.sql

:: 2. 上传文件目录（直接整体复制）
xcopy /E /I D:\xgpy\uploads D:\backup\uploads
```

### 常用排错

| 现象 | 排查 |
|---|---|
| 双击后窗口一闪而过 | 用命令行运行 `xgpy.exe` 看报错；多为 .env 缺失或数据库连不上 |
| 提示数据库连接失败 | 检查 DB_HOST/端口/账号密码；确认数据库服务已启动、账号允许远程连接 |
| 提示 No embedded migrations | exe 构建不完整，重新下载或重新构建 |
| 页面能开但图片不显示 | 检查 `uploads` 目录是否和 exe 在同一目录、是否有读取权限 |
| 端口被占用 | 改 .env 里 `PORT`，或找出占用进程：`netstat -ano \| findstr :3001` |

---

## 七、架构说明

- exe 内置 Node.js 22 运行时 + Express 后端 + 前端静态页面（`backend/exe-assets/frontend-dist`）+ 内嵌迁移脚本；
- 前端与 API 同端口服务，无需 Nginx；如需 HTTPS 可在前面加一层反向代理；
- AI 功能（DeepSeek 等）的密钥和模型配置保存在数据库的系统配置中，由管理员在后台界面维护，不在 .env 里。
