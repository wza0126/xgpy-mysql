import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { PetMood } from './PetSprite';

interface PetBubbleProps {
  mood: PetMood;
  streak?: number;
  critStreak?: number;
  wrongCount?: number;
}

const getBubbleMessage = (mood: PetMood, streak?: number, critStreak?: number, wrongCount?: number): string => {
  switch (mood) {
    case 'happy':
      if (streak && streak >= 10) return '十连对！超神了！🔥';
      if (streak && streak >= 5) return `连对${streak}题，状态火热！`;
      return '答对了！继续加油！💪';
    case 'sad':
      if (wrongCount && wrongCount >= 2) return '没关系，再想想！🤔';
      return '别灰心，下次一定！';
    case 'excited':
      return '暴击！运气爆棚！✨';
    case 'proud':
      return '十全十美！我是最强的！👑';
    case 'embarrassed':
      return '呜呜…要加油了…😅';
    default:
      if (streak && streak >= 10) return '保持住！迈向下一站！🔥';
      if (streak && streak >= 5) return '状态不错！继续！';
      if (wrongCount && wrongCount >= 2) return '认真审题哦～';
      return '';
  }
};

const getBubbleColor = (mood: PetMood): string => {
  switch (mood) {
    case 'happy':
    case 'proud':
      return 'bg-green-50 border-green-200 text-green-700';
    case 'sad':
    case 'embarrassed':
      return 'bg-blue-50 border-blue-200 text-blue-600';
    case 'excited':
      return 'bg-yellow-50 border-yellow-200 text-yellow-700';
    default:
      return 'bg-gray-50 border-gray-200 text-gray-600';
  }
};

export const PetBubble: React.FC<PetBubbleProps> = ({ mood, streak, critStreak, wrongCount }) => {
  const [message, setMessage] = useState('');
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const msg = getBubbleMessage(mood, streak, critStreak, wrongCount);
    if (msg) {
      setMessage(msg);
      setIsVisible(true);
      const timer = setTimeout(() => {
        setIsVisible(false);
      }, 2500);
      return () => clearTimeout(timer);
    } else {
      setIsVisible(false);
    }
  }, [mood, streak, critStreak, wrongCount]);

  return (
    <div className="relative h-10 flex items-center justify-center">
      <AnimatePresence>
        {isVisible && message && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -5, scale: 0.9 }}
            transition={{ type: 'spring', stiffness: 400, damping: 20 }}
            className={`px-3 py-1.5 rounded-xl border text-xs font-medium shadow-sm whitespace-nowrap ${getBubbleColor(mood)}`}
          >
            <div className="flex items-center gap-1">
              <span>{message}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
