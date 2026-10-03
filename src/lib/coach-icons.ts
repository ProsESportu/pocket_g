import { ArrowUpRight, Check, X } from '@lucide/svelte';
import type { CoachKind } from './coach.ts';

export const COACH_ICONS = { keep: Check, fix: X, try: ArrowUpRight } satisfies Record<CoachKind, typeof Check>;
export const COACH_WORDS: Record<CoachKind, string> = { keep: 'Keep', fix: 'Fix', try: 'Try' };
