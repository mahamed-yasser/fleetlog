'use strict';
const test = require('node:test'), assert = require('node:assert/strict'); const F = require('../src/fleet');
test('addMonths clamps to month end and crosses years', () => { assert.equal(F.addMonths('2026-01-31', 1), '2026-02-28'); assert.equal(F.addMonths('2026-11-24', 12), '2027-11-24'); assert.equal(F.addMonths('2026-12-15', 2), '2027-02-15'); assert.equal(F.addMonths('2028-01-31', 1), '2028-02-29'); });
test('ruleStatus by distance, by time, whichever comes first', () => {
  const rule = { every_km: 10000, every_months: 6 }, last = { date: '2026-06-01', odometer: 50000 };
  assert.deepEqual(F.ruleStatus(rule, last, 52000, '2026-08-01'), { due_km: 60000, due_date: '2026-12-01', km_left: 8000, days_left: 122, status: 'ok' });
  assert.equal(F.ruleStatus(rule, last, 59500, '2026-08-01').status, 'due_soon'); assert.equal(F.ruleStatus(rule, last, 60001, '2026-08-01').status, 'overdue');
  assert.equal(F.ruleStatus(rule, last, 52000, '2026-11-20').status, 'due_soon'); assert.equal(F.ruleStatus(rule, last, 52000, '2026-12-02').status, 'overdue');
  assert.equal(F.ruleStatus({ every_km: null, every_months: 12 }, last, 999999, '2026-08-01').km_left, null); assert.equal(F.ruleStatus(rule, last, 60000, '2026-08-01').status, 'due_soon'); // exactly due is not overdue yet
});
test('efficiency uses full-to-full and spreads partial fills', () => {
  const e = F.efficiency([{ odometer: 1000, liters: 40, full: 1 }, { odometer: 1300, liters: 20, full: 0 }, { odometer: 1500, liters: 20, full: 1 }, { odometer: 2000, liters: 30, full: 1 }]);
  assert.equal(e.segments.length, 2); assert.deepEqual(e.segments[0], { from: 1000, to: 1500, km: 500, liters: 40, l_per_100km: 8 }); assert.equal(e.segments[1].l_per_100km, 6); assert.equal(e.avg_l_per_100km, 7); // 70 L over 1000 km
  assert.equal(F.efficiency([{ odometer: 1000, liters: 40, full: 1 }]).avg_l_per_100km, null); assert.equal(F.efficiency([]).km, 0);
  assert.equal(F.efficiency([{ odometer: 100, liters: 1, full: 0 }, { odometer: 200, liters: 5, full: 1 }, { odometer: 300, liters: 5, full: 1 }]).avg_l_per_100km, 5); // first fill before any full anchor ignored
});
test('odometerProblem catches readings going backwards in either direction', () => {
  const es = [{ id: 'a', date: '2026-01-10', odometer: 1000 }, { id: 'b', date: '2026-03-10', odometer: 3000 }];
  assert.equal(F.odometerProblem(es, '2026-02-01', 2000), null); assert.match(F.odometerProblem(es, '2026-02-01', 900), /lower than 1000/); assert.match(F.odometerProblem(es, '2026-02-01', 3500), /higher than 3000/); assert.equal(F.odometerProblem(es, '2026-03-10', 3000, 'b'), null); assert.equal(F.odometerProblem([], '2026-01-01', 5), null);
});
