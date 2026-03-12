import sqlite3

# 连接到SQLite数据库
conn = sqlite3.connect('quiz.db')
cursor = conn.cursor()

# 删除旧表
cursor.execute('DROP TABLE IF EXISTS user_answers')
cursor.execute('DROP TABLE IF EXISTS options')
cursor.execute('DROP TABLE IF EXISTS questions')
cursor.execute('DROP TABLE IF EXISTS libraries')

# 创建题库表
cursor.execute('''
CREATE TABLE IF NOT EXISTS libraries (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    icon TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT ''
)
''')

# 创建题目表（符合新的字段类型说明）
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
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (library_id) REFERENCES libraries (id)
)
''')

# 创建用户答题记录表
cursor.execute('''
CREATE TABLE IF NOT EXISTS user_answers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    library_id TEXT NOT NULL,
    question_id INTEGER NOT NULL,
    user_answer TEXT,
    is_correct INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (library_id) REFERENCES libraries (id),
    FOREIGN KEY (question_id) REFERENCES questions (id)
)
''')

# 插入示例题库
cursor.execute('''
INSERT OR IGNORE INTO libraries (id, title, icon, description)
VALUES ('demo', '全端适配测试题库', '📱', '覆盖移动端适配、Flex 布局、HTML/CSS/JavaScript 基础知识点。')
''')

# 插入示例题目（符合新的字段结构）
questions = [
    (1, '[Q1] 在移动端开发中，\'viewport-fit=cover\' 属性的作用是什么？', 
     'single', '["优化刘海屏安全区域适配","提高页面滑动流畅度","自动压缩页面图片","强制横屏显示"]', 
     '0', '该属性是专门为 iPhone 刘海屏等异形屏设计的，通过设置 cover 可以让网页内容填充整个屏幕。', 
     1, '移动端适配', 'demo'),
    
    (2, '[Q2] 以下哪个是 CSS Flexbox 的容器属性？', 
     'single', '["flex-direction","display: flex","justify-content","align-items"]', 
     '1', 'display: flex 是设置容器为 Flexbox 布局的基本属性。', 
     1, 'CSS布局', 'demo'),
    
    (3, '[Q3] JavaScript 中，哪个方法用于添加事件监听器？', 
     'single', '["onclick","addEvent","addEventListener","attachEvent"]', 
     '2', 'addEventListener 是标准的事件监听方法。', 
     1, '事件处理', 'demo'),
    
    (4, '[Q4] HTML5 中，哪个标签用于定义文档的主要内容？', 
     'single', '["section","article","content","main"]', 
     '3', 'main 标签用于定义文档的主要内容区域。', 
     1, 'HTML5语义化', 'demo'),
    
    (5, '[Q5] CSS 中，哪个属性用于设置元素的外边距？', 
     'single', '["margin","padding","border","spacing"]', 
     '0', 'margin 属性用于设置元素的外边距。', 
     1, 'CSS盒模型', 'demo'),
    
    (6, '[Q6] JavaScript 中，哪个方法用于将字符串转换为整数？', 
     'single', '["toInt","parseInt","Number","parseFloat"]', 
     '1', 'parseInt 方法用于将字符串转换为整数。', 
     1, '数据类型转换', 'demo'),
    
    (7, '[Q7] HTML 中，哪个属性用于指定元素的唯一标识符？', 
     'single', '["class","name","id","value"]', 
     '2', 'id 属性用于为元素指定唯一标识符。', 
     1, 'HTML属性', 'demo'),
    
    (8, '[Q8] CSS 中，哪个选择器用于选择类名为 "example" 的元素？', 
     'single', '["#example","example","!example",".example"]', 
     '3', '.example 是类选择器的语法。', 
     1, 'CSS选择器', 'demo'),
    
    (9, '[Q9] JavaScript 中，哪个关键字用于声明变量？', 
     'single', '["let","var","const","int"]', 
     '0', 'let 是 ES6 中引入的变量声明关键字。', 
     1, 'JavaScript语法', 'demo'),
    
    (10, '[Q10] HTML5 中，哪个标签用于定义导航链接？', 
     'single', '["link","nav","menu","navigation"]', 
     '1', 'nav 标签用于定义导航链接区域。', 
     1, 'HTML5语义化', 'demo'),
    
    (11, '[Q11] CSS 中，哪个属性用于设置元素的背景颜色？', 
     'single', '["color","text-color","background-color","bg-color"]', 
     '2', 'background-color 属性用于设置元素的背景颜色。', 
     1, 'CSS样式', 'demo'),
    
    (12, '[Q12] JavaScript 中，哪个方法用于数组排序？', 
     'single', '["order","arrange","sort","organize"]', 
     '2', 'sort 方法用于对数组进行排序。', 
     1, '数组方法', 'demo'),
    
    (13, '[Q13] HTML 中，哪个标签用于定义表格行？', 
     'single', '["tr","td","th","row"]', 
     '0', 'tr 标签用于定义表格行。', 
     1, 'HTML表格', 'demo'),
    
    (14, '[Q14] CSS 中，哪个单位是相对于父元素字体大小的？', 
     'single', '["px","em","rem","%"]', 
     '1', 'em 单位是相对于父元素字体大小的。', 
     1, 'CSS单位', 'demo'),
    
    (15, '[Q15] JavaScript 中，哪个方法用于获取元素？', 
     'single', '["querySelector","findElement","getElementById","selectElement"]', 
     '2', 'getElementById 方法用于通过 ID 获取元素。', 
     1, 'DOM操作', 'demo')
]

cursor.executemany('''
INSERT OR IGNORE INTO questions (id, question, type, options, answer, analysis, difficulty, chapter, library_id)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
''', questions)

# 提交事务
conn.commit()

# 关闭连接
conn.close()

print('数据库初始化完成！')
