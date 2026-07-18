import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { HonorEvent } from '../../../hooks/useGameSystem';

interface HonorToastProps {
  honor: HonorEvent | null;
  onDismiss: () => void;
}

const getHonorIcon = (type: string): string => {
  switch (type) {
    case 'perfect_10':
      return '🏆';
    case 'triple_crit':
      return '💥';
    case 'wrong_3':
      return '😈';
    case 'studious':
      return '📚';
    default:
      return '🎉';
  }
};

const getHonorGradient = (type: string): string => {
  switch (type) {
    case 'perfect_10':
      return 'from-green-500 to-emerald-600';
    case 'triple_crit':
      return 'from-yellow-500 to-orange-600';
    case 'wrong_3':
      return 'from-red-500 to-rose-600';
    case 'studious':
      return 'from-blue-500 to-cyan-600';
    default:
      return 'from-blue-500 to-purple-600';
  }
};

export const HonorToast: React.FC<HonorToastProps> = ({ honor, onDismiss }) => {
  useEffect(() => {
    if (honor) {
      const timer = setTimeout(() => {
        onDismiss();
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [honor, onDismiss]);

  return (
    <AnimatePresence>
      {honor && (
        <motion.div
          key={honor.type}
          initial={{ y: -100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -100, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 25 }}
          className="fixed top-4 left-1/2 transform -translate-x-1/2 z-[100]"
        >
          <div
            className={`flex items-center gap-4 px-6 py-4 rounded-2xl shadow-2xl bg-gradient-to-r ${getHonorGradient(honor.type)} text-white min-w-[320px]`}
          >
            <motion.div
              initial={{ rotate: -20, scale: 0 }}
              animate={{ rotate: 0, scale: 1 }}
              transition={{ delay: 0.2, type: 'spring', stiffness: 400 }}
              className="text-4xl"
            >
              {getHonorIcon(honor.type)}
            </motion.div>
            <div className="flex-1">
              <motion.p
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.3 }}
                className="font-bold text-lg"
              >
                {honor.name}
              </motion.p>
              <motion.p
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.4 }}
                className="text-sm opacity-90"
              >
                {honor.description}
              </motion.p>
            </div>
            <motion.button
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5 }}
              onClick={onDismiss}
              className="text-white/80 hover:text-white transition-colors"
            >
              ✕
            </motion.button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
