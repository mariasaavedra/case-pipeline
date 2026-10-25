import { fileURLToPath } from "node:url";
import { defineConfig, type Connect, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * /u/<token> is the client upload page (upload.html), a separate entry from the
 * dashboard. nginx does this rewrite in production (apps/web/nginx.conf); this
 * does it for `vite` and `vite preview`.
 */
function clientUploadPage(): Plugin {
  const rewrite: Connect.NextHandleFunction = (req, _res, next) => {
    if (req.url && /^\/u\/[^/?]+\/?(\?.*)?$/.test(req.url)) req.url = "/upload.html";
    next();
  };
  return {
    name: "client-upload-page",
    configureServer: (server) => void server.middlewares.use(rewrite),
    configurePreviewServer: (server) => void server.middlewares.use(rewrite),
  };
}

/**
 * The Content-Security-Policy nginx sends in production (security-headers.conf —
 * keep the two the same). `vite preview` sends it too, so a production build can
 * be checked for violations locally. Not on the dev server: Vite injects inline
 * scripts there (React refresh) that this policy would block.
 */
const CSP_POLICY = "script-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'";

export default defineConfig({
  // Build stamp — baked at image build time (Dockerfile.web passes BUILD_SHA /
  // BUILD_DATE from the CI commit). Lets the running page report exactly which
  // build it is, so "did my deploy land / am I on a stale bundle?" is answerable.
  define: {
    __BUILD_SHA__: JSON.stringify(process.env.BUILD_SHA ?? "dev"),
    __BUILD_DATE__: JSON.stringify(process.env.BUILD_DATE ?? ""),
  },
  plugins: [tailwindcss(), react(), clientUploadPage()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      // Match the API's IPv4 loopback bind (127.0.0.1). Using "localhost" here
      // can resolve to IPv6 ::1 and fail to connect.
      //
      // Overridable so the API can be run on another port when 3000 is taken by
      // something else on the machine. Default is unchanged.
      "/api": process.env.API_PROXY_TARGET ?? "http://127.0.0.1:3000",
    },
  },
  preview: {
    port: 5173,
    proxy: { "/api": process.env.API_PROXY_TARGET ?? "http://127.0.0.1:3000" },
    headers: { "Content-Security-Policy": CSP_POLICY, "X-Content-Type-Options": "nosniff" },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      // Two pages: the dashboard, and the client upload page (/u/<token>), which
      // must never pull in the dashboard's code.
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        upload: fileURLToPath(new URL("./upload.html", import.meta.url)),
      },
      output: {
        // Split the vendors out of the app chunk. Two reasons: the app shipped as
        // a single ~700 KB file, and every one-line change to our own code
        // invalidated React and MSAL along with it. MSAL alone is ~240 KB and
        // cannot be lazy-loaded — AuthProvider needs it on boot to restore the
        // session — but as its own chunk it stays cached across deploys.
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("@azure")) return "vendor-msal";
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return "vendor-react";
          return "vendor";
        },
      },
    },
  },
});
