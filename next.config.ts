import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The incident routes read data/sample-incident/* from the filesystem at
  // runtime (fs.readFile). Next's output file tracing does NOT auto-include
  // files that are only read at runtime, so on Vercel the serverless function
  // would 500 with ENOENT. Explicitly include them in the trace.
  outputFileTracingIncludes: {
    "/api/incident/stream": ["./data/sample-incident/**/*"],
    "/api/incident/live": ["./data/sample-incident/**/*"],
    "/api/baseline": ["./data/sample-incident/**/*"],
    "/api/run-chain": ["./data/sample-incident/**/*"],
  },
};

export default nextConfig;
