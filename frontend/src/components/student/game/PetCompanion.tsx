import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { backendClient } from '../../../api/backendClient';
import { useAuth } from '../../../hooks/useAuth';
import { BuffInfo, HonorEvent } from '../../../hooks/useGameSystem';
import { PetSprite, PetMood } from './PetSprite';
import { BuffAura } from './BuffAura';
import { PetBubble } from './PetBubble';

interface PetCompanionProps {
  isCorrect: boolean | null;
  isCrit: boolean;
  newHonor: HonorEvent | null;
  currentStreak: number;
  currentCritStreak: number;
  currentWrong: number;
  buffs: BuffInfo[];
  showResult: boolean;
}

const PARTICLE_COLORS = ['#FFD700', '#22c55e', '#3b82f6', '#ec4899', '#a855f7', '#06b6d4'];

export const PetCompanion: React.FC<PetCompanionProps> = ({
  isCorrect,
  isCrit,
  newHonor,
  currentStreak,
  currentCritStreak,
  currentWrong,
  buffs,
  showResult,
}) => {
  const { profile } = useAuth();
  const [petImage, setPetImage] = useState<string | null>(null);
  const [petName, setPetName] = useState('');
  const [petLevel, setPetLevel] = useState(1);
  const [maxStage, setMaxStage] = useState(5);
  const [mood, setMood] = useState<PetMood>('idle');
  const [isLoaded, setIsLoaded] = useState(false);
  const [showCelebration, setShowCelebration] = useState(false);
  const [celebrationType, setCelebrationType] = useState<'perfect_10' | 'triple_crit' | null>(null);
  const lastLoadedProfileIdRef = useRef<string | null>(null);

  // 只在 profile.id 变化时加载宠物数据，避免 refreshProfile 导致重新加载
  useEffect(() => {
    if (!profile?.id) return;
    // 同一个 profile.id 只加载一次
    if (lastLoadedProfileIdRef.current === profile.id) return;
    lastLoadedProfileIdRef.current = profile.id;

    let cancelled = false;
    (async () => {
      try {
        const [{ data: studentPetData }, { data: configData }] = await Promise.all([
          backendClient
            .from('student_pets')
            .select('*')
            .eq('student_id', profile.id)
            .maybeSingle(),
          backendClient
            .from('pet_config')
            .select('*')
            .maybeSingle(),
        ]);

        if (cancelled) return;

        const currentMaxStage = configData?.max_stage || 5;
        setMaxStage(currentMaxStage);

        if (studentPetData) {
          const displayLevel = studentPetData.display_level || studentPetData.growth_level || 1;
          const stage = Math.min(displayLevel, currentMaxStage);
          setPetLevel(stage);

          const { data: petData } = await backendClient
            .from('pets')
            .select('*')
            .eq('id', studentPetData.pet_id)
            .maybeSingle();

          if (cancelled) return;

          if (petData) {
            const imageField = `image_level_${stage}`;
            setPetImage(petData[imageField] || null);
            setPetName(petData.name || '萌宠');
          }
        }
        setIsLoaded(true);
      } catch (err) {
        console.error('PetCompanion: 加载宠物数据失败', err);
        if (!cancelled) setIsLoaded(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [profile?.id]);

  useEffect(() => {
    if (!showResult || isCorrect === null) {
      setMood('idle');
      return;
    }

    if (isCorrect) {
      if (isCrit) {
        setMood('excited');
      } else if (newHonor?.type === 'perfect_10') {
        setMood('proud');
      } else {
        setMood('happy');
      }
    } else {
      if (currentWrong >= 3) {
        setMood('embarrassed');
      } else {
        setMood('sad');
      }
    }
  }, [showResult, isCorrect, isCrit, newHonor, currentWrong]);

  useEffect(() => {
    if (newHonor && (newHonor.type === 'perfect_10' || newHonor.type === 'triple_crit') && showResult) {
      setCelebrationType(newHonor.type as 'perfect_10' | 'triple_crit');
      setShowCelebration(true);
      const timer = setTimeout(() => {
        setShowCelebration(false);
        setCelebrationType(null);
      }, 2500);
      return () => clearTimeout(timer);
    }
  }, [newHonor, showResult]);

  const celebrateColor = celebrationType === 'perfect_10' ? '#22c55e' : '#eab308';

  if (!isLoaded) return null;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      className="flex flex-col items-center gap-1"
    >
      <div className="relative">
        <BuffAura buffs={buffs} />
        <PetSprite
          imageUrl={petImage}
          petName={petName}
          mood={mood}
          level={petLevel}
        />

        <AnimatePresence>
          {showCelebration && (
            <>
              {[...Array(8)].map((_, i) => (
                <motion.div
                  key={`particle-${i}`}
                  className="absolute w-1.5 h-1.5 rounded-full"
                  initial={{ opacity: 0, scale: 0, x: 0, y: 0 }}
                  animate={{
                    opacity: [0, 1, 0],
                    scale: [0, 1.5, 0],
                    x: Math.cos((i * 45 * Math.PI) / 180) * (35 + Math.random() * 20),
                    y: Math.sin((i * 45 * Math.PI) / 180) * (35 + Math.random() * 20),
                  }}
                  transition={{ duration: 1 + Math.random() * 0.5, ease: 'easeOut' }}
                  style={{
                    background: PARTICLE_COLORS[i % PARTICLE_COLORS.length],
                    boxShadow: `0 0 6px ${celebrateColor}`,
                  }}
                />
              ))}
              <motion.div
                className="absolute -inset-3 rounded-full"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: [0, 0.3, 0], scale: [0.8, 1.3, 1.5] }}
                transition={{ duration: 1.2, ease: 'easeOut' }}
                style={{
                  background: `radial-gradient(circle, ${celebrateColor}44 0%, transparent 70%)`,
                }}
              />
            </>
          )}
        </AnimatePresence>
      </div>
      <PetBubble
        mood={mood}
        streak={currentStreak}
        critStreak={currentCritStreak}
        wrongCount={currentWrong}
      />
    </motion.div>
  );
};
