import sqlite3
import json
import os

# Override via environment variable to use a different database path
DB_PATH = os.environ.get('RSR_DB_PATH', 'rsr_results.db')


def init_db():
    with sqlite3.connect(DB_PATH) as conn:
        conn.executescript('''
            CREATE TABLE IF NOT EXISTS sessions (
                id             INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                patient_id     TEXT,
                age_months     INTEGER,
                percentile     INTEGER,
                total_score    REAL,
                result         TEXT,
                session_folder TEXT
            );
            CREATE TABLE IF NOT EXISTS sentence_results (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id      INTEGER REFERENCES sessions(id) ON DELETE CASCADE,
                sentence_number INTEGER,
                ground_truth    TEXT,
                response        TEXT,
                errors          INTEGER,
                score           INTEGER,
                edit_script     TEXT
            );
            CREATE TABLE IF NOT EXISTS recordings (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id      INTEGER REFERENCES sessions(id) ON DELETE CASCADE,
                sentence_number INTEGER,
                file_path       TEXT
            );
        ''')


def save_session(patient_id, age_months, percentile, total_score, result, sentences, recording_paths, session_folder=None):
    with sqlite3.connect(DB_PATH) as conn:
        cur = conn.execute(
            '''INSERT INTO sessions (patient_id, age_months, percentile, total_score, result, session_folder)
               VALUES (?, ?, ?, ?, ?, ?)''',
            (patient_id, age_months, percentile, total_score, result, session_folder)
        )
        session_id = cur.lastrowid

        for s in sentences:
            conn.execute(
                '''INSERT INTO sentence_results
                   (session_id, sentence_number, ground_truth, response, errors, score, edit_script)
                   VALUES (?, ?, ?, ?, ?, ?, ?)''',
                (session_id, int(s['id']), s.get('Ground Truth', ''), s.get('Sentence', ''),
                 s.get('Errors', 0), s.get('Score', 0), json.dumps(s.get('Edit Script', {})))
            )

        for sentence_number, path in recording_paths.items():
            conn.execute(
                'INSERT INTO recordings (session_id, sentence_number, file_path) VALUES (?, ?, ?)',
                (session_id, sentence_number, path)
            )

    return session_id


def get_sessions():
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute('SELECT * FROM sessions ORDER BY created_at DESC').fetchall()
        return [dict(r) for r in rows]


def get_session(session_id):
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        session = conn.execute('SELECT * FROM sessions WHERE id = ?', (session_id,)).fetchone()
        if not session:
            return None
        sentences = conn.execute(
            'SELECT * FROM sentence_results WHERE session_id = ? ORDER BY sentence_number',
            (session_id,)
        ).fetchall()
        recs = conn.execute(
            'SELECT * FROM recordings WHERE session_id = ? ORDER BY sentence_number',
            (session_id,)
        ).fetchall()
        return {
            'session': dict(session),
            'sentences': [dict(r) for r in sentences],
            'recordings': [dict(r) for r in recs],
        }
