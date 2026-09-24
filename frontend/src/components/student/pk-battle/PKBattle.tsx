// PK 对战入口：管理 4 个子页面切换 + socket 事件路由
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useAuth } from '../../../hooks/useAuth';
import { usePKSocket } from './hooks/usePKSocket';
import { PKLobby } from './PKLobby';
import { PKRoom } from './PKRoom';
import { PKBattleArena } from './PKBattleArena';
import { PKResult } from './PKResult';
import type { PKResultDrop, PKResultHonor, PKResultBonus } from './PKResult';
import { useGameEventStore } from '../../../store/gameEventStore';
import { getAuthToken } from '../../../utils/authToken';

type View = 'lobby' | 'room' | 'arena' | 'result';

interface Question {
  id: string;
  question_text: string;
  question_type: string;
  answers: any;
  difficulty?: number;
}

interface LeaderEntry {
  userId: string;
  score: number;
  correct: number;
  wrong: number;
}

interface BattlePlayer {
  user_id: string;
  username: string;
  real_name: string;
  tier: number;
  stars: number;
  score?: number;
  correct?: number;
  wrong?: number;
}

interface ResumeData {
  room_id: string;
  questions: Question[];
  players: BattlePlayer[];
  ends_at: string;
  answered: string[];
}

const STORAGE_KEY = 'pk_room_id';

interface RoomState {
  id: string;
  room_code: string | null;
  host_user_id: string;
  status: string;
  players: any[];
}

export const PKBattle: React.FC = () => {
  const { profile } = useAuth();
  const { connected, commands, on, connect, disconnect } = usePKSocket();

  const [view, setView] = useState<View>('lobby');
  const [matchSearching, setMatchSearching] = useState(false);
  const [disconnected, setDisconnected] = useState(false);

  // 房间状态
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [roomId, setRoomId] = useState<string | null>(null);

  // 断线恢复数据（刷新页面后从 localStorage 恢复）
  const [resumeData, setResumeData] = useState<ResumeData | null>(null);
  const [hasStoredRoom, setHasStoredRoom] = useState(false);
  const prevConnectedRef = useRef(false);

  // localStorage 持久化 roomId（刷新/重开后能恢复对局）
  const persistRoom = useCallback((rid: string | null) => {
    if (rid) {
      localStorage.setItem(STORAGE_KEY, rid);
      setHasStoredRoom(true);
    } else {
      localStorage.removeItem(STORAGE_KEY);
      setHasStoredRoom(false);
    }
  }, []);

  // 对战状态
  const [questions, setQuestions] = useState<Question[]>([]);
  const [duration, setDuration] = useState(180);
  const [endsAt, setEndsAt] = useState<string>('');
  const [remaining, setRemaining] = useState(0);
  const [leaderboard, setLeaderboard] = useState<LeaderEntry[]>([]);
  const [players, setPlayers] = useState<BattlePlayer[]>([]);
  const [answerFeedback, setAnswerFeedback] = useState<{ qid: string; correct: boolean } | null>(null);
  const [resultRoomId, setResultRoomId] = useState<string | null>(null);
  // 本局掉落与荣誉（来自 pk:battle_end 载荷，迁移 087）
  const [resultDrops, setResultDrops] = useState<PKResultDrop[]>([]);
  const [resultHonors, setResultHonors] = useState<PKResultHonor[]>([]);
  // 参与类奖励明细（首战 / 单日满场）与满场所需场次（文案用）
  const [resultBonuses, setResultBonuses] = useState<PKResultBonus | null>(null);
  const [resultDailyTarget, setResultDailyTarget] = useState(0);

  // 连接 socket
  useEffect(() => {
    const token = getAuthToken();
    if (token) connect(token);
    // 挂载时检查是否有进行中的对局/房间
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) setHasStoredRoom(true);
    return () => disconnect();
  }, []);

  // 断线检测：房间/对战中掉线时显示重连遮罩
  useEffect(() => {
    const inSession = view === 'arena' || view === 'room';
    setDisconnected(!connected && inSession);
  }, [connected, view]);

  // 自动恢复：仅当 socket 刚连接成功（进入页面/断线重连）且有本地房间记录时恢复对局
  // 注意：不能每次 hasStoredRoom 变化都重连——匹配成功也会写房间记录，
  // 此时房间已开战，重连会触发服务端返回"对局已结束"
  useEffect(() => {
    const justConnected = connected && !prevConnectedRef.current;
    prevConnectedRef.current = connected;
    if (!connected || !hasStoredRoom || view === 'result') return;
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return;
    if (justConnected) {
      commands.reconnect(stored);
    }
  }, [connected, hasStoredRoom, view]);

  // 注册 socket 事件
  useEffect(() => {
    if (!connected) return;

    // 匹配中
    const offSearching = on('pk:match_searching', () => {
      setMatchSearching(true);
    });

    // 匹配成功
    const offFound = on('pk:match_found', (data: any) => {
      setMatchSearching(false);
      setRoomId(data.room_id);
      persistRoom(data.room_id);
      // 等待 battle_start
    });

    // 匹配超时
    const offTimeout = on('pk:match_timeout', (data: any) => {
      setMatchSearching(false);
      alert(data?.message || '暂未匹配到同活动的对手，可更换活动后重试');
    });

    // 房间创建成功
    const offCreated = on('pk:room_created', (data: any) => {
      setMatchSearching(false);
      setRoomId(data.room_id);
      persistRoom(data.room_id);
      // 等待 battle_start
      setView('room');
    });

    // 加入房间成功（对手通过房间码加入）
    const offJoined = on('pk:room_joined', (data: any) => {
      setMatchSearching(false);
      setRoomId(data.room_id);
      persistRoom(data.room_id);
      setView('room');
    });

    // 房间状态更新
    const offUpdated = on('pk:room_updated', (data: any) => {
      setRoomState(data.state);
      // 断线重连恢复房间页：若在大厅且本地有房间记录，切到房间视图
      if (view === 'lobby' && hasStoredRoom && data.state?.id) {
        setRoomId(data.state.id);
        setView('room');
      }
    });

    // 断线重连恢复对战页
    const offResume = on('pk:battle_resume', (data: any) => {
      setRoomId(data.room_id);
      setQuestions(data.questions || []);
      setPlayers(data.players || []);
      setEndsAt(data.ends_at || '');
      setResumeData(data);
      persistRoom(data.room_id);
      setView('arena');
    });

    // 被房主踢出
    const offKicked = on('pk:room_kicked', (data: any) => {
      if (data.user_id === profile?.id) {
        setRoomId(null);
        setRoomState(null);
        persistRoom(null);
        setView('lobby');
        alert('你已被房主请出房间');
      }
    });

    // 对战开始
    const offStart = on('pk:battle_start', (data: any) => {
      setQuestions(data.questions);
      setDuration(data.duration);
      setEndsAt(data.ends_at);
      if (Array.isArray(data.players)) setPlayers(data.players);
      setResumeData(null);
      setAnswerFeedback(null); // 清掉上一局遗留的判分反馈，避免新局开局误弹提示
      // 清掉上一局的掉落/荣誉/奖励，否则新局尚未结束时若跳进结算页会显示旧数据
      setResultDrops([]);
      setResultHonors([]);
      setResultBonuses(null);
      setResultDailyTarget(0);
      setView('arena');
    });

    // 单题提交结果
    const offAnswerResult = on('pk:answer_result', (data: any) => {
      setAnswerFeedback({ qid: data.question_id, correct: !!data.correct });
    });

    // 每秒 tick
    const offTick = on('pk:tick', (data: any) => {
      setRemaining(data.remaining);
      setLeaderboard(data.leaderboard);
    });

    // 对战结束
    // 载荷里带了本局掉落与荣誉（迁移 087，按 user_id 分组）：
    // 结算页要等 GET /api/pk/history 返回才渲染，截图式反馈会滞后，
    // 所以先把属于「我」的那份存下来，结算页顶部直接展示。
    const offEnd = on('pk:battle_end', (data: any) => {
      const myId = profile?.id;
      const allDrops = data?.dropped_equipments || {};
      const allHonors = data?.new_honors || {};
      const allBonuses = data?.bonuses || {};
      setResultDrops(myId ? (allDrops[myId] || []) : []);
      setResultHonors(myId ? (allHonors[myId] || []) : []);
      // 参与类奖励（首战/单日满场）：后端只回传「本次真正发出」的，0 表示今日已发过
      const myBonus = myId ? (allBonuses[myId] || null) : null;
      setResultBonuses(myBonus && ((myBonus.first_battle || 0) + (myBonus.daily_battles || 0)) > 0
        ? myBonus
        : null);
      setResultDailyTarget(Number(data?.daily_battles_target) || 0);

      // 荣誉/装备同时触发时给一个即时反馈（落在结算页渲染之前）
      const honors = myId ? (allHonors[myId] || []) : [];
      if (honors.length > 0) {
        const first = honors[0];
        useGameEventStore.getState().emitEvent(
          first.type as any,
          { equipments: myId ? (allDrops[myId] || []) : [] }
        );
      } else {
        const drops = myId ? (allDrops[myId] || []) : [];
        if (drops.length > 0) {
          useGameEventStore.getState().emitEvent('equipment_drop', { equipments: drops });
        }
      }

      setResultRoomId(data.room_id);
      persistRoom(null);
      setView('result');
    });

    // 对手断线
    const offOppDisc = on('pk:opponent_disconnected', (data: any) => {
      alert(`对手掉线，${data.grace_seconds}秒内重连，否则你赢`);
    });

    // 对手重连
    const offOppReconn = on('pk:opponent_reconnected', () => {
      // 可选 toast
    });

    // 错误
    const offError = on('pk:room_error', (data: any) => {
      setMatchSearching(false);
      if (data.code === 'battle_gone') {
        // 对局已结束/不存在：清本地记录回大厅
        persistRoom(null);
        setRoomId(null);
        setRoomState(null);
        setView('lobby');
      }
      alert(data.message);
    });

    return () => {
      offSearching();
      offFound();
      offTimeout();
      offCreated();
      offJoined();
      offUpdated();
      offResume();
      offKicked();
      offStart();
      offAnswerResult();
      offTick();
      offEnd();
      offOppDisc();
      offOppReconn();
      offError();
    };
  }, [connected, on, view, hasStoredRoom, persistRoom]);

  // 本地倒计时（以 ends_at 为准）
  useEffect(() => {
    if (!endsAt || view !== 'arena') return;
    const update = () => {
      const ms = new Date(endsAt).getTime() - Date.now();
      setRemaining(Math.max(0, Math.floor(ms / 1000)));
    };
    update();
    const t = setInterval(update, 1000);
    return () => clearInterval(t);
  }, [endsAt, view]);

  // 处理函数
  const handleMatchQuick = (configId?: string) => {
    setMatchSearching(true);
    commands.matchQuick(configId);
  };

  const handleCreateRoom = (configId?: string) => {
    commands.createRoom(configId);
  };

  const handleJoinRoom = (code: string) => {
    commands.joinRoom(code);
  };

  const handleLeaveRoom = () => {
    commands.leaveRoom();
    persistRoom(null);
    setView('lobby');
    setRoomState(null);
  };

  const handleKick = (userId: string) => {
    commands.kickUser(userId);
  };

  const handleToggleReady = (ready: boolean) => {
    commands.toggleReady(ready);
  };

  const handleStartBattle = () => {
    commands.startBattle();
  };

  const handleSubmitAnswer = (qid: string, answer: string, costMs: number) => {
    commands.submitAnswer(qid, answer, costMs);
  };

  const handleSurrender = () => {
    if (confirm('确定投降？')) {
      commands.surrender();
    }
  };

  const handleBackToLobby = () => {
    setView('lobby');
    setRoomId(null);
    setResultRoomId(null);
    setQuestions([]);
    setLeaderboard([]);
  };

  const handleManualReconnect = () => {
    const token = getAuthToken();
    if (token) connect(token);
  };

  // 大厅"恢复对局"入口：手动发起重连
  const handleResumeBattle = () => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) commands.reconnect(stored);
  };

  return (
    <div className="h-full relative">
      {/* 断线重连遮罩 */}
      <AnimatePresence>
        {disconnected && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 bg-black/60 flex flex-col items-center justify-center gap-4"
          >
            <p className="text-white text-xl font-bold">连接已断开</p>
            <p className="text-white/80 text-sm">正在尝试自动重连...</p>
            <button
              onClick={handleManualReconnect}
              className="px-6 py-2 bg-purple-500 hover:bg-purple-600 text-white rounded-lg font-bold"
            >
              重新连接
            </button>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence mode="wait">
        {view === 'lobby' && (
          <motion.div
            key="lobby"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="h-full"
          >
            <PKLobby
              onMatchQuick={handleMatchQuick}
              onCreateRoom={handleCreateRoom}
              onJoinRoom={handleJoinRoom}
              matchSearching={matchSearching}
              hasStoredRoom={hasStoredRoom}
              onResumeBattle={handleResumeBattle}
              onCancelMatch={() => {
                commands.matchCancel();
                setMatchSearching(false);
              }}
            />
          </motion.div>
        )}

        {view === 'room' && (
          <motion.div
            key="room"
            initial={{ opacity: 0, x: 50 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -50 }}
            className="h-full"
          >
            <PKRoom
              roomState={roomState}
              myUserId={profile?.id || ''}
              onToggleReady={handleToggleReady}
              onStart={handleStartBattle}
              onLeave={handleLeaveRoom}
              onKick={handleKick}
            />
          </motion.div>
        )}

        {view === 'arena' && (
          <motion.div
            key="arena"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            className="h-full"
          >
            <PKBattleArena
              questions={questions}
              duration={duration}
              endsAt={endsAt}
              leaderboard={leaderboard}
              remaining={remaining}
              myUserId={profile?.id || ''}
              players={players}
              answerFeedback={answerFeedback}
              answeredIds={resumeData?.answered}
              onSubmitAnswer={handleSubmitAnswer}
              onSurrender={handleSurrender}
            />
          </motion.div>
        )}

        {view === 'result' && resultRoomId && (
          <motion.div
            key="result"
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="h-full"
          >
            <PKResult
              roomId={resultRoomId}
              onBackToLobby={handleBackToLobby}
              droppedEquipments={resultDrops}
              newHonors={resultHonors}
              bonuses={resultBonuses}
              dailyTarget={resultDailyTarget}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
