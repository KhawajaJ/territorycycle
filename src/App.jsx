import React, { useState, useEffect, useRef, useCallback, createContext, useContext, useMemo } from 'react'
import { MapPin, Play, Pause, Trophy, Shield, Bell, User, Target, Clock, TrendingUp, Award, LogOut, Mail, AlertCircle, Loader2, CheckCircle, X, Navigation, Camera, Save, ChevronRight, Zap, Flag, Star, HelpCircle, Users, Crown, Calendar, Flame, Lock, Unlock, StopCircle, ChevronLeft, Plus, Copy, Check, Mountain, Bike, Sun, Cloud, CloudRain, Wind, Route, Sparkles, Settings } from 'lucide-react'
import { supabase } from './supabase'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { latLngToCell, cellToBoundary } from 'h3-js'

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN

// ============== CONFIGURATION ==============
const CONFIG = {
  H3_RESOLUTION: 10,
  MIN_RIDE_POINTS: 10,
  MIN_ACCURACY_METERS: 50,
  MAX_SPEED_MS: { cycling: 18, running: 8, hiking: 4 },
  UNLOCK_THRESHOLD: 3,
  UNLOCK_WINDOW_DAYS: 7,
  TERRITORY_DECAY_DAYS: 7,
}

const ACTIVITIES = {
  cycling: {
    id: 'cycling', name: 'Cycling', emoji: '🚴', color: '#06b6d4',
    gradient: 'from-cyan-500 to-blue-600', mapStyle: 'mapbox://styles/mapbox/outdoors-v12',
    avgSpeed: 20, xpMultiplier: 1.0, caloriesPerKm: 30,
  },
  running: {
    id: 'running', name: 'Running', emoji: '🏃', color: '#f59e0b',
    gradient: 'from-amber-500 to-orange-600', mapStyle: 'mapbox://styles/mapbox/streets-v12',
    avgSpeed: 10, xpMultiplier: 1.2, caloriesPerKm: 60,
  },
  hiking: {
    id: 'hiking', name: 'Hiking', emoji: '🥾', color: '#10b981',
    gradient: 'from-emerald-500 to-green-600', mapStyle: 'mapbox://styles/mapbox/outdoors-v12',
    avgSpeed: 4, xpMultiplier: 1.5, caloriesPerKm: 50,
  }
}

const DIFFICULTY = {
  easy: { name: 'Easy', color: '#10b981', icon: '🌱', mult: 1.0 },
  moderate: { name: 'Moderate', color: '#f59e0b', icon: '🔥', mult: 1.25 },
  hard: { name: 'Hard', color: '#ef4444', icon: '💪', mult: 1.5 },
  extreme: { name: 'Extreme', color: '#8b5cf6', icon: '⚡', mult: 2.0 },
}

const AVATAR_OPTIONS = {
  backgrounds: ['#06b6d4', '#a855f7', '#f59e0b', '#10b981', '#ef4444', '#3b82f6', '#ec4899', '#8b5cf6'],
  icons: ['🚴', '🏃', '🥾', '🚴‍♂️', '🏃‍♀️', '🧗', '🏆', '⚡', '🔥', '💪', '🎯', '🌟', '👑', '🦁'],
}

const ACHIEVEMENTS = [
  { id: 'first_activity', name: 'First Steps', desc: 'Complete your first activity', icon: '🎯', xp: 50 },
  { id: 'explorer_100', name: 'Explorer', desc: 'Touch 100 tiles', icon: '🗺️', xp: 100 },
  { id: 'conqueror_50', name: 'Conqueror', desc: 'Own 50 tiles', icon: '👑', xp: 200 },
  { id: 'multi_sport', name: 'Multi-Sport', desc: 'All 3 activities', icon: '🏅', xp: 300 },
  { id: 'streak_7', name: 'Week Warrior', desc: '7 day streak', icon: '🔥', xp: 250 },
  { id: 'streak_30', name: 'Monthly Master', desc: '30 day streak', icon: '💎', xp: 500 },
  { id: 'century', name: 'Century', desc: '100km total', icon: '💯', xp: 300 },
]

const LEVEL_XP = [0, 100, 250, 500, 1000, 1750, 2750, 4000, 5500, 7500, 10000]

// ============== UTILITIES ==============
const haversine = (lat1, lon1, lat2, lon2) => {
  const R = 6371000, toRad = x => x * Math.PI / 180
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1)
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2)**2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
}

const sha256 = async (msg) => {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(msg))
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2,'0')).join('')
}

const formatDuration = (sec) => {
  const h = Math.floor(sec/3600), m = Math.floor((sec%3600)/60), s = Math.floor(sec%60)
  return h > 0 ? `${h}:${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}` : `${m}:${s.toString().padStart(2,'0')}`
}

const getLevel = (xp) => { for (let i = LEVEL_XP.length-1; i >= 0; i--) if (xp >= LEVEL_XP[i]) return i+1; return 1 }
const getXpProgress = (xp) => {
  const lvl = getLevel(xp), curr = LEVEL_XP[lvl-1]||0, next = LEVEL_XP[lvl]||LEVEL_XP[LEVEL_XP.length-1]
  return Math.min(((xp-curr)/(next-curr))*100, 100)
}

// ============== CONTEXT ==============
const AppContext = createContext(null)
const useApp = () => useContext(AppContext)

// ============== UI COMPONENTS ==============
function Toast({ message, type, onClose }) {
  useEffect(() => { const t = setTimeout(onClose, 4000); return () => clearTimeout(t) }, [onClose])
  const colors = { success: 'bg-emerald-600', error: 'bg-red-600', warning: 'bg-amber-600', info: 'bg-cyan-600', levelup: 'bg-gradient-to-r from-purple-500 to-pink-600' }
  return (
    <div className={`${colors[type]||colors.info} text-white px-4 py-3 rounded-xl shadow-lg flex items-center gap-3 animate-slide-up`}>
      <CheckCircle className="w-5 h-5" /><span className="flex-1 text-sm font-medium">{message}</span>
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
        <div key={i} className="absolute w-3 h-3 animate-confetti" style={{ left: `${Math.random()*100}%`, animationDelay: `${Math.random()*2}s`, backgroundColor: ['#06b6d4','#a855f7','#f59e0b','#10b981','#ef4444'][Math.floor(Math.random()*5)] }} />
      ))}
    </div>
  )
}

function AvatarDisplay({ avatar, size = 'md' }) {
  const sizes = { sm: 'w-10 h-10 text-lg', md: 'w-16 h-16 text-2xl', lg: 'w-24 h-24 text-4xl', xl: 'w-32 h-32 text-5xl' }
  return (
    <div className={`${sizes[size]} rounded-full flex items-center justify-center`} style={{ backgroundColor: avatar?.background || '#06b6d4' }}>
      {avatar?.photo_url ? <img src={avatar.photo_url} alt="" className="w-full h-full rounded-full object-cover" /> : <span>{avatar?.icon || '🚴'}</span>}
    </div>
  )
}

function LevelBadge({ level, size = 'sm' }) {
  const sizes = { sm: 'w-6 h-6 text-xs', md: 'w-8 h-8 text-sm' }
  const colors = level >= 10 ? 'from-amber-400 to-orange-600' : level >= 7 ? 'from-purple-400 to-pink-600' : level >= 4 ? 'from-cyan-400 to-blue-600' : 'from-slate-400 to-slate-600'
  return <div className={`${sizes[size]} bg-gradient-to-br ${colors} rounded-full flex items-center justify-center font-bold text-white shadow-lg`}>{level}</div>
}

function StreakBadge({ streak }) {
  if (!streak || streak < 2) return null
  return <div className={`flex items-center gap-1 ${streak >= 7 ? 'text-orange-400' : 'text-amber-400'}`}><Flame className="w-4 h-4" /><span className="font-bold text-sm">{streak}</span></div>
}

function WeatherWidget({ weather, activity }) {
  if (!weather) return null
  const icons = { clear: Sun, clouds: Cloud, rain: CloudRain }
  const Icon = icons[weather.condition] || Sun
  return (
    <div className="bg-slate-800/50 rounded-xl p-3 flex items-center gap-3 border border-slate-700">
      <Icon className="w-8 h-8 text-amber-400" />
      <div>
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold text-white">{weather.temp}°C</span>
          <span className="text-sm text-slate-400 capitalize">{weather.condition}</span>
        </div>
        <div className="text-xs text-slate-500">Wind {weather.wind} km/h</div>
      </div>
      {weather.condition === 'rain' && (
        <div className="ml-auto text-xs text-amber-400 bg-amber-400/20 px-2 py-1 rounded">Indoor {activity?.name}?</div>
      )}
    </div>
  )
}

// ============== MAIN APP ==============
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
  const [showConfetti, setShowConfetti] = useState(false)
  const [clan, setClan] = useState(null)
  const [achievements, setAchievements] = useState([])
  const [streak, setStreak] = useState(0)
  const [selectedActivity, setSelectedActivity] = useState(null)
  const [weather, setWeather] = useState(null)
  const [suggestedRoutes, setSuggestedRoutes] = useState([])
  const [showTutorial, setShowTutorial] = useState(false)

  const addToast = useCallback((message, type = 'info') => setToasts(p => [...p, { id: Date.now(), message, type }]), [])
  const removeToast = useCallback((id) => setToasts(p => p.filter(t => t.id !== id)), [])
  const triggerConfetti = useCallback(() => { setShowConfetti(true); setTimeout(() => setShowConfetti(false), 3000) }, [])

  const activity = ACTIVITIES[selectedActivity]

  const addXp = useCallback(async (amount, reason) => {
    if (!user || !profile) return
    const mult = activity?.xpMultiplier || 1
    const gained = Math.floor(amount * mult)
    const oldLvl = getLevel(profile.xp || 0), newXp = (profile.xp || 0) + gained, newLvl = getLevel(newXp)
    const { data } = await supabase.from('profiles').update({ xp: newXp }).eq('id', user.id).select().single()
    if (data) {
      setProfile(data)
      addToast(`+${gained} XP - ${reason}`, 'success')
      if (newLvl > oldLvl) { triggerConfetti(); addToast(`🎉 Level ${newLvl}!`, 'levelup') }
    }
  }, [user, profile, activity, addToast, triggerConfetti])

  // Fetch weather
  useEffect(() => {
    navigator.geolocation.getCurrentPosition(async pos => {
      try {
        const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${pos.coords.latitude}&longitude=${pos.coords.longitude}&current=temperature_2m,weather_code,wind_speed_10m`)
        const data = await res.json()
        if (data.current) {
          const codes = { 0:'clear', 1:'clear', 2:'clouds', 3:'clouds', 51:'rain', 61:'rain', 63:'rain' }
          setWeather({ temp: Math.round(data.current.temperature_2m), condition: codes[data.current.weather_code]||'clear', wind: Math.round(data.current.wind_speed_10m) })
        }
      } catch {}
    }, () => {})
  }, [])

  // Generate routes
  useEffect(() => {
    if (!selectedActivity) return
    const act = ACTIVITIES[selectedActivity]
    const owned = tiles.filter(t => t.activity_type === selectedActivity).length
    const base = act.avgSpeed * 0.5
    let mult = 1
    if (weather?.condition === 'rain') mult *= 0.7
    if (weather?.wind > 20) mult *= 0.9
    
    const diff = owned > 300 ? 'hard' : owned > 100 ? 'moderate' : 'easy'
    setSuggestedRoutes([
      { id: 'quick', name: 'Quick Session', duration: 20, distance: (base*0.4*mult).toFixed(1), difficulty: 'easy', tiles: 5+Math.floor(Math.random()*5), unlocked: true },
      { id: 'standard', name: 'Standard Route', duration: 45, distance: (base*mult).toFixed(1), difficulty: owned > 50 ? 'moderate' : 'easy', tiles: 15+Math.floor(Math.random()*10), unlocked: true },
      { id: 'challenge', name: 'Challenge Route', duration: 75, distance: (base*1.8*mult).toFixed(1), difficulty: diff, tiles: 30+Math.floor(Math.random()*20), unlocked: owned >= 25 },
      { id: 'explorer', name: 'Territory Explorer', duration: 60, distance: (base*1.5*mult).toFixed(1), difficulty: 'moderate', tiles: 25+Math.floor(Math.random()*15), unlocked: owned >= 10 },
    ])
  }, [selectedActivity, tiles, weather])

  // Auth listener
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      if (session?.user) { loadProfile(session.user.id); loadData(session.user.id) }
      else setLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      setUser(session?.user ?? null)
      if (session?.user) { loadProfile(session.user.id); loadData(session.user.id) }
      else { setCurrentPage('onboarding'); setProfile(null); setLoading(false) }
    })
    return () => subscription.unsubscribe()
  }, [])

  const loadProfile = async (userId) => {
    try {
      const { data } = await supabase.from('profiles').select('*').eq('id', userId).single()
      if (data) {
        setProfile(data)
        if (data.preferred_activity) setSelectedActivity(data.preferred_activity)
        if (!data.preferred_activity) setCurrentPage('activitySelect')
        else if (!data.first_name) setCurrentPage('profileSetup')
        else setCurrentPage('home')
        if (data.clan_id) loadClan(data.clan_id)
        loadAchievements(userId)
        calcStreak(userId)
      } else setCurrentPage('activitySelect')
    } catch { setCurrentPage('activitySelect') }
    finally { setLoading(false) }
  }

  const loadData = async (userId) => {
    const [r1, r2, r3, r4] = await Promise.all([
      supabase.from('rides').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
      supabase.from('tiles').select('*').eq('current_owner_user_id', userId),
      supabase.from('route_threats').select('*').eq('defender_user_id', userId).eq('status', 'active'),
      supabase.from('route_unlocks').select('*').eq('user_id', userId).eq('is_unlocked', true)
    ])
    if (r1.data) setRides(r1.data)
    if (r2.data) setTiles(r2.data)
    if (r3.data) setThreats(r3.data)
    if (r4.data) setRouteUnlocks(r4.data)
  }

  const loadClan = async (id) => {
    const { data } = await supabase.from('clans').select('*, clan_members(*, profiles(*))').eq('id', id).single()
    if (data) setClan(data)
  }

  const loadAchievements = async (userId) => {
    const { data } = await supabase.from('user_achievements').select('*').eq('user_id', userId)
    if (data) setAchievements(data.map(a => a.achievement_id))
  }

  const calcStreak = async (userId) => {
    const { data } = await supabase.from('rides').select('started_at').eq('user_id', userId).order('started_at', { ascending: false }).limit(60)
    if (!data?.length) { setStreak(0); return }
    let s = 0, d = new Date(); d.setHours(0,0,0,0)
    const dates = [...new Set(data.map(r => { const x = new Date(r.started_at); x.setHours(0,0,0,0); return x.getTime() }))].sort((a,b)=>b-a)
    for (const rd of dates) { if (d.getTime()-rd <= 86400000) { s++; d = new Date(rd) } else break }
    setStreak(s)
  }

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    setUser(null); setProfile(null); setSelectedActivity(null); setCurrentPage('onboarding')
  }

  const ctx = {
    user, profile, setProfile, rides, setRides, tiles, setTiles, routeUnlocks, threats,
    currentPage, setCurrentPage, addToast, lastRide, setLastRide, handleSignOut, loadData,
    triggerConfetti, clan, setClan, loadClan, achievements, streak, calcStreak, addXp,
    selectedActivity, setSelectedActivity, weather, suggestedRoutes, activity,
    showTutorial, setShowTutorial
  }

  if (loading) return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center">
      <div className="text-center space-y-4">
        <Loader2 className="w-12 h-12 text-cyan-500 animate-spin mx-auto" />
        <p className="text-slate-400">Loading TerritoryTrack...</p>
      </div>
    </div>
  )

  return (
    <AppContext.Provider value={ctx}>
      <div className="min-h-screen bg-slate-900">
        {currentPage === 'onboarding' && <OnboardingScreen />}
        {currentPage === 'auth' && <AuthScreen />}
        {currentPage === 'activitySelect' && <ActivitySelectScreen />}
        {currentPage === 'profileSetup' && user && <ProfileSetupScreen />}
        {user && profile && selectedActivity && !['onboarding','auth','activitySelect','profileSetup'].includes(currentPage) && <MainApp />}
        <ToastContainer toasts={toasts} removeToast={removeToast} />
        <Confetti active={showConfetti} />
        {showTutorial && <TutorialOverlay />}
      </div>
      <style>{`
        @keyframes slide-up { from { transform: translateY(100%); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        @keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
        @keyframes confetti { 0% { transform: translateY(-10vh) rotate(0); opacity:1; } 100% { transform: translateY(100vh) rotate(720deg); opacity:0; } }
        @keyframes float { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-10px); } }
        .animate-slide-up { animation: slide-up 0.3s ease-out; }
        .animate-fade-in { animation: fade-in 0.3s ease-out; }
        .animate-confetti { animation: confetti 3s ease-out forwards; }
        .animate-float { animation: float 3s ease-in-out infinite; }
      `}</style>
    </AppContext.Provider>
  )
}

// ============== TUTORIAL OVERLAY ==============
function TutorialOverlay() {
  const { setShowTutorial, selectedActivity, activity } = useApp()
  const [step, setStep] = useState(1)
  
  const steps = [
    { icon: <MapPin className="w-16 h-16" style={{ color: activity?.color }} />, title: 'Welcome to TerritoryTrack!', desc: `Claim territory while ${activity?.name.toLowerCase()}. The more you move, the more you own.` },
    { icon: <Navigation className="w-16 h-16 text-emerald-400" />, title: 'Track Your Activity', desc: `Tap 'Start ${activity?.name}' to begin tracking your route with GPS.` },
    { icon: <Target className="w-16 h-16 text-purple-400" />, title: 'Unlock Routes', desc: 'Complete the same route 3 times in 7 days to unlock it and claim tiles.' },
    { icon: <Route className="w-16 h-16 text-amber-400" />, title: 'Smart Routes', desc: 'Get personalized route suggestions based on weather and your progress!' },
    { icon: <Trophy className="w-16 h-16 text-yellow-400" />, title: 'Ready to Go!', desc: 'Earn XP, unlock achievements, and dominate the leaderboard!' }
  ]
  const s = steps[step - 1]
  
  const close = () => setShowTutorial(false)
  
  return (
    <div className="fixed inset-0 bg-slate-900/95 backdrop-blur-sm z-50 flex items-center justify-center p-6">
      <div className="max-w-sm w-full animate-fade-in" key={step}>
        <div className="text-center space-y-6">
          <div className="w-32 h-32 bg-slate-800/50 rounded-3xl flex items-center justify-center mx-auto border border-slate-700 animate-float">{s.icon}</div>
          <div className="space-y-3">
            <h2 className="text-2xl font-bold text-white">{s.title}</h2>
            <p className="text-slate-300">{s.desc}</p>
          </div>
          <div className="flex justify-center gap-2">
            {steps.map((_, i) => (
              <div key={i} className={`h-2 rounded-full transition-all ${i + 1 === step ? 'w-8' : 'w-2 bg-slate-700'}`} style={i + 1 === step ? { backgroundColor: activity?.color } : {}} />
            ))}
          </div>
          <div className="space-y-3 pt-4">
            {step < steps.length ? (
              <>
                <button onClick={() => setStep(step + 1)} className={`w-full bg-gradient-to-r ${activity?.gradient} text-white font-bold py-4 rounded-xl`}>Next</button>
                <button onClick={close} className="w-full text-slate-500 hover:text-slate-300 py-2">Skip</button>
              </>
            ) : (
              <button onClick={close} className={`w-full bg-gradient-to-r ${activity?.gradient} text-white font-bold py-4 rounded-xl`}>{activity?.emoji} Let's Go!</button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ============== ONBOARDING ==============
function OnboardingScreen() {
  const { setCurrentPage } = useApp()
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-cyan-900 text-white flex flex-col justify-center px-6">
      <div className="text-center space-y-8 animate-fade-in">
        <div className="w-24 h-24 bg-gradient-to-br from-cyan-500 to-purple-600 rounded-3xl flex items-center justify-center mx-auto animate-float">
          <MapPin className="w-12 h-12 text-white" />
        </div>
        <div>
          <h1 className="text-4xl font-bold mb-2">TerritoryTrack</h1>
          <p className="text-slate-400 text-lg">Cycle. Run. Hike. Conquer.</p>
        </div>
        <div className="space-y-3 pt-8">
          <button onClick={() => setCurrentPage('auth')} className="w-full bg-gradient-to-r from-cyan-500 to-purple-600 text-white font-bold py-4 rounded-xl">
            Get Started
          </button>
        </div>
      </div>
    </div>
  )
}

// ============== AUTH ==============
function AuthScreen() {
  const { addToast, setCurrentPage } = useApp()
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
        <div className="text-center">
          <div className="w-16 h-16 bg-gradient-to-br from-cyan-500 to-purple-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <MapPin className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold">Welcome Back</h1>
        </div>
        
        {!mode && (
          <div className="space-y-3">
            <button onClick={handleGoogle} disabled={loading} className="w-full bg-white text-slate-900 font-semibold py-4 rounded-xl flex items-center justify-center gap-2">
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Continue with Google'}
            </button>
            <button onClick={() => setMode('email')} className="w-full bg-slate-800 text-white py-4 rounded-xl border border-slate-600 flex items-center justify-center gap-2">
              <Mail className="w-5 h-5" />Continue with Email
            </button>
            <button onClick={() => setCurrentPage('onboarding')} className="w-full text-slate-400 py-2">Back</button>
          </div>
        )}
        
        {mode === 'email' && (
          <div className="space-y-4 bg-slate-800/50 rounded-2xl p-6 border border-slate-700">
            <div className="flex gap-2">
              <button onClick={() => setIsSignUp(false)} className={`flex-1 py-2 rounded-lg ${!isSignUp ? 'bg-cyan-600' : 'text-slate-400'}`}>Sign In</button>
              <button onClick={() => setIsSignUp(true)} className={`flex-1 py-2 rounded-lg ${isSignUp ? 'bg-cyan-600' : 'text-slate-400'}`}>Sign Up</button>
            </div>
            {error && <div className="bg-red-500/20 text-red-300 px-4 py-2 rounded-lg text-sm flex items-center gap-2"><AlertCircle className="w-4 h-4" />{error}</div>}
            <input type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} className="w-full px-4 py-3 rounded-xl bg-slate-900 border border-slate-600 focus:border-cyan-500 focus:outline-none" />
            <input type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} className="w-full px-4 py-3 rounded-xl bg-slate-900 border border-slate-600 focus:border-cyan-500 focus:outline-none" />
            <button onClick={handleEmail} disabled={loading} className="w-full bg-cyan-500 text-slate-900 font-bold py-3 rounded-xl">
              {loading ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : isSignUp ? 'Create Account' : 'Sign In'}
            </button>
            <button onClick={() => setMode(null)} className="w-full text-slate-400 py-2">Back</button>
          </div>
        )}
      </div>
    </div>
  )
}

// ============== ACTIVITY SELECT ==============
function ActivitySelectScreen() {
  const { user, setSelectedActivity, setCurrentPage, profile } = useApp()
  const [selected, setSelected] = useState(null)
  const [loading, setLoading] = useState(false)

  const handleContinue = async () => {
    if (!selected) return
    setLoading(true)
    if (user) {
      await supabase.from('profiles').upsert({ id: user.id, preferred_activity: selected, updated_at: new Date().toISOString() })
    }
    setSelectedActivity(selected)
    setLoading(false)
    setCurrentPage(profile?.first_name ? 'home' : 'profileSetup')
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white flex flex-col">
      <div className="flex-1 flex flex-col justify-center px-6 py-12">
        <div className="space-y-8 animate-fade-in">
          <div className="text-center">
            <h1 className="text-3xl font-bold mb-2">Choose Your Activity</h1>
            <p className="text-slate-400">How do you want to conquer territory?</p>
          </div>

          <div className="space-y-4">
            {Object.values(ACTIVITIES).map(act => {
              const isSelected = selected === act.id
              return (
                <button
                  key={act.id}
                  onClick={() => setSelected(act.id)}
                  className={`w-full p-5 rounded-2xl border-2 transition-all ${isSelected ? '' : 'border-slate-700 bg-slate-800/50'}`}
                  style={isSelected ? { borderColor: act.color, backgroundColor: `${act.color}15` } : {}}
                >
                  <div className="flex items-center gap-4">
                    <div className="w-16 h-16 rounded-xl flex items-center justify-center text-3xl" style={{ backgroundColor: `${act.color}20` }}>
                      {act.emoji}
                    </div>
                    <div className="flex-1 text-left">
                      <h3 className="text-xl font-bold">{act.name}</h3>
                      <p className="text-sm text-slate-400">~{act.avgSpeed} km/h avg</p>
                      {act.xpMultiplier > 1 && <p className="text-xs mt-1" style={{ color: act.color }}>{((act.xpMultiplier-1)*100).toFixed(0)}% XP bonus</p>}
                    </div>
                    <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center ${isSelected ? 'bg-white border-white' : 'border-slate-600'}`}>
                      {isSelected && <Check className="w-4 h-4 text-slate-900" />}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      </div>

      <div className="p-6 pb-8">
        <button
          onClick={handleContinue}
          disabled={!selected || loading}
          className={`w-full font-bold py-4 rounded-xl disabled:opacity-50 ${selected ? `bg-gradient-to-r ${ACTIVITIES[selected].gradient} text-white` : 'bg-slate-700 text-slate-400'}`}
        >
          {loading ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : 'Continue'}
        </button>
      </div>
    </div>
  )
}

function ProfileSetupScreen() {
  const { user, setProfile, setCurrentPage, addToast, selectedActivity, activity, setShowTutorial } = useApp()
  const [step, setStep] = useState(1)
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [avatar, setAvatar] = useState({ background: '#06b6d4', icon: '🚴' })
  const [loading, setLoading] = useState(false)
  const [customEmoji, setCustomEmoji] = useState('')
  const [showCustom, setShowCustom] = useState(false)
  const fileRef = useRef(null)

  // Update avatar when activity is loaded
  useEffect(() => {
    if (activity) {
      setAvatar({ background: activity.color, icon: activity.emoji })
    }
  }, [activity])

  const handleSave = async () => {
    if (!firstName.trim()) { addToast('Enter your name', 'error'); return }
    setLoading(true)
    try {
      const fullName = lastName.trim() ? `${firstName.trim()} ${lastName.trim()}` : firstName.trim()
      const { data, error } = await supabase.from('profiles').upsert({
        id: user.id, email: user.email, first_name: firstName.trim(), last_name: lastName.trim() || null,
        name: fullName, avatar_background: avatar.background,
        avatar_icon: avatar.icon, xp: 0, preferred_activity: selectedActivity, updated_at: new Date().toISOString()
      }).select().single()
      if (error) throw error
      setProfile(data); addToast('Profile saved!', 'success'); setCurrentPage('home'); setShowTutorial(true)
    } catch { addToast('Failed to save', 'error') }
    finally { setLoading(false) }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-cyan-900 text-white flex flex-col">
      <div className="flex-1 overflow-auto px-6 pt-12 pb-4">
        <div className="space-y-6 animate-fade-in">
          {step === 1 && (
            <>
              <div className="text-center">
                <h1 className="text-3xl font-bold">What's your name?</h1>
                <p className="text-slate-400 mt-2">Let others know who you are</p>
              </div>
              <div className="space-y-4 pt-4">
                <input type="text" value={firstName} onChange={e => setFirstName(e.target.value)} placeholder="First name" className="w-full px-4 py-3 rounded-xl bg-slate-800 border border-slate-600 focus:outline-none text-lg" style={{ borderColor: firstName ? activity?.color : undefined }} />
                <input type="text" value={lastName} onChange={e => setLastName(e.target.value)} placeholder="Last name" className="w-full px-4 py-3 rounded-xl bg-slate-800 border border-slate-600 focus:outline-none text-lg" style={{ borderColor: lastName ? activity?.color : undefined }} />
              </div>
            </>
          )}
          {step === 2 && (
            <>
              <div className="text-center">
                <h1 className="text-3xl font-bold">Create Avatar</h1>
              </div>
              <div className="flex justify-center py-4">
                <AvatarDisplay avatar={avatar} size="xl" />
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-2">Background</label>
                <div className="flex flex-wrap gap-2">
                  {AVATAR_OPTIONS.backgrounds.map(bg => (
                    <button key={bg} onClick={() => setAvatar(a => ({ ...a, background: bg }))} className={`w-10 h-10 rounded-full ${avatar.background === bg ? 'ring-2 ring-white scale-110' : ''}`} style={{ backgroundColor: bg }} />
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-2">Icon</label>
                <div className="flex flex-wrap gap-2">
                  {AVATAR_OPTIONS.icons.map(ic => (
                    <button key={ic} onClick={() => { setAvatar(a => ({ ...a, icon: ic })); setCustomEmoji('') }} className={`w-10 h-10 rounded-lg bg-slate-800 flex items-center justify-center text-xl ${avatar.icon === ic ? 'ring-2 ring-cyan-400 scale-110' : ''}`}>{ic}</button>
                  ))}
                  <button onClick={() => setShowCustom(!showCustom)} className={`w-10 h-10 rounded-lg bg-slate-800 border-2 border-dashed flex items-center justify-center text-xl ${showCustom ? 'border-cyan-400' : 'border-slate-600'}`}>{customEmoji || '+'}</button>
                </div>
                {showCustom && (
                  <input type="text" value={customEmoji} onChange={e => { const em = [...e.target.value].find(c => /\p{Emoji}/u.test(c)); if (em) { setCustomEmoji(em); setAvatar(a => ({ ...a, icon: em })) } }} placeholder="Type emoji..." className="mt-3 w-full px-4 py-3 rounded-xl bg-slate-800 text-center text-2xl border border-slate-600" maxLength={2} />
                )}
              </div>
            </>
          )}
        </div>
      </div>
      <div className="p-6 pb-8">
        {step === 1 ? (
          <button onClick={() => setStep(2)} disabled={!firstName.trim()} className={`w-full font-bold py-4 rounded-xl disabled:opacity-50 bg-gradient-to-r ${activity?.gradient} text-white`}>Next</button>
        ) : (
          <div className="space-y-3">
            <button onClick={handleSave} disabled={loading} className={`w-full font-bold py-4 rounded-xl disabled:opacity-50 flex items-center justify-center gap-2 bg-gradient-to-r ${activity?.gradient} text-white`}>
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <><Save className="w-5 h-5" />Save</>}
            </button>
            <button onClick={() => setStep(1)} className="w-full text-slate-400 py-2">Back</button>
          </div>
        )}
      </div>
    </div>
  )
}

// ============== MAIN APP ==============
function MainApp() {
  const { currentPage } = useApp()
  return (
    <div className="min-h-screen bg-slate-900 flex flex-col">
      <div className="flex-1 overflow-auto">
        {currentPage === 'home' && <HomePage />}
        {currentPage === 'routes' && <RoutesPage />}
        {currentPage === 'ride' && <RecordingPage />}
        {currentPage === 'rideSummary' && <SummaryPage />}
        {currentPage === 'territory' && <TerritoryPage />}
        {currentPage === 'leaderboard' && <LeaderboardPage />}
        {currentPage === 'profile' && <ProfilePage />}
        {currentPage === 'settings' && <SettingsPage />}
        {currentPage === 'kingOfCity' && <KingOfCityPage />}
        {currentPage === 'clan' && <ClanPage />}
        {currentPage === 'joinClan' && <JoinClanPage />}
        {currentPage === 'createClan' && <CreateClanPage />}
      </div>
      {!['ride', 'rideSummary', 'routes', 'joinClan', 'createClan', 'settings', 'kingOfCity'].includes(currentPage) && <BottomNav />}
    </div>
  )
}

// ============== HOME PAGE ==============
function HomePage() {
  const { profile, rides, tiles, setCurrentPage, streak, clan, selectedActivity, weather, suggestedRoutes, activity } = useApp()
  
  const actTiles = tiles.filter(t => t.activity_type === selectedActivity)
  const weekly = useMemo(() => {
    const wk = Date.now() - 7*86400000
    const wr = rides.filter(r => r.activity_type === selectedActivity && new Date(r.started_at).getTime() >= wk)
    return { count: wr.length, distance: wr.reduce((s,r) => s + (r.distance_m||0), 0) / 1000 }
  }, [rides, selectedActivity])

  const level = getLevel(profile?.xp || 0)
  const xpProg = getXpProgress(profile?.xp || 0)

  return (
    <div className="p-4 space-y-4 pb-24">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-3">
          <div className="relative">
            <AvatarDisplay avatar={{ background: profile?.avatar_background, icon: profile?.avatar_icon }} size="md" />
            <div className="absolute -bottom-1 -right-1"><LevelBadge level={level} /></div>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold text-white">{profile?.first_name}</h1>
              <StreakBadge streak={streak} />
            </div>
            <div className="flex items-center gap-2">
              <div className="bg-slate-700 rounded-full h-2 w-24 overflow-hidden">
                <div className="h-2" style={{ width: `${xpProg}%`, backgroundColor: activity?.color }} />
              </div>
              <span className="text-xs text-slate-400">Lv.{level}</span>
            </div>
          </div>
        </div>
        <button onClick={() => setCurrentPage('profile')} className="p-2 bg-slate-800 rounded-lg">
          <Settings className="w-5 h-5 text-slate-400" />
        </button>
      </div>

      {/* Activity Pills - Toggleable */}
      <div className="flex gap-2 bg-slate-800/50 rounded-xl p-1.5">
        {Object.values(ACTIVITIES).map(act => (
          <button 
            key={act.id} 
            onClick={async () => {
              setSelectedActivity(act.id)
              if (user) await supabase.from('profiles').update({ preferred_activity: act.id }).eq('id', user.id)
            }}
            className={`flex-1 py-2 px-2 rounded-lg flex flex-col items-center justify-center gap-1 transition-all ${selectedActivity === act.id ? '' : 'opacity-40 hover:opacity-70'}`} 
            style={selectedActivity === act.id ? { backgroundColor: `${act.color}30` } : {}}
          >
            <span className="text-xl">{act.emoji}</span>
            <span className="text-xs font-medium text-white">{act.name}</span>
          </button>
        ))}
      </div>

      {/* Weather */}
      {weather && <WeatherWidget weather={weather} activity={activity} />}

      {/* Start Button */}
      <button onClick={() => setCurrentPage('ride')} className={`w-full bg-gradient-to-r ${activity?.gradient} text-white font-bold py-6 rounded-2xl shadow-lg flex items-center justify-center gap-3`} style={{ boxShadow: `0 10px 40px ${activity?.color}40` }}>
        <Play className="w-8 h-8" fill="currentColor" />
        <span className="text-xl">Start {activity?.name}</span>
      </button>

      {/* Route Suggestions */}
      <div className="bg-slate-800/50 rounded-2xl p-4 border border-slate-700">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5" style={{ color: activity?.color }} />
            <span className="font-semibold text-white">Suggested Routes</span>
          </div>
          <button onClick={() => setCurrentPage('routes')} className="text-sm" style={{ color: activity?.color }}>See all →</button>
        </div>
        <div className="space-y-2">
          {suggestedRoutes.slice(0,2).map(route => (
            <div key={route.id} className={`bg-slate-800 rounded-xl p-3 flex items-center gap-3 ${!route.unlocked ? 'opacity-50' : ''}`}>
              <div className="w-10 h-10 rounded-lg flex items-center justify-center text-lg" style={{ backgroundColor: DIFFICULTY[route.difficulty]?.color + '20' }}>
                {DIFFICULTY[route.difficulty]?.icon}
              </div>
              <div className="flex-1">
                <div className="font-medium text-white flex items-center gap-2">
                  {route.name}
                  {!route.unlocked && <Lock className="w-3 h-3 text-slate-500" />}
                </div>
                <div className="text-xs text-slate-400">{route.duration}min • {route.distance}km</div>
              </div>
              <ChevronRight className="w-5 h-5 text-slate-500" />
            </div>
          ))}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-slate-800/50 rounded-xl p-3 text-center border border-slate-700">
          <div className="text-2xl font-bold text-white">{weekly.count}</div>
          <div className="text-xs text-slate-500">this week</div>
        </div>
        <div className="bg-slate-800/50 rounded-xl p-3 text-center border border-slate-700">
          <div className="text-2xl font-bold text-white">{weekly.distance.toFixed(1)}</div>
          <div className="text-xs text-slate-500">km</div>
        </div>
        <div className="bg-slate-800/50 rounded-xl p-3 text-center border border-slate-700">
          <div className="text-2xl font-bold text-white">{actTiles.length}</div>
          <div className="text-xs text-slate-500">tiles</div>
        </div>
      </div>

      {/* Territory Card */}
      <div onClick={() => setCurrentPage('territory')} className="rounded-2xl p-4 border cursor-pointer" style={{ backgroundColor: `${activity?.color}10`, borderColor: `${activity?.color}30` }}>
        <div className="flex justify-between items-start">
          <div>
            <h2 className="text-sm font-semibold" style={{ color: activity?.color }}>{activity?.name} Territory</h2>
            <div className="text-4xl font-bold text-white">{actTiles.length}</div>
            <div className="text-sm text-slate-400">tiles owned</div>
          </div>
          <Trophy className="w-8 h-8" style={{ color: activity?.color }} />
        </div>
      </div>

      {/* King of the City */}
      <div onClick={() => setCurrentPage('kingOfCity')} className="bg-gradient-to-br from-amber-500/20 to-orange-600/20 rounded-2xl p-4 border border-amber-500/30 cursor-pointer">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-12 h-12 bg-amber-500/30 rounded-xl flex items-center justify-center">
            <Crown className="w-6 h-6 text-amber-400" />
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-white flex items-center gap-2">
              King of the City
              {actTiles.length < 50 && <Lock className="w-4 h-4 text-slate-500" />}
            </h3>
            <p className="text-sm text-amber-300/70">
              {actTiles.length >= 50 ? 'Compete on city tracks!' : `${50 - actTiles.length} more tiles to unlock`}
            </p>
          </div>
          <ChevronRight className="w-5 h-5 text-amber-400" />
        </div>
        {actTiles.length >= 50 && (
          <div className="bg-black/20 rounded-lg p-2 text-center">
            <span className="text-xs text-amber-300">🏆 Weekly competition active</span>
          </div>
        )}
      </div>

      {/* Clan */}
      {clan ? (
        <div onClick={() => setCurrentPage('clan')} className="bg-blue-500/20 rounded-2xl p-4 border border-blue-500/30 cursor-pointer">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-blue-500/30 rounded-xl flex items-center justify-center text-2xl">{clan.icon || '⚔️'}</div>
            <div className="flex-1">
              <h3 className="font-semibold text-white">{clan.name}</h3>
              <p className="text-sm text-blue-300">{clan.clan_members?.length || 0} members</p>
            </div>
          </div>
        </div>
      ) : (
        <div onClick={() => setCurrentPage('joinClan')} className="bg-slate-800/50 rounded-2xl p-4 border border-slate-700 cursor-pointer">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-slate-700 rounded-xl flex items-center justify-center">
              <Users className="w-6 h-6 text-slate-400" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-white">Join a Clan</h3>
              <p className="text-sm text-slate-400">Team up with others</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ============== ROUTES PAGE ==============
function RoutesPage() {
  const { suggestedRoutes, selectedActivity, setCurrentPage, tiles, weather, activity } = useApp()
  const owned = tiles.filter(t => t.activity_type === selectedActivity).length

  return (
    <div className="min-h-screen bg-slate-900 pb-6">
      <div className={`p-6 bg-gradient-to-r ${activity?.gradient}`}>
        <div className="flex items-center gap-4 mb-4">
          <button onClick={() => setCurrentPage('home')} className="p-2 bg-white/20 rounded-lg">
            <ChevronLeft className="w-5 h-5 text-white" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-white">Route Suggestions</h1>
            <p className="text-white/70 text-sm">Based on your {owned} tiles</p>
          </div>
        </div>
        {weather && (
          <div className="bg-white/10 rounded-xl p-3 flex items-center gap-3">
            <Sun className="w-6 h-6 text-white" />
            <span className="text-white">{weather.temp}°C • {weather.condition}</span>
          </div>
        )}
      </div>

      <div className="p-4 space-y-4">
        {suggestedRoutes.map(route => {
          const diff = DIFFICULTY[route.difficulty]
          return (
            <div key={route.id} className={`bg-slate-800 rounded-2xl p-4 border border-slate-700 ${!route.unlocked ? 'opacity-60' : ''}`}>
              <div className="flex items-start gap-4">
                <div className="w-14 h-14 rounded-xl flex items-center justify-center text-2xl" style={{ backgroundColor: diff?.color + '20' }}>
                  {diff?.icon}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-white">{route.name}</h3>
                    {!route.unlocked && <Lock className="w-4 h-4 text-slate-500" />}
                  </div>
                  <div className="flex flex-wrap gap-2 mt-2">
                    <span className="bg-slate-700 px-2 py-1 rounded text-xs text-slate-300">⏱ {route.duration}min</span>
                    <span className="bg-slate-700 px-2 py-1 rounded text-xs text-slate-300">📍 {route.distance}km</span>
                    <span className="bg-slate-700 px-2 py-1 rounded text-xs text-slate-300">🗺 ~{route.tiles} tiles</span>
                    <span className="px-2 py-1 rounded text-xs" style={{ backgroundColor: diff?.color + '30', color: diff?.color }}>{diff?.name}</span>
                  </div>
                </div>
              </div>
              {route.unlocked ? (
                <button onClick={() => setCurrentPage('ride')} className={`w-full mt-4 bg-gradient-to-r ${activity?.gradient} text-white font-semibold py-3 rounded-xl`}>
                  Start Route
                </button>
              ) : (
                <div className="mt-4 bg-slate-700/50 rounded-xl p-3 text-center text-sm text-slate-400">
                  🔒 Own {route.id === 'challenge' ? 25 : 10}+ tiles to unlock
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ============== RECORDING PAGE ==============
function RecordingPage() {
  const { user, setRides, setCurrentPage, addToast, setLastRide, triggerConfetti, addXp, calcStreak, selectedActivity, activity, profile } = useApp()
  const [state, setState] = useState('idle')
  const [stats, setStats] = useState({ distance: 0, duration: 0, tiles: 0, speed: 0 })
  const [gps, setGps] = useState('waiting')
  const [cells, setCells] = useState(new Set())
  const [showEnd, setShowEnd] = useState(false)
  const [trackChallenge, setTrackChallenge] = useState(null)
  const [trackCompleted, setTrackCompleted] = useState(false)

  const mapRef = useRef(null), markerRef = useRef(null), containerRef = useRef(null)
  const startRef = useRef(null), pauseRef = useRef(null), pausedRef = useRef(0)
  const watchRef = useRef(null), timerRef = useRef(null), pointsRef = useRef([])

  // Check for active track challenge
  useEffect(() => {
    const saved = localStorage.getItem('activeTrackChallenge')
    if (saved) {
      try {
        const challenge = JSON.parse(saved)
        if (challenge.isActive) {
          setTrackChallenge(challenge)
        }
      } catch {}
    }
  }, [])

  // Check if track distance reached
  useEffect(() => {
    if (trackChallenge && !trackCompleted && state === 'recording') {
      const targetDistance = trackChallenge.distance * 1000 // Convert km to meters
      if (stats.distance >= targetDistance) {
        setTrackCompleted(true)
        const timeSeconds = Math.floor(stats.duration)
        saveTrackTime(trackChallenge, timeSeconds)
        triggerConfetti()
        addToast(`🏆 Track completed! Time: ${formatTrackTime(timeSeconds)}`, 'success')
      }
    }
  }, [stats.distance, trackChallenge, trackCompleted, state, stats.duration])

  const formatTrackTime = (seconds) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  const saveTrackTime = async (challenge, timeSeconds) => {
    try {
      if (challenge.trackId && !['sprint', 'classic', 'king'].includes(challenge.trackId)) {
        await supabase.from('track_times').insert({
          user_id: user.id,
          track_id: challenge.trackId,
          time_seconds: timeSeconds
        })
      }
      localStorage.removeItem('activeTrackChallenge')
    } catch (err) {
      console.error('Failed to save track time:', err)
    }
  }

  const clearTrackChallenge = () => {
    localStorage.removeItem('activeTrackChallenge')
    setTrackChallenge(null)
    setTrackCompleted(false)
  }
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    navigator.geolocation.getCurrentPosition(
      pos => {
        mapRef.current = new mapboxgl.Map({
          container: containerRef.current,
          style: activity?.mapStyle || 'mapbox://styles/mapbox/dark-v11',
          center: [pos.coords.longitude, pos.coords.latitude],
          zoom: 16,
          attributionControl: false
        })
        markerRef.current = new mapboxgl.Marker({ color: activity?.color })
          .setLngLat([pos.coords.longitude, pos.coords.latitude])
          .addTo(mapRef.current)
      },
      () => {
        mapRef.current = new mapboxgl.Map({
          container: containerRef.current,
          style: activity?.mapStyle || 'mapbox://styles/mapbox/dark-v11',
          center: [0, 0], zoom: 2, attributionControl: false
        })
      }
    )
    return () => { if (mapRef.current) mapRef.current.remove() }
  }, [activity])

  const start = useCallback(() => {
    setState('recording')
    startRef.current = Date.now()
    pausedRef.current = 0
    pointsRef.current = []
    setStats({ distance: 0, duration: 0, tiles: 0, speed: 0 })
    setCells(new Set())

    watchRef.current = navigator.geolocation.watchPosition(
      pos => {
        const pt = { lat: pos.coords.latitude, lng: pos.coords.longitude, ts: Date.now(), acc: pos.coords.accuracy }
        setGps(pt.acc <= 20 ? 'good' : pt.acc <= 50 ? 'okay' : 'poor')
        if (pt.acc > CONFIG.MIN_ACCURACY_METERS) return

        const cell = latLngToCell(pt.lat, pt.lng, CONFIG.H3_RESOLUTION)
        setCells(prev => { const n = new Set(prev); n.add(cell); setStats(s => ({ ...s, tiles: n.size })); return n })

        const prev = pointsRef.current
        if (prev.length >= 1) {
          const last = prev[prev.length - 1]
          const dist = haversine(last.lat, last.lng, pt.lat, pt.lng)
          const dt = (pt.ts - last.ts) / 1000
          const spd = dt > 0 ? dist / dt : 0
          if (spd > CONFIG.MAX_SPEED_MS[selectedActivity]) return
          setStats(s => ({ ...s, distance: s.distance + dist, speed: spd * 3.6 }))
        }
        if (mapRef.current && markerRef.current) {
          markerRef.current.setLngLat([pt.lng, pt.lat])
          mapRef.current.flyTo({ center: [pt.lng, pt.lat], zoom: 16 })
        }
        pointsRef.current = [...prev, pt]
      },
      () => setGps('poor'),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
    )
    timerRef.current = setInterval(() => {
      setStats(s => ({ ...s, duration: (Date.now() - startRef.current - pausedRef.current) / 1000 }))
    }, 1000)
    addToast(`${activity?.name} started! ${activity?.emoji}`, 'success')
  }, [selectedActivity, activity, addToast])

  const pause = useCallback(() => {
    setState('paused')
    pauseRef.current = Date.now()
    if (watchRef.current) navigator.geolocation.clearWatch(watchRef.current)
    if (timerRef.current) clearInterval(timerRef.current)
  }, [])

  const resume = useCallback(() => {
    if (pauseRef.current) pausedRef.current += Date.now() - pauseRef.current
    setState('recording')
    watchRef.current = navigator.geolocation.watchPosition(
      pos => {
        const pt = { lat: pos.coords.latitude, lng: pos.coords.longitude, ts: Date.now(), acc: pos.coords.accuracy }
        setGps(pt.acc <= 20 ? 'good' : pt.acc <= 50 ? 'okay' : 'poor')
        if (pt.acc > CONFIG.MIN_ACCURACY_METERS) return
        const cell = latLngToCell(pt.lat, pt.lng, CONFIG.H3_RESOLUTION)
        setCells(prev => { const n = new Set(prev); n.add(cell); setStats(s => ({ ...s, tiles: n.size })); return n })
        const prev = pointsRef.current
        if (prev.length >= 1) {
          const last = prev[prev.length-1], dist = haversine(last.lat, last.lng, pt.lat, pt.lng)
          const dt = (pt.ts - last.ts)/1000, spd = dt > 0 ? dist/dt : 0
          if (spd > CONFIG.MAX_SPEED_MS[selectedActivity]) return
          setStats(s => ({ ...s, distance: s.distance + dist, speed: spd * 3.6 }))
        }
        if (mapRef.current && markerRef.current) { markerRef.current.setLngLat([pt.lng, pt.lat]); mapRef.current.flyTo({ center: [pt.lng, pt.lat], zoom: 16 }) }
        pointsRef.current = [...prev, pt]
      },
      () => setGps('poor'),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
    )
    timerRef.current = setInterval(() => {
      setStats(s => ({ ...s, duration: (Date.now() - startRef.current - pausedRef.current) / 1000 }))
    }, 1000)
  }, [selectedActivity])

  const end = useCallback(async (save) => {
    if (watchRef.current) navigator.geolocation.clearWatch(watchRef.current)
    if (timerRef.current) clearInterval(timerRef.current)
    setShowEnd(false)

    if (!save) { addToast('Discarded', 'info'); setCurrentPage('home'); return }
    if (pointsRef.current.length < CONFIG.MIN_RIDE_POINTS) { addToast('Too short', 'warning'); setCurrentPage('home'); return }

    const cellArr = Array.from(cells)
    const sig = await sha256(cellArr.join(','))
    const ride = {
      user_id: user.id,
      activity_type: selectedActivity,
      started_at: new Date(startRef.current).toISOString(),
      ended_at: new Date().toISOString(),
      duration_sec: Math.floor(stats.duration),
      distance_m: Math.floor(stats.distance),
      route_signature: sig,
      tiles_touched: cellArr.length
    }

    try {
      const { data, error } = await supabase.from('rides').insert(ride).select().single()
      if (error) throw error
      setRides(p => [data, ...p])
      setLastRide({ ...data, h3Cells: cellArr })
      const xp = Math.floor(stats.distance/100) + Math.floor(stats.duration/60) + cellArr.length * 2
      addXp(xp, `${(stats.distance/1000).toFixed(1)}km`)
      calcStreak(user.id)
      triggerConfetti()
      addToast('Saved! 🎉', 'success')
      setCurrentPage('rideSummary')
    } catch {
      addToast('Failed to save', 'error')
      setCurrentPage('home')
    }
  }, [user, stats, cells, selectedActivity, addToast, setCurrentPage, setRides, setLastRide, triggerConfetti, addXp, calcStreak])

  useEffect(() => () => {
    if (watchRef.current) navigator.geolocation.clearWatch(watchRef.current)
    if (timerRef.current) clearInterval(timerRef.current)
  }, [])

  const gpsColor = { waiting: 'bg-slate-500', good: 'bg-emerald-500', okay: 'bg-amber-500', poor: 'bg-red-500' }

  return (
    <div className="h-screen flex flex-col bg-slate-900">
      <div ref={containerRef} className="flex-1 relative">
        {/* Track Challenge Banner */}
        {trackChallenge && (
          <div className="absolute top-0 left-0 right-0 bg-gradient-to-r from-amber-500 to-orange-500 p-3 z-20 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Crown className="w-5 h-5 text-white" />
              <div>
                <p className="text-white font-bold text-sm">{trackChallenge.trackName}</p>
                <p className="text-white/80 text-xs">
                  {trackCompleted ? '✅ Completed!' : `Target: ${trackChallenge.distance}km`}
                </p>
              </div>
            </div>
            {!trackCompleted && (
              <div className="text-right">
                <p className="text-white font-bold">{((trackChallenge.distance * 1000 - stats.distance) / 1000).toFixed(2)}km</p>
                <p className="text-white/80 text-xs">remaining</p>
              </div>
            )}
            {state === 'idle' && (
              <button onClick={clearTrackChallenge} className="p-1 bg-white/20 rounded">
                <X className="w-4 h-4 text-white" />
              </button>
            )}
          </div>
        )}

        {/* Stats overlay */}
        <div className={`absolute left-0 right-0 bg-gradient-to-b from-slate-900 via-slate-900/95 to-transparent p-6 z-10 ${trackChallenge ? 'top-14' : 'top-0'}`}>
          <div className="text-center">
            <div className="text-6xl font-bold text-white tabular-nums">{(stats.distance / 1000).toFixed(2)}</div>
            <div className="text-lg font-medium" style={{ color: activity?.color }}>kilometers</div>
            <div className="text-3xl font-semibold text-white/80 tabular-nums">{formatDuration(stats.duration)}</div>
          </div>
          {state !== 'idle' && (
            <div className="mt-4 flex justify-center gap-4">
              <div className="bg-slate-800/80 rounded-full px-4 py-2 flex items-center gap-2">
                <MapPin className="w-4 h-4" style={{ color: activity?.color }} />
                <span style={{ color: activity?.color }} className="font-semibold">{stats.tiles} tiles</span>
              </div>
              <div className="bg-slate-800/80 rounded-full px-4 py-2 flex items-center gap-2">
                <Zap className="w-4 h-4 text-white" />
                <span className="text-white font-semibold">{stats.speed.toFixed(1)} km/h</span>
              </div>
            </div>
          )}
          {/* Track progress bar */}
          {trackChallenge && state !== 'idle' && !trackCompleted && (
            <div className="mt-4">
              <div className="bg-slate-700 rounded-full h-2 overflow-hidden">
                <div 
                  className="bg-gradient-to-r from-amber-500 to-orange-500 h-2 rounded-full transition-all" 
                  style={{ width: `${Math.min((stats.distance / (trackChallenge.distance * 1000)) * 100, 100)}%` }} 
                />
              </div>
            </div>
          )}
        </div>

        {/* GPS indicator */}
        <div className={`absolute right-6 z-10 ${trackChallenge ? 'top-20' : 'top-6'}`}>
          <div className="flex items-center gap-2 bg-slate-800/80 rounded-full px-3 py-1.5">
            <div className={`${gpsColor[gps]} w-2 h-2 rounded-full ${gps === 'good' ? 'animate-pulse' : ''}`} />
            <span className="text-xs text-slate-300">{gps === 'good' ? 'Strong' : gps === 'okay' ? 'Fair' : 'Weak'}</span>
          </div>
        </div>

        {/* Back button */}
        {state === 'idle' && (
          <button onClick={() => { clearTrackChallenge(); setCurrentPage('home') }} className={`absolute left-6 z-10 bg-slate-800/80 rounded-full p-2 ${trackChallenge ? 'top-20' : 'top-6'}`}>
            <ChevronLeft className="w-6 h-6 text-white" />
          </button>
        )}
      </div>

      {/* Controls */}
      <div className="bg-slate-800 p-6 border-t border-slate-700">
        {state === 'idle' && (
          <button onClick={start} className={`w-full bg-gradient-to-r ${trackChallenge ? 'from-amber-500 to-orange-500' : activity?.gradient} text-white font-bold py-5 rounded-2xl flex items-center justify-center gap-3`}>
            <Play className="w-7 h-7" fill="currentColor" />
            <span className="text-xl">{trackChallenge ? `Start ${trackChallenge.trackName}` : `Start ${activity?.name}`}</span>
          </button>
        )}
        {state === 'recording' && (
          <div className="flex gap-3">
            <button onClick={pause} className="flex-1 bg-amber-600 text-white font-bold py-4 rounded-xl flex items-center justify-center gap-2">
              <Pause className="w-6 h-6" />Pause
            </button>
            <button onClick={() => setShowEnd(true)} className="flex-1 bg-red-600 text-white font-bold py-4 rounded-xl flex items-center justify-center gap-2">
              <StopCircle className="w-6 h-6" />End
            </button>
          </div>
        )}
        {state === 'paused' && (
          <div className="space-y-3">
            <div className="bg-amber-500/20 border border-amber-500/50 rounded-xl p-3 text-center">
              <span className="text-amber-300 font-medium">⏸️ Paused</span>
            </div>
            <div className="flex gap-3">
              <button onClick={resume} className={`flex-1 bg-gradient-to-r ${activity?.gradient} text-white font-bold py-4 rounded-xl flex items-center justify-center gap-2`}>
                <Play className="w-6 h-6" fill="currentColor" />Resume
              </button>
              <button onClick={() => setShowEnd(true)} className="flex-1 bg-red-600 text-white font-bold py-4 rounded-xl flex items-center justify-center gap-2">
                <StopCircle className="w-6 h-6" />End
              </button>
            </div>
          </div>
        )}
      </div>

      {/* End confirmation modal */}
      {showEnd && (
        <div className="fixed inset-0 bg-slate-900/90 z-50 flex items-center justify-center p-6">
          <div className="bg-slate-800 rounded-2xl p-6 max-w-sm w-full border border-slate-700">
            <div className="text-center mb-4">
              <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <StopCircle className="w-8 h-8 text-red-400" />
              </div>
              <h2 className="text-xl font-bold text-white">End {activity?.name}?</h2>
            </div>
            <div className="bg-slate-700/50 rounded-xl p-4 mb-4">
              <div className="grid grid-cols-3 gap-4 text-center">
                <div><div className="text-lg font-bold text-white">{(stats.distance/1000).toFixed(2)}</div><div className="text-xs text-slate-500">km</div></div>
                <div><div className="text-lg font-bold text-white">{formatDuration(stats.duration)}</div><div className="text-xs text-slate-500">time</div></div>
                <div><div className="text-lg font-bold text-white">{stats.tiles}</div><div className="text-xs text-slate-500">tiles</div></div>
              </div>
            </div>
            <div className="space-y-2">
              <button onClick={() => end(true)} className="w-full bg-emerald-600 text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2">
                <Save className="w-5 h-5" />Save
              </button>
              <button onClick={() => end(false)} className="w-full bg-red-600/20 text-red-400 font-semibold py-3 rounded-xl border border-red-600/30">
                Discard
              </button>
              <button onClick={() => setShowEnd(false)} className="w-full text-slate-400 py-2">
                Continue
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ============== SUMMARY PAGE ==============
function SummaryPage() {
  const { lastRide, rides, setCurrentPage, activity } = useApp()
  
  const recentCount = useMemo(() => {
    if (!lastRide) return 0
    const wk = Date.now() - 7*86400000
    return rides.filter(r => r.route_signature === lastRide.route_signature && new Date(r.started_at).getTime() >= wk).length
  }, [rides, lastRide])

  const unlocked = recentCount >= 3
  const xp = lastRide ? Math.floor(lastRide.distance_m/100) + Math.floor(lastRide.duration_sec/60) + (lastRide.tiles_touched||0)*2 : 0

  if (!lastRide) return <div className="min-h-screen bg-slate-900 flex items-center justify-center"><button onClick={() => setCurrentPage('home')} className="text-cyan-400">Go Home</button></div>

  return (
    <div className="min-h-screen bg-slate-900 p-4 space-y-4">
      <div className={`bg-gradient-to-br ${activity?.gradient} rounded-3xl p-6 text-white text-center`}>
        <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-3">
          <CheckCircle className="w-10 h-10" />
        </div>
        <p className="text-white/80 font-medium">Great {activity?.name.toLowerCase()}!</p>
        <div className="text-5xl font-bold">{(lastRide.distance_m/1000).toFixed(2)}</div>
        <div className="text-lg text-white/80">kilometers</div>
        <div className="mt-4 inline-flex items-center gap-2 bg-white/20 rounded-full px-4 py-2">
          <Star className="w-5 h-5 text-amber-300" />
          <span className="font-bold">+{Math.floor(xp * (activity?.xpMultiplier || 1))} XP</span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="bg-slate-800 rounded-2xl p-4 text-center border border-slate-700">
          <Clock className="w-5 h-5 mx-auto mb-1" style={{ color: activity?.color }} />
          <div className="text-xl font-bold text-white">{formatDuration(lastRide.duration_sec)}</div>
          <div className="text-xs text-slate-500">Duration</div>
        </div>
        <div className="bg-slate-800 rounded-2xl p-4 text-center border border-slate-700">
          <Zap className="w-5 h-5 text-amber-400 mx-auto mb-1" />
          <div className="text-xl font-bold text-white">{((lastRide.distance_m/lastRide.duration_sec)*3.6).toFixed(1)}</div>
          <div className="text-xs text-slate-500">km/h avg</div>
        </div>
        <div className="bg-slate-800 rounded-2xl p-4 text-center border border-slate-700">
          <MapPin className="w-5 h-5 text-purple-400 mx-auto mb-1" />
          <div className="text-xl font-bold text-white">{lastRide.tiles_touched || 0}</div>
          <div className="text-xs text-slate-500">Tiles</div>
        </div>
      </div>

      <div className="bg-slate-800 rounded-2xl p-4 border border-slate-700">
        <div className="flex items-center justify-between mb-3">
          <span className="font-semibold text-white">Route Progress</span>
          <span className="text-sm font-bold" style={{ color: activity?.color }}>{Math.min(recentCount, 3)}/3</span>
        </div>
        <div className="flex justify-center gap-4">
          {[1,2,3].map(i => (
            <div key={i} className={`w-14 h-14 rounded-full flex items-center justify-center font-bold text-lg ${i <= recentCount ? 'text-white' : 'bg-slate-700 text-slate-500'}`} style={i <= recentCount ? { backgroundColor: activity?.color } : {}}>
              {i <= recentCount ? <CheckCircle className="w-7 h-7" /> : i}
            </div>
          ))}
        </div>
        <div className={`mt-4 rounded-xl p-4 flex items-center gap-3 ${unlocked ? 'bg-emerald-500/20 border border-emerald-500/50' : 'bg-slate-700/50'}`}>
          <div className={`w-12 h-12 rounded-full flex items-center justify-center ${unlocked ? 'bg-emerald-500' : 'bg-slate-700'}`}>
            {unlocked ? <Unlock className="w-6 h-6 text-white" /> : <Lock className="w-6 h-6 text-slate-500" />}
          </div>
          <div>
            <p className={`font-bold ${unlocked ? 'text-emerald-300' : 'text-white'}`}>
              {unlocked ? '🎉 Route Unlocked!' : 'Keep going!'}
            </p>
            <p className="text-sm text-slate-400">
              {unlocked ? 'Tiles are yours!' : `${3-recentCount} more to unlock`}
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-3 pt-2">
        <button onClick={() => setCurrentPage('home')} className={`w-full bg-gradient-to-r ${activity?.gradient} text-white font-bold py-4 rounded-xl`}>
          Done
        </button>
        <button onClick={() => setCurrentPage('territory')} className="w-full bg-slate-800 text-white font-semibold py-4 rounded-xl border border-slate-600">
          View Territory
        </button>
      </div>
    </div>
  )
}

function TerritoryPage() {
  const { tiles, selectedActivity, activity } = useApp()
  const containerRef = useRef(null), mapRef = useRef(null)
  const actTiles = tiles.filter(t => t.activity_type === selectedActivity)

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    navigator.geolocation.getCurrentPosition(
      pos => {
        mapRef.current = new mapboxgl.Map({
          container: containerRef.current,
          style: activity?.mapStyle || 'mapbox://styles/mapbox/dark-v11',
          center: [pos.coords.longitude, pos.coords.latitude],
          zoom: 13, attributionControl: false
        })
        mapRef.current.on('load', () => {
          if (actTiles.length > 0) {
            const features = actTiles.map(t => ({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [cellToBoundary(t.h3_index, true)] } }))
            mapRef.current.addSource('tiles', { type: 'geojson', data: { type: 'FeatureCollection', features } })
            mapRef.current.addLayer({ id: 'tiles-fill', type: 'fill', source: 'tiles', paint: { 'fill-color': activity?.color, 'fill-opacity': 0.4 } })
            mapRef.current.addLayer({ id: 'tiles-line', type: 'line', source: 'tiles', paint: { 'line-color': activity?.color, 'line-width': 2 } })
          }
        })
      },
      () => { mapRef.current = new mapboxgl.Map({ container: containerRef.current, style: 'mapbox://styles/mapbox/dark-v11', center: [0, 0], zoom: 2, attributionControl: false }) }
    )
    return () => { if (mapRef.current) mapRef.current.remove() }
  }, [actTiles, activity])

  return (
    <div className="h-screen flex flex-col bg-slate-900">
      <div className="bg-slate-800 p-4 border-b border-slate-700">
        <h1 className="text-xl font-bold text-white">{activity?.name} Territory</h1>
        <p className="text-sm text-slate-400">{actTiles.length} tiles owned</p>
      </div>
      <div ref={containerRef} className="flex-1" />
      {actTiles.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="bg-slate-800/90 rounded-2xl p-6 m-4 text-center max-w-sm">
            <MapPin className="w-12 h-12 mx-auto mb-3" style={{ color: activity?.color }} />
            <h3 className="font-bold text-white mb-2">No Territory Yet</h3>
            <p className="text-sm text-slate-400">Complete {activity?.name.toLowerCase()} to claim tiles!</p>
          </div>
        </div>
      )}
    </div>
  )
}

// ============== LEADERBOARD PAGE ==============
function LeaderboardPage() {
  const { user, profile, selectedActivity, activity } = useApp()
  const [leaders, setLeaders] = useState([])
  const [loading, setLoading] = useState(true)
  const [actFilter, setActFilter] = useState(selectedActivity)
  const [scope, setScope] = useState('global')
  const [location, setLocation] = useState({ city: profile?.city, country: profile?.country })

  useEffect(() => {
    if (!location.city && !profile?.city) {
      navigator.geolocation.getCurrentPosition(async pos => {
        try {
          const res = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${pos.coords.longitude},${pos.coords.latitude}.json?types=place,country&access_token=${mapboxgl.accessToken}`)
          const data = await res.json()
          const city = data.features?.find(f => f.place_type.includes('place'))?.text
          const country = data.features?.find(f => f.place_type.includes('country'))?.text
          setLocation({ city, country })
          if (user) await supabase.from('profiles').update({ city, country }).eq('id', user.id)
        } catch {}
      }, () => {})
    }
  }, [user, profile])

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      let query = supabase.from('leaderboard').select('*')
      if (scope === 'city' && location.city) query = query.eq('city', location.city)
      else if (scope === 'country' && location.country) query = query.eq('country', location.country)
      const { data } = await query.limit(50)
      setLeaders(data || [])
      setLoading(false)
    }
    load()
  }, [actFilter, scope, location])

  return (
    <div className="min-h-screen bg-slate-900 pb-24">
      <div className={`p-6 bg-gradient-to-r ${activity?.gradient}`}>
        <div className="flex items-center gap-3 mb-4">
          <Trophy className="w-8 h-8 text-white" />
          <h1 className="text-2xl font-bold text-white">Leaderboard</h1>
        </div>
        <div className="flex gap-1 bg-black/20 p-1 rounded-lg mb-3">
          {Object.values(ACTIVITIES).map(act => (
            <button key={act.id} onClick={() => setActFilter(act.id)} className={`flex-1 py-1.5 rounded-md text-sm ${actFilter === act.id ? 'bg-white/20 text-white' : 'text-white/60'}`}>{act.emoji}</button>
          ))}
          <button onClick={() => setActFilter('all')} className={`flex-1 py-1.5 rounded-md text-sm ${actFilter === 'all' ? 'bg-white/20 text-white' : 'text-white/60'}`}>All</button>
        </div>
        <div className="flex gap-1 bg-black/20 p-1 rounded-lg">
          <button onClick={() => setScope('city')} disabled={!location.city} className={`flex-1 py-1.5 rounded-md text-sm ${scope === 'city' ? 'bg-white/20 text-white' : 'text-white/60'} ${!location.city ? 'opacity-50' : ''}`}>🏙️ City</button>
          <button onClick={() => setScope('country')} disabled={!location.country} className={`flex-1 py-1.5 rounded-md text-sm ${scope === 'country' ? 'bg-white/20 text-white' : 'text-white/60'} ${!location.country ? 'opacity-50' : ''}`}>🌍 Country</button>
          <button onClick={() => setScope('global')} className={`flex-1 py-1.5 rounded-md text-sm ${scope === 'global' ? 'bg-white/20 text-white' : 'text-white/60'}`}>🌐 Global</button>
        </div>
      </div>
      <div className="p-4 space-y-2">
        {loading ? <div className="text-center py-12"><Loader2 className="w-8 h-8 animate-spin mx-auto text-slate-500" /></div> :
        leaders.length === 0 ? <div className="text-center py-16"><Trophy className="w-16 h-16 mx-auto mb-4 text-slate-600" /><p className="text-slate-500">No entries yet</p></div> :
        leaders.map((e, i) => (
          <div key={e.user_id} className={`bg-slate-800 rounded-xl p-4 flex items-center gap-4 border ${e.user_id === user?.id ? 'border-cyan-500 bg-cyan-500/10' : 'border-slate-700'}`}>
            <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold ${i === 0 ? 'bg-amber-500' : i === 1 ? 'bg-slate-400' : i === 2 ? 'bg-orange-700' : 'bg-slate-700 text-slate-400'} text-white`}>{i === 0 ? '👑' : i + 1}</div>
            <div className="flex-1">
              <div className="font-semibold text-white">{e.first_name ? `${e.first_name} ${e.last_name}` : 'Anonymous'}{e.user_id === user?.id && <span className="ml-2 text-xs text-cyan-400">(You)</span>}</div>
              <div className="text-sm text-slate-500">{e.tiles_owned || 0} tiles</div>
            </div>
            {i < 3 && <div className="text-2xl">{['🥇', '🥈', '🥉'][i]}</div>}
          </div>
        ))}
      </div>
    </div>
  )
}

// ============== PROFILE PAGE ==============
function ProfilePage() {
  const { user, profile, rides, tiles, handleSignOut, setCurrentPage, streak, achievements, selectedActivity, activity } = useApp()
  const totalDist = rides.reduce((s, r) => s + (r.distance_m || 0), 0)
  const level = getLevel(profile?.xp || 0)

  return (
    <div className="min-h-screen bg-slate-900 pb-24">
      <div className={`p-6 bg-gradient-to-r ${activity?.gradient}`}>
        <div className="flex items-center gap-4 mb-6">
          <div className="relative">
            <AvatarDisplay avatar={{ background: profile?.avatar_background, icon: profile?.avatar_icon }} size="lg" />
            <div className="absolute -bottom-1 -right-1"><LevelBadge level={level} size="md" /></div>
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2"><h1 className="text-xl font-bold text-white">{profile?.first_name} {profile?.last_name}</h1><StreakBadge streak={streak} /></div>
            <p className="text-sm text-white/70">{user?.email}</p>
            <p className="text-sm text-white/80 mt-1">{profile?.xp || 0} XP • Level {level}</p>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4 bg-white/10 rounded-xl p-4">
          <div className="text-center"><div className="text-2xl font-bold text-white">{rides.length}</div><div className="text-xs text-white/70">Activities</div></div>
          <div className="text-center"><div className="text-2xl font-bold text-white">{(totalDist / 1000).toFixed(0)}</div><div className="text-xs text-white/70">km</div></div>
          <div className="text-center"><div className="text-2xl font-bold text-white">{tiles.length}</div><div className="text-xs text-white/70">Tiles</div></div>
        </div>
      </div>
      <div className="p-4 space-y-4">
        {/* Settings Button */}
        <button onClick={() => setCurrentPage('settings')} className="w-full bg-slate-800 rounded-xl p-4 border border-slate-700 flex items-center gap-3">
          <div className="w-10 h-10 bg-slate-700 rounded-lg flex items-center justify-center">
            <Settings className="w-5 h-5 text-slate-400" />
          </div>
          <div className="flex-1 text-left">
            <div className="font-medium text-white">Settings</div>
            <div className="text-xs text-slate-400">Avatar, activity, preferences</div>
          </div>
          <ChevronRight className="w-5 h-5 text-slate-500" />
        </button>

        <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
          <h2 className="font-semibold text-white mb-3">Activity Breakdown</h2>
          {Object.values(ACTIVITIES).map(act => {
            const actRides = rides.filter(r => r.activity_type === act.id)
            const actDist = actRides.reduce((s, r) => s + (r.distance_m || 0), 0) / 1000
            return (
              <div key={act.id} className="flex items-center gap-3 py-2 border-b border-slate-700 last:border-0">
                <span className="text-2xl">{act.emoji}</span>
                <div className="flex-1">
                  <div className="font-medium text-white">{act.name}</div>
                  <div className="text-xs text-slate-400">{actRides.length} sessions • {actDist.toFixed(1)} km</div>
                </div>
              </div>
            )
          })}
        </div>
        <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
          <h2 className="font-semibold text-white mb-3 flex items-center gap-2"><Award className="w-5 h-5 text-amber-400" />Achievements</h2>
          <p className="text-sm text-slate-400">{achievements.length}/{ACHIEVEMENTS.length} unlocked</p>
        </div>
        <button onClick={handleSignOut} className="w-full bg-red-600/20 text-red-400 font-semibold py-4 rounded-xl border border-red-600/30 flex items-center justify-center gap-2">
          <LogOut className="w-5 h-5" />Sign Out
        </button>
      </div>
    </div>
  )
}

// ============== SETTINGS PAGE ==============
function SettingsPage() {
  const { user, profile, setProfile, setCurrentPage, addToast, selectedActivity, setSelectedActivity, activity } = useApp()
  const [avatar, setAvatar] = useState({ background: profile?.avatar_background || '#06b6d4', icon: profile?.avatar_icon || '🚴' })
  const [customEmoji, setCustomEmoji] = useState('')
  const [showCustom, setShowCustom] = useState(false)
  const [saving, setSaving] = useState(false)

  const saveAvatar = async () => {
    setSaving(true)
    try {
      const { data, error } = await supabase.from('profiles').update({
        avatar_background: avatar.background,
        avatar_icon: avatar.icon,
        updated_at: new Date().toISOString()
      }).eq('id', user.id).select().single()
      if (error) throw error
      setProfile(data)
      addToast('Avatar updated!', 'success')
    } catch { addToast('Failed to save', 'error') }
    finally { setSaving(false) }
  }

  const changeActivity = async (actId) => {
    setSelectedActivity(actId)
    await supabase.from('profiles').update({ preferred_activity: actId }).eq('id', user.id)
    addToast(`Switched to ${ACTIVITIES[actId].name}!`, 'success')
  }

  return (
    <div className="min-h-screen bg-slate-900">
      <div className="bg-slate-800 p-4 border-b border-slate-700 flex items-center gap-4">
        <button onClick={() => setCurrentPage('profile')} className="p-2 bg-slate-700 rounded-lg">
          <ChevronLeft className="w-5 h-5 text-white" />
        </button>
        <h1 className="text-xl font-bold text-white">Settings</h1>
      </div>

      <div className="p-4 space-y-6">
        {/* Avatar Section */}
        <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
          <h2 className="font-semibold text-white mb-4 flex items-center gap-2">
            <Camera className="w-5 h-5" style={{ color: activity?.color }} />
            Edit Avatar
          </h2>
          
          <div className="flex justify-center mb-4">
            <AvatarDisplay avatar={avatar} size="xl" />
          </div>

          <div className="mb-4">
            <label className="block text-sm text-slate-400 mb-2">Background</label>
            <div className="flex flex-wrap gap-2">
              {AVATAR_OPTIONS.backgrounds.map(bg => (
                <button key={bg} onClick={() => setAvatar(a => ({ ...a, background: bg }))} className={`w-10 h-10 rounded-full transition-transform ${avatar.background === bg ? 'ring-2 ring-white scale-110' : ''}`} style={{ backgroundColor: bg }} />
              ))}
            </div>
          </div>

          <div className="mb-4">
            <label className="block text-sm text-slate-400 mb-2">Icon</label>
            <div className="flex flex-wrap gap-2">
              {AVATAR_OPTIONS.icons.map(ic => (
                <button key={ic} onClick={() => { setAvatar(a => ({ ...a, icon: ic })); setCustomEmoji('') }} className={`w-10 h-10 rounded-lg bg-slate-700 flex items-center justify-center text-xl transition-transform ${avatar.icon === ic ? 'ring-2 ring-cyan-400 scale-110' : ''}`}>{ic}</button>
              ))}
              <button onClick={() => setShowCustom(!showCustom)} className={`w-10 h-10 rounded-lg bg-slate-700 border-2 border-dashed flex items-center justify-center text-xl ${showCustom ? 'border-cyan-400' : 'border-slate-600'}`}>{customEmoji || '+'}</button>
            </div>
            {showCustom && (
              <input type="text" value={customEmoji} onChange={e => { const em = [...e.target.value].find(c => /\p{Emoji}/u.test(c)); if (em) { setCustomEmoji(em); setAvatar(a => ({ ...a, icon: em })) } }} placeholder="Type emoji..." className="mt-3 w-full px-4 py-3 rounded-xl bg-slate-700 text-center text-2xl border border-slate-600" maxLength={2} />
            )}
          </div>

          <button onClick={saveAvatar} disabled={saving} className={`w-full bg-gradient-to-r ${activity?.gradient} text-white font-semibold py-3 rounded-xl disabled:opacity-50 flex items-center justify-center gap-2`}>
            {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <><Save className="w-5 h-5" />Save Avatar</>}
          </button>
        </div>

        {/* Activity Selection */}
        <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
          <h2 className="font-semibold text-white mb-4">Default Activity</h2>
          <div className="space-y-2">
            {Object.values(ACTIVITIES).map(act => (
              <button
                key={act.id}
                onClick={() => changeActivity(act.id)}
                className={`w-full p-3 rounded-xl flex items-center gap-3 transition-all ${selectedActivity === act.id ? 'border-2' : 'bg-slate-700'}`}
                style={selectedActivity === act.id ? { borderColor: act.color, backgroundColor: `${act.color}20` } : {}}
              >
                <span className="text-2xl">{act.emoji}</span>
                <div className="flex-1 text-left">
                  <div className="font-medium text-white">{act.name}</div>
                  <div className="text-xs text-slate-400">{act.xpMultiplier > 1 ? `${((act.xpMultiplier-1)*100).toFixed(0)}% XP bonus` : 'Standard XP'}</div>
                </div>
                {selectedActivity === act.id && <Check className="w-5 h-5" style={{ color: act.color }} />}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ============== KING OF THE CITY PAGE ==============
function KingOfCityPage() {
  const { user, profile, tiles, selectedActivity, setCurrentPage, activity, addToast } = useApp()
  const [tab, setTab] = useState('tracks')
  const [leaderboard, setLeaderboard] = useState([])
  const [myTimes, setMyTimes] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedTrack, setSelectedTrack] = useState(null)
  const [cityTracks, setCityTracks] = useState([])
  
  const actTiles = tiles.filter(t => t.activity_type === selectedActivity)
  const isQualified = actTiles.length >= 50
  const city = profile?.city || null

  // Load tracks for user's city
  useEffect(() => {
    const loadTracks = async () => {
      if (!city) {
        // Try to detect city
        navigator.geolocation.getCurrentPosition(async pos => {
          try {
            const res = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${pos.coords.longitude},${pos.coords.latitude}.json?types=place&access_token=${mapboxgl.accessToken}`)
            const data = await res.json()
            const detectedCity = data.features?.[0]?.text
            if (detectedCity && user) {
              await supabase.from('profiles').update({ city: detectedCity }).eq('id', user.id)
              loadTracksForCity(detectedCity)
            }
          } catch {}
        })
        return
      }
      loadTracksForCity(city)
    }

    const loadTracksForCity = async (cityName) => {
      const { data } = await supabase
        .from('city_tracks')
        .select('*')
        .eq('city', cityName)
        .eq('activity_type', selectedActivity)
        .eq('is_active', true)
      
      if (data && data.length > 0) {
        setCityTracks(data)
        setSelectedTrack(data[0])
      } else {
        // No tracks for this city - show default generated ones
        setCityTracks(generateDefaultTracks(cityName))
      }
      setLoading(false)
    }

    loadTracks()
  }, [city, selectedActivity, user])

  // Generate default point-to-point tracks based on user location
  const generateDefaultTracks = (cityName) => {
    return [
      { 
        id: 'sprint', 
        name: `${cityName} Sprint`, 
        distance_km: 2, 
        difficulty: 'easy', 
        description: 'Quick 2km point-to-point dash', 
        icon: '⚡',
        city: cityName,
        activity_type: selectedActivity
      },
      { 
        id: 'classic', 
        name: `${cityName} Classic`, 
        distance_km: 5, 
        difficulty: 'moderate', 
        description: 'Standard 5km challenge', 
        icon: '🔄',
        city: cityName,
        activity_type: selectedActivity
      },
      { 
        id: 'king', 
        name: `King of ${cityName}`, 
        distance_km: 10, 
        difficulty: 'hard', 
        description: 'Ultimate 10km test', 
        icon: '👑',
        city: cityName,
        activity_type: selectedActivity
      },
    ]
  }

  // Load leaderboard for selected track
  useEffect(() => {
    const loadLeaderboard = async () => {
      if (!selectedTrack?.id) return
      setLoading(true)
      
      // For database tracks
      if (selectedTrack.id && !['sprint', 'classic', 'king'].includes(selectedTrack.id)) {
        const { data } = await supabase
          .from('weekly_track_leaderboard')
          .select('*')
          .eq('track_id', selectedTrack.id)
          .order('time_seconds', { ascending: true })
          .limit(20)
        
        setLeaderboard(data || [])
      } else {
        // For generated tracks, show empty or mock
        setLeaderboard([])
      }
      setLoading(false)
    }

    if (tab === 'leaderboard') loadLeaderboard()
  }, [selectedTrack, tab])

  // Load user's times
  useEffect(() => {
    const loadMyTimes = async () => {
      if (!user) return
      
      const { data } = await supabase
        .from('track_times')
        .select('*, city_tracks(*)')
        .eq('user_id', user.id)
        .order('recorded_at', { ascending: false })
        .limit(20)
      
      setMyTimes(data || [])
    }

    if (tab === 'myTimes') loadMyTimes()
  }, [user, tab])

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  const startTrackChallenge = (track) => {
    // Store selected track in localStorage for the ride recording page
    localStorage.setItem('activeTrackChallenge', JSON.stringify({
      trackId: track.id,
      trackName: track.name,
      distance: track.distance_km,
      startTime: null,
      isActive: true
    }))
    addToast(`${track.name} selected! Start your ${activity?.name.toLowerCase()} to begin.`, 'success')
    setCurrentPage('ride')
  }

  if (!isQualified) {
    return (
      <div className="min-h-screen bg-slate-900">
        <div className="bg-slate-800 p-4 border-b border-slate-700 flex items-center gap-4">
          <button onClick={() => setCurrentPage('home')} className="p-2 bg-slate-700 rounded-lg">
            <ChevronLeft className="w-5 h-5 text-white" />
          </button>
          <h1 className="text-xl font-bold text-white">King of the City</h1>
        </div>
        <div className="p-6 flex flex-col items-center justify-center min-h-[60vh]">
          <div className="w-24 h-24 bg-amber-500/20 rounded-full flex items-center justify-center mb-6">
            <Lock className="w-12 h-12 text-amber-400" />
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">Not Yet Qualified</h2>
          <p className="text-slate-400 text-center mb-6">
            You need <span className="text-amber-400 font-bold">50 tiles</span> to compete.<br/>
            You currently have <span className="text-white font-bold">{actTiles.length}</span> tiles.
          </p>
          <div className="w-full max-w-xs bg-slate-800 rounded-xl p-4">
            <div className="flex justify-between text-sm mb-2">
              <span className="text-slate-400">Progress</span>
              <span className="text-amber-400">{actTiles.length}/50</span>
            </div>
            <div className="bg-slate-700 rounded-full h-3 overflow-hidden">
              <div className="bg-gradient-to-r from-amber-500 to-orange-500 h-3 rounded-full transition-all" style={{ width: `${Math.min((actTiles.length / 50) * 100, 100)}%` }} />
            </div>
          </div>
          <button onClick={() => setCurrentPage('ride')} className={`mt-6 bg-gradient-to-r ${activity?.gradient} text-white font-bold py-3 px-8 rounded-xl`}>
            Start {activity?.name} to Earn Tiles
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-900 pb-6">
      <div className="bg-gradient-to-r from-amber-500 to-orange-600 p-6">
        <div className="flex items-center gap-4 mb-4">
          <button onClick={() => setCurrentPage('home')} className="p-2 bg-white/20 rounded-lg">
            <ChevronLeft className="w-5 h-5 text-white" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <Crown className="w-6 h-6" /> King of {city || 'the City'}
            </h1>
            <p className="text-white/70 text-sm">Weekly competition • {activity?.name}</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 bg-black/20 p-1 rounded-lg">
          <button onClick={() => setTab('tracks')} className={`flex-1 py-2 rounded-md text-sm font-medium ${tab === 'tracks' ? 'bg-white/20 text-white' : 'text-white/60'}`}>
            🛤️ Tracks
          </button>
          <button onClick={() => setTab('leaderboard')} className={`flex-1 py-2 rounded-md text-sm font-medium ${tab === 'leaderboard' ? 'bg-white/20 text-white' : 'text-white/60'}`}>
            🏆 Rankings
          </button>
          <button onClick={() => setTab('myTimes')} className={`flex-1 py-2 rounded-md text-sm font-medium ${tab === 'myTimes' ? 'bg-white/20 text-white' : 'text-white/60'}`}>
            ⏱️ My Times
          </button>
        </div>
      </div>

      <div className="p-4">
        {tab === 'tracks' && (
          <div className="space-y-4">
            {/* How it works */}
            <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700">
              <h3 className="font-semibold text-white mb-2 flex items-center gap-2">
                <HelpCircle className="w-4 h-4 text-amber-400" /> How Point-to-Point Works
              </h3>
              <ol className="text-sm text-slate-400 space-y-1 list-decimal list-inside">
                <li>Select a track and tap "Race Now"</li>
                <li>Travel the required distance as fast as you can</li>
                <li>Your time is recorded when you hit the distance</li>
                <li>Compete for the best weekly time!</li>
              </ol>
            </div>

            {!city && (
              <div className="bg-amber-500/20 rounded-xl p-4 border border-amber-500/30">
                <p className="text-amber-300 text-sm">📍 Enable location to see tracks for your city</p>
              </div>
            )}
            
            {cityTracks.map(track => (
              <div key={track.id} className="bg-slate-800 rounded-2xl p-4 border border-slate-700">
                <div className="flex items-start gap-4">
                  <div className="w-14 h-14 rounded-xl flex items-center justify-center text-2xl" style={{ backgroundColor: DIFFICULTY[track.difficulty]?.color + '20' }}>
                    {track.icon}
                  </div>
                  <div className="flex-1">
                    <h3 className="font-bold text-white">{track.name}</h3>
                    <p className="text-sm text-slate-400 mt-1">{track.description}</p>
                    <div className="flex gap-2 mt-2">
                      <span className="bg-slate-700 px-2 py-1 rounded text-xs text-slate-300">📍 {track.distance_km}km</span>
                      <span className="px-2 py-1 rounded text-xs" style={{ backgroundColor: DIFFICULTY[track.difficulty]?.color + '30', color: DIFFICULTY[track.difficulty]?.color }}>{DIFFICULTY[track.difficulty]?.name}</span>
                    </div>
                  </div>
                </div>
                <div className="flex gap-2 mt-4">
                  <button 
                    onClick={() => { setSelectedTrack(track); setTab('leaderboard') }} 
                    className="flex-1 bg-slate-700 text-white font-semibold py-2 rounded-xl text-sm"
                  >
                    View Rankings
                  </button>
                  <button 
                    onClick={() => startTrackChallenge(track)} 
                    className="flex-1 bg-gradient-to-r from-amber-500 to-orange-500 text-white font-semibold py-2 rounded-xl text-sm flex items-center justify-center gap-1"
                  >
                    <Play className="w-4 h-4" /> Race Now
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === 'leaderboard' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-white">Weekly Rankings</h2>
              <span className="text-xs text-amber-400 bg-amber-400/20 px-2 py-1 rounded">Resets Monday</span>
            </div>
            
            {/* Track selector */}
            <div className="flex gap-2 overflow-x-auto pb-2">
              {cityTracks.map(track => (
                <button
                  key={track.id}
                  onClick={() => setSelectedTrack(track)}
                  className={`px-4 py-2 rounded-lg whitespace-nowrap text-sm flex items-center gap-1 ${selectedTrack?.id === track.id ? 'bg-amber-500 text-white' : 'bg-slate-800 text-slate-400'}`}
                >
                  {track.icon} {track.distance_km}km
                </button>
              ))}
            </div>

            {selectedTrack && (
              <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700">
                <p className="text-white font-medium">{selectedTrack.name}</p>
                <p className="text-xs text-slate-400">{selectedTrack.distance_km}km • {DIFFICULTY[selectedTrack.difficulty]?.name}</p>
              </div>
            )}

            {loading ? (
              <div className="text-center py-12"><Loader2 className="w-8 h-8 animate-spin mx-auto text-slate-500" /></div>
            ) : leaderboard.length > 0 ? (
              <div className="space-y-2">
                {leaderboard.map((entry, i) => (
                  <div key={entry.id || i} className={`bg-slate-800 rounded-xl p-4 flex items-center gap-4 border ${entry.user_id === user?.id ? 'border-amber-500 bg-amber-500/10' : 'border-slate-700'}`}>
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold ${i === 0 ? 'bg-amber-500' : i === 1 ? 'bg-slate-400' : i === 2 ? 'bg-orange-700' : 'bg-slate-700 text-slate-400'} text-white`}>
                      {i === 0 ? '👑' : i + 1}
                    </div>
                    <AvatarDisplay avatar={{ background: entry.avatar_background, icon: entry.avatar_icon }} size="sm" />
                    <div className="flex-1">
                      <div className="font-semibold text-white">
                        {entry.first_name} {entry.last_name}
                        {entry.user_id === user?.id && <span className="ml-2 text-xs text-amber-400">(You)</span>}
                      </div>
                      <div className="text-xs text-slate-500">
                        {new Date(entry.recorded_at).toLocaleDateString()}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold text-amber-400 text-lg">{formatTime(entry.time_seconds)}</div>
                    </div>
                    {i < 3 && <div className="text-xl">{['🥇', '🥈', '🥉'][i]}</div>}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12">
                <Trophy className="w-16 h-16 mx-auto mb-4 text-slate-600" />
                <p className="text-slate-500">No times recorded yet this week</p>
                <p className="text-sm text-slate-600 mb-4">Be the first to set a time!</p>
                <button 
                  onClick={() => selectedTrack && startTrackChallenge(selectedTrack)} 
                  className="bg-amber-500 text-white font-semibold py-2 px-6 rounded-xl"
                >
                  Race Now
                </button>
              </div>
            )}
          </div>
        )}

        {tab === 'myTimes' && (
          <div className="space-y-4">
            <h2 className="font-semibold text-white">Your Best Times</h2>
            
            {myTimes.length > 0 ? (
              <div className="space-y-2">
                {myTimes.map((time, i) => (
                  <div key={time.id} className="bg-slate-800 rounded-xl p-4 border border-slate-700">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-lg flex items-center justify-center text-xl" style={{ backgroundColor: DIFFICULTY[time.city_tracks?.difficulty]?.color + '20' }}>
                        {time.city_tracks?.icon || '🏁'}
                      </div>
                      <div className="flex-1">
                        <div className="font-medium text-white">{time.city_tracks?.name || 'Track'}</div>
                        <div className="text-xs text-slate-400">
                          {time.city_tracks?.distance_km}km • {new Date(time.recorded_at).toLocaleDateString()}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-bold text-amber-400 text-lg">{formatTime(time.time_seconds)}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12">
                <Clock className="w-16 h-16 mx-auto mb-4 text-slate-600" />
                <p className="text-slate-500">No times recorded yet</p>
                <p className="text-sm text-slate-600 mb-4">Complete a track challenge to see your times here</p>
                <button onClick={() => setTab('tracks')} className="bg-amber-500 text-white font-semibold py-2 px-6 rounded-xl">
                  View Tracks
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ============== CLAN PAGES ==============
function ClanPage() {
  const { clan, user, setCurrentPage, addToast, setClan, setProfile } = useApp()
  const [copied, setCopied] = useState(false)
  const isLeader = clan?.leader_user_id === user?.id

  const copyCode = () => { navigator.clipboard.writeText(clan.invite_code); setCopied(true); setTimeout(() => setCopied(false), 2000) }
  const leave = async () => {
    if (isLeader) { addToast('Leaders cannot leave', 'warning'); return }
    await supabase.from('clan_members').delete().eq('clan_id', clan.id).eq('user_id', user.id)
    await supabase.from('profiles').update({ clan_id: null }).eq('id', user.id)
    setClan(null); setProfile(p => ({ ...p, clan_id: null })); setCurrentPage('home')
  }

  if (!clan) return null
  return (
    <div className="min-h-screen bg-slate-900 pb-24">
      <div className="p-6 bg-gradient-to-r from-blue-600 to-indigo-600">
        <div className="flex items-center gap-4 mb-4">
          <div className="w-16 h-16 rounded-xl flex items-center justify-center text-4xl bg-white/20">{clan.icon || '⚔️'}</div>
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-white">{clan.name}</h1>
            <p className="text-white/70">{clan.clan_members?.length || 0} members</p>
          </div>
          {isLeader && <Crown className="w-6 h-6 text-amber-400" />}
        </div>
        <div className="bg-white/10 rounded-xl p-3 flex items-center justify-between">
          <div><p className="text-xs text-white/60">Invite Code</p><p className="text-lg font-mono font-bold text-white">{clan.invite_code}</p></div>
          <button onClick={copyCode} className="p-2 bg-white/20 rounded-lg">{copied ? <Check className="w-5 h-5 text-emerald-400" /> : <Copy className="w-5 h-5 text-white" />}</button>
        </div>
      </div>
      <div className="p-4 space-y-4">
        <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
          <h2 className="font-semibold text-white mb-3 flex items-center gap-2"><Users className="w-5 h-5 text-cyan-400" />Members</h2>
          {clan.clan_members?.map(m => (
            <div key={m.user_id} className="flex items-center gap-3 py-2 border-b border-slate-700 last:border-0">
              <AvatarDisplay avatar={{ background: m.profiles?.avatar_background, icon: m.profiles?.avatar_icon }} size="sm" />
              <div className="flex-1">
                <div className="font-medium text-white flex items-center gap-2">{m.profiles?.first_name} {m.profiles?.last_name}{m.role === 'leader' && <Crown className="w-4 h-4 text-amber-400" />}</div>
                <div className="text-xs text-slate-500">{m.role}</div>
              </div>
            </div>
          ))}
        </div>
        {!isLeader && <button onClick={leave} className="w-full bg-red-600/20 text-red-400 font-semibold py-4 rounded-xl border border-red-600/30">Leave Clan</button>}
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
    supabase.from('clans').select('*, clan_members(count)').eq('is_public', true).limit(20).then(({ data }) => { setClans(data || []); setLoading(false) })
  }, [])

  const join = async (clanId) => {
    setJoining(true)
    await supabase.from('clan_members').insert({ clan_id: clanId, user_id: user.id, role: 'member' })
    await supabase.from('profiles').update({ clan_id: clanId }).eq('id', user.id)
    setProfile(p => ({ ...p, clan_id: clanId }))
    await loadClan(clanId)
    addToast('Joined! 🎉', 'success')
    setCurrentPage('clan')
    setJoining(false)
  }

  const joinByCode = async () => {
    if (!code.trim()) return
    setJoining(true)
    const { data } = await supabase.from('clans').select('*').eq('invite_code', code.toUpperCase().trim()).single()
    if (data) await join(data.id)
    else { addToast('Invalid code', 'error'); setJoining(false) }
  }

  return (
    <div className="min-h-screen bg-slate-900">
      <div className="bg-slate-800 p-4 border-b border-slate-700 flex items-center gap-4">
        <button onClick={() => setCurrentPage('home')} className="p-2 bg-slate-700 rounded-lg"><ChevronLeft className="w-5 h-5 text-white" /></button>
        <h1 className="text-xl font-bold text-white">Join a Clan</h1>
      </div>
      <div className="p-4">
        <div className="flex gap-2 mb-4">
          <button onClick={() => setTab('browse')} className={`flex-1 py-2 rounded-lg ${tab === 'browse' ? 'bg-cyan-600 text-white' : 'bg-slate-800 text-slate-400'}`}>Browse</button>
          <button onClick={() => setTab('code')} className={`flex-1 py-2 rounded-lg ${tab === 'code' ? 'bg-cyan-600 text-white' : 'bg-slate-800 text-slate-400'}`}>Invite Code</button>
        </div>
        {tab === 'browse' && (
          <div className="space-y-3">
            {loading ? <Loader2 className="w-8 h-8 animate-spin mx-auto text-slate-500" /> :
            clans.map(c => (
              <div key={c.id} className="bg-slate-800 rounded-xl p-4 border border-slate-700">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl" style={{ backgroundColor: `${c.color}30` }}>{c.icon || '⚔️'}</div>
                  <div className="flex-1"><h3 className="font-semibold text-white">{c.name}</h3><p className="text-sm text-slate-400">{c.clan_members?.[0]?.count || 0} members</p></div>
                </div>
                <button onClick={() => join(c.id)} disabled={joining} className="w-full bg-cyan-600 text-white font-semibold py-2 rounded-lg">{joining ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : 'Join'}</button>
              </div>
            ))}
          </div>
        )}
        {tab === 'code' && (
          <div className="space-y-4">
            <input type="text" value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="ABCD1234" className="w-full px-4 py-3 rounded-xl bg-slate-800 text-white text-center text-2xl font-mono border border-slate-600" maxLength={8} />
            <button onClick={joinByCode} disabled={joining} className="w-full bg-cyan-600 text-white font-bold py-4 rounded-xl">{joining ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : 'Join'}</button>
          </div>
        )}
        <button onClick={() => setCurrentPage('createClan')} className="w-full mt-6 bg-slate-800 text-white font-semibold py-4 rounded-xl border border-slate-600 flex items-center justify-center gap-2"><Plus className="w-5 h-5" />Create Clan</button>
      </div>
    </div>
  )
}

function CreateClanPage() {
  const { user, setCurrentPage, addToast, setClan, setProfile, loadClan, activity } = useApp()
  const [name, setName] = useState('')
  const [icon, setIcon] = useState('⚔️')
  const [color, setColor] = useState('#06b6d4')
  const [creating, setCreating] = useState(false)
  const icons = ['⚔️', '🛡️', '🏰', '🦁', '🐺', '🦅', '🔥', '⚡', '💎', '🌟', '👑', '🎯']
  const colors = ['#06b6d4', '#a855f7', '#f59e0b', '#10b981', '#ef4444', '#3b82f6', '#ec4899', '#8b5cf6']

  const create = async () => {
    if (!name.trim()) { addToast('Enter name', 'error'); return }
    setCreating(true)
    const { data, error } = await supabase.from('clans').insert({ name: name.trim(), icon, color, leader_user_id: user.id }).select().single()
    if (error) { addToast('Name taken', 'error'); setCreating(false); return }
    await supabase.from('clan_members').insert({ clan_id: data.id, user_id: user.id, role: 'leader' })
    await supabase.from('profiles').update({ clan_id: data.id }).eq('id', user.id)
    setProfile(p => ({ ...p, clan_id: data.id }))
    await loadClan(data.id)
    addToast('Created! 🎉', 'success')
    setCurrentPage('clan')
  }

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col">
      <div className="bg-slate-800 p-4 border-b border-slate-700 flex items-center gap-4">
        <button onClick={() => setCurrentPage('joinClan')} className="p-2 bg-slate-700 rounded-lg"><ChevronLeft className="w-5 h-5 text-white" /></button>
        <h1 className="text-xl font-bold text-white">Create Clan</h1>
      </div>
      <div className="flex-1 p-4 space-y-6">
        <div className="flex justify-center"><div className="w-24 h-24 rounded-2xl flex items-center justify-center text-5xl" style={{ backgroundColor: `${color}30` }}>{icon}</div></div>
        <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Clan name" className="w-full px-4 py-3 rounded-xl bg-slate-800 text-white border border-slate-600" maxLength={30} />
        <div><label className="block text-sm text-slate-400 mb-2">Icon</label><div className="flex flex-wrap gap-2">{icons.map(i => <button key={i} onClick={() => setIcon(i)} className={`w-12 h-12 rounded-xl bg-slate-800 text-2xl ${icon === i ? 'ring-2 ring-cyan-400' : ''}`}>{i}</button>)}</div></div>
        <div><label className="block text-sm text-slate-400 mb-2">Color</label><div className="flex flex-wrap gap-2">{colors.map(c => <button key={c} onClick={() => setColor(c)} className={`w-10 h-10 rounded-full ${color === c ? 'ring-2 ring-white' : ''}`} style={{ backgroundColor: c }} />)}</div></div>
      </div>
      <div className="p-4"><button onClick={create} disabled={creating || !name.trim()} className={`w-full bg-gradient-to-r ${activity?.gradient} text-white font-bold py-4 rounded-xl disabled:opacity-50`}>{creating ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : 'Create Clan'}</button></div>
    </div>
  )
}

// ============== BOTTOM NAV ==============
function BottomNav() {
  const { currentPage, setCurrentPage, activity } = useApp()
  const items = [
    { id: 'home', icon: MapPin, label: 'Home' },
    { id: 'territory', icon: Trophy, label: 'Map' },
    { id: 'leaderboard', icon: TrendingUp, label: 'Ranks' },
    { id: 'profile', icon: User, label: 'Profile' },
  ]
  return (
    <div className="fixed bottom-0 left-0 right-0 bg-slate-800 border-t border-slate-700 px-2 py-2 flex justify-around items-center z-50">
      {items.map(({ id, icon: Icon, label }) => (
        <button key={id} onClick={() => setCurrentPage(id)} className="flex flex-col items-center justify-center p-2 rounded-xl" style={currentPage === id ? { color: activity?.color } : { color: '#64748b' }}>
          <Icon className="w-6 h-6" />
          <span className="text-xs mt-1 font-medium">{label}</span>
        </button>
      ))}
    </div>
  )
}
