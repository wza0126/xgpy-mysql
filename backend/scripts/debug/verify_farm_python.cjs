'use strict';
/**
 * 前端「代码农场」Python 子集解释器回归测试
 *
 * 做法：先把 frontend/src/utils/farmPython.ts 编译成 CommonJS（用仓库自带的 tsc），
 *      再 require 编译产物跑断言。编译产物写到系统临时目录，跑完即删。
 *
 * 覆盖：词法/语法/求值、中文别名、本地镜像语义、劳作计费口径、预算拦截、错误提示。
 * 用法：cd backend && node scripts/debug/verify_farm_python.cjs
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../../..');
const FRONTEND = path.join(ROOT, 'frontend');
const SRC = path.join(FRONTEND, 'src/utils/farmPython.ts');

let pass = 0;
let fail = 0;
function ok(name, cond, extra) {
  if (cond) {
    pass++;
    console.log('  ✓ ' + name + (extra !== undefined ? '  [' + extra + ']' : ''));
  } else {
    fail++;
    console.log('  ✗ ' + name + (extra !== undefined ? '  [' + extra + ']' : ''));
  }
}
function section(t) {
  console.log('\n=== ' + t + ' ===');
}

// ---------- 编译 ----------
let outDir = null;
let runFarmCode = null;
try {
  outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'farmpy-'));
  execFileSync(
    process.execPath,
    [
      path.join(FRONTEND, 'node_modules/typescript/bin/tsc'),
      'src/utils/farmPython.ts',
      '--target', 'es2020',
      '--module', 'commonjs',
      '--lib', 'es2020,dom',
      '--outDir', outDir,
    ],
    { cwd: FRONTEND, stdio: 'pipe' }
  );
  runFarmCode = require(path.join(outDir, 'farmPython.js')).runFarmCode;
  console.log('解释器编译成功 → ' + outDir);
} catch (e) {
  console.error('编译失败：' + (e.stdout ? e.stdout.toString() : '') + (e.message || e));
  process.exit(1);
}

// ---------- 辅助 ----------
function base(over) {
  return Object.assign(
    { crop: null, growth: 0, moisture: 50, nutrient: 50, stage: 0, opsLeft: 20, day: 1, weather: 'sunny' },
    over || {}
  );
}
function run(code, over) {
  return runFarmCode(code, base(over));
}
function last(r) {
  return r.prints[r.prints.length - 1];
}

// ============================================================

section('A. 基础：变量与 print');
let r = run('x = 3\nprint("x =", x)');
ok('变量赋值 + print', r.prints.length === 1 && r.prints[0] === 'x = 3', JSON.stringify(r.prints));
ok('无错误', r.error === null, r.error);

r = run('print(2**3, 7//2, 7%2)\nprint(1.5 + 1)');
ok('幂/整除/取模/浮点', r.prints[0] === '8 3 1' && r.prints[1] === '2.5', JSON.stringify(r.prints));

r = run('a = 5\na += 2\na *= 3\nprint(a)');
ok('累加赋值 += *=', r.prints[0] === '21', JSON.stringify(r.prints));

section('B. 循环');
r = run('plant("wheat")\nfor i in range(3):\n    water()');
ok('for + range(3) 生成 3 次浇水', r.ops.length === 4 && r.ops.filter((o) => o.op === 'water').length === 3, JSON.stringify(r.ops));
ok('播种在最前', r.ops[0].op === 'plant' && r.ops[0].crop === 'wheat');

r = run('for i in range(1, 4):\n    water(1)');
ok('range(1,4) 三次', r.ops.length === 3, JSON.stringify(r.ops));

r = run('for i in range(6, 0, -2):\n    water()');
ok('range 负步长', r.ops.length === 3, JSON.stringify(r.ops));

section('C. 条件分支');
r = run('if moisture() < 80:\n    water(5)\nelse:\n    print("enough")', { moisture: 50 });
ok('if 命中 → 浇水', r.ops.length === 1 && r.ops[0].op === 'water', JSON.stringify(r.ops));
ok('if 命中 → 不走 else', r.prints.length === 0, JSON.stringify(r.prints));

r = run('if moisture() < 20:\n    water(5)\nelse:\n    print("enough")', { moisture: 50 });
ok('条件不命中 → 走 else', r.ops.length === 0 && r.prints[0] === 'enough', JSON.stringify(r.prints));

r = run('n = moisture()\nif n > 30 and n < 70:\n    print("刚刚好")', { moisture: 50 });
ok('and 组合', r.prints[0] === '刚刚好', JSON.stringify(r.prints));

r = run('if crop() == None:\n    plant("corn")', { crop: null });
ok('None 比较 + 播种', r.ops.length === 1 && r.ops[0].crop === 'corn', JSON.stringify(r.ops));

section('D. while（含本地镜像更新）');
r = run('while moisture() < 100:\n    water()', { moisture: 50 });
ok('while 读到浇水后的新水分（50→100 共 5 次）', r.ops.length === 5, 'ops=' + r.ops.length);
ok('本地镜像水分到 100', r.mirror.moisture === 100, 'moisture=' + r.mirror.moisture);
ok('while 浇到满只扣 5 次劳作', r.mirror.opsLeft === 15, r.mirror.opsLeft);

r = run('i = 0\nwhile i < 3:\n    water()\n    i += 1');
ok('while + 计数变量', r.ops.length === 3, 'ops=' + r.ops.length);

r = run('plant("wheat")\nwhile moisture() < 100:\n    water()\nprint(ops_left())', { moisture: 50 });
ok('播种 1 + 浇到满 5 = 扣 6 次，剩 14', last(r) === '14', JSON.stringify(r.prints));
ok('水到 100 就停（不多浇）', r.mirror.moisture === 100 && r.ops.length === 6, 'ops=' + r.ops.length);

section('E. 函数 def / 中文别名 / 查询');
r = run('def 两遍():\n    water(2)\n    water(2)\nplant("wheat")\n两遍()');
ok('def 定义并调用（含中文名）', r.ops.length === 3 && r.ops[1].n === 2, JSON.stringify(r.ops));

r = run('def 浇到满():\n    while moisture() < 100:\n        water()\n浇到满()', { moisture: 88 });
ok('def 内嵌 while', r.ops.length === 1, JSON.stringify(r.ops));

r = run('播种("玉米")\n浇水(2)\nprint(作物())');
ok('全中文 API', r.ops.length === 2 && r.ops[0].crop === 'corn' && r.prints[0] === 'corn', JSON.stringify(r.ops) + ' ' + JSON.stringify(r.prints));

r = run('plant("wheat")\nprint(stage(), growth(), ops_left())', { opsLeft: 3 });
ok('查询函数返回镜像值（播种扣 1 次）', r.prints[0] === '1 0 2', JSON.stringify(r.prints));

r = run('def f(a, b):\n    print(a + b)\nf(2, 3)');
ok('def 带参数', r.prints[0] === '5', JSON.stringify(r.prints));

section('F. 错误处理（要能给学生看懂的中文提示）');
r = run('if moisture() < 50\n    water()');
ok('缺冒号 → 语法错误', /结尾需要/.test(String(r.error)), r.error);
ok('错误带行号', r.errorLine === 1, 'line=' + r.errorLine);

r = run('water(abc)');
ok('未定义变量 → 提示', /还没有赋值/.test(String(r.error)), r.error);

r = run('print(1/0)');
ok('除零 → 提示', /不能除以 0/.test(String(r.error)), r.error);

r = run('water()\n  water()');
ok('缩进不一致 → 提示', /缩进/.test(String(r.error)), r.error);

r = run('for i in range(200):\n    water()', { opsLeft: 500 });
ok('操作数超程序上限 → 提示', /操作太多了/.test(String(r.error)), r.error);

r = run('while True:\n    pass');
ok('死循环被拦下', /跑得太久/.test(String(r.error)), r.error);

r = run('foo(1)');
ok('未知函数 → 提示', /没有名为/.test(String(r.error)), r.error);

r = run('plant("banana")');
ok('无效作物 → 友好提示（不报错）', r.error === null && /没有/.test(r.prints.join(' ')), JSON.stringify(r.prints));

section('G. 边界');
r = run('plant("wheat")\nharvest()', { crop: null });
ok('未成熟收获：本地就拦下，只提交播种那一条', r.ops.length === 1, r.ops.length);
ok('未成熟收获：给出中文提示', /还没成熟/.test(r.prints.join(' ')), JSON.stringify(r.prints));
ok('未成熟收获：不报错', r.error === null, r.error);

r = run('plant("wheat")\nharvest()', { crop: 'wheat', growth: 100, stage: 3 });
ok('成熟收获：镜像清空地块', r.mirror.crop === null && r.mirror.growth === 0);

r = run('harvest()', { crop: 'wheat', growth: 100, stage: 3, opsLeft: 20 });
ok('成熟收获扣 1 次劳作', r.mirror.opsLeft === 19, r.mirror.opsLeft);

r = run('');
ok('空代码不报错', r.error === null && r.ops.length === 0);

r = run('# 只有注释\n\n# 再来一行注释');
ok('纯注释不报错', r.error === null && r.ops.length === 0);

r = run('plant("wheat")\nprint("hello")  # 行尾注释');
ok('行尾注释被忽略', r.error === null && r.prints[0] === 'hello');

r = run('if True:\n\twater()');
ok('Tab 缩进可用', r.ops.length === 1, JSON.stringify(r.ops));

section('H. ⛔ 劳作计费口径（按动作单位，不按提交次数）');
r = run('plant("wheat")\nwater(3)\nprint(ops_left())', { opsLeft: 20 });
ok('播种 1 + 浇水 3 = 扣 4 次', last(r) === '16', JSON.stringify(r.prints));
ok('两条 op 都提交给后端', r.ops.length === 2, r.ops.length);

r = run('plant("wheat")\nwater(10)\nprint(ops_left())', { opsLeft: 20 });
ok('water(10) 扣 10 次（不是 1 次）', last(r) === '9', JSON.stringify(r.prints));

r = run('water(5)', { opsLeft: 20, moisture: 50 });
ok('water(5) 与 5 次 water() 等价：水到 100、扣 5 次', r.mirror.moisture === 100 && r.mirror.opsLeft === 15,
  'm=' + r.mirror.moisture + ' left=' + r.mirror.opsLeft);
ok('water(5) 刚好浇满 → 不提示浪费', !/白花力气/.test(r.prints.join(' ')), JSON.stringify(r.prints));

r = run('water(6)', { opsLeft: 20, moisture: 50 });
ok('water(6) 多出的 1 份白花力气（水只到 100，仍扣 6 次）',
  r.mirror.moisture === 100 && r.mirror.opsLeft === 14, 'm=' + r.mirror.moisture + ' left=' + r.mirror.opsLeft);
ok('water(6) 给出「白花力气」提示', /白花力气/.test(r.prints.join(' ')), JSON.stringify(r.prints));

r = run('water(10)', { opsLeft: 5, moisture: 50 });
ok('预算不够 → 该操作不提交', r.ops.length === 0, r.ops.length);
ok('预算不够 → 给出中文提示', /劳作次数不够/.test(r.prints.join(' ')), JSON.stringify(r.prints));
ok('预算不够 → 不报错', r.error === null, r.error);

r = run('for i in range(10):\n    water()', { opsLeft: 4 });
ok('预算 4 → 只提交 4 条', r.ops.length === 4, r.ops.length);
ok('预算扣到 0', r.mirror.opsLeft === 0, r.mirror.opsLeft);
ok('「次数不够」只提示一次（不刷屏）', r.prints.filter((p) => /劳作次数/.test(p)).length === 1, JSON.stringify(r.prints));

section('I. ★ 除草：单次值钱（+24），但仍撑不起一整块地');
r = run('plant("wheat")\nfor i in range(50):\n    weed()\nharvest()', { opsLeft: 20 });
ok('50 次 weed 只提交 19 条（预算挡下其余）', r.ops.length === 20,
  'ops=' + r.ops.length + '（播种 1 + 除草 19；预算用尽，收获也被拦下）');
ok('★ 水肥 50/50 时每次除草 +6（19 次共 114 → 截到 100）', Math.abs(r.mirror.growth - 100) < 1e-9, r.mirror.growth);

r = run('plant("wheat")\nfor i in range(17):\n    weed()', { opsLeft: 30 });
ok('★ 闷头除草要 17 次才封顶（6 × 17 = 102 → 100）', Math.abs(r.mirror.growth - 100) < 1e-9, r.mirror.growth);
ok('★ 纯除草总耗 18 次劳作（播种 1 + 除草 17），多于搭配写法的 11 次',
  30 - r.mirror.opsLeft === 18 && r.ops.length === 18, 'labor=' + (30 - r.mirror.opsLeft) + ' ops=' + r.ops.length);

r = run('plant("wheat")\nweed()', { moisture: 10, nutrient: 10, opsLeft: 20 });
ok('★ 水肥 10/10 时除草只 +0.24（几乎没用）', Math.abs(r.mirror.growth - 0.24) < 1e-9, r.mirror.growth);
ok('水肥太低时给出提示', /水肥不足/.test(r.prints.join(' ')), JSON.stringify(r.prints));

r = run('plant("wheat")\nweed()', { moisture: 100, nutrient: 100, opsLeft: 20 });
ok('★ 满水满肥时除草 +24（= 1.5 次浇水）', Math.abs(r.mirror.growth - 24) < 1e-9, r.mirror.growth);
ok('水肥充足时不提示', !/水肥不足/.test(r.prints.join(' ')), JSON.stringify(r.prints));

r = run('weed()');
ok('空地除草：不报错，给出提示', r.error === null && /空地/.test(r.prints.join(' ')), JSON.stringify(r.prints));

r = run('plant("wheat")\nprint(moisture())\nweed()\nprint(growth())', { moisture: 50, nutrient: 50 });
ok('weed 之后 growth() 读到新值（6）', last(r) === '6', JSON.stringify(r.prints));

section('J. 吸收口径（每份水/肥各吸收一次）');
r = run('plant("wheat")\nwater(5)', { moisture: 50, nutrient: 50 });
ok('water(5)：水分 50→100，成长 = 16×0.5×(0.62+0.74+0.86+0.98+1.00) = 33.6',
  Math.abs(r.mirror.growth - 33.6) < 0.01, r.mirror.growth.toFixed(2));

r = run('plant("wheat")\nfertilize(5)', { moisture: 50, nutrient: 50 });
ok('fertilize(5)：养分 50→100，成长同样 33.6',
  Math.abs(r.mirror.growth - 33.6) < 0.01, r.mirror.growth.toFixed(2));

r = run('plant("wheat")\nwhile moisture() < 100:\n    water()\nwhile nutrient() < 100:\n    fertilize()', { moisture: 50, nutrient: 50 });
ok('水肥各浇到满：成长 33.6 + 67.2 = 100.8 → 截到 100（成熟）',
  Math.abs(r.mirror.growth - 100) < 1e-9, r.mirror.growth.toFixed(2));
ok('恰好用掉 11 次劳作（播种 1 + 水 5 + 肥 5）', r.mirror.opsLeft === 9 && r.ops.length === 11,
  'left=' + r.mirror.opsLeft + ' ops=' + r.ops.length);

r = run('plant("wheat")\nwater(3)', { moisture: 50, nutrient: 50, weather: 'drought' });
ok('旱天吸收打 6 折（成长 = 33.6 中前 3 份 × 0.6）',
  Math.abs(r.mirror.growth - (16 * 0.6 * (0.62 + 0.74 + 0.86) * 0.5)) < 0.01, r.mirror.growth.toFixed(2));

console.log('\n========================================');
console.log((fail === 0 ? '全部通过' : '有失败项') + '：' + pass + ' / ' + (pass + fail));
console.log('========================================');

try {
  fs.rmSync(outDir, { recursive: true, force: true });
} catch (_) {
  /* ignore */
}
process.exit(fail === 0 ? 0 : 1);
