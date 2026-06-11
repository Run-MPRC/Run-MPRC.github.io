module.exports = {
  env: {
    browser: true,
    es2021: true,
  },
  extends: 'airbnb',
  overrides: [
    {
      env: {
        node: true,
      },
      files: ['.eslintrc.{js,cjs}'],
      parserOptions: {
        sourceType: 'script',
      },
    },
    {
      files: ['*.ts', '*.tsx'],
      extends: ['airbnb-typescript'],
      parserOptions: {
        project: './tsconfig.json',
      },
      rules: {
        // airbnb-typescript v17 enables @typescript-eslint formatting rules
        // that were removed in @typescript-eslint v8 (moved to @stylistic).
        // ESLint emits a "Definition for rule ... was not found" warning per
        // file for each, which fails CI=true CRA builds. All are stylistic;
        // disable them rather than downgrade the toolchain.
        '@typescript-eslint/brace-style': 'off',
        '@typescript-eslint/comma-dangle': 'off',
        '@typescript-eslint/comma-spacing': 'off',
        '@typescript-eslint/func-call-spacing': 'off',
        '@typescript-eslint/indent': 'off',
        '@typescript-eslint/keyword-spacing': 'off',
        '@typescript-eslint/lines-between-class-members': 'off',
        '@typescript-eslint/no-extra-semi': 'off',
        '@typescript-eslint/no-throw-literal': 'off',
        '@typescript-eslint/object-curly-spacing': 'off',
        '@typescript-eslint/quotes': 'off',
        '@typescript-eslint/semi': 'off',
        '@typescript-eslint/space-before-blocks': 'off',
        '@typescript-eslint/space-before-function-paren': 'off',
        '@typescript-eslint/space-infix-ops': 'off',
      },
    },
  ],
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  settings: {
    'import/resolver': {
      node: {
        extensions: ['.js', '.jsx', '.ts', '.tsx'],
      },
    },
  },
  rules: {
    'import/extensions': [
      'warn',
      'ignorePackages',
      {
        js: 'never',
        jsx: 'never',
        ts: 'never',
        tsx: 'never',
      },
    ],
    'react/require-default-props': 'off',
    'no-underscore-dangle': ['warn', { allowAfterThis: true, allow: ['_instance', '_analytics', '_emulatorsConnected'] }],
    'no-console': ['warn', { allow: ['warn', 'error'] }],
    'react/forbid-prop-types': 'off',
  },
  plugins: ['only-warn'],
};
