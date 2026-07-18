import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useGameEventStore } from '../../../store/gameEventStore';

export interface DroppedEquipment {
  id: string;
  name: string;
  icon: string;
  crit_bonus: number;
}

const DISPLAY_DURATION = 2000;

export const EquipmentDropEffect: React.FC = () => {
  const lastEvent = useGameEventStore((s) => s.lastEvent);
  const eventCount = useGameEventStore((s) => s.eventCount);
  const eventPayload = useGameEventStore((s) => s.eventPayload);

  const [equipments, setEquipments] = useState<DroppedEquipment[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isVisible, setIsVisible] = useState(false);
  const [prevEventCount, setPrevEventCount] = useState(eventCount);

  useEffect(() => {
    console.log('[EquipmentDropEffect] 事件变化 - lastEvent:', lastEvent, 'eventCount:', eventCount, 'prevEventCount:', prevEventCount);
    if (eventCount !== prevEventCount && lastEvent === 'equipment_drop' && eventPayload) {
      const dropped: DroppedEquipment[] = eventPayload.equipments || [];
      console.log('[EquipmentDropEffect] 检测到装备掉落事件，装备数量:', dropped.length);
      if (dropped.length > 0) {
        setEquipments(dropped);
        setCurrentIndex(0);
        setIsVisible(true);
      }
      setPrevEventCount(eventCount);
    }
  }, [eventCount, lastEvent, eventPayload, prevEventCount]);

  useEffect(() => {
    if (!isVisible || equipments.length === 0) return;

    const timer = setTimeout(() => {
      if (currentIndex < equipments.length - 1) {
        setCurrentIndex((prev) => prev + 1);
      } else {
        setIsVisible(false);
      }
    }, DISPLAY_DURATION);

    return () => clearTimeout(timer);
  }, [isVisible, equipments, currentIndex]);

  const currentEquipment = equipments[currentIndex];

  return (
    <AnimatePresence>
      {isVisible && currentEquipment && (
        <motion.div
          key={`${currentEquipment.id}-${currentIndex}`}
          initial={{ opacity: 0, scale: 0.5, y: -20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.8, y: -30 }}
          transition={{ type: 'spring', stiffness: 300, damping: 20 }}
          className="fixed top-1/4 left-1/2 -translate-x-1/2 z-[9999] pointer-events-none"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: [0, 1, 0.6, 1], scale: [0.8, 1.1, 1] }}
            transition={{ duration: 1.5, repeat: Infinity, repeatType: 'reverse' }}
            className="absolute inset-0 rounded-3xl bg-gradient-to-r from-amber-300 to-yellow-400 blur-2xl opacity-70"
          />

          <div
            className="relative flex flex-col items-center px-10 py-8 rounded-3xl shadow-2xl bg-gradient-to-r from-amber-400 to-yellow-500 text-white min-w-[320px] overflow-hidden"
          >
            <motion.div
              initial={{ x: '-100%' }}
              animate={{ x: '100%' }}
              transition={{ duration: 1.2, repeat: Infinity, repeatDelay: 0.5 }}
              className="absolute top-0 left-0 w-1/2 h-full bg-gradient-to-r from-transparent via-white/30 to-transparent skew-x-12"
            />

            <motion.div
              initial={{ scale: 0, rotate: -30 }}
              animate={{
                scale: [0, 1.3, 1],
                rotate: [ -30, 10, 0],
                y: [0, -8, 0],
              }}
              transition={{
                duration: 0.8,
                scale: { times: [0, 0.6, 1], type: 'spring', stiffness: 400 },
                rotate: { times: [0, 0.6, 1] },
                y: { duration: 2, repeat: Infinity, repeatType: 'reverse' },
              }}
              className="text-7xl mb-3 drop-shadow-lg"
            >
              {currentEquipment.icon || '⚔️'}
            </motion.div>

            <motion.p
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="text-sm font-semibold tracking-widest text-amber-100 uppercase mb-1"
            >
              获得装备
            </motion.p>

            <motion.p
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              className="text-2xl font-bold mb-2 drop-shadow"
            >
              {currentEquipment.name}
            </motion.p>

            {currentEquipment.crit_bonus > 0 && (
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.5, type: 'spring', stiffness: 300 }}
                className="px-4 py-1 rounded-full bg-white/25 backdrop-blur-sm text-sm font-semibold"
              >
                +暴击 {currentEquipment.crit_bonus}%
              </motion.div>
            )}

            {equipments.length > 1 && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.6 }}
                className="flex gap-1.5 mt-4"
              >
                {equipments.map((eq, idx) => (
                  <span
                    key={eq.id}
                    className={`w-2 h-2 rounded-full transition-all ${
                      idx === currentIndex
                        ? 'bg-white scale-125'
                        : idx < currentIndex
                        ? 'bg-white/60'
                        : 'bg-white/25'
                    }`}
                  />
                ))}
              </motion.div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};