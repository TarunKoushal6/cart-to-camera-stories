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

- Server-only integrations live in `src/lib/*.server.ts` (AI, Firecrawl, video, Instagram); client calls go through `src/lib/ugc.functions.ts` — keeps secrets out of the browser.
- Reels are ~20s: one 10s video job plus one 10s extension job, advanced by client polling of `pollVideo` — avoids long server requests.
- Instagram posting moves posts scheduled → processing → published via `advancePost`, driven by the 5-minute `/api/public/jobs/publish-due` schedule and on-demand refreshes — Instagram processes videos asynchronously.
- The app uses a single dark theme defined in `:root` — no light/dark toggle.
- Review creation uses persisted script modes and language; custom text bypasses AI, and actions mode suppresses narration in both video stages — preserves creator intent.
- External MP4s upload directly to private owner-scoped Storage paths and attach through an authenticated verification function — avoids large server requests and cross-user attachment.

- The primary Cutline studio uses owner-scoped studio_sources, studio_clips and studio_posts; legacy product routes remain to preserve existing content.
- Personal AI and Facebook credentials are AES-GCM encrypted in service-role-only studio_credentials and accessed only after user authorization; prevents browser secret reads.
- Studio AI analysis calls the selected provider directly with the owner’s key and never falls back to Lovable AI; preserves separate provider billing.
- Local FFmpeg WASM exports source MP4s with ASS captions in the browser; the server cannot execute native video tools.
- Studio Meta posts advance via the existing protected publish-due schedule and manual refresh; asynchronous processing avoids long requests.

- YouTube OAuth uses atomic single-use hashed states bound to the authenticated owner and stores encrypted offline tokens only in server-role tables; prevents callback forgery and credential exposure.
- YouTube uploads stream saved MP4s to a validated Google resumable upload URL; Google publishAt schedules public release and the existing job polls processing status.
- YouTube counts come from videos.list statistics and join Meta metrics in the UI; missing counts remain unknown rather than zero.
- Custom AI endpoints are OpenAI-compatible chat-completions bases stored per user in studio_credentials.base_url; model lists come from the provider's /models endpoint — keeps any provider working without code changes.
- Clips require a persisted personal-AI critique and owner approval before publishing; edits invalidate both and database triggers gate Meta and YouTube queues — guarantees nothing posts without explicit consent.
- Caption text comes from free transcript windows and transcription runs in a browser Whisper worker; missing transcripts use explicitly provisional outline-based analysis — avoids transcription credit charges and pretending AI watched footage.
- Edge speech uses an authenticated server wrapper and Worker WebSocket upgrade with the current consumer token protocol; never silently fall back to paid speech — keeps generation key-free and makes service unavailability explicit.
- Batch clipping runs in the browser (FFmpeg WASM) per source file, then AI-reviews; approving schedules next-day slots — the Worker cannot render video.
- Cloud clipping uses a health-checked Cutline v1 FastAPI protocol with an optional pinned OpenShorts Python bridge, owner-bound leased resumable jobs and exact-object signed uploads; personal AI and approval-gated publishing remain in the app, because native OpenShorts APIs do not implement this contract.
- Batch scheduling keeps approved-but-unscheduled clips retryable and skips existing queued posts; next-day local slots compress for large batches so all clips remain on the promised day.
