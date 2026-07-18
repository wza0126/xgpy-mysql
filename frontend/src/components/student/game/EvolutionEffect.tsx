import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { PET_LEVELS, PET_STAGE_NAMES } from '../../../types';

interface EvolutionEffectProps {
  show: boolean;
  level: number;
  petImageUrl: string | null;
  petName: string;
  onComplete: () => void;
}

const STAR_COLORS = ['#FFD700', '#FF69B4', '#9370DB', '#00CED1', '#FF6B6B', '#4CAF50'];

export const EvolutionEffect: React.FC<EvolutionEffectProps> = ({
  show,
  level,
  petImageUrl,
  petName,
  onComplete,
}) => {
  useEffect(() => {
    if (show) {
      const timer = setTimeout(() => {
        onComplete();
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [show, onComplete]);

  const levelConfig = PET_LEVELS.find((l) => l.level === level);
  const stageIndex = Math.min(level, PET_STAGE_NAMES.length) - 1;
  const levelName = levelConfig?.name || (level > PET_STAGE_NAMES.length ? `超越阶段(Lv.${level})` : PET_STAGE_NAMES[stageIndex] || '未知');

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          key="evolution-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.5 }}
          className="fixed inset-0 z-[100] pointer-events-none flex items-center justify-center"
          style={{
            background: 'radial-gradient(circle, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0.8) 40%, rgba(200,230,255,0.6) 70%, transparent 100%)',
          }}
        >
          <motion.div
            className="flex flex-col items-center gap-4"
          >
            <motion.div
              initial={{ scale: 0, rotate: -180, opacity: 0 }}
              animate={{ scale: 1, rotate: 0, opacity: 1 }}
              transition={{ duration: 0.8, type: 'spring', stiffness: 150, damping: 15 }}
              className="relative"
            >
              <motion.div
                className="absolute -inset-8 rounded-full"
                animate={{
                  scale: [1, 1.3, 1],
                  opacity: [0.4, 0.8, 0.4],
                }}
                transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
                style={{
                  background: 'radial-gradient(circle, rgba(255,215,0,0.6) 0%, rgba(147,112,219,0.3) 50%, transparent 70%)',
                  filter: 'blur(12px)',
                }}
              />
              <div className="w-32 h-32 rounded-full bg-gradient-to-br from-pink-200 to-purple-200 flex items-center justify-center overflow-hidden shadow-2xl">
                {petImageUrl ? (
                  <img
                    src={petImageUrl}
                    alt={petName}
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <span className="text-5xl">🐾</span>
                )}
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.6, duration: 0.5 }}
              className="text-center"
            >
              <motion.p
                className="text-lg font-bold text-gray-500"
                animate={{ opacity: [1, 0.5, 1] }}
                transition={{ duration: 1, repeat: Infinity }}
              >
                {petName}
              </motion.p>
              <motion.h2
                className="text-4xl font-black mt-2"
                style={{
                  background: 'linear-gradient(135deg, #ec4899, #8b5cf6, #3b82f6)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                }}
                animate={{ scale: [1, 1.05, 1] }}
                transition={{ duration: 1, repeat: Infinity, ease: 'easeInOut' }}
              >
                ✨ 进化！{levelName} ✨
              </motion.h2>
              <motion.p
                className="text-sm text-gray-400 mt-1"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.8 }}
              >
                Lv.{level}
              </motion.p>
            </motion.div>
          </motion.div>

          {[...Array(20)].map((_, i) => (
            <motion.div
              key={i}
              className="absolute w-2 h-2 rounded-full"
              initial={{
                scale: 0,
                opacity: 0,
                x: 0,
                y: 0,
              }}
              animate={{
                scale: [0, 1.5, 0],
                opacity: [0, 1, 0],
                x: Math.cos((i * 2 * Math.PI) / 20) * (100 + Math.random() * 150),
                y: Math.sin((i * 2 * Math.PI) / 20) * (100 + Math.random() * 150),
              }}
              transition={{
                duration: 1.2 + Math.random() * 0.8,
                delay: 0.2 + Math.random() * 0.4,
                ease: 'easeOut',
              }}
              style={{
                background: `radial-gradient(circle, ${STAR_COLORS[i % STAR_COLORS.length]}, white)`,
                boxShadow: `0 0 10px ${STAR_COLORS[i % STAR_COLORS.length]}`,
              }}
            />
          ))}

          {[...Array(12)].map((_, i) => (
            <motion.div
              key={`ring-${i}`}
              className="absolute w-1 h-4 rounded-full"
              initial={{ opacity: 0, scale: 0, rotate: 0 }}
              animate={{
                opacity: [0, 0.8, 0],
                scale: [0, 1.5, 0],
                rotate: 360 + i * 30,
                x: Math.cos((i * 30 * Math.PI) / 180) * 120,
                y: Math.sin((i * 30 * Math.PI) / 180) * 120,
              }}
              transition={{
                duration: 1.5,
                delay: 0.3 + i * 0.05,
                ease: 'easeOut',
              }}
              style={{
                background: `linear-gradient(to top, ${STAR_COLORS[i % STAR_COLORS.length]}, transparent)`,
              }}
            />
          ))}

          <motion.div
            className="absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 0.3, 0] }}
            transition={{ duration: 2, delay: 0.5, ease: 'easeInOut' }}
            style={{
              background: 'radial-gradient(circle at center, rgba(255,255,255,0.8) 0%, rgba(200,230,255,0.4) 30%, transparent 60%)',
            }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
};
