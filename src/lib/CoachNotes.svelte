<script lang="ts">
	import type { CoachKind, CoachNote } from './coach';
	import { COACH_ICONS, COACH_WORDS } from './coach-icons';

	let { notes, readingCount, selected = $bindable(null) }: { notes: CoachNote[]; readingCount: number; selected?: string | null } = $props();
	const uid = $props.id();
	const KINDS: { kind: CoachKind; phrase: string }[] = [{ kind: 'fix', phrase: 'to fix' }, { kind: 'try', phrase: 'to try' }, { kind: 'keep', phrase: 'to keep' }];
	const time = (value: string) => Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Europe/Warsaw' }).format(new Date(value)) : 'Timestamp unavailable';
	const range = (note: CoachNote) => {
		if (!note.from) return '';
		const [from, to] = [time(note.from), note.to ? time(note.to) : ''];
		return to && to !== from ? `${from}–${to}` : from;
	};
	// Announced only when the mix of notes changes, not on every five-second refresh.
	let summary = $derived(notes.length ? `Coach’s notes: ${KINDS.map(({ kind, phrase }) => [notes.filter((note) => note.kind === kind).length, phrase] as const).filter(([count]) => count).map(([count, phrase]) => `${count} ${phrase}`).join(', ')}.` : '');
	let linked = $derived(notes.some((note) => note.fromId !== undefined));
</script>

{#snippet body(note: CoachNote, active: boolean)}
	{@const Icon = COACH_ICONS[note.kind]}
	<span aria-hidden="true" class={['grid size-8 shrink-0 place-items-center text-night transition-colors duration-150', active ? 'bg-white' : 'bg-lime']}><Icon size={18} strokeWidth={2.75} /></span>
	<span class="min-w-0 flex-1">
		<span class="flex flex-wrap items-baseline gap-x-3">
			<span class="label text-lime">{COACH_WORDS[note.kind]}</span>
			{#if note.from}<span class="text-[13px] text-muted tabular-nums">{range(note)}</span>{/if}
		</span>
		<span class="mt-1.5 block text-[16px] leading-[1.55] text-white">{note.text}</span>
	</span>
{/snippet}

<section class="min-w-0" aria-labelledby={`${uid}-title`}>
	<h2 id={`${uid}-title`} class="display text-[28px] md:text-[32px]"><span class="text-lime">Coach’s</span> <span class="outline-text">notes</span></h2>
	<p class="mt-3 text-[15px] leading-relaxed text-muted">{readingCount ? `Sensor checks over the last ${readingCount} readings, plus the latest ECG and experimental EMG findings. Times are in Warsaw.` : 'Sensor checks and the latest ECG and experimental EMG findings. Times are in Warsaw.'}</p>
	<p class="sr-only" aria-live="polite">{summary}</p>
	{#if notes.length}
		<ul class="mt-5 -mx-3 space-y-2" role="list">
			{#each notes as note (note.id)}
				<li>
					{#if note.fromId !== undefined}
						<button type="button" class={['flex w-full gap-4 border-l-2 px-3 py-3 text-left transition-colors duration-150 hover:bg-raised', selected === note.id ? 'border-lime bg-raised' : 'border-transparent']} aria-pressed={selected === note.id} onclick={() => (selected = selected === note.id ? null : note.id)}>
							{@render body(note, selected === note.id)}
						</button>
					{:else}
						<div class="flex gap-4 border-l-2 border-transparent px-3 py-3">{@render body(note, false)}</div>
					{/if}
				</li>
			{/each}
		</ul>
		{#if linked}<p class="mt-3 text-[14px] text-muted">Select a note to mark its moment on the strip.</p>{/if}
	{:else}
		<p class="mt-5 text-[16px] leading-[1.55] text-white">Signal checks appear once a few readings have arrived.</p>
	{/if}
</section>
