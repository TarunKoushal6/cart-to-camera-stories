---
title: Cutline Cloud Clipper
emoji: ✂️
colorFrom: green
colorTo: gray
sdk: docker
app_port: 7860
pinned: false
---
# Cutline Cloud Clipper

## Hugging Face Spaces (free CPU tier where available)
1. Create a Space at https://huggingface.co/new-space, choose **Docker / Blank**, and the free CPU hardware.
2. Upload app.py, openshorts_adapter.py, requirements.txt, Dockerfile and this README.md at the repository root. This is Cutline's independent worker, not OpenShorts.
3. In Space Settings, add a secret named WORKER_TOKEN with a private value you choose. Enter that same value in Cutline Settings → Cloud Clipper Worker → Secret token. Never commit this value.
4. Wait for the container build and first Whisper model download. Copy the direct https://YOUR-SPACE.hf.space URL (not the huggingface.co page) into Cutline's Worker URL.
5. Save, then use Fully Auto Cut with Cloud Worker in the studio. Only use videos you own or have permission to repurpose. Review and approve saved clips before scheduling tomorrow.

Uploading files may take minutes; container build/model downloads and processing can take longer. Free CPU inference is slow, free Spaces sleep, disk/jobs can disappear on restart, and YouTube may block data-center downloads or require cookies. No two-minute deployment or always-free availability is guaranteed. Retrying starts a new job; already saved clips remain in Cutline. No paid transcription service is used; your personal AI provider can charge for analysis/reviews.

## Docker
Build: docker build -t cutline-worker .
Run: docker run --env-file /path/to/private-worker.env -p 7860:7860 -v cutline-data:/tmp/cutline cutline-worker
The private env file contains WORKER_TOKEN and optionally WHISPER_MODEL=base. Speed: the worker first uses the video's existing YouTube captions (YOUTUBE_SUBTITLES=1, languages from YOUTUBE_SUB_LANGS, default en,hi,en-orig,hi-orig, original-language tracks preferred) and only transcribes audio when none exist; fallback Whisper uses WHISPER_THREADS (default: all CPU cores) and WHISPER_BEAM_SIZE=1. Do not commit it. Put a TLS reverse proxy in front and save its public HTTPS URL in Cutline.

## Protocol / other FastAPI hosts
The URL must implement Cutline v1: POST /jobs {id,url}; GET /jobs/{id} returns status and word-timed cues; POST /jobs/{id}/render accepts segment windows and object-scoped signed upload URLs. An arbitrary OpenShorts/Modal endpoint is not automatically compatible; deploy this container or implement the adapter. Modal infrastructure is not included, but any Docker-capable HTTPS host can run this image. Protect a public worker with WORKER_TOKEN. Leaving it blank allows public compute usage and job reads.

Cutline keeps personal AI keys and database credentials out of this worker. Only temporary signed PUT URLs for exact clip objects are sent. The worker transcribes with CPU faster-whisper, center-crops to 720×1280, burns five-word karaoke ASS captions with Noto Devanagari support, and uploads H.264/AAC MP4s under 50 MB. AI selects and reviews up to 15 distinct 20–30s moments in Cutline; predictions aren't guarantees of virality. Center cropping isn't face tracking.

The host supports videos up to 2 hours, 2 GB source downloads, three queued jobs and one media job at a time. Signed uploads expire in two hours. Longer jobs may fail; choose a shorter source or faster host. Cloud work continues without the browser: the protected app schedule checks every five minutes, and an open source panel also advances jobs. Keep that existing schedule active; unpublished/local apps cannot receive hosted callbacks. Interrupted app processing resumes after a three-minute lease expires. Posting stays blocked until owner approval. Do not log request bodies or signed upload URLs. Terminal jobs are retained until host restart; periodically clear /tmp/cutline for disk space.

## Actual OpenShorts integration (optional, heavier Docker deployment)

Upstream: https://github.com/mutonby/openshorts — MIT, inspected at commit `45c98204a26c5f00989f3d4c6180f7b42a4f51af`.
Its native `/api/process` and `/mcp` are **not** Cutline worker endpoints. Saving a worker checks authenticated `/health` for `cutline-v1`; don't paste an OpenShorts native API URL into Settings.

The included `openshorts_adapter.py` reuses upstream `main.download_youtube_video`, `main.transcribe_video`, and `main.process_video_to_vertical`. Cutline still uses your personal AI endpoint to choose 20–30s intervals and critique each clip; the adapter extracts each interval, uses OpenShorts vertical reframing, burns Cutline ASS karaoke captions, and uploads to exact-object signed URLs. It does not call OpenShorts' Gemini picker or social posting API.

Build the complete upstream backend first (Docker, internet access for dependencies/models, enough disk/RAM, and optionally GPU):

```sh
git clone https://github.com/mutonby/openshorts.git openshorts
git -C openshorts checkout 45c98204a26c5f00989f3d4c6180f7b42a4f51af
docker build -t openshorts-base:cutline-pinned openshorts
# From the directory containing Cutline's downloaded worker files:
docker build -f Dockerfile.openshorts -t cutline-openshorts-worker .
docker run --env-file /path/to/private-worker.env -p 7860:7860 \
  -v cutline-data:/tmp/cutline -v openshorts-models:/app/.cache/huggingface \
  cutline-openshorts-worker
```

Start only the adapter API, not OpenShorts' dashboard/API/renderer. Put TLS in front of port 7860 and enter that HTTPS origin and WORKER_TOKEN in Cutline. The image pins the reviewed source; upstream changes can break the bridge. CPU works but full OpenShorts imports initialize heavyweight vision/model dependencies. Neither this full-image deployment nor face tracking is verified on free Spaces; it is not a turnkey two-minute Hugging Face/Modal deployment. Modal setup is not supplied. The adapter health handshake proves protocol/authentication only, not model availability or successful downloading.

Not included: OpenShorts Gemini scene-aware moment selection, AI-generated Shorts, Remotion templates/renderer, dubbing/ElevenLabs, fal.ai or Upload-Post publishing, its dashboard or hosted-service subscriptions. OpenShorts reframe may fall back to its simpler implementation; no guarantee of face tracking quality. Those upstream features have their own services, credentials, hardware and license/model terms. Cutline's free worker remains the default center-crop option.

YouTube can reject either downloader. The default image includes Deno for current yt-dlp JavaScript challenges. For authorized videos needing cookies, mount a private Netscape-format cookie file and set YOUTUBE_COOKIES_FILE on the default worker, or simply place `cookies.txt` next to `app.py` (or in the data folder) and it is picked up automatically. Empty cookie files are ignored. Alternatively set YOUTUBE_COOKIES_BROWSER=chrome (or firefox/edge) to read cookies from a logged-in browser on the same machine; no browser is used unless you set it, because Edge/Chrome decryption in an Administrator Windows shell fails with a DPAPI error (yt-dlp issue 10927). If yt-dlp reports a cookie/DPAPI error, the worker retries once without cookies. When no cookies are loaded the worker passes `--extractor-args youtube:player_client=tv,android,web_safari` (with cookies it uses yt-dlp defaults, because desktop cookies are rejected by TV/Android clients); override it with YOUTUBE_EXTRACTOR_ARGS or set it to `none` to use yt-dlp's own defaults; never upload cookies to Cutline or commit them. OpenShorts uses its upstream download configuration. Neither path bypasses YouTube permissions or guarantees access.

## Approval and next-day scheduling

Successful MP4s are stored privately under the owner's clip paths and AI-reviewed. Open the source's review list, select clips, choose Instagram or Facebook, then press Approve & schedule tomorrow. No post is queued without that explicit action. Existing queued clips are skipped on retry; approved but unscheduled clips remain selectable. Slots use your browser's local timezone, start tomorrow at 10:00 and normally run two hours apart; larger batches compress the spacing to keep all 15 clips within tomorrow. Scheduling uses the day you approve, not the day you started processing. YouTube Shorts scheduling remains in the individual clip editor. Connect the intended social account first; live platform acceptance is not guaranteed by a worker render.

## Updating a running worker / troubleshooting downloads

Replace `app.py` with the latest download and restart the worker. Keep yt-dlp current, because YouTube changes often:

```
pip install -U "yt-dlp[default]"
```

Install Deno (https://deno.land) on the worker host for YouTube's JavaScript checks; the worker uses it automatically when present. Failed jobs now report the specific reason (bot check, outdated yt-dlp, private/age-restricted video, missing FFmpeg, out of memory) in the app, and the full details print in the worker console. While downloading, the worker reports bytes downloaded, total size, speed and time left; the app shows them as a progress bar.
