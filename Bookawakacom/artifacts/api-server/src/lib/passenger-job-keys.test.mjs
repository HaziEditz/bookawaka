import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("website booking create stamps app aliases and dual-writes Passengerjobs trees", () => {
  const src = readFileSync(join(root, "routes/bookings.ts"), "utf8");
  assert.match(src, /PickupAddress: pickAddress/);
  assert.match(src, /DropoffAddress: dropAddress/);
  assert.match(src, /collectPassengerJobKeys/);
  assert.match(src, /Passengerjobs\/\$\{treeKey\}\/\$\{bookingId\}/);
});

test("passengerKey collectPassengerJobKeys drops guest and web_ keys", () => {
  const src = readFileSync(join(root, "lib/passengerKey.ts"), "utf8");
  assert.match(src, /export async function collectPassengerJobKeys/);
  assert.match(src, /s === "guest" \|\| s.startsWith\("web_"\)/);
  assert.match(src, /export async function collectPassengerJobKeysFromBooking/);
});

test("my-rides merges alias Passengerjobs trees and fans out cancel", () => {
  const src = readFileSync(join(root, "routes/myrides.ts"), "utf8");
  assert.match(src, /collectPassengerJobKeys/);
  assert.match(src, /collectPassengerJobKeysFromBooking/);
  assert.match(src, /Passengerjobs\/\$\{treeKey\}\/\$\{jobId\}/);
});
