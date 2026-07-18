# 装备掉落功能设计方案

## 概述

在练习、错题重练模块加入随机掉落装备机制，考试及格也可掉落装备（掉率为练习时10倍）。装备提供暴击率永久加成，自动生效无需手动装备。教师在打怪系统中管理装备（增删改查），在创建测试中开启装备掉落开关。

## 数据模型

### 新增 `equipments` 表 — 装备目录

| 字段 | 类型 | 说明 |
|------|------|------|
| id | VARCHAR(50) PK | 主键，格式 `eq_{timestamp}_{random}` |
| name | VARCHAR(100) NOT NULL | 装备名称 |
| drop_rate | DECIMAL(5,2) NOT NULL DEFAULT 1.00 | 掉落概率(%)，如 3.00 表示 3% |
| crit_bonus | DECIMAL(5,2) NOT NULL DEFAULT 1.00 | 暴击率永久加成(%)，如 2.00 表示 +2% |
| icon | VARCHAR(50) DEFAULT '⚔️' | 图标emoji |
| is_active | BOOLEAN DEFAULT true | 是否启用（false=软删除，不再掉落但已拥有仍生效） |
| created_at | TIMESTAMP DEFAULT CURRENT_TIMESTAMP | 创建时间 |
| updated_at | TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP | 更新时间 |

索引：`INDEX idx_is_active (is_active)`

### 新增 `student_equipments` 表 — 学生装备持有

| 字段 | 类型 | 说明 |
|------|------|------|
| id | VARCHAR(50) PK | 主键 |
| student_id | VARCHAR(50) NOT NULL | 学生ID |
| equipment_id | VARCHAR(50) NOT NULL | 装备ID |
| quantity | INT DEFAULT 1 | 拥有数量（可叠加，重复掉落 quantity+1） |
| acquired_at | TIMESTAMP DEFAULT CURRENT_TIMESTAMP | 首次获取时间 |

约束：`UNIQUE KEY uk_student_equipment (student_id, equipment_id)`
索引：`INDEX idx_student_id (student_id)`

### `tests` 表新增字段

```sql
ALTER TABLE tests ADD COLUMN allow_equipment_drop BOOLEAN DEFAULT false COMMENT '是否开启及格掉落装备';
```

## 后端 API

### 装备管理 API（教师端，需 authenticate）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/teacher/equipments` | 获取所有装备列表（含已禁用的） |
| POST | `/api/teacher/equipments` | 新增装备 `{ name, drop_rate, crit_bonus, icon }` |
| PUT | `/api/teacher/equipments/:id` | 编辑装备 `{ name, drop_rate, crit_bonus, icon, is_active }` |
| DELETE | `/api/teacher/equipments/:id` | 软删除（设 is_active=false），不物理删除 |

### 掉落逻辑

#### 练习/错题重练掉落（submit-answer，答对时）

在 `POST /api/business/submit-answer` 的答对分支中，现有荣誉判定之后新增：

```javascript
// 查询所有启用中的装备
const [equipments] = await connection.query(
  'SELECT id, name, icon, drop_rate, crit_bonus FROM equipments WHERE is_active = true'
);

const droppedEquipments = [];
for (const eq of equipments) {
  if (Math.random() * 100 < parseFloat(eq.drop_rate)) {
    // 掉落成功，INSERT ON DUPLICATE KEY UPDATE quantity = quantity + 1
    await connection.query(
      `INSERT INTO student_equipments (id, student_id, equipment_id, quantity) 
       VALUES (?, ?, ?, 1) 
       ON DUPLICATE KEY UPDATE quantity = quantity + 1`,
      [`se_${Date.now()}_${Math.random().toString(36).substr(2,9)}`, student_id, eq.id]
    );
    droppedEquipments.push({ id: eq.id, name: eq.name, icon: eq.icon, crit_bonus: parseFloat(eq.crit_bonus) });
  }
}
```

#### 考试及格掉落（submit-test 和 close-exam）

在 `POST /api/business/submit-test` 的及格分支（`isPassed = true`）中：

```javascript
if (test.allow_equipment_drop && isPassed) {
  const [equipments] = await connection.query(
    'SELECT id, name, icon, drop_rate, crit_bonus FROM equipments WHERE is_active = true'
  );
  for (const eq of equipments) {
    // 掉率为练习时的10倍
    if (Math.random() * 100 < parseFloat(eq.drop_rate) * 10) {
      // 同上 INSERT ON DUPLICATE KEY UPDATE
    }
  }
}
```

`POST /api/business/close-exam` 中强行评分及格的学生同理处理。

### 暴击率公式更新

#### 当前公式（submit-answer 行1476-1479，stats API 行5350-5354）

```
crit_rate = clamp(crit_base_rate + floor(total_correct/100) + extra_crit + buffSum, 5, crit_max_rate)
```

#### 新公式

```javascript
// 查询学生装备总暴击加成
const [eqRows] = await connection.query(
  `SELECT IFNULL(SUM(e.crit_bonus * se.quantity), 0) AS total_eq_crit 
   FROM student_equipments se 
   JOIN equipments e ON se.equipment_id = e.id 
   WHERE se.student_id = ?`,
  [student_id]
);
const equipmentCritSum = parseFloat(eqRows[0]?.total_eq_crit) || 0;

// 新公式
crit_rate = critBaseRate + Math.floor(oldTotalCorrect / 100) + extraCrit + buffSum + equipmentCritSum;
crit_rate = Math.min(crit_rate, critMaxRate);
crit_rate = Math.max(crit_rate, 5);
```

#### crit_rate_breakdown 更新（GET /api/student/stats）

```javascript
crit_rate_breakdown: {
  base: critBaseRate,
  from_correct_count: Math.floor(totalCorrect / 100),
  from_extra_crit: extraCrit,
  from_buffs: buffSum,
  from_equipment: equipmentCritSum  // 新增
}
```

### 响应扩展

#### submit-answer 响应新增字段

```json
{
  "data": {
    "success": true,
    "dropped_equipments": [
      { "id": "eq_xxx", "name": "魔法之剑", "icon": "⚔️", "crit_bonus": 2.0 }
    ]
  }
}
```

无掉落时为空数组 `[]`。submit-test 和 close-exam 响应同理。

## 前端设计

### 教师端 — 装备管理（GameSettings.tsx）

在"打怪系统"页面"奖励Buff"区域下方新增"装备掉落"区域：

- **装备列表表格**：图标 | 名称 | 掉落概率(%) | 暴击加成(%) | 状态(启用/禁用) | 操作(编辑/删除)
- **"添加装备"按钮**：弹出表单，字段：图标(emoji输入)、名称、掉落概率、暴击加成
- **编辑按钮**：同一表单回填数据
- **删除按钮**：确认后调用 DELETE API（软删除），列表中标记为"已禁用"
- **系统说明区**：增加装备掉落规则文案（"练习答对随机掉落装备，考试及格掉率为10倍，装备暴击加成永久叠加"）

### 教师端 — 考试设置（TestManager.tsx）

在"完成奖励上网认证码"开关下方（行506-530之后）新增：

```tsx
<div className="p-4 bg-amber-50 rounded-xl">
  <label className="flex items-center gap-2 cursor-pointer">
    <input
      type="checkbox"
      checked={formData.allow_equipment_drop}
      onChange={(e) => setFormData({ ...formData, allow_equipment_drop: e.target.checked })}
      className="w-4 h-4 text-amber-500"
    />
    <span className="font-medium text-amber-700">测试及格掉落装备</span>
  </label>
  <p className="text-xs text-gray-500 mt-2">测试及格后随机掉落装备，掉率为练习时的10倍</p>
</div>
```

`formData` 初始值新增 `allow_equipment_drop: false`。

### 学生端 — 答题掉落特效（PracticeModule.tsx & WrongQuestions.tsx）

在现有游戏数据提取处（PracticeModule 行302-330，WrongQuestions 行208-234）新增：

```typescript
// 检查装备掉落
const droppedEquipments = result.data?.dropped_equipments || [];
if (droppedEquipments.length > 0) {
  // 触发掉落特效事件
  useGameEventStore.getState().emitEvent('equipment_drop', { equipments: droppedEquipments });
}
```

掉落特效组件（新增 `EquipmentDropEffect.tsx`）：
- 金色光芒动画（framer-motion）
- 显示装备图标（放大弹跳）+ 装备名称 + "+暴击X%"
- 位置：屏幕中央偏上，2秒后淡出
- 同时掉落多件装备时依次展示

### 学生端 — 个人中心装备栏（ProfileModule.tsx）

在"战力暴击"卡片下方新增"装备栏"卡片：

- **暴击来源展开区**新增一行：`装备加成 +{from_equipment}%`（紫色显示，现有行为 base 灰色、correct_count 蓝色、buffs 绿色）
- **装备列表**：网格布局，每个装备显示：图标(大) | 名称 | +暴击X% | ×数量
- 无装备时显示"暂无装备，答题正确有机会掉落装备"
- 数据来源：`GET /api/student/stats` 返回的 `equipment_list` 和 `crit_rate_breakdown.from_equipment`

### 学生端 — 荣誉图鉴中的装备显示

ProfileModule 的荣誉图鉴区域不需要改动装备相关内容（装备栏卡片独立展示）。

## 涉及文件清单

### 后端

| 文件 | 修改内容 |
|------|----------|
| `backend/database/migrations/028_add_equipment_drop.sql` | 新建迁移：equipments 表、student_equipments 表、tests 表加字段 |
| `backend/src/embedded-migrations.js` | 重新生成嵌入迁移 |
| `backend/src/index.js` | 新增装备 CRUD API、掉落逻辑、暴击率公式更新、stats API 更新 |

### 前端

| 文件 | 修改内容 |
|------|----------|
| `frontend/src/components/teacher/GameSettings.tsx` | 新增装备管理区域 |
| `frontend/src/components/teacher/TestManager.tsx` | 新增装备掉落开关 |
| `frontend/src/components/student/PracticeModule.tsx` | 答题掉落检测与事件触发 |
| `frontend/src/components/student/WrongQuestions.tsx` | 答题掉落检测与事件触发 |
| `frontend/src/components/student/ProfileModule.tsx` | 新增装备栏卡片、暴击来源增加装备加成 |
| `frontend/src/components/student/game/EquipmentDropEffect.tsx` | 新建：掉落特效组件 |
| `frontend/src/hooks/useGameSystem.ts` | stats 类型扩展（equipment_list、from_equipment） |

## 实现顺序

1. 数据库迁移（028_add_equipment_drop.sql）
2. 后端装备 CRUD API
3. 后端掉落逻辑 + 暴击率公式更新 + stats API 更新
4. 前端教师端装备管理 UI
5. 前端教师端考试设置开关
6. 前端学生端掉落特效
7. 前端学生端个人中心装备栏
8. 联调测试
