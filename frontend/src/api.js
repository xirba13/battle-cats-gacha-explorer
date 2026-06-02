// Thin fetch wrapper around the stateless backend API.
//
// API base: empty by default, so calls are same-origin ("/api/...") — which is
// what the Vite dev proxy and a single-origin reverse-proxy deploy both want.
// For split hosting (static frontend on one host, backend on another), set
// VITE_API_BASE at build time, e.g.:
//   VITE_API_BASE=https://api.example.com pnpm build
// (CORS is open on the backend, so cross-origin calls work.)
const BASE = (import.meta.env.VITE_API_BASE || "").replace(/\/$/, "");

async function req(method, path, body) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${path}`, opts);
  if (!res.ok) {
    let detail = res.statusText;
    try {
      detail = (await res.json()).detail || detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  return res.json();
}

export const api = {
  master: () => req("GET", "/api/master"),
  events: (seed, count) =>
    req("GET", `/api/events?seed=${encodeURIComponent(seed)}&count=${count || 100}`),
  search: (payload) => req("POST", "/api/search", payload),
  followed: (solution, owned, resources) =>
    req("POST", "/api/followed", { solution, owned, resources }),
};
