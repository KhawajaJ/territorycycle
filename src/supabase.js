import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Auth helpers
export async function signInWithGoogle() {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin
    }
  })
  return { data, error }
}

export async function signInWithEmail(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password
  })
  return { data, error }
}

export async function signUpWithEmail(email, password) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password
  })
  return { data, error }
}

export async function signOut() {
  const { error } = await supabase.auth.signOut()
  return { error }
}

export async function getCurrentUser() {
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

// Database helpers
export async function saveRide(ride) {
  const { data, error } = await supabase
    .from('rides')
    .insert(ride)
    .select()
    .single()
  return { data, error }
}

export async function getUserRides(userId) {
  const { data, error } = await supabase
    .from('rides')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
  return { data, error }
}

export async function getRouteUnlock(userId, routeSignature) {
  const { data, error } = await supabase
    .from('route_unlocks')
    .select('*')
    .eq('user_id', userId)
    .eq('route_signature', routeSignature)
    .single()
  return { data, error }
}

export async function upsertRouteUnlock(unlock) {
  const { data, error } = await supabase
    .from('route_unlocks')
    .upsert(unlock, { onConflict: 'user_id,route_signature' })
    .select()
    .single()
  return { data, error }
}

export async function getUserTiles(userId) {
  const { data, error } = await supabase
    .from('tiles')
    .select('*')
    .eq('current_owner_user_id', userId)
  return { data, error }
}

export async function claimTiles(tiles) {
  const { data, error } = await supabase
    .from('tiles')
    .upsert(tiles, { onConflict: 'h3_index' })
  return { data, error }
}

export async function getLeaderboard() {
  const { data, error } = await supabase
    .from('leaderboard')
    .select('*')
    .order('tiles_owned', { ascending: false })
    .limit(50)
  return { data, error }
}

export async function getActiveThreats(userId) {
  const { data, error } = await supabase
    .from('route_threats')
    .select('*')
    .eq('defender_user_id', userId)
    .eq('status', 'active')
  return { data, error }
}
