import { useCallback } from 'react';
import { backendClient } from '../api/backendClient';

export function usePoints() {
  const updatePoints = useCallback(async (studentId: string, change: number) => {
    const { data: profile } = await backendClient
      .from('profiles')
      .select('current_points, max_points')
      .eq('id', studentId)
      .single();

    if (!profile) return { error: 'Profile not found' };

    const newCurrent = (profile.current_points || 0) + change;
    const newMax = Math.max(profile.max_points || 0, newCurrent);

    const { error } = await backendClient
      .from('profiles')
      .eq('id', studentId)
      .update({
        current_points: newCurrent,
        max_points: newMax,
      });

    return { error };
  }, []);

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
