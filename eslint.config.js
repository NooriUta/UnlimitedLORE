import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

// Minimal, intentionally narrow lint config. It does NOT turn on the full
// recommended rulesets (the codebase predates linting and would drown in
// findings); it enforces one design-system guardrail and parses TS/TSX so the
// rule can be expanded later.
export default tseslint.config(
  {
    ignores: ['dist', 'node_modules', 'mcp-server', 'backend', '**/*.css'],
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    // Registered so the existing `// eslint-disable react-hooks/*` directives
    // resolve; the rules themselves are surfaced as warnings, not errors.
    plugins: { 'react-hooks': reactHooks, '@typescript-eslint': tseslint.plugin },
    rules: {
      'react-hooks/rules-of-hooks': 'warn',
      'react-hooks/exhaustive-deps': 'warn',
      // Known but not enforced — the codebase has a few justified `any`s with
      // inline disables; registering the rule keeps those directives valid.
      '@typescript-eslint/no-explicit-any': 'off',
      // Design-system guardrail: prefer tokens (var(--…), tokens.css) over
      // hard-coded hex colors. Warn-only for now — there is a legacy backlog of
      // ~167 inline hexes (task B6 migrates them incrementally); ratchet this to
      // 'error' once that backlog is cleared.
      'no-restricted-syntax': ['warn', {
        selector: 'Literal[value=/^#(?:[0-9a-fA-F]{3,4}){1,2}$/]',
        message: 'Hard-coded hex color — use a design token var(--…) from tokens.css instead.',
      }],
    },
  },
);
