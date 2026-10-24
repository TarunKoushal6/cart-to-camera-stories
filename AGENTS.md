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
