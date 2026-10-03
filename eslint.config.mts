import obsidianmd from 'eslint-plugin-obsidianmd';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'main.js',
      'node_modules/**',
      // Worktrees checked out inside the repo hold a second copy of the source
      // that is not covered by this project's tsconfig, which makes the
      // type-aware rules fail to load.
      '.claude/**',
      '.obsidian-cache/**',
      'test/screenshots/**',
    ],
  },
  ...tseslint.configs.recommended,
  ...obsidianmd.configs.recommended,
  {
    // obsidianmd's recommended set includes type-aware rules, which only work
    // for files covered by tsconfig.json.
    files: ['src/**/*.ts', 'test/**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // Build scripts and the wdio config live outside tsconfig's include.
    // disableTypeChecked only knows about typescript-eslint's own rules, so
    // obsidianmd's typed rules need turning off here too.
    files: ['**/*.mjs', '**/*.mts'],
    extends: [tseslint.configs.disableTypeChecked],
    rules: {
      'obsidianmd/no-plugin-as-component': 'off',
      'obsidianmd/no-view-references-in-plugin': 'off',
      'obsidianmd/no-unsupported-api': 'off',
      'obsidianmd/prefer-create-el': 'off',
      'obsidianmd/prefer-file-manager-trash-file': 'off',
      'obsidianmd/prefer-instanceof': 'off',
      // These build/test-tooling scripts run under Node, not inside
      // Obsidian's mobile-compatible sandbox.
      'obsidianmd/no-nodejs-modules': 'off',
      'obsidianmd/rule-custom-message': 'off',
    },
  },
  {
    // TypeScript already resolves globals; core no-undef doesn't know about
    // Obsidian's DOM helpers (createDiv, activeWindow, ...) or ambient types.
    files: ['**/*.ts', '**/*.mts'],
    rules: { 'no-undef': 'off' },
  },
  {
    files: ['**/*.mjs'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    // e2e tests reach into Obsidian internals that aren't in the public
    // typings -- app.plugins, app.setting -- so the values genuinely are `any`.
    // Unit tests and the fixture server run under Node, not inside Obsidian.
    files: ['test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      'import/no-nodejs-modules': 'off',
      'obsidianmd/no-nodejs-modules': 'off',
      'obsidianmd/no-global-this': 'off',
      'obsidianmd/prefer-window-timers': 'off',
      // The screenshot capture restyles the settings pane to frame the image
      // and composes it on a throwaway canvas: not shipped plugin code, so
      // the theming and element-creation rules don't apply.
      'obsidianmd/no-static-styles-assignment': 'off',
      'obsidianmd/prefer-create-el': 'off',
    },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { args: 'none' }],
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      'no-prototype-builtins': 'off',
    },
  }
);
