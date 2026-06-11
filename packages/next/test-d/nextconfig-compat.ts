// Compile-time fixture for #64: Next's official NextConfig must flow through
// withShortwind()(…) without a cast — including `webpack: null`, which Next's
// type allows and the plugin's former local NextConfig type rejected. Checked
// by `pnpm typecheck` (tsconfig.typetest.json); never executed.
import type { NextConfig } from "next";
import { withShortwind } from "../src/index.js";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  webpack: null,
  turbopack: {
    rules: { "*.svg": { loaders: ["@svgr/webpack"] } },
  },
};

// Both directions matter: the wrapper accepts the official config, and what it
// returns satisfies next.config.ts's expected export type.
export const wrapped: NextConfig = withShortwind()(nextConfig);
