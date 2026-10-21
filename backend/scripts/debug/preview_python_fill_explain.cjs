#!/usr/bin/env node
/**
 * preview_python_fill_explain.cjs
 * ============================================================
 * 「AI 语音讲解能不能讲编程填空题」的可行性实测（2026-10-21）。
 *
 * 现状：讲解只认 questions 表（wrong_questions JOIN questions），
 *      编程填空题在 python_tasks / python_gradings 里，两条链路完全没打通。
 * 本脚本不改库、不接接口，只用**真实题目 + 真实学生错法**跑一遍模型，
 * 看生成质量能不能达到投屏标准，据此判断值不值得正式接。
 *
 * 用法：cd backend && node scripts/debug/preview_python_fill_explain.cjs [styleKey]
 * 前置：system_config 里已配 ai_api_base_url / ai_api_key。
 */

const path = require('path');
process.env.NODE_ENV = process.env.NODE_ENV || 'development';
require('../../src/env');

const pool = require('../../src/db');
const { buildSystemPrompt, getStyle } = require('../../src/explain-styles');

// 三道真实填空题 + 模拟的「后进生错法」（贴着他会犯的错：概念混、少一步取位）
const CASES = [
  {
    title: '第01题 求圆的周长和面积',
    student: { '1': '3.14*r*2', '2': '3.14*r*2', '3': 'c' }, // ②把周长当面积、③输出变量错
  },
  {
    title: '第02题 求圆周长和面积',
    student: { '1': 'int', '2': 'r', '3': 'c' }, // ①拿 int 截断、③又写成 c
  },
  {
    title: '第03题 反转四位数',
    student: { '1': 'n//100', '2': 'n//10', '3': 'a+b+c+d' }, // ①少除一位、②没取余、③还是顺序相加
  },
];

// ⛔ 编程题讲解的**新增**难点：答案里全是代码，TTS 直接念会变成一串乱码。
// 这段规则是接入前必须补的（选择题/文字填空题用不上）。
const CODE_SPEAK_RULES = `【代码念法，必须遵守】
1. 运算符一律念中文：// 念「整除」，% 念「取余」，** 念「的几次方」，* 念「乘」，/ 念「除以」，+ 念「加」。
2. 函数调用念成「函数名 括号 参数 括号」，例如 range(1, 11) 念「range 括号 1 到 11 括号」。
3. 变量名按字面念，例如 n 念「n」，s 念「s」，list1 念「list1」。
4. 不要念引号、括号的英文读法、空格、注释符号。
5. 一句里最多念一个表达式；表达式长就拆成两句，先念「这一空填」再念「也就是」。
6. 第几空一律念中文数字：念「第一空」「第二空」，不要念「①」「②」这种符号。

【结构补充（编程填空专用）】
- 本题没有 A B C D 选项，禁止生成 compare 场景，禁止出现 options 字段。
- 只允许 point 和 memory 两种场景。
- 只讲做错的那几空，做对的空一句话带过。`;

const CASE_PROMPT = `【题目】{desc}

【程序模板（① ② ③ 是要填的空）】
{template}

【每空的正确答案（任一即可）】
{answers}

【这个学生实际填的】
{student}

【任务】只讲学生做错的那几空：先直接说这一空该填什么，再用大白话讲为什么。做对的空一句带过，不要重复讲。`;

function fmtAnswers(task) {
  const arr = typeof task.blank_answers === 'string' ? JSON.parse(task.blank_answers) : task.blank_answers;
  return arr.map((alts, i) => `第${'①②③④⑤⑥'[i]}空：${alts.slice(0, 3).join(' / ')}`).join('\n');
}

function fmtStudent(task, student) {
  const arr = typeof task.blank_answers === 'string' ? JSON.parse(task.blank_answers) : task.blank_answers;
  return Object.entries(student).map(([k, v]) => {
    const idx = Number(k) - 1;
    const alts = arr[idx] || [];
    const ok = alts.some((a) => String(a).replace(/\s+/g, '') === String(v).replace(/\s+/g, ''));
    return `第${'①②③④⑤⑥'[idx]}空：${v}（${ok ? '对' : '错'}，正确答案是 ${alts[0]}）`;
  }).join('\n');
}

async function readAiConfig() {
  const [rows] = await pool.query("SELECT config_key, value FROM system_config WHERE config_key LIKE 'ai_%'");
  const map = {};
  for (const r of rows) {
    let v = r.value;
    if (typeof v === 'string') { try { const p = JSON.parse(v); v = p && typeof p === 'object' && 'value' in p ? p.value : p; } catch { /* 原样 */ } }
    map[r.config_key] = v;
  }
  const [tasks] = await pool.query(
    "SELECT id, title, description, blank_template, blank_answers FROM python_tasks WHERE task_type = 'fill_blank'",
  );
  return { ai: map, tasks };
}

async function callModel(ai, styleKey) {
  const style = (await getStyle(pool, styleKey)) || { style_key: styleKey, max_chars: 260 };
  const systemPrompt = buildSystemPrompt(style);
  const apiUrl = `${String(ai.ai_api_base_url || '').replace(/\/+$/, '')}/chat/completions`;
  if (!apiUrl.startsWith('http')) throw new Error('未配置 ai_api_base_url');
  return { apiUrl, systemPrompt, style };
}

(async () => {
  const styleKey = process.argv[2] || 'chat';
  const { ai, tasks } = await readAiConfig();
  const { apiUrl, systemPrompt, style } = await callModel(ai, styleKey);
  console.log(`模型：${ai.ai_model} / 风格：${styleKey}（约 ${style.max_chars} 字）\n`);

  for (const cs of CASES) {
    const task = tasks.find((t) => t.title === cs.title);
    if (!task) { console.log(`跳过（库里找不到）：${cs.title}`); continue; }
    const userPrompt = [
      CASE_PROMPT
        .replace('{desc}', String(task.description || ''))
        .replace('{template}', String(task.blank_template || ''))
        .replace('{answers}', fmtAnswers(task))
        .replace('{student}', fmtStudent(task, cs.student)),
      CODE_SPEAK_RULES,
    ].join('\n\n');

    const t0 = Date.now();
    let j = null;
    let raw = '';
    let finish = '';
    // 空响应 / 截断都实测出现过（3 题里挂 2 题）→ 失败重试一次，并把 finish_reason 打出来定位
    for (let attempt = 1; attempt <= 2; attempt++) {
      const r = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ai.ai_api_key}` },
        body: JSON.stringify({
          model: ai.ai_model,
          temperature: Number(ai.ai_temperature ?? 0.7),
          max_tokens: 2200,
          messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
        }),
      });
      j = await r.json().catch(() => null);
      raw = j?.choices?.[0]?.message?.content || '';
      finish = j?.choices?.[0]?.finish_reason || '';
      if (raw.trim() && finish !== 'length') break;
      console.log(`  （第 ${attempt} 次返回为空或被截断，finish_reason=${finish || '空'}，重试）`);
    }
    const ms = Date.now() - t0;
    console.log('═'.repeat(70));
    console.log(`【${cs.title}】${ms}ms，原始 ${raw.length} 字，finish_reason=${finish || '空'}`);
    let obj = null;
    try {
      const m = raw.match(/\{[\s\S]*\}/);
      obj = JSON.parse(m ? m[0] : raw);
    } catch { /* 解析失败 */ }
    if (!obj) { console.log('❌ JSON 解析失败，原文：\n' + raw.slice(0, 600)); continue; }
    console.log(`知识点：${obj.topic || '（空）'}   场景数：${(obj.scenes || []).length}`);
    let total = 0;
    for (const s of obj.scenes || []) {
      const txt = String(s.narration || '');
      total += txt.length;
      console.log(`  · [${s.kind}] ${s.title}：${txt}`);
      for (const b of s.bullets || []) console.log(`      - ${b}`);
      if (s.kind === 'compare') console.log(`      ⚠️ 出现了 compare 场景（填空题不该有）`);
    }
    console.log(`朗读字数合计：${total}（风格上限 ${style.max_chars}）${total > style.max_chars * 1.6 ? '  ⚠️ 明显超长' : ''}`);
  }
  // ⛔ 不关 pool 进程会一直挂着（命令行会以为还没跑完）
  await pool.end();
})().catch(async (e) => { console.error('失败：', e.message); try { await pool.end(); } catch { /* ignore */ } process.exit(1); });
