# Pocket G — Supabase sample

A small SvelteKit 3 + TypeScript viewer for `public.ekgemgpuls` in the
`hackyeah2026` Supabase project.

## Sample app setup

The local `.env` is configured. For a fresh checkout, copy `.env.example` to
`.env` and set your Supabase URL and publishable key. Never use a secret or
service-role key. Variables are declared in `src/env.ts` using SvelteKit 3's
explicit environment configuration.

Run `npm install`, then `npm run dev`.

The app loads the last 10 seconds of rows (about 1,250 at 125 Hz) directly
through the Supabase REST API. It displays latest sensor values and a
refresh button. Separate EKG, EMG, and pulse
charts plot all loaded rows by timestamp, with independent scales and gaps for
missing values. Raw EMG swings across the sensor's range from one sample to the
next, so its chart shows an activity envelope instead: the deviation from a
centered 1-second moving mean, as RMS over a centered 0.25-second window, scaled
from zero. The pulse chart shows beat-to-beat heart rate in BPM rather than the
raw sensor value. Hover, tap, or focus a chart and use arrow keys (about 0.1 s
per step, Page keys about 1 s) to inspect readings. Timestamps use
Europe/Warsaw; raw EKG, EMG, and pulse sensor values have no assumed units.
Connection errors and empty results have dedicated states.

The universal page loader fetches 12.5 seconds of readings in pages of up to
1,000 rows (the last page sized from the sample spacing so far), then the ECG
window, during initial server rendering and subsequent browser refreshes using
the public environment configuration. The same readings feed the charts
and pulse estimate; pulse samples are fetched separately only in sampling-rate
fallback mode. JavaScript is required for monitoring and model analysis.
The existing adapter-auto deployment setup is retained; static hosting needs a
separate adapter and SPA fallback configuration.

The page automatically refreshes every five seconds while open, including in a
background tab. Returning to the tab or resuming monitoring refreshes immediately.
Pause/Resume controls refresh and the gyro session. ECG and EMG analysis never
run automatically; they start only from **Analyze ECG** and **Analyze EMG**.
Browser throttling or suspension can delay the five-second cadence. Failed refreshes
preserve the last successful charts, cards, and fetch timestamp.

With user approval, the `allow_public_sample_readings` migration granted SELECT
to `anon` and added a public read policy on the existing sample table. RLS remains
enabled. Applied SQL is recorded in `supabase/sample-read-access.sql`; do not
reapply it to this project.

Validate with `npm test`, `npm run check`, and `npm run build`. The chart-data
tests use Node.js's built-in TypeScript stripping (Node.js 22.18+).

## Gyro movement energy

The movement energy section reads `public.readings` independently of the EKG,
EMG, and pulse loaders. The MPU6050 stores gyro axes in **degrees per second**:
every axis clips at exactly ±250, the sensor's default ±250 °/s range, and the
accelerometer at its default ±2 g. The loader converts gyro values to rad/s, so
every calculation below works in rad/s. Before this conversion, a 2 kg elbow
session read about 3,300 times too high and rest noise (~0.3 °/s) never fell
below the rest threshold, so sets never ended. Enter the mass moved in kg and
apply settings. The pivot toggle defaults to **Elbow — 35 cm** and also offers
**Shoulder — 65 cm** (30 cm upper arm plus 35 cm elbow-to-load). Both distances
can be overridden under Calculation settings. Switching pivots immediately
recalculates the entire session without clearing its samples or changing mass.

The estimate treats the load as a point mass moving in a circle with the gyro
rotating around the selected pivot: `K = 0.5 * mass * distance² * |gyro|²`.
Each gyro axis uses a causal exponential filter with a 0.25 s time constant and
actual `created_at` spacing; magnitudes below 0.05 rad/s count as rest. Positive
kinetic work is the sum of `max(0, K_next - K_previous)`, not a sum or time
integral of kinetic energy. Missing/nonfinite samples, invalid/repeated/backward
timestamps, ID gaps, and capture pauses over two seconds break segments. The
first sample in each segment sets the baseline and contributes no work.
Gravitational work and metabolic expenditure are excluded. These distance,
filter, and rest defaults are engineering assumptions, not calibrated measures
of exercise energy expenditure; noise above the threshold can still add work.

Initial loading includes all existing rows. Ascending-ID requests page in
batches of up to 1,000 under a fixed latest-ID boundary and a shared 30 s timeout,
without a silent row cap. Later refreshes load only rows after the committed
boundary. The panel follows the current dashboard refresh cadence (one second),
Pause/Resume, and manual Refresh now, including when physiological requests fail.
Incomplete loads never commit; errors preserve the last snapshot as stale.

**Reset energy session** fetches the current latest gyro ID, excludes readings
through that boundary, and clears the total in this tab. It issues only GET
requests and never deletes database rows. A failed reset preserves the session.
Settings, selected pivot, both distances, and reset boundary are stored in
`sessionStorage`; reloads re-fetch the same session's rows, while a new tab
starts with existing history. Blocked browser storage is reported explicitly.
Navigation aborts loading, and reset invalidates in-flight refreshes. Database
access permissions are unchanged by this feature.

## Workout insights and recording quality

**Rep consistency** appears above the EMG fatigue-score table for a completed
snapshot. It charts the seconds between consecutive detected EMG peaks, labeled
by rep pair, and requires at least three finite, strictly increasing peak times.
The median interval is the dashed reference line. Timing variation is the
population standard deviation divided by the mean interval, multiplied by 100;
lower variation means more consistent detected timing. Hover, tap, or focus a
bar to see its interval and percentage difference from the median. Numeric
values are also available in an expandable table. These are peak-to-peak times,
not measured movement phases or assessments of fatigue or technique. The chart
shares the EMG snapshot's record range and stale state; moving windows reset its
rep numbering.

**Energy by detected set** partitions the existing session's positive kinetic
work into movement sets. A set starts when smoothed gyro speed reaches 0.05 rad/s
and finishes after five continuous, recorded seconds below that threshold.
Shorter rests stay in the same set. The final unclosed set is Ongoing; invalid
samples, ID gaps, repeated/backward timestamps, and capture gaps over two seconds
end an open set as Interrupted. No new samples means no newly confirmed rest.
Set duration and bounds run from its first to last active sample, including
short pauses between them and excluding trailing rest. Sets beginning at a
loaded recording boundary can cover only part of an exercise set. This is an
engineering heuristic rather than verified exercise segmentation.

Each set receives the same positive energy increments used for the session
total, without resetting smoothing at normal set boundaries. Set work therefore
reconciles with the session total. Bars show joules, duration, and status, with
record ranges and Warsaw capture times in expandable details. Changing mass or
pivot recalculates work without changing detected boundaries. Reset clears sets
with the energy session; reload reconstructs them from the same saved tab-local
reset boundary. Constant-speed movement may form a zero-work set because the
estimate counts increases in kinetic energy, not the cost of sustaining motion.

**Recording quality**, in the right-hand column below the coach's notes,
examines the original fetched physiological rows before invalid timestamps are
excluded from charts. Its Loaded signal window usually covers about 12.5
seconds, while the strip remains
10 seconds; the actual loaded count and measurable capture span are shown.
Channel percentages count finite values out of loaded rows, with missing-sample
counts and longest missing runs. Details show invalid/non-increasing timestamps,
absent IDs, and capture pauses over the larger of one second or five median
positive consecutive sample intervals. Observed timing is derived from those
intervals and never changes an analysis model's assumed sampling rate.

Gyro session quality, below it, is calculated separately for the complete loaded gyro
session, even before mass is configured. It requires all three finite axes and
a valid timestamp, and uses the energy calculation's two-second gap limit.
Stationary gyro readings are valid. Usable duration includes only continuous
intervals with available endpoint values. ID gaps and timestamp pauses are
reported separately and may describe the same interruption. These indicators
describe data completeness and continuity, not sensor placement or clinical
signal quality. Last capture and last successful fetch times are shown
separately; failed refreshes retain the prior summary as stale, and pausing
monitoring is labeled independently. No additional database requests, models,
or persisted workout records are introduced by these features.

## Reps, exercise recognition and form checks

**Your reps** reads the same motion session as Movement energy, now including the
accelerometer (`acc_x/y/z`, in g). Sets are the ones in Energy by detected set, so
their numbers match. The forearm angle is the angle between the smoothed (0.4 s)
gravity direction and the rest just before the set. A rep is a rise and fall of at
least 30°, with tops at least 0.8 s apart, and it counts once the arm comes back
down. Range is the angle between the bottom and top of each rep. Up and down times
run between the points 5% of the range from the bottom, interpolated between
samples. At about 5 Hz, reps faster than about 1 s may be missed.

**Teaching:** press Start teaching, do 3–5 reps and press Save exercise. A template
stores the average bottom and top gravity directions, the main hinge axis (principal
axis of the gyro vectors) and median range, tempo, lifting speed and off-axis
rotation. Templates are saved in this browser's `localStorage`. A set with at least
2 reps is named after the closest template when both its start direction and its
hinge are within 35°; otherwise it shows Unknown movement. Range is not used for
recognition, so short reps are still recognised and then flagged. Directions are
relative to the strap, so wear the sensor the same way as when teaching.

**Form checks** compare each rep of a recognised set with its template: Short range
(under 80% of its range), Fast lowering (under 60% of its lowering time), Swing (peak
lifting speed over 150%, or an axis at the ±250 °/s sensor limit) and Twisting
(off-axis rotation more than 15 points above it). Coach's notes add one note per set,
with times only, because motion record IDs aren't strip IDs.

## Heart recovery and muscle activity per rep

The motion sensor and the EKG/EMG/pulse board keep separate clocks. **Motion clock
ahead by (s)** under Your reps › Calculation settings (saved in this browser) moves
motion times onto the pulse board's clock.

**Heart recovery** starts by itself when a set completes after the page has loaded,
at the set's last active sample, or from Start recovery now at the newest pulse
reading. It pages `id,created_at,puls` forward from that moment and reuses the pulse
estimator on 10-second windows: the first 10 s, then every 5 s, and the 55–65 s
window. When the board's timestamps run backwards inside a window, it is timed by
the same sampling rate as the heart-rate panel (1,800 Hz by default). Finished
windows are kept, so each is analysed once. The drop is the start minus the
one-minute heart rate, after rounding each to
whole BPM. An unclear pulse at either end gives the estimator's reason instead of a
number. The last five results stay in this tab.

**Muscle activity per rep** loads `id,created_at,emg` for a set's time range once
the set has ended. It averages the existing EMG activity envelope over each rep.
Each rep is shown as a percentage of the median of reps 1–3 in the same set, because
electrode placement changes EMG amplitude. Under 50% is tagged Low muscle activity.
A rep needs 80% of its expected 125 Hz samples. The angle chart overlays the EMG
envelope in blue, so a clock mismatch shows as bursts that don't line up with the
lifts.

## Model analysis and coach’s notes

ECG runs only when **Analyze ECG** is pressed, on the 10-second window shown at
that moment; **Cancel** stops a run and keeps the previous result. When newer
samples arrive, the panel says so until it is analyzed again.
EMG works the same way with **Analyze EMG**: it loads up to 60 continuous
seconds ending at the newest record shown when pressed, and **Cancel EMG
analysis** stops loading or inference. After a failure the button offers a retry.
Model sessions are reused. All results stay in browser memory and end when the
dashboard closes. No notes are written to Supabase.

Coach’s notes include every ECG output with an independent sigmoid score ≥ 0.80,
except exactly `NORMAL SINUS RHYTHM`, `NORMAL ECG`, `SINUS RHYTHM`, and
`otherwise normal ecg`. There is no limit on qualifying labels and no dependence
on the overall `ABNORMAL ECG` score. ECG findings are sorted by descending score,
then original model index; all 150 scores remain available in the panel and JSON.
Fragments and comparison statements are shown literally as model outputs requiring
clinical context; the app does not compare recordings or reconstruct diagnoses.
These flags are unvalidated: the 125 Hz recording is upsampled to ECGFounder's
500 Hz input, which keeps real timing but adds no detail above 62.5 Hz.

Sensor fixes precede model findings, followed by sensor suggestions and positive
checks. Each model replaces its notes after successful completion. No qualifying
finding or successfully determined unavailable input clears its notes. Failures
and active replacement analysis retain previous findings with a stale label.
Notes preserve their original record range and Warsaw timestamps and highlight
only the overlap with the currently visible strip.

## Pulse frequency

Pulse frequency automatically uses `created_at` capture timestamps to estimate
BPM and Hz on the existing five-second/manual refresh. When timestamps are
missing, invalid, repeated, or run backwards within the current continuous
recording, the board's known rate, **1,800 Hz**, times the pulse instead; valid
timestamps always take priority.

Since 2026-10-04 the EKG/EMG/pulse board samples at about 1,800 Hz (1,845–1,890
rows per second measured), and its timestamps run backwards because upload batches
overlap. Each 500-sample batch is stamped 0.5 ms apart, and rows from two batches
can interleave. Until the uploader stamps samples in order, pulse timing therefore
uses the sampling rate. The ECG model, EMG fatigue analysis and 12,501-row strip
loader still assume 125 Hz. The dedicated Pulse frequency panel beside the session heading
shows Hz prominently alongside BPM, beat count, duration, timing source, and
record IDs. It follows live/manual refreshes and preserves the last successful
estimate with a stale label after failures. Raw pulse values remain in the
table.

The estimate uses the latest ten seconds of the page's readings. In
sampling-rate fallback mode, the browser reads them through separate paginated,
snapshot-bounded read-only requests, up to `ceil(10 × rate) + 1` rows (18,001 at
1,800 Hz). The strip's own loader keeps its 1,000-rows-per-second cap, so a faster
board shows a shorter strip rather than a heavier refresh. Calculation uses the newest continuous
segment in record-ID order, ending at missing/nonfinite values or ID gaps.
Timestamp mode preserves microseconds and handles irregular sample spacing;
capture pauses longer than both one second and five median sample intervals
start a new segment. Sampling-rate fallback uses up to `ceil(10 × rate) + 1`
rows and assumes each consecutive row is one uniformly spaced sample.
Unmarked recording pauses cannot be detected in fallback mode.

Recordings at 500 Hz or more are first averaged in blocks down to about 250
samples per second; a pulse wave has nothing above about 10 Hz. Without this
step, the rolling median makes each estimate at 1,800 Hz take about half a second.
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

The session strip's pulse lane plots beat-to-beat heart rate from a 12.5-second
run of the same analysis, so the line reaches the strip's left edge: at each
record, 60 divided by the interval between the two most recent beats, held
until the next beat. Beats within 0.75 seconds (half the
baseline window) of either end of the analysis window are left out because the
one-sided baseline shifts their timing; the last kept rate holds until two
median intervals after the newest beat. Intervals more than 30% from the median
(likely missed or doubled beats) leave a gap. The lane has a minimum 30 BPM scale
so normal variation isn't magnified. It is empty until the estimate is ready.

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
on the first **Analyze ECG**, and the session is reused until failure or navigation.
Failures create a fresh worker for retry.

The browser loads the 1,250 latest EKG rows (`id,created_at,ekg`; 10 seconds at
125 Hz) separately from
the dashboard's 10-second chart/table query. It pages through the existing Data API
in batches of up to 1,000, using descending IDs and the latest dashboard ID as
a fixed upper boundary. Missing values stay in this newest window, so ECG never
falls back to an older recording to fill it. Samples are then passed oldest to
newest by record ID for waveform analysis, as with pulse and EMG.
This handles the API's row limit and keeps new inserts from shifting pages.
Each dashboard refresh updates this window. Results keep their original record
IDs when new data arrives.

If there are fewer than 1,250 usable database ECG samples, the panel
shows the available count and does not start inference or download the model.
Rows with null EKG values stay in the newest database window. Missing or nonfinite
values block analysis. This is a sample-count window, with no verified continuity
or sampling rate in the current schema.
There is no file picker, synthetic demo, or padding; missing samples are never
filled in.
Database read errors are displayed separately from insufficient samples.
ECG acquisition and preprocessing are configured for lead I at 125 Hz (1,250
samples represent 10 seconds); the current database has no lead/sampling-rate
metadata to verify this. The Pi can't record at the model's 500 Hz, so after
filtering at 125 Hz the window is upsampled 4x in the browser to the 5,000
samples (10 seconds at 500 Hz) the model expects. Earlier versions passed 5,000
samples (40 seconds) unresampled, which made the model see time 4x faster.

Raw mode adapts the upstream `util.filter_bandpass` at source revision
`04edac702b61c91face519774ddcc0cd712fef23`: 50 Hz notch (Q=30), fourth-order
0.67–40 Hz Butterworth bandpass, forward/backward filtering with SciPy's default
odd padding, filters designed for 125 Hz, 51-sample zero-padded median baseline
removal (approximately 0.4 seconds, preserving the upstream window duration), then population
z-score with epsilon `1e-8`. The 1,250 prepared samples are then upsampled 4x with
Lanczos (a = 4) windowed-sinc interpolation, keeping every original sample and
repeating the end samples at the edges, and z-scored again. Calculations use
float64 and produce a float32 tensor named `ecg` of shape `[1,1,5000]`.
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

The EMG panel analyzes raw EMG, when **Analyze EMG** is pressed, from
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
Retrying after an error starts a fresh worker. Results stay in browser memory.

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
preprocessing profile, and experimental status. A new analysis replaces the
completed snapshot only when it finishes. Loading and errors retain the
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
