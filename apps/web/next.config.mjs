/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config) => {
    // konva's node entry requires the optional `canvas` package when
    // bundled server-side; the editor only ever runs in the browser
    // (dynamic import, ssr:false), so externalize it.
    config.externals = [...config.externals, { canvas: "canvas" }];
    return config;
  },
};

export default nextConfig;
