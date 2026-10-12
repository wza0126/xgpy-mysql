'use strict';

/**
 * 游戏化任务系统 · 后端路由
 * ============================================================
 * 教师端：「刷题打怪系统 → 任务系统」页的任务 CRUD（可编辑 / 启停 / 设适用班级）
 * 学生端：桌面「任务中心 → 每日任务 / 成就殿堂」的列表+进度、领取、红点计数
 *
 * ⛔ 铁律
 *   1) 奖励发放全程**服务端**执行，前端传来的任何金额/奖励概不采信。
 *   2) 领取幂等靠 `student_task_claims` 唯一键 (student_id, task_id, cycle_key)：
 *      daily → cycle_key = 当日日期；once → cycle_key = 'once'。先 INSERT 抢锁再发奖，
 *      重复领取在 INSERT 处即被拒绝，绝不重复发奖。
 *   3) 发奖全部在**同一事务**内，任一项失败整体回滚（含上网码库存不足）。
 *   4) 积分走原子 UPDATE（与全站一致），绝不前端读-改-写。
 *
 * 指标统计在 game-task-metrics.js，本文件只负责"判定 + 发奖 + 记账"。
 * 「系列」由指标派生（metrics.getSeriesOfMetric），不落库、不加列。
 */

const { v4: uuidv4 } = require('uuid');
const metrics = require('./game-task-metrics');

const REWARD_TYPES = ['points', 'internet_code', 'app', 'equipment'];
const MAX_REWARD_ITEMS = 6;
const MAX_BATCH = 500; // 单次批量操作上限

// ---------------- 工具 ----------------

/** 批量操作的 id 列表清洗：去重、去空、限长 */
function normalizeIdList(v) {
  if (!Array.isArray(v)) return [];
  return Array.from(new Set(v.map((x) => String(x).trim()).filter(Boolean)));
}

function safeJson(v, fallback) {
  if (v === null || v === undefined) return fallback;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return fallback; }
}

/** 适用班级：NULL / 空数组 = 不限班级 */
function normalizeClassIds(v) {
  const arr = safeJson(v, null);
  if (!Array.isArray(arr)) return null;
  const cleaned = arr.map((x) => String(x)).filter(Boolean);
  return cleaned.length ? cleaned : null;
}

/** 奖励数组清洗：只保留合法类型且数值 > 0 的项 */
function normalizeRewards(v) {
  const arr = safeJson(v, []);
  if (!Array.isArray(arr)) return [];
  return arr
    .map((r) => ({
      type: String((r && r.type) || ''),
      value: Number(r && r.value) || 0,
      target_id: r && r.target_id ? String(r.target_id) : null,
    }))
    .filter((r) => REWARD_TYPES.includes(r.type) && r.value > 0)
    .slice(0, MAX_REWARD_ITEMS);
}

// ---------------- 奖励发放（条件筛选 + 发奖 + 通知） ----------------

/** 条件运算符白名单 */
const COND_OPS = ['gte', 'gt', 'lte', 'lt', 'eq'];
const COND_MAX = 8;          // 一组筛选条件最多 8 条
const SCOPE_MAX = 1000;      // 单次发放候选学生上限

/** 筛选条件清洗 */
function normalizeConditions(v) {
  if (!Array.isArray(v)) return [];
  return v
    .map((c) => ({
      metric: String((c && c.metric) || '').trim(),
      op: COND_OPS.includes(c && c.op) ? c.op : 'gte',
      value: Number(c && c.value),
      params: c && typeof c.params === 'object' && c.params ? c.params : {},
    }))
    .filter((c) => c.metric && Number.isFinite(c.value))
    .slice(0, COND_MAX);
}

function cmpOp(value, op, target) {
  switch (op) {
    case 'gt': return value > target;
    case 'gte': return value >= target;
    case 'lt': return value < target;
    case 'lte': return value <= target;
    case 'eq': return Math.abs(value - target) < 1e-9;
    default: return false;
  }
}

function opLabel(op) {
  return { gt: '>', gte: '≥', lt: '<', lte: '≤', eq: '=' }[op] || '≥';
}

/** 单条条件的可读描述，如「累计掌握题数 ≥ 10题（掌握阈值 2 次）」 */
function condLabel(c) {
  const def = metrics.getMetricDef(c.metric);
  const name = def ? def.label : c.metric;
  let extra = '';
  if (c.params && c.params.kind === 'wps') extra = '（WPS）';
  else if (c.params && c.params.kind === 'access') extra = '（Access）';
  const unit = def ? (def.unit || '') : '';
  return `${name}${extra} ${opLabel(c.op)} ${c.value}${unit}`;
}

/** 按范围取候选学生（班级 / 指定学生，可组合为交集）；未指定范围返回 null */
async function loadScopeStudents(pool, classIds, studentIds) {
  if (!classIds.length && !studentIds.length) return null;
  let sql = "SELECT id, username, real_name, class_id FROM profiles WHERE role = 'student'";
  const args = [];
  if (classIds.length) {
    sql += ` AND class_id IN (${classIds.map(() => '?').join(',')})`;
    args.push(...classIds);
  }
  if (studentIds.length) {
    sql += ` AND id IN (${studentIds.map(() => '?').join(',')})`;
    args.push(...studentIds);
  }
  sql += ' ORDER BY class_id ASC, username ASC';
  const [rows] = await pool.query(sql, args);
  return rows;
}

/**
 * 逐个学生评估全部条件；返回命中的学生（附每条条件的实测值与是否通过）
 * logic='and' 全通过；'or' 至少一条通过；无条件下 = 范围内全部命中。
 */
async function evaluateStudents(pool, students, conditions, logic) {
  const out = [];
  for (const s of students) {
    const checks = [];
    let allPass = true;
    let anyPass = false;
    for (const c of conditions) {
      const p = await metrics.getProgress(pool, c.metric, s.id, c.params);
      const value = Number(p.value) || 0;
      const pass = !p.error && cmpOp(value, c.op, c.value);
      checks.push({ metric: c.metric, op: c.op, target: c.value, value, pass, label: condLabel(c), text: p.text || '', error: p.error || null });
      if (pass) anyPass = true; else allPass = false;
    }
    const matched = conditions.length === 0 ? true : (logic === 'or' ? anyPass : allPass);
    if (matched) {
      const reasons = checks.filter((x) => x.pass).map((x) => x.label);
      out.push({ id: s.id, username: s.username, real_name: s.real_name, class_id: s.class_id, checks, reasons });
    }
  }
  return out;
}

/** 奖励物项的可读描述（装备名从 map 查） */
function rewardLine(r, equipMap) {
  const n = Math.max(1, Math.round(r.value));
  if (r.type === 'points') return `+${n} 积分`;
  if (r.type === 'internet_code') return `上网码 ×${n}`;
  if (r.type === 'equipment') return `${(equipMap && equipMap[r.target_id]) || '装备'} ×${n}`;
  if (r.type === 'app') return '解锁应用 ×1';
  return r.type;
}

function normalizeTaskRow(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    icon: row.icon || 'star',
    task_type: row.task_type || 'daily',
    metric: row.metric,
    metric_params: safeJson(row.metric_params, null),
    target_value: Number(row.target_value) || 0,
    unit: row.unit || '',
    rewards: normalizeRewards(row.rewards),
    class_ids: normalizeClassIds(row.class_ids),
    is_active: !!Number(row.is_active),
    sort_order: Number(row.sort_order) || 0,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function todayStrSql() {
  return "SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS d";
}

// ---------------- 发奖 ----------------

/**
 * 在既有事务连接内发放奖励。
 * @throws 任一项失败即抛错（调用方 rollback）
 */
async function grantRewards(conn, { studentId, studentUsername, task, rewards, context }) {
  // context 允许复用本函数做「任务领取」以外场景的发放（如通知管理的奖励发放）：
  //   sourceType  记账来源（point_transactions.source_type / internet_codes.source），默认 'mission'
  //   sourceId    记账来源 id，默认 task.id
  //   pointsReason 积分流水原因，默认 `完成任务「name」`
  const ctx = context || {};
  const sourceType = ctx.sourceType || 'mission';
  const sourceId = ctx.sourceId !== undefined ? ctx.sourceId : (task ? task.id : null);
  const pointsReason = ctx.pointsReason || (task ? `完成任务「${task.name}」` : '奖励发放');
  const granted = [];
  for (const r of rewards) {
    const n = Math.max(1, Math.round(r.value));

    if (r.type === 'points') {
      await conn.query(
        'UPDATE profiles SET current_points = current_points + ?, ' +
        'total_points_earned = COALESCE(total_points_earned, 0) + ? WHERE id = ?',
        [n, n, studentId]
      );
      await conn.query(
        'UPDATE profiles SET max_points = GREATEST(COALESCE(max_points, 0), current_points) WHERE id = ?',
        [studentId]
      );
      await conn.query(
        'INSERT INTO point_transactions (student_id, amount, reason, source_type, source_id, created_at) VALUES (?, ?, ?, ?, ?, NOW())',
        [studentId, n, pointsReason, sourceType, sourceId]
      );
      granted.push({ type: 'points', value: n, label: `+${n} 积分` });
    }

    else if (r.type === 'internet_code') {
      const [codes] = await conn.query(
        'SELECT id, code FROM internet_codes WHERE is_used = 0 ORDER BY id LIMIT ? FOR UPDATE',
        [n]
      );
      if (codes.length < n) {
        throw new Error(`上网码库存不足（需 ${n} 个，仅剩 ${codes.length} 个），请联系老师补充后领取`);
      }
      const ids = codes.map((c) => c.id);
      await conn.query(
        'UPDATE internet_codes SET is_used = 1, used_by = ?, used_at = NOW(), used_by_username = ?, source = ?, source_id = ? WHERE id IN (?)',
        [studentId, studentUsername || '', sourceType, sourceId, ids]
      );
      granted.push({ type: 'internet_code', value: n, label: `上网码 ×${n}`, codes: codes.map((c) => c.code) });
    }

    else if (r.type === 'app') {
      if (!r.target_id) throw new Error('应用解锁奖励未指定应用');
      const [apps] = await conn.query('SELECT name FROM apps WHERE id = ? LIMIT 1', [r.target_id]);
      const appName = apps.length ? apps[0].name : '';
      await conn.query(
        'INSERT INTO student_app_usage (id, student_id, app_id, points_spent, acquired_at, usage_count) ' +
        'VALUES (?, ?, ?, 0, NOW(), 1) ON DUPLICATE KEY UPDATE usage_count = usage_count',
        [uuidv4(), studentId, r.target_id]
      );
      granted.push({ type: 'app', value: 1, target_id: r.target_id, label: `解锁应用：${appName || r.target_id}` });
    }

    else if (r.type === 'equipment') {
      if (!r.target_id) throw new Error('装备奖励未指定装备');
      const [eqs] = await conn.query('SELECT name, icon FROM equipments WHERE id = ? LIMIT 1', [r.target_id]);
      const eq = eqs.length ? eqs[0] : {};
      await conn.query(
        'INSERT INTO student_equipments (id, student_id, equipment_id, quantity, acquired_at) ' +
        'VALUES (?, ?, ?, ?, NOW()) ON DUPLICATE KEY UPDATE quantity = quantity + ?',
        [uuidv4(), studentId, r.target_id, n, n]
      );
      granted.push({
        type: 'equipment', value: n, target_id: r.target_id,
        label: `${eq.icon || ''}${eq.name || '装备'} ×${n}`,
      });
    }
  }
  return granted;
}

// ---------------- 学生可见任务 ----------------

/**
 * 取某学生当前可见的启用中任务（按班级过滤）
 * @param type 'daily' | 'once' | null(全部)
 */
async function loadVisibleTasks(pool, studentId, type) {
  let sql = 'SELECT * FROM game_tasks WHERE is_active = 1';
  const args = [];
  if (type === 'daily' || type === 'once') {
    sql += ' AND task_type = ?';
    args.push(type);
  }
  sql += ' ORDER BY sort_order ASC, created_at ASC';
  const [rows] = await pool.query(sql, args);

  const [pr] = await pool.query('SELECT class_id FROM profiles WHERE id = ? LIMIT 1', [studentId]);
  const classId = pr.length ? pr[0].class_id : null;

  return rows
    .map(normalizeTaskRow)
    .filter((t) => {
      if (!t.class_ids) return true;                 // 不限班级
      return !!(classId && t.class_ids.includes(classId));
    });
}

/**
 * 领取记录映射：task_id -> { cycle_key, claimed_at }
 * daily 看今天、once 看永久；一个任务只会是其一，故同一 task_id 至多一行。
 */
async function loadClaimMap(pool, studentId) {
  const [rows] = await pool.query(
    'SELECT task_id, cycle_key, claimed_at FROM student_task_claims WHERE student_id = ? ' +
    "AND (cycle_key = 'once' OR cycle_key = DATE_FORMAT(CURDATE(), '%Y-%m-%d'))",
    [studentId]
  );
  const map = new Map();
  rows.forEach((r) => map.set(r.task_id, { cycle_key: r.cycle_key, claimed_at: r.claimed_at }));
  return map;
}

/**
 * 学生端任务项的统一形状（含由指标派生的 series，供成就殿堂分组）
 */
function buildStudentItem(task, progress, claim) {
  const p = progress || { value: 0, text: '' };
  const claimed = !!claim;
  return {
    id: task.id,
    name: task.name,
    description: task.description,
    icon: task.icon,
    task_type: task.task_type,
    unit: task.unit,
    target_value: task.target_value,
    rewards: task.rewards,
    series: metrics.getSeriesOfMetric(task.metric),
    progress: { value: p.value, text: p.text || '', error: p.error || null },
    can_claim: !claimed && !p.error && p.value >= task.target_value,
    claimed,
    claimed_at: claim ? claim.claimed_at : null,
  };
}

// ---------------- 注册 ----------------

function registerGameTasks(app, deps) {
  const { pool, authenticate, requireTeacher, requireStudent } = deps;

  // ============ 教师端 ============

  // 元数据：可选指标 + 奖励可选项（班级 / 应用 / 装备）+ 系列清单
  // ⚠️ 必须注册在 /:id 之前，否则被 :id 吃掉
  app.get('/api/teacher/game-tasks/meta', authenticate, requireTeacher, async (req, res) => {
    try {
      const [classes] = await pool.query('SELECT id, name FROM classes ORDER BY name');
      const [apps] = await pool.query('SELECT id, name FROM apps WHERE is_active = 1 ORDER BY name');
      const [equipments] = await pool.query('SELECT id, name, icon FROM equipments WHERE is_active = 1 ORDER BY name');
      res.json({
        data: {
          metrics: metrics.listMetrics(),
          series: metrics.listSeries(),
          rewardTypes: [
            { type: 'points', label: '积分' },
            { type: 'internet_code', label: '上网码' },
            { type: 'app', label: '应用解锁' },
            { type: 'equipment', label: '装备' },
          ],
          classes: classes || [],
          apps: apps || [],
          equipments: equipments || [],
        },
      });
    } catch (e) {
      res.status(500).json({ data: null, error: e.message });
    }
  });

  // 今日各任务领取情况（教师端概览）
  app.get('/api/teacher/game-tasks/stats', authenticate, requireTeacher, async (req, res) => {
    try {
      const [rows] = await pool.query(
        'SELECT task_id, COUNT(*) AS claims FROM student_task_claims ' +
        "WHERE claimed_at >= CURDATE() AND claimed_at < CURDATE() + INTERVAL 1 DAY GROUP BY task_id"
      );
      const map = {};
      rows.forEach((r) => { map[r.task_id] = Number(r.claims) || 0; });
      res.json({ data: map });
    } catch (e) {
      res.status(500).json({ data: null, error: e.message });
    }
  });

  // 列表
  app.get('/api/teacher/game-tasks', authenticate, requireTeacher, async (req, res) => {
    try {
      const { type } = req.query;
      let sql = 'SELECT * FROM game_tasks WHERE 1=1';
      const args = [];
      if (type === 'daily' || type === 'once') {
        sql += ' AND task_type = ?';
        args.push(type);
      }
      sql += ' ORDER BY sort_order ASC, created_at ASC';
      const [rows] = await pool.query(sql, args);
      res.json({ data: rows.map(normalizeTaskRow) });
    } catch (e) {
      res.status(500).json({ data: null, error: e.message });
    }
  });

  // 新建
  app.post('/api/teacher/game-tasks', authenticate, requireTeacher, async (req, res) => {
    try {
      const b = req.body || {};
      const name = String(b.name || '').trim();
      if (!name) return res.status(400).json({ data: null, error: '任务名称不能为空' });

      const metric = String(b.metric || '').trim();
      if (!metrics.getMetricDef(metric)) {
        return res.status(400).json({ data: null, error: `未知统计指标：${metric}` });
      }

      const rewards = normalizeRewards(b.rewards);
      if (!rewards.length) return res.status(400).json({ data: null, error: '至少配置一项奖励' });

      const taskType = b.task_type === 'once' ? 'once' : 'daily';
      const targetValue = Number(b.target_value);
      if (!Number.isFinite(targetValue) || targetValue <= 0) {
        return res.status(400).json({ data: null, error: '目标值必须为大于 0 的数字' });
      }

      const id = String(b.id || '').trim() || `gtask_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      await pool.query(
        'INSERT INTO game_tasks (id, name, description, icon, task_type, metric, metric_params, target_value, unit, rewards, class_ids, is_active, sort_order, created_by) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          id, name,
          String(b.description || '').slice(0, 255) || null,
          String(b.icon || 'star').slice(0, 30),
          taskType,
          metric,
          b.metric_params ? JSON.stringify(b.metric_params) : null,
          targetValue,
          String(b.unit || '').slice(0, 10),
          JSON.stringify(rewards),
          b.class_ids ? JSON.stringify(b.class_ids) : null,
          b.is_active === false ? 0 : 1,
          Number(b.sort_order) || 0,
          (req.user && req.user.userId) || null,
        ]
      );
      res.json({ data: { id } });
    } catch (e) {
      res.status(500).json({ data: null, error: e.message });
    }
  });

  // 编辑（部分字段）
  app.put('/api/teacher/game-tasks/:id', authenticate, requireTeacher, async (req, res) => {
    try {
      const { id } = req.params;
      const [exist] = await pool.query('SELECT id FROM game_tasks WHERE id = ? LIMIT 1', [id]);
      if (!exist.length) return res.status(404).json({ data: null, error: '任务不存在' });

      const b = req.body || {};
      const sets = [];
      const args = [];

      if (b.name !== undefined) {
        const name = String(b.name).trim();
        if (!name) return res.status(400).json({ data: null, error: '任务名称不能为空' });
        sets.push('name = ?'); args.push(name);
      }
      if (b.description !== undefined) { sets.push('description = ?'); args.push(String(b.description).slice(0, 255) || null); }
      if (b.icon !== undefined) { sets.push('icon = ?'); args.push(String(b.icon).slice(0, 30)); }
      if (b.task_type !== undefined) { sets.push('task_type = ?'); args.push(b.task_type === 'once' ? 'once' : 'daily'); }
      if (b.metric !== undefined) {
        const metric = String(b.metric).trim();
        if (!metrics.getMetricDef(metric)) return res.status(400).json({ data: null, error: `未知统计指标：${metric}` });
        sets.push('metric = ?'); args.push(metric);
      }
      if (b.metric_params !== undefined) {
        sets.push('metric_params = ?');
        args.push(b.metric_params ? JSON.stringify(b.metric_params) : null);
      }
      if (b.target_value !== undefined) {
        const tv = Number(b.target_value);
        if (!Number.isFinite(tv) || tv <= 0) return res.status(400).json({ data: null, error: '目标值必须为大于 0 的数字' });
        sets.push('target_value = ?'); args.push(tv);
      }
      if (b.unit !== undefined) { sets.push('unit = ?'); args.push(String(b.unit).slice(0, 10)); }
      if (b.rewards !== undefined) {
        const rewards = normalizeRewards(b.rewards);
        if (!rewards.length) return res.status(400).json({ data: null, error: '至少配置一项奖励' });
        sets.push('rewards = ?'); args.push(JSON.stringify(rewards));
      }
      if (b.class_ids !== undefined) {
        const cids = normalizeClassIds(b.class_ids);
        sets.push('class_ids = ?'); args.push(cids ? JSON.stringify(cids) : null);
      }
      if (b.is_active !== undefined) { sets.push('is_active = ?'); args.push(b.is_active ? 1 : 0); }
      if (b.sort_order !== undefined) { sets.push('sort_order = ?'); args.push(Number(b.sort_order) || 0); }

      if (!sets.length) return res.status(400).json({ data: null, error: '没有可更新的字段' });

      args.push(id);
      await pool.query(`UPDATE game_tasks SET ${sets.join(', ')} WHERE id = ?`, args);
      res.json({ data: { id } });
    } catch (e) {
      res.status(500).json({ data: null, error: e.message });
    }
  });

  // 删除（连带清理该任务的领取记录，避免悬空）
  app.delete('/api/teacher/game-tasks/:id', authenticate, requireTeacher, async (req, res) => {
    try {
      const { id } = req.params;
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        const [r1] = await conn.query('DELETE FROM game_tasks WHERE id = ?', [id]);
        await conn.query('DELETE FROM student_task_claims WHERE task_id = ?', [id]);
        await conn.commit();
        if (!r1.affectedRows) return res.status(404).json({ data: null, error: '任务不存在' });
        res.json({ data: { id } });
      } catch (e) {
        try { await conn.rollback(); } catch { /* ignore */ }
        throw e;
      } finally {
        conn.release();
      }
    } catch (e) {
      res.status(500).json({ data: null, error: e.message });
    }
  });

  // 批量启用 / 停用（教师端多选后一次操作）
  app.post('/api/teacher/game-tasks/batch-update', authenticate, requireTeacher, async (req, res) => {
    try {
      const ids = normalizeIdList(req.body && req.body.ids);
      if (!ids.length) return res.status(400).json({ data: null, error: '未选择任何任务' });
      if (ids.length > MAX_BATCH) return res.status(400).json({ data: null, error: `一次最多操作 ${MAX_BATCH} 个任务` });
      const isActive = !!(req.body && req.body.is_active);
      const ph = ids.map(() => '?').join(',');
      const [r] = await pool.query(
        `UPDATE game_tasks SET is_active = ? WHERE id IN (${ph})`,
        [isActive ? 1 : 0, ...ids]
      );
      res.json({ data: { affected: r.affectedRows, is_active: isActive } });
    } catch (e) {
      res.status(500).json({ data: null, error: e.message });
    }
  });

  // 批量删除（连带清理这些任务的领取记录，避免悬空）
  app.post('/api/teacher/game-tasks/batch-delete', authenticate, requireTeacher, async (req, res) => {
    try {
      const ids = normalizeIdList(req.body && req.body.ids);
      if (!ids.length) return res.status(400).json({ data: null, error: '未选择任何任务' });
      if (ids.length > MAX_BATCH) return res.status(400).json({ data: null, error: `一次最多删除 ${MAX_BATCH} 个任务` });
      const ph = ids.map(() => '?').join(',');
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        const [r] = await conn.query(`DELETE FROM game_tasks WHERE id IN (${ph})`, ids);
        await conn.query(`DELETE FROM student_task_claims WHERE task_id IN (${ph})`, ids);
        await conn.commit();
        res.json({ data: { affected: r.affectedRows } });
      } catch (e) {
        try { await conn.rollback(); } catch { /* ignore */ }
        throw e;
      } finally {
        conn.release();
      }
    } catch (e) {
      res.status(500).json({ data: null, error: e.message });
    }
  });

  // ---- 奖励发放：按指标条件筛选学生 → 发奖（积分/上网码/装备）→ 同时发通知 ----
  // dry_run=true 仅返回命中名单（不写库）；dry_run=false 才真正发放。
  app.post('/api/teacher/rewards/grant', authenticate, requireTeacher, async (req, res) => {
    const teacherId = req.user.userId;
    try {
      const b = req.body || {};
      const dryRun = !!b.dry_run;
      const scope = b.scope || {};
      const classIds = normalizeIdList(scope.class_ids);
      const studentIds = normalizeIdList(scope.student_ids);
      if (!classIds.length && !studentIds.length) {
        return res.status(400).json({ data: null, error: '请先选择班级或学生' });
      }
      if (classIds.length + studentIds.length > SCOPE_MAX) {
        return res.status(400).json({ data: null, error: `一次最多针对 ${SCOPE_MAX} 个对象发放` });
      }

      const conditions = normalizeConditions(b.conditions);
      if (Array.isArray(b.conditions) && b.conditions.length > conditions.length) {
        return res.status(400).json({ data: null, error: '存在无效的筛选条件（指标或数值不合法）' });
      }
      for (const c of conditions) {
        if (!metrics.getMetricDef(c.metric)) {
          return res.status(400).json({ data: null, error: `未知统计指标：${c.metric}` });
        }
      }
      const logic = b.logic === 'or' ? 'or' : 'and';
      const rewards = normalizeRewards(b.rewards);
      if (!dryRun && !rewards.length) {
        return res.status(400).json({ data: null, error: '至少配置一项奖励' });
      }

      const students = await loadScopeStudents(pool, classIds, studentIds);
      const matched = await evaluateStudents(pool, students, conditions, logic);

      const condText = conditions.length
        ? conditions.map(condLabel).join(logic === 'or' ? ' 或 ' : ' 且 ')
        : '（未设筛选条件，按所选范围）';

      if (dryRun) {
        return res.json({
          data: {
            candidates: students.length,
            matched_count: matched.length,
            logic,
            condition_text: condText,
            matched: matched.slice(0, 1000).map((m) => ({
              id: m.id, username: m.username, real_name: m.real_name, class_id: m.class_id,
              reasons: m.reasons,
              checks: m.checks.map((c) => ({ label: c.label, value: c.value, pass: c.pass, error: c.error })),
            })),
          },
          error: null,
        });
      }

      if (!matched.length) {
        return res.status(400).json({ data: null, error: '没有学生符合条件，未发放任何奖励' });
      }

      // 装备名映射（奖励文案用）
      const equipMap = {};
      const [eqs] = await pool.query('SELECT id, name, icon FROM equipments');
      eqs.forEach((e) => { equipMap[e.id] = (e.icon || '') + (e.name || ''); });

      // 上网码库存预检查（不足则直接拒绝，避免发到一半回滚）
      let codeNeed = 0;
      for (const r of rewards) {
        if (r.type === 'internet_code') codeNeed += Math.max(1, Math.round(r.value)) * matched.length;
      }
      if (codeNeed > 0) {
        const [[cr]] = await pool.query('SELECT COUNT(*) AS avail FROM internet_codes WHERE is_used = 0');
        if (Number(cr.avail) < codeNeed) {
          return res.status(400).json({ data: null, error: `上网码库存不足（共需 ${codeNeed} 个，仅剩 ${cr.avail} 个），请先补充` });
        }
      }

      const title = String(b.title || '').trim().slice(0, 255) || '🎁 奖励发放';
      const rewardLines = rewards.map((r) => rewardLine(r, equipMap));
      let finalContent = String(b.content || '').trim() || '老师给你发放了奖励，快去看看！';
      finalContent += `\n\n🎁 奖励物项：${rewardLines.join('、')}`;
      finalContent += `\n📋 发放条件：${condText}`;

      const pointPerStudent = rewards
        .filter((r) => r.type === 'points')
        .reduce((a, r) => a + Math.max(1, Math.round(r.value)), 0);

      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        const [nr] = await conn.query(
          "INSERT INTO notifications (teacher_id, title, content, notification_type, target_student_ids, published_at) VALUES (?, ?, ?, 'student', ?, NOW())",
          [teacherId, title, finalContent, JSON.stringify(matched.map((m) => m.id))]
        );
        const notificationId = nr.insertId;

        const details = [];
        for (const st of matched) {
          const myReason = st.reasons.length ? st.reasons.join('、') : condText;
          const granted = await grantRewards(conn, {
            studentId: st.id,
            studentUsername: st.username,
            rewards,
            context: {
              sourceType: 'notification',
              sourceId: String(notificationId),
              pointsReason: `奖励发放：${myReason}`,
            },
          });
          await conn.query(
            'INSERT INTO notification_recipients (notification_id, student_id, point_change, point_change_reason) VALUES (?, ?, ?, ?)',
            [notificationId, st.id, pointPerStudent, myReason]
          );
          details.push({ student_id: st.id, real_name: st.real_name, granted });
        }
        await conn.commit();
        res.json({ data: { notification_id: notificationId, granted_count: matched.length, granted: details }, error: null });
      } catch (e) {
        try { await conn.rollback(); } catch { /* ignore */ }
        throw e;
      } finally {
        conn.release();
      }
    } catch (e) {
      res.status(500).json({ data: null, error: e.message });
    }
  });

  // ============ 学生端 ============

  // 红点计数：已达成且本期未领取的任务数（**每日 + 成就一并统计**）
  // ⚠️ 必须注册在 /:id/claim 之前
  app.get('/api/student/daily-tasks/pending-count', authenticate, requireStudent, async (req, res) => {
    try {
      const studentId = req.user.userId;
      const tasks = await loadVisibleTasks(pool, studentId, null);
      if (!tasks.length) return res.json({ data: { count: 0, daily: 0, once: 0 } });

      const progressMap = await metrics.getProgressBatch(pool, tasks, studentId);
      const claimMap = await loadClaimMap(pool, studentId);

      // 拆分口径：daily（每日任务）/ once（成就殿堂）；count = 两者之和（桌面入口总红点）
      let daily = 0;
      let once = 0;
      for (const t of tasks) {
        const p = progressMap[t.id];
        if (p && !p.error && p.value >= t.target_value && !claimMap.has(t.id)) {
          if (t.task_type === 'once') once++;
          else daily++;
        }
      }
      res.json({ data: { count: daily + once, daily, once } });
    } catch (e) {
      res.status(500).json({ data: null, error: e.message });
    }
  });

  // 我的任务列表（含进度 / 可领取状态）
  app.get('/api/student/daily-tasks', authenticate, requireStudent, async (req, res) => {
    try {
      const studentId = req.user.userId;
      const type = req.query.type === 'once' ? 'once' : (req.query.type === 'all' ? null : 'daily');
      const tasks = await loadVisibleTasks(pool, studentId, type);
      const progressMap = await metrics.getProgressBatch(pool, tasks, studentId);
      const claimMap = await loadClaimMap(pool, studentId);

      const list = tasks.map((t) => buildStudentItem(t, progressMap[t.id], claimMap.get(t.id)));
      res.json({ data: list });
    } catch (e) {
      res.status(500).json({ data: null, error: e.message });
    }
  });

  // 我的成就殿堂（仅一次性成就；含系列清单与概览）
  app.get('/api/student/achievements', authenticate, requireStudent, async (req, res) => {
    try {
      const studentId = req.user.userId;
      const tasks = await loadVisibleTasks(pool, studentId, 'once');
      const progressMap = await metrics.getProgressBatch(pool, tasks, studentId);
      const claimMap = await loadClaimMap(pool, studentId);

      const items = tasks.map((t) => buildStudentItem(t, progressMap[t.id], claimMap.get(t.id)));
      const got = items.filter((i) => i.claimed).length;
      const ready = items.filter((i) => i.can_claim).length;

      // 最近点亮（once 领取记录里最新的一条）
      let last = null;
      try {
        const [lr] = await pool.query(
          'SELECT g.name, c.claimed_at FROM student_task_claims c ' +
          'JOIN game_tasks g ON g.id = c.task_id ' +
          "WHERE c.student_id = ? AND c.cycle_key = 'once' " +
          'ORDER BY c.claimed_at DESC LIMIT 1',
          [studentId]
        );
        if (lr.length) last = { name: lr[0].name, claimed_at: lr[0].claimed_at };
      } catch { /* ignore */ }

      res.json({
        data: {
          items,
          series: metrics.listSeries(),
          summary: { total: items.length, got, ready, last },
        },
      });
    } catch (e) {
      res.status(500).json({ data: null, error: e.message });
    }
  });

  // 领取奖励
  app.post('/api/student/daily-tasks/:id/claim', authenticate, requireStudent, async (req, res) => {
    const studentId = req.user.userId;
    const taskId = req.params.id;
    let conn = null;
    try {
      const [trs] = await pool.query('SELECT * FROM game_tasks WHERE id = ? LIMIT 1', [taskId]);
      if (!trs.length) return res.status(404).json({ data: null, error: '任务不存在' });
      const task = normalizeTaskRow(trs[0]);
      if (!task.is_active) return res.status(400).json({ data: null, error: '该任务已停用' });

      const [prs] = await pool.query('SELECT id, username, class_id FROM profiles WHERE id = ? LIMIT 1', [studentId]);
      if (!prs.length) return res.status(404).json({ data: null, error: '学生不存在' });
      const student = prs[0];

      if (task.class_ids && !(student.class_id && task.class_ids.includes(student.class_id))) {
        return res.status(403).json({ data: null, error: '该任务不适用于你所在的班级' });
      }

      const prog = await metrics.getProgress(pool, task.metric, studentId, task.metric_params);
      if (prog.error) return res.status(500).json({ data: null, error: `进度统计失败：${prog.error}` });
      if (!(prog.value >= task.target_value)) {
        return res.status(400).json({
          data: null,
          error: '任务尚未完成，继续加油！',
          meta: { progress: prog, target: task.target_value },
        });
      }

      conn = await pool.getConnection();
      await conn.beginTransaction();

      const [[{ d: today }]] = await conn.query(todayStrSql());
      const cycleKey = task.task_type === 'once' ? 'once' : today;
      const claimId = uuidv4();

      try {
        await conn.query(
          'INSERT INTO student_task_claims (id, student_id, task_id, cycle_key, progress_snapshot, reward_snapshot) VALUES (?, ?, ?, ?, ?, NULL)',
          [claimId, studentId, task.id, cycleKey, prog.value]
        );
      } catch (e) {
        await conn.rollback();
        conn.release();
        conn = null;
        if (e && e.code === 'ER_DUP_ENTRY') {
          return res.status(409).json({ data: null, error: '该任务本期奖励已领取过了' });
        }
        throw e;
      }

      const granted = await grantRewards(conn, {
        studentId,
        studentUsername: student.username,
        task,
        rewards: task.rewards,
      });

      await conn.query('UPDATE student_task_claims SET reward_snapshot = ? WHERE id = ?', [JSON.stringify(granted), claimId]);
      await conn.commit();
      conn.release();
      conn = null;

      res.json({
        data: {
          task: { id: task.id, name: task.name },
          granted,
          cycle_key: cycleKey,
        },
      });
    } catch (e) {
      if (conn) {
        try { await conn.rollback(); } catch { /* ignore */ }
        try { conn.release(); } catch { /* ignore */ }
      }
      res.status(400).json({ data: null, error: (e && e.message) || '领取失败，请稍后重试' });
    }
  });
}

module.exports = { registerGameTasks, grantRewards, normalizeRewards, normalizeTaskRow };
