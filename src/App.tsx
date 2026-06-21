/**
 * 水文测验终端主应用 — PWA 移动端
 * 包含：深色模式切换、强制存档、Toast 通知
 */
import { motion, AnimatePresence } from 'framer-motion';
import { useEffect, useState } from 'react';
import { Sun, Moon, Save, Download, Upload } from 'lucide-react';
import Dashboard from './components/Dashboard';
import PeriodToggle from './components/PeriodToggle';
import HydroTable from './components/HydroTable';
import { useHydroStore } from './store/hydroStore';

function Toast({ message, show }: { message: string; show: boolean }) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] px-4 py-2 rounded-lg bg-emerald-500 dark:bg-emerald-600 text-white text-sm font-bold shadow-lg"
        >
          {message}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default function App() {
  const recalculate = useHydroStore((s) => s.recalculate);
  const exportData = useHydroStore((s) => s.exportData);
  const currentRun = useHydroStore((s) => s.currentRun);
  const importBackup = useHydroStore((s) => s.importBackup);
  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem('theme');
    if (saved) return saved === 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });
  const [toast, setToast] = useState({ show: false, message: '' });

  useEffect(() => {
    recalculate();
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    localStorage.setItem('theme', darkMode ? 'dark' : 'light');
  }, [darkMode]);

  const showToast = (msg: string) => {
    setToast({ show: true, message: msg });
    setTimeout(() => setToast({ show: false, message: '' }), 1500);
  };

  const handleForceSave = () => {
    localStorage.setItem('hydro-storage', JSON.stringify({
      state: {
        currentRun,
        runs: useHydroStore.getState().runs,
      },
      version: 0,
    }));
    showToast('✅ 数据已本地安全锁定');
  };

  const handleDownloadJSON = () => {
    const data = JSON.stringify({
      currentRun,
      runs: useHydroStore.getState().runs,
      exportedAt: new Date().toISOString(),
    }, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const now = new Date();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const mi = String(now.getMinutes()).padStart(2, '0');
    link.download = `hydro_backup_${now.getFullYear()}${mm}${dd}_${hh}${mi}.json`;
    link.click();
    URL.revokeObjectURL(url);
    showToast('✅ JSON 备份已下载到设备');
  };

  const handleImportClick = () => {
    document.getElementById('hydro-import-input')?.click();
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target?.result as string);
        importBackup(data);
        showToast('✅ 备份已成功还原');
      } catch {
        showToast('❌ 文件格式无效，请选择正确的备份文件');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <div className="min-h-screen bg-[#F2F2F7] dark:bg-gray-950 transition-colors duration-300">
      <Toast message={toast.message} show={toast.show} />

      {/* 背景装饰 */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-0 right-0 w-[300px] h-[300px] bg-hydro-blue/3 dark:bg-hydro-blue/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3" />
      </div>

      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="relative z-10">
        {/* 标题栏 — 随屏滚动 */}
        <header className="bg-[#F2F2F7] dark:bg-gray-950 pt-safe">
          <div className="px-2 py-1.5 flex items-center justify-between gap-1.5">
            <div className="flex items-center gap-1.5">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-hydro-blue to-hydro-blue-dark flex items-center justify-center shadow-sm shadow-hydro-blue/20">
                <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 18 Q8 6 12 12 Q16 18 21 6" strokeLinecap="round" />
                  <circle cx="12" cy="6" r="2" fill="currentColor" />
                </svg>
              </div>
              <div>
                <h1 className="text-sm font-bold text-slate-800 dark:text-white">水文测验终端</h1>
                <p className="text-xs text-slate-400 dark:text-slate-500">GB 50179-2015</p>
              </div>
            </div>

            {/* 操作按钮区 */}
            <div className="flex items-center gap-1">
              <button onClick={handleForceSave}
                className="p-1.5 rounded-md bg-white/60 dark:bg-gray-800/60 border border-white/80 dark:border-gray-700 text-slate-500 dark:text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 transition-colors"
                title="强制存档到本地">
                <Save className="w-4 h-4" />
              </button>
              <button onClick={handleImportClick}
                className="p-1.5 rounded-md bg-white/60 dark:bg-gray-800/60 border border-white/80 dark:border-gray-700 text-slate-500 dark:text-slate-400 hover:text-amber-600 dark:hover:text-amber-400 transition-colors"
                title="导入备份">
                <Upload className="w-4 h-4" />
              </button>
              <input id="hydro-import-input" type="file" accept=".json" onChange={handleImportFile} className="w-0 h-0 opacity-0 absolute pointer-events-none" />
              <button onClick={handleDownloadJSON}
                className="p-1.5 rounded-md bg-white/60 dark:bg-gray-800/60 border border-white/80 dark:border-gray-700 text-slate-500 dark:text-slate-400 hover:text-hydro-blue dark:hover:text-hydro-blue-light transition-colors"
                title="导出 JSON 备份">
                <Download className="w-4 h-4" />
              </button>
              <button onClick={exportData}
                className="flex items-center gap-1 px-2 py-1 rounded-md bg-emerald-500 dark:bg-emerald-600 text-white text-sm font-medium shadow-sm hover:bg-emerald-600 dark:hover:bg-emerald-500 transition-colors">
                <Download className="w-3 h-3" /><span className="hidden sm:inline">导出</span>
              </button>
              <button onClick={() => setDarkMode(!darkMode)}
                className="p-1.5 rounded-md bg-white/60 dark:bg-gray-800/60 border border-white/80 dark:border-gray-700 text-slate-500 dark:text-yellow-400 hover:bg-slate-100 dark:hover:bg-gray-800 transition-colors"
                title={darkMode ? '切换亮色模式' : '切换深色模式'}>
                {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </header>

        <Dashboard />
        <PeriodToggle />
        <HydroTable />
      </motion.div>
    </div>
  );
}