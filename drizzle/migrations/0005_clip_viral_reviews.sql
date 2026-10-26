ALTER TABLE public.studio_clips ADD COLUMN viral_review jsonb;
CREATE OR REPLACE FUNCTION public.invalidate_clip_review() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
 IF NEW.caption IS DISTINCT FROM OLD.caption OR NEW.voiceover IS DISTINCT FROM OLD.voiceover OR NEW.start_seconds IS DISTINCT FROM OLD.start_seconds OR NEW.end_seconds IS DISTINCT FROM OLD.end_seconds OR NEW.video_path IS DISTINCT FROM OLD.video_path THEN
   NEW.approved_at := NULL;
   NEW.viral_review := NULL;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER studio_clip_review_invalidation BEFORE UPDATE ON public.studio_clips FOR EACH ROW EXECUTE FUNCTION public.invalidate_clip_review();
CREATE OR REPLACE FUNCTION public.require_clip_approval() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.studio_clips c WHERE c.id=NEW.clip_id AND c.user_id=NEW.user_id AND c.approved_at IS NOT NULL AND c.video_path IS NOT NULL AND c.viral_review IS NOT NULL) THEN
 RAISE EXCEPTION 'Review the clip with your AI and approve it before posting.';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER studio_posts_require_approval BEFORE INSERT ON public.studio_posts FOR EACH ROW EXECUTE FUNCTION public.require_clip_approval();
CREATE TRIGGER youtube_posts_require_approval BEFORE INSERT ON public.youtube_posts FOR EACH ROW EXECUTE FUNCTION public.require_clip_approval();