'use strict';
// Fleet maintenance and fuel maths (pure). Dates YYYY-MM-DD, distances km, fuel litres, money cents.
const dayNum = (d) => Math.round(Date.parse(d + 'T00:00:00Z') / 864e5);
const diffDays = (a, b) => dayNum(b) - dayNum(a);
function addMonths(date, n) {
  let [y, m, d] = date.split('-').map(Number); m += n; y += Math.floor((m - 1) / 12); m = ((m - 1) % 12 + 12) % 12 + 1;
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate(); return `${y}-${String(m).padStart(2, '0')}-${String(Math.min(d, dim)).padStart(2, '0')}`;
}
// Next due for one rule. last = {date, odometer} of the most recent matching service, or the vehicle baseline.
function ruleStatus(rule, last, odo, today) {
  const due_km = rule.every_km ? last.odometer + rule.every_km : null, due_date = rule.every_months ? addMonths(last.date, rule.every_months) : null;
  const km_left = due_km == null ? null : due_km - odo, days_left = due_date == null ? null : diffDays(today, due_date);
  let status = 'ok';
  if ((km_left != null && km_left < 0) || (days_left != null && days_left < 0)) status = 'overdue';
  else if ((km_left != null && km_left <= 1000) || (days_left != null && days_left <= 30)) status = 'due_soon';
  return { due_km, due_date, km_left, days_left, status };
}
// Full-to-full consumption. Fills are {odometer, liters, full}. Only distances between two full tanks count.
function efficiency(fills) {
  const f = [...fills].sort((a, b) => a.odometer - b.odometer); const segs = []; let anchor = null, litres = 0;
  for (const x of f) {
    if (anchor) litres += x.liters;
    if (x.full) { if (anchor && x.odometer > anchor.odometer) segs.push({ from: anchor.odometer, to: x.odometer, km: x.odometer - anchor.odometer, liters: litres, l_per_100km: Math.round((litres / (x.odometer - anchor.odometer)) * 1000) / 10 }); anchor = x; litres = 0; }
  }
  const km = segs.reduce((t, s) => t + s.km, 0), l = segs.reduce((t, s) => t + s.liters, 0);
  return { segments: segs, avg_l_per_100km: km ? Math.round((l / km) * 1000) / 10 : null, km };
}
// Readings must never go backwards in time. entries: [{date, odometer, id}]
function odometerProblem(entries, date, odo, selfId) {
  for (const e of entries) { if (e.id === selfId) continue;
    if (e.date <= date && e.odometer > odo) return `Odometer ${odo} km is lower than ${e.odometer} km recorded on ${e.date}`;
    if (e.date > date && e.odometer < odo) return `Odometer ${odo} km is higher than ${e.odometer} km recorded later on ${e.date}`; }
  return null;
}
module.exports = { addMonths, diffDays, ruleStatus, efficiency, odometerProblem };
