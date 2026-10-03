# ONNX model fit review

Reviewed 4 October 2026. Scope: the two bundled models, their TypeScript preprocessing and browser inference paths, and published replacement candidates. This is an engineering fit assessment; no candidate was benchmarked on Pocket G recordings.

## Current configuration: raw acquisition at 2,000 Hz

The user reports 2,000 Hz acquisition and removal of the sensor's ECG digital
filter. The frontend has now been migrated to that contract. Earlier sections
below describe the previous 125 Hz script and are historical findings.

- ECG: 20,000 raw capture samples over ten seconds, anti-aliased 4:1 decimation
  to ECGFounder's 5,000 samples at 500 Hz, then model-rate filtering and normalization.
- EMG: 20,000–120,000 raw samples over 10–60 seconds using the original
  2,000 Hz/20–450 Hz coefficients already supplied in model metadata. Weights,
  feature order and trigger settings are unchanged.
- Both pipelines check consecutive IDs and microsecond capture timestamps,
  reject non-increasing times and gaps above 2.5 ms, and require the average
  rate to be within 20% of 2,000 Hz. Historical 125 Hz and mixed windows cannot
  pass these checks. These are engineering tolerances, not proof of lossless capture.
- Dashboard row limits and pulse fallback now support 2,000 Hz. ECG reuses the
  shared dashboard fetch where possible, reducing duplicate pagination.
- Independent SciPy fixtures cover preprocessing and anti-aliasing; the
  unchanged EMG ONNX model is checked against 420 upstream inference cases.

**Recommendation:** retain the current EMG weights for evaluation now that the
sampling rate matches an upstream profile. Keep ECGFounder as a baseline;
HeartKIT remains a smaller candidate if the job is focused rhythm/beat/quality
classification rather than 150 broad ECG labels. Neither replacement nor the
current model has been validated on this BioAmp/MCP3008 setup.

Actual sustained per-channel timing, analog filter configuration, gain, reference
voltage, electrode placement and labeled exercise performance remain unverified.
At the original batch size of 50, 2,000 rows/second would target about 40 inserts
per second. The original uploader and deadline catch-up loop still warrant
measurement and revision; the capture script was supplied in chat and was not
installed or executed by this task. No Supabase schema or policies were changed.

## Historical 125 Hz acquisition review

Hardware confirmed by the user: **BioAmp EXG Pill with MCP3008** for ECG and EMG. The Pill is an analog front end with configurable gain/bandpass; its software examples distinguish EMG filtering and envelope extraction. The MCP3008 is a 10-bit, eight-input SPI ADC, rated up to 200 kSPS under specified operating conditions. That is converter throughput, not a guaranteed per-channel rate from the application's acquisition loop. Neither component imposes the app's 125 Hz assumption. The supplied Python capture code confirms a target of 125 samples/second per channel and raw EMG storage; measured timing, analog filter configuration, gain/reference voltage and electrode placement remain unverified. [BioAmp documentation](https://docs.upsidedownlabs.tech/hardware/bioamp/bioamp-exg-pill/), [MCP3008 datasheet](https://ww1.microchip.com/downloads/aemDocuments/documents/MSLD/ProductDocuments/DataSheets/MCP3004-MCP3008-Data-Sheet-DS20001295.pdf)

If acquisition is faster and the database contains decimated samples or envelopes, revisit the raw-bandwidth assessment using the acquisition/decimation pipeline. Increasing ADC rate alone is insufficient if the analog front end remains configured for a narrow passband. Electrode placement must also be confirmed before treating ECG as lead I.

This hardware makes higher-rate acquisition a plausible option without replacing the ADC: target 500 Hz per ECG channel for ECGFounder's native input and 2 kHz per raw EMG channel to align with the original fatigue study, subject to measured timing, analog bandwidth and anti-aliasing. These rates improve input compatibility, not establish model accuracy. The current supplied script retains only 125 Hz raw EMG, so the original model-fit findings apply. The capture script was supplied in chat and was not executed or installed on the acquisition device.

## Findings from the supplied acquisition script

| Channel | Saved value | Implication |
|---|---|---|
| EMG, MCP3008 channel 0 | `round(emg_adc.value * 1023)` | Raw ADC counts; no digital envelope extraction or pre-storage downsampling in this script. |
| Pulse, channel 1 | `round(puls_adc.value * 1023)` | Raw ADC counts. |
| ECG, channel 7 | `round(ecg_filter.process(ekg_raw)) + 512` | Causally bandpass-filtered and rounded ECG with a constant offset; not raw ECG and not normalized to −1…1. |

The acquisition loop targets one row every 8 ms, reading all three channels sequentially. This is 125 samples/second **per channel**, not a 125-sample aggregate divided among three inputs. The timestamp precedes all three reads, so it is a shared approximate capture timestamp rather than a separate time for each ADC conversion. GPIO Zero documents `.value` as a current ADC reading scaled to 0–1. [ADC API](https://gpiozero.readthedocs.io/en/stable/api_spi.html#gpiozero.MCP3008)

The ECG filter is described by the script as a fourth-order 0.5–44.5 Hz Butterworth bandpass at 125 Hz, implemented in four second-order sections. The browser then applies a 50 Hz notch, 0.67–40 Hz bandpass and median baseline removal again. This combined causal/offline processing differs from treating the database values as raw ECG. Preserve raw ECG for model-specific preprocessing where possible, and record the capture filter/version; do not simply bypass all browser preprocessing because standardization and resampling are separate requirements. Rounding the filtered output introduces an additional quantization step. The `+512` offset does not impose a bounded output range, and the code does not clip it.

The deadline accumulator runs continuously without sleep. After a stall it remains negative and triggers closely spaced new ADC reads until it catches up; those are not recovered historical samples. Per-sample console printing can introduce stalls, and uniform-rate filtering/model input assumptions become less reliable during catch-up. A revised capture loop should measure actual per-channel timing, count missed deadlines and mark gaps rather than simulate regular sampling through catch-up reads.

The uploader runs separately and normally batches 50 rows (about 0.4 s). `queue.Queue()` is unbounded, while `batch[-5000:]` caps only the uploader's local batch. Repeated upload failures can discard older rows; database-generated IDs do not identify those pre-insert losses. Add a capture sequence number and explicit loss accounting when revising acquisition. These are code-path findings, not evidence that losses occurred in a particular recording.

Do not increase `SAMPLE_RATE` alone: the ECG coefficients are fixed for 125 Hz, and the browser's filters, sample counts, EMG profile and model contracts also assume that rate. Higher-rate capture needs coordinated filter redesign, buffering, timing validation and storage/model integration.

## Recommendation

For the workout dashboard, evaluate **HeartKIT SEG-2-TCN-SM plus ARR-2-EFF-SM** first: QRS/heart-rate measurement and a narrowly scoped rhythm output match the available single-channel signal better than 150 diagnostic labels. These are conversion candidates, not verified ONNX replacements. If a shipped ONNX artifact is a requirement, evaluate **OpenECG codec_v6_int8.onnx** instead, using anti-aliased 2,000→500 Hz decimation and its own preprocessing.

For EMG, retain the supplied logistic model for evaluation with its original 2,000 Hz filter profile. I did not identify a verified alternative ONNX fatigue checkpoint trained on this BioAmp/MCP3008 setup. If sensor-specific evaluation fails, a small classifier trained on labeled recordings from this sensor is the strongest replacement direction.

The frontend preprocessing, windows, continuity checks and descriptions have been updated; both bundled ONNX weight files are unchanged.

## Current models

| Model | Local contract | Fit assessment |
|---|---|---|
| ECGFounder single-lead FP32 | 123,383,747 bytes (117.67 MiB); 30,807,750 parameters; float32 `ecg [1,1,5000]` → `logits [1,150]`; 10 seconds at 500 Hz | Useful broad research baseline, expensive for browser delivery and broader than workout monitoring needs. |
| EMG standardized logistic regression | 692 bytes; float32 `features [N,24]` → `fatigue_probability [N,1]`; threshold 0.58, 2-of-3 trigger | Already extremely small. The problem is feature/domain mismatch, not inference cost. |

Both local SHA-256 hashes match the committed metadata/reports. ECG: `f6cf5ef61399889d7dddb4ac28556729b4a7e56ec78ff824bcf2e8c7a42f95a7`. EMG: `4e15901646a835d4c7e54acb71c0e96e3df5ab946403ead8b5687e6ada3f5e5e`.

### ECG findings before migration

- `src/lib/ecg.ts` assumes 125 Hz and lead I. The preprocessing filters to 0.67–40 Hz, removes a median baseline, standardizes, upsamples fourfold and standardizes again. Matching the tensor length preserves timing under the sampling assumption; it does not establish accuracy on this recording domain.
- `src/lib/ecg-database.ts` accepts the newest 1,250 finite samples without checking ID gaps, monotonic capture times or elapsed duration. An interrupted recording can therefore be presented as a continuous ten-second input. Fix this before comparing model accuracy.
- `src/lib/ecg-coach.ts` sends every non-normal output scoring at least 0.80 to coach notes. The bundled labels include infarct/axis labels and fragments referring to previous recordings. Their presence is a task-fit concern even if model export is numerically correct.
- The committed export report validates three synthetic inputs on CPU and explicitly excludes clinical validation and browser benchmarks. It establishes export fidelity, not sensor accuracy.

Local evidence: `static/models/ecgfounder/validation_report.json`, `static/models/ecgfounder/tasks.txt`, `src/lib/ecg-preprocessing.ts`, `src/lib/ecg-runtime.ts`, `src/lib/ecg.worker.ts`.

### EMG findings before migration

The original project describes 2,000 Hz biceps recordings and a 20–450 Hz bandpass. Pocket G instead uses 125 Hz and a separate 20–55 Hz profile with unchanged classifier weights. Its Nyquist frequency is 62.5 Hz; interpolation cannot recover the original spectrum. [Upstream method](https://github.com/muqsitamir/EMG_fatigue_detection)

The 24 inputs include raw amplitudes, median frequency, repetition number, sample indices and repetition duration in samples. At 125 Hz a two-second repetition has about 250 samples, versus 4,000 at 2,000 Hz. The changed physical meaning of those inputs is not corrected by retaining their order. Timing/repetition features also create a shortcut-learning risk that needs ablation testing; this review did not inspect fitted coefficient importance.

The moving 60-second window resets repetition numbering and its first-three-repetition baseline. A window beginning midway through a set can redefine already fatigued activity as the baseline. Upstream parity fixtures confirm reproduction of supplied probabilities, not fatigue accuracy for this sensor.

Local evidence: `static/models/emg-fatigue/metadata.json`, `experimental-125hz.json`, `upstream-validation.json`, `src/lib/emg-preprocessing.ts`, `src/lib/emg-readings.ts`, `src/lib/emg-prediction.ts`.

## ECG shortlist

| Candidate | Published input and task | Delivery | Decision |
|---|---|---|---|
| HeartKIT SEG-2-TCN-SM | 100 Hz, 2.5 seconds; QRS versus background; about 2K parameters | Keras/TFLite downloads | First choice for beat timing and ECG-derived heart rate. Requires ONNX conversion and waveform/postprocessing parity. |
| HeartKIT ARR-2-EFF-SM | 100 Hz, 5 seconds; NSR versus grouped AFIB/AFL; about 18K parameters | Keras/TFLite downloads | First rhythm candidate when a narrow output is sufficient. A binary model does not recognize every possible abnormal rhythm or noise. |
| HeartKIT ARR-4-EFF-SM | 100 Hz, 5 seconds; sinus rhythm, bradycardia, AFIB/AFL, grouped tachycardia/SVT | Keras/TFLite downloads | Broader alternative. Its tachycardia grouping needs particular care during exercise. |
| OpenECG codec_v6 | Single lead, 500 Hz, 10 seconds; frame, beat and rhythm heads; about 1.16M parameters | Published dynamic-int8 ONNX, approximately 3.8 MB | Best identified candidate with an existing ONNX artifact and broader structured outputs. Requires anti-aliased 2,000→500 Hz decimation, its own normalization and runtime testing. |
| CLEF-Small | Single-lead representation encoder; 448K parameters; quickstart uses 5,000 samples and returns 256 features | PyTorch checkpoint | Research/training option: add a task head, verify preprocessing and export. Not a ready diagnostic classifier. |
| MIT-BIH legacy ResNet-1D + RR | MLII, 360 Hz; 180-sample beat windows plus two RR features; normal/PVC/PAC | ONNX export, about 2.2 MB | Lower-priority beat-classification baseline. Lead mismatch and weak PAC results make it a poor default here. |

HeartKIT's published configurations need 2,000→100 Hz downsampling from the updated capture stream with an appropriate anti-alias filter; reproduce each model's own normalization instead of copying ECGFounder's preprocessing. Download size after ONNX conversion is unknown. Its published F1 values are not Pocket G measurements. [Segmentation model](https://ambiqai.github.io/heartkit/zoo/seg-2-tcn-sm/), [binary rhythm model](https://ambiqai.github.io/heartkit/zoo/arr-2-eff-sm/), [four-class model](https://ambiqai.github.io/heartkit/zoo/arr-4-eff-sm/)

OpenECG's model card specifies `signal [B,5000]` with rank normalization and three per-sample logit outputs. It evaluates rhythm across cohorts, but notes weak/unverified classes and lead-II limitations. Exclude the outer two seconds when following its streaming evaluation convention. The README also describes a separate 250 Hz TFLite delineator; that is not the 500 Hz ONNX codec. [Codec model card](https://github.com/vitaldb/openecg/blob/main/openecg/models/codec_v6_MODEL_CARD.md), [pipeline documentation](https://github.com/vitaldb/openecg)

CLEF-Small offers a compact encoder, but reported aggregate gains in the project are not evidence that its smallest model beats ECGFounder on this device. [Model sizes](https://github.com/Nokia-Bell-Labs/ecg-foundation-model), [representation example](https://github.com/Nokia-Bell-Labs/ecg-foundation-model/blob/main/notebooks/clef_quickstart.ipynb)

The legacy MIT-BIH ResNet reports PAC F1 of 0.156 and training on MLII rather than lead I. Its newer AAMI five-class architecture should not be confused with a validated, higher-quality shipped checkpoint. [Model card](https://github.com/TenzinDhonyoe/ecg-arrhythmia-mitbih-pvc-pac-classifier/blob/main/docs/MODEL_CARD.md)

## EMG replacement direction

1. Confirm the analog front end: raw EMG versus rectified/smoothed envelope, analog filtering, actual acquisition rate and amplitude calibration. A 125 Hz envelope stream can support activity tracking, but should not be treated as a raw 20–450 Hz waveform. Without suitable analog anti-aliasing, raw recordings may also contain aliasing.
2. If raw spectral fatigue is the goal, acquire at least 1 kHz with appropriate analog filtering for a 450 Hz upper band, or match the original 2 kHz setup. Retrain/calibrate on the actual hardware and exercises.
3. If 125 Hz is fixed, train an amplitude/activity and movement-based fatigue proxy using this sensor and explicit fatigue-onset labels. Start with regularized logistic regression or a small boosted-tree model. Use normalized amplitude/trend features, durations in seconds, and consistent set boundaries. Avoid treating a narrow-band MDF as interchangeable with full-band MDF.
4. Evaluate on held-out participants, with complete sessions confined to one split. Compare onset error in repetitions, missed onsets and false triggers per set. Ablate repetition/time features to check whether predictions follow elapsed set length rather than measured fatigue.

These are proposed models to train, not downloadable pretrained replacements with established accuracy.

## Requirements before switching

- Confirm lead placement, input type and sampling timing; reject discontinuous ECG windows and improve timestamp validation for EMG.
- Pin candidate versions, verify download hashes and artifact redistribution terms. Existing models are MIT; candidate repository licenses include HeartKIT BSD-3-Clause, OpenECG Apache-2.0 and CLEF BSD-3-Clause-Clear. Verify checkpoint-specific terms before bundling.
- Match preprocessing, tensor layouts and output activation. The current 150 independent sigmoids and fixed EMG metadata checks cannot be reused unchanged for different heads.
- Prove conversion parity and execution with ONNX Runtime Web 1.30.0, including CPU WASM. Native Python ONNX support does not establish browser support, especially for quantized operators.
- Benchmark cold download/session creation, warm inference and memory on target phones/laptops. Compare on labeled recordings from this sensor, including motion and electrode noise, before claiming improved accuracy.
- Keep results tied to record ranges and stale/cancellation state. Select output-specific thresholds using held-out data rather than inheriting 0.80 or 0.58.

No new inference tests were run because this change is documentation only. Candidate weights were not downloaded or executed. HeartKIT's linked configuration/metrics files could not be inspected: the web reader rejected their content type and the shell could not resolve the asset host. Therefore normalization details, measured artifact sizes and browser compatibility remain open checks.
