import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.hydro.geekterminal',
  appName: '水文测验',
  webDir: 'dist',
  plugins: {
    SystemBars: {
      insetsHandling: 'css',
      style: 'LIGHT',
      hidden: false
    },
    StatusBar: {
      // Android <= 14 must keep the WebView below the status bar. Android 15+
      // uses the SystemBars safe-area CSS variables above.
      overlaysWebView: false,
      style: 'LIGHT'
    },
    Keyboard: {
      resize: 'native'
    }
  }
};

export default config;
