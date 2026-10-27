// Layer boundaries from the platform spec, enforced in CI.
//   packages/*      may not import adapters/* or apps/*
//   packages/core   may not import any other workspace package or a vendor SDK
//   adapters/*      may import @pea/core and engine public APIs only
import js from "@eslint/js";
import tseslint from "typescript-eslint";

const NLE_AND_APP_LAYERS = [
  { group: ["**/adapters/**", "@pea/adapter-*"], message: "Engines and Core may not import adapters." },
  { group: ["**/apps/**", "@pea/app-*", "@pea/sidecar", "@pea/premiere-panel"], message: "Engines and Core may not import apps." },
];

const VENDOR_SDKS = [
  "openai",
  "@anthropic-ai/*",
  "@google/generative-ai",
  "@google-cloud/*",
  "@aws-sdk/*",
  "@azure/*",
  "@deepgram/*",
  "assemblyai",
  "deepl-node",
  "@mistralai/*",
  "fluent-ffmpeg",
  "premierepro",
  "uxp",
];

export default tseslint.config(
  {
    ignores: ["**/node_modules/**", "**/dist/**", "**/build/**", "**/coverage/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_", ignoreRestSiblings: true },
      ],
    },
  },
  {
    files: ["packages/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: NLE_AND_APP_LAYERS }],
    },
  },
  {
    files: ["packages/core/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            ...NLE_AND_APP_LAYERS,
            {
              group: ["@pea/*", "!@pea/core"],
              message: "Core may not depend on any other workspace package.",
            },
            {
              group: ["**/packages/*/**", "!**/packages/core/**"],
              message: "Core may not depend on any other workspace package.",
            },
            {
              group: VENDOR_SDKS,
              message: "Provider SDKs may not leak into Core. Depend on capability interfaces instead.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["adapters/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["**/apps/**"], message: "Adapters may not import apps." },
            { group: ["**/packages/*/src/**", "!**/packages/*/src/index.ts"], message: "Adapters may use engine public APIs only." },
          ],
        },
      ],
    },
  },
);
