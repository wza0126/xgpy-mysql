import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export type PetMood = 'idle' | 'happy' | 'sad' | 'excited' | 'proud' | 'embarrassed';

interface PetSpriteProps {
  imageUrl: string | null;
  petName: string;
  mood: PetMood;
  level: number;
  onMoodComplete?: () => void;
}

const moodVariants: Record<PetMood, any> = {
  idle: {
    y: [0, -6, 0],
    scale: [1, 1.02, 1],
    transition: { duration: 3, repeat: Infinity, ease: 'easeInOut' },
  },
  happy: {
    y: [0, -25, -20, -25, 0],
    scale: [1, 1.15, 1.1, 1.15, 1],
    rotate: [0, -5, 5, -5, 0],
    transition: { duration: 0.8, ease: 'easeOut' },
  },
  sad: {
    y: [0, 5, 3, 5, 0],
    scale: [1, 0.95, 0.97, 0.95, 1],
    rotate: [0, 3, -3, 3, 0],
    transition: { duration: 1.2, ease: 'easeOut' },
  },
  excited: {
    y: [0, -30, 0, -20, 0],
    scale: [1, 1.2, 1, 1.15, 1],
    rotate: [0, -10, 10, -10, 0],
    transition: { duration: 0.6, ease: 'easeOut' },
  },
  proud: {
    y: [0, -15, -10, -15, 0],
    scale: [1, 1.1, 1.05, 1.1, 1],
    rotate: [0, -8, 8, -8, 0],
    transition: { duration: 1.0, ease: 'easeOut' },
  },
  embarrassed: {
    x: [0, -4, 4, -4, 4, -4, 0],
    y: [0, 3, 0, 3, 0, 3, 0],
    scale: [1, 0.97, 0.99, 0.97, 0.99, 0.97, 1],
    transition: { duration: 1.5, ease: 'easeInOut' },
  },
};

const moodFilterStyles: Record<PetMood, string> = {
  idle: '',
  happy: 'brightness(1.05) saturate(1.1)',
  sad: 'brightness(0.85) saturate(0.6)',
  excited: 'brightness(1.3) contrast(1.2) saturate(1.3)',
  proud: 'brightness(1.1) saturate(1.2)',
  embarrassed: 'brightness(0.9) saturate(0.7)',
};

const moodOverlays: Record<PetMood, React.ReactNode> = {
  idle: null,
  happy: (
    <motion.div
      key="happy-overlay"
      initial={{ opacity: 0, scale: 0 }}
      animate={{ opacity: [0, 0.6, 0], scale: [0, 1.5, 2], y: [0, -30] }}
      transition={{ duration: 0.8 }}
      className="absolute inset-0 flex items-center justify-center pointer-events-none"
    >
      <span className="text-3xl">❤️</span>
    </motion.div>
  ),
  sad: (
    <motion.div
      key="sad-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: [0, 1, 0] }}
      transition={{ duration: 1.2 }}
      className="absolute -top-4 left-1/2 -translate-x-1/2 text-sm text-blue-500 font-medium whitespace-nowrap pointer-events-none"
    >
      😢 下次加油！
    </motion.div>
  ),
  excited: (
    <>
      <motion.div
        key="excited-flash"
        initial={{ opacity: 0 }}
        animate={{ opacity: [0, 0.4, 0] }}
        transition={{ duration: 0.6 }}
        className="absolute inset-0 rounded-full pointer-events-none"
        style={{ background: 'radial-gradient(circle, rgba(255,215,0,0.4) 0%, transparent 70%)' }}
      />
      <motion.div
        key="excited-icon"
        initial={{ opacity: 0, scale: 0 }}
        animate={{ opacity: [0, 1, 0], scale: [0, 1.5, 2], y: [0, -40] }}
        transition={{ duration: 0.8 }}
        className="absolute inset-0 flex items-center justify-center pointer-events-none"
      >
        <span className="text-3xl">⚡</span>
      </motion.div>
    </>
  ),
  proud: (
    <motion.div
      key="proud-crown"
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: [0, 1, 1, 0], y: [-20, 0, 0, -30] }}
      transition={{ duration: 1.5 }}
      className="absolute -top-6 left-1/2 -translate-x-1/2 text-2xl pointer-events-none"
    >
      👑
    </motion.div>
  ),
  embarrassed: (
    <motion.div
      key="embarrassed-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: [0, 0.5, 0] }}
      transition={{ duration: 1.5 }}
      className="absolute inset-0 rounded-full pointer-events-none"
      style={{ background: 'radial-gradient(circle, rgba(255,100,100,0.2) 0%, transparent 70%)' }}
    />
  ),
};

export const PetSprite: React.FC<PetSpriteProps> = ({ imageUrl, petName, mood, level, onMoodComplete }) => {
  const [displayMood, setDisplayMood] = React.useState<PetMood>('idle');

  React.useEffect(() => {
    if (mood !== 'idle') {
      setDisplayMood(mood);
      const timer = setTimeout(() => {
        setDisplayMood('idle');
        onMoodComplete?.();
      }, mood === 'excited' ? 800 : 1500);
      return () => clearTimeout(timer);
    } else {
      setDisplayMood('idle');
    }
  }, [mood, onMoodComplete]);

  return (
    <div className="relative flex flex-col items-center justify-center">
      <div className="relative w-28 h-28 flex items-center justify-center">
        <AnimatePresence mode="wait">
          <motion.div
            key={displayMood}
            className="relative w-24 h-24 flex items-center justify-center"
            animate={moodVariants[displayMood]}
            style={{
              filter: moodFilterStyles[displayMood],
            }}
          >
            <div
              className="w-20 h-20 rounded-full bg-gradient-to-br from-pink-200 to-purple-200 flex items-center justify-center overflow-hidden shadow-lg"
            >
              {imageUrl ? (
                <img
                  src={imageUrl}
                  alt={petName}
                  className="w-full h-full object-contain"
                  draggable={false}
                />
              ) : (
                <span className="text-3xl">🐾</span>
              )}
            </div>
          </motion.div>
        </AnimatePresence>

        <AnimatePresence>
          {moodOverlays[displayMood]}
        </AnimatePresence>

        <div className="absolute -bottom-1 left-1/2 -translate-x-1/2">
          <span className="text-[10px] text-gray-400 bg-white/80 px-2 py-0.5 rounded-full shadow-sm">
            Lv.{level}
          </span>
        </div>
      </div>
    </div>
  );
};
