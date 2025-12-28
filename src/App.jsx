import React, { useState, useEffect, useRef, useCallback, createContext, useContext, useMemo } from 'react'
import { MapPin, Play, Pause, Square, Trophy, Shield, Bell, User, Target, Clock, TrendingUp, Award, LogOut, Mail, AlertCircle, Loader2, CheckCircle, X, Navigation, Camera, Save, ChevronRight, Zap, Flag, Star, HelpCircle, Users, Crown, Swords, Calendar, Flame, Gift, Lock, Unlock, StopCircle, ChevronLeft, Plus, Search, Settings, Copy, Share2, Check } from 'lucide-react'
import { supabase } from './supabase'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { latLngToCell, cellToBoundary } from 'h3-js'

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN

const CONFIG = {
  H3_RESOLUTION: 10,
  MIN_RIDE_POINTS: 10,
  MIN_ACCURACY_METERS: 50,
  MAX_SPEED_MS: 18,
  UNLOCK_THRESHOLD: 3,
  UNLOCK_WINDOW_DAYS: 7,
  TERRITORY_DECAY_DAYS: 7,
}

const AVATAR_OPTIONS = {
  backgrounds: ['#06b6d4', '#a855f7', '#f59e0b', '#10b981', '#ef4444', '#3b82f6', '#ec4899', '#8b5cf6'],
  icons: ['🚴', '🚴‍♂️', '🚴‍♀️', '🏆', '⚡', '🔥', '💪', '🎯', '🌟', '👑', '🦁', '🐯', '🦅', '🐺'],
}

const ACHIEVEMENTS = [
  { id: 'first_ride', name: 'First Pedal', desc: 'Complete your first ride', icon: '🚴', xp: 50 },
  { id: 'explorer_100', name: 'Explorer', desc: 'Touch 100 different tiles', icon: '🗺️', xp: 100 },
  { id: 'conqueror_50', name: 'Conqueror', desc: 'Own 50 tiles', icon: '👑', xp: 200 },
  { id: 'streak_7', name: 'Week Warrior', desc: 'Ride 7 days in a row', icon: '🔥', xp: 250 },
  { id: 'streak_30', name: 'Monthly Master', desc: 'Ride 30 days in a row', icon: '💎', xp: 500 },
  { id: 'century', name: 'Century Rider', desc: 'Ride 100km total', icon: '💯', xp: 300 },
  { id: 'clan_founder', name: 'Clan Founder', desc: 'Create a clan', icon: '⚔️', xp: 100 },
  { id: 'route_master', name: 'Route Master', desc: 'Unlock 10 different routes', icon: '🛤️', xp: 350 },
]

const LEVEL_XP = [0, 100, 250, 500, 1000, 1750, 2750, 4000, 5500, 7500, 10000]

const haversine = (lat1, lon1, lat2, lon2) => {
  const R = 6371000
  const φ1 = (lat1 * Math.PI) / 180, φ2 = (lat2 * Math.PI) / 180
  const Δφ = ((lat2 - lat1) * Math.PI) / 180, Δλ = ((lon2 - lon1) * Math.PI) / 180
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

const sha256 = async (msg) => {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(msg))
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('')
}

const formatDuration = (sec) => {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60)
  return h > 0 ? `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}` : `${m}:${s.toString().padStart(2, '0')}`
}

const getLevel = (xp) => { for (let i = LEVEL_XP.length - 1; i >= 0; i--) if (xp >= LEVEL_XP[i]) return i + 1; return 1 }
const getXpProgress = (xp) => {
  const lvl = getLevel(xp), curr = LEVEL_XP[lvl - 1] || 0, next = LEVEL_XP[lvl] || LEVEL_XP[LEVEL_XP.length - 1]
  return Math.min(((xp - curr) / (next - curr)) * 100, 100)
}
const getDaysUntilDecay = (lastRide) => lastRide ? Math.max(0, CONFIG.TERRITORY_DECAY_DAYS - Math.floor((Date.now() - new Date(lastRide).getTime()) / 86400000)) : 0

const AppContext = createContext(null)
const useApp = () => useContext(AppContext)

function Toast({ message, type, onClose }) {
  useEffect(() => { const t = setTimeout(onClose, 4000); return () => clearTimeout(t) }, [onClose])
  const colors = { success: 'bg-emerald-600', error: 'bg-red-600', warning: 'bg-amber-600', info: 'bg-cyan-600', achievement: 'bg-gradient-to-r from-amber-500 to-orange-600', levelup: 'bg-gradient-to-r from-purple-500 to-pink-600' }
  const icons = { success: CheckCircle, error: AlertCircle, warning: AlertCircle, info: Bell, achievement: Award, levelup: Star }
  const Icon = icons[type] || Bell
  return (
    <div className={`${colors[type]} text-white px-4 py-3 rounded-xl shadow-lg flex items-center gap-3 animate-slide-up`}>
      <Icon className="w-5 h-5" /><span className="flex-1 text-sm font-medium">{message}</span>
      <button onClick={onClose}><X className="w-4 h-4" /></button>
    </div>
  )
}

function ToastContainer({ toasts, removeToast }) {
  return <div className="fixed bottom-24 left-4 right-4 z-50 flex flex-col gap-2">{toasts.map(t => <Toast key={t.id} {...t} onClose={() => removeToast(t.id)} />)}</div>
}

function Confetti({ active }) {
  if (!active) return null
  return (
    <div className="fixed inset-0 pointer-events-none z-50 overflow-hidden">
      {[...Array(50)].map((_, i) => (
        <div key={i} className="absolute w-3 h-3 animate-confetti" style={{ left: `${Math.random() * 100}%`, animationDelay: `${Math.random() * 2}s`, backgroundColor: ['#06b6d4', '#a855f7', '#f59e0b', '#10b981', '#ef4444'][Math.floor(Math.random() * 5)], transform: `rotate(${Math.random() * 360}deg)` }} />
      ))}
    </div>
  )
}

function AvatarDisplay({ avatar, size = 'md', className = '' }) {
  const sizes = { sm: 'w-10 h-10 text-lg', md: 'w-16 h-16 text-2xl', lg: 'w-24 h-24 text-4xl', xl: 'w-32 h-32 text-5xl' }
  return (
    <div className={`${sizes[size]} rounded-full flex items-center justify-center ${className}`} style={{ backgroundColor: avatar?.background || AVATAR_OPTIONS.backgrounds[0] }}>
      {avatar?.photo_url ? <img src={avatar.photo_url} alt="" className="w-full h-full rounded-full object-cover" /> : <span>{avatar?.icon || '🚴'}</span>}
    </div>
  )
}

function LevelBadge({ level, size = 'sm' }) {
  const sizes = { sm: 'w-6 h-6 text-xs', md: 'w-8 h-8 text-sm', lg: 'w-10 h-10 text-base' }
  const colors = level >= 10 ? 'from-amber-400 to-orange-600' : level >= 7 ? 'from-purple-400 to-pink-600' : level >= 4 ? 'from-cyan-400 to-blue-600' : 'from-slate-400 to-slate-600'
  return <div className={`${sizes[size]} bg-gradient-to-br ${colors} rounded-full flex items-center justify-center font-bold text-white shadow-lg`}>{level}</div>
}

function StreakBadge({ streak }) {
  if (!streak || streak < 2) return null
  return <div className={`flex items-center gap-1 ${streak >= 7 ? 'text-orange-400' : streak >= 3 ? 'text-amber-400' : 'text-slate-400'}`}><Flame className="w-4 h-4" /><span className="font-bold text-sm">{streak}</span></div>
}

export default function App() {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [currentPage, setCurrentPage] = useState('onboarding')
  const [toasts, setToasts] = useState([])
  const [rides, setRides] = useState([])
  const [tiles, setTiles] = useState([])
  const [routeUnlocks, setRouteUnlocks] = useState([])
  const [lastRide, setLastRide] = useState(null)
  const [threats, setThreats] = useState([])
  const [showTutorial, setShowTutorial] = useState(false)
  const [showConfetti, setShowConfetti] = useState(false)
  const [clan, setClan] = useState(null)
  const [achievements, setAchievements] = useState([])
  const [streak, setStreak] = useState(0)

  const addToast = useCallback((message, type = 'info') => setToasts(p => [...p, { id: Date.now(), message, type }]), [])
  const removeToast = useCallback((id) => setToasts(p => p.filter(t => t.id !== id)), [])
  const triggerConfetti = useCallback(() => { setShowConfetti(true); setTimeout(() => setShowConfetti(false), 3000) }, [])

  const addXp = useCallback(async (amount, reason) => {
    if (!user || !profile) return
    const oldLvl = getLevel(profile.xp || 0), newXp = (profile.xp || 0) + amount, newLvl = getLevel(newXp)
    const { data } = await supabase.from('profiles').update({ xp: newXp }).eq('id', user.id).select().single()
    if (data) { setProfile(data); addToast(`+${amount} XP - ${reason}`, 'success'); if (newLvl > oldLvl) { triggerConfetti(); addToast(`🎉 Level Up! You're now level ${newLvl}!`, 'levelup') } }
  }, [user, profile, addToast, triggerConfetti])

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      if (session?.user) { loadUserProfile(session.user.id); loadUserData(session.user.id) }
      else setLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      setUser(session?.user ?? null)
      if (session?.user) { loadUserProfile(session.user.id); loadUserData(session.user.id) }
      else { setCurrentPage('onboarding'); setProfile(null); setLoading(false) }
    })
    return () => subscription.unsubscribe()
  }, [])

  const loadUserProfile = async (userId) => {
    try {
      const { data } = await supabase.from('profiles').select('*').eq('id', userId).single()
      if (data) {
        setProfile(data)
        if (!data.first_name || !data.last_name) setCurrentPage('profileSetup')
        else if (!data.tutorial_completed) { setCurrentPage('home'); setShowTutorial(true) }
        else setCurrentPage('home')
        if (data.clan_id) loadClan(data.clan_id)
        loadAchievements(userId)
        calculateStreak(userId)
      } else setCurrentPage('profileSetup')
    } catch { setCurrentPage('profileSetup') }
    finally { setLoading(false) }
  }

  const loadUserData = async (userId) => {
    const [ridesRes, tilesRes, threatsRes, unlocksRes] = await Promise.all([
      supabase.from('rides').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
      supabase.from('tiles').select('*').eq('current_owner_user_id', userId),
      supabase.from('route_threats').select('*').eq('defender_user_id', userId).eq('status', 'active'),
      supabase.from('route_unlocks').select('*').eq('user_id', userId).eq('is_unlocked', true)
    ])
    if (ridesRes.data) setRides(ridesRes.data)
    if (tilesRes.data) setTiles(tilesRes.data)
    if (threatsRes.data) setThreats(threatsRes.data)
    if (unlocksRes.data) setRouteUnlocks(unlocksRes.data)
  }

  const loadClan = async (clanId) => {
    const { data } = await supabase.from('clans').select('*, clan_members(*, profiles(*))').eq('id', clanId).single()
    if (data) setClan(data)
  }

  const loadAchievements = async (userId) => {
    const { data } = await supabase.from('user_achievements').select('*').eq('user_id', userId)
    if (data) setAchievements(data.map(a => a.achievement_id))
  }

  const calculateStreak = async (userId) => {
    const { data } = await supabase.from('rides').select('started_at').eq('user_id', userId).order('started_at', { ascending: false }).limit(60)
    if (!data?.length) { setStreak(0); return }
    let s = 0, d = new Date(); d.setHours(0,0,0,0)
    const dates = [...new Set(data.map(r => { const x = new Date(r.started_at); x.setHours(0,0,0,0); return x.getTime() }))].sort((a,b) => b-a)
    for (const rd of dates) { if (d.getTime() - rd <= 86400000) { s++; d = new Date(rd) } else break }
    setStreak(s)
  }

  const completeTutorial = async () => { setShowTutorial(false); if (user) await supabase.from('profiles').update({ tutorial_completed: true }).eq('id', user.id) }

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    setUser(null); setProfile(null); setRides([]); setTiles([]); setClan(null); setCurrentPage('onboarding')
    addToast('Signed out', 'info')
  }

  const ctx = { user, profile, setProfile, rides, setRides, tiles, setTiles, routeUnlocks, setRouteUnlocks, threats, setThreats, currentPage, setCurrentPage, addToast, lastRide, setLastRide, handleSignOut, loadUserData, triggerConfetti, showTutorial, setShowTutorial, completeTutorial, clan, setClan, loadClan, achievements, setAchievements, loadAchievements, streak, setStreak, calculateStreak, addXp }

  if (loading) return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center">
      <div className="text-center space-y-4">
        <div className="relative"><div className="w-16 h-16 border-4 border-cyan-500/30 rounded-full animate-spin border-t-cyan-500"></div><MapPin className="w-8 h-8 text-cyan-400 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" /></div>
        <p className="text-slate-400">Loading TerritoryCycle...</p>
      </div>
    </div>
  )

  return (
    <AppContext.Provider value={ctx}>
      <div className="min-h-screen bg-slate-900">
        {currentPage === 'onboarding' && <OnboardingScreen />}
        {currentPage === 'auth' && <AuthScreen />}
        {currentPage === 'profileSetup' && user && <ProfileSetupScreen />}
        {user && profile && !['onboarding', 'auth', 'profileSetup'].includes(currentPage) && <MainApp />}
        <ToastContainer toasts={toasts} removeToast={removeToast} />
        <Confetti active={showConfetti} />
        {showTutorial && <TutorialOverlay />}
      </div>
      <style>{`
        @keyframes slide-up { from { transform: translateY(100%); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        @keyframes fade-in { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes pulse-glow { 0%, 100% { box-shadow: 0 0 20px rgba(6, 182, 212, 0.3); } 50% { box-shadow: 0 0 40px rgba(6, 182, 212, 0.6); } }
        @keyframes confetti { 0% { transform: translateY(-10vh) rotate(0deg); opacity: 1; } 100% { transform: translateY(100vh) rotate(720deg); opacity: 0; } }
        @keyframes float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-10px); } }
        .animate-slide-up { animation: slide-up 0.3s ease-out; }
        .animate-fade-in { animation: fade-in 0.4s ease-out; }
        .animate-pulse-glow { animation: pulse-glow 2s ease-in-out infinite; }
        .animate-confetti { animation: confetti 3s ease-out forwards; }
        .animate-float { animation: float 3s ease-in-out infinite; }
      `}</style>
    </AppContext.Provider>
  )
}

function TutorialOverlay() {
  const { completeTutorial } = useApp()
  const [step, setStep] = useState(1)
  const steps = [
    { icon: <MapPin className="w-16 h-16 text-cyan-400" />, title: "Welcome to TerritoryCycle!", desc: "Claim territory by cycling consistently through your city.", hl: "30 second tutorial" },
    { icon: <Navigation className="w-16 h-16 text-emerald-400" />, title: "Record Your Rides", desc: "Tap 'Start Ride' to track your route with GPS.", hl: "Every ride counts" },
    { icon: <Target className="w-16 h-16 text-purple-400" />, title: "Unlock Routes", desc: "Ride the same route 3 times in 7 days to unlock it.", hl: "3 rides = 1 route unlocked" },
    { icon: <Flag className="w-16 h-16 text-amber-400" />, title: "Claim Territory", desc: "Unlocked routes let you claim all tiles along them!", hl: "Build your empire" },
    { icon: <Shield className="w-16 h-16 text-red-400" />, title: "Keep It Active", desc: "Tiles decay after 7 days without riding. Stay active!", hl: "Use it or lose it" },
    { icon: <Users className="w-16 h-16 text-blue-400" />, title: "Join a Clan", desc: "Team up with other riders and compete together.", hl: "Stronger together" },
    { icon: <Trophy className="w-16 h-16 text-yellow-400" />, title: "Ready to Ride!", desc: "Earn XP, unlock achievements, and dominate the leaderboard!", hl: "Let's go! 🚴" }
  ]
  const s = steps[step - 1]
  
  return (
    <div className="fixed inset-0 bg-slate-900/95 backdrop-blur-sm z-50 flex items-center justify-center p-6">
      <div className="max-w-sm w-full animate-fade-in" key={step}>
        <div className="text-center space-y-6">
          <div className="w-32 h-32 bg-slate-800/50 rounded-3xl flex items-center justify-center mx-auto border border-slate-700 animate-float">{s.icon}</div>
          <div className="space-y-3">
            <h2 className="text-2xl font-bold text-white">{s.title}</h2>
            <p className="text-slate-300">{s.desc}</p>
            <div className="inline-block bg-cyan-500/20 text-cyan-300 text-sm px-4 py-2 rounded-full">{s.hl}</div>
          </div>
          <div className="flex justify-center gap-2">{steps.map((_, i) => <div key={i} className={`h-2 rounded-full transition-all ${i + 1 === step ? 'w-8 bg-cyan-400' : 'w-2 bg-slate-700'}`} />)}</div>
          <div className="space-y-3 pt-4">
            {step < steps.length ? (
              <><button onClick={() => setStep(step + 1)} className="w-full bg-cyan-500 hover:bg-cyan-400 text-slate-900 font-bold py-4 rounded-xl">Next</button>
              <button onClick={completeTutorial} className="w-full text-slate-500 hover:text-slate-300 py-2">Skip</button></>
            ) : <button onClick={completeTutorial} className="w-full bg-gradient-to-r from-cyan-500 to-purple-600 text-white font-bold py-4 rounded-xl">🚴 Start Riding!</button>}
          </div>
        </div>
      </div>
    </div>
  )
}

function OnboardingScreen() {
  const { setCurrentPage } = useApp()
  const [step, setStep] = useState(1)
  const steps = [
    { icon: <MapPin className="w-12 h-12 text-cyan-400" />, title: 'Ride. Repeat. Rule.', desc: 'Turn your rides into territory you own.' },
    { icon: <Target className="w-12 h-12 text-purple-400" />, title: 'Unlock in 7 days', desc: 'Ride the same route 3× to unlock claiming.' },
    { icon: <Shield className="w-12 h-12 text-emerald-400" />, title: 'Stay active', desc: 'Territory decays after 7 days without riding.' },
    { icon: <Navigation className="w-12 h-12 text-amber-400" />, title: 'Enable Location', desc: 'We need GPS to track your rides.' },
  ]
  const requestLocation = async () => { try { await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { timeout: 10000 })) } catch {} setCurrentPage('auth') }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-cyan-900 text-white flex flex-col">
      <div className="flex-1 flex flex-col justify-center px-6 animate-fade-in" key={step}>
        <div className="space-y-8 text-center">
          <div className="w-24 h-24 bg-slate-800/50 rounded-2xl flex items-center justify-center mx-auto border border-slate-700 animate-float">{steps[step-1].icon}</div>
          <h1 className="text-3xl font-bold">{steps[step-1].title}</h1>
          <p className="text-lg text-slate-300 max-w-sm mx-auto">{steps[step-1].desc}</p>
        </div>
      </div>
      <div className="p-6 space-y-4">
        {step < 4 ? <><button onClick={() => setStep(step+1)} className="w-full bg-cyan-500 text-slate-900 font-bold py-4 rounded-xl">Next</button><button onClick={() => setStep(4)} className="w-full text-slate-400 py-2">Skip</button></> :
        <><button onClick={requestLocation} className="w-full bg-cyan-500 text-slate-900 font-bold py-4 rounded-xl">Allow Location</button><button onClick={() => setCurrentPage('auth')} className="w-full text-slate-400 py-2">Not now</button></>}
        <div className="flex justify-center gap-2">{[1,2,3,4].map(s => <div key={s} className={`h-2 w-8 rounded-full ${s === step ? 'bg-cyan-400' : 'bg-slate-700'}`} />)}</div>
      </div>
    </div>
  )
}

function AuthScreen() {
  const { addToast } = useApp()
  const [mode, setMode] = useState(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [isSignUp, setIsSignUp] = useState(false)

  const handleGoogle = async () => {
    setLoading(true)
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } })
    if (error) addToast(error.message, 'error')
    setLoading(false)
  }

  const handleEmail = async () => {
    setError('')
    if (!email || !password) { setError('Fill in all fields'); return }
    if (password.length < 6) { setError('Password must be 6+ chars'); return }
    setLoading(true)
    const { error } = isSignUp ? await supabase.auth.signUp({ email, password }) : await supabase.auth.signInWithPassword({ email, password })
    if (error) setError(error.message)
    else if (isSignUp) addToast('Check email to confirm!', 'success')
    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-cyan-900 text-white flex flex-col justify-center px-6">
      <div className="space-y-8 animate-fade-in">
        <div className="text-center space-y-4">
          <div className="w-20 h-20 bg-gradient-to-br from-cyan-500 to-purple-600 rounded-2xl flex items-center justify-center mx-auto animate-pulse-glow"><MapPin className="w-10 h-10 text-white" /></div>
          <h1 className="text-3xl font-bold">TerritoryCycle</h1>
          <p className="text-slate-400">Sign in to claim territory</p>
        </div>
        {!mode && (
          <div className="space-y-3">
            <button onClick={handleGoogle} disabled={loading} className="w-full bg-white text-slate-900 font-semibold py-4 rounded-xl flex items-center justify-center gap-2 disabled:opacity-50">
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <><svg className="w-5 h-5" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>Continue with Google</>}
            </button>
            <button onClick={() => setMode('email')} className="w-full bg-slate-800 text-white font-semibold py-4 rounded-xl border border-slate-600 flex items-center justify-center gap-2"><Mail className="w-5 h-5" />Continue with Email</button>
          </div>
        )}
        {mode === 'email' && (
          <div className="space-y-4 bg-slate-800/50 rounded-2xl p-6 border border-slate-700">
            <div className="flex gap-2">
              <button onClick={() => setIsSignUp(false)} className={`flex-1 py-2 rounded-lg font-medium ${!isSignUp ? 'bg-cyan-600 text-white' : 'text-slate-400'}`}>Sign In</button>
              <button onClick={() => setIsSignUp(true)} className={`flex-1 py-2 rounded-lg font-medium ${isSignUp ? 'bg-cyan-600 text-white' : 'text-slate-400'}`}>Sign Up</button>
            </div>
            {error && <div className="bg-red-500/20 border border-red-500/50 text-red-300 px-4 py-2 rounded-lg text-sm flex items-center gap-2"><AlertCircle className="w-4 h-4" />{error}</div>}
            <input type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} className="w-full px-4 py-3 rounded-xl bg-slate-900 text-white border border-slate-600 focus:border-cyan-500 focus:outline-none" />
            <input type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} className="w-full px-4 py-3 rounded-xl bg-slate-900 text-white border border-slate-600 focus:border-cyan-500 focus:outline-none" />
            <button onClick={handleEmail} disabled={loading} className="w-full bg-cyan-500 text-slate-900 font-bold py-3 rounded-xl disabled:opacity-50 flex items-center justify-center">{loading ? <Loader2 className="w-5 h-5 animate-spin" /> : isSignUp ? 'Create Account' : 'Sign In'}</button>
            <button onClick={() => setMode(null)} className="w-full text-slate-400 py-2">Back</button>
          </div>
        )}
      </div>
    </div>
  )
}

function ProfileSetupScreen() {
  const { user, setProfile, setCurrentPage, addToast, setShowTutorial } = useApp()
  const [step, setStep] = useState(1)
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [avatar, setAvatar] = useState({ background: AVATAR_OPTIONS.backgrounds[0], icon: AVATAR_OPTIONS.icons[0], photo_url: null })
  const [photoFile, setPhotoFile] = useState(null)
  const [loading, setLoading] = useState(false)
  const fileRef = useRef(null)

  const handlePhoto = (e) => {
    const file = e.target.files[0]
    if (file) {
      if (file.size > 5 * 1024 * 1024) { addToast('Photo must be <5MB', 'error'); return }
      setPhotoFile(file)
      const reader = new FileReader()
      reader.onloadend = () => setAvatar(a => ({ ...a, photo_url: reader.result }))
      reader.readAsDataURL(file)
    }
  }

  const handleSave = async () => {
    if (!firstName.trim() || !lastName.trim()) { addToast('Enter your name', 'error'); return }
    setLoading(true)
    try {
      let photoUrl = null
      if (photoFile) {
        const ext = photoFile.name.split('.').pop()
        const path = `avatars/${user.id}-${Date.now()}.${ext}`
        const { error } = await supabase.storage.from('avatars').upload(path, photoFile)
        if (!error) { const { data } = supabase.storage.from('avatars').getPublicUrl(path); photoUrl = data.publicUrl }
      }
      const { data, error } = await supabase.from('profiles').upsert({
        id: user.id, email: user.email, first_name: firstName.trim(), last_name: lastName.trim(), name: `${firstName.trim()} ${lastName.trim()}`,
        avatar_url: photoUrl, avatar_background: avatar.background, avatar_icon: avatar.icon, xp: 0, tutorial_completed: false, updated_at: new Date().toISOString()
      }).select().single()
      if (error) throw error
      setProfile(data); addToast('Profile saved!', 'success'); setCurrentPage('home'); setShowTutorial(true)
    } catch (err) { addToast('Failed to save', 'error') }
    finally { setLoading(false) }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-cyan-900 text-white flex flex-col">
      <div className="flex-1 overflow-auto px-6 py-8">
        <div className="space-y-6 animate-fade-in">
          {step === 1 && (
            <>
              <div className="text-center"><h1 className="text-3xl font-bold">What's your name?</h1><p className="text-slate-400 mt-2">Let other riders know who you are</p></div>
              <div className="space-y-4 pt-4">
                <div><label className="block text-sm text-slate-400 mb-2">First Name</label><input type="text" value={firstName} onChange={e => setFirstName(e.target.value)} placeholder="First name" className="w-full px-4 py-3 rounded-xl bg-slate-800 text-white border border-slate-600 focus:border-cyan-500 focus:outline-none text-lg" autoFocus /></div>
                <div><label className="block text-sm text-slate-400 mb-2">Last Name</label><input type="text" value={lastName} onChange={e => setLastName(e.target.value)} placeholder="Last name" className="w-full px-4 py-3 rounded-xl bg-slate-800 text-white border border-slate-600 focus:border-cyan-500 focus:outline-none text-lg" /></div>
              </div>
            </>
          )}
          {step === 2 && (
            <>
              <div className="text-center"><h1 className="text-3xl font-bold">Create Your Avatar</h1><p className="text-slate-400 mt-2">How you'll appear to others</p></div>
              <div className="flex justify-center py-4">
                <div className="relative">
                  <AvatarDisplay avatar={avatar} size="xl" />
                  <button onClick={() => fileRef.current?.click()} className="absolute bottom-0 right-0 w-10 h-10 bg-cyan-500 rounded-full flex items-center justify-center border-4 border-slate-900"><Camera className="w-5 h-5 text-white" /></button>
                  <input ref={fileRef} type="file" accept="image/*" onChange={handlePhoto} className="hidden" />
                </div>
              </div>
              <p className="text-center text-sm text-slate-500">Tap camera for photo (optional)</p>
              {!avatar.photo_url && (
                <>
                  <div><label className="block text-sm text-slate-400 mb-2">Background</label><div className="flex flex-wrap gap-2">{AVATAR_OPTIONS.backgrounds.map(bg => <button key={bg} onClick={() => setAvatar(a => ({ ...a, background: bg }))} className={`w-10 h-10 rounded-full ${avatar.background === bg ? 'ring-2 ring-white ring-offset-2 ring-offset-slate-900 scale-110' : ''}`} style={{ backgroundColor: bg }} />)}</div></div>
                  <div><label className="block text-sm text-slate-400 mb-2">Icon</label><div className="flex flex-wrap gap-2">{AVATAR_OPTIONS.icons.map(ic => <button key={ic} onClick={() => setAvatar(a => ({ ...a, icon: ic }))} className={`w-10 h-10 rounded-lg bg-slate-800 flex items-center justify-center text-xl ${avatar.icon === ic ? 'ring-2 ring-cyan-400 scale-110' : ''}`}>{ic}</button>)}</div></div>
                </>
              )}
            </>
          )}
          <div className="flex justify-center gap-2 pt-4"><div className={`h-2 w-8 rounded-full ${step === 1 ? 'bg-cyan-400' : 'bg-slate-700'}`} /><div className={`h-2 w-8 rounded-full ${step === 2 ? 'bg-cyan-400' : 'bg-slate-700'}`} /></div>
        </div>
      </div>
      <div className="p-6 space-y-3">
        {step === 1 ? <button onClick={() => setStep(2)} disabled={!firstName.trim() || !lastName.trim()} className="w-full bg-cyan-500 text-slate-900 font-bold py-4 rounded-xl disabled:opacity-50">Next: Create Avatar</button> :
        <><button onClick={handleSave} disabled={loading} className="w-full bg-cyan-500 text-slate-900 font-bold py-4 rounded-xl disabled:opacity-50 flex items-center justify-center gap-2">{loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <><Save className="w-5 h-5" />Save & Continue</>}</button><button onClick={() => setStep(1)} className="w-full text-slate-400 py-2">Back</button></>}
      </div>
    </div>
  )
}

function MainApp() {
  const { currentPage } = useApp()
  return (
    <div className="min-h-screen bg-slate-900 flex flex-col">
      <div className="flex-1 overflow-auto">
        {currentPage === 'home' && <HomePage />}
        {currentPage === 'ride' && <RideRecordingPage />}
        {currentPage === 'rideSummary' && <RideSummaryPage />}
        {currentPage === 'territory' && <TerritoryMapPage />}
        {currentPage === 'leaderboard' && <LeaderboardPage />}
        {currentPage === 'profile' && <ProfilePage />}
        {currentPage === 'achievements' && <AchievementsPage />}
        {currentPage === 'clan' && <ClanPage />}
        {currentPage === 'createClan' && <CreateClanPage />}
        {currentPage === 'joinClan' && <JoinClanPage />}
      </div>
      {!['ride', 'rideSummary', 'createClan', 'joinClan'].includes(currentPage) && <BottomNav />}
    </div>
  )
}

function HomePage() {
  const { profile, rides, tiles, threats, setCurrentPage, setShowTutorial, streak, clan, routeUnlocks } = useApp()
  const isNew = rides.length === 0
  const weekly = useMemo(() => {
    const wk = Date.now() - 7*86400000
    const wr = rides.filter(r => new Date(r.started_at || r.created_at).getTime() >= wk)
    return { count: wr.length, distance: wr.reduce((s,r) => s + (r.distance_m||0), 0) / 1000 }
  }, [rides])
  const level = getLevel(profile?.xp || 0), xpProg = getXpProgress(profile?.xp || 0)
  const decay = getDaysUntilDecay(rides[0]?.started_at)

  return (
    <div className="p-4 space-y-4 pb-24 safe-area-inset-top">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-3">
          <div className="relative">
            <AvatarDisplay avatar={{ background: profile?.avatar_background, icon: profile?.avatar_icon, photo_url: profile?.avatar_url }} size="md" />
            <div className="absolute -bottom-1 -right-1"><LevelBadge level={level} /></div>
          </div>
          <div>
            <div className="flex items-center gap-2"><h1 className="text-lg font-bold text-white">{profile?.first_name || 'Rider'}</h1><StreakBadge streak={streak} /></div>
            <div className="flex items-center gap-2"><div className="bg-slate-700 rounded-full h-2 w-24 overflow-hidden"><div className="bg-gradient-to-r from-cyan-500 to-purple-500 h-2" style={{ width: `${xpProg}%` }} /></div><span className="text-xs text-slate-400">Lv.{level}</span></div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowTutorial(true)} className="p-2 bg-slate-800 rounded-lg"><HelpCircle className="w-5 h-5 text-slate-400" /></button>
          <div className="relative"><Bell className="w-6 h-6 text-slate-400" />{threats.length > 0 && <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full text-xs text-white flex items-center justify-center">{threats.length}</span>}</div>
        </div>
      </div>

      {tiles.length > 0 && decay <= 3 && (
        <div className="bg-gradient-to-r from-amber-500/20 to-red-500/20 rounded-xl p-3 border border-amber-500/50 flex items-center gap-3">
          <Clock className="w-5 h-5 text-amber-400" />
          <div><p className="text-sm font-medium text-amber-300">Territory decay in {decay} day{decay !== 1 ? 's' : ''}!</p><p className="text-xs text-slate-400">Ride to keep your tiles</p></div>
        </div>
      )}

      <button onClick={() => setCurrentPage('ride')} className="w-full bg-gradient-to-r from-cyan-500 to-purple-600 text-white font-bold py-6 rounded-2xl shadow-lg shadow-cyan-500/25 flex items-center justify-center gap-3 animate-pulse-glow">
        <Play className="w-8 h-8" fill="currentColor" /><span className="text-xl">Start Ride</span>
      </button>

      {isNew && (
        <div className="bg-gradient-to-br from-cyan-500/20 to-purple-600/20 rounded-2xl p-4 border border-cyan-500/30">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 bg-cyan-500/20 rounded-xl flex items-center justify-center"><Zap className="w-5 h-5 text-cyan-400" /></div>
            <div>
              <h3 className="font-semibold text-white">Ready to claim territory?</h3>
              <p className="text-sm text-slate-300 mt-1">Complete your first ride to start!</p>
              <div className="flex items-center gap-2 mt-2">
                {[1,2,3].map(i => <div key={i} className="w-6 h-6 rounded-full bg-slate-700 text-slate-500 flex items-center justify-center text-xs font-bold">{i}</div>)}
                <span className="text-sm text-slate-400">0/3 to unlock route</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {!isNew && (
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-slate-800/50 rounded-xl p-3 text-center border border-slate-700"><div className="text-2xl font-bold text-white">{weekly.count}</div><div className="text-xs text-slate-500">rides/wk</div></div>
          <div className="bg-slate-800/50 rounded-xl p-3 text-center border border-slate-700"><div className="text-2xl font-bold text-white">{weekly.distance.toFixed(1)}</div><div className="text-xs text-slate-500">km/wk</div></div>
          <div className="bg-slate-800/50 rounded-xl p-3 text-center border border-slate-700"><div className="text-2xl font-bold text-white">{routeUnlocks.length}</div><div className="text-xs text-slate-500">routes</div></div>
        </div>
      )}

      <div onClick={() => setCurrentPage('territory')} className="bg-gradient-to-br from-amber-500/20 to-orange-600/20 rounded-2xl p-4 border border-amber-500/30 cursor-pointer">
        <div className="flex justify-between items-start mb-2"><div><h2 className="text-sm font-semibold text-amber-300">Your Territory</h2><div className="text-4xl font-bold text-white">{tiles.length}</div><div className="text-sm text-amber-200/70">tiles owned</div></div><Trophy className="w-8 h-8 text-amber-400" /></div>
        <div className="flex items-center justify-between pt-3 border-t border-amber-500/20"><span className="text-sm text-amber-200">View map</span><ChevronRight className="w-5 h-5 text-amber-400" /></div>
      </div>

      {clan ? (
        <div onClick={() => setCurrentPage('clan')} className="bg-gradient-to-br from-blue-500/20 to-indigo-600/20 rounded-2xl p-4 border border-blue-500/30 cursor-pointer">
          <div className="flex items-center gap-3"><div className="w-12 h-12 bg-blue-500/30 rounded-xl flex items-center justify-center text-2xl">{clan.icon || '⚔️'}</div><div className="flex-1"><h3 className="font-semibold text-white">{clan.name}</h3><p className="text-sm text-blue-300">{clan.clan_members?.length || 0} members</p></div><ChevronRight className="w-5 h-5 text-blue-400" /></div>
        </div>
      ) : (
        <div onClick={() => setCurrentPage('joinClan')} className="bg-slate-800/50 rounded-2xl p-4 border border-slate-700 cursor-pointer">
          <div className="flex items-center gap-3"><div className="w-12 h-12 bg-slate-700 rounded-xl flex items-center justify-center"><Users className="w-6 h-6 text-slate-400" /></div><div className="flex-1"><h3 className="font-semibold text-white">Join a Clan</h3><p className="text-sm text-slate-400">Team up with riders</p></div><ChevronRight className="w-5 h-5 text-slate-400" /></div>
        </div>
      )}

      {threats.map(t => (
        <div key={t.id} className="bg-gradient-to-br from-red-500/30 to-orange-600/30 rounded-2xl p-4 border-2 border-red-500 animate-pulse">
          <div className="flex items-center gap-2 mb-3"><Shield className="w-6 h-6 text-red-400" /><div><h2 className="font-bold text-red-300">⚠️ Territory Under Attack!</h2><p className="text-sm text-slate-300">{t.tiles_at_risk_count} tiles at risk</p></div></div>
          <button onClick={() => setCurrentPage('ride')} className="w-full bg-red-600 text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2"><Shield className="w-5 h-5" />Defend Now</button>
        </div>
      ))}
    </div>
  )
}

function RideRecordingPage() {
  const { user, setRides, setCurrentPage, addToast, setLastRide, triggerConfetti, addXp, calculateStreak } = useApp()
  const [rideState, setRideState] = useState('idle')
  const [stats, setStats] = useState({ distance: 0, duration: 0, tilesCount: 0, speed: 0 })
  const [gpsStatus, setGpsStatus] = useState('waiting')
  const [cellsVisited, setCellsVisited] = useState(new Set())
  const [showEndConfirm, setShowEndConfirm] = useState(false)

  const mapRef = useRef(null), markerRef = useRef(null), mapContainerRef = useRef(null)
  const startTimeRef = useRef(null), pauseStartRef = useRef(null), totalPausedRef = useRef(0)
  const watchIdRef = useRef(null), timerRef = useRef(null), pointsRef = useRef([])

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return
    navigator.geolocation.getCurrentPosition(
      pos => {
        mapRef.current = new mapboxgl.Map({ container: mapContainerRef.current, style: 'mapbox://styles/mapbox/dark-v11', center: [pos.coords.longitude, pos.coords.latitude], zoom: 16, attributionControl: false })
        markerRef.current = new mapboxgl.Marker({ color: '#06b6d4' }).setLngLat([pos.coords.longitude, pos.coords.latitude]).addTo(mapRef.current)
      },
      () => { mapRef.current = new mapboxgl.Map({ container: mapContainerRef.current, style: 'mapbox://styles/mapbox/dark-v11', center: [0, 0], zoom: 2, attributionControl: false }) }
    )
    return () => { if (mapRef.current) mapRef.current.remove() }
  }, [])

  const startRecording = useCallback(() => {
    setRideState('recording'); startTimeRef.current = Date.now(); totalPausedRef.current = 0
    pointsRef.current = []; setStats({ distance: 0, duration: 0, tilesCount: 0, speed: 0 }); setCellsVisited(new Set())

    watchIdRef.current = navigator.geolocation.watchPosition(
      pos => {
        const pt = { lat: pos.coords.latitude, lng: pos.coords.longitude, timestamp: Date.now(), accuracy: pos.coords.accuracy }
        setGpsStatus(pt.accuracy <= 20 ? 'good' : pt.accuracy <= 50 ? 'okay' : 'poor')
        if (pt.accuracy > CONFIG.MIN_ACCURACY_METERS) return

        const cell = latLngToCell(pt.lat, pt.lng, CONFIG.H3_RESOLUTION)
        setCellsVisited(prev => { const ns = new Set(prev); ns.add(cell); setStats(s => ({ ...s, tilesCount: ns.size })); return ns })

        const prev = pointsRef.current
        if (prev.length >= 1) {
          const last = prev[prev.length - 1]
          const dist = haversine(last.lat, last.lng, pt.lat, pt.lng)
          const dt = (pt.timestamp - last.timestamp) / 1000, spd = dt > 0 ? dist / dt : 0
          if (spd > CONFIG.MAX_SPEED_MS) return
          setStats(s => ({ ...s, distance: s.distance + dist, speed: spd * 3.6 }))
        }
        if (mapRef.current && markerRef.current) { markerRef.current.setLngLat([pt.lng, pt.lat]); mapRef.current.flyTo({ center: [pt.lng, pt.lat], zoom: 16 }) }
        pointsRef.current = [...prev, pt]
      },
      () => { setGpsStatus('poor'); addToast('GPS signal lost', 'warning') },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
    )
    timerRef.current = setInterval(() => { setStats(s => ({ ...s, duration: (Date.now() - startTimeRef.current - totalPausedRef.current) / 1000 })) }, 1000)
    addToast('Ride started! 🚴', 'success')
  }, [addToast])

  const pauseRecording = useCallback(() => {
    setRideState('paused'); pauseStartRef.current = Date.now()
    if (watchIdRef.current) navigator.geolocation.clearWatch(watchIdRef.current)
    if (timerRef.current) clearInterval(timerRef.current)
    addToast('Ride paused', 'info')
  }, [addToast])

  const resumeRecording = useCallback(() => {
    if (pauseStartRef.current) totalPausedRef.current += Date.now() - pauseStartRef.current
    setRideState('recording')
    watchIdRef.current = navigator.geolocation.watchPosition(
      pos => {
        const pt = { lat: pos.coords.latitude, lng: pos.coords.longitude, timestamp: Date.now(), accuracy: pos.coords.accuracy }
        setGpsStatus(pt.accuracy <= 20 ? 'good' : pt.accuracy <= 50 ? 'okay' : 'poor')
        if (pt.accuracy > CONFIG.MIN_ACCURACY_METERS) return
        const cell = latLngToCell(pt.lat, pt.lng, CONFIG.H3_RESOLUTION)
        setCellsVisited(prev => { const ns = new Set(prev); ns.add(cell); setStats(s => ({ ...s, tilesCount: ns.size })); return ns })
        const prev = pointsRef.current
        if (prev.length >= 1) { const last = prev[prev.length - 1], dist = haversine(last.lat, last.lng, pt.lat, pt.lng), dt = (pt.timestamp - last.timestamp) / 1000, spd = dt > 0 ? dist / dt : 0; if (spd > CONFIG.MAX_SPEED_MS) return; setStats(s => ({ ...s, distance: s.distance + dist, speed: spd * 3.6 })) }
        if (mapRef.current && markerRef.current) { markerRef.current.setLngLat([pt.lng, pt.lat]); mapRef.current.flyTo({ center: [pt.lng, pt.lat], zoom: 16 }) }
        pointsRef.current = [...prev, pt]
      },
      () => setGpsStatus('poor'),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
    )
    timerRef.current = setInterval(() => { setStats(s => ({ ...s, duration: (Date.now() - startTimeRef.current - totalPausedRef.current) / 1000 })) }, 1000)
    addToast('Resumed! 🚴', 'success')
  }, [addToast])

  const endRide = useCallback(async (save = true) => {
    if (watchIdRef.current) navigator.geolocation.clearWatch(watchIdRef.current)
    if (timerRef.current) clearInterval(timerRef.current)
    setShowEndConfirm(false)

    if (!save) { addToast('Ride discarded', 'info'); setCurrentPage('home'); return }

    const fp = pointsRef.current
    if (fp.length < CONFIG.MIN_RIDE_POINTS) { addToast('Ride too short', 'warning'); setCurrentPage('home'); return }

    const cells = Array.from(cellsVisited), sig = await sha256(cells.join(','))
    const ride = { user_id: user.id, started_at: new Date(startTimeRef.current).toISOString(), ended_at: new Date().toISOString(), duration_sec: Math.floor(stats.duration), distance_m: Math.floor(stats.distance), route_signature: sig, tiles_touched: cells.length }

    try {
      const { data, error } = await supabase.from('rides').insert(ride).select().single()
      if (error) throw error
      setRides(p => [data, ...p]); setLastRide({ ...data, h3Cells: cells })
      const xp = Math.floor(stats.distance / 100) + Math.floor(stats.duration / 60) + cells.length * 2
      addXp(xp, `Ride: ${(stats.distance/1000).toFixed(1)}km`)
      calculateStreak(user.id)
      triggerConfetti(); addToast('Ride saved! 🎉', 'success'); setCurrentPage('rideSummary')
    } catch { addToast('Failed to save', 'error'); setCurrentPage('home') }
  }, [user, stats, cellsVisited, addToast, setCurrentPage, setRides, setLastRide, triggerConfetti, addXp, calculateStreak])

  useEffect(() => () => { if (watchIdRef.current) navigator.geolocation.clearWatch(watchIdRef.current); if (timerRef.current) clearInterval(timerRef.current) }, [])

  const gpsCol = { waiting: 'bg-slate-500', good: 'bg-emerald-500', okay: 'bg-amber-500', poor: 'bg-red-500' }
  const gpsLbl = { waiting: 'Waiting...', good: 'Strong', okay: 'Fair', poor: 'Weak' }

  return (
    <div className="h-screen flex flex-col bg-slate-900">
      <div ref={mapContainerRef} className="flex-1 relative">
        <div className="absolute top-0 left-0 right-0 bg-gradient-to-b from-slate-900 via-slate-900/95 to-transparent p-6 safe-area-inset-top z-10">
          <div className="text-center">
            <div className="text-6xl font-bold text-white tabular-nums">{(stats.distance / 1000).toFixed(2)}</div>
            <div className="text-cyan-400 text-lg font-medium">kilometers</div>
            <div className="text-3xl font-semibold text-white/80 tabular-nums">{formatDuration(stats.duration)}</div>
          </div>
          {rideState !== 'idle' && (
            <div className="mt-4 flex justify-center gap-4">
              <div className="bg-slate-800/80 backdrop-blur rounded-full px-4 py-2 flex items-center gap-2"><MapPin className="w-4 h-4 text-amber-400" /><span className="text-amber-300 font-semibold">{stats.tilesCount} tiles</span></div>
              <div className="bg-slate-800/80 backdrop-blur rounded-full px-4 py-2 flex items-center gap-2"><Zap className="w-4 h-4 text-cyan-400" /><span className="text-cyan-300 font-semibold">{stats.speed.toFixed(1)} km/h</span></div>
            </div>
          )}
        </div>
        <div className="absolute top-6 right-6 z-10 safe-area-inset-top"><div className="flex items-center gap-2 bg-slate-800/80 backdrop-blur rounded-full px-3 py-1.5"><div className={`${gpsCol[gpsStatus]} w-2 h-2 rounded-full ${gpsStatus === 'good' ? 'animate-pulse' : ''}`} /><span className="text-xs text-slate-300">{gpsLbl[gpsStatus]}</span></div></div>
        {rideState === 'idle' && <button onClick={() => setCurrentPage('home')} className="absolute top-6 left-6 z-10 safe-area-inset-top bg-slate-800/80 backdrop-blur rounded-full p-2"><ChevronLeft className="w-6 h-6 text-white" /></button>}
      </div>

      <div className="bg-slate-800 p-6 space-y-4 border-t border-slate-700 safe-area-inset-bottom">
        {rideState === 'idle' && <button onClick={startRecording} className="w-full bg-emerald-600 text-white font-bold py-5 rounded-2xl flex items-center justify-center gap-3"><Play className="w-7 h-7" fill="currentColor" /><span className="text-xl">Start Ride</span></button>}
        {rideState === 'recording' && (
          <div className="flex gap-3">
            <button onClick={pauseRecording} className="flex-1 bg-amber-600 text-white font-bold py-4 rounded-xl flex items-center justify-center gap-2"><Pause className="w-6 h-6" />Pause</button>
            <button onClick={() => setShowEndConfirm(true)} className="flex-1 bg-red-600 text-white font-bold py-4 rounded-xl flex items-center justify-center gap-2"><StopCircle className="w-6 h-6" />End</button>
          </div>
        )}
        {rideState === 'paused' && (
          <div className="space-y-3">
            <div className="bg-amber-500/20 border border-amber-500/50 rounded-xl p-3 text-center"><span className="text-amber-300 font-medium">⏸️ Paused</span></div>
            <div className="flex gap-3">
              <button onClick={resumeRecording} className="flex-1 bg-emerald-600 text-white font-bold py-4 rounded-xl flex items-center justify-center gap-2"><Play className="w-6 h-6" fill="currentColor" />Resume</button>
              <button onClick={() => setShowEndConfirm(true)} className="flex-1 bg-red-600 text-white font-bold py-4 rounded-xl flex items-center justify-center gap-2"><StopCircle className="w-6 h-6" />End</button>
            </div>
          </div>
        )}
      </div>

      {showEndConfirm && (
        <div className="fixed inset-0 bg-slate-900/90 backdrop-blur-sm z-50 flex items-center justify-center p-6">
          <div className="bg-slate-800 rounded-2xl p-6 max-w-sm w-full border border-slate-700 animate-fade-in">
            <div className="text-center mb-4">
              <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-4"><StopCircle className="w-8 h-8 text-red-400" /></div>
              <h2 className="text-xl font-bold text-white">End Ride?</h2>
            </div>
            <div className="bg-slate-700/50 rounded-xl p-4 mb-4">
              <div className="grid grid-cols-3 gap-4 text-center">
                <div><div className="text-lg font-bold text-white">{(stats.distance / 1000).toFixed(2)}</div><div className="text-xs text-slate-500">km</div></div>
                <div><div className="text-lg font-bold text-white">{formatDuration(stats.duration)}</div><div className="text-xs text-slate-500">time</div></div>
                <div><div className="text-lg font-bold text-white">{stats.tilesCount}</div><div className="text-xs text-slate-500">tiles</div></div>
              </div>
            </div>
            <div className="space-y-2">
              <button onClick={() => endRide(true)} className="w-full bg-emerald-600 text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2"><Save className="w-5 h-5" />Save Ride</button>
              <button onClick={() => endRide(false)} className="w-full bg-red-600/20 text-red-400 font-semibold py-3 rounded-xl border border-red-600/30">Discard</button>
              <button onClick={() => setShowEndConfirm(false)} className="w-full text-slate-400 py-2">Continue Riding</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function RideSummaryPage() {
  const { lastRide, rides, setCurrentPage } = useApp()
  const recentCount = useMemo(() => {
    if (!lastRide) return 0
    const wk = Date.now() - 7 * 86400000
    return rides.filter(r => r.route_signature === lastRide.route_signature && new Date(r.started_at || r.created_at).getTime() >= wk).length
  }, [rides, lastRide])
  const isUnlocked = recentCount >= 3
  const xp = lastRide ? Math.floor(lastRide.distance_m / 100) + Math.floor(lastRide.duration_sec / 60) + (lastRide.tiles_touched || 0) * 2 : 0

  if (!lastRide) return <div className="min-h-screen bg-slate-900 flex items-center justify-center"><button onClick={() => setCurrentPage('home')} className="text-cyan-400">Go Home</button></div>

  return (
    <div className="min-h-screen bg-slate-900 p-4 space-y-4 safe-area-inset-top safe-area-inset-bottom">
      <div className="bg-gradient-to-br from-cyan-600 to-purple-700 rounded-3xl p-6 text-white text-center">
        <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-3"><CheckCircle className="w-10 h-10" /></div>
        <p className="text-cyan-100 font-medium">Great ride!</p>
        <div className="text-5xl font-bold">{(lastRide.distance_m / 1000).toFixed(2)}</div>
        <div className="text-lg text-cyan-100">kilometers</div>
        <div className="mt-4 inline-flex items-center gap-2 bg-white/20 rounded-full px-4 py-2"><Star className="w-5 h-5 text-amber-300" /><span className="font-bold">+{xp} XP</span></div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="bg-slate-800 rounded-2xl p-4 text-center border border-slate-700"><Clock className="w-5 h-5 text-cyan-400 mx-auto mb-1" /><div className="text-xl font-bold text-white">{formatDuration(lastRide.duration_sec)}</div><div className="text-xs text-slate-500">Duration</div></div>
        <div className="bg-slate-800 rounded-2xl p-4 text-center border border-slate-700"><Zap className="w-5 h-5 text-amber-400 mx-auto mb-1" /><div className="text-xl font-bold text-white">{((lastRide.distance_m / lastRide.duration_sec) * 3.6).toFixed(1)}</div><div className="text-xs text-slate-500">km/h avg</div></div>
        <div className="bg-slate-800 rounded-2xl p-4 text-center border border-slate-700"><MapPin className="w-5 h-5 text-purple-400 mx-auto mb-1" /><div className="text-xl font-bold text-white">{lastRide.tiles_touched || 0}</div><div className="text-xs text-slate-500">Tiles</div></div>
      </div>

      <div className="bg-slate-800 rounded-2xl p-4 border border-slate-700 space-y-4">
        <div className="flex items-center justify-between"><div className="flex items-center gap-2"><Target className="w-5 h-5 text-cyan-400" /><span className="font-semibold text-white">Route Progress</span></div><span className="text-sm font-bold text-cyan-400">{Math.min(recentCount, 3)}/3</span></div>
        <div className="flex justify-center gap-4">
          {[1, 2, 3].map(i => <div key={i} className="flex flex-col items-center gap-2"><div className={`w-14 h-14 rounded-full flex items-center justify-center font-bold text-lg ${i <= recentCount ? 'bg-cyan-500 text-white scale-110' : 'bg-slate-700 text-slate-500'}`}>{i <= recentCount ? <CheckCircle className="w-7 h-7" /> : i}</div><span className="text-xs text-slate-500">Ride {i}</span></div>)}
        </div>
        {isUnlocked ? (
          <div className="bg-emerald-500/20 border border-emerald-500/50 rounded-xl p-4 flex items-center gap-3"><div className="w-12 h-12 bg-emerald-500 rounded-full flex items-center justify-center"><Unlock className="w-6 h-6 text-white" /></div><div><p className="font-bold text-emerald-300">🎉 Route Unlocked!</p><p className="text-sm text-emerald-200/70">Tiles are now yours!</p></div></div>
        ) : (
          <div className="bg-slate-700/50 rounded-xl p-4 flex items-center gap-3"><div className="w-12 h-12 bg-slate-700 rounded-full flex items-center justify-center"><Lock className="w-6 h-6 text-slate-500" /></div><div><p className="font-semibold text-white">Keep going!</p><p className="text-sm text-slate-400">{3 - recentCount} more ride{3 - recentCount !== 1 ? 's' : ''} to unlock</p></div></div>
        )}
      </div>

      <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 flex items-start gap-3"><Calendar className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" /><div><p className="text-sm font-medium text-amber-300">Territory Reminder</p><p className="text-xs text-slate-400">Ride at least once every 7 days to keep your tiles!</p></div></div>

      <div className="space-y-3 pt-2">
        <button onClick={() => setCurrentPage('home')} className="w-full bg-cyan-600 text-white font-bold py-4 rounded-xl">Done</button>
        <button onClick={() => setCurrentPage('territory')} className="w-full bg-slate-800 text-white font-semibold py-4 rounded-xl border border-slate-600 flex items-center justify-center gap-2"><MapPin className="w-5 h-5" />View Territory</button>
      </div>
    </div>
  )
}

function TerritoryMapPage() {
  const { tiles } = useApp()
  const mapContainerRef = useRef(null), mapRef = useRef(null)

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return
    navigator.geolocation.getCurrentPosition(
      pos => {
        mapRef.current = new mapboxgl.Map({ container: mapContainerRef.current, style: 'mapbox://styles/mapbox/dark-v11', center: [pos.coords.longitude, pos.coords.latitude], zoom: 13, attributionControl: false })
        mapRef.current.on('load', () => {
          if (tiles.length > 0) {
            const feats = tiles.map(t => ({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [cellToBoundary(t.h3_index, true)] }, properties: {} }))
            mapRef.current.addSource('tiles', { type: 'geojson', data: { type: 'FeatureCollection', features: feats } })
            mapRef.current.addLayer({ id: 'tiles-fill', type: 'fill', source: 'tiles', paint: { 'fill-color': '#06b6d4', 'fill-opacity': 0.4 } })
            mapRef.current.addLayer({ id: 'tiles-line', type: 'line', source: 'tiles', paint: { 'line-color': '#06b6d4', 'line-width': 2 } })
          }
        })
      },
      () => { mapRef.current = new mapboxgl.Map({ container: mapContainerRef.current, style: 'mapbox://styles/mapbox/dark-v11', center: [0, 0], zoom: 2, attributionControl: false }) }
    )
    return () => { if (mapRef.current) mapRef.current.remove() }
  }, [tiles])

  return (
    <div className="h-screen flex flex-col bg-slate-900">
      <div className="bg-slate-800 p-4 border-b border-slate-700 safe-area-inset-top"><h1 className="text-xl font-bold text-white">Territory Map</h1><p className="text-sm text-slate-400">{tiles.length} tiles owned</p></div>
      <div ref={mapContainerRef} className="flex-1" />
      {tiles.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="bg-slate-800/90 backdrop-blur rounded-2xl p-6 m-4 text-center max-w-sm"><MapPin className="w-12 h-12 text-cyan-400 mx-auto mb-3" /><h3 className="font-bold text-white mb-2">No Territory Yet</h3><p className="text-sm text-slate-400">Complete rides to unlock routes and claim tiles!</p></div>
        </div>
      )}
    </div>
  )
}

function LeaderboardPage() {
  const { user } = useApp()
  const [leaders, setLeaders] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('riders')

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase.from(tab === 'riders' ? 'leaderboard' : 'clan_leaderboard').select('*').limit(50)
      setLeaders(data || []); setLoading(false)
    }
    load()
  }, [tab])

  return (
    <div className="min-h-screen bg-slate-900 pb-24">
      <div className="bg-gradient-to-r from-amber-600 to-orange-600 p-6 safe-area-inset-top">
        <div className="flex items-center gap-3 mb-4"><Trophy className="w-8 h-8 text-white" /><h1 className="text-2xl font-bold text-white">Leaderboard</h1></div>
        <div className="flex gap-2">
          <button onClick={() => setTab('riders')} className={`flex-1 py-2 rounded-lg font-medium ${tab === 'riders' ? 'bg-white/20 text-white' : 'text-white/60'}`}>Riders</button>
          <button onClick={() => setTab('clans')} className={`flex-1 py-2 rounded-lg font-medium ${tab === 'clans' ? 'bg-white/20 text-white' : 'text-white/60'}`}>Clans</button>
        </div>
      </div>
      <div className="p-4 space-y-2">
        {loading ? <div className="text-center py-12"><Loader2 className="w-8 h-8 animate-spin mx-auto text-slate-500" /></div> :
        leaders.length === 0 ? <div className="text-center py-16"><Trophy className="w-16 h-16 mx-auto mb-4 text-slate-600" /><p className="text-slate-500">No entries yet</p></div> :
        leaders.map((e, i) => (
          <div key={e.user_id || e.id} className={`bg-slate-800 rounded-xl p-4 flex items-center gap-4 border ${e.user_id === user?.id ? 'border-cyan-500 bg-cyan-500/10' : 'border-slate-700'}`}>
            <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm ${i === 0 ? 'bg-amber-500 text-white' : i === 1 ? 'bg-slate-400 text-white' : i === 2 ? 'bg-orange-700 text-white' : 'bg-slate-700 text-slate-400'}`}>{i === 0 ? '👑' : i + 1}</div>
            <div className="flex-1">
              <div className="font-semibold text-white">{tab === 'riders' ? (e.first_name ? `${e.first_name} ${e.last_name}` : e.name || 'Anonymous') : e.name}{e.user_id === user?.id && <span className="ml-2 text-xs text-cyan-400">(You)</span>}</div>
              <div className="text-sm text-slate-500">{e.tiles_owned ?? e.total_tiles ?? 0} tiles</div>
            </div>
            {i < 3 && <div className="text-2xl">{['🥇', '🥈', '🥉'][i]}</div>}
          </div>
        ))}
      </div>
    </div>
  )
}

function ProfilePage() {
  const { user, profile, rides, tiles, handleSignOut, setCurrentPage, streak, achievements } = useApp()
  const totalDist = rides.reduce((s, r) => s + (r.distance_m || 0), 0)
  const level = getLevel(profile?.xp || 0)

  return (
    <div className="min-h-screen bg-slate-900 pb-24">
      <div className="bg-gradient-to-r from-cyan-600 to-purple-600 p-6 safe-area-inset-top">
        <div className="flex items-center gap-4 mb-6">
          <div className="relative">
            <AvatarDisplay avatar={{ background: profile?.avatar_background, icon: profile?.avatar_icon, photo_url: profile?.avatar_url }} size="lg" />
            <div className="absolute -bottom-1 -right-1"><LevelBadge level={level} size="md" /></div>
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2"><h1 className="text-xl font-bold text-white">{profile?.first_name} {profile?.last_name}</h1><StreakBadge streak={streak} /></div>
            <p className="text-sm text-cyan-100">{user?.email}</p>
            <p className="text-sm text-cyan-200 mt-1">{profile?.xp || 0} XP • Level {level}</p>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4 bg-white/10 rounded-xl p-4">
          <div className="text-center"><div className="text-2xl font-bold text-white">{rides.length}</div><div className="text-xs text-cyan-100">Rides</div></div>
          <div className="text-center"><div className="text-2xl font-bold text-white">{(totalDist / 1000).toFixed(0)}</div><div className="text-xs text-cyan-100">km</div></div>
          <div className="text-center"><div className="text-2xl font-bold text-white">{tiles.length}</div><div className="text-xs text-cyan-100">Tiles</div></div>
        </div>
      </div>
      <div className="p-4 space-y-4">
        <button onClick={() => setCurrentPage('achievements')} className="w-full bg-slate-800 text-white font-semibold py-4 rounded-xl flex items-center justify-center gap-2 border border-slate-600"><Award className="w-5 h-5 text-amber-400" />Achievements ({achievements.length}/{ACHIEVEMENTS.length})</button>
        <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
          <h2 className="font-semibold text-white mb-3 flex items-center gap-2"><Award className="w-5 h-5 text-amber-400" />Recent Rides</h2>
          {rides.length === 0 ? <p className="text-sm text-slate-500 text-center py-4">No rides yet</p> :
          <div className="space-y-3">{rides.slice(0, 5).map(r => <div key={r.id} className="flex justify-between border-b border-slate-700 last:border-0 pb-3 last:pb-0"><div><div className="font-semibold text-white">{((r.distance_m || 0) / 1000).toFixed(2)} km</div><div className="text-xs text-slate-500">{new Date(r.started_at || r.created_at).toLocaleDateString()}</div></div><div className="text-sm text-slate-400">{formatDuration(r.duration_sec || 0)}</div></div>)}</div>}
        </div>
        <button onClick={handleSignOut} className="w-full bg-red-600/20 text-red-400 font-semibold py-4 rounded-xl flex items-center justify-center gap-2 border border-red-600/30"><LogOut className="w-5 h-5" />Sign Out</button>
      </div>
    </div>
  )
}

function AchievementsPage() {
  const { achievements, setCurrentPage } = useApp()
  return (
    <div className="min-h-screen bg-slate-900 pb-24">
      <div className="bg-gradient-to-r from-amber-600 to-orange-600 p-6 safe-area-inset-top flex items-center gap-3">
        <button onClick={() => setCurrentPage('profile')} className="p-2 bg-white/20 rounded-lg"><ChevronLeft className="w-5 h-5 text-white" /></button>
        <div><h1 className="text-2xl font-bold text-white">Achievements</h1><p className="text-amber-100 text-sm">{achievements.length}/{ACHIEVEMENTS.length} unlocked</p></div>
      </div>
      <div className="p-4 space-y-3">
        {ACHIEVEMENTS.map(a => {
          const unlocked = achievements.includes(a.id)
          return (
            <div key={a.id} className={`bg-slate-800 rounded-xl p-4 flex items-center gap-4 border ${unlocked ? 'border-amber-500/50' : 'border-slate-700 opacity-60'}`}>
              <div className={`w-14 h-14 rounded-xl flex items-center justify-center text-2xl ${unlocked ? 'bg-amber-500/20' : 'bg-slate-700'}`}>{a.icon}</div>
              <div className="flex-1"><div className="font-semibold text-white">{a.name}</div><div className="text-sm text-slate-400">{a.desc}</div></div>
              <div className="text-right"><div className="text-sm font-bold text-amber-400">+{a.xp} XP</div>{unlocked && <Check className="w-5 h-5 text-emerald-400 mx-auto mt-1" />}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
// PART 3 - Final Part - Clan Pages & Navigation

function ClanPage() {
  const { clan, user, profile, setCurrentPage, addToast, setClan, setProfile, loadClan } = useApp()
  const [copied, setCopied] = useState(false)
  const isLeader = clan?.leader_user_id === user?.id

  const copyCode = () => { navigator.clipboard.writeText(clan.invite_code); setCopied(true); setTimeout(() => setCopied(false), 2000); addToast('Invite code copied!', 'success') }

  const leaveClan = async () => {
    if (isLeader) { addToast('Leaders cannot leave. Delete clan first.', 'warning'); return }
    await supabase.from('clan_members').delete().eq('clan_id', clan.id).eq('user_id', user.id)
    await supabase.from('profiles').update({ clan_id: null }).eq('id', user.id)
    setClan(null); setProfile(p => ({ ...p, clan_id: null })); addToast('Left clan', 'info'); setCurrentPage('home')
  }

  const deleteClan = async () => {
    if (!isLeader) return
    await supabase.from('clans').delete().eq('id', clan.id)
    setClan(null); setProfile(p => ({ ...p, clan_id: null })); addToast('Clan deleted', 'info'); setCurrentPage('home')
  }

  if (!clan) return <div className="min-h-screen bg-slate-900 flex items-center justify-center"><button onClick={() => setCurrentPage('home')} className="text-cyan-400">Go Home</button></div>

  return (
    <div className="min-h-screen bg-slate-900 pb-24">
      <div className="p-6 safe-area-inset-top" style={{ background: `linear-gradient(135deg, ${clan.color}40, ${clan.color}20)` }}>
        <div className="flex items-center gap-4 mb-4">
          <div className="w-16 h-16 rounded-xl flex items-center justify-center text-4xl" style={{ backgroundColor: `${clan.color}30` }}>{clan.icon || '⚔️'}</div>
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-white">{clan.name}</h1>
            <p className="text-slate-300 text-sm">{clan.clan_members?.length || 0} members</p>
          </div>
          {isLeader && <Crown className="w-6 h-6 text-amber-400" />}
        </div>
        {clan.description && <p className="text-slate-300 text-sm mb-4">{clan.description}</p>}
        
        <div className="bg-slate-800/50 rounded-xl p-3 flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-400">Invite Code</p>
            <p className="text-lg font-mono font-bold text-white">{clan.invite_code}</p>
          </div>
          <button onClick={copyCode} className="p-2 bg-slate-700 rounded-lg">
            {copied ? <Check className="w-5 h-5 text-emerald-400" /> : <Copy className="w-5 h-5 text-slate-400" />}
          </button>
        </div>
      </div>

      <div className="p-4 space-y-4">
        <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
          <h2 className="font-semibold text-white mb-3 flex items-center gap-2"><Users className="w-5 h-5 text-cyan-400" />Members</h2>
          <div className="space-y-3">
            {clan.clan_members?.map(m => (
              <div key={m.user_id} className="flex items-center gap-3">
                <AvatarDisplay avatar={{ background: m.profiles?.avatar_background, icon: m.profiles?.avatar_icon, photo_url: m.profiles?.avatar_url }} size="sm" />
                <div className="flex-1">
                  <div className="font-medium text-white flex items-center gap-2">
                    {m.profiles?.first_name} {m.profiles?.last_name}
                    {m.role === 'leader' && <Crown className="w-4 h-4 text-amber-400" />}
                    {m.user_id === user.id && <span className="text-xs text-cyan-400">(You)</span>}
                  </div>
                  <div className="text-xs text-slate-500">{m.role}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {isLeader ? (
          <button onClick={deleteClan} className="w-full bg-red-600/20 text-red-400 font-semibold py-4 rounded-xl border border-red-600/30">Delete Clan</button>
        ) : (
          <button onClick={leaveClan} className="w-full bg-red-600/20 text-red-400 font-semibold py-4 rounded-xl border border-red-600/30">Leave Clan</button>
        )}
      </div>
    </div>
  )
}

function JoinClanPage() {
  const { user, setCurrentPage, addToast, setClan, setProfile, loadClan } = useApp()
  const [tab, setTab] = useState('browse')
  const [code, setCode] = useState('')
  const [clans, setClans] = useState([])
  const [loading, setLoading] = useState(true)
  const [joining, setJoining] = useState(false)

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase.from('clans').select('*, clan_members(count)').eq('is_public', true).order('total_tiles', { ascending: false }).limit(20)
      setClans(data || []); setLoading(false)
    }
    load()
  }, [])

  const joinClan = async (clanId) => {
    setJoining(true)
    try {
      await supabase.from('clan_members').insert({ clan_id: clanId, user_id: user.id, role: 'member' })
      await supabase.from('profiles').update({ clan_id: clanId }).eq('id', user.id)
      setProfile(p => ({ ...p, clan_id: clanId }))
      await loadClan(clanId)
      addToast('Joined clan! 🎉', 'success')
      setCurrentPage('clan')
    } catch (e) { addToast('Failed to join', 'error') }
    setJoining(false)
  }

  const joinByCode = async () => {
    if (!code.trim()) { addToast('Enter invite code', 'error'); return }
    setJoining(true)
    const { data: clan } = await supabase.from('clans').select('*').eq('invite_code', code.toUpperCase().trim()).single()
    if (!clan) { addToast('Invalid code', 'error'); setJoining(false); return }
    await joinClan(clan.id)
  }

  return (
    <div className="min-h-screen bg-slate-900 safe-area-inset-top safe-area-inset-bottom">
      <div className="bg-slate-800 p-4 border-b border-slate-700 flex items-center gap-4">
        <button onClick={() => setCurrentPage('home')} className="p-2 bg-slate-700 rounded-lg"><ChevronLeft className="w-5 h-5 text-white" /></button>
        <h1 className="text-xl font-bold text-white">Join a Clan</h1>
      </div>

      <div className="p-4">
        <div className="flex gap-2 mb-4">
          <button onClick={() => setTab('browse')} className={`flex-1 py-2 rounded-lg font-medium ${tab === 'browse' ? 'bg-cyan-600 text-white' : 'bg-slate-800 text-slate-400'}`}>Browse</button>
          <button onClick={() => setTab('code')} className={`flex-1 py-2 rounded-lg font-medium ${tab === 'code' ? 'bg-cyan-600 text-white' : 'bg-slate-800 text-slate-400'}`}>Invite Code</button>
        </div>

        {tab === 'browse' && (
          <div className="space-y-3">
            {loading ? <div className="text-center py-12"><Loader2 className="w-8 h-8 animate-spin mx-auto text-slate-500" /></div> :
            clans.length === 0 ? <div className="text-center py-12 text-slate-500">No public clans yet</div> :
            clans.map(c => (
              <div key={c.id} className="bg-slate-800 rounded-xl p-4 border border-slate-700">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl" style={{ backgroundColor: `${c.color}30` }}>{c.icon || '⚔️'}</div>
                  <div className="flex-1"><h3 className="font-semibold text-white">{c.name}</h3><p className="text-sm text-slate-400">{c.clan_members?.[0]?.count || 0} members</p></div>
                </div>
                <button onClick={() => joinClan(c.id)} disabled={joining} className="w-full bg-cyan-600 text-white font-semibold py-2 rounded-lg disabled:opacity-50">{joining ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : 'Join'}</button>
              </div>
            ))}
          </div>
        )}

        {tab === 'code' && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm text-slate-400 mb-2">Invite Code</label>
              <input type="text" value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="ABCD1234" className="w-full px-4 py-3 rounded-xl bg-slate-800 text-white border border-slate-600 focus:border-cyan-500 focus:outline-none text-center text-2xl font-mono tracking-widest" maxLength={8} />
            </div>
            <button onClick={joinByCode} disabled={joining} className="w-full bg-cyan-600 text-white font-bold py-4 rounded-xl disabled:opacity-50">{joining ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : 'Join Clan'}</button>
          </div>
        )}

        <div className="mt-6 pt-6 border-t border-slate-700">
          <button onClick={() => setCurrentPage('createClan')} className="w-full bg-slate-800 text-white font-semibold py-4 rounded-xl border border-slate-600 flex items-center justify-center gap-2"><Plus className="w-5 h-5" />Create New Clan</button>
        </div>
      </div>
    </div>
  )
}

function CreateClanPage() {
  const { user, setCurrentPage, addToast, setClan, setProfile, loadClan } = useApp()
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [icon, setIcon] = useState('⚔️')
  const [color, setColor] = useState('#06b6d4')
  const [creating, setCreating] = useState(false)

  const icons = ['⚔️', '🛡️', '🏰', '🦁', '🐺', '🦅', '🔥', '⚡', '💎', '🌟', '👑', '🎯']
  const colors = ['#06b6d4', '#a855f7', '#f59e0b', '#10b981', '#ef4444', '#3b82f6', '#ec4899', '#8b5cf6']

  const create = async () => {
    if (!name.trim()) { addToast('Enter clan name', 'error'); return }
    setCreating(true)
    try {
      const { data: clan, error } = await supabase.from('clans').insert({ name: name.trim(), description: desc.trim(), icon, color, leader_user_id: user.id }).select().single()
      if (error) throw error
      
      await supabase.from('clan_members').insert({ clan_id: clan.id, user_id: user.id, role: 'leader' })
      await supabase.from('profiles').update({ clan_id: clan.id }).eq('id', user.id)
      
      setProfile(p => ({ ...p, clan_id: clan.id }))
      await loadClan(clan.id)
      addToast('Clan created! 🎉', 'success')
      setCurrentPage('clan')
    } catch (e) { 
      if (e.code === '23505') addToast('Clan name taken', 'error')
      else addToast('Failed to create', 'error')
    }
    setCreating(false)
  }

  return (
    <div className="min-h-screen bg-slate-900 safe-area-inset-top safe-area-inset-bottom flex flex-col">
      <div className="bg-slate-800 p-4 border-b border-slate-700 flex items-center gap-4">
        <button onClick={() => setCurrentPage('joinClan')} className="p-2 bg-slate-700 rounded-lg"><ChevronLeft className="w-5 h-5 text-white" /></button>
        <h1 className="text-xl font-bold text-white">Create Clan</h1>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-6">
        <div className="flex justify-center">
          <div className="w-24 h-24 rounded-2xl flex items-center justify-center text-5xl" style={{ backgroundColor: `${color}30` }}>{icon}</div>
        </div>

        <div>
          <label className="block text-sm text-slate-400 mb-2">Clan Name *</label>
          <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Epic Riders" className="w-full px-4 py-3 rounded-xl bg-slate-800 text-white border border-slate-600 focus:border-cyan-500 focus:outline-none" maxLength={30} />
        </div>

        <div>
          <label className="block text-sm text-slate-400 mb-2">Description</label>
          <textarea value={desc} onChange={e => setDesc(e.target.value)} placeholder="What's your clan about?" className="w-full px-4 py-3 rounded-xl bg-slate-800 text-white border border-slate-600 focus:border-cyan-500 focus:outline-none resize-none" rows={3} maxLength={200} />
        </div>

        <div>
          <label className="block text-sm text-slate-400 mb-2">Icon</label>
          <div className="flex flex-wrap gap-2">{icons.map(i => <button key={i} onClick={() => setIcon(i)} className={`w-12 h-12 rounded-xl bg-slate-800 flex items-center justify-center text-2xl ${icon === i ? 'ring-2 ring-cyan-400' : ''}`}>{i}</button>)}</div>
        </div>

        <div>
          <label className="block text-sm text-slate-400 mb-2">Color</label>
          <div className="flex flex-wrap gap-2">{colors.map(c => <button key={c} onClick={() => setColor(c)} className={`w-10 h-10 rounded-full ${color === c ? 'ring-2 ring-white ring-offset-2 ring-offset-slate-900' : ''}`} style={{ backgroundColor: c }} />)}</div>
        </div>
      </div>

      <div className="p-4 border-t border-slate-700">
        <button onClick={create} disabled={creating || !name.trim()} className="w-full bg-cyan-600 text-white font-bold py-4 rounded-xl disabled:opacity-50 flex items-center justify-center gap-2">{creating ? <Loader2 className="w-5 h-5 animate-spin" /> : <><Plus className="w-5 h-5" />Create Clan</>}</button>
      </div>
    </div>
  )
}

function BottomNav() {
  const { currentPage, setCurrentPage, threats } = useApp()
  const items = [
    { id: 'home', icon: MapPin, label: 'Home' },
    { id: 'territory', icon: Trophy, label: 'Map' },
    { id: 'leaderboard', icon: TrendingUp, label: 'Ranks' },
    { id: 'profile', icon: User, label: 'Profile', badge: threats.length },
  ]

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-slate-800 border-t border-slate-700 px-2 py-2 flex justify-around items-center safe-area-inset-bottom z-50">
      {items.map(({ id, icon: Icon, label, badge }) => (
        <button key={id} onClick={() => setCurrentPage(id)} className={`flex flex-col items-center justify-center p-2 rounded-xl relative ${currentPage === id ? 'text-cyan-400' : 'text-slate-500'}`}>
          <Icon className="w-6 h-6" />
          <span className="text-xs mt-1 font-medium">{label}</span>
          {badge > 0 && <span className="absolute top-0 right-0 w-5 h-5 bg-red-500 text-white text-xs rounded-full flex items-center justify-center">{badge}</span>}
        </button>
      ))}
    </div>
  )
}

// Export is in Part 1
