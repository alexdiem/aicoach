"""
Parse FIT or GPX activity files into a unified dict with per-GPS-point performance data.
"""
from __future__ import annotations

import io
import math
import xml.etree.ElementTree as ET

import gpxpy


def _haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Distance between two GPS points in meters."""
    R = 6371000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def _parse_fit(content: bytes) -> dict:
    import fitparse
    ff = fitparse.FitFile(io.BytesIO(content))
    points = []
    for record in ff.get_messages('record'):
        data = {f.name: f.value for f in record}
        lat = data.get('position_lat')
        lon = data.get('position_long')
        if lat is None or lon is None:
            continue
        # FIT semicircles to degrees
        lat = lat * 180 / 2**31
        lon = lon * 180 / 2**31
        dist = data.get('distance') or 0.0  # meters
        points.append({
            'lat': lat, 'lon': lon,
            'ele': data.get('altitude') or data.get('enhanced_altitude') or 0.0,
            'dist_m': float(dist),
            'power': data.get('power'),
            'hr': data.get('heart_rate'),
            'speed_ms': data.get('speed'),
        })
    # compute total gain from elevation deltas
    total_gain = sum(max(0, points[i]['ele'] - points[i-1]['ele']) for i in range(1, len(points)))
    total_dist = points[-1]['dist_m'] if points else 0.0
    return {'points': points, 'total_distance_m': total_dist, 'total_gain_m': total_gain}


def _parse_gpx_activity(content: bytes) -> dict:
    gpx_text = content.decode('utf-8', errors='replace')
    gpx = gpxpy.parse(gpx_text)
    # Also parse raw XML for extensions
    root = ET.fromstring(gpx_text)

    points = []
    cumulative_dist = 0.0
    prev_pt = None

    for track in gpx.tracks:
        for segment in track.segments:
            for pt in segment.points:
                if pt.latitude is None or pt.longitude is None:
                    continue
                if prev_pt:
                    cumulative_dist += _haversine(prev_pt.latitude, prev_pt.longitude, pt.latitude, pt.longitude)
                points.append({
                    'lat': pt.latitude, 'lon': pt.longitude,
                    'ele': pt.elevation or 0.0,
                    'dist_m': cumulative_dist,
                    'power': None, 'hr': None, 'speed_ms': None,
                })
                prev_pt = pt

    # Extract extensions from raw XML
    trkpts = root.findall('.//gpx:trkpt', {'gpx': 'http://www.topografix.com/GPX/1/1'})
    for i, trkpt in enumerate(trkpts):
        if i >= len(points):
            break
        ext = trkpt.find('.//{http://www.garmin.com/xmlschemas/TrackPointExtension/v1}TrackPointExtension')
        if ext is not None:
            hr_el = ext.find('{http://www.garmin.com/xmlschemas/TrackPointExtension/v1}hr')
            if hr_el is not None and hr_el.text:
                points[i]['hr'] = int(hr_el.text)
        # power in various namespaces
        for tag in ['{http://www.garmin.com/xmlschemas/PowerExtension/v1}PowerInWatts',
                    '{http://www.garmin.com/xmlschemas/TrackPointExtension/v1}power',
                    'power']:
            pw = trkpt.find('.//' + tag) if tag.startswith('{') else trkpt.find(tag)
            if pw is not None and pw.text:
                try:
                    points[i]['power'] = int(float(pw.text))
                    break
                except ValueError:
                    pass

    total_gain = sum(max(0, points[i]['ele'] - points[i-1]['ele']) for i in range(1, len(points)))
    total_dist = points[-1]['dist_m'] if points else 0.0
    return {'points': points, 'total_distance_m': total_dist, 'total_gain_m': total_gain}


def parse_activity_file(content: bytes, filename: str) -> dict:
    """
    Parse a FIT or GPX activity file.
    Returns {'points': [...], 'total_distance_m': float, 'total_gain_m': float}.
    Each point: {lat, lon, ele, dist_m, power, hr, speed_ms}
    """
    if filename.lower().endswith('.fit'):
        return _parse_fit(content)
    return _parse_gpx_activity(content)
