export type Reading = {
	id: number;
	created_at: string;
	ekg: number | null;
	emg: number | null;
	puls: number | null;
};
