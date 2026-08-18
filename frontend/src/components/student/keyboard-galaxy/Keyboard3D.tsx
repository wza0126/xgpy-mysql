import React, { useState } from 'react';
import { KEY_ROWS, Finger, FINGER_CLASS, FINGER_COLOR, FINGER_LABEL } from './KeyboardData';

interface Keyboard3DProps {
  activeKey?: string | null;      // 当前应按键（如 'p'）
  collapsible?: boolean;          // 是否可折叠
  showHint?: boolean;             // 是否显示手指提示文字
}

const keyStyle = (finger: Finger, active: boolean): React.CSSProperties => ({
  width: 44,
  height: 44,
  marginRight: 6,
  borderRadius: 8,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontFamily: "'Consolas', monospace",
  fontSize: 18,
  fontWeight: 700,
  color: '#fff',
  textShadow: '0 1px 2px rgba(0,0,0,.5)',
  background: `linear-gradient(180deg, ${FINGER_COLOR[finger]}, ${shade(FINGER_COLOR[finger], -25)})`,
  border: '1px solid rgba(140,160,255,.35)',
  boxShadow: active
    ? '0 2px 0 0 #151b3a, 0 0 20px 6px rgba(255,224,90,.95), inset 0 1px 0 rgba(255,255,255,.45)'
    : `0 2px 0 0 ${shade(FINGER_COLOR[finger], -55)}, 0 4px 8px rgba(0,0,0,.4), inset 0 1px 0 rgba(255,255,255,.18)`,
  cursor: 'default',
  position: 'relative' as const,
  animation: active ? 'galaxyKeyFlash .7s ease-in-out infinite' : undefined,
  outline: 'none',
});

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = Math.max(0, Math.min(255, (n >> 16) + amt));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 0xff) + amt));
  const b = Math.max(0, Math.min(255, (n & 0xff) + amt));
  return `rgb(${r},${g},${b})`;
}

export const Keyboard3D: React.FC<Keyboard3DProps> = ({ activeKey, collapsible, showHint = true }) => {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="w-full select-none">
      {collapsible && (
        <div className="flex justify-end mb-1">
          <button
            onClick={() => setCollapsed(c => !c)}
            className="px-2 py-0.5 rounded text-[10px] bg-white/10 hover:bg-white/20 text-gray-300 transition-colors"
          >
            {collapsed ? '◢ 展开键位图' : '▽ 折叠键位图'}
          </button>
        </div>
      )}
      {!collapsed && (
        <div style={{ width: '100%' }}>
          <style>{`
            @keyframes galaxyKeyFlash {
              0%,100% { filter: brightness(1); }
              50% { filter: brightness(1.45); }
            }
          `}</style>
          <div
            style={{
              background: 'linear-gradient(180deg, #232a4d, #141a38)',
              border: '1px solid rgba(120,140,255,.3)',
              borderRadius: 14,
              padding: '12px 14px 16px',
              boxShadow: '0 10px 30px -12px rgba(0,0,0,.6)',
              maxWidth: 640,
              margin: '0 auto',
            }}
          >
            {KEY_ROWS.map((row, ri) => (
              <div key={ri} style={{ display: 'flex', justifyContent: 'center', marginBottom: 6 }}>
                {row.map((k, ki) => {
                  const isActive = !!activeKey && activeKey.toLowerCase() === k.label.toLowerCase();
                  const w = (k.width ?? 1) * 44 + ((k.width ?? 1) - 1) * 6;
                  return (
                    <div
                      key={ki}
                      style={{ ...keyStyle(k.finger, isActive), width: w, marginRight: ki === row.length - 1 ? 0 : 6 }}
                    >
                      {k.label}
                      {k.home && <span style={{ position: 'absolute', bottom: 3, width: 3, height: 3, borderRadius: '50%', background: 'rgba(255,255,255,.8)' }} />}
                      {isActive && (
                        <span
                          style={{
                            position: 'absolute', top: -16, left: '50%', transform: 'translateX(-50%)',
                            fontSize: 9, fontWeight: 600, color: '#ffe08a', whiteSpace: 'nowrap',
                            textShadow: '0 0 4px rgba(0,0,0,.9)',
                          }}
                        >
                          {FINGER_LABEL[k.finger]}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          {showHint && (
            <div className="mt-3 flex flex-wrap gap-2 justify-center text-[10px] text-indigo-300">
              {(Object.keys(FINGER_LABEL) as Finger[]).map(f => (
                <span key={f} className="inline-flex items-center gap-1">
                  <i style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: FINGER_COLOR[f] }} />
                  {FINGER_LABEL[f]}
                </span>
              ))}
              {activeKey && (
                <span className="inline-flex items-center gap-1 text-amber-300">
                  <i style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: '#ffd76a', border: '1px solid #fff' }} />
                  当前应按：{activeKey}（{FINGER_LABEL[fingerOf(activeKey)]}）
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

function fingerOf(ch: string): Finger {
  // 从 KeyboardData 映射：小写字母查表
  const map: Record<string, Finger> = {
    q: 'lp', a: 'lp', z: 'lp', w: 'lr', s: 'lr', x: 'lr', e: 'lm', d: 'lm', c: 'lm',
    r: 'li', t: 'li', f: 'li', g: 'li', v: 'li', b: 'li', y: 'ri', u: 'ri', h: 'ri',
    j: 'ri', n: 'ri', m: 'ri', i: 'rm', k: 'rm', o: 'rr', l: 'rr', p: 'rp', ' ': 'thumb',
    '1': 'lp', '2': 'lr', '3': 'lm', '4': 'li', '5': 'li', '6': 'ri', '7': 'ri', '8': 'rm',
    '9': 'rr', '0': 'rp',
  };
  return map[ch.toLowerCase()] || 'lp';
}
