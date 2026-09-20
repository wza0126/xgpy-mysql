/**
 * 生成聚类分布报告（供教师抽查）
 * 输出：docs/cluster-report.md
 */
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const { CHAPTER_TAXONOMY, SECTION_PATHS, CHAPTER_NAMES, CHAPTER_ALLOW_SELF } = require('../../src/chapter-taxonomy');

(async () => {
  const c = await mysql.createConnection({ host: '127.0.0.1', port: 3306, user: 'root', password: '122201', database: 'xgpy' });
  const q = async (sql, p = []) => (await c.query(sql, p))[0];

  const tot = (await q("SELECT COUNT(*) n FROM questions"))[0];
  const st = await q("SELECT cluster_status, COUNT(*) n FROM questions GROUP BY cluster_status");
  const src = await q("SELECT cluster_source, COUNT(*) n FROM questions GROUP BY cluster_source");
  const rows = await q("SELECT cluster_id, COUNT(*) n FROM questions WHERE cluster_id IS NOT NULL AND cluster_id<>'' GROUP BY cluster_id");
  const map = new Map(rows.map(r => [r.cluster_id, Number(r.n)]));
  const secSet = new Set(SECTION_PATHS), chSet = new Set(CHAPTER_NAMES);

  // 每个小节的题量 + 抽样题目
  const secSentence = async (cid, limit = 2) => {
    const rs = await q(
      'SELECT content FROM questions WHERE cluster_id = ? ORDER BY RAND() LIMIT ?',
      [cid, limit]
    );
    return rs.map(r => String(r.content || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 60));
  };

  const L = [];
  L.push('# 题库聚类分布报告');
  L.push('');
  L.push(`生成时间：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`);
  L.push('');
  L.push('## 总览');
  L.push('');
  L.push(`- 题目总数：**${tot.n}**`);
  L.push(`- 已聚类：**${st.find(s => s.cluster_status === 'done')?.n || 0}**（${st.map(s => s.cluster_status + '=' + s.n).join('，')}）`);
  L.push(`- 分类来源：${src.map(s => s.cluster_source + '=' + s.n).join('，')}`);
  const inVocab = rows.filter(r => r.cluster_id !== '其他' && (secSet.has(r.cluster_id) || (chSet.has(r.cluster_id) && CHAPTER_ALLOW_SELF[r.cluster_id])));
  L.push(`- 使用中的分类数：**${inVocab.length}**（词表外：${rows.length - inVocab.length}）`);
  L.push(`- 词表覆盖：**${SECTION_PATHS.filter(sp => map.has(sp)).length}/${SECTION_PATHS.length}** 个小节有题`);
  L.push('');
  L.push('> 说明：分类为「章/小节」两级。标 ★ 的章支持「整章」兜底（题库有题但讲义未细分的考点）。');
  L.push('');

  L.push('## 章 / 小节题量明细');
  L.push('');

  for (const part of CHAPTER_TAXONOMY) {
    L.push(`### ${part.group}`);
    L.push('');
    L.push('| 章 | 小节 | 题量 | 抽样题目 |');
    L.push('|---|---|---:|---|');
    let partTotal = 0;
    for (const ch of part.chapters) {
      const selfCnt = map.get(ch.name) || 0;   // 章级兜底
      const chTotal = selfCnt + ch.sections.reduce((s, sec) => s + (map.get(`${ch.name}/${sec}`) || 0), 0);
      partTotal += chTotal;
      const star = ch.allowChapter ? ' ★' : '';
      let firstRow = true;
      for (const sec of ch.sections) {
        const cid = `${ch.name}/${sec}`;
        const n = map.get(cid) || 0;
        let sample = '';
        if (n > 0) {
          const ss = await secSentence(cid, 1);
          sample = ss[0] ? ss[0].replace(/\|/g, '\\|') : '';
        }
        L.push(`| ${firstRow ? `**${ch.code} ${ch.name}**${star}` : ''} | ${sec} | ${n} | ${sample} |`);
        firstRow = false;
      }
      if (ch.allowChapter) {
        const ss = selfCnt > 0 ? (await secSentence(ch.name, 1))[0] || '' : '';
        L.push(`| | _（整章兜底）_ | **${selfCnt}** | ${ss.replace(/\|/g, '\\|')} |`);
      }
      L.push(`| | _小计_ | **${chTotal}** | |`);
    }
    L.push(`| | **本部分合计** | **${partTotal}** | |`);
    L.push('');
  }

  const other = map.get('其他') || 0;
  if (other > 0) {
    L.push(`**其他（无法归类）**：${other} 题`);
    L.push('');
  }

  L.push('## 合计');
  L.push('');
  L.push(`全部 16 章合计 ${[...map.entries()].filter(([k]) => k !== '其他').reduce((s, [, v]) => s + v, 0)} 题` +
    (other ? `，另有「其他」${other} 题` : '') + '。');
  L.push('');

  const out = path.resolve(__dirname, '../../../docs/cluster-report.md');
  fs.writeFileSync(out, L.join('\n'), 'utf8');
  console.log('报告已生成:', out);
  console.log(`  题量合计 ${[...map.values()].reduce((a, b) => a + b, 0)}，分类数 ${rows.length}`);
  await c.end();
})().catch(e => { console.error('ERR', e.message, e.stack); process.exit(1); });
