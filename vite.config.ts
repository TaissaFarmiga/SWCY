import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// VitePWA 已禁用：在 Capacitor WebView 中 SW 会劫持主文档路由，阻断 Native shouldInterceptRequest
// import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    // VitePWA 已禁用
  ],
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
});
