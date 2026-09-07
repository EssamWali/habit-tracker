/**
 * README screenshots. Renders the app under headless Chrome with a fake session
 * and a seeded local mirror of synthetic habits, then writes both themes of
 * each shot to docs/img/. No real account or data is involved: Supabase calls
 * are intercepted and answered with empty results.
 *
 *   npm run dev -- --port 5199        # in another terminal
 *   npx --yes playwright@1.63.0 --version   # once, so the package is present
 *   node scripts/screenshots.mjs
 *
 * Uses the machine's Chrome rather than a downloaded browser (channel: 'chrome').
 * TODAY is pinned so the pictures are reproducible.
 */
import { chromium } from 'playwright'
import { mkdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const BASE = 'http://localhost:5199/'
const OUT = fileURLToPath(new URL('../docs/img/', import.meta.url))
mkdirSync(OUT, { recursive: true })

const USER = 'a0000000-0000-4000-8000-000000000001'
const REF = new URL(readFileSync(new URL('../.env.local', import.meta.url), 'utf8').match(/VITE_SUPABASE_URL=(\S+)/)[1]).hostname.split('.')[0]
const TODAY = '2026-09-07'

// ---------- deterministic data ----------
let s = 20260907
const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32 }
const iso = d => d.toISOString().slice(0, 10)
const addDays = (day, n) => { const d = new Date(day + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return iso(d) }
const isoWeekday = day => { const w = new Date(day + 'T00:00:00Z').getUTCDay(); return w === 0 ? 7 : w }
const stamp = '2026-09-07T08:00:00.000Z'

const habits = [
  { id: 'h1', name: 'Read 20 pages', colour: 'blue', start: '2026-01-05', cadence: 'daily', weekdays: null, target: null, weight: 3, rate: 0.93 },
  { id: 'h2', name: 'Morning run', colour: 'orange', start: '2026-03-02', cadence: 'weekdays', weekdays: [1, 3, 5], target: null, weight: 2, rate: 0.84 },
  { id: 'h3', name: 'Gym', colour: 'rose', start: '2026-02-16', cadence: 'weekly_quota', weekdays: null, target: 3, weight: 2, rate: 0.8 },
  { id: 'h4', name: 'Write journal', colour: 'teal', start: '2026-05-04', cadence: 'weekdays', weekdays: [1, 2, 3, 4, 5], target: null, weight: 2, rate: 0.78 },
  { id: 'h5', name: 'Meditate', colour: 'purple', start: '2026-04-13', cadence: 'daily', weekdays: null, target: null, weight: 1, rate: 0.7 },
  { id: 'h6', name: 'Spanish lesson', colour: 'emerald', start: '2026-06-22', cadence: 'daily', weekdays: null, target: null, weight: 2, rate: 0.55 },
]

const rows = { profiles: [], habits: [], habit_schedules: [], day_entries: [], meta: [{ key: 'last_user_id', value: USER }] }
rows.profiles.push({ id: USER, day_start_minutes: 240, theme: 'system', reminder_enabled: true, reminder_minutes: 1260, timezone: 'Asia/Karachi', last_clear_day: null, updated_at: stamp })

const NOTES = {
  'h2|2026-08-19': 'Rain. Treadmill instead, 5k.',
  'h2|2026-09-04': 'Best pace since March.',
  'h1|2026-08-30': 'Finished The Left Hand of Darkness.',
  'h4|2026-07-15': 'Short one, late night.',
}

habits.forEach((h, i) => {
  rows.habits.push({ id: h.id, user_id: USER, name: h.name, colour: h.colour, start_date: h.start, archived_at: null, sort_order: i, updated_at: stamp, deleted_at: null })
  rows.habit_schedules.push({ id: 's' + h.id, habit_id: h.id, user_id: USER, effective_from: h.start, cadence_type: h.cadence, weekdays: h.weekdays, weekly_target: h.target, weight: h.weight, updated_at: stamp, deleted_at: null })

  const put = (day, kind) => rows.day_entries.push({ habit_id: h.id, day, user_id: USER, kind, value: null, note: NOTES[h.id + '|' + day] ?? null, updated_at: stamp, deleted_at: null })

  if (h.cadence === 'weekly_quota') {
    // walk ISO weeks; meet the quota most weeks
    let day = h.start
    while (day <= TODAY) {
      const wd = isoWeekday(day)
      const weekStart = addDays(day, 1 - wd)
      const hit = rnd() < h.rate ? h.target + (rnd() < 0.3 ? 1 : 0) : h.target - 1
      const days = [0, 1, 2, 3, 4, 5, 6].sort(() => rnd() - 0.5).slice(0, hit).map(o => addDays(weekStart, o))
      for (const d of days) if (d >= h.start && d <= TODAY) put(d, 'completed')
      day = addDays(weekStart, 7)
    }
    return
  }

  const scheduled = d => h.cadence === 'daily' || h.weekdays.includes(isoWeekday(d))
  for (let d = h.start; d <= TODAY; d = addDays(d, 1)) {
    if (!scheduled(d)) continue
    // ramp: Spanish improves over time, Meditate dips mid-summer
    let p = h.rate
    if (h.id === 'h6') p = 0.35 + 0.6 * ((Date.parse(d) - Date.parse(h.start)) / (Date.parse(TODAY) - Date.parse(h.start)))
    if (h.id === 'h5' && d >= '2026-07-01' && d <= '2026-07-20') p = 0.3
    // current streaks: the last stretch is solid for the top two
    if (h.id === 'h1' && d >= '2026-07-28') p = 1
    if (h.id === 'h2' && d >= '2026-08-10') p = 1
    if (h.id === 'h4' && d >= '2026-08-24') p = 1
    if (NOTES[h.id + '|' + d]) p = 1
    if (rnd() < p) put(d, 'completed')
  }
  // freezes on the reading habit: a token spent to keep the run alive
  if (h.id === 'h1') for (const d of ['2026-08-14', '2026-06-03']) {
    const i = rows.day_entries.findIndex(e => e.habit_id === 'h1' && e.day === d)
    if (i >= 0) rows.day_entries.splice(i, 1)
    put(d, 'frozen')
  }
})

// ---------- fake session ----------
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url')
const exp = Math.floor(Date.now() / 1000) + 365 * 86400
const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: USER, aud: 'authenticated', role: 'authenticated', exp, email: 'you@example.com' })}.c2ln`
const session = {
  access_token: jwt, token_type: 'bearer', expires_in: 365 * 86400, expires_at: exp, refresh_token: 'fake',
  user: { id: USER, aud: 'authenticated', role: 'authenticated', email: 'you@example.com', app_metadata: { provider: 'google', providers: ['google'] }, user_metadata: {}, identities: [], created_at: '2026-09-05T00:00:00Z', updated_at: '2026-09-05T00:00:00Z' },
}

async function open(browser, { colorScheme, width, range = 'year', scale = 2, statWindow = '30' }) {
  const ctx = await browser.newContext({ viewport: { width, height: 1200 }, deviceScaleFactor: scale, colorScheme })
  await ctx.route(/supabase\.co/, route => {
    const url = route.request().url()
    if (url.includes('/rest/v1/')) return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'content-range': '*/0' }, body: '[]' })
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  })
  await ctx.addInitScript(([key, value, range, statWindow]) => {
    localStorage.setItem(key, value)
    localStorage.setItem('range', range)
    localStorage.setItem('stats-window', statWindow)
    localStorage.setItem('theme', 'system')
  }, [`sb-${REF}-auth-token`, JSON.stringify(session), range, statWindow])
  const page = await ctx.newPage()
  page.on('pageerror', e => console.error('pageerror', e.message))
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.waitForSelector('text=No habits yet', { timeout: 15000 }).catch(() => {})
  await page.evaluate(async rows => {
    const req = indexedDB.open('habit-tracker')
    const db = await new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error) })
    const tx = db.transaction(Object.keys(rows), 'readwrite')
    for (const [store, list] of Object.entries(rows)) for (const r of list) tx.objectStore(store).put(r)
    await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error) })
    db.close()
  }, rows)
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForSelector('.habits li', { timeout: 15000 })
  await page.waitForTimeout(800)
  return { ctx, page }
}

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const HIDE = '.card p:has(button.linkish) { display: none !important; }'
try {
  for (const scheme of ['light', 'dark']) {
    // Desktop: the main card at year range, and the statistics card
    {
      const { ctx, page } = await open(browser, { colorScheme: scheme, width: 880, range: 'year' })
      await page.addStyleTag({ content: HIDE })
      await page.locator('.card').nth(1).screenshot({ path: `${OUT}habits-year-${scheme}.png` })
      const stats = page.locator('.card').nth(2)
      await stats.locator('button', { hasText: '90d' }).click()
      await page.waitForTimeout(300)
      await stats.screenshot({ path: `${OUT}stats-${scheme}.png` })
      await ctx.close()
    }
    // Phone: quarter range, then a day detail sheet and the share sheet
    {
      const { ctx, page } = await open(browser, { colorScheme: scheme, width: 430, range: 'quarter' })
      await page.addStyleTag({ content: HIDE })
      await page.locator('.card').nth(1).screenshot({ path: `${OUT}habits-quarter-phone-${scheme}.png` })
      const cells = page.locator('.habits li').nth(1).locator('.hcell--completed')
      await cells.nth((await cells.count()) - 2).click()
      await page.waitForSelector('.sheet')
      await page.waitForTimeout(300)
      await page.locator('.sheet').screenshot({ path: `${OUT}day-detail-${scheme}.png` })
      await page.locator('.sheet button', { hasText: 'Close' }).click()
      await page.locator('.habits li').first().locator('button.chip', { hasText: 'Share' }).click()
      await page.waitForSelector('.share-preview canvas')
      await page.locator('.sheet button', { hasText: 'Year' }).click()
      await page.waitForTimeout(600)
      await page.locator('.sheet').screenshot({ path: `${OUT}share-card-${scheme}.png` })
      await ctx.close()
    }
  }
  console.log('ok', OUT)
} finally {
  await browser.close()
}
