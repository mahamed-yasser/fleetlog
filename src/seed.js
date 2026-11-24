'use strict';
const F = require('./fleet');
module.exports = function seed(db, today) {
  const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
  const veh = (name, plate, kind, odo, startAgoDays) => Number(db.prepare('INSERT INTO vehicles(name,plate,kind,start_odo,start_date) VALUES(?,?,?,?,?)').run(name, plate, kind, odo, addDays(today, -startAgoDays)).lastInsertRowid);
  const rule = (v, t, km, mo) => db.prepare('INSERT INTO rules(vehicle_id,task,every_km,every_months) VALUES(?,?,?,?)').run(v, t, km, mo);
  const svc = (v, t, ago, odo, cost, n) => db.prepare('INSERT INTO services(vehicle_id,task,date,odometer,cost_cents,notes) VALUES(?,?,?,?,?,?)').run(v, t, addDays(today, -ago), odo, cost, n || '');
  const fuel = (v, ago, odo, l, c, full = 1) => db.prepare('INSERT INTO fuel(vehicle_id,date,odometer,liters,cost_cents,full) VALUES(?,?,?,?,?,?)').run(v, addDays(today, -ago), odo, l, c, full);
  const van = veh('Delivery van 1', 'KL-482-VN', 'Van', 82400, 400), truck = veh('Box truck', 'MZ-119-TR', 'Truck', 141200, 500), car = veh('Sales car', 'AB-731-CD', 'Car', 38100, 300);
  [[van, 'Oil & filter', 15000, 12], [van, 'Brake inspection', 30000, 12], [van, 'Tyre rotation', 10000, null], [truck, 'Oil & filter', 20000, 12], [truck, 'Safety inspection', null, 12], [truck, 'Air filter', 40000, null], [car, 'Oil & filter', 15000, 12], [car, 'Tyres swap', null, 6]].forEach((r) => rule(...r));
  svc(van, 'Oil & filter', 150, 83900, 11900, 'Synthetic 5W-30'); svc(van, 'Tyre rotation', 220, 78700, 4000); svc(van, 'Brake inspection', 100, 85900, 6500, 'Rear pads at 40%');
  svc(truck, 'Oil & filter', 330, 123800, 18900); svc(truck, 'Safety inspection', 410, 120100, 9500); svc(truck, 'Air filter', 200, 131000, 4900);
  svc(car, 'Oil & filter', 120, 29800, 8900); svc(car, 'Tyres swap', 215, 31500, 6000, 'Winter to summer');
  // van fuel: full tanks, regular
  let o = 87400; [[75, 11.2], [60, 10.8], [46, 11.5], [32, 11.0], [18, 11.9], [5, 11.3]].forEach(([ago, per100], i) => { const km = 900; o += km; fuel(van, ago, o, Math.round(km * per100) / 100, Math.round(km * per100 * 1.62), 1); });
  o = 150400; [[70, 24.5], [52, 25.1], [34, 26.3], [16, 25.8]].forEach(([ago, per100]) => { const km = 1800; o += km; fuel(truck, ago, o, Math.round(km * per100) / 100, Math.round(km * per100 * 1.58), 1); });
  fuel(car, 58, 41600, 38, 6300, 1); fuel(car, 40, 42300, 22, 3600, 0); fuel(car, 38, 42900, 16, 2700, 1); fuel(car, 14, 44100, 41, 6900, 1);
};
