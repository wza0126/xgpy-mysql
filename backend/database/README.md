# 数据库迁移说明

本项目使用 MariaDB/MySQL，数据库结构由原生 SQL 迁移文件管理，不使用 ORM。

## 目录

```text
migrations/   按文件名顺序执行的 SQL 迁移
```

当前迁移：

- `001_initial_schema.sql`：创建完整数据库结构。
- `002_seed_defaults.sql`：写入默认用户、班级、系统配置、单词和应用数据。

## 自动迁移

后端启动时会自动执行未应用的迁移。

迁移记录保存在：

```text
schema_migrations
```

如果已经执行过的迁移文件内容被修改，后端启动时会因为 checksum 不一致而失败。需要新增迁移文件，不要修改已经应用过的迁移。

## 手动迁移

开发环境：

```bash
cd backend
npm run migrate:dev
```

生产环境：

```bash
cd backend
npm run migrate:prod
```

## 新增迁移

在 `migrations/` 下创建下一个编号的 `.sql` 文件，例如：

```text
003_add_some_feature.sql
```

建议迁移 SQL 尽量写成可重复执行的形式，例如使用 `IF NOT EXISTS`、`DROP ... IF EXISTS`，这样本地重建数据库时更稳定。
