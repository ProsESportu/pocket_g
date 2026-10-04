<script lang="ts">
	import { invalidate } from '$app/navigation';
	import { onMount, untrack } from 'svelte';
	import { Pause, Play, RefreshCw, TriangleAlert } from '@lucide/svelte';
	import SessionStrip from '#lib/SessionStrip.svelte';
	import RecordingQuality from '#lib/RecordingQuality.svelte';
	import GyroEnergy from '#lib/GyroEnergy.svelte';
	import RepCounter from '#lib/RepCounter.svelte';
	import { initialGyroSession } from '#lib/gyro-session.ts';
	import { gyroRecordingQuality } from '#lib/recording-quality.ts';
	import { analyzeReps } from '#lib/reps.ts';
	import { assessSet, type ExerciseTemplate } from '#lib/exercises.ts';
	import { formCoachNotes } from '#lib/rep-coach.ts';
	import HeartRecovery from '#lib/HeartRecovery.svelte';
	import { recoveryCoachNotes, type Recovery } from '#lib/recovery.ts';
	import { muscleCoachNotes, type SetMuscle } from '#lib/rep-emg.ts';
	import CoachNotes from '#lib/CoachNotes.svelte';
	import EcgAnalysis from '#lib/EcgAnalysis.svelte';
	import EmgAnalysis from '#lib/EmgAnalysis.svelte';
	import { emgCoachNote } from '#lib/emg-coach.ts';
	import { ecgCoachNotes } from '#lib/ecg-coach.ts';
	import type { EcgResult } from '#lib/ecg.ts';
	import type { EmgResult } from '#lib/emg.ts';
	import PulseFrequency from '#lib/PulseFrequency.svelte';
	import { signalChecks } from '#lib/coach.ts';
	import type { PageData } from './$types';
	let { data }: { data: PageData } = $props();
	let lastSuccess = $state<PageData | null>(untrack(() => data.error ? null : data));
	let displayed = $derived(data.error ? lastSuccess ?? data : data);
	let autoRefresh = $state(true);
	let pageVisible = $state(true);
	let refreshing = $state(false);
	let refreshError = $state('');
	let selectedNote = $state<string | null>(null);
	let emgResult = $state.raw<EmgResult | null>(null);
	let ecgResult = $state.raw<EcgResult | null>(null);
	let emgState = $state.raw({ busy: false, error: '' });
	let ecgState = $state.raw({ busy: false, error: '' });
	let emgStale = $derived(emgState.busy || !!emgState.error || (emgResult?.window.lastRecordId != null && displayed.readings[0]?.id !== emgResult.window.lastRecordId));
	let ecgStale = $derived(ecgState.busy || !!ecgState.error || !!displayed.ecg.error || (!!ecgResult && (ecgResult.window.firstRecordId !== displayed.ecg.firstRecordId || ecgResult.window.lastRecordId !== displayed.ecg.lastRecordId || ecgResult.window.available !== displayed.ecg.available || ecgResult.window.rowCount !== displayed.ecg.rowCount)));
	let gyroRefreshRequest = $state.raw({ sequence: 0, manual: false });
	// One motion session feeds movement energy, the rep counter and the form checks.
	let gyroSession = $state.raw(initialGyroSession());
	let imuReadings = $derived(gyroSession.readings);
	let gyroQuality = $derived(gyroRecordingQuality(gyroSession.readings));
	let templates = $state.raw<ExerciseTemplate[]>([]);
	let clockOffset = $state(0);
	let recoveries = $state.raw<Recovery[]>([]);
	let setMuscle = $state.raw<SetMuscle | null>(null);
	let repSets = $derived(analyzeReps(imuReadings));
	let assessments = $derived(repSets.map((set) => assessSet(set, templates)));
	let notes = $derived.by(() => {
		const checks = signalChecks(displayed.readings, displayed.pulse);
		const workout = [...formCoachNotes(repSets, assessments), ...muscleCoachNotes(setMuscle, repSets), ...recoveryCoachNotes(recoveries)];
		return [...checks.filter((note) => note.kind === 'fix'),
			...ecgCoachNotes(ecgResult, displayed.readings, ecgStale || !!failure),
			...emgCoachNote(emgResult, displayed.readings, emgStale || !!failure),
			...workout.filter((note) => note.kind === 'try'), ...checks.filter((note) => note.kind === 'try'),
			...workout.filter((note) => note.kind === 'keep'), ...checks.filter((note) => note.kind === 'keep')];
	});
	let failure = $derived(data.error || refreshError);
	let status = $derived(failure ? 'Connection problem' : !autoRefresh ? 'Paused' : !pageVisible ? 'Live in background' : 'Live');
	// The Live dot beats at the measured heart rate; implausible estimates leave it still.
	let beat = $derived.by(() => {
		const bpm = data.pulse.status === 'ready' ? Math.round(data.pulse.bpm ?? 0) : 0;
		return status === 'Live' && bpm >= 30 && bpm <= 220 ? `${(60 / bpm).toFixed(3)}s` : null;
	});
	const STEPS = [
		{ title: 'Wear the sensors', text: 'Put on the ECG, EMG and pulse sensors and the motion sensor on your forearm. Your signals appear within a few seconds.' },
		{ title: 'Teach your exercise', text: 'Under Your reps, name it, press Start teaching and do 3–5 clean reps, then save.' },
		{ title: 'Train', text: 'Reps are counted and compared with your example. Heart recovery records itself for a minute after each set.' }
	];
	const date = (value: string) => new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'medium', timeZone: 'Europe/Warsaw' }).format(new Date(value));
	const time = (value: string) => new Intl.DateTimeFormat('en-GB', { timeStyle: 'medium', timeZone: 'Europe/Warsaw' }).format(new Date(value));
	onMount(() => {
		pageVisible = document.visibilityState === 'visible';
		const updateVisibility = () => {
			pageVisible = document.visibilityState === 'visible';
			if (pageVisible && autoRefresh) void refresh();
		};
		document.addEventListener('visibilitychange', updateVisibility);
		const timer = window.setInterval(() => {
			if (autoRefresh) void refresh();
		}, 1000);
		return () => {
			window.clearInterval(timer);
			document.removeEventListener('visibilitychange', updateVisibility);
		};
	});
	function toggleMonitoring() {
		autoRefresh = !autoRefresh;
		if (autoRefresh) void refresh();
	}
	async function refresh(manual = false) {
		// Gyro loading follows every refresh request, even while the physiological loader is busy or fails.
		gyroRefreshRequest = { sequence: gyroRefreshRequest.sequence + 1, manual };
		if (refreshing) return;
		refreshing = true;
		refreshError = '';
		try {
			await invalidate('app:readings');
			if (!data.error) lastSuccess = data;
		}
		catch { refreshError = 'Refresh failed.'; }
		finally { refreshing = false; }
	}
</script>

<svelte:head>
	<title>MyGymBro</title>
	<meta name="description" content="Live ECG, EMG, pulse and rep tracking while you train." />
</svelte:head>

<header class="border-b border-rule">
	<div class="mx-auto flex h-16 max-w-[1280px] items-center justify-between gap-3 px-4 md:px-8">
		<a href="/" class="display inline-flex min-h-11 items-center text-[20px]">MyGym<span class="text-lime">Bro</span></a>
		<div class="flex items-center gap-2 md:gap-3">
			<p class="label mr-1 flex items-center gap-2 text-muted">
				<svg class={['size-2.5 shrink-0', beat && 'beat']} style:--beat={beat} viewBox="0 0 10 10" aria-hidden="true">
					{#if failure}<path d="M5 0.5 9.8 9.5H0.2Z" fill="var(--color-lime)" />
					{:else if autoRefresh}<circle cx="5" cy="5" r="4" fill="var(--color-lime)" />
					{:else}<circle cx="5" cy="5" r="3.5" fill="none" stroke="currentColor" stroke-width="1.5" />{/if}
				</svg>
				<span class="text-white max-sm:sr-only">{status}</span>
				{#if displayed.loadedAt}<span class="hidden tabular-nums sm:inline">Updated {time(displayed.loadedAt)}</span>{/if}
			</p>
			<button class="btn btn-line px-3 md:px-4" onclick={toggleMonitoring}>
				{#if autoRefresh}<Pause size={18} />{:else}<Play size={18} />{/if}
				<span class="sr-only md:not-sr-only">{autoRefresh ? 'Pause monitoring' : 'Resume monitoring'}</span>
			</button>
			<!-- Live updates already refresh every second, so the manual refresh only matters while paused. -->
			{#if !autoRefresh}
				<button class="btn btn-line px-3 md:px-4" onclick={() => refresh(true)}>
					<RefreshCw size={18} />
					<span class="sr-only md:not-sr-only">Refresh now</span>
				</button>
			{/if}
		</div>
	</div>
</header>

<!-- Full-bleed hero: the outer 1fr gutters let the heart-rate panel run to the right edge like the template's photo panels. -->
<section class="relative grid overflow-hidden border-b border-rule lg:grid-cols-[minmax(2rem,1fr)_minmax(0,736px)_minmax(0,480px)_minmax(2rem,1fr)]" aria-labelledby="page-title">
	<div class="relative z-10 px-4 pt-10 pb-14 md:px-8 md:pt-14 lg:col-start-2 lg:px-0 lg:pr-8 lg:pb-20">
		<h1 id="page-title" class="display text-[clamp(48px,7vw,96px)]">
			<span class="rise block text-[0.55em]" style:--i={0}>Live</span>
			<!-- Outer spans drift with scroll, inner spans rise on load, so the two animations never compete. -->
			<span aria-hidden="true" class="drift block" style:--drift="-0.6em" style:--fade={0.2}><span class="rise outline-text block" style:--i={1}>Session</span></span>
			<span aria-hidden="true" class="drift -mt-[0.08em] block" style:--drift="-0.3em" style:--fade={0.5}><span class="rise outline-text block" style:--i={2}>Session</span></span>
			<span class="rise -mt-[0.08em] block text-lime" style:--i={3.5}>Session</span>
		</h1>
		<p class="mt-6 max-w-[52ch] text-[16px] leading-relaxed text-muted">MyGymBro reads your heart, muscle and arm movement while you lift. Put on the sensor board and the forearm motion sensor, then start curling. Everything below updates live.</p>
	</div>
	<div class="hero-panel relative bg-panel lg:col-span-2 lg:col-start-3">
		<svg class="edge-line absolute inset-0 hidden h-full w-full lg:block" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><line x1="16" y1="0" x2="0" y2="100" stroke="var(--color-lime)" stroke-width="2" vector-effect="non-scaling-stroke" /></svg>
		<div aria-hidden="true" class="display pointer-events-none absolute right-0 bottom-5 left-0 hidden overflow-hidden text-[88px] leading-none whitespace-nowrap md:block">
			<span class="pulse-band outline-text block pl-[10%] [--stroke:var(--color-lime)]">Pulse Pulse Pulse</span>
		</div>
		<div class="relative z-10 px-4 pt-12 pb-14 md:px-8 md:pb-[136px] lg:max-w-[min(100%,560px)] lg:pt-14 lg:pr-8 lg:pl-[22%]">
			<PulseFrequency result={data.pulse} refreshError={failure} {refreshing} />
		</div>
	</div>
	<span aria-hidden="true" class="hero-wedge wedge bottom-0 left-0 z-10 h-3 w-[42%] max-w-[460px]"></span>
</section>

<main class="mx-auto max-w-[1280px] px-4 pt-12 pb-12 md:px-8 md:pt-16">
	{#if failure}
		<div class="mb-10 flex gap-3 border-l-2 border-lime bg-raised px-4 py-3 text-[15px] leading-relaxed" role="alert">
			<TriangleAlert class="mt-0.5 shrink-0 text-lime" size={20} />
			<p>{failure} {lastSuccess ? `Showing readings from ${time(lastSuccess.loadedAt)}.` : ''} {autoRefresh ? 'Retrying every second.' : 'Refresh now, or resume live updates to retry.'}</p>
		</div>
	{/if}
	<section class="mb-14 border-b border-rule pb-12" aria-labelledby="steps-title">
		<h2 id="steps-title" class="label text-muted">How it works</h2>
		<ol class="mt-5 grid gap-8 md:grid-cols-3">
			{#each STEPS as step, index (step.title)}
				<li class="flex gap-4">
					<span aria-hidden="true" class="display text-[44px] text-lime">{index + 1}</span>
					<div>
						<p class="display text-[18px]">{step.title}</p>
						<p class="mt-2 text-[15px] leading-relaxed text-muted">{step.text}</p>
					</div>
				</li>
			{/each}
		</ol>
	</section>
	<!-- Coach notes and both quality panels share the right column beside the main panels. -->
	<div class="grid items-start gap-x-8 gap-y-14 lg:grid-cols-12">
		<section class="min-w-0 lg:col-span-8" aria-labelledby="signals-title">
			<h2 id="signals-title" class="display mb-5 text-[28px] md:text-[32px]"><span class="text-lime">Your</span> <span class="outline-text">signals</span></h2>
			<p class="-mt-2 mb-5 text-[15px] leading-relaxed text-muted">The last 10 seconds from your sensors. Each line has its own scale, so compare a signal with itself, not with the others.</p>
			<SessionStrip readings={displayed.readings} heartRate={displayed.heartRate} {notes} {selectedNote} unavailable={!!failure} />
		</section>
		<div class="min-w-0 lg:col-span-4 lg:row-span-4">
			<CoachNotes {notes} bind:selected={selectedNote} />
			<div class="mt-14 space-y-5">
				<RecordingQuality summary={displayed.quality} label="Sensor board" loadedAt={displayed.loadedAt} stale={!!failure} monitoring={autoRefresh} {refreshing} />
				<RecordingQuality summary={gyroQuality} label="Motion sensor" loadedAt={gyroSession.loadedAt} stale={!!gyroSession.error && gyroSession.hasLoaded} monitoring={autoRefresh} refreshing={gyroSession.busy} />
			</div>
		</div>
		<div class="min-w-0 lg:col-span-8">
			<GyroEnergy monitoring={autoRefresh} refreshRequest={gyroRefreshRequest} bind:session={gyroSession} />
		</div>
		<div class="min-w-0 lg:col-span-8">
			<RepCounter readings={imuReadings} sets={repSets} {assessments} bind:templates bind:offsetSeconds={clockOffset} bind:muscle={setMuscle} />
		</div>
		<div class="min-w-0 lg:col-span-8">
			<HeartRecovery sets={repSets} latestPulse={displayed.readings[0]} refreshRequest={gyroRefreshRequest} offsetSeconds={clockOffset} pulseRate={displayed.pulseRate} bind:history={recoveries} />
		</div>
		<!-- The ECG and EMG checks sit side by side across the full width, below the right column. -->
		<div class="grid min-w-0 gap-x-8 gap-y-14 lg:col-span-12 lg:grid-cols-2">
			<EcgAnalysis window={displayed.ecg} connectionError={failure} onresult={(result) => { ecgResult = result; }} onstate={(state) => { ecgState = state; }} />
			<EmgAnalysis throughId={displayed.readings[0]?.id} connectionError={failure} onresult={(result) => { emgResult = result; }} onstate={(state) => { emgState = state; }} />
		</div>
	</div>

	<footer class="label mt-20 flex flex-wrap justify-between gap-x-6 gap-y-2 border-t border-rule pt-6 text-muted">
		<p class="flex items-center gap-3"><span class="whitespace-nowrap text-white">MyGymBro</span><span aria-hidden="true" class="h-4 w-0.5 bg-lime"></span>All times in Warsaw time</p>
		<p class="tabular-nums">{displayed.loadedAt ? `Last fetched ${date(displayed.loadedAt)}` : 'Waiting for the first connection'}</p>
	</footer>
</main>

<style>
	/* Diagonal left edge on wide screens, a slanted top edge when stacked. */
	.hero-panel { clip-path: polygon(0 28px, 100% 0, 100% 100%, 0 100%); }
	@media (min-width: 1024px) { .hero-panel { clip-path: polygon(16% 0, 100% 0, 100% 100%, 0 100%); } }

	/* Page-load sequence, CSS only so it plays before hydration: the title stack rises line by line with the
	   lime word landing last, the heart-rate panel sweeps in from the right, then the lime edge and wedge land. */
	@media (prefers-reduced-motion: no-preference) {
		.rise { animation: rise 750ms var(--ease-out-expo) calc(var(--i) * 90ms) backwards; }
		.hero-panel { animation: panel-in 900ms var(--ease-out-expo) 150ms backwards; }
		.edge-line { animation: draw-down 500ms var(--ease-out-expo) 750ms backwards; }
		.hero-wedge { transform-origin: left; animation: slice 700ms var(--ease-out-expo) 550ms backwards; }
		.beat { animation: beat var(--beat) ease-out infinite; }
	}
	@media (prefers-reduced-motion: no-preference) and (min-width: 1024px) {
		.hero-panel { animation-name: panel-in-wide; }
	}
	/* Scroll-linked: the outlined echoes trail upward as the title leaves, and the PULSE band slides sideways.
	   Browsers without scroll-driven animations keep both still. */
	@supports (animation-timeline: scroll()) {
		@media (prefers-reduced-motion: no-preference) {
			.drift, .pulse-band { animation-name: drift; animation-timing-function: linear; animation-fill-mode: both; animation-timeline: scroll(root); animation-range: 0 60vh; }
			.pulse-band { --drift-x: -40%; animation-range: 0 100vh; }
		}
	}

	/* Text rises from behind its own bottom edge: the clip shrinks as fast as the line moves up. */
	@keyframes rise {
		from { translate: 0 100%; clip-path: inset(0 -0.25em 100% -0.25em); }
		to { translate: 0 0; clip-path: inset(-0.25em); }
	}
	@keyframes panel-in { from { clip-path: polygon(100% 28px, 100% 0, 100% 100%, 100% 100%); } }
	@keyframes panel-in-wide { from { clip-path: polygon(100% 0, 100% 0, 100% 100%, 84% 100%); } }
	@keyframes draw-down {
		from { clip-path: inset(0 0 100% 0); }
		to { clip-path: inset(0); }
	}
	@keyframes slice { from { scale: 0 1; } }
	@keyframes drift { to { transform: translate(var(--drift-x, 0), var(--drift, 0)); opacity: var(--fade, 1); } }
	/* Lub-dub: a strong beat, a softer echo, then rest for the remainder of the interval. */
	@keyframes beat {
		0%, 50%, 100% { scale: 1; }
		12% { scale: 1.5; }
		24% { scale: 1; }
		36% { scale: 1.25; }
	}
</style>
