// PK 对战 socket.io 连接与事件封装
import { useRef, useState, useEffect, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { API_CONFIG } from '../../../../api/config';

interface PKProfile {
  tier: number;
  stars: number;
  pk_points: number;
  battles_today: number;
  total_wins: number;
  total_losses: number;
  total_draws: number;
  class_enabled: boolean;
}

interface Question {
  id: string;
  question_text: string;
  question_type: string;
  answers: any;
  difficulty?: number;
}

export function usePKSocket() {
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);

  // 命令函数
  const commands = useRef({
    matchQuick: (configId?: string) =>
      socketRef.current?.emit('pk:match_quick', { config_id: configId }),
    matchCancel: () => socketRef.current?.emit('pk:match_cancel', {}),
    createRoom: (configId?: string) =>
      socketRef.current?.emit('pk:room_create', { config_id: configId }),
    joinRoom: (code: string) =>
      socketRef.current?.emit('pk:room_join', { room_code: code }),
    leaveRoom: () => socketRef.current?.emit('pk:room_leave', {}),
    toggleReady: (ready: boolean) =>
      socketRef.current?.emit('pk:room_ready', { ready }),
    kickUser: (userId: string) =>
      socketRef.current?.emit('pk:room_kick', { user_id: userId }),
    startBattle: () => socketRef.current?.emit('pk:room_start', {}),
    submitAnswer: (qid: string, answer: string, costMs: number) =>
      socketRef.current?.emit('pk:answer_submit', {
        question_id: qid,
        answer,
        cost_ms: costMs,
      }),
    surrender: () => socketRef.current?.emit('pk:surrender', {}),
    reconnect: (roomId: string) =>
      socketRef.current?.emit('pk:reconnect', { room_id: roomId }),
  }).current;

  // 订阅事件
  const on = useCallback((event: string, handler: (...args: any[]) => void) => {
    if (!socketRef.current) return () => {};
    socketRef.current.on(event, handler);
    return () => {
      socketRef.current?.off(event, handler);
    };
  }, []);

  // 自动连接（PKBattle mount 时调用）
  const connect = useCallback((token: string) => {
    if (socketRef.current?.connected) return;
    const url = API_CONFIG.apiUrl.replace(/\/api$/, '');
    socketRef.current = io(url, {
      path: '/pk-socket/',
      auth: { token },
      transports: ['websocket', 'polling'],
    });

    socketRef.current.on('connect', () => setConnected(true));
    socketRef.current.on('disconnect', () => setConnected(false));
    socketRef.current.on('connect_error', (err) => {
      console.error('[PK] socket 连接失败:', err);
      setConnected(false);
    });
  }, []);

  // 断开
  const disconnect = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
      setConnected(false);
    }
  }, []);

  return { connected, commands, on, connect, disconnect, socket: socketRef };
}
