/**
 * 一次性数据修正：83 道编程填空题的 7 处问题（2026-11-01，吴老确认）
 *
 * 每条改动都先比对「期望的旧值」，对不上就整条跳过并报错，
 * 避免模板被之后改过时把内容写坏。
 *
 * 用法：cd backend && node scripts/fix-python-fillblank.js [--apply]
 *   不带 --apply 只打印将要做的修改（dry run）。
 */
const mysql = require('mysql2/promise');

const APPLY = process.argv.includes('--apply');

/** 每条：按 title 精确定位，校验旧值，替换成新值 */
const FIXES = [
  {
    no: 63,
    title: '第63题.判断闰年（一）',
    field: 'blank_answers',
    why: '答案被逗号拆成两个备选，学生填 (2000, 3001) 判错',
    expect: '[["(2000","3001)"],',
    apply: (v) => v.replace('[["(2000","3001)"],', '[["(2000, 3001)","(2000,3001)"],'),
  },
  {
    no: 50,
    title: '第50题.判断能否构成直角三角形',
    field: 'blank_template',
    why: '缺输入语句，运行报 NameError（描述里已给出这一行）',
    expect: 'if x<y:',
    apply: () => 'x,y,z=map(float,input().split())   #输入三角形三条边的长度x,y,z，输入空格键区分各边长\n' +
      'if x<y:\n' +
      '    ①                        #x和y的数值进行交换\n' +
      'if x<z:\n' +
      '    ②                        #以上四行的目的是将最大值放入变量x中\n' +
      'if x**2==y**2+z**2:\n' +
      '    print(x,y,z,"能够构成直角三角形。")\n' +
      '③\n' +
      '    print(x,y,z,"不能构成直角三角形。")',
  },
  {
    no: 72,
    title: '第72题.求π的近似值3',
    field: 'blank_template',
    why: '缺初始化，while b<1000 直接报错（描述里已给出这一行）',
    expect: 'while b<1000:',
    apply: () => 'sum,a,b,t=0.0,1,1.0,1.0   #给各参数依次赋值\n' +
      'while b<1000:\n' +
      '    sum=sum+①\n' +
      '    b=②\n' +
      '    a=③\n' +
      '    t=a/b\n' +
      'pi =④\n' +
      'print("pi的值是{:.20f}".format(pi))  # 输出20位浮点型数值',
  },
  {
    no: 59,
    title: '第59题.模拟核酸',
    field: 'blank_template',
    why: '有一行裸文本缺 #，运行报 NameError',
    expect: '用编号表示各个小区居民',
    apply: (v) => v.replace(/(^|\n)用编号表示各个小区居民/, '$1# 用编号表示各个小区居民'),
  },
  {
    no: 21,
    title: '第21题.水仙花数（二）',
    field: 'blank_answers',
    why: '第 2 空备选 10//10 等于 1（x//1 不是百位），是坏备选',
    expect: '[["1000"],["100","10//10"],["100%10","10"]]',
    apply: () => '[["1000"],["100"],["10","100%10"]]',
  },
  {
    no: 3,
    title: '第03题.反转四位数',
    field: 'blank_answers',
    why: '两个备选含 +*10 语法错误',
    expect: 'd*1000+c*100+*10*b+a',
    apply: (v) => {
      const arr = JSON.parse(v);
      arr[2] = arr[2].filter((a) => !String(a).includes('+*10'));
      return JSON.stringify(arr);
    },
  },
  {
    no: 51,
    title: '第51题.求解分段函数',
    field: 'blank_answers',
    why: '4 个备选被逗号拆成半截（pow( ），另 1 个 3and 缺空格；与第63题同类的数据损坏',
    expect: '"pow(x-3"',
    apply: (v) => {
      const arr = JSON.parse(v);
      arr[1] = arr[1].filter((a) => !String(a).includes('3and'));
      arr[2] = ['(x-3)**0.5', '(x-3)**(1/2)', 'pow(x-3,0.5)', 'pow(x-3,1/2)'];
      arr[3] = ['2**(x-3)', 'pow(2,x-3)'];
      return JSON.stringify(arr);
    },
  },
  {
    no: 82,
    title: '第82题.辗转相除自定义函数求最大公约数',
    field: 'blank_template',
    why: '模板末尾残留「参考答案」四个字',
    expect: 'print(\'最大公约数是:\',③(a,b))',
    apply: (v) => v.replace(/\s*参考答案\s*$/, '').replace(/\s+$/, ''),
  },
];

(async () => {
  const conn = await mysql.createConnection({
    host: '127.0.0.1', user: 'root', password: '122201', database: 'xgpy', charset: 'utf8mb4',
  });

  let ok = 0, skip = 0;
  for (const f of FIXES) {
    const [rows] = await conn.query(
      'SELECT id, blank_template, blank_answers FROM python_tasks WHERE title = ? LIMIT 1',
      [f.title]
    );
    if (!rows.length) {
      console.log(`✗ 第${f.no}题：数据库里找不到「${f.title}」`);
      skip++; continue;
    }
    const row = rows[0];
    const oldVal = row[f.field] || '';
    if (!oldVal.includes(f.expect)) {
      console.log(`✗ 第${f.no}题（${f.field}）：旧值与预期不符，跳过。`);
      console.log(`   预期包含：${JSON.stringify(f.expect)}`);
      console.log(`   实际内容：${JSON.stringify(oldVal.slice(0, 120))}`);
      skip++; continue;
    }
    const newVal = typeof f.apply === 'function' ? f.apply(oldVal) : f.apply;
    if (newVal === oldVal) {
      console.log(`- 第${f.no}题：无需改动（生成结果与原来一致）`);
      skip++; continue;
    }

    console.log(`\n=== 第${f.no}题 · ${f.field} ===`);
    console.log(`原因：${f.why}`);
    console.log(`--- 改前 ---\n${oldVal}`);
    console.log(`--- 改后 ---\n${newVal}`);

    if (APPLY) {
      await conn.execute(
        `UPDATE python_tasks SET ${f.field} = ? WHERE id = ?`,
        [newVal, row.id]
      );
      console.log('已写入 ✓');
    } else {
      console.log('（dry run，未写入）');
    }
    ok++;
  }

  console.log(`\n合计：待改 ${ok} 条，跳过 ${skip} 条，模式 = ${APPLY ? 'APPLY' : 'DRY-RUN'}`);
  await conn.end();
})().catch((e) => { console.error('失败:', e.message); process.exit(1); });
