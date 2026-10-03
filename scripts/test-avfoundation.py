#!/usr/bin/env python3
"""Generated-media acceptance. No user footage, network, or Premiere host involved."""
import argparse, base64, json, math, os, pathlib, shutil, struct, subprocess, tempfile, wave, select, time
p=argparse.ArgumentParser();p.add_argument('--binary',required=True);args=p.parse_args()
binary=str(pathlib.Path(args.binary).resolve())
if not pathlib.Path(binary).is_file(): raise SystemExit('FAIL: AVFoundation CLI binary is missing')
ffmpeg=shutil.which('ffmpeg')
if not ffmpeg: raise SystemExit('FAIL: ffmpeg is required to generate acceptance fixtures')
def call(data,success=True):
    r=subprocess.run([binary],input=json.dumps(data),text=True,capture_output=True,timeout=180)
    out=json.loads(r.stdout)
    assert (r.returncode==0)==success,(r.returncode,out,r.stderr)
    return out
with tempfile.TemporaryDirectory(prefix='pea-avf-') as folder:
    root=pathlib.Path(folder); audio=root/'stereo.wav'; movie=root/'stereo.mov'
    with wave.open(str(audio),'wb') as w:
        w.setparams((2,2,48000,0,'NONE','not compressed'))
        w.writeframes(b''.join(struct.pack('<hh',int((0 if 1<=i/48000<2 else .2)*32767),-int((0 if 1<=i/48000<2 else .2)*32767)) for i in range(240000)))
    subprocess.run([ffmpeg,'-nostdin','-v','error','-f','lavfi','-i','color=c=black:s=96x64:r=24:d=5','-i',str(audio),'-map','0:v:0','-map','1:a:0','-c:v','prores_ks','-profile:v','0','-pix_fmt','yuv422p10le','-c:a','pcm_s16le',str(movie)],check=True,timeout=60)
    before=movie.read_bytes(); m=call({'op':'probe','path':str(movie)})
    assert m['durationFrames']=='120' and m['channels']==2 and m['frameRate']=={'numerator':24,'denominator':1},m
    value=call({'op':'window','media':m,'startSample':24000,'sampleCount':48000})
    data=base64.b64decode(value['pcmBase64'],validate=True);assert len(data)==48000*2*4
    samples=struct.unpack('<'+'f'*(len(data)//4),data)
    assert abs(samples[0]-.2)<.0001 and abs(samples[1]+.2)<.0001
    assert max(abs(x) for x in samples[48000:])<.00001
    call({'op':'window','media':m,'startSample':0,'sampleCount':240001},False)
    call({'op':'probe','path':str(audio)},False)
    damaged=dict(m,fileIdentity='wrong');call({'op':'window','media':damaged,'startSample':0,'sampleCount':1},False)
    # Exercise the same job lifecycle used by Hybrid, including a response larger than 64 KiB.
    worker=subprocess.Popen([binary,'--jobs'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
    def request(value):
        worker.stdin.write(json.dumps(value)+'\n');worker.stdin.flush()
        assert select.select([worker.stdout],[],[],20)[0], 'native job control timed out'
        line=worker.stdout.readline();assert line, 'native job process terminated'
        return json.loads(line)
    def job(value):
        started=request(value);ident=started['jobId'];deadline=time.monotonic()+180
        while time.monotonic()<deadline:
            state=request({'op':'poll','jobId':ident})
            if state['status']=='completed':
                request({'op':'delete','jobId':ident});return state['result']
            assert state['status']=='running',state
            time.sleep(.03)
        raise AssertionError('native job deadline exceeded')
    try:
        jm=job({'op':'probe','path':str(movie)});assert jm==m
        jw=job({'op':'window','media':jm,'startSample':24000,'sampleCount':48000})
        assert base64.b64decode(jw['pcmBase64'],validate=True)==data
    finally:
        worker.stdin.close()
        try: worker.wait(timeout=10)
        except subprocess.TimeoutExpired: worker.kill();worker.wait()
    assert worker.returncode==0
    assert movie.read_bytes()==before
    print('PASS: AVFoundation generated MOV probe, CFR clock, stereo/polarity, exact window, bounds, wrong identity, immutable source, native job lifecycle and large PCM response')
