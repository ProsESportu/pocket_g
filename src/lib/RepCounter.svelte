<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import * as env from '$app/env/public';
	import { Trash2 } from '@lucide/svelte';
	import type { ImuReading } from './gyro-energy.ts';
	import { displayedSet, REPS, type RepSet } from './reps.ts';
	import { buildTemplate, EXERCISE_STORAGE_KEY, EXERCISES, FLAG_LABEL, FORM, restoreExercises, serializeExercises,
		type ExerciseTemplate, type SetAssessment } from './exercises.ts';
	import { gyroRecordingQuality } from './recording-quality.ts';
	import { loadSetEmg, muscleByRep, REP_EMG, setEmgWindow, type SetMuscle } from './rep-emg.ts';

	let { readings, sets, assessments, templates = $bindable([]), offsetSeconds = $bindable(0), muscle = $bindable(null) }: {
		readings: readonly ImuReading[]; sets: readonly RepSet[]; assessments: readonly SetAssessment[];
		templates?: ExerciseTemplate[]; offsetSeconds?: number; muscle?: SetMuscle | null;
	} = $props();
	const OFFSET_STORAGE_KEY = 'pocket-g:clock-offset:v1';
	const uid = $props.id();
	const HEIGHT = 180;
	const STATUS = { ongoing: 'Ongoing', completed: 'Completed', interrupted: 'Interrupted' } as const;

	let shown = $derived(displayedSet(sets));
	let assessment = $derived(shown ? assessments.find((item) => item.set === shown.set) ?? null : null);
	let checks = $derived(new Map(assessment?.checks.map((check) => [check.rep, check]) ?? []));
	// A newer set that is moving but hasn't counted a rep yet doesn't take over the panel.
	let moving = $derived(sets.at(-1)?.status === 'ongoing' && sets.at(-1) !== shown);
	let rate = $derived(gyroRecordingQuality(readings).observedRateHz);
	let earlier = $derived(sets.filter((set) => set !== shown && set.reps.length).toReversed().slice(0, 5));
	let selectedRep = $state<number | null>(null);
	let selected = $derived(shown?.reps.find((rep) => rep.rep === selectedRep) ?? shown?.reps.at(-1) ?? null);
	let clean = $derived(assessment?.checks.filter((check) => !check.flags.length).length ?? 0);
	// Muscle activity per rep, loaded once a set has ended, for the offset it was loaded with.
	let shownMuscle = $derived(shown && muscle?.firstRecordId === shown.firstRecordId && muscle.offsetSeconds === offsetSeconds && muscle.reps.length === shown.reps.length ? muscle : null);
	let muscleByNumber = $derived(new Map(shownMuscle?.reps.map((rep) => [rep.rep, rep]) ?? []));
	let readout = $derived.by(() => {
		if (!selected) return null;
		const percent = muscleByNumber.get(selected.rep)?.percent;
		const shortfall = checks.get(selected.rep)?.rangeShortDeg ?? 0;
		return {
			rep: selected.rep,
			text: `${number(selected.rangeDeg)}° range · up ${number(selected.upSeconds, 1)} s · down ${number(selected.downSeconds, 1)} s${percent == null ? '' : ` · muscle ${number(percent)}%`}`,
			alerts: tags(selected.rep).map((tag) => tag === FLAG_LABEL.range ? `${tag} (−${number(shortfall)}°)` : tag)
		};
	});
	let emgKey = $derived(shown && shown.status !== 'ongoing' ? `${shown.firstRecordId}:${shown.reps.length}:${offsetSeconds}` : null);
	let emgBusy = $state(false);
	let emgError = $state('');
	let loadedKey = '';
	let emgAborter: AbortController | null = null;

	let width = $state(640);
	let chart = $derived.by(() => {
		const trace = shown?.trace ?? [];
		if (!shown || trace.length < 2) return null;
		const [start, end] = [trace[0].seconds, trace.at(-1)!.seconds];
		const x = (seconds: number) => 8 + (seconds - start) / (end - start || 1) * (width - 16);
		const y = (deg: number) => HEIGHT - 16 - Math.min(deg, 180) / 180 * (HEIGHT - 32);
		return {
			path: trace.map((point, i) => `${i ? 'L' : 'M'}${x(point.seconds).toFixed(1)},${y(point.deg).toFixed(1)}`).join(' '),
			tops: shown.reps.map((rep) => ({ rep: rep.rep, x: x(rep.topSeconds), y: y(rep.topDeg), flagged: tags(rep.rep).length > 0 })),
			grid: [0, 90, 180].map((deg) => ({ deg, y: y(deg) })), span: end - Math.max(start, 0),
			// EMG activity fills the lower part of the plot, scaled to its own peak.
			band: emgBand(shownMuscle?.trace.filter((point) => point.seconds >= start && point.seconds <= end) ?? [], x)
		};
	});

	let nameInput = $state('Bicep curl');
	let teaching = $state<{ name: string; afterId: number } | null>(null);
	let teachMessage = $state('');
	let storageError = $state('');
	let offsetInput = $state<number | undefined>(0);
	let offsetError = $state('');
	let teachReps = $derived(teaching ? sets.flatMap((set) => set.reps).filter((rep) => rep.firstRecordId > teaching!.afterId) : []);

	const number = (value: number, digits = 0) => new Intl.NumberFormat('en-GB', { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(value);
	const time = (value: string) => new Intl.DateTimeFormat('en-GB', { timeStyle: 'medium', timeZone: 'Europe/Warsaw' }).format(new Date(value));
	const flags = (rep: number) => checks.get(rep)?.flags ?? [];
	const tags = (rep: number) => [...flags(rep).map((flag) => FLAG_LABEL[flag]), ...(muscleByNumber.get(rep)?.low ? ['Low muscle activity'] : [])];
	function emgBand(points: { seconds: number; activity: number }[], x: (seconds: number) => number) {
		if (points.length < 2) return '';
		const peak = Math.max(...points.map((point) => point.activity)) || 1, floor = HEIGHT - 16, depth = (HEIGHT - 32) * 0.45;
		return `M${x(points[0].seconds).toFixed(1)},${floor} ${points.map((point) => `L${x(point.seconds).toFixed(1)},${(floor - point.activity / peak * depth).toFixed(1)}`).join(' ')} L${x(points.at(-1)!.seconds).toFixed(1)},${floor} Z`;
	}

	async function loadEmg(set: RepSet, offset: number) {
		if (!env.PUBLIC_SUPABASE_URL || !env.PUBLIC_SUPABASE_PUBLISHABLE_KEY) return;
		emgAborter?.abort();
		const aborter = emgAborter = new AbortController();
		emgBusy = true;
		emgError = '';
		try {
			const { from, to } = setEmgWindow(set, offset);
			const rows = await loadSetEmg(fetch, env.PUBLIC_SUPABASE_URL, env.PUBLIC_SUPABASE_PUBLISHABLE_KEY, from, to, aborter.signal);
			if (aborter === emgAborter) muscle = muscleByRep(set, rows, offset);
		} catch (error) {
			if (aborter !== emgAborter) return;
			emgError = error instanceof Error && error.name !== 'AbortError' && error.name !== 'TimeoutError' ? error.message : 'Could not load EMG for this set.';
			loadedKey = '';
		} finally {
			if (aborter === emgAborter) emgBusy = false;
		}
	}
	function syncEmg() {
		const key = emgKey, set = shown, offset = offsetSeconds;
		untrack(() => {
			if (!key || !set || key === loadedKey) return;
			loadedKey = key;
			void loadEmg(set, offset);
		});
	}
	$effect(syncEmg);

	onMount(() => {
		try {
			templates = restoreExercises(localStorage.getItem(EXERCISE_STORAGE_KEY));
			const saved = Number(localStorage.getItem(OFFSET_STORAGE_KEY) ?? 0);
			if (Number.isFinite(saved) && Math.abs(saved) <= 600) offsetSeconds = offsetInput = saved;
		}
		catch { storageError = 'Browser storage is blocked, so taught exercises last only until you reload.'; }
	});
	function applyOffset() {
		if (typeof offsetInput !== 'number' || !Number.isFinite(offsetInput) || Math.abs(offsetInput) > 600) { offsetError = 'Enter a number of seconds between −600 and 600.'; return; }
		offsetSeconds = offsetInput;
		offsetError = '';
		try { localStorage.setItem(OFFSET_STORAGE_KEY, String(offsetInput)); } catch { /* the offset still applies until reload */ }
	}
	function persist(next: ExerciseTemplate[]) {
		templates = next;
		try { localStorage.setItem(EXERCISE_STORAGE_KEY, serializeExercises(next)); storageError = ''; }
		catch { storageError = 'Browser storage is blocked, so taught exercises last only until you reload.'; }
	}
	function startTeaching(event: SubmitEvent) {
		event.preventDefault();
		if (!nameInput.trim()) { teachMessage = 'Give the exercise a name.'; return; }
		teaching = { name: nameInput.trim(), afterId: readings.at(-1)?.id ?? 0 };
		teachMessage = '';
	}
	function saveTeaching() {
		if (!teaching) return;
		const template = buildTemplate(teaching.name, teachReps);
		if (typeof template === 'string') { teachMessage = template; return; }
		persist([...templates.filter((item) => item.name.toLowerCase() !== template.name.toLowerCase()), template]);
		teachMessage = `Saved ${template.name} from ${template.reps} reps.`;
		teaching = null;
	}
</script>

{#snippet muscleCell(rep: number)}
	{@const value = muscleByNumber.get(rep)}
	{#if !shownMuscle}–{:else if value?.percent == null}No EMG{:else}<span class={value.low ? 'text-lime' : ''}>{number(value.percent)}%{value.low ? ' · low' : ''}</span>{/if}
{/snippet}

<section class="min-w-0" aria-labelledby={`${uid}-title`}>
	<div class="flex flex-wrap items-baseline gap-x-4 gap-y-2">
		<h2 id={`${uid}-title`} class="display text-[28px] md:text-[32px]"><span class="text-lime">Your</span> <span class="outline-text">reps</span></h2>
		<span class="label border border-lime px-2 py-1 text-lime">Motion{rate ? ` · ${number(rate)} Hz` : ''}</span>
	</div>
	<p class="mt-3 text-[15px] leading-relaxed text-muted">Reps, range and tempo from the forearm motion sensor. Teach an exercise once and later reps are named and compared with it.</p>
	<div class="relative mt-5 border border-rule bg-night p-5 md:p-6">
		{#if shown}
			<p class="label text-lime">
				{assessment?.status === 'matched' ? assessment.template!.name : assessment?.status === 'unknown' ? 'Unknown movement' : templates.length ? 'Recognising…' : 'Teach an exercise to name it'}
				<span class="text-muted">{` · Set ${shown.set} · ${STATUS[shown.status]}`}</span>
			</p>
			<p class="mt-3 flex flex-wrap items-baseline gap-3 leading-none" role="status"><span class="text-[clamp(44px,8vw,76px)] font-extrabold tracking-tight tabular-nums">{shown.reps.length}</span><span class="display text-[24px] text-lime">{shown.reps.length === 1 ? 'rep' : 'reps'}</span></p>
			<p class="mt-3 text-[14px] text-muted tabular-nums">
				{#if assessment?.status === 'matched'}{number(assessment.distanceDeg!)}° from your example · {clean} of {shown.reps.length} reps match your taught {assessment.template!.name}
				{:else if assessment?.status === 'unknown'}{assessment.distanceDeg === null ? 'No clear hinge in these reps.' : `The closest taught exercise is ${number(assessment.distanceDeg)}° away (limit ${EXERCISES.matchDegrees}°).`} Teach this exercise to get form checks.
				{:else}{time(shown.startedAt)}–{time(shown.endedAt)} (Warsaw){/if}
			</p>
			{#if moving}<p class="mt-2 text-[14px] text-lime">Set {sets.at(-1)!.set} has started; no rep counted in it yet.</p>{/if}

			<p class="label mt-6 text-muted">Forearm angle from the starting position (°)</p>
			<div class="chart-grid relative mt-2 h-[180px] min-w-0 border border-rule" bind:clientWidth={width}>
				{#if chart}
					<svg class="absolute inset-0 block" {width} height={HEIGHT} viewBox={`0 0 ${width} ${HEIGHT}`} role="img" aria-label={`Forearm angle over set ${shown.set}, with ${shown.reps.length} rep tops marked`}>
						{#each chart.grid as line (line.deg)}
							<text x="6" y={line.y - 4} class="fill-muted text-[11px]">{line.deg}°</text>
						{/each}
						{#if chart.band}<path d={chart.band} fill="var(--color-pen-emg)" fill-opacity="0.35" stroke="var(--color-pen-emg)" stroke-width="1" />{/if}
						<path d={chart.path} fill="none" stroke="var(--color-lime)" stroke-width="2" stroke-linejoin="round" />
						{#each chart.tops as top (top.rep)}
							<circle cx={top.x} cy={top.y} r="5" class={top.flagged ? 'fill-night stroke-white' : 'fill-lime stroke-night'} stroke-width="2" />
							<text x={top.x} y={Math.max(top.y - 10, 12)} text-anchor="middle" class="fill-white text-[12px] font-bold">{top.rep}</text>
						{/each}
					</svg>
				{/if}
			</div>
			<p class="mt-1 text-[12px] text-muted tabular-nums">Set start → {chart ? number(chart.span, 1) : 0} s · <span class="text-lime">line: angle</span>, numbers mark each top{shownMuscle?.covered ? ' · blue: EMG activity' : ''}{chart?.tops.some((top) => top.flagged) ? ' · hollow markers: flagged reps' : ''}</p>
			<p class="mt-2 text-[14px] tabular-nums" role="status">
				{#if shown.status === 'ongoing'}<span class="text-muted">Muscle activity is added once the set ends.</span>
				{:else if emgBusy}<span class="text-muted">Loading EMG for this set…</span>
				{:else if emgError}<span class="text-lime">{emgError} It retries with the next motion update.</span>
				{:else if shownMuscle}EMG found for <strong>{shownMuscle.covered} of {shownMuscle.reps.length}</strong> reps{shownMuscle.covered ? '' : '. Record EMG during the set, or check the motion clock offset under Calculation settings.'}{/if}
			</p>

			<p class="label mt-6 text-muted">Range per rep (°)</p>
			<div class="mt-2 overflow-x-auto pb-2">
				<div class="relative flex h-[140px] min-w-fit gap-1.5 border-b border-rule px-1">
					{#each shown.reps as rep (rep.rep)}
						<button type="button" class="relative h-full min-w-7 flex-1 hover:bg-raised focus-visible:bg-raised"
							aria-label={`Rep ${rep.rep}: ${number(rep.rangeDeg)} degrees${tags(rep.rep).length ? `, ${tags(rep.rep).join(', ')}` : ''}`}
							aria-pressed={selected?.rep === rep.rep}
							onpointerenter={() => { selectedRep = rep.rep; }} onfocus={() => { selectedRep = rep.rep; }} onclick={() => { selectedRep = rep.rep; }}>
							<span aria-hidden="true" class={['absolute inset-x-1 bottom-0 border-2', tags(rep.rep).length ? 'border-lime bg-transparent' : selected?.rep === rep.rep ? 'border-white bg-lime' : 'border-lime bg-lime/60']} style:height={`${Math.min(rep.rangeDeg, 180) / 180 * 100}%`}></span>
						</button>
					{/each}
				</div>
				<div aria-hidden="true" class="mt-1 flex min-w-fit gap-1.5 px-1 text-center text-[12px] text-muted tabular-nums">
					{#each shown.reps as rep (rep.rep)}<span class="min-w-7 flex-1">{rep.rep}</span>{/each}
				</div>
			</div>
			<p class="mt-2 min-h-10 border-l-2 border-lime bg-raised px-3 py-2 text-[14px] tabular-nums" role="status">
				{#if readout}<strong>Rep {readout.rep}</strong>: {readout.text}{#each readout.alerts as alert (alert)}<span class="text-lime before:mx-1.5 before:text-white before:content-['·']">{alert}</span>{/each}{/if}
			</p>

			<details class="mt-4 border-t border-rule pt-3">
				<summary class="text-[14px] font-semibold">Rep details</summary>
				<div class="mt-2 overflow-x-auto">
					<table class="w-full text-left text-[14px] tabular-nums">
						<caption class="sr-only">Range, lifting and lowering time per rep in set {shown.set}</caption>
						<thead class="label text-lime"><tr class="border-b border-rule"><th scope="col" class="py-2 pr-4">Rep</th><th scope="col" class="py-2 pr-4">Range</th><th scope="col" class="py-2 pr-4">Up</th><th scope="col" class="py-2 pr-4">Down</th><th scope="col" class="py-2 pr-4">Muscle</th><th scope="col" class="py-2">Compared with example</th></tr></thead>
						<tbody>
							{#each shown.reps as rep (rep.rep)}
								<tr class="border-b border-rule"><th scope="row" class="py-2 pr-4 font-semibold">{rep.rep}</th><td class="py-2 pr-4">{number(rep.rangeDeg)}°</td><td class="py-2 pr-4">{number(rep.upSeconds, 1)} s</td><td class="py-2 pr-4">{number(rep.downSeconds, 1)} s</td>
									<td class="py-2 pr-4">{@render muscleCell(rep.rep)}</td>
									<td class="py-2">{assessment?.status !== 'matched' ? '–' : flags(rep.rep).length ? flags(rep.rep).map((flag) => FLAG_LABEL[flag]).join(', ') : 'Matches'}</td></tr>
							{/each}
						</tbody>
					</table>
				</div>
			</details>
			{#if earlier.length}
				<details class="mt-3 border-t border-rule pt-3">
					<summary class="text-[14px] font-semibold">Earlier sets</summary>
					<ul class="mt-2 space-y-1 text-[14px] text-muted tabular-nums">
						{#each earlier as set (set.firstRecordId)}
							{@const match = assessments.find((item) => item.set === set.set)}
							<li>Set {set.set} · {set.reps.length} reps · average {number(set.reps.reduce((sum, rep) => sum + rep.rangeDeg, 0) / set.reps.length)}°{match?.status === 'matched' ? ` · ${match.template!.name}` : ''} · {time(set.startedAt)}</li>
						{/each}
					</ul>
				</details>
			{/if}
		{:else}
			<p class="text-[20px] font-semibold">{readings.length ? 'No reps yet.' : 'Waiting for motion readings.'}</p>
			<p class="mt-2 text-[15px] leading-relaxed text-muted">{readings.length ? 'Do a few slow curls with the sensor on your forearm. Each rep is counted once your arm comes back down.' : 'Start recording on the motion sensor.'}</p>
			{#if moving}<p class="mt-2 text-[14px] text-lime">Movement detected; no rep counted yet.</p>{/if}
		{/if}

		<section class="mt-6 border-t border-rule pt-5" aria-labelledby={`${uid}-teach`}>
			<h3 id={`${uid}-teach`} class="label text-lime">Taught exercises</h3>
			<p class="mt-2 text-[13px] leading-relaxed text-muted">Do {EXERCISES.minTeachReps}–5 reps with good form. Later sets are named after the closest taught exercise and each rep is compared with it. Wear the sensor the same way as when teaching.</p>
			{#if templates.length}
				<ul class="mt-3 space-y-2">
					{#each templates as template (template.id)}
						<li class="flex items-center justify-between gap-3 text-[14px] tabular-nums">
							<span><strong>{template.name}</strong><span class="text-muted">{` · ${template.reps} reps · ${number(template.rangeDeg)}° · up ${number(template.upSeconds, 1)} s · down ${number(template.downSeconds, 1)} s`}</span></span>
							<button type="button" class="btn btn-line px-0" aria-label={`Delete ${template.name}`} onclick={() => persist(templates.filter((item) => item.id !== template.id))}><Trash2 size={17} /></button>
						</li>
					{/each}
				</ul>
			{/if}
			{#if teaching}
				<div class="mt-4 border-l-2 border-lime bg-raised px-4 py-3">
					<p class="text-[15px]" role="status">Teaching <strong>{teaching.name}</strong>: {teachReps.length} rep{teachReps.length === 1 ? '' : 's'} so far.</p>
					<div class="mt-3 flex flex-wrap gap-3">
						<button type="button" class="btn btn-lime" onclick={saveTeaching}>Save exercise</button>
						<button type="button" class="btn btn-line" onclick={() => { teaching = null; teachMessage = ''; }}>Cancel</button>
					</div>
				</div>
			{:else}
				<form class="mt-4 flex flex-wrap items-end gap-3" onsubmit={startTeaching}>
					<label class="block min-w-0 flex-1 sm:max-w-64">
						<span class="label mb-2 block text-muted">Exercise name</span>
						<input class="min-h-11 w-full border border-white/45 bg-night px-3 text-[16px] text-white" bind:value={nameInput} maxlength="40" />
					</label>
					<button type="submit" class="btn btn-lime" disabled={!readings.length}>Start teaching</button>
				</form>
			{/if}
			{#if teachMessage}<p class="mt-3 text-[14px] text-lime" role="status">{teachMessage}</p>{/if}
			{#if storageError}<p class="mt-3 text-[13px] text-lime" role="status">{storageError}</p>{/if}
		</section>

		<details class="mt-6 border-t border-rule pt-4">
			<summary class="text-[14px] font-semibold">Calculation settings</summary>
			<ul class="mt-3 space-y-1 text-[13px] leading-relaxed text-muted">
				<li>Angle: direction of gravity from the accelerometer, smoothed over {REPS.accSmoothingSeconds} s, relative to the rest just before the set.</li>
				<li>A rep is a rise and fall of at least {REPS.minRangeDegrees}°, with tops at least {REPS.minRepSeconds} s apart. At about 5 Hz, reps faster than about 1 s may be missed.</li>
				<li>Recognition: start position and hinge axis each within {EXERCISES.matchDegrees}° of a taught exercise, after {EXERCISES.minMatchReps} reps.</li>
				<li>Compared with your example: range under {FORM.shortRange * 100}% · lowering under {FORM.fastLowering * 100}% of its time · lifting speed over {FORM.swingSpeed * 100}% or at the sensor limit · off-axis rotation {FORM.twistShare * 100} points above it.</li>
				<li>Muscle activity: mean EMG envelope during each rep as a percentage of the median of reps 1–{REP_EMG.baselineReps} in the same set; under {REP_EMG.lowPercent}% is low. A rep needs {REP_EMG.minCoverage * 100}% of its EMG samples.</li>
				<li>These are engineering defaults, not coaching rules or calibrated measurements.</li>
			</ul>
			<label class="mt-4 block max-w-64">
				<span class="label mb-2 block text-muted">Motion clock ahead by (s)</span>
				<input class="min-h-11 w-full border border-white/45 bg-night px-3 text-[16px] text-white" type="number" inputmode="decimal" step="0.1" bind:value={offsetInput} onchange={applyOffset} aria-invalid={!!offsetError} />
			</label>
			<p class="mt-2 text-[13px] leading-relaxed text-muted">The motion sensor and the EKG/EMG/pulse board keep separate clocks. A positive value means the motion sensor’s clock is ahead. It lines reps up with muscle activity and starts heart recovery at the right moment. Saved in this browser.</p>
			{#if offsetError}<p class="mt-2 text-[14px] text-lime" role="alert">{offsetError}</p>{/if}
		</details>
	</div>
</section>
