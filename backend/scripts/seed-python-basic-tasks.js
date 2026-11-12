'use strict';
/**
 * 写入「Python 基础 12 题」（2026-11-12，吴老要求）。
 *
 * 背景：原来的 11 道 code 题是手工编的，题干不够明确、难度跨度大，学生不好上手。
 * 这套按学习顺序重编：输出 → 变量 → 运算 → 类型转换 → 分支 → 循环 → 列表 → 函数，
 * 每题都给出「确定的期望输出」，判分才能稳定（AI 判分为主、规则引擎兜底）。
 *
 * 用法：
 *   node scripts/seed-python-basic-tasks.js --verify   只跑标准答案、核对输出，不写库
 *   node scripts/seed-python-basic-tasks.js --apply    备份 → 写 12 题 → 停用旧 11 题
 *   node scripts/seed-python-basic-tasks.js --apply --keep-old   写新题但不停用旧题
 *
 * ⛔ 旧题一律 is_active=0（软删除），不物理删除：
 *    历史 python_submissions / python_gradings 还挂在上面，删了会留下孤儿数据。
 */

const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const DB = {
  host: '127.0.0.1',
  user: 'root',
  password: '122201',
  database: 'xgpy',
};

const SCORE = 10; // 每题 10 分，12 题共 120 分

/** 12 道题：id 固定可读，便于以后单独改某一题 */
const TASKS = [
  {
    id: 'pybase01',
    title: '第01题.输出一句话',
    description:
      '用 print() 在屏幕上输出一句话：\n\n' +
      '你好，Python！\n\n' +
      '注意：\n' +
      '1. 引号要用英文的双引号 " ，不要用中文的 “”；\n' +
      '2. 括号也要用英文的 () 。',
    reference_code: 'print("你好，Python！")',
    expected_output: '你好，Python！',
    hint: 'print("要输出的内容")，引号和括号都必须是英文的',
    required_keywords: ['print'],
  },
  {
    id: 'pybase02',
    title: '第02题.分两行输出',
    description:
      '用两条 print() 语句，分两行输出：\n\n' +
      '第一行：我叫小明\n' +
      '第二行：我学Python\n\n' +
      '提示：每次 print() 执行完会自动换行，所以写两条就自动分成两行。',
    reference_code: 'print("我叫小明")\nprint("我学Python")',
    expected_output: '我叫小明\n我学Python',
    hint: '写两条 print()，一条输出一行',
    required_keywords: ['print'],
  },
  {
    id: 'pybase03',
    title: '第03题.用变量拼接',
    description:
      '先定义两个变量：\n\n' +
      'name = "张三"\n' +
      'city = "南京"\n\n' +
      '然后用一条 print() 输出：张三来自南京\n\n' +
      '要求：必须用这两个变量拼出来，不能直接把整句话写死在 print 里。',
    reference_code: 'name = "张三"\ncity = "南京"\nprint(name + "来自" + city)',
    expected_output: '张三来自南京',
    hint: '用 + 号把字符串接起来，例如 name + "来自"',
    required_keywords: ['name', 'city', 'print'],
  },
  {
    id: 'pybase04',
    title: '第04题.四则运算',
    description:
      '先定义两个变量：\n\n' +
      'a = 12\n' +
      'b = 5\n\n' +
      '然后分 4 行输出（每行一个结果）：\n' +
      '第1行：a 与 b 的和\n' +
      '第2行：a 与 b 的差（a - b）\n' +
      '第3行：a 与 b 的积\n' +
      '第4行：a 与 b 的商（用 / ）',
    reference_code: 'a = 12\nb = 5\nprint(a + b)\nprint(a - b)\nprint(a * b)\nprint(a / b)',
    expected_output: '17\n7\n60\n2.4',
    hint: '加 +、减 -、乘 *、除 /，每个结果单独 print 一次',
    required_keywords: ['print', '+', '-', '*', '/'],
  },
  {
    id: 'pybase05',
    title: '第05题.字符串转整数',
    description:
      '变量 s = "100"，它现在是一个**字符串**。\n\n' +
      '请把它转换成整数，加 1 之后输出结果。\n\n' +
      '预期输出：101\n\n' +
      '提示：用 int(s) 可以把字符串转成整数。',
    reference_code: 's = "100"\nprint(int(s) + 1)',
    expected_output: '101',
    hint: 'int(s) 把字符串 "100" 变成整数 100',
    required_keywords: ['int', 'print'],
  },
  {
    id: 'pybase06',
    title: '第06题.if 单分支',
    description:
      '变量 score = 75。\n\n' +
      '如果 score 大于等于 60，就输出：及格\n' +
      '（小于 60 时什么都不用输出）\n\n' +
      '注意 if 语句下面的那一行要缩进 4 个空格。',
    reference_code: 'score = 75\nif score >= 60:\n    print("及格")',
    expected_output: '及格',
    hint: 'if 条件后面要有英文冒号 : ，下一行缩进 4 个空格',
    required_keywords: ['if', 'print'],
  },
  {
    id: 'pybase07',
    title: '第07题.if-else 双分支',
    description:
      '变量 n = 7。\n\n' +
      '如果 n 除以 2 的余数等于 0，输出：偶数\n' +
      '否则输出：奇数\n\n' +
      '预期输出：奇数\n\n' +
      '提示：% 是求余数的运算符。',
    reference_code: 'n = 7\nif n % 2 == 0:\n    print("偶数")\nelse:\n    print("奇数")',
    expected_output: '奇数',
    hint: 'n % 2 得到余数，== 判断是否相等',
    required_keywords: ['if', 'else', 'print'],
  },
  {
    id: 'pybase08',
    title: '第08题.for 循环输出',
    description:
      '用 for 循环，把 1 到 5 这 5 个数字分行输出：\n\n' +
      '1\n2\n3\n4\n5\n\n' +
      '提示：range(1, 6) 产生的数字是 1、2、3、4、5（**不包括 6**）。',
    reference_code: 'for i in range(1, 6):\n    print(i)',
    expected_output: '1\n2\n3\n4\n5',
    hint: 'range(1, 6) 从 1 到 5，右边的数取不到',
    required_keywords: ['for', 'range', 'print'],
  },
  {
    id: 'pybase09',
    title: '第09题.for 循环累加',
    description:
      '用 for 循环求 1 + 2 + 3 + … + 100 的和，并输出结果。\n\n' +
      '预期输出：5050\n\n' +
      '提示：先准备一个变量 total = 0，每轮把数字加到它上面。',
    reference_code: 'total = 0\nfor i in range(1, 101):\n    total = total + i\nprint(total)',
    expected_output: '5050',
    hint: 'total = total + i 就是「累加」，注意缩进在循环里面',
    required_keywords: ['for', 'range', 'print'],
  },
  {
    id: 'pybase10',
    title: '第10题.while 循环',
    description:
      '用 while 循环，把 1 到 5 分行输出：\n\n' +
      '1\n2\n3\n4\n5\n\n' +
      '要求：这题不能用 for，必须用 while。\n\n' +
      '提示：需要一个变量从 1 开始，每轮输出后加 1，否则会变成死循环。',
    reference_code: 'i = 1\nwhile i <= 5:\n    print(i)\n    i = i + 1',
    expected_output: '1\n2\n3\n4\n5',
    hint: '循环体里一定要有 i = i + 1，不然程序永远停不下来',
    required_keywords: ['while', 'print'],
  },
  {
    id: 'pybase11',
    title: '第11题.列表取元素',
    description:
      '定义列表：\n\n' +
      'scores = [85, 92, 78, 90]\n\n' +
      '输出列表的第一个元素和最后一个元素，各占一行。\n\n' +
      '预期输出：\n85\n90\n\n' +
      '提示：列表下标从 0 开始，最后一个元素可以用 -1 取。',
    reference_code: 'scores = [85, 92, 78, 90]\nprint(scores[0])\nprint(scores[-1])',
    expected_output: '85\n90',
    hint: 'scores[0] 是第一个，scores[-1] 是最后一个',
    required_keywords: ['scores', 'print'],
  },
  {
    id: 'pybase12',
    title: '第12题.自定义函数',
    description:
      '定义一个函数 add(a, b)，用来返回 a 与 b 的和。\n\n' +
      '然后调用它计算 33 + 55，并把结果输出。\n\n' +
      '预期输出：88\n\n' +
      '提示：函数用 def 定义，用 return 把结果交回去。',
    reference_code: 'def add(a, b):\n    return a + b\n\nprint(add(33, 55))',
    expected_output: '88',
    hint: 'def add(a, b): 下面缩进写 return a + b',
    required_keywords: ['def', 'return', 'print'],
  },
];

/** 跑一遍标准答案，核对输出是否与 expected_output 完全一致 */
function verify() {
  const tmp = path.join(require('os').tmpdir(), `pycheck_${Date.now()}.py`);
  let bad = 0;
  for (const t of TASKS) {
    fs.writeFileSync(tmp, t.reference_code, 'utf8');
    let out = '';
    try {
      out = execFileSync('python', [tmp], { encoding: 'utf8', timeout: 10000 });
    } catch (e) {
      out = `<<执行失败: ${e.message}>>`;
    }
    const got = out.replace(/\r\n/g, '\n').replace(/\n+$/, '');
    const want = t.expected_output.replace(/\r\n/g, '\n').replace(/\n+$/, '');
    if (got !== want) {
      bad += 1;
      console.log(`✗ ${t.title}`);
      console.log(`    期望: ${JSON.stringify(want)}`);
      console.log(`    实际: ${JSON.stringify(got)}`);
    } else {
      console.log(`✓ ${t.title}  →  ${JSON.stringify(got)}`);
    }
  }
  try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  console.log(bad === 0 ? '\n全部通过' : `\n有 ${bad} 题不一致`);
  return bad === 0;
}

async function apply(keepOld) {
  const conn = await mysql.createConnection(DB);
  try {
    // ① 备份现有 code 题（含参考答案，别丢）
    const [oldRows] = await conn.query(
      "SELECT * FROM python_tasks WHERE task_type = 'code' ORDER BY title"
    );
    const backupDir = 'C:/wza/xgpydev/backup';
    fs.mkdirSync(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const backupFile = path.join(backupDir, `python_code_tasks_${stamp}.json`);
    fs.writeFileSync(backupFile, JSON.stringify(oldRows, null, 2), 'utf8');
    console.log(`已备份 ${oldRows.length} 道旧题 → ${backupFile}`);

    // ② 新题沿用旧题的班级范围与创建人（保持发布口径一致）
    const sample = oldRows[0] || {};
    const classIds = sample.class_ids || null;
    const createdBy = sample.created_by || null;
    console.log(`班级范围: ${classIds || '(全部班级)'}`);

    // ③ 写入 12 题（已存在则更新，可重复执行）
    for (const t of TASKS) {
      await conn.query(
        `INSERT INTO python_tasks
           (id, title, description, task_type, category, class_ids, total_score,
            deadline, allow_late_submission, allow_run_code, max_run_seconds,
            reference_code, expected_output, hint, required_keywords, is_active, created_by)
         VALUES (?, ?, ?, 'code', NULL, ?, ?, NULL, 0, 1, 3, ?, ?, ?, ?, 1, ?)
         ON DUPLICATE KEY UPDATE
           title = VALUES(title), description = VALUES(description),
           class_ids = VALUES(class_ids), total_score = VALUES(total_score),
           reference_code = VALUES(reference_code), expected_output = VALUES(expected_output),
           hint = VALUES(hint), required_keywords = VALUES(required_keywords),
           allow_run_code = 1, max_run_seconds = 3, is_active = 1`,
        [
          t.id, t.title, t.description, classIds, SCORE,
          t.reference_code, t.expected_output, t.hint,
          JSON.stringify(t.required_keywords), createdBy,
        ]
      );
      console.log(`  写入 ${t.title}`);
    }

    // ④ 停用旧题（软删除）
    if (!keepOld) {
      const oldIds = oldRows.map((r) => r.id).filter((id) => !id.startsWith('pybase'));
      if (oldIds.length) {
        const [r] = await conn.query(
          'UPDATE python_tasks SET is_active = 0 WHERE id IN (?)', [oldIds]
        );
        console.log(`\n已停用旧题 ${r.affectedRows} 道（is_active=0，数据保留可回滚）`);
      }
    }

    // ⑤ 结果
    const [[cnt]] = await conn.query(
      "SELECT COUNT(*) n, SUM(total_score) s FROM python_tasks WHERE task_type='code' AND is_active=1"
    );
    console.log(`\n当前启用的完整编程题: ${cnt.n} 道，合计 ${cnt.s} 分`);
  } finally {
    await conn.end();
  }
}

(async () => {
  const argv = process.argv.slice(2);
  if (argv.includes('--verify')) {
    process.exit(verify() ? 0 : 1);
  }
  if (argv.includes('--apply')) {
    if (!verify()) {
      console.error('\n标准答案与实际输出不一致，已中止写库');
      process.exit(1);
    }
    await apply(argv.includes('--keep-old'));
    return;
  }
  console.log('用法：--verify 只校验 / --apply 写库');
})();
