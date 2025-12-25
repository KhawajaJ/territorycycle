import React, { useState, useEffect, useRef, useCallback, createContext, useContext } from 'react'
import { MapPin, Play, Pause, Square, Trophy, Shield, Bell, User, Target, Clock, TrendingUp, Award, LogOut, Mail, AlertCircle, Loader2, CheckCircle, X, Navigation, Camera, Save } from 'lucide-react'
import { supabase, signInWithGoogle, signInWithEmail, signUpWithEmail, signOut, saveRide, getUserRides, upsertRouteUnlock, getUserTiles, claimTiles, getLeaderboard, getActiveThreats } from './supabase'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { latLngToCell, cellToBoundary } from 'h3-js'

// Set Mapbox token
mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN

// Config
const CONFIG = {
  H3_RESOLUTION: 10,
  MIN_RIDE_POINTS: 10,
  MIN_ACCURACY_METERS: 50,
  MAX_SPEED_MS: 18,
  UNLOCK_THRESHOLD: 3,
  UNLOCK_WINDOW_DAYS: 7,
}

// Utilities
const haversine = (lat1, lon1, lat2, lon2) => {
  const R = 6371000
  const φ1 = (lat1 * Math.PI) / 180
  const φ2 = (lat2 * Math.PI) / 180
  const Δφ = ((lat2 - lat1) * Math.PI) / 180
  const Δλ = ((lon2 - lon1) * Math.PI) / 180
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

const sha256 = async (message) => {
  const msgUint8 = new TextEncoder().encode(message)
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
}

const formatDuration = (seconds) => {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  return `${m}:${s.toString().padStart(2, '0')}`
}

// Context
const AppContext = createContext(null)
const useApp = () => useContext(AppContext)

// Toast Component
function Toast({ message, type, onClose }) {
  useEffect(() => {
    const timer = setTimeout(onClose, 4000)
    return () => clearTimeout(timer)
  }, [onClose])

  const colors = {
    success: 'bg-emerald-600',
    error: 'bg-red-600',
    warning: 'bg-amber-600',
    info: 'bg-cyan-600',
  }

  return (
    <div className={`${colors[type]} text-white px-4 py-3 rounded-xl shadow-lg flex items-center gap-3 animate-slide-up`}>
      {type === 'success' && <CheckCircle className="w-5 h-5" />}
      {type === 'error' && <AlertCircle className="w-5 h-5" />}
      {type === 'warning' && <AlertCircle className="w-5 h-5" />}
      {type === 'info' && <Bell className="w-5 h-5" />}
      <span className="flex-1 text-sm font-medium">{message}</span>
      <button onClick={onClose} className="hover:opacity-70"><X className="w-4 h-4" /></button>
    </div>
  )
}

function ToastContainer({ toasts, removeToast }) {
  return (
    <div className="fixed bottom-24 left-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map((toast) => (
        <Toast key={toast.id} {...toast} onClose={() => removeToast(toast.id)} />
      ))}
    </div>
  )
}

// Main App
export default function App() {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [currentPage, setCurrentPage] = useState('onboarding')
  const [toasts, setToasts] = useState([])
  const [rides, setRides] = useState([])
  const [tiles, setTiles] = useState([])
  const [routeUnlocks, setRouteUnlocks] = useState({})
  const [lastRide, setLastRide] = useState(null)
  const [threats, setThreats] = useState([])

  const addToast = useCallback((message, type = 'info') => {
    const id = Date.now()
    setToasts((prev) => [...prev, { id, message, type }])
  }, [])

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  // Auth state listener
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      if (session?.user) {
        loadUserProfile(session.user.id)
        loadUserData(session.user.id)
      } else {
        setLoading(false)
      }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      if (session?.user) {
        loadUserProfile(session.user.id)
        loadUserData(session.user.id)
      } else {
        setCurrentPage('onboarding')
        setProfile(null)
        setLoading(false)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  const loadUserProfile = async (userId) => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single()
      
      if (data) {
        setProfile(data)
        // Check if profile is complete
        if (!data.first_name || !data.last_name) {
          setCurrentPage('profileSetup')
        } else {
          setCurrentPage('home')
        }
      } else {
        // Profile doesn't exist yet, go to setup
        setCurrentPage('profileSetup')
      }
    } catch (err) {
      console.error('Error loading profile:', err)
      setCurrentPage('profileSetup')
    } finally {
      setLoading(false)
    }
  }

  const loadUserData = async (userId) => {
    try {
      const [ridesRes, tilesRes, threatsRes] = await Promise.all([
        getUserRides(userId),
        getUserTiles(userId),
        getActiveThreats(userId)
      ])
      if (ridesRes.data) setRides(ridesRes.data)
      if (tilesRes.data) setTiles(tilesRes.data)
      if (threatsRes.data) setThreats(threatsRes.data)
    } catch (err) {
      console.error('Error loading user data:', err)
    }
  }

  const handleSignOut = async () => {
    await signOut()
    setUser(null)
    setProfile(null)
    setRides([])
    setTiles([])
    setCurrentPage('onboarding')
    addToast('Signed out successfully', 'info')
  }

  const contextValue = {
    user,
    profile,
    setProfile,
    rides,
    setRides,
    tiles,
    setTiles,
    routeUnlocks,
    setRouteUnlocks,
    threats,
    setThreats,
    currentPage,
    setCurrentPage,
    addToast,
    lastRide,
    setLastRide,
    handleSignOut,
    loadUserData,
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-center space-y-4">
          <Loader2 className="w-12 h-12 text-cyan-400 animate-spin mx-auto" />
          <p className="text-slate-400">Loading TerritoryCycle...</p>
        </div>
      </div>
    )
  }

  return (
    <AppContext.Provider value={contextValue}>
      <div className="min-h-screen bg-slate-900">
        {currentPage === 'onboarding' && <OnboardingScreen />}
        {currentPage === 'auth' && <AuthScreen />}
        {currentPage === 'profileSetup' && user && <ProfileSetupScreen />}
        {user && profile && !['onboarding', 'auth', 'profileSetup'].includes(currentPage) && <MainApp />}
        <ToastContainer toasts={toasts} removeToast={removeToast} />
      </div>
    </AppContext.Provider>
  )
}

// Profile Setup Screen
function ProfileSetupScreen() {
  const { user, setProfile, setCurrentPage, addToast } = useApp()
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [photoUrl, setPhotoUrl] = useState(null)
  const [photoFile, setPhotoFile] = useState(null)
  const [loading, setSaving] = useState(false)
  const fileInputRef = useRef(null)

  // Load existing profile data if any
  useEffect(() => {
    const loadExisting = async () => {
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single()
      
      if (data) {
        setFirstName(data.first_name || '')
        setLastName(data.last_name || '')
        setPhotoUrl(data.avatar_url || null)
      }
    }
    loadExisting()
  }, [user.id])

  const handlePhotoSelect = (e) => {
    const file = e.target.files[0]
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        addToast('Photo must be less than 5MB', 'error')
        return
      }
      setPhotoFile(file)
      const reader = new FileReader()
      reader.onloadend = () => {
        setPhotoUrl(reader.result)
      }
      reader.readAsDataURL(file)
    }
  }

  const handleSave = async () => {
    if (!firstName.trim() || !lastName.trim()) {
      addToast('Please enter your first and last name', 'error')
      return
    }

    setSaving(true)

    try {
      let avatarUrl = photoUrl

      // Upload photo if selected
      if (photoFile) {
        const fileExt = photoFile.name.split('.').pop()
        const fileName = `${user.id}-${Date.now()}.${fileExt}`
        const filePath = `avatars/${fileName}`

        const { error: uploadError } = await supabase.storage
          .from('avatars')
          .upload(filePath, photoFile)

        if (uploadError) {
          console.error('Upload error:', uploadError)
          // Continue without photo if upload fails
        } else {
          const { data: { publicUrl } } = supabase.storage
            .from('avatars')
            .getPublicUrl(filePath)
          avatarUrl = publicUrl
        }
      }

      // Update profile
      const { data, error } = await supabase
        .from('profiles')
        .upsert({
          id: user.id,
          email: user.email,
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          name: `${firstName.trim()} ${lastName.trim()}`,
          avatar_url: avatarUrl,
          updated_at: new Date().toISOString()
        })
        .select()
        .single()

      if (error) throw error

      setProfile(data)
      addToast('Profile saved!', 'success')
      setCurrentPage('home')
    } catch (err) {
      console.error('Error saving profile:', err)
      addToast('Failed to save profile', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-cyan-900 text-white flex flex-col safe-area-inset-top safe-area-inset-bottom">
      <div className="flex-1 flex flex-col justify-center px-6 py-8">
        <div className="space-y-8 animate-fade-in">
          <div className="text-center space-y-2">
            <h1 className="text-3xl font-bold">Complete Your Profile</h1>
            <p className="text-slate-400">Let other riders know who you are</p>
          </div>

          {/* Photo Upload */}
          <div className="flex justify-center">
            <div 
              onClick={() => fileInputRef.current?.click()}
              className="relative cursor-pointer group"
            >
              <div className="w-32 h-32 rounded-full bg-slate-700 border-4 border-slate-600 overflow-hidden flex items-center justify-center group-hover:border-cyan-500 transition-colors">
                {photoUrl ? (
                  <img src={photoUrl} alt="Profile" className="w-full h-full object-cover" />
                ) : (
                  <User className="w-16 h-16 text-slate-500" />
                )}
              </div>
              <div className="absolute bottom-0 right-0 w-10 h-10 bg-cyan-500 rounded-full flex items-center justify-center border-4 border-slate-800 group-hover:bg-cyan-400 transition-colors">
                <Camera className="w-5 h-5 text-white" />
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handlePhotoSelect}
                className="hidden"
              />
            </div>
          </div>
          <p className="text-center text-sm text-slate-500">Tap to add a photo (optional)</p>

          {/* Form Fields */}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-2">First Name *</label>
              <input
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="Enter your first name"
                className="w-full px-4 py-3 rounded-xl bg-slate-800 text-white placeholder-slate-500 border border-slate-600 focus:border-cyan-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-400 mb-2">Last Name *</label>
              <input
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Enter your last name"
                className="w-full px-4 py-3 rounded-xl bg-slate-800 text-white placeholder-slate-500 border border-slate-600 focus:border-cyan-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-400 mb-2">Email</label>
              <input
                type="email"
                value={user?.email || ''}
                disabled
                className="w-full px-4 py-3 rounded-xl bg-slate-800/50 text-slate-400 border border-slate-700 cursor-not-allowed"
              />
              <p className="text-xs text-slate-500 mt-1">Email cannot be changed</p>
            </div>
          </div>

          {/* Save Button */}
          <button
            onClick={handleSave}
            disabled={loading}
            className="w-full bg-cyan-500 hover:bg-cyan-400 text-slate-900 font-bold py-4 rounded-xl transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <>
                <Save className="w-5 h-5" />
                Save Profile
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

// Onboarding
function OnboardingScreen() {
  const { setCurrentPage } = useApp()
  const [step, setStep] = useState(1)

  const steps = [
    { icon: <MapPin className="w-12 h-12 text-cyan-400" />, title: 'Ride. Repeat. Rule your streets.', desc: 'TerritoryCycle turns your rides into territory you can own. Claim tiles by riding consistently.' },
    { icon: <Target className="w-12 h-12 text-purple-400" />, title: 'Unlock routes in 7 days', desc: 'Ride the same route 3× in the last 7 days to unlock claiming. Your consistency is your power.' },
    { icon: <Shield className="w-12 h-12 text-emerald-400" />, title: 'Defend with speed', desc: "We'll alert you when challengers are close. Beat your average time for stronger defense." },
    { icon: <Navigation className="w-12 h-12 text-amber-400" />, title: 'Enable Location', desc: 'We use GPS to track routes and update your territory. Your data stays private.' },
  ]

  const requestLocation = async () => {
    try {
      await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10000 })
      })
    } catch {}
    setCurrentPage('auth')
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-cyan-900 text-white flex flex-col safe-area-inset-top safe-area-inset-bottom">
      <div className="flex-1 flex flex-col justify-center px-6 animate-fade-in" key={step}>
        <div className="space-y-8 text-center">
          <div className="w-24 h-24 bg-slate-800/50 backdrop-blur rounded-2xl flex items-center justify-center mx-auto border border-slate-700">
            {steps[step - 1].icon}
          </div>
          <h1 className="text-3xl font-bold tracking-tight">{steps[step - 1].title}</h1>
          <p className="text-lg text-slate-300 leading-relaxed max-w-sm mx-auto">{steps[step - 1].desc}</p>
        </div>
      </div>

      <div className="p-6 space-y-4">
        {step < 4 ? (
          <>
            <button onClick={() => setStep(step + 1)} className="w-full bg-cyan-500 hover:bg-cyan-400 text-slate-900 font-bold py-4 rounded-xl transition-colors">
              Next
            </button>
            <button onClick={() => setStep(4)} className="w-full text-slate-400 hover:text-white font-medium py-2">
              Skip
            </button>
          </>
        ) : (
          <>
            <button onClick={requestLocation} className="w-full bg-cyan-500 hover:bg-cyan-400 text-slate-900 font-bold py-4 rounded-xl transition-colors">
              Allow Location
            </button>
            <button onClick={() => setCurrentPage('auth')} className="w-full text-slate-400 hover:text-white font-medium py-2">
              Not now
            </button>
          </>
        )}
        <div className="flex justify-center gap-2 pt-2">
          {[1, 2, 3, 4].map((s) => (
            <div key={s} className={`h-2 w-8 rounded-full transition-colors ${s === step ? 'bg-cyan-400' : 'bg-slate-700'}`} />
          ))}
        </div>
      </div>
    </div>
  )
}

// Auth Screen
function AuthScreen() {
  const { addToast } = useApp()
  const [mode, setMode] = useState(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [isSignUp, setIsSignUp] = useState(false)

  const handleGoogleSignIn = async () => {
    setLoading(true)
    const { error } = await signInWithGoogle()
    if (error) {
      addToast(error.message, 'error')
    }
    setLoading(false)
  }

  const handleEmailAuth = async () => {
    setError('')
    if (!email || !password) {
      setError('Please fill in all fields')
      return
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters')
      return
    }

    setLoading(true)
    const { error } = isSignUp
      ? await signUpWithEmail(email, password)
      : await signInWithEmail(email, password)

    if (error) {
      setError(error.message)
    } else if (isSignUp) {
      addToast('Check your email to confirm your account!', 'success')
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-cyan-900 text-white flex flex-col justify-center px-6 safe-area-inset-top safe-area-inset-bottom">
      <div className="space-y-8 animate-fade-in">
        <div className="text-center space-y-4">
          <div className="w-20 h-20 bg-gradient-to-br from-cyan-500 to-purple-600 rounded-2xl flex items-center justify-center mx-auto animate-pulse-glow">
            <MapPin className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-3xl font-bold">TerritoryCycle</h1>
          <p className="text-slate-400">Sign in to save rides and claim territory.</p>
        </div>

        {!mode && (
          <div className="space-y-3">
            <button onClick={handleGoogleSignIn} disabled={loading} className="w-full bg-white hover:bg-slate-100 text-slate-900 font-semibold py-4 rounded-xl transition-colors flex items-center justify-center gap-2 disabled:opacity-50">
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : (
                <>
                  <svg className="w-5 h-5" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
                  Continue with Google
                </>
              )}
            </button>
            <button onClick={() => setMode('email')} className="w-full bg-slate-800 hover:bg-slate-700 text-white font-semibold py-4 rounded-xl border border-slate-600 flex items-center justify-center gap-2">
              <Mail className="w-5 h-5" /> Continue with Email
            </button>
          </div>
        )}

        {mode === 'email' && (
          <div className="space-y-4 bg-slate-800/50 backdrop-blur rounded-2xl p-6 border border-slate-700">
            <div className="flex gap-2 mb-4">
              <button onClick={() => setIsSignUp(false)} className={`flex-1 py-2 rounded-lg font-medium transition-colors ${!isSignUp ? 'bg-cyan-600 text-white' : 'text-slate-400'}`}>Sign In</button>
              <button onClick={() => setIsSignUp(true)} className={`flex-1 py-2 rounded-lg font-medium transition-colors ${isSignUp ? 'bg-cyan-600 text-white' : 'text-slate-400'}`}>Sign Up</button>
            </div>

            {error && (
              <div className="bg-red-500/20 border border-red-500/50 text-red-300 px-4 py-2 rounded-lg text-sm flex items-center gap-2">
                <AlertCircle className="w-4 h-4" />{error}
              </div>
            )}

            <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full px-4 py-3 rounded-xl bg-slate-900 text-white placeholder-slate-500 border border-slate-600 focus:border-cyan-500 focus:outline-none" />
            <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full px-4 py-3 rounded-xl bg-slate-900 text-white placeholder-slate-500 border border-slate-600 focus:border-cyan-500 focus:outline-none" />
            <button onClick={handleEmailAuth} disabled={loading} className="w-full bg-cyan-500 hover:bg-cyan-400 text-slate-900 font-bold py-3 rounded-xl disabled:opacity-50 flex items-center justify-center">
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : (isSignUp ? 'Create Account' : 'Sign In')}
            </button>
            <button onClick={() => setMode(null)} className="w-full text-slate-400 hover:text-white font-medium py-2">Back</button>
          </div>
        )}
      </div>
    </div>
  )
}

// Main App Container
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
        {currentPage === 'editProfile' && <EditProfilePage />}
      </div>
      {!['ride', 'rideSummary', 'editProfile'].includes(currentPage) && <BottomNav />}
    </div>
  )
}

// Home Page
function HomePage() {
  const { user, profile, rides, tiles, threats, setCurrentPage } = useApp()

  const weeklyStats = React.useMemo(() => {
    const now = Date.now()
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000
    const weeklyRides = rides.filter((r) => new Date(r.started_at || r.created_at).getTime() >= weekAgo)
    const distance = weeklyRides.reduce((sum, r) => sum + (r.distance_m || 0), 0) / 1000
    const time = weeklyRides.reduce((sum, r) => sum + (r.duration_sec || 0), 0)
    const score = Math.floor(Math.sqrt(distance * 1000) * 0.6 + Math.sqrt(time) * 0.4)
    return { distance, time, score, count: weeklyRides.length }
  }, [rides])

  return (
    <div className="p-4 space-y-4 pb-24 safe-area-inset-top">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-white">TerritoryCycle</h1>
          <p className="text-sm text-slate-400">Welcome, {profile?.first_name || 'Rider'}!</p>
        </div>
        <div className="relative">
          <Bell className="w-6 h-6 text-slate-400" />
          {threats.length > 0 && <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full text-xs text-white flex items-center justify-center">{threats.length}</span>}
        </div>
      </div>

      <button onClick={() => setCurrentPage('ride')} className="w-full bg-gradient-to-r from-cyan-500 to-purple-600 hover:from-cyan-400 hover:to-purple-500 text-white font-bold py-6 rounded-2xl shadow-lg shadow-cyan-500/20 transition-all flex items-center justify-center gap-3 animate-pulse-glow">
        <Play className="w-8 h-8" fill="currentColor" />
        <span className="text-xl">Start Ride</span>
      </button>

      <div className="bg-slate-800/50 backdrop-blur rounded-2xl p-4 border border-slate-700">
        <h2 className="text-sm font-semibold text-slate-400 mb-3">This Week</h2>
        <div className="grid grid-cols-4 gap-4">
          <div className="text-center"><div className="text-2xl font-bold text-white">{weeklyStats.count}</div><div className="text-xs text-slate-500">rides</div></div>
          <div className="text-center"><div className="text-2xl font-bold text-white">{weeklyStats.distance.toFixed(1)}</div><div className="text-xs text-slate-500">km</div></div>
          <div className="text-center"><div className="text-2xl font-bold text-white">{Math.floor(weeklyStats.time / 60)}</div><div className="text-xs text-slate-500">min</div></div>
          <div className="text-center"><div className="text-2xl font-bold text-white">{weeklyStats.score}</div><div className="text-xs text-slate-500">score</div></div>
        </div>
      </div>

      <div className="bg-gradient-to-br from-amber-500/20 to-orange-600/20 rounded-2xl p-4 border border-amber-500/30">
        <div className="flex justify-between items-center mb-2">
          <h2 className="text-sm font-semibold text-amber-300">Territory</h2>
          <Trophy className="w-5 h-5 text-amber-400" />
        </div>
        <div className="text-4xl font-bold text-white">{tiles.length}</div>
        <div className="text-sm text-amber-200/70">tiles owned</div>
      </div>

      {threats.map((threat) => (
        <div key={threat.id} className="bg-gradient-to-br from-red-500/20 to-orange-600/20 rounded-2xl p-4 border-2 border-red-500/50">
          <div className="flex items-start justify-between mb-2">
            <div className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-red-400" />
              <h2 className="text-sm font-bold text-red-300">Territory at Risk!</h2>
            </div>
            <Clock className="w-4 h-4 text-red-300" />
          </div>
          <div className="text-sm text-slate-300 mb-3">{threat.tiles_at_risk_count} tiles under threat</div>
          <button onClick={() => setCurrentPage('ride')} className="w-full bg-red-600 hover:bg-red-500 text-white font-bold py-2.5 rounded-xl">
            Defend Now
          </button>
        </div>
      ))}
    </div>
  )
}

// Ride Recording Page
function RideRecordingPage() {
  const { user, setRides, setCurrentPage, addToast, setLastRide } = useApp()
  const [rideState, setRideState] = useState('idle')
  const [points, setPoints] = useState([])
  const [stats, setStats] = useState({ distance: 0, duration: 0 })
  const [gpsStatus, setGpsStatus] = useState('waiting')

  const mapContainerRef = useRef(null)
  const mapRef = useRef(null)
  const startTimeRef = useRef(null)
  const pausedDurationRef = useRef(0)
  const watchIdRef = useRef(null)
  const timerRef = useRef(null)
  const pointsRef = useRef([])

  useEffect(() => {
    pointsRef.current = points
  }, [points])

  // Initialize map
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        mapRef.current = new mapboxgl.Map({
          container: mapContainerRef.current,
          style: 'mapbox://styles/mapbox/dark-v11',
          center: [pos.coords.longitude, pos.coords.latitude],
          zoom: 15,
          attributionControl: false,
        })

        new mapboxgl.Marker({ color: '#06b6d4' })
          .setLngLat([pos.coords.longitude, pos.coords.latitude])
          .addTo(mapRef.current)
      },
      () => {
        mapRef.current = new mapboxgl.Map({
          container: mapContainerRef.current,
          style: 'mapbox://styles/mapbox/dark-v11',
          center: [0, 0],
          zoom: 2,
          attributionControl: false,
        })
      }
    )

    return () => {
      if (mapRef.current) mapRef.current.remove()
    }
  }, [])

  const startRecording = useCallback(() => {
    setRideState('recording')
    startTimeRef.current = Date.now()
    pausedDurationRef.current = 0
    setPoints([])
    pointsRef.current = []
    setStats({ distance: 0, duration: 0 })

    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        const newPoint = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          timestamp: Date.now(),
          accuracy: position.coords.accuracy,
        }

        setGpsStatus(newPoint.accuracy <= 20 ? 'good' : newPoint.accuracy <= 50 ? 'okay' : 'poor')

        if (newPoint.accuracy > CONFIG.MIN_ACCURACY_METERS) return

        setPoints((prev) => {
          if (prev.length >= 1) {
            const last = prev[prev.length - 1]
            const dist = haversine(last.lat, last.lng, newPoint.lat, newPoint.lng)
            const timeDiff = (newPoint.timestamp - last.timestamp) / 1000
            const speed = timeDiff > 0 ? dist / timeDiff : 0

            if (speed > CONFIG.MAX_SPEED_MS) return prev

            setStats((s) => ({ ...s, distance: s.distance + dist }))
          }

          // Update map
          if (mapRef.current) {
            mapRef.current.flyTo({ center: [newPoint.lng, newPoint.lat], zoom: 16 })
          }

          return [...prev, newPoint]
        })
      },
      (err) => {
        setGpsStatus('poor')
        addToast('GPS signal lost', 'warning')
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
    )

    timerRef.current = setInterval(() => {
      const elapsed = (Date.now() - startTimeRef.current - pausedDurationRef.current) / 1000
      setStats((s) => ({ ...s, duration: elapsed }))
    }, 1000)
  }, [addToast])

  const pauseRecording = useCallback(() => {
    setRideState('paused')
    if (watchIdRef.current) navigator.geolocation.clearWatch(watchIdRef.current)
    if (timerRef.current) clearInterval(timerRef.current)
  }, [])

  const resumeRecording = useCallback(() => {
    const pauseEnd = Date.now()
    pausedDurationRef.current += pauseEnd - (startTimeRef.current + stats.duration * 1000 + pausedDurationRef.current)
    setRideState('recording')
    // Restart GPS and timer...
    startRecording()
  }, [stats.duration, startRecording])

  const stopRecording = useCallback(async () => {
    if (watchIdRef.current) navigator.geolocation.clearWatch(watchIdRef.current)
    if (timerRef.current) clearInterval(timerRef.current)

    const finalPoints = pointsRef.current

    if (finalPoints.length < CONFIG.MIN_RIDE_POINTS) {
      addToast('Ride too short to save', 'warning')
      setCurrentPage('home')
      return
    }

    // Generate H3 cells and route signature
    const h3Cells = []
    const cellSet = new Set()
    for (const point of finalPoints) {
      const cell = latLngToCell(point.lat, point.lng, CONFIG.H3_RESOLUTION)
      if (!cellSet.has(cell)) {
        h3Cells.push(cell)
        cellSet.add(cell)
      }
    }

    const routeSignature = await sha256(h3Cells.join(','))

    const ride = {
      user_id: user.id,
      started_at: new Date(Date.now() - stats.duration * 1000).toISOString(),
      ended_at: new Date().toISOString(),
      duration_sec: Math.floor(stats.duration),
      distance_m: Math.floor(stats.distance),
      route_signature: routeSignature,
      tiles_touched: h3Cells.length,
    }

    try {
      const { data, error } = await saveRide(ride)
      if (error) throw error

      setRides((prev) => [data, ...prev])
      setLastRide({ ...data, h3Cells })
      addToast('Ride saved!', 'success')
      setCurrentPage('rideSummary')
    } catch (err) {
      addToast('Failed to save ride', 'error')
      setCurrentPage('home')
    }
  }, [user, stats, addToast, setCurrentPage, setRides, setLastRide])

  useEffect(() => {
    return () => {
      if (watchIdRef.current) navigator.geolocation.clearWatch(watchIdRef.current)
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [])

  const gpsColors = { waiting: 'bg-slate-500', good: 'bg-emerald-500', okay: 'bg-amber-500', poor: 'bg-red-500' }

  return (
    <div className="h-screen flex flex-col bg-slate-900">
      <div ref={mapContainerRef} className="flex-1 relative">
        <div className="absolute top-0 left-0 right-0 bg-gradient-to-b from-slate-900/90 to-transparent p-6 safe-area-inset-top z-10">
          <div className="text-center space-y-2">
            <div className="text-6xl font-bold text-white tabular-nums">{(stats.distance / 1000).toFixed(2)}</div>
            <div className="text-cyan-400 text-lg font-medium">kilometers</div>
            <div className="text-3xl font-semibold text-white/80">{formatDuration(stats.duration)}</div>
          </div>
        </div>

        <div className="absolute top-6 right-6 z-10 safe-area-inset-top">
          <div className={`${gpsColors[gpsStatus]} w-3 h-3 rounded-full`} />
        </div>
      </div>

      <div className="bg-slate-800 p-6 space-y-4 border-t border-slate-700 safe-area-inset-bottom">
        {rideState === 'idle' && (
          <button onClick={startRecording} className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-5 rounded-2xl flex items-center justify-center gap-3">
            <Play className="w-7 h-7" fill="currentColor" /><span className="text-xl">Start</span>
          </button>
        )}

        {rideState === 'recording' && (
          <div className="flex gap-3">
            <button onClick={pauseRecording} className="flex-1 bg-amber-600 hover:bg-amber-500 text-white font-bold py-5 rounded-2xl flex items-center justify-center gap-2">
              <Pause className="w-6 h-6" /><span>Pause</span>
            </button>
            <button onClick={stopRecording} className="flex-1 bg-red-600 hover:bg-red-500 text-white font-bold py-5 rounded-2xl flex items-center justify-center gap-2">
              <Square className="w-6 h-6" fill="currentColor" /><span>Stop</span>
            </button>
          </div>
        )}

        {rideState === 'paused' && (
          <div className="flex gap-3">
            <button onClick={resumeRecording} className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-5 rounded-2xl flex items-center justify-center gap-2">
              <Play className="w-6 h-6" fill="currentColor" /><span>Resume</span>
            </button>
            <button onClick={stopRecording} className="flex-1 bg-red-600 hover:bg-red-500 text-white font-bold py-5 rounded-2xl flex items-center justify-center gap-2">
              <Square className="w-6 h-6" fill="currentColor" /><span>Stop</span>
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// Ride Summary Page
function RideSummaryPage() {
  const { lastRide, rides, setCurrentPage } = useApp()

  if (!lastRide) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <button onClick={() => setCurrentPage('home')} className="text-cyan-400">Go Home</button>
      </div>
    )
  }

  const recentCount = rides.filter((r) => {
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
    return r.route_signature === lastRide.route_signature && new Date(r.started_at || r.created_at).getTime() >= weekAgo
  }).length

  const isUnlocked = recentCount >= 3

  return (
    <div className="min-h-screen bg-slate-900 p-4 space-y-4 safe-area-inset-top safe-area-inset-bottom">
      <div className="bg-gradient-to-br from-cyan-600 to-purple-700 rounded-3xl p-6 text-white text-center space-y-2">
        <CheckCircle className="w-12 h-12 mx-auto text-white/80" />
        <div className="text-5xl font-bold">{(lastRide.distance_m / 1000).toFixed(2)}</div>
        <div className="text-lg text-cyan-100">kilometers</div>
      </div>

      <div className="bg-slate-800 rounded-2xl p-4 border border-slate-700">
        <div className="grid grid-cols-3 gap-4 text-center">
          <div><div className="text-2xl font-bold text-white">{formatDuration(lastRide.duration_sec)}</div><div className="text-xs text-slate-500">Duration</div></div>
          <div><div className="text-2xl font-bold text-white">{((lastRide.distance_m / lastRide.duration_sec) * 3.6).toFixed(1)}</div><div className="text-xs text-slate-500">Avg km/h</div></div>
          <div><div className="text-2xl font-bold text-white">{lastRide.tiles_touched || 0}</div><div className="text-xs text-slate-500">Tiles</div></div>
        </div>
      </div>

      <div className="bg-slate-800 rounded-2xl p-4 border border-slate-700 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-slate-400">Route Progress (7 Days)</span>
          <span className="text-sm font-bold text-cyan-400">{Math.min(recentCount, 3)}/3</span>
        </div>
        <div className="bg-slate-700 rounded-full h-3 overflow-hidden">
          <div className="bg-gradient-to-r from-cyan-500 to-purple-500 h-3 rounded-full transition-all duration-700" style={{ width: `${(Math.min(recentCount, 3) / 3) * 100}%` }} />
        </div>
        {isUnlocked ? (
          <div className="bg-emerald-500/20 border border-emerald-500/50 rounded-xl p-3 flex items-center gap-2">
            <Award className="w-5 h-5 text-emerald-400" />
            <span className="text-sm font-semibold text-emerald-300">Unlocked! Tiles are claimable on this route</span>
          </div>
        ) : (
          <p className="text-sm text-slate-400">Ride this route {3 - recentCount} more time{3 - recentCount !== 1 ? 's' : ''} to unlock claiming</p>
        )}
      </div>

      <div className="space-y-3 pt-4">
        <button onClick={() => setCurrentPage('home')} className="w-full bg-cyan-600 hover:bg-cyan-500 text-white font-bold py-4 rounded-xl">Done</button>
        <button onClick={() => setCurrentPage('territory')} className="w-full bg-slate-800 hover:bg-slate-700 text-white font-semibold py-4 rounded-xl border border-slate-600">View Territory Map</button>
      </div>
    </div>
  )
}

// Territory Map Page
function TerritoryMapPage() {
  const { tiles } = useApp()
  const mapContainerRef = useRef(null)
  const mapRef = useRef(null)

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        mapRef.current = new mapboxgl.Map({
          container: mapContainerRef.current,
          style: 'mapbox://styles/mapbox/dark-v11',
          center: [pos.coords.longitude, pos.coords.latitude],
          zoom: 13,
          attributionControl: false,
        })

        mapRef.current.on('load', () => {
          // Add tile polygons
          if (tiles.length > 0) {
            const features = tiles.map((tile) => {
              const boundary = cellToBoundary(tile.h3_index, true)
              return {
                type: 'Feature',
                geometry: { type: 'Polygon', coordinates: [boundary] },
                properties: { h3: tile.h3_index },
              }
            })

            mapRef.current.addSource('tiles', {
              type: 'geojson',
              data: { type: 'FeatureCollection', features },
            })

            mapRef.current.addLayer({
              id: 'tiles-fill',
              type: 'fill',
              source: 'tiles',
              paint: { 'fill-color': '#06b6d4', 'fill-opacity': 0.4 },
            })

            mapRef.current.addLayer({
              id: 'tiles-outline',
              type: 'line',
              source: 'tiles',
              paint: { 'line-color': '#06b6d4', 'line-width': 2 },
            })
          }
        })
      },
      () => {
        mapRef.current = new mapboxgl.Map({
          container: mapContainerRef.current,
          style: 'mapbox://styles/mapbox/dark-v11',
          center: [0, 0],
          zoom: 2,
          attributionControl: false,
        })
      }
    )

    return () => {
      if (mapRef.current) mapRef.current.remove()
    }
  }, [tiles])

  return (
    <div className="h-screen flex flex-col bg-slate-900">
      <div className="bg-slate-800 p-4 border-b border-slate-700 safe-area-inset-top">
        <h1 className="text-xl font-bold text-white">Territory Map</h1>
        <p className="text-sm text-slate-400">{tiles.length} tiles owned</p>
      </div>
      <div ref={mapContainerRef} className="flex-1" />
    </div>
  )
}

// Leaderboard Page
function LeaderboardPage() {
  const { user } = useApp()
  const [leaderboard, setLeaderboard] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const loadLeaderboard = async () => {
      const { data } = await getLeaderboard()
      if (data) setLeaderboard(data)
      setLoading(false)
    }
    loadLeaderboard()
  }, [])

  return (
    <div className="min-h-screen bg-slate-900 pb-24">
      <div className="bg-gradient-to-r from-amber-600 to-orange-600 p-6 safe-area-inset-top">
        <div className="flex items-center gap-3">
          <Trophy className="w-8 h-8 text-white" />
          <h1 className="text-2xl font-bold text-white">Leaderboard</h1>
        </div>
      </div>

      <div className="p-4 space-y-2">
        {loading ? (
          <div className="text-center py-12"><Loader2 className="w-8 h-8 animate-spin mx-auto text-slate-500" /></div>
        ) : leaderboard.length === 0 ? (
          <div className="text-center py-16 text-slate-500">
            <Trophy className="w-16 h-16 mx-auto mb-4 opacity-30" />
            <div className="text-lg">No riders yet</div>
            <div className="text-sm">Be the first!</div>
          </div>
        ) : (
          leaderboard.map((entry, index) => (
            <div key={entry.user_id} className={`bg-slate-800 rounded-xl p-4 flex items-center gap-4 border ${entry.user_id === user?.id ? 'border-cyan-500 bg-cyan-500/10' : 'border-slate-700'}`}>
              <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm ${index === 0 ? 'bg-amber-500 text-white' : index === 1 ? 'bg-slate-400 text-white' : index === 2 ? 'bg-orange-700 text-white' : 'bg-slate-700 text-slate-400'}`}>
                {index + 1}
              </div>
              <div className="flex-1">
                <div className="font-semibold text-white">{entry.name || 'Anonymous'}{entry.user_id === user?.id && <span className="ml-2 text-xs text-cyan-400">(You)</span>}</div>
                <div className="text-sm text-slate-500">{entry.tiles_owned || 0} tiles</div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

// Profile Page
function ProfilePage() {
  const { user, profile, rides, tiles, handleSignOut, setCurrentPage } = useApp()

  const totalDistance = rides.reduce((sum, r) => sum + (r.distance_m || 0), 0)
  const totalTime = rides.reduce((sum, r) => sum + (r.duration_sec || 0), 0)

  return (
    <div className="min-h-screen bg-slate-900 pb-24">
      <div className="bg-gradient-to-r from-cyan-600 to-purple-600 p-6 safe-area-inset-top">
        <div className="flex items-center gap-4 mb-6">
          <div className="w-20 h-20 bg-white/20 backdrop-blur rounded-full overflow-hidden flex items-center justify-center">
            {profile?.avatar_url ? (
              <img src={profile.avatar_url} alt="Profile" className="w-full h-full object-cover" />
            ) : (
              <User className="w-10 h-10 text-white" />
            )}
          </div>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-white">
              {profile?.first_name && profile?.last_name 
                ? `${profile.first_name} ${profile.last_name}`
                : profile?.name || 'Rider'}
            </h1>
            <div className="text-sm text-cyan-100">{user?.email}</div>
          </div>
          <button 
            onClick={() => setCurrentPage('editProfile')}
            className="p-2 bg-white/20 rounded-lg hover:bg-white/30 transition-colors"
          >
            <Camera className="w-5 h-5 text-white" />
          </button>
        </div>

        <div className="grid grid-cols-3 gap-4 bg-white/10 backdrop-blur rounded-xl p-4">
          <div className="text-center"><div className="text-2xl font-bold text-white">{rides.length}</div><div className="text-xs text-cyan-100">Rides</div></div>
          <div className="text-center"><div className="text-2xl font-bold text-white">{(totalDistance / 1000).toFixed(0)}</div><div className="text-xs text-cyan-100">km</div></div>
          <div className="text-center"><div className="text-2xl font-bold text-white">{Math.floor(totalTime / 3600)}</div><div className="text-xs text-cyan-100">hours</div></div>
        </div>
      </div>

      <div className="p-4 space-y-4">
        <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
          <h2 className="font-semibold text-white mb-3 flex items-center gap-2"><Award className="w-5 h-5 text-amber-400" />Recent Rides</h2>
          {rides.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-4">No rides yet</p>
          ) : (
            <div className="space-y-3">
              {rides.slice(0, 5).map((ride) => (
                <div key={ride.id} className="border-b border-slate-700 last:border-0 pb-3 last:pb-0">
                  <div className="flex justify-between">
                    <div>
                      <div className="font-semibold text-white">{((ride.distance_m || 0) / 1000).toFixed(2)} km</div>
                      <div className="text-xs text-slate-500">{new Date(ride.started_at || ride.created_at).toLocaleDateString()}</div>
                    </div>
                    <div className="text-sm text-slate-400">{formatDuration(ride.duration_sec || 0)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <button 
          onClick={() => setCurrentPage('editProfile')} 
          className="w-full bg-slate-800 hover:bg-slate-700 text-white font-semibold py-4 rounded-xl flex items-center justify-center gap-2 border border-slate-600"
        >
          <User className="w-5 h-5" />Edit Profile
        </button>

        <button onClick={handleSignOut} className="w-full bg-red-600/20 hover:bg-red-600/30 text-red-400 font-semibold py-4 rounded-xl flex items-center justify-center gap-2 border border-red-600/30">
          <LogOut className="w-5 h-5" />Sign Out
        </button>
      </div>
    </div>
  )
}

// Edit Profile Page
function EditProfilePage() {
  const { user, profile, setProfile, setCurrentPage, addToast } = useApp()
  const [firstName, setFirstName] = useState(profile?.first_name || '')
  const [lastName, setLastName] = useState(profile?.last_name || '')
  const [photoUrl, setPhotoUrl] = useState(profile?.avatar_url || null)
  const [photoFile, setPhotoFile] = useState(null)
  const [saving, setSaving] = useState(false)
  const fileInputRef = useRef(null)

  const handlePhotoSelect = (e) => {
    const file = e.target.files[0]
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        addToast('Photo must be less than 5MB', 'error')
        return
      }
      setPhotoFile(file)
      const reader = new FileReader()
      reader.onloadend = () => setPhotoUrl(reader.result)
      reader.readAsDataURL(file)
    }
  }

  const handleSave = async () => {
    if (!firstName.trim() || !lastName.trim()) {
      addToast('Please enter your first and last name', 'error')
      return
    }

    setSaving(true)

    try {
      let avatarUrl = photoUrl

      if (photoFile) {
        const fileExt = photoFile.name.split('.').pop()
        const fileName = `${user.id}-${Date.now()}.${fileExt}`
        const filePath = `avatars/${fileName}`

        const { error: uploadError } = await supabase.storage
          .from('avatars')
          .upload(filePath, photoFile)

        if (!uploadError) {
          const { data: { publicUrl } } = supabase.storage
            .from('avatars')
            .getPublicUrl(filePath)
          avatarUrl = publicUrl
        }
      }

      const { data, error } = await supabase
        .from('profiles')
        .upsert({
          id: user.id,
          email: user.email,
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          name: `${firstName.trim()} ${lastName.trim()}`,
          avatar_url: avatarUrl,
          updated_at: new Date().toISOString()
        })
        .select()
        .single()

      if (error) throw error

      setProfile(data)
      addToast('Profile updated!', 'success')
      setCurrentPage('profile')
    } catch (err) {
      console.error('Error saving profile:', err)
      addToast('Failed to save profile', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-900 safe-area-inset-top safe-area-inset-bottom">
      <div className="bg-slate-800 p-4 border-b border-slate-700 flex items-center gap-4">
        <button onClick={() => setCurrentPage('profile')} className="text-slate-400 hover:text-white">
          <X className="w-6 h-6" />
        </button>
        <h1 className="text-xl font-bold text-white flex-1">Edit Profile</h1>
      </div>

      <div className="p-6 space-y-6">
        {/* Photo */}
        <div className="flex justify-center">
          <div onClick={() => fileInputRef.current?.click()} className="relative cursor-pointer group">
            <div className="w-32 h-32 rounded-full bg-slate-700 border-4 border-slate-600 overflow-hidden flex items-center justify-center group-hover:border-cyan-500 transition-colors">
              {photoUrl ? (
                <img src={photoUrl} alt="Profile" className="w-full h-full object-cover" />
              ) : (
                <User className="w-16 h-16 text-slate-500" />
              )}
            </div>
            <div className="absolute bottom-0 right-0 w-10 h-10 bg-cyan-500 rounded-full flex items-center justify-center border-4 border-slate-900">
              <Camera className="w-5 h-5 text-white" />
            </div>
            <input ref={fileInputRef} type="file" accept="image/*" onChange={handlePhotoSelect} className="hidden" />
          </div>
        </div>

        {/* Form */}
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-2">First Name</label>
            <input type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} className="w-full px-4 py-3 rounded-xl bg-slate-800 text-white border border-slate-600 focus:border-cyan-500 focus:outline-none" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-2">Last Name</label>
            <input type="text" value={lastName} onChange={(e) => setLastName(e.target.value)} className="w-full px-4 py-3 rounded-xl bg-slate-800 text-white border border-slate-600 focus:border-cyan-500 focus:outline-none" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-2">Email</label>
            <input type="email" value={user?.email || ''} disabled className="w-full px-4 py-3 rounded-xl bg-slate-800/50 text-slate-500 border border-slate-700 cursor-not-allowed" />
          </div>
        </div>

        <button onClick={handleSave} disabled={saving} className="w-full bg-cyan-500 hover:bg-cyan-400 text-slate-900 font-bold py-4 rounded-xl disabled:opacity-50 flex items-center justify-center gap-2">
          {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <><Save className="w-5 h-5" />Save Changes</>}
        </button>
      </div>
    </div>
  )
}

// Bottom Navigation
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
        <button key={id} onClick={() => setCurrentPage(id)} className={`flex flex-col items-center justify-center p-2 rounded-xl transition-colors relative ${currentPage === id ? 'text-cyan-400' : 'text-slate-500'}`}>
          <Icon className="w-6 h-6" />
          <span className="text-xs mt-1 font-medium">{label}</span>
          {badge > 0 && <span className="absolute top-0 right-0 w-5 h-5 bg-red-500 text-white text-xs rounded-full flex items-center justify-center">{badge}</span>}
        </button>
      ))}
    </div>
  )
}
