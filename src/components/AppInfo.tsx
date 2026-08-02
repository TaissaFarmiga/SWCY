import { useEffect } from 'react';
import { BookOpen, ChevronLeft, FileText, HelpCircle, Info, MapPin, ShieldCheck, Smartphone } from 'lucide-react';
import { APP_COMPLIANCE } from '../config/appCompliance';

const cardClass = 'rounded-3xl border border-white/80 bg-white/70 p-4 shadow-[0_8px_28px_rgba(0,0,0,0.05)] backdrop-blur-xl dark:border-gray-700/80 dark:bg-gray-800/65';

function SectionTitle({ icon, title }: { icon: React.ReactNode; title: string }) {
  return <h2 className="mb-3 flex items-center gap-2 text-base font-black text-slate-800 dark:text-slate-100">{icon}{title}</h2>;
}

function jumpTo(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export function AppInfo({ onBack }: { onBack: () => void }) {
  useEffect(() => {
    const handleBack = (event: Event) => {
      event.preventDefault();
      onBack();
    };
    window.addEventListener('hydro-app-back', handleBack);
    return () => window.removeEventListener('hydro-app-back', handleBack);
  }, [onBack]);

  return (
    <main data-testid="app-info-screen" className="app-safe-screen mx-auto min-h-[100dvh] w-full max-w-xl overflow-x-hidden px-3 pb-safe min-[360px]:px-5">
      <header className="sticky top-0 z-20 -mx-1 flex min-h-14 items-center gap-2 bg-[#F2F2F7]/90 px-1 backdrop-blur-xl dark:bg-gray-950/90">
        <button type="button" onClick={onBack} aria-label="返回首页" className="flex min-h-11 min-w-11 items-center justify-center rounded-2xl text-slate-600 active:bg-white/70 dark:text-slate-200 dark:active:bg-gray-800"><ChevronLeft className="h-6 w-6" /></button>
        <div><h1 className="text-lg font-black text-slate-800 dark:text-slate-100">帮助与关于</h1><p className="text-[10px] text-slate-400">使用说明、隐私与版本信息</p></div>
      </header>

      <nav aria-label="页面目录" className="grid grid-cols-4 gap-2 py-3">
        {[
          ['help', '帮助', <HelpCircle className="h-4 w-4" />],
          ['privacy', '隐私', <ShieldCheck className="h-4 w-4" />],
          ['agreement', '协议', <FileText className="h-4 w-4" />],
          ['about', '关于', <Info className="h-4 w-4" />],
        ].map(([id, label, icon]) => <button key={String(id)} type="button" onClick={() => jumpTo(String(id))} className="flex min-h-11 min-w-0 items-center justify-center gap-1 rounded-xl bg-white/70 px-1 text-xs font-bold text-slate-600 shadow-sm dark:bg-gray-800 dark:text-slate-200">{icon}{label}</button>)}
      </nav>

      <div className="space-y-3 pb-8 text-[13px] leading-6 text-slate-600 dark:text-slate-300">
        <section id="help" data-testid="help-section" className={`${cardClass} scroll-mt-16`}>
          <SectionTitle icon={<BookOpen className="h-5 w-5 text-blue-500" />} title="使用帮助" />
          <ol className="list-decimal space-y-2 pl-5">
            <li>新建测流或水准任务，按现场记录依次录入测点、读数和必要元数据。</li>
            <li>录入后查看实时校核。出现缺失、断链或超限时先处理提示，再完成并锁定成果。</li>
            <li>重要任务完成后导出Excel；需要跨设备转移时使用对应页面的JSON导入、导出。</li>
            <li>水准测站GPS仅在点击定位建站时请求。拒绝权限后自动降级为无坐标建站，不影响读数录入。</li>
            <li>电子气泡仅作辅助校准。设备不支持、权限拒绝或无传感器数据时不会生成模拟读数。</li>
          </ol>
          <p className="mt-3 rounded-xl bg-blue-50 px-3 py-2 text-xs text-blue-700 dark:bg-blue-950/30 dark:text-blue-300">故障处理：先从对应业务页面导出Excel或JSON，再联系支持人员。不要在未导出数据时清除应用数据或卸载。</p>
        </section>

        <section id="privacy" data-testid="privacy-section" className={`${cardClass} scroll-mt-16`}>
          <SectionTitle icon={<ShieldCheck className="h-5 w-5 text-emerald-500" />} title="隐私政策摘要" />
          <p>生效日期：{APP_COMPLIANCE.effectiveDate}。运营主体：{APP_COMPLIANCE.operatorName}。</p>
          <h3 className="mt-3 font-bold text-slate-700 dark:text-slate-100">处理的数据</h3>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            <li>用户主动录入的测流、水准、测点、人员、备注和成果数据。</li>
            <li><MapPin className="mr-1 inline h-3.5 w-3.5" />用户点击定位建站时取得的前台位置；不进行后台或持续定位。</li>
            <li>电子气泡页面打开期间的方向和运动传感器数据；仅用于本机显示，不保存原始传感器流。</li>
            <li>版本检查访问GitHub Release时产生的网络请求；应用不接入广告、用户画像或第三方统计SDK。</li>
          </ul>
          <h3 className="mt-3 font-bold text-slate-700 dark:text-slate-100">存储、共享与期限</h3>
          <p>业务数据默认保存在本机。只有用户主动导出Excel或JSON时才进入系统分享流程。数据保留至用户删除、导入覆盖、清除应用数据或卸载；应用不自动上传业务成果。</p>
          <h3 className="mt-3 font-bold text-slate-700 dark:text-slate-100">权限与选择</h3>
          <p>网络用于版本查询和用户发起的更新；网络状态用于运行判断；前台位置用于GPS测站。定位可拒绝，核心手工测量仍可使用。用户可在系统设置撤回权限，并可在应用内查看、导出、删除业务数据。</p>
          <p className="mt-3">隐私咨询或权利请求：{APP_COMPLIANCE.supportContact}{APP_COMPLIANCE.privacyUrl ? <>；完整政策：<a className="break-all font-semibold text-blue-600 underline" href={APP_COMPLIANCE.privacyUrl} target="_blank" rel="noreferrer">{APP_COMPLIANCE.privacyUrl}</a></> : null}。</p>
        </section>

        <section id="agreement" data-testid="agreement-section" className={`${cardClass} scroll-mt-16`}>
          <SectionTitle icon={<FileText className="h-5 w-5 text-indigo-500" />} title="用户协议摘要" />
          <ul className="list-disc space-y-1 pl-5">
            <li>本应用用于水文外业记录、计算、校核和成果整理，不替代现行国家、行业及单位规程。</li>
            <li>用户应确保输入、仪器检定、规则参数和复核流程真实有效；超限或数据不完整成果不得直接作为正式结论。</li>
            <li>成果归档前应完成业务复核并导出留存。因误输入、错误参数、未导出或设备损坏导致的风险应按单位制度处置。</li>
            <li>不得利用应用处理无权访问的数据、破坏更新校验或传播恶意文件。</li>
            <li>版本升级可能调整数据结构；应用提供自动迁移能力，重大升级前仍应主动导出业务JSON或Excel。</li>
          </ul>
        </section>

        <section id="about" data-testid="about-section" className={`${cardClass} scroll-mt-16`}>
          <SectionTitle icon={<Smartphone className="h-5 w-5 text-cyan-500" />} title="关于应用" />
          <dl className="grid grid-cols-[6rem_1fr] gap-x-2 gap-y-1">
            <dt>应用名称</dt><dd className="font-semibold text-slate-700 dark:text-slate-100">水文测验终端</dd>
            <dt>版本</dt><dd className="font-mono">v{__APP_VERSION__}</dd>
            <dt>技术形态</dt><dd>PWA / Android Capacitor</dd>
            <dt>运营主体</dt><dd>{APP_COMPLIANCE.operatorName}</dd>
            <dt>支持渠道</dt><dd>{APP_COMPLIANCE.supportContact}</dd>
            <dt>应用备案</dt><dd>{APP_COMPLIANCE.appFilingNumber || '内部部署阶段，正式上架前配置'}</dd>
            <dt>ICP备案</dt><dd>{APP_COMPLIANCE.icpFilingNumber || '如公开网站适用，正式上线前配置'}</dd>
          </dl>
          {!APP_COMPLIANCE.storeReady && <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">当前为内部部署配置。正式Store Release会强制检查运营主体、支持渠道、HTTPS隐私政策、生效日期、应用备案号和正式签名。</p>}
        </section>
      </div>
    </main>
  );
}
