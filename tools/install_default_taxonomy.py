"""Explicit, offline preset maintenance. The application must be stopped for --apply."""
import argparse
from datetime import datetime
import json
from pathlib import Path
import sqlite3
import sys
import uuid

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from backend.services import taxonomy_presets as presets
from backend.storage import library_lock,snapshot_database,database_fingerprint


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--library',type=Path,required=True)
    parser.add_argument('--catalog',type=Path,default=presets.DEFAULT_PATH)
    parser.add_argument('--remove-unused-legacy',action='store_true')
    parser.add_argument('--apply',action='store_true')
    args=parser.parse_args();library=args.library.resolve();database=library/'media.db'
    if not database.is_file():raise FileNotFoundError('资料库数据库不存在')
    data=presets.load_catalog(args.catalog)
    with sqlite3.connect(database.as_uri()+'?mode=ro',uri=True) as read:
        read.row_factory=sqlite3.Row
        ids=[r[0] for r in read.execute('SELECT id FROM taxonomy_nodes WHERE legacy=1')] if args.remove_unused_legacy else []
        preview=presets.preview_install(read,data,ids)
    if not args.apply or preview['already_installed']:
        print(json.dumps({k:v for k,v in preview.items() if k!='key_to_id'},ensure_ascii=False));return
    with library_lock(library):
        folder=library/'upgrade-backups';folder.mkdir(mode=0o700,exist_ok=True)
        backup=folder/('taxonomy-preset-'+datetime.now().strftime('%Y%m%d-%H%M%S')+'-'+uuid.uuid4().hex[:8]+'.db')
        snapshot_database(database,backup)
        before=database_fingerprint(backup)
        metadata={'operation':'default_taxonomy_v1','backup':str(backup),'state':'backed_up','before':before,
                  'preview':preview,'catalog':str(args.catalog.resolve())}
        receipt=backup.with_suffix('.json')
        receipt.write_text(json.dumps(metadata,ensure_ascii=False,indent=2)+'\n');receipt.chmod(0o600)
        db=sqlite3.connect(database,timeout=30);db.row_factory=sqlite3.Row
        try:
            db.execute('PRAGMA foreign_keys=ON');db.execute('BEGIN IMMEDIATE')
            old_settings=dict(db.execute('SELECT key,value FROM settings'))
            result=presets.install(db,data,ids)
            assert not db.execute('PRAGMA foreign_key_check').fetchall()
            allowed={presets.MARKER,'classification_semantic_revision','classification_label_revision','classification_event_revision'}
            new_settings=dict(db.execute('SELECT key,value FROM settings'))
            assert {k:v for k,v in old_settings.items() if k not in allowed}=={k:v for k,v in new_settings.items() if k not in allowed}
            db.commit()
            after=database_fingerprint(database)
            mutable={'tags','taxonomy_nodes','taxonomy_expressions','settings'}
            unchanged={t:after['tables'].get(t)==v for t,v in before['tables'].items() if t not in mutable}
            assert all(unchanged.values()),'非词库数据发生变化，已停止；保留所有现场，不自动恢复'
            assert after['tables']['taxonomy_nodes']['rows']==result['nodes']
            metadata.update(state='verified',result={k:v for k,v in result.items() if k!='key_to_id'},unchanged_tables=unchanged)
            receipt.write_text(json.dumps(metadata,ensure_ascii=False,indent=2)+'\n')
            print(json.dumps({'state':'verified','nodes':result['nodes'],'aliases':result['aliases'],'roots':result['roots'],
                              'max_depth':result['max_depth'],'removed_ids':ids,'unchanged_tables':len(unchanged),'backup':str(backup)},ensure_ascii=False))
        except Exception as error:
            db.rollback();metadata.update(state='failed_preserved',error_type=type(error).__name__)
            receipt.write_text(json.dumps(metadata,ensure_ascii=False,indent=2)+'\n');raise
        finally:db.close()


if __name__=='__main__':main()
