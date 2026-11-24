'use strict';
const path = require('node:path'); const { createApp, csv } = require('./core'); const F = require('./fleet');
const SCHEMA = `
CREATE TABLE IF NOT EXISTS vehicles(id INTEGER PRIMARY KEY, name TEXT NOT NULL, plate TEXT NOT NULL UNIQUE, kind TEXT NOT NULL, start_odo INTEGER NOT NULL DEFAULT 0, start_date TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS rules(id INTEGER PRIMARY KEY, vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE, task TEXT NOT NULL, every_km INTEGER, every_months INTEGER, CHECK(every_km IS NOT NULL OR every_months IS NOT NULL), UNIQUE(vehicle_id,task));
CREATE TABLE IF NOT EXISTS services(id INTEGER PRIMARY KEY, vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE, task TEXT NOT NULL, date TEXT NOT NULL, odometer INTEGER NOT NULL, cost_cents INTEGER NOT NULL DEFAULT 0, notes TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS fuel(id INTEGER PRIMARY KEY, vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE, date TEXT NOT NULL, odometer INTEGER NOT NULL, liters REAL NOT NULL CHECK(liters>0), cost_cents INTEGER NOT NULL CHECK(cost_cents>=0), full INTEGER NOT NULL DEFAULT 1);`;

function build({ dbFile, clock = () => new Date(), publicDir = path.join(__dirname, '..', 'public') } = {}) {
  return createApp({ dbFile, publicDir, schema: SCHEMA, appName: 'FleetLog', seed: (db) => require('./seed')(db, clock().toISOString().slice(0, 10)),
    routes(add, { db, tx, v, bad, HttpError }) {
      const today = () => clock().toISOString().slice(0, 10);
      const veh = (id) => { const x = db.prepare('SELECT * FROM vehicles WHERE id=?').get(id); if (!x) throw new HttpError(404, 'Vehicle not found'); return x; };
      const readings = (id) => [...db.prepare('SELECT id, date, odometer FROM services WHERE vehicle_id=?').all(id).map((r) => ({ ...r, id: 's' + r.id })), ...db.prepare('SELECT id, date, odometer FROM fuel WHERE vehicle_id=?').all(id).map((r) => ({ ...r, id: 'f' + r.id }))];
      const odo = (x) => Math.max(x.start_odo, ...readings(x.id).map((r) => r.odometer));
      const check = (vid, date, o, self) => { const p = F.odometerProblem(readings(vid), date, o, self); if (p) throw bad(p); };
      const rulesOf = (x) => { const o = odo(x), t = today(); return db.prepare('SELECT * FROM rules WHERE vehicle_id=? ORDER BY task').all(x.id).map((r) => {
        const last = db.prepare('SELECT date, odometer FROM services WHERE vehicle_id=? AND task=? ORDER BY date DESC, odometer DESC LIMIT 1').get(x.id, r.task) || { date: x.start_date, odometer: x.start_odo };
        return { ...r, last_date: last.date, last_odometer: last.odometer, ...F.ruleStatus(r, last, o, t) }; }); };
      const worst = (rs) => rs.some((r) => r.status === 'overdue') ? 'overdue' : rs.some((r) => r.status === 'due_soon') ? 'due_soon' : 'ok';
      const summary = (x) => { const rs = rulesOf(x); return { ...x, odometer: odo(x), status: worst(rs), overdue: rs.filter((r) => r.status === 'overdue').map((r) => r.task), due_soon: rs.filter((r) => r.status === 'due_soon').map((r) => r.task) }; };

      add('GET', '/api/vehicles', () => ({ vehicles: db.prepare('SELECT * FROM vehicles ORDER BY active DESC, name').all().map(summary) }));
      add('POST', '/api/vehicles', ({ body }) => tx(() => { const id = Number(db.prepare('INSERT INTO vehicles(name,plate,kind,start_odo,start_date) VALUES(?,?,?,?,?)').run(v.str(body.name, 'Name', { max: 60 }), v.str(body.plate, 'Plate', { max: 12 }).toUpperCase(), v.str(body.kind, 'Type', { max: 30 }), v.int(body.start_odo ?? 0, 'Odometer', { max: 2e6 }), v.date(body.start_date || today(), 'Start date')).lastInsertRowid);
        for (const [t, km, mo] of [['Oil & filter', 15000, 12], ['Safety inspection', null, 12]]) db.prepare('INSERT INTO rules(vehicle_id,task,every_km,every_months) VALUES(?,?,?,?)').run(id, t, km, mo); return { id }; }));
      add('PATCH', '/api/vehicles/:id', ({ params, body }) => { veh(Number(params.id)); db.prepare('UPDATE vehicles SET active=? WHERE id=?').run(body.active ? 1 : 0, Number(params.id)); return { ok: true }; });
      add('GET', '/api/vehicles/:id', ({ params }) => {
        const x = veh(Number(params.id)); const fills = db.prepare('SELECT * FROM fuel WHERE vehicle_id=? ORDER BY date DESC, odometer DESC').all(x.id); const svc = db.prepare('SELECT * FROM services WHERE vehicle_id=? ORDER BY date DESC, odometer DESC').all(x.id);
        const eff = F.efficiency(fills); const fuelCost = fills.reduce((t, f) => t + f.cost_cents, 0), svcCost = svc.reduce((t, s) => t + s.cost_cents, 0); const km = odo(x) - x.start_odo;
        return { vehicle: summary(x), rules: rulesOf(x), services: svc, fuel: fills, efficiency: eff, costs: { fuel_cents: fuelCost, service_cents: svcCost, total_cents: fuelCost + svcCost, cents_per_km: km > 0 ? Math.round((fuelCost + svcCost) / km) : null, km } };
      });
      add('POST', '/api/vehicles/:id/fuel', ({ params, body }) => { const x = veh(Number(params.id)); const d = v.date(body.date, 'Date'); if (d > today()) throw bad('Date is in the future'); const o = v.int(body.odometer, 'Odometer', { min: 1, max: 2e6 }); check(x.id, d, o);
        return { id: Number(db.prepare('INSERT INTO fuel(vehicle_id,date,odometer,liters,cost_cents,full) VALUES(?,?,?,?,?,?)').run(x.id, d, o, v.num(body.liters, 'Litres', { min: 0.1, max: 500 }), v.int(body.cost_cents, 'Cost'), body.full === false ? 0 : 1).lastInsertRowid) }; });
      add('POST', '/api/vehicles/:id/services', ({ params, body }) => { const x = veh(Number(params.id)); const d = v.date(body.date, 'Date'); if (d > today()) throw bad('Date is in the future'); const o = v.int(body.odometer, 'Odometer', { min: 1, max: 2e6 }); check(x.id, d, o);
        return { id: Number(db.prepare('INSERT INTO services(vehicle_id,task,date,odometer,cost_cents,notes) VALUES(?,?,?,?,?,?)').run(x.id, v.str(body.task, 'Task', { max: 60 }), d, o, v.int(body.cost_cents ?? 0, 'Cost'), v.str(body.notes, 'Notes', { required: false, max: 300 })).lastInsertRowid) }; });
      add('DELETE', '/api/fuel/:id', ({ params }) => { db.prepare('DELETE FROM fuel WHERE id=?').run(Number(params.id)); return { ok: true }; });
      add('DELETE', '/api/services/:id', ({ params }) => { db.prepare('DELETE FROM services WHERE id=?').run(Number(params.id)); return { ok: true }; });
      add('POST', '/api/vehicles/:id/rules', ({ params, body }) => { veh(Number(params.id)); const km = v.int(body.every_km, 'Every km', { min: 100, required: false }), mo = v.int(body.every_months, 'Every months', { min: 1, max: 120, required: false }); if (km == null && mo == null) throw bad('Set a distance interval, a time interval, or both');
        db.prepare('INSERT INTO rules(vehicle_id,task,every_km,every_months) VALUES(?,?,?,?)').run(Number(params.id), v.str(body.task, 'Task', { max: 60 }), km, mo); return { ok: true }; });
      add('DELETE', '/api/rules/:id', ({ params }) => { db.prepare('DELETE FROM rules WHERE id=?').run(Number(params.id)); return { ok: true }; });
      add('GET', '/api/dashboard', () => { const vs = db.prepare('SELECT * FROM vehicles WHERE active=1').all(); const due = []; for (const x of vs) for (const r of rulesOf(x)) if (r.status !== 'ok') due.push({ vehicle_id: x.id, vehicle: x.name, plate: x.plate, task: r.task, status: r.status, km_left: r.km_left, days_left: r.days_left, due_date: r.due_date });
        due.sort((a, b) => (a.status === b.status ? Math.min(a.days_left ?? 1e9, (a.km_left ?? 1e9) / 50) - Math.min(b.days_left ?? 1e9, (b.km_left ?? 1e9) / 50) : a.status === 'overdue' ? -1 : 1));
        const month = today().slice(0, 7); const f = db.prepare("SELECT COALESCE(SUM(cost_cents),0) AS c, COALESCE(SUM(liters),0) AS l FROM fuel WHERE substr(date,1,7)=?").get(month), s = db.prepare('SELECT COALESCE(SUM(cost_cents),0) AS c FROM services WHERE substr(date,1,7)=?').get(month);
        const monthly = db.prepare("SELECT m, SUM(f) AS fuel, SUM(s) AS service FROM (SELECT substr(date,1,7) AS m, cost_cents AS f, 0 AS s FROM fuel UNION ALL SELECT substr(date,1,7), 0, cost_cents FROM services) GROUP BY m ORDER BY m DESC LIMIT 6").all().reverse();
        return { vehicles: vs.length, overdue: due.filter((d) => d.status === 'overdue').length, due_soon: due.filter((d) => d.status === 'due_soon').length, due, month_fuel_cents: f.c, month_liters: Math.round(f.l * 10) / 10, month_service_cents: s.c, monthly }; });
      add('GET', '/api/vehicles/:id/services.csv', ({ params }) => csv([['Date', 'Task', 'Odometer', 'Cost', 'Notes'], ...db.prepare('SELECT * FROM services WHERE vehicle_id=? ORDER BY date').all(Number(params.id)).map((s) => [s.date, s.task, s.odometer, s.cost_cents / 100, s.notes])]));
    } });
}
module.exports = { build };
