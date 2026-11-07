"""Model selection and per-run people scans; synthetic libraries and model contracts."""
from support import DatabaseCase
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch
import unittest
import numpy as np
from PIL import Image
from backend.services import face_engine, people, people_jobs as jobs, importer


class PeopleScanOptionsTests(DatabaseCase):
    def setUp(self):
        super().setUp()
        from backend.blueprints.people import bp
        self.app.register_blueprint(bp,url_prefix='/api/people')

    def test_all_six_packs_and_local_paths_are_explicit_and_hash_every_stage(self):
        packs={
            'buffalo_l':('det_10g.onnx','w600k_r50.onnx'),
            'buffalo_m':('det_2.5g.onnx','w600k_r50.onnx'),
            'buffalo_s':('det_500m.onnx','w600k_mbf.onnx'),
            'buffalo_sc':('det_500m.onnx','w600k_mbf.onnx'),
            'raccoon_s':('det_10g_wo.onnx','w600k_mbf.onnx'),
            'raccoon_l':('det_10g_wo.onnx','w600k_r50.onnx')}
        for profile,names in packs.items():
            with self.subTest(profile=profile):
                folder=self.case/profile;folder.mkdir()
                for name in names:(folder/name).write_bytes(name.encode())
                if profile.startswith('raccoon_'):(folder/'face_verifier_mnv2.onnx').write_bytes(b'synthetic verifier')
                r=self.client.patch('/api/people/settings',json={'profile':profile,'model_dir':str(folder)})
                self.assertEqual(r.status_code,200,r.json)
                self.assertTrue(self.client.get('/api/people/status').json['model']['ready'])
        detector=self.case/'det.onnx';recognizer=self.case/'rec.onnx';verifier=self.case/'verify.onnx'
        for file in (detector,recognizer,verifier):file.write_bytes(file.name.encode())
        cfg={'profile':'buffalo_l','detector_path':str(detector),'recognizer_path':str(recognizer),
             'verifier_path':str(verifier),'verify_enabled':False}
        r=self.client.patch('/api/people/settings',json=cfg);self.assertEqual(r.status_code,200,r.json)
        pair=face_engine.model_info('',**cfg)
        cfg['verify_enabled']=True;three=face_engine.model_info('',**cfg)
        self.assertEqual(len(pair['paths']),2);self.assertEqual(len(three['paths']),3)
        self.assertNotEqual(pair['key'],three['key'])
        verifier.write_bytes(b'new verifier')
        self.assertNotEqual(three['key'],face_engine.model_info('',**cfg)['key'])
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM people_jobs').fetchone()[0],0)

    def test_model_settings_reject_relative_paths_and_invalid_switches_without_partial_save(self):
        for bad in ({'profile':'custom','detector_path':'relative'}, {'verify_enabled':'true'},
                    {'recognizer_path':'relative'}, {'verifier_path':42}):
            before=jobs.settings(self.db)
            r=self.client.patch('/api/people/settings',json=bad)
            self.assertEqual(r.status_code,409,r.json);self.assertEqual(jobs.settings(self.db),before)

    def test_video_face_rate_defaults_to_one_and_round_trips_only_three_choices(self):
        self.assertEqual(self.client.get('/api/people/status').json['settings']['video_fps'],1)
        keys=set()
        for fps in (1,2,3):
            r=self.client.patch('/api/people/settings',json={'video_fps':fps})
            self.assertEqual(r.status_code,200,r.json)
            self.assertEqual(r.json['video_fps'],fps)
            self.assertEqual(self.client.get('/api/people/status').json['settings']['video_fps'],fps)
            self.assertEqual(self.db.execute("SELECT value FROM settings WHERE key='people_video_fps'").fetchone()[0],str(fps))
            self.assertEqual(jobs.video_settings(self.db)['fps'],fps)
            keys.add(jobs._config_key(self.db))
        self.assertEqual(len(keys),3)
        for invalid in (0,4,-1,True,False,1.5,2.0,'2',None):
            before=jobs.settings(self.db)
            r=self.client.patch('/api/people/settings',json={'video_fps':invalid,'profile':'raccoon_s'})
            self.assertEqual(r.status_code,409,r.json);self.assertEqual(jobs.settings(self.db),before)
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM people_jobs').fetchone()[0],0)

    def test_video_rate_change_keeps_completed_results_until_explicit_rescan(self):
        mid=self.seed(media_type='video');jid=jobs.enqueue(self.db,mid)
        self.db.execute("UPDATE people_jobs SET state='done' WHERE id=?",(jid,));self.db.commit()
        self.assertEqual(self.client.patch('/api/people/settings',json={'video_fps':2}).status_code,200)
        skipped=self.client.post('/api/people/jobs',json={'scope':'selected','media_ids':[mid],'existing':'skip'})
        self.assertEqual((skipped.json['queued'],skipped.json['skipped']),(0,1))
        queued=self.client.post('/api/people/jobs',json={'scope':'selected','media_ids':[mid],'existing':'rescan'})
        self.assertEqual(queued.json['queued'],1)
        self.assertEqual(self.db.execute('SELECT state FROM people_jobs WHERE id=?',(jid,)).fetchone()[0],'done')
        self.assertNotEqual(self.db.execute("SELECT config_key FROM people_jobs WHERE media_id=? AND state='queued'",(mid,)).fetchone()[0],
                            self.db.execute('SELECT config_key FROM people_jobs WHERE id=?',(jid,)).fetchone()[0])

    def test_track_sample_count_round_trips_and_rejects_invalid_values_atomically(self):
        self.assertEqual(self.client.get('/api/people/status').json['settings'].get('video_identity_samples'),4)
        for count in (1,3,4,8,48):
            r=self.client.patch('/api/people/settings',json={'video_identity_samples':count})
            self.assertEqual(r.status_code,200,r.json)
            self.assertEqual(r.json['video_identity_samples'],count)
            self.assertEqual(self.client.get('/api/people/status').json['settings']['video_identity_samples'],count)
            self.assertEqual(self.db.execute("SELECT value FROM settings WHERE key='people_video_identity_samples'").fetchone()[0],str(count))
        for invalid in (0,-1,49,True,False,1.5,3.0,'3',None):
            before=jobs.settings(self.db)
            r=self.client.patch('/api/people/settings',json={'video_identity_samples':invalid,'profile':'raccoon_s'})
            self.assertEqual(r.status_code,409,r.json)
            self.assertEqual(jobs.settings(self.db),before)
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM people_jobs').fetchone()[0],0)

    def test_track_sample_count_changes_only_video_jobs_and_keeps_completed_results(self):
        photo=self.seed(self.case/'photo.jpg',media_type='image');video=self.seed(media_type='video')
        photo_job=jobs.enqueue(self.db,photo);video_job=jobs.enqueue(self.db,video)
        self.db.execute("UPDATE people_jobs SET state='done'");self.db.commit()
        r=self.client.patch('/api/people/settings',json={'video_identity_samples':8})
        self.assertEqual(r.status_code,200,r.json)
        self.assertEqual(jobs.enqueue(self.db,photo),photo_job)
        skipped=jobs.enqueue_scope(self.db,{'scope':'selected','media_ids':[video],'existing':'skip'})
        self.assertEqual((skipped['queued'],skipped['skipped']),(0,1))
        again=jobs.enqueue_scope(self.db,{'scope':'selected','media_ids':[video],'existing':'rescan'})
        self.assertEqual(again['queued'],1)
        new=self.db.execute("SELECT * FROM people_jobs WHERE media_id=? AND state='queued'",(video,)).fetchone()
        self.assertNotEqual(new['id'],video_job)
        self.assertEqual(self.db.execute('SELECT state FROM people_jobs WHERE id=?',(video_job,)).fetchone()[0],'done')

    def test_video_rate_changes_do_not_duplicate_or_invalidate_photo_jobs(self):
        photo=self.seed(self.case/'photo.jpg',media_type='image');video=self.seed(media_type='video')
        photo_job=jobs.enqueue(self.db,photo);video_job=jobs.enqueue(self.db,video);self.db.commit()
        jobs.configure(self.db,{'video_fps':2});self.db.commit()
        self.assertEqual(jobs.enqueue(self.db,photo),photo_job)
        self.assertNotEqual(jobs.enqueue(self.db,video),video_job);self.db.commit()
        jobs.control(self.db,'pause');jobs.configure(self.db,{'video_fps':3});jobs.control(self.db,'resume');self.db.commit()
        self.assertEqual(self.db.execute('SELECT state FROM people_jobs WHERE id=?',(photo_job,)).fetchone()[0],'queued')
        job=jobs.claim(self.db);self.assertEqual(job['id'],photo_job)
        def infer(db,job):
            jobs.configure(db,{'video_fps':1});db.commit()
            return {'observations':[],'new_crops':[],'model_key':'synthetic','scope':'image'}
        self.assertTrue(jobs.process(self.db,job,infer))
        self.assertEqual(self.db.execute('SELECT state FROM people_jobs WHERE id=?',(photo_job,)).fetchone()[0],'no_faces')

    def test_multiple_recursive_folders_deduplicate_and_respect_skip_or_rescan(self):
        base=self.case/'photos';other=self.case/'other'
        mids=[self.seed(base/'a.jpg',media_type='image'),self.seed(base/'sub/b.jpg',media_type='image'),
              self.seed(other/'c.mov'),self.seed(self.case/'photos-more/d.jpg',media_type='image')]
        old=jobs.enqueue(self.db,mids[0]);self.db.execute("UPDATE people_jobs SET state='done' WHERE id=?",(old,));self.db.commit()
        payload={'scope':'folders','folders':[str(base),str(base/'sub'),str(other)],'existing':'skip'}
        r=self.client.post('/api/people/jobs',json=payload);self.assertEqual(r.status_code,200,r.json)
        self.assertEqual((r.json['queued'],r.json['skipped']),(2,1))
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM people_jobs').fetchone()[0],3)
        again=self.client.post('/api/people/jobs',json=payload)
        self.assertEqual((again.json['queued'],again.json['skipped']),(0,3))
        payload['existing']='rescan';r=self.client.post('/api/people/jobs',json=payload)
        self.assertEqual(r.json['queued'],1)  # two jobs are already queued
        self.assertEqual(self.db.execute('SELECT state FROM people_jobs WHERE id=?',(old,)).fetchone()[0],'queued')
        self.assertIsNone(self.db.execute('SELECT 1 FROM people_jobs WHERE media_id=?',(mids[3],)).fetchone())

    def test_partial_folder_selection_keeps_parent_files_and_excludes_unchecked_subtrees(self):
        base=self.case/'相册_%';sub=base/'子目录'
        direct=self.seed(base/'one.jpg',media_type='image')
        self.seed(sub/'two.mov',media_type='video')
        self.seed(sub/'更深/three.jpg',media_type='image')
        sibling=self.seed(base/'保留/four.jpg',media_type='image')
        self.seed(self.case/'相册_%别的/five.jpg',media_type='image')
        self.seed(base/'six.wav',media_type='audio')
        result=self.client.post('/api/people/jobs',json={'scope':'folders','folders':[str(base/'保留')],
                                                       'direct_folders':[str(base)]})
        self.assertEqual(result.status_code,200,result.json)
        self.assertEqual(result.json['queued'],2)
        self.assertEqual({r[0] for r in self.db.execute('SELECT media_id FROM people_jobs')},{direct,sibling})

    def test_direct_folder_scope_handles_empty_recursive_list_and_deep_reselection(self):
        base=self.case/'相册';sub=base/'子目录'
        direct=self.seed(base/'one.jpg',media_type='image')
        self.seed(sub/'two.jpg',media_type='image')
        deep=self.seed(sub/'更深/three.jpg',media_type='image')
        result=self.client.post('/api/people/jobs',json={'scope':'folders','folders':[],
                                                       'direct_folders':[str(base),str(sub/'更深')]})
        self.assertEqual(result.status_code,200,result.json)
        self.assertEqual(result.json['queued'],2)
        self.assertEqual({r[0] for r in self.db.execute('SELECT media_id FROM people_jobs')},{direct,deep})

    def test_invalid_direct_folder_scopes_do_not_queue_any_media(self):
        self.seed(media_type='image')
        for direct in (['relative'],[''],[None],'/tmp',None):
            result=self.client.post('/api/people/jobs',json={'scope':'folders','folders':[str(self.case)],
                                                           'direct_folders':direct})
            self.assertEqual(result.status_code,409,result.json)
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM people_jobs').fetchone()[0],0)

    def test_skip_is_by_source_revision_and_does_not_duplicate_running_work_after_setting_change(self):
        mid=self.seed(media_type='image');jid=jobs.enqueue(self.db,mid);self.db.commit()
        job=jobs.claim(self.db)
        r=self.client.post('/api/people/jobs',json={'scope':'selected','media_ids':[mid],'existing':'rescan'})
        self.assertEqual(r.json['queued'],0);self.assertEqual(self.db.execute('SELECT lease FROM people_jobs WHERE id=?',(jid,)).fetchone()[0],job['lease'])
        self.db.execute("UPDATE people_jobs SET state='done' WHERE id=?",(jid,));self.db.commit()
        jobs.configure(self.db,{'profile':'raccoon_s'});self.db.commit()
        r=self.client.post('/api/people/jobs',json={'scope':'selected','media_ids':[mid],'existing':'skip'})
        self.assertEqual((r.json['queued'],r.json['skipped']),(0,1))
        self.db.execute('UPDATE media SET file_size=2 WHERE id=?',(mid,));self.db.commit()
        r=self.client.post('/api/people/jobs',json={'scope':'selected','media_ids':[mid],'existing':'skip'})
        self.assertEqual(r.json['queued'],1)

    def test_invalid_folder_scopes_and_policy_do_not_write_jobs(self):
        self.seed(media_type='image')
        for data in ({'scope':'folders','folders':[]}, {'scope':'folders','folders':['relative']},
                     {'scope':'all','confirm_all':True,'existing':'erase'}, {'scope':'folders','folders':'/tmp'}):
            self.assertEqual(self.client.post('/api/people/jobs',json=data).status_code,409)
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM people_jobs').fetchone()[0],0)

    def test_many_selected_folders_do_not_exceed_sql_expression_depth(self):
        mid=self.seed(self.case/'目录999/one.jpg',media_type='image')
        r=self.client.post('/api/people/jobs',json={'scope':'folders','folders':[str(self.case/f'目录{i}') for i in range(1000)]})
        self.assertEqual(r.status_code,200,r.json);self.assertEqual(r.json['queued'],1)
        self.assertEqual(self.db.execute('SELECT media_id FROM people_jobs').fetchone()[0],mid)

    def test_import_recognition_is_per_request_even_if_legacy_global_switch_is_on(self):
        self.db.execute("INSERT OR REPLACE INTO settings VALUES ('people_enabled','true')");self.db.commit()
        def prepared(name):
            path=self.case/name;path.write_bytes(b'synthetic')
            return {'file_path':str(path),'file_name':name,'media_type':'image','file_size':path.stat().st_size,'file_mtime':path.stat().st_mtime}
        no=importer._save_import(self.db,prepared('no.jpg'),None)
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM people_jobs').fetchone()[0],0)
        yes=importer._save_import(self.db,prepared('yes.jpg'),None,organize_people=True)
        self.assertEqual(self.db.execute('SELECT media_id FROM people_jobs').fetchone()[0],yes['id'])
        self.assertNotEqual(no['id'],yes['id'])
        self.assertEqual(self.client.post('/api/library/import-batch',json={'paths':['x'],'organize_people':'true'}).status_code,400)

    def test_single_and_batch_import_limit_face_jobs_without_filtering_imported_files(self):
        for endpoint in ('import-one','import-batch'):
            for scope,enabled,expected in [('image',True,{'image'}),('video',True,{'video'}),
                                            ('all',True,{'image','video'}),('video',False,set()),
                                            (None,True,{'image','video'})]:
                with self.subTest(endpoint=endpoint,scope=scope,enabled=enabled):
                    paths=[];prepared={}
                    for kind,ext in [('image','jpg'),('video','mov'),('audio','wav')]:
                        file=self.case/f'{endpoint}-{scope}-{enabled}.{ext}';file.write_bytes(b'synthetic media')
                        paths.append(str(file));prepared[str(file)]={'file_path':str(file),'file_name':file.name,
                            'media_type':kind,'file_size':file.stat().st_size,'file_mtime':file.stat().st_mtime}
                    option={'organize_people':enabled}
                    if scope is not None:option['people_media_type']=scope
                    with patch.object(importer,'_prepare_import',side_effect=lambda p,*a:prepared[str(p)]),\
                         patch.object(importer,'_run_exiftool_batch',return_value={}),\
                         patch.object(jobs,'ensure_worker'):
                        payloads=[{'paths':paths,**option}] if endpoint=='import-batch' else [{'path':p,**option} for p in paths]
                        for payload in payloads:
                            r=self.client.post('/api/library/'+endpoint,json=payload)
                            self.assertEqual(r.status_code,200,r.get_data(as_text=True));r.get_data()
                    marks=','.join('?' for _ in paths)
                    self.assertEqual(self.db.execute('SELECT COUNT(*) FROM media WHERE file_path IN ('+marks+')',paths).fetchone()[0],3)
                    queued={r[0] for r in self.db.execute('SELECT media_type FROM media JOIN people_jobs ON media.id=people_jobs.media_id WHERE file_path IN ('+marks+')',paths)}
                    self.assertEqual(queued,expected)

    def test_invalid_import_face_type_is_rejected_before_importing_or_queueing(self):
        for endpoint in ('import-one','import-batch'):
            for invalid in ('audio','images','',True,None,['image','video'],{}):
                with self.subTest(endpoint=endpoint,value=invalid):
                    r=self.client.post('/api/library/'+endpoint,json={'path':'/missing.jpg','paths':['/missing.jpg'],
                        'organize_people':True,'people_media_type':invalid})
                    self.assertEqual(r.status_code,400,r.get_data(as_text=True))
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM media').fetchone()[0],0)
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM people_jobs').fetchone()[0],0)

    def test_video_resolution_is_independent_of_analysis_and_changes_only_when_requested(self):
        mid=self.seed(media_type='video',duration=100)
        jid=jobs.enqueue(self.db,mid)
        for key,value in {'video_engine':'local','local_frames_fps':'.5','local_frames_max':'16','local_frames_res':'720'}.items():
            self.db.execute('INSERT OR REPLACE INTO settings VALUES (?,?)',(key,value))
        self.db.commit()
        self.assertEqual(jobs.video_settings(self.db),{'res':1080,'fps':1})
        self.assertEqual(jobs.enqueue(self.db,mid),jid)
        self.db.execute("INSERT OR REPLACE INTO settings VALUES ('video_engine','cloud')")
        self.db.execute("INSERT OR REPLACE INTO settings VALUES ('fps','5')")
        self.db.execute("INSERT OR REPLACE INTO settings VALUES ('resolution','240')");self.db.commit()
        self.assertEqual(jobs.video_settings(self.db),{'res':1080,'fps':1})
        self.assertEqual(jobs.enqueue(self.db,mid),jid)
        jobs.configure(self.db,{'video_resolution':'original'})
        self.assertEqual(jobs.video_settings(self.db),{'res':None,'fps':1})
        self.assertNotEqual(jobs.enqueue(self.db,mid),jid)

    def test_optional_verifier_filters_nonfaces_before_feature_extraction(self):
        engine=face_engine.FaceEngine.__new__(face_engine.FaceEngine)
        engine.detector=None
        points=face_engine._DEST.copy()
        engine.detect=lambda image:[{'box':np.array([0.,0.,112.,112.]),'points':points,'score':.99}]
        engine.recognizer=SimpleNamespace(run=Mock(return_value=[np.ones((1,512),dtype=np.float32)]),get_inputs=lambda:[SimpleNamespace(name='input')])
        engine.verifier=SimpleNamespace(run=Mock(return_value=[np.array([.05],dtype=np.float32)]),get_inputs=lambda:[SimpleNamespace(name='input',shape=['N',3,128,128],type='tensor(uint8)')])
        pixels=np.random.default_rng(12).integers(0,255,(112,112,3),dtype=np.uint8)
        self.assertEqual(engine.observe(Image.fromarray(pixels)),[])
        engine.recognizer.run.assert_not_called()
        engine.verifier=None
        self.assertEqual(len(engine.observe(Image.fromarray(pixels))),1)

    def test_video_settings_sample_entire_timeline_in_windows_not_total_frame_cap(self):
        import subprocess
        video=self.case/'sampling.mp4'
        subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','testsrc2=s=160x96:r=4:d=4',
                        '-c:v','libx264','-pix_fmt','yuv420p','-y',str(video)],check=True)
        row={'id':1,'media_type':'video','file_path':str(video),'duration':4,'fps':'4/1'}
        frames,scope=face_engine.read_frames(row,self.case/'cache',lambda:False,
                                           video_settings={'fps':2.,'max_frames':2,'res':96})
        observed=[(t,image.size) for t,image in frames]
        self.assertEqual(scope,'sampled_video')
        self.assertEqual([t for t,_ in observed],[0.,.5,1.,1.5,2.,2.5,3.,3.5])
        self.assertTrue(all(size==(160,96) for _,size in observed))
        self.assertEqual(list(self.case.glob('**/vlm_frames_*')),[])

    def test_shared_window_decoder_releases_each_consumed_window_and_close_cleans_up(self):
        import subprocess,tempfile
        from backend.analyzer import iter_video_frames
        video=self.case/'windows.mp4'
        subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','testsrc2=s=160x96:r=2:d=3',
                        '-c:v','libx264','-pix_fmt','yuv420p','-y',str(video)],check=True)
        make_directory=tempfile.TemporaryDirectory
        with patch('backend.analyzer.tempfile.TemporaryDirectory',side_effect=lambda **kw:make_directory(dir=self.case,**kw)):
            windows=iter_video_frames(video,fps=2,max_frames=2,frame_res=96)
            next(windows);directory=next(self.case.glob('vlm_frames_*'))
            self.assertTrue((directory/'w0').exists())
            next(windows);self.assertFalse((directory/'w0').exists())
            windows.close();self.assertFalse(directory.exists())

    def test_only_ambiguous_results_need_review_and_manual_decisions_survive_rescan(self):
        def obs(key,vector):return {'sample_key':key,'bbox':[.1,.1,.5,.5],'feature':vector,'quality':.9,'score':.99}
        a=self.seed(self.case/'a.jpg',media_type='image');b=self.seed(self.case/'b.jpg',media_type='image')
        f=people.record_observations(self.db,a,'v1','m',[obs('a',[1.,0.])])['faces'][0]
        people.record_observations(self.db,b,'v1','m',[obs('b',[.99,.01])])
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM people_reviews').fetchone()[0],0)
        people.decide_faces(self.db,[f['id']],'new',name='保留姓名')
        c=self.seed(self.case/'c.jpg',media_type='image')
        people.record_observations(self.db,c,'v1','m',[obs('c',[.5,.866])])
        self.assertGreater(self.db.execute("SELECT COUNT(*) FROM people_reviews WHERE state='pending'").fetchone()[0],0)
        people.record_observations(self.db,a,'v1','m',[obs('a',[1.,0.])])
        self.assertEqual(self.db.execute('SELECT assignment FROM people_faces WHERE id=?',(f['id'],)).fetchone()[0],'manual')
        self.assertTrue(self.db.execute("SELECT 1 FROM people_persons WHERE name='保留姓名'").fetchone())

    def test_low_quality_unassigned_faces_are_reviewable(self):
        mid=self.seed(media_type='image')
        result=people.record_observations(self.db,mid,'v1','m',[{'sample_key':'unclear','bbox':[.1,.1,.5,.5],
                  'feature':None,'quality':.1,'score':.7}])
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM people_reviews WHERE state='pending' AND face_id=?",(result['faces'][0]['id'],)).fetchone()[0],1)
        people.record_observations(self.db,mid,'v1','m',[])
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM people_reviews WHERE state='pending' AND face_id=?",(result['faces'][0]['id'],)).fetchone()[0],0)

    def test_long_video_observations_write_in_chunks_atomically_without_old_total_cap(self):
        mid=self.seed(media_type='video')
        jid=jobs.enqueue(self.db,mid);self.db.commit();job=jobs.claim(self.db)
        obs=[{'sample_key':str(i),'frame_time':float(i),'bbox':[.1,.1,.5,.5],
              'feature':None,'quality':.1,'score':.7} for i in range(10001)]
        self.assertTrue(jobs.process(self.db,job,lambda db,j:{'model_key':'s','observations':obs,'scope':'sampled_video'}))
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM people_faces WHERE active=1').fetchone()[0],10001)
        self.assertEqual(self.db.execute('SELECT face_count FROM people_jobs WHERE id=?',(jid,)).fetchone()[0],10001)
        jobs.enqueue(self.db,mid,force=True);self.db.commit();job=jobs.claim(self.db)
        bad=obs[:1001]+[{**obs[-1],'bbox':[-1,0,.1,.1]}]
        with self.assertRaises(people.Conflict):jobs.process(self.db,job,lambda db,j:{'model_key':'s','observations':bad,'scope':'sampled_video'})
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM people_faces WHERE active=1').fetchone()[0],10001)


if __name__=='__main__':unittest.main()
