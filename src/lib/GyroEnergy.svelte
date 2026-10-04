<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import * as env from '$app/env/public';
	import { RotateCcw, TriangleAlert } from '@lucide/svelte';
	import { defaultGyroSettings, estimateGyroEnergy, GYRO, GYRO_STORAGE_KEY, pivotDistanceCm, positiveFinite,
		restoreGyroSession, serializeGyroSession, type GyroPivot } from './gyro-energy.ts';
	import { latestGyroId, loadGyroSnapshot } from './gyro-readings.ts';
	import { GyroSession, initialGyroSession, type GyroSessionState } from './gyro-session.ts';
	import EnergySets from './EnergySets.svelte';

	// `session` shares this tab's motion session (gyro in rad/s, accelerometer in g) with the rep counter and its quality panel.
	let { monitoring = true, refreshRequest, session = $bindable(initialGyroSession()) }: { monitoring?: boolean; refreshRequest: { sequence: number; manual: boolean }; session?: GyroSessionState } = $props();
	const uid = $props.id();
	let settings = $state.raw(defaultGyroSettings());
	let massInput = $state<number | undefined>();
	let elbowInput = $state<number | undefined>(35);
	let shoulderInput = $state<number | undefined>(65);
	let inputError = $state('');
	let storageError = $state('');
	let mounted = $state(false);
	let controller: GyroSession | undefined;
	let seenRequest = -1;
	let energy = $derived(estimateGyroEnergy(session.readings, settings));
	let distance = $derived(pivotDistanceCm(settings));
	let canShowEnergy = $derived(session.hasLoaded && (energy.status === 'ready' || energy.status === 'empty'));
	const number = (value: number) => new Intl.NumberFormat('en-GB', { maximumSignificantDigits: 5 }).format(value);
	const time = (value: string) => new Intl.DateTimeFormat('en-GB', { dateStyle: 'short', timeStyle: 'medium', timeZone: 'Europe/Warsaw' }).format(new Date(value));

	function persist() {
		if (!mounted) return;
		try { sessionStorage.setItem(GYRO_STORAGE_KEY, serializeGyroSession(settings, session.baselineId)); }
		catch { storageError = 'This browser blocks storage, so your settings reset when you reload.'; }
	}
	function checkConfiguration() {
		if (!env.PUBLIC_SUPABASE_URL || !env.PUBLIC_SUPABASE_PUBLISHABLE_KEY) throw new Error('Configure the Supabase URL and publishable key to load gyro readings.');
	}
	onMount(() => {
		let saved: string | null = null;
		try { saved = sessionStorage.getItem(GYRO_STORAGE_KEY); }
		catch { storageError = 'This browser blocks storage, so your settings reset when you reload.'; }
		const restored = restoreGyroSession(saved);
		settings = restored.settings;
		massInput = settings.massKg ?? undefined;
		elbowInput = settings.elbowCm;
		shoulderInput = settings.shoulderCm;
		controller = new GyroSession({
			load: (afterId, signal) => { checkConfiguration(); return loadGyroSnapshot(fetch, env.PUBLIC_SUPABASE_URL, env.PUBLIC_SUPABASE_PUBLISHABLE_KEY, afterId, signal); },
			latest: (signal) => { checkConfiguration(); return latestGyroId(fetch, env.PUBLIC_SUPABASE_URL, env.PUBLIC_SUPABASE_PUBLISHABLE_KEY, signal); },
			change: (next) => {
				const boundaryChanged = session.baselineId !== next.baselineId;
				session = next;
				if (boundaryChanged) persist();
			}
		}, restored.baselineId);
		session = controller.state;
		mounted = true;
		seenRequest = untrack(() => refreshRequest.sequence);
		controller.setMonitoring(untrack(() => monitoring));
		void controller.refresh();
		return () => controller?.dispose();
	});
	function observeRefresh() {
		const request = refreshRequest;
		const enabled = monitoring;
		untrack(() => {
			controller?.setMonitoring(enabled);
			if (!controller || request.sequence === seenRequest) return;
			seenRequest = request.sequence;
			void controller.refresh(request.manual);
		});
	}
	$effect(observeRefresh);

	function applySettings(event: SubmitEvent) {
		event.preventDefault();
		if (!positiveFinite(massInput)) { inputError = 'Enter the weight in kilograms, above zero.'; return; }
		if (!positiveFinite(elbowInput) || !positiveFinite(shoulderInput)) { inputError = 'Both distances must be above zero.'; return; }
		if (!Number.isFinite(0.5 * massInput * (Math.max(elbowInput, shoulderInput) / 100) ** 2)) { inputError = 'That weight or distance is too large to calculate.'; return; }
		settings = { ...settings, massKg: massInput, elbowCm: elbowInput, shoulderCm: shoulderInput };
		inputError = '';
		persist();
	}
	function selectPivot(pivot: GyroPivot) {
		settings = { ...settings, pivot };
		persist();
	}
</script>

<section class="min-w-0" aria-labelledby={`${uid}-title`}>
	<div class="flex flex-wrap items-baseline gap-x-4 gap-y-2">
		<h2 id={`${uid}-title`} class="display text-[28px] md:text-[32px]"><span class="text-lime">Movement</span> <span class="outline-text">energy</span></h2>
		<span class="label border border-lime px-2 py-1 text-lime">Estimate</span>
	</div>
	<p class="mt-3 text-[15px] leading-relaxed text-muted">How much work your arm puts into the weight. Enter the weight in your hand and the joint you’re moving around. This isn’t calories burned.</p>
	<div class="relative mt-5 border border-rule bg-night p-5 md:p-6">
		<form onsubmit={applySettings} novalidate>
			<div class="flex flex-wrap items-end gap-3">
				<label class="block min-w-0 flex-1 sm:max-w-64">
					<span class="label mb-2 block text-muted">Weight in your hand (kg)</span>
					<input class="min-h-11 w-full border border-white/45 bg-night px-3 text-[16px] text-white" type="number" inputmode="decimal" step="any" min="0" required placeholder="e.g. 5" bind:value={massInput} aria-invalid={!!inputError && !positiveFinite(massInput)} aria-describedby={inputError ? `${uid}-input-error` : undefined} />
				</label>
				<button type="submit" class="btn btn-lime">Apply settings</button>
			</div>
			<fieldset class="mt-6">
				<legend class="label mb-3 text-muted">Joint you move around</legend>
				<div class="grid grid-cols-2 gap-3">
					{#each ['elbow', 'shoulder'] as pivot (pivot)}
						<label class={['pivot-choice btn min-w-0 flex-wrap gap-x-2 px-2 py-3', settings.pivot === pivot ? 'btn-lime' : 'btn-line']}>
							<input class="sr-only" type="radio" name={`${uid}-pivot`} value={pivot} checked={settings.pivot === pivot} onchange={() => selectPivot(pivot as GyroPivot)} />
							<span>{pivot === 'elbow' ? 'Elbow' : 'Shoulder'}</span>
							<span class="text-[12px] tracking-normal tabular-nums">{number(pivot === 'elbow' ? settings.elbowCm : settings.shoulderCm)} cm</span>
						</label>
					{/each}
				</div>
			</fieldset>
			<details class="mt-5 border-t border-rule pt-4">
				<summary class="text-[14px] font-semibold">Energy settings</summary>
				<p class="mt-3 text-[14px] leading-relaxed text-muted">Distance from the joint to the weight. Defaults: 35 cm from elbow to hand; 65 cm from shoulder to hand (30 cm upper arm + 35 cm). Adjust both here, then apply settings.</p>
				<div class="mt-4 grid gap-4 sm:grid-cols-2">
					<label class="block"><span class="label mb-2 block text-muted">Elbow distance (cm)</span><input class="min-h-11 w-full border border-white/45 bg-night px-3 text-[16px]" type="number" inputmode="decimal" step="any" min="0" required bind:value={elbowInput} /></label>
					<label class="block"><span class="label mb-2 block text-muted">Shoulder distance (cm)</span><input class="min-h-11 w-full border border-white/45 bg-night px-3 text-[16px]" type="number" inputmode="decimal" step="any" min="0" required bind:value={shoulderInput} /></label>
				</div>
				<p class="mt-4 text-[13px] leading-relaxed text-muted">Assumes the weight moves in a circle around the selected joint, with the sensor rotating with it. Uses ½ × mass × distance² × angular speed² and adds only increases between smoothed samples. Gravitational work and metabolic expenditure are excluded.</p>
				<p class="mt-2 text-[13px] leading-relaxed text-muted">The motion sensor sends degrees per second (its axes clip at ±{GYRO.sensorLimitDegrees} °/s); readings are converted to rad/s. Smoothing: 0.25 s. Rest threshold: 0.05 rad/s (2.9 °/s). These are engineering assumptions, not calibrated sensor measurements.</p>
			</details>
			{#if inputError}<p id={`${uid}-input-error`} class="mt-4 text-[15px] text-lime" role="alert">{inputError}</p>{/if}
		</form>
		<div class="mt-6 border-t border-rule pt-6" aria-busy={session.busy}>
			<p class="label text-muted">Work done lifting</p>
			{#if canShowEnergy}
				<p class="mt-3 flex flex-wrap items-baseline gap-3 leading-none"><span class="text-[clamp(44px,8vw,76px)] font-extrabold tracking-tight tabular-nums">{number(energy.workJ)}</span><span class="display text-[24px] text-lime">J</span></p>
				<p class="mt-4 text-[15px] text-muted">Energy of the weight right now: <strong class="text-white tabular-nums">{energy.latestKineticJ === null ? 'Unavailable' : `${number(energy.latestKineticJ)} J`}</strong></p>
				<p class="mt-2 text-[14px] text-muted">{number(settings.massKg!)} kg · {settings.pivot === 'elbow' ? 'Elbow' : 'Shoulder'} joint · {number(distance)} cm. Switching joints recalculates the whole count.</p>
			{:else}
				<p class="mt-3 text-[20px] font-semibold">{settings.massKg === null ? 'Enter the weight in your hand to see the energy.' : !session.hasLoaded ? 'Waiting for the motion sensor.' : energy.reason}</p>
			{/if}
			{#if session.hasLoaded}
				{#if energy.status === 'unset' && session.readings.length}<p class="mt-4 text-[14px] text-muted">{session.readings.length.toLocaleString('en-GB')} motion readings received.</p>{/if}
				{#if !session.readings.length}<p class="mt-4 text-[14px] text-muted">{session.baselineId === null ? 'No motion readings yet. Start recording on the motion sensor.' : 'Count reset. Waiting for new movement.'}</p>{/if}
			{/if}
			<!-- Loads run every second, so a reload over existing data keeps showing the last update instead of flickering. -->
			<p class="mt-4 text-[14px] text-muted" role="status">{session.resetting ? 'Resetting…' : session.busy && !session.hasLoaded ? 'Loading motion readings…' : !monitoring ? 'Paused. Use Refresh now to load new readings.' : session.error ? 'Couldn’t update. Retrying…' : session.loadedAt ? `Updated ${time(session.loadedAt)}.` : 'Waiting for the motion sensor.'}</p>
			{#if session.error}<p class="mt-3 flex gap-2 text-[15px] leading-relaxed" role="alert"><TriangleAlert size={18} class="mt-0.5 shrink-0 text-lime" /><span>{session.hasLoaded ? 'Showing the last result. ' : ''}{session.error}</span></p>{/if}
		</div>
		{#if canShowEnergy}<EnergySets sets={energy.sets} />{/if}
		<div class="mt-6 border-t border-rule pt-5">
			<button class="btn btn-line w-full sm:w-auto" type="button" disabled={!mounted || session.resetting} onclick={() => controller?.reset()}><RotateCcw size={17} />Start a fresh count</button>
			<p class="mt-3 text-[13px] leading-relaxed text-muted">Counts only movement from now on. Your weight and joint stay set.</p>
			{#if storageError}<p class="mt-3 text-[13px] text-lime" role="status">{storageError}</p>{/if}
		</div>
	</div>
</section>

<style>
	.pivot-choice:has(input:focus-visible) { outline: 2px solid var(--color-lime); outline-offset: 3px; }
	.pivot-choice.btn-lime:has(input:focus-visible) { outline-color: white; }
</style>
