"""Preset installation must never relabel media or erase user-maintained trees."""
from support import DatabaseCase
from backend.services import taxonomy as tx, taxonomy_presets as presets


def catalog():
    return {'version':1,'title':'测试预置','nodes':[
        {'key':'scene','parent_key':None,'name':'场景','definition':'可观察场景','recognition_text':'scene','aliases':[]},
        {'key':'scene.nature','parent_key':'scene','name':'自然环境','definition':'自然环境','recognition_text':'nature','aliases':[]},
        {'key':'scene.nature.water','parent_key':'scene.nature','name':'水域','definition':'水域景观','recognition_text':'water','aliases':[]},
        {'key':'scene.nature.water.lake','parent_key':'scene.nature.water','name':'湖泊','definition':'湖面','recognition_text':'lake','aliases':['湖景']}]}


class PresetTests(DatabaseCase):
    def test_empty_install_preserves_media_and_never_enqueues_or_assigns(self):
        mid=self.seed(embedding=b'original-resnet')
        result=presets.install(self.db,catalog());self.db.commit()
        self.assertEqual(result['nodes'],4)
        self.assertEqual(tx.resolve(self.db,'湖景')[0]['name'],'湖泊')
        for table in ['media_tags','taxonomy_decisions','taxonomy_sources','taxonomy_jobs','taxonomy_relation_jobs']:
            self.assertEqual(self.db.execute('SELECT COUNT(*) FROM '+table).fetchone()[0],0)
        self.assertEqual(self.db.execute('SELECT embedding FROM media WHERE id=?',(mid,)).fetchone()[0],b'original-resnet')

    def test_replace_only_explicit_unused_legacy_nodes_without_reusing_ids(self):
        ids=[self.db.execute('INSERT INTO tags(name) VALUES (?)',(name,)).lastrowid for name in ['风景','建筑']]
        tx.init_schema(self.db);self.db.commit()
        result=presets.install(self.db,catalog(),remove_legacy_ids=ids);self.db.commit()
        self.assertEqual(sorted(result['removed_ids']),ids)
        self.assertGreater(min(result['key_to_id'].values()),max(ids))
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM taxonomy_nodes WHERE legacy=1').fetchone()[0],0)
        self.assertEqual(self.db.execute('PRAGMA foreign_key_check').fetchall(),[])

    def test_referenced_legacy_or_unselected_custom_tree_is_not_deleted(self):
        tag=self.db.execute("INSERT INTO tags(name) VALUES ('旧标签')").lastrowid
        tx.init_schema(self.db);mid=self.seed();tx.decide(self.db,[mid],tag,'confirm');self.db.commit()
        before=[tuple(r) for r in self.db.execute('SELECT * FROM tags')]
        with self.assertRaises(tx.Conflict):presets.install(self.db,catalog(),remove_legacy_ids=[tag])
        self.assertEqual([tuple(r) for r in self.db.execute('SELECT * FROM tags')],before)
        self.assertEqual(tx.summaries(self.db,[mid])[mid],1)
        self.assertFalse(presets.ensure_defaults(self.db,catalog()))

    def test_json_references_are_protected_even_without_foreign_keys(self):
        tag=self.db.execute("INSERT INTO tags(name) VALUES ('旧标签')").lastrowid
        tx.init_schema(self.db);tx.save_collection(self.db,'保留图集',{'tag_ids':[tag]});self.db.commit()
        with self.assertRaises(tx.Conflict):presets.install(self.db,catalog(),remove_legacy_ids=[tag])
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM tags').fetchone()[0],1)

    def test_repeat_install_does_not_restore_deleted_or_renamed_user_nodes(self):
        result=presets.install(self.db,catalog());node=tx.get_node(self.db,result['key_to_id']['scene'])
        tx.update_node(self.db,node['id'],{'name':'我的场景'},node['version']);self.db.commit()
        before=self.db.total_changes
        again=presets.install(self.db,catalog());self.db.commit()
        self.assertTrue(again['already_installed']);self.assertEqual(self.db.total_changes,before)
        self.assertEqual(tx.get_node(self.db,node['id'])['name'],'我的场景')

    def test_partial_insert_failure_rolls_back_old_and_new_labels(self):
        tag=self.db.execute("INSERT INTO tags(name) VALUES ('旧标签')").lastrowid
        tx.init_schema(self.db);self.db.execute("CREATE TRIGGER reject_preset BEFORE INSERT ON taxonomy_nodes WHEN NEW.name='水域' BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");self.db.commit()
        with self.assertRaises(Exception):presets.install(self.db,catalog(),remove_legacy_ids=[tag])
        self.assertEqual([tuple(r) for r in self.db.execute('SELECT id,name FROM tags')],[(tag,'旧标签')])
        self.assertIsNone(self.db.execute('SELECT 1 FROM settings WHERE key=?',(presets.MARKER,)).fetchone())

    def test_invalid_tree_and_alias_ownership_are_rejected_before_writes(self):
        broken=catalog();broken['nodes'][-1]['aliases']=['水域']
        with self.assertRaises(tx.Conflict):presets.install(self.db,broken)
        broken=catalog();broken['nodes'].append({**broken['nodes'][-1],'key':'level5','parent_key':broken['nodes'][-1]['key']})
        with self.assertRaises(tx.Conflict):presets.install(self.db,broken)
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM tags').fetchone()[0],0)

    def test_equivalent_alias_spellings_and_canonical_self_alias_do_not_abort(self):
        data=catalog();data['nodes'][-1]['aliases']=['lake','Lake','ＬＡＫＥ','湖泊']
        result=presets.install(self.db,data);self.db.commit()
        self.assertEqual(result['aliases'],1)
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM taxonomy_expressions').fetchone()[0],1)

    def test_shipped_catalog_is_four_dimensional_and_rich_but_bounded(self):
        data=presets.load_catalog()
        stats=presets.validate(data)
        self.assertGreaterEqual(stats['nodes'],800)
        self.assertEqual(stats['max_depth'],4)
        self.assertEqual({n['name'] for n in data['nodes'] if n['parent_key'] is None},{'场景','主体','活动','视觉特征'})
        result=presets.install(self.db,data);self.db.commit()
        self.assertEqual(result['nodes'],stats['nodes'])
        self.assertEqual(self.db.execute('PRAGMA foreign_key_check').fetchall(),[])
