import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // SSE 长连接需要关闭压缩缓冲，确保流式输出即时到达
  experimental: {},
};

export default nextConfig;
