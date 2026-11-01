ALTER TABLE public.studio_cloud_jobs ADD COLUMN IF NOT EXISTS music text NOT NULL DEFAULT 'auto';
ALTER TABLE public.studio_cloud_jobs DROP CONSTRAINT IF EXISTS studio_cloud_jobs_music_check;
ALTER TABLE public.studio_cloud_jobs ADD CONSTRAINT studio_cloud_jobs_music_check CHECK (music IN ('auto','off','energetic','chill','emotional','dramatic','inspiring','funny'));