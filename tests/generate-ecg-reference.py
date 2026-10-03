"""Regenerate fixtures with NumPy/SciPy; runtime tests do not require Python.

Reference: ECGFounder util.filter_bandpass at revision
04edac702b61c91face519774ddcc0cd712fef23, adapted to 125 Hz and followed by population z-score.
"""
import json
from pathlib import Path
import numpy as np
import scipy
from scipy.signal import butter, filtfilt, iirnotch, medfilt

cases = {}
i = np.arange(5000, dtype=np.float64)
sample_rate = 125
baseline_samples = 51
t = i / sample_rate
cases['periodic'] = np.sin(2 * np.pi * 1.2 * t) + 0.2 * np.sin(2 * np.pi * 12 * t)
cases['baseline_and_interference'] = (
    np.sin(2 * np.pi * 1.2 * t) + 0.3 * np.sin(2 * np.pi * 50 * t)
    + 0.5 * np.sin(2 * np.pi * 0.2 * t)
    + np.where(i % 104 == 0, 2.0, 0.0)
)
fixtures = []
for name, signal in cases.items():
    filtered = filtfilt(*iirnotch(50, 30, sample_rate), signal)
    filtered = filtfilt(*butter(4, [0.67, 40], btype='bandpass', fs=sample_rate), filtered)
    filtered -= medfilt(filtered, kernel_size=baseline_samples)
    expected = ((filtered - filtered.mean()) / (filtered.std() + 1e-8)).astype(np.float32)
    fixtures.append(dict(name=name, samples=signal.tolist(), expected=expected.tolist()))
destination = Path(__file__).parent / 'fixtures/ecg-preprocessing.json'
destination.parent.mkdir(exist_ok=True)
destination.write_text(json.dumps(dict(scipy=scipy.__version__, numpy=np.__version__, sample_rate=sample_rate, baseline_samples=baseline_samples, cases=fixtures)), encoding='utf-8')
print(f'Wrote {destination}')
