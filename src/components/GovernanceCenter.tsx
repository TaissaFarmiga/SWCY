import { useEffect, useMemo, useState } from 'react';
import { Archive, ChevronLeft, DatabaseBackup, FileCheck2, Plus, ShieldCheck, Stethoscope, Trash2 } from 'lucide-react';
import { createAppDiagnostic, exportAppDiagnostic, exportFullBackup, restoreFullBackup, validateFullBackup } from '../lib/appBackup';
import type { FullBackupFile } from '../lib/appBackup';
import { effectiveInstrumentStatus, useGovernanceStore } from '../store/governanceStore';
import { useHydroStore } from '../store/hydroStore';
import { useLevelingStore } from '../store/levelingStore';
import type { InstrumentKind, InstrumentProfile, InstrumentStatus } from '../types/governance';

const statusLabel: Record<InstrumentStatus, string> = {
  unregistered: '未登记', valid: '有效', expired: '已过期', disabled: '停用',
};

const lifecycleLabel = {
  draft: '草稿', completed: '已完成', pending_review: '待复核', reviewed: '已复核', archived: '已归档', revision: '修订中',
} as const;

const kindLabel: Record<InstrumentKind, string> = {
  'current-meter': '流速仪', level: '水准仪', staff: '水准尺', other: '其他',
};

const fieldClass = 'min-h-11 w-full min-w-0 rounded-xl border border-white/90 bg-white/75 px-3 text-sm text-slate-700 outline-none focus:border-indigo-400 dark:border-gray-700 dark:bg-gray-800/75 dark:text-slate-100';
const cardClass = 'rounded-3xl border border-white/80 bg-white/65 p-3 shadow-[0_8px_28px_rgba(0,0,0,0.05)] backdrop-blur-xl dark:border-gray-700/80 dark:bg-gray-800/60';

interface DraftInstrument {
  kind: InstrumentKind;
  name: string;
  model: string;
  serialNumber: string;
  certificateNumber: string;
  verificationDate: string;
  validUntil: string;
  status: InstrumentStatus;
  k: string;
  c: string;
}

const emptyInstrument: DraftInstrument = {
  kind: 'current-meter', name: '', model: '', serialNumber: '', certificateNumber: '', verificationDate: '', validUntil: '', status: 'valid', k: '', c: '',
};

function toInstrumentInput(draft: DraftInstrument): Omit<InstrumentProfile, 'id' | 'createdAt' | 'updatedAt'> | null {
  if (!draft.name.trim()) return null;
  const k = Number(draft.k);
  const c = Number(draft.c);
  const meterFormula = draft.kind === 'current-meter' && draft.k.trim() !== '' && draft.c.trim() !== '' && Number.isFinite(k) && Number.isFinite(c)
    ? { k, c }
    : undefined;
  return {
    kind: draft.kind,
    name: draft.name.trim(),
    model: draft.model.trim(),
    serialNumber: draft.serialNumber.trim(),
    certificateNumber: draft.certificateNumber.trim(),
    verificationDate: draft.verificationDate || undefined,
    validUntil: draft.validUntil || undefined,
    status: draft.status,
    meterFormula,
    notes: '',
  };
}

export function GovernanceCenter({ onBack }: { onBack: () => void }) {
  const governance = useGovernanceStore();
  const currentRun = useHydroStore((state) => state.currentRun);
  const currentRoute = useLevelingStore((state) => state.currentRoute);
  const [draft, setDraft] = useState<DraftInstrument>(emptyInstrument);
  const [message, setMessage] = useState('');
  const [pendingBackup, setPendingBackup] = useState<FullBackupFile | null>(null);
  const [diagnosticPreview, setDiagnosticPreview] = useState('');
  const rules = governance.ruleProfiles;
  const audits = useMemo(() => governance.audits.slice().reverse().slice(0, 20), [governance.audits]);

  useEffect(() => {
    const handleBack = (event: Event) => {
      if (!pendingBackup) return;
      setPendingBackup(null);
      event.preventDefault();
    };
    window.addEventListener('hydro-app-back', handleBack);
    return () => window.removeEventListener('hydro-app-back', handleBack);
  }, [pendingBackup]);

  const addInstrument = () => {
    const input = toInstrumentInput(draft);
    if (!input) {
      setMessage('请填写仪器名称；流速仪公式须同时填写有限数 K、C，或均留空。');
      return;
    }
    if (draft.kind === 'current-meter' && (draft.k.trim() === '') !== (draft.c.trim() === '')) {
      setMessage('流速仪公式 K、C 必须同时填写或同时留空。');
      return;
    }
    if (draft.kind === 'current-meter' && draft.k.trim() !== '' && !input.meterFormula) {
      setMessage('流速仪公式必须为有限数。');
      return;
    }
    governance.addInstrument(input);
    setDraft(emptyInstrument);
    setMessage('仪器档案已保存。任务应用后会保存独立快照。');
  };

  const chooseInstrument = (module: 'flow' | 'leveling', id: string) => {
    governance.setSelectedInstrument(module, id);
    if (module === 'flow') useHydroStore.getState().applySelectedInstrument();
    else useLevelingStore.getState().applySelectedInstrument();
    setMessage(module === 'flow' ? '已应用到当前测流任务。' : '已应用到当前水准任务。');
  };

  const readBackup = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed: unknown = JSON.parse(String(reader.result));
        const validated = validateFullBackup(parsed);
        setPendingBackup(validated);
        setMessage('校验通过。确认后才会覆盖当前完整数据。');
      } catch (error) {
        governance.recordDiagnostic('backup');
        setPendingBackup(null);
        setMessage(error instanceof Error ? error.message : '备份校验失败');
      }
    };
    reader.onerror = () => {
      governance.recordDiagnostic('backup');
      setMessage('备份文件读取失败');
    };
    reader.readAsText(file);
  };

  const confirmRestore = () => {
    if (!pendingBackup) return;
    try {
      restoreFullBackup(pendingBackup);
      setPendingBackup(null);
      setMessage('完整备份恢复成功。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '完整备份恢复失败');
    }
  };

  const previewDiagnostic = async () => {
    const diagnostic = await createAppDiagnostic();
    setDiagnosticPreview(`平台 ${diagnostic.runtime.platform} · 测流 ${diagnostic.counts.flowRecords} · 水准 ${diagnostic.counts.levelingRecords} · 最近错误类别 ${diagnostic.recentErrorCategories.length}`);
  };

  const advanceFlowStatus = () => {
    const store = useHydroStore.getState();
    if (store.currentRun.recordStatus === 'draft' || store.currentRun.recordStatus === 'revision') {
      setMessage(store.completeCurrentRun() ? '测流成果已完成并锁定。' : '测流数据尚不完整，不能完成。');
    } else if (store.currentRun.recordStatus === 'completed') {
      store.transitionRecordStatus('pending_review'); setMessage('测流成果已提交复核。');
    } else if (store.currentRun.recordStatus === 'pending_review') {
      store.transitionRecordStatus('reviewed'); setMessage('测流成果已复核。');
    } else if (store.currentRun.recordStatus === 'reviewed') {
      store.transitionRecordStatus('archived'); setMessage('测流成果已归档。');
    }
  };

  const advanceLevelingStatus = () => {
    const store = useLevelingStore.getState();
    if (store.currentRoute.completionStatus === 'draft' || store.currentRoute.completionStatus === 'revision') {
      if (!store.currentRoute.calculation.isComplete) { setMessage('水准路线尚不完整，不能完成。'); return; }
      store.completeRoute(); setMessage('水准成果已完成并锁定。');
    } else if (store.currentRoute.completionStatus === 'completed') {
      store.transitionRouteStatus('pending_review'); setMessage('水准成果已提交复核。');
    } else if (store.currentRoute.completionStatus === 'pending_review') {
      store.transitionRouteStatus('reviewed'); setMessage('水准成果已复核。');
    } else if (store.currentRoute.completionStatus === 'reviewed') {
      store.transitionRouteStatus('archived'); setMessage('水准成果已归档。');
    }
  };

  const nextStatusLabel = (status: keyof typeof lifecycleLabel) => status === 'draft' || status === 'revision'
    ? '完成并锁定'
    : status === 'completed'
      ? '提交复核'
      : status === 'pending_review'
        ? '确认复核'
        : status === 'reviewed' ? '归档' : '已归档';

  return (
    <main data-testid="governance-screen" className="app-safe-screen min-h-[100dvh] bg-gradient-to-br from-[#F2F2F7] to-slate-100 px-3 pb-safe dark:from-gray-950 dark:to-slate-900 min-[360px]:px-4">
      <header className="sticky top-0 z-20 -mx-3 flex min-h-14 items-center gap-2 border-b border-white/70 bg-[#F2F2F7]/90 px-3 py-1.5 backdrop-blur-xl dark:border-gray-800 dark:bg-gray-950/90 min-[360px]:-mx-4 min-[360px]:px-4">
        <button type="button" onClick={onBack} aria-label="返回首页" className="flex min-h-11 min-w-11 items-center justify-center rounded-xl text-slate-600 hover:bg-white/70 dark:text-slate-200 dark:hover:bg-gray-800"><ChevronLeft className="h-5 w-5" /></button>
        <div className="min-w-0"><h1 className="truncate text-base font-black text-slate-800 dark:text-slate-100">数据治理与备份</h1><p className="text-[10px] text-slate-500">本地优先 · 成果留痕 · 可验证恢复</p></div>
      </header>

      <div className="mx-auto mt-3 flex w-full max-w-xl flex-col gap-3">
        {message && <p role="status" className="rounded-xl border border-indigo-100 bg-indigo-50/80 px-3 py-2 text-xs leading-5 text-indigo-700 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-300">{message}</p>}

        <section className={cardClass}>
          <h2 className="mb-2 flex items-center gap-2 text-sm font-black text-slate-700 dark:text-slate-100"><ShieldCheck className="h-4 w-4 text-indigo-500" />操作身份与修订原因</h2>
          <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
            <input data-testid="governance-actor" value={governance.activeActor} onChange={(event) => governance.setActiveActor(event.target.value)} placeholder="操作人员" className={fieldClass} />
            <input value={governance.revisionReason} onChange={(event) => governance.setRevisionReason(event.target.value)} placeholder="修订原因" className={fieldClass} />
          </div>
          <p className="mt-2 text-[10px] leading-4 text-slate-500">完成、复核、归档和修改已锁定成果时记录人员、原因、时间及前后完整性摘要。</p>
        </section>

        <section className={cardClass}>
          <h2 className="mb-2 text-sm font-black text-slate-700 dark:text-slate-100">当前成果状态</h2>
          <div className="grid grid-cols-1 gap-2 min-[360px]:grid-cols-2">
            <article className="rounded-2xl bg-cyan-50/70 p-3 dark:bg-cyan-950/30">
              <strong className="text-xs text-cyan-800 dark:text-cyan-200">测流 · {lifecycleLabel[currentRun.recordStatus]} · 修订 {currentRun.revision}</strong>
              <button type="button" data-testid="flow-lifecycle" disabled={currentRun.recordStatus === 'archived'} onClick={advanceFlowStatus} className="mt-2 min-h-11 w-full rounded-xl bg-cyan-600 px-2 text-xs font-bold text-white disabled:opacity-40">{nextStatusLabel(currentRun.recordStatus)}</button>
            </article>
            <article className="rounded-2xl bg-emerald-50/70 p-3 dark:bg-emerald-950/30">
              <strong className="text-xs text-emerald-800 dark:text-emerald-200">水准 · {lifecycleLabel[currentRoute.completionStatus]} · 修订 {currentRoute.revision}</strong>
              <button type="button" data-testid="leveling-lifecycle" disabled={currentRoute.completionStatus === 'archived'} onClick={advanceLevelingStatus} className="mt-2 min-h-11 w-full rounded-xl bg-emerald-600 px-2 text-xs font-bold text-white disabled:opacity-40">{nextStatusLabel(currentRoute.completionStatus)}</button>
            </article>
          </div>
          <p className="mt-2 text-[10px] leading-4 text-slate-500">成果完成后锁定。再次修改自动创建带父记录 ID 的新修订，不覆盖原成果。</p>
        </section>

        <section className={cardClass}>
          <h2 className="mb-2 text-sm font-black text-slate-700 dark:text-slate-100">仪器档案</h2>
          <div className="grid grid-cols-2 gap-2">
            <select value={draft.kind} onChange={(event) => setDraft({ ...draft, kind: event.target.value as InstrumentKind })} className={fieldClass}>{Object.entries(kindLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
            <select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as InstrumentStatus })} className={fieldClass}>{Object.entries(statusLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
            <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="仪器名称*" className={fieldClass} />
            <input value={draft.model} onChange={(event) => setDraft({ ...draft, model: event.target.value })} placeholder="型号" className={fieldClass} />
            <input value={draft.serialNumber} onChange={(event) => setDraft({ ...draft, serialNumber: event.target.value })} placeholder="出厂/设备编号" className={fieldClass} />
            <input value={draft.certificateNumber} onChange={(event) => setDraft({ ...draft, certificateNumber: event.target.value })} placeholder="检定证书号" className={fieldClass} />
            <label className="text-[10px] text-slate-500">检定日期<input type="date" value={draft.verificationDate} onChange={(event) => setDraft({ ...draft, verificationDate: event.target.value })} className={`${fieldClass} mt-1`} /></label>
            <label className="text-[10px] text-slate-500">有效期至<input type="date" value={draft.validUntil} onChange={(event) => setDraft({ ...draft, validUntil: event.target.value })} className={`${fieldClass} mt-1`} /></label>
            {draft.kind === 'current-meter' && <><input inputMode="decimal" value={draft.k} onChange={(event) => setDraft({ ...draft, k: event.target.value })} placeholder="流速公式 K" className={fieldClass} /><input inputMode="decimal" value={draft.c} onChange={(event) => setDraft({ ...draft, c: event.target.value })} placeholder="流速公式 C" className={fieldClass} /></>}
          </div>
          <button type="button" onClick={addInstrument} className="mt-2 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-3 text-sm font-bold text-white"><Plus className="h-4 w-4" />保存仪器档案</button>

          <div className="mt-3 space-y-2">
            {governance.instruments.map((instrument) => {
              const effective = effectiveInstrumentStatus(instrument);
              const canFlow = instrument.kind === 'current-meter';
              const canLevel = instrument.kind === 'level' || instrument.kind === 'staff';
              return <article key={instrument.id} className="rounded-2xl border border-slate-200/70 bg-white/55 p-2 dark:border-gray-700 dark:bg-gray-900/40">
                <div className="flex min-w-0 items-start justify-between gap-2">
                  <div className="min-w-0"><strong className="block truncate text-xs text-slate-700 dark:text-slate-100">{instrument.name}</strong><span className="text-[10px] text-slate-500">{kindLabel[instrument.kind]} · {instrument.model || '未填型号'} · {statusLabel[effective]}</span></div>
                  {!instrument.id.startsWith('unregistered-') && <button type="button" onClick={() => governance.deleteInstrument(instrument.id)} aria-label={`删除${instrument.name}`} className="flex min-h-11 min-w-11 items-center justify-center rounded-xl text-slate-400 hover:bg-red-50 hover:text-red-500"><Trash2 className="h-4 w-4" /></button>}
                </div>
                <div className="mt-1 grid grid-cols-2 gap-1">
                  {canFlow && <button type="button" onClick={() => chooseInstrument('flow', instrument.id)} className={`min-h-11 rounded-xl px-2 text-xs font-bold ${governance.selectedFlowInstrumentId === instrument.id ? 'bg-cyan-600 text-white' : 'bg-cyan-50 text-cyan-700'}`}>用于测流</button>}
                  {canLevel && <button type="button" onClick={() => chooseInstrument('leveling', instrument.id)} className={`min-h-11 rounded-xl px-2 text-xs font-bold ${governance.selectedLevelingInstrumentId === instrument.id ? 'bg-emerald-600 text-white' : 'bg-emerald-50 text-emerald-700'}`}>用于水准</button>}
                </div>
              </article>;
            })}
          </div>
        </section>

        <section className={cardClass}>
          <h2 className="mb-2 flex items-center gap-2 text-sm font-black text-slate-700 dark:text-slate-100"><FileCheck2 className="h-4 w-4 text-amber-500" />水准规则档案</h2>
          {rules.map((rule) => <article key={rule.id} className="rounded-2xl border border-amber-100 bg-amber-50/70 p-3 text-xs dark:border-amber-900 dark:bg-amber-950/30">
            <strong className="text-amber-800 dark:text-amber-300">{rule.name} · v{rule.version}</strong>
            <p className="mt-1 leading-5 text-amber-700 dark:text-amber-400">{rule.approved ? '已确认' : '待业务专家复核'}。来源：{rule.source}</p>
          </article>)}
        </section>

        <section className={cardClass}>
          <h2 className="mb-2 flex items-center gap-2 text-sm font-black text-slate-700 dark:text-slate-100"><DatabaseBackup className="h-4 w-4 text-blue-500" />完整备份与诊断</h2>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" data-testid="backup-export" onClick={() => void exportFullBackup().then(() => setMessage('完整备份已生成。')).catch((error: unknown) => setMessage(error instanceof Error ? error.message : '备份导出失败'))} className="min-h-11 rounded-xl bg-blue-600 px-2 text-xs font-bold text-white">导出完整备份</button>
            <label className="flex min-h-11 cursor-pointer items-center justify-center rounded-xl bg-white px-2 text-center text-xs font-bold text-blue-700 shadow-sm dark:bg-gray-900 dark:text-blue-300">选择备份恢复<input data-testid="backup-import" type="file" accept="application/json,.json" onChange={readBackup} className="hidden" /></label>
            <button type="button" onClick={() => void previewDiagnostic()} className="min-h-11 rounded-xl bg-slate-100 px-2 text-xs font-bold text-slate-700 dark:bg-gray-900 dark:text-slate-200"><Stethoscope className="mr-1 inline h-4 w-4" />预览诊断</button>
            <button type="button" onClick={() => void exportAppDiagnostic().then(() => setMessage('脱敏诊断已生成。')).catch((error: unknown) => setMessage(error instanceof Error ? error.message : '诊断导出失败'))} className="min-h-11 rounded-xl bg-slate-700 px-2 text-xs font-bold text-white">导出脱敏诊断</button>
          </div>
          {diagnosticPreview && <p className="mt-2 rounded-xl bg-slate-50 px-3 py-2 text-[10px] leading-4 text-slate-600 dark:bg-gray-900 dark:text-slate-300">{diagnosticPreview}</p>}
          {pendingBackup && <div className="mt-2 rounded-2xl border border-red-200 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950/30">
            <p className="text-xs leading-5 text-red-700 dark:text-red-300">备份 v{pendingBackup.appVersion}，{new Date(pendingBackup.exportedAt).toLocaleString()}。将覆盖当前测流、水准、模板、仪器、规则和审计数据。</p>
            <div className="mt-2 grid grid-cols-2 gap-2"><button type="button" onClick={() => setPendingBackup(null)} className="min-h-11 rounded-xl bg-white text-xs font-bold text-slate-600">取消</button><button type="button" data-testid="backup-confirm" onClick={confirmRestore} className="min-h-11 rounded-xl bg-red-600 text-xs font-bold text-white">确认覆盖恢复</button></div>
          </div>}
        </section>

        <section className={cardClass}>
          <h2 className="mb-2 flex items-center gap-2 text-sm font-black text-slate-700 dark:text-slate-100"><Archive className="h-4 w-4 text-emerald-500" />最近成果审计</h2>
          {audits.length === 0 ? <p className="text-xs text-slate-400">暂无审计记录</p> : <div className="space-y-1.5">{audits.map((audit) => <article key={audit.id} className="rounded-xl bg-slate-50/80 p-2 text-[10px] leading-4 text-slate-600 dark:bg-gray-900/60 dark:text-slate-300"><strong>{audit.module} · {audit.action}</strong> · {audit.actor} · {new Date(audit.timestamp).toLocaleString()}<br />原因：{audit.reason}<br /><span className="break-all font-mono text-[9px] text-slate-400">{audit.beforeHash} / {audit.afterHash}</span></article>)}</div>}
        </section>
      </div>
    </main>
  );
}
