import sqlite3

from loguru import logger
from flask import g, current_app

# SQLite connection management and schema bootstrap (auto-migrates on startup).


_SCHEMA = """
CREATE TABLE IF NOT EXISTS media (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    file_path       TEXT NOT NULL UNIQUE,
    file_name       TEXT NOT NULL,
    media_type      TEXT NOT NULL CHECK(media_type IN ('video', 'image', 'audio')),
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
    updated_at      TEXT DEFAULT (datetime('now')),
    music_title     TEXT,
    music_artist    TEXT,
    music_album     TEXT,
    music_summary   TEXT
);

CREATE INDEX IF NOT EXISTS idx_media_type ON media(media_type);
CREATE INDEX IF NOT EXISTS idx_media_rating ON media(rating);
CREATE INDEX IF NOT EXISTS idx_media_imported ON media(imported_at);

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
    color_tone      TEXT DEFAULT '',
    tone            TEXT DEFAULT '',
    dof             TEXT DEFAULT '',
    style           TEXT DEFAULT '',
    composition     TEXT DEFAULT '',
    highlights      TEXT DEFAULT '',
    emotions        TEXT DEFAULT '',
    seq             INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_segment_media ON media_segment(media_id);
CREATE INDEX IF NOT EXISTS idx_segment_shot ON media_segment(shot_type);
CREATE INDEX IF NOT EXISTS idx_segment_mood ON media_segment(mood);

CREATE TABLE IF NOT EXISTS music_segment (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    media_id        INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
    time_start      TEXT NOT NULL,
    time_end        TEXT NOT NULL,
    mood_json       TEXT DEFAULT '[]',
    genre_json      TEXT DEFAULT '[]',
    instrument_json TEXT DEFAULT '[]',
    theme_json      TEXT DEFAULT '[]',
    arousal         REAL,
    valence         REAL,
    vocals          TEXT DEFAULT '',
    vocals_language TEXT DEFAULT '',
    watermark       TEXT DEFAULT 'None',
    watermark_text  TEXT DEFAULT '',
    seq             INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_music_segment_media ON music_segment(media_id);
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

CREATE TABLE IF NOT EXISTS projects (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    description TEXT DEFAULT '',
    created_at  TEXT DEFAULT (datetime('now')),
    updated_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS project_media (
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    media_id   INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
    PRIMARY KEY (project_id, media_id)
);

CREATE TABLE IF NOT EXISTS project_tracks (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id    INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    version       INTEGER DEFAULT 1,
    position      INTEGER DEFAULT 0,
    track_type    TEXT NOT NULL CHECK(track_type IN ('theme','emotion','narration','subtitle','text','video')),
    segment_id    INTEGER REFERENCES media_segment(id) ON DELETE SET NULL,
    content       TEXT DEFAULT '',
    time_start    TEXT DEFAULT '',
    time_end      TEXT DEFAULT '',
    emotion_value REAL DEFAULT 0.5,
    metadata      TEXT DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_tracks_project ON project_tracks(project_id, version, position);
CREATE INDEX IF NOT EXISTS idx_project_media_project ON project_media(project_id);
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
    ("file_mtime", "ALTER TABLE media ADD COLUMN file_mtime REAL"),
    ("color_tone", "ALTER TABLE media_segment ADD COLUMN color_tone TEXT DEFAULT ''"),
    ("tone", "ALTER TABLE media_segment ADD COLUMN tone TEXT DEFAULT ''"),
    ("dof", "ALTER TABLE media_segment ADD COLUMN dof TEXT DEFAULT ''"),
    ("style", "ALTER TABLE media_segment ADD COLUMN style TEXT DEFAULT ''"),
    ("composition", "ALTER TABLE media_segment ADD COLUMN composition TEXT DEFAULT ''"),
    ("highlights", "ALTER TABLE media_segment ADD COLUMN highlights TEXT DEFAULT ''"),
    ("emotions", "ALTER TABLE media_segment ADD COLUMN emotions TEXT DEFAULT ''"),
    ("creative_brief", "ALTER TABLE projects ADD COLUMN creative_brief TEXT"),
    ("ai_plan", "ALTER TABLE projects ADD COLUMN ai_plan TEXT"),
]


def _migrate(db):
    cols = {r[1] for r in db.execute("PRAGMA table_info(media)").fetchall()}
    seg_cols = {r[1] for r in db.execute("PRAGMA table_info(media_segment)").fetchall()}
    proj_cols = {r[1] for r in db.execute("PRAGMA table_info(projects)").fetchall()}
    all_known = cols | seg_cols | proj_cols
    for name, sql in _MIGRATIONS:
        if name not in all_known:
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
        # Ensure PK includes dup_type — rebuild table if needed
        excl_cols = {r[1] for r in db.execute("PRAGMA table_info(dup_exclusions)").fetchall()}
        if "dup_type" not in excl_cols:
            db.execute("ALTER TABLE dup_exclusions ADD COLUMN dup_type TEXT NOT NULL DEFAULT 'similar'")
        # Check if PK already includes dup_type
        pk_cols = [r for r in db.execute("PRAGMA table_info(dup_exclusions)").fetchall() if r[5]]
        if len(pk_cols) < 3:
            db.execute(
                "CREATE TABLE dup_exclusions_new "
                "(media_id_a INTEGER NOT NULL, media_id_b INTEGER NOT NULL, "
                "dup_type TEXT NOT NULL DEFAULT 'similar', "
                "PRIMARY KEY (media_id_a, media_id_b, dup_type))"
            )
            db.execute("INSERT OR IGNORE INTO dup_exclusions_new SELECT * FROM dup_exclusions")
            db.execute("DROP TABLE dup_exclusions")
            db.execute("ALTER TABLE dup_exclusions_new RENAME TO dup_exclusions")

    # media 表重建：media_type CHECK 加 'audio' + music 四列。
    # SQLite 无法 ALTER CHECK，需建新表拷数据；dup_exclusions 重建（上方）的同款模式。
    row = db.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='media'").fetchone()
    if row and "'audio'" not in row[0]:
        import re
        import shutil
        from pathlib import Path
        # 迁移前整库备份（WAL 先 checkpoint 确保主文件完整）
        db.commit()
        db.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        db.commit()
        try:
            src = Path(current_app.config["DATABASE"])
            shutil.copy(src, src.with_suffix(".db.bak-music"))
        except Exception as e:
            logger.warning("media rebuild backup failed (continuing): {}", e)
        db.execute("PRAGMA foreign_keys=OFF")  # 否则 DROP media 级联清空子表
        m = re.search(r"(CREATE TABLE IF NOT EXISTS media \(.*?\n\))", _SCHEMA, re.S)
        db.execute("DROP TABLE IF EXISTS media_new")
        db.execute(m.group(1).replace("CREATE TABLE IF NOT EXISTS media", "CREATE TABLE media_new"))
        old_info = db.execute("PRAGMA table_info(media)").fetchall()
        new_cols = {r[1] for r in db.execute("PRAGMA table_info(media_new)").fetchall()}
        # 关键：_MIGRATIONS 历史 ALTER 列（file_mtime/audio_*/embedding 等）不在 _SCHEMA 里，
        # 必须先逐个补进 media_new，否则交集拷贝会静默丢列丢数据（2026-08-18 事故）
        for r in old_info:
            if r[1] == "id" or r[1] in new_cols:
                continue
            ddl = f'ALTER TABLE media_new ADD COLUMN "{r[1]}" {r[2] or "TEXT"}'
            if r[4] is not None:
                ddl += f" DEFAULT {r[4]}"
            db.execute(ddl)
            new_cols.add(r[1])
        keep = [r[1] for r in old_info if r[1] != "id"]
        cols_sql = ", ".join(f'"{c}"' for c in keep)
        db.execute(f"INSERT INTO media_new (id, {cols_sql}) SELECT id, {cols_sql} FROM media")
        db.execute("DROP TABLE media")
        db.execute("ALTER TABLE media_new RENAME TO media")
        for idx_sql in (
            "CREATE INDEX IF NOT EXISTS idx_media_type ON media(media_type)",
            "CREATE INDEX IF NOT EXISTS idx_media_rating ON media(rating)",
            "CREATE INDEX IF NOT EXISTS idx_media_imported ON media(imported_at)",
        ):
            db.execute(idx_sql)
        db.execute("PRAGMA foreign_keys=ON")
        db.commit()
        logger.info("media table rebuilt: media_type CHECK + music columns (backup: .db.bak-music)")

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

    # Convert segment time format from MM:SS.ss to HH:MM:SS.ss
    if get_setting(db, "time_format_hms") != "1":
        rows = db.execute("SELECT id, time_start, time_end FROM media_segment").fetchall()
        for r in rows:
            ns = _to_hms(r["time_start"])
            ne = _to_hms(r["time_end"])
            if ns != r["time_start"] or ne != r["time_end"]:
                db.execute("UPDATE media_segment SET time_start=?, time_end=? WHERE id=?",
                           (ns, ne, r["id"]))
        db.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('time_format_hms', '1')")

    # Fix timestamps where seconds >= 60 or minutes >= 60
    if get_setting(db, "time_overflow_fixed") != "1":
        rows = db.execute("SELECT id, time_start, time_end FROM media_segment WHERE time_start LIKE '%:%:%' OR time_end LIKE '%:%:%'").fetchall()
        fixed = 0
        for r in rows:
            ns = _fix_overflow_timestamp(r["time_start"])
            ne = _fix_overflow_timestamp(r["time_end"])
            if ns != r["time_start"] or ne != r["time_end"]:
                db.execute("UPDATE media_segment SET time_start=?, time_end=? WHERE id=?",
                           (ns, ne, r["id"]))
                fixed += 1
        if fixed:
            logger.info(f"Fixed {fixed} segments with overflow timestamps")
        db.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('time_overflow_fixed', '1')")

    logger.info("DB migrations applied")


def _to_hms(t):
    if not t or ":" not in t:
        return t
    parts = t.split(":")
    if len(parts) != 2:
        return t
    mm = int(parts[0])
    hh, mm = divmod(mm, 60)
    return f"{hh:02d}:{mm:02d}:{parts[1]}"


def _fix_overflow_timestamp(t):
    """Fix timestamps where seconds >= 60 or minutes >= 60."""
    if not t or ":" not in t:
        return t
    parts = t.split(":")
    if len(parts) != 3:
        return t
    try:
        h, m, s = float(parts[0]), float(parts[1]), float(parts[2])
        total = h * 3600 + m * 60 + s
        h = int(total // 3600)
        m = int((total % 3600) // 60)
        s = total % 60
        return f"{h:02d}:{m:02d}:{s:05.2f}"
    except (ValueError, IndexError):
        return t


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
    "language": "zh",
    "asr_model": "large-v3",
    "music_engine": "local",
    "music_model": "qwen3-omni-30b-a3b",
}


def init_db(app):
    with app.app_context():
        db = get_db()
        db.execute("PRAGMA journal_mode=WAL")
        db.executescript(_SCHEMA)
        _migrate(db)
        for k, v in _DEFAULTS.items():
            db.execute("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)", (k, v))
        # Reset stale 'processing' status from previous interrupted runs
        stale = db.execute("SELECT COUNT(*) FROM media WHERE analysis_status = 'processing'").fetchone()[0]
        if stale:
            db.execute("UPDATE media SET analysis_status = 'none' WHERE analysis_status = 'processing'")
            logger.info("Reset {} stale 'processing' records to 'none'", stale)
        db.commit()
        db.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        db.execute("VACUUM")
        logger.info("Database initialized")
    app.teardown_appcontext(close_db)
