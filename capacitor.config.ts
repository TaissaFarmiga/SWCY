import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.hydro.geekterminal',
  appName: '水文测验',
  webDir: 'dist',
  plugins: {
    StatusBar: {
      // MainActivity owns system-bar insets for every route.
      overlaysWebView: true,
      style: 'LIGHT'
    },
    Keyboard: {
      resize: 'native'
    }
  }
};

export default config;
