ALTER TABLE public.studio_credentials DROP CONSTRAINT studio_credentials_kind_check;
ALTER TABLE public.studio_credentials ADD CONSTRAINT studio_credentials_kind_check CHECK(kind IN ('ai','facebook','cloud_worker'));
CREATE TABLE public.studio_cloud_jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, source_id uuid NOT NULL REFERENCES public.studio_sources(id) ON DELETE CASCADE, worker_url text NOT NULL, worker_job_id uuid NOT NULL, status text NOT NULL DEFAULT 'transcribing' CHECK(status IN ('transcribing','analyzing','rendering','finalizing','ready','failed')), clips jsonb NOT NULL DEFAULT '[]', error text, created_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT ON public.studio_cloud_jobs TO authenticated;
GRANT ALL ON public.studio_cloud_jobs TO service_role;
ALTER TABLE public.studio_cloud_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY cloud_jobs_owner_read ON public.studio_cloud_jobs FOR SELECT TO authenticated USING(user_id=auth.uid());