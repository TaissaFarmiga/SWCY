import { useMemo, useState } from 'react';
import { ChevronLeft, RotateCcw, TrendingDown, TrendingUp, Equal } from 'lucide-react';
import { calculateFlowDeviation } from '../../lib/flowDeviation';
import { formatFinite, formatFiniteAdaptive } from '../../lib/rounding';

function FlowInput({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label
      htmlFor={id}
      className="block rounded-2xl border border-white/80 bg-white/65 p-4 shadow-glass backdrop-blur-xl"
    >
      <span className="mb-2 block text-sm font-bold text-slate-700">{label}</span>
      <div className="flex min-h-12 items-center rounded-xl border border-slate-200 bg-white/80 px-3 focus-within:border-blue-400">
        <input
          id={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="请输入流量"
          className="min-w-0 flex-1 bg-transparent py-3 font-mono text-lg font-bold text-slate-800 outline-none"
        />
        <span className="shrink-0 text-xs text-slate-400">m³/s</span>
      </div>
    </label>
  );
}

export function FlowDeviationTool({ onBack }: { onBack: () => void }) {
  const [measured, setMeasured] = useState('');
  const [online, setOnline] = useState('');
  const hasAnyInput = measured.trim() !== '' || online.trim() !== '';
  const result = useMemo(
    () => calculateFlowDeviation(measured, online),
    [measured, online],
  );

  const clear = () => {
    setMeasured('');
    setOnline('');
  };

  const statusIcon = result.kind === 'valid'
    ? result.status === '实测偏高'
      ? <TrendingUp className="h-5 w-5" />
      : result.status === '实测偏低'
        ? <TrendingDown className="h-5 w-5" />
        : <Equal className="h-5 w-5" />
    : null;

  return (
    <main className="app-safe-screen mx-auto min-h-[100dvh] w-full max-w-xl px-3 pb-28">
      <header className="mb-5 flex items-start gap-1">
        <button type="button" onClick={onBack} aria-label="返回首页" title="返回首页" className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl text-slate-600 transition-colors hover:bg-white/60 active:scale-95">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0 pt-0.5">
          <p className="text-xs font-semibold tracking-[0.2em] text-blue-500">工具箱</p>
          <h1 className="mt-1 text-2xl font-black text-slate-800">流量偏离率</h1>
          <p className="mt-1 text-sm text-slate-500">仅计算偏离，不设置合格阈值</p>
        </div>
      </header>

      <section className="space-y-3">
        <FlowInput
          id="measured-flow"
          label="实测流量 Q实测"
          value={measured}
          onChange={setMeasured}
        />
        <FlowInput
          id="online-flow"
          label="线上流量 Q线上"
          value={online}
          onChange={setOnline}
        />
      </section>

      <section
        aria-live="polite"
        className="mt-4 rounded-3xl border border-white/80 bg-white/70 p-4 shadow-glass-lg backdrop-blur-xl"
      >
        {result.kind === 'valid' ? (
          <div className="space-y-3">
            <div className="flex min-h-11 items-center justify-between rounded-xl bg-blue-50/80 px-3">
              <span className="text-sm text-slate-500">ΔQ</span>
              <strong className="font-mono text-base text-blue-700">
                {formatFiniteAdaptive(result.delta, 6)} m³/s
              </strong>
            </div>
            <div className="grid grid-cols-1 gap-2 min-[360px]:grid-cols-2">
              <div className="rounded-xl bg-slate-50 p-3">
                <span className="block text-xs text-slate-500">有符号偏离率 R</span>
                <strong className="mt-1 block font-mono text-base text-slate-800">
                  {result.signedRate ? `${formatFinite(result.signedRate, 2)}%` : result.rateMessage}
                </strong>
              </div>
              <div className="rounded-xl bg-slate-50 p-3">
                <span className="block text-xs text-slate-500">绝对偏离率 Ra</span>
                <strong className="mt-1 block font-mono text-base text-slate-800">
                  {result.absoluteRate ? `${formatFinite(result.absoluteRate, 2)}%` : result.rateMessage}
                </strong>
              </div>
            </div>
            <div className="flex min-h-11 items-center gap-2 rounded-xl bg-emerald-50 px-3 font-bold text-emerald-700">
              {statusIcon}
              <span>{result.status}</span>
            </div>
          </div>
        ) : (
          <p className={`py-8 text-center text-sm ${hasAnyInput ? 'text-amber-600' : 'text-slate-400'}`}>
            {hasAnyInput ? result.message : '录入两项流量后显示结果'}
          </p>
        )}
      </section>

      <button
        type="button"
        onClick={clear}
        disabled={!hasAnyInput}
        className="mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border border-white/80 bg-white/70 font-bold text-slate-600 shadow-glass active:scale-[0.98] disabled:opacity-40"
      >
        <RotateCcw className="h-4 w-4" />
        清空
      </button>
    </main>
  );
}
