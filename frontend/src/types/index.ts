export type ActivityType = 'CYCLING' | 'RUNNING' | 'XC_SKIING' | 'HIKING' | 'CLIMBING' | 'STRENGTH' | 'OTHER'
export type SportCategory = 'AEROBIC_TRAINING' | 'CASUAL' | 'STRENGTH'
export type Season = 'CYCLING_RUNNING' | 'SKI'
export type Phase = 'BASE' | 'BUILD' | 'PEAK' | 'RECOVERY'
export type WorkoutType = 'EASY' | 'TEMPO' | 'THRESHOLD' | 'VO2MAX' | 'LONG' | 'RECOVERY' | 'STRENGTH'

export interface Activity {
  id: number
  garmin_activity_id: string | null
  activity_type: ActivityType
  sport_category: SportCategory
  start_time: string
  duration_seconds: number
  distance_meters: number | null
  elevation_gain_meters: number | null
  avg_heart_rate: number | null
  avg_power_watts: number | null
  normalized_power_watts: number | null
  training_stress_score: number | null
  is_indoor: boolean
  notes: string | null
}

export interface FitnessPoint {
  date: string
  ctl: number
  atl: number
  tsb: number
  tss: number
}

export interface Readiness {
  score: number
  zone: string
  guidance: string
  signals: {
    body_battery?: number
    hrv_status?: string
    sleep_score?: number
    sleep_hours?: number
    resting_hr?: number
  }
}

export interface DailyWellness {
  date: string
  body_battery_max: number | null
  hrv_status: string | null
  hrv_last_night_avg: number | null
  sleep_score: number | null
  sleep_hours: number | null
  resting_hr: number | null
  avg_stress: number | null
}

export interface FitnessMetrics {
  series: FitnessPoint[]
  current: { ctl: number; atl: number; tsb: number }
  readiness: Readiness
  recent_wellness: DailyWellness[]
  cross_sport_transfer: Record<string, number>
  season: Season
  season_confidence: number
  vo2max_trends: {
    cycling: Array<{ date: string; vo2max: number }>
    running: Array<{ date: string; vo2max: number }>
    skiing: Array<{ date: string; vo2max: number }>
  }
}

export interface RouteSegment {
  start_km: number
  end_km: number
  length_meters: number
  elevation_gain_m: number
  avg_gradient_pct: number
  category: 'SHORT_PUNCH' | 'MEDIUM_CLIMB' | 'LONG_CLIMB' | 'ROLLING' | 'FLAT'
  est_duration_at_ftp_min: number
  avg_power_w?: number | null
  avg_hr_bpm?: number | null
  avg_speed_kmh?: number | null
}

export interface Route {
  id: number
  name: string
  distance_km: number
  elevation_gain_m: number
  terrain_type: string
  gain_per_10km: number
  segments: RouteSegment[]
  created_at: string
  start_km?: number | null
  end_km?: number | null
  performance_profile?: {
    segments_with_perf?: Array<{
      start_km: number
      end_km: number
      avg_power_w?: number | null
      avg_hr_bpm?: number | null
      avg_speed_kmh?: number | null
    }>
  }
  source_file_type?: string | null
}

export interface SessionInterval {
  type: 'work' | 'rest'
  rep?: number
  total_reps?: number
  duration_minutes: number
  target?: string
  notes: string
  segment?: {
    category: string
    avg_gradient_pct: number
    length_meters: number
    est_duration_at_ftp_min: number
  } | null
}

export interface StructuredSession {
  warmup_minutes: number
  warmup_notes: string | null
  intervals: SessionInterval[]
  cooldown_minutes: number
  cooldown_notes: string | null
  route_id: number | null
  route_name: string | null
  total_duration_minutes: number
  route_summary?: {
    distance_km: number
    elevation_gain_m: number
    estimated_minutes: number
    full_route_km: number | null
  } | null
}

export interface PlannedWorkout {
  id: number
  day_of_week: number
  sport: string
  workout_type: WorkoutType
  duration_minutes: number
  intensity_zone: string | null
  purpose: string
  terrain_notes: string | null
  is_completed: boolean
  is_unstructured: boolean
  structured_session: StructuredSession | null
  compliance_score: number | null
  ai_compliance_notes: string | null
}

export interface WeeklyPlan {
  id: number
  week_start: string
  season: Season
  phase: Phase
  ctl_at_generation: number
  narrative: string | null
  workouts: PlannedWorkout[]
}

export interface Athlete {
  id: number
  display_name: string | null
  ftp_watts: number | null
  lthr: number | null
  vo2max_running: number | null
  vo2max_cycling: number | null
}
