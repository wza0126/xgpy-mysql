// PK 房间等待页：玩家列表 + 准备 + 开始
import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { getRankInfo, renderStars, getRankColorClass } from './utils/pkHelpers';

interface RoomPlayer {
  user_id: string;
  username: string;
  real_name: string;
  is_host: boolean;
  is_ready: boolean;
  tier: number;
  stars: number;
}

interface RoomConfig {
  name: string;
  duration_seconds: number;
  question_count: number;
  tag_filters: string[] | string | null;
  cluster_filters: string[] | string | null;
  difficulty_min: number | null;
  difficulty_max: number | null;
}

interface RoomState {
  id: string;
  room_code: string | null;
  host_user_id: string;
  status: string;
  config?: RoomConfig;
  players: RoomPlayer[];
}

/** 兼容解析筛选字段：mysql2 JSON 列可能返回数组或字符串 */
function parseFilters(v: string[] | string | null | undefined): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') {
    try {
      const p = JSON.parse(v);
      return Array.isArray(p) ? p : [];
    } catch {
      return [];
    }
  }
  return [];
}

export const PKRoom: React.FC<{
  roomState: RoomState | null;
  myUserId: string;
  onToggleReady: (ready: boolean) => void;
  onStart: () => void;
  onLeave: () => void;
  onKick: (userId: string) => void;
}> = ({ roomState, myUserId, onToggleReady, onStart, onLeave, onKick }) => {
  const me = roomState?.players.find((p) => p.user_id === myUserId);
  const opponent = roomState?.players.find((p) => p.user_id !== myUserId);
  const isHost = me?.is_host;
  const allReady = roomState?.players.length === 2 && roomState.players.every((p) => p.is_ready);

  if (!roomState) {
    return (
      <div className="flex items-center justify-center h-full">
        <i className="fa-solid fa-circle-notch fa-spin text-3xl text-purple-500"></i>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      {/* 顶部：返回 + 房间码 */}
      <div className="flex items-center justify-between mb-6">
        <button onClick={onLeave} className="text-gray-500 hover:text-gray-700">
          <i className="fa-solid fa-arrow-left mr-2"></i>返回列表
        </button>
        {roomState.room_code && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500">房间码：</span>
            <span className="text-3xl font-bold tracking-widest text-purple-600">
              {roomState.room_code}
            </span>
            <button
              onClick={() => {
                navigator.clipboard?.writeText(roomState.room_code!);
              }}
              className="ml-2 px-2 py-1 bg-purple-100 text-purple-600 rounded text-sm hover:bg-purple-200"
            >
              📋复制
            </button>
          </div>
        )}
      </div>

      {/* 对战配置信息 */}
      {roomState.config && (
        <div className="bg-purple-50 rounded-xl border border-purple-200 p-4 mb-4">
          <div className="flex items-center gap-2 mb-3">
            <i className="fa-solid fa-trophy text-purple-600"></i>
            <h3 className="font-bold text-purple-800">{roomState.config.name}</h3>
          </div>
          <div className="flex flex-wrap gap-2 text-sm text-gray-600">
            <span className="px-2 py-1 bg-white rounded">
              <i className="fa-regular fa-clock mr-1"></i>{Math.floor(roomState.config.duration_seconds / 60)}分钟
            </span>
            <span className="px-2 py-1 bg-white rounded">
              <i className="fa-solid fa-list-ol mr-1"></i>{roomState.config.question_count}题
            </span>
            {roomState.config.difficulty_min != null && roomState.config.difficulty_max != null && (
              <span className="px-2 py-1 bg-white rounded">
                <i className="fa-solid fa-signal mr-1"></i>难度 {roomState.config.difficulty_min}-{roomState.config.difficulty_max}
              </span>
            )}
            {parseFilters(roomState.config.tag_filters).length > 0 && (
              <span className="px-2 py-1 bg-white rounded">
                <i className="fa-solid fa-tags mr-1"></i>{parseFilters(roomState.config.tag_filters).length}个标签
              </span>
            )}
            {parseFilters(roomState.config.cluster_filters).length > 0 && (
              <span className="px-2 py-1 bg-white rounded">
                <i className="fa-solid fa-layer-group mr-1"></i>{parseFilters(roomState.config.cluster_filters).length}个聚类
              </span>
            )}
          </div>
        </div>
      )}

      {/* 玩家列表 */}
      <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-6 mb-6">
        <h3 className="font-bold text-gray-800 mb-4">玩家列表</h3>
        <div className="space-y-3">
          {/* 我 */}
          <PlayerCard player={me} isMe />
          {/* 对手 */}
          {opponent ? (
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <PlayerCard player={opponent} />
              </div>
              {isHost && (
                <button
                  onClick={() => onKick(opponent.user_id)}
                  className="px-3 py-2 bg-red-100 text-red-600 rounded-lg text-sm hover:bg-red-200 whitespace-nowrap"
                  title="踢出房间"
                >
                  <i className="fa-solid fa-user-slash mr-1"></i>踢出
                </button>
              )}
            </div>
          ) : (
            <div className="border-2 border-dashed border-gray-200 rounded-lg p-4 text-center text-gray-400">
              等待对手加入...
            </div>
          )}
        </div>
      </div>

      {/* 操作按钮 */}
      <div className="flex gap-4">
        {me && (
          <button
            onClick={() => onToggleReady(!me.is_ready)}
            className={`flex-1 py-4 rounded-xl font-bold text-lg ${
              me.is_ready
                ? 'bg-green-500 text-white'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
          >
            {me.is_ready ? '✓ 已准备' : '点击准备'}
          </button>
        )}
        {isHost && (
          <button
            onClick={onStart}
            disabled={!allReady}
            className={`flex-1 py-4 rounded-xl font-bold text-lg ${
              allReady
                ? 'bg-gradient-to-r from-purple-500 to-pink-500 text-white shadow-lg'
                : 'bg-gray-200 text-gray-400 cursor-not-allowed'
            }`}
          >
            开始对战
          </button>
        )}
      </div>
      {isHost && !allReady && (
        <p className="text-center text-sm text-gray-400 mt-2">
          需全员准备后才能开始
        </p>
      )}
    </div>
  );
};

// 玩家卡片子组件
const PlayerCard: React.FC<{ player?: RoomPlayer; isMe?: boolean }> = ({
  player,
  isMe,
}) => {
  if (!player) return null;
  const info = getRankInfo(player.tier, player.stars);
  return (
    <div
      className={`border-2 rounded-lg p-4 flex items-center gap-3 ${
        player.is_ready ? 'border-green-300 bg-green-50' : 'border-gray-200 bg-gray-50'
      }`}
    >
      <span className="text-2xl">{player.is_host ? '👑' : '👤'}</span>
      <div className="flex-1">
        <p className="font-bold">
          {player.real_name}
          {isMe && <span className="text-xs text-gray-500 ml-2">（我）</span>}
        </p>
        <p className="text-sm text-gray-500">
          {info.icon} {info.name} {renderStars(player.tier, player.stars)}
        </p>
      </div>
      <span
        className={`px-3 py-1 rounded-full text-sm ${
          player.is_ready
            ? 'bg-green-500 text-white'
            : 'bg-gray-200 text-gray-500'
        }`}
      >
        {player.is_ready ? '✓ 准备' : '未准备'}
      </span>
    </div>
  );
};
