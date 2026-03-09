from flask import Flask, jsonify, request, session, redirect, render_template, Response
import sqlite3
import json
import os
import re
import uuid
from datetime import datetime, timezone
from functools import wraps

app = Flask(__name__)
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, 'quiz.db')
app.secret_key = os.environ.get('FLASK_SECRET_KEY', 'change-this-secret-key')
ADMIN_USERNAME = os.environ.get('ADMIN_USERNAME', 'admin')
ADMIN_PASSWORD = os.environ.get('ADMIN_PASSWORD', 'admin123')
SCHEMA_INITIALIZED = False

# 数据库连接函数
def get_db_connection():
    global SCHEMA_INITIALIZED
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    if not SCHEMA_INITIALIZED:
        ensure_schema(conn)
        SCHEMA_INITIALIZED = True
    return conn

def ensure_schema(conn):
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

    cursor.execute("PRAGMA table_info(questions)")
    question_columns = [row[1] for row in cursor.fetchall()]
    if 'subject' in question_columns:
        # 迁移 questions 表，移除 subject 字段
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
                knowledge_point TEXT NOT NULL DEFAULT '',
                library_id TEXT NOT NULL,
                FOREIGN KEY (library_id) REFERENCES libraries (id)
            )
        ''')
        cursor.execute('''
            INSERT INTO questions_new (
                id, question, type, options, answer, analysis, difficulty, knowledge_point, library_id
            )
            SELECT id, question, type, options, answer, analysis, difficulty, knowledge_point, library_id
            FROM questions
        ''')
        cursor.execute('DROP TABLE questions')
        cursor.execute('ALTER TABLE questions_new RENAME TO questions')
        cursor.execute("PRAGMA foreign_keys=ON")
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
    '多选': 'multiple'
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

    indices = sorted({
        parse_option_index(token, option_count)
        for token in tokens
        if str(token).strip() != ''
    })
    if not indices:
        raise ValueError('多选答案不能为空')
    return indices

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

    return {
        'id': question_row['id'],
        'q': question_row['question'],
        'type': question_type,
        'options': options,
        'ans': answer,
        'analysis': question_row['analysis'],
        'difficulty': question_row['difficulty'],
        'knowledge_point': question_row['knowledge_point'],
        'library_id': question_row['library_id']
    }

def serialize_question_for_export(question_row):
    try:
        options = json.loads(question_row['options'])
    except (TypeError, json.JSONDecodeError):
        options = []
    question_type = normalize_question_type(question_row['type'])
    answer_raw = question_row['answer']
    answer = parse_stored_multiple_answer(answer_raw) if question_type == 'multiple' else answer_raw

    return {
        'question': question_row['question'],
        'type': question_type,
        'options': options,
        'answer': answer,
        'analysis': question_row['analysis'],
        'difficulty': question_row['difficulty'],
        'knowledge_point': question_row['knowledge_point']
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
    knowledge_point = (data.get('knowledge_point') or '').strip()
    raw_type = str(data.get('type') or 'single').strip().lower()
    if raw_type in {'fill', 'fill_blank', 'blank', 'text', '填空'}:
        raise ValueError('当前版本不支持填空题，请使用单选题、多选题或判断题')
    question_type = normalize_question_type(raw_type)

    if not question_text:
        raise ValueError('题目内容不能为空')
    if not analysis:
        raise ValueError('解析不能为空')

    raw_answer = data.get('answer', data.get('ans'))
    if question_type == 'judge':
        options = parse_options(data.get('options'), allow_empty=True)
        if not options:
            options = ['正确', '错误']
        if len(options) != 2:
            raise ValueError('判断题必须提供 2 个选项')
    else:
        options = parse_options(data.get('options'))
    if raw_answer is None or str(raw_answer).strip() == '':
        raise ValueError('答案不能为空')
    if question_type == 'multiple':
        indices = parse_multiple_answer(raw_answer, len(options))
        answer = json.dumps(indices, ensure_ascii=False)
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
        'knowledge_point': knowledge_point
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
    except sqlite3.IntegrityError:
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
    fields = []
    values = []

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

    if not fields:
        return jsonify({'error': '没有可更新字段'}), 400

    conn = get_db_connection()
    cursor = conn.cursor()
    values.append(lib_id)
    cursor.execute(f'UPDATE libraries SET {", ".join(fields)} WHERE id = ?', values)
    if cursor.rowcount == 0:
        conn.close()
        return jsonify({'error': 'Library not found'}), 404

    conn.commit()
    result = get_library_with_questions(conn, lib_id)
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
            difficulty, knowledge_point, library_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ''', (
        payload['question'], payload['type'], payload['options'], payload['answer'],
        payload['analysis'], payload['difficulty'], payload['knowledge_point'], lib_id
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
            difficulty = ?, knowledge_point = ?, library_id = ?
        WHERE id = ?
    ''', (
        payload['question'], payload['type'], payload['options'], payload['answer'],
        payload['analysis'], payload['difficulty'], payload['knowledge_point'],
        target_library_id, question_id
    ))
    conn.commit()

    cursor.execute('SELECT * FROM questions WHERE id = ?', (question_id,))
    updated = serialize_question(cursor.fetchone())
    conn.close()
    return jsonify(updated)

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
                        difficulty, knowledge_point, library_id
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ''', (
                    parsed_question['question'], parsed_question['type'], parsed_question['options'],
                    parsed_question['answer'], parsed_question['analysis'],
                    parsed_question['difficulty'], parsed_question['knowledge_point'], target_library_id
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
