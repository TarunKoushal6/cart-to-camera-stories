"""Optional bridge to OpenShorts commit 45c98204a26c5f00989f3d4c6180f7b42a4f51af.
Run inside its full backend image; never expose its API as a Cutline worker.
"""
from pathlib import Path
import importlib
import math

def upstream():
    return importlib.import_module('main')

def download_source(url, directory):
    video_path, _title = upstream().download_youtube_video(url, output_dir=str(directory))
    return Path(video_path)

def transcribe_source(source):
    transcript = upstream().transcribe_video(str(source))
    cues = []
    for segment in transcript.get('segments', []):
        words = segment.get('words') or []
        for word in words:
            start, end = float(word.get('start', 0)), float(word.get('end', 0))
            text = str(word.get('word', word.get('text', ''))).strip()
            if text and math.isfinite(start) and math.isfinite(end) and 0 <= start < end:
                cues.append({'start': start, 'end': end, 'text': text})
    if not cues:
        raise RuntimeError('OpenShorts returned no word-timed transcript')
    return sorted(cues, key=lambda cue: cue['start'])

def reframe_source(source, output):
    upstream().process_video_to_vertical(str(source), str(output), aspect_ratio=9 / 16, watermark=False)
    if not output.is_file():
        raise RuntimeError('OpenShorts reframe returned no file')