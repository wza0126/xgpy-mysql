import { create } from 'zustand';
import { WindowState, DesktopIcon } from '../types';

interface DesktopState {
  windows: WindowState[];
  activeWindowId: string | null;
  zIndexCounter: number;
  background: string;
  setBackground: (url: string) => void;
  openWindow: (window: Omit<WindowState, 'zIndex' | 'isOpen'>) => void;
  closeWindow: (id: string) => void;
  minimizeWindow: (id: string) => void;
  minimizeAllWindows: () => void;
  maximizeWindow: (id: string) => void;
  restoreWindow: (id: string) => void;
  activateWindow: (id: string) => void;
}

export const desktopIcons: DesktopIcon[] = [
  { id: 'learn', title: '学习', icon: 'fa-book', color: 'bg-blue-500' },
  { id: 'practice', title: '练习', icon: 'fa-pen-to-square', color: 'bg-green-500' },
  { id: 'test', title: '测试', icon: 'fa-clipboard-check', color: 'bg-purple-500' },
  { id: 'wrong', title: '错题集', icon: 'fa-circle-xmark', color: 'bg-red-500' },
  { id: 'notebook', title: '记事本', icon: 'fa-note-sticky', color: 'bg-yellow-500' },
  { id: 'python', title: 'Python编程', icon: 'fa-code', color: 'bg-blue-600' },
  { id: 'apps', title: '应用中心', icon: 'fa-rocket', color: 'bg-indigo-500' },
  { id: 'pet', title: '萌宠', icon: 'fa-paw', color: 'bg-pink-500' },
  { id: 'exchange', title: '兑换', icon: 'fa-gift', color: 'bg-orange-500' },
  { id: 'leaderboard', title: '排行榜', icon: 'fa-trophy', color: 'bg-amber-500' },
  { id: 'security', title: '登录安全', icon: 'fa-shield-halved', color: 'bg-teal-500' },
  { id: 'proxyBrowser', title: '上网冲浪', icon: 'fa-earth-asia', color: 'bg-sky-500' },
  { id: 'profile', title: '我的', icon: 'fa-user', color: 'bg-cyan-500' },
];

export const useDesktopStore = create<DesktopState>((set, get) => ({
  windows: [],
  activeWindowId: null,
  zIndexCounter: 100,
  background: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=1920',

  setBackground: (url) => set({ background: url }),

  openWindow: (window) => {
    const { windows, zIndexCounter } = get();
    const existing = windows.find((w) => w.id === window.id);

    if (existing) {
      set({
        windows: windows.map((w) =>
          w.id === window.id
            ? { ...w, isOpen: true, isMinimized: false, zIndex: zIndexCounter + 1 }
            : w
        ),
        activeWindowId: window.id,
        zIndexCounter: zIndexCounter + 1,
      });
    } else {
      set({
        windows: [
          ...windows,
          {
            ...window,
            isOpen: true,
            zIndex: zIndexCounter + 1,
          },
        ],
        activeWindowId: window.id,
        zIndexCounter: zIndexCounter + 1,
      });
    }
  },

  closeWindow: (id) => {
    const { windows } = get();
    set({
      windows: windows.filter((w) => w.id !== id),
      activeWindowId: null,
    });
  },

  minimizeWindow: (id) => {
    const { windows } = get();
    set({
      windows: windows.map((w) =>
        w.id === id ? { ...w, isMinimized: true } : w
      ),
      activeWindowId: null,
    });
  },

  minimizeAllWindows: () => {
    const { windows } = get();
    set({
      windows: windows.map((w) => ({ ...w, isMinimized: true })),
      activeWindowId: null,
    });
  },

  maximizeWindow: (id) => {
    const { windows, zIndexCounter } = get();
    set({
      windows: windows.map((w) =>
        w.id === id
          ? { ...w, isMaximized: true, zIndex: zIndexCounter + 1 }
          : w
      ),
      activeWindowId: id,
      zIndexCounter: zIndexCounter + 1,
    });
  },

  restoreWindow: (id) => {
    const { windows, zIndexCounter } = get();
    set({
      windows: windows.map((w) =>
        w.id === id
          ? { ...w, isMaximized: false, isMinimized: false, zIndex: zIndexCounter + 1 }
          : w
      ),
      activeWindowId: id,
      zIndexCounter: zIndexCounter + 1,
    });
  },

  activateWindow: (id) => {
    const { windows, zIndexCounter } = get();
    set({
      windows: windows.map((w) =>
        w.id === id ? { ...w, zIndex: zIndexCounter + 1 } : w
      ),
      activeWindowId: id,
      zIndexCounter: zIndexCounter + 1,
    });
  },
}));
