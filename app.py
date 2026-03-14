from flask import Flask, jsonify, request, session, redirect, render_template, Response
import sqlite3
import json
import os
import re
import uuid
from datetime import datetime, timezone
from functools import wraps
import time
import threading
from urllib import request as urlrequest
from urllib import error as urlerror
from urllib.parse import quote

try:
    import pymysql
except ImportError:
    pymysql = None
try:
    import redis as redis_lib
except ImportError:
    redis_lib = None

app = Flask(__name__)
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
IS_VERCEL = bool(os.environ.get('VERCEL')) or bool(os.environ.get('VERCEL_REGION'))
DEFAULT_SQLITE_PATH = os.path.join(BASE_DIR, 'quiz.db')
DEFAULT_AI_SETTINGS_PATH = os.path.join(BASE_DIR, 'ai_settings.json')

def resolve_runtime_path(path_value, default_path):
    value = str(path_value or '').strip()
    if not value:
        return default_path
    if os.path.isabs(value):
        return value
    return os.path.abspath(os.path.join(BASE_DIR, value))

DB_PATH = resolve_runtime_path(os.environ.get('DB_PATH'), DEFAULT_SQLITE_PATH)
AI_SETTINGS_PATH = resolve_runtime_path(os.environ.get('AI_SETTINGS_PATH'), DEFAULT_AI_SETTINGS_PATH)
DB_BACKEND = (os.environ.get('DB_BACKEND') or '').strip().lower()
if not DB_BACKEND:
    DB_BACKEND = 'mysql' if os.environ.get('MYSQL_HOST') else 'sqlite'
if DB_BACKEND not in ('sqlite', 'mysql'):
    raise RuntimeError("DB_BACKEND 仅支持 sqlite 或 mysql")
SQLITE_READ_ONLY = DB_BACKEND == 'sqlite' and IS_VERCEL

MYSQL_HOST = (os.environ.get('MYSQL_HOST') or '').strip()
MYSQL_DATABASE = (os.environ.get('MYSQL_DATABASE') or '').strip()
MYSQL_USER = (os.environ.get('MYSQL_USER') or '').strip()
MYSQL_PASSWORD = os.environ.get('MYSQL_PASSWORD', '')
try:
    MYSQL_PORT = int(os.environ.get('MYSQL_PORT', '3306'))
except ValueError:
    MYSQL_PORT = 3306

app.secret_key = os.environ.get('FLASK_SECRET_KEY', 'change-this-secret-key')
ADMIN_USERNAME = os.environ.get('ADMIN_USERNAME', 'admin')
ADMIN_PASSWORD = os.environ.get('ADMIN_PASSWORD', 'admin123')

def parse_bool_env(value, default=False):
    if value is None:
        return bool(default)
    text = str(value).strip().lower()
    if text in {'1', 'true', 'yes', 'on', 'y'}:
        return True
    if text in {'0', 'false', 'no', 'off', 'n'}:
        return False
    return bool(default)

def parse_db_bool(value, default=False):
    if value is None:
        return bool(default)
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return int(value) != 0
    text = str(value).strip().lower()
    if text in {'1', 'true', 'yes', 'on', 'y'}:
        return True
    if text in {'0', 'false', 'no', 'off', 'n', '', 'null', 'none'}:
        return False
    try:
        return int(float(text)) != 0
    except (TypeError, ValueError):
        return bool(default)

def parse_int_env(value, default=0):
    try:
        return int(value)
    except (TypeError, ValueError):
        return int(default)

COLLECTOR_PUSH_DEFAULT_ENABLED = parse_bool_env(os.environ.get('COLLECTOR_PUSH'), True)
COLLECTOR_PUSH_DEFAULT_TOKEN = (os.environ.get('COLLECTOR_PUSH_TOKEN') or '').strip()
_REDIS_ENABLED_ENV = os.environ.get('REDIS_ENABLED')
if _REDIS_ENABLED_ENV is None:
    REDIS_ENABLED = bool(os.environ.get('REDIS_URL'))
else:
    REDIS_ENABLED = parse_bool_env(_REDIS_ENABLED_ENV, False)
REDIS_URL = (os.environ.get('REDIS_URL') or '').strip()
REDIS_HOST = (os.environ.get('REDIS_HOST') or '127.0.0.1').strip() or '127.0.0.1'
REDIS_PORT = parse_int_env(os.environ.get('REDIS_PORT'), 6379)
REDIS_DB = parse_int_env(os.environ.get('REDIS_DB'), 0)
REDIS_PASSWORD = os.environ.get('REDIS_PASSWORD')
REDIS_CACHE_PREFIX = (os.environ.get('REDIS_CACHE_PREFIX') or 'quiz').strip() or 'quiz'
REDIS_PUBLIC_LIB_CACHE_TTL = max(10, parse_int_env(os.environ.get('REDIS_PUBLIC_LIB_CACHE_TTL'), 600))
MYSQL_POOL_ENABLED = parse_bool_env(os.environ.get('MYSQL_POOL_ENABLED'), IS_VERCEL)
MYSQL_POOL_MAX_IDLE_SECONDS = max(10, parse_int_env(os.environ.get('MYSQL_POOL_MAX_IDLE_SECONDS'), 45))
MYSQL_CONN_LOCAL = threading.local()

REDIS_CLIENT = None
REDIS_INIT_ATTEMPTED = False
SCHEMA_INITIALIZED = False
LOCAL_CACHE = {}
LOCAL_CACHE_LOCK = threading.Lock()
DB_INTEGRITY_ERRORS = (sqlite3.IntegrityError,)
if pymysql is not None:
    DB_INTEGRITY_ERRORS = (sqlite3.IntegrityError, pymysql.err.IntegrityError)

AI_DEFAULT_SETTINGS = {
    'provider': 'openai_compatible',
    'base_url': 'https://api.openai.com/v1',
    'model': 'gpt-4o-mini',
    'endpoint_path': '',
    'collector_push_enabled': COLLECTOR_PUSH_DEFAULT_ENABLED,
    'collector_push_token': COLLECTOR_PUSH_DEFAULT_TOKEN
}

class MySQLCursorAdapter:
    def __init__(self, cursor):
        self._cursor = cursor

    @staticmethod
    def _normalize_params(params):
        if isinstance(params, list):
            return tuple(params)
        return params

    @staticmethod
    def _normalize_query(query):
        return query.replace('?', '%s')

    def execute(self, query, params=None):
        sql = self._normalize_query(query)
        if params is None:
            return self._cursor.execute(sql)
        return self._cursor.execute(sql, self._normalize_params(params))

    def executemany(self, query, seq_of_params):
        sql = self._normalize_query(query)
        normalized_seq = [self._normalize_params(params) for params in seq_of_params]
        return self._cursor.executemany(sql, normalized_seq)

    def __getattr__(self, item):
        return getattr(self._cursor, item)

class MySQLConnectionAdapter:
    def __init__(self, conn, pooled=False):
        self._conn = conn
        self._pooled = bool(pooled)

    def cursor(self, *args, **kwargs):
        return MySQLCursorAdapter(self._conn.cursor(*args, **kwargs))

    def commit(self):
        return self._conn.commit()

    def rollback(self):
        return self._conn.rollback()

    def close(self):
        if self._pooled:
            # 保留连接以复用，但确保事务不会泄漏到下一次请求
            try:
                self._conn.rollback()
            except Exception:
                pass
            return None
        return self._conn.close()

    def __getattr__(self, item):
        return getattr(self._conn, item)

# 数据库连接函数
def _validate_mysql_env():
    missing = []
    if not MYSQL_HOST:
        missing.append('MYSQL_HOST')
    if not MYSQL_DATABASE:
        missing.append('MYSQL_DATABASE')
    if not MYSQL_USER:
        missing.append('MYSQL_USER')
    if missing:
        raise RuntimeError(f'DB_BACKEND=mysql 但缺少环境变量: {", ".join(missing)}')

def _create_mysql_raw_connection():
    return pymysql.connect(
        host=MYSQL_HOST,
        port=MYSQL_PORT,
        user=MYSQL_USER,
        password=MYSQL_PASSWORD,
        database=MYSQL_DATABASE,
        charset='utf8mb4',
        cursorclass=pymysql.cursors.DictCursor,
        connect_timeout=2,
        read_timeout=5,
        write_timeout=5,
        autocommit=False
    )

def _get_mysql_raw_connection():
    now = time.time()
    entry = getattr(MYSQL_CONN_LOCAL, 'mysql_entry', None)
    if entry:
        raw_conn, last_used = entry
        if raw_conn is not None:
            idle_seconds = now - float(last_used or 0)
            if idle_seconds >= MYSQL_POOL_MAX_IDLE_SECONDS:
                try:
                    raw_conn.ping(reconnect=True)
                except Exception:
                    try:
                        raw_conn.close()
                    except Exception:
                        pass
                    raw_conn = None
            if raw_conn is not None:
                MYSQL_CONN_LOCAL.mysql_entry = (raw_conn, now)
                return raw_conn

    raw_conn = _create_mysql_raw_connection()
    MYSQL_CONN_LOCAL.mysql_entry = (raw_conn, now)
    return raw_conn

# 数据库连接函数
def get_db_connection():
    global SCHEMA_INITIALIZED, REDIS_ENABLED
    if DB_BACKEND == 'mysql':
        if pymysql is None:
            raise RuntimeError('DB_BACKEND=mysql 但未安装 PyMySQL，请先安装依赖')
        _validate_mysql_env()
        if MYSQL_POOL_ENABLED:
            conn = MySQLConnectionAdapter(_get_mysql_raw_connection(), pooled=True)
        else:
            conn = MySQLConnectionAdapter(_create_mysql_raw_connection(), pooled=False)
    else:
        if SQLITE_READ_ONLY:
            if not os.path.exists(DB_PATH):
                raise RuntimeError(f'SQLite 数据库文件不存在: {DB_PATH}')
            sqlite_uri = f'file:{quote(DB_PATH)}?mode=ro&immutable=1'
            conn = sqlite3.connect(sqlite_uri, timeout=2, uri=True)
        else:
            db_dir = os.path.dirname(DB_PATH)
            if db_dir:
                os.makedirs(db_dir, exist_ok=True)
            conn = sqlite3.connect(DB_PATH, timeout=2)
        conn.row_factory = sqlite3.Row
        # SQLite 性能与一致性设置
        try:
            conn.execute('PRAGMA foreign_keys=ON')
            conn.execute('PRAGMA synchronous=NORMAL')
            # Serverless 场景下 WAL 往往收益有限，且可能带来额外文件 IO
            if not IS_VERCEL:
                conn.execute('PRAGMA journal_mode=WAL')
        except sqlite3.OperationalError:
            pass

    if IS_VERCEL and REDIS_ENABLED and not REDIS_URL and REDIS_HOST in {'127.0.0.1', 'localhost'}:
        # Vercel 无本地 Redis，避免首个请求额外探测超时
        REDIS_ENABLED = False

    if not SCHEMA_INITIALIZED:
        if not SQLITE_READ_ONLY:
            ensure_schema(conn)
        SCHEMA_INITIALIZED = True
    return conn

def build_redis_cache_key(*parts):
    normalized = [REDIS_CACHE_PREFIX]
    for part in parts:
        text = str(part or '').strip()
        if text:
            normalized.append(text)
    return ':'.join(normalized)

def apply_public_cache_headers(response, max_age=0, s_maxage=300, stale_while_revalidate=600):
    response.headers['Cache-Control'] = (
        f'public, max-age={max_age}, s-maxage={max(0, int(s_maxage))}, '
        f'stale-while-revalidate={max(0, int(stale_while_revalidate))}'
    )
    return response

def local_cache_get(key):
    now = time.time()
    with LOCAL_CACHE_LOCK:
        cached = LOCAL_CACHE.get(key)
        if not cached:
            return None
        expires_at, payload = cached
        if expires_at and expires_at < now:
            LOCAL_CACHE.pop(key, None)
            return None
        return payload

def local_cache_set(key, payload, ttl_seconds=REDIS_PUBLIC_LIB_CACHE_TTL):
    try:
        ttl = max(1, int(ttl_seconds))
    except (TypeError, ValueError):
        ttl = REDIS_PUBLIC_LIB_CACHE_TTL
    with LOCAL_CACHE_LOCK:
        LOCAL_CACHE[key] = (time.time() + ttl, payload)

def local_cache_delete(key):
    with LOCAL_CACHE_LOCK:
        LOCAL_CACHE.pop(key, None)

def local_cache_delete_prefix(prefix):
    with LOCAL_CACHE_LOCK:
        keys = [item_key for item_key in LOCAL_CACHE.keys() if item_key.startswith(prefix)]
        for item_key in keys:
            LOCAL_CACHE.pop(item_key, None)

def get_redis_client():
    global REDIS_CLIENT, REDIS_INIT_ATTEMPTED
    if REDIS_INIT_ATTEMPTED:
        return REDIS_CLIENT
    REDIS_INIT_ATTEMPTED = True

    if not REDIS_ENABLED or redis_lib is None:
        REDIS_CLIENT = None
        return None

    try:
        if REDIS_URL:
            client = redis_lib.Redis.from_url(
                REDIS_URL,
                decode_responses=True,
                socket_connect_timeout=0.2,
                socket_timeout=0.2
            )
        else:
            client = redis_lib.Redis(
                host=REDIS_HOST,
                port=REDIS_PORT,
                db=REDIS_DB,
                password=REDIS_PASSWORD,
                decode_responses=True,
                socket_connect_timeout=0.2,
                socket_timeout=0.2
            )
        client.ping()
        REDIS_CLIENT = client
    except Exception:
        REDIS_CLIENT = None
    return REDIS_CLIENT

def redis_get_json(key):
    client = get_redis_client()
    if not client:
        return local_cache_get(key)
    try:
        raw = client.get(key)
        if not raw:
            return local_cache_get(key)
        payload = json.loads(raw)
        local_cache_set(key, payload, REDIS_PUBLIC_LIB_CACHE_TTL)
        return payload
    except Exception:
        return local_cache_get(key)

def redis_set_json(key, payload, ttl_seconds=REDIS_PUBLIC_LIB_CACHE_TTL):
    local_cache_set(key, payload, ttl_seconds)
    client = get_redis_client()
    if not client:
        return
    try:
        ttl = max(1, int(ttl_seconds))
        client.setex(key, ttl, json.dumps(payload, ensure_ascii=False))
    except Exception:
        pass

def invalidate_public_library_cache(library_id=None):
    list_key = build_redis_cache_key('public', 'libraries', 'list')
    local_cache_delete(list_key)
    if library_id:
        local_cache_delete(build_redis_cache_key('public', 'libraries', 'detail', library_id))
    else:
        local_cache_delete_prefix(build_redis_cache_key('public', 'libraries', 'detail', ''))

    client = get_redis_client()
    if not client:
        return

    try:
        client.delete(list_key)
    except Exception:
        pass

    if library_id:
        detail_key = build_redis_cache_key('public', 'libraries', 'detail', library_id)
        try:
            client.delete(detail_key)
        except Exception:
            pass
        return

    pattern = build_redis_cache_key('public', 'libraries', 'detail', '*')
    try:
        keys = list(client.scan_iter(match=pattern, count=200))
        if keys:
            client.delete(*keys)
    except Exception:
        pass

def ensure_mysql_schema(conn):
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS libraries (
            id VARCHAR(64) PRIMARY KEY,
            title VARCHAR(255) NOT NULL,
            icon VARCHAR(32) NOT NULL,
            description TEXT NOT NULL,
            is_public TINYINT(1) NOT NULL DEFAULT 1
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ''')
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS questions (
            id BIGINT PRIMARY KEY AUTO_INCREMENT,
            question TEXT NOT NULL,
            type VARCHAR(32) NOT NULL DEFAULT 'single',
            options TEXT NOT NULL,
            answer TEXT NOT NULL,
            analysis TEXT NOT NULL,
            difficulty INT NOT NULL DEFAULT 1,
            chapter VARCHAR(255) NOT NULL DEFAULT '',
            library_id VARCHAR(64) NOT NULL,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_questions_library_id (library_id),
            CONSTRAINT fk_questions_library FOREIGN KEY (library_id) REFERENCES libraries(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ''')
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS user_answers (
            id BIGINT PRIMARY KEY AUTO_INCREMENT,
            library_id VARCHAR(64) NOT NULL,
            question_id BIGINT NOT NULL,
            user_answer TEXT,
            is_correct TINYINT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_user_answers_library_id (library_id),
            INDEX idx_user_answers_question_id (question_id),
            CONSTRAINT fk_user_answers_library FOREIGN KEY (library_id) REFERENCES libraries(id) ON DELETE CASCADE,
            CONSTRAINT fk_user_answers_question FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ''')
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS collector_records (
            id BIGINT PRIMARY KEY AUTO_INCREMENT,
            source_filename VARCHAR(255) NOT NULL DEFAULT '',
            source_size INT NOT NULL DEFAULT 0,
            library_title VARCHAR(255) NOT NULL DEFAULT '',
            library_id VARCHAR(64) NOT NULL DEFAULT '',
            library_count INT NOT NULL DEFAULT 0,
            question_count INT NOT NULL DEFAULT 0,
            payload LONGTEXT NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_collector_records_created_at (created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ''')

    def get_columns(table_name):
        cursor.execute('''
            SELECT COLUMN_NAME
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
        ''', (table_name,))
        return {row['COLUMN_NAME'] for row in cursor.fetchall()}

    library_columns = get_columns('libraries')
    if 'description' not in library_columns:
        cursor.execute("ALTER TABLE libraries ADD COLUMN description VARCHAR(1024) NOT NULL DEFAULT ''")
    if 'is_public' not in library_columns:
        cursor.execute("ALTER TABLE libraries ADD COLUMN is_public TINYINT(1) NOT NULL DEFAULT 1")

    question_columns = get_columns('questions')
    if 'chapter' not in question_columns:
        source_column = None
        if 'knowledge_point' in question_columns:
            source_column = 'knowledge_point'
        elif 'subject' in question_columns:
            source_column = 'subject'

        cursor.execute("ALTER TABLE questions ADD COLUMN chapter VARCHAR(255) NOT NULL DEFAULT ''")
        if source_column:
            cursor.execute(f"UPDATE questions SET chapter = COALESCE({source_column}, '')")

    if 'updated_at' not in question_columns:
        cursor.execute(
            'ALTER TABLE questions '
            'ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'
        )

    conn.commit()

def ensure_schema(conn):
    if DB_BACKEND == 'mysql':
        ensure_mysql_schema(conn)
        return

    cursor = conn.cursor()
    # SQLite 首次启动自动建表（避免空数据库直接 500）
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS libraries (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            icon TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            is_public INTEGER NOT NULL DEFAULT 1
        )
    ''')
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS questions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            question TEXT NOT NULL,
            type TEXT NOT NULL DEFAULT 'single',
            options TEXT NOT NULL,
            answer TEXT NOT NULL,
            analysis TEXT NOT NULL,
            difficulty INTEGER NOT NULL DEFAULT 1,
            chapter TEXT NOT NULL DEFAULT '',
            library_id TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (library_id) REFERENCES libraries (id)
        )
    ''')
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS user_answers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            library_id TEXT NOT NULL,
            question_id INTEGER NOT NULL,
            user_answer TEXT,
            is_correct INTEGER,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (library_id) REFERENCES libraries (id),
            FOREIGN KEY (question_id) REFERENCES questions (id)
        )
    ''')
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS collector_records (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            source_filename TEXT NOT NULL DEFAULT '',
            source_size INTEGER NOT NULL DEFAULT 0,
            library_title TEXT NOT NULL DEFAULT '',
            library_id TEXT NOT NULL DEFAULT '',
            library_count INTEGER NOT NULL DEFAULT 0,
            question_count INTEGER NOT NULL DEFAULT 0,
            payload TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    conn.commit()

    cursor.execute("PRAGMA table_info(libraries)")
    columns = {row[1] for row in cursor.fetchall()}
    if 'description' not in columns:
        cursor.execute("ALTER TABLE libraries ADD COLUMN description TEXT NOT NULL DEFAULT ''")
        conn.commit()
    if 'is_public' not in columns:
        cursor.execute("ALTER TABLE libraries ADD COLUMN is_public INTEGER NOT NULL DEFAULT 1")
        conn.commit()

    def get_question_columns():
        cursor.execute("PRAGMA table_info(questions)")
        return [row[1] for row in cursor.fetchall()]

    question_columns = set(get_question_columns())
    if 'subject' in question_columns:
        # 迁移 questions 表，移除 subject 字段，并统一为 chapter 字段
        chapter_source = 'chapter' if 'chapter' in question_columns else 'knowledge_point' if 'knowledge_point' in question_columns else "''"
        updated_at_source = 'updated_at' if 'updated_at' in question_columns else 'CURRENT_TIMESTAMP'
        cursor.execute("PRAGMA foreign_keys=OFF")
        cursor.execute('DROP TABLE IF EXISTS questions_new')
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS questions_new (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                question TEXT NOT NULL,
                type TEXT NOT NULL DEFAULT 'single',
                options TEXT NOT NULL,
                answer TEXT NOT NULL,
                analysis TEXT NOT NULL,
                difficulty INTEGER NOT NULL DEFAULT 1,
                chapter TEXT NOT NULL DEFAULT '',
                library_id TEXT NOT NULL,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (library_id) REFERENCES libraries (id)
            )
        ''')
        cursor.execute(f'''
            INSERT INTO questions_new (
                id, question, type, options, answer, analysis, difficulty, chapter, library_id, updated_at
            )
            SELECT id, question, type, options, answer, analysis, difficulty, {chapter_source}, library_id, {updated_at_source}
            FROM questions
        ''')
        cursor.execute('DROP TABLE questions')
        cursor.execute('ALTER TABLE questions_new RENAME TO questions')
        cursor.execute("PRAGMA foreign_keys=ON")
        conn.commit()
        question_columns = set(get_question_columns())

    if 'chapter' not in question_columns:
        if 'knowledge_point' in question_columns:
            try:
                cursor.execute("ALTER TABLE questions RENAME COLUMN knowledge_point TO chapter")
            except sqlite3.OperationalError:
                # SQLite 版本不支持 RENAME COLUMN 时，回退为整表迁移
                updated_at_source = 'updated_at' if 'updated_at' in question_columns else 'CURRENT_TIMESTAMP'
                cursor.execute("PRAGMA foreign_keys=OFF")
                cursor.execute('DROP TABLE IF EXISTS questions_new')
                cursor.execute('''
                    CREATE TABLE IF NOT EXISTS questions_new (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        question TEXT NOT NULL,
                        type TEXT NOT NULL DEFAULT 'single',
                        options TEXT NOT NULL,
                        answer TEXT NOT NULL,
                        analysis TEXT NOT NULL,
                        difficulty INTEGER NOT NULL DEFAULT 1,
                        chapter TEXT NOT NULL DEFAULT '',
                        library_id TEXT NOT NULL,
                        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY (library_id) REFERENCES libraries (id)
                    )
                ''')
                cursor.execute(f'''
                    INSERT INTO questions_new (
                        id, question, type, options, answer, analysis, difficulty, chapter, library_id, updated_at
                    )
                    SELECT id, question, type, options, answer, analysis, difficulty, knowledge_point, library_id, {updated_at_source}
                    FROM questions
                ''')
                cursor.execute('DROP TABLE questions')
                cursor.execute('ALTER TABLE questions_new RENAME TO questions')
                cursor.execute("PRAGMA foreign_keys=ON")
            conn.commit()
        else:
            cursor.execute("ALTER TABLE questions ADD COLUMN chapter TEXT NOT NULL DEFAULT ''")
            conn.commit()
        question_columns = set(get_question_columns())

    if 'updated_at' not in question_columns:
        cursor.execute("ALTER TABLE questions ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''")
        cursor.execute("UPDATE questions SET updated_at = CURRENT_TIMESTAMP WHERE updated_at = ''")
        conn.commit()

    # 索引优化（SQLite）
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_questions_library_id ON questions(library_id)")

    cursor.execute("CREATE INDEX IF NOT EXISTS idx_user_answers_library_id ON user_answers(library_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_user_answers_question_id ON user_answers(question_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_user_answers_created_at ON user_answers(created_at)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_collector_records_created_at ON collector_records(created_at)")
    conn.commit()

def load_ai_settings():
    if not os.path.exists(AI_SETTINGS_PATH):
        return {}
    try:
        with open(AI_SETTINGS_PATH, 'r', encoding='utf-8') as handle:
            data = json.load(handle)
        if isinstance(data, dict):
            return data
    except (OSError, json.JSONDecodeError):
        return {}
    return {}

def save_ai_settings(settings):
    try:
        settings_dir = os.path.dirname(AI_SETTINGS_PATH)
        if settings_dir:
            os.makedirs(settings_dir, exist_ok=True)
        with open(AI_SETTINGS_PATH, 'w', encoding='utf-8') as handle:
            json.dump(settings, handle, ensure_ascii=False, indent=2)
    except OSError as exc:
        raise RuntimeError(f'保存 AI 设置失败: {exc}')

def sanitize_ai_settings(payload, existing=None):
    existing = existing or {}
    provider = str(payload.get('provider') or existing.get('provider') or AI_DEFAULT_SETTINGS['provider']).strip()
    base_url = str(payload.get('base_url') or existing.get('base_url') or AI_DEFAULT_SETTINGS['base_url']).strip()
    model = str(payload.get('model') or existing.get('model') or AI_DEFAULT_SETTINGS['model']).strip()
    endpoint_path = str(payload.get('endpoint_path') or existing.get('endpoint_path') or AI_DEFAULT_SETTINGS['endpoint_path']).strip()
    api_key = payload.get('api_key', None)
    clear_api_key = bool(payload.get('clear_api_key'))
    if 'collector_push_enabled' in payload:
        collector_push_enabled = parse_bool_env(payload.get('collector_push_enabled'), AI_DEFAULT_SETTINGS['collector_push_enabled'])
    elif 'collector_push_enabled' in existing:
        collector_push_enabled = parse_bool_env(existing.get('collector_push_enabled'), AI_DEFAULT_SETTINGS['collector_push_enabled'])
    else:
        collector_push_enabled = AI_DEFAULT_SETTINGS['collector_push_enabled']

    if 'collector_push_token' in payload:
        collector_push_token = str(payload.get('collector_push_token') or '').strip()
    elif 'collector_push_token' in existing:
        collector_push_token = str(existing.get('collector_push_token') or '').strip()
    else:
        collector_push_token = AI_DEFAULT_SETTINGS['collector_push_token']

    cleaned = {
        'provider': provider or AI_DEFAULT_SETTINGS['provider'],
        'base_url': base_url or AI_DEFAULT_SETTINGS['base_url'],
        'model': model or AI_DEFAULT_SETTINGS['model'],
        'endpoint_path': endpoint_path,
        'collector_push_enabled': bool(collector_push_enabled),
        'collector_push_token': collector_push_token
    }

    if clear_api_key:
        cleaned['api_key'] = ''
    elif api_key is not None and str(api_key).strip():
        cleaned['api_key'] = str(api_key).strip()
    elif existing.get('api_key'):
        cleaned['api_key'] = existing.get('api_key')
    else:
        cleaned['api_key'] = ''

    return cleaned

def mask_api_key(api_key):
    if not api_key:
        return ''
    if len(api_key) <= 6:
        return '*' * len(api_key)
    return f"{'*' * (len(api_key) - 4)}{api_key[-4:]}"

def extract_json_payload(text):
    if text is None:
        raise ValueError('AI 返回为空')
    cleaned = str(text).strip()
    if cleaned.startswith('```'):
        cleaned = re.sub(r'^```(?:json)?', '', cleaned, flags=re.IGNORECASE).strip()
        cleaned = re.sub(r'```$', '', cleaned).strip()
    start = min([idx for idx in (cleaned.find('{'), cleaned.find('[')) if idx != -1], default=-1)
    if start > 0:
        cleaned = cleaned[start:]
    # 尝试直接解析
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass

    # 尝试截取首个完整 JSON 块
    stack = []
    end_index = None
    for i, ch in enumerate(cleaned):
        if ch in '{[':
            stack.append(ch)
        elif ch in '}]' and stack:
            stack.pop()
            if not stack:
                end_index = i + 1
                break
    if end_index is not None:
        snippet = cleaned[:end_index]
        return json.loads(snippet)
    raise ValueError('AI 返回不是有效 JSON')

def call_openai_compatible_chat(settings, prompt, request_timeout=60):
    base_url = (settings.get('base_url') or '').strip().rstrip('/')
    endpoint_path = (settings.get('endpoint_path') or '').strip()
    if not base_url and not endpoint_path:
        raise RuntimeError('AI Base URL 不能为空')

    if endpoint_path.startswith('http://') or endpoint_path.startswith('https://'):
        url = endpoint_path
    elif base_url.endswith('/chat/completions'):
        url = base_url
    elif endpoint_path:
        url = f'{base_url}/{endpoint_path.lstrip("/")}'
    elif base_url.endswith('/v1'):
        url = f'{base_url}/chat/completions'
    else:
        url = f'{base_url}/v1/chat/completions'
    payload = {
        'model': settings['model'],
        'temperature': 0.2,
        'stream': False,
        'messages': [
            {'role': 'system', 'content': 'You are a quiz data extraction engine. Return only strict JSON.'},
            {'role': 'user', 'content': prompt}
        ]
    }
    data = json.dumps(payload).encode('utf-8')
    headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) CodexClient/1.0',
        'Authorization': f"Bearer {settings['api_key']}"
    }
    req = urlrequest.Request(url, data=data, headers=headers, method='POST')
    try:
        timeout_seconds = max(5, int(request_timeout or 60))
        with urlrequest.urlopen(req, timeout=timeout_seconds) as resp:
            raw = resp.read().decode('utf-8')
    except urlerror.HTTPError as exc:
        try:
            error_payload = exc.read().decode('utf-8')
        except Exception:
            error_payload = ''
        raise RuntimeError(f'AI 请求失败: {exc.code} {exc.reason} {error_payload}')
    except urlerror.URLError as exc:
        raise RuntimeError(f'AI 请求失败: {exc.reason}')

    if not raw or not raw.strip():
        raise RuntimeError('AI 返回为空，请检查 API Key、模型或网关拦截')

    try:
        parsed = json.loads(raw)
        if isinstance(parsed, dict) and parsed.get('error'):
            raise RuntimeError(f"AI 返回错误: {parsed.get('error')}")
        return parsed['choices'][0]['message']['content']
    except (KeyError, IndexError, json.JSONDecodeError) as exc:
        snippet = raw.strip().replace('\n', ' ')[:200]
        raise RuntimeError(f'AI 返回解析失败: {exc}. 响应片段: {snippet}')

def build_ai_collect_prompt(source_text, library_title=None, library_id=None):
    title = library_title or 'AI 采集题库'
    lib_id = library_id or ''
    return (
        '请将以下内容转换为题库 JSON。输出必须是严格 JSON，不要包含任何解释、Markdown 或代码块。\n'
        'JSON 结构如下：\n'
        '{ "libraries": [ { "id": "", "title": "", "icon": "📚", "description": "", "questions": [\n'
        '  { "question": "", "type": "single|multiple|judge|fill|qa", "options": [], "answer": "", "analysis": "", "difficulty": 1, "chapter": "" }\n'
        '] } ] }\n'
        '规则：\n'
        '1) 每道题都必须包含并补全这 8 个字段：question/type/options/answer/analysis/difficulty/chapter。\n'
        '2) 单选题 answer 用选项字母（如 A）；多选题 answer 用逗号分隔字母（如 A,C）；options 至少 2 个。\n'
        '3) 判断题 options 固定为 ["正确","错误"]，answer 只能是“正确”或“错误”。\n'
        '4) 填空题 answer 使用“答案1|答案2”，数量需与题目括号空位一致。\n'
        '5) 问答题 options 为空数组，answer 需给出简短参考答案（不要留空）。\n'
        '6) analysis 不要留空；若无法提炼，写“暂无解析”。\n'
        '7) chapter 不要留空；若无法判断，写“综合”。difficulty 为 1-5 的整数。\n'
        f'8) 题集 title 固定为：{title}\n'
        f'9) 题集 id 若提供则写入：{lib_id}\n'
        '10) 无法识别的题型默认 single。\n'
        '\n'
        '题目内容如下：\n'
        f'{source_text}\n'
    )

def build_ai_generate_prompt(question_text, question_type, options):
    type_text = normalize_question_type(question_type)
    option_lines = []
    if isinstance(options, list) and options:
        for idx, opt in enumerate(options):
            letter = chr(65 + idx)
            option_lines.append(f'{letter}. {opt}')
    options_block = '\n'.join(option_lines)

    return (
        '请根据题目与选项生成答案、解析与章节。输出必须是严格 JSON，不要包含任何解释、Markdown 或代码块。\n'
        'JSON 结构：{"answer": "", "analysis": "", "chapter": ""}\n'
        '规则：\n'
        '1) 单选题 answer 使用选项字母，如 A。\n'
        '2) 多选题 answer 使用逗号分隔字母，如 A,C。\n'
        '3) 判断题 answer 使用“正确”或“错误”。\n'
        '4) 填空题 answer 使用“答案1|答案2”。\n'
        '5) 问答题 answer 可为简短文本。\n'
        '题目：\n'
        f'{question_text}\n'
        f'题型：{type_text}\n'
        f'选项：\n{options_block}\n'
    )

def build_ai_generate_batch_prompt(items):
    lines = [
        '请根据以下题目生成答案、解析与章节。输出必须是严格 JSON，不要包含任何解释、Markdown 或代码块。',
        '返回格式：{"items":[{"answer":"","analysis":"","chapter":""}, ...]}',
        '要求：items 长度必须与输入题目数量一致，顺序保持一致。'
    ]
    for idx, item in enumerate(items, start=1):
        q_text = item.get('question', '')
        q_type = normalize_question_type(item.get('type'))
        opts = item.get('options') or []
        option_lines = []
        if isinstance(opts, list) and opts:
            for opt_index, opt in enumerate(opts):
                letter = chr(65 + opt_index)
                option_lines.append(f'{letter}. {opt}')
        options_block = '\n'.join(option_lines)
        lines.append(f'{idx}. 题目: {q_text}')
        lines.append(f'题型: {q_type}')
        if options_block:
            lines.append(f'选项:\n{options_block}')
    return '\n'.join(lines)

QUESTION_TYPE_ALIASES = {
    'single': 'single',
    'single_choice': 'single',
    'radio': 'single',
    '单选': 'single',
    'judge': 'judge',
    'true_false': 'judge',
    'truefalse': 'judge',
    'tf': 'judge',
    '判断': 'judge',
    '判断题': 'judge',
    'multiple': 'multiple',
    'multi': 'multiple',
    'multiple_choice': 'multiple',
    'checkbox': 'multiple',
    '多选': 'multiple',
    'fill': 'fill',
    'blank': 'fill',
    'fill_blank': 'fill',
    '填空': 'fill',
    '填空题': 'fill',
    'qa': 'qa',
    'short_answer': 'qa',
    'essay': 'qa',
    '问答': 'qa',
    '问答题': 'qa',
    '简答': 'qa',
    '简答题': 'qa'
}

def normalize_question_type(raw_type):
    key = str(raw_type or 'single').strip().lower()
    return QUESTION_TYPE_ALIASES.get(key, 'single')

def strip_option_prefix(option_text):
    text = str(option_text or '').strip()
    if not text:
        return ''
    # 兼容并连续清理：A. / A、 / A) / A: / A： / A． / (A) / （A） 等前缀
    # 示例：A、A. 选项内容 -> 选项内容
    for _ in range(4):
        next_text = re.sub(r'^[\(\[（【]\s*[A-Ha-h]\s*[\)\]）】]\s*', '', text)
        next_text = re.sub(r'^[A-Ha-h]\s*[\.．、\):：]\s*', '', next_text)
        next_text = next_text.strip()
        if next_text == text:
            break
        text = next_text
    return text

def normalize_option_list(raw_options):
    normalized = []
    for option in (raw_options or []):
        cleaned = strip_option_prefix(option)
        if cleaned:
            normalized.append(cleaned)
    return normalized

def parse_options(raw_options, allow_empty=False):
    if isinstance(raw_options, list):
        options = normalize_option_list(raw_options)
    elif isinstance(raw_options, str):
        text = raw_options.strip()
        if not text:
            options = []
        else:
            try:
                parsed = json.loads(text)
                if isinstance(parsed, list):
                    options = normalize_option_list(parsed)
                else:
                    options = normalize_option_list(text.splitlines())
            except json.JSONDecodeError:
                options = normalize_option_list(text.splitlines())
    else:
        options = []

    if not allow_empty and len(options) < 2:
        raise ValueError('选项至少需要 2 个')
    return options

def parse_option_index(token, option_count):
    value = str(token).strip() if token is not None else ''
    if not value:
        raise ValueError('答案不能为空')

    if re.fullmatch(r'[A-Za-z]', value):
        index = ord(value.upper()) - ord('A')
    elif re.fullmatch(r'-?\d+', value):
        index = int(value)
    else:
        raise ValueError('答案索引格式不正确')

    if option_count is not None and (index < 0 or index >= option_count):
        raise ValueError('答案索引超出选项范围')
    return index

def parse_multiple_answer(raw_answer, option_count=None):
    if isinstance(raw_answer, list):
        tokens = raw_answer
    else:
        text = str(raw_answer or '').strip()
        if not text:
            raise ValueError('多选答案不能为空')
        try:
            parsed = json.loads(text)
            if isinstance(parsed, list):
                tokens = parsed
            else:
                tokens = re.split(r'[\s,，/|]+', text)
        except json.JSONDecodeError:
            tokens = re.split(r'[\s,，/|]+', text)

    if len(tokens) == 1 and re.fullmatch(r'[A-Za-z]{2,}', str(tokens[0]).strip()):
        tokens = list(str(tokens[0]).strip())

    indices = sorted({
        parse_option_index(token, option_count)
        for token in tokens
        if str(token).strip() != ''
    })
    if not indices:
        raise ValueError('多选答案不能为空')
    return indices

def normalize_judge_answer(raw_answer):
    token = str(raw_answer or '').strip().replace('。', '').replace('；', '').replace(';', '').lower()
    if token in {'a', '0', '正确', '对', 'true', 't', 'yes', 'y', '√'}:
        return '0'
    if token in {'b', '1', '错误', '错', 'false', 'f', 'no', 'n', '×', 'x'}:
        return '1'
    return None

def parse_fill_answers(raw_answer):
    if isinstance(raw_answer, list):
        tokens = [str(item).strip() for item in raw_answer]
    else:
        text = str(raw_answer or '').strip()
        if not text:
            return []
        tokens = [item.strip() for item in re.split(r'[|｜]', text)]
    if not tokens or any(not item for item in tokens):
        raise ValueError('填空题答案格式不正确，请使用“答案: 答案1|答案2”')
    return tokens

def normalize_compare_text(value):
    text = str(value or '').strip().lower()
    text = re.sub(r'\s+', '', text)
    text = re.sub(r'[，,。；;：:、！？!?（）()【】\[\]《》“”"\']', '', text)
    return text

def parse_stored_multiple_answer(raw_answer):
    try:
        parsed = json.loads(str(raw_answer or '[]'))
    except json.JSONDecodeError:
        parsed = re.split(r'[\s,，/|]+', str(raw_answer or ''))

    if not isinstance(parsed, list):
        parsed = [parsed]

    result = []
    for token in parsed:
        try:
            result.append(int(token))
        except (TypeError, ValueError):
            continue
    return sorted(set(result))

def serialize_user_answer(value):
    if value is None:
        return None
    if isinstance(value, (list, dict)):
        return json.dumps(value, ensure_ascii=False)
    return str(value)

def is_answer_correct(question_type, correct_answer, user_answer, option_count=None):
    q_type = normalize_question_type(question_type)
    if user_answer is None:
        return False

    if q_type == 'multiple':
        try:
            correct = set(parse_stored_multiple_answer(correct_answer))
            user = set(parse_multiple_answer(user_answer, option_count))
            return correct == user
        except ValueError:
            return False

    if q_type == 'judge':
        expected = normalize_judge_answer(correct_answer)
        received = normalize_judge_answer(user_answer)
        return expected is not None and expected == received

    if q_type == 'fill':
        try:
            expected = parse_fill_answers(correct_answer)
            received = parse_fill_answers(user_answer)
        except ValueError:
            return False
        if len(expected) != len(received):
            return False
        return all(
            normalize_compare_text(expected[idx]) == normalize_compare_text(received[idx])
            for idx in range(len(expected))
        )

    if q_type == 'qa':
        user_text = str(user_answer or '').strip()
        if not user_text:
            return False
        expected_text = str(correct_answer or '').strip()
        if not expected_text:
            # 主观题若未提供标准答案，仅判断是否作答
            return True
        return normalize_compare_text(expected_text) == normalize_compare_text(user_text)

    try:
        expected = parse_option_index(correct_answer, option_count)
        received = parse_option_index(user_answer, option_count)
        return expected == received
    except ValueError:
        return False

def serialize_question(question_row):
    try:
        options = json.loads(question_row['options'])
    except (TypeError, json.JSONDecodeError):
        options = []
    options = options if isinstance(options, list) else []
    question_type = normalize_question_type(question_row['type'])
    answer_raw = question_row['answer']
    answer = parse_stored_multiple_answer(answer_raw) if question_type == 'multiple' else answer_raw

    chapter = ''
    if 'chapter' in question_row.keys():
        chapter = question_row['chapter']
    elif 'knowledge_point' in question_row.keys():
        chapter = question_row['knowledge_point']

    return {
        'id': question_row['id'],
        'q': question_row['question'],
        'type': question_type,
        'options': options,
        'ans': answer,
        'analysis': question_row['analysis'],
        'difficulty': question_row['difficulty'],
        'chapter': chapter,
        'knowledge_point': chapter,
        'library_id': question_row['library_id'],
        'updated_at': question_row['updated_at'] if 'updated_at' in question_row.keys() else ''
    }

def serialize_question_for_export(question_row):
    try:
        options = json.loads(question_row['options'])
    except (TypeError, json.JSONDecodeError):
        options = []
    options = options if isinstance(options, list) else []
    question_type = normalize_question_type(question_row['type'])
    answer_raw = question_row['answer']
    answer = parse_stored_multiple_answer(answer_raw) if question_type == 'multiple' else answer_raw

    chapter = ''
    if 'chapter' in question_row.keys():
        chapter = question_row['chapter']
    elif 'knowledge_point' in question_row.keys():
        chapter = question_row['knowledge_point']

    return {
        'question': question_row['question'],
        'type': question_type,
        'options': options,
        'answer': answer,
        'analysis': question_row['analysis'],
        'difficulty': question_row['difficulty'],
        'chapter': chapter,
        'updated_at': question_row['updated_at'] if 'updated_at' in question_row.keys() else ''
    }

def get_library_with_questions(conn, lib_id):
    cursor = conn.cursor()
    cursor.execute('SELECT * FROM libraries WHERE id = ?', (lib_id,))
    library = cursor.fetchone()
    if not library:
        return None

    cursor.execute('SELECT * FROM questions WHERE library_id = ? ORDER BY id', (lib_id,))
    questions = [serialize_question(row) for row in cursor.fetchall()]

    return {
        'id': library['id'],
        'title': library['title'],
        'icon': library['icon'],
        'description': library['description'] if 'description' in library.keys() else '',
        'is_public': parse_db_bool(library['is_public'], True) if 'is_public' in library.keys() else True,
        'questions': questions
    }

def parse_question_payload(data, allow_empty_answer=False):
    question_text = (data.get('question') or data.get('q') or '').strip()
    analysis = (data.get('analysis') or '').strip()
    chapter = (data.get('chapter') or data.get('knowledge_point') or '').strip()
    raw_type = str(data.get('type') or 'single').strip().lower()
    question_type = normalize_question_type(raw_type)

    if not question_text:
        raise ValueError('题目内容不能为空')

    raw_answer = data.get('answer', data.get('ans'))
    if question_type == 'judge':
        options = parse_options(data.get('options'), allow_empty=True)
        if not options:
            options = ['正确', '错误']
        if len(options) != 2:
            raise ValueError('判断题必须提供 2 个选项')
    elif question_type in {'fill', 'qa'}:
        options = []
    else:
        options = parse_options(data.get('options'))
        if question_type == 'multiple' and len(options) > 8:
            raise ValueError('多选题最多支持 8 个选项')
    answer_is_empty = raw_answer is None or str(raw_answer).strip() == ''
    if answer_is_empty:
        if not allow_empty_answer:
            raise ValueError('答案不能为空')
        answer = ''
    elif question_type == 'multiple':
        indices = parse_multiple_answer(raw_answer, len(options))
        if len(indices) < 2:
            raise ValueError('多选题答案至少需要 2 个选项')
        answer = json.dumps(indices, ensure_ascii=False)
    elif question_type == 'judge':
        normalized_answer = normalize_judge_answer(raw_answer)
        if normalized_answer is None:
            raise ValueError('判断题答案格式错误，请使用“对/错、正确/错误、√/×”')
        answer = normalized_answer
    elif question_type == 'fill':
        if re.search(r'_{2,}|＿{2,}', question_text):
            raise ValueError('填空题不能使用下划线，请使用括号（）标记空位')
        blanks = re.findall(r'[（(][^（）()]*[）)]', question_text)
        if not blanks:
            raise ValueError('填空题题目必须使用括号（）标记空位')
        fill_answers = parse_fill_answers(raw_answer)
        if len(fill_answers) != len(blanks):
            raise ValueError('填空题答案数量需与括号数量一致')
        answer = '|'.join(fill_answers)
    elif question_type == 'qa':
        answer = str(raw_answer).strip()
    else:
        answer = str(parse_option_index(raw_answer, len(options)))

    try:
        difficulty = int(data.get('difficulty', 1))
    except (TypeError, ValueError):
        raise ValueError('难度必须是数字')

    return {
        'question': question_text,
        'type': question_type,
        'options': json.dumps(options, ensure_ascii=False),
        'answer': answer,
        'analysis': analysis,
        'difficulty': difficulty,
        'chapter': chapter
    }

def normalize_library_id(raw_id):
    cleaned = re.sub(r'[^a-zA-Z0-9_-]', '-', (raw_id or '').strip())
    return cleaned.strip('-_')

def generate_library_id(title):
    slug = re.sub(r'[^a-zA-Z0-9]+', '-', title.lower()).strip('-')
    if not slug:
        slug = 'library'
    return f'{slug}-{uuid.uuid4().hex[:6]}'

def ensure_unique_library_id(conn, base_id, reserved_ids=None):
    reserved = reserved_ids or set()
    normalized_base = normalize_library_id(base_id) or 'library'
    cursor = conn.cursor()

    candidate = normalized_base
    suffix = 1
    while True:
        cursor.execute('SELECT 1 FROM libraries WHERE id = ?', (candidate,))
        if not cursor.fetchone() and candidate not in reserved:
            return candidate
        candidate = f'{normalized_base}-{suffix}'
        suffix += 1

def extract_import_libraries(payload):
    if isinstance(payload, list):
        libraries = payload
    elif isinstance(payload, dict):
        if isinstance(payload.get('libraries'), list):
            libraries = payload['libraries']
        elif any(key in payload for key in ('title', 'id', 'questions')):
            libraries = [payload]
        else:
            raise ValueError('JSON 格式不正确，缺少题集信息')
    else:
        raise ValueError('JSON 顶层必须是对象或数组')

    if not libraries:
        raise ValueError('JSON 中没有可导入的题集')

    return libraries

def save_collector_record(source_filename, source_size, library_title, library_id, library_count, question_count, payload):
    payload_text = payload if isinstance(payload, str) else json.dumps(payload, ensure_ascii=False)
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('''
            INSERT INTO collector_records (
                source_filename, source_size, library_title, library_id,
                library_count, question_count, payload
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ''', (
            str(source_filename or ''),
            int(source_size or 0),
            str(library_title or ''),
            str(library_id or ''),
            int(library_count or 0),
            int(question_count or 0),
            payload_text
        ))
        record_id = cursor.lastrowid
        conn.commit()
        return int(record_id) if record_id is not None else None
    except Exception:
        conn.rollback()
        return None
    finally:
        conn.close()

def count_questions_in_libraries(libraries):
    if not isinstance(libraries, list):
        return 0
    total = 0
    for lib in libraries:
        if isinstance(lib, dict) and isinstance(lib.get('questions'), list):
            total += len(lib.get('questions') or [])
    return total

def parse_options_for_lookup(raw_options):
    try:
        return parse_options(raw_options, allow_empty=True)
    except Exception:
        return []

def format_stored_answer_for_client(question_type, stored_answer):
    q_type = normalize_question_type(question_type)
    if stored_answer is None:
        return ''
    if q_type == 'multiple':
        indices = parse_stored_multiple_answer(stored_answer)
        letters = []
        for idx in indices:
            try:
                idx_num = int(idx)
            except (TypeError, ValueError):
                continue
            if idx_num < 0:
                continue
            letters.append(chr(ord('A') + idx_num))
        return '#'.join(letters) if letters else str(stored_answer).strip()
    if q_type == 'single':
        value = str(stored_answer).strip()
        if re.fullmatch(r'-?\d+', value):
            idx = int(value)
            if idx >= 0:
                return chr(ord('A') + idx)
        return value.upper() if re.fullmatch(r'[A-Za-z]', value) else value
    if q_type == 'judge':
        normalized = normalize_judge_answer(stored_answer)
        if normalized == '0':
            return '正确'
        if normalized == '1':
            return '错误'
        return str(stored_answer).strip()
    return str(stored_answer).strip()

def find_answer_from_question_bank(question_text, question_type=None):
    text = str(question_text or '').strip()
    if not text:
        return ''
    q_type = normalize_question_type(question_type or 'single')
    normalized_target = normalize_compare_text(text)
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        # 1) 优先精确匹配（同题型）
        cursor.execute('''
            SELECT question, type, answer
            FROM questions
            WHERE question = ? AND type = ?
            ORDER BY updated_at DESC, id DESC
            LIMIT 1
        ''', (text, q_type))
        row = cursor.fetchone()
        if row:
            return format_stored_answer_for_client(row['type'], row['answer'])

        # 2) 精确匹配（不限题型）
        cursor.execute('''
            SELECT question, type, answer
            FROM questions
            WHERE question = ?
            ORDER BY updated_at DESC, id DESC
            LIMIT 1
        ''', (text,))
        row = cursor.fetchone()
        if row:
            return format_stored_answer_for_client(row['type'], row['answer'])

        # 3) 近似匹配（同题型）
        like_keyword = f"%{text[:120]}%"
        cursor.execute('''
            SELECT question, type, answer
            FROM questions
            WHERE type = ? AND question LIKE ?
            ORDER BY updated_at DESC, id DESC
            LIMIT 80
        ''', (q_type, like_keyword))
        rows = cursor.fetchall()
        for item in rows:
            normalized_item = normalize_compare_text(item['question'])
            if not normalized_item:
                continue
            if normalized_item == normalized_target or normalized_target in normalized_item or normalized_item in normalized_target:
                return format_stored_answer_for_client(item['type'], item['answer'])
    finally:
        conn.close()
    return ''

def _extract_questions_from_any_payload(payload_obj):
    extracted = []

    def _append(item, fallback_type='single'):
        if not isinstance(item, dict):
            return
        question = str(item.get('question') or item.get('q') or item.get('title') or '').strip()
        answer = str(item.get('answer') if item.get('answer') is not None else item.get('ans') or '').strip()
        q_type = normalize_question_type(item.get('type') or fallback_type or 'single')
        if not question:
            return
        extracted.append({
            'question': question,
            'type': q_type,
            'answer': answer
        })

    libraries = []
    if isinstance(payload_obj, dict) and isinstance(payload_obj.get('libraries'), list):
        libraries = payload_obj.get('libraries') or []
    elif isinstance(payload_obj, list):
        libraries = payload_obj

    if libraries:
        for lib in libraries:
            if not isinstance(lib, dict):
                continue
            for question_item in (lib.get('questions') or []):
                _append(question_item)
        return extracted

    if isinstance(payload_obj, dict):
        _append(payload_obj, payload_obj.get('type') if isinstance(payload_obj, dict) else 'single')
    return extracted

def find_answer_from_collector_records(question_text, question_type=None, limit=120):
    text = str(question_text or '').strip()
    if not text:
        return ''
    q_type = normalize_question_type(question_type or 'single')
    normalized_target = normalize_compare_text(text)

    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('''
            SELECT payload
            FROM collector_records
            ORDER BY id DESC
            LIMIT ?
        ''', (max(1, min(int(limit), 500)),))
        rows = cursor.fetchall()
    finally:
        conn.close()

    for row in rows:
        payload_raw = row['payload'] if isinstance(row, dict) or hasattr(row, '__getitem__') else ''
        try:
            payload_obj = json.loads(str(payload_raw or '').strip() or '{}')
        except Exception:
            payload_obj = None
        if payload_obj is None:
            continue

        candidates = _extract_questions_from_any_payload(payload_obj)
        for item in candidates:
            stored_question = str(item.get('question') or '').strip()
            stored_answer = str(item.get('answer') or '').strip()
            stored_type = normalize_question_type(item.get('type') or 'single')
            if not stored_question or not stored_answer:
                continue
            # 题型一致优先，不一致也允许兜底命中
            if stored_type != q_type and q_type:
                # 延迟匹配，先看是否文本几乎完全一致
                pass
            normalized_item = normalize_compare_text(stored_question)
            if not normalized_item:
                continue
            if normalized_item == normalized_target or normalized_target in normalized_item or normalized_item in normalized_target:
                return format_stored_answer_for_client(stored_type, stored_answer)
    return ''

def generate_answer_by_ai(question_text, question_type, options):
    question = str(question_text or '').strip()
    if not question:
        return ''
    q_type = normalize_question_type(question_type or 'single')
    normalized_options = parse_options_for_lookup(options)

    settings = sanitize_ai_settings({}, load_ai_settings())
    if not settings.get('api_key'):
        return ''
    if not settings.get('base_url') and not settings.get('endpoint_path'):
        return ''
    if settings.get('provider') != 'openai_compatible':
        return ''

    prompt = build_ai_generate_prompt(question, q_type, normalized_options)
    ai_text = call_openai_compatible_chat(settings, prompt)
    result = extract_json_payload(ai_text)
    if not isinstance(result, dict):
        return ''
    return str(result.get('answer') or '').strip()

def upsert_collector_libraries_into_question_bank(
    libraries,
    fallback_library_id='collector-history',
    fallback_library_title='采集历史题库'
):
    if not isinstance(libraries, list):
        return {'merged_count': 0, 'updated_count': 0, 'library_ids': []}

    conn = get_db_connection()
    cursor = conn.cursor()
    reserved_ids = set()
    merged_count = 0
    updated_count = 0
    affected_library_ids = []

    def _fetch_row_id(row):
        if row is None:
            return None
        if hasattr(row, 'keys') and 'id' in row.keys():
            return row['id']
        try:
            return row[0]
        except Exception:
            return None

    try:
        prepared_libraries = []
        for lib_index, lib in enumerate(libraries, start=1):
            if not isinstance(lib, dict):
                continue
            title = str(lib.get('title') or fallback_library_title or f'采集题库{lib_index}').strip()
            if not title:
                title = f'采集题库{lib_index}'
            icon = str(lib.get('icon') or '📥').strip() or '📥'
            description = str(lib.get('description') or '').strip()
            is_public = 1 if parse_bool_env(lib.get('is_public'), True) else 0
            requested_id = normalize_library_id(lib.get('id'))

            if not requested_id:
                base_id = normalize_library_id(title) or normalize_library_id(fallback_library_id) or 'collector-history'
                if base_id in reserved_ids:
                    requested_id = ensure_unique_library_id(conn, base_id, reserved_ids)
                else:
                    cursor.execute('SELECT 1 FROM libraries WHERE id = ?', (base_id,))
                    if cursor.fetchone():
                        requested_id = base_id
                    else:
                        requested_id = base_id

            if requested_id in reserved_ids:
                requested_id = ensure_unique_library_id(conn, requested_id, reserved_ids)

            cursor.execute('SELECT 1 FROM libraries WHERE id = ?', (requested_id,))
            exists = cursor.fetchone() is not None
            if exists:
                cursor.execute(
                    'UPDATE libraries SET title = ?, icon = ?, description = ?, is_public = ? WHERE id = ?',
                    (title, icon, description, is_public, requested_id)
                )
            else:
                cursor.execute(
                    'INSERT INTO libraries (id, title, icon, description, is_public) VALUES (?, ?, ?, ?, ?)',
                    (requested_id, title, icon, description, is_public)
                )

            reserved_ids.add(requested_id)
            if requested_id not in affected_library_ids:
                affected_library_ids.append(requested_id)
            questions = lib.get('questions')
            if not isinstance(questions, list):
                questions = []
            prepared_libraries.append((requested_id, questions))

        for library_id, questions in prepared_libraries:
            for raw_question in questions:
                if not isinstance(raw_question, dict):
                    continue
                try:
                    parsed = parse_question_payload(raw_question, allow_empty_answer=True)
                except Exception:
                    fallback_question = str(raw_question.get('question') or raw_question.get('q') or '').strip()
                    if not fallback_question:
                        continue
                    try:
                        parsed = parse_question_payload({
                            'question': fallback_question,
                            'type': 'qa',
                            'options': [],
                            'answer': str(raw_question.get('answer') if raw_question.get('answer') is not None else raw_question.get('ans') or '').strip(),
                            'analysis': str(raw_question.get('analysis') or '').strip(),
                            'difficulty': raw_question.get('difficulty', 1),
                            'chapter': str(raw_question.get('chapter') or raw_question.get('knowledge_point') or '').strip()
                        }, allow_empty_answer=True)
                    except Exception:
                        continue

                cursor.execute('''
                    SELECT id FROM questions
                    WHERE library_id = ? AND question = ? AND type = ?
                    ORDER BY id DESC
                    LIMIT 1
                ''', (library_id, parsed['question'], parsed['type']))
                existing_row = cursor.fetchone()
                existing_id = _fetch_row_id(existing_row)

                if existing_id:
                    cursor.execute('''
                        UPDATE questions
                        SET options = ?, answer = ?, analysis = ?, difficulty = ?, chapter = ?, updated_at = CURRENT_TIMESTAMP
                        WHERE id = ?
                    ''', (
                        parsed['options'],
                        parsed['answer'],
                        parsed['analysis'],
                        parsed['difficulty'],
                        parsed['chapter'],
                        existing_id
                    ))
                    updated_count += 1
                else:
                    cursor.execute('''
                        INSERT INTO questions (
                            question, type, options, answer, analysis,
                            difficulty, chapter, library_id, updated_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                    ''', (
                        parsed['question'],
                        parsed['type'],
                        parsed['options'],
                        parsed['answer'],
                        parsed['analysis'],
                        parsed['difficulty'],
                        parsed['chapter'],
                        library_id
                    ))
                    merged_count += 1

        conn.commit()
        invalidate_public_library_cache()
        return {
            'merged_count': merged_count,
            'updated_count': updated_count,
            'library_ids': affected_library_ids
        }
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

def is_admin_authenticated():
    return bool(session.get('is_admin'))

def require_admin_auth(view_func):
    @wraps(view_func)
    def wrapped(*args, **kwargs):
        if not is_admin_authenticated():
            return jsonify({'error': '请先登录管理员账号'}), 401
        return view_func(*args, **kwargs)
    return wrapped

@app.route('/')
def serve_index():
    return render_template('index.html')

def render_admin_page(admin_page):
    if not is_admin_authenticated():
        return redirect('/admin/login')
    page_titles = {
        'question-bank': '题库管理',
        'library-management': '题集管理',
        'import': '导入题库',
        'export': '导出题库',
        'collector-list': '采集列表'
    }
    page_key = admin_page if admin_page in page_titles else 'question-bank'
    return render_template(
        'admin.html',
        admin_page=page_key,
        admin_page_title=page_titles[page_key]
    )

@app.route('/admin')
def serve_admin():
    return redirect('/admin/question-bank')

@app.route('/admin/question-bank')
def serve_admin_question_bank():
    return render_admin_page('question-bank')

@app.route('/admin/library-management')
def serve_admin_library_management():
    return render_admin_page('library-management')

@app.route('/admin/import')
def serve_admin_import():
    return render_admin_page('import')

@app.route('/admin/export')
def serve_admin_export():
    return render_admin_page('export')

@app.route('/admin/question-collector')
def serve_admin_question_collector():
    return redirect('/admin/import')

@app.route('/admin/collector-list')
def serve_admin_collector_list():
    return render_admin_page('collector-list')

@app.route('/admin/login')
def serve_admin_login():
    if is_admin_authenticated():
        return redirect('/admin')
    return render_template('admin_login.html')

# 获取题库列表
@app.route('/api/libraries', methods=['GET'])
@app.route('/libraries', methods=['GET'])
def get_libraries():
    cache_key = build_redis_cache_key('public', 'libraries', 'list')
    cached = redis_get_json(cache_key)
    if isinstance(cached, list):
        return apply_public_cache_headers(
            jsonify(cached),
            s_maxage=min(600, REDIS_PUBLIC_LIB_CACHE_TTL),
            stale_while_revalidate=max(600, REDIS_PUBLIC_LIB_CACHE_TTL * 3)
        )

    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('''
        SELECT l.id, l.title, l.icon, l.description, l.is_public, COUNT(q.id) AS question_count
        FROM libraries l
        LEFT JOIN questions q ON q.library_id = l.id
        GROUP BY l.id, l.title, l.icon, l.description, l.is_public
        ORDER BY l.id
    ''')
    libraries = cursor.fetchall()
    conn.close()
    
    result = []
    for lib in libraries:
        is_public = parse_db_bool(lib['is_public'], True) if 'is_public' in lib.keys() else True
        if not is_public:
            continue
        result.append({
            'id': lib['id'],
            'title': lib['title'],
            'icon': lib['icon'],
            'description': lib['description'] if 'description' in lib.keys() else '',
            'is_public': is_public,
            'question_count': int(lib['question_count']) if 'question_count' in lib.keys() else 0
        })

    redis_set_json(cache_key, result, REDIS_PUBLIC_LIB_CACHE_TTL)
    return apply_public_cache_headers(
        jsonify(result),
        s_maxage=min(600, REDIS_PUBLIC_LIB_CACHE_TTL),
        stale_while_revalidate=max(600, REDIS_PUBLIC_LIB_CACHE_TTL * 3)
    )

# 获取题库详情（包含题目和选项）
@app.route('/api/libraries/<lib_id>', methods=['GET'])
@app.route('/libraries/<lib_id>', methods=['GET'])
def get_library_details(lib_id):
    admin_auth = is_admin_authenticated()
    cache_key = build_redis_cache_key('public', 'libraries', 'detail', lib_id)
    if not admin_auth:
        cached = redis_get_json(cache_key)
        if isinstance(cached, dict):
            return apply_public_cache_headers(
                jsonify(cached),
                s_maxage=min(600, REDIS_PUBLIC_LIB_CACHE_TTL),
                stale_while_revalidate=max(600, REDIS_PUBLIC_LIB_CACHE_TTL * 3)
            )

    conn = get_db_connection()
    result = get_library_with_questions(conn, lib_id)
    conn.close()

    if not result:
        return jsonify({'error': 'Library not found'}), 404
    if not result.get('is_public', True) and not admin_auth:
        return jsonify({'error': 'Library not found'}), 404
    if not admin_auth and result.get('is_public', True):
        redis_set_json(cache_key, result, REDIS_PUBLIC_LIB_CACHE_TTL)
        return apply_public_cache_headers(
            jsonify(result),
            s_maxage=min(600, REDIS_PUBLIC_LIB_CACHE_TTL),
            stale_while_revalidate=max(600, REDIS_PUBLIC_LIB_CACHE_TTL * 3)
        )
    return jsonify(result)

# 保存用户答题记录
@app.route('/api/answers', methods=['POST'])
@app.route('/answers', methods=['POST'])
def save_answers():
    data = request.get_json()
    library_id = data.get('library_id')
    answers = data.get('answers')
    
    if not library_id or not answers:
        return jsonify({'error': 'Missing required fields'}), 400
    
    conn = get_db_connection()
    cursor = conn.cursor()
    
    try:
        # 计算得分
        cursor.execute('SELECT id, answer, type, options FROM questions WHERE library_id = ? ORDER BY id', (library_id,))
        questions = cursor.fetchall()
        
        correct_count = 0
        total_questions = len(questions)
        batch_rows = []
        
        for i, q in enumerate(questions):
            user_answer = answers.get(str(i))
            try:
                option_count = len(json.loads(q['options'] or '[]'))
            except (TypeError, json.JSONDecodeError):
                option_count = None

            is_correct = 1 if is_answer_correct(q['type'], q['answer'], user_answer, option_count) else 0
            if is_correct:
                correct_count += 1
            
            # 保存答题记录
            batch_rows.append((library_id, q['id'], serialize_user_answer(user_answer), is_correct))
        
        accuracy = round(correct_count / total_questions * 100) if total_questions > 0 else 0
        score = correct_count

        if batch_rows:
            cursor.executemany('''
                INSERT INTO user_answers (library_id, question_id, user_answer, is_correct)
                VALUES (?, ?, ?, ?)
            ''', batch_rows)
        
        conn.commit()
        conn.close()
        
        return jsonify({
            'score': score,
            'correct': correct_count,
            'total': total_questions,
            'accuracy': accuracy
        })
    except Exception as e:
        conn.rollback()
        conn.close()
        return jsonify({'error': str(e)}), 500

# 获取用户答题历史
@app.route('/api/answers/<library_id>', methods=['GET'])
@app.route('/answers/<library_id>', methods=['GET'])
def get_answers(library_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    
    cursor.execute('''
        SELECT q.id as question_id, q.question, q.answer, 
               ua.user_answer, ua.is_correct, ua.created_at
        FROM user_answers ua
        JOIN questions q ON ua.question_id = q.id
        WHERE ua.library_id = ?
        ORDER BY ua.created_at DESC, q.id
    ''', (library_id,))
    
    answers = cursor.fetchall()
    conn.close()
    
    result = []
    for ans in answers:
        result.append({
            'question_id': ans['question_id'],
            'question': ans['question'],
            'answer': ans['answer'],
            'user_answer': ans['user_answer'],
            'is_correct': bool(ans['is_correct']),
            'created_at': ans['created_at']
        })
    
    return jsonify(result)

# 管理后台：题集列表（含题目数量）
@app.route('/api/admin/libraries', methods=['GET'])
@require_admin_auth
def admin_get_libraries():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('''
        SELECT l.id, l.title, l.icon, l.description, l.is_public, COUNT(q.id) AS question_count
        FROM libraries l
        LEFT JOIN questions q ON q.library_id = l.id
        GROUP BY l.id, l.title, l.icon, l.description, l.is_public
        ORDER BY l.id
    ''')
    rows = cursor.fetchall()
    conn.close()

    return jsonify([{
        'id': row['id'],
        'title': row['title'],
        'icon': row['icon'],
        'description': row['description'] if 'description' in row.keys() else '',
        'is_public': parse_db_bool(row['is_public'], True) if 'is_public' in row.keys() else True,
        'question_count': row['question_count']
    } for row in rows])

# 管理后台：新建题集
@app.route('/api/admin/libraries', methods=['POST'])
@require_admin_auth
def admin_create_library():
    data = request.get_json(silent=True) or {}
    title = (data.get('title') or '').strip()
    icon = (data.get('icon') or '📚').strip() or '📚'
    description = (data.get('description') or '').strip()
    is_public = 1 if parse_bool_env(data.get('is_public'), True) else 0
    lib_id = normalize_library_id(data.get('id'))

    if not title:
        return jsonify({'error': '题集名称不能为空'}), 400

    if not lib_id:
        lib_id = generate_library_id(title)

    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            'INSERT INTO libraries (id, title, icon, description, is_public) VALUES (?, ?, ?, ?, ?)',
            (lib_id, title, icon, description, is_public)
        )
        conn.commit()
        invalidate_public_library_cache()
    except DB_INTEGRITY_ERRORS:
        conn.rollback()
        conn.close()
        return jsonify({'error': '题集 ID 已存在'}), 409

    cursor.execute('SELECT * FROM libraries WHERE id = ?', (lib_id,))
    created = cursor.fetchone()
    conn.close()

    return jsonify({
        'id': created['id'],
        'title': created['title'],
        'icon': created['icon'],
        'description': created['description'] if 'description' in created.keys() else '',
        'is_public': parse_db_bool(created['is_public'], True) if 'is_public' in created.keys() else True,
        'question_count': 0
    }), 201

# 管理后台：获取单个题集详情
@app.route('/api/admin/libraries/<lib_id>', methods=['GET'])
@require_admin_auth
def admin_get_library_details(lib_id):
    conn = get_db_connection()
    result = get_library_with_questions(conn, lib_id)
    conn.close()

    if not result:
        return jsonify({'error': 'Library not found'}), 404
    return jsonify(result)

# 管理后台：获取全题库题目（跨题集）
@app.route('/api/admin/questions', methods=['GET'])
@require_admin_auth
def admin_get_all_questions():
    keyword = (request.args.get('keyword') or '').strip()
    library_id = (request.args.get('library_id') or '').strip()

    conn = get_db_connection()
    cursor = conn.cursor()

    query = '''
        SELECT q.*, l.title AS library_title, l.icon AS library_icon
        FROM questions q
        JOIN libraries l ON l.id = q.library_id
    '''
    where_clauses = []
    params = []

    if library_id:
        where_clauses.append('q.library_id = ?')
        params.append(library_id)

    if keyword:
        like_kw = f'%{keyword}%'
        where_clauses.append('(q.question LIKE ? OR q.chapter LIKE ? OR l.title LIKE ?)')
        params.extend([like_kw, like_kw, like_kw])

    if where_clauses:
        query += ' WHERE ' + ' AND '.join(where_clauses)

    query += ' ORDER BY q.id DESC'
    cursor.execute(query, tuple(params))
    rows = cursor.fetchall()
    conn.close()

    questions = []
    for row in rows:
        item = serialize_question(row)
        item['library_title'] = row['library_title'] if 'library_title' in row.keys() else ''
        item['library_icon'] = row['library_icon'] if 'library_icon' in row.keys() else '📚'
        questions.append(item)

    return jsonify({
        'total': len(questions),
        'questions': questions
    })

# 管理后台：更新题集信息
@app.route('/api/admin/libraries/<lib_id>', methods=['PUT'])
@require_admin_auth
def admin_update_library(lib_id):
    data = request.get_json(silent=True) or {}
    next_lib_id = None
    fields = []
    values = []

    if 'id' in data:
        next_lib_id = normalize_library_id(data.get('id'))
        if not next_lib_id:
            return jsonify({'error': '题集 ID 不能为空，且只能包含字母、数字、-、_'}), 400

    if 'title' in data:
        title = (data.get('title') or '').strip()
        if not title:
            return jsonify({'error': '题集名称不能为空'}), 400
        fields.append('title = ?')
        values.append(title)

    if 'icon' in data:
        icon = (data.get('icon') or '📚').strip() or '📚'
        fields.append('icon = ?')
        values.append(icon)
    if 'description' in data:
        description = (data.get('description') or '').strip()
        fields.append('description = ?')
        values.append(description)
    if 'is_public' in data:
        is_public = 1 if parse_bool_env(data.get('is_public'), True) else 0
        fields.append('is_public = ?')
        values.append(is_public)

    if not fields and (not next_lib_id or next_lib_id == lib_id):
        return jsonify({'error': '没有可更新字段'}), 400

    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT 1 FROM libraries WHERE id = ?', (lib_id,))
    if not cursor.fetchone():
        conn.close()
        return jsonify({'error': 'Library not found'}), 404

    current_lib_id = lib_id
    if next_lib_id and next_lib_id != lib_id:
        cursor.execute('SELECT 1 FROM libraries WHERE id = ?', (next_lib_id,))
        if cursor.fetchone():
            conn.close()
            return jsonify({'error': '题集 ID 已存在，请更换'}), 400
        cursor.execute('UPDATE libraries SET id = ? WHERE id = ?', (next_lib_id, lib_id))
        cursor.execute('UPDATE questions SET library_id = ? WHERE library_id = ?', (next_lib_id, lib_id))
        cursor.execute('UPDATE user_answers SET library_id = ? WHERE library_id = ?', (next_lib_id, lib_id))
        current_lib_id = next_lib_id

    if fields:
        values.append(current_lib_id)
        cursor.execute(f'UPDATE libraries SET {", ".join(fields)} WHERE id = ?', values)

    conn.commit()
    invalidate_public_library_cache()
    result = get_library_with_questions(conn, current_lib_id)
    conn.close()
    return jsonify(result)

# 管理后台：删除题集
@app.route('/api/admin/libraries/<lib_id>', methods=['DELETE'])
@require_admin_auth
def admin_delete_library(lib_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT 1 FROM libraries WHERE id = ?', (lib_id,))
    exists = cursor.fetchone()
    if not exists:
        conn.close()
        return jsonify({'error': 'Library not found'}), 404

    cursor.execute('DELETE FROM user_answers WHERE library_id = ?', (lib_id,))
    cursor.execute('DELETE FROM questions WHERE library_id = ?', (lib_id,))
    cursor.execute('DELETE FROM libraries WHERE id = ?', (lib_id,))
    conn.commit()
    invalidate_public_library_cache()
    conn.close()

    return jsonify({'message': '题集已删除'})

# 管理后台：批量操作题集
@app.route('/api/admin/libraries/batch', methods=['POST'])
@require_admin_auth
def admin_batch_libraries():
    data = request.get_json(silent=True) or {}
    raw_ids = data.get('library_ids')
    action = str(data.get('action') or '').strip()

    if not isinstance(raw_ids, list) or not raw_ids:
        return jsonify({'error': 'library_ids 必须是非空数组'}), 400
    if action not in ('delete', 'set-public', 'set-private'):
        return jsonify({'error': '不支持的批量操作'}), 400

    library_ids = []
    seen_ids = set()
    for item in raw_ids:
        lib_id = str(item or '').strip()
        if not lib_id or lib_id in seen_ids:
            continue
        seen_ids.add(lib_id)
        library_ids.append(lib_id)

    if not library_ids:
        return jsonify({'error': '没有有效的题集 ID'}), 400

    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        placeholders = ','.join(['?'] * len(library_ids))
        cursor.execute(
            f'SELECT id FROM libraries WHERE id IN ({placeholders})',
            tuple(library_ids)
        )
        existing_ids = [row['id'] for row in cursor.fetchall()]
        if not existing_ids:
            conn.close()
            return jsonify({'error': '未找到可操作的题集'}), 404

        existing_placeholders = ','.join(['?'] * len(existing_ids))
        if action == 'delete':
            params = tuple(existing_ids)
            cursor.execute(f'DELETE FROM user_answers WHERE library_id IN ({existing_placeholders})', params)
            cursor.execute(f'DELETE FROM questions WHERE library_id IN ({existing_placeholders})', params)
            cursor.execute(f'DELETE FROM libraries WHERE id IN ({existing_placeholders})', params)
            affected_count = len(existing_ids)
            conn.commit()
            invalidate_public_library_cache()
            conn.close()
            return jsonify({
                'message': f'已删除 {affected_count} 个题集',
                'action': action,
                'requested_count': len(library_ids),
                'affected_count': affected_count,
                'library_ids': existing_ids
            })

        is_public = 1 if action == 'set-public' else 0
        cursor.execute(
            f'UPDATE libraries SET is_public = ? WHERE id IN ({existing_placeholders})',
            (is_public, *existing_ids)
        )
        affected_count = int(cursor.rowcount) if isinstance(cursor.rowcount, int) and cursor.rowcount >= 0 else len(existing_ids)
        conn.commit()
        invalidate_public_library_cache()
        conn.close()
        return jsonify({
            'message': f'已更新 {affected_count} 个题集可见性',
            'action': action,
            'requested_count': len(library_ids),
            'affected_count': affected_count,
            'library_ids': existing_ids,
            'is_public': bool(is_public)
        })
    except Exception as exc:
        conn.rollback()
        conn.close()
        return jsonify({'error': f'批量操作失败: {exc}'}), 500

# 管理后台：新增题目
@app.route('/api/admin/libraries/<lib_id>/questions', methods=['POST'])
@require_admin_auth
def admin_create_question(lib_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT 1 FROM libraries WHERE id = ?', (lib_id,))
    if not cursor.fetchone():
        conn.close()
        return jsonify({'error': 'Library not found'}), 404

    data = request.get_json(silent=True) or {}
    try:
        payload = parse_question_payload(data)
    except ValueError as exc:
        conn.close()
        return jsonify({'error': str(exc)}), 400

    cursor.execute('''
        INSERT INTO questions (
            question, type, options, answer, analysis,
            difficulty, chapter, library_id, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ''', (
        payload['question'], payload['type'], payload['options'], payload['answer'],
        payload['analysis'], payload['difficulty'], payload['chapter'], lib_id
    ))
    question_id = cursor.lastrowid
    conn.commit()
    invalidate_public_library_cache(lib_id)

    cursor.execute('SELECT * FROM questions WHERE id = ?', (question_id,))
    question = serialize_question(cursor.fetchone())
    conn.close()

    return jsonify(question), 201

# 管理后台：批量新增题目
@app.route('/api/admin/libraries/<lib_id>/questions/batch', methods=['POST'])
@require_admin_auth
def admin_create_questions_batch(lib_id):
    data = request.get_json(silent=True) or {}
    raw_questions = data.get('questions')
    if not isinstance(raw_questions, list) or not raw_questions:
        return jsonify({'error': 'questions 必须是非空数组'}), 400

    allow_empty_answer = parse_bool_env(data.get('allow_empty_answer'), False)
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT 1 FROM libraries WHERE id = ?', (lib_id,))
    if not cursor.fetchone():
        conn.close()
        return jsonify({'error': 'Library not found'}), 404

    rows = []
    try:
        for idx, item in enumerate(raw_questions, start=1):
            if not isinstance(item, dict):
                raise ValueError(f'第 {idx} 题格式错误，必须是对象')
            try:
                parsed = parse_question_payload(item, allow_empty_answer=allow_empty_answer)
            except ValueError as exc:
                raise ValueError(f'第 {idx} 题: {exc}')
            rows.append((
                parsed['question'], parsed['type'], parsed['options'], parsed['answer'],
                parsed['analysis'], parsed['difficulty'], parsed['chapter'], lib_id
            ))

        cursor.executemany('''
            INSERT INTO questions (
                question, type, options, answer, analysis,
                difficulty, chapter, library_id, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ''', rows)
        conn.commit()
        invalidate_public_library_cache(lib_id)
    except ValueError as exc:
        conn.rollback()
        conn.close()
        return jsonify({'error': str(exc)}), 400
    except Exception as exc:
        conn.rollback()
        conn.close()
        return jsonify({'error': f'批量导入失败: {exc}'}), 500

    conn.close()
    return jsonify({
        'message': '批量导入成功',
        'library_id': lib_id,
        'imported_count': len(rows)
    }), 201

# 管理后台：更新题目
@app.route('/api/admin/questions/<int:question_id>', methods=['PUT'])
@require_admin_auth
def admin_update_question(question_id):
    data = request.get_json(silent=True) or {}
    try:
        payload = parse_question_payload(data)
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400

    target_library_id = normalize_library_id(data.get('library_id')) or data.get('library_id')
    if target_library_id is None or str(target_library_id).strip() == '':
        target_library_id = data.get('library_id')

    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT library_id FROM questions WHERE id = ?', (question_id,))
    question = cursor.fetchone()
    if not question:
        conn.close()
        return jsonify({'error': 'Question not found'}), 404

    if not target_library_id:
        target_library_id = question['library_id']

    cursor.execute('SELECT 1 FROM libraries WHERE id = ?', (target_library_id,))
    if not cursor.fetchone():
        conn.close()
        return jsonify({'error': '目标题集不存在'}), 400

    cursor.execute('''
        UPDATE questions
        SET question = ?, type = ?, options = ?, answer = ?, analysis = ?,
            difficulty = ?, chapter = ?, library_id = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    ''', (
        payload['question'], payload['type'], payload['options'], payload['answer'],
        payload['analysis'], payload['difficulty'], payload['chapter'],
        target_library_id, question_id
    ))
    conn.commit()
    invalidate_public_library_cache()

    cursor.execute('SELECT * FROM questions WHERE id = ?', (question_id,))
    updated = serialize_question(cursor.fetchone())
    conn.close()
    return jsonify(updated)

# 管理后台：批量修改题目
@app.route('/api/admin/questions/batch', methods=['PUT'])
@require_admin_auth
def admin_batch_update_questions():
    data = request.get_json(silent=True) or {}
    raw_question_ids = data.get('question_ids')
    if not isinstance(raw_question_ids, list) or not raw_question_ids:
        return jsonify({'error': '请提供要修改的题目 ID 列表'}), 400

    question_ids = []
    for raw_id in raw_question_ids:
        try:
            question_id = int(raw_id)
        except (TypeError, ValueError):
            return jsonify({'error': '题目 ID 必须是数字'}), 400
        if question_id not in question_ids:
            question_ids.append(question_id)

    changes = data.get('changes')
    if not isinstance(changes, dict):
        return jsonify({'error': 'changes 字段必须是对象'}), 400

    fields = []
    values = []

    if 'difficulty' in changes:
        try:
            difficulty = int(changes.get('difficulty'))
        except (TypeError, ValueError):
            return jsonify({'error': '难度必须是数字'}), 400
        fields.append('difficulty = ?')
        values.append(difficulty)

    if 'chapter' in changes or 'knowledge_point' in changes:
        chapter = str(changes.get('chapter', changes.get('knowledge_point')) or '').strip()
        fields.append('chapter = ?')
        values.append(chapter)

    target_library_id = normalize_library_id(changes.get('target_library_id')) or str(changes.get('target_library_id') or '').strip()
    if target_library_id:
        fields.append('library_id = ?')
        values.append(target_library_id)

    copy_to_library_id = normalize_library_id(changes.get('copy_to_library_id')) or str(changes.get('copy_to_library_id') or '').strip()
    if not fields and not copy_to_library_id:
        return jsonify({'error': '没有可批量修改的字段'}), 400

    library_id = normalize_library_id(data.get('library_id')) or str(data.get('library_id') or '').strip()
    if not library_id:
        return jsonify({'error': 'library_id 不能为空'}), 400

    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT 1 FROM libraries WHERE id = ?', (library_id,))
    if not cursor.fetchone():
        conn.close()
        return jsonify({'error': '题集不存在'}), 404

    if target_library_id:
        cursor.execute('SELECT 1 FROM libraries WHERE id = ?', (target_library_id,))
        if not cursor.fetchone():
            conn.close()
            return jsonify({'error': '目标题集不存在'}), 404

    if copy_to_library_id:
        cursor.execute('SELECT 1 FROM libraries WHERE id = ?', (copy_to_library_id,))
        if not cursor.fetchone():
            conn.close()
            return jsonify({'error': '复制目标题集不存在'}), 404

    placeholders = ','.join(['?'] * len(question_ids))
    updated_count = 0
    copied_count = 0

    if fields:
        sql = f'''
            UPDATE questions
            SET {", ".join(fields)}, updated_at = CURRENT_TIMESTAMP
            WHERE library_id = ? AND id IN ({placeholders})
        '''
        cursor.execute(sql, values + [library_id] + question_ids)
        updated_count = cursor.rowcount

    if copy_to_library_id:
        if copy_to_library_id == library_id:
            conn.close()
            return jsonify({'error': '复制目标题集不能与当前题集相同'}), 400
        cursor.execute(
            f'''
                SELECT question, type, options, answer, analysis, difficulty, chapter
                FROM questions
                WHERE library_id = ? AND id IN ({placeholders})
                ORDER BY id
            ''',
            [library_id] + question_ids
        )
        source_questions = cursor.fetchall()
        for row in source_questions:
            cursor.execute('''
                INSERT INTO questions (
                    question, type, options, answer, analysis,
                    difficulty, chapter, library_id, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ''', (
                row['question'], row['type'], row['options'], row['answer'],
                row['analysis'], row['difficulty'], row['chapter'], copy_to_library_id
            ))
        copied_count = len(source_questions)

    conn.commit()
    invalidate_public_library_cache()
    conn.close()

    return jsonify({'updated_count': updated_count, 'copied_count': copied_count})

# 管理后台：删除题目
@app.route('/api/admin/questions/<int:question_id>', methods=['DELETE'])
@require_admin_auth
def admin_delete_question(question_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT library_id FROM questions WHERE id = ?', (question_id,))
    row = cursor.fetchone()
    if not row:
        conn.close()
        return jsonify({'error': 'Question not found'}), 404

    cursor.execute('DELETE FROM user_answers WHERE question_id = ?', (question_id,))
    cursor.execute('DELETE FROM questions WHERE id = ?', (question_id,))
    conn.commit()
    invalidate_public_library_cache(row['library_id'])
    conn.close()
    return jsonify({'message': '题目已删除'})

@app.route('/api/admin/import-json', methods=['POST'])
@require_admin_auth
def admin_import_libraries_from_json():
    uploaded_file = request.files.get('file')
    if not uploaded_file or not uploaded_file.filename:
        return jsonify({'error': '请上传 JSON 文件'}), 400

    raw_content = uploaded_file.read()
    if not raw_content:
        return jsonify({'error': '上传文件为空'}), 400

    try:
        text = raw_content.decode('utf-8-sig')
    except UnicodeDecodeError:
        return jsonify({'error': '文件编码不支持，请使用 UTF-8'}), 400

    try:
        payload = json.loads(text)
    except json.JSONDecodeError as exc:
        return jsonify({'error': f'JSON 解析失败: {exc.msg} (第 {exc.lineno} 行)'}), 400

    try:
        raw_libraries = extract_import_libraries(payload)
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400

    replace_existing = str(request.form.get('replace_existing', '')).strip().lower() in (
        '1', 'true', 'yes', 'on'
    )
    allow_empty_answer = str(request.form.get('allow_empty_answer', '1')).strip().lower() in (
        '1', 'true', 'yes', 'on'
    )

    conn = get_db_connection()
    cursor = conn.cursor()
    imported_library_ids = []
    imported_question_count = 0
    replaced_count = 0
    reserved_ids = set()

    try:
        for lib_index, raw_library in enumerate(raw_libraries, start=1):
            if not isinstance(raw_library, dict):
                raise ValueError(f'第 {lib_index} 个题集格式错误，必须是对象')

            title = str(raw_library.get('title') or '').strip()
            if not title:
                raise ValueError(f'第 {lib_index} 个题集缺少 title')

            icon = str(raw_library.get('icon') or '📚').strip() or '📚'
            description = str(raw_library.get('description') or '').strip()
            is_public = 1 if parse_bool_env(raw_library.get('is_public'), True) else 0
            requested_id = normalize_library_id(raw_library.get('id'))
            questions = raw_library.get('questions')
            if questions is None:
                questions = []
            if not isinstance(questions, list):
                raise ValueError(f'题集「{title}」的 questions 必须是数组')

            if requested_id:
                target_library_id = requested_id
            else:
                target_library_id = ensure_unique_library_id(
                    conn,
                    normalize_library_id(title),
                    reserved_ids
                )

            cursor.execute('SELECT 1 FROM libraries WHERE id = ?', (target_library_id,))
            exists = cursor.fetchone() is not None
            if exists:
                if not replace_existing:
                    raise ValueError(f'题集 ID 已存在: {target_library_id}，请修改 JSON 或开启覆盖导入')
                cursor.execute(
                    'UPDATE libraries SET title = ?, icon = ?, description = ?, is_public = ? WHERE id = ?',
                    (title, icon, description, is_public, target_library_id)
                )
                cursor.execute('DELETE FROM user_answers WHERE library_id = ?', (target_library_id,))
                cursor.execute('DELETE FROM questions WHERE library_id = ?', (target_library_id,))
                replaced_count += 1
            else:
                cursor.execute(
                    'INSERT INTO libraries (id, title, icon, description, is_public) VALUES (?, ?, ?, ?, ?)',
                    (target_library_id, title, icon, description, is_public)
                )

            reserved_ids.add(target_library_id)
            imported_library_ids.append(target_library_id)

            question_rows = []
            for question_index, raw_question in enumerate(questions, start=1):
                if not isinstance(raw_question, dict):
                    raise ValueError(f'题集「{title}」第 {question_index} 题格式错误，必须是对象')
                try:
                    parsed_question = parse_question_payload(
                        raw_question,
                        allow_empty_answer=allow_empty_answer
                    )
                except ValueError as exc:
                    raise ValueError(f'题集「{title}」第 {question_index} 题: {exc}')

                question_rows.append((
                    parsed_question['question'], parsed_question['type'], parsed_question['options'],
                    parsed_question['answer'], parsed_question['analysis'],
                    parsed_question['difficulty'], parsed_question['chapter'], target_library_id
                ))

            if question_rows:
                cursor.executemany('''
                    INSERT INTO questions (
                        question, type, options, answer, analysis,
                        difficulty, chapter, library_id, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                ''', question_rows)
                imported_question_count += len(question_rows)

        conn.commit()
        invalidate_public_library_cache()
    except ValueError as exc:
        conn.rollback()
        conn.close()
        return jsonify({'error': str(exc)}), 400
    except Exception as exc:
        conn.rollback()
        conn.close()
        return jsonify({'error': f'导入失败: {exc}'}), 500

    conn.close()

    # 将 JSON 导入记录同步到“采集列表”，便于追溯来自第三方采集器（如 OCS）的题目导入
    first_library = raw_libraries[0] if raw_libraries and isinstance(raw_libraries[0], dict) else {}
    save_collector_record(
        source_filename=uploaded_file.filename or 'import.json',
        source_size=len(raw_content),
        library_title=str(first_library.get('title') or ''),
        library_id=str(first_library.get('id') or ''),
        library_count=len(imported_library_ids),
        question_count=imported_question_count,
        payload={'libraries': raw_libraries}
    )

    return jsonify({
        'message': '导入成功',
        'library_count': len(imported_library_ids),
        'question_count': imported_question_count,
        'replaced_count': replaced_count,
        'library_ids': imported_library_ids
    })

@app.route('/api/admin/export-json', methods=['GET'])
@require_admin_auth
def admin_export_libraries_as_json():
    selected_library_ids = [str(item or '').strip() for item in request.args.getlist('library_id') if str(item or '').strip()]
    raw_library_ids = str(request.args.get('library_ids') or '').strip()
    if raw_library_ids:
        selected_library_ids.extend([
            part.strip()
            for part in re.split(r'[,\s]+', raw_library_ids)
            if part.strip()
        ])
    dedup_library_ids = []
    for lib_id in selected_library_ids:
        if lib_id == '__all__':
            dedup_library_ids = []
            break
        if lib_id not in dedup_library_ids:
            dedup_library_ids.append(lib_id)
    selected_library_ids = dedup_library_ids

    conn = get_db_connection()
    cursor = conn.cursor()

    if selected_library_ids:
        placeholders = ','.join('?' for _ in selected_library_ids)
        cursor.execute(f'SELECT * FROM libraries WHERE id IN ({placeholders})', selected_library_ids)
        rows = cursor.fetchall()
        row_map = {row['id']: row for row in rows}
        missing_ids = [lib_id for lib_id in selected_library_ids if lib_id not in row_map]
        if missing_ids:
            conn.close()
            return jsonify({'error': f'题集不存在: {",".join(missing_ids)}'}), 404
        libraries = [row_map[lib_id] for lib_id in selected_library_ids]
    else:
        cursor.execute('SELECT * FROM libraries ORDER BY id')
        libraries = cursor.fetchall()

    export_libraries = []
    question_count = 0
    for lib in libraries:
        cursor.execute('SELECT * FROM questions WHERE library_id = ? ORDER BY id', (lib['id'],))
        questions = [serialize_question_for_export(row) for row in cursor.fetchall()]
        question_count += len(questions)
        export_libraries.append({
            'id': lib['id'],
            'title': lib['title'],
            'icon': lib['icon'],
            'description': lib['description'] if 'description' in lib.keys() else '',
            'is_public': parse_db_bool(lib['is_public'], True) if 'is_public' in lib.keys() else True,
            'questions': questions
        })

    conn.close()

    payload = {
        'exported_at': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'library_count': len(export_libraries),
        'question_count': question_count,
        'libraries': export_libraries
    }

    if not selected_library_ids:
        filename_scope = 'all'
    elif len(selected_library_ids) == 1:
        filename_scope = selected_library_ids[0]
    else:
        filename_scope = f'selected-{len(selected_library_ids)}'
    filename = f'quiz-export-{filename_scope}.json'
    content = json.dumps(payload, ensure_ascii=False, indent=2)
    return Response(
        content,
        mimetype='application/json; charset=utf-8',
        headers={'Content-Disposition': f'attachment; filename=\"{filename}\"'}
    )

@app.route('/api/admin/ai-settings', methods=['GET'])
@require_admin_auth
def admin_get_ai_settings():
    settings = load_ai_settings()
    merged = sanitize_ai_settings({}, settings)
    api_key = merged.get('api_key', '')
    return jsonify({
        'provider': merged.get('provider', AI_DEFAULT_SETTINGS['provider']),
        'base_url': merged.get('base_url', AI_DEFAULT_SETTINGS['base_url']),
        'model': merged.get('model', AI_DEFAULT_SETTINGS['model']),
        'endpoint_path': merged.get('endpoint_path', AI_DEFAULT_SETTINGS['endpoint_path']),
        'collector_push_enabled': bool(merged.get('collector_push_enabled', AI_DEFAULT_SETTINGS['collector_push_enabled'])),
        'collector_push_token': str(merged.get('collector_push_token') or ''),
        'has_api_key': bool(api_key),
        'api_key_mask': mask_api_key(api_key)
    })

@app.route('/api/admin/ai-settings', methods=['POST'])
@require_admin_auth
def admin_save_ai_settings():
    payload = request.get_json(silent=True) or {}
    existing = load_ai_settings()
    settings = sanitize_ai_settings(payload, existing)
    save_ai_settings(settings)
    return jsonify({
        'message': 'AI 设置已保存',
        'provider': settings.get('provider'),
        'base_url': settings.get('base_url'),
        'model': settings.get('model'),
        'endpoint_path': settings.get('endpoint_path'),
        'collector_push_enabled': bool(settings.get('collector_push_enabled', AI_DEFAULT_SETTINGS['collector_push_enabled'])),
        'collector_push_token': str(settings.get('collector_push_token') or ''),
        'has_api_key': bool(settings.get('api_key')),
        'api_key_mask': mask_api_key(settings.get('api_key', ''))
    })

@app.route('/api/admin/ai-test', methods=['POST'])
@require_admin_auth
def admin_test_ai_connection():
    payload = request.get_json(silent=True) or {}
    existing = load_ai_settings()
    settings = sanitize_ai_settings(payload, existing)

    if not settings.get('api_key'):
        return jsonify({'error': '请先填写 API Key'}), 400
    if not settings.get('base_url') and not settings.get('endpoint_path'):
        return jsonify({'error': '请先填写 Base URL 或 Endpoint Path'}), 400
    if settings.get('provider') != 'openai_compatible':
        return jsonify({'error': '当前仅支持 openai_compatible 提供商'}), 400

    test_prompt = 'Return strict JSON: {"ok": true}'
    start = time.time()
    try:
        ai_text = call_openai_compatible_chat(settings, test_prompt)
    except RuntimeError as exc:
        return jsonify({'error': str(exc)}), 500
    except Exception as exc:
        return jsonify({'error': f'连接测试失败: {exc}'}), 500
    latency_ms = int((time.time() - start) * 1000)
    snippet = (ai_text or '').strip().replace('\n', ' ')[:200]
    return jsonify({
        'message': '连接成功',
        'latency_ms': latency_ms,
        'sample': snippet
    })

@app.route('/api/admin/ai-generate', methods=['POST'])
@require_admin_auth
def admin_ai_generate_fields():
    payload = request.get_json(silent=True) or {}
    question_text = str(payload.get('question') or '').strip()
    question_type = str(payload.get('type') or 'single').strip().lower()
    options = payload.get('options') or []
    if isinstance(options, str):
        options = [line.strip() for line in options.splitlines() if line.strip()]
    if not isinstance(options, list):
        options = []

    if not question_text:
        return jsonify({'error': '题目不能为空'}), 400

    settings = sanitize_ai_settings({}, load_ai_settings())
    if not settings.get('api_key'):
        return jsonify({'error': '请先在设置中填写 AI API Key'}), 400
    if not settings.get('base_url') and not settings.get('endpoint_path'):
        return jsonify({'error': '请先在设置中填写 Base URL 或 Endpoint Path'}), 400
    if settings.get('provider') != 'openai_compatible':
        return jsonify({'error': '当前仅支持 openai_compatible 提供商'}), 400

    prompt = build_ai_generate_prompt(question_text, question_type, options)
    try:
        ai_text = call_openai_compatible_chat(settings, prompt)
        result = extract_json_payload(ai_text)
        if not isinstance(result, dict):
            raise ValueError('AI 返回格式错误')
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    except RuntimeError as exc:
        return jsonify({'error': str(exc)}), 500
    except Exception as exc:
        return jsonify({'error': f'AI 生成失败: {exc}'}), 500

    answer = str(result.get('answer') or '').strip()
    analysis = str(result.get('analysis') or '').strip()
    chapter = str(result.get('chapter') or '').strip()
    return jsonify({
        'answer': answer,
        'analysis': analysis,
        'chapter': chapter
    })

@app.route('/api/admin/ai-generate-batch', methods=['POST'])
@require_admin_auth
def admin_ai_generate_batch():
    payload = request.get_json(silent=True) or {}
    items = payload.get('items') or []
    if not isinstance(items, list) or not items:
        return jsonify({'error': 'items 不能为空'}), 400
    if len(items) > 30:
        return jsonify({'error': 'items 数量过多，请分批（<=30）'}), 400

    normalized_items = []
    for item in items:
        if not isinstance(item, dict):
            continue
        question_text = str(item.get('question') or '').strip()
        if not question_text:
            normalized_items.append({'question': '', 'type': 'single', 'options': []})
            continue
        question_type = str(item.get('type') or 'single').strip().lower()
        options = item.get('options') or []
        if isinstance(options, str):
            options = [line.strip() for line in options.splitlines() if line.strip()]
        if not isinstance(options, list):
            options = []
        normalized_items.append({
            'question': question_text,
            'type': question_type,
            'options': options
        })

    settings = sanitize_ai_settings({}, load_ai_settings())
    if not settings.get('api_key'):
        return jsonify({'error': '请先在设置中填写 AI API Key'}), 400
    if not settings.get('base_url') and not settings.get('endpoint_path'):
        return jsonify({'error': '请先在设置中填写 Base URL 或 Endpoint Path'}), 400
    if settings.get('provider') != 'openai_compatible':
        return jsonify({'error': '当前仅支持 openai_compatible 提供商'}), 400

    prompt = build_ai_generate_batch_prompt(normalized_items)
    try:
        ai_text = call_openai_compatible_chat(settings, prompt)
        result = extract_json_payload(ai_text)
        if not isinstance(result, dict) or not isinstance(result.get('items'), list):
            raise ValueError('AI 返回格式错误')
        result_items = result.get('items') or []
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    except RuntimeError as exc:
        return jsonify({'error': str(exc)}), 500
    except Exception as exc:
        return jsonify({'error': f'AI 生成失败: {exc}'}), 500

    # 兜底对齐长度
    if len(result_items) < len(normalized_items):
        result_items.extend([{} for _ in range(len(normalized_items) - len(result_items))])
    if len(result_items) > len(normalized_items):
        result_items = result_items[:len(normalized_items)]

    cleaned = []
    for item in result_items:
        if not isinstance(item, dict):
            cleaned.append({'answer': '', 'analysis': '', 'chapter': ''})
            continue
        cleaned.append({
            'answer': str(item.get('answer') or '').strip(),
            'analysis': str(item.get('analysis') or '').strip(),
            'chapter': str(item.get('chapter') or '').strip()
        })

    return jsonify({'items': cleaned})

@app.route('/api/admin/ai-collect', methods=['POST'])
@require_admin_auth
def admin_ai_collect_from_file():
    uploaded_file = request.files.get('file')
    source_filename = ''
    raw_content = b''
    source_text = ''

    if uploaded_file and uploaded_file.filename:
        raw_content = uploaded_file.read()
        if not raw_content:
            return jsonify({'error': '上传文件为空'}), 400
        if len(raw_content) > 400_000:
            return jsonify({'error': '文件过大，请控制在 400KB 以内'}), 400
        try:
            source_text = raw_content.decode('utf-8-sig')
        except UnicodeDecodeError:
            return jsonify({'error': '文件编码不支持，请使用 UTF-8'}), 400
        source_filename = uploaded_file.filename or 'upload.txt'
    else:
        source_text = str(request.form.get('source_text') or '')
        if not source_text.strip():
            return jsonify({'error': '请上传题目文件或粘贴题目文本'}), 400
        raw_content = source_text.encode('utf-8')
        if len(raw_content) > 400_000:
            return jsonify({'error': '文本过大，请控制在 400KB 以内'}), 400
        source_filename = 'pasted-text.txt'

    settings = sanitize_ai_settings({}, load_ai_settings())
    if not settings.get('api_key'):
        return jsonify({'error': '请先在设置中填写 AI API Key'}), 400

    provider = settings.get('provider', AI_DEFAULT_SETTINGS['provider'])
    if not settings.get('base_url') and not settings.get('endpoint_path'):
        return jsonify({'error': '请先在设置中填写 Base URL 或 Endpoint Path'}), 400
    library_title = (request.form.get('library_title') or '').strip()
    library_id = normalize_library_id(request.form.get('library_id'))

    if provider != 'openai_compatible':
        return jsonify({'error': '当前仅支持 openai_compatible 提供商'}), 400

    prompt = build_ai_collect_prompt(source_text, library_title or 'AI 采集题库', library_id or '')

    try:
        ai_text = call_openai_compatible_chat(settings, prompt, request_timeout=180)
        payload = extract_json_payload(ai_text)
        libraries = extract_import_libraries(payload)
        if isinstance(payload, list) or (isinstance(payload, dict) and 'libraries' not in payload):
            payload = {'libraries': libraries}
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    except RuntimeError as exc:
        return jsonify({'error': str(exc)}), 500
    except Exception as exc:
        return jsonify({'error': f'AI 解析失败: {exc}'}), 500

    question_count = count_questions_in_libraries(libraries)

    record_id = save_collector_record(
        source_filename=source_filename,
        source_size=len(raw_content),
        library_title=library_title or 'AI 采集题库',
        library_id=library_id or '',
        library_count=len(libraries),
        question_count=question_count,
        payload=payload
    )

    return jsonify({
        'message': 'AI 识别完成',
        'library_count': len(libraries),
        'question_count': question_count,
        'payload': payload,
        'record_id': record_id
    })

@app.route('/api/admin/collector-records', methods=['GET'])
@require_admin_auth
def admin_get_collector_records():
    try:
        limit = int(request.args.get('limit', 50))
    except (TypeError, ValueError):
        limit = 50
    limit = max(1, min(limit, 200))

    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('''
        SELECT id, source_filename, source_size, library_title, library_id,
               library_count, question_count, payload, created_at
        FROM collector_records
        ORDER BY id DESC
        LIMIT ?
    ''', (limit,))
    rows = cursor.fetchall()
    conn.close()

    records = []
    questions = []
    seq = 1

    def _normalize_options_text(raw_options):
        if isinstance(raw_options, list):
            return '\n'.join([str(item).strip() for item in raw_options if str(item).strip()])
        if isinstance(raw_options, str):
            return raw_options.strip()
        return ''

    def _normalize_answer_text(raw_answer):
        if isinstance(raw_answer, list):
            return ','.join([str(item).strip() for item in raw_answer if str(item).strip()])
        if raw_answer is None:
            return ''
        return str(raw_answer).strip()

    def _append_question(record_id, created_at, item, fallback_type='single'):
        nonlocal seq
        if not isinstance(item, dict):
            return
        question_text = str(item.get('question') or item.get('q') or '').strip()
        answer_text = _normalize_answer_text(item.get('answer', item.get('ans')))
        options_text = _normalize_options_text(item.get('options'))
        question_type = normalize_question_type(item.get('type') or fallback_type)
        if not question_text and not answer_text and not options_text:
            return
        questions.append({
            'seq': seq,
            'record_id': record_id,
            'type': question_type,
            'question': question_text,
            'options': options_text,
            'answer': answer_text,
            'created_at': created_at
        })
        seq += 1

    for row in rows:
        row_get = row.get if hasattr(row, 'get') else lambda key, default='': row[key] if key in row.keys() else default
        record_id = row_get('id', '')
        created_at = row_get('created_at', '')
        records.append({
            'id': record_id,
            'source_filename': row_get('source_filename', ''),
            'source_size': row_get('source_size', 0),
            'library_title': row_get('library_title', ''),
            'library_id': row_get('library_id', ''),
            'library_count': row_get('library_count', 0),
            'question_count': row_get('question_count', 0),
            'created_at': created_at
        })

        payload_raw = row_get('payload', '')
        payload_obj = None
        if isinstance(payload_raw, (dict, list)):
            payload_obj = payload_raw
        else:
            try:
                payload_obj = json.loads(str(payload_raw or '').strip() or '{}')
            except json.JSONDecodeError:
                payload_obj = None

        before_count = len(questions)
        libraries = []
        if isinstance(payload_obj, dict) and isinstance(payload_obj.get('libraries'), list):
            libraries = payload_obj.get('libraries') or []
        elif isinstance(payload_obj, list):
            libraries = payload_obj

        for lib in libraries:
            if not isinstance(lib, dict):
                continue
            for item in (lib.get('questions') or []):
                _append_question(record_id, created_at, item)

        if len(questions) == before_count and isinstance(payload_obj, dict):
            # 兜底：兼容未封装为 libraries 的推送结构
            guessed = {
                'question': payload_obj.get('question') or payload_obj.get('title') or '',
                'type': payload_obj.get('type') or 'single',
                'options': payload_obj.get('options') or '',
                'answer': (
                    payload_obj.get('answer')
                    if payload_obj.get('answer') is not None
                    else (
                        payload_obj.get('data', {}).get('data')
                        if isinstance(payload_obj.get('data'), dict)
                        else ''
                    )
                )
            }
            _append_question(record_id, created_at, guessed, guessed.get('type') or 'single')

    return jsonify({'records': records, 'questions': questions, 'count': len(records), 'question_count': len(questions)})

@app.route('/api/admin/collector-records/<int:record_id>', methods=['DELETE'])
@require_admin_auth
def admin_delete_collector_record(record_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT 1 FROM collector_records WHERE id = ?', (record_id,))
    if not cursor.fetchone():
        conn.close()
        return jsonify({'error': '采集记录不存在'}), 404
    cursor.execute('DELETE FROM collector_records WHERE id = ?', (record_id,))
    conn.commit()
    conn.close()
    return jsonify({'message': '采集记录已删除'})

@app.route('/api/admin/collector-records/clear', methods=['DELETE'])
@require_admin_auth
def admin_clear_collector_records():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT COUNT(*) AS total FROM collector_records')
    row = cursor.fetchone()
    total = int((row['total'] if row else 0) or 0)
    if total > 0:
        cursor.execute('DELETE FROM collector_records')
        conn.commit()
    conn.close()
    return jsonify({'message': f'已清空 {total} 条采集记录', 'deleted_count': total})

@app.route('/api/admin/query', methods=['POST'])
def admin_push_collector_record():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({'error': '请求体必须是 JSON 对象'}), 400

    runtime_settings = sanitize_ai_settings({}, load_ai_settings())
    collector_push_enabled = bool(runtime_settings.get('collector_push_enabled', AI_DEFAULT_SETTINGS['collector_push_enabled']))
    collector_push_token = str(runtime_settings.get('collector_push_token') or '').strip()

    token = (
        request.headers.get('X-Collector-Token')
        or request.headers.get('x-collector-token')
        or request.args.get('token')
        or request.form.get('token')
        or data.get('token')
        or ''
    )
    auth_header = request.headers.get('Authorization', '')
    if not token and isinstance(auth_header, str) and auth_header.lower().startswith('bearer '):
        token = auth_header[7:].strip()

    if not collector_push_enabled and not is_admin_authenticated():
        return jsonify({'error': '采集推送已关闭'}), 403

    # 管理员登录态可直接推送；若配置了 COLLECTOR_PUSH_TOKEN，则要求携带令牌
    if not is_admin_authenticated() and collector_push_token and str(token).strip() != collector_push_token:
        return jsonify({'error': '无权限推送采集记录，请检查 token'}), 401

    raw_payload = data.get('payload')
    if raw_payload is None:
        if isinstance(data.get('libraries'), list):
            raw_payload = {'libraries': data.get('libraries')}
        elif isinstance(data.get('data'), (dict, list)):
            raw_payload = data.get('data')
        else:
            raw_payload = data

    def _to_int(value, default=0):
        try:
            return int(value)
        except (TypeError, ValueError):
            return default

    def _extract_question_from_item(item, fallback_type='single'):
        if not isinstance(item, dict):
            return None
        question = str(item.get('question') or item.get('q') or item.get('title') or '').strip()
        answer = str(item.get('answer') if item.get('answer') is not None else item.get('ans') or '').strip()
        q_type = normalize_question_type(item.get('type') or fallback_type or 'single')
        options = parse_options_for_lookup(item.get('options'))
        if not question and not answer and not options:
            return None
        return {
            'question': question,
            'answer': answer,
            'type': q_type,
            'options': options
        }

    # 解析推送中的题目
    payload_libraries = []
    if isinstance(raw_payload, dict) and isinstance(raw_payload.get('libraries'), list):
        payload_libraries = raw_payload.get('libraries') or []
    elif isinstance(raw_payload, list):
        payload_libraries = raw_payload

    extracted_questions = []
    if payload_libraries:
        for lib in payload_libraries:
            if not isinstance(lib, dict):
                continue
            for item in (lib.get('questions') or []):
                parsed = _extract_question_from_item(item, item.get('type') if isinstance(item, dict) else 'single')
                if not parsed:
                    continue
                parsed['ref'] = item if isinstance(item, dict) else None
                extracted_questions.append(parsed)
    elif isinstance(raw_payload, dict):
        parsed = _extract_question_from_item(raw_payload, raw_payload.get('type') if isinstance(raw_payload, dict) else 'single')
        if parsed:
            parsed['ref'] = raw_payload
            extracted_questions.append(parsed)

    # 兜底：兼容直接推 title/options/type 的请求
    if not extracted_questions:
        fallback_item = {
            'question': data.get('title') or data.get('question') or '',
            'type': data.get('type') or 'single',
            'options': data.get('options') or '',
            'answer': data.get('answer') or ''
        }
        parsed = _extract_question_from_item(fallback_item, fallback_item.get('type') or 'single')
        if parsed:
            parsed['ref'] = None
            extracted_questions.append(parsed)

    # 按“题库优先，AI 兜底”解析答案
    resolved_questions = []
    ai_error = ''
    for item in extracted_questions:
        question = item.get('question', '')
        q_type = item.get('type', 'single')
        options = item.get('options') or []
        answer = str(item.get('answer') or '').strip()
        source = 'payload' if answer else ''

        if not answer:
            answer = find_answer_from_question_bank(question, q_type)
            if answer:
                source = 'bank'

        if not answer:
            answer = find_answer_from_collector_records(question, q_type)
            if answer:
                source = 'collector'

        if not answer:
            try:
                answer = generate_answer_by_ai(question, q_type, options)
            except Exception as exc:
                ai_error = str(exc)
                answer = ''
            if answer:
                source = 'ai'

        ref = item.get('ref')
        if answer and isinstance(ref, dict):
            if ref.get('answer') is None and ref.get('ans') is None:
                ref['answer'] = answer
            elif str(ref.get('answer') if ref.get('answer') is not None else ref.get('ans') or '').strip() == '':
                ref['answer'] = answer

        resolved_questions.append({
            'question': question,
            'type': q_type,
            'options': options,
            'answer': answer,
            'source': source or ('none' if question else '')
        })

    # 若 payload 不包含 libraries，构造统一结构以便采集列表展示
    payload_for_save = raw_payload
    libraries_for_save = payload_libraries
    if not libraries_for_save and resolved_questions:
        auto_library_id = normalize_library_id(data.get('library_id') or 'ocs-push') or 'ocs-push'
        auto_library_title = str(data.get('library_title') or 'OCS 采集').strip() or 'OCS 采集'
        libraries_for_save = [{
            'id': auto_library_id,
            'title': auto_library_title,
            'questions': [
                {
                    'question': q.get('question', ''),
                    'type': q.get('type', 'single'),
                    'options': q.get('options', []),
                    'answer': q.get('answer', '')
                }
                for q in resolved_questions
            ]
        }]
        payload_for_save = {
            'source': raw_payload,
            'libraries': libraries_for_save
        }

    first_library = libraries_for_save[0] if libraries_for_save and isinstance(libraries_for_save[0], dict) else {}
    inferred_library_count = len(libraries_for_save) if libraries_for_save else (1 if resolved_questions else 0)
    inferred_question_count = count_questions_in_libraries(libraries_for_save) if libraries_for_save else len(resolved_questions)
    try:
        inferred_payload_size = len(json.dumps(payload_for_save, ensure_ascii=False).encode('utf-8'))
    except Exception:
        inferred_payload_size = 0

    source_filename = str(
        data.get('source_filename')
        or data.get('filename')
        or data.get('source')
        or 'ocs-push.json'
    ).strip() or 'ocs-push.json'
    library_title = str(
        data.get('library_title')
        or first_library.get('title')
        or 'OCS 采集'
    ).strip()
    library_id = str(
        data.get('library_id')
        or first_library.get('id')
        or ''
    ).strip()
    source_size = max(0, _to_int(data.get('source_size'), inferred_payload_size))
    library_count = max(0, _to_int(data.get('library_count'), inferred_library_count))
    question_count = max(0, _to_int(data.get('question_count'), inferred_question_count))

    merge_result = {'merged_count': 0, 'updated_count': 0, 'library_ids': []}
    merge_error = ''
    try:
        merge_result = upsert_collector_libraries_into_question_bank(
            libraries_for_save,
            fallback_library_id=normalize_library_id(library_id or 'collector-history') or 'collector-history',
            fallback_library_title=library_title or '采集历史题库'
        )
    except Exception as exc:
        merge_error = str(exc)

    record_id = save_collector_record(
        source_filename=source_filename,
        source_size=source_size,
        library_title=library_title,
        library_id=library_id,
        library_count=library_count,
        question_count=question_count,
        payload=payload_for_save
    )
    if not record_id:
        return jsonify({'error': '采集记录保存失败'}), 500

    primary = None
    for item in resolved_questions:
        if item.get('answer'):
            primary = item
            break
    if not primary and resolved_questions:
        primary = resolved_questions[0]
    primary_answer = str(primary.get('answer') or '').strip() if primary else ''

    return jsonify({
        'message': '采集记录已写入',
        'record_id': record_id,
        'library_count': library_count,
        'question_count': question_count,
        'collector_push_enabled': collector_push_enabled,
        'token_required': bool(collector_push_token),
        'code': 1 if primary_answer else 0,
        'data': primary_answer,
        'answer': primary_answer,
        'source': primary.get('source') if primary else '',
        'results': resolved_questions,
        'ai_error': ai_error,
        'merged_count': int(merge_result.get('merged_count') or 0),
        'updated_count': int(merge_result.get('updated_count') or 0),
        'merged_library_ids': merge_result.get('library_ids') or [],
        'merge_error': merge_error
    })

@app.route('/api/admin/session', methods=['GET'])
def admin_session_status():
    if not is_admin_authenticated():
        return jsonify({'authenticated': False})
    return jsonify({'authenticated': True, 'username': session.get('admin_user', ADMIN_USERNAME)})

@app.route('/api/admin/login', methods=['POST'])
def admin_login():
    data = request.get_json(silent=True) or {}
    username = str(data.get('username', '')).strip()
    password = str(data.get('password', ''))

    if username == ADMIN_USERNAME and password == ADMIN_PASSWORD:
        session['is_admin'] = True
        session['admin_user'] = username
        return jsonify({'message': '登录成功', 'username': username})

    return jsonify({'error': '账号或密码错误'}), 401

@app.route('/api/admin/logout', methods=['POST'])
def admin_logout():
    session.pop('is_admin', None)
    session.pop('admin_user', None)
    return jsonify({'message': '已退出登录'})

# 启用CORS
@app.after_request
def after_request(response):
    response.headers.add('Access-Control-Allow-Origin', '*')
    response.headers.add('Access-Control-Allow-Headers', 'Content-Type,Authorization')
    response.headers.add('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS')
    return response

if __name__ == '__main__':
    app.run(host='127.0.0.1', port=5000, threaded=True, use_reloader=False)
