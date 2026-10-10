# vendor/ — 第三方代码内联目录

## mdb-reader.cjs 是什么

[`mdb-reader`](https://www.npmjs.com/package/mdb-reader) v3.2.0（MIT）的**打包产物**：一个纯 JS 的 Access 数据库（`.accdb` / `.mdb`，Jet4/ACE 格式）读取库。

**为什么内联而不是装 npm 包**

1. 交付物是 `pkg` 打的**单文件 exe**；而 mdb-reader 是 **ESM**（`"type": "module"`），pkg 对 ESM 依赖支持很差。
2. 上游包还带了 Office 敏捷加密、`fast-xml-parser`、`browserify-aes` 等一整棵依赖树，我们**一个都用不到**。

所以这里把它的源码 **esbuild 打成单个 CJS 文件**并内联进仓库，运行时只依赖 `node:zlib`。

## 相对上游的改动（XGPY patch）

1. `lib/node/codec-handler/create.js`：删掉 `CodecType.OFFICE`（敏捷加密）分支 → 不再引入 `fast-xml-parser` 与整套 crypto 依赖。
   （副作用：**加密的 .accdb 会被当成明文读**，实现层会在读表阶段报错并给出提示。学生做题不会加密，可接受。）
2. `lib/node/Table.js`：新增 `get definitionBuffer()` / `get database()`，让上层能拿到**原始 TDEF 页**（mdb-reader 本身不解析索引/主键）。
3. `lib/node/index.js`：额外导出 `Database` / `Table`。

## 怎么重新生成

```bash
# 1) 取源码
curl -sL -o mdb.tgz https://registry.npmjs.org/mdb-reader/-/mdb-reader-3.2.0.tgz
mkdir -p node_modules/mdb-reader && tar -xzf mdb.tgz -C node_modules/mdb-reader --strip-components=1

# 2) 打补丁（见上「相对上游的改动」三处）

# 3) 打包（esbuild 来自 backend/node_modules）
echo "import MDBReader, { Database, Table } from 'mdb-reader'; export { Database, Table }; export default MDBReader;" > entry.mjs
backend/node_modules/.bin/esbuild entry.mjs --bundle --platform=node --format=cjs --target=node22 --outfile=mdb-reader.bundle.cjs

# 4) 把 bundle 覆盖到本目录，并在文件头保留 MIT 版权注释
```

许可证原文见 `mdb-reader.LICENSE`。
