import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  // Build stamp — baked at image build time (Dockerfile.web passes BUILD_SHA /
  // BUILD_DATE from the CI commit). Lets the running page report exactly which
  // build it is, so "did my deploy land / am I on a stale bundle?" is answerable.
  define: {
    __BUILD_SHA__: JSON.stringify(process.env.BUILD_SHA ?? "dev"),
    __BUILD_DATE__: JSON.stringify(process.env.BUILD_DATE ?? ""),
  },
  plugins: [tailwindcss(), react()],
  server: {
    port: 5173,
    proxy: {
      // Match the API's IPv4 loopback bind (127.0.0.1). Using "localhost" here
      // can resolve to IPv6 ::1 and fail to connect.
      "/api": "http://127.0.0.1:3000",
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
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
