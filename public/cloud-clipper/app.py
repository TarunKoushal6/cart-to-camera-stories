"""Cutline protocol v1: download/transcribe, then render scoped signed-upload targets.
No database/service-role key or personal AI key is needed on this worker.
"""
import os, json, uuid, secrets, shutil, subprocess, threading, re
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urlparse
import requests
from fastapi import FastAPI, Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, Field, HttpUrl
from faster_whisper import WhisperModel

ROOT = Path(os.getenv('DATA_DIR', '/tmp/cutline')); ROOT.mkdir(parents=True, exist_ok=True)
TOKEN = os.getenv('WORKER_TOKEN', '')
AUTH = HTTPBearer(auto_error=False)
POOL = ThreadPoolExecutor(max_workers=1)
LOCK = threading.Lock()
MODEL_LOCK = threading.Lock()
MODEL = None
app = FastAPI(title='Cutline Cloud Clipper', version='1.0')

def authorized(c: HTTPAuthorizationCredentials | None = Depends(AUTH)):
    if TOKEN and (not c or not secrets.compare_digest(c.credentials, TOKEN)):
        raise HTTPException(401, 'Invalid worker token')

class Intake(BaseModel):
    id: uuid.UUID
    url: HttpUrl

class Segment(BaseModel):
    title: str = Field(max_length=200)
    start: float = Field(ge=0)
    end: float
    score: int = Field(ge=0, le=100)
    reason: str = Field(max_length=1000)

class Target(BaseModel):
    id: uuid.UUID
    path: str
    segment: Segment
    upload_url: HttpUrl

class Render(BaseModel):
    targets: list[Target] = Field(min_length=1, max_length=15)

def folder(job):
    return ROOT / str(job)

def read(job):
    p = folder(job) / 'state.json'
    if not p.exists(): raise HTTPException(404, 'Job not found; sleeping/restarted free hosts can lose jobs')
    return json.loads(p.read_text())

def write(job, **fields):
    with LOCK:
        p = folder(job) / 'state.json'
        data = json.loads(p.read_text()) if p.exists() else {}
        data.update(fields)
        tmp = p.with_suffix('.tmp'); tmp.write_text(json.dumps(data, ensure_ascii=False)); tmp.replace(p)

def run(args, timeout=7200):
    # Logs never contain signed upload URLs, bearer tokens or provider keys.
    r = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout)
    if r.returncode: raise RuntimeError('Media command failed (download blocked, unsupported media or insufficient memory)')
    return r.stdout.decode()

def download(job, url):
    try:
        d = folder(job)
        run(['yt-dlp', '--no-playlist', '--max-filesize', '2G', '--match-filter', 'duration <= 7200',
             '-f', 'bestvideo[height<=720]+bestaudio/best[height<=720]', '--merge-output-format', 'mp4',
             '-o', str(d / 'source.%(ext)s'), url])
        files = list(d.glob('source.*'))
        source = next((p for p in files if p.suffix in ['.mp4', '.webm', '.mkv']), None)
        if source is None: raise RuntimeError('No video downloaded')
        probe = json.loads(run(['ffprobe', '-v', 'error', '-show_format', '-of', 'json', str(source)]))
        duration = float(probe['format']['duration'])
        if not 20 <= duration <= 7200: raise RuntimeError('Supported duration is 20 seconds to 2 hours')
        audio = d / 'audio.wav'
        run(['ffmpeg', '-y', '-i', str(source), '-vn', '-ac', '1', '-ar', '16000', str(audio)])
        global MODEL
        with MODEL_LOCK:
            if MODEL is None: MODEL = WhisperModel(os.getenv('WHISPER_MODEL', 'base'), device='cpu', compute_type='int8')
            segments, info = MODEL.transcribe(str(audio), word_timestamps=True, vad_filter=True)
            cues = []
            for s in segments:
                for w in s.words or []:
                    if w.word.strip() and w.end > w.start:
                        cues.append({'start': w.start, 'end': w.end, 'text': w.word.strip()})
        if not cues or len(cues) > 15000: raise RuntimeError('No speech found or transcript too long')
        write(job, status='analyzed', duration=duration, cues=cues, source=str(source))
        audio.unlink(missing_ok=True)
    except Exception:
        write(job, status='failed')

def stamp(t):
    centis = max(0, round(t * 100)); h, rem = divmod(centis, 360000); m, rem = divmod(rem, 6000); s, c = divmod(rem, 100)
    return f'{h}:{m:02}:{s:02}.{c:02}'

def escaped(s):
    # Do not allow transcript words to inject ASS formatting/directives.
    return s.replace('\\', '').replace('{', '').replace('}', '').replace('\n', ' ')

def captions(path, cues, start, end):
    header = '''[Script Info]
ScriptType: v4.00+
PlayResX: 720
PlayResY: 1280
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Main,Noto Sans Devanagari,44,&H0000FFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,3,1,2,45,45,250,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
'''
    words = [c for c in cues if c['end'] > start and c['start'] < end]
    lines = []
    for i in range(0, len(words), 5):
        group = words[i:i+5]; a = max(start, group[0]['start']); b = min(end, group[-1]['end'])
        text = ''.join('{\\kf%d}%s ' % (max(1, round((min(end,w['end'])-max(start,w['start']))*100)), escaped(w['text'])) for w in group)
        lines.append(f'Dialogue: 0,{stamp(a-start)},{stamp(b-start)},Main,,0,0,0,,{text.strip()}')
    path.write_text(header + '\n'.join(lines), encoding='utf-8')

def render(job, targets):
    try:
        state = read(job); source = Path(state['source']); d = folder(job); completed = []
        for t in targets:
            s = t.segment
            if not 20 <= s.end-s.start <= 30 or s.end > state['duration']: raise RuntimeError('Invalid clip window')
            ass = d / f'{t.id}.ass'; output = d / f'{t.id}.mp4'
            captions(ass, state['cues'], s.start, s.end)
            filters = f'scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,setsar=1,ass={ass}'
            run(['ffmpeg', '-y', '-ss', str(s.start), '-i', str(source), '-t', str(s.end-s.start),
                 '-vf', filters, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p',
                 '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', '-threads', '2', str(output)])
            if output.stat().st_size > 50*1024*1024: raise RuntimeError('Clip exceeds 50 MB')
            # URL supplied by Cutline grants PUT to this exact object only (expires in 2h).
            u = urlparse(str(t.upload_url))
            if u.scheme != 'https' or not u.hostname or not u.hostname.endswith('.supabase.co') or '/storage/v1/object/upload/sign/' not in u.path:
                raise RuntimeError('Only scoped storage upload URLs are accepted')
            with output.open('rb') as f:
                response = requests.put(str(t.upload_url), data=f, headers={'Content-Type':'video/mp4'}, timeout=180, allow_redirects=False)
            if not 200 <= response.status_code < 300: raise RuntimeError('Signed upload failed or expired')
            completed.append(str(t.id)); write(job, completed=completed)
            output.unlink(); ass.unlink()
        write(job, status='complete', completed=completed)
        source.unlink(missing_ok=True)
    except Exception:
        write(job, status='failed')

@app.get('/health')
def health(): return {'ok': True, 'protocol': 'cutline-v1', 'protected': bool(TOKEN)}

@app.post('/jobs', dependencies=[Depends(authorized)])
def start(body: Intake):
    u = urlparse(str(body.url))
    if u.scheme != 'https' or u.hostname not in ['www.youtube.com','youtube.com','youtu.be','m.youtube.com']:
        raise HTTPException(400, 'Only authorized YouTube URLs are supported')
    if u.username or u.password or u.port: raise HTTPException(400, 'Invalid YouTube URL')
    d = folder(body.id)
    with LOCK:
        if (d / 'state.json').exists(): return {'id': str(body.id)}
        active = sum(1 for p in ROOT.glob('*/state.json') if json.loads(p.read_text()).get('status') in ['transcribing','analyzed','rendering'])
        if active >= 3: raise HTTPException(429, 'Worker queue full')
        d.mkdir(exist_ok=True)
    write(body.id, status='transcribing', completed=[])
    POOL.submit(download, body.id, str(body.url))
    return {'id': str(body.id)}

@app.get('/jobs/{job}', dependencies=[Depends(authorized)])
def status(job: uuid.UUID):
    s = read(job)
    return {k: s[k] for k in ['status','duration','cues','completed'] if k in s}

@app.post('/jobs/{job}/render', dependencies=[Depends(authorized)])
def begin_render(job: uuid.UUID, body: Render):
    with LOCK:
        s = read(job)
        if s['status'] in ['rendering','complete']: return {'accepted': True}
        if s['status'] != 'analyzed': raise HTTPException(409, 'Transcript not ready')
        p = folder(job) / 'state.json'; s['status'] = 'rendering'; p.write_text(json.dumps(s))
    POOL.submit(render, job, body.targets)
    return {'accepted': True}
