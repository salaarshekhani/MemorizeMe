from flask import Flask, jsonify, request, send_from_directory, session, g
from pathlib import Path
from datetime import datetime
from functools import wraps
from werkzeug.security import generate_password_hash, check_password_hash
import sqlite3
import secrets

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
DB_PATH = DATA_DIR / "app.db"
SECRET_KEY_FILE = DATA_DIR / "secret_key.txt"
FRONTEND_DIR = BASE_DIR.parent / "frontend"

DATA_DIR.mkdir(exist_ok=True)

DEFAULT_FLASHCARDS = [
    {
        "term": "Photosynthesis",
        "translation": "Photosynthese",
        "definition": "The process plants use to turn sunlight, water and carbon dioxide into energy and oxygen.",
    }
]

DEFAULT_SETTINGS = {
    "sound_enabled": True,
    "timer_seconds": 10,
    "theme": "light",
}

DEFAULT_PROFILE = {
    "name": "",
    "level": 1,
    "xp": 0,
    "best_streak": 0,
    "current_streak": 0,
}

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    username_lower TEXT NOT NULL UNIQUE,
    password_hash TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS flashcards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    card_number INTEGER NOT NULL,
    term TEXT NOT NULL,
    translation TEXT NOT NULL,
    definition TEXT NOT NULL,
    UNIQUE(user_id, card_number)
);

CREATE TABLE IF NOT EXISTS settings (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    sound_enabled INTEGER NOT NULL DEFAULT 1,
    timer_seconds INTEGER NOT NULL DEFAULT 10,
    theme TEXT NOT NULL DEFAULT 'light'
);

CREATE TABLE IF NOT EXISTS profiles (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL DEFAULT '',
    level INTEGER NOT NULL DEFAULT 1,
    xp INTEGER NOT NULL DEFAULT 0,
    best_streak INTEGER NOT NULL DEFAULT 0,
    current_streak INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS performance (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    card_number INTEGER NOT NULL,
    correct INTEGER NOT NULL DEFAULT 0,
    incorrect INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, card_number)
);

CREATE TABLE IF NOT EXISTS results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    timestamp TEXT NOT NULL,
    mode TEXT NOT NULL,
    correct INTEGER NOT NULL,
    incorrect INTEGER NOT NULL,
    total INTEGER NOT NULL,
    percentage INTEGER NOT NULL,
    xp_gained INTEGER NOT NULL
);
"""


def get_db():
    db = getattr(g, "_database", None)
    if db is None:
        db = g._database = sqlite3.connect(DB_PATH)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys = ON")
    return db


def init_db():
    conn = sqlite3.connect(DB_PATH)
    conn.executescript(SCHEMA)
    conn.commit()
    conn.close()


def get_secret_key():
    if SECRET_KEY_FILE.exists():
        return SECRET_KEY_FILE.read_text(encoding="utf-8").strip()
    key = secrets.token_hex(32)
    SECRET_KEY_FILE.write_text(key, encoding="utf-8")
    return key


def current_username():
    """Returns the logged-in username, or None for a guest (not logged in)."""
    return session.get("username")


def login_required(view):
    """All user-data endpoints require a real account. Guests are handled
    entirely client-side (localStorage) and never reach these routes."""
    @wraps(view)
    def wrapped(*args, **kwargs):
        if not session.get("username"):
            return jsonify({"error": "Not logged in."}), 401
        return view(*args, **kwargs)
    return wrapped


def get_user_row(username):
    db = get_db()
    return db.execute(
        "SELECT * FROM users WHERE username_lower = ?", (username.lower(),)
    ).fetchone()


def ensure_user(username):
    """Get (creating if needed) the user row and default related rows. Returns user_id."""
    db = get_db()
    row = get_user_row(username)
    if row is None:
        db.execute(
            "INSERT INTO users (username, username_lower, password_hash, created_at) "
            "VALUES (?, ?, NULL, ?)",
            (username, username.lower(), datetime.now().strftime("%Y-%m-%d %H:%M:%S")),
        )
        db.commit()
        row = get_user_row(username)

    user_id = row["id"]

    if db.execute("SELECT 1 FROM settings WHERE user_id = ?", (user_id,)).fetchone() is None:
        db.execute(
            "INSERT INTO settings (user_id, sound_enabled, timer_seconds, theme) VALUES (?, ?, ?, ?)",
            (user_id, int(DEFAULT_SETTINGS["sound_enabled"]), DEFAULT_SETTINGS["timer_seconds"], DEFAULT_SETTINGS["theme"]),
        )

    if db.execute("SELECT 1 FROM profiles WHERE user_id = ?", (user_id,)).fetchone() is None:
        name = username
        db.execute(
            "INSERT INTO profiles (user_id, name, level, xp, best_streak, current_streak) VALUES (?, ?, ?, ?, ?, ?)",
            (user_id, name, DEFAULT_PROFILE["level"], DEFAULT_PROFILE["xp"],
             DEFAULT_PROFILE["best_streak"], DEFAULT_PROFILE["current_streak"]),
        )

    if db.execute("SELECT 1 FROM flashcards WHERE user_id = ?", (user_id,)).fetchone() is None:
        for index, card in enumerate(DEFAULT_FLASHCARDS, start=1):
            db.execute(
                "INSERT INTO flashcards (user_id, card_number, term, translation, definition) VALUES (?, ?, ?, ?, ?)",
                (user_id, index, card["term"], card["translation"], card["definition"]),
            )

    db.commit()
    return user_id


def get_flashcards(username):
    user_id = ensure_user(username)
    db = get_db()
    rows = db.execute(
        "SELECT card_number, term, translation, definition FROM flashcards WHERE user_id = ? ORDER BY card_number",
        (user_id,),
    ).fetchall()
    return [
        {
            "id": row["card_number"],
            "term": row["term"],
            "translation": row["translation"],
            "definition": row["definition"],
        }
        for row in rows
    ]


def get_settings(username):
    user_id = ensure_user(username)
    db = get_db()
    row = db.execute(
        "SELECT sound_enabled, timer_seconds, theme FROM settings WHERE user_id = ?", (user_id,)
    ).fetchone()
    return {
        "sound_enabled": bool(row["sound_enabled"]),
        "timer_seconds": row["timer_seconds"],
        "theme": row["theme"],
    }


def get_profile(username):
    user_id = ensure_user(username)
    db = get_db()
    row = db.execute(
        "SELECT name, level, xp, best_streak, current_streak FROM profiles WHERE user_id = ?", (user_id,)
    ).fetchone()
    return {
        "name": row["name"],
        "level": row["level"],
        "xp": row["xp"],
        "best_streak": row["best_streak"],
        "current_streak": row["current_streak"],
    }


def get_performance(username):
    user_id = ensure_user(username)
    db = get_db()
    rows = db.execute(
        "SELECT card_number, correct, incorrect FROM performance WHERE user_id = ?", (user_id,)
    ).fetchall()
    return {str(row["card_number"]): {"correct": row["correct"], "incorrect": row["incorrect"]} for row in rows}


def get_results(username):
    user_id = ensure_user(username)
    db = get_db()
    rows = db.execute(
        "SELECT timestamp, mode, correct, incorrect, total, percentage, xp_gained "
        "FROM results WHERE user_id = ? ORDER BY id",
        (user_id,),
    ).fetchall()
    return [dict(row) for row in rows]


app = Flask(__name__, static_folder=None)
app.secret_key = get_secret_key()
init_db()


@app.teardown_appcontext
def close_db(exception=None):
    db = getattr(g, "_database", None)
    if db is not None:
        db.close()


@app.route("/")
def serve_index():
    return send_from_directory(FRONTEND_DIR, "index.html")


@app.route("/<path:filename>")
def serve_frontend_file(filename):
    return send_from_directory(FRONTEND_DIR, filename)


@app.route("/api/auth/register", methods=["POST"])
def register():
    body = request.get_json(force=True) or {}
    username = (body.get("username") or "").strip()
    password = body.get("password") or ""

    if not username or not password:
        return jsonify({"error": "Username and password are required."}), 400

    db = get_db()
    if get_user_row(username) is not None:
        return jsonify({"error": "That username is already taken."}), 409

    password_hash = generate_password_hash(password)
    db.execute(
        "INSERT INTO users (username, username_lower, password_hash, created_at) VALUES (?, ?, ?, ?)",
        (username, username.lower(), password_hash, datetime.now().strftime("%Y-%m-%d %H:%M:%S")),
    )
    db.commit()

    ensure_user(username)

    profile = get_profile(username)
    if not profile.get("name"):
        user_id = get_user_row(username)["id"]
        db.execute("UPDATE profiles SET name = ? WHERE user_id = ?", (username, user_id))
        db.commit()

    session["username"] = username
    return jsonify({"ok": True, "username": username})


@app.route("/api/auth/login", methods=["POST"])
def login():
    body = request.get_json(force=True) or {}
    username = (body.get("username") or "").strip()
    password = body.get("password") or ""

    row = get_user_row(username)
    if row is None or not row["password_hash"] or not check_password_hash(row["password_hash"], password):
        return jsonify({"error": "Incorrect username or password."}), 401

    session["username"] = row["username"]
    return jsonify({"ok": True, "username": row["username"]})


@app.route("/api/auth/logout", methods=["POST"])
def logout():
    session.pop("username", None)
    return jsonify({"ok": True})


@app.route("/api/auth/current", methods=["GET"])
def current():
    return jsonify({"username": session.get("username")})


@app.route("/api/flashcards", methods=["GET"])
@login_required
def list_flashcards():
    return jsonify(get_flashcards(current_username()))


@app.route("/api/flashcards", methods=["POST"])
@login_required
def add_flashcard():
    username = current_username()
    body = request.get_json(force=True) or {}
    term = (body.get("term") or "").strip()
    translation = (body.get("translation") or "").strip()
    definition = (body.get("definition") or "").strip()
    if not term or not translation or not definition:
        return jsonify({"error": "Term, translation, and definition are all required."}), 400

    user_id = ensure_user(username)
    db = get_db()
    next_id = (db.execute(
        "SELECT COALESCE(MAX(card_number), 0) + 1 AS next_id FROM flashcards WHERE user_id = ?", (user_id,)
    ).fetchone()["next_id"])
    db.execute(
        "INSERT INTO flashcards (user_id, card_number, term, translation, definition) VALUES (?, ?, ?, ?, ?)",
        (user_id, next_id, term, translation, definition),
    )
    db.commit()
    return jsonify({"id": next_id, "term": term, "translation": translation, "definition": definition}), 201


@app.route("/api/flashcards/<int:card_id>", methods=["DELETE"])
@login_required
def delete_flashcard(card_id):
    username = current_username()
    user_id = ensure_user(username)
    db = get_db()
    cur = db.execute(
        "DELETE FROM flashcards WHERE user_id = ? AND card_number = ?", (user_id, card_id)
    )
    if cur.rowcount == 0:
        return jsonify({"error": "Card not found."}), 404
    db.execute(
        "DELETE FROM performance WHERE user_id = ? AND card_number = ?", (user_id, card_id)
    )
    db.commit()
    return jsonify({"deleted": card_id})


@app.route("/api/flashcards/import", methods=["POST"])
@login_required
def import_flashcards():
    username = current_username()
    body = request.get_json(force=True) or {}
    incoming = body.get("cards")
    if not isinstance(incoming, list):
        return jsonify({"error": "Expected a 'cards' list."}), 400

    user_id = ensure_user(username)
    db = get_db()
    next_id = (db.execute(
        "SELECT COALESCE(MAX(card_number), 0) + 1 AS next_id FROM flashcards WHERE user_id = ?", (user_id,)
    ).fetchone()["next_id"])

    added = 0
    for item in incoming:
        term = (item.get("term") or "").strip() if isinstance(item, dict) else ""
        translation = (item.get("translation") or "").strip() if isinstance(item, dict) else ""
        definition = (item.get("definition") or "").strip() if isinstance(item, dict) else ""
        if term and translation and definition:
            db.execute(
                "INSERT INTO flashcards (user_id, card_number, term, translation, definition) VALUES (?, ?, ?, ?, ?)",
                (user_id, next_id, term, translation, definition),
            )
            next_id += 1
            added += 1
    db.commit()

    total = db.execute(
        "SELECT COUNT(*) AS total FROM flashcards WHERE user_id = ?", (user_id,)
    ).fetchone()["total"]
    return jsonify({"added": added, "total": total})


@app.route("/api/flashcards/export", methods=["GET"])
@login_required
def export_flashcards():
    return jsonify(get_flashcards(current_username()))


@app.route("/api/settings", methods=["GET"])
@login_required
def read_settings():
    return jsonify(get_settings(current_username()))


@app.route("/api/settings", methods=["POST"])
@login_required
def write_settings():
    username = current_username()
    user_id = ensure_user(username)
    body = request.get_json(force=True) or {}
    settings = get_settings(username)

    if "sound_enabled" in body:
        settings["sound_enabled"] = bool(body["sound_enabled"])

    if "timer_seconds" in body:
        try:
            seconds = int(body["timer_seconds"])
        except (TypeError, ValueError):
            return jsonify({"error": "timer_seconds must be a number."}), 400
        if seconds not in (5, 10, 15, 20, 30):
            return jsonify({"error": "timer_seconds must be one of 5, 10, 15, 20, 30."}), 400
        settings["timer_seconds"] = seconds

    if "theme" in body:
        if body["theme"] not in ("light", "dark"):
            return jsonify({"error": "theme must be light or dark."}), 400
        settings["theme"] = body["theme"]

    db = get_db()
    db.execute(
        "UPDATE settings SET sound_enabled = ?, timer_seconds = ?, theme = ? WHERE user_id = ?",
        (int(settings["sound_enabled"]), settings["timer_seconds"], settings["theme"], user_id),
    )
    db.commit()
    return jsonify(settings)


@app.route("/api/profile", methods=["GET"])
@login_required
def read_profile():
    return jsonify(get_profile(current_username()))


@app.route("/api/profile", methods=["POST"])
@login_required
def write_profile():
    username = current_username()
    user_id = ensure_user(username)
    body = request.get_json(force=True) or {}
    profile = get_profile(username)
    if "name" in body:
        profile["name"] = (body["name"] or "").strip() or "Guest"

    db = get_db()
    db.execute("UPDATE profiles SET name = ? WHERE user_id = ?", (profile["name"], user_id))
    db.commit()
    return jsonify(profile)


def build_performance(username):
    cards = {str(card["id"]): card for card in get_flashcards(username)}
    performance = get_performance(username)
    joined = {}
    for card_id, card in cards.items():
        stats = performance.get(card_id, {"correct": 0, "incorrect": 0})
        joined[card_id] = {
            "term": card["term"],
            "translation": card.get("translation", ""),
            "definition": card["definition"],
            **stats,
        }
    return joined


@app.route("/api/performance", methods=["GET"])
@login_required
def read_performance():
    return jsonify(build_performance(current_username()))


@app.route("/api/stats", methods=["GET"])
@login_required
def read_stats():
    username = current_username()
    return jsonify({
        "profile": get_profile(username),
        "performance": build_performance(username),
        "history": get_results(username)[-20:],
    })


@app.route("/api/quiz/result", methods=["POST"])
@login_required
def submit_quiz_result():
    username = current_username()
    user_id = ensure_user(username)
    body = request.get_json(force=True) or {}
    mode = body.get("mode") or "quiz"
    card_results = body.get("card_results", [])
    correct = int(body.get("correct", 0))
    incorrect = int(body.get("incorrect", 0))
    total = int(body.get("total", correct + incorrect))

    db = get_db()

    for item in card_results:
        card_id = item.get("id")
        if card_id is None:
            continue
        card_number = int(card_id)
        existing = db.execute(
            "SELECT correct, incorrect FROM performance WHERE user_id = ? AND card_number = ?",
            (user_id, card_number),
        ).fetchone()
        if existing is None:
            correct_count, incorrect_count = 0, 0
        else:
            correct_count, incorrect_count = existing["correct"], existing["incorrect"]

        if item.get("correct"):
            correct_count += 1
        else:
            incorrect_count += 1

        db.execute(
            "INSERT INTO performance (user_id, card_number, correct, incorrect) VALUES (?, ?, ?, ?) "
            "ON CONFLICT(user_id, card_number) DO UPDATE SET correct = ?, incorrect = ?",
            (user_id, card_number, correct_count, incorrect_count, correct_count, incorrect_count),
        )

    profile = get_profile(username)
    leveled_up = False
    xp_gained = 0
    for item in card_results:
        if item.get("correct"):
            xp_gained += 15
            profile["current_streak"] += 1
            profile["best_streak"] = max(profile["best_streak"], profile["current_streak"])
        else:
            profile["current_streak"] = 0

    profile["xp"] += xp_gained
    while profile["xp"] >= profile["level"] * 100:
        profile["level"] += 1
        leveled_up = True

    db.execute(
        "UPDATE profiles SET xp = ?, level = ?, best_streak = ?, current_streak = ? WHERE user_id = ?",
        (profile["xp"], profile["level"], profile["best_streak"], profile["current_streak"], user_id),
    )

    percentage = int((correct / total) * 100) if total else 0
    db.execute(
        "INSERT INTO results (user_id, timestamp, mode, correct, incorrect, total, percentage, xp_gained) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (user_id, datetime.now().strftime("%Y-%m-%d %H:%M:%S"), mode, correct, incorrect, total, percentage, xp_gained),
    )

    db.commit()

    return jsonify({
        "profile": profile,
        "leveled_up": leveled_up,
        "xp_gained": xp_gained,
        "percentage": percentage,
    })


@app.route("/api/results/export", methods=["GET"])
@login_required
def export_results():
    return jsonify(get_results(current_username()))


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
