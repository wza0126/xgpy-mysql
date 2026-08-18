# 「键盘星域」实现计划

对应设计文档：`docs/superpowers/specs/2026-08-11-keyboard-galaxy-design.md`
目标版本：后端 v1.4.0 / 前端 v1.2.0

## 实现顺序总览

| 阶段 | 内容 | 依赖 |
|------|------|------|
| P0 | 数据库迁移 058（3 表 + 应用注册） | 无 |
| P1 | 后端 typing API + 房间状态机 | P0 |
| P2 | 前端共享词表 + 3D 键位图组件 + 应用入口 | 无 |
| P3 | 指法学堂 | P2 |
| P4 | 单人游戏 + 结算上报 | P2 |
| P5 | 班级排行榜 | P1 |
| P6 | 双人大厅 + 双人对局 | P1, P2, P4 |
| P7 | 应用集成（AppCenter 特判 + AppManager 配置） | P0 |
| P8 | 验证（迁移、语法、typecheck） | 全部 |

---

## P0 · 数据库迁移

**文件**：`backend/database/migrations/058_add_keyboard_galaxy.sql`

- `CREATE TABLE IF NOT EXISTS typing_scores`（字段见设计文档：id/user_id/score/wpm/accuracy/words/chapter/created_at + idx_user_id, idx_score）
- `CREATE TABLE IF NOT EXISTS typing_rooms`（table_no/player1_id/player2_id/status/p1_ready/p2_ready/seed/p1_score/p2_score/p1_hp/p2_hp/chapter/winner/start_at/ended_at/updated_at + idx_table_no）
- `CREATE TABLE IF NOT EXISTS typing_duel_records`（user_id/opponent_id/result/score/opponent_score/created_at + idx_user_id）
- `INSERT IGNORE INTO apps` 注册 `app_typing_trainer`（config: tables=6, difficulty=standard）
- `INSERT IGNORE INTO app_visibility` 给现有班级（test、class1 等）插可见记录

**验证**：`npm run migrate:dev`（首次可能 partial，重跑至 up to date）；`SELECT` 确认表与应用存在。

## P1 · 后端 API（`backend/src/index.js`）

在 python-magic / code-realm API 区域后新增「键盘星域 API 开始/结束」段落：

1. **成绩与排行榜**
   - `POST /api/typing/scores`：authenticate，插入 typing_scores，返回成功
   - `GET /api/typing/leaderboard`：authenticate；查本人 `profile.class_id`，JOIN profiles 过滤同班，`GROUP BY user_id` 取 MAX(score)，按 score DESC；附本人名次
2. **房间管理（状态机 idle→waiting→ready→playing→finished→idle）**
   - `GET /api/typing/rooms`：返回全部桌位（JOIN profiles 拿玩家名，供大厅渲染）
   - `POST /api/typing/rooms/:id/sit`：`{ side }`；校验座位空 → 设置 player，status=waiting（若 2 座满）
   - `POST /api/typing/rooms/:id/leave`：清本人座位，重置 ready 标记，若空桌归 idle
   - `POST /api/typing/rooms/:id/ready`：标记本人 ready；双方 ready → status=ready
   - `POST /api/typing/rooms/:id/start`：要求 status=ready → 生成 `seed`，status=playing，start_at=NOW()
   - `POST /api/typing/rooms/:id/heartbeat`：更新 `last_seen`（表加 last_seen DATETIME 字段）
   - `POST /api/typing/rooms/:id/sync`：playing 中同步 `{ score, hp, chapter }`（写本人侧字段），返回对手侧最新值
   - `POST /api/typing/rooms/:id/finish`：携带最终分；判定 winner（先失血判负由 sync 中 hp=0 触发，或按积分/时间）；写 typing_duel_records（双方各一条）；清座位归 idle
3. **战绩**
   - `GET /api/typing/duels`：authenticate，最近 20 条本人战绩（JOIN 对手名）
4. **教师端**
   - `GET /api/typing/teacher/rooms`：authenticate + requireTeacher，全部桌位状态（含玩家/阶段）

**掉线释放**：房间查询时对 `last_seen` 超过 30s 的玩家：playing 中判对方获胜并记战绩，否则释放座位。放在 `GET /rooms` 与 `sync` 内顺带清理。

**验证**：`node --check src/index.js`；用 curl/脚本跑一遍坐席流程。

## P2 · 前端基础（共享词表 + 3D 键位图 + 入口）

- `frontend/src/components/student/keyboard-galaxy/KeyboardData.ts`：
  `export { KEYWORDS as GALAXY_KEYWORDS } from '../code-realm/CodeRealmData';`（复用 36 项词表；补充每个词的 `letters` 小写串按需）
- `frontend/src/components/student/keyboard-galaxy/Keyboard3D.tsx`：
  - 3D 立体键盘（perspective + rotateX），指法分区 class（k-pinky/k-ring/k-mid/k-index/k-thumb × 左右手）
  - props：`activeKey?: string`、`collapsible?: boolean`
  - 当前键保留分区颜色 + 金色光晕闪烁；f/j 凸点；下方手指提示文字
  - 键位布局数据放 `KeyboardData.ts`（rows + 每键 letter/手指归属）
- `frontend/src/components/student/TypingTrainer.tsx`：
  顶部导航（🎓 指法学堂 / 🚀 单人游戏 / 🏮 双人对战 / 🏆 排行榜）+ 深色星空主题容器 + `onClose`

**验证**：typecheck 通过；临时在页面挂载 Keyboard3D 目测 3D 与闪烁效果。

## P3 · 指法学堂（LessonView.tsx）

- 章节数据（4 章）：基准键位 / 中指行 / 完整分区 / Python 词练习，每章含教学文案 + 键位图高亮范围 + 练习生成器
- 练习：单键跟打 → 随机字母串 → 单词串；`onKeyDown` 匹配，错误闪烁；实时 WPM/正确率
- 章节完成度存 localStorage `keyboard_galaxy_lesson_<userId>`；章节卡片打勾

**验证**：4 章依次可完成，刷新后进度保留。

## P4 · 单人游戏（SingleGame.tsx）

- 开局难度选择（轻松/标准/极限）→ 5 关基准速度/密度
- 游戏核心 `useRef` 循环（requestAnimationFrame 驱动下落，`setInterval` 检查碰撞）：
  - 词队列：GALAXY_KEYWORDS 洗牌出词，按密度生成词块（词块组件：英文+中文，目标词红色脉冲）
  - 输入：keydown 逐字符匹配当前目标词，已输入高亮；完整 → 子弹+爆炸特效（CSS keyframes，复用 mockup 效果）→ +10 分、击落词、连击++
  - 落地：-1❤ 并移除；❤=0 结束；打完 15 词升关（速度密度提升）
- HUD：WPM/正确率/得分/连击/❤/关卡；3D 键位图底部（可折叠）
- 结算页：得分/WPM/正确率/字数 + 「上报成绩」「再来一局」；中途退出放弃不上报
- 上报：`POST /api/typing/scores`

**验证**：单机可完整玩 5 关；连击与扣血正确；上报成功进榜。

## P5 · 排行榜（LeaderboardView.tsx）

- `GET /api/typing/leaderboard`；TOP 榜表格（名次/姓名/WPM/得分/正确率）+ 本人名次高亮
- 无成绩时空态引导去单人游戏

## P6 · 双人对战（DuelLobby.tsx + DuelGame.tsx）

- **DuelLobby**：`GET /api/typing/rooms` 渲染桌子网格（桌号/圆桌/左右座）；点击空座 → `sit`；已占显示玩家；同桌双人 → 「我同意」+ 等对方 → 双方 ready → 倒计时 3·2·1 → 进入 DuelGame；500ms 轮询刷新；离开 → `leave`；底部显示我的最近战绩（`/api/typing/duels`）
- **DuelGame**：
  - 顶部双栏比分（我方/对方：得分/❤/关卡/剩余时间）
  - 各自游戏区渲染同一 seed 词序（`seededShuffle` 由 seed 生成，双端一致）；关卡自动 1→5 每关 1 分钟
  - 本地事件（得分/失血/关卡）→ `sync` 推送；`sync` 返回对方最新 → 更新对方面板
  - 结束条件：本地 hp=0 立即 `finish`；5 分钟到 → `finish`；中途退出按钮 → `finish`（按当前分判胜）
  - 掉线提示（30s 无心跳）→ 后端判负后轮询返回 finished → 展示结果
- **seededShuffle**：放在 KeyboardData.ts 供双端共用

**验证**：两台设备（或两个浏览器窗口模拟）同大厅坐同桌、同意开赛、实时比分、先失血判负、中途退出判分、战绩可查。

## P7 · 应用集成

- `AppCenter.tsx`：`app.type === 'typing_trainer'` 特判 → 打开 `TypingTrainer`
- `AppManager.tsx`：
  - `appTypes` 增加 `{ value: 'typing_trainer', label: '键盘星域' }`
  - `App` type 联合增加 `'typing_trainer'`
  - 表单 config 分支：`tables`（桌子数量，默认 6）、`difficulty`（默认难度，默认 standard）
  - 配置渲染分支：键盘星域 → 桌子数量/默认难度表单项
  - 卡片增加「查看对战桌」按钮 → `GET /api/typing/teacher/rooms` 弹窗展示当前桌位状态

## P8 · 验证

1. `npm run migrate:dev` 至 up to date；确认表/应用
2. `node --check backend/src/index.js`
3. `npx tsc --noEmit` 过滤键盘星域相关文件（既有错误与本项目无关）
4. 手动走查：指法学堂 → 单人 5 关 → 排行榜上榜 → 双人同桌对战 → 教师端配置/查看对战桌
