# 「键盘星域」盲打练习应用 设计方案

## 概述

在学生桌面新增「键盘星域」应用，通过**盲打指法教学 + 打字射击游戏 + 局域网双人对战**，锻炼学生打字速度，并强化记忆江苏省信息技术学测 Python 考点词汇（与《代码秘境》完全一致的 36 项词表）。

应用包含四大模块：

| 模块 | 定位 |
|------|------|
| 🎓 指法学堂 | 盲打指法教学 + 渐进练习，3D 键位图辅助 |
| 🚀 单人游戏 | 36 词下落射击，5 关难度递增，班级排行榜 |
| 🏮 双人对战 | 局域网联机，桌子大厅，同词序同时比拼 |
| 🏆 排行榜 | 按班级排行，取每生最高得分 |

## 词汇表（36 项，与代码秘境一致）

与 `frontend/src/components/student/code-realm/CodeRealmData.ts` 的 `KEYWORDS` 复用同一份数据（抽取为共享数据文件，避免双份维护），含 id / 名称 / 类型（关键字|内置）/ 中文释义 / 示例。

| id | 名称 | 类型 | 释义 | 归属章 |
|----|------|------|------|--------|
| input | input() | 内置 | 接收用户输入 | 1 |
| print | print() | 内置 | 输出到屏幕 | 1 |
| def | def | 关键字 | 定义函数 | 1 |
| return | return | 关键字 | 返回结果 | 1 |
| True | True | 关键字 | 布尔真值 | 2 |
| False | False | 关键字 | 布尔假值 | 2 |
| bool | bool() | 内置 | 转布尔 | 2 |
| if | if | 关键字 | 条件判断 | 2 |
| elif | elif | 关键字 | 否则如果 | 2 |
| else | else | 关键字 | 否则 | 2 |
| and | and | 关键字 | 逻辑与 | 2 |
| or | or | 关键字 | 逻辑或 | 2 |
| not | not | 关键字 | 逻辑非 | 2 |
| for | for | 关键字 | 遍历循环 | 3 |
| range | range() | 内置 | 整数序列 | 3 |
| while | while | 关键字 | 条件循环 | 3 |
| break | break | 关键字 | 跳出循环 | 3 |
| continue | continue | 关键字 | 跳过本次 | 3 |
| is | is | 关键字 | 身份判断 | 4 |
| in | in | 关键字 | 成员判断 | 4 |
| None | None | 关键字 | 空值 | 4 |
| int | int() | 内置 | 转整数 | 5 |
| float | float() | 内置 | 转浮点数 | 5 |
| max | max() | 内置 | 最大值 | 5 |
| min | min() | 内置 | 最小值 | 5 |
| round | round() | 内置 | 四舍五入 | 5 |
| sum | sum() | 内置 | 求和 | 5 |
| len | len() | 内置 | 求长度 | 5 |
| split | split() | 内置 | 分割字符串 | 6 |
| replace | replace() | 内置 | 替换 | 6 |
| strip | strip() | 内置 | 去首尾空格 | 6 |
| sort | sort() | 内置 | 升序排序 | 6 |
| reverse | reverse() | 内置 | 反转 | 6 |
| append | append() | 内置 | 追加元素 | 6 |
| del | del | 关键字 | 删除 | 6 |
| import | import | 关键字 | 导入模块 | 7 |

> 单词击落需完整打出**小写英文**；中文释义仅辅助记忆，不参与输入。

## 模块一：指法学堂（练习模式）

**教学章节（循序渐进）**：

1. 认识基准键位：f / j 凸点定位，ASDF JKL; 手势
2. 中指行扩展：上方 qwer / uiop，下方 zxcv / nm 的指法归属
3. 完整指法分区：全部 26 字母 + 常用符号的指法归属讲解
4. 常用 Python 词练习：从 36 词表抽取单词串跟打

**3D 键位图（通用组件，练习与游戏中复用）**：

- CSS 3D 透视（`perspective` + `rotateX`）立体键盘，键帽带按压阴影
- 指法分区配色：左手小指/无名指/中指/食指、右手食指/中指/无名指/小指、拇指各一色
- f / j 基准键凸点标记；当前按键**保留分区颜色 + 金色光晕闪烁**，下方显示"用右手小指按 p"
- 支持折叠，默认显示

**练习形式**：单键跟打（指定键连打）→ 随机字母串 → 单词串；实时 WPM / 正确率；每章完成打勾。

**进度**：localStorage（`keyboard_galaxy_lesson_<userId>`）保存章节完成度；不做后端进度上报（非考勤需求）。

## 模块二：单人游戏（星际打字）

**关卡与难度**：5 关，下落速度/密度逐关递增（关1 慢而稀 → 关5 极速最密）。开局选难度档（轻松/标准/极限），作为 5 关基准速度与密度的乘数。单人每关单词数固定 15 个，打完自动升关。

**玩法**：

- 36 词随机下落，词块=发光胶囊（英文 + 中文释义）；目标词红色脉冲高亮
- 键盘输入逐字符匹配，实时高亮已输入部分；完整打出 → 光束子弹 + 命中爆炸粒子特效击落，**+10 分**（连击计数仅展示，不额外加分，保持简单）
- 单词漏到底部红色警戒线 → **-1 ❤**（共 3 滴），并清除该词
- 3 血耗尽 → 游戏结束；打完 5 关 → 通关结算
- 中途可退出：视为放弃本局，不结算、不上报成绩（防止刷榜）

**HUD**：打字速度 WPM、正确率、得分、连击、❤❤❤、当前关 3/5。

**结算**：展示得分/WPM/正确率/打字数，自动上报班级排行榜；返回重玩。

## 模块三：双人对战（局域网联机）

**大厅**：

- 桌子网格（数量由教师端 AppManager 配置，默认 6 张，每桌 2 座）
- 每桌显示圆桌 + 左右两座位；座位状态：空座（点击入座）/ 我方（蓝色）/ 对方（橙色，显示头像+名字）
- 双人坐齐 → 双方出现「同意」按钮 → 都同意 → 3·2·1 倒计时开赛

**联机同步**：后端存房间状态，前端 **500ms 轮询**（简单可靠，优于 WebSocket，适合教室局域网）。轮询范围：大厅桌位状态 + 进行中房间的比分/血量/关卡。

**比赛规则**：

- 双方使用**同一单词序列**（房间创建时生成随机种子，同速同密度），各自屏幕独立渲染，比拼手速与正确率
- 关卡自动 1→5，每关 1 分钟，共 5 分钟
- 每人 3 滴血：单词落地 -1 ❤；**先失 3 血者判负**
- 时间到 / 打完 5 关：**积分多者胜**；平局判为和局
- 中途可终止退出，按当时积分判定胜负
- 实时显示双方分数 / 血量 / 当前关卡 / 剩余时间

**战绩**：每场结果写入战绩表，学生大厅内可看"我的最近战绩（胜/负/和）"，不计入打字榜。

## 模块四：排行榜

- 单人游戏每局结束上报成绩（score / wpm / accuracy / words）
- **按班级排行**：取每名学生最高得分，按得分降序，展示 TOP 榜 + 自己名次；班级按登录学生 `profile.class_id` 过滤

## 数据模型（后端迁移 058）

### 1) `typing_scores` — 单人成绩（班级排行榜数据源）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | VARCHAR(50) PK | `ts_{timestamp}_{rand}` |
| user_id | VARCHAR(36) NOT NULL | 学生ID |
| score | INT NOT NULL | 得分 |
| wpm | INT NOT NULL | 打字速度 |
| accuracy | DECIMAL(5,2) NOT NULL | 正确率 % |
| words | INT NOT NULL | 击落单词数 |
| chapter | INT DEFAULT 0 | 达成最高关卡 |
| created_at | TIMESTAMP DEFAULT CURRENT_TIMESTAMP | 时间 |

索引：`INDEX idx_user_id (user_id)`, `INDEX idx_score (score)`

### 2) `typing_rooms` — 双人房间（桌子）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | VARCHAR(50) PK | `tr_{timestamp}_{rand}` |
| table_no | INT NOT NULL | 桌号 |
| player1_id | VARCHAR(36) | 左座玩家（可空） |
| player2_id | VARCHAR(36) | 右座玩家（可空） |
| status | VARCHAR(20) DEFAULT 'idle' | idle / waiting / ready / playing / finished |
| p1_ready | BOOLEAN DEFAULT false | 左座是否同意 |
| p2_ready | BOOLEAN DEFAULT false | 右座是否同意 |
| seed | VARCHAR(64) | 词序随机种子 |
| p1_score / p2_score | INT DEFAULT 0 | 双方得分 |
| p1_hp / p2_hp | INT DEFAULT 3 | 双方血量 |
| chapter | INT DEFAULT 1 | 当前关卡 |
| winner | VARCHAR(20) DEFAULT '' | p1 / p2 / draw / '' |
| start_at | DATETIME NULL | 开赛时间 |
| ended_at | DATETIME NULL | 结束时间 |
| last_seen | DATETIME NULL | 最近心跳时间（30s 超时视为掉线） |
| updated_at | TIMESTAMP ... ON UPDATE | 更新时间 |

索引：`INDEX idx_table_no (table_no)`

> 只保留一张"活动房间"表（按桌号覆盖复用），对局结束写入战绩后清空座位归 idle。

### 3) `typing_duel_records` — 双人战绩

| 字段 | 类型 | 说明 |
|------|------|------|
| id | VARCHAR(50) PK | 主键 |
| user_id | VARCHAR(36) NOT NULL | 玩家 |
| opponent_id | VARCHAR(36) | 对手 |
| result | VARCHAR(10) NOT NULL | win / lose / draw |
| score | INT NOT NULL | 本场得分 |
| opponent_score | INT | 对手得分 |
| created_at | TIMESTAMP DEFAULT CURRENT_TIMESTAMP | 时间 |

索引：`INDEX idx_user_id (user_id)`

### 4) 应用注册

```sql
INSERT IGNORE INTO apps (id, name, description, icon, type, price_type, points_price, category, is_active, is_marketplace, config, created_by)
VALUES ('app_typing_trainer', '键盘星域', '盲打练习 + 打字射击 + 局域网双人对战，36 个学测 Python 考点词汇随玩随记。', '⌨️', 'typing_trainer', 'free', 0, '编程实训', TRUE, TRUE,
  JSON_OBJECT('tables', 6, 'difficulty', 'standard'), 'teacher1');
```

- `app_visibility`：按需给各班级插入可见记录（不插记录 = 全部可见）

## 后端 API

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/typing/scores` | 上报单人成绩（authenticate） |
| GET | `/api/typing/leaderboard` | 班级排行榜（authenticate，按本人班级过滤） |
| GET | `/api/typing/rooms` | 大厅桌位状态列表（authenticate） |
| POST | `/api/typing/rooms/:id/sit` | 坐下 `{ side: 'L'|'R' }`（冲突返回错误） |
| POST | `/api/typing/rooms/:id/leave` | 离开座位 |
| POST | `/api/typing/rooms/:id/ready` | 标记同意开始 |
| POST | `/api/typing/rooms/:id/start` | 双方 ready 后创建词序种子并开赛 |
| POST | `/api/typing/rooms/:id/heartbeat` | 心跳续期（防掉线） |
| POST | `/api/typing/rooms/:id/sync` | 对局中同步 `{ score, hp, chapter }` |
| POST | `/api/typing/rooms/:id/finish` | 结束对局（写入战绩，清座位） |
| GET | `/api/typing/duels` | 我的最近战绩（authenticate） |
| GET | `/api/typing/teacher/rooms` | 教师端查看当前对战桌状态（authenticate + requireTeacher） |

**轮询与心跳**：大厅/房间前端每 500ms 轮询 `GET /rooms` 或 `sync`；坐下后每 10s 心跳；后端记录 `last_seen`，超过 30s 未心跳视为掉线，自动释放座位（对局中则判对方获胜）。

## 前端结构

```
frontend/src/components/student/keyboard-galaxy/
  KeyboardData.ts          # 36 词表（从 code-realm/CodeRealmData 导入复用）
  Keyboard3D.tsx           # 3D 键位图组件（指法分区/当前键闪烁/折叠）
  LessonView.tsx           # 指法学堂（章节 + 练习）
  SingleGame.tsx           # 单人游戏（下落/射击/关卡/HUD/结算）
  DuelLobby.tsx            # 双人大厅（桌子网格/坐下/同意/战绩）
  DuelGame.tsx             # 双人对局（同屏双栏比分 + 各自游戏区）
  LeaderboardView.tsx      # 班级排行榜
TypingTrainer.tsx          # 应用入口（导航到 4 模块）
```

**集成**：
- `AppCenter.tsx`：`app.type === 'typing_trainer'` 特判打开 `TypingTrainer`
- `AppManager.tsx`：`appTypes` 增加 `typing_trainer`（键盘星域）；表单配置分支渲染 `tables`（桌子数量）、`difficulty`（默认难度）；卡片显示"查看对战桌"按钮（调 `/api/typing/teacher/rooms`）

## 双人联机协议（房间状态机）

```
idle ──(sit 双方入座)──> waiting ──(双方 ready)──> ready ──(start 倒计时)──> playing
playing ──(3血尽 / 时间到 / finish)──> finished ──(写入战绩)──> idle(清座)
```

- 坐下冲突：同一座位已被占 → 返回错误，前端提示"座位已被占用"
- 断线：playing 中一方掉线超时 → 判对方获胜并记战绩
- 词序：`seed` 驱动双方从同一 36 词序列取词（`seededShuffle`），同一关卡同一速度/密度

## 边界与错误处理

- 词表为空 / 请求失败：显示错误并允许重试
- 单人未登录：仍可玩，但成绩不上报、排行榜不显示
- 双人中途退出：`finish` 携带当前比分判胜负，双方正常结算
- 重复上报：`typing_scores` 仅插入（每人最高分由排行榜查询取 MAX），无需幂等
- 教师未配置桌子数量时默认 6 张；配置变更仅影响新建房间

## 验收要点

1. 指法学堂 4 章可渐进完成，3D 键位图指法分区正确、当前键闪烁且显示手指
2. 单人 5 关速度密度递增，击落 +10 分、落地 -1❤、3 血结束、结算上榜
3. 双人两台设备进同一桌、双方同意开赛、同词序同时比拼、比分血量实时刷新、先失 3 血或时间到按积分判胜负、中途退出按积分判、战绩可查
4. 排行榜按班级显示最高得分与名次
