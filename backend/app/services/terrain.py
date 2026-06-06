"""
GPX analysis and route-to-workout terrain matching.
Designed for hilly terrain (Oslo area) where flat intervals aren't realistic.
"""
from __future__ import annotations

import math
from typing import TYPE_CHECKING

import gpxpy
import gpxpy.gpx

if TYPE_CHECKING:
    from app.models.route import Route

# Minimum gradient (%) and length (m) to consider a segment a "climb"
CLIMB_GRADIENT_THRESHOLD = 3.0
CLIMB_MIN_LENGTH_M = 100
SMOOTHING_WINDOW = 5  # points


def _smooth(arr: list[float], w: int) -> list[float]:
    result = []
    for i in range(len(arr)):
        lo = max(0, i - w // 2)
        hi = min(len(arr), i + w // 2 + 1)
        result.append(sum(arr[lo:hi]) / (hi - lo))
    return result


def _haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Distance between two GPS points in meters."""
    R = 6371000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def analyze_gpx(gpx_content: str) -> dict:
    """
    Parse GPX and extract elevation profile + climb segments.
    Returns analysis dict suitable for storage in Route.analysis.
    """
    gpx = gpxpy.parse(gpx_content)

    points = []
    for track in gpx.tracks:
        for segment in track.segments:
            for pt in segment.points:
                if pt.latitude and pt.longitude:
                    points.append({
                        "lat": pt.latitude,
                        "lon": pt.longitude,
                        "ele": pt.elevation or 0.0,
                    })

    if len(points) < 2:
        return {"segments": [], "terrain_type": "UNKNOWN", "error": "Insufficient GPS data"}

    # Calculate cumulative distance and elevation gain
    total_distance = 0.0
    total_gain = 0.0
    distances = [0.0]
    gradients = []

    for i in range(1, len(points)):
        d = _haversine(
            points[i - 1]["lat"], points[i - 1]["lon"],
            points[i]["lat"], points[i]["lon"]
        )
        total_distance += d
        distances.append(total_distance)

        ele_diff = points[i]["ele"] - points[i - 1]["ele"]
        if ele_diff > 0:
            total_gain += ele_diff

        grad = (ele_diff / d * 100) if d > 1 else 0.0
        gradients.append(grad)

    smoothed = _smooth(gradients, SMOOTHING_WINDOW)

    # Identify climb segments: consecutive points above threshold
    climb_segments = []
    in_climb = False
    climb_start_idx = 0

    for i, grad in enumerate(smoothed):
        if not in_climb and grad >= CLIMB_GRADIENT_THRESHOLD:
            in_climb = True
            climb_start_idx = i
        elif in_climb and (grad < CLIMB_GRADIENT_THRESHOLD - 1.0 or i == len(smoothed) - 1):
            end_idx = i
            length = distances[end_idx] - distances[climb_start_idx]
            if length >= CLIMB_MIN_LENGTH_M:
                ele_gain = max(0, points[end_idx]["ele"] - points[climb_start_idx]["ele"])
                avg_grad = (ele_gain / length * 100) if length > 0 else 0.0
                category = categorize_climb(length, avg_grad)
                # Reference FTP rider: 3.5 W/kg, ~75kg = 262W
                # Climbing speed at FTP: roughly (FTP in W) / (total resistance)
                # Simple estimate: at 8% gradient, ~10km/h = 1.67 m/s at FTP
                speed_mps = max(1.0, 1.67 * (5.0 / max(avg_grad, 1.0)) ** 0.3)
                est_duration_min = (length / speed_mps) / 60

                climb_segments.append({
                    "start_km": round(distances[climb_start_idx] / 1000, 2),
                    "end_km": round(distances[end_idx] / 1000, 2),
                    "length_meters": round(length),
                    "elevation_gain_m": round(ele_gain),
                    "avg_gradient_pct": round(avg_grad, 1),
                    "category": category,
                    "est_duration_at_ftp_min": round(est_duration_min, 1),
                })
            in_climb = False

    terrain_type = _classify_overall_terrain(total_distance, total_gain, climb_segments)

    return {
        "segments": climb_segments,
        "terrain_type": terrain_type,
        "total_distance_m": round(total_distance),
        "total_gain_m": round(total_gain),
        "gain_per_10km": round(total_gain / (total_distance / 10000)) if total_distance > 0 else 0,
    }


def categorize_climb(length_m: float, avg_gradient_pct: float) -> str:
    """
    Classify climb by duration at FTP effort.
    SHORT_PUNCH: < 2 min (punchy, explosive)
    MEDIUM_CLIMB: 2-8 min (VO2max territory)
    LONG_CLIMB: > 8 min (threshold / FTP effort)
    ROLLING: not a single dominant climb
    FLAT: minimal gradient throughout
    """
    if avg_gradient_pct < 2.0:
        return "FLAT"
    speed_mps = max(1.0, 1.67 * (5.0 / max(avg_gradient_pct, 1.0)) ** 0.3)
    duration_min = (length_m / speed_mps) / 60
    if duration_min < 2:
        return "SHORT_PUNCH"
    elif duration_min < 8:
        return "MEDIUM_CLIMB"
    else:
        return "LONG_CLIMB"


def _classify_overall_terrain(distance_m: float, gain_m: float, segments: list[dict]) -> str:
    if distance_m == 0:
        return "UNKNOWN"
    gain_per_km = gain_m / (distance_m / 1000)
    if gain_per_km < 5:
        return "FLAT"
    if len(segments) == 0:
        return "ROLLING"
    max_climb = max((s["length_meters"] for s in segments), default=0)
    if max_climb > distance_m * 0.3:
        return "LONG_CLIMB_DOMINANT"
    if len(segments) >= 3:
        return "ROLLING_HILLY"
    return "ROLLING"


def match_route_to_workout(
    workout_type: str,
    target_duration_min: int,
    target_intensity: str,
    available_routes: list["Route"],
    athlete_ftp: float = 250.0,
) -> dict:
    """
    Find the best route for a given workout.
    Returns match result with score and rationale.
    """
    if not available_routes:
        return {
            "best_match": None,
            "match_score": 0.0,
            "rationale": "No routes in library.",
            "modification_suggestion": "Add GPX routes to your library, or complete this session indoors.",
            "indoor_recommended": True,
        }

    scored = []
    for route in available_routes:
        score, notes = _score_route(route, workout_type, target_duration_min, target_intensity, athlete_ftp)
        scored.append((score, notes, route))

    scored.sort(key=lambda x: x[0], reverse=True)
    best_score, best_notes, best_route = scored[0]

    indoor_threshold = 0.4
    indoor_recommended = best_score < indoor_threshold

    modification = None
    if indoor_recommended:
        modification = _suggest_indoor_adaptation(workout_type, target_duration_min, target_intensity)

    return {
        "best_match": best_route,
        "match_score": round(best_score, 2),
        "rationale": best_notes,
        "modification_suggestion": modification,
        "indoor_recommended": indoor_recommended,
    }


def _score_route(
    route: "Route",
    workout_type: str,
    target_duration_min: int,
    target_intensity: str,
    athlete_ftp: float,
) -> tuple[float, str]:
    analysis = route.analysis or {}
    segments = analysis.get("segments", [])
    terrain_type = analysis.get("terrain_type", "UNKNOWN")

    if target_intensity == "VO2MAX":
        # Want SHORT_PUNCH or MEDIUM_CLIMB segments matching interval duration
        # Prefer routes where segments can be repeated
        matching = [
            s for s in segments
            if s["category"] in ("SHORT_PUNCH", "MEDIUM_CLIMB")
        ]
        if not matching:
            return 0.2, f"Route '{route.name}' has no suitable climb segments for VO2max intervals."

        # Find best duration match
        best_match = min(matching, key=lambda s: abs(s["est_duration_at_ftp_min"] - target_duration_min))
        duration_error = abs(best_match["est_duration_at_ftp_min"] - target_duration_min)
        duration_score = max(0, 1.0 - duration_error / target_duration_min)

        # Repeatability bonus: can we fit multiple reps?
        rep_bonus = min(len(matching), 5) / 5 * 0.2

        score = 0.7 * duration_score + 0.1 * rep_bonus + 0.2
        notes = (
            f"Route '{route.name}': best segment is {best_match['length_meters']}m at "
            f"{best_match['avg_gradient_pct']}% (~{best_match['est_duration_at_ftp_min']}min at FTP). "
            f"{len(matching)} usable climb(s) for repeats."
        )
        return score, notes

    elif target_intensity in ("THRESHOLD", "TEMPO"):
        matching = [s for s in segments if s["category"] == "LONG_CLIMB"]
        if not matching:
            matching = [s for s in segments if s["category"] == "MEDIUM_CLIMB"]
        if not matching:
            return 0.3, f"Route '{route.name}' lacks sustained climbs for threshold work."

        best = max(matching, key=lambda s: s["length_meters"])
        duration_error = abs(best["est_duration_at_ftp_min"] - target_duration_min)
        score = max(0.3, 1.0 - duration_error / max(target_duration_min, 1))
        notes = (
            f"Route '{route.name}': main climb {best['length_meters']}m at "
            f"{best['avg_gradient_pct']}% (~{best['est_duration_at_ftp_min']}min at threshold)."
        )
        return score, notes

    else:  # EASY, LONG, RECOVERY
        # Any terrain works; prefer ROLLING for variety
        if terrain_type in ("ROLLING_HILLY", "ROLLING"):
            score = 0.85
        elif terrain_type == "FLAT":
            score = 0.75
        else:
            score = 0.7
        return score, f"Route '{route.name}' ({terrain_type.lower().replace('_', ' ')}) suits an easy/long ride."


def _suggest_indoor_adaptation(workout_type: str, duration_min: int, intensity: str) -> str:
    suggestions = {
        "VO2MAX": f"Use ERG mode on trainer: {duration_min}min intervals at 105-115% FTP with 1:1 rest. "
                  "Alternatively, find a short punchy climb (>8% gradient) and use it for maximal efforts.",
        "THRESHOLD": f"Trainer in resistance mode: sustained {duration_min}min at 95-105% FTP. "
                     "Or find a hill with >5min of steady climbing.",
        "TEMPO": f"Trainer or flat road: {duration_min}min at 88-93% FTP (Zone 3). "
                 "Any terrain works at this intensity.",
    }
    return suggestions.get(intensity, "Consider completing this session on the trainer.")
