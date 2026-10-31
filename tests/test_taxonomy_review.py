"""Regressions for independently reviewed asynchronous taxonomy changes."""
from support import DatabaseCase
from unittest.mock import patch
from backend.services import taxonomy as tx, taxonomy_review as review, classification_jobs as jobs


class ReviewRegressionTests(DatabaseCase):
    def candidate(self,mid,tag,term=None,stage='fast',extra=None):
        revision=tx.input_revision(self.db,mid,stage)
        evidence={'origin':stage,**(extra or {})}
        cid=self.db.execute('INSERT INTO taxonomy_candidates(media_id,tag_id,term,kind,evidence,source_key,input_revision) VALUES (?,?,?,?,?,?,?)',
             (mid,tag['id'] if tag else None,term or tag['name'],stage,tx._json(evidence),str(self.db.total_changes),revision)).lastrowid
        review.track_candidate(self.db,cid,'batch1');self.db.commit();return cid

    def test_old_rejection_cannot_remove_a_new_manual_confirmation(self):
        mid=self.seed();tag=tx.create_node(self.db,'人物');cid=self.candidate(mid,tag)
        tx.decide(self.db,[mid],tag['id'],'confirm');self.db.commit()
        response=self.client.post('/api/taxonomy/candidates/review',json={'ids':[cid],'accept':False})
        self.assertEqual(response.status_code,409)
        self.assertEqual(tx.summaries(self.db,[mid])[mid],1)
        self.assertEqual(self.db.execute('SELECT decision FROM taxonomy_decisions').fetchone()[0],'confirm')

    def test_changed_definition_needs_revalidation_but_unrelated_change_does_not(self):
        mid=self.seed();tag=tx.create_node(self.db,'植物');cid=self.candidate(mid,tag)
        other=tx.create_node(self.db,'汽车');self.db.commit()
        review.validate_candidate(self.db,self.db.execute('SELECT * FROM taxonomy_candidates WHERE id=?',(cid,)).fetchone())
        tx.update_node(self.db,tag['id'],{'definition':'只含花卉'},tag['version']);self.db.commit()
        self.assertEqual(self.client.post('/api/taxonomy/candidates/review',json={'ids':[cid],'accept':True}).status_code,409)
        self.assertEqual(self.client.post(f'/api/taxonomy/candidates/{cid}/revalidate',json={}).status_code,200)
        self.assertEqual(self.client.post('/api/taxonomy/candidates/review',json={'ids':[cid],'accept':True}).status_code,200)

    def test_remapping_target_description_and_decisions_are_version_checked(self):
        mid=self.seed();source=tx.create_node(self.db,'苹果');target=tx.create_node(self.db,'水果',definition='食用水果')
        cid=self.candidate(mid,source)
        data={'ids':[cid],'accept':True,'tag_id':target['id']}
        self.assertEqual(self.client.post('/api/taxonomy/candidates/review',json=data).status_code,409)
        data.update(self.client.post('/api/taxonomy/candidates/review/preview',json=data).json)
        target=tx.update_node(self.db,target['id'],{'definition':'电脑品牌'},target['version']);self.db.commit()
        self.assertEqual(self.client.post('/api/taxonomy/candidates/review',json=data).status_code,409)
        data.update(self.client.post('/api/taxonomy/candidates/review/preview',json=data).json)
        tx.update_node(self.db,target['id'],{'name':'显示改名'},target['version']);self.db.commit()
        self.assertEqual(self.client.post('/api/taxonomy/candidates/review',json=data).status_code,200)

    def test_merged_candidate_requires_refresh_and_then_writes_only_target(self):
        mid=self.seed();a=tx.create_node(self.db,'单车');b=tx.create_node(self.db,'自行车');cid=self.candidate(mid,a)
        plan=tx.preview_merge(self.db,[a['id']],b['id']);tx.apply_plan(self.db,plan);self.db.commit()
        self.assertEqual(self.client.post('/api/taxonomy/candidates/review',json={'ids':[cid],'accept':True}).status_code,409)
        self.assertEqual(self.client.post(f'/api/taxonomy/candidates/{cid}/revalidate',json={}).status_code,200)
        self.assertEqual(self.client.post('/api/taxonomy/candidates/review',json={'ids':[cid],'accept':True}).status_code,200)
        self.assertEqual([r[0] for r in self.db.execute('SELECT tag_id FROM media_tags')],[b['id']])
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM taxonomy_sources WHERE origin='fast'").fetchone()[0],1)

    def test_same_display_word_keeps_both_concepts_and_meanings(self):
        mid=self.seed();fruit=tx.create_node(self.db,'水果');brand=tx.create_node(self.db,'品牌')
        a=tx.create_node(self.db,'苹果',fruit['id']);b=tx.create_node(self.db,'苹果',brand['id'])
        jobs.enqueue(self.db,mid,'fast');self.db.commit();job=jobs.claim(self.db)
        payload=[{'term':'苹果','evidence':{'tag_id':n['id'],'version':n['version']}} for n in (a,b)]
        jobs.process(self.db,job,infer=lambda db,j:payload)
        self.assertEqual({r[0] for r in self.db.execute('SELECT tag_id FROM taxonomy_candidates')},{a['id'],b['id']})

    def test_explicit_requeue_after_model_or_semantics_change_reuses_image_not_done_state(self):
        mid=self.seed();tag=tx.create_node(self.db,'风景')
        jid=jobs.enqueue(self.db,mid,'fast');self.db.commit()
        jobs.process(self.db,jobs.claim(self.db),infer=lambda d,j:[])
        tx.update_node(self.db,tag['id'],{'definition':'海边风景'},tag['version'])
        self.assertEqual(jobs.enqueue(self.db,mid,'fast',priority=100),jid);self.db.commit()
        self.assertEqual(self.db.execute('SELECT state FROM taxonomy_jobs WHERE id=?',(jid,)).fetchone()[0],'queued')
        self.assertIsNotNone(jobs.claim(self.db))

    def test_import_redelivery_does_not_repeat_completed_inference(self):
        mid=self.seed();tx.create_node(self.db,'风景')
        jid=jobs.enqueue(self.db,mid);self.db.commit()
        jobs.process(self.db,jobs.claim(self.db),infer=lambda d,j:[])
        key=self.db.execute('SELECT matching_key FROM taxonomy_job_context WHERE job_id=?',(jid,)).fetchone()[0]
        self.assertEqual(jobs.enqueue(self.db,mid),jid)
        self.assertEqual(self.db.execute('SELECT state FROM taxonomy_jobs WHERE id=?',(jid,)).fetchone()[0],'done')
        self.assertEqual(self.db.execute('SELECT matching_key FROM taxonomy_job_context WHERE job_id=?',(jid,)).fetchone()[0],key)
        jobs.enqueue(self.db,mid,priority=100)
        self.assertEqual(self.db.execute('SELECT state FROM taxonomy_jobs WHERE id=?',(jid,)).fetchone()[0],'done')

    def test_explicit_request_promotes_existing_import_job_and_deadline_pauses_lease(self):
        import time
        first=self.seed();second=self.seed(self.case/'second.jpg')
        jobs.enqueue(self.db,first);jid=jobs.enqueue(self.db,second);self.db.commit()
        jobs.enqueue(self.db,second,priority=100);self.db.commit()
        job=jobs.claim(self.db);self.assertEqual(job['id'],jid)
        job['_deadline']=time.monotonic()-1
        self.assertFalse(jobs.process(self.db,job,infer=lambda d,j:self.fail('expired job ran inference')))
        self.assertEqual(tuple(self.db.execute('SELECT state,lease FROM taxonomy_jobs WHERE id=?',(jid,)).fetchone()),('paused',None))

    def test_future_crash_lease_schedules_recovery_without_busy_loop(self):
        import time
        mid=self.seed();jid=jobs.enqueue(self.db,mid);self.db.commit()
        jobs.claim(self.db)
        self.db.execute('UPDATE taxonomy_jobs SET lease_until=? WHERE id=?',(time.time()+20,jid));self.db.commit()
        with patch.object(jobs.threading,'Timer') as timer:
            jobs._resume_expired_leases(self.app,self.app.config['DATABASE'],self.db)
            self.assertEqual(timer.call_count,1)
            self.assertGreater(timer.call_args.args[0],19)
            self.assertLess(timer.call_args.args[0],21)
            timer.return_value.start.assert_called_once()
        jobs._recovery_timers.pop(self.app.config['DATABASE'],None)

    def test_explicit_retry_failed_same_basis_and_analysis_batch_grouping(self):
        from backend.blueprints.analysis import _claim_analysis,save_segments
        from flask import g
        mids=[self.seed(self.case/(str(i)+'.jpg')) for i in range(2)]
        with self.app.test_request_context('/api/analysis/batch',json={'organize_tags':True}):
            g.classification_analysis_batch='shared-batch'
            for mid in mids:
                self.assertTrue(_claim_analysis(self.db,mid))
                with patch.object(jobs,'ensure_worker'):
                    save_segments(mid,[{'time_start':'00:00:00','time_end':'00:00:01','visual':'花朵','main_subjects':['花']}])
        self.assertEqual({r[0] for r in self.db.execute('SELECT batch_id FROM taxonomy_job_context')},{'shared-batch'})
        jid=self.db.execute('SELECT id FROM taxonomy_jobs LIMIT 1').fetchone()[0]
        self.db.execute("UPDATE taxonomy_jobs SET state='failed',attempts=3 WHERE id=?",(jid,))
        jobs.enqueue(self.db,mids[0],'analysis',priority=100)
        self.assertEqual(tuple(self.db.execute('SELECT state,attempts FROM taxonomy_jobs WHERE id=?',(jid,)).fetchone()),('queued',0))

    def test_pause_running_waiter_clears_lease_and_retry_resets_budget(self):
        mid=self.seed();jid=jobs.enqueue(self.db,mid,'fast');self.db.commit();job=jobs.claim(self.db)
        self.assertEqual(self.client.post('/api/taxonomy/jobs/control',json={'ids':[jid],'action':'pause'}).status_code,200)
        row=self.db.execute('SELECT state,lease FROM taxonomy_jobs WHERE id=?',(jid,)).fetchone()
        self.assertEqual(tuple(row),('paused',None))
        self.db.execute("UPDATE taxonomy_jobs SET state='failed',attempts=3 WHERE id=?",(jid,));self.db.commit()
        with patch.object(jobs,'ensure_worker'):
            self.assertEqual(self.client.post('/api/taxonomy/jobs/control',json={'ids':[jid],'action':'resume'}).status_code,200)
        self.assertIsNotNone(jobs.claim(self.db))

    def test_group_members_page_and_declined_meaning_does_not_reopen(self):
        mids=[self.seed(self.case/(str(i)+'.jpg')) for i in range(4)]
        for mid in mids:self.candidate(mid,None,'生僻物品',extra={'parent':'工具'})
        groups=self.client.get('/api/taxonomy/candidates/groups').json['data']
        self.assertEqual(len(groups),1);self.assertEqual(groups[0]['count'],4)
        group=groups[0]['group_key']
        self.assertEqual(len(self.client.get('/api/taxonomy/candidates',query_string={'group':group,'per_page':2}).json['data']),2)
        cid=groups[0]['samples'][0]['id']
        self.client.post('/api/taxonomy/candidates/review',json={'ids':[cid],'accept':False})
        new=self.seed(self.case/'new.jpg');self.candidate(new,None,'生僻物品',extra={'parent':'工具'})
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM taxonomy_candidates WHERE state='pending'").fetchone()[0],0)
        self.candidate(new,None,'生僻物品',extra={'parent':'植物'})
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM taxonomy_candidates WHERE state='pending'").fetchone()[0],1)

    def test_historical_preview_has_no_write_and_lists_ambiguity_and_missing_results(self):
        mid=self.seed();other=self.seed(self.case/'empty.jpg');self.segments(mid)
        a=tx.create_node(self.db,'主体');b=tx.create_node(self.db,'产品')
        tx.create_node(self.db,'苹果',a['id']);tx.create_node(self.db,'苹果',b['id']);tx.create_node(self.db,'山')
        self.db.execute('UPDATE media_segment SET main_subjects=? WHERE media_id=?',('["苹果","山","新主体"]',mid));self.db.commit()
        response=self.client.post('/api/taxonomy/jobs/preview',json={'media_ids':[mid,other]})
        self.assertEqual(response.status_code,200,response.json)
        self.assertEqual((response.json['available_count'],response.json['skipped_count']),(1,1))
        self.assertEqual([r['term'] for r in response.json['ambiguous_terms']],['苹果'])
        self.assertEqual([r['term'] for r in response.json['matched_terms']],['山'])
        self.assertIn('新主体',[r['term'] for r in response.json['unmatched_terms']])
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM taxonomy_jobs').fetchone()[0],0)
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM media_tags').fetchone()[0],0)

    def test_history_requeue_tracks_relevant_vocabulary_only(self):
        mid=self.seed();self.segments(mid)
        self.db.execute('UPDATE media_segment SET main_subjects=? WHERE media_id=?',('["风景"]',mid));self.db.commit()
        jid=jobs.enqueue(self.db,mid,'analysis',priority=100);self.db.commit()
        jobs.process(self.db,jobs.claim(self.db))
        tx.create_node(self.db,'完全无关');jobs.enqueue(self.db,mid,'analysis',priority=100);self.db.commit()
        self.assertIsNone(jobs.claim(self.db))
        tag=tx.create_node(self.db,'风景');jobs.enqueue(self.db,mid,'analysis',priority=100);self.db.commit()
        job=jobs.claim(self.db);self.assertEqual(job['id'],jid);jobs.process(self.db,job)
        self.assertIsNotNone(self.db.execute('SELECT 1 FROM taxonomy_candidates WHERE tag_id=?',(tag['id'],)).fetchone())

    def test_candidate_cleanup_requires_explicit_confirmation_and_preserves_sources_and_pending(self):
        mid=self.seed();node=tx.create_node(self.db,'人像');cid=self.candidate(mid,node)
        review.review(self.db,[cid],True);pending=self.candidate(mid,None,'待审词')
        rejected=self.candidate(mid,None,'过期新词');review.review(self.db,[rejected],False)
        self.db.execute("UPDATE taxonomy_candidates SET updated_at='2000-01-01'");self.db.commit()
        response=self.client.post('/api/taxonomy/candidates/cleanup',json={})
        self.assertEqual(response.json['count'],1)
        self.assertIsNotNone(self.db.execute('SELECT id FROM taxonomy_candidates WHERE id=?',(rejected,)).fetchone())
        self.client.post('/api/taxonomy/candidates/cleanup',json={'confirm':True})
        self.assertIsNone(self.db.execute('SELECT id FROM taxonomy_candidates WHERE id=?',(rejected,)).fetchone())
        self.assertIsNotNone(self.db.execute('SELECT id FROM taxonomy_candidates WHERE id=?',(pending,)).fetchone())
        self.assertEqual(tx.summaries(self.db,[mid])[mid],1)
        self.assertIsNotNone(self.db.execute('SELECT 1 FROM taxonomy_sources').fetchone())
        self.assertIsNotNone(self.db.execute('SELECT 1 FROM taxonomy_closed_proposals').fetchone())

    def test_library_export_restore_keeps_every_taxonomy_table_and_original_embedding(self):
        import sqlite3
        from backend.storage import export_library,restore_library,database_fingerprint
        mid=self.seed(embedding=b'existing-resnet');self.segments(mid)
        node=tx.create_node(self.db,'文档');tx.add_expression(self.db,node['id'],'文件')
        tx.decide(self.db,[mid],node['id'],'confirm')
        tx.save_collection(self.db,'资料图集',{'tag_ids':[node['id']]})
        self.client.post('/api/taxonomy/examples/'+str(node['id']),json={'media_id':mid,'role':'positive'})
        jobs.enqueue(self.db,mid,'analysis');self.db.commit();jobs.process(self.db,jobs.claim(self.db))
        library=self.case/'export-library';library.mkdir()
        with sqlite3.connect(library/'media.db') as destination:self.db.backup(destination)
        export_library(library,self.case/'portable');restore_library(self.case/'portable',self.case/'restored')
        self.assertEqual(database_fingerprint(library/'media.db'),database_fingerprint(self.case/'restored'/'media.db'))
        with sqlite3.connect(self.case/'restored'/'media.db') as restored:
            for table in tx.TABLES:
                self.assertEqual(restored.execute('SELECT COUNT(*) FROM '+table).fetchone()[0],self.db.execute('SELECT COUNT(*) FROM '+table).fetchone()[0])
            self.assertEqual(restored.execute('PRAGMA foreign_key_check').fetchall(),[])
            self.assertEqual(restored.execute('SELECT embedding FROM media WHERE id=?',(mid,)).fetchone()[0],b'existing-resnet')
