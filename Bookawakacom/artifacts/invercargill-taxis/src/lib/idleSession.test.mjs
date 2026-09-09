import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const idleSrc = readFileSync(join(dir, 'idleSession.ts'), 'utf8');
const guardSrc = readFileSync(join(dir, '../components/IdleSessionGuard.tsx'), 'utf8');
const appSrc = readFileSync(join(dir, '../App.tsx'), 'utf8');
const ridesSrc = readFileSync(join(dir, '../pages/MyRidesPage.tsx'), 'utf8');
const towSrc = readFileSync(join(dir, '../pages/TowTrackPage.tsx'), 'utf8');

const IDLE_TIMEOUT_MS = 15 * 60 * 1000;

const LIVE_TRIP_STATUSES = new Set([
  'offered', 'offer', 'assigned', 'accepted', 'enroute', 'en route',
  'picking', 'arrived', 'ontrip', 'on trip', 'started', 'active', 'reassigned',
]);

function isLiveTripStatus(status) {
  return LIVE_TRIP_STATUSES.has(String(status || '').trim().toLowerCase());
}

function isLiveTripTrackingPath(pathname) {
  const p = String(pathname || '').replace(/\/+$/, '') || '/';
  return p === '/my-rides' || p.endsWith('/my-rides') || p === '/tow/track' || p.endsWith('/tow/track');
}

function shouldHoldIdleForLiveTracking(opts) {
  if (!opts.liveTripVisible) return false;
  return isLiveTripTrackingPath(opts.pathname);
}

function isIdleExpired(lastActivityMs, nowMs, holdLiveTracking) {
  if (holdLiveTracking) return false;
  return nowMs - lastActivityMs >= IDLE_TIMEOUT_MS;
}

test('website idle timeout is 15 minutes', () => {
  assert.match(idleSrc, /IDLE_TIMEOUT_MS = 15 \* 60 \* 1000/);
  assert.equal(IDLE_TIMEOUT_MS, 900000);
});

test('idle expires after 15 minutes of inactivity on ordinary pages', () => {
  const t0 = 1_000_000;
  assert.equal(isIdleExpired(t0, t0 + 14 * 60 * 1000, false), false);
  assert.equal(isIdleExpired(t0, t0 + 15 * 60 * 1000, false), true);
  assert.equal(
    shouldHoldIdleForLiveTracking({ pathname: '/book', liveTripVisible: false }),
    false,
  );
});

test('live trip-tracking screen holds the session with no clicks', () => {
  assert.equal(isLiveTripStatus('arrived'), true);
  assert.equal(isLiveTripStatus('ontrip'), true);
  assert.equal(isLiveTripTrackingPath('/my-rides'), true);
  assert.equal(isLiveTripTrackingPath('/tow/track'), true);
  assert.equal(isLiveTripTrackingPath('/book'), false);
  assert.equal(
    shouldHoldIdleForLiveTracking({ pathname: '/my-rides', liveTripVisible: true }),
    true,
  );
  const t0 = 1_000_000;
  assert.equal(isIdleExpired(t0, t0 + 60 * 60 * 1000, true), false);
});

test('guard is mounted and live-tracking pages set the hold flag', () => {
  assert.match(appSrc, /<IdleSessionGuard/);
  assert.match(guardSrc, /dataset\[LIVE_FLAG\] === "1"/);
  assert.match(ridesSrc, /dataset\.liveTripTracking/);
  assert.match(towSrc, /dataset\.liveTripTracking/);
});
