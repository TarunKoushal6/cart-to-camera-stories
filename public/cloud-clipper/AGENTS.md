# Cloud clipper worker

- Background music is chosen per clip (job `music` mode + AI `vibe`); unknown/none automatic moods keep original audio rather than an arbitrary uplifting track. Licensed files in music/<vibe>/ come first, else a restrained original FFmpeg bed, loudness-normalized and sidechain-ducked under speech; failed mixes preserve the clip with original audio.
- Keep the app and worker render/status batch limits aligned; the safety ceiling is not a desired clip count, and each target retains its own complete-thought timing.
- Normalize overlapping repeated word cues into a single non-overlapping timeline before ASS rendering; libass must show only one caption group at a time without deleting sequential repeated speech.
