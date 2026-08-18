import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../../../hooks/useAuth';
import { backendClient } from '../../../api/backendClient';
import { DuelGame } from './DuelGame';

interface RoomView {
  id: string;
  table_no: number;
  status: string;
  seed: string;
  player1_id: string | null;
  player2_id: string | null;
  p1_name: string | null;
  p2_name: string | null;
  p1_username: string | null;
  p2_username: string | null;
  p1_ready: boolean;
  p2_ready: boolean;
  p1_score: number;
  p2_score: number;
  has_password?: boolean;
}

export const DuelLobby: React.FC<{ onEnterGame?: () => void }> = () => {
  const { user } = useAuth();
  const [rooms, setRooms] = useState<RoomView[]>([]);
  const [myRoom, setMyRoom] = useState<{ roomId: string; side: 'L' | 'R' } | null>(null);
  const [myReady, setMyReady] = useState(false);
  const [opponentReady, setOpponentReady] = useState(false);
  const [totals, setTotals] = useState<{ win: number; lose: number; draw: number }>({ win: 0, lose: 0, draw: 0 });
  const [game, setGame] = useState<{ roomId: string; seed: string; side: 'L' | 'R'; opponentName: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [entryFee, setEntryFee] = useState(0); // 双人对局门票（每局每人积分）
  const [pwdModal, setPwdModal] = useState<{ room: RoomView; side: 'L' | 'R'; mode: 'set' | 'enter' } | null>(null);
  const [pwdInput, setPwdInput] = useState('');
  const [pwdSubmitting, setPwdSubmitting] = useState(false);
  const startedRef = useRef(false);

  const fetchRooms = useCallback(async () => {
    try {
      const res = await backendClient.get('/api/typing/rooms');
      const data = (res?.data || []) as RoomView[];
      setRooms(data);
      // 定位我所在的桌
      const mine = data.find(r => r.player1_id === user?.id || r.player2_id === user?.id);
      if (mine) {
        setMyRoom({ roomId: mine.id, side: mine.player1_id === user?.id ? 'L' : 'R' });
        // 保护乐观更新：如果本地已经点了同意（myReady=true），就不要被后端 false 覆盖
        setMyReady(prevReady => {
          if (prevReady) return true; // 乐观锁定，保持 true 直到离座或开赛
          return mine.player1_id === user?.id ? mine.p1_ready : mine.p2_ready;
        });
        setOpponentReady(mine.player1_id === user?.id ? mine.p2_ready : mine.p1_ready);
        // 双方就绪后后端已自动开赛（status=playing），轮询到即可同时进入 3 秒倒计时
        if (mine.status === 'playing' && mine.seed && !startedRef.current) {
          startedRef.current = true;
          const mySide = mine.player1_id === user?.id ? 'L' : 'R';
          const oppName = (mySide === 'L' ? mine.p2_name : mine.p1_name) || '对手';
          setGame({ roomId: mine.id, seed: mine.seed, side: mySide, opponentName: oppName });
        }
        if (mine.status !== 'playing') startedRef.current = false;
      } else {
        setMyRoom(null);
        setMyReady(false);
        setOpponentReady(false);
      }
    } catch {
      // 忽略轮询错误
    }
  }, [user?.id]);

  const fetchRecords = useCallback(async () => {
    try {
      const res = await backendClient.get('/api/typing/duels');
      const d = res?.data;
      if (d?.totals) setTotals(d.totals);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (!user) return;
    fetchRecords();
    const t = setInterval(fetchRooms, 1000);
    return () => clearInterval(t);
  }, [user, fetchRooms, fetchRecords]);

  // 读取双人对局门票配置
  useEffect(() => {
    backendClient.get('/api/typing/config')
      .then(res => { setEntryFee(parseInt(res?.data?.duel_entry_fee) || 0); })
      .catch(() => {});
  }, []);

  const doSit = async (room: RoomView, side: 'L' | 'R', password: string) => {
    setPwdSubmitting(true);
    try {
      const res = await backendClient.post(`/api/typing/rooms/${room.id}/sit`, { side, password });
      if (res?.error) { setError(res.error); return; }
      setPwdModal(null);
      setPwdInput('');
      fetchRooms();
    } catch (e: any) {
      // backendClient 对非 2xx 会抛出后端返回的错误信息（如入座门槛/密码错误提示）
      setError(e?.message || '坐下失败，请重试');
      setPwdModal(null);
    } finally {
      setPwdSubmitting(false);
    }
  };

  const sit = async (room: RoomView, side: 'L' | 'R') => {
    setError(null);
    // 点击自己的座位 => 离座
    if (myRoom && myRoom.roomId === room.id && myRoom.side === side) {
      await leave();
      return;
    }
    if (myRoom) { setError('你已在 ' + myRoom.roomId + ' 桌，请先离开'); return; }
    if (room.status === 'playing') { setError('该桌正在比赛中'); return; }
    const occupied = side === 'L' ? room.player1_id : room.player2_id;
    if (occupied) { setError('该座位已被占用'); return; }
    const isFirstSeat = !room.player1_id && !room.player2_id;
    if (isFirstSeat) {
      // 首位入座：弹窗设置 4 位数字密码（不填则无密码）
      setPwdInput('');
      setPwdModal({ room, side, mode: 'set' });
      return;
    }
    if (room.has_password) {
      // 次位且桌已有密码：弹窗输入正确密码才能入座
      setPwdInput('');
      setPwdModal({ room, side, mode: 'enter' });
      return;
    }
    await doSit(room, side, '');
  };

  const leave = async () => {
    if (!myRoom) return;
    try {
      await backendClient.post(`/api/typing/rooms/${myRoom.roomId}/leave`, {});
      setMyRoom(null);
      setMyReady(false);
      setOpponentReady(false);
      fetchRooms();
    } catch { /* ignore */ }
  };

  const ready = async () => {
    if (!myRoom) return;
    const sid = user?.id;
    if (!sid) return;
    // 立即本地更新，避免等待轮询
    setRooms(prev => prev.map(r => {
      if (r.id !== myRoom.roomId) return r;
      if (myRoom.side === 'L' && r.player1_id === sid) {
        return { ...r, p1_ready: true };
      }
      if (myRoom.side === 'R' && r.player2_id === sid) {
        return { ...r, p2_ready: true };
      }
      return r;
    }));
    if (myRoom.side === 'L') setMyReady(true);
    else setMyReady(true);
    try {
      const res = await backendClient.post(`/api/typing/rooms/${myRoom.roomId}/ready`, {});
      const d = res?.data;
      // 双方都同意：后端已自动开赛，直接用返回的 seed 进入游戏（无需等下一次轮询）
      if (d?.both_ready && d?.seed && !startedRef.current) {
        startedRef.current = true;
        const mine = rooms.find(r => r.id === myRoom.roomId);
        const oppName = (mine && (myRoom.side === 'L' ? mine.p2_name : mine.p1_name)) || '对手';
        setGame({ roomId: myRoom.roomId, seed: d.seed, side: myRoom.side, opponentName: oppName });
      } else {
        fetchRooms();
      }
    } catch { /* ignore */ }
  };

  const wins = totals.win;
  const losses = totals.lose;
  const draws = totals.draw;

  if (game) {
    return <DuelGame {...game} onExit={() => { setGame(null); startedRef.current = false; fetchRooms(); }} />;
  }

  return (
    <div className="h-full flex flex-col px-5 py-4">
      <div className="shrink-0 flex items-center justify-between mb-3">
        <h2 className="text-lg font-bold text-amber-300"><i className="fa-solid fa-people-arrows mr-2"></i>星际酒馆 · 双人对决</h2>
        <div className="text-xs text-indigo-300">
          我的战绩：<b className="text-emerald-300">{wins}胜</b> <b className="text-red-300">{losses}负</b> <b className="text-indigo-300">{draws}平</b>
        </div>
      </div>

      {error && (
        <div className="shrink-0 mb-3 px-3 py-2 rounded-lg bg-red-900/40 border border-red-500/40 text-red-200 text-xs">{error}</div>
      )}

      {myRoom && (
        <div className="shrink-0 mb-4 rounded-xl border border-amber-400/40 bg-amber-900/20 px-4 py-3 flex items-center gap-3">
          <span className="text-sm text-amber-200">
            你在第{rooms.find(r => r.id === myRoom.roomId)?.table_no ?? myRoom.roomId.replace('typing_room_', '')}桌
            <span className="text-indigo-300 ml-3">每局对战扣除{entryFee}积分</span>
          </span>
          {opponentReady && myReady ? (
            <span className="text-sm text-emerald-300 font-bold ml-auto">双方就绪，3秒后开始对战…</span>
          ) : (
            <span className="text-xs text-indigo-300 ml-auto">
              {myReady ? '✔ 你已同意，等待对方同意…' : '点击座位下方的「我同意」按钮开始'}
              {opponentReady && !myReady ? '（对方已同意）' : ''}
            </span>
          )}
          <button onClick={leave} className="px-3 py-1.5 rounded-lg text-xs bg-white/10 hover:bg-white/20 text-gray-300 transition-colors">
            离桌
          </button>
        </div>
      )}

      {/* 桌子网格 */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {rooms.map(room => {
            // 计算包含乐观更新的有效 ready 状态
            const p1EffectiveReady = (myRoom?.roomId === room.id && myRoom?.side === 'L') ? myReady : room.p1_ready;
            const p2EffectiveReady = (myRoom?.roomId === room.id && myRoom?.side === 'R') ? myReady : room.p2_ready;
            return (
            <div key={room.id} className={`rounded-xl border p-3 text-center transition-colors ${room.status === 'playing' ? 'border-emerald-500/50 bg-emerald-900/10' : room.status === 'ready' ? 'border-amber-400/50 bg-amber-900/10' : 'border-indigo-400/25 bg-indigo-950/30'}`}>
              <div className="text-xs text-indigo-300 mb-2">对战桌 <b className="text-amber-300">#{room.table_no}</b>{!!room.has_password && <span className="ml-1" title="该桌设有密码">🔒</span>}</div>
              <div className="flex items-start justify-center gap-4 mb-2">
                <div className="flex flex-col items-center gap-1">
                  <SeatSlot
                    label="左座"
                    name={room.player1_id === user?.id ? '我' : (room.p1_name || room.p1_username)}
                    occupied={!!room.player1_id}
                    ready={p1EffectiveReady}
                    isMe={room.player1_id === user?.id}
                    onClick={() => sit(room, 'L')}
                  />
                  {/* 左座同意按钮（仅当是自己的座位且已入座时显示） */}
                  {room.player1_id === user?.id && !!room.player1_id && (
                    p1EffectiveReady ? (
                      <div className="w-24 text-[10px] py-1 rounded-md text-center border border-emerald-400/50 bg-gradient-to-r from-emerald-600/60 to-teal-600/60 text-emerald-100 font-bold shadow-md shadow-emerald-500/20">
                        ✔ 已同意
                      </div>
                    ) : (
                      <button
                        onClick={(e) => { e.stopPropagation(); ready(); }}
                        className="w-24 text-[10px] py-1 rounded-md transition-all bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 hover:shadow-lg hover:shadow-indigo-500/40 text-white font-bold active:scale-95"
                      >
                        我同意
                      </button>
                    )
                  )}
                </div>
                <div className="text-2xl mt-3" style={{ filter: 'drop-shadow(0 0 6px rgba(200,170,255,.5))' }}>🪑</div>
                <div className="flex flex-col items-center gap-1">
                  <SeatSlot
                    label="右座"
                    name={room.player2_id === user?.id ? '我' : (room.p2_name || room.p2_username)}
                    occupied={!!room.player2_id}
                    ready={p2EffectiveReady}
                    isMe={room.player2_id === user?.id}
                    onClick={() => sit(room, 'R')}
                  />
                  {/* 右座同意按钮（仅当是自己的座位且已入座时显示） */}
                  {room.player2_id === user?.id && !!room.player2_id && (
                    p2EffectiveReady ? (
                      <div className="w-24 text-[10px] py-1 rounded-md text-center border border-emerald-400/50 bg-gradient-to-r from-emerald-600/60 to-teal-600/60 text-emerald-100 font-bold shadow-md shadow-emerald-500/20">
                        ✔ 已同意
                      </div>
                    ) : (
                      <button
                        onClick={(e) => { e.stopPropagation(); ready(); }}
                        className="w-24 text-[10px] py-1 rounded-md transition-all bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 hover:shadow-lg hover:shadow-indigo-500/40 text-white font-bold active:scale-95"
                      >
                        我同意
                      </button>
                    )
                  )}
                </div>
              </div>
              <div className="text-[10px] text-indigo-400">
                {room.status === 'playing' ? '🔥 比赛中' : room.status === 'ready' ? '双方就绪，即将开始' : room.status === 'waiting' ? '等待对手…' : '空闲'}
              </div>
            </div>
            );
          })}
        </div>
        <p className="mt-4 text-[10px] text-indigo-400 text-center">点击空座位坐下；点击自己的座位可离座；双人就座后双方点「我同意」即可开始 · 500ms 实时刷新</p>
      </div>

      {/* 入座密码弹窗 */}
      {pwdModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[9999]">
          <div className="bg-gray-900 rounded-xl border border-indigo-500/40 p-6 w-80 shadow-2xl">
            <h3 className="text-lg font-bold text-amber-300 mb-3">
              {pwdModal.mode === 'set' ? '🔒 设置桌子密码' : '🔑 输入桌子密码'}
            </h3>
            <p className="text-sm text-gray-400 mb-4">
              {pwdModal.mode === 'set'
                ? '可选设置 4 位数字密码，不填则无密码'
                : '该桌已设置密码，输入正确密码才能入座'}
            </p>
            <input
              type="text"
              inputMode="numeric"
              maxLength={4}
              placeholder="4 位数字"
              value={pwdInput}
              onChange={e => setPwdInput(e.target.value.replace(/\D/g, '').slice(0, 4))}
              className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-600 text-white text-center text-lg tracking-widest placeholder:text-gray-500 mb-4"
              autoFocus
            />
            <div className="flex gap-2">
              <button
                onClick={() => { setPwdModal(null); setPwdInput(''); }}
                className="flex-1 px-3 py-2 rounded-lg bg-gray-700 text-gray-300 text-sm hover:bg-gray-600"
                disabled={pwdSubmitting}
              >
                取消
              </button>
              <button
                onClick={() => doSit(pwdModal.room, pwdModal.side, pwdInput)}
                disabled={pwdSubmitting}
                className="flex-1 px-3 py-2 rounded-lg bg-gradient-to-r from-violet-600 to-indigo-600 text-white text-sm font-bold hover:from-violet-500 hover:to-indigo-500 disabled:opacity-50"
              >
                {pwdSubmitting ? '处理中…' : '确认入座'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const SeatSlot: React.FC<{
  label: string;
  name: string | null;
  occupied: boolean;
  ready: boolean;
  isMe: boolean;
  onClick: () => void;
}> = ({ label, name, occupied, ready, isMe, onClick }) => (
  <button
    onClick={onClick}
    title={isMe ? '点击离座' : (occupied ? '该座位已被占用' : '点击入座')}
    className={`w-24 rounded-xl border px-2 py-2 text-xs transition-all ${
      isMe
        ? 'border-blue-400 bg-blue-500/30 text-white hover:border-red-400 hover:bg-red-500/30 hover:text-red-100 cursor-pointer'
        : occupied
          ? 'border-orange-400/60 bg-orange-500/20 text-orange-200 cursor-default'
          : 'border-dashed border-indigo-400/50 text-indigo-300 hover:border-amber-400 hover:text-amber-200 cursor-pointer'
    } ${ready ? 'ring-2 ring-emerald-400' : ''}`}
  >
    <div className="text-[9px] opacity-80">{label}{occupied && !isMe ? ' · 已占' : ''}</div>
    <div className="font-bold truncate">
      {isMe ? '我 (点击离座)' : (occupied ? (name || '…') : '点击入座')}
    </div>
    {ready && <div className="text-emerald-300 text-[10px]">✔ 已同意</div>}
  </button>
);
