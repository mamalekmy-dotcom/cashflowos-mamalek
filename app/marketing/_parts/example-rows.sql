-- Example rows for the Marketing tab — for the OWNER to run once in the Supabase
-- SQL Editor (team members don't hold the keys). INSERT ONLY: it adds 5 rows in
-- the new 'campaign' category, each titled "EXAMPLE — …", and touches nothing else.
-- Safe to re-run: it skips if any EXAMPLE campaign already exists.
-- To remove them later: delete only rows where category='campaign' and title like 'EXAMPLE — %'.
insert into records (title, status, amount, category, due_date, notes, meta)
select * from (values
  ('EXAMPLE — Raya promo search ads',   'running', 1500, 'campaign', current_date + 14, 'Search ads on "nasi lemak catering"', '{"channel":"Google Ads","spent":820,"leads":34}'::jsonb),
  ('EXAMPLE — Lunch set FB + IG ads',   'running', 1200, 'campaign', current_date + 10, 'Retargeting page visitors',           '{"channel":"Meta Ads","spent":640,"leads":41}'::jsonb),
  ('EXAMPLE — Viral kitchen video boost','running',  800, 'campaign', current_date + 7,  'Spark ads on our best TikTok',        '{"channel":"TikTok Ads","spent":510,"leads":22}'::jsonb),
  ('EXAMPLE — Merdeka weekend deal',    'ended',    600, 'campaign', current_date - 20, 'Finished — good cost per lead',       '{"channel":"Meta Ads","spent":600,"leads":30}'::jsonb),
  ('EXAMPLE — Year-end catering push',  'planned', 2000, 'campaign', current_date + 45, 'Starts next month',                   '{"channel":"Google Ads","spent":0,"leads":0}'::jsonb)
) as seed(title, status, amount, category, due_date, notes, meta)
where not exists (select 1 from records where category = 'campaign' and title like 'EXAMPLE — %');
