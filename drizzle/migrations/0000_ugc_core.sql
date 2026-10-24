CREATE TABLE public.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  url text NOT NULL,
  source text NOT NULL DEFAULT 'other',
  title text NOT NULL DEFAULT '',
  price text,
  image_url text,
  features text NOT NULL DEFAULT '',
  research text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.products TO authenticated;
GRANT ALL ON public.products TO service_role;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own products" ON public.products FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE TABLE public.reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  hook text NOT NULL DEFAULT '',
  voiceover text NOT NULL DEFAULT '',
  scene_1 text NOT NULL DEFAULT '',
  scene_2 text NOT NULL DEFAULT '',
  caption text NOT NULL DEFAULT '',
  hashtags text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'scripted',
  job_id text,
  stage int NOT NULL DEFAULT 0,
  video_path text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reviews TO authenticated;
GRANT ALL ON public.reviews TO service_role;
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own reviews" ON public.reviews FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE TABLE public.posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  review_id uuid NOT NULL REFERENCES public.reviews(id) ON DELETE CASCADE,
  caption text NOT NULL DEFAULT '',
  scheduled_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'scheduled',
  ig_container_id text,
  ig_media_id text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.posts TO authenticated;
GRANT ALL ON public.posts TO service_role;
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own posts" ON public.posts FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE TABLE public.instagram_accounts (
  user_id uuid PRIMARY KEY,
  ig_user_id text NOT NULL,
  username text NOT NULL DEFAULT '',
  access_token text NOT NULL,
  connected_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT (user_id, ig_user_id, username, connected_at) ON public.instagram_accounts TO authenticated;
GRANT DELETE ON public.instagram_accounts TO authenticated;
GRANT ALL ON public.instagram_accounts TO service_role;
ALTER TABLE public.instagram_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own ig read" ON public.instagram_accounts FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "own ig delete" ON public.instagram_accounts FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE POLICY "own videos read" ON storage.objects FOR SELECT TO authenticated USING (bucket_id='videos' AND (storage.foldername(name))[1] = auth.uid()::text);