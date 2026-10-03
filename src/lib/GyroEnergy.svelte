<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import * as env from '$app/env/public';
	import { RotateCcw, TriangleAlert } from '@lucide/svelte';
	import { defaultGyroSettings, estimateGyroEnergy, GYRO_STORAGE_KEY, pivotDistanceCm, positiveFinite,
		restoreGyroSession, serializeGyroSession, type GyroPivot } from './gyro-energy.ts';
	import { latestGyroId, loadGyroSnapshot } from './gyro-readings.ts';
	import { GyroSession, initialGyroSession } from './gyro-session.ts';
	import EnergySets from './EnergySets.svelte';
	import RecordingQuality from './RecordingQuality.svelte';
	import { gyroRecordingQuality } from './recording-quality.ts';

	let { monitoring = true, refreshRequest }: { monitoring?: boolean; refreshRequest: { sequence: number; manual: boolean } } = $props();
	const uid = $props.id();
	let settings = $state.raw(defaultGyroSettings());
	let session = $state.raw(initialGyroSession());
	let massInput = $state<number | undefined>();
	let elbowInput = $state<number | undefined>(35);
	let shoulderInput = $state<number | undefined>(65);
	let inputError = $state('');
	let storageError = $state('');
	let mounted = $state(false);
	let controller: GyroSession | undefined;
	let seenRequest = -1;
	let energy = $derived(estimateGyroEnergy(session.readings, settings));
	let quality = $derived(gyroRecordingQuality(session.readings));
	let distance = $derived(pivotDistanceCm(settings));
	let canShowEnergy = $derived(session.hasLoaded && (energy.status === 'ready' || energy.status === 'empty'));
	const number = (value: number) => new Intl.NumberFormat('en-GB', { maximumSignificantDigits: 5 }).format(value);
	const time = (value: string) => new Intl.DateTimeFormat('en-GB', { dateStyle: 'short', timeStyle: 'medium', timeZone: 'Europe/Warsaw' }).format(new Date(value));

	function persist() {
		if (!mounted) return;
		try { sessionStorage.setItem(GYRO_STORAGE_KEY, serializeGyroSession(settings, session.baselineId)); }
		catch { storageError = 'Tab storage is unavailable. Settings and the reset boundary will be lost when you reload.'; }
	}
	function checkConfiguration() {
		if (!env.PUBLIC_SUPABASE_URL || !env.PUBLIC_SUPABASE_PUBLISHABLE_KEY) throw new Error('Configure the Supabase URL and publishable key to load gyro readings.');
	}
	onMount(() => {
		let saved: string | null = null;
		try { saved = sessionStorage.getItem(GYRO_STORAGE_KEY); }
		catch { storageError = 'Tab storage is unavailable. Settings and the reset boundary will be lost when you reload.'; }
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
		if (!positiveFinite(massInput)) { inputError = 'Enter a finite, positive mass in kilograms.'; return; }
		if (!positiveFinite(elbowInput) || !positiveFinite(shoulderInput)) { inputError = 'Both pivot distances must be finite and greater than zero.'; return; }
		if (!Number.isFinite(0.5 * massInput * (Math.max(elbowInput, shoulderInput) / 100) ** 2)) { inputError = 'Mass or distance is too large to calculate energy.'; return; }
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
		<span class="label border border-lime px-2 py-1 text-lime">Estimate · Gyro</span>
	</div>
	<p class="mt-3 text-[15px] leading-relaxed text-muted">Estimated positive kinetic work from your MPU6050 gyro readings. Enter the mass you are moving and choose its pivot.</p>
	<div class="relative mt-5 border border-rule bg-night p-5 md:p-6">
		<form onsubmit={applySettings} novalidate>
			<div class="flex flex-wrap items-end gap-3">
				<label class="block min-w-0 flex-1 sm:max-w-64">
					<span class="label mb-2 block text-muted">Mass moved (kg)</span>
					<input class="min-h-11 w-full border border-white/45 bg-night px-3 text-[16px] text-white" type="number" inputmode="decimal" step="any" min="0" required placeholder="e.g. 5" bind:value={massInput} aria-invalid={!!inputError && !positiveFinite(massInput)} aria-describedby={inputError ? `${uid}-input-error` : undefined} />
				</label>
				<button type="submit" class="btn btn-lime">Apply settings</button>
			</div>
			<fieldset class="mt-6">
				<legend class="label mb-3 text-muted">Movement pivot</legend>
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
				<summary class="text-[14px] font-semibold">Calculation settings</summary>
				<p class="mt-3 text-[14px] leading-relaxed text-muted">Distance from the pivot to the load. Defaults: 35 cm from elbow to load; 65 cm from shoulder to load (30 cm upper arm + 35 cm). Adjust both here, then apply settings.</p>
				<div class="mt-4 grid gap-4 sm:grid-cols-2">
					<label class="block"><span class="label mb-2 block text-muted">Elbow distance (cm)</span><input class="min-h-11 w-full border border-white/45 bg-night px-3 text-[16px]" type="number" inputmode="decimal" step="any" min="0" required bind:value={elbowInput} /></label>
					<label class="block"><span class="label mb-2 block text-muted">Shoulder distance (cm)</span><input class="min-h-11 w-full border border-white/45 bg-night px-3 text-[16px]" type="number" inputmode="decimal" step="any" min="0" required bind:value={shoulderInput} /></label>
				</div>
				<p class="mt-4 text-[13px] leading-relaxed text-muted">Gyro units: rad/s. Smoothing: 0.25 s. Rest threshold: 0.05 rad/s. These are engineering assumptions, not calibrated sensor measurements.</p>
			</details>
			{#if inputError}<p id={`${uid}-input-error`} class="mt-4 text-[15px] text-lime" role="alert">{inputError}</p>{/if}
		</form>
		<div class="mt-6 border-t border-rule pt-6" aria-busy={session.busy}>
			<p class="label text-muted">Estimated positive kinetic work</p>
			{#if canShowEnergy}
				<p class="mt-3 flex flex-wrap items-baseline gap-3 leading-none"><span class="text-[clamp(44px,8vw,76px)] font-extrabold tracking-tight tabular-nums">{number(energy.workJ)}</span><span class="display text-[24px] text-lime">J</span></p>
				<p class="mt-4 text-[15px] text-muted">Latest kinetic energy: <strong class="text-white tabular-nums">{energy.latestKineticJ === null ? 'Unavailable' : `${number(energy.latestKineticJ)} J`}</strong></p>
				<p class="mt-2 text-[14px] text-muted">{number(settings.massKg!)} kg · {settings.pivot === 'elbow' ? 'Elbow' : 'Shoulder'} pivot · {number(distance)} cm. Switching pivots recalculates this entire session.</p>
			{:else}
				<p class="mt-3 text-[20px] font-semibold">{settings.massKg === null ? 'Enter the mass to calculate energy.' : !session.hasLoaded ? 'Waiting for gyro readings.' : energy.reason}</p>
			{/if}
			{#if session.hasLoaded}
				<p class="mt-4 text-[14px] leading-relaxed text-muted">{energy.status === 'unset' ? `${session.readings.length.toLocaleString('en-GB')} gyro rows loaded.` : `${energy.sampleCount.toLocaleString('en-GB')} analyzed samples · ${number(energy.durationSeconds)} s of continuous motion data · ${energy.segmentCount} segment${energy.segmentCount === 1 ? '' : 's'}.`}</p>
				{#if energy.firstRecordId !== null}<p class="mt-2 text-[13px] leading-relaxed text-muted">Records {energy.firstRecordId}–{energy.lastRecordId} · {time(energy.startedAt)}–{time(energy.endedAt)} (Warsaw).</p>{/if}
				{#if energy.skippedCount}<p class="mt-2 text-[13px] text-muted">Skipped {energy.skippedCount} unusable sample{energy.skippedCount === 1 ? '' : 's'}; energy is never added across gaps.</p>{/if}
				{#if !session.readings.length}<p class="mt-2 text-[14px] text-muted">{session.baselineId === null ? 'No gyro readings yet. Start recording on your sensor.' : 'Session reset. Waiting for readings after the reset boundary.'}</p>{/if}
			{/if}
			<p class="mt-4 text-[14px] text-muted" role="status">{session.resetting ? 'Resetting the local session…' : session.busy ? `Loading gyro readings${session.hasLoaded ? '; showing the last completed snapshot' : ''}…` : !monitoring ? 'Monitoring paused. Use Refresh now to load new gyro readings.' : session.error ? 'Gyro refresh failed. Retrying with live updates.' : session.loadedAt ? `Updated ${time(session.loadedAt)}.` : 'Waiting for gyro readings.'}</p>
			{#if session.error}<p class="mt-3 flex gap-2 text-[15px] leading-relaxed" role="alert"><TriangleAlert size={18} class="mt-0.5 shrink-0 text-lime" /><span>{session.hasLoaded ? 'Stale snapshot. ' : ''}{session.error}</span></p>{/if}
		</div>
		{#if canShowEnergy}<EnergySets sets={energy.sets} />{/if}
		<RecordingQuality summary={quality} title="Gyro session quality" label="Current gyro session" loadedAt={session.loadedAt} stale={!!session.error && session.hasLoaded} {monitoring} refreshing={session.busy} />
		<div class="mt-6 border-t border-rule pt-5">
			<button class="btn btn-line w-full sm:w-auto" type="button" disabled={!mounted || session.resetting} onclick={() => controller?.reset()}><RotateCcw size={17} />Reset energy session</button>
			<p class="mt-3 text-[13px] leading-relaxed text-muted">Starts counting future readings in this tab. Supabase history is preserved; mass and pivot settings stay selected. Settings and the reset survive reloads in this tab.</p>
			{#if storageError}<p class="mt-3 text-[13px] text-lime" role="status">{storageError}</p>{/if}
		</div>
	</div>
	<p class="mt-4 text-[13px] leading-relaxed text-muted">Assumes the load moves in a circle around the selected pivot, with the gyro rotating with it. Uses ½ × mass × distance² × angular speed² and adds only increases between smoothed samples. Gravitational work and metabolic expenditure are excluded; this estimate is not calories burned.</p>
</section>

<style>
	.pivot-choice:has(input:focus-visible) { outline: 2px solid var(--color-lime); outline-offset: 3px; }
	.pivot-choice.btn-lime:has(input:focus-visible) { outline-color: white; }
</style>
