import React from 'react';
import { motion } from 'framer-motion';
import { DesktopIcon as DesktopIconType } from '../../types';

interface DesktopIconProps {
  icon: DesktopIconType;
  onDoubleClick: () => void;
  isLocked?: boolean;
}

export const DesktopIcon: React.FC<DesktopIconProps> = ({ icon, onDoubleClick, isLocked }) => {
  return (
    <motion.div
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      onDoubleClick={onDoubleClick}
      className={`flex flex-col items-center gap-2 p-4 rounded-lg cursor-pointer transition-colors group ${
        isLocked ? 'opacity-60 hover:bg-white/5' : 'hover:bg-white/10'
      }`}
    >
      <div className="relative">
        <div className={`w-14 h-14 ${icon.color} rounded-xl flex items-center justify-center shadow-lg group-hover:shadow-xl transition-shadow`}>
          <i className={`fa-solid ${icon.icon} text-white text-2xl`}></i>
        </div>
        {isLocked && (
          <div className="absolute -bottom-1 -right-1 w-6 h-6 bg-gray-700 rounded-full flex items-center justify-center border-2 border-slate-900">
            <i className="fa-solid fa-lock text-amber-400 text-xs"></i>
          </div>
        )}
      </div>
      <span className="text-white text-sm font-medium text-center px-2 py-1 rounded bg-black/30 backdrop-blur-sm">
        {icon.title}
      </span>
    </motion.div>
  );
};
