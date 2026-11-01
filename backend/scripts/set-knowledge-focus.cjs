/**
 * 给某个知识点指定「AI 讲解重点」，并立即重新生成讲稿。
 *
 * 背景：同一节讲义，不同老师想突出的点不一样。例如「运算符与表达式」这一节，
 * 讲义把 7 个算术运算符 + 5 个关系运算符 + 逻辑运算符 + 优先级全列了一遍，
 * 平均用力讲下来每个都只有一两句；而学测其实主要考 // % ** 和关系运算符。
 *
 * ⛔ 重点存在 knowledge_explain_scripts.focus 里，是**这一节的长期设置**：
 *    学生端点开时会自动带上它，保证全校听到的是同一份口径。
 *    不会出现"老师定制一份、学生一端生成就被覆盖"的情况。
 *
 * 用法（在 backend 目录下）：
 *   node scripts/set-knowledge-focus.cjs --chapter "程序设计语言的基本知识" --section "运算符与表达式" \
 *        --focus "本节课重点讲 // % ** 和关系运算符，其余一带而过"
 *   node scripts/set-knowledge-focus.cjs --chapter "章名" --section "小节名" --clear   # 取消定制，恢复平均讲
 *   node scripts/set-knowledge-focus.cjs --list                                        # 看哪些节已定制
 *
 * 可选：--port 3000（默认，生产）或 --port 3101（本地开发版）
 *       --teacher <教师账号id>（默认取库里第一个 role=teacher 的账号）
 *
 * ⛔ 只读 + 写讲解缓存表，不碰学生数据；临时会话用完即删。
 */
const mysql = require('mysql2/promise');

const argv = process.argv.slice(2);
const argOf = (name, dflt = null) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : dflt;
};
const hasFlag = (name) => argv.includes(`--${name}`);

const PORT = Number(argOf('port', '3000'));
const BASE = `http://127.0.0.1:${PORT}`;

async function db() {
  return mysql.createConnection({
    host: '127.0.0.1', user: 'root', password: '122201', database: 'xgpy', charset: 'utf8mb4',
  });
}

(async () => {
  const conn = await db();
  let sessionId = null;
  try {
    if (hasFlag('list')) {
      const [rows] = await conn.query(
        `SELECT section_path, CHAR_LENGTH(focus) AS len, updated_at
           FROM knowledge_explain_scripts WHERE focus IS NOT NULL AND focus <> '' ORDER BY updated_at DESC`,
      );
      console.log(`已定制讲解重点的知识点：${rows.length} 个\n`);
      for (const r of rows) console.log(`  ${r.section_path}  （重点 ${r.len} 字，${r.updated_at}）`);
      return;
    }

    const chapter = argOf('chapter');
    const section = argOf('section');
    if (!chapter || !section) {
      console.error('缺少参数。用法见文件顶部注释。');
      process.exitCode = 1;
      return;
    }

    let teacherId = argOf('teacher');
    if (!teacherId) {
      const [[t]] = await conn.query("SELECT id FROM profiles WHERE role = 'teacher' ORDER BY created_at LIMIT 1");
      if (!t) { console.error('找不到教师账号'); process.exitCode = 1; return; }
      teacherId = t.id;
    }

    // 临时会话：脚本跑完就删，不影响任何人
    const tok = `kpfocus_${Date.now()}`;
    const crypto = require('crypto');
    sessionId = `ls_kpfocus_${Date.now()}`;
    await conn.query(
      `INSERT INTO login_sessions (id, user_id, token, device_info, expires_at, is_active)
       VALUES (?, ?, ?, 'kpfocus', DATE_ADD(NOW(), INTERVAL 20 MINUTE), 1)`,
      [sessionId, teacherId, crypto.createHash('sha256').update(tok).digest('hex')],
    );

    const body = { chapter_id: chapter, section, force: true };
    if (hasFlag('clear')) body.focus = '';
    else {
      const focus = argOf('focus');
      if (!focus) { console.error('要重新生成请给 --focus "……"；要取消定制请用 --clear'); process.exitCode = 1; return; }
      body.focus = focus;
    }

    console.log(`重新生成「${chapter} / ${section}」…（约 15~30 秒）`);
    const res = await fetch(`${BASE}/api/teacher/explain/knowledge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      console.error('生成失败：', (json && json.error) || res.status);
      process.exitCode = 1;
      return;
    }

    const d = json.data || {};
    const s = d.script || {};
    if (d.degraded) {
      console.error('⚠ AI 这次没生成成功，落到了「按讲义原文朗读」的兜底稿，未写缓存。请稍后重试。');
      process.exitCode = 1;
      return;
    }

    console.log('\n完成。讲稿结构：');
    console.log('  导入：', s.intro && s.intro.hook);
    console.log('  目标：', (s.objectives || []).join(' / '));
    (s.points || []).forEach((p, i) => console.log(`  要点${i + 1}：${p.title}  —— ${p.key}`));
    console.log('  易错：', (s.pitfalls || []).map((p) => p.what).join('；'));
    console.log('  考点：', s.exam);
    console.log('  口诀：', s.mnemonic);
    console.log('  随堂问：', (s.quiz || []).map((q) => q.q).join(' / ') || '（无）');
    console.log(`\n重点设置：${body.focus ? '已保存 ' + body.focus.length + ' 字' : '已清除（恢复按讲义平均讲）'}`);
    console.log('学生端刷新即读到新讲稿（全校共用同一份，不会各自重新生成）。');
  } finally {
    if (sessionId) {
      try { await conn.query('DELETE FROM login_sessions WHERE id = ?', [sessionId]); } catch (e) { /* ignore */ }
    }
    await conn.end();
  }
})();
