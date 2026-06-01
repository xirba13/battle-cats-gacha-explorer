// Thin fetch wrapper around the stateless backend API.

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
  master: () => req("GET", "/api/master"),
  events: (seed, count) =>
    req("GET", `/api/events?seed=${encodeURIComponent(seed)}&count=${count || 100}`),
  search: (payload) => req("POST", "/api/search", payload),
  followed: (solution, owned, resources) =>
    req("POST", "/api/followed", { solution, owned, resources }),
};
