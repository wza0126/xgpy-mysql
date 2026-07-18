import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { backendClient } from '../../api/backendClient';
import { useGameEventStore } from '../../store/gameEventStore';
import { HonorToast } from './game/HonorToast';

type LearnModule = 'python' | 'it';

const chineseNums = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二', '十三', '十四'];

const getSectionNavTitle = (title: string, index: number) => {
  const parts = title.split('：');
  if (parts.length >= 2) {
    return `${chineseNums[index]}、${parts[1]}`;
  }
  return title;
};

// Python百问
const pythonSections = [
  {
    title: "第一层：Python初印象与环境操作",
    icon: "fa-rocket",
    questions: [
      "Python 是一种什么类型的语言？（编译型还是解释型？）",
      "我们使用什么工具来编写和运行 Python 程序？（IDLE 是什么？）",
      "交互式环境（>>>）和脚本式（.py 文件）运行方式有什么不同？",
      "如何新建一个 .py 文件并运行它？（F5 快捷键的作用？）",
      "注释有什么作用？单行注释和多行注释分别怎么写？",
      "print() 命令的作用是什么？它输出时，带引号和不带引号有什么区别？",
      "input() 命令的作用是什么？它输入的数据默认是什么数据类型？"
    ]
  },
  {
    title: "第二层：数据、常量、变量与数据类型",
    icon: "fa-database",
    questions: [
      "什么是常量？请举例说明。",
      "什么是变量？变量名可以随意起吗？",
      "变量命名必须遵守哪些规则？（哪些字符不能用？能不能以数字开头？）",
      "Python 中的关键字（如 if、for、while）可以当作变量名吗？",
      "学测中要求掌握哪几种基本数据类型？",
      "整型（int） 是什么？举例。",
      "浮点型（float） 是什么？举例。",
      "字符串（str） 有什么特征？（必须用引号括起来？）",
      "布尔型（bool） 只有哪两个值？首字母大小写有要求吗？",
      "如何查看一个变量或数据属于什么类型？（type() 函数的作用？）",
      "赋值号 = 和数学中的等号意义相同吗？a = a + 1 在程序中是什么意思？"
    ]
  },
  {
    title: "第三层：运算符、表达式与类型转换",
    icon: "fa-calculator",
    questions: [
      "Python 中的基本算术运算符有哪些？",
      "+、-、*、/ 分别是什么？（/ 的结果一定是浮点数吗？）",
      "// 是什么运算？（整除，取商的整数部分）",
      "% 是什么运算？（取余数）",
      "** 是什么运算？（幂运算）",
      "字符串能用 + 和 * 运算吗？分别是什么效果？（拼接和重复）",
      "不同类型的数字（整型和浮点型）混合运算时，结果是什么类型？",
      "运算符的优先级是怎样的？（先乘除后加减，括号最优先？）",
      "什么是表达式？3 + 5 * 2 是表达式吗？它会返回一个值吗？",
      "如何将字符串 \"123\" 转换为整数？（int() 函数）",
      "如何将整数转换为浮点数？（float() 函数）",
      "如何将数字转换为字符串？（str() 函数）",
      "关系运算符有哪些？",
      "==（等于）和 =（赋值）能混用吗？",
      "!=（不等于）、>、<、>=、<=、逻辑运算符有哪些？",
      "and（与）、or（或）、not（非）分别表示什么逻辑？"
    ]
  },
  {
    title: "第四层：常用内置函数",
    icon: "fa-square-root-variable",
    questions: [
      "print() 函数如何输出多个内容？（用逗号分隔）",
      "input() 函数的括号里可以写提示文字吗？怎么写？",
      "type() 函数的作用是什么？",
      "int()、float()、str() 三个转换函数各自怎么用？",
      "round() 函数的作用是什么？（四舍五入）比如 round(3.14159, 2) 结果是多少？",
      "abs() 函数的作用是什么？（求绝对值）",
      "max()、min()、sum() 分别有什么作用？它们能作用于列表吗？",
      "len() 函数的作用是什么？（求字符串或列表的长度）"
    ]
  },
  {
    title: "第五层：顺序结构",
    icon: "fa-list-ol",
    questions: [
      "程序默认的执行流程是什么？（从上到下依次执行——这就是顺序结构？）",
      "在顺序结构中，input() 和 print() 的先后顺序会影响程序结果吗？"
    ]
  },
  {
    title: "第六层：选择结构（分支）",
    icon: "fa-code-branch",
    questions: [
      "什么是选择结构？它解决什么问题？（根据条件决定是否执行某段代码）",
      "if 语句的基本格式是什么？（冒号和缩进是必须的吗？缩进通常用几个空格？）",
      "if-else 语句和 if-elif-else 语句有什么区别？",
      "elif 是 else if 的缩写吗？它可以多次使用吗？",
      "条件判断中，关系表达式的结果是什么类型？（布尔型 True 或 False）",
      "如何用 and 表示「并且」的关系？如何用 or 表示「或者」的关系？",
      "如何用 not 对条件取反？",
      "什么是嵌套 if？就是在一个 if 里面再写一个 if 吗？",
      "如何判断一个整数是奇数还是偶数？（用 % 2 == 0 吗？）",
      "如何判断一个年份是否为闰年？（条件是什么？）"
    ]
  },
  {
    title: "第七层：循环结构（一）—— for 循环",
    icon: "fa-sync",
    questions: [
      "什么是循环结构？它解决什么问题？（让代码重复执行）",
      "for 循环通常用于什么场景？（遍历已知范围或序列）",
      "range() 函数有哪几种用法？",
      "range(5) 产生哪些数字？",
      "range(2, 5) 产生哪些数字？",
      "range(1, 10, 2) 产生哪些数字？（步长是什么？）",
      "for 循环如何遍历一个字符串中的每个字符？",
      "for 循环如何遍历一个列表中的每个元素？",
      "循环体中变量的值会随每次循环而变化吗？"
    ]
  },
  {
    title: "第八层：循环结构（二）—— while 循环与流程控制",
    icon: "fa-infinity",
    questions: [
      "while 循环通常用于什么场景？（当不确定循环次数，只知道条件时）",
      "while 循环的格式是什么？它的循环条件是一个布尔表达式吗？",
      "for 循环和 while 循环在什么情况下可以互相替换？",
      "什么是无限循环？while True: 是无限循环吗？如何跳出？",
      "break 语句的作用是什么？（立即终止整个循环）",
      "continue 语句的作用是什么？（跳过本次循环剩余语句，进入下一轮）",
      "循环嵌套是什么？（一个循环里面再套一个循环）",
      "用循环实现累加（如求 1+2+...+100）的思路是什么？",
      "用循环实现累乘（如求 1×2×3×...×10）的思路是什么？",
      "用循环实现计数（如统计 1~100 中偶数的个数）的思路是什么？"
    ]
  },
  {
    title: "第九层：字符串（核心操作）",
    icon: "fa-quote-right",
    questions: [
      "字符串可以用哪些方式表示？（单引号、双引号、三引号？）",
      "什么是字符串索引？索引从 0 开始还是从 1 开始？",
      "对于 s = \"hello\"，s[0] 是什么？s[4] 是什么？",
      "什么是负索引？s[-1] 代表什么？（最后一个字符）",
      "什么是字符串切片？s[1:4] 取到哪些字符？（注意左闭右开原则）",
      "s[:3] 和 s[3:] 分别是什么意思？（省略开始或结束）",
      "如何获取字符串的长度？（用 len(s)）",
      "字符串的常用方法有哪些？",
      ".upper() 和 .lower() 分别做什么？",
      ".strip() 做什么？（去除首尾空白字符）",
      ".split() 做什么？（将字符串按指定字符分割成列表）",
      ".find() 做什么？（查找子串首次出现的位置，找不到返回 -1）",
      ".replace() 做什么？（替换子串）",
      "如何判断一个子串是否在字符串中？（用 in，如 'a' in 'abc'）"
    ]
  },
  {
    title: "第十层：列表（核心操作）",
    icon: "fa-list-ul",
    questions: [
      "列表是什么？用什么符号表示？（方括号 []）",
      "列表中的元素可以是不同类型吗？（如 [1, \"hello\", 3.14]）",
      "列表的索引和切片规则与字符串一样吗？（也是从 0 开始，左闭右开？）",
      "如何获取列表的长度？（用 len()）",
      "列表的常用方法有哪些？",
      ".append() 做什么？（在末尾添加一个元素）",
      ".insert() 做什么？（在指定位置插入元素）",
      ".remove() 做什么？（删除第一个匹配的指定值）",
      ".pop() 做什么？（删除并返回指定位置的元素，默认最后一个）",
      ".sort() 做什么？（默认升序排序）",
      ".reverse() 做什么？（反转列表中元素的顺序）",
      "列表.sort() 和 sorted(列表) 有什么区别？（前者修改原列表，后者返回新列表）",
      "如何遍历列表中的所有元素？（用 for 元素 in 列表:）",
      "如何将字符串转换为列表？（list(\"abc\") 得到 ['a','b','c']）",
      "如何将列表合并为字符串？（用 ''.join(列表)）",
      "什么是\"索引越界\"？访问不存在的索引（如 lst[10]）会怎样？"
    ]
  },
  {
    title: "第十一层：函数与模块",
    icon: "fa-puzzle-piece",
    questions: [
      "什么是函数？为什么要把代码封装成函数？（复用、模块化）",
      "如何定义一个函数？（用 def 函数名(参数):）",
      "函数的参数是什么？调用时传入的数据叫参数吗？",
      "函数的返回值是什么？用什么关键字返回？（return）",
      "如果一个函数没有写 return，它返回什么？（None）",
      "什么是局部变量？在函数内部定义的变量，能在函数外部使用吗？",
      "什么是全局变量？在函数内部能直接修改全局变量吗？（通常不能，除非用 global）",
      "什么是模块？如何导入模块？",
      "import math 后如何使用 math.sqrt()？",
      "from math import sqrt 后如何使用 sqrt()？",
      "学测常考的 math 模块中有哪些函数和常量？",
      "math.sqrt() 求平方根、math.ceil() 向上取整、math.floor() 向下取整、math.pi 圆周率",
      "学测常考的 random 模块中有哪些函数？",
      "random.random() 生成 [0,1) 的随机浮点数",
      "random.randint(a, b) 生成 [a, b] 的随机整数",
      "random.choice(列表) 从列表中随机选一个元素",
      "time 模块中的 time.sleep() 有什么作用？（让程序暂停）"
    ]
  },
  {
    title: "第十二层：异常处理（简单容错）",
    icon: "fa-triangle-exclamation",
    questions: [
      "程序运行时出错（如除以零、类型错误）怎么办？什么是异常？",
      "如何捕获异常，让程序不崩溃？（用 try-except）",
      "try-except 的基本格式是什么？",
      "try: 下面写可能出错的代码，except: 下面写出错后执行的代码",
      "可以指定捕获特定类型的异常吗？（如 except ZeroDivisionError:）"
    ]
  },
  {
    title: "第十三层：算法基础与流程图",
    icon: "fa-diagram-project",
    questions: [
      "什么是算法？它和程序是什么关系？",
      "算法的描述方式有哪些？（自然语言、流程图、伪代码、程序代码）",
      "流程图中的基本符号你认识吗？",
      "起止框（圆角矩形）表示什么？",
      "处理框（矩形）表示什么？",
      "判断框（菱形）表示什么？",
      "输入/输出框（平行四边形）表示什么？",
      "流程线（箭头）表示什么？",
      "学测中常考的算法思想有哪些？",
      "枚举（穷举）法：把所有可能情况一一列举并检验？（如百钱买百鸡）",
      "累加器：用一个变量不断累加数值（如求总和）",
      "累乘器：用一个变量不断累乘数值（如求阶乘）",
      "计数器：统计满足某个条件的个数",
      "打擂台法：求一组数据中的最大值或最小值（如何初始化擂台？）",
      "交换两个变量的值：如何实现？（用临时变量，或 a, b = b, a）"
    ]
  },
  {
    title: "第十四层：综合与易错陷阱（考前必查）",
    icon: "fa-circle-exclamation",
    questions: [
      "缩进错误（IndentationError）是什么原因造成的？如何解决？",
      "把关键字（如 if、for）当作变量名会怎样？",
      "把赋值号 = 误写成比较号 == 会有什么后果？（常见于 if 条件中）",
      "input() 返回的是字符串，如果要用它进行数学比较，应该先做什么？（用 int() 转换）",
      "字符串和数字用 + 拼接时会报错吗？怎么解决？（用 str() 转换数字）",
      "for i in range(n): 循环结束后，变量 i 的值是多少？（是 n-1）",
      "在遍历列表时，如果同时删除列表元素，可能会有什么问题？（建议用 while 或遍历副本）",
      "print() 默认输出后会换行，如何让它不换行？（设置 end=\"\" 参数）",
      "在循环中使用 break 和 continue 时，要注意什么？（break 彻底结束，continue 只跳过本次）",
      "学测的编程大题通常是什么模式？（输入 → 处理（计算/判断/循环）→ 输出）"
    ]
  }
];

// IT百问（学业水平测试信息技术）
const itSections = [
  {
    title: "一、信息与信息技术",
    icon: "fa-circle-info",
    questions: [
      "信息的五个基本特征分别是什么？（传递性、共享性等）",
      "人类历史上的五次信息技术革命顺序是什么？（语言→文字→印刷等）",
      "信息技术的核心支撑技术是什么？（计算机与通信技术）",
      "构成世界的三大资源是什么？（信息、物质、能量）",
      "信息社会中三大核心资源是什么？（信息、知识、人才）",
      "信息处理的一般过程包含哪些环节？（采集→存储→加工等）",
      "信息表达技术有哪些常见方式？（文字、声音、图像等）",
      "信息传递与信息共享的区别是什么？（传递一对多/共享不损耗）",
      "信息的载体形式有哪些？（文字、图形、声音等）",
      "信息获取的基本方法有哪些？（直接获取、间接获取）"
    ]
  },
  {
    title: "二、计算机基础（硬件）",
    icon: "fa-microchip",
    questions: [
      "计算机系统由哪两大部分组成？（硬件系统和软件系统）",
      "计算机硬件系统五大部件是什么？（运算器、控制器等）",
      "CPU由哪两部分构成？（运算器和控制器）",
      "运算器的主要功能是什么？（算术与逻辑运算）",
      "控制器的主要功能是什么？（指挥协调各部件）",
      "存储器分为哪两大类？（内存储器和外存储器）",
      "内存储器和外存储器的区别是什么？（内速快/外容量大）",
      "输入设备有哪些常见例子？（键盘、鼠标、扫描仪）",
      "输出设备有哪些常见例子？（显示器、打印机等）",
      "内存的RAM和ROM有什么区别？（断电丢失/断电不丢）",
      "计算机的工作原理是什么？（存储程序与程序控制）",
      "存储容量的基本单位是什么？（字节Byte）",
      "计算机中数据存储的最小单位是什么？（比特bit）",
      "1GB等于多少MB？（1024MB）",
      "计算机的启动过程依赖什么程序？（BIOS基本输入输出）",
      "外存中的程序要运行必须先调入哪里？（内存）"
    ]
  },
  {
    title: "三、计算机基础（软件）",
    icon: "fa-laptop-code",
    questions: [
      "计算机软件分为哪两大类？（系统软件和应用软件）",
      "系统软件的核心是什么？（操作系统）",
      "操作系统的功能有哪些？（管理软硬件资源）",
      "常见的操作系统有哪些？（Windows、Linux等）",
      "应用软件和系统软件的区别是什么？（解决具体/通用管理）",
      "应用软件有哪些常见例子？（Office、Photoshop等）",
      "程序设计语言经历了哪几个发展阶段？（机器→汇编→高级）",
      "机器语言、汇编语言、高级语言的区别是什么？（机器可直接执行）",
      "什么是源程序？什么是目标程序？（高级语言写/机器语言）",
      "编译程序和解释程序的区别是什么？（整体翻译/逐句翻译）",
      "软件和硬件的关系是什么？（相互依赖、不可分割）"
    ]
  },
  {
    title: "四、进制与编码",
    icon: "fa-0",
    questions: [
      "计算机采用什么进制计数？（二进制）",
      "二进制的基本数码是哪两个？（0和1）",
      "十进制数转换成二进制数的方法是什么？（除以2倒取余）",
      "二进制数转换成十进制数的方法是什么？（按权展开求和）",
      "十六进制的基本数码有哪些？（0-9和A-F）",
      "ASCII码的作用是什么？（字符统一编码）",
      "ASCII码中大写字母和小写字母谁大谁小？（小写字母更大）",
      "汉字的编码方式有哪些？（输入码、机内码等）",
      "图像在计算机中是如何表示的？（像素点阵/位图）",
      "声音在计算机中是如何表示的？（采样与量化）",
      "位（bit）与字节（Byte）的关系是什么？（1Byte=8bit）",
      "1KB等于多少字节？（1024字节）",
      "为什么计算机采用二进制？（电路易实现两种状态）"
    ]
  },
  {
    title: "五、网络技术基础",
    icon: "fa-network-wired",
    questions: [
      "计算机网络按覆盖地域分为哪几类？（局域网、城域网等）",
      "路由器在网络中的主要作用是什么？（连接不同网络）",
      "交换机的基本功能是什么？（连接局域网设备）",
      "LAN、WAN、MAN分别代表什么？（局、城、广域网）",
      "防火墙在网络中的作用是什么？（安全防护隔离）",
      "DNS配置错误会导致什么后果？（域名无法解析）",
      "IP地址由几段数字组成？（4段）",
      "TCP/IP协议的主要功能是什么？（网络通信规则）",
      "URL由哪几个部分组成？（协议+域名+路径）",
      "能登录QQ但打不开网页，可能是什么原因？（DNS出问题）",
      "局域网中IP地址冲突如何解决？（修改IP地址）",
      "SSID代表什么含义？（无线网络名称）",
      "FTP协议的全称及功能是什么？（文件传输协议）",
      "B/S结构指的是什么？（浏览器/服务器模式）",
      "无线局域网的英文缩写是什么？（WLAN）",
      "网关的主要作用是什么？（连接异构网络）",
      "网络拓扑结构有哪些常见类型？（总线、星型等）",
      "IP地址和域名之间的关系是什么？（域名对应IP）",
      "域名系统的功能是什么？（域名解析为IP）",
      "常见的顶级域名有哪些？（.com、.cn等）",
      "网页和网站的区别是什么？（网页是网站组成）",
      "HTTP协议的主要功能是什么？（网页传输规则）",
      "WWW的中文名称是什么？（万维网）",
      "电子邮件系统中SMTP和POP3分别起什么作用？（发信/收信）",
      "电子邮件地址的格式是什么？（用户名@域名）",
      "计算机网络最主要的两个功能是什么？（资源共享、通信）",
      "数字信号和模拟信号哪个更适合远距离传输？（数字信号）",
      "常用网络传输介质有哪些？（双绞线、光纤等）",
      "Internet的中文名称是什么？（因特网）",
      "上网时输入域名后，谁负责将域名解析成IP地址？（DNS服务器）"
    ]
  },
  {
    title: "六、物联网",
    icon: "fa-wifi",
    questions: [
      "物联网的三层体系结构是什么？（感知、网络、应用层）",
      "感知层包含哪些常见设备？（传感器、RFID等）",
      "温度传感器检测的是什么物理量？（温度值）",
      "RFID技术的典型应用有哪些？（门禁、ETC等）",
      "ETC系统主要使用什么技术？（RFID射频识别）",
      "5G通信技术属于物联网的哪一层？（网络层）",
      "物联网和互联网有什么区别？（物物相连/人人相连）",
      "智能家居属于物联网的什么应用？（物联网应用）",
      "传感器在物联网中起什么作用？（采集物理信息）",
      "物联网的核心是什么？（感知与互联）"
    ]
  },
  {
    title: "七、信息安全与信息社会",
    icon: "fa-shield-halved",
    questions: [
      "计算机病毒的主要特征有哪些？（传染、隐蔽等）",
      "设置安全密码的基本要求是什么？（长度+复杂度）",
      "连接公共Wi-Fi时应注意什么？（避免敏感操作）",
      "使用公用计算机后必须做什么操作？（清除浏览记录）",
      "网络道德规范包含哪些基本要求？（守法、文明等）",
      "《数据安全法》于哪一年开始施行？（2021年）",
      "个人信息保护的核心原则是什么？（知情同意）",
      "网络诈骗常见手段有哪些？（钓鱼、中奖等）",
      "数字签名的主要作用是什么？（身份认证防篡改）",
      "网络安全中加密技术的作用是什么？（保证数据保密）",
      "知识产权保护在信息社会中的意义是什么？（鼓励创新）",
      "信息污染指的是什么？（无用信息过载）",
      "计算机病毒和生物病毒有什么区别？（人为程序/生物）",
      "什么是黑客行为？（非法入侵计算机）",
      "保护个人信息安全的基本措施有哪些？（密码+不泄露）"
    ]
  },
  {
    title: "八、人工智能",
    icon: "fa-robot",
    questions: [
      "语音识别技术的英文简称是什么？（ASR）",
      "虚拟现实技术的核心特点是什么？（沉浸式交互）",
      "哪些常见应用属于人工智能领域？（人脸识别等）",
      "人工智能研究的根本目标是什么？（模拟人类智能）",
      "自然语言处理主要研究什么？（人机语言交互）",
      "机器学习的基本原理是什么？（数据学习规律）",
      "深度学习与传统机器学习的区别是什么？（多隐层网络）",
      "人脸识别应用了什么技术？（深度学习图像识别）",
      "智能客服背后的技术是什么？（自然语言处理）",
      "人工智能、机器学习、深度学习三者的关系是什么？（层层包含）",
      "图灵测试是用来测试什么的？（机器是否智能）",
      "人工智能的主要研究领域有哪些？（语音、图像等）",
      "专家系统属于人工智能的哪个领域？（知识表示推理）",
      "自动驾驶使用了哪些人工智能技术？（感知+决策等）",
      "生成式人工智能（如ChatGPT）属于什么技术？（大语言模型）"
    ]
  },
  {
    title: "九、信息系统与数据管理",
    icon: "fa-database",
    questions: [
      "信息系统的基本功能有哪些？（采集、存储等）",
      "信息系统以什么技术为基础？（计算机与网络技术）",
      "大数据的主要特征有哪些？（大量、多样等）",
      "数据采集分为哪两种方式？（自动、手动采集）",
      "模拟信号与数字信号的根本区别是什么？（连续/离散）",
      "信息、数据与知识三者之间的关系是什么？（层层递进加工）",
      "数据分析报告的主要作用是什么？（辅助决策）",
      "关系数据库中主键的特征要求是什么？（唯一、非空）",
      "数据库管理系统的基本功能有哪些？（增删改查等）",
      "数据备份的主要目的是什么？（防止数据丢失）",
      "信息系统由哪些要素构成？（人、硬件、软件等）",
      "结构化数据和非结构化数据的区别是什么？（表格/无固定格式）",
      "数据仓库的主要作用是什么？（历史数据分析）",
      "数据挖掘的基本任务是什么？（发现隐含规律）",
      "云计算对信息系统有什么影响？（降低成本弹性扩展）"
    ]
  },
  {
    title: "十、多媒体技术",
    icon: "fa-photo-film",
    questions: [
      "多媒体技术的主要特征有哪些？（集成、交互等）",
      "常见的图像文件格式有哪些？（JPEG、PNG等）",
      "常见的音频文件格式有哪些？（MP3、WAV等）",
      "常见的视频文件格式有哪些？（MP4、AVI等）",
      "位图图像和矢量图像的区别是什么？（像素/数学描述）",
      "图像分辨率指的是什么？（像素密度）",
      "音频采样频率对音质有什么影响？（越高越清晰）",
      "视频帧率指的是什么？（每秒画面数）",
      "数据压缩分为哪两种类型？（有损、无损压缩）",
      "有损压缩和无损压缩的区别是什么？（丢失质量/完全还原）"
    ]
  }
];

export const LearnModule: React.FC = () => {
  const [currentModule, setCurrentModule] = useState<LearnModuleType>('python');
  const [selectedSection, setSelectedSection] = useState(0);
  const [visitedQuestions, setVisitedQuestions] = useState<Set<string>>(new Set());
  const [currentHonor, setCurrentHonor] = useState<any>(null);

  const emitEvent = useGameEventStore.getState().emitEvent;

  const sections = currentModule === 'python' ? pythonSections : itSections;
  const modulePrefix = currentModule === 'python' ? 'py' : 'it';
  const moduleColor = currentModule === 'python'
    ? 'from-orange-500 to-yellow-500'
    : 'from-blue-500 to-cyan-500';
  const moduleAccent = currentModule === 'python' ? 'text-orange-500' : 'text-blue-500';
  const moduleBorder = currentModule === 'python' ? 'border-orange-300' : 'border-blue-300';

  // 计算总问题数（当前模块）
  const totalQuestions = sections.reduce((sum, s) => sum + s.questions.length, 0);
  const visitedCount = Array.from(visitedQuestions).filter(k => k.startsWith(`${modulePrefix}-`)).length;

  // 初始化从数据库加载访问记录
  useEffect(() => {
    const loadVisited = async () => {
      try {
        const result = await backendClient.get('/api/student/learn-visited');
        if (result.data) {
          setVisitedQuestions(new Set(result.data));
        }
      } catch (e) {
        console.error('加载学习已看记录失败:', e);
      }
    };
    loadVisited();
  }, []);

  // 保存访问记录到数据库
  const saveVisited = (key: string, questionText: string) => {
    backendClient.post('/api/student/learn-visited', {
      question_key: key,
      question_text: questionText
    }).catch(e => console.error('保存学习已看记录失败:', e));
  };

  // 点击问题：标记已访问 + 打开AI答疑 + 学习打卡
  const handleQuestionClick = (question: string, index: number) => {
    const key = `${modulePrefix}-${selectedSection}-${index}`;

    const newVisited = new Set(visitedQuestions);
    const isNewVisit = !newVisited.has(key);
    newVisited.add(key);
    setVisitedQuestions(newVisited);
    saveVisited(key, question);

    if (isNewVisit) {
      handleStudiousCheckin();
    }

    if ((window as any).openAiQaWindow) {
      (window as any).openAiQaWindow({ question });
    }
  };

  const handleStudiousCheckin = async () => {
    try {
      const result = await backendClient.post('/api/student/learn-studious-checkin', {});
      if (result.data?.triggered && result.data?.honor) {
        setCurrentHonor({
          type: result.data.honor.type,
          name: result.data.honor.name,
          description: result.data.honor.description,
        });
        emitEvent('studious');
      }
    } catch (e) {
      console.error('学习打卡失败:', e);
    }
  };

  // 检查问题是否已访问
  const isVisited = (index: number) => {
    return visitedQuestions.has(`${modulePrefix}-${selectedSection}-${index}`);
  };

  return (
    <div className="flex h-full bg-gray-50">
      <HonorToast honor={currentHonor} onDismiss={() => setCurrentHonor(null)} />
      {/* 左侧导航栏 */}
      <div className="w-72 bg-white border-r border-gray-200 overflow-y-auto">
        {/* 模块切换标签 */}
        <div className="sticky top-0 bg-white border-b border-gray-200 shadow-lg z-10">
          <div className="flex">
            <button
              onClick={() => { setCurrentModule('python'); setSelectedSection(0); }}
              className={`flex-1 py-3 px-2 text-sm font-medium transition-all ${
                currentModule === 'python'
                  ? 'text-orange-600 border-b-2 border-orange-500 bg-orange-50'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
              }`}
            >
              <i className="fab fa-python mr-1"></i> Python百问
            </button>
            <button
              onClick={() => { setCurrentModule('it'); setSelectedSection(0); }}
              className={`flex-1 py-3 px-2 text-sm font-medium transition-all ${
                currentModule === 'it'
                  ? 'text-blue-600 border-b-2 border-blue-500 bg-blue-50'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
              }`}
            >
              <i className="fas fa-laptop-code mr-1"></i> IT百问
            </button>
          </div>
          {/* 进度信息 */}
          <div className={`p-3 bg-gradient-to-r ${moduleColor} text-white`}>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-white/20 rounded-lg flex items-center justify-center">
                <i className={`${currentModule === 'python' ? 'fab fa-python' : 'fas fa-laptop-code'} text-xl`}></i>
              </div>
              <div>
                <h2 className="font-bold">{currentModule === 'python' ? 'Python百问' : 'IT百问'}</h2>
                <div className="text-xs text-white/80">
                  已看 <span className="font-bold">{visitedCount}</span>/{totalQuestions}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 章节列表 */}
        <div className="p-2">
          <div className="space-y-1">
            {sections.map((section, index) => (
              <button
                key={index}
                onClick={() => setSelectedSection(index)}
                className={`w-full text-left px-4 py-3 rounded-xl transition-all duration-200 ${
                  selectedSection === index
                    ? `bg-gradient-to-r ${moduleColor} text-white shadow-md`
                    : 'hover:bg-gray-100 text-gray-700'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                    selectedSection === index ? 'bg-white/20' : 'bg-gray-100'
                  }`}>
                    <i className={`fas ${section.icon} ${selectedSection === index ? 'text-white' : moduleAccent}`}></i>
                  </div>
                  <div className="flex-1">
                    <div className={`text-sm font-medium ${
                      selectedSection === index ? 'text-white' : 'text-gray-800'
                    }`}>
                      {getSectionNavTitle(section.title, index)}
                    </div>
                    <div className={`text-xs mt-0.5 ${
                      selectedSection === index ? 'text-white/80' : 'text-gray-500'
                    }`}>
                      {section.questions.length} 个问题
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 右侧内容区 */}
      <div className="flex-1 overflow-y-auto">
        <AnimatePresence mode="wait">
          <motion.div
            key={selectedSection}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.2 }}
            className="p-6"
          >
            {/* 章节标题 */}
            <div className="mb-6">
              <div className="flex items-center gap-3 mb-2">
                <div className={`w-12 h-12 bg-gradient-to-br ${moduleColor} rounded-xl flex items-center justify-center`}>
                  <i className={`fas ${sections[selectedSection].icon} text-white text-xl`}></i>
                </div>
                <div>
                  <h1 className="text-2xl font-bold text-gray-800">{sections[selectedSection].title}</h1>
                  <p className="text-gray-500 text-sm">共 {sections[selectedSection].questions.length} 个问题</p>
                </div>
              </div>
            </div>

            {/* 问题列表 */}
            <div className="space-y-3">
              {sections[selectedSection].questions.map((question, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: index * 0.03 }}
                >
                  <div
                    onClick={() => handleQuestionClick(question, index)}
                    className={`group relative p-4 rounded-xl cursor-pointer transition-all duration-200 ${
                      isVisited(index)
                        ? 'bg-green-50 border-2 border-green-300 hover:border-green-400 hover:bg-green-100'
                        : `bg-white border-2 border-gray-100 hover:${moduleBorder} hover:shadow-md`
                    }`}
                  >
                    {/* 已访问标记 */}
                    {isVisited(index) && (
                      <div className="absolute -top-2 -right-2 w-6 h-6 bg-green-500 rounded-full flex items-center justify-center shadow-sm">
                        <i className="fas fa-check text-white text-xs"></i>
                      </div>
                    )}

                    <div className="flex items-start gap-4">
                      {/* 序号 */}
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                        isVisited(index) ? 'bg-green-100' : 'bg-gray-100'
                      }`}>
                        <span className={`text-sm font-bold ${
                          isVisited(index) ? 'text-green-600' : 'text-gray-500'
                        }`}>
                          {index + 1}
                        </span>
                      </div>

                      {/* 问题内容 */}
                      <div className="flex-1">
                        <p className={`text-base leading-relaxed ${
                          isVisited(index) ? 'text-green-800' : 'text-gray-700'
                        }`}>
                          {question}
                        </p>
                      </div>

                      {/* AI答疑按钮 */}
                      <div className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                        isVisited(index)
                          ? 'bg-green-500 text-white group-hover:bg-green-600'
                          : `bg-gradient-to-r ${moduleColor} text-white opacity-0 group-hover:opacity-100`
                      }`}>
                        <i className="fas fa-robot mr-1"></i>
                        {isVisited(index) ? '再看一次' : 'AI答疑'}
                      </div>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>

            {/* 底部统计 */}
            <div className="mt-8 pt-6 border-t border-gray-200">
              <div className="flex items-center justify-between text-sm text-gray-500">
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded bg-white border-2 border-gray-200"></div>
                    <span>未访问</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded bg-green-50 border-2 border-green-300 flex items-center justify-center">
                      <i className="fas fa-check text-green-500 text-xs"></i>
                    </div>
                    <span>已访问</span>
                  </div>
                </div>
                <div>
                  本层进度：{sections[selectedSection].questions.filter((_, i) => isVisited(i)).length}/{sections[selectedSection].questions.length}
                </div>
              </div>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
};
