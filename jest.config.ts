import type { Config } from "jest";

const config: Config = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  testMatch: ["**/__tests__/**/*.test.ts", "**/*.test.ts"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        tsconfig: {
          // Override to use commonjs for Jest
          module: "commonjs",
          moduleResolution: "node",
          target: "ES2017",
          esModuleInterop: true,
          strict: true,
          paths: { "@/*": ["./src/*"] },
        },
      },
    ],
  },
  // Don't transform node_modules except for ESM-only packages
  transformIgnorePatterns: ["/node_modules/(?!(chokidar|simple-git)/)"],
  // Auto-mock fs to avoid hitting real filesystem in unit tests
  // (we'll use real fs for integration tests with temp dirs)
  collectCoverageFrom: [
    "src/lib/env-manager.ts",
    "src/lib/fs-watcher.ts",
    "src/lib/git-manager.ts",
    "src/app/api/sessions/history/**/*.ts",
    "src/app/api/env/**/*.ts",
  ],
};

export default config;
