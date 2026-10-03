-- Applied to hackyeah2026 with user approval via the Supabase migration tool.
-- Anonymous clients can read these sample rows. RLS remains enabled.
grant select on table public.ekgemgpuls to anon;
create policy "Public can read sample readings"
on public.ekgemgpuls for select to anon using (true);
