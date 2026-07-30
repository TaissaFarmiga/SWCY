import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.hydro.geekterminal',
  appName: '水文测验',
  webDir: 'dist',
  plugins: {
    StatusBar: {
      // Android 16 forces edge-to-edge. Native WindowInsets keep controls safe.
      // This setting preserves the same layout model on older Android versions.
      overlaysWebView: true,
      style: 'LIGHT'
    },
    Keyboard: {
      resize: 'body'
    }
  }
};

export default config;
