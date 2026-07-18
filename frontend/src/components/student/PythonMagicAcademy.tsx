import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../../hooks/useAuth';
import { backendClient } from '../../api/backendClient';
import { useDesktopStore } from '../../store/desktopStore';
import { Chapter, GameProgress, NPC, Badge } from '../../types/python-magic';
import { GameDialogue } from './python-magic/GameDialogue';
import { MagicBook } from './python-magic/MagicBook';
import { CodeChallenge } from './python-magic/CodeChallenge';
import { BossBattle } from './python-magic/BossBattle';
import { AIPartner } from './python-magic/AIPartner';
import { Inventory } from './python-magic/Inventory';

interface Props {
  onClose: () => void;
}

const fullChapters: Chapter[] = [
  {
    id: 1,
    title: '输出魔法',
    subtitle: 'print()咒语',
    professor: {
      id: 'prof_print',
      name: '普林特教授',
      title: '输出魔法导师',
      description: '专精于输出魔法的教授，能让任何信息显示在屏幕上',
      avatar: '📜',
    },
    dialogues: [
      { npcId: 'prof_print', text: '欢迎来到输出魔法课堂！我是普林特教授。' },
      { npcId: 'prof_print', text: '在Python魔法世界中，print()是最基础也最重要的咒语之一。' },
      { npcId: 'prof_print', text: '它能将你想表达的内容显示在控制台上——就像施展了一个显示魔法！' },
      { npcId: 'prof_print', text: '无论是文字、数字还是运算结果，print()都能帮你展示出来。' },
      { npcId: 'prof_print', text: '来，让我们开始第一次魔法实践吧！' },
    ],
    magicBook: {
      title: 'print()输出函数',
      content: [
        'print()函数用于在控制台输出信息，是Python中最常用的函数之一',
        '可以输出字符串（用引号括起来的文字）、数字、变量等内容',
        '多个内容用逗号分隔，print()会自动在它们之间加空格',
        'print()执行完毕后会自动换行，让输出更整洁',
      ],
      examples: [
        { code: 'print("Hello, World!")', description: '输出一段文字，字符串需要用引号包裹' },
        { code: 'print(100)', description: '输出一个数字，数字不需要引号' },
        { code: 'print("年龄:", 18)', description: '输出多个内容，用逗号分隔' },
        { code: 'print("第一行")\nprint("第二行")', description: '多个print语句会分行显示' },
      ],
    },
    challenges: [
      {
        id: 'ch1_1',
        title: '第一条咒语',
        description: '使用print()输出"Hello, Python魔法学院！"',
        template: 'print("")',
        hint: '在引号内填入内容，注意标点符号要用英文的',
        expectedOutput: 'Hello, Python魔法学院！',
        xpReward: 20,
      },
      {
        id: 'ch1_2',
        title: '自我介绍',
        description: '用三行print分别输出你的名字、年龄和爱好',
        template: 'print("我的名字是：")\nprint("我今年")\nprint("我喜欢")',
        hint: '每行print输出一个信息，在引号内补充完整内容',
        expectedOutput: '',
        xpReward: 30,
      },
    ],
    boss: {
      id: 'boss_1',
      title: '魔力测试',
      description: '输出以下诗句：\n床前明月光\n疑是地上霜\n举头望明月\n低头思故乡',
      template: 'print("")',
      hint: '使用4行print语句，每行输出一句诗',
      expectedOutput: '床前明月光\n疑是地上霜\n举头望明月\n低头思故乡',
      xpReward: 50,
    },
    badge: {
      id: 'badge_1',
      name: '初级咒术师',
      description: '掌握print()输出魔法',
      icon: '📜',
    },
  },
  {
    id: 2,
    title: '数据魔法',
    subtitle: '变量与类型',
    professor: {
      id: 'prof_var',
      name: '瓦里布尔教授',
      title: '数据魔法导师',
      description: '精通各种数据类型的魔法教授，能化无形为有形',
      avatar: '📦',
    },
    dialogues: [
      { npcId: 'prof_var', text: '欢迎来到数据魔法课堂！我是瓦里布尔教授。' },
      { npcId: 'prof_var', text: '变量就像一个个魔法盒子，你可以给它们贴上标签，然后往里面存放各种数据。' },
      { npcId: 'prof_var', text: 'Python中有几种基本数据类型：int（整数）、float（浮点数）、str（字符串）和bool（布尔值）。' },
      { npcId: 'prof_var', text: '使用type()函数可以查看一个数据的类型——就像鉴定魔法的属性一样！' },
      { npcId: 'prof_var', text: '掌握数据类型，你就能更好地驾驭Python魔法！' },
    ],
    magicBook: {
      title: '变量与数据类型',
      content: [
        '变量用等号赋值：变量名 = 值，变量名要见名知意',
        'int（整数）：如 10、-5、999，不带小数点的数字',
        'float（浮点数）：如 3.14、-0.5、2.0，带小数点的数字',
        'str（字符串）：用引号包裹的文字，如 "Hello"、"Python"',
        'bool（布尔值）：只有 True 和 False 两个值，用于判断',
        'type()函数可以返回任意数据的类型',
      ],
      examples: [
        { code: 'name = "小明"\nage = 12\nprint(name, age)', description: '创建变量存储名字和年龄' },
        { code: 'pi = 3.14\nprint(pi)\nprint(type(pi))', description: '浮点数变量和type()用法' },
        { code: 'is_student = True\nprint(is_student)\nprint(type(is_student))', description: '布尔值变量' },
      ],
    },
    challenges: [
      {
        id: 'ch2_1',
        title: '创建变量',
        description: '创建三个变量：name存储你的名字（字符串）、age存储年龄（整数）、power存储魔力值（浮点数），然后分别输出它们',
        template: 'name = ""\nage = \npower = \nprint(name)\nprint(age)\nprint(power)',
        hint: '字符串用引号，整数直接写数字，浮点数要带小数点',
        expectedOutput: '',
        xpReward: 25,
      },
      {
        id: 'ch2_2',
        title: '数据类型鉴定',
        description: '使用type()函数判断以下数据的类型：100、3.14、"Python"、True',
        template: 'print(type(100))\nprint(type())\nprint(type())\nprint(type())',
        hint: '在type()的括号里填入要判断的数据',
        expectedOutput: "<class 'int'>\n<class 'float'>\n<class 'str'>\n<class 'bool'>",
        xpReward: 30,
      },
    ],
    boss: {
      id: 'boss_2',
      title: '数据类型分类',
      description: '创建变量存储以下信息并输出它们的类型：\n1. 你的名字（字符串）\n2. 你的身高（浮点数）\n3. 是否学过编程（布尔值）\n4. 你的出生年份（整数）',
      template: 'name = ""\nheight = \nhas_studied = \nyear = \nprint(type(name))\nprint(type(height))\nprint(type(has_studied))\nprint(type(year))',
      hint: '布尔值只有 True 和 False 两种取值',
      expectedOutput: '',
      xpReward: 50,
    },
    badge: {
      id: 'badge_2',
      name: '数据学徒',
      description: '掌握变量与数据类型',
      icon: '📦',
    },
  },
  {
    id: 3,
    title: '交互魔法',
    subtitle: 'input()与运算',
    professor: {
      id: 'prof_input',
      name: '因普特教授',
      title: '交互魔法导师',
      description: '擅长与使用者对话的教授，让程序学会倾听',
      avatar: '🎙️',
    },
    dialogues: [
      { npcId: 'prof_input', text: '你好，小魔法师！我是因普特教授，专攻交互魔法。' },
      { npcId: 'prof_input', text: 'input()函数能让你的程序和用户对话——程序提问，用户回答！' },
      { npcId: 'prof_input', text: '不过要记住，input()返回的是字符串，做数学运算前需要用int()或float()转换。' },
      { npcId: 'prof_input', text: 'Python还有几个实用的运算符：//整除、%取余、**幂运算。' },
      { npcId: 'prof_input', text: '学会了这些，你就能制作出真正的交互式程序了！' },
    ],
    magicBook: {
      title: 'input()与运算符',
      content: [
        'input("提示语")可以从用户获取输入，括号里可以写提示文字',
        'input()返回的数据类型是字符串（str）',
        'int()将数据转换为整数类型，float()转换为浮点数类型',
        '/ 是普通除法（返回浮点数），// 是整除（取商的整数部分）',
        '% 是取余运算（返回除法的余数），** 是幂运算',
      ],
      examples: [
        { code: 'name = input("请输入你的名字：")\nprint("你好，" + name)', description: '获取用户输入并打招呼' },
        { code: 'a = int(input("请输入第一个数："))\nb = int(input("请输入第二个数："))\nprint("和：", a + b)', description: '将输入转为整数后计算' },
        { code: 'print("13 // 5 =", 13 // 5)\nprint("13 % 5 =", 13 % 5)\nprint("2 ** 3 =", 2 ** 3)', description: '整除、取余和幂运算' },
      ],
    },
    challenges: [
      {
        id: 'ch3_1',
        title: '互动问答',
        description: '编写一个程序：询问用户的名字和年龄，然后打印出"你好，XX！你今年XX岁。"',
        template: 'name = input("请输入你的名字：")\nage = input("请输入你的年龄：")\nprint("你好，"， "！你今年"， "岁。")',
        hint: '使用逗号分隔多个输出内容，变量不需要加引号',
        expectedOutput: '',
        xpReward: 25,
      },
      {
        id: 'ch3_2',
        title: '数学运算练习',
        description: '输入两个整数a和b，输出a整除b的结果、a除以b的余数、a的b次幂',
        template: 'a = int(input("请输入a："))\nb = int(input("请输入b："))\nprint()\nprint()\nprint()',
        hint: '分别使用 //、% 和 ** 运算符',
        expectedOutput: '',
        xpReward: 30,
      },
    ],
    boss: {
      id: 'boss_3',
      title: '简单计算器',
      description: '制作一个简单计算器：输入两个数字和一个运算符（+、-、*、/），输出计算结果',
      template: 'a = float(input("请输入第一个数字："))\nb = float(input("请输入第二个数字："))\nop = input("请输入运算符（+、-、*、/）：")\nif op == "+":\n    print(a + b)\nelif op == "-":\n    print(a - b)\nelif op == "*":\n    print(a * b)\nelif op == "/":\n    print(a / b)\nelse:\n    print("无效运算符")',
      hint: '使用if-elif-else判断不同的运算符，注意除法时分母不能为0',
      expectedOutput: '',
      xpReward: 50,
    },
    badge: {
      id: 'badge_3',
      name: '交互法师',
      description: '掌握input()与运算符',
      icon: '🎙️',
    },
  },
  {
    id: 4,
    title: '决断魔法',
    subtitle: '程序分支',
    professor: {
      id: 'prof_branch',
      name: '布兰奇教授',
      title: '决断魔法导师',
      description: '掌握判断之力的教授，让程序学会做决定',
      avatar: '⚖️',
    },
    dialogues: [
      { npcId: 'prof_branch', text: '我是布兰奇教授，今天我们来学习如何让程序做决定！' },
      { npcId: 'prof_branch', text: 'if语句就像是一个岔路口——条件成立走一条路，不成立走另一条。' },
      { npcId: 'prof_branch', text: 'elif可以添加多个判断条件，else处理所有不满足的情况。' },
      { npcId: 'prof_branch', text: '比较运算符（>、<、==、!=）和逻辑运算符（and、or、not）是构建条件的好帮手。' },
      { npcId: 'prof_branch', text: '掌握了分支魔法，你的程序就能根据情况做出不同的反应了！' },
    ],
    magicBook: {
      title: 'if条件判断语句',
      content: [
        'if 条件: 后面跟冒号，下一行缩进的代码在条件为True时执行',
        'elif 条件: 用于添加额外的判断条件，可多个elif连用',
        'else: 处理所有前面条件都不满足的情况',
        '比较运算符：>（大于）、<（小于）、>=（大于等于）、<=（小于等于）、==（等于）、!=（不等于）',
        '逻辑运算符：and（且）、or（或）、not（非），用于组合多个条件',
      ],
      examples: [
        { code: 'score = 85\nif score >= 60:\n    print("及格")\nelse:\n    print("不及格")', description: '判断成绩是否及格' },
        { code: 'score = 85\nif score >= 90:\n    print("优秀")\nelif score >= 80:\n    print("良好")\nelif score >= 70:\n    print("中等")\nelif score >= 60:\n    print("及格")\nelse:\n    print("不及格")', description: '多级评分系统' },
        { code: 'year = 2024\nif year % 4 == 0 and year % 100 != 0 or year % 400 == 0:\n    print(year, "是闰年")\nelse:\n    print(year, "不是闰年")', description: '判断闰年' },
      ],
    },
    challenges: [
      {
        id: 'ch4_1',
        title: '成绩等级判断',
        description: '输入一个成绩（0-100），判断等级：90以上"优秀"，80-89"良好"，70-79"中等"，60-69"及格"，60以下"不及格"',
        template: 'score = int(input("请输入成绩："))\nif score >= 90:\n    print("优秀")\nelif :\n    print("良好")\nelif :\n    print("中等")\nelif :\n    print("及格")\nelse:\n    print("不及格")',
        hint: 'elif后面要补全判断条件，如 score >= 80',
        expectedOutput: '',
        xpReward: 30,
      },
      {
        id: 'ch4_2',
        title: '判断闰年',
        description: '输入一个年份，判断它是否为闰年（能被4整除但不能被100整除，或者能被400整除）',
        template: 'year = int(input("请输入年份："))\nif :\n    print(year, "是闰年")\nelse:\n    print(year, "不是闰年")',
        hint: '使用 and 和 or 组合条件：year % 4 == 0 and year % 100 != 0 or year % 400 == 0',
        expectedOutput: '',
        xpReward: 35,
      },
    ],
    boss: {
      id: 'boss_4',
      title: '石头剪刀布',
      description: '实现石头剪刀布游戏：用户输入 石头/剪刀/布，程序随机出拳，判断胜负。提示：需先引入 import random，电脑出拳用 random.choice(["石头", "剪刀", "布"])',
      template: 'import random\nchoices = ["石头", "剪刀", "布"]\nplayer = input("请输入（石头/剪刀/布）：")\ncomputer = random.choice(choices)\nprint("电脑出了：", computer)\nif player == computer:\n    print("平局！")\nelif :\n    print("你赢了！")\nelse:\n    print("你输了！")',
      hint: '判断赢的条件：石头赢剪刀、剪刀赢布、布赢石头',
      expectedOutput: '',
      xpReward: 50,
    },
    badge: {
      id: 'badge_4',
      name: '决断者',
      description: '掌握程序分支结构',
      icon: '⚖️',
    },
  },
  {
    id: 5,
    title: '循环魔法',
    subtitle: 'for与while',
    professor: {
      id: 'prof_loop',
      name: '卢普教授',
      title: '循环魔法导师',
      description: '精通循环之道的教授，让重复的事情交给程序去做',
      avatar: '🔄',
    },
    dialogues: [
      { npcId: 'prof_loop', text: '我是卢普教授！编程中经常需要重复做某件事，循环魔法就是为此而生。' },
      { npcId: 'prof_loop', text: 'for循环适合遍历一个范围内的元素，比如使用range()生成一系列数字。' },
      { npcId: 'prof_loop', text: 'while循环在条件满足时会一直执行，直到条件不再成立。' },
      { npcId: 'prof_loop', text: 'break可以立刻跳出循环，continue则跳过本次循环的剩余部分进入下一次。' },
      { npcId: 'prof_loop', text: '学会了循环，你会发现很多重复的工作都可以交给程序自动完成！' },
    ],
    magicBook: {
      title: '循环结构',
      content: [
        'for 变量 in range(开始, 结束, 步长): 循环执行指定次数',
        'range(n)生成0到n-1的数字序列，range(a,b)生成a到b-1的序列',
        'while 条件: 当条件为True时一直执行循环体',
        'break：立即跳出当前循环；continue：跳过本次循环剩余部分',
        '循环嵌套：循环内部再写循环，可以处理二维结构（如乘法表）',
      ],
      examples: [
        { code: 'for i in range(5):\n    print(i)', description: 'for循环输出0到4' },
        { code: 'for i in range(1, 10):\n    for j in range(1, i+1):\n        print(f"{j}x{i}={i*j}", end="\\t")\n    print()', description: '打印九九乘法表' },
        { code: 'count = 0\nwhile count < 5:\n    print("计数:", count)\n    count += 1', description: 'while循环计数' },
      ],
    },
    challenges: [
      {
        id: 'ch5_1',
        title: '打印九九乘法表',
        description: '使用嵌套for循环打印九九乘法表（格式：1x1=1\\t1x2=2...）',
        template: 'for i in range(1, 10):\n    for j in range(1, i+1):\n        print(f"{j}x{i}={i*j}", end="\\t")\n    print()',
        hint: '外循环控制行数，内循环控制每行的表达式个数',
        expectedOutput: '',
        xpReward: 35,
      },
      {
        id: 'ch5_2',
        title: '猜数字游戏',
        description: '使用while循环实现猜数字游戏：程序生成1-100的随机数，用户猜数字，猜大提示"大了"，猜小提示"小了"，猜中提示"恭喜"并退出',
        template: 'import random\nsecret = random.randint(1, 100)\nwhile True:\n    guess = int(input("请猜一个1-100的数字："))\n    if guess > secret:\n        print("大了")\n    elif guess < secret:\n        print("小了")\n    else:\n        print("恭喜你猜对了！")\n        break',
        hint: '使用无限循环 while True，猜中后使用 break 退出',
        expectedOutput: '',
        xpReward: 40,
      },
    ],
    boss: {
      id: 'boss_5',
      title: '打印菱形图案',
      description: '使用循环打印一个由星号(*)组成的菱形图案，菱形高度为奇数（如7行）',
      template: 'n = 7\nfor i in range(n):\n    spaces = abs(n // 2 - i)\n    stars = n - 2 * spaces\n    print(" " * spaces + "*" * stars)',
      hint: '上半部分空格递减星号递增，下半部分相反。用abs()函数计算空格数',
      expectedOutput: '',
      xpReward: 50,
    },
    badge: {
      id: 'badge_5',
      name: '循环大师',
      description: '掌握循环结构',
      icon: '🔄',
    },
  },
  {
    id: 6,
    title: '集合魔法',
    subtitle: '列表',
    professor: {
      id: 'prof_list',
      name: '利斯特教授',
      title: '集合魔法导师',
      description: '统领列表魔法的教授，让数据井然有序',
      avatar: '📋',
    },
    dialogues: [
      { npcId: 'prof_list', text: '我是利斯特教授。当你有多个数据需要管理时，列表就是最好的容器。' },
      { npcId: 'prof_list', text: '列表用方括号[]表示，里面的元素用逗号隔开，可以存放不同类型的数据。' },
      { npcId: 'prof_list', text: '通过索引可以访问特定位置的元素，索引从0开始。还有append()、insert()、remove()等操作方法。' },
      { npcId: 'prof_list', text: 'len()获取列表长度，切片可以获取列表的一部分。' },
      { npcId: 'prof_list', text: '灵活运用列表，你就能管理任意复杂的集合数据了！' },
    ],
    magicBook: {
      title: '列表操作',
      content: [
        '列表用 [] 定义，如 fruits = ["苹果", "香蕉", "橘子"]',
        '索引从0开始：fruits[0] 获取第一个元素，fruits[-1] 获取最后一个',
        '常用方法：append()末尾添加、insert(位置,元素)插入、remove(元素)删除、pop()弹出',
        'len()获取列表元素个数，sum()计算数值列表总和',
        '切片：列表[开始:结束:步长]，如 fruits[1:3] 获取第2到第3个元素',
      ],
      examples: [
        { code: 'tasks = []\ntasks.append("写作业")\ntasks.append("复习")\ntasks.insert(0, "吃饭")\nprint(tasks)\ntasks.remove("复习")\nprint(tasks)', description: '任务清单的基本操作' },
        { code: 'scores = [85, 92, 78, 95, 88]\naverage = sum(scores) / len(scores)\nprint("平均分:", average)\nprint("最高分:", max(scores))\nprint("最低分:", min(scores))', description: '计算成绩统计信息' },
        { code: 'nums = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]\nprint("前三个:", nums[:3])\nprint("后三个:", nums[-3:])\nprint("偶数位:", nums[1::2])', description: '列表切片用法' },
      ],
    },
    challenges: [
      {
        id: 'ch6_1',
        title: '任务清单管理',
        description: '创建空列表，添加三个任务"学Python"、"做练习"、"写作业"，插入一个任务"休息"到第一个位置，然后删除"写作业"，最后输出列表',
        template: 'tasks = []\ntasks.append("")\ntasks.append("")\ntasks.append("")\ntasks.insert(0, "")\ntasks.remove("")\nprint(tasks)',
        hint: 'append()添加到最后面，insert(0, ...)插入到最前面',
        expectedOutput: '',
        xpReward: 30,
      },
      {
        id: 'ch6_2',
        title: '计算平均分',
        description: '已知一个分数列表 [85, 92, 78, 95, 88, 90]，计算并输出平均分（保留一位小数）',
        template: 'scores = [85, 92, 78, 95, 88, 90]\ntotal = sum(scores)\ncount = len(scores)\naverage = total / count\nprint("平均分：", round(average, 1))',
        hint: '使用sum()求总和，len()求个数，round()保留小数位数',
        expectedOutput: '',
        xpReward: 35,
      },
    ],
    boss: {
      id: 'boss_6',
      title: '学生成绩管理系统',
      description: '实现一个简单的成绩管理系统：\n1. 创建列表存储5名学生的姓名\n2. 创建对应列表存储他们的成绩\n3. 输出所有学生姓名和成绩\n4. 计算并输出班级平均分\n5. 输出最高分的学生姓名',
      template: 'names = ["张三", "李四", "王五", "赵六", "孙七"]\nscores = [88, 92, 76, 95, 83]\nfor i in range(len(names)):\n    print(names[i], ":", scores[i], "分")\naverage = sum(scores) / len(scores)\nprint("班级平均分：", round(average, 1))\nmax_score = max(scores)\nmax_index = scores.index(max_score)\nprint("最高分：", names[max_index], max_score, "分")',
      hint: '使用len()同时遍历两个列表，用max()和index()找到最高分对应的学生',
      expectedOutput: '',
      xpReward: 55,
    },
    badge: {
      id: 'badge_6',
      name: '集合使',
      description: '掌握列表操作',
      icon: '📋',
    },
  },
  {
    id: 7,
    title: '封装魔法',
    subtitle: '函数',
    professor: {
      id: 'prof_func',
      name: '芬克申教授',
      title: '封装魔法导师',
      description: '函数魔法的开创者，教会你如何封装和复用代码',
      avatar: '⚡',
    },
    dialogues: [
      { npcId: 'prof_func', text: '我是芬克申教授，函数魔法的传承者。函数是Python最重要的概念之一！' },
      { npcId: 'prof_func', text: '用def可以定义自己的函数，像创造属于自己的魔法咒语一样！' },
      { npcId: 'prof_func', text: '函数可以接收参数（输入），用return返回结果（输出），实现代码复用。' },
      { npcId: 'prof_func', text: '合理的函数封装能让代码更清晰、更易维护，就像把复杂的魔法分解成几个小咒语。' },
      { npcId: 'prof_func', text: '来吧，完成最后的修行，你就能从Python魔法学院毕业了！' },
    ],
    magicBook: {
      title: '函数的定义与使用',
      content: [
        'def 函数名(参数1, 参数2, ...): 定义一个新的函数',
        '函数体需要缩进，函数可以没有参数也可以有多个参数',
        'return 表达式：将计算结果返回给调用者，没有return返回None',
        '函数定义后需要用 函数名(参数) 的方式调用执行',
        '函数让代码模块化，一次定义多次调用，避免重复代码',
      ],
      examples: [
        { code: 'def greet(name):\n    return name + "你好！"\n\nprint(greet("小明"))\nprint(greet("小红"))', description: '定义函数实现打招呼，传入不同名字得到不同结果' },
        { code: 'def is_prime(n):\n    if n < 2:\n        return False\n    for i in range(2, int(n**0.5) + 1):\n        if n % i == 0:\n            return False\n    return True\n\nprint(is_prime(7))\nprint(is_prime(10))', description: '判断质数的函数' },
        { code: 'def factorial(n):\n    result = 1\n    for i in range(2, n + 1):\n        result *= i\n    return result\n\nprint(factorial(5))\nprint(factorial(10))', description: '计算阶乘的函数' },
      ],
    },
    challenges: [
      {
        id: 'ch7_1',
        title: '判断质数函数',
        description: '编写一个函数 is_prime(n)，判断一个数是否为质数（只能被1和自身整除），并测试7、10、13、20',
        template: 'def is_prime(n):\n    if n < 2:\n        return False\n    for i in range(2, int(n**0.5) + 1):\n        if n % i == 0:\n            return False\n    return True\n\nprint(is_prime(7))\nprint(is_prime(10))\nprint(is_prime(13))\nprint(is_prime(20))',
        hint: '质数从2开始判断，如果能被2到sqrt(n)之间的数整除就不是质数',
        expectedOutput: '',
        xpReward: 35,
      },
      {
        id: 'ch7_2',
        title: '计算阶乘函数',
        description: '编写一个函数 factorial(n)，计算n的阶乘（n! = 1×2×3×...×n），并测试5和10',
        template: 'def factorial(n):\n    result = 1\n    for i in range(2, n + 1):\n        result *= i\n    return result\n\nprint(factorial(5))\nprint(factorial(10))',
        hint: '从1乘到n，用循环累乘。注意0的阶乘是1',
        expectedOutput: '',
        xpReward: 35,
      },
    ],
    boss: {
      id: 'boss_7',
      title: '终极魔法阵：编写问候函数',
      description: '芬克申教授给你最后一关考验：\n1. 定义一个函数 greet(name)，接收名字参数\n2. 在函数中用print()输出 "你好，[名字]！欢迎来到Python魔法学院！"\n3. 调用 greet("小明") 测试效果\n\n提示：函数体记得缩进，字符串用 + 拼接',
      template: 'def greet(name):\n    print("你好，" + name + "！欢迎来到Python魔法学院！")\n\ngreet("小明")',
      hint: '函数定义用 def 关键字，后面跟函数名和冒号；函数体要缩进；调用时传入具体名字',
      expectedOutput: '',
      xpReward: 60,
    },
    badge: {
      id: 'badge_7',
      name: '封装大师',
      description: '掌握函数定义与使用',
      icon: '⚡',
    },
  },
];

const prologueDialogues = [
  { npcId: 'headmaster', text: '欢迎你，新来的小魔法师！我是吉多院长，Python魔法学院的院长。' },
  { npcId: 'headmaster', text: 'Python魔法学院是学习编程魔法的圣地，在这里你将掌握七种强大的魔法！' },
  { npcId: 'headmaster', text: '从输出魔法到封装魔法，每一门课程都会让你变得更加强大。' },
  { npcId: 'headmaster', text: '这本魔法书会记录你学到的所有知识，你的AI伙伴小智会随时帮助你。' },
  { npcId: 'headmaster', text: '好了，现在就让普林特教授开始你的第一堂课吧！祝你好运！' },
];

const npcMap: Record<string, NPC> = {};

fullChapters.forEach((ch) => {
  npcMap[ch.professor.id] = ch.professor;
});

npcMap['headmaster'] = {
  id: 'headmaster',
  name: '吉多院长',
  title: 'Python魔法学院院长',
  description: 'Python魔法学院的创始人，德高望重的长者',
  avatar: '🧙',
};

const XP_PER_CHAPTER = 100;
const ALL_BADGES: Badge[] = fullChapters.map((ch) => ch.badge);

function createEmptyProgress(userId: string): GameProgress {
  return {
    id: '',
    user_id: userId,
    current_chapter: 0,
    current_step: 'dialogue',
    completed_challenges: [],
    badges: [],
    total_xp: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

interface RewardResult {
  granted: boolean;
  points?: number;
  equipment?: {
    id: string;
    name: string;
    icon: string;
    crit_bonus: number;
  };
}

export const PythonMagicAcademy: React.FC<Props> = ({ onClose }) => {
  const { user } = useAuth();
  const { windows, activeWindowId, closeWindow } = useDesktopStore();

  const [view, setView] = useState<'intro' | 'dialogue' | 'magicbook' | 'challenge' | 'boss' | 'graduation'>('intro');
  const [currentChapter, setCurrentChapter] = useState(0);
  const [currentChallengeIndex, setCurrentChallengeIndex] = useState(0);
  const [progress, setProgress] = useState<GameProgress | null>(null);
  const [showInventory, setShowInventory] = useState(false);
  const [showAIPartner, setShowAIPartner] = useState(false);
  const [loading, setLoading] = useState(true);
  const [chapterAnimKey, setChapterAnimKey] = useState(0);
  const [lastReward, setLastReward] = useState<RewardResult | null>(null);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }

    backendClient
      .get('/api/python-magic/progress')
      .then((res: any) => {
        const data = res?.data;
        if (data && data.current_chapter !== undefined) {
          setProgress(data);
          setCurrentChapter(data.current_chapter);

          if (data.current_chapter === 0 && data.current_step === 'dialogue') {
            setView('intro');
          } else if (data.current_step === 'completed' && data.current_chapter >= fullChapters.length) {
            setView('graduation');
          } else if (data.current_step === 'dialogue') {
            setView('dialogue');
          } else if (data.current_step === 'challenge') {
            setView('challenge');
          } else if (data.current_step === 'boss') {
            setView('boss');
          } else {
            setView('dialogue');
          }
        } else {
          const empty = createEmptyProgress(user.id);
          setProgress(empty);
        }
      })
      .catch(() => {
        if (user) {
          const empty = createEmptyProgress(user.id);
          setProgress(empty);
        }
      })
      .finally(() => {
        setLoading(false);
      });
  }, [user]);

  const saveProgress = useCallback(
    async (updates: Partial<GameProgress>) => {
      if (!progress || !user) return;

      const updated = { ...progress, ...updates, updated_at: new Date().toISOString() };
      setProgress(updated);

      try {
        const res: any = await backendClient.post('/api/python-magic/progress', updated);
        if (res?.reward?.granted) {
          setLastReward(res.reward);
        }
      } catch {
        // silent fail
      }
    },
    [progress, user],
  );

  const handleDialogueComplete = useCallback(() => {
    if (currentChapter === 0) {
      setCurrentChapter(1);
      setView('dialogue');
      setChapterAnimKey((k) => k + 1);
      saveProgress({ current_chapter: 1, current_step: 'dialogue' });
    } else {
      setView('magicbook');
      saveProgress({ current_step: 'magicbook' });
    }
  }, [currentChapter, saveProgress]);

  const handleMagicBookComplete = useCallback(() => {
    setView('challenge');
    setCurrentChallengeIndex(0);
    saveProgress({ current_step: 'challenge' });
  }, [saveProgress]);

  const handleChallengeComplete = useCallback(
    (challengeId: string) => {
      const chapter = fullChapters[currentChapter - 1];
      if (!chapter) return;

      const earnedXp =
        chapter.challenges.find((c) => c.id === challengeId)?.xpReward ?? XP_PER_CHAPTER;
      const completedChallenges = [...(progress?.completed_challenges ?? []), challengeId];
      const newXp = (progress?.total_xp ?? 0) + earnedXp;

      if (currentChallengeIndex < chapter.challenges.length - 1) {
        setCurrentChallengeIndex((i) => i + 1);
        saveProgress({
          completed_challenges: completedChallenges,
          total_xp: newXp,
        });
      } else {
        saveProgress({
          completed_challenges: completedChallenges,
          total_xp: newXp,
          current_step: 'boss',
        });
        setView('boss');
      }
    },
    [currentChapter, currentChallengeIndex, progress, saveProgress],
  );

  const handleBossComplete = useCallback(
    (bossId: string) => {
      const chapter = fullChapters[currentChapter - 1];
      if (!chapter) return;

      const earnedXp = chapter.boss.xpReward;
      const newBadges = [...(progress?.badges ?? []), chapter.badge.id];
      const newXp = (progress?.total_xp ?? 0) + earnedXp;

      if (currentChapter < fullChapters.length) {
        const nextChapter = currentChapter + 1;
        setCurrentChapter(nextChapter);
        setCurrentChallengeIndex(0);
        setView('dialogue');
        setChapterAnimKey((k) => k + 1);
        saveProgress({
          current_chapter: nextChapter,
          current_step: 'dialogue',
          badges: newBadges,
          total_xp: newXp,
        });
      } else {
        setView('graduation');
        saveProgress({
          current_chapter: currentChapter,
          current_step: 'completed',
          badges: newBadges,
          total_xp: newXp,
        });
      }
    },
    [currentChapter, progress, saveProgress],
  );

  const handleSelectChapter = useCallback(
    (chapterId: number) => {
      if (chapterId === currentChapter) return;

      const chapter = fullChapters[chapterId - 1];
      if (!chapter) return;

      const completed = (progress?.badges ?? []).includes(chapter.badge.id);

      setCurrentChapter(chapterId);
      setCurrentChallengeIndex(0);
      setView(completed ? 'magicbook' : 'dialogue');
      setChapterAnimKey((k) => k + 1);
      saveProgress({ current_chapter: chapterId, current_step: completed ? 'magicbook' : 'dialogue' });
    },
    [currentChapter, progress, saveProgress],
  );

  const handleRestartFromChapter = useCallback(
    (chapterId: number) => {
      const chapter = fullChapters[chapterId - 1];
      if (!chapter) return;

      setCurrentChapter(chapterId);
      setCurrentChallengeIndex(0);
      setView('dialogue');
      setChapterAnimKey((k) => k + 1);

      const completedChallenges = (progress?.completed_challenges ?? []).filter((id) => {
        for (let i = chapterId; i <= fullChapters.length; i++) {
          const ch = fullChapters[i - 1];
          if (ch && ch.challenges.some((c) => c.id === id)) return false;
        }
        return true;
      });
      const badges = (progress?.badges ?? []).filter((id) => {
        for (let i = chapterId; i <= fullChapters.length; i++) {
          const ch = fullChapters[i - 1];
          if (ch && ch.badge.id === id) return false;
        }
        return true;
      });

      saveProgress({
        current_chapter: chapterId,
        current_step: 'dialogue',
        completed_challenges: completedChallenges,
        badges: badges,
      });
    },
    [progress, saveProgress],
  );

  const chapter = currentChapter > 0 ? fullChapters[currentChapter - 1] : null;
  const currentChallenge = chapter ? chapter.challenges[currentChallengeIndex] : null;
  const isChapterCompleted = chapter
    ? (progress?.badges ?? []).includes(chapter.badge.id)
    : false;
  const hasProgress = progress !== null && progress.total_xp > 0;

  const renderSidebar = () => (
    <div className="flex w-[250px] flex-shrink-0 flex-col border-r border-gray-700/50 bg-gray-900/80">
      <div className="flex items-center gap-3 border-b border-gray-700/50 px-5 py-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-purple-500 to-indigo-600 text-lg shadow-lg shadow-purple-500/20">
          🐍
        </div>
        <div>
          <h2 className="text-sm font-bold text-white">Python 魔法学院</h2>
          <p className="text-[10px] text-gray-500">编程魔法学习之旅</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3">
        <p className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
          课程章节
        </p>
        <div className="space-y-1">
          {fullChapters.map((ch) => {
            const completed = (progress?.badges ?? []).includes(ch.badge.id);
            const unlocked = completed || currentChapter >= ch.id;
            const active = currentChapter === ch.id;

            return (
              <button
                key={ch.id}
                onClick={() => unlocked && handleSelectChapter(ch.id)}
                disabled={!unlocked}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-all ${
                  active
                    ? 'bg-purple-500/20 text-purple-200 shadow-sm shadow-purple-500/10'
                    : completed
                      ? 'bg-emerald-500/10 text-emerald-300'
                      : unlocked
                        ? 'text-gray-300 hover:bg-gray-800/60 hover:text-gray-100'
                        : 'cursor-not-allowed text-gray-600'
                }`}
              >
                <div
                  className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-sm ${
                    active
                      ? 'bg-gradient-to-br from-purple-500 to-indigo-600 text-white shadow-sm'
                      : completed
                        ? 'bg-emerald-500/20 text-emerald-400'
                        : 'bg-gray-800 text-gray-500'
                  }`}
                >
                  {completed ? '✓' : ch.id}
                </div>
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-medium leading-tight ${active ? 'text-white' : ''}`}>
                    {ch.title}
                  </p>
                  <p className="text-[11px] text-gray-500/80">{ch.subtitle}</p>
                </div>
                {!unlocked && (
                  <svg className="h-3.5 w-3.5 flex-shrink-0 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="border-t border-gray-700/50 p-3 space-y-2">
        <button
          onClick={() => setShowInventory((v) => !v)}
          className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm text-gray-300 transition-colors hover:bg-gray-800/60 hover:text-white"
        >
          <span className="text-lg">🏅</span>
          <span>成就与进度</span>
          {progress && progress.total_xp > 0 && (
            <span className="ml-auto rounded-full bg-purple-500/20 px-2 py-0.5 text-[11px] text-purple-300">
              {progress.total_xp} XP
            </span>
          )}
        </button>
        <button
          onClick={() => setShowAIPartner((v) => !v)}
          className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm text-gray-300 transition-colors hover:bg-gray-800/60 hover:text-white"
        >
          <span className="text-lg">🤖</span>
          <span>小智 AI 伙伴</span>
          {showAIPartner && (
            <span className="ml-auto text-[11px] text-cyan-400">已开启</span>
          )}
        </button>
      </div>
    </div>
  );

  const renderIntro = () => (
    <div className="flex flex-1 items-center justify-center">
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="mx-auto max-w-lg text-center"
      >
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.2, type: 'spring', stiffness: 200 }}
          className="mx-auto mb-8 flex h-28 w-28 items-center justify-center rounded-full bg-gradient-to-br from-purple-500 via-indigo-500 to-purple-600 shadow-2xl shadow-purple-500/30"
        >
          <span className="text-5xl">🐍</span>
        </motion.div>

        <motion.h1
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="mb-3 text-4xl font-black text-white"
        >
          Python <span className="bg-gradient-to-r from-purple-400 to-indigo-400 bg-clip-text text-transparent">魔法学院</span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6 }}
          className="mb-3 text-lg text-gray-400"
        >
          欢迎来到编程魔法的世界！
        </motion.p>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.7 }}
          className="mb-8 text-sm leading-relaxed text-gray-500"
        >
          在这里，你将跟随七位教授学习 Python 魔法
          <br />
          掌握输出、数据、交互、决断、循环、集合与封装七大魔法
          {hasProgress && (
            <span className="mt-2 block text-purple-400">
              检测到已有存档，继续你的魔法修行吧！
            </span>
          )}
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.9 }}
          className="flex flex-col items-center gap-3"
        >
          <button
            onClick={() => {
              setView('dialogue');
              setChapterAnimKey((k) => k + 1);
            }}
            className="inline-flex items-center gap-3 rounded-2xl bg-gradient-to-r from-purple-500 to-indigo-600 px-10 py-4 text-lg font-bold text-white shadow-xl shadow-purple-500/30 transition-all hover:from-purple-400 hover:to-indigo-500 hover:shadow-purple-500/50 active:scale-95"
          >
            <span>{hasProgress ? '继续修行' : '开始入学'}</span>
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
          </button>

          {hasProgress && currentChapter > 0 && currentChapter <= fullChapters.length && (
            <p className="text-sm text-gray-500">
              当前进度：第 {currentChapter} 章 · {fullChapters[currentChapter - 1]?.title}
            </p>
          )}
        </motion.div>
      </motion.div>
    </div>
  );

  const renderChapterTransition = () => (
    <div className="flex flex-1 items-center justify-center">
      <motion.div
        key={currentChapter}
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        className="text-center"
      >
        <motion.div
          initial={{ y: -20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="mx-auto mb-6 flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-purple-500 to-indigo-600 text-4xl shadow-xl shadow-purple-500/20"
        >
          {chapter?.professor.avatar}
        </motion.div>
        <motion.h2
          initial={{ y: -10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="mb-2 text-3xl font-bold text-white"
        >
          第 {currentChapter} 章
        </motion.h2>
        <motion.p
          initial={{ y: -10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="mb-1 text-xl text-purple-300"
        >
          {chapter?.title}
        </motion.p>
        <motion.p
          initial={{ y: -10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="text-sm text-gray-500"
        >
          {chapter?.subtitle}
        </motion.p>
      </motion.div>
    </div>
  );

  const renderGraduation = () => (
    <div className="flex flex-1 items-center justify-center">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="mx-auto max-w-lg text-center"
      >
        <motion.div
          initial={{ scale: 0, rotate: -180 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: 'spring', stiffness: 150, delay: 0.2 }}
          className="mx-auto mb-8 flex h-32 w-32 items-center justify-center rounded-full bg-gradient-to-br from-yellow-400 to-amber-600 shadow-2xl shadow-yellow-500/30"
        >
          <span className="text-5xl">🎓</span>
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="mb-4 text-4xl font-black text-white"
        >
          恭喜毕业！
        </motion.h1>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6 }}
          className="space-y-3"
        >
          <p className="text-lg text-purple-300">
            你已掌握 Python 七大魔法，成为一名真正的编程法师！
          </p>

          {progress && (
            <div className="mx-auto mt-6 grid max-w-sm grid-cols-3 gap-4">
              <div className="rounded-xl bg-gray-800/60 p-4">
                <p className="text-2xl font-bold text-yellow-400">{progress.total_xp}</p>
                <p className="text-xs text-gray-400">总经验值</p>
              </div>
              <div className="rounded-xl bg-gray-800/60 p-4">
                <p className="text-2xl font-bold text-emerald-400">{progress.badges.length}</p>
                <p className="text-xs text-gray-400">获得徽章</p>
              </div>
              <div className="rounded-xl bg-gray-800/60 p-4">
                <p className="text-2xl font-bold text-blue-400">7</p>
                <p className="text-xs text-gray-400">通关章节</p>
              </div>
            </div>
          )}

          {(lastReward?.granted || progress?.reward_claimed) && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.8 }}
              className="mx-auto mt-6 max-w-sm rounded-2xl bg-gradient-to-r from-amber-500/20 to-orange-500/20 border border-amber-500/30 p-4"
            >
              <p className="mb-3 text-sm font-semibold text-amber-300">🎉 毕业奖励已发放</p>
              <div className="flex flex-wrap justify-center gap-4">
                {(lastReward?.points || 0) > 0 && (
                  <div className="flex items-center gap-2 rounded-xl bg-yellow-500/20 px-3 py-2">
                    <span className="text-xl">⭐</span>
                    <div className="text-left">
                      <p className="text-sm font-bold text-yellow-400">+{lastReward.points}</p>
                      <p className="text-[10px] text-yellow-600/80">积分</p>
                    </div>
                  </div>
                )}
                {lastReward?.equipment && (
                  <div className="flex items-center gap-2 rounded-xl bg-purple-500/20 px-3 py-2">
                    <span className="text-xl">{lastReward.equipment.icon}</span>
                    <div className="text-left">
                      <p className="text-sm font-bold text-purple-300">{lastReward.equipment.name}</p>
                      <p className="text-[10px] text-purple-600/80">暴击+{lastReward.equipment.crit_bonus}%</p>
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          )}

          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <button
              onClick={() => setShowInventory(true)}
              className="inline-flex items-center gap-2 rounded-xl bg-purple-500/20 px-6 py-3 text-sm font-semibold text-purple-300 transition-colors hover:bg-purple-500/30"
            >
              🏅 查看成就
            </button>
            <button
              onClick={() => handleRestartFromChapter(1)}
              className="inline-flex items-center gap-2 rounded-xl bg-gray-800/60 px-6 py-3 text-sm font-semibold text-gray-300 transition-colors hover:bg-gray-700/60"
            >
              🔄 重新修行
            </button>
            <button
              onClick={onClose}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-purple-500 to-indigo-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-purple-500/20 transition-all hover:from-purple-400 hover:to-indigo-500"
            >
              返回桌面
            </button>
          </div>
        </motion.div>
      </motion.div>
    </div>
  );

  const renderChapterContent = () => {
    if (!chapter) return null;

    switch (view) {
      case 'dialogue':
        return (
          <GameDialogue
            key={chapterAnimKey}
            npc={
              currentChapter === 0
                ? npcMap['headmaster']
                : chapter.professor
            }
            dialogues={currentChapter === 0 ? prologueDialogues : chapter.dialogues}
            onComplete={handleDialogueComplete}
          />
        );
      case 'magicbook':
        return (
          <div className="flex flex-1 items-start justify-center overflow-y-auto py-8">
            <div className="w-full max-w-3xl px-6">
              <div className="mb-6 flex items-center justify-between">
                <button
                  onClick={() => {
                    setView('dialogue');
                    saveProgress({ current_step: 'dialogue' });
                  }}
                  className="flex items-center gap-1.5 text-sm text-gray-400 transition-colors hover:text-white"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                  返回对话
                </button>
                <button
                  onClick={handleMagicBookComplete}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-purple-500 to-indigo-600 px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-purple-500/20 transition-all hover:from-purple-400 hover:to-indigo-500 active:scale-95"
                >
                  开始练习
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
              <MagicBook chapter={chapter} />
            </div>
          </div>
        );
      case 'challenge':
        return (
          <div className="flex flex-1 items-start justify-center overflow-y-auto py-8">
            <div className="w-full max-w-3xl px-6">
              <div className="mb-6">
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-medium text-gray-400">
                      练习 {currentChallengeIndex + 1} / {chapter.challenges.length}
                    </h3>
                    <p className="text-xs text-gray-500">第 {currentChapter} 章 · {chapter.title}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        setView('magicbook');
                        saveProgress({ current_step: 'magicbook' });
                      }}
                      className="flex items-center gap-1.5 rounded-lg border border-gray-700/50 px-3 py-1.5 text-xs text-gray-400 transition-colors hover:bg-gray-800 hover:text-white"
                    >
                      📖 回顾知识
                    </button>
                  </div>
                </div>
                <div className="flex gap-1.5">
                  {chapter.challenges.map((_, i) => (
                    <div
                      key={i}
                      className={`h-1.5 flex-1 rounded-full transition-colors ${
                        i < currentChallengeIndex
                          ? 'bg-emerald-500'
                          : i === currentChallengeIndex
                            ? 'bg-purple-500'
                            : 'bg-gray-700'
                      }`}
                    />
                  ))}
                </div>
              </div>

              <AnimatePresence mode="wait">
                <motion.div
                  key={currentChallenge?.id}
                  initial={{ opacity: 0, x: 30 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -30 }}
                  transition={{ duration: 0.2 }}
                >
                  {currentChallenge && (
                    <CodeChallenge
                      challenge={currentChallenge}
                      onComplete={handleChallengeComplete}
                    />
                  )}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        );
      case 'boss':
        return (
          <div className="flex flex-1 items-start justify-center overflow-y-auto py-8">
            <div className="w-full max-w-4xl px-6">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-medium text-red-400">⚔️ Boss 挑战</h3>
                  <p className="text-xs text-gray-500">第 {currentChapter} 章 · {chapter.title}</p>
                </div>
                <button
                  onClick={() => {
                    setView('challenge');
                    saveProgress({ current_step: 'challenge' });
                  }}
                  className="flex items-center gap-1.5 rounded-lg border border-gray-700/50 px-3 py-1.5 text-xs text-gray-400 transition-colors hover:bg-gray-800 hover:text-white"
                >
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                  返回练习
                </button>
              </div>
              <BossBattle boss={chapter.boss} onComplete={handleBossComplete} />
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-gray-950">
        <div className="text-center">
          <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-purple-500/30 border-t-purple-500" />
          <p className="text-sm text-gray-400">加载魔法世界中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex h-full overflow-hidden bg-gray-950">
      {view === 'dialogue' && currentChapter > 0 && chapter ? (
        <div className="flex flex-1">
          {renderSidebar()}
          <div className="relative flex flex-1 flex-col">
            <GameDialogue
              key={chapterAnimKey}
              npc={chapter.professor}
              dialogues={chapter.dialogues}
              onComplete={handleDialogueComplete}
            />
          </div>
        </div>
      ) : view === 'intro' ? (
        <div className="flex flex-1">{renderSidebar()}{renderIntro()}</div>
      ) : view === 'graduation' ? (
        <div className="flex flex-1">{renderSidebar()}{renderGraduation()}</div>
      ) : view === 'dialogue' && currentChapter === 0 ? (
        <div className="relative flex-1">
          <GameDialogue
            key="prologue"
            npc={npcMap['headmaster']}
            dialogues={prologueDialogues}
            onComplete={handleDialogueComplete}
          />
        </div>
      ) : (
        <div className="flex flex-1">
          {renderSidebar()}
          <div className="relative flex flex-1 flex-col">
            {renderChapterContent()}
          </div>
        </div>
      )}

      {/* Inventory Modal */}
      <AnimatePresence>
        {showInventory && progress && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
            onClick={() => setShowInventory(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="mx-4 max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-gray-700/50 bg-gray-900 p-6 shadow-2xl"
            >
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-bold text-white">成就与进度</h2>
                <button
                  onClick={() => setShowInventory(false)}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-800 hover:text-white"
                >
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <Inventory
                progress={progress}
                allBadges={ALL_BADGES}
                currentChapter={currentChapter}
                totalChapters={fullChapters.length}
              />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* AI Partner Panel */}
      <AnimatePresence>
        {showAIPartner && (
          <motion.div
            initial={{ x: 400, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 400, opacity: 0 }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="absolute right-0 top-0 z-40 h-full w-[380px] border-l border-gray-700/50 shadow-2xl"
          >
            <div className="flex h-full flex-col">
              <div className="flex items-center justify-between bg-gray-800/80 px-4 py-3">
                <span className="text-sm font-semibold text-white">🤖 小智 AI 伙伴</span>
                <button
                  onClick={() => setShowAIPartner(false)}
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-700 hover:text-white"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="flex-1 overflow-hidden">
                <AIPartner
                  chapterId={currentChapter}
                  context={chapter ? `当前学习第${currentChapter}章：${chapter.title} - ${chapter.subtitle}` : undefined}
                />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
