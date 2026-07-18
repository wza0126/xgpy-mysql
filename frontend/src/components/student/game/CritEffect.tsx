import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface CritEffectProps {
  isCrit: boolean;
  onComplete: () => void;
}

export const CritEffect: React.FC<CritEffectProps> = ({ isCrit, onComplete }) => {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (isCrit) {
      setShow(true);
      const timer = setTimeout(() => {
        setShow(false);
        onComplete();
      }, 1200);
      return () => clearTimeout(timer);
    }
  }, [isCrit, onComplete]);

  return (
    <AnimatePresence>
      {show && (
        <>
          <motion.div
            key="flash"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="fixed inset-0 z-50 pointer-events-none"
            style={{
              background: 'radial-gradient(circle, rgba(255,215,0,0.3) 0%, rgba(255,215,0,0) 70%)',
            }}
          />
          <motion.div
            key="text"
            initial={{ opacity: 0, scale: 0.3, y: 20 }}
            animate={{ opacity: 1, scale: 1.2, y: 0 }}
            exit={{ opacity: 0, scale: 2, y: -100 }}
            transition={{ duration: 0.8, ease: 'easeOut' }}
            className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none"
          >
            <div className="text-center">
              <motion.div
                className="text-7xl font-black text-yellow-400"
                style={{ textShadow: '0 0 20px rgba(255,215,0,0.8), 0 0 40px rgba(255,215,0,0.4)' }}
              >
                ⚡暴击！x2
              </motion.div>
            </div>
          </motion.div>
          <motion.div
            key="shake"
            animate={{
              x: [0, -4, 4, -4, 2, -2, 0],
            }}
            transition={{ duration: 0.5, ease: 'easeInOut' }}
            className="fixed inset-0 z-40 pointer-events-none"
          />
        </>
      )}
    </AnimatePresence>
  );
};
