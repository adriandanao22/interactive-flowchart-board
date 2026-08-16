import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The board fills the viewport, so the floating dev badge always sits on top
  // of a control — bottom-left it covers the palette and the example preview's
  // Step button, and it intercepts the clicks rather than just hiding them.
  // Compile and runtime errors are still surfaced with this off.
  devIndicators: false,
};

export default nextConfig;
