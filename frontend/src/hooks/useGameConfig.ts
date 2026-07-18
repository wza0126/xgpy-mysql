import { useState, useCallback, useEffect } from 'react';
import { backendClient } from '../api/backendClient';

export interface GameConfig {
  honorPerfectBuffCrit: number;
  honorPerfectBuffMinutes: number;
  honorCritstreakBuffCrit: number;
  honorCritstreakBuffMinutes: number;
  honorWrongDebuffCrit: number;
  honorWrongDebuffMinutes: number;
  critBaseRate: number;
  critMaxRate: number;
  critStreakThreshold: number;
  wrongStreakThreshold: number;
}

const DEFAULT_CONFIG: GameConfig = {
  honorPerfectBuffCrit: 0.3,
  honorPerfectBuffMinutes: 30,
  honorCritstreakBuffCrit: 0.2,
  honorCritstreakBuffMinutes: 15,
  honorWrongDebuffCrit: -0.15,
  honorWrongDebuffMinutes: 10,
  critBaseRate: 0.1,
  critMaxRate: 0.6,
  critStreakThreshold: 3,
  wrongStreakThreshold: 3,
};

const parseConfigValue = (value: any): number => {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed === 'object' && parsed !== null) {
        return Number(parsed.value) || 0;
      }
      return Number(parsed) || 0;
    } catch {
      return Number(value) || 0;
    }
  }
  if (typeof value === 'object' && value !== null) {
    return Number(value.value) || 0;
  }
  return 0;
};

export function useGameConfig() {
  const [config, setConfig] = useState<GameConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(false);

  const fetchGameConfig = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await backendClient.from('system_config').select('*');
      if (data) {
        const configMap: Record<string, number> = {};
        data.forEach((item: any) => {
          const key = item.key || item.config_key;
          configMap[key] = parseConfigValue(item.value);
        });

        setConfig({
          honorPerfectBuffCrit: configMap['honor_perfect_buff_crit'] ?? DEFAULT_CONFIG.honorPerfectBuffCrit,
          honorPerfectBuffMinutes: configMap['honor_perfect_buff_minutes'] ?? DEFAULT_CONFIG.honorPerfectBuffMinutes,
          honorCritstreakBuffCrit: configMap['honor_critstreak_buff_crit'] ?? DEFAULT_CONFIG.honorCritstreakBuffCrit,
          honorCritstreakBuffMinutes: configMap['honor_critstreak_buff_minutes'] ?? DEFAULT_CONFIG.honorCritstreakBuffMinutes,
          honorWrongDebuffCrit: configMap['honor_wrong_debuff_crit'] ?? DEFAULT_CONFIG.honorWrongDebuffCrit,
          honorWrongDebuffMinutes: configMap['honor_wrong_debuff_minutes'] ?? DEFAULT_CONFIG.honorWrongDebuffMinutes,
          critBaseRate: configMap['crit_base_rate'] ?? DEFAULT_CONFIG.critBaseRate,
          critMaxRate: configMap['crit_max_rate'] ?? DEFAULT_CONFIG.critMaxRate,
          critStreakThreshold: configMap['crit_streak_threshold'] ?? DEFAULT_CONFIG.critStreakThreshold,
          wrongStreakThreshold: configMap['wrong_streak_threshold'] ?? DEFAULT_CONFIG.wrongStreakThreshold,
        });
      }
    } catch (err) {
      console.error('Failed to fetch game config:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchGameConfig();
  }, []);

  return {
    config,
    loading,
    fetchGameConfig,
  };
}
