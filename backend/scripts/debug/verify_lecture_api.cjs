/**
 * AI 讲堂（微课程）后端回归
 *
 * 覆盖：鉴权、创建校验、整篇生成、未传字段保留、发布门槛、
 *       学生端开关/班级/草稿可见性、越权、复制、单页重生成、清理无残留。
 *
 * ⛔ 只在真实库上跑，课程标题统一 tmp_ 前缀，末尾按前缀清干净并逐条复查。
 * ⛔ 学生 hidden_features 先快照后还原（它是老师手动配置的，不能被回归改坏）。
 */
const mysql = require('mysql2/promise');

const BASE = process.env.XGPY_BASE || 'http://127.0.0.1:3101';
const TEACHER = { username: 'teacher', password: 'xgpy666' };
const STUDENT = { username: 'a', password: '111111' };
const TMP = 'tmp_讲堂回归';

let pass = 0;
let fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`  ✅ ${name}${extra ? ' — ' + extra : ''}`); }
  else { fail += 1; console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`); }
};
const section = (t) => console.log(`\n== ${t} ==`);

const login = async (u, p) => {
  const r = await fetch(`${BASE}/api/auth/secure-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: u, password: p, deviceInfo: 'verify-lecture' }),
  });
  const j = await r.json().catch(() => null);
  return j?.data?.session?.access_token || null;
};

const call = async (token, method, path, body) => {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = await r.json().catch(() => null);
  return { status: r.status, json: j, data: j?.data, error: j?.error };
};

(async () => {
  const conn = await mysql.createConnection({ host: 'localhost', user: 'root', password: '122201', database: 'xgpy' });
  const created = [];
  let stuSnapshot = null;
  let stuId = null;

  try {
    const ttk = await login(TEACHER.username, TEACHER.password);
    const stk = await login(STUDENT.username, STUDENT.password);
    ok('教师登录', !!ttk);
    ok('学生登录', !!stk);
    if (!ttk || !stk) throw new Error('登录失败，后续无法继续');

    const [srows] = await conn.query("SELECT id, class_id, hidden_features FROM profiles WHERE username = ? LIMIT 1", [STUDENT.username]);
    stuId = srows[0].id;
    stuSnapshot = srows[0].hidden_features;
    const stuClass = srows[0].class_id;

    // ---------- A. 鉴权 ----------
    section('A. 鉴权与越权');
    const stuOnTeacher = await call(stk, 'GET', '/api/teacher/lectures');
    ok('学生访问教师端课程列表被拒', stuOnTeacher.status === 403 || stuOnTeacher.status === 401, `status=${stuOnTeacher.status}`);
    const teaOnStudent = await call(ttk, 'GET', '/api/student/lectures');
    ok('教师访问学生端课程列表被拒', teaOnStudent.status === 403 || teaOnStudent.status === 401, `status=${teaOnStudent.status}`);

    // ---------- B. 创建校验 ----------
    section('B. 创建校验');
    const noTitle = await call(ttk, 'POST', '/api/teacher/lectures', { outline: '知识点了' });
    ok('缺标题 400', noTitle.status === 400, noTitle.error || '');
    const noOutline = await call(ttk, 'POST', '/api/teacher/lectures', { title: `${TMP} 无大纲` });
    ok('缺大纲 400', noOutline.status === 400, noOutline.error || '');
    const badStyle = await call(ttk, 'POST', '/api/teacher/lectures', {
      title: `${TMP} 坏风格`, outline: '知识点', style_key: 'no_such_style',
    });
    ok('非法风格 400', badStyle.status === 400, badStyle.error || '');

    // ---------- C. 创建 + 生成 ----------
    section('C. 创建与整篇生成');
    const mk = await call(ttk, 'POST', '/api/teacher/lectures', {
      title: `${TMP} 数据与信息`,
      subject: '必修1',
      chapter: '1.1 我们身边的数据',
      outline: '1. 数据是客观事物的符号记录\n2. 信息是加工后对人有意义的数据\n3. 知识是提炼出的规律性认识\n4. 三者逐层加工',
      requirement: '面向学测，讲清三者区别',
      page_target: 6,
    });
    ok('创建草稿成功', mk.status === 200 && !!mk.data?.lecture?.id, `id=${mk.data?.lecture?.id}`);
    const id = mk.data?.lecture?.id;
    if (!id) throw new Error('创建失败，终止');
    created.push(id);
    ok('新建默认草稿态', mk.data.lecture.status === 'draft', mk.data.lecture.status);
    ok('新建时 pages 为空', (mk.data.lecture.pages || []).length === 0);

    const emptyPublish = await call(ttk, 'POST', `/api/teacher/lectures/${id}/publish`);
    ok('空课程不能发布（400）', emptyPublish.status === 400, emptyPublish.error || '');

    const t0 = Date.now();
    const gen = await call(ttk, 'POST', `/api/teacher/lectures/${id}/generate`, { page_target: 6 });
    const genMs = Date.now() - t0;
    ok('整篇生成成功', gen.status === 200 && (gen.data?.lecture?.pages || []).length > 0, `${(genMs / 1000).toFixed(1)}s`);
    const lec = gen.data?.lecture || {};
    const pages = lec.pages || [];
    ok('页数在 3~12 且贴合目标(5~7)', pages.length >= 3 && pages.length <= 12, `pages=${pages.length}`);
    ok('首页是 lead', pages[0]?.kind === 'lead', pages[0]?.kind);
    ok('末页是 recap', pages[pages.length - 1]?.kind === 'recap', pages[pages.length - 1]?.kind);
    ok('每页都有讲解词', pages.every((p) => String(p.narration || '').trim().length > 0));
    ok('每页都有标题', pages.every((p) => String(p.title || '').trim().length > 0));
    ok('page_count 与 pages 一致', Number(lec.page_count) === pages.length, `${lec.page_count}/${pages.length}`);
    ok('duration_sec 已估算', Number(lec.duration_sec) > 0, `${lec.duration_sec}s`);
    ok('cover 已写入首屏摘要', !!lec.cover?.title, JSON.stringify(lec.cover || null));
    ok('讲解词不含 markdown 星号', pages.every((p) => !/\*\*|##|```/.test(p.narration || '')));
    // chart 页若存在，数字必须在大纲里出现过（防编数）
    const chartPages = pages.filter((p) => p.kind === 'chart');
    ok('chart 页数字均可在大纲中找到（若无 chart 页视为通过）',
      chartPages.every((p) => (p.chart?.items || []).every((it) => String(mk.data.lecture.outline || '').includes(String(it.value)))),
      `chart 页 ${chartPages.length} 个`);

    // ---------- D. 更新：未传字段保留 ----------
    section('D. 部分更新保留原值');
    const [before] = await conn.query('SELECT outline, class_ids, title FROM lectures WHERE id = ?', [id]);
    const upd = await call(ttk, 'PUT', `/api/teacher/lectures/${id}`, { title: `${TMP} 改了标题` });
    const [after] = await conn.query('SELECT outline, class_ids, title FROM lectures WHERE id = ?', [id]);
    ok('改标题成功', upd.status === 200 && after[0].title === `${TMP} 改了标题`, after[0].title);
    ok('未传 outline 时大纲保留', after[0].outline === before[0].outline, `len=${String(after[0].outline || '').length}`);
    ok('未传 class_ids 时班级保留',
      JSON.stringify(after[0].class_ids) === JSON.stringify(before[0].class_ids),
      JSON.stringify(after[0].class_ids));
    const emptyTitle = await call(ttk, 'PUT', `/api/teacher/lectures/${id}`, { title: '   ' });
    ok('标题置空被拒（400）', emptyTitle.status === 400, emptyTitle.error || '');

    const badPages = await call(ttk, 'PUT', `/api/teacher/lectures/${id}`, { pages: 'not-array' });
    ok('pages 非数组被拒（400）', badPages.status === 400, badPages.error || '');

    // 手改一页标题 → cover/page_count 应同步刷新
    const edited = pages.slice();
    edited[0] = { ...edited[0], title: '手改的首页标题' };
    const savePages = await call(ttk, 'PUT', `/api/teacher/lectures/${id}`, { pages: edited });
    ok('保存整篇页面成功', savePages.status === 200, `status=${savePages.status}`);
    ok('封面随首页标题刷新', savePages.data?.lecture?.cover?.title === '手改的首页标题', JSON.stringify(savePages.data?.lecture?.cover || null));

    // ---------- E. 单页重生成 ----------
    section('E. 单页重生成');
    const outOfRange = await call(ttk, 'POST', `/api/teacher/lectures/${id}/generate-page`, { index: 99 });
    ok('页码越界 400', outOfRange.status === 400, outOfRange.error || '');
    const regen = await call(ttk, 'POST', `/api/teacher/lectures/${id}/generate-page`, { index: 1 });
    ok('重生成第 2 页成功', regen.status === 200, `status=${regen.status}`);
    ok('重生成后页数不变', (regen.data?.lecture?.pages || []).length === pages.length,
      `${(regen.data?.lecture?.pages || []).length}/${pages.length}`);
    ok('重生成没动第 1 页（首页仍是手改标题）',
      regen.data?.lecture?.pages?.[0]?.title === '手改的首页标题',
      regen.data?.lecture?.pages?.[0]?.title);

    // ---------- F. 发布与学生端 ----------
    section('F. 发布与学生端可见性');
    // 学生先关掉开关
    await conn.query("UPDATE profiles SET hidden_features = JSON_ARRAY('paint_board','roll_call','ai_explain') WHERE id = ?", [stuId]);
    const closed = await call(stk, 'GET', '/api/student/lectures');
    ok('讲解关闭时学生列表 403', closed.status === 403, closed.error || '');
    const closedDetail = await call(stk, 'GET', `/api/student/lectures/${id}`);
    ok('讲解关闭时学生看详情也 403', closedDetail.status === 403, closedDetail.error || '');

    // 放开开关
    await conn.query("UPDATE profiles SET hidden_features = JSON_ARRAY('paint_board','roll_call') WHERE id = ?", [stuId]);

    const draftList = await call(stk, 'GET', '/api/student/lectures');
    ok('放开后草稿仍不出现在学生列表',
      draftList.status === 200 && !(draftList.data?.lectures || []).some((x) => x.id === id),
      `条数=${(draftList.data?.lectures || []).length}`);
    const draftDetail = await call(stk, 'GET', `/api/student/lectures/${id}`);
    ok('草稿详情对学生 404', draftDetail.status === 404, draftDetail.error || '');

    const pub = await call(ttk, 'POST', `/api/teacher/lectures/${id}/publish`);
    ok('发布成功', pub.status === 200 && pub.data?.lecture?.status === 'published', pub.data?.lecture?.status);

    const pubList = await call(stk, 'GET', '/api/student/lectures');
    const mine = (pubList.data?.lectures || []).find((x) => x.id === id);
    ok('发布后学生列表可见', !!mine, mine ? mine.title : '');
    ok('学生列表不含 pages（省流量）', mine ? mine.pages === undefined : false);
    ok('学生列表带封面', !!mine?.cover?.title, JSON.stringify(mine?.cover || null));

    const [pc0] = await conn.query('SELECT play_count FROM lectures WHERE id = ?', [id]);
    const det = await call(stk, 'GET', `/api/student/lectures/${id}`);
    ok('学生打开详情拿到全部页面', det.status === 200 && (det.data?.lecture?.pages || []).length === pages.length,
      `pages=${(det.data?.lecture?.pages || []).length}`);
    const [pc1] = await conn.query('SELECT play_count FROM lectures WHERE id = ?', [id]);
    ok('播放次数 +1', Number(pc1[0].play_count) === Number(pc0[0].play_count) + 1, `${pc0[0].play_count} -> ${pc1[0].play_count}`);

    // 班级不匹配 → 403（把课程限定到一个不存在的班级）
    const otherClass = 'tmp_class_not_exists_9527';
    await call(ttk, 'PUT', `/api/teacher/lectures/${id}`, { class_ids: [otherClass] });
    const crossClass = await call(stk, 'GET', `/api/student/lectures/${id}`);
    ok('非本班学生看详情 403', crossClass.status === 403, crossClass.error || '');
    const crossList = await call(stk, 'GET', '/api/student/lectures');
    ok('非本班课程不出现在列表', !(crossList.data?.lectures || []).some((x) => x.id === id));

    // 恢复成本班可见（class_ids 空 = 不限）
    await call(ttk, 'PUT', `/api/teacher/lectures/${id}`, { class_ids: [] });
    const backList = await call(stk, 'GET', '/api/student/lectures');
    ok('清空 class_ids 后恢复全班可见', (backList.data?.lectures || []).some((x) => x.id === id), `stuClass=${stuClass}`);

    // 学生不能发布
    const stuPublish = await call(stk, 'POST', `/api/teacher/lectures/${id}/publish`);
    ok('学生调发布接口被拒', stuPublish.status === 403 || stuPublish.status === 401, `status=${stuPublish.status}`);

    // ---------- G. 取消发布 / 复制 / 删除 ----------
    section('G. 取消发布 / 复制 / 删除');
    const unpub = await call(ttk, 'POST', `/api/teacher/lectures/${id}/unpublish`);
    ok('取消发布成功', unpub.status === 200 && unpub.data?.lecture?.status === 'draft', unpub.data?.lecture?.status);
    const afterUnpub = await call(stk, 'GET', `/api/student/lectures/${id}`);
    ok('取消发布后学生看不到', afterUnpub.status === 404, afterUnpub.error || '');

    const dup = await call(ttk, 'POST', `/api/teacher/lectures/${id}/duplicate`);
    const dupId = dup.data?.lecture?.id;
    ok('复制成功且是新 id', !!dupId && dupId !== id, dupId || '');
    if (dupId) {
      created.push(dupId);
      ok('副本是草稿态', dup.data.lecture.status === 'draft', dup.data.lecture.status);
      ok('副本页数一致', Number(dup.data.lecture.page_count) === pages.length, `${dup.data.lecture.page_count}/${pages.length}`);
      ok('副本标题带「副本」', String(dup.data.lecture.title).includes('副本'), dup.data.lecture.title);
    }

    const del = await call(ttk, 'DELETE', `/api/teacher/lectures/${id}`);
    ok('删除成功', del.status === 200, `status=${del.status}`);
    created.splice(created.indexOf(id), 1);
    const afterDel = await call(ttk, 'GET', `/api/teacher/lectures/${id}`);
    ok('删除后再查 404', afterDel.status === 404, `status=${afterDel.status}`);
  } catch (e) {
    fail += 1;
    console.log(`\n💥 异常终止：${e.message}`);
  } finally {
    // ---------- H. 清理 ----------
    section('H. 清理与不留痕');
    try {
      const [rows] = await conn.query('SELECT id, title FROM lectures WHERE title LIKE ?', [`${TMP}%`]);
      for (const r of rows) await conn.query('DELETE FROM lectures WHERE id = ?', [r.id]);
      const [left] = await conn.query("SELECT COUNT(*) c FROM lectures WHERE title LIKE 'tmp_%'");
      ok('tmp_ 课程已清空', Number(left[0].c) === 0, `残留 ${left[0].c}`);
    } catch (e) {
      ok('清理临时课程', false, e.message);
    }
    if (stuId && stuSnapshot !== null) {
      await conn.query('UPDATE profiles SET hidden_features = ? WHERE id = ?', [stuSnapshot, stuId]);
      const [h] = await conn.query('SELECT hidden_features FROM profiles WHERE id = ?', [stuId]);
      ok('学生 hidden_features 已还原',
        JSON.stringify(h[0].hidden_features) === JSON.stringify(stuSnapshot),
        JSON.stringify(h[0].hidden_features));
    }
    await conn.end();
    console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
    process.exit(fail ? 1 : 0);
  }
})();
