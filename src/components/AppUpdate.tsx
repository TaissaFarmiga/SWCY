import { useCallback, useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronRight, Download, RefreshCw, ShieldCheck, X } from 'lucide-react';
import { SnapshotPlugin } from '../bridge/snapshotPlugin';
import {
  checkGitHubUpdate,
  formatAssetSize,
  type GitHubUpdateRelease,
} from '../lib/githubUpdate';

type UpdateStatus = 'checking' | 'latest' | 'available' | 'downloading' | 'ready' | 'error';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatDate(value: string | null): string {
  if (!value) return '发布时间未知';
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
}

export function AppUpdate() {
  const [currentVersion, setCurrentVersion] = useState(__APP_VERSION__);
  const [status, setStatus] = useState<UpdateStatus>('checking');
  const [release, setRelease] = useState<GitHubUpdateRelease | null>(null);
  const [message, setMessage] = useState('正在检查版本');
  const [progress, setProgress] = useState(0);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const mountedRef = useRef(true);
  const requestSequenceRef = useRef(0);

  const checkUpdate = useCallback(async (version: string, manual = false, signal?: AbortSignal) => {
    const requestSequence = ++requestSequenceRef.current;
    setStatus('checking');
    setMessage('正在连接 GitHub');
    try {
      const result = await checkGitHubUpdate(version, signal);
      if (!mountedRef.current || signal?.aborted || requestSequence !== requestSequenceRef.current) return;
      setRelease(result.release);
      if (result.available) {
        setStatus('available');
        setMessage(`发现新版本 v${result.release.version}`);
        if (manual) setDrawerOpen(true);
      } else {
        setStatus('latest');
        setMessage(`已是最新版本 v${result.currentVersion}`);
      }
    } catch (error: unknown) {
      if (!mountedRef.current || signal?.aborted || requestSequence !== requestSequenceRef.current) return;
      setStatus('error');
      setMessage(errorMessage(error));
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const controller = new AbortController();
    const initialize = async () => {
      let installedVersion = __APP_VERSION__;
      if (Capacitor.isNativePlatform()) {
        try {
          const info = await SnapshotPlugin.getCurrentInfo();
          if (info.apkVersion) installedVersion = info.apkVersion;
        } catch {
          installedVersion = __APP_VERSION__;
        }
      }
      if (!mountedRef.current) return;
      setCurrentVersion(installedVersion);
      await checkUpdate(installedVersion, false, controller.signal);
    };
    void initialize();
    return () => {
      mountedRef.current = false;
      controller.abort();
    };
  }, [checkUpdate]);

  useEffect(() => {
    if (!drawerOpen) return undefined;
    const handleBack = (event: Event) => {
      setDrawerOpen(false);
      event.preventDefault();
    };
    window.addEventListener('hydro-app-back', handleBack);
    return () => window.removeEventListener('hydro-app-back', handleBack);
  }, [drawerOpen]);

  const openOrCheck = () => {
    if (status === 'checking') return;
    if (status === 'available' || status === 'downloading' || status === 'ready') {
      setDrawerOpen(true);
      return;
    }
    void checkUpdate(currentVersion, true);
  };

  const installUpdate = async () => {
    if (!release || status === 'downloading') return;
    if (!Capacitor.isNativePlatform()) {
      window.open(release.htmlUrl, '_blank', 'noopener,noreferrer');
      return;
    }

    setStatus('downloading');
    setMessage('正在下载安装包');
    setProgress(0);
    let progressListener: PluginListenerHandle | null = null;
    try {
      progressListener = await SnapshotPlugin.addListener('downloadProgress', (data) => {
        if (!mountedRef.current) return;
        setProgress(Math.max(0, Math.min(100, data.progress)));
      });
      await SnapshotPlugin.downloadAndInstallApk({
        apkUrl: release.asset.url,
        expectedSha256: release.asset.sha256,
      });
      if (!mountedRef.current) return;
      setStatus('ready');
      setMessage('安装界面已打开');
      setProgress(100);
    } catch (error: unknown) {
      if (!mountedRef.current) return;
      setStatus('error');
      setMessage(errorMessage(error));
    } finally {
      if (progressListener) await progressListener.remove();
    }
  };

  const statusIcon = status === 'checking'
    ? <RefreshCw className="h-4 w-4 animate-spin" />
    : status === 'latest'
      ? <Check className="h-4 w-4" />
      : <Download className="h-4 w-4" />;

  return (
    <section className="relative z-10 pb-7" aria-label="版本更新">
      <button
        type="button"
        onClick={openOrCheck}
        className="flex min-h-16 w-full items-center gap-3 rounded-2xl border border-white/80 bg-white/60 px-3.5 py-3 text-left shadow-[0_6px_24px_rgba(0,0,0,0.05)] backdrop-blur-xl active:scale-[0.99] dark:border-gray-700/80 dark:bg-gray-800/60"
      >
        <span className={`relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${status === 'available' ? 'bg-blue-500 text-white' : status === 'error' ? 'bg-amber-100 text-amber-600 dark:bg-amber-900/40' : 'bg-slate-100 text-slate-500 dark:bg-gray-700 dark:text-slate-300'}`}>
          {statusIcon}
          {status === 'available' && <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full border-2 border-white bg-red-500 dark:border-gray-800" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <strong className="text-sm text-slate-800 dark:text-slate-100">版本更新</strong>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 font-mono text-[9px] text-slate-500 dark:bg-gray-700 dark:text-slate-300">v{currentVersion}</span>
          </span>
          <span className={`mt-0.5 block truncate text-[11px] ${status === 'error' ? 'text-amber-600' : status === 'available' ? 'font-semibold text-blue-600' : 'text-slate-400'}`}>{message}</span>
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
      </button>

      <AnimatePresence>
        {drawerOpen && release && (
          <div className="fixed inset-0 z-[1000] flex items-end justify-center" role="dialog" aria-modal="true" aria-labelledby="update-title">
            <motion.button type="button" aria-label="关闭版本更新" className="absolute inset-0 bg-slate-900/30 backdrop-blur-[2px]" onClick={() => setDrawerOpen(false)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
            <motion.div
              initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              transition={{ type: 'spring', stiffness: 320, damping: 32 }}
              className="relative w-full max-w-xl rounded-t-[28px] border border-white/70 bg-[#F8F9FC]/95 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 shadow-2xl backdrop-blur-2xl dark:border-gray-700 dark:bg-gray-900/95"
            >
              <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-300 dark:bg-gray-600" />
              <div className="flex items-start gap-3">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-cyan-500 text-white shadow-lg shadow-blue-500/25"><Download className="h-6 w-6" /></span>
                <div className="min-w-0 flex-1">
                  <h2 id="update-title" className="truncate text-lg font-black text-slate-800 dark:text-slate-100">{release.title}</h2>
                  <p className="mt-0.5 text-xs text-slate-500">v{currentVersion} → v{release.version} · {formatAssetSize(release.asset.size)}</p>
                </div>
                <button type="button" onClick={() => setDrawerOpen(false)} aria-label="关闭" className="flex min-h-11 min-w-11 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-gray-800"><X className="h-5 w-5" /></button>
              </div>

              <div className="mt-4 max-h-[32dvh] overflow-y-auto rounded-2xl bg-white/70 p-3.5 dark:bg-gray-800/70">
                <p className="mb-2 text-xs font-bold text-slate-700 dark:text-slate-200">更新内容</p>
                <p className="whitespace-pre-wrap break-words text-[12px] leading-5 text-slate-500 dark:text-slate-400">{release.notes}</p>
              </div>

              <div className="mt-3 flex items-center justify-between px-1 text-[10px] text-slate-400">
                <span className="inline-flex items-center gap-1"><ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />GitHub SHA-256 安全校验</span>
                <span>{formatDate(release.publishedAt)}</span>
              </div>

              {status === 'downloading' && (
                <div className="mt-4">
                  <div className="mb-1.5 flex justify-between text-[11px] font-semibold text-blue-600"><span>正在下载</span><span>{progress}%</span></div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-gray-700"><motion.div className="h-full rounded-full bg-gradient-to-r from-blue-500 to-cyan-400" animate={{ width: `${progress}%` }} /></div>
                </div>
              )}

              {status === 'error' && <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">{message}</p>}

              <button
                type="button"
                onClick={() => void installUpdate()}
                disabled={status === 'downloading'}
                className="mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-blue-500 px-4 font-bold text-white shadow-lg shadow-blue-500/20 active:scale-[0.98] disabled:opacity-60"
              >
                {status === 'downloading' ? <><RefreshCw className="h-4 w-4 animate-spin" />正在下载 {progress}%</> : status === 'ready' ? <><Check className="h-4 w-4" />继续安装</> : <><Download className="h-4 w-4" />{Capacitor.isNativePlatform() ? '立即更新' : '前往 GitHub 下载'}</>}
              </button>
              <button type="button" onClick={() => setDrawerOpen(false)} className="mt-2 min-h-11 w-full rounded-xl text-sm font-semibold text-slate-500">稍后再说</button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </section>
  );
}
