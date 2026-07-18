import React from 'react';
import { motion } from 'framer-motion';
import { DesktopIcon as DesktopIconType } from '../../types';

interface DesktopIconProps {
  icon: DesktopIconType;
  onDoubleClick: () => void;
}

export const DesktopIcon: React.FC<DesktopIconProps> = ({ icon, onDoubleClick }) => {
  return (
    <motion.div
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      onDoubleClick={onDoubleClick}
      className="flex flex-col items-center gap-2 p-4 rounded-lg cursor-pointer hover:bg-white/10 transition-colors group"
    >
      <div className={`w-14 h-14 ${icon.color} rounded-xl flex items-center justify-center shadow-lg group-hover:shadow-xl transition-shadow`}>
        <i className={`fa-solid ${icon.icon} text-white text-2xl`}></i>
      </div>
      <span className="text-white text-sm font-medium text-center px-2 py-1 rounded bg-black/30 backdrop-blur-sm">
        {icon.title}
      </span>
    </motion.div>
  );
};
