import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { isLiveAsapStatus, jobLooksAsap, serviceTypesMatch } from "./asap-guard.ts";
import {
  ACTIVE_ASAP_LATER_ONLY_MSG,
  parseActiveAsapCheck,
} from "../../../invercargill-taxis/src/lib/asapDuplicateUx.ts";

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

test("website blocks ASAP at first tap and keeps Later available", () => {
  assert.equal(
    parseActiveAsapCheck({ hasActive: true, existingBookingId: "8692609121", existingStatus: "Pending" })
      ?.existingBookingId,
    "8692609121",
  );
  assert.equal(parseActiveAsapCheck({ hasActive: false }), null);
  const book = readFileSync(join(root, "../../invercargill-taxis/src/pages/BookPage.tsx"), "utf8");
  const home = readFileSync(join(root, "../../invercargill-taxis/src/App.tsx"), "utf8");
  assert.match(book, /ACTIVE_ASAP_LATER_ONLY_MSG/);
  assert.match(book, /disabled=\{\!\!activeBooking\}/);
  assert.match(book, /if \(activeBooking\) \{/);
  assert.match(book, /setBookingType\("scheduled"\)/);
  assert.match(home, /asap-later-only-modal/);
  assert.match(home, /fetchActiveAsapBooking/);
  assert.match(ACTIVE_ASAP_LATER_ONLY_MSG, /Later booking/);
});

import {
  parseCompanyVehicleTypes,
  resolveBookingVehicleType,
  vehicleTypeLooksLikeVan,
} from "./companyVehicleTypes.ts";
import {
  farePurposeForVehicle,
  parseCompanyVehicleTypesFromApi,
  pickForcedVehicleForPax,
} from "../../../invercargill-taxis/src/lib/companyVehicleTypes.ts";

test("Owner Panel vehicleTypes parse drops inactive rows and keeps real names", () => {
  const parsed = parseCompanyVehicleTypes({
    "6-seater-van": {
      active: true,
      capacity: 6,
      name: "6-seater Van",
    },
    wheelchair: {
      active: true,
      capacity: 6,
      name: "Wheelchair",
    },
    sedan: {
      active: false,
      capacity: 4,
      name: "Sedan",
    },
  });
  assert.deepEqual(
    parsed.map((t) => t.name).sort(),
    ["6-seater Van", "Wheelchair"],
  );
  assert.equal(vehicleTypeLooksLikeVan("6-seater Van"), true);
  assert.equal(vehicleTypeLooksLikeVan("Car"), false);
});

test("booking stamp keeps Owner Panel van name instead of rewriting to generic Van", () => {
  assert.equal(resolveBookingVehicleType({ vehicleType: "Any", passengers: 1 }), "");
  assert.equal(resolveBookingVehicleType({ vehicleType: "Sedan", passengers: 1 }), "Sedan");
  assert.equal(
    resolveBookingVehicleType({ vehicleType: "6-seater Van", passengers: 6 }),
    "6-seater Van",
  );
  assert.equal(resolveBookingVehicleType({ vehicleType: "Car", passengers: 6 }), "Van");
});

test("website booking form lists Owner Panel types and times out hung creates", () => {
  const book = readFileSync(join(root, "../../invercargill-taxis/src/pages/BookPage.tsx"), "utf8");
  const companies = readFileSync(join(root, "routes/companies.ts"), "utf8");
  assert.match(companies, /parseCompanyVehicleTypes/);
  assert.match(companies, /vehicleTypes: parseCompanyVehicleTypes/);
  assert.doesNotMatch(book, /\["Any", "Sedan", "SUV", "Van"/);
  assert.match(book, /ownerVehicleTypes\.map/);
  assert.match(book, /AbortSignal\.timeout\(25_000\)/);
  assert.match(book, /pickForcedVehicleForPax/);
  const guard = readFileSync(join(root, "lib/active-booking-guard.ts"), "utf8");
  assert.match(guard, /paxRowNeedsLiveConfirm/);
  assert.match(guard, /ACTIVE_CHECK_TIMEOUT_MS/);
});

test("paxRowNeedsLiveConfirm skips terminal Passengerjobs without allbookings reads", () => {
  assert.equal(isLiveAsapStatus("Completed"), false);
  assert.equal(isLiveAsapStatus("Cancelled"), false);
  assert.equal(isLiveAsapStatus("PendingPayment"), false);
  assert.equal(isLiveAsapStatus("Scheduled"), false);
  assert.equal(isLiveAsapStatus("Pending"), true);
  const guard = readFileSync(join(root, "lib/active-booking-guard.ts"), "utf8");
  assert.match(guard, /if \(!paxRowNeedsLiveConfirm\(paxStatus\)\) continue/);
});

test("5+ pax picks the company's van-class type from Owner Panel", () => {
  const types = parseCompanyVehicleTypesFromApi([
    { id: "car", name: "Car", capacity: 4 },
    { id: "van", name: "6-seater Van", capacity: 6 },
  ]);
  assert.equal(pickForcedVehicleForPax(types, 6), "6-seater Van");
  assert.equal(farePurposeForVehicle({ vehicleName: "6-seater Van", passengers: 1, paymentMethod: "cash" }), "Van");
  assert.equal(farePurposeForVehicle({ vehicleName: "Car", passengers: 1, paymentMethod: "cash" }), "Standard");
});

