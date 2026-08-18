import React, { useState, useEffect } from 'react';
import { backendClient } from '../../api/backendClient';

interface Buff {
  id: string;
  buff_type: string;
  crit_modifier: number;
  expires_at: string;
  created_at: string;
}

interface BuffBadgeProps {
  studentId?: string;
  compact?: boolean;
  className?: string;
}

export const BuffBadge: React.FC<BuffBadgeProps> = ({ studentId, compact = false, className = '' }) => {
  const [buffs, setBuffs] = useState<Buff[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (studentId) {
      fetchBuffs();
      // 每30秒刷新一次
      const interval = setInterval(fetchBuffs, 30000);
      return () => clearInterval(interval);
    }
  }, [studentId]);

  const fetchBuffs = async () => {
    if (!studentId) return;
    
    try {
      setLoading(true);
      const { data, error } = await backendClient
        .from('student_buffs')
        .select('id, buff_type, crit_modifier, expires_at, created_at')
        .eq('student_id', studentId)
        .gt('expires_at', new Date().toISOString())
        .order('expires_at', { ascending: true });
      
      if (!error && data) {
        setBuffs(data);
      }
    } catch (error) {
      console.error('获取Buff失败:', error);
    } finally {
      setLoading(false);
    }
  };

  // 如果没有buff，不显示
  if (!loading && buffs.length === 0) {
    return null;
  }

  // 如果正在加载且没有buff，不显示
  if (loading && buffs.length === 0) {
    return null;
  }

  // 紧凑模式：只显示一个提示
  if (compact) {
    const totalCrit = buffs.reduce((sum, buff) => sum + Number(buff.crit_modifier), 0);
    const minExpires = buffs.reduce((min, buff) => {
      const expires = new Date(buff.expires_at).getTime();
      return expires < min ? expires : min;
    }, Infinity);
    const remainingMinutes = Math.ceil((minExpires - Date.now()) / 60000);
    
    return (
      <div className={`fixed top-4 right-4 bg-gradient-to-r from-yellow-400 to-orange-400 text-white px-4 py-2 rounded-lg shadow-lg z-50 ${className}`}>
        <div className="flex items-center gap-2">
          <i className="fa-solid fa-bolt"></i>
          <span className="font-bold">
            {totalCrit > 0 ? '+' : ''}{totalCrit}% 暴击率
          </span>
          <span className="text-xs opacity-90">
            ({remainingMinutes > 0 ? `${remainingMinutes}分钟` : '即将过期'})
          </span>
        </div>
      </div>
    );
  }

  // 完整模式：显示所有buff
  return (
    <div className={`bg-gradient-to-r from-yellow-100 to-orange-100 border border-yellow-300 rounded-lg p-3 ${className}`}>
      <div className="flex items-center gap-2 mb-2">
        <i className="fa-solid fa-bolt text-yellow-600"></i>
        <span className="font-semibold text-yellow-800 text-sm">当前Buff效果</span>
        <span className="text-xs text-gray-500">({buffs.length}个)</span>
      </div>
      
      <div className="space-y-1">
        {buffs.map(buff => {
          const expiresAt = new Date(buff.expires_at);
          const remainingMinutes = Math.ceil((expiresAt.getTime() - Date.now()) / 60000);
          
          return (
            <div key={buff.id} className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <span className={buff.crit_modifier > 0 ? 'text-green-600' : 'text-red-600'}>
                  {buff.crit_modifier > 0 ? '+' : ''}{buff.crit_modifier}% 暴击率
                </span>
                <span className="text-xs text-gray-500">
                  ({buff.buff_type === 'perfect_crit' ? '十全十美' : buff.buff_type === 'critstreak_crit' ? '暴击新星' : buff.buff_type === 'wrong_debuff' ? '屡败屡战' : buff.buff_type === 'teacher_crit' ? '师恩赋能' : buff.buff_type === 'studious_crit' ? '勤学好问' : buff.buff_type === 'typing_fast_crit' ? '运指如飞' : buff.buff_type})
                </span>
              </div>
              <span className="text-xs text-orange-600">
                {remainingMinutes > 0 ? `${remainingMinutes}分钟后过期` : '即将过期'}
              </span>
            </div>
          );
        })}
      </div>
      
      <div className="mt-2 pt-2 border-t border-yellow-200">
        <div className="text-xs text-gray-600">
          <i className="fa-solid fa-info-circle mr-1"></i>
          Buff会在练习和答题时自动生效
        </div>
      </div>
    </div>
  );
};
