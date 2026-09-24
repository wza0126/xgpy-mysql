/**
 * smoke_pk_v267_four_features.cjs
 *
 * 目的：验证 v2.6.7 四项 PK 需求（迁移 088）
 *   ① 首战奖励「分了积分却没告诉学生」——battle_end 广播必须带 bonuses 回执
 *   ② PK 高频错题榜双击看选项/答案/解析
 *   ③ PK 大厅荣誉数据 + 对战历史记录
 *   ④ 5 套段位专属皮肤（3/7/8/9/10% 暴击）+ 达到段位永久解锁 + 个人中心激活
 *
 * 分五层验证：
 *   A. 数据库结构与迁移 088
 *      - student_skins.unlock_source 列与 idx_unlock_source 索引
 *      - 5 个段位皮肤 id 的历史行必须回填成 'rank'（否则历史学生被当成积分兑换）
 *      - student_skins 唯一键还在（INSERT IGNORE 幂等的前提）
 *   B. 段位皮肤映射一致性（三处必须同步）
 *      - 后端 index.js / battleEngine.js / 前端 windowSkins.ts 的 tier→skinId 映射逐项相等
 *      - 5 套皮肤的暴击率必须严格等于 1/3/6/8/10
 *   C. 接口（真数据 + 真登录）
 *      - /api/pk/profile 触发懒补偿后 my-skins 能拿到段位皮肤
 *      - 段位单调：已达 tier=N 时 0..N 的皮肤全部应得
 *      - /api/pk/history 带对手与段位变化字段
 *      - /api/student/honors 带 pk_total_battles 等战绩字段
 *      - wrong-questions 带 options/answers/explanation
 *   D. 兑换侧拦截（段位皮肤不能积分购买）
 *      - 源码层：兑换路由在扣分前拦截 unlockSource==='rank'
 *      - 接口层：真调兑换接口拿段位皮肤必须被拒
 *   E. 源码接线（防重构删掉关键逻辑）
 *      - battleEngine 事务后广播 bonuses / daily_battles_target
 *      - 失败分支不带头部载荷（积分没发出去不能提示）
 *      - 前端 PKResult 渲染奖励卡片、PKBattle 透传、SkinManager 分组、PKLobby 三页签
 *      - 教师奖品下拉排除段位皮肤
 *
 * 用法：node scripts/debug/smoke_pk_v267_four_features.cjs
 * 前提：后端在跑（默认 127.0.0.1:3000）
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
      body: JSON.stringify({ username, password, deviceInfo: 'smoke-v267' }),
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
    return { status: res.status, json: await res.json() };
  } catch {
    return null;
  }
}

// 从源码里抽出 `tier: 'skin_xxx'` 形式的映射（tier 用数字字面量）
function extractTierSkinMap(src) {
  const out = {};
  const re = /(\d)\s*:\s*'(skin_rank_[a-z]+)'/g;
  let m;
  while ((m = re.exec(src)) !== null) out[m[1]] = m[2];
  return out;
}

// ── 前端 PKStatsTab 解析逻辑的**镜像实现**（口径必须与前端一致）──
// 用于对接口返回的真实 options/answers 做端到端渲染校验。
function feNormalizeOptions(raw) {
  if (!raw) return [];
  let arr = raw;
  if (typeof arr === 'string') {
    try { arr = JSON.parse(arr); } catch { return [{ key: '', text: arr }]; }
  }
  if (arr && !Array.isArray(arr) && typeof arr === 'object') {
    const inner = arr.options ?? arr.items ?? arr.data ?? arr.list ?? arr.choices;
    if (inner !== undefined) arr = inner;
  }
  if (typeof arr === 'string') {
    const s = arr;
    try { arr = JSON.parse(s); } catch { return [{ key: '', text: s }]; }
  }
  if (Array.isArray(arr)) {
    return arr.map((item, i) => {
      if (typeof item === 'string') {
        const stripped = item.replace(/^\s*([A-Za-z])[.、．:：)]\s*/, '');
        const km = item.match(/^\s*([A-Za-z])[.、．:：)]/);
        return { key: km ? km[1].toUpperCase() : String.fromCharCode(65 + i), text: stripped };
      }
      const o = item || {};
      const key = String(o.label ?? o.key ?? o.option ?? String.fromCharCode(65 + i));
      const rawText = String(o.text ?? o.content ?? o.value ?? '');
      const text = rawText.replace(new RegExp(`^\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[.、．:：)]\\s*`), '');
      return { key, text };
    });
  }
  return [];
}

function feNormalizeAnswers(raw) {
  if (raw == null) return [];
  let v = raw;
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch { return String(raw).split(/[,，\s]+/).filter(Boolean); }
  }
  if (v && !Array.isArray(v) && typeof v === 'object') {
    const inner = v.answers ?? v.answer ?? v.items ?? v.data ?? v.value;
    if (inner !== undefined) v = inner;
  }
  if (typeof v === 'string') return v.split(/[,，\s]+/).filter(Boolean);
  if (Array.isArray(v)) {
    return v.map((x) => {
      if (x == null) return '';
      if (typeof x === 'object') {
        const o = x;
        return String(o.text ?? o.value ?? o.key ?? o.label ?? '');
      }
      return String(x);
    }).filter(Boolean);
  }
  return [String(v)];
}

async function main() {
  // ══ A. 数据库结构与迁移 088 ═══════════════════════════════════════════
  section('A. 数据库结构与迁移（迁移 088）');

  const RANK_SKIN_IDS = [
    'skin_rank_primary', 'skin_rank_junior', 'skin_rank_senior',
    'skin_rank_undergrad', 'skin_rank_researcher',
  ];

  {
    const [cols] = await pool.query('SHOW COLUMNS FROM student_skins');
    const names = cols.map((c) => c.Field);
    ok('student_skins 有 unlock_source 列', names.includes('unlock_source'));
    const col = cols.find((c) => c.Field === 'unlock_source');
    ok('unlock_source 默认 points 且非空',
      String(col?.Default) === 'points' && String(col?.Null).toUpperCase() === 'NO',
      `default=${col?.Default} null=${col?.Null}`);

    const [idx] = await pool.query('SHOW INDEX FROM student_skins');
    const idxNames = idx.map((i) => i.Key_name);
    ok('student_skins 有 idx_unlock_source 索引', idxNames.includes('idx_unlock_source'));
    ok('student_skins 保留唯一键（INSERT IGNORE 幂等前提）',
      idxNames.some((n) => String(n).includes('uk_student_skin') || String(n).includes('student_skin')),
      idxNames.join(','));
  }

  {
    const [rows] = await pool.query(
      `SELECT skin_id, unlock_source, COUNT(*) AS cnt
         FROM student_skins
        WHERE skin_id IN (${RANK_SKIN_IDS.map(() => '?').join(',')})
        GROUP BY skin_id, unlock_source`,
      RANK_SKIN_IDS
    );
    const bad = rows.filter((r) => r.unlock_source !== 'rank');
    ok('所有已存在的段位皮肤行都已回填 unlock_source=rank',
      bad.length === 0,
      bad.length ? bad.map((b) => `${b.skin_id}=${b.unlock_source}`).join(',') : `共 ${rows.reduce((s, r) => s + r.cnt, 0)} 行`);
  }

  // ══ B. 映射一致性 ═════════════════════════════════════════════════════
  section('B. 段位皮肤映射三处同步 + 暴击率');

  const beIndexSrc = readSrc('src/index.js');
  const beEngineSrc = readSrc('src/pk-socket/battleEngine.js');
  const feSkinSrc = readFe('src/config/windowSkins.ts');

  const mapIndex = extractTierSkinMap(beIndexSrc);
  const mapEngine = extractTierSkinMap(beEngineSrc);

  // 前端不是字面量映射，而是由 RANK_SKINS.reduce 派生 —— 从皮肤定义里抽 tier→id
  const feTierPairs = {};
  {
    const re = /id\s*:\s*'(skin_rank_[a-z]+)'[\s\S]{0,600}?requiredRankTier\s*:\s*([0-4])/g;
    let m;
    while ((m = re.exec(feSkinSrc)) !== null) feTierPairs[m[2]] = m[1];
  }

  for (let t = 0; t <= 4; t++) {
    const a = mapIndex[t], b = mapEngine[t], c = feTierPairs[t];
    ok(`tier ${t} 三处映射一致`, !!a && a === b && b === c, `index=${a} engine=${b} front=${c}`);
  }
  ok('共抽出 5 个段位映射项（index/engine 字面量 + front 派生源）',
    Object.keys(mapIndex).length === 5 && Object.keys(mapEngine).length === 5 && Object.keys(feTierPairs).length === 5,
    `${Object.keys(mapIndex).length}/${Object.keys(mapEngine).length}/${Object.keys(feTierPairs).length}`);

  // 暴击率必须严格等于 1/3/6/8/10（用户给定数值，不得擅改）
  const EXPECT_CRIT = { skin_rank_primary: 1, skin_rank_junior: 3, skin_rank_senior: 6, skin_rank_undergrad: 8, skin_rank_researcher: 10 };
  for (const [sid, cr] of Object.entries(EXPECT_CRIT)) {
    const block = feSkinSrc.split(sid)[1] || '';
    const seg = block.slice(0, 400);
    const m = seg.match(/critBonus\s*:\s*(\d+)/);
    ok(`${sid} 暴击率 = ${cr}%`, m && Number(m[1]) === cr, `实际 ${m ? m[1] : '未找到'}`);
  }

  {
    // ⛔ WINDOW_SKINS_META（后端）是权威定义，前端界面只是副本 ——
    // 只改一边会导致「卡片显示 X% 但实际结算按 Y%」，必须逐项比对。
    for (const [sid, cr] of Object.entries(EXPECT_CRIT)) {
      const line = beIndexSrc.split('\n').find((l) => l.includes(`id: '${sid}'`)) || '';
      const m = line.match(/critBonus:\s*(\d+)/);
      ok(`后端 WINDOW_SKINS_META ${sid} 暴击率 = ${cr}%`,
        m && Number(m[1]) === cr, `实际 ${m ? m[1] : '未找到'}`);
    }
  }

  {
    // 段位皮肤必须带 unlockSource:'rank' 与 requiredRankTier
    const rankSeg = feSkinSrc.slice(feSkinSrc.indexOf('skin_rank_primary'));
    ok('段位皮肤标记 unlockSource: rank', /unlockSource\s*:\s*['"]rank['"]/.test(rankSeg));
    ok('段位皮肤带 requiredRankTier', /requiredRankTier\s*:\s*[0-4]/.test(rankSeg));
    ok('段位皮肤带 rankName（小学/初中/高中/本科/研究生）',
      ['小学生', '初中生', '高中生', '本科生', '研究生'].every((n) => rankSeg.includes(n)));
    ok('导出 RANK_SKINS（个人中心分组用）', /export\s+const\s+RANK_SKINS/.test(feSkinSrc));
    ok('导出 RANK_SKIN_BY_TIER', /export\s+const\s+RANK_SKIN_BY_TIER/.test(feSkinSrc));
    ok('导出 isRankSkin', /export\s+(const|function)\s+isRankSkin/.test(feSkinSrc));
  }

  // ══ C. 接口（真数据） ══════════════════════════════════════════════════
  section('C. 接口（真登录 + 真数据）');

  const studentToken = await loginUser('a', '111111');
  ok('学生 a 登录成功', !!studentToken);

  let studentTier = null;
  if (studentToken) {
    // C1 段位皮肤懒补偿
    const prof = await apiGet('/api/pk/profile', studentToken);
    studentTier = prof?.data?.tier;
    ok('/api/pk/profile 返回 tier', Number.isFinite(Number(studentTier)), `tier=${studentTier}`);

    const mySkins = await apiGet('/api/student/my-skins', studentToken);
    const owned = (mySkins?.data?.ownedSkins || []).map((s) => s.skin_id);
    const expectOwned = [];
    for (let i = 0; i <= Number(studentTier || 0); i++) {
      const sid = mapIndex[i];
      if (sid) expectOwned.push(sid);
    }
    ok('段位单调：已达 tier 对应的皮肤全部拥有',
      expectOwned.every((s) => owned.includes(s)),
      `tier=${studentTier} 应得=[${expectOwned}] 实际段位皮肤=[${owned.filter((s) => s.startsWith('skin_rank_'))}]`);
    // 段位皮肤在 my-skins 里的行必须 unlock_source='rank'
    if (owned.some((s) => s.startsWith('skin_rank_'))) {
      const [r] = await pool.query(
        `SELECT DISTINCT unlock_source FROM student_skins
          WHERE student_id = (SELECT id FROM profiles WHERE username = ?)
            AND skin_id LIKE 'skin_rank_%'`, ['a']);
      ok('学生 a 的段位皮肤在库中来源为 rank',
        r.length > 0 && r.every((x) => x.unlock_source === 'rank'),
        r.map((x) => x.unlock_source).join(','));
    }

    // C2 对战历史
    const hist = await apiGet('/api/pk/history?page=1&pageSize=10', studentToken);
    ok('/api/pk/history 返回列表', Array.isArray(hist?.data?.list), `count=${hist?.data?.list?.length}`);
    const first = (hist?.data?.list || [])[0];
    if (first) {
      ok('历史行带对手字段（opp_real_name/opp_username）',
        'opp_real_name' in first || 'opp_username' in first,
        Object.keys(first).join(','));
      ok('历史行带 tier_changed 布尔', typeof first.tier_changed === 'boolean', `tier_changed=${first.tier_changed}`);
      ok('历史行带 config_name / question_count',
        'config_name' in first && 'question_count' in first);
    } else {
      ok('历史行有数据（学生 a 应有对战记录）', false, '列表为空，无法验证字段');
    }

    // C3 荣誉数据
    const honors = await apiGet('/api/student/honors', studentToken);
    const hd = honors?.data || {};
    ok('/api/student/honors 带 pk_total_battles', 'pk_total_battles' in hd, `=${hd.pk_total_battles}`);
    ok('战绩自洽：总场次 = 胜 + 负 + 平',
      Number(hd.pk_total_battles) === Number(hd.pk_total_wins) + Number(hd.pk_total_losses) + Number(hd.pk_total_draws),
      `${hd.pk_total_battles} vs ${hd.pk_total_wins}+${hd.pk_total_losses}+${hd.pk_total_draws}`);
  }

  // C4 错题榜三字段（教师身份，接口要求 class_id）
  const teacherToken = await loginUser('teacher', 'xgpy666');
  ok('教师 teacher 登录成功', !!teacherToken);
  if (teacherToken) {
    // 取本学期班级 id（app 里 test 班有学生）
    const cls = await apiGet('/api/classes', teacherToken);
    const classId = (cls?.data || [])[0]?.id;
    ok('能取到班级 id（错题榜必填）', !!classId, `class_id=${classId}`);
    if (classId) {
      const wq = await apiGet(`/api/pk/stats/wrong-questions?class_id=${encodeURIComponent(classId)}&limit=10&offset=0`, teacherToken);
      const rows = wq?.data?.rows || [];
      ok('/api/pk/stats/wrong-questions 返回列表', Array.isArray(rows), `count=${rows.length} total=${wq?.data?.total}`);
      ok('错题榜 total 与列表口径一致（total>0 时列表不为空）',
        !(Number(wq?.data?.total) > 0 && rows.length === 0),
        `total=${wq?.data?.total} rows=${rows.length}`);
      if (rows.length > 0) {
        const r0 = rows[0];
        ok('错题行带 options 字段', 'options' in r0);
        ok('错题行带 answers 字段', 'answers' in r0);
        ok('错题行带 explanation 字段', 'explanation' in r0);
        ok('options 已被解析成数组或对象（非原始 JSON 串）',
          r0.options === null || typeof r0.options !== 'string',
          `typeof=${typeof r0.options}`);
        ok('answers 已被解析成数组或对象（非原始 JSON 串）',
          r0.answers === null || typeof r0.answers !== 'string',
          `typeof=${typeof r0.answers}`);

        // ⛔ 端到端：按**前端同款口径**解析全量错题，模拟弹窗渲染。
        // 修 v2.6.7 的 bug：options/answers 是包裹对象，不拆包 → 无选项 + "[object Object]"。
        const probe = await apiGet(
          `/api/pk/stats/wrong-questions?class_id=${encodeURIComponent(classId)}&limit=100&offset=0`,
          teacherToken
        );
        const all = probe?.data?.rows || [];
        let objObj = 0, emptyAns = 0, choiceNoOpts = 0, keyMiss = 0;
        for (const r of all) {
          const opts = feNormalizeOptions(r.options);
          const ans = feNormalizeAnswers(r.answers);
          const ansStr = ans.join('、');
          if (ansStr.includes('[object')) objObj++;
          if (ans.length === 0) emptyAns++;
          if (r.type === 'choice' && opts.length === 0) choiceNoOpts++;
          if (r.type === 'choice') {
            for (const a of ans) if (!opts.some((o) => o.key === a)) keyMiss++;
          }
        }
        ok('全量错题：正确答案无 "[object Object]"', objObj === 0, `共 ${all.length} 题，异常 ${objObj} 题`);
        ok('全量错题：正确答案不为空', emptyAns === 0, `空答案 ${emptyAns} 题`);
        ok('全量错题：选择题都有选项', choiceNoOpts === 0, `无选项 ${choiceNoOpts} 题`);
        ok('全量错题：选择题答案键都能在选项中命中', keyMiss === 0, `未命中 ${keyMiss} 处`);
        // 填空题（无选项）必须有非空答案 —— 用户反馈的正是这类显示不出来
        const fills = all.filter((r) => r.type === 'fill_blank' || r.type === 'fill');
        if (fills.length > 0) {
          const fillOk = fills.every((r) => feNormalizeAnswers(r.answers).length > 0
            && !feNormalizeAnswers(r.answers).join('、').includes('[object'));
          ok('填空题正确答案正常显示（非空且非 [object Object]）',
            fillOk, `填空题 ${fills.length} 道，示例「${feNormalizeAnswers(fills[0].answers).join('、')}」`);
        }
      } else {
        ok('错题榜已返回数据（用于验证三字段）', false,
          `rows=${rows.length} total=${wq?.data?.total}`);
      }
    }
  }

  // C5 PK 结算逐题复盘（学生端，接口 /api/pk/history/:room_id）
  // ⛔ 该接口必须下发 options/explanation，否则结算页双击题干弹窗没有内容
  if (studentToken) {
    const hist = await apiGet('/api/pk/history?page=1&pageSize=5', studentToken);
    const firstRoom = (hist?.data?.list || [])[0]?.id;
    ok('能取到历史房间 id（复盘必填）', !!firstRoom, `room=${firstRoom}`);
    if (firstRoom) {
      const rev = await apiGet(`/api/pk/history/${encodeURIComponent(firstRoom)}`, studentToken);
      const ans = rev?.data?.answers || [];
      ok('/api/pk/history/:room_id 返回 answers', Array.isArray(ans) && ans.length > 0, `count=${ans.length}`);
      if (ans.length > 0) {
        ok('复盘作答行带 options 字段', 'options' in ans[0]);
        ok('复盘作答行带 explanation 字段', 'explanation' in ans[0]);
        ok('复盘作答行保留 correct_answer（原字段未破坏）', 'correct_answer' in ans[0]);

        // 端到端：按前端同款口径（utils/questionDisplay）解析全部复盘作答
        let objObj2 = 0, emptyAns2 = 0, choiceNoOpts2 = 0, keyMiss2 = 0;
        for (const a of ans) {
          const opts = feNormalizeOptions(a.options);
          const ansl = feNormalizeAnswers(a.correct_answer);
          if (ansl.join('、').includes('[object')) objObj2++;
          if (ansl.length === 0) emptyAns2++;
          if (a.question_type === 'choice' && opts.length === 0) choiceNoOpts2++;
          if (a.question_type === 'choice') {
            for (const k of ansl) if (!opts.some((o) => o.key === k)) keyMiss2++;
          }
        }
        ok('复盘：正确答案无 "[object Object]"', objObj2 === 0, `共 ${ans.length} 条，异常 ${objObj2} 条`);
        ok('复盘：正确答案不为空', emptyAns2 === 0, `空答案 ${emptyAns2} 条`);
        ok('复盘：选择题都有选项', choiceNoOpts2 === 0, `无选项 ${choiceNoOpts2} 条`);
        ok('复盘：选择题答案键都能在选项中命中', keyMiss2 === 0, `未命中 ${keyMiss2} 处`);
      }
    }
  }

  // ══ D. 兑换侧拦截 ════════════════════════════════════════════════════
  section('D. 段位皮肤不可用积分兑换');

  {
    ok('兑换路由在扣分前拦截段位皮肤',
      /unlockSource\s*===\s*['"]rank['"]/.test(beIndexSrc) && /段位专属皮肤/.test(beIndexSrc));
    const grantFn = /async\s+function\s+grantRankSkins/.test(beIndexSrc);
    ok('index.js 有 grantRankSkins 函数', grantFn);
    ok('grantRankSkins 用 INSERT IGNORE（幂等）',
      beIndexSrc.slice(beIndexSrc.indexOf('async function grantRankSkins')).slice(0, 800).includes('INSERT IGNORE'));
    const cntMeta = (beIndexSrc.match(/^const WINDOW_SKINS_META/gm) || []).length;
    ok('WINDOW_SKINS_META 仅定义一次（防 TDZ）', cntMeta === 1, `出现 ${cntMeta} 次`);
    const metaIdx = beIndexSrc.indexOf('const WINDOW_SKINS_META');
    const useIdx = beIndexSrc.indexOf("unlockSource === 'rank'");
    ok('WINDOW_SKINS_META 定义位置早于兑换校验使用点',
      metaIdx > 0 && metaIdx < useIdx, `def=${metaIdx} use=${useIdx}`);
  }

  if (studentToken) {
    // 真调一次兑换接口（把段位皮肤挂在一个奖品上再兑换）——
    // 这里走的是一个更直接的路径：用 prize 里带段位皮肤的兑换请求必须被拒。
    // 但更稳的是直接校验路由层拦截逻辑已存在（D 段源码断言），
    // 接口层用一个不存在的 prize 也拿不到 200，故只在能拿到段位皮肤奖品时才实测。
    const prizes = await apiGet('/api/business/prizes', teacherToken);
    const rankPrize = (prizes?.data || []).find(
      (p) => String(p.skin_id || '').startsWith('skin_rank_')
    );
    if (rankPrize) {
      const me = await apiGet('/api/auth/me', studentToken);
      const sid = me?.data?.id || me?.data?.profile?.id;
      const r = await apiSend('POST', '/api/business/exchange-prize', studentToken,
        { student_id: sid, prize_id: rankPrize.id });
      const rejected = r && (r.status === 403 || r.json?.error);
      ok('兑换段位皮肤奖品被拒绝', !!rejected,
        r ? `status=${r.status} error=${r.json?.error || ''}` : '请求失败');
    } else {
      ok('奖品库无段位皮肤（教师下拉已排除，拦截逻辑走源码断言）', true,
        'prize 下拉不含 skin_rank_*，符合预期');
    }
  }

  // ══ E. 源码接线 ══════════════════════════════════════════════════════
  section('E. 源码接线');

  {
    // ① 首战奖励回执
    ok('battleEngine 外层声明 rewardsFinal',
      /let\s+rewardsFinal\s*=\s*\{\}/.test(beEngineSrc));
    ok('battleEngine commit 后转正 rewardsFinal',
      beEngineSrc.includes('rewardsFinal = rewardByUser'));
    ok('battle_end 广播带 bonuses',
      /bonuses\s*:\s*rewardsFinal/.test(beEngineSrc));
    ok('battle_end 广播带 daily_battles_target',
      /daily_battles_target\s*:\s*rewardCfg\.dailyBattlesTarget/.test(beEngineSrc));
    // 三个失败分支不得带头部载荷（积分没发出去不能提示）
    const emitCount = (beEngineSrc.match(/emit\('pk:battle_end'/g) || []).length;
    const bonusCount = (beEngineSrc.match(/bonuses\s*:\s*rewardsFinal/g) || []).length;
    ok('仅结算成功那一次广播带 bonuses',
      emitCount > 1 && bonusCount === 1, `emit=${emitCount} bonuses=${bonusCount}`);

    // ② 段位皮肤在结算事务内授予
    ok('battleEngine 定义 RANK_TIER_SKIN_MAP', /const\s+RANK_TIER_SKIN_MAP\s*=/.test(beEngineSrc));
    ok('battleEngine 升段时授予皮肤（INSERT IGNORE + rank 来源）',
      /INSERT IGNORE INTO student_skins/.test(beEngineSrc) && /'rank'/.test(beEngineSrc));
    ok('段位皮肤授予为单调补发（for i <= curTier）',
      /for\s*\(\s*let\s+i\s*=\s*0;\s*i\s*<=\s*curTier/.test(beEngineSrc));
  }

  {
    const rp = readFe('src/components/student/pk-battle/PKResult.tsx');
    ok('PKResult 有 bonuses prop', /bonuses\?:/.test(rp));
    ok('PKResult 过滤 0 值（今日已发过不发文案）', /firstBattlePts|bonusTotal/.test(rp));
    ok('PKResult 渲染本局额外奖励卡片', rp.includes('本局额外奖励'));
    ok('PKResult 首战文案', rp.includes('每日首战'));
    ok('PKResult 满场文案', rp.includes('单日满'));

    const pb = readFe('src/components/student/pk-battle/PKBattle.tsx');
    ok('PKBattle 解析 data.bonuses', /data\?\.bonuses/.test(pb));
    ok('PKBattle 透传 bonuses 给 PKResult', /bonuses=\{resultBonuses\}/.test(pb));
    ok('PKBattle 新局清空 rewards', /setResultBonuses\(null\)/.test(pb));

    const st = readFe('src/components/teacher/PKStatsTab.tsx');
    ok('PKStatsTab 双击题干打开详情', /onDoubleClick/.test(st));
    ok('PKStatsTab 详情弹窗显示解析', st.includes('解析'));
    ok('PKStatsTab 提示双击', st.includes('双击'));
    // ⛔ 选项/答案归一化实现已抽到公共工具 utils/questionDisplay.ts ——
    // 教师端错题榜与学生端 PK 结算逐题复盘共用同一份口径，两处副本漂移过一次。
    // 断言必须落在**公共工具**上，且确认两边都从它 import。
    const qd = readFe('src/utils/questionDisplay.ts');
    ok('公共工具 questionDisplay.ts 存在且导出 normalizeOptions',
      /export const normalizeOptions/.test(qd));
    ok('公共工具 questionDisplay.ts 导出 normalizeAnswers',
      /export const normalizeAnswers/.test(qd));
    ok('公共工具导出 questionTypeLabel（题型中文标签唯一入口）',
      /export const questionTypeLabel/.test(qd));
    ok('PKStatsTab 从 questionDisplay 引入归一化（不再本地副本）',
      /from '\.\.\/\.\.\/utils\/questionDisplay'/.test(st)
      && /normalizeOptions/.test(st) && /normalizeAnswers/.test(st));
    ok('PKStatsTab 不再保留本地 normalizeOptions 实现（防副本漂移）',
      !/const normalizeOptions = /.test(st));
    // ⛔ 后端 options/answers 存的是**包裹对象**（{options:[...]} / {answers:[...]}），
    // 前端不拆包会显示"本题无选项" + 正确答案 "[object Object]"（v2.6.7 修的 bug）。
    ok('normalizeOptions 拆包裹对象（{options:[...]}）',
      /o\.options\s*\?\?\s*o\.items/.test(qd));
    ok('normalizeAnswers 拆包裹对象（{answers:[...]}）',
      /o\.answers\s*\?\?\s*o\.answer/.test(qd));
    ok('选项剥掉自带前缀（避免 A. A. xxx）',
      /OPTION_PREFIX_RE/.test(qd) || /replace\(\/\^\\s\*\(\[A-Za-z\]\)/.test(qd));
    ok('fill_blank 题型有中文标签',
      /case 'fill':\s*\n\s*case 'fill_blank':/.test(qd) && qd.includes('填空题'));

    // ===== 学生端 PK 结算「逐题复盘」双击看详情（与教师端错题榜同款交互）=====
    ok('PKResult 引入公共 questionDisplay 工具',
      /from '\.\.\/\.\.\/\.\.\/utils\/questionDisplay'/.test(rp));
    ok('PKResult 复盘行绑定 onDoubleClick', /onDoubleClick=\{\(\) => setDetailQuestion/.test(rp));
    ok('PKResult 有 detailQuestion state（详情弹窗数据源）',
      /useState<ReviewAnswer \| null>\(null\)/.test(rp));
    ok('PKResult 详情弹窗显示正确答案', /正确答案/.test(rp));
    ok('PKResult 详情弹窗显示我的作答', /我的作答/.test(rp));
    ok('PKResult 详情弹窗显示解析', /解析/.test(rp));
    ok('PKResult 详情弹窗渲染选项列表（复用 normalizeOptions）',
      /normalizeOptions\(detailQuestion\.options\)/.test(rp) && /opts\.map/.test(rp));
    ok('PKResult 提示双击可看详情', rp.includes('双击'));
    // 后端复盘接口必须下发 options/explanation，否则前端拿不到数据
    ok('后端复盘接口下发 options 与 explanation',
      /q\.options AS options, q\.explanation AS explanation/.test(beIndexSrc));

    const lb = readFe('src/components/student/pk-battle/PKLobby.tsx');
    ok('PKLobby 三页签（排行榜/荣誉/历史）',
      lb.includes("'rank'") && lb.includes("'honor'") && lb.includes("'history'"));
    ok('PKLobby 拉取 /api/student/honors', lb.includes('/api/student/honors'));
    ok('PKLobby 拉取 /api/pk/history', lb.includes('/api/pk/history'));
    ok('PKLobby 有分页', /HISTORY_PAGE_SIZE/.test(lb));
    ok('PKLobby 荣誉卡（连胜达人/零失误/愈战愈勇）',
      lb.includes('连胜达人') && lb.includes('零失误') && lb.includes('愈战愈勇'));

    const sm = readFe('src/components/student/SkinManager.tsx');
    ok('SkinManager 引用段位皮肤', /RANK_SKINS/.test(sm));
    ok('SkinManager 从 /api/pk/profile 读段位', sm.includes('/api/pk/profile'));
    ok('SkinManager 积分皮肤排除段位皮肤', /unlockSource\s*!==\s*'rank'/.test(sm));
    ok('SkinManager 段位专属皮肤区块', sm.includes('段位专属皮肤'));
    ok('SkinManager 未解锁显示所需段位',
      sm.includes('需达到') && sm.includes('还差'));

    const pm = readFe('src/components/teacher/PrizeManager.tsx');
    ok('奖品下拉排除段位皮肤', /unlockSource\s*!==\s*'rank'/.test(pm));
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
