// 代码秘境 · 游戏数据（江苏省信息技术学测 Python 考点：19 关键字 + 17 内置函数/方法 = 36 项）

export interface RealmQuestion {
  prompt: string;      // 题目 / 咒语填空
  options: string[];   // 选项（含正确项）
  answer: number;      // 正确项索引
  good: string;        // 答对反馈
  bad: string;         // 答错反馈
}

export interface RealmScene {
  id: string;
  npcIcon: string;
  npcName: string;
  lines: string[];     // 对话 / 叙述
  q?: RealmQuestion;   // 选择题
  keywords?: string[]; // 通过后收集的图鉴项
  xp: number;
}

export interface RealmBoss {
  name: string;
  icon: string;
  intro: string;
  questions: RealmQuestion[];
  keywords: string[];
  xp: number;
}

export interface RealmChapter {
  id: number;
  title: string;
  subtitle: string;
  icon: string;
  scenes: RealmScene[];
  boss: RealmBoss;
  badge: { id: string; name: string; icon: string };
}

export interface KeywordInfo {
  id: string;
  name: string;        // 展示名（input() 等）
  type: 'keyword' | 'builtin';
  desc: string;        // 释义
  example: string;     // 示例
  chapter: number;     // 归属章节
}

// ==================== 36 项图鉴 ====================
export const KEYWORDS: KeywordInfo[] = [
  { id: 'input', name: 'input()', type: 'builtin', chapter: 1, desc: '接收用户输入，把外界的文字带回程序', example: 'name = input("你叫什么名字？")' },
  { id: 'print', name: 'print()', type: 'builtin', chapter: 1, desc: '把内容输出到屏幕上，让世界看见', example: 'print("你好，世界！")' },
  { id: 'def', name: 'def', type: 'keyword', chapter: 1, desc: '定义函数，给一段代码取名字，之后可反复调用', example: 'def 祝福(): return "加油！"' },
  { id: 'return', name: 'return', type: 'keyword', chapter: 1, desc: '从函数中返回结果，把计算结果交还给调用处', example: 'return 面积' },
  { id: 'True', name: 'True', type: 'keyword', chapter: 2, desc: '布尔真值，表示"成立/是"', example: 'if 1 < 2:  # 条件为 True' },
  { id: 'False', name: 'False', type: 'keyword', chapter: 2, desc: '布尔假值，表示"不成立/否"', example: 'if 1 > 2:  # 条件为 False' },
  { id: 'bool', name: 'bool()', type: 'builtin', chapter: 2, desc: '把任意值转换为布尔 True/False', example: 'bool(1)  # True' },
  { id: 'if', name: 'if', type: 'keyword', chapter: 2, desc: '如果条件成立，就执行下面的代码', example: 'if 分数 >= 60:' },
  { id: 'elif', name: 'elif', type: 'keyword', chapter: 2, desc: '否则如果——条件多于两个时继续判断', example: 'elif 分数 >= 80:' },
  { id: 'else', name: 'else', type: 'keyword', chapter: 2, desc: '否则——以上条件都不满足时执行', example: 'else:  # 剩余情况' },
  { id: 'and', name: 'and', type: 'keyword', chapter: 2, desc: '逻辑与：所有条件同时成立才为 True', example: 'if 有勇气 and 有智慧:' },
  { id: 'or', name: 'or', type: 'keyword', chapter: 2, desc: '逻辑或：只要一个条件成立即为 True', example: 'if 走密林 or 走沼泽:' },
  { id: 'not', name: 'not', type: 'keyword', chapter: 2, desc: '逻辑非：把 True 变 False，False 变 True', example: 'not False  # True' },
  { id: 'for', name: 'for', type: 'keyword', chapter: 3, desc: '遍历循环：依次访问序列中的每一个元素', example: 'for x in [1,2,3]:' },
  { id: 'range', name: 'range()', type: 'builtin', chapter: 3, desc: '生成整数序列，常配合 for 使用', example: 'for i in range(5):' },
  { id: 'while', name: 'while', type: 'keyword', chapter: 3, desc: '条件循环：只要条件为真就持续执行', example: 'while 谷物数量 > 0:' },
  { id: 'break', name: 'break', type: 'keyword', chapter: 3, desc: '立刻跳出整个循环，不再继续', example: 'if 找到错误: break' },
  { id: 'continue', name: 'continue', type: 'keyword', chapter: 3, desc: '跳过本次循环剩余代码，进入下一次', example: 'if 石头是红色: continue' },
  { id: 'is', name: 'is', type: 'keyword', chapter: 4, desc: '判断两个对象是否为同一个（身份比较）', example: 'x is None' },
  { id: 'in', name: 'in', type: 'keyword', chapter: 4, desc: '判断某个元素是否在序列中', example: '"天狼星" in 星辰名录' },
  { id: 'None', name: 'None', type: 'keyword', chapter: 4, desc: '空值，表示"什么都没有"，不是 0 也不是 False', example: 'x = None  # 未赋值' },
  { id: 'int', name: 'int()', type: 'builtin', chapter: 5, desc: '转为整数，舍去小数部分', example: 'int(3.14)  # 3' },
  { id: 'float', name: 'float()', type: 'builtin', chapter: 5, desc: '转为浮点数，让数字拥有小数', example: 'float(3)  # 3.0' },
  { id: 'max', name: 'max()', type: 'builtin', chapter: 5, desc: '返回一组数中的最大值', example: 'max(3, 7, 2)  # 7' },
  { id: 'min', name: 'min()', type: 'builtin', chapter: 5, desc: '返回一组数中的最小值', example: 'min(3, 7, 2)  # 2' },
  { id: 'round', name: 'round()', type: 'builtin', chapter: 5, desc: '四舍五入到指定精度', example: 'round(3.14159, 2)  # 3.14' },
  { id: 'sum', name: 'sum()', type: 'builtin', chapter: 5, desc: '对序列中的数字求和', example: 'sum([30, 45, 20])  # 95' },
  { id: 'len', name: 'len()', type: 'builtin', chapter: 5, desc: '返回序列的长度（元素个数）', example: 'len([1,2,3])  # 3' },
  { id: 'split', name: 'split()', type: 'builtin', chapter: 6, desc: '按指定字符把字符串分割成列表', example: '"a_b_c".split("_")  # [a, b, c]' },
  { id: 'replace', name: 'replace()', type: 'builtin', chapter: 6, desc: '把字符串中的内容替换为新的内容', example: '"紫".replace("紫","蓝")  # 蓝' },
  { id: 'strip', name: 'strip()', type: 'builtin', chapter: 6, desc: '去除字符串首尾的空格或指定字符', example: '" 石像 ".strip()  # 石像' },
  { id: 'sort', name: 'sort()', type: 'builtin', chapter: 6, desc: '对列表原地升序排序', example: '[5,2,8].sort()  # [2,5,8]' },
  { id: 'reverse', name: 'reverse()', type: 'builtin', chapter: 6, desc: '把列表顺序原地反转', example: '[1,2,3].reverse()  # [3,2,1]' },
  { id: 'append', name: 'append()', type: 'builtin', chapter: 6, desc: '在列表末尾添加一个元素', example: '项链.append("贝壳")' },
  { id: 'del', name: 'del', type: 'keyword', chapter: 6, desc: '删除指定元素或变量', example: 'del 项链[0]' },
  { id: 'import', name: 'import', type: 'keyword', chapter: 7, desc: '导入模块，调用别人写好的强大功能', example: 'import random' },
];

// ==================== 7 大秘境 ====================
export const CHAPTERS: RealmChapter[] = [
  {
    id: 1,
    title: '第一章 · 回音谷',
    subtitle: '输入输出与函数',
    icon: '🏔️',
    badge: { id: 'badge_1', name: '倾听者', icon: '👂' },
    scenes: [
      {
        id: 'c1s1',
        npcIcon: '🧙',
        npcName: '导师',
        xp: 10,
        lines: [
          '「你来了，学徒。世界需要你。」',
          '「拿起那本空白的『真理之书』，它会记录你找回的每一个关键字。」',
          '「你的第一站是回音谷。那里的回声能回应人的话语，但也需要正确的咒语才能唤醒。」',
        ],
      },
      {
        id: 'c1s2',
        npcIcon: '🪨',
        npcName: '回音石壁',
        xp: 20,
        lines: [
          '石壁上刻着一行字：「向深渊说出你的名字，让世界听见你。」',
          '一个低沉的声音传来：「凡人的呼喊无法启动魔法，你需要正确的咒语。」',
        ],
        keywords: ['input'],
        q: {
          prompt: '哪个咒语能接收用户输入的名字？',
          options: ['print()', 'input()', 'int()', 'return'],
          answer: 1,
          good: '你念出 input() 的瞬间，石壁裂开金光，你的名字自动浮现其上。「input()——接收万物的声音。」',
          bad: '石壁毫无反应。低沉的声音再次响起：「input() 用于接收输入，把用户敲下的文字带回程序。」',
        },
      },
      {
        id: 'c1s3',
        npcIcon: '📯',
        npcName: '金色号角',
        xp: 20,
        lines: [
          '山谷中央立着一支巨大的金色号角，底座刻着：「将你的心声告诉世界。」',
          '号角发出低鸣：「我很久没被吹响了。用那个让世界听见你的咒语。」',
        ],
        keywords: ['print'],
        q: {
          prompt: '哪个咒语能把「你好，世界！」显示出来？',
          options: ['input()', 'len()', 'print()', 'del'],
          answer: 2,
          good: '号角震耳欲聋地共鸣，金色文字飘向天空：「你好，世界！」「print()——输出，就是让世界看见你的思想。」',
          bad: '号角发出难听的噪音。地面浮现一行字：「正确的咒语是 print()，它把内容显示在屏幕上。」',
        },
      },
    ],
    boss: {
      name: '回声巨灵',
      icon: '🌪️',
      intro: '山谷深处，由回声凝聚的巨灵挡住了去路：「想过去？证明你掌握了创造咒语的力量！」',
      xp: 60,
      keywords: ['def', 'return'],
      questions: [
        {
          prompt: '要给一段魔法取名字、以后反复使用，用哪个关键字开头？\n\n____ 祝福():\n    return "加油"',
          options: ['def', 'return', 'if', 'print'],
          answer: 0,
          good: '「def——定义函数。它给代码取名字，从此你只需呼唤它，不必重复书写。」',
          bad: '巨灵摇头：「def 才是定义函数的关键字。return 是返回结果，if 是判断，print 是输出。」',
        },
        {
          prompt: '函数计算出结果后，用哪个关键字把结果交还给你？\n\ndef 圆面积(r):\n    ____ 3.14 * r * r',
          options: ['del', 'return', 'break', 'input'],
          answer: 1,
          good: '「return——把结果从函数中带回来。创造咒语时，有 def 定义、有 return 返回，才算完整。」',
          bad: '巨灵：「return 用于把函数的结果返回给调用处。del 删除、break 跳出、input 输入。」',
        },
        {
          prompt: '回声巨灵怒吼：「你如何召唤自己创造的咒语？」',
          options: ['直接喊函数名：祝福()', '用 break 打断它', '用 import 导入它', '用 print 打印它'],
          answer: 0,
          good: '你大喊「祝福()」，巨灵被声浪震退，化为符文飞入真理之书。',
          bad: '巨灵：「定义好 def 祝福(): return ... 之后，调用它的方式就是直接写函数名并加括号 祝福()。」',
        },
      ],
    },
  },
  {
    id: 2,
    title: '第二章 · 抉择森林',
    subtitle: '条件与逻辑',
    icon: '🌲',
    badge: { id: 'badge_2', name: '逻辑师', icon: '🧠' },
    scenes: [
      {
        id: 'c2s1',
        npcIcon: '🧚',
        npcName: '布尔精灵',
        xp: 20,
        lines: [
          '路牌：「欢迎来到抉择森林。这里的每一条路都由真与假决定。」',
          '树上的果实说话了：「我是布尔精灵。先回答我：『天空是蓝色的』——这句话是真是假？」',
        ],
        keywords: ['True', 'False'],
        q: {
          prompt: '「天空是蓝色的」——用哪个值表示它成立？',
          options: ['True', 'False', 'None', '0'],
          answer: 0,
          good: '布尔精灵拍手：「正确！True 代表真。而它不成立时的对立面就是 False——假。」',
          bad: '布尔精灵摇头：「True 代表真，False 代表假。天空是蓝色的，显然为真，选 True。」',
        },
      },
      {
        id: 'c2s2',
        npcIcon: '⛵',
        npcName: '三岔河船夫',
        xp: 20,
        lines: [
          '三条河汇聚成树状。天空突然下起大雨。',
          '船夫：「记住规则：if 天晴走左溪，elif 下雨走右江，else 走中河。现在，请选择。」',
        ],
        keywords: ['if', 'elif', 'else'],
        q: {
          prompt: '此刻正下着大雨，应走哪条路？',
          options: ['左溪（if 天晴）', '中河（else）', '右江（elif 下雨）', '原地等待'],
          answer: 2,
          good: '你踏上右江的船平安过河。船夫递来符文：「elif——否则如果。当条件不止两个时，它让逻辑层层分明。」',
          bad: '船夫摇头：「if 是『如果』，elif 是『否则如果』，else 是『否则』。天气是下雨，应选 elif。」',
        },
      },
      {
        id: 'c2s3',
        npcIcon: '🗿',
        npcName: '双生门石像鬼',
        xp: 20,
        lines: [
          '两扇石门，一扇刻日轮，一扇刻月轮。两枚令牌悬浮空中：🔥火之钥 💧水之钥。',
          '石像鬼：「只有同时持有火之钥和水之钥的人才能开门。」',
        ],
        keywords: ['and'],
        q: {
          prompt: '咒语填空：「持有火之钥 ___ 持有水之钥，门将开启」',
          options: ['and', 'or', 'not', 'in'],
          answer: 0,
          good: '你念出 and，两枚令牌融合成金色钥匙。「and——要求所有条件同时满足。」',
          bad: '石像鬼低吼：「or 允许二选一，not 是否定。这里需要两者兼备——用 and！」',
        },
      },
      {
        id: 'c2s4',
        npcIcon: '🏮',
        npcName: '灯笼精灵',
        xp: 20,
        lines: [
          '夜晚森林，两条黑暗的路，一盏灯笼飘浮在空中。',
          '灯笼精灵：「左边密林、右边沼泽，你只需要走其中一条就能出去。」',
        ],
        keywords: ['or'],
        q: {
          prompt: '咒语填空：「走密林 ___ 走沼泽，只要有一条路对就行」',
          options: ['and', 'or', 'not', 'is'],
          answer: 1,
          good: '灯笼亮起暖光：「or——宽容的退路。你不必完美，只要有一线希望就够了。」它照亮了沼泽中隐藏的石桥。',
          bad: '灯笼闪烁两下熄灭：「and 要求两条路都走，那不可能；not 是否定。这里用 or——选一个就行。」',
        },
      },
      {
        id: 'c2s5',
        npcIcon: '🪞',
        npcName: '颠倒镜灵',
        xp: 20,
        lines: [
          '一面巨大的镜子，映出完全相反的世界。',
          '镜灵：「镜子里的世界全是反的。告诉我——not False 等于什么？」',
        ],
        keywords: ['not'],
        q: {
          prompt: 'not False 等于？',
          options: ['False', 'True', 'None', '0'],
          answer: 1,
          good: '镜子碎裂成光点露出一条通道。「not——否定的力量。它让假变成真，真变成假。」',
          bad: '镜灵嘲讽：「False 的反面当然是 True。not 就是『非』的意思。」',
        },
      },
    ],
    boss: {
      name: '矛盾巨兽',
      icon: '👾',
      intro: '森林中心，由逻辑错误构成的巨兽咆哮：「解开我的逻辑谜题，每答对一题我就虚弱一分！」',
      xp: 80,
      keywords: ['bool'],
      questions: [
        {
          prompt: '巨兽：「1 大于 2 是 ___」',
          options: ['True', 'False', 'and', 'None'],
          answer: 1,
          good: '巨兽痛苦缩小一圈：「呃啊！你让我看到了真相——1 大于 2 当然是 False！」',
          bad: '巨兽：「1 大于 2 不成立，应该是 False。用 bool() 也能得到这个结果。」',
        },
        {
          prompt: '巨兽：「要打败我，你需要同时拥有勇气 ___ 智慧！」',
          options: ['and', 'or', 'not', 'in'],
          answer: 0,
          good: '巨兽再次缩小：「两种力量兼备——这才是真正的 and 逻辑！」',
          bad: '巨兽：「or 是二选一，这里需要两者兼备，用 and。」',
        },
        {
          prompt: '巨兽：「用哪个函数可以把任意值变成布尔 True/False？」',
          options: ['int()', 'len()', 'bool()', 'round()'],
          answer: 2,
          good: '你喊出 bool()，巨兽哀嚎着碎裂成无数逻辑符文。「bool()——明辨是非的钥匙！」',
          bad: '巨兽：「int() 转整数，len() 求长度。转布尔用 bool()！」',
        },
      ],
    },
  },
  {
    id: 3,
    title: '第三章 · 循环钟楼',
    subtitle: '循环结构',
    icon: '🕰️',
    badge: { id: 'badge_3', name: '循环行者', icon: '🌀' },
    scenes: [
      {
        id: 'c3s1',
        npcIcon: '📮',
        npcName: '无尽信使',
        xp: 20,
        lines: [
          '钟楼第一层，5 棵发光的树排成一排，信使累得直喘气。',
          '「我要给每一棵树送一封信，但我跑不动了。用那个『遍历每一个』的咒语帮我！」',
        ],
        keywords: ['for', 'range'],
        q: {
          prompt: '要依次给 5 棵树送信，哪个咒语最合适？',
          options: ['for tree in trees: 送信()', 'while 送信()', 'if 送信()', 'del 送信()'],
          answer: 0,
          good: '你念出咒语，5 封信同时飞向对应树木。「for——遍历循环，访问序列中的每一个成员，一个不漏。配合 range(5) 就是访问 5 次。」',
          bad: '信使摇头：「for 元素 in 序列: 执行动作，才能依次访问每一个。while 是条件循环，if 只判断一次。」',
        },
      },
      {
        id: 'c3s2',
        npcIcon: '⚙️',
        npcName: '磨坊主',
        xp: 20,
        lines: [
          '巨大的磨坊，水车不停旋转，旁边堆着 100 袋谷物。',
          '磨坊主：「只要谷物还有，磨坊就不能停。当最后一袋磨完，水车就要停下。」',
        ],
        keywords: ['while'],
        q: {
          prompt: '咒语填空：\n\n___ 谷物数量 > 0:\n    磨一袋谷物()\n    谷物数量 -= 1',
          options: ['for', 'while', 'if', 'break'],
          answer: 1,
          good: '水车有节奏地转动，磨完最后一袋缓缓停下。「while——只要条件为真就持续执行，条件不再成立便停止。」',
          bad: '磨坊主叹气：「for 用于遍历已知范围，if 只判断一次。这里需要『当条件成立时持续执行』——用 while。」',
        },
      },
      {
        id: 'c3s3',
        npcIcon: '🕐',
        npcName: '钟表匠',
        xp: 20,
        lines: [
          '钟楼第三层，20 个时钟排成弧形，其中有一个时间错误。',
          '钟表匠：「找到第一个错误就停下来，不必检查所有。用一个能『紧急跳出』的咒语。」',
        ],
        keywords: ['break'],
        q: {
          prompt: '伪代码补全：\n\nfor 时钟 in 所有时钟:\n    if 时钟.时间错误():\n        ____()',
          options: ['continue', 'break', 'return', 'del'],
          answer: 1,
          good: '遍历到第 3 个时钟时念出 break，循环立即终止。「break——跳出整个循环，精准中断。」',
          bad: '钟表匠：「continue 是跳过本次继续，break 才是跳出全部循环。」',
        },
      },
      {
        id: 'c3s4',
        npcIcon: '💧',
        npcName: '水精灵',
        xp: 20,
        lines: [
          '钟楼第四层，溪流上有 5 块石头，其中 2 块是红色「问题石」会咬人。',
          '水精灵：「跳过红色石头，踩安全的石头前进。使用那个『跳过本次』的咒语。」',
        ],
        keywords: ['continue'],
        q: {
          prompt: '伪代码补全：\n\nfor 石头 in 溪流:\n    if 石头.颜色 == "红色":\n        ____()',
          options: ['break', 'continue', 'return', 'del'],
          answer: 1,
          good: '你每次遇到红色石头就跳过去，安全到达对岸。「continue——跳过本次循环的剩余部分，直接进入下一次。」',
          bad: '你被红色石头咬中弹回起点。水精灵：「break 终止整个循环，return 返回结果。跳过麻烦的石头用 continue！」',
        },
      },
    ],
    boss: {
      name: '永动守卫',
      icon: '🤖',
      intro: '钟楼顶层，齿轮机器人永恒旋转：「我永不停止！你能打破我的循环吗？」',
      xp: 70,
      keywords: [],
      questions: [
        {
          prompt: '守卫进入无限循环攻击模式，你该如何终结它？',
          options: ['用 break 跳出循环', '用 continue 跳过', '用 for 遍历', '用 while 等待'],
          answer: 0,
          good: '你念出 break，守卫齿轮卡死停下攻击。「break——果断跳出，中断无限循环！」',
          bad: '守卫：「continue 只是跳过本次，只有 break 能完全终止循环。」',
        },
        {
          prompt: '守卫释放范围攻击但破绽百出，你要躲过这次攻击、继续自己的节奏——',
          options: ['用 break 停止', '用 continue 跳过这次攻击', '用 while 重来', '用 if 判断'],
          answer: 1,
          good: '你念出 continue 灵巧跳过攻击继续逼近核心。「continue——绕开障碍，不中断旅程。」',
          bad: '守卫：「跳过这一次、继续下一次，这正是 continue 的用途。」',
        },
        {
          prompt: '守卫倒下前问：「遍历 5 次，用哪个函数生成序列？」',
          options: ['range(5)', 'input(5)', 'len(5)', 'sum(5)'],
          answer: 0,
          good: '「range(5) 生成 0 到 4 的整数序列，配合 for 就能循环 5 次！」守卫轰然倒地。',
          bad: '守卫：「range(n) 生成 n 个整数的序列，for i in range(5) 正是循环 5 次。」',
        },
      ],
    },
  },
  {
    id: 4,
    title: '第四章 · 真伪殿堂',
    subtitle: '身份、归属与空',
    icon: '🏛️',
    badge: { id: 'badge_4', name: '真理使者', icon: '⚖️' },
    scenes: [
      {
        id: 'c4s1',
        npcIcon: '🪷',
        npcName: '照影湖灵',
        xp: 20,
        lines: [
          '殿堂中央，平静的湖水倒映着天空。',
          '湖灵：「你看——天空倒映在水中，它们看起来一模一样。但它们是同一个东西吗？」',
        ],
        keywords: ['is'],
        q: {
          prompt: '判断两个对象是否为「同一个身份」，用哪个关键字？',
          options: ['is', 'in', '==', 'not'],
          answer: 0,
          good: '湖面泛起金字：「is——判断同一性。它比较的是身份，而不是外表是否相同。」',
          bad: '湖灵：「is 判断身份/同一性；外观相同不代表是同一个对象。」',
        },
      },
      {
        id: 'c4s2',
        npcIcon: '🌌',
        npcName: '星图管理员',
        xp: 20,
        lines: [
          '殿堂上方，万千星辰组成名录。',
          '管理员：「告诉我——『天狼星』在星辰名录里吗？」',
        ],
        keywords: ['in'],
        q: {
          prompt: '判断「天狼星」是否在名录中，正确的写法是？',
          options: ['"天狼星" in 名录', '"天狼星" is 名录', '"天狼星" = 名录', 'del "天狼星"'],
          answer: 0,
          good: '星辰名录亮起，天狼星的名字闪耀金光。「in——归属的检验：在，返回 True；不在，返回 False。」',
          bad: '管理员摇头：「is 比较身份，= 是赋值。in 才是判断是否在序列中。」',
        },
      },
      {
        id: 'c4s3',
        npcIcon: '📦',
        npcName: '空之匣',
        xp: 20,
        lines: [
          '殿堂角落放着一只精美的宝匣，打开后空无一物。',
          '宝匣：「我里面什么都没有，但我很有价值。你明白『空』的意义吗？」',
        ],
        keywords: ['None'],
        q: {
          prompt: 'Python 中表示「什么都没有」的空值是什么？',
          options: ['None', '0', 'False', '""'],
          answer: 0,
          good: '宝匣散发暖光：「None——空值。不是错误，不是零，只是『什么都没有』。空，是为了容纳新的可能。」',
          bad: '宝匣：「None 就是『空』本身。0 是数字，False 是假，空字符串 "" 也是值——只有 None 表示没有值。」',
        },
      },
    ],
    boss: {
      name: '真假审判官',
      icon: '⚖️',
      intro: '殿堂尽头，穿法官袍的巨人：「回答我三个问题，全部正确才能通过！」',
      xp: 70,
      keywords: [],
      questions: [
        {
          prompt: '审判官：「None 是什么？」',
          options: ['错误', '空值', '假', '零'],
          answer: 1,
          good: '「None 代表空值——什么都没有，但不是错误也不是零。」审判官的光环暗了一分。',
          bad: '审判官：「None 是空值。错误是异常，假是 False，零是 0。」',
        },
        {
          prompt: '审判官：「is 和 == 的区别？」',
          options: ['完全相同', 'is 判断身份，== 判断值相等', 'is 判断值相等', '== 判断身份'],
          answer: 1,
          good: '「is 比较是否为同一个对象，== 比较值是否相等。」审判官的声音开始颤抖。',
          bad: '审判官：「is 判断身份/同一性，== 判断值是否相等。」',
        },
        {
          prompt: '审判官：「最后——not False 等于什么？」',
          options: ['True', 'False', 'None', '0'],
          answer: 0,
          good: '你答出 True，审判官法袍碎裂化作五彩光芒。「你已在逻辑的殿堂中加冕！」',
          bad: '审判官：「not 是否定，False 的否定就是 True。」',
        },
      ],
    },
  },
  {
    id: 5,
    title: '第五章 · 数字山脉',
    subtitle: '数字与计算',
    icon: '⛰️',
    badge: { id: 'badge_5', name: '数据工匠', icon: '🔢' },
    scenes: [
      {
        id: 'c5s1',
        npcIcon: '🪨',
        npcName: '长老精灵',
        xp: 20,
        lines: [
          '巨大的灵魂石上刻着各种数字。',
          '长老：「你带来了 3.14——这不是完整的编号。请把它转化为整数。」',
        ],
        keywords: ['int'],
        q: {
          prompt: '把 3.14 转为整数，用哪个函数？',
          options: ['float()', 'int()', 'len()', 'round()'],
          answer: 1,
          good: '灵魂石上的 3.14 变成 3。「int()——转为整数，舍去小数部分，只保留完整的单位。」',
          bad: '灵魂石发出警报：「float() 转浮点数，len() 求长度。转整数用 int()！」',
        },
      },
      {
        id: 'c5s2',
        npcIcon: '☁️',
        npcName: '云梯管理员',
        xp: 20,
        lines: [
          '通往山顶的云梯需要精确的高度才稳定。',
          '管理员：「你带来的高度是 3，但我们需要更精细的 3.0。请把整数转化为浮点数。」',
        ],
        keywords: ['float'],
        q: {
          prompt: '把 3 转为浮点数，用哪个函数？',
          options: ['int()', 'float()', 'round()', 'len()'],
          answer: 1,
          good: '云梯凝固成晶莹的台阶，精确到小数位。「float()——转为浮点数，让世界拥有更多细节。」',
          bad: '阶梯变透明，你一脚踩空。管理员惊呼：「int() 转整数，round() 四舍五入。转浮点数用 float()！」',
        },
      },
      {
        id: 'c5s3',
        npcIcon: '🗻',
        npcName: '山神',
        xp: 25,
        lines: [
          '五座山峰高度：3200、4500、2800、5100、3900 米。',
          '山神：「最高的顶峰有日之石，最低的谷底有月之花。用两个咒语同时找到它们。」',
        ],
        keywords: ['max', 'min'],
        q: {
          prompt: '找出列表中的最大值和最小值，用哪个组合？',
          options: ['max() 和 min()', 'sum() 和 len()', 'sort() 和 reverse()', 'round() 和 int()'],
          answer: 0,
          good: '5100 米处金光闪耀，2800 米处银月绽放。「max() 选最大，min() 选最小——帮你找到极值。」',
          bad: '山神：「sum() 求和，len() 求长度，sort() 排序。找最大最小用 max() 和 min()！」',
        },
      },
      {
        id: 'c5s4',
        npcIcon: '🌾',
        npcName: '丰收祭司',
        xp: 25,
        lines: [
          '金黄麦田，五堆谷物：30、45、20、50、35 袋。',
          '祭司：「我需要知道总收成多少袋，以及一共有多少堆。」',
        ],
        keywords: ['sum', 'len'],
        q: {
          prompt: '谷物 = [30, 45, 20, 50, 35]，求总袋数和堆数用？',
          options: ['sum() 和 len()', 'max() 和 min()', 'int() 和 float()', 'split() 和 strip()'],
          answer: 0,
          good: '「180」与「5」同时浮现。「sum() 凝聚整体，len() 度量规模。你为丰收节带来智慧。」',
          bad: '谷物燃烧起来。祭司：「sum() 求和，len() 求长度！不是找极值也不是转换。」',
        },
      },
    ],
    boss: {
      name: '数字巨龙',
      icon: '🐉',
      intro: '山顶盘旋着由数字组成的巨龙：「回答我的数字风暴，我将让出全部宝藏！」',
      xp: 80,
      keywords: ['round'],
      questions: [
        {
          prompt: '巨龙：「把 3.14159 四舍五入保留两位小数」',
          options: ['round(3.14159, 2)', 'int(3.14159)', 'float(3.14159)', 'sum(3.14159)'],
          answer: 0,
          good: '「round()——四舍五入打磨精度，不多不少。结果是 3.14。」巨龙失去一枚鳞片。',
          bad: '巨龙：「round(数字, 小数位数) 才是四舍五入。int 直接舍去小数。」',
        },
        {
          prompt: '巨龙：「[3, 7, 2, 9, 5] 中最大值与最小值之差？」',
          options: ['4', '7', '9', '5'],
          answer: 1,
          good: '「max()=9，min()=2，差为 7！」巨龙再失一鳞。',
          bad: '巨龙：「先用 max() 和 min() 求出 9 和 2，它们的差是 7。」',
        },
        {
          prompt: '巨龙：「[10, 20, 30, 40] 的总和与长度？」',
          options: ['总和 100，长度 4', '总和 4，长度 100', '总和 100，长度 10', '总和 10，长度 4'],
          answer: 0,
          good: '「sum() 求和得 100，len() 求长度得 4！」巨龙化成金色数字洒落。',
          bad: '巨龙：「sum() 求总和，len() 求元素个数。100 和 4，记住了。」',
        },
      ],
    },
  },
  {
    id: 6,
    title: '第六章 · 序列作坊',
    subtitle: '字符串与列表操作',
    icon: '🧵',
    badge: { id: 'badge_6', name: '序列大师', icon: '📐' },
    scenes: [
      {
        id: 'c6s1',
        npcIcon: '🧶',
        npcName: '织女',
        xp: 20,
        lines: [
          '一团乱麻般的丝线缠住云锦。',
          '织女：「按每一个结扣把乱线拆开。用那个『分割』的咒语。」',
        ],
        keywords: ['split'],
        q: {
          prompt: '"hello_world_python".____("_") 按 _ 分割，用哪个方法？',
          options: ['split()', 'replace()', 'strip()', 'sort()'],
          answer: 0,
          good: '丝线按 _ 断开成 hello / world / python 三段。「split()——分割，让混乱重获秩序。」',
          bad: '丝线缠得更紧。织女：「replace() 替换字符，strip() 去空格。分割用 split()！」',
        },
      },
      {
        id: 'c6s2',
        npcIcon: '🎨',
        npcName: '画师',
        xp: 20,
        lines: [
          '一幅画里，天空被画成了紫色。',
          '画师：「我犯错了！请把『紫』换成『蓝』。」',
        ],
        keywords: ['replace'],
        q: {
          prompt: '"紫色的天空".____("紫", "蓝") 替换文字，用哪个方法？',
          options: ['split()', 'replace()', 'strip()', 'append()'],
          answer: 1,
          good: '画布上的紫色瞬间变为蓝色。「replace()——替换，用新的美好覆盖旧的遗憾。」',
          bad: '画布更混乱了。画师：「split() 是分割，strip() 是去空格。替换用 replace()！」',
        },
      },
      {
        id: 'c6s3',
        npcIcon: '🌿',
        npcName: '园丁',
        xp: 20,
        lines: [
          '石像被藤蔓缠绕，首尾都是多余枝叶。',
          '园丁：「去除首尾多余的枝叶，让石像露出本来的面容。」',
        ],
        keywords: ['strip'],
        q: {
          prompt: '"   **石像**   ".____() 去除首尾空格，用哪个方法？',
          options: ['split()', 'replace()', 'strip()', 'reverse()'],
          answer: 2,
          good: '藤蔓被修剪整齐，露出精美雕刻。「strip()——去除首尾的累赘，回归最本质的模样。」',
          bad: '藤蔓疯长。园丁：「split() 分割，replace() 替换。去首尾空格用 strip()！」',
        },
      },
      {
        id: 'c6s4',
        npcIcon: '🌷',
        npcName: '花园精灵',
        xp: 25,
        lines: [
          '花朵散落：5、2、8、1、9。',
          '精灵：「先按从小到大排列，再看看反过来是什么样。」',
        ],
        keywords: ['sort'],
        q: {
          prompt: '花朵 = [5, 2, 8, 1, 9]，先升序排列用哪个方法？',
          options: ['sort()', 'reverse()', 'append()', 'del'],
          answer: 0,
          good: '花朵自动排成 [1, 2, 5, 8, 9]。「sort()——让混乱变得有序。之后再 reverse() 就能反转顺序。」',
          bad: '花朵枯萎。精灵：「sort() 升序排列，reverse() 反转顺序，append() 添加元素。」',
        },
      },
    ],
    boss: {
      name: '数据巨魔',
      icon: '👹',
      intro: '作坊深处，由错误数据组成的巨魔：「重组我，否则我会永远混乱下去！」',
      xp: 80,
      keywords: ['reverse', 'append', 'del'],
      questions: [
        {
          prompt: '巨魔体内数字 [3, 1, 4] 杂乱无序，先排序再反转成 [4, 3, 1]？',
          options: ['sort() 后 reverse()', 'reverse() 后 sort()', 'append() 后 del', 'strip() 后 split()'],
          answer: 0,
          good: '数字先有序排列再反转，巨魔结构稳定了一半。「sort 建立秩序，reverse 翻转视角！」',
          bad: '巨魔：「先 sort() 升序，再 reverse() 反转，才能得到 [4, 3, 1]。」',
        },
        {
          prompt: '巨魔：「往空列表里加一颗宝石，用什么方法？」',
          options: ['append()', 'sort()', 'strip()', 'replace()'],
          answer: 0,
          good: '宝石被添进列表。「append()——在末尾持续积累。」巨魔又崩了一块。',
          bad: '巨魔：「append() 在列表末尾添加元素。sort 排序，strip 去空格。」',
        },
        {
          prompt: '巨魔：「删掉列表中的第一个错误元素，用什么？」',
          options: ['del 列表[0]', 'append 列表[0]', 'strip 列表[0]', 'reverse 列表[0]'],
          answer: 0,
          good: '错误元素被魔法消除。「del——删除指定元素，适时放手。」巨魔彻底崩溃！',
          bad: '巨魔：「del 用于删除。append 添加，reverse 反转，strip 修剪。」',
        },
      ],
    },
  },
  {
    id: 7,
    title: '第七章 · 召唤圣坛',
    subtitle: '函数与模块 · 终章',
    icon: '⛩️',
    badge: { id: 'badge_7', name: '封印师', icon: '🛡️' },
    scenes: [
      {
        id: 'c7s1',
        npcIcon: '🧳',
        npcName: '异乡旅人',
        xp: 20,
        lines: [
          '圣坛边，旅人打开行囊，里面装着随机数、数学库等异国工具。',
          '旅人：「你可以把工具『导入』你的世界，让力量为你所用。」',
        ],
        keywords: ['import'],
        q: {
          prompt: '导入数学库 random，正确的咒语是？',
          options: ['import random', 'def random', 'return random', 'del random'],
          answer: 0,
          good: '你念出 import random，工具飞入真理之书。「import——把别人的智慧变成你的力量。」',
          bad: '旅人：「def 定义，return 返回。要召唤远方的东西，用 import！」',
        },
      },
      {
        id: 'c7s2',
        npcIcon: '🦸',
        npcName: '大导师',
        xp: 20,
        lines: [
          '「七座秘境的符文已集齐，是时候直面 Bug 魔王了。」',
          '「记住你学过的一切：def 创造咒语、return 取回结果、import 连接世界。」',
        ],
      },
    ],
    boss: {
      name: 'Bug 魔王',
      icon: '👿',
      intro: '圣坛上空黑云翻滚，Bug 魔王现身：「碎片没有力量！你还不会『创造』！让我看看你能否用 def、return、import 打败我！」',
      xp: 100,
      keywords: [],
      questions: [
        {
          prompt: '魔王释放无限循环攻击，你需要定义一个「防御」函数——',
          options: ['def 防御(): return "护盾"', 'if 攻击: break', 'for 攻击 in 魔王: print("挡")', 'import 防御'],
          answer: 0,
          good: '你定义了 def 防御()，每次调用都返回护盾挡住攻击。魔王惊讶：「你……创造了新的咒语？」',
          bad: '魔王：「用 def 定义函数，return 返回结果。if 判断、for 循环、import 导入都不是定义。」',
        },
        {
          prompt: '魔王：「你的咒语太弱了！怎么获得更强力量？」',
          options: ['import 星辰之力', 'def 星辰之力()', 'return 星辰之力', 'break 星辰之力'],
          answer: 0,
          good: '你导入星辰之力，圣坛被星光包围，力量瞬间增强数倍。',
          bad: '魔王：「import 导入外部力量。def 是定义，return 是返回。」',
        },
        {
          prompt: '魔王：「用你最强的自定义咒语终结我！」',
          options: ['def 封印(): return "胜利"', 'print("胜利")', 'break', 'while 魔王: 攻击()'],
          answer: 0,
          good: '你大喊「def 封印(): return 胜利」，金色锁链将魔王彻底禁锢。「你已从一个学徒，成长为真正的代码灵师！」',
          bad: '魔王：「print 只是输出，break 只跳循环。要终结我，用 def 定义咒语、return 返回胜利！」',
        },
      ],
    },
  },
];

export const TOTAL_XP = 10 + 20 + 20 + 60 + 20 * 5 + 80 + 20 * 4 + 70 + 20 * 3 + 70 + 20 * 2 + 25 + 25 + 80 + 20 * 4 + 80 + 20 + 20 + 100;
