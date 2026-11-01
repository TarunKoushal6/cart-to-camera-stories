import traceback
"""Cutline protocol v1: download/transcribe, then render scoped signed-upload targets.
No database/service-role key or personal AI key is needed on this worker.
"""
import os, json, uuid, secrets, shutil, subprocess, threading, re, time, logging
from collections import deque
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urlparse
import requests
from fastapi import FastAPI, Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, Field, HttpUrl
from faster_whisper import WhisperModel

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
log = logging.getLogger('cutline')
ROOT = Path(os.getenv('DATA_DIR') or Path(__file__).resolve().parent / 'data'); ROOT.mkdir(parents=True, exist_ok=True)
TOKEN = os.getenv('WORKER_TOKEN', '')
AUTH = HTTPBearer(auto_error=False)
POOL = ThreadPoolExecutor(max_workers=1)
LOCK = threading.Lock()
MODEL_LOCK = threading.Lock()
MODEL = None
ENGINE = os.getenv('CLIPPER_ENGINE', 'cutline')
if ENGINE not in ('cutline', 'openshorts'):
    raise RuntimeError('CLIPPER_ENGINE must be cutline or openshorts')
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

class StepError(RuntimeError):
    """Message is safe to show to the app owner (no URLs with tokens, keys or paths)."""

def run(args, timeout=14400, failure='Media command failed', cwd=None):
    # Logs never contain signed upload URLs, bearer tokens or provider keys.
    try:
        r = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout, cwd=cwd)
    except FileNotFoundError:
        raise StepError(f'{args[0]} is not installed on the worker. Install FFmpeg/yt-dlp and restart.')
    except subprocess.TimeoutExpired:
        raise StepError(f'{failure}: timed out.')
    if r.returncode:
        err = r.stderr.decode(errors='replace')
        log.error('%s failed: %s', args[0], err[-2000:])
        # FFmpeg stderr names only local files; yt-dlp output is summarised elsewhere.
        detail = f"\nFFmpeg said: {err.strip()[-600:]}" if args[0] == 'ffmpeg' else ''
        raise StepError(f'{failure}. See worker console for details.{detail}')
    return r.stdout.decode()

def explain_download(output):
    s = output.lower()
    if 'no such option' in s or 'unrecognized arguments' in s:
        return 'yt-dlp on the worker is outdated. Run: pip install -U "yt-dlp[default]" and restart the worker.'
    if 'sign in to confirm' in s or 'not a bot' in s:
        using = 'cookies are loaded but may be expired or logged out' if cookie_args() else 'no cookies are loaded'
        return ('YouTube blocked this worker as a bot ("Sign in to confirm you are not a bot"); ' + using + '. Fix: '
                '1) pip install -U "yt-dlp[default]" and install Deno, then restart. '
                '2) Export cookies.txt from a browser logged into YouTube (Netscape format, e.g. "Get cookies.txt LOCALLY" extension) '
                'and put it next to app.py, or set YOUTUBE_COOKIES_FILE=/path/cookies.txt. '
                '3) Or set YOUTUBE_COOKIES_BROWSER=chrome if YouTube is logged in on this machine\'s browser. '
                'On Windows as Administrator, browser cookies often fail with a DPAPI error; use cookies.txt instead. '
                '4) Try other player clients, e.g. YOUTUBE_EXTRACTOR_ARGS="youtube:player_client=tv,web_safari" '
                '(default is ' + DEFAULT_EXTRACTOR_ARGS + '; set YOUTUBE_EXTRACTOR_ARGS=none to disable). '
                'Datacenter/VPS IPs may still need cookies or a residential proxy.')
    if 'private video' in s or 'members-only' in s or 'join this channel' in s:
        return 'This video is private or members-only.'
    if 'confirm your age' in s or 'age-restricted' in s:
        return 'This video is age-restricted; the worker needs YouTube cookies (YOUTUBE_COOKIES_FILE).'
    if 'video unavailable' in s or 'has been removed' in s:
        return 'This video is unavailable or removed.'
    if 'larger than max-filesize' in s:
        return 'Video is larger than the 2 GB limit at 720p.'
    if 'does not pass filter' in s:
        return 'Video is longer than the 4 hour limit.'
    if 'requested format is not available' in s or 'only images are available' in s:
        return 'YouTube gave no downloadable format. Update yt-dlp and install Deno on the worker.'
    if 'ffmpeg' in s and ('not found' in s or 'not installed' in s):
        return 'FFmpeg is not installed on the worker; yt-dlp needs it to merge video and audio.'
    if 'http error 403' in s:
        return 'YouTube refused the download (403). Update yt-dlp, install Deno, or add YouTube cookies.'
    if 'http error 429' in s or 'too many requests' in s:
        return 'YouTube is rate-limiting this worker (429). Wait a while or add YouTube cookies.'
    if 'timed out' in s or 'name or service not known' in s or 'connection' in s and 'error' in s:
        return 'The worker could not reach YouTube. Check its internet connection.'
    if 'no space left' in s:
        return 'The worker ran out of disk space.'
    errors = [l for l in output.splitlines() if 'ERROR' in l]
    return ('Download failed: ' + errors[-1].split('ERROR:', 1)[-1].strip())[:300] if errors else 'Download failed. See worker console for details.'

def num(v):
    try: return float(v)
    except (TypeError, ValueError): return None

PROGRESS = 'download:CUTLINE %(progress.downloaded_bytes)s %(progress.total_bytes)s %(progress.total_bytes_estimate)s %(progress.speed)s %(progress.eta)s'
# Player clients that usually avoid the proof-of-origin bot check on VPS/datacenter IPs without cookies.
DEFAULT_EXTRACTOR_ARGS = 'youtube:player_client=tv,android,web_safari'
COOKIE_ERRORS = ('failed to decrypt with dpapi', 'dpapi', 'could not find cookies', 'could not copy', 'cookie database',
                 'failed to load cookies', 'cookies file', 'netscape format')

def usable_file(p):
    try: return p.is_file() and p.stat().st_size > 0
    except OSError: return False

def json_cookies_to_netscape(cookies):
    """Convert a browser-extension JSON cookie export (list, or {"cookies": [...]}) to Netscape text."""
    if isinstance(cookies, dict): cookies = cookies.get('cookies', [])
    if not isinstance(cookies, list): raise ValueError('JSON cookies must be a list')
    lines = ['# Netscape HTTP Cookie File', '# Converted automatically from JSON by Cutline worker', '']
    for c in cookies:
        if not isinstance(c, dict) or not c.get('name') or not (c.get('domain') or c.get('host')): continue
        domain = str(c.get('domain') or c.get('host')).strip()
        host_only = c.get('hostOnly')
        if host_only is None: host_only = not domain.startswith('.')
        if not host_only and not domain.startswith('.'): domain = '.' + domain
        flag = 'FALSE' if host_only else 'TRUE'
        path = str(c.get('path') or '/')
        secure = 'TRUE' if c.get('secure') else 'FALSE'
        exp = c.get('expirationDate', c.get('expires', c.get('expiry', 0)))
        try: exp = int(float(exp)) if exp and not c.get('session') else 0
        except (TypeError, ValueError): exp = 0
        if exp < 0: exp = 0
        value = str(c.get('value', '')).replace('\t', ' ').replace('\n', '')
        name = str(c['name']).replace('\t', ' ').replace('\n', '')
        if c.get('httpOnly'): domain = '#HttpOnly_' + domain
        lines.append('\t'.join([domain, flag, path, secure, str(exp), name, value]))
    if len(lines) <= 3: raise ValueError('no valid cookies found in JSON')
    return '\n'.join(lines) + '\n'

def ensure_netscape(p):
    """If a cookie file is a JSON export (starts with '[' or '{'), rewrite it in Netscape format in place,
    keeping the original as <name>.json.bak. Returns True when the file is usable afterwards."""
    try:
        text = p.read_text(encoding='utf-8-sig', errors='replace')
    except OSError as e:
        log.warning('Cannot read cookies file %s: %s', p, e); return False
    if not text.lstrip().startswith(('[', '{')): return True
    try:
        converted = json_cookies_to_netscape(json.loads(text))
        p.with_name(p.name + '.json.bak').write_text(text, encoding='utf-8')
        tmp = p.with_name(p.name + '.tmp')
        tmp.write_text(converted, encoding='utf-8', newline='\n')
        os.replace(tmp, p)
        log.info('Converted JSON cookies to Netscape format: %s', p)
        return True
    except Exception as e:
        log.warning('Could not convert JSON cookies in %s, ignoring: %s', p, e)
        return False

def cookie_args():
    """Cookies priority: YOUTUBE_COOKIES_FILE, then cookies.txt beside app.py or in ROOT, then an explicit
    YOUTUBE_COOKIES_BROWSER. Empty files are ignored; JSON exports are auto-converted to Netscape format.
    No browser is used unless explicitly configured (Windows/Admin Edge decryption fails with DPAPI, yt-dlp issue 10927)."""
    env_file = os.getenv('YOUTUBE_COOKIES_FILE', '').strip()
    if env_file:
        if usable_file(Path(env_file)) and ensure_netscape(Path(env_file)): return ['--cookies', env_file]
        log.warning('YOUTUBE_COOKIES_FILE missing, empty or invalid, ignoring: %s', env_file)
    for c in (Path(__file__).resolve().parent / 'cookies.txt', ROOT / 'cookies.txt'):
        if usable_file(c) and ensure_netscape(c):
            log.info('Using YouTube cookies from %s', c)
            return ['--cookies', str(c)]
    browser = os.getenv('YOUTUBE_COOKIES_BROWSER', '').strip()
    if browser:
        log.info('Using YouTube cookies from browser %s', browser)
        return ['--cookies-from-browser', browser]
    return []

def extractor_args(cookies=None):
    """YOUTUBE_EXTRACTOR_ARGS always wins ('none' disables). Otherwise the tv/android default applies only
    without cookies: YouTube rejects desktop web cookies sent with TV/Android player clients."""
    value = os.getenv('YOUTUBE_EXTRACTOR_ARGS', '').strip()
    if value.lower() in ('none', 'off', '0', 'false'): return []
    if value: return ['--extractor-args', value]
    if cookies: return []
    return ['--extractor-args', DEFAULT_EXTRACTOR_ARGS]

def is_cookie_error(output):
    s = output.lower()
    return any(k in s for k in COOKIE_ERRORS)

def ytdlp_attempt(job, url, d, cookies):
    extra = extractor_args(cookies) + cookies
    # Only request Deno when it exists; older/standalone installs reject the flag otherwise.
    if shutil.which('deno'): extra += ['--js-runtimes', 'deno']
    args = ['yt-dlp', '--no-playlist', '--newline', '--progress', '--progress-template', PROGRESS,
            '--max-filesize', '2G', '--match-filter', 'duration <= 14400', *extra,
            '-f', 'bestvideo[height<=720]+bestaudio/best[height<=720]/best', '--merge-output-format', 'mp4',
            '-o', str(d / 'source.%(ext)s'), url]
    try:
        p = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, errors='replace')
    except FileNotFoundError:
        raise StepError('yt-dlp is not installed on the worker. Run: pip install -U "yt-dlp[default]".')
    tail = deque(maxlen=200); base = 0.0; prev = 0.0; prev_total = None; part = 1; last = 0.0; began = time.time()
    for line in p.stdout:
        if time.time() - began > 14400: p.kill(); raise StepError('Download took longer than 4 hours.')
        if not line.startswith('CUTLINE '):
            tail.append(line.rstrip()); continue
        dl, total, est, speed, eta = (num(x) for x in line.split()[1:6])
        if dl is None: continue
        total = total or est
        if prev and dl < prev * 0.5:  # yt-dlp started the next stream (audio after video)
            base += prev_total or prev; part += 1
        prev, prev_total = dl, total
        now = time.time()
        if now - last >= 1:
            last = now
            write(job, stage='downloading', progress={'downloaded': base + dl, 'total': base + total if total else None,
                                                      'speed': speed, 'eta': eta, 'part': part})
    code = p.wait()
    source = next((f for f in d.glob('source.*') if f.suffix in ['.mp4', '.webm', '.mkv']), None)
    return code, source, '\n'.join(tail)

def ytdlp(job, url, d):
    cookies = cookie_args()
    code, source, output = ytdlp_attempt(job, url, d, cookies)
    if (code or source is None) and cookies and is_cookie_error(output):
        log.warning('yt-dlp cookie error (%s); retrying once without cookies', output[-500:])
        for f in d.glob('source.*'):
            try: f.unlink()
            except OSError: pass
        write(job, stage='downloading', progress={})
        code, source, output = ytdlp_attempt(job, url, d, [])
    if code or source is None:
        log.error('yt-dlp failed (%s): %s', code, output[-3000:])
        raise StepError(explain_download(output))
    return source

# ---- YouTube subtitles fast-path: skips CPU transcription when captions already exist ----
SUB_LANGS = os.getenv('YOUTUBE_SUB_LANGS', 'en,hi,en-orig,hi-orig')
TIME_RE = re.compile(r'(\d+:)?(\d{1,2}):(\d{2})[.,](\d{3})')
CUE_RE = re.compile(r'^\s*((?:\d+:)?\d{1,2}:\d{2}[.,]\d{3})\s*-->\s*((?:\d+:)?\d{1,2}:\d{2}[.,]\d{3})')
INLINE_RE = re.compile(r'<((?:\d+:)?\d{1,2}:\d{2}[.,]\d{3})>')
TAG_RE = re.compile(r'</?[^>]+>')

def secs(t):
    m = TIME_RE.match(t.strip())
    if not m: return None
    h = int(m.group(1)[:-1]) if m.group(1) else 0
    return h * 3600 + int(m.group(2)) * 60 + int(m.group(3)) + int(m.group(4)) / 1000

def clean_words(text):
    import html
    return [w for w in html.unescape(TAG_RE.sub('', text)).replace('\u200b', '').split() if w and not re.fullmatch(r'\[.*\]|\(.*\)', w)]

def parse_subtitles(text):
    """Parse VTT/SRT into word cues. YouTube auto-captions carry per-word <00:00:01.230> stamps (karaoke-ready);
    plain cues get word times spread evenly. Rolling duplicate lines in auto-captions are dropped."""
    blocks, cur = [], None
    for line in text.replace('\r', '').split('\n'):
        m = CUE_RE.match(line)
        if m:
            cur = [secs(m.group(1)), secs(m.group(2)), []]; blocks.append(cur); continue
        if cur is not None:
            if line == '': cur = None
            else: cur[2].append(line)
    timed = any(INLINE_RE.search(l) for b in blocks for l in b[2])
    cues, prev_text = [], None
    for start, end, lines in blocks:
        if start is None or end is None or end <= start: continue
        if timed:
            lines = [l for l in lines if INLINE_RE.search(l)]
            if not lines: continue  # rolling repeat of the previous line
            for line in lines:
                parts = INLINE_RE.split(line)  # text, time, text, time, text...
                pieces = [(start, parts[0])] + [(secs(parts[i]), parts[i + 1]) for i in range(1, len(parts) - 1, 2)]
                for j, (t, chunk) in enumerate(pieces):
                    words = clean_words(chunk)
                    if not words or t is None: continue
                    nxt = pieces[j + 1][0] if j + 1 < len(pieces) and pieces[j + 1][0] else end
                    nxt = max(nxt, t + 0.05)
                    step = (nxt - t) / len(words)
                    for k, w in enumerate(words):
                        cues.append({'start': round(t + k * step, 3), 'end': round(t + (k + 1) * step, 3), 'text': w})
        else:
            joined = ' '.join(lines)
            if re.fullmatch(r'\d+', joined.strip()): continue
            if joined == prev_text: continue
            prev_text = joined
            words = clean_words(joined)
            if not words: continue
            step = (end - start) / len(words)
            for k, w in enumerate(words):
                cues.append({'start': round(start + k * step, 3), 'end': round(start + (k + 1) * step, 3), 'text': w})
    cues.sort(key=lambda c: c['start'])
    out = []
    for c in cues:  # drop exact duplicates produced by overlapping cues
        if out and abs(out[-1]['start'] - c['start']) < 0.01 and out[-1]['text'] == c['text']: continue
        out.append(c)
    return out

def pick_subtitle(files):
    """Prefer original-language captions (*-orig, never auto-translated), then YOUTUBE_SUB_LANGS order.
    yt-dlp writes uploaded subs for a language when present, otherwise its auto-captions."""
    order = [l.strip() for l in SUB_LANGS.split(',') if l.strip()]
    def lang(f): return f.name[len('subs.'):].rsplit('.', 1)[0]
    def rank(f):
        l = lang(f)
        return (0 if l.endswith('-orig') else 1, order.index(l) if l in order else len(order))
    return sorted(files, key=rank)[0] if files else None

def youtube_subtitles(job, url, d):
    """Return word cues from existing YouTube captions, or None. Never fails the job."""
    if os.getenv('YOUTUBE_SUBTITLES', '1').lower() in ('0', 'off', 'false', 'no'): return None
    write(job, stage='fetching_subtitles', progress={})
    for f in d.glob('subs.*'):
        try: f.unlink()
        except OSError: pass
    def attempt(cookies):
        args = ['yt-dlp', '--no-playlist', '--skip-download', '--write-sub', '--write-auto-sub',
                '--sub-lang', SUB_LANGS, '--sub-format', 'vtt/srt/best', *extractor_args(cookies), *cookies,
                '-o', str(d / 'subs.%(ext)s'), url]
        try:
            r = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=180, text=True, errors='replace')
            return r.returncode, r.stdout
        except (FileNotFoundError, subprocess.TimeoutExpired) as e:
            return 1, str(e)
    cookies = cookie_args()
    code, out = attempt(cookies)
    files = [f for f in d.glob('subs.*') if f.suffix in ('.vtt', '.srt')]
    if not files and cookies and is_cookie_error(out):
        code, out = attempt([])
        files = [f for f in d.glob('subs.*') if f.suffix in ('.vtt', '.srt')]
    best = pick_subtitle(files)
    if not best:
        log.info('No YouTube subtitles found (%s); will transcribe audio', out.strip().splitlines()[-1][:200] if out.strip() else code)
        return None
    try:
        cues = parse_subtitles(best.read_text(encoding='utf-8', errors='replace'))
    except Exception:
        log.exception('Could not parse subtitles %s', best.name); return None
    if len(cues) < 20:
        log.info('Subtitles %s too short (%d words); will transcribe audio', best.name, len(cues)); return None
    log.info('Using YouTube subtitles %s (%d words) - skipping transcription', best.name, len(cues))
    return cues

def download(job, url):
    try:
        d = folder(job)
        sub_cues = youtube_subtitles(job, url, d) if ENGINE == 'cutline' else None
        write(job, stage='downloading', progress={})
        if ENGINE == 'openshorts':
            from openshorts_adapter import download_source
            source = download_source(url, d)
        else:
            source = ytdlp(job, url, d)
        if source is None: raise StepError('No video downloaded')
        size = source.stat().st_size
        if size > 2 * 1024**3: raise StepError('Source exceeds 2 GB')
        write(job, stage='preparing_audio', progress={'downloaded': size, 'total': size})
        probe = json.loads(run(['ffprobe', '-v', 'error', '-show_format', '-of', 'json', str(source)], failure='FFprobe could not read the downloaded video'))
        duration = float(probe['format']['duration'])
        if not 20 <= duration <= 14400: raise StepError('Supported duration is 20 seconds to 4 hours')
        audio = d / 'audio.wav'
        if sub_cues:
            write(job, stage='preparing_audio', progress={'downloaded': size, 'total': size, 'subtitles': True})
            cues = [c for c in sub_cues if c['start'] < duration]
        elif ENGINE == 'openshorts':
            run(['ffmpeg', '-y', '-i', str(source), '-vn', '-ac', '1', '-ar', '16000', str(audio)], failure='FFmpeg could not extract audio')
            write(job, stage='transcribing', progress={})
            from openshorts_adapter import transcribe_source
            cues = transcribe_source(source)
        else:
            run(['ffmpeg', '-y', '-i', str(source), '-vn', '-ac', '1', '-ar', '16000', str(audio)], failure='FFmpeg could not extract audio')
            global MODEL
            with MODEL_LOCK:
                if MODEL is None:
                    write(job, stage='loading_model', progress={})
                    try: MODEL = WhisperModel(os.getenv('WHISPER_MODEL', 'base'), device='cpu', compute_type='int8',
                                                  cpu_threads=int(os.getenv('WHISPER_THREADS') or os.cpu_count() or 8))
                    except Exception:
                        log.exception('Whisper model load failed')
                        raise StepError('Could not load the Whisper model. The first run needs internet access and about 1 GB free RAM.')
                write(job, stage='transcribing', progress={'percent': 0})
                segments, info = MODEL.transcribe(str(audio), word_timestamps=True, vad_filter=True,
                                                  beam_size=int(os.getenv('WHISPER_BEAM_SIZE', '1')))
                cues = []; last = 0.0; total = info.duration or duration
                for s in segments:
                    for w in s.words or []:
                        if w.word.strip() and w.end > w.start:
                            cues.append({'start': w.start, 'end': w.end, 'text': w.word.strip()})
                    if time.time() - last >= 2:
                        last = time.time(); write(job, progress={'percent': min(100, round(s.end / total * 100, 1))})
        if not cues: raise StepError('No speech found in this video, so no captions could be made.')
        if len(cues) > 75000: raise StepError('Transcript is too long (over 75,000 words).')
        write(job, status='analyzed', stage='analyzed', progress={}, duration=duration, cues=cues, source=str(source))
        audio.unlink(missing_ok=True)
    except StepError as e:
        log.error('Job %s failed: %s', job, e)
        write(job, status='failed', error=f'{e}\n\n{traceback.format_exc()}')
    except MemoryError:
        log.exception('Job %s out of memory', job)
        write(job, status='failed', error='The worker ran out of memory. Use a smaller WHISPER_MODEL (tiny/base) or a machine with more RAM.\n\n' + traceback.format_exc())
    except Exception as e:
        log.exception('Job %s failed', job)
        write(job, status='failed', error=f'Download or transcription failed: {type(e).__name__}: {e}\n\n{traceback.format_exc()}')

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
            render_source = source
            offset = s.start
            if ENGINE == 'openshorts':
                from openshorts_adapter import reframe_source
                cut = d / f'{t.id}-cut.mp4'; vertical = d / f'{t.id}-vertical.mp4'
                run(['ffmpeg', '-y', '-ss', str(s.start), '-i', str(source), '-t', str(s.end-s.start),
                     '-c:v', 'libx264', '-preset', 'veryfast', '-c:a', 'aac', '-threads', '2', str(cut)])
                reframe_source(cut, vertical)
                render_source, offset = vertical, 0
            # Relative name + cwd: Windows paths (C:\\...) break FFmpeg filter parsing at the drive colon.
            filters = f'scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,setsar=1,ass={ass.name}'
            run(['ffmpeg', '-y', '-ss', str(offset), '-i', str(render_source), '-t', str(s.end-s.start),
                 '-vf', filters, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p',
                 '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', '-threads', '2', str(output)], cwd=str(d))
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
            if ENGINE == 'openshorts':
                cut.unlink(missing_ok=True); vertical.unlink(missing_ok=True)
        write(job, status='complete', completed=completed)
        source.unlink(missing_ok=True)
    except StepError as e:
        log.error('Render %s failed: %s', job, e)
        write(job, status='failed', error=f'{e} Saved clips remain available.\n\n{traceback.format_exc()}')
    except Exception as e:
        log.exception('Render %s failed', job)
        write(job, status='failed', error=f'Render or signed upload failed: {type(e).__name__}: {e}\n\n{traceback.format_exc()}')

@app.get('/health', dependencies=[Depends(authorized)])
def health(): return {'ok': True, 'protocol': 'cutline-v1', 'protected': bool(TOKEN), 'engine': ENGINE}

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
        (d / 'state.json').write_text(json.dumps({'status':'transcribing','stage':'queued','progress':{},'completed':[]}))
    POOL.submit(download, body.id, str(body.url))
    return {'id': str(body.id)}

@app.get('/jobs/{job}', dependencies=[Depends(authorized)])
def status(job: uuid.UUID):
    s = read(job)
    return {k: s[k] for k in ['status','stage','progress','duration','cues','completed','error'] if k in s}

@app.post('/jobs/{job}/render', dependencies=[Depends(authorized)])
def begin_render(job: uuid.UUID, body: Render):
    with LOCK:
        s = read(job)
        if s['status'] in ['rendering','complete']: return {'accepted': True}
        if s['status'] != 'analyzed': raise HTTPException(409, 'Transcript not ready')
        p = folder(job) / 'state.json'; s['status'] = 'rendering'; p.write_text(json.dumps(s))
    POOL.submit(render, job, body.targets)
    return {'accepted': True}
