-- 重建生存关卡：编号与学习模块对齐（2026-10-27 吴老发现）
--
-- 问题：旧实现的关卡编号是「单元.章.该章内第几个知识点」，其中第三段按
--      cluster_id 的**拼音字典序**排，于是
--        「数据与信息」章排出来是 1.1.1 大数据 / 1.1.2 数据、信息、知识与智慧的关系
--                                    / 1.1.3 数据、信息与知识的概念
--      而学习模块（chapter-taxonomy.js 词表，教材顺序）是
--        1.1.1 数据、信息与知识的概念
--        1.1.2 数据、信息、知识与智慧的关系
--        1.1.3 大数据
--      两边对不上，老师按编号找题会找错。
--
-- 修法：syncSurvivalLevels 改为直接用 chapter-taxonomy.js 的 SECTION_CODES
--      （学习模块、题库聚类、练习筛选都用这同一套），关卡数正好 70。
--
-- 本迁移只负责清空，让后端下次访问时按新规则自动重建：
--   * 关卡表 70 行全部重来（重生点标记与剧情由生成逻辑一并写入）
--   * 学生档案的 seq 指向旧编号，必须重置，否则会停在一个对不上的关卡上
--   * 答题日志（survival_answers）保留原样，它是历史流水，不参与关卡逻辑

DELETE FROM `survival_levels`;

UPDATE `survival_profiles`
   SET `seq` = 1,
       `current_question_id` = NULL,
       `current_started_at` = NULL,
       `current_deadline` = NULL,
       `pending_correction` = 0,
       `round_levels` = 0,
       `alive` = 0;
