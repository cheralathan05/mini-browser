// NEXUS - Dynamic Environment & API Configuration

/**
 * Returns the base API URL.
 * In a browser (e.g. deployed on Render, Docker, or local web host),
 * it dynamically uses window.location.origin so all requests stay same-origin,
 * eliminating CORS issues, mixed-content security blocks, and hardcoded localhost failures.
 * In Electron desktop windows (file:// protocol), it falls back to http://127.0.0.1:8001.
 */
export function getApiBase(): string {
  if (typeof window !== "undefined" && !window.location.protocol.startsWith("file")) {
    const envApi = import.meta.env.VITE_NEXUS_API_URL;
    if (envApi && !envApi.includes("127.0.0.1") && !envApi.includes("localhost")) {
      return envApi.replace(/\/+$/, "");
    }
    return window.location.origin;
  }
  const envApi = import.meta.env.VITE_NEXUS_API_URL;
  return (envApi && envApi.trim()) || "http://127.0.0.1:8001";
}

/**
 * Returns the WebSocket URL.
 * In a browser, it uses the current host with wss: (for https:) or ws: (for http:).
 * In Electron desktop windows, it falls back to ws://127.0.0.1:8001.
 */
export function getWsUrl(): string {
  if (typeof window !== "undefined" && !window.location.protocol.startsWith("file")) {
    const envWs = import.meta.env.VITE_NEXUS_WS_URL;
    if (envWs && !envWs.includes("127.0.0.1") && !envWs.includes("localhost")) {
      return envWs.replace(/\/+$/, "");
    }
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${window.location.host}`;
  }
  const envWs = import.meta.env.VITE_NEXUS_WS_URL;
  return (envWs && envWs.trim()) || "ws://127.0.0.1:8001";
}
