# Pocket G — Supabase sample

A small SvelteKit 3 + TypeScript viewer for `public.ekgemgpuls` in the
`hackyeah2026` Supabase project.

## Sample app setup

The local `.env` is configured. For a fresh checkout, copy `.env.example` to
`.env` and set your Supabase URL and publishable key. Never use a secret or
service-role key. Variables are declared in `src/env.ts` using SvelteKit 3's
explicit environment configuration.

Run `npm install`, then `npm run dev`.

The app loads the latest 100 rows through the Supabase REST API.
It displays latest sensor values, an exact accessible row count, a searchable
table with 20 rows per page, and a refresh button. Search applies to the loaded
100 rows. Separate EKG, EMG, and pulse charts plot all loaded rows by timestamp,
with independent scales and gaps for missing values. Hover, tap, or focus a chart
and use arrow keys to inspect readings. Table search does not filter the charts.
Timestamps use Europe/Warsaw; sensor values have no assumed units.
Connection errors and empty results have dedicated states.

The universal page loader fetches readings, ECG windows, and pulse samples
during initial server rendering and subsequent browser refreshes using the public
environment configuration. JavaScript is required for monitoring and model
analysis. The existing adapter-auto deployment setup is retained; static hosting
needs a separate adapter and SPA fallback configuration.

The page automatically refreshes every five seconds while open, including in a
background tab. Returning to the tab or resuming monitoring refreshes immediately.
Pause/Resume controls both refresh and automatic model analysis; active runs may
finish after pausing. Manual refresh requests one analysis pass even while paused.
Browser throttling or suspension can delay the five-second cadence. Failed refreshes
preserve the last successful charts, cards, table, count, and fetch timestamp.

With user approval, the `allow_public_sample_readings` migration granted SELECT
to `anon` and added a public read policy on the existing sample table. RLS remains
enabled. Applied SQL is recorded in `supabase/sample-read-access.sql`; do not
reapply it to this project.

Validate with `npm test`, `npm run check`, and `npm run build`. The chart-data
tests use Node.js's built-in TypeScript stripping (Node.js 22.18+).

## Continuous monitoring and coach’s notes

ECG and EMG run independently: each has one active analysis and one pending
snapshot, replaced by the latest fresh window. Unchanged completed windows are
skipped; manual refresh can explicitly rerun them. Model sessions are reused.
Failures retry after 5, 10, 20, 40, then at most 60 seconds; success resets backoff.
Pause prevents new runs and retries. All results stay in browser memory, and
monitoring ends when the dashboard closes. No notes are written to Supabase.

Coach’s notes include every ECG output with an independent sigmoid score ≥ 0.80,
except exactly `NORMAL SINUS RHYTHM`, `NORMAL ECG`, `SINUS RHYTHM`, and
`otherwise normal ecg`. There is no limit on qualifying labels and no dependence
on the overall `ABNORMAL ECG` score. ECG findings are sorted by descending score,
then original model index; all 150 scores remain available in the panel and JSON.
Fragments and comparison statements are shown literally as model outputs requiring
clinical context; the app does not compare recordings or reconstruct diagnoses.
These flags are unvalidated at the current 125 Hz input; ECGFounder expects 500 Hz.

Sensor fixes precede model findings, followed by sensor suggestions and positive
checks. Each model replaces its notes after successful completion. No qualifying
finding or successfully determined unavailable input clears its notes. Failures
and active replacement analysis retain previous findings with a stale label.
Notes preserve their original record range and Warsaw timestamps and highlight
only the overlap with the currently visible strip.

## Pulse frequency

Pulse frequency automatically uses `created_at` capture timestamps to estimate
BPM and Hz on the existing five-second/manual refresh. The sampling-rate picker
appears only when timestamps are missing, invalid, repeated, or run backwards
within the current continuous recording. In that case, enter the sensor’s actual
acquisition rate (10–1,000 Hz) and click **Apply**. The fallback rate is saved in
the `pulseSampleRate` URL parameter; valid timestamps always take priority over
that saved rate. The dedicated Pulse frequency panel below the session strip
shows Hz prominently alongside BPM, beat count, duration, timing source, and
record IDs. It follows live/manual refreshes and preserves the last successful
estimate with a stale label after failures. Raw pulse values remain in the
session strip and table.

The browser reads the latest ten seconds through paginated, snapshot-bounded
read-only requests, capped at 10,001 rows. Calculation uses the newest continuous
segment in record-ID order, ending at missing/nonfinite values or ID gaps.
Timestamp mode preserves microseconds and handles irregular sample spacing;
capture pauses longer than both one second and five median sample intervals
start a new segment. Sampling-rate fallback uses up to `ceil(10 × rate) + 1`
rows and assumes each consecutive row is one uniformly spaced sample.
Unmarked recording pauses cannot be detected in fallback mode.

The estimator uses a centered 40 ms moving average, a centered 1.5-second rolling
median baseline, and positive-going peaks with 20% percentile-range prominence
and 250 ms minimum separation. These windows and peak intervals use actual
elapsed capture time in timestamp mode. Window edges use the available samples. Flat peaks
use their midpoint; isolated peaks use quadratic interpolation to reduce timing
quantization at low sampling rates. Frequency is the reciprocal of the median
beat interval; BPM is 60 times that frequency.

At least five continuous seconds and three peaks are required. Flat signals,
estimates outside 30–240 BPM, or interval median absolute deviation above 30% of
the median produce an unavailable reason rather than a number. These are initial
engineering defaults, not calibrated clinical quality criteria. Pulse request
errors preserve the last successful estimate with a stale label and its original
sampling rate. An unavailable new recording clears the displayed estimate.

## ECGFounder ONNX analysis

The dashboard includes the supplied single-lead ECGFounder FP32 model using
ONNX Runtime Web 1.30.0, preferring WebGPU acceleration with WebAssembly (CPU)
for unsupported operators. If WebGPU is unavailable in the worker, or GPU session
initialization or inference fails, analysis retries using a separate CPU-only
WASM runtime. WebGL is skipped because its convolution implementation does not
support this model's 1D convolutions. GPU support requires a
WebGPU-capable browser and adapter on HTTPS or localhost. The bundled Asyncify
WASM/MJS assets support WebGPU; separate standard WASM/MJS assets support CPU
fallback with one thread, without requiring cross-origin isolation or CUDA.
Analysis runs in a dedicated
browser worker. ECG values come from the existing Supabase table, and inference
and results stay in the browser. The 118 MiB model downloads
on the first eligible automatic analysis, and the session is reused until failure or navigation.
Failures create a fresh worker for retry.

The browser loads up to 5,000 latest EKG rows (`id,created_at,ekg`) separately from
the dashboard's 100-row chart/table query. It pages through the existing Data API
in batches of up to 1,000, using descending IDs and the latest dashboard ID as
a fixed upper boundary. Missing values stay in this newest window, so ECG never
falls back to an older recording to fill it. Samples are then passed oldest to
newest by record ID for waveform analysis, as with pulse and EMG.
This handles the API's row limit and keeps new inserts from shifting pages.
Each dashboard refresh updates this window. Eligible fresh windows are analyzed
automatically; results retain their original record IDs when new data arrives.

If there are fewer than 5,000 usable database ECG samples, the panel
shows the available count and does not start inference or download the model.
Rows with null EKG values stay in the newest database window. Missing or nonfinite
values block analysis. This is a sample-count window, with no verified continuity
or sampling rate in the current schema.
There is no file picker, synthetic demo, padding, resampling, or fabricated data.
Database read errors are displayed separately from insufficient samples.
ECG acquisition and preprocessing are configured for lead I at 125 Hz (5,000
samples represent 40 seconds); the current database has no lead/sampling-rate
metadata to verify this. The model expects 500 Hz input, and the current pipeline
does not resample the 125 Hz recording to that rate.

Raw mode adapts the upstream `util.filter_bandpass` at source revision
`04edac702b61c91face519774ddcc0cd712fef23`: 50 Hz notch (Q=30), fourth-order
0.67–40 Hz Butterworth bandpass, forward/backward filtering with SciPy's default
odd padding, filters designed for 125 Hz, 51-sample zero-padded median baseline
removal (approximately 0.4 seconds, preserving the upstream window duration), then population
z-score with epsilon `1e-8`. Calculations use float64 and produce a float32 tensor
named `ecg` of shape `[1,1,5000]`.
Output `logits` has shape `[1,150]`; stable independent sigmoids are paired with
`tasks.txt` in its original order. The UI ranks scores for browsing, while JSON
exports retain the model label order, include logits and database record IDs,
and explicitly describe lead/sample rate as assumptions. Scores are uncalibrated
model outputs, not diagnoses. An engineering cutoff of 80% is used for coach notes;
it is not a validated clinical threshold.

The panel supports top-10/all-label views, label search, and JSON export.

Model assets, original MIT license, and the supplied export validation report are
under `static/models/ecgfounder/`. The model SHA-256 is
`f6cf5ef61399889d7dddb4ac28556729b4a7e56ec78ff824bcf2e8c7a42f95a7`.
Deployments must serve the 123,383,747-byte ONNX file and the bundled WASM/MJS
assets without rewriting them to HTML. Hosts with a per-file upload limit below
118 MiB need separate asset hosting and appropriate CORS configuration.

`npm test` checks database pagination and insufficient-data handling, waveform
rejection, label order, sigmoid stability, and complete
preprocessing parity against committed SciPy fixtures (including filter edges).
Fixtures can be regenerated using `tests/generate-ecg-reference.py` in a Python
environment with NumPy/SciPy; Python is not required to run the app or tests.

---

## Experimental EMG fatigue analysis

The EMG panel automatically analyzes fresh raw EMG from
`public.ekgemgpuls.emg`. This integration uses the supplied standardized logistic
regression classifier from `EMG_fatigue_detection`, upstream revision
`1825550c132de4fca2178a34ea9ce5db375a1de6`. The acquisition rate is configured as
**125 Hz**, as confirmed for this sensor. Each consecutive database row is
assumed to contain one uniformly spaced raw EMG sample.

Analysis is an **experimental, retrospective snapshot** of the latest continuous
recording, up to 7,500 samples (60 seconds). EMG is fetched for each eligible fresh snapshot,
using the dashboard's latest record ID as a fixed upper boundary. Read-only
requests page in descending-ID order, at most 1,000 rows per page, with a shared
30-second timeout. Null samples remain in the query. The newest segment ends at
missing/nonfinite EMG values, missing record IDs, or a forward timestamp gap
exceeding one second. Older segments are never stitched into the input.
Timestamps describe the recording and detectable pauses; they do not determine
the configured sample rate. Missing, repeated, or unreliable timestamps cannot
reveal otherwise unmarked capture pauses.

At least 1,250 continuous samples (10 seconds) and three detected repetitions
are required. Short, flat, or insufficient-repetition recordings report an
unavailable reason without fatigue scores. The model downloads only after those
checks pass. Preprocessing and inference run in a dedicated browser worker with
the app's existing ONNX Runtime Web 1.30.0 CPU WASM runtime and one thread.
The session is reused; navigation stops database loading and terminates the worker.
Automatic retry starts a fresh worker after errors. Results stay in browser memory.

The original model expects features from 20–450 Hz filtered EMG, which cannot be
reproduced at 125 Hz (Nyquist frequency 62.5 Hz). A separate
`experimental-125hz.json` profile uses a fourth-order 20–55 Hz Butterworth
bandpass, 50 Hz notch with Q=30, rectification, and fourth-order 5 Hz envelope.
Filtering uses float64 SciPy-compatible forward/backward filtering with odd
padding. Repetitions use two-second peak spacing and relative prominence 0.2,
midpoint boundaries, RMS, Welch median frequency, the first-three-repetition
baseline, first differences, and rolling means. All 24 features retain their
original order; sample indices and repetition duration remain actual sample
counts at 125 Hz. There is no resampling, retraining, amplitude calibration, or
replacement of classifier weights.

The original threshold is **0.58**, with fatigue triggered by **2 of the last 3**
scores at or above the threshold, including partial initial windows. Smoothing
is disabled. These scores and the trigger are **unvalidated at 125 Hz**:
reduced bandwidth, acquisition conditions, amplitude units, and sample-index
features differ from training. Engineering parity tests do not establish
fatigue-detection accuracy for this sensor. Moving the window resets repetition
numbering and baseline; a window can contain part of an exercise set.

The panel shows per-repetition scores, first trigger, record range, Warsaw
timestamps, and JSON export containing every feature, score, model hash,
preprocessing profile, and experimental status. Fresh readings automatically replace a
completed snapshot only when their analysis finishes. Loading and errors retain the
previous result with a stale label. Successful replacement with no trigger or unavailable data
clears its fatigue coach note. Coach notes identify the analyzed range and link
only the portion overlapping the currently visible signal strip.

Original model assets, metadata, MIT license, and upstream validation reports
are preserved under `static/models/emg-fatigue/`. The 692-byte model SHA-256 is
`4e15901646a835d4c7e54acb71c0e96e3df5ab946403ead8b5687e6ada3f5e5e`;
the worker verifies it against metadata before creating the inference session.
The supplied upstream reports describe the original pipeline, not the new
125 Hz profile. Deployments must serve the model, JSON profile, and worker
WASM/MJS assets as files rather than HTML fallbacks.

`npm test` includes EMG pagination and continuity, cancellation and retry,
snapshot provenance, coach notes and export, independent SciPy parity for the
125 Hz pipeline (including filter edges and all features), and real WASM model
parity against all 420 upstream reference rows. Probability error must be at
most `2e-6`, with matching threshold and per-session trigger decisions.
Regenerate the profile and DSP fixtures with `python tests/generate-emg-reference.py`
in an environment containing NumPy and SciPy. Python is unnecessary for running
the app or its tests. Also run `npm run check` and `npm run build`.

---

## Original scaffold instructions

Everything you need to build a Svelte project, powered by [`sv`](https://github.com/sveltejs/cli).

## Creating a project

If you're seeing this, you've probably already done this step. Congrats!

```sh
# create a new project
npx sv create my-app
```

To recreate this project with the same configuration:

```sh
# recreate this project
npx sv@1.0.1 create --template minimal --types ts --add tailwindcss="plugins:typography" ai-tools="ide:claude-code,cursor,opencode,vscode,other+delivery:plugin+tools:mcp,svelte-code-writer,svelte-core-bestpractices,svelte-file-editor+mcpSetup:remote" --install npm ./
```

## Adding features

Add features to your project with `sv add`:

```sh
npx sv add
```

For example, to add Tailwind CSS:

```sh
npx sv add tailwindcss
```

## Developing

Once you've created a project and installed dependencies with `npm install` (or `pnpm install` or `yarn`), start a development server:

```sh
npm run dev

# or start the server and open the app in a new browser tab
npm run dev -- --open
```

## Building

To create a production version of your app:

```sh
npm run build
```

You can preview the production build with `npm run preview`.

> To deploy your app, you may need to install an [adapter](https://svelte.dev/docs/kit/adapters) for your target environment.
