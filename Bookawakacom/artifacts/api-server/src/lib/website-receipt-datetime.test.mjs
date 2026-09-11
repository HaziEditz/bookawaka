import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const apiRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const webRoot = join(apiRoot, "../../invercargill-taxis/src");

function loadApi(rel) {
  return readFileSync(join(apiRoot, rel), "utf8");
}
function loadWeb(rel) {
  return readFileSync(join(webRoot, rel), "utf8");
}

test("My Rides overlays and renders extra stops", () => {
  const api = loadApi("routes/myrides.ts");
  assert.match(api, /overlayStops/);
  assert.match(api, /live\.nextstopdata/);
  const page = loadWeb("pages/MyRidesPage.tsx");
  assert.match(page, /stopLabelsFromRide/);
  assert.match(page, /Stop \$\{i \+ 1\}/);
});

test("schedule datetime uses NZ wall time min and stacks on small screens", () => {
  const book = loadWeb("pages/BookPage.tsx");
  assert.match(book, /toNZDatetimeLocal\(Date\.now\(\) \+ 5 \* 60 \* 1000\)/);
  assert.doesNotMatch(book, /toISOString\(\)\.slice\(0, 16\)/);
  const picker = loadWeb("components/NzDateTimeInput.tsx");
  assert.match(picker, /flex-col gap-2 sm:flex-row/);
  assert.match(picker, /min-w-0 w-full/);
});
