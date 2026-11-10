import React from 'react';

/**
 * 「游戏时间」兑换弹窗（2026-11-11 从 AppCenter 抽出来）
 *
 * 为什么抽：桌面推荐应用（双击直达）不打开完整应用中心，
 * 但按时长的应用时长不够时仍然要能就地用钻石换时间 —— 两处必须用同一个弹窗，
 * 否则又会出现「应用中心里能换、桌面点进来换不了」的两套逻辑。
 */
interface Props {
  open: boolean;
  onClose: () => void;
  playtime: any;
  /** 学生档案（取 diamond_balance） */
  profile: any;
  diamonds: number;
  setDiamonds: (n: number) => void;
  onExchange: () => Promise<void> | void;
  exchanging: boolean;
}

export const TimeExchangeModal: React.FC<Props> = ({
  open, onClose, playtime, profile, diamonds, setDiamonds, onExchange, exchanging,
}) => {
  if (!open) return null;
  const perDiamond = playtime?.rules?.diamond_to_minutes ?? 5;
  return (
    <div className="fixed inset-0 z-[9999] bg-black/60 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl p-6 max-w-md w-full">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-gray-800">
            <i className="fa-solid fa-hourglass-half text-sky-500 mr-2"></i>
            游戏时间
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <i className="fa-solid fa-xmark"></i>
          </button>
        </div>

        <div className="bg-sky-50 rounded-xl p-4 mb-4">
          <div className="flex items-baseline justify-between mb-2">
            <span className="text-sm text-gray-600">当前剩余</span>
            <span className="text-2xl font-bold text-sky-600">{playtime?.balance_minutes ?? 0} 分钟</span>
          </div>
          <div className="text-xs text-gray-500 space-y-1">
            <p>今日已赚钻石 {playtime?.today?.earned_diamonds ?? 0}/{playtime?.today?.earn_cap ?? '-'} 颗</p>
            <p>今日已玩 {playtime?.today?.used_minutes ?? 0}/{playtime?.today?.cap_minutes ?? '-'} 分钟</p>
          </div>
        </div>

        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">用钻石兑换</label>
          <div className="flex items-center gap-3">
            <input
              type="number"
              min={1}
              value={diamonds}
              onChange={(e) => setDiamonds(Math.max(1, parseInt(e.target.value) || 1))}
              className="w-24 p-2 border border-gray-300 rounded-lg text-center"
            />
            <span className="text-sm text-gray-600">颗钻石</span>
            <span className="text-sm text-gray-400">→</span>
            <span className="text-lg font-bold text-sky-600">
              {(diamonds * perDiamond)} 分钟
            </span>
          </div>
          <p className="text-xs text-gray-400 mt-2">
            1 颗钻石 = {perDiamond} 分钟 · 单次最多 {playtime?.rules?.max_exchange_minutes ?? 30} 分钟 ·
            当前有 <i className="fa-solid fa-gem text-sky-500"></i> {profile?.diamond_balance ?? 0} 颗
          </p>
        </div>

        <div className="bg-gray-50 rounded-lg p-3 mb-4 text-xs text-gray-500 space-y-1">
          <p className="font-medium text-gray-600 mb-1">怎么用</p>
          <p>· 兑换到的时间存在「时长池」里，所有按时长的应用共用。</p>
          <p>· 打开应用就开始计时，每 30 秒扣一次（点进去看一眼也算半分钟）。</p>
          <p>· 关掉窗口、最小化，或者点一下别的窗口，立刻停止扣时。</p>
          <p>· 每天最多玩 {playtime?.today?.cap_minutes ?? '-'} 分钟，超出后即使有时长也要等明天。</p>
          <p>· 钻石只能通过测试、考试、任务和老师发放获得，积分换不了。</p>
        </div>

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 border border-gray-300 text-gray-600 rounded-lg font-medium hover:bg-gray-50"
          >
            取消
          </button>
          <button
            onClick={onExchange}
            disabled={exchanging}
            className="flex-1 py-2.5 bg-sky-500 hover:bg-sky-600 text-white rounded-lg font-medium disabled:opacity-50"
          >
            {exchanging ? '兑换中...' : '确认兑换'}
          </button>
        </div>
      </div>
    </div>
  );
};
