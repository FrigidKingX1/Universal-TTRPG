import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "src-tauri/target/**", "target/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // The codebase deliberately uses exhaustive-deps-violating prop-sync
      // effects (sheet fields resync when the profile prop changes).
      "react-hooks/exhaustive-deps": "off",
      // Same family: several components intentionally mirror store/prop
      // state into local state inside effects.
      "react-hooks/set-state-in-effect": "off",
      // React 19.1 lacks a stable useEffectEvent; the classic "latest-ref"
      // idiom (ref.current = fn inside an effect) is our sanctioned escape
      // hatch until then.
      "react-hooks/refs": "off",
      "react-hooks/immutability": "off",
      // @tanstack/react-virtual's useVirtualizer is flagged as incompatible
      // with the compiler; it is a well-behaved external hook here.
      "react-hooks/incompatible-library": "off",
      // Domain code passes Tauri payloads around; tightening this is a
      // larger refactor tracked separately.
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
);
