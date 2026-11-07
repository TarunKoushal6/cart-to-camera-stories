# Cloud clipper worker

- Background music is chosen per clip (job `music` mode + AI `vibe`) and mixed by the worker: licensed files in music/<vibe>/ first, else an FFmpeg-synthesised original bed, sidechain-ducked under speech; a failed mix falls back to original audio — the Worker runtime can't mix audio and clips must never be lost to music.
- Normalize overlapping repeated word cues into a single non-overlapping timeline before ASS rendering; libass must show only one caption group at a time without deleting sequential repeated speech.
