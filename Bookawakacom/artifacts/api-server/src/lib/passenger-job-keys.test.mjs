import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { isLiveAsapStatus, jobLooksAsap, serviceTypesMatch } from "./asap-guard.ts";

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

test("duplicate ASAP guard matches empty ServiceType as taxi and scans all trees", () => {
  assert.equal(serviceTypesMatch("", "taxi"), true);
  assert.equal(serviceTypesMatch(null, "taxi"), true);
  assert.equal(serviceTypesMatch("food", "taxi"), false);
  assert.equal(jobLooksAsap({ BookingType: "ASAP", ScheduledFor: 0 }), true);
  assert.equal(jobLooksAsap({ BookingType: "Prebook", ScheduledFor: Date.now() + 1e8 }), false);
  assert.equal(jobLooksAsap({ ScheduledFor: null, Status: "Pending" }), true);
  assert.equal(isLiveAsapStatus("Pending"), true);
  assert.equal(isLiveAsapStatus("PendingPayment"), false);
  assert.equal(isLiveAsapStatus("Scheduled"), false);
  assert.equal(isLiveAsapStatus("Cancelled"), false);
  const guard = readFileSync(join(root, "lib/active-booking-guard.ts"), "utf8");
  assert.match(guard, /collectPassengerJobKeys/);
  assert.match(guard, /serviceTypesMatch/);
  assert.match(guard, /isLiveAsapStatus/);
  const create = readFileSync(join(root, "routes/booking.ts"), "utf8");
  assert.match(create, /findActiveBooking/);
  assert.match(create, /DUPLICATE_ACTIVE_BOOKING/);
});
