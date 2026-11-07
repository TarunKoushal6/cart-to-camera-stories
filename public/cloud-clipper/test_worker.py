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
        self.assertEqual(app.MusicPlan().volume, 0.10)
        with self.assertRaises(ValueError): app.music_bed('none', 20, Path('/tmp/invalid-music.wav'))

    def test_real_ducked_music_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            d = Path(tmp)
            speech, bed, mixed = d / 'speech.wav', d / 'chill.wav', d / 'mixed.wav'
            app.run(['ffmpeg', '-y', '-f', 'lavfi', '-i', 'sine=frequency=250:duration=3', str(speech)])
            app.music_bed('chill', 3, bed)
            args = app.music_mix_args(3, 0.10)
            app.run(['ffmpeg', '-y', '-i', str(speech), '-i', str(bed), *args[:2], '-map', '[a]', str(mixed)])
            self.assertGreater(mixed.stat().st_size, 10000)

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
        app.run(['ffmpeg', '-y', '-f', 'lavfi', '-i', 'color=size=320x180:rate=5', '-t', '60', '-c:v', 'libx264', '-threads', '2', str(source)])
        app.write(job, status='analyzed', source=str(source), duration=60, cues=[{'start':0, 'end':60, 'text':'One minute complete thought'}])
        target = app.Target(id=clip, path=f'owner/clips/{clip}/video.mp4', segment=app.Segment(title='Minute', start=0, end=60, score=80, reason='Complete'), upload_url='https://test.supabase.co/storage/v1/object/upload/sign/videos/test.mp4?token=test')
        captured = directory / 'uploaded.mp4'
        def upload(url, data, **kwargs):
            captured.write_bytes(data.read())
            return types.SimpleNamespace(status_code=200)
        with patch.object(app.requests, 'put', side_effect=upload): app.render(job, [target])
        self.assertEqual(app.read(job)['status'], 'complete')
        import json
        video = next(s for s in json.loads(app.run(['ffprobe', '-v', 'error', '-show_streams', '-of', 'json', str(captured)]))['streams'] if s['codec_type'] == 'video')
        self.assertEqual((video['width'], video['height']), (1080,1920))
        self.assertEqual(round(float(video['duration'])), 60)

    def test_real_vertical_render_and_exact_upload(self):
        job, clip = uuid.uuid4(), uuid.uuid4()
        directory = app.folder(job)
        directory.mkdir()
        source = directory / 'source.mp4'
        app.run(['ffmpeg','-y','-f','lavfi','-i','testsrc2=size=320x180:rate=10','-t','21','-c:v','libx264','-threads','2',str(source)])
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

    def test_openshorts_bridge_uses_upstream_functions_and_word_cues(self):
        mock=types.SimpleNamespace(download_youtube_video=lambda url,output_dir:('/tmp/source.mp4','Title'),transcribe_video=lambda path:{'segments':[{'words':[{'start':0,'end':1,'word':'Hello'}]}]})
        with patch.dict(sys.modules,{'main':mock}):
            self.assertEqual(openshorts_adapter.download_source('https://youtube.com/watch?v=test',Path('/tmp')),Path('/tmp/source.mp4'))
            self.assertEqual(openshorts_adapter.transcribe_source(Path('/tmp/source.mp4')),[{'start':0.0,'end':1.0,'text':'Hello'}])

if __name__ == '__main__': unittest.main()