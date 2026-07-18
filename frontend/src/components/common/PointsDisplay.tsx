import React from 'react';
import { motion } from 'framer-motion';
import { Profile } from '../../types';

interface PointsDisplayProps {
  profile: Profile | null;
}

export const PointsDisplay: React.FC<PointsDisplayProps> = ({ profile }) => {
  if (!profile) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="fixed bottom-16 right-4 z-[9998] flex items-center gap-4"
    >
      <div className="bg-gradient-to-r from-yellow-500 to-orange-500 px-4 py-2 rounded-full shadow-lg flex items-center gap-2">
        <i className="fa-solid fa-coins text-white"></i>
        <div className="flex flex-col">
          <span className="text-white text-xs opacity-80">当前积分</span>
          <span className="text-white font-bold text-lg leading-tight">{profile.current_points || 0}</span>
        </div>
      </div>
      <div className="bg-gradient-to-r from-purple-500 to-pink-500 px-4 py-2 rounded-full shadow-lg flex items-center gap-2">
        <i className="fa-solid fa-trophy text-white"></i>
        <div className="flex flex-col">
          <span className="text-white text-xs opacity-80">最高积分</span>
          <span className="text-white font-bold text-lg leading-tight">{profile.max_points || 0}</span>
        </div>
      </div>
    </motion.div>
  );
};
