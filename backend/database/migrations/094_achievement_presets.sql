-- 094_achievement_presets.sql
-- 成就系统（任务二期）：预置一批「一次性成就」（task_type='once'）
--   · 复用 093 的 game_tasks / student_task_claims，**不动表结构**
--   · 全部走「累计口径」指标（scope='total'，见 backend/src/game-task-metrics.js）
--   · 系列由指标自动派生：答题达人 / 掌握大师 / 对战王者 / 勤学坚持 / 操作题 / 财富积累 / 宠物养成
--   · INSERT IGNORE：重复执行不覆盖教师在后台的改动，也不影响已领取记录
--
-- 奖励一律用「积分 / 上网码」（不需要 target_id）；应用解锁 / 装备奖励需指定具体对象，
-- 由教师在后台按需自行添加，故预置不带。

INSERT IGNORE INTO `game_tasks`
  (`id`,`name`,`description`,`icon`,`task_type`,`metric`,`metric_params`,`target_value`,`unit`,`rewards`,`class_ids`,`is_active`,`sort_order`)
VALUES
  -- ===== 答题达人（累计做对题数 / 累计作答题数 / 累计十连对）=====
  ('gtask_ach_correct_100',  '初出茅庐','累计做对 100 道题', 'star', 'once','total_correct',    NULL, 100,  '题','[{"type":"points","value":50}]', NULL,1,100),
  ('gtask_ach_correct_500',  '崭露头角','累计做对 500 道题', 'star', 'once','total_correct',    NULL, 500,  '题','[{"type":"points","value":100}]',NULL,1,101),
  ('gtask_ach_correct_1000', '百炼成钢','累计做对 1000 道题','crown','once','total_correct',    NULL, 1000, '题','[{"type":"internet_code","value":1}]',NULL,1,102),
  ('gtask_ach_correct_5000', '题海之王','累计做对 5000 道题','crown','once','total_correct',    NULL, 5000, '题','[{"type":"points","value":300}]',NULL,1,103),
  ('gtask_ach_answer_100',   '勤练不辍','累计作答 100 道题', 'bolt', 'once','total_answer',     NULL, 100,  '题','[{"type":"points","value":30}]', NULL,1,104),
  ('gtask_ach_perfect10_1',  '十连对',  '累计达成十连对 1 次','bolt','once','perfect_10_times', NULL, 1,    '次','[{"type":"points","value":30}]', NULL,1,105),
  ('gtask_ach_perfect10_10', '连对达人','累计达成十连对 10 次','crown','once','perfect_10_times',NULL,10,   '次','[{"type":"points","value":100}]',NULL,1,106),

  -- ===== 掌握大师（累计掌握题数）=====
  ('gtask_ach_mastered_50',  '小有所成','累计掌握 50 道题',  'book','once','total_mastered',   NULL, 50,   '题','[{"type":"points","value":60}]', NULL,1,120),
  ('gtask_ach_mastered_200', '融会贯通','累计掌握 200 道题', 'book','once','total_mastered',   NULL, 200,  '题','[{"type":"points","value":150}]',NULL,1,121),
  ('gtask_ach_mastered_500', '登峰造极','累计掌握 500 道题', 'crown','once','total_mastered',  NULL, 500,  '题','[{"type":"internet_code","value":1},{"type":"points","value":100}]',NULL,1,122),

  -- ===== 对战王者（累计 PK 胜场 / PK 段位）=====
  ('gtask_ach_pkwin_1',   '首战告捷','累计 PK 获胜 1 局',   'sword','once','total_pk_win', NULL, 1,   '局','[{"type":"points","value":20}]', NULL,1,140),
  ('gtask_ach_pkwin_20',  '常胜将军','累计 PK 获胜 20 局',  'sword','once','total_pk_win', NULL, 20,  '局','[{"type":"points","value":80}]', NULL,1,141),
  ('gtask_ach_pkwin_100', '百战之王','累计 PK 获胜 100 局', 'crown','once','total_pk_win', NULL, 100, '局','[{"type":"points","value":300}]',NULL,1,142),
  ('gtask_ach_pktier_2',  '段位晋升','PK 段位达到「高中生」','medal','once','pk_rank_tier', NULL, 2,   '段','[{"type":"points","value":100}]',NULL,1,143),

  -- ===== 勤学坚持（累计打卡次数 / 累计活跃天数）=====
  ('gtask_ach_checkin_10', '勤学之星','累计勤学好问打卡 10 次','fire',  'once','checkin_total',    NULL, 10, '次','[{"type":"points","value":40}]', NULL,1,160),
  ('gtask_ach_checkin_50', '持之以恒','累计勤学好问打卡 50 次','fire',  'once','checkin_total',    NULL, 50, '次','[{"type":"points","value":150}]',NULL,1,161),
  ('gtask_ach_active_30',  '学而不厌','累计活跃 30 天',        'target','once','total_active_days',NULL, 30, '天','[{"type":"points","value":100}]',NULL,1,162),

  -- ===== 操作题（累计操作题得分）=====
  ('gtask_ach_op_300',  '操作新秀','累计操作题得分满 300',  'code','once','total_op_score', NULL, 300,  '分','[{"type":"points","value":40}]', NULL,1,180),
  ('gtask_ach_op_1000', '操作能手','累计操作题得分满 1000', 'code','once','total_op_score', NULL, 1000, '分','[{"type":"points","value":120}]',NULL,1,181),
  ('gtask_ach_op_3000', '操作大师','累计操作题得分满 3000', 'crown','once','total_op_score',NULL, 3000, '分','[{"type":"internet_code","value":1}]',NULL,1,182),

  -- ===== 财富积累（累计获得积分）=====
  ('gtask_ach_points_1000', '小有积蓄','累计获得 1000 积分','coin','once','total_points_earned',NULL,1000,'分','[{"type":"points","value":60}]', NULL,1,200),
  ('gtask_ach_points_5000', '富甲一方','累计获得 5000 积分','coin','once','total_points_earned',NULL,5000,'分','[{"type":"points","value":200}]',NULL,1,201),

  -- ===== 宠物养成（宠物等级）=====
  ('gtask_ach_pet_5',  '悉心照料','宠物等级达到 5 级',  'paw','once','pet_level',NULL, 5,  '级','[{"type":"points","value":50}]', NULL,1,220),
  ('gtask_ach_pet_15', '培养大师','宠物等级达到 15 级', 'paw','once','pet_level',NULL, 15, '级','[{"type":"points","value":150}]',NULL,1,221);
