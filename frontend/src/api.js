// What the page used to ask the server, answered in the browser: the Cat
// Guide list and godfat's banner data are static files (public/data/), roll
// tables are built here, and path searches run in a Web Worker so the page
// stays responsive. Nothing about your collection, seed or resources leaves
// the page.
import { Dataset } from "./engine/data.js";
import { DISCLAIMER, MasterData, eventsRequest, followedRequest } from "./engine/services.js";

// A search stops after this long, or once it holds this many states (memory,
// for phones), and shows the best paths found so far.
export const SEARCH_TIME_LIMIT_MS = 20_000;
const MAX_STATES = (globalThis.navigator?.deviceMemory ?? 4) <= 2 ? 1_000_000 : 2_500_000;

const loaded = {};
function loadJson(name) {
  if (!loaded[name]) {
    loaded[name] = fetch(`${import.meta.env.BASE_URL}data/${name}`).then((res) => {
      if (!res.ok) throw new Error(`Couldn't load ${name} (HTTP ${res.status}). Try again in a moment.`);
      return res.json();
    });
    loaded[name].catch(() => delete loaded[name]); // a failed load is retried next time
  }
  return loaded[name];
}
const loadMaster = () => loadJson("cat_guide_master.json");
const loadData = () => loadJson("godfat_bcen.json");

let dataset = null;
let master = null;

function search(body, { onProgress, signal } = {}) {
  return Promise.all([loadData(), loadMaster()]).then(([data, masterJson]) => new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Search cancelled", "AbortError"));
      return;
    }
    const worker = new Worker(new URL("./engine/search.worker.js", import.meta.url), { type: "module" });
    const finish = () => {
      worker.terminate();
      signal?.removeEventListener("abort", abort);
    };
    function abort() {
      finish();
      reject(new DOMException("Search cancelled", "AbortError"));
    }
    signal?.addEventListener("abort", abort, { once: true });
    worker.onmessage = (e) => {
      const msg = e.data;
      if (msg.type === "progress") {
        onProgress?.(msg.progress);
        return;
      }
      finish();
      if (msg.type === "done") resolve(msg.result);
      else reject(new Error(msg.message));
    };
    worker.onerror = (e) => {
      finish();
      reject(new Error(e.message || "The search failed."));
    };
    worker.postMessage({
      data,
      master: masterJson,
      body,
      options: { timeLimitMs: SEARCH_TIME_LIMIT_MS, maxStates: MAX_STATES },
    });
  }));
}

export const api = {
  master: async () => {
    const m = await loadMaster();
    return { meta: m._meta, units: m.units, disclaimer: DISCLAIMER };
  },
  events: async (seed) => {
    dataset ??= new Dataset(await loadData());
    return eventsRequest(dataset, seed);
  },
  search,
  followed: async (solution, owned, resources) => {
    master ??= new MasterData(await loadMaster());
    return followedRequest(master, { solution, owned, resources });
  },
};
