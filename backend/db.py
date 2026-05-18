import sqlite3
from flask import g, current_app

# SQLite connection management and schema bootstrap (auto-migrates on startup).


_SCHEMA = """
CREATE TABLE IF NOT EXISTS media (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    file_path       TEXT NOT NULL UNIQUE,
    file_name       TEXT NOT NULL,
    media_type      TEXT NOT NULL CHECK(media_type IN ('video', 'image')),
    file_size       INTEGER,
    duration        REAL,
    width           INTEGER,
    height          INTEGER,
    fps             TEXT,
    video_codec     TEXT,
    video_profile   TEXT,
    bit_rate        INTEGER,
    audio_codec     TEXT,
    audio_sample_rate INTEGER,
    audio_channels  INTEGER,
    color_space     TEXT,
    color_range     TEXT,
    pix_fmt         TEXT,
    camera_model    TEXT,
    date_taken      TEXT,
    thumbnail_path  TEXT,
    analysis_status TEXT DEFAULT 'none',
    analysis_model  TEXT,
    analysis_date   TEXT,
    rating          INTEGER DEFAULT 0,
    color_label     TEXT DEFAULT NULL,
    favorite        INTEGER DEFAULT 0,
    notes           TEXT DEFAULT '',
    imported_at     TEXT DEFAULT (datetime('now')),
    updated_at      TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_media_type ON media(media_type);
CREATE INDEX IF NOT EXISTS idx_media_rating ON media(rating);
CREATE INDEX IF NOT EXISTS idx_media_imported ON media(imported_at);

CREATE TABLE IF NOT EXISTS collections (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    cover_id    INTEGER REFERENCES media(id) ON DELETE SET NULL,
    created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS collection_items (
    collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    media_id      INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
    PRIMARY KEY (collection_id, media_id)
);

CREATE TABLE IF NOT EXISTS tags (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS media_tags (
    media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
    tag_id   INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (media_id, tag_id)
);

CREATE TABLE IF NOT EXISTS media_segment (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    media_id        INTEGER NOT NULL,
    time_start      TEXT NOT NULL,
    time_end        TEXT NOT NULL,
    visual          TEXT DEFAULT '',
    asr             TEXT DEFAULT '',
    subtitle        TEXT DEFAULT '',
    dominant_colors TEXT DEFAULT '',
    main_subjects   TEXT DEFAULT '',
    shot_type       TEXT DEFAULT '',
    focal_length    TEXT DEFAULT '',
    camera_angle    TEXT DEFAULT '',
    camera_movement TEXT DEFAULT '',
    perspective     TEXT DEFAULT '',
    scene_type      TEXT DEFAULT '',
    mood            TEXT DEFAULT '',
    lighting        TEXT DEFAULT '',
    weather         TEXT DEFAULT '',
    seq             INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_segment_media ON media_segment(media_id);
CREATE INDEX IF NOT EXISTS idx_segment_shot ON media_segment(shot_type);
CREATE INDEX IF NOT EXISTS idx_segment_mood ON media_segment(mood);
CREATE INDEX IF NOT EXISTS idx_segment_scene ON media_segment(scene_type);

CREATE VIRTUAL TABLE IF NOT EXISTS media_fts USING fts5(
    media_id UNINDEXED,
    file_name,
    visual,
    asr,
    subtitle,
    subjects,
    colors,
    tags,
    tokenize='unicode61'
);

CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""


def get_db() -> sqlite3.Connection:
    if "db" not in g:
        g.db = sqlite3.connect(current_app.config["DATABASE"])
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys=ON")
    return g.db


def get_setting(db, key: str, default: str = "") -> str:
    row = db.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else default


def close_db(exc):
    db = g.pop("db", None)
    if db:
        db.close()


_MIGRATIONS = [
    ("video_profile", "ALTER TABLE media ADD COLUMN video_profile TEXT"),
    ("bit_rate", "ALTER TABLE media ADD COLUMN bit_rate INTEGER"),
    ("audio_codec", "ALTER TABLE media ADD COLUMN audio_codec TEXT"),
    ("audio_sample_rate", "ALTER TABLE media ADD COLUMN audio_sample_rate INTEGER"),
    ("audio_channels", "ALTER TABLE media ADD COLUMN audio_channels INTEGER"),
    ("color_space", "ALTER TABLE media ADD COLUMN color_space TEXT"),
    ("color_range", "ALTER TABLE media ADD COLUMN color_range TEXT"),
    ("pix_fmt", "ALTER TABLE media ADD COLUMN pix_fmt TEXT"),
    ("camera_make", "ALTER TABLE media ADD COLUMN camera_make TEXT"),
    ("lens_model", "ALTER TABLE media ADD COLUMN lens_model TEXT"),
    ("dialogue_to_asr", None),  # handled in _migrate specially
    ("file_hash", "ALTER TABLE media ADD COLUMN file_hash TEXT"),
    ("phash", "ALTER TABLE media ADD COLUMN phash TEXT"),
    ("has_xmp", "ALTER TABLE media ADD COLUMN has_xmp INTEGER DEFAULT 0"),
    ("picture_control", "ALTER TABLE media ADD COLUMN picture_control TEXT"),
    ("embedding", "ALTER TABLE media ADD COLUMN embedding BLOB"),
]


def _migrate(db):
    cols = {r[1] for r in db.execute("PRAGMA table_info(media)").fetchall()}
    for name, sql in _MIGRATIONS:
        if name not in cols:
            if sql:
                db.execute(sql)

    # dup_exclusions table (pair-level, per dup_type)
    tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
    if "dup_exclusions" not in tables:
        db.execute(
            "CREATE TABLE dup_exclusions "
            "(media_id_a INTEGER NOT NULL, media_id_b INTEGER NOT NULL, "
            "dup_type TEXT NOT NULL DEFAULT 'similar', "
            "PRIMARY KEY (media_id_a, media_id_b, dup_type))"
        )
    else:
        # Migrate: add dup_type column if missing
        excl_cols = {r[1] for r in db.execute("PRAGMA table_info(dup_exclusions)").fetchall()}
        if "dup_type" not in excl_cols:
            db.execute("ALTER TABLE dup_exclusions ADD COLUMN dup_type TEXT NOT NULL DEFAULT 'similar'")
            db.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_dup_excl ON dup_exclusions (media_id_a, media_id_b, dup_type)")

    # dialogue → asr: rename column + rebuild FTS
    seg_cols = {r[1] for r in db.execute("PRAGMA table_info(media_segment)").fetchall()}
    if "dialogue" in seg_cols and "asr" not in seg_cols:
        db.execute("ALTER TABLE media_segment RENAME COLUMN dialogue TO asr")
    fts_cols = {r[1] for r in db.execute("PRAGMA table_info(media_fts)").fetchall()}
    if "dialogue" in fts_cols and "asr" not in fts_cols:
        db.execute("DROP TABLE IF EXISTS media_fts")
        db.execute(
            "CREATE VIRTUAL TABLE media_fts USING fts5("
            "media_id UNINDEXED, file_name, visual, asr, subtitle, subjects, colors, tags,"
            "tokenize='unicode61')"
        )
        rows = db.execute(
            "SELECT s.media_id, m.file_name, s.visual, s.asr, s.subtitle, s.dominant_colors, s.main_subjects "
            "FROM media_segment s JOIN media m ON m.id = s.media_id"
        ).fetchall()
        for r in rows:
            tags = db.execute(
                "SELECT t.name FROM tags t JOIN media_tags mt ON t.id = mt.tag_id WHERE mt.media_id = ?",
                (r["media_id"],),
            ).fetchall()
            tags_str = " ".join(t["name"] for t in tags)
            db.execute(
                "INSERT INTO media_fts (media_id, file_name, visual, asr, subtitle, subjects, colors, tags) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (r["media_id"], r["file_name"], r["visual"], r["asr"], r["subtitle"], r["main_subjects"], r["dominant_colors"], tags_str),
            )


_DEFAULTS = {
    "resolution": "480",
    "fps": "30",
    "vendor": "zhipu",
    "model": "glm-4.6v",
    "use_multimodal": "true",
    "asr_engine": "whisper",
    "video_api_key": "",
    "asr_api_key": "",
    "image_resolution": "1920",
    "image_api_key": "",
    "image_model": "glm-4.6v",
    "hw_accel": "false",
}


def init_db(app):
    with app.app_context():
        db = get_db()
        db.execute("PRAGMA journal_mode=WAL")
        db.executescript(_SCHEMA)
        _migrate(db)
        for k, v in _DEFAULTS.items():
            db.execute("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)", (k, v))
        db.commit()
        db.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        db.execute("VACUUM")
    app.teardown_appcontext(close_db)
