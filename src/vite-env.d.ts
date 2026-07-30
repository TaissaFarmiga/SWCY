/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  readonly VITE_APP_OPERATOR_NAME?: string;
  readonly VITE_APP_SUPPORT_CONTACT?: string;
  readonly VITE_APP_PRIVACY_URL?: string;
  readonly VITE_APP_PRIVACY_EFFECTIVE_DATE?: string;
  readonly VITE_APP_FILING_NUMBER?: string;
  readonly VITE_ICP_FILING_NUMBER?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
