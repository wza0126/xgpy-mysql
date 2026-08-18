import { useState, useCallback, useEffect } from 'react';
import { API_CONFIG } from '../api/config';
import { backendClient } from '../api/backendClient';

export interface BuffInfo {
  id: string;
  buff_type: string;
  crit_modifier: number;
  expires_at: string;
  remaining_seconds: number;
}

export interface CritRateBreakdown {
  base: number;
  from_correct_count: number;
  from_extra_crit: number;
  from_buffs: number;
  from_equipment: number;
  from_skin: number;
}

export interface GameStats {
  power_multiplier: number;
  crit_rate: number;
  total_correct: number;
  pet_level: number;
  active_buffs: BuffInfo[];
  crit_rate_breakdown?: CritRateBreakdown;
  active_skin_id?: string | null;
}

export interface HonorStats {
  perfect_10_times: number;
  triple_crit_times: number;
  wrong_3_times: number;
  studious_times: number;
  typing_fast_times: number;
}

export interface SubmitResult {
  power_multiplier: number;
  crit_rate: number;
  is_crit: boolean;
  final_score: number;
  crit_final_score: number;
  current_streak: number;
  current_crit_streak: number;
  current_wrong: number;
  new_honor: HonorEvent | null;
}

export interface HonorEvent {
  type: string;
  name: string;
  description: string;
}

export function useGameSystem() {
  const [gameStats, setGameStats] = useState<GameStats | null>(null);
  const [honorStats, setHonorStats] = useState<HonorStats | null>(null);
  const [buffs, setBuffs] = useState<BuffInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchBuffs = useCallback(async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('xgpy_token');
      const response = await fetch(`${API_CONFIG.apiUrl}/api/student/buffs`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      if (!response.ok) {
        throw new Error('Failed to fetch buffs');
      }
      const result = await response.json();
      const buffsData = result.data || result || [];
      setBuffs(buffsData);
      setError(null);
      return buffsData;
    } catch (err: any) {
      setError(err.message);
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchHonors = useCallback(async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('xgpy_token');
      const response = await fetch(`${API_CONFIG.apiUrl}/api/student/honors`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      if (!response.ok) {
        throw new Error('Failed to fetch honors');
      }
      const result = await response.json();
      const honorsData = result.data || result || null;
      setHonorStats(honorsData);
      setError(null);
      return honorsData;
    } catch (err: any) {
      setError(err.message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchGameStats = useCallback(async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('xgpy_token');
      const response = await fetch(`${API_CONFIG.apiUrl}/api/student/stats`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      if (!response.ok) {
        throw new Error('Failed to fetch game stats');
      }
      const result = await response.json();
      const statsData = result.data || result || null;
      setGameStats(statsData);
      setError(null);
      return statsData;
    } catch (err: any) {
      setError(err.message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const submitAnswerWithGame = useCallback(async (data: {
    student_id: string;
    question_id: string;
    answer: string;
    is_correct: boolean;
    points_change: number;
    source: string;
  }): Promise<{ data?: SubmitResult; error?: string }> => {
    try {
      const result = await backendClient.businessSubmitAnswer(data);
      if (result.error) {
        return { error: result.error };
      }
      const submitResult: SubmitResult = result.data || null;
      return { data: submitResult };
    } catch (err: any) {
      return { error: err.message };
    }
  }, []);

  useEffect(() => {
    fetchBuffs();
    fetchHonors();
    fetchGameStats();
  }, []);

  return {
    gameStats,
    honorStats,
    buffs,
    loading,
    error,
    fetchBuffs,
    fetchHonors,
    fetchGameStats,
    submitAnswerWithGame,
  };
}
