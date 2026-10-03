"""Generate the experimental 125 Hz profile and independent SciPy DSP references.

Requires NumPy and SciPy only. No model training or upstream asset changes.
"""
import json
from pathlib import Path
import numpy as np
from scipy.signal import butter, iirnotch, lfilter_zi, filtfilt, find_peaks, welch

ROOT = Path(__file__).resolve().parents[1]
FS = 125


def pack(pair):
    b, a = pair
    return {"b": b.tolist(), "a": a.tolist(), "zi": lfilter_zi(b, a).tolist()}


profile = {
    "id": "experimental-125hz", "experimental": True, "sample_rate": FS,
    "preprocessing": {
        "lowcut_hz": 20, "highcut_hz": 55, "notch_hz": 50, "notch_quality": 30,
        "envelope_hz": 5, "distance_seconds": 2, "prominence": .2,
        "baseline_reps": 3, "rep_duration_unit": "samples",
    },
    "filters": {
        "bandpass": pack(butter(4, [20, 55], btype="bandpass", fs=FS)),
        "notch": pack(iirnotch(50, 30, FS)),
        "envelope": pack(butter(4, 5, fs=FS)),
    },
}


def process(samples):
    b, a = profile["filters"]["bandpass"]["b"], profile["filters"]["bandpass"]["a"]
    bp = filtfilt(b, a, samples)
    b, a = profile["filters"]["notch"]["b"], profile["filters"]["notch"]["a"]
    filtered = filtfilt(b, a, bp)
    b, a = profile["filters"]["envelope"]["b"], profile["filters"]["envelope"]["a"]
    env = filtfilt(b, a, np.abs(filtered))
    peaks, _ = find_peaks(env, distance=2 * FS, prominence=.2 * np.max(env))
    boundaries = [0, *(((peaks[:-1] + peaks[1:]) // 2).tolist()), len(samples)]
    rows = []
    for i, peak in enumerate(peaks):
        start, end = boundaries[i:i+2]
        segment = filtered[start:end]
        f, power = welch(segment, fs=FS, nperseg=min(1024, len(segment)))
        mdf = float(f[np.searchsorted(np.cumsum(power), power.sum() / 2)]) if power.sum() else 0.
        rows.append({"rep": i+1, "start": start, "end": end, "peak_idx": int(peak), "peak_time": float(peak / FS),
                     "rms": float(np.sqrt(np.mean(segment**2))), "mdf": mdf,
                     "env_peak": float(env[peak]), "rep_duration": end-start})
    columns = ["rms", "mdf", "env_peak", "rep_duration"]
    base = {c: np.mean([r[c] for r in rows[:3]]) for c in columns} if rows else {}
    features = []
    for i, row in enumerate(rows):
        result = dict(row)
        for c in columns:
            result[c + "_rel_base"] = float(row[c] / (base[c] + 1e-9))
            result[c + "_delta_base"] = float(row[c] - base[c])
        for c in columns[:3]:
            result[c + "_diff1"] = float(row[c] - rows[i-1][c]) if i else 0.
            result[c + "_roll3_mean"] = float(np.mean([r[c] for r in rows[max(0, i-2):i+1]]))
        result["peak_time_diff1"] = float(row["peak_time"] - rows[i-1]["peak_time"]) if i else 0.
        features.append(result)
    return {"samples": samples.tolist(), "filtered": filtered.tolist(), "env": env.tolist(),
            "peaks": peaks.tolist(), "rows": features}


signals = []
for name, centers, duration in [("four-reps", [1, 4, 7, 10], 12.5), ("long-welch", [2, 11, 20, 29], 32),
                                ("two-reps", [2, 7], 10), ("flat", [], 10)]:
    time = np.arange(int(FS * duration)) / FS
    envelope = sum(np.exp(-((time-c)/.45)**2) * (.7 + .1*i) for i, c in enumerate(centers))
    samples = envelope * (np.sin(2*np.pi*31*time) + .3*np.cos(2*np.pi*43*time))
    if centers:
        samples += .001*np.sin(2*np.pi*50*time)
    else:
        samples = np.zeros(len(time))
    signals.append({"name": name, **process(samples)})

mdf = []
for count in [1, 27, 777, 1023, 1024, 2049]:
    time = np.arange(count) / FS
    samples = np.sin(2*np.pi*31*time) + .7*np.sin(2*np.pi*43*time)
    f, power = welch(samples, fs=FS, nperseg=min(1024, count))
    expected = float(f[np.searchsorted(np.cumsum(power), power.sum()/2)]) if power.sum() else 0.
    mdf.append({"samples": samples.tolist(), "expected": expected})

(ROOT / "static/models/emg-fatigue/experimental-125hz.json").write_text(json.dumps(profile, indent=2) + "\n")
(ROOT / "tests/fixtures/emg-preprocessing.json").write_text(json.dumps({"fs": FS, "signals": signals, "mdf": mdf}) + "\n")
print(f"Generated profile, {len(signals)} signal references and {len(mdf)} Welch references")
