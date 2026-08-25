# 学生自绑 DeepSeek API Key 设计

> 版本：v1 · 日期：2026-08-20 · 状态：已批准，待实施

## 背景

DeepSeek 涨价后，平台统一付费创作成本升高。希望允许学生绑定自有 DeepSeek API Key：
- 绑定后用自己的 Key 创作，不扣积分、无次数限制
- 不绑定走原平台 Key + 扣积分流程

## 目标

- 学生可在「作者中心」绑定/解绑/测试自有 DeepSeek API Key
- 创作时若已绑 Key，走学生 Key 并跳过积分扣减与限额
- 学生机不需要访问外网的能力，所有外网调用由后端代理

## 范围

**In**
- `profiles` 表新增 `deepseek_api_key` 字段（明文存储）
- 后端 4 个新路由：`GET/PUT/DELETE/POST /api/creative-workshop/me/apikey`
- 修改 `generateAIContent` 与 generate/modify 路由，按是否绑 Key 切换调用方式
- 前端「作者中心」tab 顶部新增 API Key 绑定区块
- 悬浮说明文案（DeepSeek 注册获取 Key 流程）

**Out**
- 不支持非 DeepSeek 提供商（如 OpenAI/Kimi），不暴露 base_url/模型名输入框
- 不加密存储（与平台现有 `app_settings.ai_api_key` 风险等级一致）
- 不为已购买作品的双向结算做改动（购买/打开作品的扣积分流程不变）

## 关键约束

- **学生机不直连外网**：测试按钮和真实创作均由后端代理调用 DeepSeek，学生机只与系统后端通信，与现有所有 API 调用一致
- **不返回明文 Key**：GET 接口只返回 `masked`（前 3 + 后 4，中间星号）
- **学生 Key 失败不降级**：调用失败直接报错，不自动回退到平台 Key + 扣积分（避免学生"绑了 Key 还扣积分"的困惑）

## 数据库

```sql
-- 065_add_profiles_deepseek_apikey.sql
ALTER TABLE profiles
  ADD COLUMN deepseek_api_key VARCHAR(128) NULL
  COMMENT '学生自绑的 DeepSeek API Key（明文存储，NULL 表示走平台 Key）';
```

同步追加到 `backend/src/embedded-migrations.js`。

## 后端 API（挂在现有 `/api/creative-workshop` 组下，受 `requireLicense(FEATURES.CREATIVE)` 保护）

| 方法 | 路径 | 行为 |
|------|------|------|
| GET | `/me/apikey` | 返回 `{ has_key: boolean, masked: string \| null }`，**不返回明文** |
| PUT | `/me/apikey` | body `{ key: string }`。校验非空、长度 20-128、`sk-` 前缀。写入并返回 masked |
| DELETE | `/me/apikey` | 置 NULL，回到平台 Key + 扣积分模式 |
| POST | `/me/apikey/test` | body `{ key?: string }`（不传则用已保存 Key）。后端用该 Key 向 DeepSeek `/chat/completions` 发最小请求（`messages:[{role:'user',content:'ping'}]`、`max_tokens:5`）。返回 `{ ok: boolean, error?: string }` |

### `/apikey/test` 错误细分
- 401（key 无效）→ `API Key 无效，请检查或重新绑定`
- 402（余额不足）→ `API Key 余额不足，请充值或解绑后用平台积分`
- 网络异常 / 超时 → `网络异常，请稍后重试`
- 其他 → `测试失败：${statusText}`

### 限流
`/apikey/test` 单独限流：每学生每分钟 ≤ 5 次，防薅 DeepSeek。

## 创作流程改造（`backend/src/creative-workshop.js`）

`generateAIContent(userId, messages, options)` 与 generate/modify 路由开头查 profile：

```javascript
const [profileRow] = await pool.query(
  'SELECT deepseek_api_key FROM profiles WHERE id = ?', [userId]);
const useUserKey = !!profileRow[0]?.deepseek_api_key;
const apiKey = useUserKey ? profileRow[0].deepseek_api_key : config.ai_api_key;
// base_url、model 仍用平台配置（DeepSeek 官方或镜像）
```

### generate 路由
- `useUserKey=true`：**跳过** 余额检查、`deductPoints`、限额校验；`ai_works` INSERT 流程不变（沿用原事务结构，status='draft'）
- `useUserKey=false`：原流程不变
- 返回 `{ ..., usedUserKey, pointsCost: useUserKey ? 0 : config.gen_cost }`

### modify 路由
同 generate：跳过 `modify_cost` 扣减与限额，其余流程不变。

### 失败回滚
- 学生 Key 调用失败：直接抛错给学生（`API Key 无效/余额不足`），**不降级**
- 用学生 Key 时本就没扣积分，无需回滚事务
- 失败时 `ai_works` 状态处理沿用原流程（不引入新的事务结构调整）

## 前端 UI

### 新组件 `AuthorApiKey.tsx`
挂在 `CreativeWorkshop.tsx` 的 `revenue` tab（[L438](file:///d:/wza/xgpy-m/frontend/src/components/student/CreativeWorkshop.tsx#L438)）顶部。

```
┌─ DeepSeek API Key 绑定 ────────────────────────────┐
│ 状态：已绑定 sk-***9abc              [测试][解绑]   │
│       未绑定                          [绑定]         │
│ ⓘ 如何获取 API Key？（hover 显示浮层）              │
│ 绑定后创作不扣积分、无次数限制                       │
└──────────────────────────────────────────────────────┘
```

交互：
- 输入框 `type=password` + 显示/隐藏切换（眼睛图标）
- 「测试」按钮：loading 态 → 成功/失败 toast
- 「绑定」按钮：调 PUT，绑定后显示 masked
- 「解绑」按钮：`confirm` 确认 → DELETE
- 悬浮说明：Tailwind `group relative` + `group-hover` 显示浮层（同时支持 `focus-within` 键盘可达）

### 创作结果提示适配
[CreativeWorkshop.tsx](file:///d:/wza/xgpy-m/frontend/src/components/student/CreativeWorkshop.tsx) 中现有 `setNotice` 的地方（[L229](file:///d:/wza/xgpy-m/frontend/src/components/student/CreativeWorkshop.tsx#L229)、[L263](file:///d:/wza/xgpy-m/frontend/src/components/student/CreativeWorkshop.tsx#L263)）：
- `usedUserKey=true` → `生成成功！（使用你的 API Key）`
- `usedUserKey=false` → `生成成功！消耗 ${data.pointsCost} 积分`（原文案）

### 悬浮说明文案

```
如何获取 DeepSeek API Key？

1. 访问 DeepSeek 开放平台：https://platform.deepseek.com/
2. 注册并登录（手机号/邮箱）
3. 进入「API Keys」页面
4. 点击「创建 API Key」，复制生成的 sk-xxx 字符串
5. 粘贴到下方输入框并保存

注意：
• 新用户通常有免费体验额度
• 用尽后按官方定价计费（约 ¥1-2/百万 tokens）
• Key 仅本账号可用，请勿泄露
```

## 错误处理矩阵

| 场景 | 处理 |
|------|------|
| 学生 Key 401 | `API Key 无效，请检查或重新绑定` |
| 学生 Key 402 | `API Key 余额不足，请充值或解绑后用平台积分` |
| 学生 Key 网络异常 | `网络异常，请稍后重试` |
| 保存空 Key | 前端 + 后端双重校验拒绝 |
| 保存非 `sk-` 前缀 | 前端校验：`DeepSeek API Key 以 sk- 开头` |
| 平台 Key 未配置（学生未绑） | 走原报错（不变） |
| `/apikey/test` 限流 | 429：`测试次数过多，请稍后再试` |

## 安全考虑

- **明文存储**（用户已选）：风险与现有 `app_settings.ai_api_key` 相当
- **不返回明文**：GET 只返回 masked，防止 XSS 偷 Key
- **masked 规则**：保留前 3 + 后 4，中间星号，长度 < 8 时全星号
- **路由授权**：4 路由都走 `authenticate + requireStudent`，整组在 `requireLicense(FEATURES.CREATIVE)` 门后
- **限流**：`/apikey/test` 单独限流，防薅 DeepSeek 测试接口

## 测试要点

- 不绑 Key 创作 → 扣积分，限额生效
- 绑 Key 创作 → 不扣、无次限
- 绑 Key 测试 → 成功/失败正确返回（401/402/网络错误细分正确）
- 解绑后再创作 → 回到扣积分流程
- 学生 Key 失败 → 报错，不降级到平台 Key
- masked 不泄露明文（GET 不返回 key 字段）
- `/apikey/test` 限流第 6 次返回 429
- 学生机网络隔离环境下测试按钮正常工作（仅与后端通信）
