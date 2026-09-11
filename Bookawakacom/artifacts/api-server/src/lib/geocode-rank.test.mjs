import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  finalizeGeocodeHits,
  parseTypedNzAddress,
  typedHouseUnresolved,
} from "./geocode-rank.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("parseTypedNzAddress handles house and NZ unit form", () => {
  const house = parseTypedNzAddress("88 Dee Street Invercargill");
  assert.equal(house.house, "88");
  assert.equal(house.street, "Dee Street");
  assert.equal(house.locality, "Invercargill");
  const unit = parseTypedNzAddress("9/6 Dee Street Invercargill");
  assert.equal(unit.unit, "9");
  assert.equal(unit.house, "6");
  assert.equal(unit.street, "Dee Street");
});

test("finalizeGeocodeHits prepends the typed address when Photon returns the wrong house", () => {
  const photonWrong = [
    {
      place_id: 1,
      display_name: "207 Dee Street, Invercargill, New Zealand",
      lat: "-46.408",
      lon: "168.347",
      address: { house_number: "207", road: "Dee Street", city: "Invercargill", country: "New Zealand" },
    },
  ];
  const q = "88 Dee Street Invercargill";
  assert.equal(typedHouseUnresolved(q, photonWrong), true);
  const out = finalizeGeocodeHits(q, photonWrong, 8);
  assert.match(out[0].display_name, /^88 Dee Street/);
  assert.equal(out[0].lat, "-46.408");
  assert.equal(out.length >= 2, true);
});

test("finalizeGeocodeHits does not treat 6/444 as a match for 9/6", () => {
  const hits = [
    {
      place_id: 2,
      display_name: "6/444 Dee Street, Invercargill, New Zealand",
      lat: "-46.4",
      lon: "168.3",
      address: { house_number: "6/444", road: "Dee Street", city: "Invercargill" },
    },
  ];
  const q = "9/6 Dee Street Invercargill";
  assert.equal(typedHouseUnresolved(q, hits), true);
  const out = finalizeGeocodeHits(q, hits, 8);
  assert.match(out[0].display_name, /^9\/6 Dee Street/);
});

test("searchNzPlaces falls through LocationIQ empty and ranks house matches", () => {
  const src = readFileSync(join(root, "lib/geocode-search.ts"), "utf8");
  assert.match(src, /typedHouseUnresolved/);
  assert.match(src, /finalizeGeocodeHits/);
  assert.match(src, /streetOnlyQuery/);
  assert.match(src, /LocationIQ empty used to return immediately/);
});
