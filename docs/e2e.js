'use strict';
const e2e = require('./e2ekit'); const { build } = require('../src/app');
const clock = () => new Date('2026-11-24T09:00:00Z');
e2e((o) => build({ ...o, clock }), async ({ page, shot, ok, restart, login, modal, tick, url }) => {
  await login(); await page.waitFor('document.body.innerText.includes("Maintenance to do")'); await tick(300); await shot('01-overview'); ok((await page.text()).includes('Safety inspection'), 'overview lists overdue maintenance');
  await page.click('a[data-id=vehicles]'); await page.waitFor('document.querySelectorAll("tbody tr").length===3'); await shot('02-vehicles');
  await page.clickText('tbody tr', 'Box truck'); await page.waitFor('document.body.innerText.includes("Maintenance schedule")'); await shot('03-vehicle');
  ok((await page.eval(`[...document.querySelectorAll('tbody tr')].find(r=>r.textContent.includes('Safety inspection')).textContent.includes('Overdue')`)), 'truck safety inspection is overdue');
  // a service that goes backwards in odometer is refused
  await page.eval(`[...document.querySelectorAll('tbody tr')].find(r=>r.textContent.includes('Safety inspection')).querySelector('button.primary').click()`); await page.waitFor('document.querySelector(".modal")');
  await modal('odometer', '1000'); await page.click('#modal-submit'); await page.waitFor('document.querySelector(".form-error").textContent.includes("lower than")'); ok(true, 'impossible odometer reading is refused');
  await modal('odometer', '157600'); await modal('cost', '99'); await page.click('#modal-submit'); await page.waitFor('!document.querySelector(".modal")');
  await page.waitFor(`[...document.querySelectorAll('tbody tr')].some(r=>r.textContent.includes('Safety inspection')&&r.textContent.includes('OK'))`); ok(true, 'logging the inspection clears the overdue flag');
  await restart(); await page.eval('location.reload()'); await page.waitFor(`[...document.querySelectorAll('tbody tr')].some(r=>r.textContent.includes('Safety inspection')&&r.textContent.includes('OK'))`); ok(true, 'service record persists after restart');
  await page.clickText('button', 'Log fuel'); await page.waitFor('document.querySelector(".modal")'); await modal('odometer', '158000'); await modal('liters', '125'); await modal('cost', '198'); await page.click('#modal-submit'); await page.waitFor('!document.querySelector(".modal")');
  await page.waitFor('document.body.innerText.includes("158,000 km")'); ok(true, 'fuel entry saved and odometer updated'); await shot('04-vehicle-after');
  await page.viewport(390, 844, true); await page.eval('location.hash="#/dashboard"'); await tick(600); await shot('05-mobile-overview');
}, { docs: __dirname });
