#!/usr/bin/env node
/**
 * verify_explain_styles.cjs
 * ============================================================
 * 验证「AI 语音讲解 · 风格库」（迁移 107，2026-10-21）：
 *   A. 结构     —— explain_styles / explain_scripts 存在，旧表 question_explain_scripts 已删
 *   B. 内置风格 —— 5 组齐全（chat/quick/warm 启用，rhyme/quest 默认停用），builtin=1
 *   C. 提示词   —— 结构锚定 + 公共规则 + 风格片段 + 结构复述，缺一段都不行；
 *                  改风格片段 → prompt_version 必变（否则改了风格不生效）
 *   D. 缓存隔离 —— 同一道题两种风格各读各的缓存（⛔ 串台会让切风格读到别人家的讲解）
 *   E. 教师 CRUD —— 新建/改名（未传字段保留原值）/停用/删除；内置风格删不掉
 *   F. 学生开关 —— 默认关闭时 403；放开后只能听自己做错的题（别人的题 403）
 *   G. 清理     —— 临时风格、marker 缓存、学生 hidden_features 全部还原，断言不留痕
 *
 * 用法：node scripts/debug/verify_explain_styles.cjs
 * 前置：后端 3101 在跑（不需要前端）。
 * 说明：不调大模型 —— 直接用计算出的 prompt_version 往缓存表写 marker，
 *       用「读缓存」路径验证键与版本，零 token。
 */

const path = require('path');
process.env.NODE_ENV = process.env.NODE_ENV || 'development';
require('../../src/env');

const pool = require('../../src/db');
const styles = require('../../src/explain-styles');

const BASE = process.env.XGPY_BASE || 'http://127.0.0.1:3101';
const TEACHER = { u: 'teacher', p: 'xgpy666' };
const STUDENT = { u: 'a', p: '111111' };

let pass = 0;
let fail = 0;
const failures = [];
function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}${detail ? '  ' + detail : ''}`); }
  else { fail++; failures.push(name); console.log(`  ✗ ${name}${detail ? '  ' + detail : ''}`); }
}
function section(t) { console.log(`\n【${t}】`); }

async function httpJson(method, url, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(BASE + url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await r.json().catch(() => null);
  return { status: r.status, json };
}

async function login(u, p) {
  const r = await httpJson('POST', '/api/auth/secure-login', { username: u, password: p });
  return r.json?.data?.session?.access_token || null;
}

const markerScript = (tag) => JSON.stringify({
  topic: `MARKER_${tag}`,
  scenes: [{ kind: 'point', title: 'marker', narration: `marker-${tag}` }],
});

async function main() {
  const created = { styleKey: null, markerRows: [], studentId: null, originalHidden: null };

  const teacherToken = await login(TEACHER.u, TEACHER.p);
  const studentToken = await login(STUDENT.u, STUDENT.p);
  ok('教师 / 学生登录', !!teacherToken && !!studentToken, `teacher=${!!teacherToken} student=${!!studentToken}`);
  if (!teacherToken || !studentToken) throw new Error('登录失败，后端是否在跑？');

  // ---------- A. 结构 ----------
  section('A. 表结构');
  const [tables] = await pool.query("SHOW TABLES LIKE 'explain%'");
  const tableNames = tables.map((r) => Object.values(r)[0]);
  ok('explain_styles 存在', tableNames.includes('explain_styles'));
  ok('explain_scripts 存在', tableNames.includes('explain_scripts'));
  const [oldTable] = await pool.query("SHOW TABLES LIKE 'question_explain_scripts'");
  ok('旧表 question_explain_scripts 已删除', oldTable.length === 0);

  const [pkRows] = await pool.query("SHOW KEYS FROM explain_scripts WHERE Key_name = 'PRIMARY'");
  const pkCols = pkRows.sort((a, b) => a.Seq_in_index - b.Seq_in_index).map((r) => r.Column_name);
  ok('缓存主键 = (question_id, style_key)', pkCols.join(',') === 'question_id,style_key', pkCols.join(','));

  // ---------- B. 内置风格 ----------
  section('B. 内置风格');
  const [rows] = await pool.query('SELECT style_key, name, max_chars, enabled, builtin, sort_order FROM explain_styles ORDER BY sort_order');
  const byKey = new Map(rows.map((r) => [r.style_key, r]));
  ok('内置风格 5 组齐全', ['chat', 'quick', 'warm', 'rhyme', 'quest'].every((k) => byKey.has(k)), rows.map((r) => r.style_key).join(','));
  ok('chat / quick / warm 默认启用', ['chat', 'quick', 'warm'].every((k) => Number(byKey.get(k)?.enabled) === 1));
  ok('rhyme / quest 默认停用', ['rhyme', 'quest'].every((k) => Number(byKey.get(k)?.enabled) === 0));
  ok('全部标记为内置（不可删）', rows.every((r) => Number(r.builtin) === 1));
  ok('默认风格 = chat（sort_order 最小且启用）', await (async () => {
    const [first] = await pool.query('SELECT style_key FROM explain_styles WHERE enabled = 1 ORDER BY sort_order ASC, style_key ASC LIMIT 1');
    return first[0]?.style_key === 'chat';
  })());

  // ---------- C. 提示词拼装 ----------
  section('C. 提示词拼装与版本号');
  const chat = await styles.getStyle(pool, 'chat');
  const quick = await styles.getStyle(pool, 'quick');
  const promptChat = styles.buildSystemPrompt(chat);
  const promptQuick = styles.buildSystemPrompt(quick);
  ok('含结构锚定（JSON 结构/scenes）', promptChat.includes('"scenes"') && promptChat.includes('"kind"'));
  ok('含公共规则：第一句先给结论', promptChat.includes('第一句先给结论'));
  ok('含公共规则：术语翻译一次', promptChat.includes('大白话解释'));
  ok('含公共规则：禁止否定式评价', promptChat.includes('禁止否定式评价'));
  ok('含风格片段原文', promptChat.includes(chat.snippet.split('\n')[0].slice(0, 12)));
  ok('结构复述段排在风格之后', promptChat.lastIndexOf('再次确认输出格式') > promptChat.lastIndexOf('讲解风格'));
  ok('字数上限写进提示词', promptChat.includes(`不超过 ${chat.max_chars} 字`));
  ok('不同风格 → 不同 prompt_version', styles.promptVersionOf(promptChat) !== styles.promptVersionOf(promptQuick));
  ok('版本号形如 v2:<hash>', /^v2:[0-9a-f]{12}$/.test(styles.promptVersionOf(promptChat)));
  ok('字数上限有夹取（9999 → 600）', styles.clampMaxChars(9999) === styles.MAX_CHARS_MAX && styles.clampMaxChars(1) === styles.MAX_CHARS_MIN);

  // 改片段 → 版本必变（这是「改了风格却看不出效果」的根因）
  const mutated = { ...chat, snippet: chat.snippet + '\n额外要求：语速再慢一点。' };
  ok('改风格片段后版本号变化（缓存自动失效）', styles.promptVersionOf(styles.buildSystemPrompt(mutated)) !== styles.promptVersionOf(promptChat));

  // ---------- D. 缓存隔离（零 token：直接写 marker 走读缓存） ----------
  section('D. 缓存按风格隔离');
  // ⚠️ marker 题必须挑**测试学生自己**的错题，且不能是「不进讲解列表」的题型
  //    （操作题 / 综合题会被学生端列表过滤掉，后面 F 段的自有题断言就会找不到样本）
  const [[q]] = await pool.query(
    `SELECT wq.student_id, wq.question_id FROM wrong_questions wq
       JOIN questions q ON q.id = wq.question_id
       JOIN profiles p ON p.id = wq.student_id
      WHERE p.username = ? AND q.type NOT IN ('wps_op','access_op','composite')
      ORDER BY wq.last_wrong_at DESC LIMIT 1`,
    [STUDENT.u],
  );
  ok('题库里有可用错题样本', !!q);
  if (!q) throw new Error('没有错题样本');

  for (const st of [chat, quick]) {
    const pv = styles.promptVersionOf(styles.buildSystemPrompt(st));
    await pool.query(
      `INSERT INTO explain_scripts (question_id, style_key, script, model, prompt_version)
       VALUES (?, ?, ?, 'verify', ?)
       ON DUPLICATE KEY UPDATE script = VALUES(script), model = VALUES(model), prompt_version = VALUES(prompt_version)`,
      [q.question_id, st.style_key, markerScript(st.style_key), pv],
    );
    created.markerRows.push({ question_id: q.question_id, style_key: st.style_key });
  }

  const readChat = await httpJson('POST', '/api/teacher/explain/script', { question_id: q.question_id, style_key: 'chat' }, teacherToken);
  const readQuick = await httpJson('POST', '/api/teacher/explain/script', { question_id: q.question_id, style_key: 'quick' }, teacherToken);
  ok('chat 命中缓存', readChat.status === 200 && readChat.json?.data?.cached === true);
  ok('chat 读到的是 chat 的脚本（未串台）', readChat.json?.data?.script?.topic === 'MARKER_chat', readChat.json?.data?.script?.topic);
  ok('quick 读到的是 quick 的脚本（未串台）', readQuick.json?.data?.script?.topic === 'MARKER_quick', readQuick.json?.data?.script?.topic);
  ok('响应带风格回执', readChat.json?.data?.style_key === 'chat' && readChat.json?.data?.style_name === chat.name);

  const noStyle = await httpJson('POST', '/api/teacher/explain/script', { question_id: q.question_id }, teacherToken);
  ok('不传 style_key 时回落默认风格（chat）', noStyle.json?.data?.style_key === 'chat');

  // ---------- E. 教师端 CRUD ----------
  section('E. 教师端风格增删改查');
  const tmpKey = `tmp_verify_${Date.now().toString(36)}`;
  const createRes = await httpJson('POST', '/api/teacher/explain/styles', {
    style_key: tmpKey,
    name: '临时验证风格',
    summary: '验证用，跑完即删',
    snippet: '用最简短的话说明这道题的关键点，不展开。',
    max_chars: 180,
    enabled: 1,
    sort_order: 900,
  }, teacherToken);
  ok('新建自定义风格 201', createRes.status === 201, `status=${createRes.status} ${createRes.json?.error || ''}`);
  if (createRes.status === 201) created.styleKey = tmpKey;

  const dup = await httpJson('POST', '/api/teacher/explain/styles', { style_key: tmpKey, name: 'x', snippet: '重复标识测试内容够长了吧' }, teacherToken);
  ok('标识重复 → 409', dup.status === 409);

  const nameBad = await httpJson('POST', '/api/teacher/explain/styles', { name: 'x', snippet: '太短' }, teacherToken);
  ok('片段过短 → 400', nameBad.status === 400);

  const beforeSnippet = (await styles.getStyle(pool, tmpKey))?.snippet;
  const putNameOnly = await httpJson('PUT', `/api/teacher/explain/styles/${tmpKey}`, { name: '临时验证风格-改名' }, teacherToken);
  const afterPut = await styles.getStyle(pool, tmpKey);
  ok('改名成功且未传字段保留原值', putNameOnly.status === 200 && afterPut.name === '临时验证风格-改名' && afterPut.snippet === beforeSnippet);

  const putDisabled = await httpJson('PUT', `/api/teacher/explain/styles/${tmpKey}`, { enabled: 0 }, teacherToken);
  ok('可停用', putDisabled.status === 200 && Number(putDisabled.json?.data?.style?.enabled) === 0);

  const [listApi] = [await httpJson('GET', '/api/teacher/explain/styles', undefined, teacherToken)];
  ok('教师端列表包含停用风格', (listApi.json?.data?.styles || []).some((s) => s.style_key === tmpKey));

  const delBuiltin = await httpJson('DELETE', '/api/teacher/explain/styles/chat', undefined, teacherToken);
  ok('内置风格不可删除 → 400', delBuiltin.status === 400);

  // ---------- F. 学生端开关 ----------
  section('F. 学生端开关与越权');
  const [[stu]] = await pool.query("SELECT id, hidden_features FROM profiles WHERE username = ? LIMIT 1", [STUDENT.u]);
  created.studentId = stu.id;
  created.originalHidden = stu.hidden_features;

  // ① 默认（关闭）
  await pool.query("UPDATE profiles SET hidden_features = JSON_ARRAY_APPEND(COALESCE(hidden_features, JSON_ARRAY()), '$', 'ai_explain') WHERE id = ? AND (hidden_features IS NULL OR JSON_CONTAINS(hidden_features, '\"ai_explain\"') = 0)", [stu.id]);
  const accessOff = await httpJson('GET', '/api/student/explain/access', undefined, studentToken);
  ok('关闭时 access.enabled=false', accessOff.status === 200 && accessOff.json?.data?.enabled === false);
  const scriptOff = await httpJson('POST', '/api/student/explain/script', { question_id: q.question_id }, studentToken);
  ok('关闭时生成讲解 → 403', scriptOff.status === 403);
  const wrongOff = await httpJson('GET', '/api/student/explain/wrong-questions', undefined, studentToken);
  ok('关闭时取错题 → 403', wrongOff.status === 403);

  // ② 放开
  await pool.query("UPDATE profiles SET hidden_features = JSON_REMOVE(hidden_features, JSON_UNQUOTE(JSON_SEARCH(hidden_features, 'one', 'ai_explain'))) WHERE id = ?", [stu.id]);
  const accessOn = await httpJson('GET', '/api/student/explain/access', undefined, studentToken);
  ok('放开后 access.enabled=true', accessOn.json?.data?.enabled === true);
  const styleKeys = (accessOn.json?.data?.styles || []).map((s) => s.style_key);
  ok('学生端只下发启用风格', styleKeys.includes('chat') && !styleKeys.includes('rhyme') && !styleKeys.includes('quest'), styleKeys.join(','));

  const myWrong = await httpJson('GET', '/api/student/explain/wrong-questions?limit=20', undefined, studentToken);
  const myList = myWrong.json?.data?.questions || [];
  ok('能取到自己的错题', myWrong.status === 200 && myList.length > 0, `count=${myList.length}`);
  ok('错题列表不含操作题', myList.every((x) => !['wps_op', 'access_op'].includes(x.type)));
  ok('错题列表不含综合题（内含多小题，不适宜语音讲解）', myList.every((x) => x.type !== 'composite'));

  // 只属于自己的题：自己列表里挑一道已写 marker 的
  const ownQ = myList.find((x) => created.markerRows.some((m) => m.question_id === x.id));
  if (ownQ) {
    const ownRead = await httpJson('POST', '/api/student/explain/script', { question_id: ownQ.id, style_key: 'chat' }, studentToken);
    ok('学生读自己的题命中缓存', ownRead.status === 200 && ownRead.json?.data?.cached === true);
  } else {
    ok('学生读自己的题命中缓存', false, '自己的错题里没有 marker 样本');
  }

  // 别人的题（不在自己 wrong_questions 里）
  const [others] = await pool.query(
    `SELECT wq.question_id FROM wrong_questions wq
      WHERE wq.student_id <> ?
        AND wq.question_id NOT IN (SELECT question_id FROM wrong_questions WHERE student_id = ?)
      LIMIT 1`,
    [stu.id, stu.id],
  );
  if (others.length) {
    const foreign = await httpJson('POST', '/api/student/explain/script', { question_id: others[0].question_id, style_key: 'chat' }, studentToken);
    ok('学生听别人的题 → 403', foreign.status === 403, foreign.json?.error || '');
  } else {
    ok('学生听别人的题 → 403', false, '库里没有「别人的题」样本');
  }

  const disabledStyle = await httpJson('POST', '/api/student/explain/script', { question_id: q.question_id, style_key: 'rhyme' }, studentToken);
  ok('学生选停用风格 → 400', disabledStyle.status === 400);

  // ---------- G. 清理 ----------
  section('G. 清理与不留痕');
  if (created.styleKey) {
    const del = await httpJson('DELETE', `/api/teacher/explain/styles/${created.styleKey}`, undefined, teacherToken);
    ok('删除自定义风格', del.status === 200);
  }
  const [styleCountAfter] = await pool.query("SELECT COUNT(*) c FROM explain_styles WHERE style_key LIKE 'tmp_%'");
  ok('无残留临时风格', Number(styleCountAfter[0].c) === 0);

  for (const m of created.markerRows) {
    await pool.query('DELETE FROM explain_scripts WHERE question_id = ? AND style_key = ? AND model = ?', [m.question_id, m.style_key, 'verify']);
  }
  const [markerLeft] = await pool.query("SELECT COUNT(*) c FROM explain_scripts WHERE model = 'verify'");
  ok('无残留 marker 缓存', Number(markerLeft[0].c) === 0);

  await pool.query('UPDATE profiles SET hidden_features = ? WHERE id = ?', [created.originalHidden, created.studentId]);
  const [[restored]] = await pool.query('SELECT hidden_features FROM profiles WHERE id = ?', [created.studentId]);
  ok('学生 hidden_features 已还原', JSON.stringify(restored.hidden_features) === JSON.stringify(created.originalHidden),
    `${restored.hidden_features}`);

  console.log(`\n========== 结果：${pass} 通过 / ${fail} 失败 ==========`);
  if (fail) {
    console.log('失败项：');
    failures.forEach((f) => console.log('  - ' + f));
  }
  await pool.end();
  process.exit(fail ? 1 : 0);
}

main().catch(async (e) => {
  console.error('脚本异常：', e);
  try { await pool.end(); } catch { /* ignore */ }
  process.exit(1);
});
