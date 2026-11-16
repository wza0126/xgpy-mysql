/**
 * 星卡学院 · 补充薄知识点题目（2026-11-16）
 *
 * 背景：70 个知识点里有 2 节完全没有题、8 节只有 1~2 题，
 *   学院「一天一张卡一阶」的节奏下这些卡会反复出同一道题。
 * 吴老同意补题，上限：每个知识点补到不超过 10 题（本脚本补到 4~5 题）。
 *
 * ⛔ 规范（和题库既有数据保持一致）：
 *   - content 是纯文本（不带 HTML 标签）
 *   - options 形如 {"options":["A. xxx","B. xxx"]}
 *   - answers 形如 {"answers":["B"]}
 *   - practice_enabled=1、exam_enabled=0（只给练习与学院用，不混进考试抽题）
 *   - id 统一 acad_seed_ 前缀，便于回溯与一键删除
 *
 * 用法：node scripts/seed-academy-questions.js [--apply]
 *   不带 --apply 只做校验与预览，不写库。
 */
const mysql = require('mysql2/promise');

const QUESTIONS = [
  // ---------- 算法的程序实现 / 顺序结构（原有 0 题） ----------
  {
    cluster: '算法的程序实现/顺序结构',
    content: '关于顺序结构，下列说法正确的是（　　）',
    options: ['A. 语句可以任意顺序执行', 'B. 必须包含分支语句', 'C. 各语句按书写顺序依次执行', 'D. 必须包含循环语句'],
    answer: 'C',
    explanation: '顺序结构是最基本的程序结构，程序从上到下逐条执行语句，不跳转、不重复。',
  },
  {
    cluster: '算法的程序实现/顺序结构',
    content: '执行语句 a = 3；b = 5；a = a + b 之后，变量 a 的值是（　　）',
    options: ['A. 3', 'B. 5', 'C. 8', 'D. 15'],
    answer: 'C',
    explanation: 'a = a + b 先把右边的 3 + 5 算成 8，再赋给 a，所以 a 变成 8。',
  },
  {
    cluster: '算法的程序实现/顺序结构',
    content: '执行语句 x = 10；y = x；x = 20 之后，变量 y 的值是（　　）',
    options: ['A. 10', 'B. 20', 'C. 30', 'D. 报错'],
    answer: 'A',
    explanation: 'y = x 时把当时的 10 存进 y；之后改 x 不会影响 y，所以 y 仍是 10。',
  },
  {
    cluster: '算法的程序实现/顺序结构',
    content: '顺序结构中，若某条语句写错了变量名，程序通常会（　　）',
    options: ['A. 自动忽略这条语句继续运行', 'B. 在这一条语句处报错', 'C. 跳到程序末尾继续', 'D. 自动修正变量名'],
    answer: 'B',
    explanation: '顺序结构逐条执行，遇到无法识别的变量名会在此处抛出错误，后面的语句不再执行。',
  },

  // ---------- 信息系统的支撑技术 / 网络拓扑结构（原有 0 题） ----------
  {
    cluster: '信息系统的支撑技术/网络拓扑结构',
    content: '所有计算机都连接到一个中心设备（如交换机）的拓扑结构称为（　　）',
    options: ['A. 总线型', 'B. 星型', 'C. 环型', 'D. 网状型'],
    answer: 'B',
    explanation: '星型拓扑以中心设备为核心，各节点单独与中心设备相连，形状像星星。',
  },
  {
    cluster: '信息系统的支撑技术/网络拓扑结构',
    content: '星型拓扑结构的主要缺点是（　　）',
    options: ['A. 布线特别复杂', 'B. 中心节点一旦故障，整个网络无法通信', 'C. 传输速度一定很慢', 'D. 不能连接互联网'],
    answer: 'B',
    explanation: '所有节点都依赖中心设备转发，中心设备坏了全网中断；单个节点故障则只影响自己。',
  },
  {
    cluster: '信息系统的支撑技术/网络拓扑结构',
    content: '总线型拓扑结构中所有节点共享一条传输介质，其主要优点是（　　）',
    options: ['A. 可靠性最高', 'B. 结构简单、布线方便、成本低', 'C. 传输速度最快', 'D. 不受节点数量影响'],
    answer: 'B',
    explanation: '总线型只需一条主干线，布线省、成本低；缺点是节点多时冲突多、一段断线全网受影响。',
  },
  {
    cluster: '信息系统的支撑技术/网络拓扑结构',
    content: '某单位要求网络中某条线路出现故障时仍能正常通信，最适合采用的拓扑结构是（　　）',
    options: ['A. 星型', 'B. 总线型', 'C. 环型', 'D. 网状型'],
    answer: 'D',
    explanation: '网状型节点之间有多条路径可达，一条线路断了可以走别的路，可靠性最高。',
  },

  // ---------- 程序设计语言的基本知识 / 常量与变量（原有 2 题） ----------
  {
    cluster: '程序设计语言的基本知识/常量与变量',
    content: '在 Python 中，下列变量名合法的是（　　）',
    options: ['A. 2num', 'B. num-1', 'C. num1', 'D. for'],
    answer: 'C',
    explanation: '变量名不能以数字开头、不能含运算符，也不能用保留字（for 是保留字）。num1 合法。',
  },
  {
    cluster: '程序设计语言的基本知识/常量与变量',
    content: '下列关于常量的说法，正确的是（　　）',
    options: ['A. 常量在程序运行过程中可以随意改变', 'B. 常量在程序运行过程中不能改变', 'C. 常量只能用整数表示', 'D. 常量必须先定义类型'],
    answer: 'B',
    explanation: '常量的值在程序执行过程中保持不变，例如数值 3.14、字符串 "Hello" 本身就是常量。',
  },

  // ---------- 程序设计语言的基本知识 / 赋值语句（原有 2 题） ----------
  {
    cluster: '程序设计语言的基本知识/赋值语句',
    content: '执行语句 a, b = 3, 4 之后，a 与 b 的值分别是（　　）',
    options: ['A. 3 和 4', 'B. 4 和 3', 'C. 都是 3', 'D. 都是 4'],
    answer: 'A',
    explanation: 'Python 支持多个变量同时赋值，按位置一一对应：a 得 3，b 得 4。',
  },
  {
    cluster: '程序设计语言的基本知识/赋值语句',
    content: '执行语句 x = 5；x = x * 2 之后，x 的值是（　　）',
    options: ['A. 5', 'B. 10', 'C. 25', 'D. 7'],
    answer: 'B',
    explanation: '赋值号右边先计算 5 * 2 = 10，再存回 x，所以 x 变成 10。',
  },

  // ---------- 程序设计语言的基本知识 / 输入语句 input（原有 2 题） ----------
  {
    cluster: '程序设计语言的基本知识/输入语句 input',
    content: '执行 a = input("请输入年龄：") 之后，变量 a 的数据类型是（　　）',
    options: ['A. 整数 int', 'B. 浮点数 float', 'C. 字符串 str', 'D. 布尔型 bool'],
    answer: 'C',
    explanation: 'input() 读到的内容一律是字符串，即使用户输入的是数字 15，得到也是 "15"。',
  },
  {
    cluster: '程序设计语言的基本知识/输入语句 input',
    content: '要让 input() 读入的内容可以参与算术运算，通常需要（　　）',
    options: ['A. 直接参与运算即可', 'B. 用 int() 或 float() 转换为数值', 'C. 用 print() 转换', 'D. 用 str() 再转换一次'],
    answer: 'B',
    explanation: '字符串不能直接做加减乘除，要用 int() 或 float() 转成数值类型后再计算。',
  },

  // ---------- 算法的程序实现 / break 与 continue（原有 2 题） ----------
  {
    cluster: '算法的程序实现/break 与 continue',
    content: '在循环中执行到 break 语句时，程序会（　　）',
    options: ['A. 跳过本次循环，继续下一次', 'B. 立即结束整个循环', 'C. 结束整个程序', 'D. 重新从第一次循环开始'],
    answer: 'B',
    explanation: 'break 的作用是跳出当前循环体，循环后面的语句不再执行，但循环之后的程序继续运行。',
  },
  {
    cluster: '算法的程序实现/break 与 continue',
    content: '在循环中执行到 continue 语句时，程序会（　　）',
    options: ['A. 结束整个循环', 'B. 跳过本次循环剩下的语句，直接进入下一次循环', 'C. 结束整个程序', 'D. 暂停循环等待输入'],
    answer: 'B',
    explanation: 'continue 只放弃本次循环的后续语句，循环本身继续；这和 break 有本质区别。',
  },

  // ---------- 经典算法应用 / 解析算法（原有 2 题） ----------
  {
    cluster: '经典算法应用/解析算法',
    content: '解析算法的主要特点是（　　）',
    options: ['A. 把所有可能情况逐一列举', 'B. 通过数学公式直接计算得出结果', 'C. 随机尝试直到成功', 'D. 必须使用递归'],
    answer: 'B',
    explanation: '解析算法先找出已知条件与结果之间的数学关系式，再用公式直接求解，效率高。',
  },
  {
    cluster: '经典算法应用/解析算法',
    content: '已知圆的半径 r，用解析算法求圆面积，正确的表达式是（　　）',
    options: ['A. 2 * 3.14 * r', 'B. 3.14 * r * r', 'C. 3.14 * r / 2', 'D. r * r / 3.14'],
    answer: 'B',
    explanation: '圆面积公式 S = πr²，用 Python 写就是 3.14 * r * r（或 3.14 * r ** 2）。',
  },

  // ---------- 经典算法应用 / 算法的优劣（原有 1 题） ----------
  {
    cluster: '经典算法应用/算法的优劣',
    content: '评价一个算法的优劣时，通常不考虑（　　）',
    options: ['A. 时间复杂度', 'B. 空间复杂度', 'C. 代码行数的多少', 'D. 结果是否正确'],
    answer: 'C',
    explanation: '算法评价看正确性、时间与空间效率、可读性等；代码写得长或短本身不是评价标准。',
  },
  {
    cluster: '经典算法应用/算法的优劣',
    content: '解决同一问题的两个算法，一个需要 100 次运算，另一个需要 10000 次，通常认为（　　）',
    options: ['A. 两者效率一样', 'B. 运算次数少的效率更高', 'C. 运算次数多的结果更准', 'D. 无法比较'],
    answer: 'B',
    explanation: '在结果都正确的前提下，运算次数越少、执行越快，算法效率越高。',
  },
  {
    cluster: '经典算法应用/算法的优劣',
    content: '在已经排好序的一组数据中查找某个数，效率最高的方法是（　　）',
    options: ['A. 顺序查找', 'B. 二分查找', 'C. 逐一枚举', 'D. 随机猜测'],
    answer: 'B',
    explanation: '二分查找每次折半，数据有序时查找次数远少于从头找到尾的顺序查找。',
  },

  // ---------- 信息系统的支撑技术 / 网络组建与调试命令（原有 1 题） ----------
  {
    cluster: '信息系统的支撑技术/网络组建与调试命令',
    content: '要查看本机的 IP 地址、子网掩码等配置信息，应使用的命令是（　　）',
    options: ['A. ping', 'B. ipconfig', 'C. dir', 'D. tasklist'],
    answer: 'B',
    explanation: 'ipconfig 用于查看和刷新本机的网络配置；ping 是测连通性，dir 看文件，tasklist 看进程。',
  },
  {
    cluster: '信息系统的支撑技术/网络组建与调试命令',
    content: '要测试本机与目标主机之间是否连通，应使用的命令是（　　）',
    options: ['A. ipconfig', 'B. ping', 'C. netstat', 'D. format'],
    answer: 'B',
    explanation: 'ping 向目标发送数据包并等待回应，有回应说明网络可达；超时说明不通或被拦截。',
  },
  {
    cluster: '信息系统的支撑技术/网络组建与调试命令',
    content: '执行命令 ping 192.168.1.1 的作用是（　　）',
    options: ['A. 查看本机 IP 地址', 'B. 测试与本机到 192.168.1.1 的连通性', 'C. 修改本机 IP 为 192.168.1.1', 'D. 关闭该地址所在的网络'],
    answer: 'B',
    explanation: 'ping 后面跟的是目标地址，用来测试连通性和延迟，不会修改任何配置。',
  },

  // ---------- 信息社会及其特征 / 信息社会的定义（原有 2 题） ----------
  {
    cluster: '信息社会及其特征/信息社会的定义',
    content: '信息社会是指（　　）',
    options: ['A. 以农业为主要产业的社会', 'B. 以信息活动为基础、信息产业占主导地位的社会', 'C. 以手工劳动为主的社会', 'D. 完全不使用网络的社会'],
    answer: 'B',
    explanation: '信息社会以信息资源为核心，信息产业成为主导产业，信息活动渗透到各个领域。',
  },
  {
    cluster: '信息社会及其特征/信息社会的定义',
    content: '下列属于信息社会主要特征的是（　　）',
    options: ['A. 信息成为重要的社会资源', 'B. 以蒸汽机的发明为标志', 'C. 土地是最主要的财富', 'D. 人力是主要动力来源'],
    answer: 'A',
    explanation: '信息社会里信息与知识成为关键资源；蒸汽机是工业社会的标志，土地与人力是农业社会的特征。',
  },
];

(async () => {
  const apply = process.argv.includes('--apply');
  const c = await mysql.createConnection({ host: '127.0.0.1', user: 'root', password: '122201', database: 'xgpy' });

  // 1) 该校验：题干/选项/答案完整、答案在选项里、同知识点补后不超过 10 题
  const byCluster = new Map();
  let bad = 0;
  QUESTIONS.forEach((q, i) => {
    const letters = q.options.map((o) => String(o).trim()[0].toUpperCase());
    if (!q.content || q.options.length < 3) { console.log(`✗ 第 ${i + 1} 题结构不完整`); bad++; }
    if (!letters.includes(q.answer)) { console.log(`✗ 第 ${i + 1} 题答案 ${q.answer} 不在选项 ${letters.join('')} 里`); bad++; }
    if (!q.cluster.includes('/')) { console.log(`✗ 第 ${i + 1} 题知识点不带章名`); bad++; }
    byCluster.set(q.cluster, (byCluster.get(q.cluster) || 0) + 1);
  });
  if (bad) { console.error(`\n有 ${bad} 处问题，未写库`); await c.end(); process.exit(1); }

  console.log(`共 ${QUESTIONS.length} 题，覆盖 ${byCluster.size} 个知识点：`);
  const [existing] = await c.execute(
    "SELECT cluster_id, COUNT(*) n FROM questions WHERE practice_enabled=1 AND type='choice' GROUP BY cluster_id"
  );
  const existMap = new Map(existing.map((r) => [r.cluster_id, Number(r.n)]));
  for (const [cluster, add] of byCluster) {
    const now = existMap.get(cluster) || 0;
    const after = now + add;
    const flag = after > 10 ? '  ⛔ 超过 10 题上限' : '';
    console.log(`  ${cluster}: 现有 ${now} + 补 ${add} = ${after}${flag}`);
    if (after > 10) bad++;
  }
  if (bad) { console.error('\n有知识点会超过 10 题，未写库'); await c.end(); process.exit(1); }

  if (!apply) {
    console.log('\n（预览模式，未写库。加 --apply 执行）');
    await c.end();
    return;
  }

  // 2) 写库
  let inserted = 0;
  let skipped = 0;
  for (let i = 0; i < QUESTIONS.length; i += 1) {
    const q = QUESTIONS[i];
    const id = `acad_seed_${String(i + 1).padStart(2, '0')}`;
    const [dup] = await c.execute('SELECT id FROM questions WHERE id = ?', [id]);
    if (dup.length) { skipped++; continue; }
    await c.execute(
      `INSERT INTO questions
         (id, type, content, options, answers, explanation, practice_enabled, exam_enabled, tags, cluster_id, created_by)
       VALUES (?, 'choice', ?, ?, ?, ?, 1, 0, '[]', ?, 'academy')`,
      [id, q.content, JSON.stringify({ options: q.options }), JSON.stringify({ answers: [q.answer] }), q.explanation, q.cluster]
    );
    inserted++;
  }
  console.log(`\n已写入 ${inserted} 题，跳过已存在 ${skipped} 题`);

  const [after] = await c.execute(
    `SELECT COUNT(*) total FROM questions WHERE id LIKE 'acad_seed_%'`
  );
  console.log('库中学院补充题总数:', after[0].total);
  await c.end();
})().catch((e) => { console.error(e); process.exit(1); });
