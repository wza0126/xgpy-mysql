import { useState, useCallback } from 'react';

const STORAGE_KEY = 'xgpy_practice_quick_mode';

// 学生端练习「快速模式」开关：默认开启，偏好存 localStorage，三个练习组件（练习模块 /
// 同类题弹窗 / 错题本）共用同一份偏好，任何一处切换全局生效。
// 快速模式行为：单选点选项即交、填空回车即交、结果页回车进下一题；关闭则恢复传统提交按钮流程。
export function useQuickMode(): [boolean, () => void] {
  const [quickMode, setQuickMode] = useState<boolean>(() => {
    try {
      // 没存过 = 默认开；显式存过 '0' 才关
      return window.localStorage.getItem(STORAGE_KEY) !== '0';
    } catch {
      return true; // 隐私模式等拿不到 localStorage 时保底开启
    }
  });

  const toggle = useCallback(() => {
    setQuickMode((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
      } catch {
        // 忽略：localStorage 不可用时仅本次会话生效
      }
      return next;
    });
  }, []);

  return [quickMode, toggle];
}
