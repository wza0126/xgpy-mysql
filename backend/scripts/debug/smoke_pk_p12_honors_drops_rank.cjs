/**
 * smoke_pk_p12_honors_drops_rank.cjs
 *
 * 目的：验证 PK 对战 P1/P2 四项功能（迁移 087）
 *   P1-1 PK 专属荣誉（连胜达人 / 零失误 / 愈战愈勇）
 *   P1-2 PK 对战高频错题榜
 *   P2-1 段位分布图 + 段位变化趋势
 *   P2-2 PK 装备掉落
 *
 * 分五层验证：
 *   A. 数据库结构与迁移 087
 *      - profiles 4 个新列、pk_battle_configs 2 个掉落列、pk_rank_history 表与索引
 *      - pk_rank_history 必须登记进 data-io 的 PK 域（否则导出静默丢数据）
 *   B. 荣誉判定口径（纯函数，不需要真跑一局）
 *      - 连胜达人的**状态跃迁幂等性**（3→4 不重复发）
 *      - 零失误要求作答数 > 0（一题没答不算）
 *      - 愈战愈勇要求「中场落后 + 最终获胜」两个条件同时成立
 *      - 掉率掷骰：系数缩放正确、0 掉率不触发、可注入随机源
 *   C. 接口（真数据）
 *      - rank-distribution 的 tiers 总数 = 班级学生数、ratio 合计 ≈ 100
 *      - rank-trend 补齐空日期（长度 == days）、不返回未来日期
 *      - wrong-questions 分页、wrong_rate 口径自洽、按答错人次降序
 *      - /api/student/honors 含 3 个 pk_* 荣誉
 *   D. 配置往返（接口层）
 *      - 掉落开关/系数能存能读；系数越界被钳制到 [0,5]；默认关闭
 *   E. 源码接线（防重构删掉关键逻辑）
 *      - battleEngine 必须走 calcNewWinStreak/judgePkHonors/rollEquipmentDrops
 *      - handler 必须整行透传掉落字段
 *      - 结算成功后才广播掉落/荣誉（事务失败不能让学生看到假掉落）
 *
 * 用法：node scripts/debug/smoke_pk_p12_honors_drops_rank.cjs
 * 前提：后端在跑（默认 127.0.0.1:3101）
 */

const path = require('path');
const fs = require('fs');
const pool = require('../../src/db');

const BASE = process.env.XGPY_BASE || 'http://127.0.0.1:3101';
const BACKEND = path.join(__dirname, '..', '..');
const FRONTEND = path.join(BACKEND, '..', 'frontend');

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? '  ' + detail : '')); }
  else { fail++; failures.push(name); console.log('  ❌ ' + name + (detail ? '  ' + detail : '')); }
}
function section(t) { console.log('\n【' + t + '】'); }

const readSrc = (rel) => fs.readFileSync(path.join(BACKEND, rel), 'utf8');
const readFe = (rel) => fs.readFileSync(path.join(FRONTEND, rel), 'utf8');

async function loginUser(username, password) {
  try {
    const res = await fetch(`${BASE}/api/auth/secure-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, deviceInfo: 'smoke-p12' }),
    });
    const j = await res.json();
    return j?.data?.session?.access_token || null;
  } catch {
    return null;
  }
}

async function apiGet(endpoint, token) {
  try {
    const res = await fetch(`${BASE}${endpoint}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return await res.json();
  } catch {
    return null;
  }
}

async function apiSend(method, endpoint, token, body) {
  try {
    const res = await fetch(`${BASE}${endpoint}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body ? JSON.stringify(body) : undefined,
    });
    return await res.json();
  } catch {
    return null;
  }
}

async function main() {
  const honors = require('../../src/pk-socket/pkHonors');

  // ══ A. 数据库结构与迁移 087 ═══════════════════════════════════════════
  section('A. 数据库结构与迁移（迁移 087）');

  {
    const [cols] = await pool.query('SHOW COLUMNS FROM profiles');
    const names = cols.map((c) => c.Field);
    for (const c of ['pk_streak_3_times', 'pk_flawless_times', 'pk_comeback_times', 'pk_win_streak']) {
      ok(`profiles 有 ${c} 列`, names.includes(c));
    }
    // 计数列默认 0 且 NOT NULL（旧行不能被留成 NULL，否则前端 ?? 0 之外还会显示 null）
    for (const c of ['pk_streak_3_times', 'pk_flawless_times', 'pk_comeback_times', 'pk_win_streak']) {
      const col = cols.find((x) => x.Field === c);
      ok(`${c} 默认 0 且非空`,
        String(col?.Default) === '0' && String(col?.Null).toUpperCase() === 'NO',
        `default=${col?.Default} null=${col?.Null}`);
    }
    // 旧荣誉列必须还在（迁移只增不删）
    for (const c of ['perfect_10_times', 'triple_crit_times', 'wrong_3_times', 'studious_times', 'typing_fast_times']) {
      ok(`保留旧荣誉列 ${c}`, names.includes(c));
    }
  }

  {
    const [cols] = await pool.query('SHOW COLUMNS FROM pk_battle_configs');
    const names = cols.map((c) => c.Field);
    ok('pk_battle_configs 有 equipment_drop_enabled', names.includes('equipment_drop_enabled'));
    ok('pk_battle_configs 有 equipment_drop_multiplier', names.includes('equipment_drop_multiplier'));
    const en = cols.find((c) => c.Field === 'equipment_drop_enabled');
    ok('equipment_drop_enabled 默认 0（维持旧行为：PK 原先无掉落）',
      String(en?.Default) === '0', `实际 ${en?.Default}`);
    const m = cols.find((c) => c.Field === 'equipment_drop_multiplier');
    ok('equipment_drop_multiplier 默认 1.00（与练习一致）',
      String(m?.Default) === '1.00', `实际 ${m?.Default}`);
    // 迁移 086 的奖励列必须还在
    for (const c of ['points_multiplier', 'win_bonus_rate', 'consolation_points', 'first_battle_points']) {
      ok(`保留迁移 086 奖励列 ${c}`, names.includes(c));
    }
  }

  {
    const [t] = await pool.query("SHOW TABLES LIKE 'pk_rank_history'");
    ok('pk_rank_history 表存在', t.length > 0);
    if (t.length > 0) {
      const [cols] = await pool.query('SHOW COLUMNS FROM pk_rank_history');
      const names = cols.map((c) => c.Field);
      for (const c of ['id', 'user_id', 'class_id', 'room_id',
        'from_tier', 'from_stars', 'to_tier', 'to_stars', 'result', 'created_at']) {
        ok(`pk_rank_history 有 ${c} 列`, names.includes(c));
      }
      const [idx] = await pool.query('SHOW INDEX FROM pk_rank_history');
      const idxNames = [...new Set(idx.map((i) => i.Key_name))];
      for (const n of ['idx_user_time', 'idx_class_time', 'idx_room']) {
        ok(`pk_rank_history 有索引 ${n}`, idxNames.includes(n), idxNames.join(','));
      }
    }
  }

  {
    // ⚠️ 铁律：新表必须决定归哪个域，否则落"其他"域且 defaultOff → 导出静默丢数据
    const dio = readSrc('src/data-io.js');
    const pkLine = dio.split('\n').find((l) => l.includes("id: 'pk'"));
    ok('pk_rank_history 已登记进 data-io 的 PK 域',
      !!pkLine && pkLine.includes('pk_rank_history'), pkLine?.trim().slice(0, 120));
  }

  // ══ B. 荣誉判定口径（纯函数）═══════════════════════════════════════════
  section('B. PK 荣誉判定口径（纯函数，与 battleEngine 同源）');

  {
    ok('pkHonors 导出 5 个符号',
      ['PK_HONORS', 'STREAK_THRESHOLD', 'calcNewWinStreak', 'judgePkHonors', 'rollEquipmentDrops']
        .every((k) => k in honors));
    ok('连胜阈值为 3', honors.STREAK_THRESHOLD === 3);
    ok('荣誉定义恰好 3 个 PK 荣誉', honors.PK_HONORS.length === 3);
    for (const h of honors.PK_HONORS) {
      ok(`荣誉 ${h.type} 有 name/icon/description/column`,
        !!(h.name && h.icon && h.description && h.column));
    }
  }

  {
    // 连胜场次计算
    ok('赢：2 → 3', honors.calcNewWinStreak(2, 'win') === 3);
    ok('输：清零', honors.calcNewWinStreak(5, 'lose') === 0);
    ok('平：清零', honors.calcNewWinStreak(5, 'draw') === 0);
    ok('非法输入兜底为 0 + 1', honors.calcNewWinStreak(undefined, 'win') === 1);
  }

  {
    const types = (p) => honors.judgePkHonors(p).map((h) => h.type);
    // 连胜达人的状态跃迁幂等性 —— 最关键的一条
    ok('连胜 2→3 触发连胜达人', types({ result: 'win', oldWinStreak: 2, newWinStreak: 3, correct: 5, wrong: 2 }).includes('pk_streak_3'));
    ok('连胜 3→4 **不**重复触发（幂等）', !types({ result: 'win', oldWinStreak: 3, newWinStreak: 4, correct: 5, wrong: 2 }).includes('pk_streak_3'));
    ok('连胜 4→5 不触发', !types({ result: 'win', oldWinStreak: 4, newWinStreak: 5, correct: 5, wrong: 2 }).includes('pk_streak_3'));
    ok('连胜 5→6 再触发一次', types({ result: 'win', oldWinStreak: 5, newWinStreak: 6, correct: 5, wrong: 2 }).includes('pk_streak_3'));
    ok('连胜 0→1 不触发', !types({ result: 'win', oldWinStreak: 0, newWinStreak: 1, correct: 5, wrong: 2 }).includes('pk_streak_3'));

    // 零失误
    ok('全对触发零失误', types({ result: 'win', oldWinStreak: 0, newWinStreak: 1, correct: 8, wrong: 0 }).includes('pk_flawless'));
    ok('做错 1 题不触发零失误', !types({ result: 'win', oldWinStreak: 0, newWinStreak: 1, correct: 7, wrong: 1 }).includes('pk_flawless'));
    ok('一题没答**不**算零失误（防挂机白拿）', !types({ result: 'lose', oldWinStreak: 0, newWinStreak: 0, correct: 0, wrong: 0 }).includes('pk_flawless'));
    ok('全对但输也触发零失误（做对全部题仍可能净分低）', types({ result: 'lose', oldWinStreak: 0, newWinStreak: 0, correct: 6, wrong: 0 }).includes('pk_flawless'));

    // 愈战愈勇
    ok('中场落后 + 获胜触发愈战愈勇', types({ result: 'win', oldWinStreak: 0, newWinStreak: 1, correct: 5, wrong: 3, behindAtHalf: true }).includes('pk_comeback'));
    ok('中场落后但**输**了不触发', !types({ result: 'lose', oldWinStreak: 0, newWinStreak: 0, correct: 3, wrong: 5, behindAtHalf: true }).includes('pk_comeback'));
    ok('中场领先赢了不触发（不是翻盘）', !types({ result: 'win', oldWinStreak: 0, newWinStreak: 1, correct: 5, wrong: 3, behindAtHalf: false }).includes('pk_comeback'));

    // 空/异常入参不能抛
    ok('空对象不抛且返回空数组', Array.isArray(honors.judgePkHonors({})) && honors.judgePkHonors({}).length === 0);
    ok('undefined 不抛', Array.isArray(honors.judgePkHonors(undefined)));
  }

  {
    // 掉率掷骰（注入随机源，避免测试随机性）
    const eqs = [
      { id: 'a', name: 'A', icon: '⚔️', drop_rate: '10.00', crit_bonus: '1.00' },
      { id: 'b', name: 'B', icon: '⚔️', drop_rate: '0.00', crit_bonus: '2.00' },
    ];
    // rand 恒返回 0 ⇒ 恒命中
    let d = honors.rollEquipmentDrops(eqs, 1, () => 0);
    ok('rand=0 时掉率为正的两件都掉', d.length === 1 && d[0].id === 'a', JSON.stringify(d.map((x) => x.id)));
    // rand 恒返回 0.99 ⇒ 只命中掉率 > 99 的（本例都不命中）
    d = honors.rollEquipmentDrops(eqs, 1, () => 0.99);
    ok('rand=0.99 时掉率 10 的不掉', d.length === 0, JSON.stringify(d.map((x) => x.id)));
    // 系数缩放：drop_rate=10 × 5 = 50 ⇒ rand=0.45 命中，rand=0.55 不命中
    d = honors.rollEquipmentDrops(eqs, 5, () => 0.45);
    ok('系数 5 放大后 rand=0.45 命中', d.some((x) => x.id === 'a'));
    d = honors.rollEquipmentDrops(eqs, 5, () => 0.55);
    ok('系数 5 放大后 rand=0.55 不命中', !d.some((x) => x.id === 'a'));
    // drop_rate = 0 恒不掉（即使系数拉满）
    d = honors.rollEquipmentDrops(eqs, 5, () => 0);
    ok('掉率 0 的装备即使系数拉满也不掉', !d.some((x) => x.id === 'b'));
    // 系数 0 = 全不掉
    d = honors.rollEquipmentDrops(eqs, 0, () => 0);
    ok('系数 0 时全不掉', d.length === 0);
    // 空/异常
    ok('空装备列表返回空数组', honors.rollEquipmentDrops([], 1, () => 0).length === 0);
    ok('null 装备列表不抛', honors.rollEquipmentDrops(null, 1, () => 0).length === 0);
    // 掉落回执字段齐全（前端 EquipmentDropEffect 依赖这 4 个字段）
    d = honors.rollEquipmentDrops(eqs, 1, () => 0);
    ok('掉落项含 id/name/icon/crit_bonus',
      d[0] && ['id', 'name', 'icon', 'crit_bonus'].every((k) => k in d[0]), JSON.stringify(d[0]));
    ok('crit_bonus 已转 number', typeof d[0]?.crit_bonus === 'number');
  }

  // ══ C. 接口（真数据）══════════════════════════════════════════════════
  section('C. 统计接口（真数据）');

  const teacherToken = await loginUser('teacher', 'xgpy666');
  ok('教师登录（teacher）', !!teacherToken);

  // 取一个有学生的班级
  let classId = null;
  let classStudentCount = 0;
  if (teacherToken) {
    const cls = await apiGet('/api/classes', teacherToken);
    const list = Array.isArray(cls) ? cls : (cls?.data || []);
    if (list.length > 0) classId = list[0].id;
    ok('拿到班级列表', !!classId, list.map((c) => c.name).join(','));
    if (classId) {
      const [cnt] = await pool.query(
        "SELECT COUNT(*) c FROM profiles WHERE class_id = ? AND role = 'student'",
        [classId]
      );
      classStudentCount = Number(cnt[0].c) || 0;
    }
  }

  if (classId) {
    // ── 段位分布 ──
    const rd = await apiGet(`/api/pk/stats/rank-distribution?class_id=${encodeURIComponent(classId)}`, teacherToken);
    ok('rank-distribution 返回成功', rd && !rd.error && !!rd.data, JSON.stringify(rd?.error));
    if (rd?.data) {
      ok('tiers 恰好 5 档（与 rankCalc.RANK_TIERS 同源）', rd.data.tiers.length === 5,
        `实际 ${rd.data.tiers.length}`);
      ok('total = 班级学生数', Number(rd.data.total) === classStudentCount,
        `接口 ${rd.data.total} vs 库 ${classStudentCount}`);
      const sumCnt = rd.data.tiers.reduce((a, t) => a + t.count, 0);
      ok('各档人数合计 = total', sumCnt === Number(rd.data.total), `${sumCnt} vs ${rd.data.total}`);
      const sumRatio = rd.data.tiers.reduce((a, t) => a + t.ratio, 0);
      // 各档单独取整到 0.1，合计允许有 ±0.5 的舍入误差
      ok('各档占比合计 ≈ 100（±0.5 舍入容差）', Math.abs(sumRatio - 100) < 0.5 || Number(rd.data.total) === 0,
        `合计 ${sumRatio.toFixed(1)}`);
      ok('各档带 name/icon', rd.data.tiers.every((t) => t.name && t.icon));

      // 独立复算：库里的 tier 分布必须与接口一致
      const [dbRows] = await pool.query(
        `SELECT pk_rank_tier AS t, COUNT(*) c FROM profiles
         WHERE class_id = ? AND role = 'student' GROUP BY pk_rank_tier`,
        [classId]
      );
      const dbMap = {};
      dbRows.forEach((r) => { dbMap[Number(r.t) || 0] = Number(r.c); });
      const consistent = rd.data.tiers.every((t) => (dbMap[t.tier] || 0) === t.count);
      ok('接口分布与独立 SQL 复算一致', consistent,
        `接口 ${JSON.stringify(rd.data.tiers.map((t) => t.count))} / 库 ${JSON.stringify(dbMap)}`);
    }

    // ── 段位趋势 ──
    const tr = await apiGet(`/api/pk/stats/rank-trend?class_id=${encodeURIComponent(classId)}&days=14`, teacherToken);
    ok('rank-trend 返回成功', tr && !tr.error && !!tr.data, JSON.stringify(tr?.error));
    if (tr?.data) {
      ok('days 回显 14', Number(tr.data.days) === 14);
      ok('series 长度 == days（已补齐空日期）', tr.data.series.length === 14,
        `实际 ${tr.data.series.length}`);
      const today = new Date();
      const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      ok('最后一个日期是今天', tr.data.series[tr.data.series.length - 1].date === todayStr,
        `${tr.data.series[tr.data.series.length - 1].date} vs ${todayStr}`);
      const dates = tr.data.series.map((p) => p.date);
      ok('日期严格递增', dates.every((d, i) => i === 0 || d > dates[i - 1]));
      ok('无未来日期', dates.every((d) => d <= todayStr));
      ok('每点含 6 个字段',
        tr.data.series.every((p) => ['date', 'tier_up', 'tier_down', 'star_up', 'star_down', 'changes']
          .every((k) => k in p)));
      // 异常 days 应被钳制
      const tr0 = await apiGet(`/api/pk/stats/rank-trend?class_id=${encodeURIComponent(classId)}&days=9999`, teacherToken);
      ok('days=9999 被钳制到 90', Number(tr0?.data?.days) === 90, `实际 ${tr0?.data?.days}`);
      const trBad = await apiGet(`/api/pk/stats/rank-trend?class_id=${encodeURIComponent(classId)}&days=abc`, teacherToken);
      ok('days=abc 回退为默认 30', Number(trBad?.data?.days) === 30, `实际 ${trBad?.data?.days}`);
      const trNo = await apiGet('/api/pk/stats/rank-trend', teacherToken);
      ok('缺 class_id 返回 400', trNo?.error === '缺少 class_id', JSON.stringify(trNo?.error));
    }

    // ── PK 高频错题榜 ──
    const wq = await apiGet(`/api/pk/stats/wrong-questions?class_id=${encodeURIComponent(classId)}&limit=5`, teacherToken);
    ok('wrong-questions 返回成功', wq && !wq.error && !!wq.data, JSON.stringify(wq?.error));
    if (wq?.data) {
      ok('limit 回显 5', Number(wq.data.limit) === 5);
      ok('rows 数量 <= limit', wq.data.rows.length <= 5, `实际 ${wq.data.rows.length}`);
      ok('每行含题干与统计字段',
        wq.data.rows.every((r) => ['question_id', 'content', 'wrong_cnt', 'answer_cnt',
          'student_cnt', 'wrong_student_cnt', 'wrong_rate'].every((k) => k in r)));
      ok('按答错人次降序', wq.data.rows.every((r, i, a) => i === 0 || a[i - 1].wrong_cnt >= r.wrong_cnt),
        wq.data.rows.map((r) => r.wrong_cnt).join(','));
      ok('wrong_cnt >= 1（HAVING 过滤掉没错过的题）', wq.data.rows.every((r) => r.wrong_cnt >= 1));
      // wrong_rate 口径自洽：wrong_cnt / answer_cnt
      for (const r of wq.data.rows.slice(0, 3)) {
        const expect = r.answer_cnt > 0 ? Math.round((r.wrong_cnt / r.answer_cnt) * 1000) / 10 : null;
        ok(`wrong_rate 口径自洽（题 ${r.question_id.slice(0, 12)}…）`,
          r.wrong_rate === expect, `${r.wrong_rate} vs ${expect}`);
      }
      ok('wrong_student_cnt <= student_cnt', wq.data.rows.every((r) => r.wrong_student_cnt <= r.student_cnt));
      // 分页：offset 生效
      const wq2 = await apiGet(`/api/pk/stats/wrong-questions?class_id=${encodeURIComponent(classId)}&limit=5&offset=5`, teacherToken);
      if (wq.data.total > 5) {
        const ids1 = wq.data.rows.map((r) => r.question_id);
        const ids2 = (wq2?.data?.rows || []).map((r) => r.question_id);
        ok('offset=5 返回不重叠的第二页',
          ids2.length === 0 || !ids2.some((id) => ids1.includes(id)),
          `${ids1.length} vs ${ids2.length}`);
      } else {
        ok('offset=5 返回不重叠的第二页', true, '(总量不足一页，跳过)');
      }
      // 独立复算 total
      const [tRows] = await pool.query(
        `SELECT COUNT(DISTINCT a.question_id) c
         FROM pk_match_answers a
         JOIN profiles pr ON a.user_id = pr.id
         WHERE pr.class_id = ?
           AND a.room_id IN (SELECT r.id FROM pk_rooms r WHERE r.status = 'finished')
           AND a.is_correct = 0`,
        [classId]
      );
      ok('total 与独立 SQL 复算一致', Number(wq.data.total) === Number(tRows[0].c),
        `接口 ${wq.data.total} vs 库 ${tRows[0].c}`);
    }
    const wqNo = await apiGet('/api/pk/stats/wrong-questions', teacherToken);
    ok('wrong-questions 缺 class_id 返回 400', wqNo?.error === '缺少 class_id');

    // ── 回归：P0 三个接口不能坏 ──
    const ov = await apiGet(`/api/pk/stats/overview?class_id=${encodeURIComponent(classId)}`, teacherToken);
    ok('回归 overview 仍正常', ov && !ov.error && !!ov.data);
    const bc = await apiGet(`/api/pk/stats/by-config?class_id=${encodeURIComponent(classId)}`, teacherToken);
    ok('回归 by-config 仍正常', bc && !bc.error && Array.isArray(bc.data));
    const bs = await apiGet(`/api/pk/stats/by-student?class_id=${encodeURIComponent(classId)}`, teacherToken);
    ok('回归 by-student 仍正常', bs && !bs.error && Array.isArray(bs.data));
  }

  // ── 学生荣誉接口含 3 个 PK 荣誉 ──
  {
    const studentToken = await loginUser('a', '111111');
    ok('学生登录（a）', !!studentToken);
    if (studentToken) {
      const hn = await apiGet('/api/student/honors', studentToken);
      ok('honors 接口成功', hn && !hn.error && !!hn.data, JSON.stringify(hn?.error));
      if (hn?.data) {
        ok('含 pk_streak_3_times 字段', 'pk_streak_3_times' in hn.data);
        ok('含 pk_flawless_times 字段', 'pk_flawless_times' in hn.data);
        ok('含 pk_comeback_times 字段', 'pk_comeback_times' in hn.data);
        ok('含 pk_win_streak 字段', 'pk_win_streak' in hn.data);
        const list = hn.data.honors || [];
        ok('honors 列表共 8 项（5 旧 + 3 PK）', list.length === 8, `实际 ${list.length}`);
        for (const t of ['pk_streak_3', 'pk_flawless', 'pk_comeback']) {
          const item = list.find((h) => h.type === t);
          ok(`honors 含 ${t}`, !!item);
          ok(`${t} 有 name/description/category`,
            !!item && !!(item.name && item.description && item.category === 'pk'));
        }
        // 旧 5 项不能丢
        for (const t of ['perfect_10', 'triple_crit', 'wrong_3', 'studious', 'typing_fast']) {
          ok(`honors 保留旧荣誉 ${t}`, list.some((h) => h.type === t));
        }
      }
    }
  }

  // ══ D. 配置往返（接口层）══════════════════════════════════════════════
  section('D. 掉落配置往返（接口层）');

  if (teacherToken) {
    // 创建：开启掉落 + 系数 2.5
    const created = await apiSend('POST', '/api/pk/battle-configs', teacherToken, {
      name: 'smoke-p12-掉落测试',
      duration_seconds: 120, question_count: 10,
      equipment_drop_enabled: true, equipment_drop_multiplier: 2.5,
    });
    const newId = created?.data?.id;
    ok('创建配置成功', !!newId, JSON.stringify(created?.error));

    if (newId) {
      const all = await apiGet('/api/pk/battle-configs', teacherToken);
      const cfg = (all?.data || []).find((c) => c.id === newId);
      ok('能读回刚创建的配置', !!cfg);
      if (cfg) {
        ok('equipment_drop_enabled 存为 1', Number(cfg.equipment_drop_enabled) === 1,
          `实际 ${cfg.equipment_drop_enabled}`);
        ok('equipment_drop_multiplier 存为 2.5', Number(cfg.equipment_drop_multiplier) === 2.5,
          `实际 ${cfg.equipment_drop_multiplier}`);
      }

      // 越界系数被钳制到 5
      await apiSend('PUT', `/api/pk/battle-configs/${newId}`, teacherToken, {
        name: 'smoke-p12-掉落测试', duration_seconds: 120, question_count: 10,
        equipment_drop_enabled: true, equipment_drop_multiplier: 99,
      });
      const all2 = await apiGet('/api/pk/battle-configs', teacherToken);
      const cfg2 = (all2?.data || []).find((c) => c.id === newId);
      ok('系数 99 被钳制到 5', Number(cfg2?.equipment_drop_multiplier) === 5,
        `实际 ${cfg2?.equipment_drop_multiplier}`);

      // 负数被钳制到 0
      await apiSend('PUT', `/api/pk/battle-configs/${newId}`, teacherToken, {
        name: 'smoke-p12-掉落测试', duration_seconds: 120, question_count: 10,
        equipment_drop_enabled: false, equipment_drop_multiplier: -5,
      });
      const all3 = await apiGet('/api/pk/battle-configs', teacherToken);
      const cfg3 = (all3?.data || []).find((c) => c.id === newId);
      ok('系数 -5 被钳制到 0', Number(cfg3?.equipment_drop_multiplier) === 0,
        `实际 ${cfg3?.equipment_drop_multiplier}`);
      ok('关闭后 enabled 存为 0', Number(cfg3?.equipment_drop_enabled) === 0,
        `实际 ${cfg3?.equipment_drop_enabled}`);

      // 清理
      const del = await apiSend('DELETE', `/api/pk/battle-configs/${newId}`, teacherToken);
      ok('清理测试配置', del && !del.error);
      // 复核已删除
      const all4 = await apiGet('/api/pk/battle-configs', teacherToken);
      ok('测试配置已从库中移除', !(all4?.data || []).some((c) => c.id === newId));
    }

    // 不传掉落字段时应落默认（关闭 + 1.00）
    const created2 = await apiSend('POST', '/api/pk/battle-configs', teacherToken, {
      name: 'smoke-p12-默认掉落', duration_seconds: 120, question_count: 10,
    });
    const id2 = created2?.data?.id;
    if (id2) {
      const all5 = await apiGet('/api/pk/battle-configs', teacherToken);
      const cfg5 = (all5?.data || []).find((c) => c.id === id2);
      ok('不传掉落字段 → enabled 默认 0（维持旧行为）',
        Number(cfg5?.equipment_drop_enabled) === 0, `实际 ${cfg5?.equipment_drop_enabled}`);
      ok('不传掉落字段 → 系数默认 1.00',
        Number(cfg5?.equipment_drop_multiplier) === 1, `实际 ${cfg5?.equipment_drop_multiplier}`);
      await apiSend('DELETE', `/api/pk/battle-configs/${id2}`, teacherToken);
    }
  }

  // ══ E. 源码接线（防重构删掉关键逻辑）═══════════════════════════════════
  section('E. 源码接线（防重构破坏）');

  {
    const be = readSrc('src/pk-socket/battleEngine.js');
    ok('battleEngine 引入 pkHonors', be.includes("require('./pkHonors')"));
    ok('battleEngine 用 calcNewWinStreak', be.includes('calcNewWinStreak('));
    ok('battleEngine 用 judgePkHonors', be.includes('judgePkHonors('));
    ok('battleEngine 用 rollEquipmentDrops', be.includes('rollEquipmentDrops('));
    ok('结算时写 pk_win_streak', be.includes('pk_win_streak = ?'));
    ok('结算时写 3 个荣誉计数列',
      be.includes('pk_streak_3_times = pk_streak_3_times + ?')
      && be.includes('pk_flawless_times = pk_flawless_times + ?')
      && be.includes('pk_comeback_times = pk_comeback_times + ?'));
    ok('写 pk_rank_history', be.includes('INSERT INTO pk_rank_history'));
    ok('段位未变化时不写历史（避免表线性膨胀）',
      be.includes('fromTier === newRank.tier && fromStars === newRank.stars'));
    ok('掉落走 student_equipments 的 ON DUPLICATE KEY 累加',
      be.includes('ON DUPLICATE KEY UPDATE quantity = quantity + 1'));
    ok('掉落配置从 config 读取（非硬编码）', be.includes('config.equipment_drop_enabled'));
    ok('掉率系数被钳制到上限 5', be.includes('Math.min(5, Math.max(0, numOr(config.equipment_drop_multiplier'));
    ok('掉落在正确数 > 0 时才掷骰（防挂机）', be.includes('if (p.correct <= 0)'));
    ok('掉落失败不连累结算（try/catch 包裹）',
      be.includes('装备掉落失败（不改动结算结果）'));
    ok('中场落后判定在作答过半时锁定一次',
      be.includes('state.halfChecked') && be.includes('behindAtHalf'));
    // 事务成功后才广播掉落/荣誉（回滚时不能让学生看到假掉落）
    const commitIdx = be.indexOf('await conn.commit();');
    const broadcastIdx = be.indexOf('dropped_equipments: droppedEquipmentsFinal');
    ok('掉落/荣誉在事务 commit 之后才广播',
      commitIdx > 0 && broadcastIdx > commitIdx, `commit@${commitIdx} broadcast@${broadcastIdx}`);
    ok('pk:battle_end 携带 dropped_equipments', be.includes('dropped_equipments: droppedEquipmentsFinal'));
    ok('pk:battle_end 携带 new_honors', be.includes('new_honors: honorsFinal'));
    ok('查询玩家时带出 pk_win_streak', be.includes('pr.pk_win_streak,'));
  }

  {
    const hd = readSrc('src/pk-socket/handler.js');
    ok('handler 透传 equipment_drop_enabled',
      hd.includes('equipment_drop_enabled: row.equipment_drop_enabled'));
    ok('handler 透传 equipment_drop_multiplier',
      hd.includes('equipment_drop_multiplier: row.equipment_drop_multiplier'));
  }

  {
    const ix = readSrc('src/index.js');
    ok('index 有 normalizePkDropFields', ix.includes('function normalizePkDropFields'));
    ok('系数上限钳制到 5', ix.includes('Math.min(5, Math.max(0, Math.round(n * 100) / 100))'));
    ok('index 有 rank-distribution 接口', ix.includes("'/api/pk/stats/rank-distribution'"));
    ok('index 有 rank-trend 接口', ix.includes("'/api/pk/stats/rank-trend'"));
    ok('index 有 wrong-questions 接口', ix.includes("'/api/pk/stats/wrong-questions'"));
    ok('段位档位复用 rankCalc.RANK_TIERS（口径唯一）',
      ix.includes("require('./pk-socket/rankCalc')") && ix.includes('RANK_TIERS'));
    ok('PK 错题榜只聚合 pk_match_answers（与学生学情口径区分）',
      ix.includes('FROM pk_match_answers a') && ix.includes('PK 高频错题榜'));
    ok('趋势接口补齐空日期', ix.includes('series.push(map[key] ||'));
    ok('trend days 上限 90', ix.includes('Math.min(90, Math.max(1, parseInt(days, 10) || 30))'));
    ok('history 接口带出 rank_changes', ix.includes('rank_changes: rankChangeRows'));
    ok('honors 接口查询 PK 荣誉列', ix.includes('pk_streak_3_times, pk_flawless_times, pk_comeback_times'));
  }

  {
    const fe = readFe('src/components/teacher/PKStatsTab.tsx');
    ok('PKStatsTab 拉 rank-distribution', fe.includes('/api/pk/stats/rank-distribution'));
    ok('PKStatsTab 拉 rank-trend', fe.includes('/api/pk/stats/rank-trend'));
    ok('PKStatsTab 拉 wrong-questions', fe.includes('/api/pk/stats/wrong-questions'));
    ok('PKStatsTab 用 LineChart 画趋势', fe.includes('LineChart'));
    ok('趋势图有 4 条线（段位升/降 + 升星/掉星）',
      fe.includes("dataKey=\"段位升\"") && fe.includes("dataKey=\"段位降\"")
      && fe.includes("dataKey=\"升星\"") && fe.includes("dataKey=\"掉星\""));
    ok('错题榜有分页', fe.includes('WRONG_PAGE_SIZE') && fe.includes('setWrongPage'));
    ok('切班重置错题榜翻页', fe.includes('setWrongPage(0)'));
    ok('PK 错题榜标注口径差异',
      fe.includes('口径与「学情分析 · 错题排行」不同'));
  }

  {
    const fe = readFe('src/components/student/pk-battle/PKResult.tsx');
    ok('PKResult 接收 droppedEquipments/newHonors', fe.includes('droppedEquipments') && fe.includes('newHonors'));
    ok('PKResult 展示「本局获得装备」', fe.includes('本局获得装备'));
    ok('PKResult 展示「本局达成荣誉」', fe.includes('本局达成荣誉'));
    ok('PKResult 展示段位升降级（含晋级/掉段标记）',
      fe.includes('晋级！') && fe.includes('掉段'));
    ok('PKResult 段位变化用 rank_changes', fe.includes('rank_changes'));
  }

  {
    const fe = readFe('src/components/student/pk-battle/PKBattle.tsx');
    ok('PKBattle 从 pk:battle_end 取掉落', fe.includes('data?.dropped_equipments'));
    ok('PKBattle 从 pk:battle_end 取荣誉', fe.includes('data?.new_honors'));
    ok('PKBattle 按本人 user_id 过滤（不显示对手掉落）', fe.includes('allDrops[myId]'));
    ok('PKBattle 触发装备掉落动效', fe.includes("emitEvent('equipment_drop'"));
    ok('新局开始时清空上局掉落/荣誉', fe.includes('setResultDrops([])') && fe.includes('setResultHonors([])'));
  }

  {
    const fe = readFe('src/components/student/ProfileModule.tsx');
    ok('图鉴含连胜达人', fe.includes('连胜达人'));
    ok('图鉴含零失误', fe.includes('零失误'));
    ok('图鉴含愈战愈勇', fe.includes('愈战愈勇'));
    ok('图鉴读取 pk_*_times', fe.includes('pk_streak_3_times') && fe.includes('pk_flawless_times') && fe.includes('pk_comeback_times'));

    const gs = readFe('src/hooks/useGameSystem.ts');
    ok('HonorStats 含 3 个 PK 荣誉字段',
      gs.includes('pk_streak_3_times') && gs.includes('pk_flawless_times') && gs.includes('pk_comeback_times'));

    const ht = readFe('src/components/student/game/HonorToast.tsx');
    ok('HonorToast 有 3 个 PK 荣誉图标',
      ht.includes("case 'pk_streak_3'") && ht.includes("case 'pk_flawless'") && ht.includes("case 'pk_comeback'"));

    const cf = readFe('src/components/teacher/PKBattleConfigTab.tsx');
    ok('配置页有掉落开关', cf.includes('equipment_drop_enabled'));
    ok('配置页有掉率系数', cf.includes('equipment_drop_multiplier'));
    ok('配置页提示默认关闭', cf.includes('默认关闭'));
    ok('配置页提示系数上限 5', cf.includes('上限 5'));
    ok('配置页提示防挂机', cf.includes('只在做对'));
    ok('openEdit 还原掉落开关', cf.includes('equipment_drop_enabled: toBool(cfg.equipment_drop_enabled)'));
    ok('表单提交带掉落字段',
      cf.includes('equipment_drop_enabled: formData.equipment_drop_enabled'));
  }

  // ══ 汇总 ═══════════════════════════════════════════════════════════════
  console.log('\n' + '='.repeat(64));
  console.log(`通过 ${pass} / 失败 ${fail}  (共 ${pass + fail})`);
  if (fail > 0) {
    console.log('\n失败项：');
    failures.forEach((f) => console.log('  - ' + f));
  }
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('脚本异常:', e);
  process.exit(1);
});
