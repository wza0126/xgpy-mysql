import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { BuffInfo } from '../../../hooks/useGameSystem';

interface BuffAuraProps {
  buffs: BuffInfo[];
}

interface AuraConfig {
  color: string;
  intensity: number;
  label: string;
}

const getAuraConfig = (buffs: BuffInfo[]): AuraConfig | null => {
  const hasPerfect = buffs.some(b => b.buff_type === 'perfect_crit');
  const hasCritstreak = buffs.some(b => b.buff_type === 'critstreak_crit');
  const hasWrong = buffs.some(b => b.buff_type === 'wrong_debuff');
  const hasTeacher = buffs.some(b => b.buff_type === 'teacher_crit');
  const hasStudious = buffs.some(b => b.buff_type === 'studious_crit');

  if (hasPerfect) {
    return { color: '#22c55e', intensity: 0.3, label: '十全十美' };
  }
  if (hasCritstreak) {
    return { color: '#eab308', intensity: 0.35, label: '暴击新星' };
  }
  if (hasTeacher) {
    return { color: '#a855f7', intensity: 0.3, label: '师恩赋能' };
  }
  if (hasStudious) {
    return { color: '#3b82f6', intensity: 0.3, label: '勤学好问' };
  }
  if (hasWrong) {
    return { color: '#ef4444', intensity: 0.2, label: '屡败屡战' };
  }
  return null;
};

export const BuffAura: React.FC<BuffAuraProps> = ({ buffs }) => {
  const aura = getAuraConfig(buffs);

  if (!aura) return null;

  return (
    <AnimatePresence>
      <motion.div
        key={aura.label}
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: [aura.intensity, aura.intensity * 1.5, aura.intensity] }}
        exit={{ opacity: 0, scale: 0.8 }}
        transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
        className="absolute inset-0 rounded-full pointer-events-none"
        style={{
          background: `radial-gradient(circle, ${aura.color}33 0%, ${aura.color}1a 50%, transparent 70%)`,
          boxShadow: `0 0 20px ${aura.color}22, 0 0 40px ${aura.color}11`,
        }}
      />
    </AnimatePresence>
  );
};
