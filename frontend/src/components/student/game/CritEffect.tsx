import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface CritEffectProps {
  isCrit: boolean;
  onComplete: () => void;
}

/**
 * 暴击全屏特效。
 *
 * ⛔ 性能铁律（2026-10-14 实测修复「暴击后画面卡顿、滚轮失控、最小化复原才恢复」）：
 *    这类「卡住不恢复、最小化再复原就好」的现象是**合成器卡死/合成层爆炸**的典型特征。
 *    实测（backend/scripts/debug/diag_crit_lag.cjs，CDP LayerTree）：
 *      · 练习页静置 = 50 个合成层（视口级 3 个）；
 *      · 暴击期间 = 58 个合成层（视口级 **6** 个）→ 本组件一口气多建了 **3 个整屏层**。
 *    所以这里守住三条：
 *      1. **不要给整屏层做 transform**：`fixed inset-0` 的容器上做 scale(→1.2 / 退出→2)，
 *         等于把整个视口按 2× 栅格化，一张层纹理就有 ~3000×1500 像素；
 *         缩放必须下移到**文字本身**（小元素）上。容器透明、本身没有可见像素，
 *         所以「整屏跟着缩放」在视觉上毫无变化，纯属白烧显存 —— 移下来零视觉代价。
 *      2. **不要留没有视觉作用的整屏层**：原先第三个 `key="shake"` 层是个**空 div**
 *         （无内容、无背景、pointer-events-none），只在每帧做 transform，
 *         屏幕上什么都不动，却实打实占一个视口级合成层。已删。
 *      3. 整屏层只允许动 opacity，并显式 `willChange: 'opacity'` + `contain: 'paint'`
 *         让它稳定走**合成器动画**，避免每帧重绘整屏 radial-gradient。
 *    另外多重 `text-shadow` 的大半径高斯模糊会跟着缩放每帧重栅格化，
 *    这里把双重 40px 收敛成单层 18px，视觉几乎无差别。
 */
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
              // 只动 opacity → 让浏览器把它锁成一个合成层走合成器动画，不再每帧重绘整屏渐变
              willChange: 'opacity',
              contain: 'paint',
            }}
          />
          <motion.div
            key="text"
            // ⛔ 这个 `fixed inset-0` 的容器**只允许动 opacity**（整屏透明，动它几乎不要钱）。
            //    缩放/位移一律下移到下面的文字元素上。
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.8, ease: 'easeOut' }}
            className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none"
            style={{ willChange: 'opacity' }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.3, y: 20 }}
              animate={{ opacity: 1, scale: 1.2, y: 0 }}
              exit={{ opacity: 0, scale: 2, y: -100 }}
              transition={{ duration: 0.8, ease: 'easeOut' }}
              className="text-7xl font-black text-yellow-400"
              style={{
                textShadow: '0 0 18px rgba(255,215,0,0.75)',
                willChange: 'transform, opacity',
              }}
            >
              ⚡暴击！x2
            </motion.div>
          </motion.div>
          {/* 原先还有一个 key="shake" 的 `fixed inset-0` 层：空 div、无背景、无内容，
              每帧做 x 抖动但屏幕上什么都看不到 —— 纯占一个视口级合成层，故删除。 */}
        </>
      )}
    </AnimatePresence>
  );
};
