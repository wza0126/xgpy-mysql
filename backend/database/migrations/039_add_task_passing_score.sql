-- 课堂任务随堂习题合格分数线与合格奖励积分
ALTER TABLE task_class
  ADD COLUMN passing_score INT DEFAULT 0
    COMMENT '随堂习题合格分数线（0=不设分数线），按学生得分与该值比较判断是否合格'
    AFTER min_study_duration,
  ADD COLUMN pass_reward_points INT DEFAULT 0
    COMMENT '随堂习题合格奖励积分（0=不奖励），学生得分达到分数线时发放'
    AFTER passing_score;
