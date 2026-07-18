import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { NPC, DialogueLine } from '../../../types/python-magic';
import { useAuth } from '../../../hooks/useAuth';

interface GameDialogueProps {
  npc: NPC;
  dialogues: DialogueLine[];
  onComplete: () => void;
}

export const GameDialogue: React.FC<GameDialogueProps> = ({ npc, dialogues, onComplete }) => {
  const { profile } = useAuth();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [displayedText, setDisplayedText] = useState('');
  const [isTyping, setIsTyping] = useState(true);
  const [showContinue, setShowContinue] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const charIndexRef = useRef(0);
  const isComplete = currentIndex >= dialogues.length;

  const currentDialogue = dialogues[currentIndex] || null;
  const currentText = currentDialogue?.text || '';
  const typingSpeed = 50;
  const autoAdvanceDelay = currentDialogue?.delay ?? 2000;

  const clearTimers = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const startTyping = useCallback(() => {
    setIsTyping(true);
    setShowContinue(false);
    setDisplayedText('');
    charIndexRef.current = 0;

    const typeNextChar = () => {
      if (charIndexRef.current < currentText.length) {
        setDisplayedText(currentText.slice(0, charIndexRef.current + 1));
        charIndexRef.current += 1;
        timerRef.current = setTimeout(typeNextChar, typingSpeed);
      } else {
        setIsTyping(false);
        setShowContinue(true);
      }
    };

    timerRef.current = setTimeout(typeNextChar, typingSpeed);
  }, [currentText]);

  useEffect(() => {
    startTyping();
    return clearTimers;
  }, [currentIndex, startTyping, clearTimers]);

  const skipToEnd = useCallback(() => {
    clearTimers();
    setDisplayedText(currentText);
    setIsTyping(false);
    setShowContinue(true);
  }, [currentText, clearTimers]);

  const advance = useCallback(() => {
    clearTimers();
    if (currentIndex < dialogues.length - 1) {
      setCurrentIndex(prev => prev + 1);
    } else {
      setShowContinue(true);
    }
  }, [currentIndex, dialogues.length, clearTimers]);

  useEffect(() => {
    if (!isTyping && showContinue && currentIndex < dialogues.length - 1) {
      const autoTimer = setTimeout(() => {
        advance();
      }, autoAdvanceDelay);
      return () => clearTimeout(autoTimer);
    }
  }, [isTyping, showContinue, currentIndex, dialogues.length, autoAdvanceDelay, advance]);

  const handleClick = useCallback(() => {
    if (isTyping) {
      skipToEnd();
    } else if (showContinue) {
      if (currentIndex < dialogues.length - 1) {
        advance();
      } else {
        onComplete();
      }
    }
  }, [isTyping, showContinue, currentIndex, dialogues.length, advance, skipToEnd, onComplete]);

  const getAvatarContent = () => {
    if (/[\u{1F000}-\u{1FFFF}]/u.test(npc.avatar)) {
      return npc.avatar;
    }
    return npc.name.charAt(0);
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-gray-900/95">
      <div className="flex-1 flex flex-col items-center justify-center px-6">
        <AnimatePresence mode="wait">
          {!isComplete && currentDialogue && (
            <motion.div
              key={currentIndex}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.3 }}
              className="flex flex-col items-center"
            >
              <motion.div
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 0.1, duration: 0.3 }}
                className="w-24 h-24 rounded-full bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center text-4xl shadow-lg shadow-purple-500/30 mb-4"
              >
                <span className="text-white font-bold select-none">
                  {getAvatarContent()}
                </span>
              </motion.div>
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.2 }}
                className="text-white text-lg font-medium mb-1"
              >
                {npc.name}
              </motion.p>
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.25 }}
                className="text-purple-300 text-sm mb-6"
              >
                {npc.title}
              </motion.p>
            </motion.div>
          )}
        </AnimatePresence>

        {isComplete && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.4 }}
            className="text-center"
          >
            <div className="w-24 h-24 rounded-full bg-gradient-to-br from-green-400 to-emerald-500 flex items-center justify-center text-5xl mx-auto mb-4 shadow-lg shadow-green-500/30">
              <span className="text-white">✦</span>
            </div>
            <p className="text-white text-xl font-bold mb-2">对话结束</p>
            <p className="text-gray-400 text-sm mb-6">准备好迎接挑战了吗？</p>
          </motion.div>
        )}
      </div>

      <div className="px-6 pb-8">
        <motion.div
          layout
          onClick={handleClick}
          className="relative bg-gray-800/90 backdrop-blur-sm border border-gray-700/50 rounded-2xl p-5 cursor-pointer hover:bg-gray-800 transition-colors min-h-[100px]"
        >
          {!isComplete && currentDialogue && (
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-indigo-600 flex-shrink-0 flex items-center justify-center text-sm font-bold text-white">
                {getAvatarContent()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-gray-300 text-sm mb-2">{npc.name}</p>
                <p className="text-white text-base leading-relaxed">
                  {displayedText}
                  {isTyping && (
                    <span className="inline-block w-0.5 h-5 bg-purple-400 ml-0.5 animate-pulse align-middle" />
                  )}
                </p>
              </div>
            </div>
          )}

          {isComplete && (
            <div className="text-center py-4">
              <p className="text-gray-300 mb-4">剧情已全部看完，准备开始吧！</p>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onComplete();
                }}
                className="px-8 py-3 bg-gradient-to-r from-purple-500 to-indigo-600 text-white font-medium rounded-xl hover:from-purple-600 hover:to-indigo-700 transition-all duration-200 shadow-lg shadow-purple-500/25 active:scale-95"
              >
                继续
              </button>
            </div>
          )}

          {showContinue && !isTyping && !isComplete && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 }}
              className="absolute bottom-3 right-4"
            >
              <span className="text-purple-400 text-xs animate-pulse">
                {currentIndex < dialogues.length - 1 ? '点击继续' : '点击结束'}
              </span>
            </motion.div>
          )}
        </motion.div>

        <div className="flex justify-center mt-3 gap-1.5">
          {dialogues.map((_, index) => (
            <div
              key={index}
              className={`w-2 h-2 rounded-full transition-all duration-300 ${
                index === currentIndex
                  ? 'bg-purple-500 w-4'
                  : index < currentIndex
                  ? 'bg-purple-700'
                  : 'bg-gray-600'
              }`}
            />
          ))}
        </div>
      </div>
    </div>
  );
};
