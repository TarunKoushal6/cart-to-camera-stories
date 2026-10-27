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
2. Upload app.py, requirements.txt, Dockerfile and this README.md at the repository root.
3. In Space Settings, add a secret named WORKER_TOKEN with a private value you choose. Enter that same value in Cutline Settings → Cloud Clipper Worker → Secret token. Never commit this value.
4. Wait for the container build and first Whisper model download. Copy the direct https://YOUR-SPACE.hf.space URL (not the huggingface.co page) into Cutline's Worker URL.
5. Save, then use Fully Auto Cut with Cloud Worker in the studio. Only use videos you own or have permission to repurpose. Review and approve saved clips before scheduling tomorrow.

Uploading files may take minutes; container build/model downloads and processing can take longer. Free CPU inference is slow, free Spaces sleep, disk/jobs can disappear on restart, and YouTube may block data-center downloads or require cookies. No two-minute deployment or always-free availability is guaranteed. Retrying starts a new job; already saved clips remain in Cutline. No paid transcription service is used; your personal AI provider can charge for analysis/reviews.

## Docker
Build: docker build -t cutline-worker .
Run: docker run --env-file /path/to/private-worker.env -p 7860:7860 -v cutline-data:/tmp/cutline cutline-worker
The private env file contains WORKER_TOKEN and optionally WHISPER_MODEL=base. Do not commit it. Put a TLS reverse proxy in front and save its public HTTPS URL in Cutline.

## Protocol / other FastAPI hosts
The URL must implement Cutline v1: POST /jobs {id,url}; GET /jobs/{id} returns status and word-timed cues; POST /jobs/{id}/render accepts segment windows and object-scoped signed upload URLs. An arbitrary OpenShorts/Modal endpoint is not automatically compatible; deploy this container or implement the adapter. Modal infrastructure is not included, but any Docker-capable HTTPS host can run this image. Protect a public worker with WORKER_TOKEN. Leaving it blank allows public compute usage and job reads.

Cutline keeps personal AI keys and database credentials out of this worker. Only temporary signed PUT URLs for exact clip objects are sent. The worker transcribes with CPU faster-whisper, center-crops to 720×1280, burns five-word karaoke ASS captions with Noto Devanagari support, and uploads H.264/AAC MP4s under 50 MB. AI selects and reviews up to 15 distinct 20–30s moments in Cutline; predictions aren't guarantees of virality. Center cropping isn't face tracking.

The host supports videos up to 2 hours, 2 GB source downloads, three queued jobs and one media job at a time. Signed uploads expire in two hours. Longer jobs may fail; choose a shorter source or faster host. Cloud work continues without the browser, and Cutline's background schedule advances analysis and reviews. Posting stays blocked until owner approval. Do not log request bodies or signed upload URLs. Terminal jobs are retained until host restart; periodically clear /tmp/cutline for disk space.
