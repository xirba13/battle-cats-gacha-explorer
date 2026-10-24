// Runs a path search off the main thread so the page never freezes, even on
// slow phones. One worker per search; the page terminates it when it's done
// or no longer wanted.
import { Dataset } from "./data.js";
import { MasterData, searchRequest } from "./services.js";

self.onmessage = (e) => {
  const { data, master, body, options } = e.data;
  try {
    const result = searchRequest(new Dataset(data), new MasterData(master), body, {
      ...options,
      onProgress: (progress) => self.postMessage({ type: "progress", progress }),
    });
    self.postMessage({ type: "done", result });
  } catch (err) {
    self.postMessage({ type: "error", message: String(err?.message || err) });
  }
};
