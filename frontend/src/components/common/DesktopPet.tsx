import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { backendClient } from '../../api/backendClient';
import { StudentPet, Pet, PetTip } from '../../types';
import { useAuth } from '../../hooks/useAuth';
import { useNotificationStore } from '../../store/notificationStore';
import { API_CONFIG } from '../../api/config';
import { authHeaders } from '../../utils/authToken';
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
  // 萌宠公告（教师端广播）：生效期间优先于提示语，倒计时结束自动消失
  const [announcements, setAnnouncements] = useState<
    { id: string; content: string; remaining_seconds: number; created_by_name?: string | null }[]
  >([]);
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
    // 公告生效期间不弹提示语（公告优先）
    if (!focusModeEnabled && announcements.length === 0 && studentPet && tips.length > 0 && tipInterval > 0) {
      const interval = setInterval(() => {
        const randomTip = tips[Math.floor(Math.random() * tips.length)];
        setCurrentTip(randomTip.content);
        setShowTip(true);
        setTimeout(() => setShowTip(false), tipDisplayTime * 1000);
      }, tipInterval * 1000);
      return () => clearInterval(interval);
    }
  }, [studentPet, tips, tipInterval, tipDisplayTime, focusModeEnabled, announcements.length]);

  // 萌宠公告：进入拉一次 + 每 20 秒对齐（教师随时可能发布）
  useEffect(() => {
    if (!profile) return;
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch(`${API_CONFIG.apiUrl}/api/pet/announcement`, { headers: authHeaders() });
        const json = await res.json().catch(() => null);
        const d = json && json.data;
        if (!alive) return;
        setAnnouncements(d && d.active && Array.isArray(d.items) ? d.items : []);
      } catch {
        // 网络抖动：保留现有公告，不清空
      }
    };
    load();
    const poll = setInterval(load, 20000);
    return () => {
      alive = false;
      clearInterval(poll);
    };
  }, [profile]);

  // 公告倒计时：每秒 -1，归零即移除（全部消失后提示语自动恢复）
  useEffect(() => {
    if (announcements.length === 0) return;
    const tick = setInterval(() => {
      setAnnouncements((prev) =>
        prev
          .map((a) => ({ ...a, remaining_seconds: Math.max(0, a.remaining_seconds - 1) }))
          .filter((a) => a.remaining_seconds > 0)
      );
    }, 1000);
    return () => clearInterval(tick);
  }, [announcements.length]);

  // 公告一出现就把正在显示的提示语收起
  useEffect(() => {
    if (announcements.length > 0) setShowTip(false);
  }, [announcements.length]);

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
        // ⛔ 领养概念已废除（老师 2026-10-14 明确）：账号启用即自动随机选一只，
        //    统一走后端幂等端点，避免这里和 PetModule 各自 insert 造成重复行。
        const { data: ensured } = await backendClient.businessEnsurePet({ student_id: profile.id });
        const petId = ensured?.pet?.pet_id;
        if (petId) {
          const { data: allPets } = await backendClient.from('pets').select('*');
          const petMeta = ((allPets || []) as Pet[]).find((p) => p.id === petId) || null;
          setStudentPet({
            id: ensured?.pet?.id || '',
            student_id: profile.id,
            pet_id: petId,
            growth_level: ensured?.pet?.growth_level || 1,
            growth_value: ensured?.pet?.growth_value || 0,
          } as unknown as StudentPet);
          if (petMeta) setPetDetails(petMeta);
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

        {/* 专注模式下的萌宠公告（2026-10-24 修复）：
            原来这个分支在 425 行直接 return 小按钮，走不到下面正常模式的公告渲染，
            于是教师在专注模式课堂上发的公告学生完全看不到 —— 而那正是上课最需要广播的时候。
            公告数据本来就是无条件拉取的（第 100 行 effect），这里只是把它显示出来。
            定位放在小按钮右侧，避免遮住左下角本身。 */}
        <AnimatePresence>
          {announcements.length > 0 && (
            <motion.div
              initial={{ opacity: 0, x: -12, scale: 0.9 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: -12, scale: 0.9 }}
              className="absolute left-[64px] bottom-0 w-[280px] space-y-2 z-20"
              onClick={(e) => e.stopPropagation()}
            >
              {announcements.slice(0, 2).map((a) => (
                <div
                  key={a.id}
                  className="rounded-2xl bg-gradient-to-br from-rose-500 via-orange-500 to-amber-400 p-[2px] shadow-2xl shadow-rose-500/40"
                >
                  <div className="rounded-2xl bg-white/95 px-3 py-2">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1 text-[11px] font-bold text-rose-600">
                        <i className="fa-solid fa-bullhorn animate-pulse text-[10px]"></i>
                        公告
                      </span>
                      <span className="rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                        {a.remaining_seconds} 秒后关闭
                      </span>
                    </div>
                    <p className="whitespace-pre-wrap text-sm font-medium leading-relaxed text-gray-800">
                      {a.content}
                    </p>
                    {a.created_by_name && (
                      <p className="mt-0.5 text-right text-[10px] text-gray-400">—— {a.created_by_name}</p>
                    )}
                  </div>
                </div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

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
          {announcements.length > 0 ? (
            // 公告优先：醒目气泡（渐变描边 + 呼吸喇叭 + 倒计时），最多堆叠 2 条
            <motion.div
              initial={{ opacity: 0, y: 10, scale: 0.85 }}
              animate={{ opacity: 1, y: -70, scale: 1 }}
              exit={{ opacity: 0, y: -90, scale: 0.85 }}
              className="absolute left-0 mb-2 w-[300px] space-y-2 z-20"
            >
              {announcements.slice(0, 2).map((a) => (
                <div
                  key={a.id}
                  className="rounded-2xl bg-gradient-to-br from-rose-500 via-orange-500 to-amber-400 p-[2px] shadow-2xl shadow-rose-500/40"
                >
                  <div className="rounded-2xl bg-white/95 px-3 py-2">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1 text-[11px] font-bold text-rose-600">
                        <i className="fa-solid fa-bullhorn animate-pulse text-[10px]"></i>
                        公告
                      </span>
                      <span className="rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                        {a.remaining_seconds} 秒后关闭
                      </span>
                    </div>
                    <p className="whitespace-pre-wrap text-sm font-medium leading-relaxed text-gray-800">
                      {a.content}
                    </p>
                    {a.created_by_name && (
                      <p className="mt-0.5 text-right text-[10px] text-gray-400">—— {a.created_by_name}</p>
                    )}
                  </div>
                </div>
              ))}
            </motion.div>
          ) : showTip && (
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
