import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.hydro.geekterminal',
  appName: '水文测验',
  webDir: 'dist',
  plugins: {
    Keyboard: {
      resize: 'body'
    }
  }
};

export default config;
