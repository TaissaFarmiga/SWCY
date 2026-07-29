import { motion } from 'framer-motion';
import { Activity, Gauge, Ruler, Waves } from 'lucide-react';
import type { AppModule } from '../types/navigation';
import { AppUpdate } from './AppUpdate';

interface HomeProps {
  onSelect: (module: AppModule) => void;
}

export function Home({ onSelect }: HomeProps) {
  return (
    <main className="relative mx-auto flex min-h-[100dvh] w-full max-w-xl flex-col overflow-hidden px-3 pb-safe pt-safe min-[360px]:px-5">
      <div className="absolute top-1/4 -left-10 w-48 h-48 bg-cyan-400/20 dark:bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 -right-10 w-48 h-48 bg-blue-500/20 dark:bg-blue-600/10 rounded-full blur-3xl pointer-events-none" />

      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="relative z-10 pb-5 pt-3 text-center">
        <h1 className="text-2xl font-black tracking-tight text-slate-800 dark:text-slate-100">水文测验终端</h1>
        <p className="mt-1 text-xs font-medium tracking-[0.18em] text-slate-500 dark:text-slate-400">HYDROMETRIC FIELD TERMINAL</p>
      </motion.div>

      <section className="relative z-10">
        <h2 className="mb-2 px-1 text-xs font-bold tracking-[0.18em] text-slate-500">核心业务</h2>
        <div className="space-y-3">
          <motion.button
            type="button"
            initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.05 }}
            whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }}
            onClick={() => onSelect('flow')}
            className="group relative min-h-[88px] w-full rounded-3xl border border-white/80 bg-white/65 p-4 text-left shadow-[0_8px_32px_rgba(0,0,0,0.06)] backdrop-blur-xl dark:border-gray-700/80 dark:bg-gray-800/60"
          >
            <div className="relative z-10 flex items-center gap-3">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-cyan-500 text-white shadow-lg shadow-cyan-500/25"><Waves className="h-6 w-6" /></span>
              <span className="min-w-0">
                <strong className="block text-base text-slate-800 dark:text-slate-100">流速仪测流</strong>
                <span className="mt-0.5 block text-[11px] leading-5 text-slate-500 dark:text-slate-400">流速面积法 · 测线、垂线与成果导出</span>
              </span>
            </div>
          </motion.button>

          <motion.button
            type="button"
            initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.1 }}
            whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }}
            onClick={() => onSelect('leveling')}
            className="group relative min-h-[88px] w-full rounded-3xl border border-white/80 bg-white/65 p-4 text-left shadow-[0_8px_32px_rgba(0,0,0,0.06)] backdrop-blur-xl dark:border-gray-700/80 dark:bg-gray-800/60"
          >
            <div className="relative z-10 flex items-center gap-3">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-500 text-white shadow-lg shadow-emerald-500/25"><Ruler className="h-6 w-6" /></span>
              <span className="min-w-0">
                <strong className="block text-base text-slate-800 dark:text-slate-100">水准测量</strong>
                <span className="mt-0.5 block text-[11px] leading-5 text-slate-500 dark:text-slate-400">三等、四等 · 测站校核与路线成果</span>
              </span>
            </div>
          </motion.button>
        </div>
      </section>

      <section className="relative z-10 mt-5 pb-7">
        <h2 className="mb-2 px-1 text-xs font-bold tracking-[0.18em] text-slate-500">工具箱</h2>
        <div className="grid grid-cols-2 gap-3">
          <motion.button
            type="button"
            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => onSelect('flow-deviation')}
            className="min-h-[132px] rounded-3xl border border-white/80 bg-white/65 p-4 text-left shadow-[0_8px_28px_rgba(0,0,0,0.05)] backdrop-blur-xl dark:border-gray-700/80 dark:bg-gray-800/60"
          >
            <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-500 text-white shadow-lg shadow-blue-500/20"><Activity className="h-5 w-5" /></span>
            <strong className="block text-sm text-slate-800 dark:text-slate-100">流量偏离率</strong>
            <span className="mt-1 block text-[10px] leading-4 text-slate-500 dark:text-slate-400">实测与线上流量对比</span>
          </motion.button>

          <motion.button
            type="button"
            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => onSelect('spirit-level')}
            className="min-h-[132px] rounded-3xl border border-white/80 bg-white/65 p-4 text-left shadow-[0_8px_28px_rgba(0,0,0,0.05)] backdrop-blur-xl dark:border-gray-700/80 dark:bg-gray-800/60"
          >
            <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-500 text-white shadow-lg shadow-amber-500/20"><Gauge className="h-5 w-5" /></span>
            <strong className="block text-sm text-slate-800 dark:text-slate-100">电子气泡</strong>
            <span className="mt-1 block text-[10px] leading-4 text-slate-500 dark:text-slate-400">水准尺垂直度辅助校验</span>
          </motion.button>
        </div>
      </section>

      <AppUpdate />
    </main>
  );
}
