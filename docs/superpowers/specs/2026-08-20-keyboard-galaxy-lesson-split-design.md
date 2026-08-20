# 键盘星域 · 指法学堂第 2 章小节拆分设计

- 日期：2026-08-20
- 状态：已批准
- 影响范围：仅 `frontend/src/components/student/keyboard-galaxy/LessonView.tsx`

## 背景

指法学堂当前为 4 章一维结构（`LESSONS` 数组），第 2 章「字母行扩展」一次性练习全部 26 个字母，对初学者难度偏大。将其拆分为 5 个手指小节，逐节练习、逐节解锁，降低入门门槛。

## 需求

第 2 章「字母行扩展」细分为 5 小节：

| # | 小节 | 手指 | 字母 |
|---|---|---|---|
| 1 | 食指 | 左右食指 (li+ri) | r t f g v b y u h j n m |
| 2 | 中指 | 左右中指 (lm+rm) | e d c i k |
| 3 | 无名指 | 左右无名指 (lr+rr) | w s x o l |
| 4 | 小手指 | 左右小指 (lp+rp) | q a z p |
| 5 | 所有手指 | 全部 | 26 个字母 |

- 每小节达标（WPM ≥ 配置 `duel_min_wpm`，当前 15，与其他章节一致）才能解锁下一节
- 5 小节全部达标后才解锁第 3 章
- 小节字符集由 `KeyboardData.ts` 的 `FINGER_OF_CHAR` 映射自动推导，保证与键位图高亮一致

## 设计

### 1. 数据结构

```ts
interface SubLesson {
  id: number;        // 1-5
  title: string;     // 食指 / 中指 / 无名指 / 小手指 / 所有手指
  desc: string;
  chars: string;     // 由 fingerOfChar 推导
}

interface Lesson {
  id: number;
  title: string;
  icon: string;
  desc: string;
  chars?: string;
  wordMode?: boolean;
  subLessons?: SubLesson[];   // 仅第 2 章有
}
```

第 2 章 `subLessons` 在模块加载时按手指分组自动生成。

### 2. 进度存储（localStorage 单 key 对象结构）

```
key: keyboard_galaxy_lesson_<uid>
值: { ch: [1, 2, ...], sub: { 2: [1, 2, 3] } }
  ch  = 已达标完成的章节 id（第 2 章 5 小节全达标后才加入）
  sub = 各章已达标小节 id 列表（目前仅第 2 章）
```

**老数据自动迁移**：读取时若旧格式为 `number[]` 且包含 `2`，自动 `sub[2] = [1,2,3,4,5]`（老用户视为 5 小节全完成，直接解锁第 3 章）。

### 3. 解锁规则

| 目标 | 条件 |
|---|---|
| 进入第 2 章 | 第 1 章完成（`ch` 含 1，原有逻辑不变） |
| 小节 1（食指） | 进入第 2 章即可练 |
| 小节 N（2-5） | `sub[2]` 含 N-1 |
| 第 3 章 | `sub[2]` 长度 = 5（即 `ch` 含 2） |

### 4. 达标判定

与其他章节一致：完成练习串后 WPM ≥ `duel_min_wpm` 即该小节达标；未达标提示再练一次。

### 5. UI

- 顶部 4 章网格不变；第 2 章卡片显示小节进度（如 `2/5`）
- 点击第 2 章 → 练习区上方出现 5 个小节切换条：已达标 ✅ / 锁定 🔒 / 可练
- 锁定提示「上一节达标后可练」；5 小节全达标后第 2 章显示 ✅ 并提示解锁第 3 章

## 非目标

- 不改后端、不改数据库
- 不改其他章节结构与逻辑
- 不迁移已存于其它 key 的数据

## 验证

- `npm run typecheck`（frontend）
- 浏览器手测：老数据迁移、逐节解锁、达标判定、第 3 章解锁
