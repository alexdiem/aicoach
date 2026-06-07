import { createContext, useContext, useState, type ReactNode } from 'react'
import { getAthleteId, setAthleteId, getApiKey, setApiKey } from '../api/client'

interface AuthContextValue {
  athleteId: number | null
  setAthlete: (id: number) => void
  apiKey: string | null
  setKey: (key: string) => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [athleteId, setLocalAthleteId] = useState<number | null>(getAthleteId())
  const [apiKey, setLocalApiKey] = useState<string | null>(getApiKey())

  function setAthlete(id: number) {
    setAthleteId(id)
    setLocalAthleteId(id)
  }
  function setKey(key: string) {
    setApiKey(key)
    setLocalApiKey(key)
  }
  return (
    <AuthContext.Provider value={{ athleteId, setAthlete, apiKey, setKey }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
