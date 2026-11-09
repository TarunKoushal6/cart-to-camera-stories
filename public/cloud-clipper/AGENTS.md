# Cloud clipper worker

- Background music is chosen per clip (job `music` mode + AI `vibe`); unknown/none automatic moods keep original audio rather than an arbitrary uplifting track. Licensed files in music/<vibe>/ come first, else a restrained original FFmpeg bed, loudness-normalized and sidechain-ducked under speech; failed mixes preserve the clip with original audio.
- Keep the app and worker render/status batch limits aligned; the safety ceiling is not a desired clip count, and each target retains its own complete-thought timing.
- Normalize overlapping repeated word cues into a single non-overlapping timeline before ASS rendering; libass must show only one caption group at a time without deleting sequential repeated speech.
- Inspect the exact final MP4 after captions and music; store bounded frame samples behind token-protected completed-clip endpoints, and keep measured checks separate from sampled AI visual/audio limitations.
- Default Cutline rendering fits the complete source into a centered letterbox band with separate title/caption safe zones; measure black scenes only inside that band so intentional padding cannot hide an empty video. Keep the optional OpenShorts reframe engine explicit.
