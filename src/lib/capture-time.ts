/** Capture time in milliseconds, retaining the fractional millisecond in Postgres timestamps. */
export function captureMilliseconds(value: unknown): number {
	if (typeof value !== 'string') return NaN;
	const milliseconds = Date.parse(value);
	if (!Number.isFinite(milliseconds)) return NaN;
	const fraction = value.match(/\.(\d+)(?:Z|[+-]\d{2}(?::?\d{2})?)$/)?.[1];
	return milliseconds + (fraction ? (Number(`0.${fraction}`) * 1000) % 1 : 0);
}
