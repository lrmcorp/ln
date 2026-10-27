import type {NextConfig} from 'next';

// tesseract.js starts its own worker thread and WASM core, so it must load from node_modules unbundled.
const nextConfig:NextConfig={serverExternalPackages:['tesseract.js']};

export default nextConfig;
