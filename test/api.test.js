'use strict';
const test = require('node:test'), assert = require('node:assert/strict'); const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { start } = require('./testkit'); const { build } = require('../src/app');
let day = '2026-11-24'; const clock = () => new Date(day + 'T09:00:00Z'); const mk = (o) => build({ ...o, clock });
const vs = async (s) => (await s.call('GET', '/api/vehicles')).data.vehicles; const byName = async (s, n) => (await vs(s)).find((v) => v.name === n);
test('auth; seeded statuses; dashboard totals match vehicle list', async () => {
  const s = await start(mk); assert.equal((await s.anon('GET', '/api/vehicles')).status, 401); const V = await vs(s); assert.equal(V.length, 3);
  const truck = V.find((v) => v.name === 'Box truck'); assert.equal(truck.status, 'overdue'); assert.ok(truck.overdue.includes('Safety inspection'));
  const d = (await s.call('GET', '/api/dashboard')).data; assert.equal(d.overdue, d.due.filter((x) => x.status === 'overdue').length); assert.equal(d.due[0].status, 'overdue'); assert.ok(d.monthly.length >= 3); await s.close();
});
test('logging a service resets that rule and clears the overdue flag', async () => {
  const s = await start(mk); const truck = await byName(s, 'Box truck'); let g = (await s.call('GET', '/api/vehicles/' + truck.id)).data;
  const insp = g.rules.find((r) => r.task === 'Safety inspection'); assert.equal(insp.status, 'overdue');
  assert.equal((await s.call('POST', `/api/vehicles/${truck.id}/services`, { task: 'Safety inspection', date: '2026-11-24', odometer: truck.odometer, cost_cents: 9900 })).status, 200);
  g = (await s.call('GET', '/api/vehicles/' + truck.id)).data; const after = g.rules.find((r) => r.task === 'Safety inspection'); assert.equal(after.status, 'ok'); assert.equal(after.due_date, '2027-11-24'); assert.equal(after.last_odometer, truck.odometer);
  assert.equal(g.services[0].task, 'Safety inspection'); await s.close();
});
test('odometer must be consistent with history; dates and values validated', async () => {
  const s = await start(mk); const van = await byName(s, 'Delivery van 1'); const url = `/api/vehicles/${van.id}`;
  assert.match((await s.call('POST', url + '/fuel', { date: '2026-11-24', odometer: 1000, liters: 40, cost_cents: 6000 })).data.error, /lower than/);
  assert.match((await s.call('POST', url + '/fuel', { date: '2026-01-01', odometer: 99999, liters: 40, cost_cents: 6000 })).data.error, /higher than/);
  assert.equal((await s.call('POST', url + '/fuel', { date: '2027-01-01', odometer: 99999, liters: 40, cost_cents: 6000 })).status, 400);
  assert.equal((await s.call('POST', url + '/fuel', { date: '2026-11-24', odometer: van.odometer + 100, liters: 0, cost_cents: 6000 })).status, 400);
  assert.equal((await s.call('POST', url + '/fuel', { date: '2026-11-24', odometer: van.odometer + 100, liters: 9.5, cost_cents: 1600, full: true })).status, 200);
  assert.equal((await byName(s, 'Delivery van 1')).odometer, van.odometer + 100); await s.close();
});
test('efficiency and costs per km are computed from the logs', async () => {
  const s = await start(mk); const van = await byName(s, 'Delivery van 1'); const g = (await s.call('GET', '/api/vehicles/' + van.id)).data;
  assert.equal(g.efficiency.segments.length, 5); assert.ok(g.efficiency.avg_l_per_100km > 10.5 && g.efficiency.avg_l_per_100km < 12);
  const fuel = g.fuel.reduce((t, f) => t + f.cost_cents, 0), svc = g.services.reduce((t, x) => t + x.cost_cents, 0); assert.equal(g.costs.total_cents, fuel + svc); assert.equal(g.costs.cents_per_km, Math.round((fuel + svc) / (van.odometer - van.start_odo)));
  const car = await byName(s, 'Sales car'); const c = (await s.call('GET', '/api/vehicles/' + car.id)).data; assert.equal(c.efficiency.segments.length, 2); await s.close();
});
test('time passing makes a rule due; rules validated; new vehicle gets default rules', async () => {
  day = '2026-11-24'; const s = await start(mk); const car = await byName(s, 'Sales car'); assert.deepEqual(car.overdue, ['Tyres swap']); const van = await byName(s, 'Delivery van 1'); assert.ok(!van.overdue.includes('Oil & filter'));
  day = '2027-11-30'; assert.ok((await byName(s, 'Delivery van 1')).overdue.includes('Oil & filter')); day = '2026-11-24';
  assert.equal((await s.call('POST', `/api/vehicles/${car.id}/rules`, { task: 'Wipers' })).status, 400); assert.equal((await s.call('POST', `/api/vehicles/${car.id}/rules`, { task: 'Wipers', every_months: 12 })).status, 200); assert.equal((await s.call('POST', `/api/vehicles/${car.id}/rules`, { task: 'Wipers', every_months: 12 })).status, 409);
  const id = (await s.call('POST', '/api/vehicles', { name: 'New bike', plate: 'zz-1', kind: 'Bike', start_odo: 100 })).data.id; assert.equal((await s.call('GET', '/api/vehicles/' + id)).data.rules.length, 2);
  assert.equal((await s.call('POST', '/api/vehicles', { name: 'Dup', plate: 'ZZ-1', kind: 'Bike' })).status, 409); await s.close();
});
test('csv export and restart persistence', async () => {
  const dbFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fl-')), 'x.db'); let s = await start((o) => mk({ ...o, dbFile })); const van = await byName(s, 'Delivery van 1');
  assert.match((await s.call('GET', `/api/vehicles/${van.id}/services.csv`, null, true)).text, /^Date,Task,Odometer/); await s.call('POST', `/api/vehicles/${van.id}/services`, { task: 'Wash', date: '2026-11-24', odometer: van.odometer, cost_cents: 500 }); await s.close();
  s = await start((o) => mk({ ...o, dbFile })); assert.equal((await s.call('GET', '/api/vehicles/' + van.id)).data.services[0].task, 'Wash'); await s.close();
});
