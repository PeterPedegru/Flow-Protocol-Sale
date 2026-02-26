import test from "node:test";
import assert from "node:assert/strict";

import { maxPriceQ96ToFdvUsd, phaseFromBlock } from "../src/math.js";

test("maxPriceQ96ToFdvUsd: floor FDV около 25,000", () => {
  const floorPriceQ96 = 1980704062800n;
  const totalSupplyRaw = 1000000000000000000000000000n;

  const fdv = maxPriceQ96ToFdvUsd(floorPriceQ96, totalSupplyRaw);
  assert.ok(fdv > 24999 && fdv < 25001, `fdv=${fdv}`);
});

test("phaseFromBlock: корректная фаза", () => {
  const start = 42673326n;
  const end = 42673596n;

  assert.equal(phaseFromBlock(start - 1n, start, end), "before_start");
  assert.equal(phaseFromBlock(start, start, end), "pre_bid");
  assert.equal(phaseFromBlock(start + 149n, start, end), "pre_bid");
  assert.equal(phaseFromBlock(start + 150n, start, end), "clearing");
  assert.equal(phaseFromBlock(end, start, end), "clearing");
  assert.equal(phaseFromBlock(end + 1n, start, end), "ended");
});
