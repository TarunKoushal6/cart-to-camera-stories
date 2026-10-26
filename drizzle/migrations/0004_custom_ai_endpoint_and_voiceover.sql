ALTER TABLE public.studio_credentials ADD COLUMN base_url text;
ALTER TABLE public.studio_clips ADD COLUMN voiceover text;
ALTER TABLE public.studio_clips ADD COLUMN approved_at timestamptz;