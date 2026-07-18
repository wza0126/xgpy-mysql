import React, { useRef, useState, useEffect, useCallback } from 'react';

interface PaintBoardProps {
  isOpen: boolean;
  onClose: () => void;
}

const COLORS = [
  '#FF0000', '#FF6B00', '#FFD700', '#00FF00',
  '#008080', '#0066FF', '#9900FF', '#FF69B4',
  '#000000', '#808080', '#FFFFFF',
];

const BRUSH_SIZES = [2, 4, 6, 10, 16];

export const PaintBoard: React.FC<PaintBoardProps> = ({ isOpen, onClose }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentColor, setCurrentColor] = useState('#FF0000');
  const [currentSize, setCurrentSize] = useState(4);
  const [isEraser, setIsEraser] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [toolbarPos, setToolbarPos] = useState({ x: 20, y: 80 });
  const lastPoint = useRef<{ x: number; y: number } | null>(null);

  // 初始化/调整 canvas 尺寸
  useEffect(() => {
    if (!isOpen) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resizeCanvas = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      // 保存当前内容
      const prev = canvas.toDataURL();
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      // 恢复内容
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0);
      img.src = prev;
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    return () => window.removeEventListener('resize', resizeCanvas);
  }, [isOpen]);

  const saveState = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const imageData = canvas.toDataURL();
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(imageData);
    if (newHistory.length > 30) newHistory.shift();
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
  }, [history, historyIndex]);

  const getCoords = (e: React.PointerEvent): { x: number; y: number } => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (canvas.width / rect.width),
      y: (e.clientY - rect.top) * (canvas.height / rect.height),
    };
  };

  const startDrawing = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);
    const { x, y } = getCoords(e);
    lastPoint.current = { x, y };
    setIsDrawing(true);

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.strokeStyle = currentColor;
    ctx.lineWidth = currentSize;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (isEraser) {
      ctx.globalCompositeOperation = 'destination-out';
    } else {
      ctx.globalCompositeOperation = 'source-over';
    }
    // 画一个点（单击也能留下痕迹）
    ctx.arc(x, y, currentSize / 2, 0, Math.PI * 2);
    ctx.fillStyle = isEraser ? '#000' : currentColor;
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const draw = (e: React.PointerEvent) => {
    if (!isDrawing) return;
    const { x, y } = getCoords(e);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.lineTo(x, y);
    ctx.stroke();
    lastPoint.current = { x, y };
  };

  const stopDrawing = (e: React.PointerEvent) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (canvas) {
      try { canvas.releasePointerCapture(e.pointerId); } catch {}
    }
    setIsDrawing(false);
    lastPoint.current = null;
    saveState();
  };

  const undo = useCallback(() => {
    if (historyIndex <= 0) return;
    const newIndex = historyIndex - 1;
    setHistoryIndex(newIndex);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const img = new Image();
    img.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
    };
    img.src = history[newIndex];
  }, [history, historyIndex]);

  const redo = useCallback(() => {
    if (historyIndex >= history.length - 1) return;
    const newIndex = historyIndex + 1;
    setHistoryIndex(newIndex);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const img = new Image();
    img.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
    };
    img.src = history[newIndex];
  }, [history, historyIndex]);

  const clearCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    saveState();
  }, [saveState]);

  const downloadImage = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = `paint_${Date.now()}.png`;
    link.href = canvas.toDataURL();
    link.click();
  }, []);

  // 拖拽工具栏
  const dragToolbar = (e: React.MouseEvent) => {
    e.stopPropagation();
    const startX = e.clientX - toolbarPos.x;
    const startY = e.clientY - toolbarPos.y;
    const move = (ev: MouseEvent) => {
      setToolbarPos({
        x: Math.max(0, Math.min(window.innerWidth - 100, ev.clientX - startX)),
        y: Math.max(0, Math.min(window.innerHeight - 50, ev.clientY - startY)),
      });
    };
    const stop = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', stop);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', stop);
  };

  if (!isOpen) return null;

  return (
    <>
      {/* 全屏透明画布层 */}
      <canvas
        ref={canvasRef}
        className="fixed inset-0 z-[9999]"
        style={{
          pointerEvents: 'auto',
          cursor: isEraser ? 'cell' : 'crosshair',
          touchAction: 'none',
        }}
        onPointerDown={startDrawing}
        onPointerMove={draw}
        onPointerUp={stopDrawing}
        onPointerLeave={stopDrawing}
      />

      {/* 浮动工具栏 */}
      <div
        className="fixed z-[10001] bg-white/95 backdrop-blur-sm rounded-xl shadow-2xl border border-gray-200 overflow-visible"
        style={{ left: toolbarPos.x, top: toolbarPos.y }}
      >
        {/* 拖拽手柄 */}
        <div
          className="bg-gradient-to-r from-indigo-500 to-purple-600 text-white px-3 py-1.5 flex items-center justify-between cursor-move rounded-t-xl"
          onMouseDown={dragToolbar}
        >
          <div className="flex items-center gap-1.5">
            <i className="fa-solid fa-grip-vertical text-xs"></i>
            <span className="text-sm font-medium">画笔</span>
          </div>
          <button
            onClick={onClose}
            className="hover:bg-white/20 px-1.5 py-0.5 rounded transition-colors"
          >
            <i className="fa-solid fa-xmark text-sm"></i>
          </button>
        </div>

        <div className="p-2.5 space-y-2 w-[260px]">
          {/* 颜色行 */}
          <div className="flex items-center gap-1 flex-wrap">
            {COLORS.map((color) => (
              <button
                key={color}
                onClick={() => { setCurrentColor(color); setIsEraser(false); }}
                className={`w-6 h-6 rounded-full border-2 transition-transform hover:scale-110 ${
                  currentColor === color && !isEraser
                    ? 'border-gray-800 scale-110 ring-1 ring-gray-400'
                    : 'border-gray-300'
                }`}
                style={{ backgroundColor: color }}
              />
            ))}
          </div>

          {/* 粗细 + 橡皮擦 */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              {BRUSH_SIZES.map((size) => (
                <button
                  key={size}
                  onClick={() => setCurrentSize(size)}
                  className={`w-7 h-7 rounded flex items-center justify-center transition-colors ${
                    currentSize === size
                      ? 'bg-indigo-100 text-indigo-600 ring-1 ring-indigo-300'
                      : 'hover:bg-gray-100 text-gray-600'
                  }`}
                >
                  <span className="rounded-full bg-current" style={{ width: Math.min(size, 14), height: Math.min(size, 14) }} />
                </button>
              ))}
            </div>
            <button
              onClick={() => setIsEraser(!isEraser)}
              className={`px-2.5 py-1 rounded text-xs flex items-center gap-1 transition-colors ${
                isEraser ? 'bg-gray-700 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              <i className="fa-solid fa-eraser"></i>
              擦除
            </button>
          </div>

          {/* 操作行 */}
          <div className="flex items-center gap-1 border-t border-gray-100 pt-2">
            <button
              onClick={undo}
              disabled={historyIndex <= 0}
              className="flex-1 py-1.5 bg-gray-100 hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed rounded text-xs flex items-center justify-center gap-1 transition-colors"
            >
              <i className="fa-solid fa-undo"></i>
              撤销
            </button>
            <button
              onClick={redo}
              disabled={historyIndex >= history.length - 1}
              className="flex-1 py-1.5 bg-gray-100 hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed rounded text-xs flex items-center justify-center gap-1 transition-colors"
            >
              <i className="fa-solid fa-redo"></i>
              重做
            </button>
            <button
              onClick={clearCanvas}
              className="flex-1 py-1.5 bg-red-50 hover:bg-red-100 text-red-600 rounded text-xs flex items-center justify-center gap-1 transition-colors"
            >
              <i className="fa-solid fa-trash"></i>
              清空
            </button>
            <button
              onClick={downloadImage}
              className="flex-1 py-1.5 bg-indigo-500 hover:bg-indigo-600 text-white rounded text-xs flex items-center justify-center gap-1 transition-colors"
            >
              <i className="fa-solid fa-download"></i>
              保存
            </button>
          </div>
        </div>
      </div>
    </>
  );
};
