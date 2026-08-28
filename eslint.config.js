// =============================================================================
// ESLint — report mode
// =============================================================================
// Introduced over a codebase that was already ~50k LOC with no linter, so the
// goal here is a RATCHET, not a cleanup: catch real defects on new code and
// stop the existing pile from growing. Deliberately excluded:
//
//   - Stylistic rules. Formatting is not a defect and churns every diff.
//   - Type-aware rules (projectService). They are the valuable ones, but they
//     need a full type build per lint and would bury the signal on day one.
//     Worth turning on later, one rule at a time.
//
// Rules that would flag a lot of existing, working code are set to "warn" so
// `npm run lint` exits 0 today. `npm run lint:strict` fails on warnings — that
// is the one CI would eventually gate on, once the warning count is at zero.
// =============================================================================

import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default tseslint.config(
  {
    // Build output, deps, and generated data are not ours to lint.
    ignores: [
      "**/node_modules/**",
      ".claude/**", // git worktrees: a second copy of the whole repo
      "**/dist/**",
      "**/build/**",
      "data/**",
      "output/**",
      "templates/**",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  // ---------------------------------------------------------------------------
  // All TypeScript
  // ---------------------------------------------------------------------------
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.node },
    },
    rules: {
      // `any` defeats the type system — the main thing worth ratcheting here.
      // Warn (not error): there are existing uses, and each needs a real type,
      // not a mechanical fix.
      "@typescript-eslint/no-explicit-any": "warn",

      // An unused variable is either dead code or a bug (a value someone meant
      // to use). Leading-underscore is the escape hatch, already the
      // convention in this repo (`_req`, `_next`).
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],

      // Real defects — these are errors from day one because they are never
      // intentional and there are none today.
      "no-await-in-loop": "off", // sequential Monday.com calls are deliberate (rate limits)
      "@typescript-eslint/no-floating-promises": "off", // needs type info; revisit
      "no-constant-condition": ["error", { checkLoops: false }],
      "no-fallthrough": "error",
      "no-self-compare": "error",
      "no-unmodified-loop-condition": "error",
      "no-unreachable-loop": "error",
      "require-atomic-updates": "off", // too many false positives on Express handlers
      eqeqeq: ["error", "always", { null: "ignore" }], // `== null` catches undefined too

      // --- Adjusted after the first run over the existing codebase ---------
      // Each of these fired on an idiom this repo uses deliberately. Silencing
      // the rule is right where the idiom is correct; where the finding is
      // real but the fix is a code change, it drops to "warn" so it stays
      // visible without blocking.

      // `catch {}` is deliberate throughout: localStorage in a locked-down
      // browser, a non-JSON error body. The empty block IS the handling.
      "no-empty": ["error", { allowEmptyCatch: true }],

      // Three files strip Monday's BOM with `.replace(/\uFEFF/g, "")`. The
      // irregular character inside that regex is the entire point of the line.
      "no-irregular-whitespace": ["error", { skipRegExps: true }],

      // `declare global { namespace Express }` is the documented way to
      // augment Express's Request type (auth/middleware.ts).
      "@typescript-eslint/no-namespace": ["error", { allowDeclarations: true }],

      // seeder.ts optionally require()s a gitignored PII fixture. Both rules
      // are correct in the abstract and wrong here: @ts-expect-error would
      // itself error when the fixture DOES exist, and the require() works
      // because seeding only ever runs through tsx, which shims it. Warn
      // rather than error — it is a real coupling to tsx, just not a bug.
      "@typescript-eslint/ban-ts-comment": "warn",
      "@typescript-eslint/no-require-imports": "warn",
      // differ.ts declares a `const` in a braceless `case` — the binding leaks
      // to sibling cases. True defect, one site, trivial fix.
      "no-case-declarations": "warn",
    },
  },

  // ---------------------------------------------------------------------------
  // Web (browser + React)
  // ---------------------------------------------------------------------------
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      // The single highest-value React rule: a wrong dependency array is a
      // stale-closure bug that renders fine and misbehaves later.
      ...reactHooks.configs.recommended.rules,
      // Warn, not error: the existing hits are real (a useMemo that recomputes
      // every render, a useEffect missing four deps) but each needs a judged
      // fix, not a mechanical one. Turning the linter on must not mean
      // rewriting hooks the same day.
      "react-hooks/exhaustive-deps": "warn",
    },
  },

  // ---------------------------------------------------------------------------
  // Tests — looser, on purpose
  // ---------------------------------------------------------------------------
  {
    files: ["**/*.test.{ts,tsx}"],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      // Casting a partial fixture to a full type is normal in test setup.
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
);
