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
        self.assertEqual((video['width'],video['height']),(720,1280))
        self.assertEqual(round(float(video['duration'])),20)

    def test_openshorts_bridge_uses_upstream_functions_and_word_cues(self):
        mock=types.SimpleNamespace(download_youtube_video=lambda url,output_dir:('/tmp/source.mp4','Title'),transcribe_video=lambda path:{'segments':[{'words':[{'start':0,'end':1,'word':'Hello'}]}]})
        with patch.dict(sys.modules,{'main':mock}):
            self.assertEqual(openshorts_adapter.download_source('https://youtube.com/watch?v=test',Path('/tmp')),Path('/tmp/source.mp4'))
            self.assertEqual(openshorts_adapter.transcribe_source(Path('/tmp/source.mp4')),[{'start':0.0,'end':1.0,'text':'Hello'}])

if __name__ == '__main__': unittest.main()