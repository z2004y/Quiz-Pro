from flask import Flask, jsonify, request, session, redirect, render_template, Response
import sqlite3
import json
import os
import re
import uuid
from datetime import datetime, timezone
from functools import wraps

try:
    import pymysql
except ImportError:
    pymysql = None

app = Flask(__name__)
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, 'quiz.db')
DB_BACKEND = (os.environ.get('DB_BACKEND') or '').strip().lower()
if not DB_BACKEND:
    DB_BACKEND = 'mysql' if os.environ.get('MYSQL_HOST') else 'sqlite'
if DB_BACKEND not in ('sqlite', 'mysql'):
    raise RuntimeError("DB_BACKEND 仅支持 sqlite 或 mysql")

MYSQL_HOST = os.environ.get('MYSQL_HOST', 'mysql3.sqlpub.com')
MYSQL_DATABASE = os.environ.get('MYSQL_DATABASE', 'z721683736')
MYSQL_USER = os.environ.get('MYSQL_USER', 'z2004y')
MYSQL_PASSWORD = os.environ.get('MYSQL_PASSWORD', '')
try:
    MYSQL_PORT = int(os.environ.get('MYSQL_PORT', '3308'))
except ValueError:
    MYSQL_PORT = 3308

app.secret_key = os.environ.get('FLASK_SECRET_KEY', 'change-this-secret-key')
ADMIN_USERNAME = os.environ.get('ADMIN_USERNAME', 'admin')
ADMIN_PASSWORD = os.environ.get('ADMIN_PASSWORD', 'admin123')
SCHEMA_INITIALIZED = False
DB_INTEGRITY_ERRORS = (sqlite3.IntegrityError,)
if pymysql is not None:
    DB_INTEGRITY_ERRORS = (sqlite3.IntegrityError, pymysql.err.IntegrityError)

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
    def __init__(self, conn):
        self._conn = conn

    def cursor(self, *args, **kwargs):
        return MySQLCursorAdapter(self._conn.cursor(*args, **kwargs))

    def commit(self):
        return self._conn.commit()

    def rollback(self):
        return self._conn.rollback()

    def close(self):
        return self._conn.close()

    def __getattr__(self, item):
        return getattr(self._conn, item)

# 数据库连接函数
def get_db_connection():
    global SCHEMA_INITIALIZED
    if DB_BACKEND == 'mysql':
        if pymysql is None:
            raise RuntimeError('DB_BACKEND=mysql 但未安装 PyMySQL，请先安装依赖')
        conn = MySQLConnectionAdapter(pymysql.connect(
            host=MYSQL_HOST,
            port=MYSQL_PORT,
            user=MYSQL_USER,
            password=MYSQL_PASSWORD,
            database=MYSQL_DATABASE,
            charset='utf8mb4',
            cursorclass=pymysql.cursors.DictCursor,
            autocommit=False
        ))
    else:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row

    if not SCHEMA_INITIALIZED:
        ensure_schema(conn)
        SCHEMA_INITIALIZED = True
    return conn

def ensure_mysql_schema(conn):
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS libraries (
            id VARCHAR(64) PRIMARY KEY,
            title VARCHAR(255) NOT NULL,
            icon VARCHAR(32) NOT NULL,
            description TEXT NOT NULL
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
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='libraries'")
    if not cursor.fetchone():
        return

    cursor.execute("PRAGMA table_info(libraries)")
    columns = {row[1] for row in cursor.fetchall()}
    if 'description' not in columns:
        cursor.execute("ALTER TABLE libraries ADD COLUMN description TEXT NOT NULL DEFAULT ''")
        conn.commit()

    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='questions'")
    if not cursor.fetchone():
        return

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

def parse_options(raw_options, allow_empty=False):
    if isinstance(raw_options, list):
        options = [str(option).strip() for option in raw_options if str(option).strip()]
    elif isinstance(raw_options, str):
        text = raw_options.strip()
        if not text:
            options = []
        else:
            try:
                parsed = json.loads(text)
                if isinstance(parsed, list):
                    options = [str(option).strip() for option in parsed if str(option).strip()]
                else:
                    options = [line.strip() for line in text.splitlines() if line.strip()]
            except json.JSONDecodeError:
                options = [line.strip() for line in text.splitlines() if line.strip()]
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
        'questions': questions
    }

def parse_question_payload(data):
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
    if raw_answer is None or str(raw_answer).strip() == '':
        raise ValueError('答案不能为空')
    if question_type == 'multiple':
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

@app.route('/admin')
def serve_admin():
    if not is_admin_authenticated():
        return redirect('/admin/login')
    return render_template('admin.html')

@app.route('/admin/login')
def serve_admin_login():
    if is_admin_authenticated():
        return redirect('/admin')
    return render_template('admin_login.html')

# 获取题库列表
@app.route('/api/libraries', methods=['GET'])
@app.route('/libraries', methods=['GET'])
def get_libraries():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT * FROM libraries ORDER BY id')
    libraries = cursor.fetchall()
    conn.close()
    
    result = []
    for lib in libraries:
        result.append({
            'id': lib['id'],
            'title': lib['title'],
            'icon': lib['icon'],
            'description': lib['description'] if 'description' in lib.keys() else ''
        })
    
    return jsonify(result)

# 获取题库详情（包含题目和选项）
@app.route('/api/libraries/<lib_id>', methods=['GET'])
@app.route('/libraries/<lib_id>', methods=['GET'])
def get_library_details(lib_id):
    conn = get_db_connection()
    result = get_library_with_questions(conn, lib_id)
    conn.close()

    if not result:
        return jsonify({'error': 'Library not found'}), 404
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
            cursor.execute('''
                INSERT INTO user_answers (library_id, question_id, user_answer, is_correct)
                VALUES (?, ?, ?, ?)
            ''', (library_id, q['id'], serialize_user_answer(user_answer), is_correct))
        
        accuracy = round(correct_count / total_questions * 100) if total_questions > 0 else 0
        score = correct_count
        
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
        SELECT l.id, l.title, l.icon, l.description, COUNT(q.id) AS question_count
        FROM libraries l
        LEFT JOIN questions q ON q.library_id = l.id
        GROUP BY l.id, l.title, l.icon, l.description
        ORDER BY l.id
    ''')
    rows = cursor.fetchall()
    conn.close()

    return jsonify([{
        'id': row['id'],
        'title': row['title'],
        'icon': row['icon'],
        'description': row['description'] if 'description' in row.keys() else '',
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
    lib_id = normalize_library_id(data.get('id'))

    if not title:
        return jsonify({'error': '题集名称不能为空'}), 400

    if not lib_id:
        lib_id = generate_library_id(title)

    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            'INSERT INTO libraries (id, title, icon, description) VALUES (?, ?, ?, ?)',
            (lib_id, title, icon, description)
        )
        conn.commit()
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
    conn.close()

    return jsonify({'message': '题集已删除'})

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

    cursor.execute('SELECT * FROM questions WHERE id = ?', (question_id,))
    question = serialize_question(cursor.fetchone())
    conn.close()

    return jsonify(question), 201

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
    conn.close()

    return jsonify({'updated_count': updated_count, 'copied_count': copied_count})

# 管理后台：删除题目
@app.route('/api/admin/questions/<int:question_id>', methods=['DELETE'])
@require_admin_auth
def admin_delete_question(question_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT 1 FROM questions WHERE id = ?', (question_id,))
    if not cursor.fetchone():
        conn.close()
        return jsonify({'error': 'Question not found'}), 404

    cursor.execute('DELETE FROM user_answers WHERE question_id = ?', (question_id,))
    cursor.execute('DELETE FROM questions WHERE id = ?', (question_id,))
    conn.commit()
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
                    'UPDATE libraries SET title = ?, icon = ?, description = ? WHERE id = ?',
                    (title, icon, description, target_library_id)
                )
                cursor.execute('DELETE FROM user_answers WHERE library_id = ?', (target_library_id,))
                cursor.execute('DELETE FROM questions WHERE library_id = ?', (target_library_id,))
                replaced_count += 1
            else:
                cursor.execute(
                    'INSERT INTO libraries (id, title, icon, description) VALUES (?, ?, ?, ?)',
                    (target_library_id, title, icon, description)
                )

            reserved_ids.add(target_library_id)
            imported_library_ids.append(target_library_id)

            for question_index, raw_question in enumerate(questions, start=1):
                if not isinstance(raw_question, dict):
                    raise ValueError(f'题集「{title}」第 {question_index} 题格式错误，必须是对象')
                try:
                    parsed_question = parse_question_payload(raw_question)
                except ValueError as exc:
                    raise ValueError(f'题集「{title}」第 {question_index} 题: {exc}')

                cursor.execute('''
                    INSERT INTO questions (
                        question, type, options, answer, analysis,
                        difficulty, chapter, library_id, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                ''', (
                    parsed_question['question'], parsed_question['type'], parsed_question['options'],
                    parsed_question['answer'], parsed_question['analysis'],
                    parsed_question['difficulty'], parsed_question['chapter'], target_library_id
                ))
                imported_question_count += 1

        conn.commit()
    except ValueError as exc:
        conn.rollback()
        conn.close()
        return jsonify({'error': str(exc)}), 400
    except Exception as exc:
        conn.rollback()
        conn.close()
        return jsonify({'error': f'导入失败: {exc}'}), 500

    conn.close()
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
    target_library_id = (request.args.get('library_id') or '').strip()
    conn = get_db_connection()
    cursor = conn.cursor()

    if target_library_id:
        cursor.execute('SELECT * FROM libraries WHERE id = ?', (target_library_id,))
    else:
        cursor.execute('SELECT * FROM libraries ORDER BY id')
    libraries = cursor.fetchall()

    if target_library_id and not libraries:
        conn.close()
        return jsonify({'error': f'题集不存在: {target_library_id}'}), 404

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
            'questions': questions
        })

    conn.close()

    payload = {
        'exported_at': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'library_count': len(export_libraries),
        'question_count': question_count,
        'libraries': export_libraries
    }

    filename_scope = target_library_id if target_library_id else 'all'
    filename = f'quiz-export-{filename_scope}.json'
    content = json.dumps(payload, ensure_ascii=False, indent=2)
    return Response(
        content,
        mimetype='application/json; charset=utf-8',
        headers={'Content-Disposition': f'attachment; filename=\"{filename}\"'}
    )

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
