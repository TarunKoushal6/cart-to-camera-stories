ALTER TABLE public.studio_cloud_jobs ADD COLUMN IF NOT EXISTS processing_token uuid, ADD COLUMN IF NOT EXISTS processing_until timestamptz;
CREATE OR REPLACE FUNCTION public.claim_cloud_job(_job_id uuid, _owner_id uuid, _token uuid) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  UPDATE public.studio_cloud_jobs SET processing_token = _token, processing_until = now() + interval '3 minutes'
  WHERE id = _job_id AND user_id = _owner_id AND status NOT IN ('ready','failed') AND (processing_until IS NULL OR processing_until < now());
  RETURN FOUND;
END; $$;
REVOKE ALL ON FUNCTION public.claim_cloud_job(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_cloud_job(uuid, uuid, uuid) TO service_role;
COMMENT ON FUNCTION public.claim_cloud_job(uuid, uuid, uuid) IS 'Service-only bounded lease; callers must authorize the owner before claiming. Expired leases allow interrupted analysis and finalization to resume.';