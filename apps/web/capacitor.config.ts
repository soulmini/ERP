import type { CapacitorConfig } from '@capacitor/cli';

/** Same React build → Android & iOS apps. Build with VITE_API_URL pointing at the live API. */
const config: CapacitorConfig = {
  appId: 'in.rryschool.erp',
  appName: 'RRY School',
  webDir: 'dist',
  android: { allowMixedContent: false },
};

export default config;
