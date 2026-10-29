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
// 关闭特效时的轻量文字提示停留时长（够看清掉了什么）
const LIGHT_DURATION = 4500;

/**
 * 特效开关（教师端「刷题打怪系统 → 打怪系统」可关）。
 * 模块级缓存 30 秒：这个组件在练习/测试/错题/PK 四个页面各挂一份，
 * 不缓存会在每个页面各请求一次；老师改开关后 30 秒内生效。
 */
let effectFlagsPromise: Promise<{ equip: boolean }> | null = null;
let effectFlagsAt = 0;
function loadEffectFlags(): Promise<{ equip: boolean }> {
  const now = Date.now();
  if (!effectFlagsPromise || now - effectFlagsAt > 30000) {
    effectFlagsAt = now;
    effectFlagsPromise = fetch('/api/public/game-flags')
      .then((r) => r.json())
      .then((j) => ({ equip: (j?.data?.equip_effect_enabled ?? true) !== false }))
      .catch(() => ({ equip: true }));
  }
  return effectFlagsPromise;
}

/**
 * 装备掉落弹窗。
 *
 * ⛔ 性能铁律（2026-10-14，配合 CritEffect 一起修「暴击后卡顿」）：
 *    这里原先有**三处 `repeat: Infinity`**，其中一处还是 `blur-2xl`（40px 高斯模糊）的
 *    `absolute inset-0` 光晕在无限做 opacity+scale 动画 —— 模糊层每帧重新栅格化，
 *    是这套「暴击/掉装备」特效里最贵的一项。暴击与掉装备常常同一刻发生，
 *    叠加剧场就是合成器被压住、滚轮失灵、要最小化复原才恢复。
 *    现在：光晕改成**一次性淡入后静止**（视觉上仍是那团金色辉光），
 *    流光扫过与图标浮动改成有限次数（不再永久跑），并给动画层标 willChange/contain。
 */
export const EquipmentDropEffect: React.FC = () => {
  const lastEvent = useGameEventStore((s) => s.lastEvent);
  const eventCount = useGameEventStore((s) => s.eventCount);
  const eventPayload = useGameEventStore((s) => s.eventPayload);

  const [equipments, setEquipments] = useState<DroppedEquipment[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isVisible, setIsVisible] = useState(false);
  const [prevEventCount, setPrevEventCount] = useState(eventCount);

  // 老师关掉「装备掉落特效」时走轻量模式：不播动效，只弹一条文字说掉了什么。
  // 关特效不等于不告诉学生 —— 否则学生根本不知道掉了装备（2026-10-29 吴老要求）。
  const [lightweight, setLightweight] = useState(false);
  const [lightEquips, setLightEquips] = useState<DroppedEquipment[]>([]);
  const [lightVisible, setLightVisible] = useState(false);

  useEffect(() => {
    let alive = true;
    loadEffectFlags().then((f) => {
      if (alive) setLightweight(!f.equip);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!lightVisible) return;
    const timer = setTimeout(() => setLightVisible(false), LIGHT_DURATION);
    return () => clearTimeout(timer);
  }, [lightVisible, lightEquips]);

  useEffect(() => {
    console.log('[EquipmentDropEffect] 事件变化 - lastEvent:', lastEvent, 'eventCount:', eventCount, 'prevEventCount:', prevEventCount);
    if (eventCount !== prevEventCount && lastEvent === 'equipment_drop' && eventPayload) {
      const dropped: DroppedEquipment[] = eventPayload.equipments || [];
      console.log('[EquipmentDropEffect] 检测到装备掉落事件，装备数量:', dropped.length);
      if (dropped.length > 0) {
        if (lightweight) {
          // 轻量模式：一次列全（考试交卷可能连掉好几件，逐件播反而看不清）
          setLightEquips(dropped);
          setLightVisible(true);
        } else {
          setEquipments(dropped);
          setCurrentIndex(0);
          setIsVisible(true);
        }
      }
      setPrevEventCount(eventCount);
    }
  }, [eventCount, lastEvent, eventPayload, prevEventCount, lightweight]);

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
    <>
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
          {/* 金色辉光：一次性淡入后**静止**（原来是 repeat:Infinity 的 40px 模糊层无限动画，
              每帧重栅格化，是暴击时刻最贵的一笔开销）。 */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.7 }}
            transition={{ duration: 0.45, ease: 'easeOut' }}
            className="absolute inset-0 rounded-3xl bg-gradient-to-r from-amber-300 to-yellow-400 blur-2xl"
            // ⚠️ 不要加 contain:'paint' —— 会把 blur 外溢的辉光裁掉
            style={{ willChange: 'opacity' }}
          />

          <div
            className="relative flex flex-col items-center px-10 py-8 rounded-3xl shadow-2xl bg-gradient-to-r from-amber-400 to-yellow-500 text-white min-w-[320px] overflow-hidden"
          >
            {/* 流光扫过：跑 2 次就停（原来 repeat:Infinity 会一直扫） */}
            <motion.div
              initial={{ x: '-100%' }}
              animate={{ x: '100%' }}
              transition={{ duration: 1.2, repeat: 1, repeatDelay: 0.4 }}
              className="absolute top-0 left-0 w-1/2 h-full bg-gradient-to-r from-transparent via-white/30 to-transparent skew-x-12"
            />

            {/* 图标：进入弹跳 + 轻微浮动 2 次后停（原来 y 是 repeat:Infinity） */}
            <motion.div
              initial={{ scale: 0, rotate: -30 }}
              animate={{
                scale: [0, 1.3, 1],
                rotate: [ -30, 10, 0],
                y: [0, -8, 0, -8, 0],
              }}
              transition={{
                duration: 0.8,
                scale: { times: [0, 0.6, 1], type: 'spring', stiffness: 400 },
                rotate: { times: [0, 0.6, 1] },
                y: { duration: 2.4, delay: 0.8, repeat: 1, repeatType: 'reverse' },
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

    {/*
      关闭「装备掉落特效」后的轻量提示：
      纯静态 DOM（无 motion、无 blur、无循环动画），只做一次 CSS 淡入，
      告诉学生掉了什么，4.5 秒自动消失。不能用全屏层，否则等于没关。
    */}
    {lightVisible && lightEquips.length > 0 && (
      <div className="fixed top-20 left-1/2 -translate-x-1/2 z-[9999] pointer-events-none px-3">
        <div
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gray-900/95 text-white shadow-lg text-sm max-w-[92vw]"
          style={{ animation: 'equipDropIn 0.25s ease-out' }}
        >
          <span className="text-lg leading-none shrink-0">🎁</span>
          <span className="min-w-0">
            <span className="font-semibold">获得装备</span>
            <span className="mx-1.5 text-gray-400">|</span>
            {lightEquips.map((eq, idx) => (
              <span key={`${eq.id}-${idx}`} className="whitespace-nowrap">
                {idx > 0 && <span className="text-gray-500">、</span>}
                <span className="mr-0.5">{eq.icon || '⚔️'}</span>
                <span className="font-medium">{eq.name}</span>
                {Number(eq.crit_bonus) > 0 && (
                  <span className="text-amber-300"> +{eq.crit_bonus}%</span>
                )}
              </span>
            ))}
          </span>
        </div>
        {/* 一次性淡入关键帧，用完即弃；不含模糊与循环，弱机无压力 */}
        <style>{`@keyframes equipDropIn { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: translateY(0); } }`}</style>
      </div>
    )}
    </>
  );
};
