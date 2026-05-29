// Thin fetch wrapper around the backend REST API.

async function req(method, path, body) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(path, opts);
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
  state: () => req("GET", "/api/state"),
  master: () => req("GET", "/api/master"),
  toggleOwned: (global_index, owned) =>
    req("POST", "/api/owned/toggle", { global_index, owned }),
  bulkOwned: (indices, owned) => req("POST", "/api/owned/bulk", { indices, owned }),
  clearOwned: () => req("POST", "/api/owned/clear"),
  setResources: (r) => req("PUT", "/api/resources", r),
  setSeed: (seed) => req("PUT", "/api/seed", { seed }),
  setRegion: (region) => req("PUT", "/api/region", { region }),
  events: (seed, count) =>
    req("GET", `/api/events?seed=${encodeURIComponent(seed)}&count=${count || 100}`),
  search: (payload) => req("POST", "/api/search", payload),
  followed: (solution, seed_before) =>
    req("POST", "/api/followed", { solution, seed_before }),
  history: () => req("GET", "/api/history"),
  // screenshot upload returns detection results
  screenshot: async (file, page) => {
    const fd = new FormData();
    fd.append("file", file);
    const q = page != null ? `?page=${page}` : "";
    const res = await fetch(`/api/screenshot${q}`, { method: "POST", body: fd });
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
  },
};
