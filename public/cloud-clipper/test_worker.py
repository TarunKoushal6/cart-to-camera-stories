"""Run: python -m unittest test_worker.py (install FastAPI + requests first).
Uses real FFmpeg and mocked uploads/OpenShorts; never downloads models or YouTube.
"""
import os
import sys
import types
import tempfile
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch

sys.modules.setdefault('faster_whisper', types.SimpleNamespace(WhisperModel=object))
os.environ['DATA_DIR'] = tempfile.mkdtemp(prefix='cutline-test-')
import app
import openshorts_adapter

class WorkerTests(unittest.TestCase):
    def test_final_quality_on_real_saved_clip_after_captions_and_music(self):
        with tempfile.TemporaryDirectory() as tmp:
            d = Path(tmp); output = d / 'final.mp4'; ass = d / 'final.ass'
            app.captions(ass, [{'start': 0, 'end': 20, 'text': 'A complete final video thought'}], 0, 20)
            app.run(['ffmpeg', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=720x1280:rate=5', '-f', 'lavfi', '-i', 'sine=frequency=250:duration=20', '-t', '20', '-c:v', 'libx264', '-preset', 'ultrafast', '-threads', '2', '-c:a', 'aac', str(output)])
            result = app.inspect_output(output, ass, 20, 'chill')
            self.assertTrue(result['metrics']['decoded'])
            self.assertTrue(result['metrics']['has_audio'])
            self.assertEqual(result['metrics']['caption_overlaps'], 0)
            self.assertEqual(result['metrics']['music'], 'chill')
            self.assertEqual(len(result['frames']), 5)
            self.assertTrue(all(len(f['jpeg']) < 160000 for f in result['frames']))

    def test_larger_topic_batch_and_speech_first_music(self):
        self.assertEqual(app.Render.model_fields['targets'].metadata[1].max_length, 60)
        self.assertEqual(app.MusicPlan().volume, 0.30)
        with self.assertRaises(ValueError): app.music_bed('none', 20, Path('/tmp/invalid-music.wav'))

    def test_real_ducked_music_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            d = Path(tmp)
            speech, bed, mixed = d / 'speech.wav', d / 'chill.wav', d / 'mixed.wav'
            app.run(['ffmpeg', '-y', '-f', 'lavfi', '-i', 'sine=frequency=250:duration=3', str(speech)])
            app.music_bed('chill', 3, bed)
            args = app.music_mix_args(3, 0.30)
            app.run(['ffmpeg', '-y', '-i', str(speech), '-i', str(bed), *args[:2], '-map', '[a]', str(mixed)])
            self.assertGreater(mixed.stat().st_size, 10000)

    def test_music_is_audible_but_ducked_under_speech(self):
        import array, math, subprocess
        with tempfile.TemporaryDirectory() as tmp:
            d = Path(tmp); speech, bed = d/'speech.wav', d/'bed.wav'
            # Distinct frequencies let us measure the added bed separately from speech.
            # Speech-level tone (about -19 dBFS RMS) starts at 2s; the real synthesised bed plays throughout.
            app.run(['ffmpeg','-y','-f','lavfi','-i',r'aevalsrc=if(lt(t\,2)\,0\,0.25*sin(2*PI*1000*t)):s=48000:d=6',str(speech)])
            app.music_bed('chill', 6, bed)
            # Isolate the ducked music and keep only the 300–3000 Hz range phone speakers actually play.
            graph = app.music_mix_args(6, app.MusicPlan().volume)[1].replace(
                '[sp][duck]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[a]',
                '[sp]anullsink;[duck]highpass=f=300,highpass=f=300,lowpass=f=3000[a]')
            def db(start):
                raw = subprocess.check_output(['ffmpeg','-v','error','-i',str(speech),'-i',str(bed),'-filter_complex',graph,'-map','[a]','-ss',str(start),'-t','0.8','-f','f32le','-'])
                samples = array.array('f'); samples.frombytes(raw)
                return 20*math.log10(math.sqrt(sum(x*x for x in samples)/len(samples))+1e-9)
            speech_db = 20*math.log10(0.25/math.sqrt(2))
            pause, talking = db(1.1), db(3.5)
            self.assertGreater(pause, speech_db - 15)    # clearly audible on a phone between phrases
            self.assertGreater(talking, speech_db - 20)  # still audible under the voice
            self.assertLess(talking, pause)              # but ducked beneath speech
            self.assertLess(talking, speech_db - 8)      # never competes with the voice

    def test_overlap_dedup_preserves_sequential_repeats(self):
        cues = app.normalized_caption_words([
            {'start': 0, 'end': 0.7, 'text': 'I'},
            {'start': 0.6, 'end': 1.1, 'text': 'I'},
            {'start': 0.7, 'end': 1.3, 'text': 'SEE'},
            {'start': 1.1, 'end': 1.5, 'text': 'SEE'},
            {'start': 1.5, 'end': 2, 'text': 'SEE'},
        ])
        self.assertEqual([w['text'] for w in cues], ['I', 'SEE', 'SEE'])
        self.assertTrue(all(a['end'] <= b['start'] for a, b in zip(cues, cues[1:])))

    def test_real_one_minute_vertical_render(self):
        job, clip = uuid.uuid4(), uuid.uuid4()
        directory = app.folder(job); directory.mkdir()
        source = directory / 'source.mp4'
        app.run(['ffmpeg', '-y', '-f', 'lavfi', '-i', 'color=size=320x180:rate=5', '-f','lavfi','-i','anullsrc=r=48000:cl=stereo', '-t', '60', '-c:v', 'libx264', '-c:a','aac', '-threads', '2', str(source)])
        app.write(job, status='analyzed', source=str(source), duration=60, cues=[{'start':0, 'end':60, 'text':'One minute complete thought'}])
        target = app.Target(id=clip, path=f'owner/clips/{clip}/video.mp4', segment=app.Segment(title='Minute', start=0, end=60, score=80, reason='Complete'), upload_url='https://test.supabase.co/storage/v1/object/upload/sign/videos/test.mp4?token=test')
        captured = directory / 'uploaded.mp4'
        def upload(url, data, **kwargs):
            captured.write_bytes(data.read())
            return types.SimpleNamespace(status_code=200)
        with patch.object(app.requests, 'put', side_effect=upload): app.render(job, [target], app.MusicPlan(clips={str(clip):'chill'}))
        self.assertEqual(app.read(job)['status'], 'complete')
        import json
        video = next(s for s in json.loads(app.run(['ffprobe', '-v', 'error', '-show_streams', '-of', 'json', str(captured)]))['streams'] if s['codec_type'] == 'video')
        self.assertEqual((video['width'], video['height']), (1080,1920))
        self.assertEqual(round(float(video['duration'])), 60)
        quality=json.loads((directory/f'{clip}-quality.json').read_text())['metrics']
        self.assertEqual(quality['music'],'chill')
        self.assertTrue(quality['has_audio'])

    def test_failed_music_preserves_clip_and_records_warning(self):
        job, clip = uuid.uuid4(), uuid.uuid4()
        d=app.folder(job); d.mkdir(); source=d/'source.mp4'
        app.run(['ffmpeg','-y','-f','lavfi','-i','color=c=blue:size=320x180:rate=5','-t','20','-c:v','libx264','-threads','2',str(source)])
        app.write(job,status='analyzed',source=str(source),duration=20,cues=[{'start':0,'end':20,'text':'Complete thought'}])
        target=app.Target(id=clip,path='owner/video.mp4',segment=app.Segment(title='Test',start=0,end=20,score=80,reason='Complete'),upload_url='https://test.supabase.co/storage/v1/object/upload/sign/videos/test.mp4?token=test')
        with patch.object(app,'music_bed',side_effect=RuntimeError('Music unavailable')), patch.object(app.requests,'put',return_value=types.SimpleNamespace(status_code=200)):
            app.render(job,[target],app.MusicPlan(clips={str(clip):'chill'}))
        import json
        quality=json.loads((d/f'{clip}-quality.json').read_text())['metrics']
        self.assertEqual(app.read(job)['status'],'complete')
        self.assertIsNone(quality['music'])
        self.assertTrue(any('background music could not be mixed' in w for w in quality['warnings']))

    def test_real_vertical_render_and_exact_upload(self):
        job, clip = uuid.uuid4(), uuid.uuid4()
        directory = app.folder(job)
        directory.mkdir()
        source = directory / 'source.mp4'
        app.run(['ffmpeg','-y','-f','lavfi','-i','color=c=blue:size=320x180:rate=10','-vf','drawbox=x=0:y=0:w=40:h=180:color=red:t=fill,drawbox=x=280:y=0:w=40:h=180:color=lime:t=fill','-t','21','-c:v','libx264','-threads','2',str(source)])
        app.write(job,status='analyzed',source=str(source),duration=21,cues=[{'start':0,'end':20,'text':'Caption test'}])
        target = app.Target(id=clip,path=f'owner/clips/{clip}/video.mp4',segment=app.Segment(title='Test',start=0,end=20,score=80,reason='Hook'),upload_url='https://test.supabase.co/storage/v1/object/upload/sign/videos/owner/test.mp4?token=test')
        captured = directory / 'uploaded.mp4'
        def upload(url, data, **kwargs):
            self.assertEqual(url,str(target.upload_url))
            captured.write_bytes(data.read())
            return types.SimpleNamespace(status_code=200)
        with patch.object(app.requests,'put',side_effect=upload): app.render(job,[target])
        self.assertEqual(app.read(job)['status'],'complete')
        self.assertEqual(app.read(job)['completed'],[str(clip)])
        import json
        probe=json.loads(app.run(['ffprobe','-v','error','-show_streams','-of','json',str(captured)]))
        video=next(s for s in probe['streams'] if s['codec_type']=='video')
        self.assertEqual((video['width'],video['height']),(1080,1920))
        self.assertEqual(round(float(video['duration'])),20)
        import subprocess
        pixels = subprocess.check_output(['ffmpeg','-v','error','-ss','1','-i',str(captured),'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-threads','1','-'])
        def rgb(x,y): return tuple(pixels[(y*1080+x)*3:(y*1080+x)*3+3])
        self.assertGreater(rgb(40,960)[0],200)  # full left edge
        self.assertGreater(rgb(1040,960)[1],200)  # full right edge
        self.assertGreater(rgb(540,960)[2],200)
        self.assertLess(max(rgb(20,100)),15)
        self.assertLess(max(rgb(20,1800)),15)
        def bright_in(y1,y2):
            return sum(min(rgb(x,y)) > 180 for y in range(y1,y2,4) for x in range(90,990,4))
        self.assertGreater(bright_in(250,550),30)  # top hook
        self.assertGreater(bright_in(1390,1560),30)  # bottom captions
        quality=json.loads((directory / f'{clip}-quality.json').read_text())['metrics']
        self.assertEqual(quality['caption_overlaps'],0)
        self.assertEqual(quality['black_seconds'],0)
        app.run(['ffmpeg','-y','-ss','1','-i',str(captured),'-frames:v','1','-threads','1','/tmp/podcast-layout.png'])

    def test_letterbox_black_source_is_still_detected(self):
        with tempfile.TemporaryDirectory() as tmp:
            d=Path(tmp); output=d/'black.mp4'; ass=d/'black.ass'
            app.captions(ass,[{'start':0,'end':20,'text':'Caption test'}],0,20,'Hook title')
            app.run(['ffmpeg','-y','-f','lavfi','-i','color=c=black:size=320x180:rate=5','-t','20','-vf',f'{app.PODCAST_FILTER},ass={ass.name}','-c:v','libx264','-preset','ultrafast','-threads','2',str(output)],cwd=str(d))
            quality=app.inspect_output(output,ass,20,None,(1080,608,0,656))['metrics']
            self.assertGreater(quality['black_seconds'],1)
            self.assertTrue(any('near-black' in w for w in quality['warnings']))

    def test_openshorts_bridge_uses_upstream_functions_and_word_cues(self):
        mock=types.SimpleNamespace(download_youtube_video=lambda url,output_dir:('/tmp/source.mp4','Title'),transcribe_video=lambda path:{'segments':[{'words':[{'start':0,'end':1,'word':'Hello'}]}]})
        with patch.dict(sys.modules,{'main':mock}):
            self.assertEqual(openshorts_adapter.download_source('https://youtube.com/watch?v=test',Path('/tmp')),Path('/tmp/source.mp4'))
            self.assertEqual(openshorts_adapter.transcribe_source(Path('/tmp/source.mp4')),[{'start':0.0,'end':1.0,'text':'Hello'}])


class SubtitleTests(unittest.TestCase):
    def test_subtitle_client_defaults_to_android_without_changing_video_clients(self):
        with patch.dict(os.environ, {'YOUTUBE_EXTRACTOR_ARGS': '', 'YOUTUBE_SUBTITLE_EXTRACTOR_ARGS': ''}, clear=False):
            self.assertEqual(app.subtitle_extractor_args([]), ['--extractor-args', 'youtube:player_client=android'])
        with patch.dict(os.environ, {'YOUTUBE_SUBTITLE_EXTRACTOR_ARGS': 'youtube:player_client=ios'}, clear=False):
            self.assertEqual(app.subtitle_extractor_args([]), ['--extractor-args', 'youtube:player_client=ios'])

    def test_hindi_regional_track_is_preferred_over_english(self):
        with tempfile.TemporaryDirectory() as tmp:
            hindi = Path(tmp) / 'subs.hi-Hans.vtt'
            english = Path(tmp) / 'subs.en.vtt'
            hindi.touch(); english.touch()
            self.assertEqual(app.pick_subtitle([english, hindi]), hindi)

    def test_caption_lookup_uses_android_and_reads_auto_hindi_captions(self):
        job = uuid.uuid4()
        directory = app.folder(job)
        directory.mkdir()
        words = 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty'
        vtt = f'WEBVTT\n\n00:00:00.000 --> 00:00:20.000\n{words}\n'

        def fetch(args, **kwargs):
            self.assertIn('youtube:player_client=android', args)
            output = Path(args[args.index('-o') + 1].replace('%(language)s', 'hi').replace('%(ext)s', 'vtt'))
            output.write_text(vtt, encoding='utf-8')
            return types.SimpleNamespace(returncode=0, stdout='Writing auto captions')

        with patch.dict(os.environ, {'YOUTUBE_EXTRACTOR_ARGS': '', 'YOUTUBE_SUBTITLE_EXTRACTOR_ARGS': '', 'YOUTUBE_SUBTITLES': '1'}, clear=False), \
             patch.object(app, 'cookie_args', return_value=[]), patch.object(app.subprocess, 'run', side_effect=fetch):
            result = app.youtube_subtitles(job, 'https://www.youtube.com/watch?v=test', directory)
        self.assertIsNone(result.error)
        self.assertEqual(len(result.cues or []), 20)

    def test_rate_limit_is_not_reported_as_missing_captions(self):
        error = app.explain_subtitle_failure('ERROR: HTTP Error 429: Too Many Requests', 1)
        self.assertTrue(error.startswith('CAPTIONS_RATE_LIMITED:'))
        self.assertIn('may still have captions', error)
        self.assertTrue(app.explain_subtitle_failure('There are no subtitles for the requested languages', 1).startswith('NO_CAPTIONS:'))

class OutroTest(unittest.TestCase):
    def test_outro_is_appended_to_reel_end(self):
        with tempfile.TemporaryDirectory() as tmp:
            clip = Path(tmp) / 'clip.mp4'
            app.run(['ffmpeg', '-y', '-f', 'lavfi', '-i', 'testsrc=s=1080x1920:r=25:d=4', '-f', 'lavfi', '-i', 'sine=d=4', '-shortest', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', str(clip)])
            outro = app.outro_file()
            self.assertIsNotNone(outro)
            app.append_outro(clip, outro)
            info = app.json.loads(app.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration:stream=width,height', '-of', 'json', str(clip)]))
            self.assertAlmostEqual(float(info['format']['duration']), 7.5, delta=0.3)
            self.assertEqual((info['streams'][0]['width'], info['streams'][0]['height']), (1080, 1920))

if __name__ == '__main__': unittest.main()