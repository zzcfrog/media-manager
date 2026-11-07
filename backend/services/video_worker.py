"""Private stdin/stdout worker protocol. No library/database or HTTP startup."""
import json
import pickle
import sys


def main():
    from .face_engine import load_engine
    from .video_people import VideoFacePipeline,iter_frames
    def send(identifier,event,**payload):
        pickle.dump({'id':identifier,'event':event,**payload},sys.stdout.buffer,protocol=5);sys.stdout.buffer.flush()
    for line in sys.stdin:
        identifier=''
        try:
            request=json.loads(line);identifier=request['id'];cfg=request['settings']
            model=load_engine(cfg['model_dir'],cfg['profile'],**{k:cfg[k] for k in ('detector_path','recognizer_path','verifier_path','verify_enabled')})
            send(identifier,'ready',model_key=model.info['key'])
            pipeline=VideoFacePipeline(model,identity_samples=cfg.get('video_identity_samples',4))
            for observation in pipeline.run(iter_frames(request['path'],request['resolution'],lambda:False,fps=cfg.get('video_fps',1)),lambda:False):
                send(identifier,'observation',observation=observation)
            send(identifier,'done',stats=pipeline.stats)
        except Exception as exc:
            kind='missing' if isinstance(exc,FileNotFoundError) else 'invalid' if isinstance(exc,ValueError) else 'failed'
            send(identifier,'error',kind=kind,error=str(exc)[:600])


if __name__=='__main__':main()
