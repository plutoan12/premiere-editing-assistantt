// Layer boundaries from the platform spec, enforced in CI. Only boundary rules
// run here; code style is left to each package.
//   packages/*      may not import adapters/* or apps/*
//   packages/core   may not import any other workspace package or a vendor SDK
//   adapters/*      may import @pea/core and engine public APIs only
import tseslint from "typescript-eslint";

const NLE_AND_APP_LAYERS = [
  { group: ["**/adapters/**", "@pea/adapter-*"], message: "Engines and Core may not import adapters." },
  { group: ["**/apps/**", "@pea/app-*", "@pea/sidecar", "@pea/premiere-panel", "@pea/helper"], message: "Engines and Core may not import apps." },
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
  {
    files: ["packages/**/*.ts"],
    languageOptions: { parser: tseslint.parser },
    rules: {
      "no-restricted-imports": ["error", { patterns: NLE_AND_APP_LAYERS }],
    },
  },
  {
    files: ["packages/core/**/*.ts"],
    languageOptions: { parser: tseslint.parser },
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            ...NLE_AND_APP_LAYERS,
            { group: ["@pea/*", "!@pea/core"], message: "Core may not depend on any other workspace package." },
            { group: ["**/packages/*/**", "!**/packages/core/**"], message: "Core may not depend on any other workspace package." },
            { group: VENDOR_SDKS, message: "Provider SDKs may not leak into Core. Depend on capability interfaces instead." },
          ],
        },
      ],
    },
  },
  {
    files: ["adapters/**/*.ts", "apps/**/*.ts"],
    languageOptions: { parser: tseslint.parser },
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["**/packages/*/src/**", "!**/packages/*/src/index.ts"], message: "Adapters and apps may use engine public APIs only." },
          ],
        },
      ],
    },
  },
);
