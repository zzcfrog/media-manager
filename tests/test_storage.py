from support import _ROOT
import importlib
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest

class StorageTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix='storage-test-',dir=_ROOT);self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name);self.source=self.root/'old';self.source.mkdir()
        db=sqlite3.connect(self.source/'media.db');db.execute('CREATE TABLE media(id INTEGER PRIMARY KEY,file_path TEXT,notes TEXT)')
        db.execute("INSERT INTO media VALUES (1,'/offline/video.mov','keep notes')");db.commit();db.close()
        (self.source/'thumbnails').mkdir();(self.source/'thumbnails'/'one.jpg').write_bytes(b'preview')
        self.models=self.root/'models';self.models.mkdir();self.weights=self.root/'outside.gguf';self.weights.write_bytes(b'model weights')
        (self.models/'weights.gguf').symlink_to(self.weights)
        self.storage=importlib.import_module('backend.storage')

    def test_migration_preserves_source_and_materializes_external_links(self):
        dest=self.root/'library'
        report=self.storage.migrate_library(self.source,self.models,dest)
        self.assertEqual(report['database']['tables']['media']['rows'],1)
        self.assertEqual((dest/'models'/'weights.gguf').read_bytes(),b'model weights')
        self.assertFalse((dest/'models'/'weights.gguf').is_symlink())
        self.assertTrue((self.source/'media.db').is_file())
        self.assertTrue(self.storage.verify_library(dest)['ok'])

    def test_existing_destination_is_never_overwritten(self):
        dest=self.root/'library';dest.mkdir();(dest/'keep').write_bytes(b'keep')
        with self.assertRaises(FileExistsError):self.storage.migrate_library(self.source,self.models,dest)
        self.assertEqual((dest/'keep').read_bytes(),b'keep')

    def test_failed_copy_never_publishes_partial_library(self):
        from unittest.mock import patch
        dest=self.root/'library'
        with patch.object(self.storage,'copy_file',side_effect=OSError('copy failed')):
            with self.assertRaises(OSError):self.storage.migrate_library(self.source,self.models,dest)
        self.assertFalse(dest.exists());self.assertTrue((self.source/'media.db').exists())

    def test_backup_restore_and_corruption_rejection(self):
        library=self.root/'library';self.storage.migrate_library(self.source,self.models,library)
        backup=self.root/'portable';self.storage.export_library(library,backup)
        restored=self.root/'restored';self.storage.restore_library(backup,restored)
        self.assertEqual(self.storage.database_fingerprint(library/'media.db'),self.storage.database_fingerprint(restored/'media.db'))
        (backup/'library'/'models'/'weights.gguf').write_bytes(b'corrupt')
        with self.assertRaises(ValueError):self.storage.restore_library(backup,self.root/'bad-restore')
        self.assertFalse((self.root/'bad-restore').exists())

    def test_upgrade_snapshots_before_start_and_reuses_data(self):
        library=self.root/'library';self.storage.migrate_library(self.source,self.models,library)
        first=self.storage.prepare_upgrade(library,'1.0.1')
        self.assertTrue(Path(first['backup']).is_file())
        self.storage.mark_started(library,'1.0.1')
        self.assertIsNone(self.storage.prepare_upgrade(library,'1.0.1')['backup'])
        later=self.storage.prepare_upgrade(library,'1.0.2');self.assertTrue(Path(later['backup']).is_file())
        self.assertEqual(self.storage.database_fingerprint(library/'media.db'),self.storage.database_fingerprint(Path(later['backup'])))

    def test_newer_format_refused_before_database_changes(self):
        library=self.root/'library';self.storage.migrate_library(self.source,self.models,library)
        (library/'data-layout.json').write_text(json.dumps({'format_version':999,'app_version':'99.0.0'}))
        before=(library/'media.db').read_bytes()
        with self.assertRaises(ValueError):self.storage.prepare_upgrade(library,'1.0.1')
        self.assertEqual((library/'media.db').read_bytes(),before)
