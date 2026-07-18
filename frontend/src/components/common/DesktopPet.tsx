import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { backendClient } from '../../api/backendClient';
import { StudentPet, Pet, PetTip } from '../../types';
import { useAuth } from '../../hooks/useAuth';
import { useNotificationStore } from '../../store/notificationStore';
import { useGameEventStore, PetMoodEvent } from '../../store/gameEventStore';

interface DesktopPetProps {
  onOpenPetModule: () => void;
  onOpenAiQa: () => void;
  focusModeEnabled?: boolean;
  onToggleQuickAccess?: () => void;
}

type DesktopMood = 'idle' | 'happy' | 'sad' | 'excited' | 'clicked';

const getMoodFromEvent = (event: PetMoodEvent): DesktopMood => {
  switch (event) {
    case 'correct': return 'happy';
    case 'wrong': return 'sad';
    case 'crit':
    case 'perfect_10':
    case 'triple_crit': return 'excited';
    case 'wrong_3': return 'sad';
    default: return 'idle';
  }
};

export const DesktopPet: React.FC<DesktopPetProps> = ({ 
  onOpenPetModule, 
  onOpenAiQa, 
  focusModeEnabled = false,
  onToggleQuickAccess 
}) => {
  const { setShowNotificationCenter, unreadCount } = useNotificationStore();
  const { profile } = useAuth();
  const lastEvent = useGameEventStore((s) => s.lastEvent);
  const eventCount = useGameEventStore((s) => s.eventCount);
  const [studentPet, setStudentPet] = useState<StudentPet | null>(null);
  const [petDetails, setPetDetails] = useState<Pet | null>(null);
  const [tips, setTips] = useState<PetTip[]>([]);
  const [currentTip, setCurrentTip] = useState<string>('');
  const [showTip, setShowTip] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [showEntranceEffect, setShowEntranceEffect] = useState(false);
  const [position, setPosition] = useState({ x: 20, y: window.innerHeight - 140 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [tipInterval, setTipInterval] = useState(30);
  const [tipDisplayTime, setTipDisplayTime] = useState(5);
  const [maxStage, setMaxStage] = useState(5);
  const [doubleClickAiQaEnabled, setDoubleClickAiQaEnabled] = useState(true);
  const [canUseApp, setCanUseApp] = useState(true);
  const [mood, setMood] = useState<DesktopMood>('idle');
  const [prevEventCount, setPrevEventCount] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const clickTimerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (profile) {
      fetchPetData();
      fetchPetConfig();
      fetchAppPermission();
      setIsVisible(true);
      if (!focusModeEnabled) {
        setTimeout(() => setShowEntranceEffect(true), 100);
        setTimeout(() => setShowEntranceEffect(false), 3000);
      }
      const configInterval = setInterval(() => {
        fetchPetConfig();
        fetchAppPermission();
      }, 5000);

      return () => {
        clearInterval(configInterval);
      };
    }
  }, [profile, focusModeEnabled]);

  useEffect(() => {
    if (!focusModeEnabled && studentPet && tips.length > 0 && tipInterval > 0) {
      const interval = setInterval(() => {
        const randomTip = tips[Math.floor(Math.random() * tips.length)];
        setCurrentTip(randomTip.content);
        setShowTip(true);
        setTimeout(() => setShowTip(false), tipDisplayTime * 1000);
      }, tipInterval * 1000);
      return () => clearInterval(interval);
    }
  }, [studentPet, tips, tipInterval, tipDisplayTime, focusModeEnabled]);

  useEffect(() => {
    if (eventCount !== prevEventCount && lastEvent) {
      const newMood = getMoodFromEvent(lastEvent);
      setMood(newMood);
      setPrevEventCount(eventCount);

      if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
      clickTimerRef.current = setTimeout(() => {
        setMood('idle');
      }, 2000);
    }
  }, [eventCount, lastEvent, prevEventCount]);

  const fetchPetData = async () => {
    if (!profile) return;
    const { data: studentPetData } = await backendClient
      .from('student_pets')
      .select('*')
      .eq('student_id', profile.id)
      .maybeSingle();
    if (studentPetData) {
      setStudentPet(studentPetData as StudentPet);
      const { data: petData } = await backendClient
        .from('pets')
        .select('*')
        .eq('id', studentPetData.pet_id)
        .maybeSingle();
      if (petData) setPetDetails(petData as Pet);
    } else {
      try {
        const { data: allPets } = await backendClient.from('pets').select('*');
        if (allPets && allPets.length > 0) {
          const randomPet = allPets[Math.floor(Math.random() * allPets.length)];
          await backendClient.from('student_pets').insert({
            student_id: profile.id,
            pet_id: randomPet.id,
            growth_level: 1,
            growth_value: 0,
          });
          setStudentPet({
            id: '',
            student_id: profile.id,
            pet_id: randomPet.id,
            growth_level: 1,
            growth_value: 0,
          } as unknown as StudentPet);
          setPetDetails(randomPet as Pet);
        }
      } catch (err) {
        console.error('自动分配宠物失败:', err);
      }
    }
    const { data: tipsData } = await backendClient.from('pet_tips').select('*');
    if (tipsData) setTips(tipsData as PetTip[]);
  };

  const fetchPetConfig = async () => {
    const { data } = await backendClient.from('pet_config').select('*').maybeSingle();
    if (data) {
      setTipInterval(data.tip_interval_seconds || 30);
      setTipDisplayTime(data.tip_display_seconds || 5);
      setMaxStage(data.max_stage || 5);
      setDoubleClickAiQaEnabled(
        data.double_click_aiqa !== false &&
        data.double_click_aiqa !== 0 &&
        data.double_click_aiqa !== '0'
      );
    } else {
      setDoubleClickAiQaEnabled(true);
    }
  };

  const fetchAppPermission = async () => {
    if (!profile) return;
    try {
      const { data } = await backendClient.from('profiles').select('can_use_app').eq('id', profile.id).maybeSingle();
      if (data) {
        const canUseAppValue = data.can_use_app;
        setCanUseApp(canUseAppValue !== 0 && canUseAppValue !== false);
      }
    } catch (error) {
      console.error('获取应用权限失败:', error);
    }
  };

  const getPetImage = () => {
    if (!petDetails || !studentPet) return null;
    const displayLevel = studentPet.display_level || studentPet.growth_level || 1;
    const stage = Math.min(displayLevel, maxStage);
    switch (stage) {
      case 1: return petDetails.image_level_1;
      case 2: return petDetails.image_level_2;
      case 3: return petDetails.image_level_3;
      case 4: return petDetails.image_level_4;
      case 5: return petDetails.image_level_5;
      default: return petDetails.image_level_1;
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (focusModeEnabled) return;
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      setDragOffset({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      });
      setIsDragging(true);
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging && !focusModeEnabled) {
      const newX = e.clientX - dragOffset.x;
      const newY = e.clientY - dragOffset.y;
      setPosition({
        x: Math.max(0, Math.min(window.innerWidth - 120, newX)),
        y: Math.max(0, Math.min(window.innerHeight - 120, newY)),
      });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleClick = () => {
    if (focusModeEnabled) {
      onToggleQuickAccess?.();
      return;
    }
    
    setMood('clicked');
    if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
    clickTimerRef.current = setTimeout(() => {
      setMood('idle');
    }, 800);

    if (!isDragging && tips.length > 0) {
      const randomTip = tips[Math.floor(Math.random() * tips.length)];
      setCurrentTip(randomTip.content);
      setShowTip(true);
      setTimeout(() => setShowTip(false), tipDisplayTime * 1000);
    }
  };

  const handleDoubleClick = () => {
    if (focusModeEnabled) return;
    if (!doubleClickAiQaEnabled) return;
    if (!canUseApp) {
      alert('当前无法使用应用，请联系管理员');
      return;
    }
    onOpenAiQa();
  };

  if (!studentPet || !petDetails || !isVisible) return null;

  const petImage = getPetImage();

  const moodVariants = {
    idle: {
      y: [0, -4, 0],
      scale: [1, 1.02, 1],
      rotate: [0, -2, 2, 0],
      transition: {
        y: { repeat: Infinity, duration: 3, ease: 'easeInOut' },
        scale: { repeat: Infinity, duration: 3, ease: 'easeInOut' },
        rotate: { repeat: Infinity, duration: 4, ease: 'easeInOut' },
      },
    },
    happy: {
      y: [0, -20, -15, -20, 0],
      scale: [1, 1.12, 1.08, 1.12, 1],
      rotate: [0, -6, 6, -6, 0],
      transition: { duration: 0.8, ease: 'easeOut' },
    },
    sad: {
      y: [0, 4, 2, 4, 0],
      scale: [1, 0.95, 0.97, 0.95, 1],
      rotate: [0, 3, -3, 3, 0],
      transition: { duration: 1.2, ease: 'easeOut' },
    },
    excited: {
      y: [0, -25, 0, -20, 0],
      scale: [1, 1.2, 1, 1.15, 1],
      rotate: [0, -10, 10, -10, 0],
      transition: { duration: 0.7, ease: 'easeOut' },
    },
    clicked: {
      scale: [1, 1.15, 0.95, 1],
      rotate: [0, -8, 8, 0],
      transition: { duration: 0.4, ease: 'easeOut' },
    },
  };

  const moodFilter: Record<DesktopMood, string> = {
    idle: '',
    happy: 'brightness(1.05) saturate(1.1)',
    sad: 'brightness(0.85) saturate(0.6)',
    excited: 'brightness(1.3) contrast(1.2) saturate(1.3)',
    clicked: 'brightness(1.15) saturate(1.1)',
  };

  const moodOverlay: Record<DesktopMood, React.ReactNode> = {
    idle: null,
    happy: (
      <motion.div
        key="desk-happy"
        initial={{ opacity: 0, scale: 0 }}
        animate={{ opacity: [0, 0.5, 0], scale: [0, 1.2, 1.5], y: [0, -20] }}
        transition={{ duration: 0.8 }}
        className="absolute inset-0 flex items-center justify-center pointer-events-none"
      >
        <span className="text-2xl">❤️</span>
      </motion.div>
    ),
    sad: null,
    excited: (
      <motion.div
        key="desk-excited"
        initial={{ opacity: 0 }}
        animate={{ opacity: [0, 0.3, 0] }}
        transition={{ duration: 0.6 }}
        className="absolute inset-0 rounded-full pointer-events-none"
        style={{ background: 'radial-gradient(circle, rgba(255,215,0,0.35) 0%, transparent 70%)' }}
      />
    ),
    clicked: null,
  };

  const renderPetContent = (width: number, height: number, showShadow: boolean) => (
    <>
      <motion.div
        className="relative"
        animate={moodVariants[mood]}
        style={{ filter: moodFilter[mood] }}
      >
        <div
          className="rounded-full overflow-hidden relative"
          style={{ width, height, background: 'transparent' }}
        >
          <motion.div
            className="absolute inset-0 rounded-full"
            animate={{
              background: [
                'radial-gradient(circle at 30% 30%, rgba(255,255,255,0.4) 0%, transparent 50%)',
                'radial-gradient(circle at 35% 25%, rgba(255,255,255,0.5) 0%, transparent 50%)',
                'radial-gradient(circle at 30% 30%, rgba(255,255,255,0.4) 0%, transparent 50%)',
              ],
            }}
            transition={{ repeat: Infinity, duration: 3, ease: 'easeInOut' }}
          />
          {petImage ? (
            <img
              src={petImage}
              alt={petDetails.name}
              className="w-full h-full object-contain"
              style={{ background: 'transparent' }}
            />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-pink-400 to-purple-500 flex items-center justify-center">
              <i className="fa-solid fa-paw text-white text-3xl"></i>
            </div>
          )}
        </div>

        <AnimatePresence>
          {moodOverlay[mood]}
        </AnimatePresence>
      </motion.div>

      {showShadow && (
        <motion.div
          className="absolute -bottom-6 left-1/2 -translate-x-1/2 rounded-full"
          style={{ width: width * 0.5, height: 4, background: 'radial-gradient(ellipse at center, rgba(0,0,0,0.15) 0%, transparent 70%)' }}
          animate={{
            scale: mood === 'idle' ? [1, 1.1, 1] : [1, 0.8, 1],
            opacity: mood === 'idle' ? [0.5, 0.3, 0.5] : 0.6,
          }}
          transition={{ repeat: Infinity, duration: 2, ease: 'easeInOut' }}
        />
      )}
    </>
  );

  if (focusModeEnabled) {
    return (
      <motion.div
        ref={containerRef}
        className="fixed z-[9998] cursor-pointer"
        style={{
          left: 20,
          bottom: 100,
          width: 56,
          height: 56,
        }}
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        whileHover={{ scale: 1.1 }}
        onClick={handleClick}
      >
        <motion.div
          className="w-full h-full rounded-full overflow-hidden relative"
          style={{
            background: 'linear-gradient(135deg, #9333ea 0%, #ec4899 100%)',
            boxShadow: '0 4px 20px rgba(147, 51, 234, 0.4)',
          }}
          animate={{
            boxShadow: [
              '0 4px 20px rgba(147, 51, 234, 0.4)',
              '0 4px 30px rgba(236, 72, 153, 0.5)',
              '0 4px 20px rgba(147, 51, 234, 0.4)',
            ],
          }}
          transition={{ repeat: Infinity, duration: 2, ease: 'easeInOut' }}
        >
          {petImage ? (
            <img
              src={petImage}
              alt={petDetails.name}
              className="w-full h-full object-contain"
              style={{ background: 'transparent' }}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <i className="fa-solid fa-paw text-white text-2xl"></i>
            </div>
          )}
          
          {profile?.role === 'student' && unreadCount > 0 && (
            <motion.div
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="absolute -top-1 -right-1 bg-red-500 text-white text-xs font-bold w-5 h-5 rounded-full flex items-center justify-center shadow-lg border-2 border-white"
            >
              {unreadCount > 99 ? '99+' : unreadCount}
            </motion.div>
          )}
        </motion.div>
        
        <motion.div
          className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-10 h-2 rounded-full"
          style={{
            background: 'radial-gradient(ellipse at center, rgba(147, 51, 234, 0.3) 0%, transparent 70%)',
          }}
          animate={{
            scale: [1, 1.1, 1],
            opacity: [0.5, 0.3, 0.5],
          }}
          transition={{ repeat: Infinity, duration: 2, ease: 'easeInOut' }}
        />
      </motion.div>
    );
  }

  return (
    <motion.div
      ref={containerRef}
      className="fixed z-[9998] cursor-move"
      style={{
        left: position.x,
        top: position.y,
        width: 120,
        height: 120,
      }}
      initial={{ opacity: 0, scale: 0, x: -100 }}
      animate={{ opacity: 1, scale: 1, x: 0 }}
      transition={{
        type: 'spring',
        stiffness: 200,
        damping: 20,
        duration: 1.5,
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
    >
      <div className="relative w-full h-full">
        <AnimatePresence>
          {showEntranceEffect && (
            <>
              <motion.div
                className="absolute inset-0 rounded-full"
                initial={{ scale: 0.5, opacity: 0 }}
                animate={{
                  scale: [0.5, 2, 3],
                  opacity: [0, 0.8, 0],
                }}
                transition={{ duration: 2, ease: 'easeOut' }}
                style={{
                  background: 'radial-gradient(circle, rgba(255,215,0,0.8) 0%, rgba(255,105,180,0.4) 50%, transparent 70%)',
                  filter: 'blur(8px)',
                }}
              />
              <motion.div
                className="absolute inset-0 rounded-full"
                initial={{ scale: 0.3, opacity: 0 }}
                animate={{
                  scale: [0.3, 1.5, 2.5],
                  opacity: [0, 1, 0],
                }}
                transition={{ duration: 1.5, delay: 0.2, ease: 'easeOut' }}
                style={{
                  background: 'radial-gradient(circle, rgba(255,255,255,0.9) 0%, rgba(147,112,219,0.5) 40%, transparent 60%)',
                  filter: 'blur(4px)',
                }}
              />
              {[...Array(8)].map((_, i) => (
                <motion.div
                  key={i}
                  className="absolute w-2 h-2 rounded-full"
                  initial={{ scale: 0, opacity: 0, x: 60, y: 60 }}
                  animate={{
                    scale: [0, 1.5, 0],
                    opacity: [0, 1, 0],
                    x: 60 + Math.cos((i * Math.PI) / 4) * 80,
                    y: 60 + Math.sin((i * Math.PI) / 4) * 80,
                  }}
                  transition={{
                    duration: 1.2,
                    delay: i * 0.1,
                    ease: 'easeOut',
                  }}
                  style={{
                    background: `linear-gradient(135deg, ${['#FFD700', '#FF69B4', '#9370DB', '#00CED1'][i % 4]} 0%, white 100%)`,
                    boxShadow: `0 0 10px ${['#FFD700', '#FF69B4', '#9370DB', '#00CED1'][i % 4]}`,
                  }}
                />
              ))}
              <motion.div
                className="absolute -inset-4 rounded-full"
                initial={{ opacity: 0, rotate: 0 }}
                animate={{ opacity: [0, 0.6, 0], rotate: 360 }}
                transition={{ duration: 2, ease: 'linear' }}
                style={{
                  background: 'conic-gradient(from 0deg, transparent, rgba(255,215,0,0.3), rgba(255,105,180,0.3), rgba(147,112,219,0.3), transparent)',
                }}
              />
            </>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {showTip && (
            <motion.div
              initial={{ opacity: 0, y: 10, scale: 0.8 }}
              animate={{ opacity: 1, y: -70, scale: 1 }}
              exit={{ opacity: 0, y: -90, scale: 0.8 }}
              className="absolute left-1/2 -translate-x-1/2 bg-white/95 backdrop-blur-sm rounded-2xl shadow-xl p-4 mb-2 whitespace-nowrap z-20 border border-pink-200"
            >
              <div className="flex items-center gap-2">
                <motion.i
                  className="fa-solid fa-comment-dots text-pink-500 text-lg"
                  animate={{ scale: [1, 1.2, 1] }}
                  transition={{ repeat: Infinity, duration: 1 }}
                />
                <span className="text-sm text-gray-700 font-medium">{currentTip}</span>
              </div>
              <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 w-3 h-3 bg-white rotate-45 border-r border-b border-pink-200"></div>
            </motion.div>
          )}
        </AnimatePresence>

        {renderPetContent(112, 112, true)}

        {profile?.role === 'student' && unreadCount > 0 && (
          <motion.div
            initial={{ scale: 0, opacity: 0 }}
            animate={{ 
              scale: [1, 1.1, 1], 
              opacity: 1,
              y: [0, -3, 0],
            }}
            className="absolute -top-2 -right-2 bg-red-500 text-white text-xs font-bold w-6 h-6 rounded-full flex items-center justify-center shadow-lg border-2 border-white z-30"
            transition={{
              repeat: Infinity,
              duration: 2,
              ease: 'easeInOut',
            }}
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </motion.div>
        )}
      </div>
    </motion.div>
  );
};
