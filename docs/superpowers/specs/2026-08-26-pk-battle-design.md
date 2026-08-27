# 学生刷题 PK 对战功能设计文档

> **创建日期**：2026-08-26
> **版本**：v1.0
> **状态**：设计稿（待实施）
> **第一阶段范围**：限时答题模式

---

## 1. 概述

### 1.1 功能定位

为系统增加学生刷题 PK 对战功能，学生通过实时同步答题对战进行知识巩固。入口放在学生端测试模块，教师端考试管理模块新增对战配置栏目。

### 1.2 核心玩法（限时答题模式）

1. 匹配成功，双方拿到同一套题目，同时开始答题
2. 全局总倒计时（如 3 分钟、5 分钟），学生可自由切换题目作答
3. 做对一题加 1 分，错一题减 1 分，按净得分判输赢
4. 时间结束统一收卷；按「得分优先，相同得分看总耗时」排名
5. 结算页对比双方每题对错、正确率、用时；按做对题数发系统通用积分
6. 对战过程实时显示双方得分
7. 关闭窗口/断线超时即判负，中途可投降

### 1.3 关键技术决策

| 决策项 | 选定方案 | 理由 |
|---|---|---|
| 匹配范围 | 全校随机，按段位优先匹配 | 池子大、段位系统自然平衡 |
| 题库范围 | 标签 + AI 聚类筛选 | 复用 ExamManager 现有筛选 UI |
| 实时通信 | WebSocket (socket.io) | 实时性最好，双向通信 |
| 段位保护 | 段位差 ≤2 级可匹配，0 星保底 | 平衡公平与匹配速度 |
| 后端架构 | socket.io + MySQL 持久化 | 零新依赖、可恢复、性能够用 |
| 基础分 | 复用 `system_config.points_correct_answer`（默认 10 分） | 与练习模块一致 |
| 赢方奖励 | +50% 系统通用积分 | 鼓励竞技 |

---

## 2. 数据库设计

### 2.1 扩展 `profiles` 表（新增段位与战绩字段）

```sql
ALTER TABLE profiles
  ADD COLUMN pk_rank_tier TINYINT NOT NULL DEFAULT 0
    COMMENT 'PK段位层级：0小学生 1初中生 2高中生 3本科生 4研究生',
  ADD COLUMN pk_rank_stars INT NOT NULL DEFAULT 0
    COMMENT '当前段位星数（研究生无上限，其他0-5）',
  ADD COLUMN pk_points INT NOT NULL DEFAULT 0
    COMMENT 'PK积分（累计，用于总榜，0保底不允许负数）',
  ADD COLUMN pk_battles_today INT NOT NULL DEFAULT 0
    COMMENT '今日对战次数（每日0点重置）',
  ADD COLUMN pk_battles_date DATE NULL
    COMMENT '今日对战计数所属日期（用于判断是否需重置）',
  ADD COLUMN pk_total_wins INT NOT NULL DEFAULT 0
    COMMENT 'PK总胜场',
  ADD COLUMN pk_total_losses INT NOT NULL DEFAULT 0
    COMMENT 'PK总负场',
  ADD COLUMN pk_total_draws INT NOT NULL DEFAULT 0
    COMMENT 'PK总平局';
```

### 2.2 新增 `pk_battle_configs` 表（教师配置的对战活动）

```sql
CREATE TABLE pk_battle_configs (
  id VARCHAR(50) PRIMARY KEY,
  teacher_id VARCHAR(50) NOT NULL,
  name VARCHAR(100) NOT NULL              COMMENT '活动名称，如"期中复习PK"',
  mode ENUM('timed','rush') NOT NULL DEFAULT 'timed' COMMENT '限时答题/抢答(占位)',
  duration_seconds INT NOT NULL DEFAULT 180 COMMENT '总时长秒数',
  question_count INT NOT NULL DEFAULT 20   COMMENT '题量',
  tag_filters JSON NULL                    COMMENT '标签筛选条件',
  cluster_filters JSON NULL               COMMENT 'AI聚类筛选条件',
  difficulty_min TINYINT NULL             COMMENT '难度下限',
  difficulty_max TINYINT NULL             COMMENT '难度上限',
  is_active TINYINT(1) NOT NULL DEFAULT 1 COMMENT '是否启用',
  daily_limit INT NULL                    COMMENT '每生每日对战上限（NULL=全局默认20）',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_teacher (teacher_id),
  INDEX idx_active (is_active)
);
```

### 2.3 新增 `pk_rooms` 表（房间状态，支持断线恢复）

```sql
CREATE TABLE pk_rooms (
  id VARCHAR(50) PRIMARY KEY              COMMENT '房间ID=socket room名',
  config_id VARCHAR(50) NULL              COMMENT '关联的对战活动配置（NULL=快速匹配用默认）',
  room_code CHAR(4) NULL                  COMMENT '4位房间码（创建房间时才有）',
  host_user_id VARCHAR(50) NOT NULL       COMMENT '房主用户ID',
  status ENUM('waiting','preparing','battling','finished','abandoned')
    NOT NULL DEFAULT 'waiting',
  question_ids JSON NULL                  COMMENT '本局题目ID有序列表（开局时确定）',
  started_at TIMESTAMP NULL               COMMENT '对战开始时间',
  ends_at TIMESTAMP NULL                  COMMENT '对战结束时间',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_room_code (room_code),
  INDEX idx_status (status),
  INDEX idx_host (host_user_id)
);
```

### 2.4 新增 `pk_room_players` 表（房间玩家状态，每局2行）

```sql
CREATE TABLE pk_room_players (
  id VARCHAR(50) PRIMARY KEY,
  room_id VARCHAR(50) NOT NULL,
  user_id VARCHAR(50) NOT NULL,
  is_host TINYINT(1) NOT NULL DEFAULT 0,
  is_ready TINYINT(1) NOT NULL DEFAULT 0,
  joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  disconnected_at TIMESTAMP NULL          COMMENT '断线时间（用于判定输）',
  final_score INT NOT NULL DEFAULT 0      COMMENT '最终净得分',
  final_correct INT NOT NULL DEFAULT 0    COMMENT '做对题数',
  final_wrong INT NOT NULL DEFAULT 0      COMMENT '做错题数',
  final_duration_ms BIGINT NOT NULL DEFAULT 0 COMMENT '总耗时毫秒',
  result ENUM('win','lose','draw','pending') NOT NULL DEFAULT 'pending',
  rank_points_change INT NOT NULL DEFAULT 0 COMMENT 'PK积分变化',
  system_points_earned INT NOT NULL DEFAULT 0 COMMENT '获得系统通用积分',
  UNIQUE KEY uk_room_user (room_id, user_id),
  INDEX idx_user (user_id)
);
```

### 2.5 新增 `pk_match_answers` 表（每题作答流水）

```sql
CREATE TABLE pk_match_answers (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  room_id VARCHAR(50) NOT NULL,
  user_id VARCHAR(50) NOT NULL,
  question_id VARCHAR(50) NOT NULL,
  answer TEXT NULL,
  is_correct TINYINT(1) NOT NULL DEFAULT 0,
  answered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  cost_ms INT NOT NULL DEFAULT 0,
  UNIQUE KEY uk_room_user_question (room_id, user_id, question_id),
  INDEX idx_room_user (room_id, user_id),
  INDEX idx_user_question (user_id, question_id)
);
```

### 2.6 扩展 `classes` 表（班级对战开关）

```sql
ALTER TABLE classes
  ADD COLUMN IF NOT EXISTS pk_battle_enabled TINYINT(1) NOT NULL DEFAULT 0
    COMMENT '是否允许该班级学生参与PK对战（默认关闭）';
```

### 2.7 扩展 `point_transactions` 枚举

```sql
ALTER TABLE point_transactions
  MODIFY COLUMN source_type ENUM('test','exam','python_submit','task','exchange',
    'teacher_adjust','ai_qa','pk_battle','wrong_question','buff','pet','other')
  DEFAULT 'other';
```

> 实施时需根据现有枚举值补充 `pk_battle`，避免遗漏已有值。

---

## 3. 后端架构

### 3.1 socket.io 集成方式

在现有 HTTP server 上挂载 socket.io，不新建独立服务：

```js
const { Server } = require('socket.io');
const io = new Server(server, {
  cors: { origin: frontendOrigin, credentials: true },
  path: '/pk-socket/'
});
io.use((socket, next) => {
  // 复用现有 JWT 鉴权
});
require('./pk-socket/handler').init(io, pool);
```

### 3.2 后端文件结构

```
backend/src/pk-socket/
  ├── handler.js       // 入口，注册 io.on('connection')
  ├── matcher.js       // 匹配队列（内存优先，MySQL 落库）
  ├── roomManager.js   // 房间状态机 + 数据库持久化
  ├── battleEngine.js  // 对战主流程（出题/计时/收卷/结算）
  └── rankCalc.js      // 段位/积分计算
```

### 3.3 房间状态机

```
[waiting 等待中]
   │ 房主点开始 + 全员准备
   ▼
[preparing 准备中]   ← 3秒过渡，前端播放"321开战"
   │ 倒计时结束
   ▼
[battling 对战中]    ← 每秒广播剩余时间 + 排行榜
   │ 时间到 / 全员交卷 / 某方投降/断线超时
   ▼
[finished 已结束]    ← 结算页数据就绪，停留30秒后清理内存
   │
   ▼
[abandoned 已放弃]   ← 房主解散/全员离开
```

### 3.4 socket 事件清单

#### 客户端 → 服务器（C2S）

| 事件名 | payload | 说明 |
|---|---|---|
| `pk:match_quick` | `{ config_id? }` | 加入快速匹配队列 |
| `pk:match_cancel` | `{}` | 取消匹配 |
| `pk:room_create` | `{ config_id? }` | 创建房间，返回4位房间码 |
| `pk:room_join` | `{ room_code }` | 输入房间码加入 |
| `pk:room_leave` | `{}` | 离开房间 |
| `pk:room_ready` | `{ ready }` | 切换准备状态 |
| `pk:room_start` | `{}` | 房主开始对战 |
| `pk:answer_submit` | `{ question_id, answer, cost_ms }` | 提交单题答案 |
| `pk:switch_question` | `{ from_id, to_id }` | 切换题目（仅记录耗时） |
| `pk:surrender` | `{}` | 投降 |
| `pk:reconnect` | `{ room_id }` | 断线重连 |

#### 服务器 → 客户端（S2C）

| 事件名 | payload | 说明 |
|---|---|---|
| `pk:match_found` | `{ room_id, opponent, questions }` | 匹配成功 |
| `pk:match_timeout` | `{}` | 匹配超时无对手 |
| `pk:room_created` | `{ room_id, room_code }` | 房间创建成功 |
| `pk:room_updated` | `{ players[], host_id, status }` | 房间状态变化 |
| `pk:room_error` | `{ code, message }` | 错误 |
| `pk:battle_start` | `{ questions[], duration, ends_at, opponents[] }` | 对战开始 |
| `pk:tick` | `{ remaining, leaderboard[] }` | 每秒推送时间+排行榜 |
| `pk:answer_result` | `{ question_id, correct, score_change, my_score, opp_score }` | 单题作答结果 |
| `pk:opponent_scored` | `{ opponent_score, opponent_correct }` | 对手得分变化（脱敏） |
| `pk:battle_end` | `{ room_id }` | 对战结束 |
| `pk:opponent_disconnected` | `{ grace_seconds }` | 对手断线 |
| `pk:opponent_reconnected` | `{}` | 对手重连 |
| `pk:opponent_surrendered` | `{}` | 对手投降 |
| `pk:kicked` | `{ reason }` | 被踢出 |

### 3.5 REST 接口

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/api/pk/battle-configs` | teacher | 教师查询对战配置 |
| POST | `/api/pk/battle-configs` | teacher | 创建配置 |
| PUT | `/api/pk/battle-configs/:id` | teacher | 更新配置 |
| DELETE | `/api/pk/battle-configs/:id` | teacher | 删除配置 |
| GET | `/api/pk/battle-configs/active` | student | 查可用配置 |
| GET | `/api/pk/profile` | student | 查段位/积分/战绩 |
| GET | `/api/pk/leaderboard` | student | PK积分排行榜 |
| GET | `/api/pk/history` | student | 对战历史 |
| GET | `/api/pk/history/:room_id` | student | 单场复盘 |
| POST | `/api/pk/history/:room_id/wrong-questions` | student | 错题加入错题本 |
| GET | `/api/pk/classes/:class_id/students/stats` | teacher | 班级学生PK战绩 |
| PUT | `/api/classes/:id/toggles` | teacher | 扩展支持 `pk_battle_enabled` |

---

## 4. 前端组件与状态机

### 4.1 组件树

```
frontend/src/components/student/pk-battle/
  ├── PKBattle.tsx          // 入口，管理4个子页面切换
  ├── PKLobby.tsx           // 1. 对战列表页
  ├── PKRoom.tsx            // 2. 房间等待页
  ├── PKBattleArena.tsx     // 3. 对战答题页
  ├── PKResult.tsx          // 4. 结算复盘页
  ├── PKLeaderboard.tsx     // 排行榜组件
  ├── hooks/
  │   ├── usePKSocket.ts    // socket.io 连接+事件封装
  │   └── usePKProfile.ts  // 段位/战绩查询
  └── utils/
      └── pkHelpers.ts      // 段位渲染/时间格式化
```

### 4.2 入口集成

在 `TestModule.tsx` 列表页顶部 tab 区新增：

```
[普通测试] [在线考试] [对战 PK]   ← 新增第3个tab
```

tab 切换到"对战 PK"时渲染 `<PKBattle />`，与现有测试/考试逻辑完全隔离。

### 4.3 前端状态机

```
view = 'lobby' | 'room' | 'arena' | 'result'
matchStatus = 'idle' | 'searching' | 'matched'
battlePhase = 'preparing' | 'battling' | 'ended'

转换路径：
lobby (idle)
  ├─ 快速匹配 → lobby (searching) → match_found → room → arena → result
  ├─ 创建房间 → room (host, waiting) → 全员准备+开始 → arena → result
  └─ 加入房间 → room (guest, waiting) → 同上

arena (battling)
  ├─ 时间到/全对 → result
  ├─ 投降 → result (负)
  ├─ 对手断线 → 60秒宽限 → 重连继续 / 超时 → result (胜)
  └─ 自己断线 → 重连继续 / 超时 → result (负)
```

### 4.4 `usePKSocket` Hook

封装 socket.io 连接与事件，组件只调命令函数：

- `commands`：`matchQuick / matchCancel / createRoom / joinRoom / leaveRoom / toggleReady / startBattle / submitAnswer / surrender / reconnect`
- `on(event, handler)`：订阅 S2C 事件
- PKBattle mount 时连接，unmount 时断开

### 4.5 关键交互细节

1. **断线重连 UI**：arena 监听 disconnect，弹窗倒计时 + 重连按钮
2. **答题防误触**：提交后按钮置灰 1.5 秒
3. **题目切换**：左侧题号导航，自由跳题
4. **实时排行榜小窗**：顶部右侧固定，每秒 `pk:tick` 更新
5. **单题反馈**：`pk:answer_result` 收到后 1.5 秒 toast
6. **错题导入**：调 `POST /api/pk/history/:room_id/wrong-questions`
7. **重连恢复**：组件 mount 时先查是否有未完成对战，有则自动重连

### 4.6 前端依赖

- 新增：`socket.io-client`
- 复用：`backendClient`、`useAuth`、`usePoints`、`framer-motion`

---

## 5. 对战流程规则

### 5.1 匹配流程（快速匹配）

```
学生点「快速匹配」→ pk:match_quick
  │
  ▼
后端校验链：
  ① 班级 pk_battle_enabled = 1
  ② 今日 pk_battles_today < daily_limit
  ③ 不在任何 room 中
  ④ profiles.pk_rank_tier/stars 存在
  │
  ▼
入匹配队列 { userId, tier, stars, joinedAt, configId }
  │
  ▼
匹配算法（每秒扫描）：
  优先级1：同 tier 同 stars         → 立即匹配
  优先级2：同 tier ±1 star           → 30秒后
  优先级3：tier ±1（受≤2级限制）     → 60秒后
  优先级4：tier ±2                   → 90秒后
  超时：120秒无对手 → pk:match_timeout
  │
  ▼
匹配成功：
  ① 选段位低者为基准
  ② 取 configId 配置（无则全局默认）
  ③ 按配置筛选题目，随机抽 N 道，乱序
  ④ 写 pk_rooms + pk_room_players
  ⑤ 推 pk:match_found
  ⑥ 跳过房间等待页，直接 preparing → battling
```

**补充规则**：
- 快速匹配跳过房间等待页（自动 ready）
- 匹配队列存内存（重启丢失无影响）
- 同一学生 60 秒内重复发起匹配拒绝

### 5.2 房间流程（创建/加入/准备）

```
房主点「创建房间」→ pk:room_create
  后端：生成4位房间码（查唯一，冲突重试，最多10次）
  写 pk_rooms（room_code, host, status=waiting）
  回 pk:room_created

房主等待 → 对手输入房间码 pk:room_join
  后端校验：room_code 存在 + status=waiting + 玩家数<2 + 对手资格
  写 pk_room_players，推 pk:room_updated

双方点「准备」→ pk:room_ready
房主点「开始」→ pk:room_start（校验全员 ready + 玩家数=2）
  → 开战流程（同匹配成功③④⑤⑥⑦）
```

**补充规则**：
- 房间等待 5 分钟无对手 → 自动解散
- 房主离开 → 房间解散，对手被踢
- 对手离开 → 房主继续等待
- 房间码有效期 = 房间存在期间

### 5.3 答题流程

```
[preparing] 3秒过渡，前端播放"3...2...1...开战！"
  后端推 pk:battle_start { questions[], duration, ends_at, opponents[] }

[battling] 主循环
  后端每秒推 pk:tick { remaining, leaderboard[] }
  前端本地倒计时（以 ends_at 为准）

学生答题：
  ① 自由切换题目（左侧题号导航）
  ② 填答案 → pk:answer_submit { question_id, answer, cost_ms }
  ③ 后端校验：题在列表 + 未答过（UNIQUE KEY）
  ④ 判对错（复用 getAnswersArray + normalizeAnswer）
  ⑤ 写 pk_match_answers
  ⑥ 回 pk:answer_result
  ⑧ 广播对手 pk:opponent_scored（仅分数）
  ⑨ 前端 toast 1.5秒
  ⑩ 提交按钮置灰 1.5秒

时间到统一收卷：未答的题算错（净得分减1）
全对提前结束：双方都答完所有题 → 提前收卷
```

**补充规则**：
- 答题不可改答（UNIQUE KEY 锁定）
- cost_ms：前端记录每题从首次展示到提交的时间
- 时间到未答的题算错
- 双方全对提前结束

### 5.4 结算流程

```
触发：时间到 / 双方全答完 / 投降 / 断线超时
  │
  ▼
锁定 pk_room_players 两行（FOR UPDATE）
  │
  ▼
统计每人：
  final_correct = COUNT(is_correct=1)
  final_wrong   = COUNT(is_correct=0)
  final_score   = final_correct - final_wrong
  final_duration = SUM(cost_ms)
  │
  ▼
判定胜负：
  ① 投降方 → 负
  ② 断线超时方 → 负
  ③ score 高者胜
  ④ score 相同 → duration 少者胜
  ⑤ 都相同 → 平局
  │
  ▼
计算变化（rankCalc.js）
  → 段位变化（按第6节规则）
  → PK 积分变化
  → 系统通用积分 = correct × points_correct_answer；赢方 ×1.5
  │
  ▼
写库：
  - pk_room_players.result / rank_points_change / system_points_earned / final_*
  - profiles.pk_rank_tier/stars/points/wins/losses/draws/battles_today
  - point_transactions（source_type='pk_battle'）
  - pk_rooms.status=finished
  │
  ▼
推 pk:battle_end，前端拉 GET /api/pk/history/:room_id 复盘
```

### 5.5 断线/投降规则汇总

| 场景 | 时机 | 判定 | 段位/PK积分 | 系统通用积分 |
|---|---|---|---|---|
| 投降 | battling | 投降方负 | 按输方规则 | 按做对题数发 |
| 关窗/断网 | battling | 60秒宽限未重连→负 | 按输方规则 | 按做对题数发 |
| 关窗/断网 | waiting/preparing | 直接移出房间 | 不计 | 不计 |
| 断线重连成功 | 宽限内 | 继续对战 | 正常结算 | 正常发 |
| 服务器重启 | battling | 双方平局 | 不计 | 不计 |

**宽限倒计时 UI**：
- 对手断线 → 我方弹窗"对手掉线，60秒内重连，否则你赢" + 倒计时
- 自己断线 → 重连后弹窗"已恢复，继续答题"

### 5.6 防作弊规则

1. 题目一致：全员同题目同顺序，开局服务端定死写库
2. 答案锁定：单题提交后不可改（UNIQUE KEY）
3. cost_ms 校验：`cost_ms ≤ ends_at - started_at`，异常值剔除
4. 时间同步：以服务端 `ends_at` 为准
5. 段位校验：匹配时校验双方段位差 ≤2
6. 重复匹配：60秒内重复入队拒绝
7. 多开防：同一 user 只能在一个 room

### 5.7 异常边界

- 全员同时断线：双方都进宽限，60秒后都未重连 → 平局
- 结算时数据缺失：某方 pk_match_answers 为空 → final_score=0-wrong
- 配置被删：不影响进行中 room（题目已快照到 question_ids）
- 班级开关中途关闭：不影响进行中 room，但新匹配/创建被拒

---

## 6. 段位与积分系统

### 6.1 段位层级定义

| tier | 名称 | 星数范围 | 图标 | 升级条件 |
|---|---|---|---|---|
| 0 | 小学生 | 0-5 | 🎒 | 满5星赢→升初中生1星 |
| 1 | 初中生 | 0-5 | 📚 | 满5星赢→升高中生1星 |
| 2 | 高中生 | 0-5 | 🏫 | 满5星赢→升本科生1星 |
| 3 | 本科生 | 0-5 | 🎓 | 满5星赢→升研究生1星 |
| 4 | 研究生 | 0-∞ | 🔬 | 星数无上限，永久累加 |

**0 星保底规则**：
- 小学生 0 星输 → 不扣星、不降级
- 其他段位 0 星输 → 降一级到 5 星

### 6.2 段位变化规则总表

设双方段位差 `diff = |winnerTier - loserTier|`：

| 段位差 | 赢家加星 | 输家扣星 | PK积分变化 |
|---|---|---|---|
| 同级（diff=0） | 赢方 +1 | 输方 -1（0保底） | 赢+1，输-1（0保底） |
| 差1级（diff=1） | 低段位赢 +2；高段位赢 +0 | 低段位输 -0；高段位输 -1 | 低赢+2/高-1；高赢+0/低-0 |
| 差2级（diff=2） | 低段位赢 +2；高段位赢 +0 | 低段位输 -0；高段位输 -1 | 低赢+2/高-1；高赢+0/低-0 |

**核心原则**：
- 低段位赢 = +2 星 +2 PK 积分（鼓励以下克上）
- 高段位赢 = +0 星 +0 PK 积分（碾压无奖励）
- 低段位输 = 不扣（保护新手）
- 高段位输 = -1 星 -1 PK 积分（输给低段位有代价）
- 同级 = ±1 星 ±1 PK 积分（正常对局）

### 6.3 升降级触发

- 加星后 `stars > 5`（研究生除外）→ `tier+1, stars=1`
- 扣星后 `stars < 0` 且 `tier > 0` → `tier-1, stars=5`
- 扣星后 `stars < 0` 且 `tier = 0` → `stars=0`（保底）
- 研究生（tier=4）星数无上限，不升级

### 6.4 平局处理

- 双方星数不变、段位不变、PK 积分不变
- 系统通用积分仍各按做对题数发

### 6.5 PK 积分

- PK 积分是独立于系统通用积分的"对战专属积分"
- 仅用于 PK 排行榜，不影响学生可用积分
- **不允许负数**：最低 0 保底

### 6.6 系统通用积分发放

```
每人发放 = final_correct × points_correct_answer（默认10分/题）
赢方 × 1.5（+50% 奖励，向下取整）
输方/平局无额外奖励
答错不扣系统通用积分
```

**示例**：
- A 赢，做对 15 题 → 15×10×1.5 = 225 分
- B 输，做对 12 题 → 12×10 = 120 分
- 平局，双方各做对 12 题 → 各 12×10 = 120 分

**写入 point_transactions**：
```
source_type = 'pk_battle'
reason = `PK对战：${room_code} ${result} ${correct}题正确`
amount = 发放积分数
```

### 6.7 每日次数重置

```
学生发起匹配/创建/加入时：
  ① 查 profiles.pk_battles_date 是否 = 今天
  ② 不等 → pk_battles_today=0, pk_battles_date=今天
  ③ 校验 pk_battles_today < daily_limit
  ④ 对战结束后 pk_battles_today += 1

daily_limit 来源：
  ① pk_battle_configs.daily_limit（NULL 则用全局默认）
  ② 全局默认 = 20
```

### 6.8 段位计算伪代码

```js
function calcRankChange(winnerTier, winnerStars, loserTier, loserStars) {
  const diff = Math.abs(winnerTier - loserTier);
  const winnerIsLower = winnerTier < loserTier;
  let winnerStarDelta, loserStarDelta, winnerPkDelta, loserPkDelta;

  if (diff === 0) {
    winnerStarDelta = +1; loserStarDelta = -1;
    winnerPkDelta = +1;   loserPkDelta = -1;
  } else {
    if (winnerIsLower) {
      winnerStarDelta = +2; loserStarDelta = -1;
      winnerPkDelta = +2;  loserPkDelta = -1;
    } else {
      winnerStarDelta = +0; loserStarDelta = -0;
      winnerPkDelta = +0;  loserPkDelta = -0;
    }
  }
  const winnerResult = applyStars(winnerTier, winnerStars, winnerStarDelta);
  const loserResult  = applyStars(loserTier, loserStars, loserStarDelta);
  return { winnerResult, loserResult, winnerPkDelta, loserPkDelta };
}

function applyStars(tier, stars, delta) {
  let newStars = stars + delta;
  let newTier = tier;
  if (newStars > 5 && tier < 4) {
    newTier = tier + 1; newStars = 1;
  } else if (newStars < 0) {
    if (tier === 0) { newStars = 0; }
    else { newTier = tier - 1; newStars = 5; }
  }
  if (newTier === 4 && newStars > 5) { /* 研究生保持累加 */ }
  return { tier: newTier, stars: newStars };
}
```

---

## 7. 教师端配置 + 学生端入口

### 7.1 班级对战开关（ClassManager.tsx）

在 `classes` 表加 `pk_battle_enabled` 字段（默认关闭）。

在 ClassManager.tsx 编辑面板开关区，参考现有 `workshop_enabled` / `app_center_enabled` 模式，新增"PK对战"开关。

切换时走统一接口 `PUT /api/classes/:id/toggles`，后端：
1. UPDATE classes SET pk_battle_enabled=?
2. 学生匹配时直接 JOIN classes 查 pk_battle_enabled（不在 profiles 加冗余字段）

### 7.2 对战活动配置（ExamManager.tsx 加 tab）

在 ExamManager.tsx 顶部 tab 区新增"对战配置"tab。

**配置列表页**：展示 pk_battle_configs 的 CRUD 列表。

**配置编辑表单字段**：
- 活动名称
- 模式（限时答题可选，抢答占位）
- 总时长（1-30分钟）
- 题量（5-50）
- 每日上限（1-100，留空用全局默认20）
- 标签筛选（复用 ExamManager 现有标签筛选 UI）
- AI聚类筛选（复用 ExamManager 现有聚类筛选 UI）
- 难度范围（可选）
- 启用开关

### 7.3 学生端入口（TestModule.tsx 加 tab）

在 TestModule.tsx 列表页顶部 tab 区新增"对战 PK"。

tab 切换时渲染 `<PKBattle />`（独立组件，不污染现有逻辑）。

**PK 入口校验链**：
- 班级 pk_battle_enabled = 0 → 显示"班级未开启PK对战"
- 今日次数已满 → 显示"今日对战次数已用完"
- 有未完成对战 → 弹窗"是否重连？"
- 正常 → 显示 lobby

### 7.4 全局默认配置

学生快速匹配不指定 config_id 时，用全局默认：
- 取 pk_battle_configs 第一个 is_active=1 的配置
- 全无可用配置 → 硬编码默认值：
  ```
  mode: timed, duration: 180s, question_count: 20,
  tag_filters: null, cluster_filters: null,
  difficulty: null, daily_limit: 20
  ```

---

## 8. UI 设计要点

### 8.1 对战列表页（PKLobby）

```
┌─────────────────────────────────────────────────────────┐
│  ⚔️ PK 对战                          [今日 12/20 场]    │
├─────────────────────────────────────────────────────────┤
│  段位卡：🎒 小学生 ★★★☆☆  PK积分 128  战绩 15胜8负2平  │
│  模式：[⏱限时答题] [⚡抢答(敬请期待)]                   │
│  [🎯快速匹配] [🏠创建房间]                               │
│  输入房间码：[ _ _ _ _ ] [加入]                          │
│  🏆 PK积分排行榜（前50，自己高亮）                        │
└─────────────────────────────────────────────────────────┘
```

**设计要点**：
1. 段位卡置顶，5 颗星图标直观显示进度
2. 今日次数右上角徽章
3. 快速匹配按钮最大最显眼（主操作）
4. 房间码输入 4 个独立格子，输完自动加入
5. 排行榜仅前 50 名，自己排名高亮

### 8.2 房间等待页（PKRoom）

```
┌─────────────────────────────────────────────────────────┐
│  ← 返回         房间码：[ 8 8 4 2 ]  [📋复制] [🔗分享]   │
├─────────────────────────────────────────────────────────┤
│  玩家列表：                                              │
│  👑 我（房主）  🎒 ★★★☆☆  [✓准备]                      │
│  ? 等待对手加入...                                      │
│  [✓ 我已准备]  [开始对战] ← 房主可见，全员准备后可点     │
└─────────────────────────────────────────────────────────┘
```

**设计要点**：
1. 房间码大号显示，复制/分享按钮
2. 玩家卡展示头像、姓名、段位、准备状态
3. 房主独有"开始对战"按钮
4. 对手未加入时显示骨架卡

### 8.3 对战答题页（PKBattleArena）

```
┌─────────────────────────────────────────────────────────┐
│  ⏱ 02:35    我 15 ━━━━━━━━━━ 对手 12     [🏳️ 投降]     │
├─────────────────────────────────────────────────────────┤
│  题号导航：[1✓][2✓][3✗][4 ][5 ]...[20]                 │
├─────────────────────────────────────────────────────────┤
│  第 4 题 / 共 20 题                                      │
│  题干内容...                                             │
│  ○ A. ...  ○ B. ...  ○ C. ...  ○ D. ...                │
│  [提交答案]                                              │
├─────────────────────────────────────────────────────────┤
│  实时排行榜：🥇我 15分 8对3错  🥈对手 12分 6对4错        │
└─────────────────────────────────────────────────────────┘
```

**设计要点**：
1. 顶部固定栏：剩余时间（<60秒变红闪烁）、实时比分条、投降按钮
2. 题号导航：对绿色✓、错红色✗、未答灰色
3. 提交按钮置灰 1.5 秒防误触
4. 实时排行榜右下角固定，每秒更新
5. 单题反馈 toast 1.5 秒
6. 对手断线弹窗倒计时

### 8.4 结算复盘页（PKResult）

```
┌─────────────────────────────────────────────────────────┐
│                  🏆 胜利！                               │
│            +1 ★  +1 PK 积分  +225 系统通用积分           │
├─────────────────────────────────────────────────────────┤
│  对战数据对比                                            │
│  我（胜）: ★★★★☆ 净+8 做15对7 正确率68% 耗时145s       │
│  对手（负）: ★★★☆☆ 净+5 做12对7 正确率63% 耗时152s      │
├─────────────────────────────────────────────────────────┤
│  逐题复盘表：题号|题干摘要|我|对手                        │
│  1 | for循环 | ✓ | ✓                                     │
│  2 | if判断  | ✓ | ✗                                     │
│  ...                                                    │
├─────────────────────────────────────────────────────────┤
│  [📝错题加入错题本] [🔁再来一局] [←返回列表]            │
└─────────────────────────────────────────────────────────┘
```

**设计要点**：
1. 结果横幅大字 + 段位变化动画
2. 数据对比卡左右双栏，自己列高亮
3. 逐题复盘表，点击题号可展开看正确答案
4. 错题导入一键加入 wrong_questions
5. 再来一局返回 lobby 重新匹配

### 8.5 段位图标映射

| tier | 图标 | 名称 | 颜色 |
|---|---|---|---|
| 0 | 🎒 | 小学生 | 蓝色 |
| 1 | 📚 | 初中生 | 青色 |
| 2 | 🏫 | 高中生 | 绿色 |
| 3 | 🎓 | 本科生 | 紫色 |
| 4 | 🔬 | 研究生 | 金色 |

### 8.6 全局视觉规范

1. 配色：PK 对战主色用紫红色系（#8B5CF6 紫罗兰）
2. 动画：framer-motion 实现星数亮起、分数滚动、3-2-1 倒计时
3. 音效：可选，留 system_config 开关
4. 响应式：答题页适配窄屏
5. 加载态：匹配中骨架屏，结算页骨架屏

### 8.7 关键 UX 细节

1. 匹配中：搜索动画 + 可随时取消
2. 3-2-1 开战：preparing 阶段全屏覆盖大字动画
3. 时间到：最后 10 秒变红闪烁，到 0 全屏"时间到！"
4. 投降确认：二次确认防误触
5. 错题导入反馈：成功 toast，已在错题本的标记

---

## 9. 迁移汇总

实施时需创建以下迁移文件（按项目惯例同步 `embedded-migrations.js`）：

| 编号 | 内容 |
|---|---|
| 070 | classes 表加 `pk_battle_enabled` 字段 |
| 071 | profiles 表加 8 个 PK 段位字段 |
| 072 | 新建 `pk_battle_configs` 表 |
| 073 | 新建 `pk_rooms` 表 |
| 074 | 新建 `pk_room_players` 表 |
| 075 | 新建 `pk_match_answers` 表（含 UNIQUE KEY） |
| 076 | `point_transactions.source_type` 枚举加 `pk_battle` |

> 实际编号以实施时最新编号为准，可合并为 1-2 个迁移文件。

---

## 10. 第一阶段范围

### 10.1 第一阶段必做

1. 限时答题模式完整流程
2. 快速匹配（全校 + 段位优先）
3. 创建/加入房间（4位房间码）
4. 房间等待 + 准备 + 开始
5. 对战答题（自由切换、实时比分、单题反馈）
6. 结算复盘（对比 + 逐题 + 错题导入）
7. 段位系统（5 级 + 星数 + 升降级）
8. PK 积分 + 系统通用积分发放
9. 断线 60 秒宽限重连
10. 班级对战开关
11. 教师端对战配置 CRUD
12. 每日次数限制 + 防沉迷

### 10.2 第一阶段不做（后续阶段）

1. 抢答模式（先占位）
2. 观战功能
3. 段位赛季制（每赛季重置）
4. PK 战绩回放
5. 好友系统
6. 多人（>2人）对战
7. 自定义房间规则
8. 音效
9. 移动端适配

### 10.3 验收标准

1. 两个学生在不同浏览器同时匹配，能成功开战
2. 对战过程中双方实时看到对方分数变化
3. 时间到自动结算，胜负判定正确
4. 结算页数据对比完整，错题可一键导入错题本
5. 断线 60 秒内重连可继续，超时判负
6. 段位升降级正确（含跨级匹配）
7. 系统通用积分正确发放（赢方 ×1.5）
8. 班级关闭 PK 对战后学生无法匹配
9. 教师配置的题库范围生效
10. 每日 20 场限制生效

---

## 11. 实施依赖

### 11.1 新增依赖

- 后端：`socket.io`
- 前端：`socket.io-client`

### 11.2 复用现有

- `getAnswersArray` + `normalizeAnswer`：答案判定
- `points_correct_answer`：基础分配置
- `wrong_questions` 表：错题导入
- `point_transactions` 表：积分流水
- ExamManager 标签 + AI 聚类筛选 UI
- ClassManager 班级开关模式
- `useAuth` / `usePoints` / `backendClient`

---

## 12. 风险与缓解

| 风险 | 缓解措施 |
|---|---|
| socket.io 首次引入，部署复杂度上升 | 挂载现有 HTTP server，无独立进程 |
| 服务器重启进行中对战丢失 | 扫库恢复，battling 房间标 abandoned，双方平局 |
| 高并发匹配压力 | 匹配队列内存处理，MySQL 仅落最终状态 |
| 学生断线频繁 | 60秒宽限 + 重连机制 |
| 题库范围无题可抽 | 配置时校验题量 ≤ 筛选结果数 |
| 房间码冲突 | 最多重试 10 次，仍冲突报错 |
| 跨班匹配社交问题 | 段位系统自然分层，不强制社交 |
