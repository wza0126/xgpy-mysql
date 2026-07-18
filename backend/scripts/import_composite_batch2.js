/**
 * 导入14道综合题到题库
 */
const mysql = require('mysql2/promise');
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.development') });

const questions = [
  // 第1题 智能宠物狗玩具
  {
    content: '<p><strong>1、智能宠物狗玩具</strong></p><p>小张同学自己动手做了一个智能宠物狗玩具。智能宠物狗听到一定强度的声音（如拍手声，咳嗽声，手机铃声等）开始行走，行走途中遇到障碍会暂停并吠叫5秒钟，此时如果被人为扭转方向，它就按照新方向前进，否则自动右转90°之后继续前进。连续行走5分钟后，如果没有人为触碰，智能宠物狗将自动停机休息。</p>',
    sub_questions: [
      { index: 1, type: 'choice', content: '<p>根据描述，请分析这个智能宠物狗玩具中使用了以下哪些传感器？（多选题）</p>', options: ['光敏传感器', '声敏传感器', '气敏传感器', '化学传感器', '压敏传感器', '湿敏传感器'], answers: ['B', 'E'], score: 3, multiple: true },
      { index: 2, type: 'choice', content: '<p>光敏传感器的功能与人类的哪个感觉器官相对应？（ ）</p>', options: ['触觉', '视觉', '听觉', '味觉', '嗅觉'], answers: ['B'], score: 2, multiple: false },
      { index: 3, type: 'choice', content: '<p>在以下设备中，属于物联网感知层的有（ ）。（多选题）</p>', options: ['红外线感应器', '射频识别装置', '二维码识读设备', '网络交换机', '超声波测距感应器'], answers: ['A', 'B', 'C', 'E'], score: 3, multiple: true },
      { index: 4, type: 'choice', content: '<p>拍手启动属于人工智能技术中的语音识别。</p>', options: ['正确', '错误'], answers: ['B'], score: 2, multiple: false },
      { index: 5, type: 'choice', content: '<p>智能宠物狗从静止到开始行走的流程图，下列选项中正确的是。（  ）</p><p><em>（此处选项为流程图图片，请教师后续手工插入选项图片并设置正确答案）</em></p>', options: ['', '', '', ''], answers: [], score: 3, multiple: false },
    ],
  },
  // 第2题 智能客服系统
  {
    content: '<p><strong>2、智能客服系统</strong></p><p>某电商平台为了提高用户购物体验，引入了智能客服系统。该系统使用自然语言处理技术，可以根据用户的问题和需求，智能地回答和解决问题，也可以直观地展示哪些商品是用户较为关注或者购买频率较高的。以下是关于该系统的几个问题：</p>',
    sub_questions: [
      { index: 1, type: 'choice', content: '<p>智能客服系统可以分析用户的购买历史和兴趣偏好，如果将这些数据以图表的形式展示出来，下列合适的图表类型是（ ）。（多选）</p>', options: ['柱状图', '折线图', '饼图', '雷达图'], answers: ['A', 'B', 'C', 'D'], score: 3, multiple: true },
      { index: 2, type: 'fill_blank', content: '<p>智能客服系统是一种人工智能技术的应用，人工智能的英文缩写是 ① 。人工智能的核心是算法，基础是 ② ，本质是计算。</p>', answers: [['AI', 'ai'], ['数据']], score: 2 },
      { index: 3, type: 'fill_blank', content: '<p>智能客服系统可以理解用户输入的自然语言，通过算法解决问题。在设计算法时，我们常采用的算法描述方法有自然语言描述算法、 ① 描述算法和伪代码描述算法。</p>', answers: [['流程图']], score: 2 },
      { index: 4, type: 'choice', content: '<p>智能客服系统可以根据用户的问题类型和关键词，在设计将问题分配给合适的客服人员进行处理的算法时，应采用的算法结构是（ ）。</p>', options: ['顺序结构', '分支结构', '循环结构', '元结构'], answers: ['B'], score: 2, multiple: false },
      { index: 5, type: 'choice', content: '<p>智能客服系统可以根据用户的反馈和评价，不断优化和改进系统回答和解决问题的能力，应用的评估指标主要是（ ）。</p>', options: ['准确率', '响应时间', '用户满意度', '系统可用性'], answers: ['C'], score: 2, multiple: false },
      { index: 6, type: 'choice', content: '<p>智能客服系统可以通过分析用户的账号信息和历史记录，实现个性化的服务，智能客服系统的实现主要依靠的是机器学习技术。</p>', options: ['正确', '错误'], answers: ['A'], score: 2, multiple: false },
    ],
  },
  // 第3题 智能识别物品
  {
    content: '<p><strong>3、智能识别物品</strong></p><p>现在一些大型超市都配备了智能称重终端，它搭载了摄像头，只要服务人员把生鲜果蔬等物品放在摄像头下，就能智能识别出该物品的编号、名称及单价，若无法确定，还会把几种近似的同类产品显示出来供服务人员选择。这样既免去了服务人员记忆各种物品编号的困难，还减少了错误率，避免了商场不必要的损失。</p>',
    sub_questions: [
      { index: 1, type: 'choice', content: '<p>从计算机层面来看，智能称重终端仍然采用的是冯·诺依曼经典体系结构的硬件系统。那么，搭载的摄像头属于（ ）。</p>', options: ['输出设备', '控制器', '传感器', '输入设备'], answers: ['D'], score: 2, multiple: false },
      { index: 2, type: 'choice', content: '<p>商品智能识别后，相关数据会与数据库服务器中的数据进行比对。ACCESS数据库管理系统支持多种数据类型，超市商品信息表中的商品编号就如同人的身份证号，则这个字段最适合的数据类型是（ ）。</p>', options: ['短文本', '数值', '日期/时间', '图形'], answers: ['A'], score: 2, multiple: false },
      { index: 3, type: 'choice', content: '<p>当识别程序无法确定某种生鲜果蔬时，智能称重终端会把几种近似的同类产品显示出来供服务人员选择。这说明，现有的智能识别程序无法完全代替人类。</p>', options: ['正确', '错误'], answers: ['A'], score: 2, multiple: false },
      { index: 4, type: 'fill_blank', content: '<p>我们把物物相连的互联网称为物联网，物联网已在智能超市、智慧交通等各领域快速发展，广泛应用。物联网的英文缩写是 。</p>', answers: [['IoT', 'IOT', 'iot']], score: 2 },
      { index: 5, type: 'fill_blank', content: '<p>从物联网的角度来看，智能称重终端上搭载的摄像头，应该属于物联网体系结构模型中的 层。</p>', answers: [['感知层']], score: 2 },
    ],
  },
  // 第4题 酒店智能机器人
  {
    content: '<p><strong>4、酒店智能机器人</strong></p><p>酒店智能机器人是一种能够自主移动、完成酒店服务工作的机器人。它们通常配备了各种传感器和软件，可以在酒店内自由行动，为客人提供导航、行李搬运、送餐等服务。一些酒店智能机器人还采用了语音识别和自然语言处理技术，能够与客人进行对话，提供信息查询、预订等服务。这些机器人极大地提高了酒店的服务质量和效率，为客人提供了更加便捷和舒适的服务体验。</p>',
    sub_questions: [
      { index: 1, type: 'choice', content: '<p>小明同学入住酒店后，对酒店机器人小A说：小A，请帮我将行李送到909房间。小A回答：客人您好，欢迎光临！请放好您的行李，并跟我一起去909房间。请问小A听小明说话用到（ ）识别。</p>', options: ['指纹识别', '语音识别', '虹膜识别', '声纹识别'], answers: ['B'], score: 2, multiple: false },
      { index: 2, type: 'choice', content: '<p>小明进入房间后，换气扇自动开启，窗帘自动关闭，床头灯自动打开，小明感叹到：这房间真的好智能啊！。下列说法正确的是（ ）。（多选）</p>', options: ['物联网技术在生活中已经应用很广泛', '这些功能主要采用了人工控制', '如果断网，很多功能都会受到影响', '这些设备控制的核心技术是大数据技术'], answers: ['A', 'C'], score: 3, multiple: true },
      { index: 3, type: 'choice', content: '<p>酒店房间有新风过滤系统，每隔5分钟就读取一次室内空气质量的数据，当发现数据超过某个临界值，就要启动新风系统处理。要实现该功能，在进行程序设计时应采用（ ）结构。（多选）</p>', options: ['顺序', '循环', '选择'], answers: ['A', 'B', 'C'], score: 3, multiple: true },
      { index: 4, type: 'choice', content: '<p>小明家也有类似的智能系统，如小明家的门锁可以使用指纹开锁，小明本人发出：小S，我已到家，请开门。的语音也能开锁。下列说法正确的是（ ）（多选）</p>', options: ['门锁采用了语音识别技术，听懂小明的话', '任何人发出同样的语音口令，小明家的门锁都能打开', '指纹识别和声纹识别常被用在身份识别等安全领域', '指纹识别、声纹识别开门没有密码开门安全、方便'], answers: ['A', 'C'], score: 3, multiple: true },
    ],
  },
  // 第5题 自动驾驶技术的发展
  {
    content: '<p><strong>5、自动驾驶技术的发展</strong></p><p>在当今社会，人工智能技术的发展已经深入到各个行业和领域，其中，自动驾驶技术的发展引起了广泛的关注。它通过各种传感器收集环境信息，通过先进的算法进行决策，实现汽车的自主驾驶。</p>',
    sub_questions: [
      { index: 1, type: 'choice', content: '<p>自动驾驶汽车一般包含感知、决策、导航、控制和预警等功能。</p>', options: ['正确', '错误'], answers: ['A'], score: 2, multiple: false },
      { index: 2, type: 'fill_blank', content: '<p>测试员通过与密室里的人和机器对话，判断谁是人谁是机器，这个测试被称为 。</p>', answers: [['图灵测试']], score: 2 },
      { index: 3, type: 'choice', content: '<p>自动驾驶汽车中，环境感知是一个重要的功能，环境感知的作用有（ ）。（多选）</p>', options: ['提高驾驶的安全性', '保证24小时不间断快速行驶', '减少交通事故', '及时准确地监测汽车环境信息'], answers: ['A', 'C', 'D'], score: 3, multiple: true },
      { index: 4, type: 'choice', content: '<p>自动驾驶汽车的发展，对于交通、环境、经济等方面都有重要的影响，下列关于自动驾驶汽车的表述正确的是（ ）。</p>', options: ['自动驾驶汽车的使用会增加交通拥堵', '自动驾驶汽车的使用会增加能源消耗', '自动驾驶汽车可以提供更加舒适和便捷的出行体验', '自动驾驶汽车已经全面淘汰人类驾驶员'], answers: ['C'], score: 2, multiple: false },
      { index: 5, type: 'choice', content: '<p>自动驾驶汽车中，数据安全和隐私保护是一个重要的问题。下列说法正确的是（ ）。</p>', options: ['自动驾驶汽车不会收集用户的个人信息', '自动驾驶汽车的数据安全问题可以忽略不计', '自动驾驶汽车的数据不需要进行加密保护', '自动驾驶汽车需要有完善的数据安全和隐私保护机制'], answers: ['D'], score: 2, multiple: false },
      { index: 6, type: 'choice', content: '<p>为促进自动驾驶技术更好的发展，我们需要关注（ ）。（多选）</p>', options: ['法律法规的制定和完善', '技术的发展和创新', '公众的接受度和信任', '研发的投入和效益'], answers: ['A', 'B', 'C', 'D'], score: 3, multiple: true },
    ],
  },
  // 第6题 作物虫情监测预警系统
  {
    content: '<p><strong>6、作物虫情监测预警系统</strong></p><p>为了提升作物虫害测报的工作效率，某农场引进了作物虫情监测预警系统，该系统采用了三层架构设计。一是以远程诱捕测报等装置相结合的感知层；二是通过5G、WLAN网络组成的网络层；三是对数据进行管理的Web端应用、APP端查询的应用层。</p>',
    sub_questions: [
      { index: 1, type: 'choice', content: '<p>从架构上看，该系统采用了物联网的体系结构模型。</p>', options: ['正确', '错误'], answers: ['A'], score: 2, multiple: false },
      { index: 2, type: 'choice', content: '<p>其中远程诱捕测报装置的核心部件之一是微型网络摄像头，下列选项用来描述摄像头分辨率的是（ ）。</p>', options: ['1280*960', '24位', '8MB', '25mm'], answers: ['A'], score: 2, multiple: false },
      { index: 3, type: 'fill_blank', content: '<p>网络层都是基于现有通信网和互联网建立的，上述系统的网络层由5G通信网、WLAN网络组成的。其中WLAN中文名称是 。</p>', answers: [['无线局域网']], score: 2 },
      { index: 4, type: 'fill_blank', content: '<p>系统使用者分为监测点用户和管理员用户，监测点用户在APP端完成田间虫情数据采集并上传至虫情信息数据库，采用的是 ① 模式；管理员用户通过Web端连接服务器，实现虫情数据管理和监测预警等应用，采用的是 ② 模式。</p>', answers: [['C/S', 'CS', 'c/s'], ['B/S', 'BS', 'b/s']], score: 2 },
      { index: 5, type: 'choice', content: '<p>该系统开发中，APP端基于Android系统，使用Java语言开发；Web端基于Windows系统，使用C#语言开发。上述软件中属于系统软件的是（ ）。（多选）</p>', options: ['Java', 'Android', 'C#', 'Windows'], answers: ['B', 'D'], score: 3, multiple: true },
    ],
  },
  // 第7题 智能音箱小X
  {
    content: '<p><strong>7、智能音箱小X</strong></p><p>某公司原有智能家居系统，可以通过手机APP远程控制室内的空调、电扇、加湿器、监控摄像头等设备的开关、参数调节等。近期，公司又推出智能音箱小X加入智能家居大家庭，用户可以与小X进行如下对话。<br>用户：小X！<br>智能音箱：我在！<br>用户：我觉得今天太热了！你知道今天温度有多高吗？<br>智能音箱：今天南京的温度是最高38度，最低32度，很热！<br>用户：赶紧开空调！<br>智能音箱：好的，空调打开，模式为制冷，温度设置26度</p>',
    sub_questions: [
      { index: 1, type: 'fill_blank', content: '<p>在本案例中，为了实现手机APP远程控制各种家用电器的功能，相关家用电器都应连入 ① ，最适合的接入方式为 ② 。<br>A.局域网 B.因特网 C.Wi-Fi接入 D.蓝牙接入</p>', answers: [['B', 'b'], ['C', 'c']], score: 2 },
      { index: 2, type: 'choice', content: '<p>下列关于智能音箱小X的说法正确的有（ ）。（多选）</p>', options: ['小X处于物联网三层结构中的网络层', '小X应用了语音识别和自然语言处理技术', '小X的硬件设备中使用了声音传感器'], answers: ['B', 'C'], score: 3, multiple: true },
      { index: 3, type: 'fill_blank', content: '<p>传感器在物联网中被大量使用，处于物联网三层结构中的 层。</p>', answers: [['感知层']], score: 2 },
      { index: 4, type: 'fill_blank', content: '<p>在本案例中，空调测温可能使用 ① ，摄像头追踪人像可能使用 ② ，加湿器可能使用 ③ 。<br>A.红外传感器 B.压力传感器 C.湿度传感器 D.温度传感器 E.声音传感器</p>', answers: [['D', 'd'], ['A', 'a'], ['C', 'c']], score: 2 },
    ],
  },
  // 第8题 智能产品在技术升级体验优化
  {
    content: '<p><strong>8、智能产品在技术升级体验优化</strong></p><p>智能产品在技术升级体验优化的同时，也在挖掘不同场景不同人群的深度需求，智能音箱与养老机构合作就是一个典型例子。<br>通过智能音箱，老年人可以听音乐京剧、获取新闻、菜谱等生活信息；通过线上服务平台，老年人通过智能音箱即可呼叫取餐、维修、咨询等服务；通过改造老式家电、窗帘、灯具等设备设施，使智能音箱直接控制开关灯具、风扇、电视等，让独居老年人的活动更加安全。调查发现，随着介入时间的推移，发现老年人非常喜欢智能音箱，生活方式也发生了很大变化，智能音箱扮演了生活智能小伴侣的角色。<br>智能音箱产品与养老事业的对接，对于帮助老年人过上高质量、有尊严的晚年生活提供了有益帮助。</p>',
    sub_questions: [
      { index: 1, type: 'choice', content: '<p>老人喜欢智能音箱的背后原因之一是操控的便捷性。本题场景中控制智能音箱的主要方式是（ ）。</p>', options: ['语音识别', '人脸识别', '指纹识别', '形态识别'], answers: ['A'], score: 2, multiple: false },
      { index: 2, type: 'choice', content: '<p>智能音箱产品以人工智能技术优化用户体验内容，人工智能的三大核心是___、___、算力。</p>', options: ['数据', '控制', '感知', '算法', '存储'], answers: ['A', 'D'], score: 3, multiple: true },
      { index: 3, type: 'choice', content: '<p>家用智能音箱无线连接网络的主要方式是Wi-Fi和（ ）。</p>', options: ['蓝牙技术', '超声技术', '红外技术', '卫星技术'], answers: ['A'], score: 2, multiple: false },
      { index: 4, type: 'fill_blank', content: '<p>智能音箱通过语音实现人机交互，老年人使用智能音箱实现灯具、风扇、电视的开关属于物联网体系结构中的 层。</p>', answers: [['应用层']], score: 2 },
      { index: 5, type: 'choice', content: '<p>有用户反映智能音箱突然不受控制放起了歌，这说明人工智能的技术还有待完善。</p>', options: ['正确', '错误'], answers: ['A'], score: 2, multiple: false },
    ],
  },
  // 第9题 智能手机的使用
  {
    content: '<p><strong>9、智能手机的使用</strong></p><p>在现代社会，智能手机的使用已经普及到各个年龄层，人们通过手机可以进行工作、学习、通信、娱乐、购物等各种活动。</p>',
    sub_questions: [
      { index: 1, type: 'choice', content: '<p>与电脑上的程序一样，手机应用程序也是由编程语言开发而来，并且通常使用的是高级语言。</p>', options: ['正确', '错误'], answers: ['A'], score: 2, multiple: false },
      { index: 2, type: 'choice', content: '<p>手机应用程序中，数据同步是一个重要的功能，下列说法属于数据同步的优势的是（ ）。</p>', options: ['可以在不同设备间共享数据', '可以防止数据丢失', '可以节省存储空间', '可以提高数据处理的效率'], answers: ['A'], score: 2, multiple: false },
      { index: 3, type: 'choice', content: '<p>智能手机的应用程序已经渗透到生活的各个方面，下列关于手机应用程序的表述正确的是（ ）。</p>', options: ['手机应用程序都是免费的', '手机应用程序的使用需要连接网络', '手机应用程序可以提供便捷的服务，如购物、支付、学习等', '手机应用程序的使用都会消耗大量的电量'], answers: ['C'], score: 2, multiple: false },
      { index: 4, type: 'choice', content: '<p>手机应用程序中，用户隐私保护是一个重要的安全问题。下列说法错误的是（ ）。（多选）</p>', options: ['所有的手机应用程序都会收集用户的个人信息', '用户应该定期查看和管理手机应用程序的权限设置，以保护个人隐私', '手机应用程序的隐私设置对用户的隐私保护没有影响', '用户必须同意手机应用程序的所有隐私设置要求才能使用'], answers: ['A', 'C', 'D'], score: 3, multiple: true },
      { index: 5, type: 'choice', content: '<p>某智能手机存储配置为6GB/128GB，其中6GB是指（ ）。</p>', options: ['运行内存', '总容量', 'CPU型号', 'GPU型号'], answers: ['A'], score: 2, multiple: false },
    ],
  },
  // 第10题 物联网看家
  {
    content: '<p><strong>10、物联网看家</strong></p><p>十一长假，王云同学一家决定去北京游玩，他们面临无人看管的家如何防止被偷盗，家中植物如何浇水、宠物如何喂食，卫生如何打扫的问题，还需要考虑如何节约时间，进行合理的游玩路线规划，安排衣食住行。同学们通过小组合作，提出了解决方案。</p>',
    sub_questions: [
      { index: 1, type: 'fill_blank', content: '<p>通过 ① ，解决防盗问题；通过 ② ，解决照顾花草的问题；通过宠物投喂器，定时、定量投喂，解决宠物喂食问题；通过APP控制扫地机器人，解决卫生问题；这些都是物联网的应用。<br>A.重力传感器 B.智能安防 C.智能制造 D.智能交通 E.智能浇灌</p>', answers: [['B', 'b'], ['E', 'e']], score: 2 },
      { index: 2, type: 'fill_blank', content: '<p>物联网的体系结构模型可分为三层，感知层、网络层、应用层。实现对物理世界的智能感知识别、信息采集处理和自动控制的是 层。</p>', answers: [['感知层']], score: 2 },
      { index: 3, type: 'fill_blank', content: '<p>感知层主要通过传感器感受被测量的信息并将其转换为电信号或者其他形式，以满足信息的传输、处理、存储、显示、记录和控制等要求。<br>对室内进行视频监控，需要用到 ① ；<br>采集花盆土壤的湿度，需要用到 ② ；<br>可以通过 ③ ，监测室内的光照强度；<br>A.重力传感器 B.湿度传感器 C.智能摄像头 D.距离传感器 E.光敏传感器 F.指纹传感器</p>', answers: [['C', 'c'], ['B', 'b'], ['E', 'e']], score: 2 },
      { index: 4, type: 'choice', content: '<p>根据流程图，土壤干湿的临界值为（ ）。</p>', options: ['60', '200', '3', '120'], answers: ['A'], score: 2, multiple: false },
      { index: 5, type: 'choice', content: '<p>判断土壤是否干燥的算法结构是（ ）。</p>', options: ['顺序结构', '分支结构', '循环结构'], answers: ['B'], score: 2, multiple: false },
    ],
  },
  // 第11题 智慧农业
  {
    content: '<p><strong>11、智慧农业</strong></p><p>现代科学技术与农业种植相结合，从而实现无人化、自动化、智能化管理，实现智慧农业生产。下图为某公司智慧农业管理平台。请结合所学知识，分析上图，完成下列题目。</p>',
    sub_questions: [
      { index: 1, type: 'choice', content: '<p>该平台中气象数据采集、棚内数据采集、视频数据采集通常采用（ ）实现。</p>', options: ['传感器', '控制器', '运算器', '显示器'], answers: ['A'], score: 2, multiple: false },
      { index: 2, type: 'fill_blank', content: '<p>智慧农业管理平台是典型的信息系统。信息系统有五大功能，气象采集、棚内采集属于信息系统的 功能。</p>', answers: [['输入', '采集']], score: 2 },
      { index: 3, type: 'choice', content: '<p>以采集土壤湿度单项数据为例，用流程图来描述该智慧农业系统运行的过程，正确的是（ ）。（注：测量值≥设定值表示土壤湿润，不需要浇灌水）</p><p><em>（此处选项为流程图图片，请教师后续手工插入选项图片并设置正确答案）</em></p>', options: ['', '', '', ''], answers: [], score: 3, multiple: false },
      { index: 4, type: 'fill_blank', content: '<p>为采集相关数据请选择对应的传感器：采集棚内温度 ① ；采集棚内湿度 ② ；采集棚内浓度 ③ ；采集风速风向 ④ ；采集棚内光照 ⑤ ；<br>A.湿度传感器 B.光敏传感器 C.风速风向仪 D.气敏传感器 E.温度传感器</p>', answers: [['E', 'e'], ['A', 'a'], ['D', 'd'], ['C', 'c'], ['B', 'b']], score: 3 },
    ],
  },
  // 第12题 自动驾驶汽车
  {
    content: '<p><strong>12、自动驾驶汽车</strong></p><p>随着相关技术的不断成熟，自动驾驶汽车逐渐走入人们的生活。自动驾驶汽车通过车载传感器感知车辆周围环境，并根据感知所获得的道路、车辆位置和障碍物信息来控制车辆的转向和速度，从而使车辆能够安全、可靠地在道路上行驶。有的无人驾驶汽车可以实现以下功能：经过人脸认证的司机只要往驾驶座一坐，然后发出指令"开车"，无需钥匙启动和按键启动，车辆就根据人脸识别和声音识别技术自动启动了，而没有经过人脸认证和声音认证的人则无法将车开走。</p>',
    sub_questions: [
      { index: 1, type: 'fill_blank', content: '<p>物联网的体系结构模型可分为感知层、网络层、 层。</p>', answers: [['应用层']], score: 2 },
      { index: 2, type: 'fill_blank', content: '<p>互联网环境下的信息系统和前沿技术为我们打造了智慧生活。信息系统的主要目的和功能是对信息进行输入、 ① 、处理、 ② 和输出等。<br>A.决策 B.计算 C.存储 D.控制</p>', answers: [['C', 'c'], ['D', 'd']], score: 2 },
      { index: 3, type: 'choice', content: '<p>请分析无人驾驶汽车在自动驾驶的过程中需要借助以下哪些传感器帮助它感知周边的环境？（ ）（多选）</p>', options: ['图像传感器（摄像头）', '超声波传感器', '温度传感器', '光敏传感器'], answers: ['A', 'B'], score: 3, multiple: true },
      { index: 4, type: 'choice', content: '<p>车辆根据人脸识别和声音识别技术自动启动，这属于人工智能技术的应用。</p>', options: ['对', '错'], answers: ['A'], score: 2, multiple: false },
      { index: 5, type: 'fill_blank', content: '<p>以下流程图描述了车辆启动程序的控制过程，请在A处填 ① 、B处填 ② 。（填"是"或"否"）</p>', answers: [['是'], ['是']], score: 2 },
    ],
  },
  // 第13题 自动浇水系统
  {
    content: '<p><strong>13、自动浇水系统</strong></p><p>小明给阳台盆栽搭建了自动浇水系统。结构如图所示。当水位降到10以下，则开启浇水装置。当水位超过15，则关闭浇水装置。通过手机可远程监控装置运行情况，必要时进行远程干预。</p>',
    sub_questions: [
      { index: 1, type: 'fill_blank', content: '<p>自动浇水系统属于小型 （填写"AI"或"物联网"）远程控制系统。</p>', answers: [['物联网']], score: 2 },
      { index: 2, type: 'fill_blank', content: '<p>在图中所示设备中，传感器是 ① ，执行器是 ② 。<br>A.浇水装置 B.手机 C.水位监测器 D.家庭网关 E.服务器</p>', answers: [['C', 'c'], ['A', 'a']], score: 2 },
      { index: 3, type: 'choice', content: '<p>若把水位监测器读取到的数据用变量value表示，浇水装置状态用state表示（0表示关，1表示开）。则小明设置的浇水装置可用Python程序表示为（ ）。</p>', options: ['if 10<=value<=15:\n    state=1\nelse:\n    state=0', 'if value<10:\n    state=1\nif value>15:\n    state=0', 'while value<10:\n    state=1\nwhile value>15:\n    state=0', 'while True:\n    if value<10:\n        state=1\n    if value>15:\n        state=0'], answers: ['D'], score: 3, multiple: false },
      { index: 4, type: 'choice', content: '<p>服务器获取数据、控制设备的过程，体现了物联网的（ ）。（多选题）</p>', options: ['全面感知', '可靠传递', '智能处理'], answers: ['A', 'B', 'C'], score: 3, multiple: true },
      { index: 5, type: 'fill_blank', content: '<p>服务器与其他设备的数据传输是 的。（填写"单向"或"双向"）</p>', answers: [['双向']], score: 2 },
    ],
  },
  // 第14题 智慧教室系统
  {
    content: '<p><strong>14、智慧教室系统</strong></p><p>某企业开发了一套智慧教室系统，这套系统包含：<br>视频监控系统、人员考勤系统：由WiFi无线摄像头和配套监控软件、人脸识别考勤机和配套控制软件构成。可以对学生进行考勤统计。<br>资产管理系统：由RFID读卡器、纸质标签、抗金属标签和配套控制软件构成。可以对教室内的实验仪器、设备等资产进行出入教室的监控与管理。<br>教学系统：教学系统由内置电子白板功能的触控投影机一体机、功放、音箱、无线麦克、拾音器、问答器和配套控制软件构成。可在投影画面上操作电脑，在每个桌位上配置问答器，实现师生交互式课堂教学。<br>灯光控制系统：由灯光控制器、光照传感器、红外传感器、窗帘控制系统和配套控制软件构成。可以判断教室内人员情况，进行灯光控制及窗帘控制。<br>温湿度、换气控制系统：由中央空调电源控制器、温湿度传感器、换气扇、CO2传感器和配套控制软件构成。通过传感器监测室内温湿度、CO2浓度，进行分析数据，自动控制室内温湿度、通风换气。</p>',
    sub_questions: [
      { index: 1, type: 'choice', content: '<p>RFID技术是融合了无线射频技术和嵌入式技术的综合技术，它在自动识别物品、物流管理等方面有着广阔的应用前景。</p>', options: ['正确', '错误'], answers: ['A'], score: 2, multiple: false },
      { index: 2, type: 'choice', content: '<p>RFID技术是一种接触式识别技术。</p>', options: ['正确', '错误'], answers: ['B'], score: 2, multiple: false },
      { index: 3, type: 'choice', content: '<p>这套物联网智能教室解决方案包含很多子信息系统，他们都具有哪些功能？（ ）（多选）</p>', options: ['输入', '处理', '存储', '控制', '输出'], answers: ['A', 'B', 'C', 'D', 'E'], score: 3, multiple: true },
      { index: 4, type: 'choice', content: '<p>这套物联网智能教室解决方案，体现物联网的哪三个层次？（ ）（多选）</p>', options: ['应用层', '网络层', '感知层', '物理层'], answers: ['A', 'B', 'C'], score: 3, multiple: true },
      { index: 5, type: 'choice', content: '<p>以下处于物联网感知层的是（ ）。（多选）</p>', options: ['音响设备', '光照传感器', '红外传感器', '温湿度传感器', '换气扇', 'CO2传感器'], answers: ['B', 'C', 'D', 'F'], score: 3, multiple: true },
      { index: 6, type: 'choice', content: '<p>这套系统中，引发信息系统安全风险的因素有哪些？（ ）（多选）</p>', options: ['人为因素', '软硬件因素', '网络因素', '数据因素'], answers: ['A', 'B', 'C', 'D'], score: 3, multiple: true },
    ],
  },
];

async function main() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'xgpy',
    waitForConnections: true,
    connectionLimit: 5,
  });

  let successCount = 0;
  let failCount = 0;

  for (const q of questions) {
    try {
      const id = `comp_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
      const subQuestions = q.sub_questions || [];
      const totalScore = subQuestions.reduce((sum, sq) => sum + (sq.score || 0), 0);
      const answersJson = JSON.stringify(subQuestions);
      const optionsJson = JSON.stringify({
        total_score: totalScore,
        sub_question_count: subQuestions.length,
        sub_scores: subQuestions.map(sq => ({ index: sq.index, score: sq.score || 0 }))
      });

      await pool.query(
        `INSERT INTO questions
         (id, type, content, options, answers, explanation, knowledge_point_id, practice_enabled, exam_enabled, tags, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          id,
          'composite',
          q.content || '',
          optionsJson,
          answersJson,
          q.explanation || '',
          q.knowledge_point_id || null,
          q.practice_enabled !== false,
          q.exam_enabled !== false,
          JSON.stringify(q.tags || ['综合题']),
          q.created_by || 'teacher1'
        ]
      );

      console.log(`导入成功 [${id}]: ${q.content?.substring(0, 30)}... 共${subQuestions.length}道小题, 总分${totalScore}`);
      successCount++;
    } catch (error) {
      console.error('导入失败:', error.message);
      console.error('题目内容:', q.content?.substring(0, 50));
      failCount++;
    }
  }

  console.log(`\n导入完成: 成功${successCount}道, 失败${failCount}道`);
  await pool.end();
}

main().catch(console.error);
