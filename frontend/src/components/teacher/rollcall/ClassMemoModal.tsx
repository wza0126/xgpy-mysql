// 班级备忘录弹窗：加载班级备忘录并可编辑保存
import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface ClassMemoModalProps {
  className: string;
  onClose: () => void;
  onLoad: () => Promise<string>;
  onSave: (memo: string) => Promise<boolean>;
}

export const ClassMemoModal: React.FC<ClassMemoModalProps> = ({ className, onClose, onLoad, onSave }) => {
  const [memoText, setMemoText] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const text = await onLoad();
      if (!cancelled) {
        setMemoText(text);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSave = async () => {
    setSaving(true);
    const ok = await onSave(memoText);
    setSaving(false);
    if (ok) {
      onClose();
      alert('班级备忘录已保存');
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
          className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-lg shadow-2xl shadow-black/50"
          onClick={(e) => e.stopPropagation()}
        >
          {/* 标题栏 */}
          <div className="flex justify-between items-center px-5 py-3 border-b border-slate-700">
            <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
              <i className="fa-solid fa-book-open text-cyan-400"></i>
              班级备忘录
              <span className="text-xs font-normal text-slate-400">（{className}）</span>
            </h3>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-slate-200 transition-colors"
              title="关闭"
            >
              <i className="fa-solid fa-xmark text-lg"></i>
            </button>
          </div>

          {/* 编辑区 */}
          <div className="p-5">
            {loading ? (
              <div className="flex items-center justify-center py-12 text-slate-400">
                <i className="fa-solid fa-circle-notch fa-spin text-2xl"></i>
              </div>
            ) : (
              <textarea
                value={memoText}
                onChange={(e) => setMemoText(e.target.value)}
                placeholder="记录本班的教学安排、注意事项、待跟进事项等..."
                className="w-full h-56 bg-slate-800/60 border border-slate-700 rounded-lg p-3 text-sm text-slate-200 placeholder-slate-500 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 outline-none resize-none"
                autoFocus
              />
            )}
          </div>

          {/* 底部按钮 */}
          <div className="flex gap-3 px-5 py-4 border-t border-slate-700">
            <button
              onClick={onClose}
              className="flex-1 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm rounded-lg transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleSave}
              disabled={saving || loading}
              className="flex-1 py-2 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white text-sm rounded-lg transition-all shadow-lg shadow-cyan-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <i className={`fa-solid ${saving ? 'fa-circle-notch fa-spin' : 'fa-floppy-disk'} mr-1.5`}></i>
              {saving ? '保存中...' : '保存备忘录'}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};
