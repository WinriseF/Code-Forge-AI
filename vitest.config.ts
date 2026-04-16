import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  assetsInclude: ['**/*.lottie'],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    setupFiles: ['tests/setup.ts'],
    clearMocks: true,
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      include: [
        'src/App.tsx',
        'src/lib/**/*.{ts,tsx}',
        'src/store/**/*.{ts,tsx}',
        'src/components/layout/TitleBar.tsx',
        'src/components/layout/WorkspaceSwitcher.tsx',
        'src/components/layout/ViewSwitcher.tsx',
        'src/components/settings/SettingsNav.tsx',
        'src/components/settings/SettingsUi.tsx',
        'src/components/settings/SettingsView.tsx',
        'src/components/settings/sections/GeneralSection.tsx',
        'src/components/settings/sections/SearchWorkspaceSection.tsx',
        'src/components/ui/ShortcutInput.tsx',
      ],
      exclude: [
        'src/vite-env.d.ts',
        'src/main.tsx',
        'src/**/__mocks__/**',
        // Integration-heavy adapters are validated in end-to-end/runtime flows, not frontend unit tests.
        'src/lib/agent/**',
        'src/lib/llm.ts',
        'src/lib/command_executor.ts',
        'tests/**',
      ],
      reporter: ['text', 'json-summary', 'lcov'],
      reportsDirectory: 'coverage',
      thresholds: {
        lines: 70,
        functions: 70,
        statements: 70,
        branches: 70,
      },
    },
  },
});
