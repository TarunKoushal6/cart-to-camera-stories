CREATE OR REPLACE FUNCTION public.require_clip_approval() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.studio_clips c WHERE c.id=NEW.clip_id AND c.user_id=NEW.user_id AND c.approved_at IS NOT NULL AND c.video_path IS NOT NULL) THEN
 RAISE EXCEPTION 'Approve the clip before posting.';
 END IF;
 RETURN NEW;
END $$;