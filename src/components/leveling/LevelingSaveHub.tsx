import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Pin, RotateCcw, Save } from 'lucide-react';
import { useLevelingStore } from '../../store/levelingStore';

// 🎯 极客手绘：4层密集饱满大蓝靶 + 猩红飞箭正中靶心矢量图标
function TargetWithArrowIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      <circle cx="10" cy="14" r="9" stroke="#3b82f6" strokeOpacity="0.25" />
      <circle cx="10" cy="14" r="6.5" stroke="#3b82f6" strokeOpacity="0.5" />
      <circle cx="10" cy="14" r="4" stroke="#3b82f6" strokeOpacity="0.8" />
      <circle cx="10" cy="14" r="1.5" stroke="#3b82f6" />
      <circle cx="10" cy="14" r="0.5" fill="#3b82f6" />
      <line x1="21" y1="3" x2="11" y2="13" stroke="#ef4444" />
      <path d="M10 14h4M10 14v-4" stroke="#ef4444" strokeWidth="2.5" />
      <line x1="18" y1="3.5" x2="20.5" y2="6" stroke="#ef4444" />
      <line x1="16" y1="5.5" x2="18.5" y2="8" stroke="#ef4444" />
    </svg>
  );
}

export function LevelingSaveHub() {
  const isDirty = useLevelingStore(s => s.isDirty);
  const currentRoute = useLevelingStore(s => s.currentRoute);
  const routes = useLevelingStore(s => s.routes);
  const commitRoute = useLevelingStore(s => s.commitRoute);
  const revertCurrentRoute = useLevelingStore(s => s.revertCurrentRoute);

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // 💡 重构后的绝对精准逻辑：
  // 1. 是否为历史记录中已存在的数据？
  const isExisting = routes.some(r => r.id === currentRoute.id);
  // 2. 只有当确实产生了脏数据 (isDirty) 时，按钮才允许点击
  const isButtonActive = isDirty;
  // 3. 只要是修改了历史记录，就必须弹窗让用户选择（覆盖/另存），绝不静默覆盖
  const showMenuInsteadOfDirectSave = isDirty && isExisting;

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const handleAppBack = (event: Event) => {
      if (!menuOpen) return;
      setMenuOpen(false);
      event.preventDefault();
    };
    if (menuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      window.addEventListener('hydro-app-back', handleAppBack);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('hydro-app-back', handleAppBack);
    };
  }, [menuOpen]);

  const handleMainClick = () => {
    if (!isButtonActive) return;
    if (!showMenuInsteadOfDirectSave) {
      // 全新路线：大拇指点击一键无缝归档
      commitRoute('new');
    } else {
      // 历史修改：点击就地展开气泡菜单
      setMenuOpen(!menuOpen);
    }
  };

  return (
    <div className="relative shrink-0" ref={menuRef}>
      <button
        onClick={handleMainClick}
        disabled={!isButtonActive}
        className={`flex min-h-11 min-w-11 items-center justify-center rounded-lg transition-all duration-300 outline-none ${
          !isButtonActive
            ? 'bg-slate-200/50 dark:bg-gray-800/50 text-slate-400 dark:text-slate-500 cursor-not-allowed'
            : !isExisting
            ? 'bg-gradient-to-br from-emerald-400 to-emerald-600 text-white shadow-lg shadow-emerald-500/30 active:scale-95'
            : 'bg-gradient-to-br from-pink-300 to-rose-400 text-white animate-pulse active:scale-95'
        }`}
        title={!isDirty ? '已静默缓存' : !isExisting ? '全新归档入库' : '历史已有修改'}
      >
        <Save className="w-4 h-4" />
      </button>

      <AnimatePresence>
        {menuOpen && isButtonActive && showMenuInsteadOfDirectSave && (
          <motion.div initial={{ opacity: 0, scale: 0.95, y: 5 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 5 }} transition={{ duration: 0.15, ease: 'easeOut' }} className="absolute right-0 top-full mt-2.5 w-[140px] z-[100] origin-top-right rounded-2xl bg-white/[0.94] dark:bg-gray-900/[0.90] backdrop-blur-xl border border-slate-200/60 dark:border-gray-700/60 shadow-2xl overflow-hidden">
            <div className="flex flex-col p-1.5 gap-0.5">
              <button onClick={() => { commitRoute('overwrite'); setMenuOpen(false); }} className="flex min-h-11 items-center gap-2.5 px-3 py-2.5 w-full rounded-xl text-[13px] font-bold text-slate-700 dark:text-slate-200 hover:bg-black/5 dark:hover:bg-white/10 transition-colors text-left">
                <Pin className="w-4 h-4 text-red-500 rotate-45 shrink-0" />
                <span>保存修改</span>
              </button>
              <button onClick={() => { commitRoute('new'); setMenuOpen(false); }} className="flex min-h-11 items-center gap-2.5 px-3 py-2.5 w-full rounded-xl text-[13px] font-bold text-slate-700 dark:text-slate-200 hover:bg-black/5 dark:hover:bg-white/10 transition-colors text-left">
                <TargetWithArrowIcon />
                <span>另存新档</span>
              </button>
              <div className="h-px w-full bg-slate-300/40 dark:bg-gray-600/50 my-0.5" />
              <button onClick={() => { revertCurrentRoute(); setMenuOpen(false); }} className="flex min-h-11 items-center gap-2.5 px-3 py-2.5 w-full rounded-xl text-[13px] font-medium text-slate-500 dark:text-slate-400 hover:bg-black/5 dark:hover:bg-white/10 transition-colors text-left">
                <RotateCcw className="w-4 h-4 text-slate-400 shrink-0" />
                <span>恢复原始</span>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
