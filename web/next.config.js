/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  reactStrictMode: true,
  experimental: {
    serverComponentsExternalPackages: [
      "@prisma/client",
      "bcryptjs",
      "nodemailer",
      "pdfkit",
      // v4.7.9 — web-push pulls in https-proxy-agent / agent-base which
      // use Node's net/http/https builtins. Next's edge bundler can't
      // resolve those, so externalise the whole package.
      "web-push",
      // v4.7.8 — adm-zip walks the filesystem at zip-build time; same
      // story (uses Node fs/path APIs).
      "adm-zip",
    ],
    // Runs src/instrumentation.ts on server boot — used to start the
    // reminder scheduler.
    instrumentationHook: true,
    // pdfkit reads its Helvetica .afm font files from its own package at
    // runtime via fs.readFileSync. Next's standalone tracer doesn't always
    // pick those up, so we force-include the data folder in the output.
    outputFileTracingIncludes: {
      "/api/maintenance/**": ["./node_modules/pdfkit/js/data/**"],
    },
  },
  // Instrumentation.ts is compiled for both Node and Edge runtimes, and
  // webpack follows its import graph into nodemailer / pdfkit — which pull
  // in Node builtins (`stream`, `fs`, `crypto`) that the Edge build can't
  // resolve. Marking them as externals leaves those imports as plain
  // `require(...)` calls that only execute on the Node server, where the
  // modules really exist.
  webpack: (config, { isServer, nextRuntime }) => {
    if (isServer) {
      const NODE_ONLY = ["nodemailer", "pdfkit", "web-push", "adm-zip"];
      const existing = Array.isArray(config.externals)
        ? config.externals
        : config.externals
          ? [config.externals]
          : [];
      config.externals = [
        ...existing,
        ({ request }, callback) => {
          if (
            request &&
            NODE_ONLY.some(
              (name) => request === name || request.startsWith(`${name}/`),
            )
          ) {
            return callback(null, `commonjs ${request}`);
          }
          return callback();
        },
      ];
    }

    // v4.7.11 — instrumentation.ts gets compiled for BOTH the Node and
    // Edge runtimes. Even though the dynamic import of
    // lib/reminder-scheduler is gated on `process.env.NEXT_RUNTIME ===
    // 'nodejs'`, webpack still statically walks the import graph for the
    // Edge bundle and fails when it reaches `net` / `http` / `https` /
    // `tls` etc. inside web-push's transitive deps (agent-base,
    // https-proxy-agent). Tell webpack those modules just resolve to
    // nothing on the Edge runtime — the code paths that would use them
    // are unreachable at execution time on Edge thanks to the runtime
    // guard. Belt-and-braces alongside the dynamic-import refactor in
    // reminder-scheduler.ts.
    if (nextRuntime === "edge") {
      config.resolve = config.resolve || {};
      config.resolve.fallback = {
        ...(config.resolve.fallback || {}),
        net: false,
        http: false,
        https: false,
        tls: false,
        fs: false,
        crypto: false,
        stream: false,
        zlib: false,
        url: false,
        dns: false,
        child_process: false,
        os: false,
        path: false,
        util: false,
        querystring: false,
      };
    }
    return config;
  },
};
module.exports = nextConfig;
