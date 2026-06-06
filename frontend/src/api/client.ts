import axios from 'axios'
import type { Activity, Athlete, FitnessMetrics, Route, WeeklyPlan } from '../types'

const api = axios.create({
  baseURL: '/api',
  timeout: 30000,
})

export function getAthleteId(): number | null {
  const id = sessionStorage.getItem('athlete_id')
  return id ? parseInt(id) : null
}

export function setAthleteId(id: number) {
  sessionStorage.setItem('athlete_id', String(id))
}

export async function connectGarmin(): Promise<{ athlete_id: number; display_name: string }> {
  const r = await api.post('/auth/connect')
  return r.data
}

export async function getAthlete(athleteId: number): Promise<Athlete> {
  const r = await api.get(`/athlete/${athleteId}`)
  return r.data
}

export async function updateAthlete(athleteId: number, data: Partial<Athlete>): Promise<void> {
  await api.patch(`/athlete/${athleteId}`, data)
}

export async function getFitnessMetrics(athleteId: number, days = 90): Promise<FitnessMetrics> {
  const r = await api.get(`/athlete/${athleteId}/fitness`, { params: { days } })
  return r.data
}

export async function getActivities(athleteId: number, limit = 20): Promise<Activity[]> {
  const r = await api.get('/activities', { params: { athlete_id: athleteId, limit } })
  return r.data
}

export async function syncActivities(athleteId: number, daysBack = 30): Promise<{ synced: number }> {
  const r = await api.post('/activities/sync', null, { params: { athlete_id: athleteId, days_back: daysBack } })
  return r.data
}

export async function getCurrentPlan(athleteId: number): Promise<WeeklyPlan | null> {
  const r = await api.get('/plan/current', { params: { athlete_id: athleteId } })
  return r.data
}

export interface DayPreference {
  day_of_week: number
  is_rest: boolean
  preferred_sport: string | null
}

export async function generatePlan(
  athleteId: number,
  schedule: DayPreference[] = [],
  phaseOverride: string | null = null,
): Promise<{ plan_id: number; narrative: string }> {
  const r = await api.post(
    '/plan/generate',
    { athlete_schedule: schedule, fun_activities: [], phase_override: phaseOverride },
    { params: { athlete_id: athleteId } },
  )
  return r.data
}

export async function buildWorkoutStructure(workoutId: number, athleteId: number, routeId?: number) {
  const r = await api.post(`/plan/workouts/${workoutId}/structure`, null, {
    params: { athlete_id: athleteId, route_id: routeId },
  })
  return r.data
}

export async function setWorkoutUnstructured(workoutId: number, athleteId: number, isUnstructured: boolean) {
  const r = await api.patch(`/plan/workouts/${workoutId}/unstructured`, null, {
    params: { athlete_id: athleteId, is_unstructured: isUnstructured },
  })
  return r.data
}

export async function markWorkoutComplete(workoutId: number, athleteId: number, activityId?: number) {
  const r = await api.put(`/plan/workouts/${workoutId}/complete`, null, {
    params: { athlete_id: athleteId, activity_id: activityId },
  })
  return r.data
}

export async function getRoutes(athleteId: number): Promise<Route[]> {
  const r = await api.get('/routes', { params: { athlete_id: athleteId } })
  return r.data
}

export async function uploadRoute(athleteId: number, name: string, file: File): Promise<Route> {
  const form = new FormData()
  form.append('athlete_id', String(athleteId))
  form.append('name', name)
  form.append('gpx_file', file)
  const r = await api.post('/routes/upload', form, { headers: { 'Content-Type': 'multipart/form-data' } })
  return r.data
}

export async function deleteRoute(routeId: number, athleteId: number): Promise<void> {
  await api.delete(`/routes/${routeId}`, { params: { athlete_id: athleteId } })
}

export async function downloadWorkoutFit(workoutId: number, athleteId: number, filename: string): Promise<void> {
  const r = await api.get(`/plan/workouts/${workoutId}/fit`, {
    params: { athlete_id: athleteId },
    responseType: 'blob',
  })
  const url = URL.createObjectURL(new Blob([r.data], { type: 'application/octet-stream' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
