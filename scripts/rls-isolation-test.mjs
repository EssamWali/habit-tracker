/**
 * V0-2 acceptance test: cross-user isolation on every table.
 *
 * The anon key is public by design, so row-level security is the only thing
 * between a stranger reading the JS bundle and every user's data. This test
 * asserts that, per table and per operation, rather than trusting that the
 * policies were written correctly.
 *
 *   node scripts/rls-isolation-test.mjs
 *
 * NOTE: sign-ups are disabled on this project (single-user app), so this test
 * will fail with "Signups not allowed" until you temporarily re-enable
 * Authentication -> Sign In / Providers -> "Allow new users to sign up".
 * Turn it back off afterwards.
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n')
    .filter(l => l.trim() && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }),
)

const URL_ = env.VITE_SUPABASE_URL
const KEY = env.VITE_SUPABASE_ANON_KEY
if (!URL_ || !KEY) throw new Error('VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY missing from .env.local')

const anon = () => createClient(URL_, KEY, { auth: { persistSession: false, autoRefreshToken: false } })
const stamp = Date.now()
const results = []
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail })
  console.log(`${pass ? '  \x1b[32mPASS\x1b[0m' : '  \x1b[31mFAIL\x1b[0m'}  ${name}${detail ? `  — ${detail}` : ''}`)
}

async function makeUser(tag) {
  const client = anon()
  // Supabase rejects reserved domains such as example.com. No mail is sent:
  // this test requires email confirmation to be off.
  const email = `rls.${tag}.${stamp}@gmail.com`
  const password = `Test-${stamp}-${tag}!aA1`
  const { data, error } = await client.auth.signUp({ email, password })
  if (error) {
    if (/signup|not allowed|disabled/i.test(error.message)) {
      throw new Error(
        'Sign-ups are disabled on this project, which is the intended steady state.
' +
        '  To run this test, temporarily enable Authentication -> Sign In / Providers ->
' +
        '  "Allow new users to sign up", then turn it off again afterwards.',
      )
    }
    throw new Error(`signUp(${tag}) failed: ${error.message}`)
  }
  if (!data.session) {
    throw new Error(
      'Sign-up returned no session, which means email confirmation is ON.\n' +
      '  Dashboard -> Authentication -> Sign In / Providers -> Email -> turn OFF "Confirm email", then re-run.',
    )
  }
  return { client, id: data.user.id, email }
}

console.log('\nV0-2 · cross-user isolation\n')

const A = await makeUser('a')
const B = await makeUser('b')
console.log(`  user A ${A.id}\n  user B ${B.id}\n`)

// --- A creates one row in every table -------------------------------------
const today = new Date().toISOString().slice(0, 10)

const { data: habit, error: hErr } = await A.client
  .from('habits')
  .insert({ user_id: A.id, name: 'A private habit', colour: 'emerald', start_date: today })
  .select().single()
if (hErr) throw new Error(`A could not create a habit: ${hErr.message}`)

const { data: sched, error: sErr } = await A.client
  .from('habit_schedules')
  .insert({ habit_id: habit.id, user_id: A.id, effective_from: today, cadence_type: 'daily', weight: 2 })
  .select().single()
if (sErr) throw new Error(`A could not create a schedule: ${sErr.message}`)

const { error: eErr } = await A.client
  .from('day_entries')
  .insert({ habit_id: habit.id, user_id: A.id, day: today, kind: 'completed' })
if (eErr) throw new Error(`A could not create a day entry: ${eErr.message}`)

console.log('  A seeded habits / habit_schedules / day_entries\n')

// --- B must not be able to touch any of it --------------------------------
const targets = [
  { table: 'profiles',        match: { id: A.id },                      patch: { theme: 'dark' } },
  { table: 'habits',          match: { id: habit.id },                  patch: { name: 'hijacked' } },
  { table: 'habit_schedules', match: { id: sched.id },                  patch: { weight: 3 } },
  { table: 'day_entries',     match: { habit_id: habit.id, day: today }, patch: { kind: 'frozen' } },
]

for (const { table, match, patch } of targets) {
  const sel = await B.client.from(table).select('*').match(match)
  check(`${table.padEnd(16)} SELECT blocked`, !sel.error && sel.data.length === 0,
    sel.error ? sel.error.message : `${sel.data?.length ?? '?'} rows visible`)

  const upd = await B.client.from(table).update(patch).match(match).select()
  check(`${table.padEnd(16)} UPDATE blocked`, !!upd.error || upd.data?.length === 0,
    upd.error ? 'rejected' : `${upd.data?.length} rows changed`)

  const del = await B.client.from(table).delete().match(match).select()
  check(`${table.padEnd(16)} DELETE blocked`, !!del.error || del.data?.length === 0,
    del.error ? 'rejected' : `${del.data?.length} rows deleted`)
}

// --- B must not be able to forge rows owned by A --------------------------
const forge = await B.client
  .from('habits')
  .insert({ user_id: A.id, name: 'forged', colour: 'red', start_date: today })
  .select()
check('habits           INSERT spoofing blocked', !!forge.error, forge.error ? 'rejected by WITH CHECK' : 'row was created')

// --- A can still see its own data (policies are not simply denying all) ---
const own = await A.client.from('habits').select('*').eq('id', habit.id)
check('owner can still read own row', !own.error && own.data?.length === 1,
  own.error ? own.error.message : `${own.data?.length} rows`)

// --- lww_guard: a stale write must not clobber a newer one -----------------
// Deployed in 0001_init.sql. PostgREST emits an unconditional ON CONFLICT DO
// UPDATE, so without the trigger a device that was offline for a week would
// silently overwrite newer data on reconnect.
{
  const fresh = new Date().toISOString()
  const stale = new Date(Date.now() - 86_400_000).toISOString()

  await A.client.from('habits').update({ name: 'newer', updated_at: fresh }).eq('id', habit.id)
  await A.client.from('habits').update({ name: 'stale overwrite', updated_at: stale }).eq('id', habit.id)

  const { data } = await A.client.from('habits').select('name').eq('id', habit.id).single()
  check('lww_guard rejects stale write', data?.name === 'newer', `name is "${data?.name}"`)

  const newer = new Date(Date.now() + 60_000).toISOString()
  await A.client.from('habits').update({ name: 'genuinely newer', updated_at: newer }).eq('id', habit.id)
  const { data: after } = await A.client.from('habits').select('name').eq('id', habit.id).single()
  check('lww_guard accepts newer write', after?.name === 'genuinely newer', `name is "${after?.name}"`)
}

// --- cleanup ---------------------------------------------------------------
await A.client.from('habits').delete().eq('id', habit.id)   // cascades

const failed = results.filter(r => !r.pass)
console.log(`\n  ${results.length - failed.length}/${results.length} passed\n`)
if (failed.length) {
  console.log('  Test users remain in auth.users; delete them from Authentication -> Users.\n')
  process.exit(1)
}
console.log('  V0-2 acceptance met. Test users remain in auth.users; delete them from Authentication -> Users.\n')
