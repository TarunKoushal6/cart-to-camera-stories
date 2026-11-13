<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Subdirectories may have their own `AGENTS.md` (e.g. `public/cloud-clipper/`); read it before changing files there.
- Server-only integrations live in `src/lib/*.server.ts` (AI, Firecrawl, video, Instagram); client calls go through `src/lib/ugc.functions.ts` — keeps secrets out of the browser.
- Reels are ~20s: one 10s video job plus one 10s extension job, advanced by client polling of `pollVideo` — avoids long server requests.
- Instagram posting moves posts scheduled → processing → published via `advancePost`, driven by the 5-minute `/api/public/jobs/publish-due` schedule and on-demand refreshes — Instagram processes videos asynchronously.
- The app uses a single dark theme defined in `:root` — no light/dark toggle.
- Review creation uses persisted script modes and language; custom text bypasses AI, and actions mode suppresses narration in both video stages — preserves creator intent.
- External MP4s upload directly to private owner-scoped Storage paths and attach through an authenticated verification function — avoids large server requests and cross-user attachment.

- The primary Cutline studio uses owner-scoped studio_sources, studio_clips and studio_posts; legacy product routes remain to preserve existing content.
- Personal AI and Facebook credentials are AES-GCM encrypted in service-role-only studio_credentials and accessed only after user authorization; prevents browser secret reads.
- Studio AI calls go through withAi (src/lib/studio-ai-default.server.ts): owner's saved key first, then built-in Lovable AI (DEFAULT_AI, low-cost model via LOVABLE_API_KEY on chat-completions) when no key is saved, it can't be decrypted, or it's refused/down (401/402/403/429/5xx) — clipping works with no external keys; built-in 402/429 get actionable messages.
- Local FFmpeg WASM exports source MP4s with ASS captions in the browser; the server cannot execute native video tools.
- Default cloud composition is owned by the downloadable worker, not the legacy browser exporter; deployment needs the published worker file and VPS restart so saved clips reflect current framing.

- YouTube OAuth uses atomic single-use hashed states bound to the authenticated owner and stores encrypted offline tokens only in server-role tables; prevents callback forgery and credential exposure.
- YouTube uploads stream saved MP4s to a validated Google resumable upload URL; Google publishAt schedules public release and the existing job polls processing status.
- YouTube counts come from videos.list statistics and join Meta metrics in the UI; missing counts remain unknown rather than zero.
- Custom AI endpoints are OpenAI-compatible chat-completions bases stored per user in studio_credentials.base_url; model lists come from the provider's /models endpoint — keeps any provider working without code changes.
- Clips require a saved video and owner approval before publishing (AI critique is optional); the clip page's Post Now/Schedule click is the approval, edits invalidate approval and database triggers gate Meta and YouTube queues — guarantees nothing posts without explicit consent.
- Caption text comes from free transcript windows and transcription runs in a browser Whisper worker; missing transcripts use explicitly provisional outline-based analysis — avoids transcription credit charges and pretending AI watched footage.
- Edge speech uses an authenticated server wrapper and Worker WebSocket upgrade with the current consumer token protocol; never silently fall back to paid speech — keeps generation key-free and makes service unavailability explicit.
- Batch clipping runs in the browser (FFmpeg WASM) per source file, then AI-reviews; approving schedules next-day slots — the Worker cannot render video.
- Cloud clipping uses a health-checked Cutline v1 FastAPI protocol with an optional pinned OpenShorts Python bridge, owner-bound leased resumable jobs and exact-object signed uploads; personal AI and approval-gated publishing remain in the app, because native OpenShorts APIs do not implement this contract.
- Batch scheduling keeps approved-but-unscheduled clips retryable and skips existing queued posts; next-day local slots compress for large batches so all clips remain on the promised day.
- Accounts without a saved cloud worker use the shared DEFAULT_CLOUD_WORKER_URL (optional CLOUD_WORKER_TOKEN secret); worker fetches use redirect:"manual" and reject 3xx — Workers runtime doesn't support redirect:"error".
- Cloud worker reports a stage/progress object on /jobs/{id}; the app reads it through a read-only progress function that never claims the job lease — keeps live progress cheap and separate from job advancement.
- Cloud jobs attach each clip as soon as the worker lists it in `completed`, and a worker failure keeps already-finished clips before marking the job failed — long batches show results early and a late crash never discards finished work.
- Map all topics uniformly, refine bounded original speech and deduplicate takeaways; review final worker frames/metrics after edits with explicit sampling/audio limits. Use typed Gateway SDK calls.
- Stopping a cloud job marks it failed with STOPPED_MESSAGE, then best-effort calls the worker's `/jobs/{id}/cancel`; all job-state updates in advancement are guarded to active statuses so a late tick never revives a stopped job.
- The root route clears the React Query cache whenever the signed-in user changes — cached videos/clips must never leak to the next account in the same browser.

- The YouTube OAuth callback keeps the previously saved refresh_token when Google omits it on re-consent and shows only explicitly safe failure reasons (never codes/tokens), also posted to the opener — users see why connecting failed.
- Studio Meta posts also advance via the publish-due schedule; the clip page polls only its own new posts through `getPublishStatus` (advances Meta/YouTube processing rows, owner-scoped via RLS) every 4s until published/scheduled/failed; immediate Meta failures throw the stored platform error — users see real outcomes, never a false "started".
- Buffer auto-post: the 5-minute publish-due tick claims each daily slot once and shareNow-posts one random unposted reel with a long signed URL; Buffer fetches media at publish time, so never pre-queue expiring links.
