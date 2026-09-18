import { useCallback } from 'react';
import { backendClient } from '../api/backendClient';

/**
 * 积分变动钩子
 *
 * ⚠️ 历史实现（务必不要再改回去）：
 *   先 select current_points → 本地 newCurrent = current_points + change →
 *   再把 current_points 绝对值写回 profiles。
 * 这种做法没有锁也没有事务，存在两类严重问题：
 *   1. 并发/重试时互相覆盖（丢失更新），最终值取决于谁最后写入；
 *   2. 完全没有下限，扣分可以扣到负数（曾出现学生积分 -4900 的情况）。
 *
 * 现在统一改为调用后端原子接口 POST /api/student/points/adjust：
 *   - 服务端把余额判断写进 UPDATE ... WHERE current_points >= ?，并发安全；
 *   - 扣分不足直接返回 400，绝不会扣成负数（数据库层还有触发器兜底）。
 */
export function usePoints() {
  const updatePoints = useCallback(
    async (studentId: string, change: number, reason?: string) => {
      if (!studentId) return { error: '缺少学生ID' };

      const delta = Math.trunc(Number(change));
      if (!Number.isFinite(delta) || delta === 0) {
        return { error: null };
      }

      try {
        const result: any = await backendClient.post('/api/student/points/adjust', {
          delta,
          reason: reason || (delta > 0 ? '积分增加' : '积分扣除'),
        });

        if (result?.error) {
          return { error: result.error };
        }
        return { error: null, data: result?.data };
      } catch (error: any) {
        // 积分不足时后端返回 400，fetchApi 会抛异常，这里吞掉并回传错误信息，
        // 避免在调用方的 catch 块里再次抛出导致未捕获的 Promise 异常。
        return { error: error?.message || '积分操作失败' };
      }
    },
    []
  );

  const getPointsConfig = useCallback(async () => {
    const { data } = await backendClient
      .from('system_config')
      .select('*');

    const config: Record<string, number> = {};
    data?.forEach((item: any) => {
      const configKey = item.key || item.config_key;
      if (configKey === 'points_correct_answer' || configKey === 'points_wrong_answer') {
        let value = item.value;
        if (typeof item.value === 'string') {
          try {
            value = JSON.parse(item.value);
          } catch {}
        }
        config[configKey] = typeof value === 'object' && value !== null ? value.value : value;
      }
    });

    return {
      correct: config['points_correct_answer'] || 10,
      wrong: config['points_wrong_answer'] || -5,
    };
  }, []);

  return {
    updatePoints,
    getPointsConfig,
  };
}
