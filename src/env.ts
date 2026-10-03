import { defineEnvVars } from '@sveltejs/kit/env';

export const variables = defineEnvVars({
	PUBLIC_SUPABASE_URL: { public: true, schema: (value) => value ?? '' },
	PUBLIC_SUPABASE_PUBLISHABLE_KEY: { public: true, schema: (value) => value ?? '' }
});
