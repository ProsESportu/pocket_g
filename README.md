# Pocket G — Supabase sample

A small SvelteKit 3 + TypeScript viewer for `public.ekgemgpuls` in the
`hackyeah2026` Supabase project.

## Sample app setup

The local `.env` is configured. For a fresh checkout, copy `.env.example` to
`.env` and set your Supabase URL and publishable key. Never use a secret or
service-role key. Variables are declared in `src/env.ts` using SvelteKit 3's
explicit environment configuration.

Run `npm install`, then `npm run dev`.

The app loads the latest 100 rows through the Supabase REST API on the server.
It displays latest sensor values, an exact accessible row count, a searchable
table with 20 rows per page, and a refresh button. Search applies to the loaded
100 rows. Separate EKG, EMG, and pulse charts plot all loaded rows by timestamp,
with independent scales and gaps for missing values. Hover, tap, or focus a chart
and use arrow keys to inspect readings. Table search does not filter the charts.
Timestamps use Europe/Warsaw; sensor values have no assumed units.
Connection errors and empty results have dedicated states.

The page automatically refreshes every five seconds while visible. Pause/Resume
controls automatic refresh; manual refresh remains available. Failed refreshes
preserve the last successful charts, cards, table, count, and fetch timestamp.

With user approval, the `allow_public_sample_readings` migration granted SELECT
to `anon` and added a public read policy on the existing sample table. RLS remains
enabled. Applied SQL is recorded in `supabase/sample-read-access.sql`; do not
reapply it to this project.

Validate with `npm test`, `npm run check`, and `npm run build`. The chart-data
tests use Node.js's built-in TypeScript stripping (Node.js 22.18+).

## Pulse frequency

Pulse frequency automatically uses `created_at` capture timestamps to estimate
BPM and Hz on the existing five-second/manual refresh. The sampling-rate picker
appears only when timestamps are missing, invalid, repeated, or run backwards
within the current continuous recording. In that case, enter the sensor’s actual
acquisition rate (10–1,000 Hz) and click **Apply**. The fallback rate is saved in
the `pulseSampleRate` URL parameter; valid timestamps always take priority over
that saved rate. Raw pulse values remain in the chart and table.

The server reads the latest ten seconds through paginated, snapshot-bounded
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
ONNX Runtime Web 1.30.0 and its WebAssembly backend. Analysis runs in a dedicated
browser worker. ECG values come from the existing Supabase table, and inference
and results stay in the browser. The 118 MiB model downloads
on the first analysis, and the session is reused until cancellation or navigation.
Cancel terminates the worker; retry creates a fresh worker.

The server loads up to 5,000 latest nonempty EKG rows (`id,created_at,ekg`) separately from
the dashboard's 100-row chart/table query. It pages through the existing Data API
in batches of up to 1,000, using descending IDs and the latest dashboard ID as
a fixed upper boundary. Samples are then passed oldest to newest by record ID.
This handles the API's row limit and keeps new inserts from shifting pages.
Each dashboard refresh updates this window. Click **Analyze ECG** to run the
current window; results retain their original record IDs when new data arrives.

If there are fewer than 5,000 usable database ECG samples, the panel
shows the available count and does not start inference or download the model.
Rows with null EKG values are skipped by the database query. Nonfinite returned
values block analysis. This is a sample-count window, with no verified continuity
or sampling rate in the current schema.
There is no file picker, synthetic demo, padding, resampling, or fabricated data.
Database read errors are displayed separately from insufficient samples.
The model assumes lead I at 500 Hz (5,000 samples represent 10 seconds at that
rate); the current database has no lead/sampling-rate metadata to verify this.

Raw mode follows the upstream `util.filter_bandpass` at source revision
`04edac702b61c91face519774ddcc0cd712fef23`: 50 Hz notch (Q=30), fourth-order
0.67–40 Hz Butterworth bandpass, forward/backward filtering with SciPy's default
odd padding, 201-sample zero-padded median baseline removal, then population
z-score with epsilon `1e-8`. Calculations use float64 and produce a float32 tensor
named `ecg` of shape `[1,1,5000]`.
Output `logits` has shape `[1,150]`; stable independent sigmoids are paired with
`tasks.txt` in its original order. The UI ranks scores for browsing, while JSON
exports retain the model label order, include logits and database record IDs,
and explicitly describe lead/sample rate as assumptions. Scores are uncalibrated
model outputs; no diagnosis or decision threshold is applied.

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
