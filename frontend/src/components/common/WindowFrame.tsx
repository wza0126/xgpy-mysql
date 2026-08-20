import React, { useState, useRef, useCallback, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useDesktopStore } from '../../store/desktopStore';
import { useSkinStore } from '../../store/skinStore';

interface WindowFrameProps {
  id: string;
  title: string;
  children: React.ReactNode;
  isMaximized: boolean;
  isMinimized: boolean;
  zIndex: number;
}

const MIN_WIDTH = 280;
const MIN_HEIGHT = 200;

// 生成星点（星河璀璨皮肤用）
function generateStars(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    top: Math.random() * 100,
    left: Math.random() * 100,
    size: Math.random() * 2 + 1,
    delay: Math.random() * 2,
  }));
}

// 生成金粉粒子（流光金黑皮肤用）
function generateGoldParticles(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    top: Math.random() * 100,
    left: Math.random() * 100,
    delay: Math.random() * 3,
  }));
}

export const WindowFrame: React.FC<WindowFrameProps> = ({
  id,
  title,
  children,
  isMaximized,
  isMinimized,
  zIndex,
}) => {
  const { closeWindow, minimizeWindow, maximizeWindow, restoreWindow, activateWindow } = useDesktopStore();
  const skin = useSkinStore((s) => s.activeSkin);
  const [position, setPosition] = useState({ x: 80, y: 80 });
  const [size, setSize] = useState({ width: 850, height: 720 });
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [resizeDirection, setResizeDirection] = useState('');

  // 星点和粒子（仅在华丽皮肤时生成一次）
  const stars = useRef(generateStars(15));
  const goldParticles = useRef(generateGoldParticles(8));

  // 用 ref 存储拖拽/调整大小的实时状态，避免闭包陷阱
  const dragState = useRef({
    startX: 0,
    startY: 0,
    initialX: 80,
    initialY: 80,
    initialWidth: 850,
    initialHeight: 720,
    direction: '',
    isDragging: false,
    isResizing: false,
  });

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (isMaximized) return;
    if (e.button !== 0) return;
    dragState.current = {
      ...dragState.current,
      startX: e.clientX,
      startY: e.clientY,
      initialX: position.x,
      initialY: position.y,
      isDragging: true,
      isResizing: false,
    };
    setIsDragging(true);
    activateWindow(id);
  }, [isMaximized, position.x, position.y, id, activateWindow]);

  const handleResizeStart = useCallback((direction: string, e: React.MouseEvent) => {
    if (isMaximized) return;
    e.stopPropagation();
    if (e.button !== 0) return;
    dragState.current = {
      ...dragState.current,
      startX: e.clientX,
      startY: e.clientY,
      initialX: position.x,
      initialY: position.y,
      initialWidth: size.width,
      initialHeight: size.height,
      direction,
      isDragging: false,
      isResizing: true,
    };
    setIsResizing(true);
    setResizeDirection(direction);
    activateWindow(id);
  }, [isMaximized, position.x, position.y, size.width, size.height, id, activateWindow]);

  useEffect(() => {
    if (!isDragging && !isResizing) return;

    const handleGlobalMouseMove = (e: MouseEvent) => {
      const ds = dragState.current;
      const dx = e.clientX - ds.startX;
      const dy = e.clientY - ds.startY;

      if (ds.isDragging) {
        setPosition({
          x: ds.initialX + dx,
          y: ds.initialY + dy,
        });
      } else if (ds.isResizing) {
        const newSize = { width: ds.initialWidth, height: ds.initialHeight };
        const newPosition = { x: ds.initialX, y: ds.initialY };

        if (ds.direction.includes('e')) {
          newSize.width = Math.max(MIN_WIDTH, ds.initialWidth + dx);
        }
        if (ds.direction.includes('w')) {
          const newWidth = Math.max(MIN_WIDTH, ds.initialWidth - dx);
          newPosition.x = ds.initialX + (ds.initialWidth - newWidth);
          newSize.width = newWidth;
        }
        if (ds.direction.includes('s')) {
          newSize.height = Math.max(MIN_HEIGHT, ds.initialHeight + dy);
        }
        if (ds.direction.includes('n')) {
          const newHeight = Math.max(MIN_HEIGHT, ds.initialHeight - dy);
          newPosition.y = ds.initialY + (ds.initialHeight - newHeight);
          newSize.height = newHeight;
        }

        setSize(newSize);
        setPosition(newPosition);
      }
    };

    const handleGlobalMouseUp = () => {
      dragState.current.isDragging = false;
      dragState.current.isResizing = false;
      setIsDragging(false);
      setIsResizing(false);
      setResizeDirection('');
    };

    document.addEventListener('mousemove', handleGlobalMouseMove);
    document.addEventListener('mouseup', handleGlobalMouseUp);

    document.body.style.userSelect = 'none';
    document.body.style.cursor = isDragging ? 'grabbing' : '';

    return () => {
      document.removeEventListener('mousemove', handleGlobalMouseMove);
      document.removeEventListener('mouseup', handleGlobalMouseUp);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
  }, [isDragging, isResizing]);

  const getCursorStyle = (direction: string) => {
    switch (direction) {
      case 'n': return 'cursor-n-resize';
      case 's': return 'cursor-s-resize';
      case 'e': return 'cursor-e-resize';
      case 'w': return 'cursor-w-resize';
      case 'ne': return 'cursor-ne-resize';
      case 'nw': return 'cursor-nw-resize';
      case 'se': return 'cursor-se-resize';
      case 'sw': return 'cursor-sw-resize';
      default: return '';
    }
  };

  // 标题栏动画类
  const titleBarAnimClass = skin.animation === 'shimmer' ? 'skin-shimmer'
    : skin.animation === 'pulse' ? 'skin-pulse'
    : skin.animation === 'gold-flow' ? 'skin-gold-flow-bar'
    : '';

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1, transition: { duration: 0.15 } }}
      className={`absolute bg-white rounded-lg overflow-hidden ${skin.borderClass} ${skin.shadowClass} ${
        isMaximized ? 'inset-4' : ''
      }`}
      style={{
        display: isMinimized ? 'none' : undefined,
        zIndex,
        left: isMaximized ? undefined : position.x,
        top: isMaximized ? undefined : position.y,
        width: isMaximized ? undefined : size.width,
        height: isMaximized ? undefined : size.height,
      }}
      // 用 onMouseDown 激活窗口而不是 onClick：
      // 点击窗口内的按钮（如 AppCenter 里"代码秘境"按钮）会先触发 openWindow 把新窗口置于顶层，
      // 紧接着 click 事件会冒泡到本根 div；若用 onClick，会让当前窗口"二次抢前"盖住刚打开的新窗口。
      // 改为 onMouseDown 后，激活发生在 click 之前，按钮的 click 不会再让父窗口被激活到顶层。
      onMouseDown={() => !isMinimized && activateWindow(id)}
    >
      <div
        className={`relative h-10 ${skin.titleBarClass} ${titleBarAnimClass} flex items-center justify-between px-4 select-none overflow-hidden`}
        onMouseDown={handleMouseDown}
        onDoubleClick={(e) => {
          e.stopPropagation();
          isMaximized ? restoreWindow(id) : maximizeWindow(id);
        }}
        style={{ cursor: isMaximized ? 'default' : isDragging ? 'grabbing' : 'grab' }}
      >
        {/* 星河璀璨：星点闪烁 */}
        {skin.animation === 'galaxy' && (
          <div className="absolute inset-0 pointer-events-none">
            {stars.current.map((star) => (
              <div
                key={star.id}
                className="skin-galaxy-star"
                style={{
                  top: `${star.top}%`,
                  left: `${star.left}%`,
                  width: `${star.size}px`,
                  height: `${star.size}px`,
                  animationDelay: `${star.delay}s`,
                }}
              />
            ))}
            {/* 偶发流星 */}
            <div
              className="skin-galaxy-meteor"
              style={{ top: '20%', left: '10%' }}
            />
          </div>
        )}

        {/* 流光金黑：金粉粒子 */}
        {skin.animation === 'gold-flow' && (
          <div className="absolute inset-0 pointer-events-none">
            {goldParticles.current.map((p) => (
              <div
                key={p.id}
                className="skin-gold-particle"
                style={{
                  top: `${p.top}%`,
                  left: `${p.left}%`,
                  animationDelay: `${p.delay}s`,
                }}
              />
            ))}
          </div>
        )}

        <div className="relative flex items-center gap-2 z-10">
          <span className={`${skin.titleTextClass} font-medium`}>{title}</span>
        </div>
        <div className="relative flex items-center gap-2 z-10">
          <button
            onClick={(e) => {
              e.stopPropagation();
              minimizeWindow(id);
            }}
            className={`w-6 h-6 flex items-center justify-center rounded ${skin.buttonHoverClass} transition-colors`}
          >
            <i className={`fa-solid fa-minus ${skin.titleTextClass} text-xs`}></i>
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              isMaximized ? restoreWindow(id) : maximizeWindow(id);
            }}
            className={`w-6 h-6 flex items-center justify-center rounded ${skin.buttonHoverClass} transition-colors`}
          >
            <i className={`fa-solid ${isMaximized ? 'fa-compress' : 'fa-expand'} ${skin.titleTextClass} text-xs`}></i>
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              closeWindow(id);
            }}
            className={`w-6 h-6 flex items-center justify-center rounded ${skin.closeButtonClass} transition-colors`}
          >
            <i className={`fa-solid fa-xmark ${skin.titleTextClass} text-xs`}></i>
          </button>
        </div>
      </div>
      <div className={`h-[calc(100%-40px)] overflow-auto ${skin.contentBgClass}`}>
        {children}
      </div>

      {!isMaximized && (
        <>
          {/* 手柄 z-40：保证位于内容滚动条之上，否则右下角等区域会被滚动条挡住无法调整大小 */}
          <div
            className={`absolute top-0 left-0 right-0 h-2 z-40 ${getCursorStyle('n')}`}
            onMouseDown={(e) => handleResizeStart('n', e)}
          />
          <div
            className={`absolute bottom-0 left-0 right-0 h-2 z-40 ${getCursorStyle('s')}`}
            onMouseDown={(e) => handleResizeStart('s', e)}
          />
          <div
            className={`absolute top-0 bottom-0 left-0 w-2 z-40 ${getCursorStyle('w')}`}
            onMouseDown={(e) => handleResizeStart('w', e)}
          />
          <div
            className={`absolute top-0 bottom-0 right-0 w-2 z-40 ${getCursorStyle('e')}`}
            onMouseDown={(e) => handleResizeStart('e', e)}
          />
          <div
            className={`absolute top-0 left-0 w-4 h-4 z-40 ${getCursorStyle('nw')}`}
            onMouseDown={(e) => handleResizeStart('nw', e)}
          />
          <div
            className={`absolute top-0 right-0 w-4 h-4 z-40 ${getCursorStyle('ne')}`}
            onMouseDown={(e) => handleResizeStart('ne', e)}
          />
          <div
            className={`absolute bottom-0 left-0 w-4 h-4 z-40 ${getCursorStyle('sw')}`}
            onMouseDown={(e) => handleResizeStart('sw', e)}
          />
          <div
            className={`absolute bottom-0 right-0 w-4 h-4 z-40 ${getCursorStyle('se')}`}
            onMouseDown={(e) => handleResizeStart('se', e)}
          />
        </>
      )}
    </motion.div>
  );
};
