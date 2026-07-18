import React from 'react';
import { Chapter } from '../../../types/python-magic';

interface MagicBookProps {
  chapter: Chapter;
}

export const MagicBook: React.FC<MagicBookProps> = ({ chapter }) => {
  const { magicBook } = chapter;

  return (
    <div className="relative mx-auto max-w-3xl">
      <div
        className="
          relative overflow-hidden rounded-r-2xl
          bg-gradient-to-br from-amber-50 to-orange-50
          border border-amber-200/60
          shadow-[8px_8px_24px_rgba(0,0,0,0.08),inset_0_1px_0_rgba(255,255,255,0.8)]
          pl-10 pr-10 py-10
        "
      >
        <div className="absolute left-0 top-0 bottom-0 w-8 bg-gradient-to-b from-amber-700 via-amber-600 to-amber-700 rounded-r-sm shadow-inner">
          <div className="absolute top-1/2 -translate-y-1/2 left-1/2 -translate-x-1/2 w-1 h-16 rounded-full bg-amber-800/30" />
          <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-0.5 h-8 rounded-full bg-amber-800/20" />
          <div className="absolute top-2/3 left-1/2 -translate-x-1/2 w-0.5 h-8 rounded-full bg-amber-800/20" />
        </div>

        <div className="absolute top-0 left-10 right-0 h-2 bg-gradient-to-r from-amber-200/40 to-transparent" />

        <div className="relative">
          <div className="mb-8">
            <div className="flex items-center gap-3 mb-2">
              <span className="text-2xl">📖</span>
              <span className="text-xs tracking-[0.2em] uppercase text-amber-500 font-semibold">
                知识手册
              </span>
            </div>
            <h2
              className="
                text-3xl font-bold text-amber-950
                tracking-wide leading-tight
              "
              style={{ fontFamily: "'Georgia', 'Times New Roman', serif" }}
            >
              {magicBook.title}
            </h2>
            <div className="mt-3 h-0.5 w-16 bg-gradient-to-r from-amber-400 to-amber-300 rounded-full" />
          </div>

          <div className="space-y-5 mb-10">
            {magicBook.content.map((item: string, index: number) => (
              <div key={index} className="flex items-start gap-4 group">
                <span
                  className="
                    flex-shrink-0 inline-flex items-center justify-center
                    w-7 h-7 rounded-full
                    bg-amber-200/70 text-amber-800
                    text-xs font-bold
                    shadow-sm
                    group-hover:bg-amber-300/70 transition-colors
                  "
                >
                  {index + 1}
                </span>
                <p
                  className="
                    text-amber-900/85 leading-relaxed text-[15px]
                    mt-0.5
                  "
                  style={{ fontFamily: "'Georgia', 'Times New Roman', serif" }}
                >
                  {item}
                </p>
              </div>
            ))}
          </div>

          {magicBook.examples.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-4">
                <span className="text-lg">⚡</span>
                <h3 className="text-sm font-semibold tracking-wider text-amber-600 uppercase">
                  魔法演练
                </h3>
              </div>

              <div className="space-y-5">
                {magicBook.examples.map((example: { code: string; description: string }, index: number) => (
                  <div
                    key={index}
                    className="
                      rounded-xl overflow-hidden
                      border border-amber-200/40
                      bg-white/50
                      shadow-sm
                    "
                  >
                    {example.description && (
                      <div className="px-5 py-3 bg-amber-50/80 border-b border-amber-100/50">
                        <p className="text-sm text-amber-800/80 italic">
                          {example.description}
                        </p>
                      </div>
                    )}
                    <div className="bg-gray-900 px-5 py-4 overflow-x-auto">
                      <pre className="text-sm text-green-300 font-mono leading-relaxed">
                        <code>{example.code}</code>
                      </pre>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="absolute bottom-3 right-8 text-xs text-amber-300/50 select-none">
          {chapter.id.toString().padStart(2, '0')}
        </div>
      </div>
    </div>
  );
};
