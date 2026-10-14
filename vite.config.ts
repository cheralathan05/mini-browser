import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const rendererRoot = path.resolve(__dirname, "src/renderer");

export default defineConfig({
  root: rendererRoot,
  // Electron production windows load renderer HTML via file:// URLs.
  // Relative asset URLs keep the React shell working after packaging.
  base: "./",
  plugins: [tailwindcss(), react()],
  resolve: {
    alias: {
      "@": rendererRoot,
    },
  },
  build: {
    outDir: path.resolve(__dirname, "dist-renderer"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: path.resolve(rendererRoot, "index.html"),
        pageSearch: path.resolve(rendererRoot, "page-search.html"),
        aiSidebar: path.resolve(rendererRoot, "ai-sidebar.html"),
        home: path.resolve(rendererRoot, "home.html"),
        agent: path.resolve(rendererRoot, "agent.html"),
        search: path.resolve(rendererRoot, "search.html"),
        tasks: path.resolve(rendererRoot, "tasks.html"),
        settings: path.resolve(rendererRoot, "settings.html"),
        learning: path.resolve(rendererRoot, "learning.html"),
        bookmarks: path.resolve(rendererRoot, "bookmarks.html"),
        history: path.resolve(rendererRoot, "history.html"),
        downloads: path.resolve(rendererRoot, "downloads.html"),
        workspace: path.resolve(rendererRoot, "workspace.html"),
        extensions: path.resolve(rendererRoot, "extensions.html"),
        userScripts: path.resolve(rendererRoot, "user-scripts.html"),
        widgets: path.resolve(rendererRoot, "widgets.html"),
        widgetRuntime: path.resolve(rendererRoot, "widget-runtime.html"),
        renderPreview: path.resolve(rendererRoot, "render-preview.html"),
        workspaceCreate: path.resolve(rendererRoot, "workspace-create.html"),
        folderSettings: path.resolve(rendererRoot, "folder-settings.html"),
      },
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5188,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8001",
        changeOrigin: true,
      },
      "/ws": {
        target: "ws://127.0.0.1:8001",
        ws: true,
      },
    },
  },
});

