import { useState, useCallback } from 'react';
import { Download, RefreshCw, CheckCircle, AlertTriangle } from 'lucide-react';
import { checkAndTriggerUpdate } from '../bridge/snapshotPlugin';

type Status = 'idle' | 'checking' | 'downloading' | 'done' | 'error';

export default function UpdatePanel() {
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState('');

  const handleUpdate = useCallback(async () => {
    setStatus('checking');
    setMessage('正在查询云端版本...');

    const result = await checkAndTriggerUpdate();

    if (result.hasUpdate) {
      setStatus('downloading');
      setMessage(result.message);
      // 防假死：如果 Native 唤起安装后用户点击了取消，或者重载失败
      // 5秒后强制恢复为可点击状态，允许用户重试
      setTimeout(() => {
        setStatus('idle');
        setMessage('更新准备就绪，点击重试');
      }, 5000);
    } else if (result.message.includes('已是最新版本')) {
      setStatus('done');
      setMessage(result.message);
    } else {
      setStatus('error');
      setMessage(result.message);
    }
  }, []);

  return (
    <div className="w-full max-w-[320px] mx-auto px-4">
      {/* 液态玻璃卡片 */}
      <div
        className="
          relative overflow-hidden rounded-2xl
          bg-white/40 backdrop-blur-md
          shadow-[inset_0_1px_1px_rgba(255,255,255,0.4),0_8px_32px_rgba(0,0,0,0.08)]
          border border-white/20
          p-5
          transition-all duration-500
        "
      >
        {/* 顶部极光光晕 */}
        <div className="absolute -top-6 -right-6 w-20 h-20 rounded-full bg-cyan-400/20 blur-2xl pointer-events-none" />
        <div className="absolute -bottom-4 -left-4 w-16 h-16 rounded-full bg-blue-500/15 blur-2xl pointer-events-none" />

        {/* 标题行 */}
        <div className="relative flex items-center gap-2 mb-4">
          <div
            className={`
              flex items-center justify-center w-7 h-7 rounded-lg
              transition-colors duration-700
              ${status === 'checking' || status === 'downloading'
                ? 'bg-amber-400/30 text-amber-600'
                : status === 'done'
                ? 'bg-emerald-400/30 text-emerald-600'
                : status === 'error'
                ? 'bg-red-400/30 text-red-500'
                : 'bg-cyan-400/30 text-cyan-600'
              }
            `}
          >
            {status === 'checking' || status === 'downloading' ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : status === 'done' ? (
              <CheckCircle className="w-4 h-4" />
            ) : status === 'error' ? (
              <AlertTriangle className="w-4 h-4" />
            ) : (
              <Download className="w-4 h-4" />
            )}
          </div>
          <span className="text-[13px] font-semibold text-slate-700 tracking-wide">
            {status === 'downloading' ? '⇊ 同步中' : status === 'done' ? '✓ 就绪' : status === 'error' ? '✗ 异常' : 'OTA 更新'}
          </span>
        </div>

        {/* 状态消息 */}
        {message && (
          <p
            className={`
              relative text-[11px] leading-relaxed mb-4 px-1
              transition-colors duration-500
              ${status === 'error' ? 'text-red-500' : status === 'done' ? 'text-emerald-600' : 'text-slate-500'}
            `}
          >
            {message}
          </p>
        )}

        {/* 操作按钮 */}
        <button
          onClick={handleUpdate}
          disabled={status === 'checking' || status === 'downloading'}
          className={`
            relative w-full py-2.5 rounded-xl
            text-[13px] font-semibold tracking-wide
            transition-all duration-200 ease-out
            active:scale-[0.97]
            select-none outline-none
            ${
              status === 'checking' || status === 'downloading'
                ? 'bg-slate-200/60 text-slate-400 cursor-not-allowed'
                : 'bg-gradient-to-b from-white/70 to-white/40 text-slate-700 hover:from-white/80 hover:to-white/50 shadow-sm hover:shadow-md border border-white/30'
            }
          `}
        >
          {status === 'checking' ? (
            <span className="inline-flex items-center gap-1.5">
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              查询中
            </span>
          ) : status === 'downloading' ? (
            <span className="inline-flex items-center gap-1.5">
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              下载中
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5">
              <Download className="w-3.5 h-3.5" />
              检查更新
            </span>
          )}
        </button>
      </div>
    </div>
  );
}