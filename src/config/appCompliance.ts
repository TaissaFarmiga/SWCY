function configured(value: string | undefined, fallback: string): string {
  return value?.trim() || fallback;
}

const operatorName = import.meta.env.VITE_APP_OPERATOR_NAME?.trim();
const supportContact = import.meta.env.VITE_APP_SUPPORT_CONTACT?.trim();
const privacyUrl = import.meta.env.VITE_APP_PRIVACY_URL?.trim();
const privacyEffectiveDate = import.meta.env.VITE_APP_PRIVACY_EFFECTIVE_DATE?.trim();
const appFilingNumber = import.meta.env.VITE_APP_FILING_NUMBER?.trim();

/**
 * 上架主体字段只接受构建环境注入，禁止把个人联系方式或证照写进仓库。
 * Store Release脚本会在正式构建前强制检查必填项。
 */
export const APP_COMPLIANCE = {
  operatorName: configured(operatorName, '内部部署版本（正式运营主体待配置）'),
  supportContact: configured(supportContact, '请联系软件交付方或本单位系统管理员'),
  privacyUrl: privacyUrl || '',
  effectiveDate: configured(privacyEffectiveDate, '2026-07-29'),
  appFilingNumber: appFilingNumber || '',
  icpFilingNumber: import.meta.env.VITE_ICP_FILING_NUMBER?.trim() || '',
  storeReady: Boolean(
    operatorName
    && supportContact
    && privacyUrl
    && /^https:\/\//i.test(privacyUrl)
    && privacyEffectiveDate
    && appFilingNumber
  ),
} as const;
