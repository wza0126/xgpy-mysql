// 代码农场：把学生虚拟桌面变成可编程的农田
// 设计说明见 embedded-migrations.js 的 095 / 096 迁移注释。
//
// ⛔ 职责边界（铁律）：
//   1) 学生写的 Python 代码由「前端子集解释器」执行（零部署依赖、即时反馈），
//      前端只提交**操作序列 ops**（如 [{op:'water',n:2}]）与代码原文；
//   2) 作物生长、成熟判定、收获积分**一律在服务端**结算；前端传来的任何结果字段概不采信；
//   3) 积分只走原子写（UPDATE ... current_points = current_points + ?）+ point_transactions 记账；
//   4) 防刷：每天**劳作次数**上限（见下）+ 水分/养分各有上限。
//
// ⛔⛔ 劳作口径（核心规则，2026-10-12 重做）：
//   · 劳作按**动作单位**计，不按「提交次数」计：
//       播种 1 次 / 除草 1 次 / 收获 1 次 / water(n) = n 次 / fertilize(n) = n 次。
//   · **每一份水或肥都会立刻被作物吸收一次**（不是一次提交只吸收一次）。
//     → 所以 `water(5)` 与写 5 遍 `water()` 的效果和成本完全相同；
//       而 `water(10)` 会因为「水早就满了」白花 5 次劳作。
//   · 只有水/肥**真的增加**时才结算吸收；失败的操作（未成熟就收、空地除草…）不扣劳作。
//   · 于是最优解必然是 `while moisture() < 100 and ops_left() > 0: water()` ——
//     既不会浇多（浪费力气），也不会浇少（长得慢），而且水肥剩余量每天都不同，写死份数是赌运气。
//
// 教育设计（为什么这么定）：
//   · 「挂着也长」→ 时间自然生长，鼓励长期挂机；
//   · 「写代码长得快」→ 每一份水肥都换成成长，代码写得越精准、长速越快；
//   · 「粗略写法会被惩罚」→ 曾经的做法是「一次提交只吸收一次」，结果 `water(10); fertilize(10)`
//     两句就能封顶，循环 / 条件 / 函数全是装饰，代码质量对结果零影响（实测三种写法成长轨迹逐帧相同）。
//     改成「按动作计费 + 每次吸收」之后，精细写法 12 次劳作收一茬，粗暴写法把整日预算耗光还收不了。
//   · 「除草是门正经手艺」→ weed 收益同样乘水肥系数（水肥太低时几乎不长，绕不开主线），
//     但满水满肥时一次 +24（= LABOR_GROWTH × 1.5），比浇一份水还多 50%，是划算的主动选择。
//     定位：浇水/施肥是「投资」（既长自己，又抬高后续每一次除草的收益），除草是「变现」。

const crypto = require('crypto');

// ============ 常数与配置表 ============

const CROPS = {
  wheat: { name: '小麦', icon: 'wheat', yield_mult: 1.0 },
  carrot: { name: '胡萝卜', icon: 'carrot', yield_mult: 1.15 },
  corn: { name: '玉米', icon: 'corn', yield_mult: 1.35 },
};

const WEATHER = {
  sunny: { label: '晴', growth: 1.0, evap: 1.0 },
  rainy: { label: '雨', growth: 1.2, evap: 0.5 },
  drought: { label: '旱', growth: 0.6, evap: 1.8 },
};

const DAILY_BASE_GROWTH = 12; // 每天自然生长量（满水满肥时）
const LABOR_GROWTH = 16; // ⛔ 每吸收一份水/肥的生长量（满水满肥时）；吸收发生在每一次 water/fertilize 上
const WATER_PER_UNIT = 12; // 一份水补充的水分
const FERT_PER_UNIT = 12; // 一份肥补充的养分
const MAX_PARAM = 10; // 单次 water/fertilize 最多带几份（同时也是它要花的劳作次数）
const MAX_OPS = 80; // 单次提交的操作条数上限（程序长度保护，与劳作次数无关）
const MAX_DEFAULT_CODE = 4000; // 教师配置的「编辑器默认代码」长度上限（防误贴大文件）
// ⛔ 除草加成（满水满肥时；实际值 = 此值 × 水% × 肥% × 天气）。
//    = LABOR_GROWTH × 1.5 → 满水满肥时「一次除草 = 1.5 次浇水的成长」，除草才有学生愿意用。
//    ⚠️ 别再往上调：W ≥ 80 时「完全不浇水施肥、只靠除草」也能达到最优，水肥管理会被架空
//      （见 .workbuddy/memory/2026-10-12.md 的调参表）。
const WEED_GROWTH = 24;
const DAILY_MOISTURE_LOSS = 6; // 每天蒸发
const DAILY_NUTRIENT_LOSS = 4; // 每天消耗
const MAX_TICK_DAYS = 500; // 长时间未访问时最多补算的天数（防长循环）
const RESET_MOISTURE = 50; // 空地与收获后的初始水分
const RESET_NUTRIENT = 50;

// 动作名（用于提示文案）
const OP_LABEL = {
  plant: '播种',
  water: '浇水',
  fertilize: '施肥',
  weed: '除草',
  harvest: '收获',
};

const DEFAULT_CFG = {
  enabled: 0,
  class_ids: null,
  day_minutes: 10,
  base_yield: 10,
  // ⛔ 语义 = 「每天的劳作次数」（按动作计，不是提交次数）。
  // 一茬地从 水50/肥50 到成熟约需 12 次：播种 1 + 水 5 + 肥 5 + 收获 1，故默认 15 留 3 次容错。
  max_ops_per_day: 15,
  weather: 'sunny',
  notice: null,
  // 编辑器默认代码（教师可配）：NULL/'' 时前端用内置示例兜底
  default_code: null,
  start_at: null,
};

// ============ 纯函数（结算引擎，便于单独测试） ============

function num(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

function round2(v) {
  return Math.round(num(v) * 100) / 100;
}

function genId() {
  return 'farm_' + crypto.randomUUID().replace(/-/g, '').slice(0, 20);
}

// 生长值 -> 阶段：0 空地 / 1 幼苗 / 2 成长 / 3 成熟
function stageOf(growth, crop) {
  if (!crop) return 0;
  const g = num(growth, 0);
  if (g >= 100) return 3;
  if (g >= 50) return 2;
  return 1;
}

function parseClassIds(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v.map(String).filter(Boolean);
  try {
    const a = JSON.parse(v);
    return Array.isArray(a) ? a.map(String).filter(Boolean) : [];
  } catch (_) {
    return [];
  }
}

// 空数组 = 全校生效
function inScope(classIds, classId) {
  if (!classIds.length) return true;
  return classIds.includes(String(classId || ''));
}

function dayIndexOf(cfg, at) {
  const start = cfg && cfg.start_at ? new Date(cfg.start_at).getTime() : null;
  if (!start || !Number.isFinite(start)) return 0;
  const dayMs = Math.max(1, num(cfg.day_minutes, 10)) * 60000;
  return Math.max(0, Math.floor((at - start) / dayMs));
}

function weatherOf(cfg) {
  return WEATHER[(cfg && cfg.weather) || 'sunny'] || WEATHER.sunny;
}

// 单日自然演化：作物按水肥比例生长，同时水分蒸发、养分消耗
function oneDayTick(plot, w) {
  if (plot.crop) {
    const mf = clamp(num(plot.moisture, 0) / 100, 0, 1);
    const nf = clamp(num(plot.nutrient, 0) / 100, 0, 1);
    plot.growth = clamp(num(plot.growth, 0) + DAILY_BASE_GROWTH * mf * nf * w.growth, 0, 100);
  }
  plot.moisture = clamp(num(plot.moisture, 0) - DAILY_MOISTURE_LOSS * w.evap, 0, 100);
  plot.nutrient = clamp(num(plot.nutrient, 0) - DAILY_NUTRIENT_LOSS, 0, 100);
  plot.stage = stageOf(plot.growth, plot.crop);
}

// 懒结算：把地块从「上次结算的天」补算到「当前天」。返回补算了几天。
function tickPlot(plot, cfg, now) {
  const day = dayIndexOf(cfg, now);
  let d = day - num(plot.day_index, 0);
  if (d <= 0) {
    // 跨天但没长（同日多次访问）也要重置劳作计数
    if (num(plot.ops_day, -1) !== day) {
      plot.ops_today = 0;
      plot.ops_day = day;
    }
    return { days: 0, day };
  }
  if (d > MAX_TICK_DAYS) d = MAX_TICK_DAYS;
  const w = weatherOf(cfg);
  for (let i = 0; i < d; i++) oneDayTick(plot, w);
  plot.day_index = day;
  plot.ops_today = 0;
  plot.ops_day = day;
  return { days: d, day };
}

const ACTION_OPS = ['plant', 'water', 'fertilize', 'weed', 'harvest'];

// 回放操作序列。budget = 今天还剩几次劳作。
// ⛔ 劳作口径：plant / weed / harvest 各 1 次；water(n) / fertilize(n) 各 n 次。
// ⛔ 吸收时机：每补进一份水/肥就立刻吸收一次（不是整段代码末尾吸收一次）。
// 返回 { events, acted, labor, refused, gained, harvests }
function applyOps(plot, cfg, ops, budget) {
  const w = weatherOf(cfg);
  const events = [];
  const harvests = [];
  let acted = 0; // 生效的操作条数
  let labor = 0; // 实际消耗的劳作次数
  let refused = 0; // 因劳作次数不够而被挡下的条数
  let gained = 0;
  let left = Math.max(0, Math.round(num(budget, 0)));
  const list = Array.isArray(ops) ? ops.slice(0, MAX_OPS) : [];

  // 一次「吸收」：作物按当前水肥比例长一截。只有水/肥真的增加时才会调用。
  const absorb = () => {
    if (!plot.crop) return 0;
    const mf = clamp(num(plot.moisture, 0) / 100, 0, 1);
    const nf = clamp(num(plot.nutrient, 0) / 100, 0, 1);
    const before = num(plot.growth, 0);
    plot.growth = clamp(before + LABOR_GROWTH * mf * nf * w.growth, 0, 100);
    plot.stage = stageOf(plot.growth, plot.crop);
    return plot.growth - before;
  };

  // 扣劳作。不够就记账并返回 false（这一条不执行，也不扣）。
  const charge = (op, cost) => {
    if (cost > left) {
      refused++;
      events.push({
        ok: false,
        text: '力气不够了：' + OP_LABEL[op] + '要花 ' + cost + ' 次劳作，今天只剩 ' + left + ' 次',
      });
      return false;
    }
    left -= cost;
    labor += cost;
    return true;
  };

  for (let i = 0; i < list.length; i++) {
    const raw = list[i];
    const op = String((raw && raw.op) || '');

    if (!ACTION_OPS.includes(op)) {
      events.push({ ok: false, text: '不认识的操作：' + (op || '(空)') });
      continue;
    }
    if (left <= 0) {
      refused += list.length - i;
      events.push({ ok: false, text: '今天的劳作次数用完了，后面的操作都没有执行' });
      break;
    }

    if (op === 'plant') {
      const key = String((raw && raw.crop) || '');
      const c = CROPS[key];
      if (!c) {
        events.push({ ok: false, text: '没有「' + (key || '?') + '」这种作物' });
        continue;
      }
      if (plot.crop) {
        events.push({ ok: false, text: '这块地还种着' + CROPS[plot.crop].name + '，先收获再说' });
        continue;
      }
      if (!charge(op, 1)) continue;
      plot.crop = key;
      plot.growth = 0;
      plot.stage = 1;
      events.push({ ok: true, text: '播下「' + c.name + '」（花 1 次劳作）' });
      acted++;
    } else if (op === 'water' || op === 'fertilize') {
      const isWater = op === 'water';
      const unit = isWater ? WATER_PER_UNIT : FERT_PER_UNIT;
      const n = clamp(Math.round(num(raw && raw.n, 1)), 1, MAX_PARAM);
      if (!charge(op, n)) continue;
      const before = round2(isWater ? plot.moisture : plot.nutrient);
      let ups = 0; // 真的补进去的份数
      let delta = 0; // 累计吸收的成长（原始值，最后再取两位）
      for (let k = 0; k < n; k++) {
        const b = num(isWater ? plot.moisture : plot.nutrient, 0);
        const v = clamp(b + unit, 0, 100);
        if (isWater) plot.moisture = v;
        else plot.nutrient = v;
        if (v > b) {
          ups++;
          delta += absorb();
        }
      }
      const after = round2(isWater ? plot.moisture : plot.nutrient);
      let text =
        OP_LABEL[op] + ' x' + n + '（花 ' + n + ' 次劳作）：' +
        (isWater ? '水分' : '养分') + ' ' + before + ' → ' + after;
      if (ups < n) {
        text += '，只有 ' + ups + ' 份补得进去，另外 ' + (n - ups) + ' 份白花了力气';
      }
      text += delta > 0
        ? '，作物吸收了 ' + ups + ' 次：成长 +' + round2(delta)
        : '，没有作物吸收（成长不变）';
      events.push({ ok: true, text });
      acted++;
    } else if (op === 'weed') {
      if (!plot.crop) {
        events.push({ ok: false, text: '空地没有杂草可除' });
        continue;
      }
      if (!charge(op, 1)) continue;
      // ⛔ 除草的收益同样要看水肥：水肥不足时松土几乎没用，无法绕开主线（不需额外的次数上限）。
      const mf = clamp(num(plot.moisture, 0) / 100, 0, 1);
      const nf = clamp(num(plot.nutrient, 0) / 100, 0, 1);
      const before = round2(plot.growth);
      const add = WEED_GROWTH * mf * nf * w.growth;
      plot.growth = clamp(num(plot.growth, 0) + add, 0, 100);
      plot.stage = stageOf(plot.growth, plot.crop);
      events.push({
        ok: true,
        text:
          '除草松土（花 1 次劳作）：成长 ' + before + ' → ' + round2(plot.growth) +
          (add < 1 ? '（水肥不足，除草几乎没用）' : ''),
      });
      acted++;
    } else if (op === 'harvest') {
      if (!plot.crop) {
        events.push({ ok: false, text: '空地没什么可收的' });
        continue;
      }
      if (num(plot.growth, 0) < 100) {
        events.push({ ok: false, text: CROPS[plot.crop].name + '还没成熟（' + round2(plot.growth) + '/100）' });
        continue;
      }
      if (!charge(op, 1)) continue;
      const c = CROPS[plot.crop];
      const gain = Math.round(num(cfg.base_yield, 10) * c.yield_mult);
      gained += gain;
      plot.total_harvest = num(plot.total_harvest, 0) + 1;
      plot.total_points = num(plot.total_points, 0) + gain;
      harvests.push({ crop: plot.crop, name: c.name, gain });
      events.push({ ok: true, text: '收获「' + c.name + '」，+' + gain + ' 积分（花 1 次劳作）' });
      plot.crop = null;
      plot.growth = 0;
      plot.stage = 0;
      plot.moisture = RESET_MOISTURE;
      plot.nutrient = RESET_NUTRIENT;
      acted++;
    }
  }

  plot.stage = stageOf(plot.growth, plot.crop);
  return { events, acted, labor, refused, gained, harvests };
}

// 学生视角的地块形状（不泄漏内部字段）
function shapePlot(p) {
  const crop = p.crop || null;
  return {
    student_id: p.student_id,
    name: p.real_name || p.username || '',
    crop,
    crop_name: crop && CROPS[crop] ? CROPS[crop].name : '',
    growth: round2(p.growth),
    moisture: round2(p.moisture),
    nutrient: round2(p.nutrient),
    stage: num(p.stage, 0),
    total_harvest: num(p.total_harvest, 0),
    total_points: num(p.total_points, 0),
  };
}

function cropCatalog() {
  return Object.keys(CROPS).map((k) => ({
    key: k,
    name: CROPS[k].name,
    icon: CROPS[k].icon,
    yield_mult: CROPS[k].yield_mult,
  }));
}

// ============ 路由 ============

function registerFarm(app, { pool, authenticate, requireTeacher, requireStudent }) {
  async function loadConfig() {
    const [rows] = await pool.query('SELECT * FROM farm_config WHERE id = 1');
    return rows[0] || Object.assign({ id: 1 }, DEFAULT_CFG);
  }

  async function loadProfile(studentId) {
    const [rows] = await pool.query(
      'SELECT id, class_id, username, real_name FROM profiles WHERE id = ? LIMIT 1',
      [studentId]
    );
    return rows[0] || null;
  }

  // 判定某学生能否玩：开关开 && 班级命中
  async function resolveAccess(studentId) {
    const cfg = await loadConfig();
    const prof = await loadProfile(studentId);
    const classIds = parseClassIds(cfg.class_ids);
    const enabled = Number(cfg.enabled) === 1;
    const scopeOk = inScope(classIds, prof && prof.class_id);
    return { cfg, prof, classIds, active: enabled && scopeOk, enabled, scopeOk };
  }

  // 确保地块存在
  async function ensurePlot(studentId, classId) {
    const [rows] = await pool.query('SELECT * FROM farm_plots WHERE student_id = ? LIMIT 1', [studentId]);
    if (rows.length) return rows[0];
    await pool.query(
      'INSERT IGNORE INTO farm_plots (id, student_id, class_id, moisture, nutrient) VALUES (?, ?, ?, ?, ?)',
      [genId(), studentId, classId || null, RESET_MOISTURE, RESET_NUTRIENT]
    );
    const [again] = await pool.query('SELECT * FROM farm_plots WHERE student_id = ? LIMIT 1', [studentId]);
    return again[0] || null;
  }

  function plotUpdateSql() {
    return (
      'UPDATE farm_plots SET crop=?, growth=?, moisture=?, nutrient=?, stage=?, day_index=?, ' +
      'ops_today=?, ops_day=?, total_harvest=?, total_points=?, last_tick_at=NOW(), class_id=? WHERE id=?'
    );
  }

  function plotUpdateParams(p) {
    return [
      p.crop || null,
      round2(p.growth),
      round2(p.moisture),
      round2(p.nutrient),
      num(p.stage, 0),
      num(p.day_index, 0),
      num(p.ops_today, 0),
      num(p.ops_day, 0),
      num(p.total_harvest, 0),
      num(p.total_points, 0),
      p.class_id || null,
      p.id,
    ];
  }

  function worldInfo(cfg, now) {
    const w = weatherOf(cfg);
    const dayMs = Math.max(1, num(cfg.day_minutes, 10)) * 60000;
    const start = cfg.start_at ? new Date(cfg.start_at).getTime() : null;
    const elapsed = start && Number.isFinite(start) ? Math.max(0, now - start) : 0;
    return {
      day: dayIndexOf(cfg, now) + 1,
      day_minutes: num(cfg.day_minutes, 10),
      day_progress: Math.min(1, (elapsed % dayMs) / dayMs),
      weather: cfg.weather || 'sunny',
      weather_label: w.label,
      notice: cfg.notice || '',
      // ⛔ 教师配置的编辑器默认代码：学生端拿它当初始模板 / 「恢复默认代码」的目标
      default_code: cfg.default_code || '',
      base_yield: num(cfg.base_yield, 10),
      // ⛔ 语义 = 每天的劳作次数（按动作计）。前端拿它算「今天还能劳作 N 次」。
      max_ops_per_day: num(cfg.max_ops_per_day, DEFAULT_CFG.max_ops_per_day),
      max_ops_per_run: MAX_OPS,
      weed_growth: WEED_GROWTH,
      labor_growth: LABOR_GROWTH,
      water_per_unit: WATER_PER_UNIT,
      fert_per_unit: FERT_PER_UNIT,
      max_param: MAX_PARAM,
      crops: cropCatalog(),
    };
  }

  // ---------- 学生端：农场状态（桌面轮询用） ----------
  app.get('/api/student/farm/state', authenticate, requireStudent, async (req, res) => {
    try {
      const studentId = req.user.userId || req.user.user_id;
      const { cfg, prof, active, enabled, scopeOk } = await resolveAccess(studentId);
      if (!active) {
        return res.json({
          data: {
            enabled: false,
            reason: !enabled ? 'closed' : (!scopeOk ? 'out_of_scope' : 'unknown'),
          },
          error: null,
        });
      }

      const now = Date.now();
      const myPlot = await ensurePlot(studentId, prof && prof.class_id);
      if (!myPlot) return res.json({ data: { enabled: false, reason: 'no_plot' }, error: null });

      const t = tickPlot(myPlot, cfg, now);
      await pool.query(plotUpdateSql(), plotUpdateParams(myPlot));

      const maxOps = Math.max(1, num(cfg.max_ops_per_day, DEFAULT_CFG.max_ops_per_day));

      // 同班同学的地块（内存补算，不落库；仅用于「看谁的地长得好」）
      const [peers] = await pool.query(
        'SELECT p.student_id, p.class_id, p.crop, p.growth, p.moisture, p.nutrient, p.stage, ' +
          'p.day_index, p.ops_today, p.ops_day, p.total_harvest, p.total_points, ' +
          'pr.real_name, pr.username ' +
          'FROM farm_plots p LEFT JOIN profiles pr ON pr.id = p.student_id ' +
          'WHERE p.class_id = ? ORDER BY p.total_points DESC, p.total_harvest DESC, p.growth DESC LIMIT 120',
        [prof.class_id]
      );
      const peerList = peers.map((p) => {
        const copy = Object.assign({}, p);
        tickPlot(copy, cfg, now);
        return shapePlot(copy);
      });

      return res.json({
        data: {
          enabled: true,
          world: worldInfo(cfg, now),
          me: Object.assign(shapePlot(myPlot), {
            ops_left_today: Math.max(0, maxOps - num(myPlot.ops_today, 0)),
            ticked_days: t.days,
          }),
          peers: peerList,
        },
        error: null,
      });
    } catch (error) {
      console.error('Error in GET /api/student/farm/state:', error);
      res.status(500).json({ data: null, error: error.message });
    }
  });

  // ---------- 学生端：提交一段农活代码（前端已解释成 ops） ----------
  app.post('/api/student/farm/run', authenticate, requireStudent, async (req, res) => {
    const studentId = req.user.userId || req.user.user_id;
    let conn = null;
    try {
      const { cfg, prof, active } = await resolveAccess(studentId);
      if (!active) return res.status(403).json({ data: null, error: '农场游戏未开启' });

      const body = req.body || {};
      const ops = Array.isArray(body.ops) ? body.ops : [];
      const code = typeof body.code === 'string' ? body.code : '';
      const prints = Array.isArray(body.prints) ? body.prints.slice(0, 200) : [];
      if (ops.length > MAX_OPS) {
        return res.status(400).json({ data: null, error: '一次提交的操作太多了（上限 ' + MAX_OPS + ' 条）' });
      }

      const now = Date.now();
      const maxOps = Math.max(1, num(cfg.max_ops_per_day, DEFAULT_CFG.max_ops_per_day));
      const hasAction = ops.some((o) => o && ACTION_OPS.includes(String(o.op)));

      conn = await pool.getConnection();
      await conn.beginTransaction();

      const [rows] = await conn.query('SELECT * FROM farm_plots WHERE student_id = ? FOR UPDATE', [studentId]);
      let plot = rows[0];
      if (!plot) {
        await conn.query(
          'INSERT IGNORE INTO farm_plots (id, student_id, class_id, moisture, nutrient) VALUES (?, ?, ?, ?, ?)',
          [genId(), studentId, (prof && prof.class_id) || null, RESET_MOISTURE, RESET_NUTRIENT]
        );
        const [again] = await conn.query('SELECT * FROM farm_plots WHERE student_id = ? FOR UPDATE', [studentId]);
        plot = again[0];
      }
      if (!plot) throw new Error('地块初始化失败');
      plot.class_id = (prof && prof.class_id) || plot.class_id;

      // 先按时间补算（顺带跨天重置劳作次数）
      const tick = tickPlot(plot, cfg, now);

      if (hasAction && num(plot.ops_today, 0) >= maxOps) {
        await conn.rollback();
        conn.release();
        conn = null;
        return res.status(429).json({
          data: null,
          error:
            '今天的劳作次数用完了（每天 ' + maxOps + ' 次，播种/浇水/除草/施肥/收获 各算 1 次），明天再来吧',
        });
      }

      // ⛔ 劳作按动作计：budget 是「今天还剩几次」，由 applyOps 自己扣、自己记账
      const result = applyOps(plot, cfg, ops, maxOps - num(plot.ops_today, 0));
      plot.ops_today = num(plot.ops_today, 0) + result.labor;
      plot.ops_day = dayIndexOf(cfg, now);

      await conn.query(plotUpdateSql(), plotUpdateParams(plot));

      // 收获积分：原子写 + 流水（⛔ 不与其它积分入口竞争读改写）
      if (result.gained > 0) {
        const names = result.harvests.map((h) => h.name).join('、');
        await conn.query(
          'UPDATE profiles SET current_points = current_points + ?, ' +
            'total_points_earned = COALESCE(total_points_earned, 0) + ? WHERE id = ?',
          [result.gained, result.gained, studentId]
        );
        await conn.query(
          'UPDATE profiles SET max_points = GREATEST(COALESCE(max_points, 0), current_points) WHERE id = ?',
          [studentId]
        );
        await conn.query(
          'INSERT INTO point_transactions (student_id, amount, reason, source_type, source_id, created_at) ' +
            'VALUES (?, ?, ?, ?, ?, NOW())',
          [studentId, result.gained, '农场收获「' + names + '」', 'farm', plot.id]
        );
      }

      // 留痕：代码 + 操作序列 + 结算摘要（教师端可查）
      await conn.query(
        'INSERT INTO farm_logs (id, student_id, code, ops, summary) VALUES (?, ?, ?, ?, ?)',
        [
          genId(),
          studentId,
          code.slice(0, 5000),
          JSON.stringify(ops.slice(0, MAX_OPS)).slice(0, 20000),
          JSON.stringify({
            events: result.events,
            acted: result.acted,
            labor: result.labor,
            refused: result.refused,
            gained: result.gained,
            harvests: result.harvests,
            days_ticked: tick.days,
          }).slice(0, 20000),
        ]
      );

      await conn.commit();
      conn.release();
      conn = null;

      return res.json({
        data: {
          events: result.events,
          me: Object.assign(shapePlot(plot), {
            ops_left_today: Math.max(0, maxOps - num(plot.ops_today, 0)),
          }),
          labor_used: result.labor,
          labor_left_today: Math.max(0, maxOps - num(plot.ops_today, 0)),
          ops_refused: result.refused,
          points_gained: result.gained,
          days_ticked: tick.days,
          prints,
        },
        error: null,
      });
    } catch (error) {
      if (conn) {
        try {
          await conn.rollback();
        } catch (_) {}
        conn.release();
      }
      console.error('Error in POST /api/student/farm/run:', error);
      res.status(500).json({ data: null, error: error.message });
    }
  });

  // ---------- 教师端：读配置 ----------
  app.get('/api/teacher/farm/config', authenticate, requireTeacher, async (req, res) => {
    try {
      const cfg = await loadConfig();
      const [stat] = await pool.query(
        'SELECT COUNT(*) AS plots, COALESCE(SUM(total_harvest), 0) AS harvests, ' +
          'COALESCE(SUM(total_points), 0) AS points FROM farm_plots'
      );
      res.json({
        data: {
          config: {
            enabled: Number(cfg.enabled) === 1,
            class_ids: parseClassIds(cfg.class_ids),
            day_minutes: num(cfg.day_minutes, 10),
            base_yield: num(cfg.base_yield, 10),
            max_ops_per_day: num(cfg.max_ops_per_day, DEFAULT_CFG.max_ops_per_day),
            weather: cfg.weather || 'sunny',
            notice: cfg.notice || '',
            default_code: cfg.default_code || '',
            start_at: cfg.start_at || null,
          },
          weathers: Object.keys(WEATHER).map((k) => ({ key: k, label: WEATHER[k].label })),
          crops: cropCatalog(),
          stats: {
            plots: num(stat && stat[0] && stat[0].plots, 0),
            harvests: num(stat && stat[0] && stat[0].harvests, 0),
            points: num(stat && stat[0] && stat[0].points, 0),
          },
        },
        error: null,
      });
    } catch (error) {
      console.error('Error in GET /api/teacher/farm/config:', error);
      res.status(500).json({ data: null, error: error.message });
    }
  });

  // ---------- 教师端：写配置 ----------
  app.put('/api/teacher/farm/config', authenticate, requireTeacher, async (req, res) => {
    try {
      const teacherId = req.user.userId || req.user.user_id;
      const b = req.body || {};
      const cfg = await loadConfig();

      const enabled = b.enabled === true || b.enabled === 1 || b.enabled === '1' ? 1 : 0;
      const classIds = Array.isArray(b.class_ids) ? b.class_ids.map(String).filter(Boolean) : parseClassIds(b.class_ids);
      const dayMinutes = clamp(Math.round(num(b.day_minutes, 10)), 1, 120);
      const baseYield = clamp(Math.round(num(b.base_yield, 10)), 1, 1000);
      // ⛔ 上限从 20 提到 200：口径改成「动作次数」后，20 次只够种 1.6 茬地，太紧。
      const maxOps = clamp(Math.round(num(b.max_ops_per_day, DEFAULT_CFG.max_ops_per_day)), 1, 200);
      const weather = WEATHER[b.weather] ? String(b.weather) : 'sunny';
      const notice = b.notice == null ? null : String(b.notice).slice(0, 255);
      // ⛔ 未传 default_code（undefined）时**保留原值**：否则「只想改开关」的旧调用会把教师配好的默认代码清空；
      //    显式传 null/'' 才表示「用内置示例」。CRLF 统一成 LF，长度截断防误贴大文件。
      const defaultCode =
        b.default_code === undefined
          ? cfg.default_code == null
            ? null
            : String(cfg.default_code)
          : b.default_code == null
          ? null
          : String(b.default_code).replace(/\r\n/g, '\n').slice(0, MAX_DEFAULT_CODE);
      const resetWorld = b.reset_world === true;

      // 首次开启（或曾经没设过起点）时打上世界起点
      let startAt = cfg.start_at || null;
      if (enabled && !startAt) startAt = new Date();
      if (resetWorld) startAt = new Date();

      await pool.query(
        'UPDATE farm_config SET enabled=?, class_ids=?, day_minutes=?, base_yield=?, max_ops_per_day=?, ' +
          'weather=?, notice=?, default_code=?, start_at=?, updated_by=? WHERE id = 1',
        [
          enabled,
          classIds.length ? JSON.stringify(classIds) : null,
          dayMinutes,
          baseYield,
          maxOps,
          weather,
          notice,
          defaultCode,
          startAt,
          teacherId,
        ]
      );

      let cleared = 0;
      if (resetWorld) {
        const [r] = await pool.query(
          'UPDATE farm_plots SET crop=NULL, growth=0, moisture=?, nutrient=?, stage=0, day_index=0, ' +
            'ops_today=0, ops_day=0, total_harvest=0, total_points=0, last_tick_at=NOW()',
          [RESET_MOISTURE, RESET_NUTRIENT]
        );
        cleared = num(r && r.affectedRows, 0);
      }

      res.json({ data: { ok: true, reset_world: resetWorld, cleared }, error: null });
    } catch (error) {
      console.error('Error in PUT /api/teacher/farm/config:', error);
      res.status(500).json({ data: null, error: error.message });
    }
  });

  // ---------- 教师端：全班地块总览 ----------
  app.get('/api/teacher/farm/overview', authenticate, requireTeacher, async (req, res) => {
    try {
      const cfg = await loadConfig();
      const now = Date.now();
      const classId = req.query.class_id ? String(req.query.class_id) : null;
      const params = [];
      let sql =
        'SELECT p.*, pr.real_name, pr.username, c.name AS class_name ' +
        'FROM farm_plots p LEFT JOIN profiles pr ON pr.id = p.student_id ' +
        'LEFT JOIN classes c ON c.id = p.class_id WHERE 1=1';
      if (classId) {
        sql += ' AND p.class_id = ?';
        params.push(classId);
      }
      sql += ' ORDER BY p.total_points DESC, p.total_harvest DESC, p.growth DESC LIMIT 300';
      const [rows] = await pool.query(sql, params);
      const list = rows.map((p) => {
        const copy = Object.assign({}, p);
        tickPlot(copy, cfg, now);
        return Object.assign(shapePlot(copy), {
          class_id: p.class_id,
          class_name: p.class_name || '',
          username: p.username || '',
        });
      });
      res.json({ data: { list, world: worldInfo(cfg, now) }, error: null });
    } catch (error) {
      console.error('Error in GET /api/teacher/farm/overview:', error);
      res.status(500).json({ data: null, error: error.message });
    }
  });

  // ---------- 教师端：劳作日志（排查 / 看学生写了什么代码） ----------
  app.get('/api/teacher/farm/logs', authenticate, requireTeacher, async (req, res) => {
    try {
      const limit = clamp(Math.round(num(req.query.limit, 50)), 1, 200);
      const params = [];
      let sql = 'SELECT * FROM farm_logs WHERE 1=1';
      if (req.query.student_id) {
        sql += ' AND student_id = ?';
        params.push(String(req.query.student_id));
      }
      sql += ' ORDER BY created_at DESC LIMIT ?';
      params.push(limit);
      const [rows] = await pool.query(sql, params);
      res.json({ data: { list: rows }, error: null });
    } catch (error) {
      console.error('Error in GET /api/teacher/farm/logs:', error);
      res.status(500).json({ data: null, error: error.message });
    }
  });
}

module.exports = {
  registerFarm,
  // 导出纯函数，供回归脚本直接测试结算引擎
  CROPS,
  WEATHER,
  MAX_OPS,
  MAX_PARAM,
  LABOR_GROWTH,
  WATER_PER_UNIT,
  FERT_PER_UNIT,
  DAILY_BASE_GROWTH,
  DAILY_MOISTURE_LOSS,
  DAILY_NUTRIENT_LOSS,
  WEED_GROWTH,
  DEFAULT_CFG,
  stageOf,
  parseClassIds,
  inScope,
  dayIndexOf,
  tickPlot,
  applyOps,
  shapePlot,
};
