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
  // 2026-10-26：三类「大题」连在一起排（综合题 → 操作题 → 编程题），
  // 它们都是整题作答、按小题或步骤给分，和单题练习/测试不是一类。
  { id: 'composite', title: '综合题', icon: 'fa-layer-group', color: 'bg-indigo-600' },
  { id: 'wpsOp', title: '操作题', icon: 'fa-file-excel', color: 'bg-emerald-600' },
  { id: 'python', title: '编程题', icon: 'fa-code', color: 'bg-blue-600' },
  { id: 'wrong', title: '错题集', icon: 'fa-circle-xmark', color: 'bg-red-500' },
  // AI 讲解（学生端）：默认隐藏，老师在「学生管理 → 讲解」里按账号放开
  { id: 'aiExplain', title: 'AI讲解', icon: 'fa-headphones-simple', color: 'bg-violet-600' },
  { id: 'notebook', title: '记事本', icon: 'fa-note-sticky', color: 'bg-yellow-500' },
  { id: 'apps', title: '应用中心', icon: 'fa-rocket', color: 'bg-indigo-500' },
  { id: 'pet', title: '萌宠', icon: 'fa-paw', color: 'bg-pink-500' },
  { id: 'exchange', title: '兑换', icon: 'fa-gift', color: 'bg-orange-500' },
  { id: 'leaderboard', title: '排行榜', icon: 'fa-trophy', color: 'bg-amber-500' },
  { id: 'security', title: '登录安全', icon: 'fa-shield-halved', color: 'bg-teal-500' },
  { id: 'proxyBrowser', title: '上网冲浪', icon: 'fa-earth-asia', color: 'bg-sky-500' },
  { id: 'creative', title: 'AI创意工坊', icon: 'fa-wand-magic-sparkles', color: 'bg-fuchsia-500' },
  { id: 'profile', title: '我的', icon: 'fa-user', color: 'bg-cyan-500' },
];

/**
 * 模块守卫（2026-10-24）：老师在「班级管理」里关掉某个模块后，任何入口——
 * 桌面图标、学习模块里的「去练习」、点桌面宠物打开萌宠——都必须拦住。
 * 逐个入口打补丁必然会漏，所以统一挂在 openWindow 这一道口子上。
 * Desktop 拿到 /api/student/desktop-permissions 后注册；返回字符串=拦截原因，null=放行。
 */
let moduleGuard: ((id: string) => string | null) | null = null;
export const setModuleGuard = (fn: ((id: string) => string | null) | null) => {
  moduleGuard = fn;
};

export const useDesktopStore = create<DesktopState>((set, get) => ({
  windows: [],
  activeWindowId: null,
  zIndexCounter: 100,
  background: '',

  setBackground: (url) => set({ background: url }),

  openWindow: (window) => {
    // 守卫必须在一切之前：被拦的模块连窗口都不创建，避免「开一半又关」的闪动
    if (moduleGuard) {
      const reason = moduleGuard(window.id);
      if (reason) {
        globalThis.alert?.(reason);
        return;
      }
    }
    const { windows, zIndexCounter } = get();

    // 考试期间互斥（2026-10-24）：测试窗口开着时不允许再打开「学习」模块，
    // 防止学生考试时翻知识点。口径与 AI 答疑的暂停一致 —— 都是窗口级，
    // 只要测试窗口开着（哪怕只是停在列表页）就算在考试场景里。
    if (window.id === 'learn' && windows.some((w) => w.id === 'test' && w.isOpen)) {
      globalThis.alert?.('考试期间不能打开学习模块，请先完成考试');
      return;
    }

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
