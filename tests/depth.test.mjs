// How deep the roll tables go by default: as deep as your resources can pull.
import { test } from "node:test";
import assert from "node:assert/strict";

import { autoDepth } from "../src/engine/services.js";

const R = (rt, cf, pt, lt) => ({ rare_tickets: rt, cat_food: cf, platinum_tickets: pt, legend_tickets: lt });

test("the automatic depth is what your resources can pull, plus 20 rows", () => {
  // 30 tickets + 30 eleven-draws (45,000 cat food) + 4 capsule tickets = 364 pulls.
  assert.equal(autoDepth(R(30, 45000, 2, 2)), 384);
  // Cat food left after the 11-draws buys singles: 1,499 = 9 singles.
  assert.equal(autoDepth(R(200, 1499, 0, 0)), 229);
  // Never shallower than the old 100 rows, never deeper than 1,000.
  assert.equal(autoDepth(R(0, 0, 0, 0)), 100);
  assert.equal(autoDepth(R(5, 300, 0, 0)), 100);
  assert.equal(autoDepth(R(999, 999999, 99, 99)), 1000);
});
