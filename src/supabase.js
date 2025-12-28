import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// ============ AUTH ============
export async function signInWithGoogle() {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin }
  })
  return { data, error }
}

export async function signInWithEmail(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  return { data, error }
}

export async function signUpWithEmail(email, password) {
  const { data, error } = await supabase.auth.signUp({ email, password })
  return { data, error }
}

export async function signOut() {
  const { error } = await supabase.auth.signOut()
  return { error }
}

// ============ PROFILES ============
export async function getProfile(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single()
  return { data, error }
}

export async function updateProfile(userId, updates) {
  const { data, error } = await supabase
    .from('profiles')
    .upsert({ id: userId, ...updates, updated_at: new Date().toISOString() })
    .select()
    .single()
  return { data, error }
}

// ============ RIDES ============
export async function saveRide(ride) {
  const { data, error } = await supabase
    .from('rides')
    .insert(ride)
    .select()
    .single()
  return { data, error }
}

export async function getUserRides(userId, limit = 100) {
  const { data, error } = await supabase
    .from('rides')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit)
  return { data, error }
}

// ============ TILES ============
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

// ============ ROUTE UNLOCKS ============
export async function getRouteUnlocks(userId) {
  const { data, error } = await supabase
    .from('route_unlocks')
    .select('*')
    .eq('user_id', userId)
    .eq('is_unlocked', true)
  return { data, error }
}

export async function checkRouteProgress(userId, routeSignature) {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const { data, error } = await supabase
    .from('rides')
    .select('id')
    .eq('user_id', userId)
    .eq('route_signature', routeSignature)
    .gte('started_at', weekAgo)
  return { count: data?.length || 0, error }
}

// ============ THREATS ============
export async function getActiveThreats(userId) {
  const { data, error } = await supabase
    .from('route_threats')
    .select('*')
    .eq('defender_user_id', userId)
    .eq('status', 'active')
  return { data, error }
}

// ============ LEADERBOARD ============
export async function getLeaderboard(limit = 50) {
  const { data, error } = await supabase
    .from('leaderboard')
    .select('*')
    .order('tiles_owned', { ascending: false })
    .limit(limit)
  return { data, error }
}

export async function getClanLeaderboard(limit = 20) {
  const { data, error } = await supabase
    .from('clan_leaderboard')
    .select('*')
    .order('total_tiles', { ascending: false })
    .limit(limit)
  return { data, error }
}

// ============ CLANS ============
export async function createClan(clan) {
  const { data, error } = await supabase
    .from('clans')
    .insert(clan)
    .select()
    .single()
  return { data, error }
}

export async function getClan(clanId) {
  const { data, error } = await supabase
    .from('clans')
    .select('*, clan_members(*, profiles(*))')
    .eq('id', clanId)
    .single()
  return { data, error }
}

export async function getPublicClans() {
  const { data, error } = await supabase
    .from('clans')
    .select('*, clan_members(count)')
    .eq('is_public', true)
    .order('total_tiles', { ascending: false })
    .limit(20)
  return { data, error }
}

export async function getClanByInviteCode(code) {
  const { data, error } = await supabase
    .from('clans')
    .select('*')
    .eq('invite_code', code.toUpperCase())
    .single()
  return { data, error }
}

export async function joinClan(clanId, userId) {
  // Add to clan_members
  const { error: memberError } = await supabase
    .from('clan_members')
    .insert({ clan_id: clanId, user_id: userId, role: 'member' })
  
  if (memberError) return { error: memberError }
  
  // Update profile
  const { data, error } = await supabase
    .from('profiles')
    .update({ clan_id: clanId })
    .eq('id', userId)
    .select()
    .single()
  
  return { data, error }
}

export async function leaveClan(clanId, userId) {
  // Remove from clan_members
  await supabase
    .from('clan_members')
    .delete()
    .eq('clan_id', clanId)
    .eq('user_id', userId)
  
  // Update profile
  const { data, error } = await supabase
    .from('profiles')
    .update({ clan_id: null })
    .eq('id', userId)
    .select()
    .single()
  
  return { data, error }
}

export async function updateClan(clanId, updates) {
  const { data, error } = await supabase
    .from('clans')
    .update(updates)
    .eq('id', clanId)
    .select()
    .single()
  return { data, error }
}

export async function deleteClan(clanId) {
  const { error } = await supabase
    .from('clans')
    .delete()
    .eq('id', clanId)
  return { error }
}

// ============ ACHIEVEMENTS ============
export async function getUserAchievements(userId) {
  const { data, error } = await supabase
    .from('user_achievements')
    .select('*')
    .eq('user_id', userId)
  return { data, error }
}

export async function unlockAchievement(userId, achievementId) {
  const { data, error } = await supabase
    .from('user_achievements')
    .insert({ user_id: userId, achievement_id: achievementId })
    .select()
    .single()
  return { data, error }
}

// ============ STATS ============
export async function getUserStats(userId) {
  const { data: rides } = await getUserRides(userId)
  const { data: tiles } = await getUserTiles(userId)
  const { data: unlocks } = await getRouteUnlocks(userId)
  
  const totalDistance = rides?.reduce((sum, r) => sum + (r.distance_m || 0), 0) || 0
  const totalTime = rides?.reduce((sum, r) => sum + (r.duration_sec || 0), 0) || 0
  const totalTiles = tiles?.length || 0
  const totalRoutes = unlocks?.length || 0
  
  return {
    totalRides: rides?.length || 0,
    totalDistance,
    totalTime,
    totalTiles,
    totalRoutes,
  }
}
