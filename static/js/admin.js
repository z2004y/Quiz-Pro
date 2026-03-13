        const API_BASE = (document.body?.dataset?.adminApiBase || '/api/admin').replace(/\/+$/, '') || '/api/admin';
        const darkModeMedia = window.matchMedia('(prefers-color-scheme: dark)');
        const THEME_STORAGE_KEY = 'quiz_theme_preference';
        const LIBRARY_PANEL_COLLAPSE_KEY = 'quiz_admin_library_panel_collapsed';
        const ADMIN_PAGE_KEY = String(document.body?.dataset?.adminPage || 'question-bank').trim();
        const IMPORT_TAB_IDS = ['json', 'doc', 'single', 'collector'];
        const EXPORT_TAB_IDS = ['json', 'txt'];
        const EXPORT_TXT_FIELDS = ['type', 'question', 'options', 'answer', 'analysis', 'difficulty', 'chapter', 'updated_at'];
        const EXPORT_TXT_DEFAULT_FIELDS = ['type', 'question', 'options', 'answer', 'analysis', 'difficulty', 'chapter'];
        const AI_BATCH_CHUNK_SIZE = 12;
        const EXPORT_TXT_FIELD_LABELS = {
            type: '题型',
            question: '题目',
            options: '选项',
            answer: '答案',
            analysis: '解析',
            difficulty: '难度',
            chapter: '章节',
            updated_at: '编辑时间'
        };
        const IMPORT_DOC_SAMPLE = `1. In the sentence "It's no use waiting for her", the italicized phrase is ____.
A. the object
B. an adverbial
C. a complement
D. the subject
答案: D
解析: it 作形式主语，真正主语是 waiting for her。
难度: 2
章节: 主语从句

2. Which part functions as an object?
A. He doesn't like the idea of my speaking at the meeting.
B. It is no use your pretending not to know the matter.
C. Her falling into the river was the climax of the whole trip.
D. My parents object to my going out alone at night.
答案: A
解析: A 中斜体成分作介词 of 的宾语。
章节: 动名词`;
        const state = {
            libraries: [],
            currentLibrary: null,
            questionSearch: '',
            questionTypeFilter: 'all',
            questionKnowledgeFilter: 'all',
            questionDifficultyFilter: 'all',
            libraryVisibilityFilter: 'all',
            questionBankKeyword: '',
            questionBankLoading: false,
            questionBankQuestions: [],
            questionBankLastRefresh: '',
            questionBankSearch: '',
            questionBankTypeFilter: 'all',
            questionBankKnowledgeFilter: 'all',
            questionBankDifficultyFilter: 'all',
            libraryListCollapsed: false,
            sidebarCollapsed: true,
            sidebarMobileOpen: false,
            importModalTab: 'json',
            exportModalTab: 'json',
            exportTxtFields: [...EXPORT_TXT_DEFAULT_FIELDS],
            importJsonFile: null,
            importJsonPreview: null,
            importJsonPayload: null,
            importDocQuestions: [],
            importDocParseError: '',
            importDocLastFilename: '',
            aiSettings: {
                provider: 'openai_compatible',
                base_url: '',
                model: '',
                endpoint_path: '',
                collector_push_enabled: true,
                collector_push_token: '',
                has_api_key: false,
                api_key_mask: ''
            },
            collectorFile: null,
            collectorFilename: '',
            collectorPayload: null,
            collectorPreview: null,
            collectorRecords: [],
            collectorRecordsLoading: false,
            collectorRecordsError: '',
            previewCollapsed: {
                importJson: true,
                importDoc: true,
                collector: true
            },
            previewExpanded: {
                importJson: {},
                importDoc: {},
                collector: {}
            }
        };

        const $ = (id) => document.getElementById(id);
        let confirmResolver = null;
        let hasAutoOpenedStandaloneModal = false;

        function isAdminPage(pageKey) {
            return ADMIN_PAGE_KEY === pageKey;
        }

        function setElementHidden(element, shouldHide) {
            if (!element) return;
            element.classList.toggle('hidden', Boolean(shouldHide));
        }

        function renderAiKeyStatus() {
            const el = $('ai-key-status');
            if (!el) return;
            if (state.aiSettings.has_api_key) {
                el.innerText = `已保存 Key: ${state.aiSettings.api_key_mask || '已设置'}`;
            } else {
                el.innerText = '尚未保存 Key';
            }
        }

        function fillAiSettingsForm(settings) {
            if ($('ai-provider')) $('ai-provider').value = settings.provider || 'openai_compatible';
            if ($('ai-base-url')) $('ai-base-url').value = settings.base_url || '';
            if ($('ai-model')) $('ai-model').value = settings.model || '';
            if ($('ai-endpoint-path')) $('ai-endpoint-path').value = settings.endpoint_path || '';
            if ($('collector-push-enabled')) $('collector-push-enabled').checked = settings.collector_push_enabled !== false;
            if ($('collector-push-token')) $('collector-push-token').value = settings.collector_push_token || '';
            if ($('ai-api-key')) $('ai-api-key').value = '';
            if ($('ai-clear-key')) $('ai-clear-key').checked = false;
            renderAiKeyStatus();
            if ($('ai-test-status')) $('ai-test-status').innerText = '';
        }

        async function loadAiSettings() {
            try {
                const data = await api('/ai-settings');
                state.aiSettings = {
                    provider: data.provider || 'openai_compatible',
                    base_url: data.base_url || '',
                    model: data.model || '',
                    endpoint_path: data.endpoint_path || '',
                    collector_push_enabled: data.collector_push_enabled !== false,
                    collector_push_token: data.collector_push_token || '',
                    has_api_key: Boolean(data.has_api_key),
                    api_key_mask: data.api_key_mask || ''
                };
                fillAiSettingsForm(state.aiSettings);
            } catch (error) {
                notify(error.message || 'AI 设置读取失败', true);
            }
        }

        async function saveAiSettings() {
            const payload = {
                provider: $('ai-provider')?.value || 'openai_compatible',
                base_url: $('ai-base-url')?.value || '',
                model: $('ai-model')?.value || '',
                endpoint_path: $('ai-endpoint-path')?.value || '',
                collector_push_enabled: $('collector-push-enabled')?.checked ?? true,
                collector_push_token: ($('collector-push-token')?.value || '').trim(),
                api_key: $('ai-api-key')?.value || '',
                clear_api_key: $('ai-clear-key')?.checked || false
            };
            try {
                const result = await api('/ai-settings', {
                    method: 'POST',
                    body: JSON.stringify(payload)
                });
                state.aiSettings = {
                    provider: result.provider || payload.provider,
                    base_url: result.base_url || payload.base_url,
                    model: result.model || payload.model,
                    endpoint_path: result.endpoint_path || payload.endpoint_path,
                    collector_push_enabled: result.collector_push_enabled !== false,
                    collector_push_token: result.collector_push_token || payload.collector_push_token,
                    has_api_key: Boolean(result.has_api_key),
                    api_key_mask: result.api_key_mask || ''
                };
                fillAiSettingsForm(state.aiSettings);
                notify('AI 设置已保存');
                closeSettingsModal();
            } catch (error) {
                notify(error.message || 'AI 设置保存失败', true);
            }
        }

        async function testAiConnection() {
            const statusEl = $('ai-test-status');
            const testBtn = $('settings-test-btn');
            const payload = {
                provider: $('ai-provider')?.value || 'openai_compatible',
                base_url: $('ai-base-url')?.value || '',
                model: $('ai-model')?.value || '',
                endpoint_path: $('ai-endpoint-path')?.value || '',
                api_key: $('ai-api-key')?.value || '',
                clear_api_key: $('ai-clear-key')?.checked || false
            };
            if (statusEl) statusEl.innerText = '连接测试中...';
            if (testBtn) testBtn.disabled = true;
            try {
                const result = await api('/ai-test', {
                    method: 'POST',
                    body: JSON.stringify(payload)
                });
                if (statusEl) {
                    statusEl.innerText = `连接成功（${result.latency_ms || 0} ms）`;
                }
                if (result.sample) {
                    notify(`连接成功：${result.sample}`);
                } else {
                    notify('连接成功');
                }
            } catch (error) {
                if (statusEl) statusEl.innerText = `连接失败：${error.message || '请检查配置'}`;
                notify(error.message || '连接测试失败', true);
            } finally {
                if (testBtn) testBtn.disabled = false;
            }
        }

        function openSettingsModal() {
            const modal = $('settings-modal');
            if (!modal) return;
            modal.classList.remove('hidden');
            fillAiSettingsForm(state.aiSettings);
        }

        function closeSettingsModal() {
            const modal = $('settings-modal');
            if (!modal) return;
            modal.classList.add('hidden');
        }

        function resetCollectorState() {
            state.collectorFile = null;
            state.collectorFilename = '';
            state.collectorPayload = null;
            state.collectorPreview = null;
            state.previewCollapsed.collector = true;
            state.previewExpanded.collector = {};
            if ($('collector-file-input')) $('collector-file-input').value = '';
            if ($('collector-file-name')) $('collector-file-name').innerText = '未选择文件';
            if ($('collector-preview')) $('collector-preview').innerText = '请上传题目文件后识别';
            if ($('collector-replace')) $('collector-replace').checked = false;
            if ($('collector-allow-empty-answer')) $('collector-allow-empty-answer').checked = true;
            if ($('collector-import-btn')) $('collector-import-btn').disabled = true;
        }

        function formatFileSize(size) {
            const num = Number(size || 0);
            if (!Number.isFinite(num) || num <= 0) return '--';
            if (num < 1024) return `${num} B`;
            if (num < 1024 * 1024) return `${(num / 1024).toFixed(1)} KB`;
            return `${(num / (1024 * 1024)).toFixed(1)} MB`;
        }

        function renderCollectorRecordList() {
            const root = $('collector-list-root');
            if (!root) return;
            if (state.collectorRecordsLoading) {
                root.innerHTML = '<p>采集列表加载中...</p>';
                return;
            }
            if (state.collectorRecordsError) {
                root.innerHTML = `<p class="text-rose-600">${esc(state.collectorRecordsError)}</p>`;
                return;
            }
            if (!Array.isArray(state.collectorRecords) || state.collectorRecords.length === 0) {
                root.innerHTML = '<p class="text-slate-400">暂无采集记录</p>';
                return;
            }

            const rowsHtml = state.collectorRecords.map((item, index) => `
                <tr class="border-b border-slate-100 hover:bg-slate-50/70">
                    <td class="py-2 px-2 whitespace-nowrap">${Number(item.seq || (index + 1))}</td>
                    <td class="py-2 px-2 whitespace-nowrap">${esc(getQuestionTypeText(item.type || 'single'))}</td>
                    <td class="py-2 px-2 max-w-[320px] truncate" title="${esc(item.question || '--')}">${esc(item.question || '--')}</td>
                    <td class="py-2 px-2 max-w-[280px]">
                        <div class="whitespace-pre-line line-clamp-4 text-slate-600" title="${esc(item.options || '--')}">${esc(item.options || '--')}</div>
                    </td>
                    <td class="py-2 px-2 max-w-[220px] break-words" title="${esc(item.answer || '--')}">${esc(item.answer || '--')}</td>
                    <td class="py-2 px-2 whitespace-nowrap">${esc(formatEditTime(item.created_at))}</td>
                    <td class="py-2 px-2 whitespace-nowrap">
                        <div class="inline-flex items-center gap-2">
                            <button class="collector-record-copy-btn text-xs px-2 py-1 rounded bg-slate-100 text-slate-700" data-answer="${esc(item.answer || '')}">复制答案</button>
                            <button class="collector-record-delete-btn text-xs px-2 py-1 rounded bg-rose-50 text-rose-600" data-record-id="${esc(item.record_id || '')}">删除</button>
                        </div>
                    </td>
                </tr>
            `).join('');

            root.innerHTML = `
                <div class="text-xs text-slate-400 mb-2">最近 ${state.collectorRecords.length} 条采集题目</div>
                <div class="question-bank-list overflow-auto">
                    <table class="min-w-full text-sm question-grid-table">
                        <thead class="bg-slate-50 text-slate-600">
                            <tr>
                                <th class="py-3 px-2 text-left whitespace-nowrap">编号</th>
                                <th class="py-3 px-2 text-left whitespace-nowrap">题型</th>
                                <th class="py-3 px-2 text-left whitespace-nowrap">题目</th>
                                <th class="py-3 px-2 text-left whitespace-nowrap">选项</th>
                                <th class="py-3 px-2 text-left whitespace-nowrap">答案</th>
                                <th class="py-3 px-2 text-left whitespace-nowrap">时间</th>
                                <th class="py-3 px-2 text-left whitespace-nowrap">操作</th>
                            </tr>
                        </thead>
                        <tbody>${rowsHtml}</tbody>
                    </table>
                </div>
            `;
        }

        async function loadCollectorRecordList() {
            state.collectorRecordsLoading = true;
            state.collectorRecordsError = '';
            renderCollectorRecordList();
            try {
                const result = await api('/collector-records');
                if (Array.isArray(result.questions)) {
                    state.collectorRecords = result.questions;
                } else {
                    state.collectorRecords = Array.isArray(result.records) ? result.records : [];
                }
            } catch (error) {
                state.collectorRecords = [];
                state.collectorRecordsError = error.message || '采集列表加载失败';
            } finally {
                state.collectorRecordsLoading = false;
                renderCollectorRecordList();
            }
        }

        function renderCollectorPreview(payload, filename = '') {
            const previewRoot = $('collector-preview');
            if (!previewRoot) return;
            if (!payload || !payload.libraries || !Array.isArray(payload.libraries)) {
                previewRoot.innerHTML = '<p class="text-rose-600">AI 返回内容无效，请重试。</p>';
                return;
            }
            const normalizeOptions = (raw) => {
                if (Array.isArray(raw)) {
                    return raw.map((item) => String(item ?? '').trim()).filter(Boolean);
                }
                if (typeof raw === 'string') {
                    return raw.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
                }
                return [];
            };
            const normalizeCollectorPayload = (rawPayload) => {
                const libs = rawPayload.libraries.map((lib) => {
                    const questions = Array.isArray(lib.questions) ? lib.questions : [];
                    return {
                        id: String(lib.id || '').trim(),
                        title: String(lib.title || '未命名题集').trim(),
                        icon: String(lib.icon || '📚').trim() || '📚',
                        description: String(lib.description || '').trim(),
                        questions: questions.map((q) => ({
                            question: String(q.question || '').trim(),
                            type: normalizeQuestionType(q.type || 'single'),
                            options: normalizeOptions(q.options || []),
                            answer: q.answer ?? '',
                            analysis: q.analysis ?? '',
                            difficulty: toIntegerOrDefault(q.difficulty, 1),
                            chapter: String(q.chapter || '').trim()
                        }))
                    };
                });
                return { libraries: libs };
            };

            state.collectorPayload = normalizeCollectorPayload(payload);
            const libs = state.collectorPayload.libraries;
            const totalQuestions = libs.reduce((sum, lib) => sum + lib.questions.length, 0);

            const typeOptions = [
                { value: 'single', label: '单选题' },
                { value: 'multiple', label: '多选题' },
                { value: 'judge', label: '判断题' },
                { value: 'fill', label: '填空题' },
                { value: 'qa', label: '问答题' }
            ];

            const libsHtml = libs.map((lib, libIndex) => {
                const questionsHtml = lib.questions.map((q, qIndex) => {
                    const key = `${libIndex}-${qIndex}`;
                    const isExpanded = Boolean(state.previewExpanded.collector[key]);
                    const summary = `${getQuestionTypeText(q.type)} · ${Array.isArray(q.options) ? q.options.length : 0} 选项`;
                    return `
                        <article class="collector-question-card border rounded-xl p-3 bg-slate-50/70" data-collector-lib="${libIndex}" data-collector-question="${qIndex}">
                            <div class="collector-row flex items-center gap-3">
                                <button type="button" class="collector-expand-btn text-xs font-semibold px-2 py-1 rounded-lg bg-slate-100 text-slate-600" data-collector-lib="${libIndex}" data-collector-question="${qIndex}">
                                    ${isExpanded ? '收起' : '展开'}
                                </button>
                                <div class="flex-1 min-w-0">
                                    <div class="text-sm font-semibold text-slate-700 truncate">${esc(q.question || `题目 ${qIndex + 1}`)}</div>
                                    <div class="text-xs text-slate-400">${esc(summary)}</div>
                                </div>
                                <button type="button" class="collector-ai-btn text-xs font-semibold px-2 py-1 rounded-lg bg-slate-900 text-white" data-collector-lib="${libIndex}" data-collector-question="${qIndex}">AI生成</button>
                                <button type="button" class="collector-delete-btn text-rose-600 text-xs font-semibold" data-collector-lib="${libIndex}" data-collector-question="${qIndex}">删除</button>
                            </div>
                            ${isExpanded ? `
                                <div class="mt-3 border-t border-slate-200/70 pt-3">
                                    <label class="block text-sm mb-3">
                                        <span class="text-slate-500">题目</span>
                                        <textarea class="w-full mt-1 px-3 py-2 rounded-lg border bg-white min-h-[88px]" data-collector-field="question">${esc(q.question)}</textarea>
                                    </label>
                                    <div class="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
                                        <label class="block text-sm">
                                            <span class="text-slate-500">题型</span>
                                            <select class="w-full mt-1 px-3 py-2 rounded-lg border bg-white" data-collector-field="type">
                                                ${typeOptions.map((item) => `<option value="${item.value}" ${q.type === item.value ? 'selected' : ''}>${item.label}</option>`).join('')}
                                            </select>
                                        </label>
                                        <label class="block text-sm">
                                            <span class="text-slate-500">难度</span>
                                            <input type="number" min="1" max="5" class="w-full mt-1 px-3 py-2 rounded-lg border bg-white" data-collector-field="difficulty" value="${esc(String(q.difficulty || 1))}">
                                        </label>
                                        <label class="block text-sm">
                                            <span class="text-slate-500">章节</span>
                                            <input class="w-full mt-1 px-3 py-2 rounded-lg border bg-white" data-collector-field="chapter" value="${esc(q.chapter || '')}">
                                        </label>
                                    </div>
                                    <label class="block text-sm mb-3">
                                        <span class="text-slate-500">选项（每行一个）</span>
                                        <textarea class="w-full mt-1 px-3 py-2 rounded-lg border bg-white min-h-[88px]" data-collector-field="options">${esc(q.options.join('\n'))}</textarea>
                                    </label>
                                    <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                                        <label class="block text-sm">
                                            <span class="text-slate-500">${getAnswerLabelText(q.type)}</span>
                                            <input class="w-full mt-1 px-3 py-2 rounded-lg border bg-white" data-collector-field="answer" value="${esc(formatAnswerForEditor(q.type, q.answer))}">
                                        </label>
                                        <label class="block text-sm">
                                            <span class="text-slate-500">解析</span>
                                            <textarea class="w-full mt-1 px-3 py-2 rounded-lg border bg-white min-h-[88px]" data-collector-field="analysis">${esc(String(q.analysis || ''))}</textarea>
                                        </label>
                                    </div>
                                </div>
                            ` : ''}
                        </article>
                    `;
                }).join('');

                return `
                    <section class="collector-lib-card border rounded-xl p-4 bg-white/95">
                        <div class="flex flex-wrap items-center gap-3 mb-3">
                            <label class="block text-xs">
                                <span class="text-slate-500">题集名称</span>
                                <input class="mt-1 px-3 py-2 rounded-lg border bg-white text-sm" data-collector-lib-field="title" data-collector-lib="${libIndex}" value="${esc(lib.title)}">
                            </label>
                            <label class="block text-xs">
                                <span class="text-slate-500">题集 ID</span>
                                <input class="mt-1 px-3 py-2 rounded-lg border bg-white text-sm" data-collector-lib-field="id" data-collector-lib="${libIndex}" value="${esc(lib.id || '')}">
                            </label>
                            <label class="block text-xs">
                                <span class="text-slate-500">图标</span>
                                <input class="mt-1 px-3 py-2 rounded-lg border bg-white text-sm w-24" data-collector-lib-field="icon" data-collector-lib="${libIndex}" value="${esc(lib.icon || '📚')}">
                            </label>
                        </div>
                        <label class="block text-sm mb-3">
                            <span class="text-slate-500">题集描述</span>
                            <textarea class="w-full mt-1 px-3 py-2 rounded-lg border bg-white min-h-[70px]" data-collector-lib-field="description" data-collector-lib="${libIndex}">${esc(lib.description || '')}</textarea>
                        </label>
                        <div class="text-xs text-slate-400 mb-3">共 ${lib.questions.length} 题</div>
                        <div class="space-y-3">${questionsHtml || '<div class="text-sm text-slate-400">暂无题目</div>'}</div>
                    </section>
                `;
            }).join('');

            previewRoot.innerHTML = `
                <div class="mb-3 text-sm flex flex-wrap items-center gap-2 justify-between">
                    <div>
                        <p>共识别 <strong>${totalQuestions}</strong> 道题。</p>
                        ${filename ? `<p class="text-xs text-slate-400 mt-1">来源：${esc(filename)}</p>` : ''}
                    </div>
                    <button type="button" class="collector-ai-batch px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-semibold">批量AI生成</button>
                </div>
                <div class="space-y-4">${libsHtml}</div>
            `;
        }

        async function runCollector() {
            if (!state.collectorFile) {
                notify('请先选择题目文件', true);
                return;
            }
            if (!state.aiSettings.has_api_key) {
                notify('请先在 AI 设置中填写 API Key', true);
                openSettingsModal();
                return;
            }
            const previewRoot = $('collector-preview');
            if (previewRoot) previewRoot.innerHTML = '<p>AI 正在识别，请稍候...</p>';
            const formData = new FormData();
            formData.append('file', state.collectorFile);
            formData.append('library_title', $('collector-library-title')?.value || '');
            formData.append('library_id', $('collector-library-id')?.value || '');
            try {
                const result = await api('/ai-collect', { method: 'POST', body: formData });
                const overrideTitle = ($('collector-library-title')?.value || '').trim();
                const overrideId = ($('collector-library-id')?.value || '').trim();
                if (result.payload && Array.isArray(result.payload.libraries) && result.payload.libraries.length) {
                    if (overrideTitle) result.payload.libraries[0].title = overrideTitle;
                    if (overrideId) result.payload.libraries[0].id = overrideId;
                }
                state.collectorPayload = result.payload;
                state.collectorPreview = result;
                state.previewCollapsed.collector = true;
                state.previewExpanded.collector = {};
                renderCollectorPreview(result.payload, state.collectorFilename);
                if ($('collector-import-btn')) $('collector-import-btn').disabled = false;
                notify(`AI 识别完成：${result.question_count || 0} 道题`);
            } catch (error) {
                if (previewRoot) previewRoot.innerHTML = `<p class="text-rose-600">${esc(error.message || 'AI 识别失败')}</p>`;
                notify(error.message || 'AI 识别失败', true);
            }
        }

        async function importCollectorPayload() {
            if (!state.collectorPayload) {
                notify('暂无可导入的识别结果', true);
                return;
            }
            const allowEmptyAnswer = $('collector-allow-empty-answer')?.checked ?? true;
            const filtered = filterLibrariesForImport(state.collectorPayload, { allowEmptyAnswer });
            if (!filtered.ready) {
                notify(
                    allowEmptyAnswer
                        ? '没有可导入的题目（题目为空或选择题缺少选项）'
                        : '没有可导入的题目（需填写答案与选项）',
                    true
                );
                return;
            }
            if (filtered.ready < filtered.total) {
                const ok = await showConfirmDialog({
                    title: '导入题库',
                    message: allowEmptyAnswer
                        ? `共有 ${filtered.total} 道题，其中 ${filtered.ready} 道可导入（其余题目为空或选择题缺少选项）。确认先导入可导入题目吗？`
                        : `共有 ${filtered.total} 道题，其中 ${filtered.ready} 道已完整可导入。确认先导入已完成题目吗？`,
                    confirmText: '先导入可导入题目'
                });
                if (!ok) return;
            }
            const replaceExisting = $('collector-replace')?.checked ? '1' : '0';
            const payloadText = JSON.stringify({ libraries: filtered.libraries }, null, 2);
            const blob = new Blob([payloadText], { type: 'application/json' });
            const file = new File([blob], 'ai-collector.json', { type: 'application/json' });
            const formData = new FormData();
            formData.append('file', file);
            formData.append('replace_existing', replaceExisting);
            formData.append('allow_empty_answer', allowEmptyAnswer ? '1' : '0');
            try {
                const result = await api('/import-json', { method: 'POST', body: formData });
                const replacedText = result.replaced_count ? `，覆盖 ${result.replaced_count} 个题集` : '';
                notify(`导入成功：${result.library_count} 个题集，${result.question_count} 道题${replacedText}`);
                resetCollectorState();
                await loadLibraries();
            } catch (error) {
                notify(error.message || '导入失败', true);
            }
        }

        function applyAdminPageMode() {
            const mainLayout = $('admin-layout-main');
            const libraryPanel = $('library-panel');
            const editorPanel = $('editor-panel');
            const questionBankPanel = $('question-bank-panel');
            const questionBankInfo = $('question-bank-info');
            const collectorListPanel = $('collector-list-panel');
            const importModal = $('import-modal');
            const exportModal = $('export-modal');

            setElementHidden(mainLayout, false);
            setElementHidden(libraryPanel, false);
            setElementHidden(editorPanel, false);
            setElementHidden(questionBankPanel, false);
            setElementHidden(questionBankInfo, false);
            setElementHidden(collectorListPanel, true);
            setElementHidden(importModal, !isAdminPage('import'));
            setElementHidden(exportModal, !isAdminPage('export'));

            if (isAdminPage('question-bank')) {
                setElementHidden(libraryPanel, true);
                if ($('editor')) $('editor').classList.add('hidden');
                if ($('editor-empty')) $('editor-empty').classList.add('hidden');
                return;
            }

            if (isAdminPage('library-management')) {
                setElementHidden(questionBankPanel, true);
                setElementHidden(questionBankInfo, true);
                return;
            }

            if (isAdminPage('collector-list')) {
                setElementHidden(libraryPanel, true);
                setElementHidden(editorPanel, true);
                setElementHidden(questionBankInfo, true);
                setElementHidden(questionBankPanel, true);
                setElementHidden(importModal, true);
                setElementHidden(exportModal, true);
                setElementHidden(collectorListPanel, false);
                return;
            }

            if (isAdminPage('import')) {
                setElementHidden(libraryPanel, true);
                setElementHidden(editorPanel, true);
                setElementHidden(questionBankInfo, true);
                setElementHidden(questionBankPanel, true);
                return;
            }

            if (isAdminPage('export')) {
                setElementHidden(libraryPanel, true);
                setElementHidden(editorPanel, true);
                setElementHidden(questionBankInfo, true);
                setElementHidden(questionBankPanel, true);
            }
        }

        function getStoredThemePreference() {
            const raw = localStorage.getItem(THEME_STORAGE_KEY);
            if (raw === 'light' || raw === 'dark' || raw === 'auto') return raw;
            return 'auto';
        }

        function getThemePreference() {
            return document.body.dataset.themePreference || getStoredThemePreference();
        }

        function setThemePreference(value) {
            const normalized = value === 'dark' || value === 'light' ? value : 'auto';
            document.body.dataset.themePreference = normalized;
            localStorage.setItem(THEME_STORAGE_KEY, normalized);
        }

        function getStoredLibraryPanelCollapsed() {
            return window.matchMedia('(max-width: 1023px)').matches;
        }

        function isMobileViewport() {
            return window.matchMedia('(max-width: 1023px)').matches;
        }

        function renderSidebarState() {
            const mobileBtn = $('sidebar-mobile-toggle-btn');
            const backdrop = $('sidebar-backdrop');
            const mobile = isMobileViewport();

            document.body.classList.toggle('sidebar-collapsed', !mobile && state.sidebarCollapsed);
            document.body.classList.toggle('sidebar-mobile-open', mobile && state.sidebarMobileOpen);

            if (mobileBtn) {
                const opened = mobile && state.sidebarMobileOpen;
                const label = opened ? '收起菜单' : '展开菜单';
                mobileBtn.title = label;
                mobileBtn.setAttribute('aria-label', label);
                mobileBtn.innerHTML = opened
                    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg>'
                    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6h16"></path><path d="M4 12h16"></path><path d="M4 18h16"></path></svg>';
            }

            if (backdrop) {
                backdrop.classList.toggle('hidden', !(mobile && state.sidebarMobileOpen));
            }
        }

        function setSidebarCollapsed() {
            state.sidebarCollapsed = true;
            renderSidebarState();
        }

        function setSidebarMobileOpen(opened) {
            state.sidebarMobileOpen = Boolean(opened);
            renderSidebarState();
        }

        function toggleSidebarMobile() {
            setSidebarMobileOpen(!state.sidebarMobileOpen);
        }

        function syncAdminLayoutMetrics() {
            const header = $('admin-header');
            if (!header) return;
            document.documentElement.style.setProperty('--admin-header-height', `${Math.ceil(header.offsetHeight)}px`);
        }

        function formatStatCount(value) {
            const number = Number(value);
            if (!Number.isFinite(number)) return '0';
            return number.toLocaleString('zh-CN');
        }

        function renderDashboardStats() {
            const totalQuestions = state.libraries.reduce(
                (sum, lib) => sum + toIntegerOrDefault(lib.question_count, 0),
                0
            );
            const currentQuestionCount = state.currentLibrary?.questions?.length
                ?? toIntegerOrDefault(state.currentLibrary?.question_count, 0);
            const currentLibraryTitle = state.currentLibrary?.title || '-';

            if ($('stat-total-questions')) $('stat-total-questions').innerText = formatStatCount(totalQuestions);
            if ($('stat-library-count')) $('stat-library-count').innerText = formatStatCount(state.libraries.length);
            if ($('stat-current-library')) $('stat-current-library').innerText = currentLibraryTitle;
            if ($('stat-current-questions')) $('stat-current-questions').innerText = formatStatCount(currentQuestionCount);
            renderQuestionBankInfo(totalQuestions);
        }

        function renderQuestionBankInfo(totalQuestions) {
            if (!isAdminPage('question-bank')) return;
            const total = Number.isFinite(totalQuestions) ? totalQuestions : state.libraries.reduce(
                (sum, lib) => sum + toIntegerOrDefault(lib.question_count, 0),
                0
            );
            const totalInput = $('question-bank-total');
            const libraryCountInput = $('question-bank-library-count');
            const refreshInput = $('question-bank-last-refresh');
            if (totalInput) totalInput.value = formatStatCount(total);
            if (libraryCountInput) libraryCountInput.value = formatStatCount(state.libraries.length);
            if (refreshInput) {
                const refreshText = state.questionBankLastRefresh
                    ? formatEditTime(state.questionBankLastRefresh)
                    : '--';
                refreshInput.value = refreshText;
            }
        }

        function renderQuestionBankList() {
            const root = $('question-bank-list');
            if (!root) return;

            if (state.questionBankLoading) {
                root.innerHTML = '<div class="p-4 text-sm text-slate-500">正在加载全部题目...</div>';
                return;
            }

            if (!state.questionBankQuestions.length) {
                root.innerHTML = '<div class="p-4 text-sm text-slate-400">暂无题目</div>';
                return;
            }

            const knowledgeMap = new Map();
            state.questionBankQuestions.forEach((question) => {
                const raw = String(question.chapter ?? question.knowledge_point ?? '').trim();
                if (!raw) return;
                const key = normalizeSearchText(raw);
                if (!knowledgeMap.has(key)) {
                    knowledgeMap.set(key, raw);
                }
            });
            const knowledgeOptions = Array.from(knowledgeMap.entries()).sort((a, b) => a[1].localeCompare(b[1], 'zh-CN'));
            const moveTargetOptions = state.libraries
                .map((item) => `<option value="${esc(item.id)}">${esc(item.icon)} ${esc(item.title)}</option>`)
                .join('');

            const total = state.questionBankQuestions.length;
            const rows = state.questionBankQuestions.map((item, index) => {
                const questionId = esc(item.id);
                const qType = normalizeQuestionType(item.type);
                const answerPreview = formatAnswerForList(qType, item.ans);
                const answerText = formatAnswerForEditor(qType, item.ans);
                const chapter = String(item.chapter ?? item.knowledge_point ?? '').trim();
                const chapterKey = normalizeSearchText(chapter);
                const difficultyText = getDifficultyText(item.difficulty);
                const difficultyClass = getDifficultyClass(item.difficulty);
                const title = esc(String(item.q || '').trim() || `题目 ${questionId}`);
                const optionsText = Array.isArray(item.options) ? item.options.join('\n') : '';
                const searchText = [
                    index + 1,
                    item.id,
                    item.q,
                    (item.options || []).join(' '),
                    answerPreview,
                    item.analysis,
                    item.chapter ?? item.knowledge_point ?? '',
                    qType,
                    item.library_title || '',
                    item.library_id || ''
                ].join(' ');
                const libraryOptions = state.libraries.map((lib) => {
                    const selected = String(lib.id) === String(item.library_id) ? 'selected' : '';
                    return `<option value="${esc(lib.id)}" ${selected}>${esc(lib.icon)} ${esc(lib.title)}</option>`;
                }).join('');
                return `
                    <tr class="border-b border-slate-100 hover:bg-slate-50/70" data-question-id="${questionId}" data-question-bank-type="${esc(qType)}" data-question-bank-knowledge="${esc(chapterKey)}" data-question-bank-difficulty="${esc(toIntegerOrDefault(item.difficulty, 1))}" data-question-bank-search="${esc(searchText)}">
                        <td class="py-3 px-3 align-middle">
                            <input type="checkbox" class="question-bank-row-check rounded border-slate-300" data-question-id="${questionId}">
                        </td>
                        <td class="py-3 px-2 align-middle">
                            <button class="row-expand-btn question-bank-expand-btn w-6 h-6 inline-flex items-center justify-center rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100" data-question-id="${questionId}" title="展开编辑">›</button>
                        </td>
                        <td class="py-3 px-2 align-middle whitespace-nowrap">${esc(getQuestionTypeText(qType))}</td>
                        <td class="py-3 px-2 align-middle whitespace-nowrap">${index + 1}</td>
                        <td class="py-3 px-2 align-middle max-w-[380px] truncate" title="${title}">${title}</td>
                        <td class="py-3 px-2 align-middle font-semibold max-w-[180px] truncate" title="${esc(answerPreview || '--')}">${esc(answerPreview || '--')}</td>
                        <td class="py-3 px-2 align-middle max-w-[160px] truncate" title="${esc(chapter || '--')}">${esc(chapter || '--')}</td>
                        <td class="py-3 px-2 align-middle whitespace-nowrap ${difficultyClass}">${difficultyText}</td>
                        <td class="py-3 px-2 align-middle text-slate-400 whitespace-nowrap">${esc(formatEditTime(item.updated_at))}</td>
                        <td class="py-3 px-2 align-middle whitespace-nowrap">
                            <button class="delete-question-btn text-rose-600 hover:text-rose-700" data-question-id="${questionId}" data-question-bank="1">删除</button>
                        </td>
                    </tr>
                    <tr class="hidden bg-slate-50/70" data-question-bank-edit-row="${questionId}">
                        <td colspan="10" class="px-4 py-4">
                            <div class="question-edit-card question-bank-edit-card border rounded-xl p-4 bg-white" data-question-bank-edit="${questionId}">
                                <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    <label class="text-sm md:col-span-2">
                                        <span class="text-slate-500">题目</span>
                                        <textarea class="qb-question w-full mt-1 px-3 py-2 rounded-lg border" rows="2">${esc(item.q)}</textarea>
                                    </label>
                                    <label class="text-sm qb-options-wrap">
                                        <span class="text-slate-500">选项 每行一个</span>
                                        <textarea class="qb-options w-full mt-1 px-3 py-2 rounded-lg border" rows="5">${esc(optionsText)}</textarea>
                                    </label>
                                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                        <label class="block text-sm">
                                            <span class="text-slate-500">题型</span>
                                            <select class="qb-type w-full mt-1 px-3 py-2 rounded-lg border">
                                                <option value="single" ${qType === 'single' ? 'selected' : ''}>单选题</option>
                                                <option value="multiple" ${qType === 'multiple' ? 'selected' : ''}>多选题</option>
                                                <option value="judge" ${qType === 'judge' ? 'selected' : ''}>判断题</option>
                                                <option value="fill" ${qType === 'fill' ? 'selected' : ''}>填空题</option>
                                                <option value="qa" ${qType === 'qa' ? 'selected' : ''}>问答题</option>
                                            </select>
                                        </label>
                                        <label class="block text-sm">
                                            <span class="text-slate-500 qb-answer-label">${getAnswerLabelText(qType)}</span>
                                            <input type="text" class="qb-answer w-full mt-1 px-3 py-2 rounded-lg border" value="${esc(answerText)}">
                                        </label>
                                        <label class="block text-sm">
                                            <span class="text-slate-500">难度</span>
                                            <input type="number" min="1" class="qb-difficulty w-full mt-1 px-3 py-2 rounded-lg border" value="${esc(item.difficulty)}">
                                        </label>
                                        <label class="block text-sm">
                                            <span class="text-slate-500">章节</span>
                                            <input class="qb-knowledge w-full mt-1 px-3 py-2 rounded-lg border" value="${esc(chapter)}">
                                        </label>
                                        <label class="block text-sm sm:col-span-2">
                                            <span class="text-slate-500">题集</span>
                                            <select class="qb-library w-full mt-1 px-3 py-2 rounded-lg border">
                                                ${libraryOptions || '<option value="" disabled>暂无题集</option>'}
                                            </select>
                                        </label>
                                    </div>
                                    <label class="text-sm md:col-span-2">
                                        <span class="text-slate-500">解析</span>
                                        <textarea class="qb-analysis w-full mt-1 px-3 py-2 rounded-lg border" rows="3">${esc(item.analysis)}</textarea>
                                    </label>
                                </div>
                                <div class="flex flex-wrap gap-3 mt-3">
                                    <button class="ai-generate-btn px-4 py-2 rounded-lg bg-slate-900 text-white font-semibold">AI生成</button>
                                    <button class="question-bank-save-btn px-4 py-2 rounded-lg bg-indigo-600 text-white font-semibold" data-question-id="${questionId}">保存题目</button>
                                    <button class="question-bank-collapse-btn px-4 py-2 rounded-lg bg-slate-100 text-slate-600 font-semibold" data-question-id="${questionId}">收起</button>
                                </div>
                            </div>
                        </td>
                    </tr>
                `;
            }).join('');

            root.innerHTML = `
                <div class="flex flex-col gap-3 mb-4">
                    <div class="question-toolbar flex flex-wrap items-center gap-2">
                        <div class="question-toolbar-select-row">
                            <select id="question-bank-type-filter" class="question-toolbar-control px-3 py-2 rounded-lg border text-sm">
                                <option value="all" ${state.questionBankTypeFilter === 'all' ? 'selected' : ''}>全部题型</option>
                                <option value="single" ${state.questionBankTypeFilter === 'single' ? 'selected' : ''}>单选题</option>
                                <option value="multiple" ${state.questionBankTypeFilter === 'multiple' ? 'selected' : ''}>多选题</option>
                                <option value="judge" ${state.questionBankTypeFilter === 'judge' ? 'selected' : ''}>判断题</option>
                                <option value="fill" ${state.questionBankTypeFilter === 'fill' ? 'selected' : ''}>填空题</option>
                                <option value="qa" ${state.questionBankTypeFilter === 'qa' ? 'selected' : ''}>问答题</option>
                            </select>
                            <select id="question-bank-knowledge-filter" class="question-toolbar-control px-3 py-2 rounded-lg border text-sm min-w-[150px]">
                                <option value="all" ${state.questionBankKnowledgeFilter === 'all' ? 'selected' : ''}>全部章节</option>
                                ${knowledgeOptions.map(([key, label]) => `<option value="${esc(key)}" ${state.questionBankKnowledgeFilter === key ? 'selected' : ''}>${esc(label)}</option>`).join('')}
                            </select>
                            <select id="question-bank-difficulty-filter" class="question-toolbar-control px-3 py-2 rounded-lg border text-sm">
                                <option value="all" ${state.questionBankDifficultyFilter === 'all' ? 'selected' : ''}>全部难度</option>
                                <option value="1" ${state.questionBankDifficultyFilter === '1' ? 'selected' : ''}>简单</option>
                                <option value="2" ${state.questionBankDifficultyFilter === '2' ? 'selected' : ''}>适中</option>
                                <option value="3" ${state.questionBankDifficultyFilter === '3' ? 'selected' : ''}>较难</option>
                            </select>
                            <select id="question-bank-batch-action" class="question-toolbar-control question-toolbar-action px-3 py-2 rounded-lg border text-sm">
                                <option value="" selected disabled hidden>批量操作</option>
                                <option value="batch-difficulty">修改难度</option>
                                <option value="batch-knowledge">修改章节</option>
                                <option value="batch-copy">复制题目</option>
                                <option value="batch-move">移动题目</option>
                                <option value="batch-export">导出题目</option>
                                <option value="delete">删除</option>
                            </select>
                        </div>
                        <select id="question-bank-batch-difficulty" class="question-toolbar-control hidden px-3 py-2 rounded-lg border text-sm">
                            <option value="1">设为简单</option>
                            <option value="2">设为适中</option>
                            <option value="3">设为较难</option>
                        </select>
                        <input id="question-bank-batch-knowledge" class="question-toolbar-control hidden px-3 py-2 rounded-lg border text-sm" placeholder="输入章节，留空可清空">
                        <select id="question-bank-batch-target-library" class="question-toolbar-control hidden px-3 py-2 rounded-lg border text-sm">
                            <option value="">选择目标题集</option>
                            ${moveTargetOptions || '<option value="" disabled>暂无可移动题集</option>'}
                        </select>
                        <select id="question-bank-batch-export-format" class="question-toolbar-control hidden px-3 py-2 rounded-lg border text-sm">
                            <option value="json">导出为 JSON</option>
                            <option value="txt">导出为文档</option>
                        </select>
                        <button id="question-bank-batch-run-btn" class="question-toolbar-run px-3 py-2 rounded-lg bg-slate-100 text-slate-600 font-semibold text-sm">执行</button>
                        <span id="question-bank-selected-hint" class="text-xs text-slate-400 ml-1">已选 0 题</span>
                        <div class="question-toolbar-search ml-auto flex items-center gap-2 w-full md:w-auto">
                            <input id="question-bank-search-input" value="${esc(state.questionBankSearch)}" class="w-full md:w-72 px-3 py-2 rounded-lg border" placeholder="请输入题目关键词">
                            <button id="question-bank-search-btn" title="搜索" aria-label="搜索" class="toolbar-icon-btn bg-slate-100 text-slate-600 hover:bg-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-300">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                    <circle cx="11" cy="11" r="7"></circle>
                                    <path d="m20 20-3.5-3.5"></path>
                                </svg>
                                <span class="sr-only">搜索</span>
                            </button>
                        </div>
                    </div>
                </div>
                <h3 class="font-bold mb-3">题目列表</h3>
                <div class="overflow-x-auto rounded-xl border border-slate-200">
                    <table class="question-grid-table min-w-[980px] w-full text-sm">
                        <thead class="bg-slate-50 text-slate-600">
                            <tr>
                                <th class="py-3 px-3 text-left w-10"><input id="question-bank-check-all" type="checkbox" class="rounded border-slate-300"></th>
                                <th class="py-3 px-2 text-left w-10"></th>
                                <th class="py-3 px-2 text-left whitespace-nowrap">题型</th>
                                <th class="py-3 px-2 text-left whitespace-nowrap">编号</th>
                                <th class="py-3 px-2 text-left whitespace-nowrap">题目</th>
                                <th class="py-3 px-2 text-left whitespace-nowrap w-[180px]">答案</th>
                                <th class="py-3 px-2 text-left whitespace-nowrap">章节</th>
                                <th class="py-3 px-2 text-left whitespace-nowrap">难易程度</th>
                                <th class="py-3 px-2 text-left whitespace-nowrap">编辑时间</th>
                                <th class="py-3 px-2 text-left whitespace-nowrap">操作</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rows}
                        </tbody>
                    </table>
                </div>
                <div id="question-bank-search-empty" class="hidden mt-4 rounded-xl border border-dashed text-center text-sm text-slate-400 py-8">没有匹配的题目</div>
            `;
            root.querySelectorAll('.question-bank-edit-card').forEach((card) => updateQuestionBankCardTypeUI(card));
            updateQuestionBankBatchControls();
            applyQuestionBankSearch();
        }

        function updateQuestionBankCardTypeUI(card) {
            if (!card) return;
            const typeSelect = card.querySelector('.qb-type');
            const answerLabel = card.querySelector('.qb-answer-label');
            const answerInput = card.querySelector('.qb-answer');
            const optionsInput = card.querySelector('.qb-options');
            const optionsWrap = card.querySelector('.qb-options-wrap');
            if (!typeSelect) return;

            const type = normalizeQuestionType(typeSelect.value);
            if (answerLabel) {
                answerLabel.innerText = getAnswerLabelText(type);
            }
            if (answerInput) {
                if (type === 'multiple') {
                    answerInput.placeholder = '如 A,C';
                } else if (type === 'judge') {
                    answerInput.placeholder = '如 对 / 正确 / √';
                } else if (type === 'fill') {
                    answerInput.placeholder = '多个答案用 | 分隔，如 红楼梦|水浒传';
                } else if (type === 'qa') {
                    answerInput.placeholder = '请输入参考答案';
                } else {
                    answerInput.placeholder = '如 A';
                }
            }
            if (optionsWrap) {
                optionsWrap.classList.toggle('hidden', type === 'fill' || type === 'qa');
            }
            if (optionsInput) {
                if (type === 'judge' && !optionsInput.value.trim()) {
                    optionsInput.value = '正确\n错误';
                }
                if (type === 'fill' || type === 'qa') {
                    optionsInput.value = '';
                    optionsInput.placeholder = '该题型无需选项';
                } else {
                    optionsInput.placeholder = type === 'judge' ? '判断题建议：正确 与 错误 每行一个' : '每行一个选项';
                }
            }
        }

        function setQuestionBankRowExpanded(questionId, expanded) {
            if (!questionId) return;
            const row = $('question-bank-list')?.querySelector(`[data-question-bank-edit-row="${questionId}"]`);
            const button = $('question-bank-list')?.querySelector(`.question-bank-expand-btn[data-question-id="${questionId}"]`);
            if (!row) return;
            if (expanded) {
                row.dataset.expanded = '1';
                row.classList.remove('hidden');
                if (button) button.innerText = '⌄';
            } else {
                delete row.dataset.expanded;
                row.classList.add('hidden');
                if (button) button.innerText = '›';
            }
        }

        function toggleQuestionBankRow(questionId) {
            if (!questionId) return;
            const listRoot = $('question-bank-list');
            if (!listRoot) return;
            const row = listRoot.querySelector(`[data-question-bank-edit-row="${questionId}"]`);
            if (!row) return;
            const willExpand = !row.dataset.expanded;
            listRoot.querySelectorAll('[data-question-bank-edit-row]').forEach((item) => {
                setQuestionBankRowExpanded(item.dataset.questionBankEditRow, false);
            });
            setQuestionBankRowExpanded(questionId, willExpand);
        }

        function buildQuestionBankPayload(card) {
            const type = normalizeQuestionType(card.querySelector('.qb-type')?.value || 'single');
            const optionsInput = card.querySelector('.qb-options');
            const answerInput = card.querySelector('.qb-answer');
            const questionInput = card.querySelector('.qb-question');
            const analysisInput = card.querySelector('.qb-analysis');
            const difficultyInput = card.querySelector('.qb-difficulty');
            const knowledgeInput = card.querySelector('.qb-knowledge');
            const libraryInput = card.querySelector('.qb-library');
            if (!optionsInput || !answerInput || !questionInput || !analysisInput || !difficultyInput || !knowledgeInput || !libraryInput) {
                throw new Error('题目编辑区域不完整，请刷新后重试');
            }

            let options = optionsInput.value
                .split('\n')
                .map((item) => item.trim())
                .filter(Boolean);
            if (type === 'judge' && options.length === 0) {
                options = ['正确', '错误'];
            }
            if (type === 'fill' || type === 'qa') {
                options = [];
            }
            const answerRaw = answerInput.value.trim();

            return {
                question: questionInput.value.trim(),
                type,
                options,
                answer: answerRaw,
                analysis: analysisInput.value.trim(),
                difficulty: difficultyInput.value.trim() || '1',
                chapter: knowledgeInput.value.trim(),
                library_id: libraryInput.value || ''
            };
        }

        function applyQuestionBankSearch() {
            const root = $('question-bank-list');
            if (!root) return;

            const query = normalizeSearchText(state.questionBankSearch);
            const selectedType = String(state.questionBankTypeFilter || 'all');
            const selectedKnowledge = String(state.questionBankKnowledgeFilter || 'all');
            const selectedDifficulty = String(state.questionBankDifficultyFilter || 'all');
            const rows = Array.from(root.querySelectorAll('[data-question-id]'));
            let visibleCount = 0;

            rows.forEach((row) => {
                const rowType = String(row.dataset.questionBankType || '');
                const rowKnowledge = String(row.dataset.questionBankKnowledge || '');
                const rowDifficulty = String(row.dataset.questionBankDifficulty || '');
                const rowSearch = normalizeSearchText(row.dataset.questionBankSearch || '');
                const rowId = row.dataset.questionId;
                const editRow = rowId ? root.querySelector(`[data-question-bank-edit-row="${rowId}"]`) : null;
                const checkbox = row.querySelector('.question-bank-row-check');

                const typeMatch = selectedType === 'all' || rowType === selectedType;
                const knowledgeMatch = selectedKnowledge === 'all' || rowKnowledge === selectedKnowledge;
                const difficultyMatch = selectedDifficulty === 'all' || rowDifficulty === selectedDifficulty;
                const keywordMatch = !query || rowSearch.includes(query);
                const matched = typeMatch && knowledgeMatch && difficultyMatch && keywordMatch;

                row.classList.toggle('hidden', !matched);
                if (editRow) {
                    editRow.classList.toggle('hidden', !matched || !editRow.dataset.expanded);
                }
                if (!matched && checkbox) {
                    checkbox.checked = false;
                }
                if (matched) visibleCount += 1;
            });

            const totalCount = rows.length;
            const emptyHint = $('question-bank-search-empty');
            if (emptyHint) {
                emptyHint.classList.toggle('hidden', visibleCount !== 0);
            }

            const checkAll = $('question-bank-check-all');
            if (checkAll) {
                const visibleRows = rows.filter((row) => !row.classList.contains('hidden'));
                const checkedVisible = visibleRows.filter((row) => row.querySelector('.question-bank-row-check')?.checked);
                checkAll.checked = visibleRows.length > 0 && checkedVisible.length === visibleRows.length;
            }
            syncQuestionBankSelectedCount();
        }

        function getQuestionBankSelectedIds() {
            return Array.from(document.querySelectorAll('.question-bank-row-check:checked'))
                .map((input) => input.getAttribute('data-question-id'))
                .filter(Boolean);
        }

        function syncQuestionBankSelectedCount() {
            const checkboxes = Array.from(document.querySelectorAll('.question-bank-row-check'));
            const checked = checkboxes.filter((item) => item.checked);
            const label = $('question-bank-selected-hint');
            if (label) {
                label.innerText = `已选 ${checked.length} 题`;
            }
            const checkAll = $('question-bank-check-all');
            if (checkAll) {
                const visible = checkboxes.filter((item) => !item.closest('tr')?.classList.contains('hidden'));
                checkAll.checked = visible.length > 0 && visible.every((item) => item.checked);
            }
        }

        function updateQuestionBankBatchControls() {
            const action = $('question-bank-batch-action')?.value || '';
            const difficultyInput = $('question-bank-batch-difficulty');
            const knowledgeInput = $('question-bank-batch-knowledge');
            const targetLibraryInput = $('question-bank-batch-target-library');
            const exportFormatInput = $('question-bank-batch-export-format');
            const runButton = $('question-bank-batch-run-btn');
            if (!difficultyInput || !knowledgeInput || !targetLibraryInput || !exportFormatInput) return;

            difficultyInput.classList.toggle('hidden', action !== 'batch-difficulty');
            knowledgeInput.classList.toggle('hidden', action !== 'batch-knowledge');
            targetLibraryInput.classList.toggle('hidden', action !== 'batch-move' && action !== 'batch-copy');
            exportFormatInput.classList.toggle('hidden', action !== 'batch-export');
            if (runButton) {
                runButton.innerText = action === 'batch-export' ? '导出' : '执行';
            }
        }

        async function batchUpdateQuestionsForLibrary(libraryId, questionIds, changes) {
            return api('/questions/batch', {
                method: 'PUT',
                body: JSON.stringify({
                    library_id: libraryId,
                    question_ids: questionIds,
                    changes
                })
            });
        }

        async function exportQuestionBankSelectedQuestions(questionIds, format) {
            const selectedSet = new Set(questionIds.map((id) => String(id)));
            const selectedQuestions = state.questionBankQuestions
                .filter((item) => selectedSet.has(String(item.id)));
            if (!selectedQuestions.length) {
                notify('没有可导出的题目', true);
                return;
            }

            const libraryLookup = new Map(state.libraries.map((lib) => [String(lib.id), lib]));
            const librariesMap = new Map();

            selectedQuestions.forEach((question) => {
                const libId = String(question.library_id || '');
                if (!libId) return;
                if (!librariesMap.has(libId)) {
                    const libInfo = libraryLookup.get(libId) || {};
                    librariesMap.set(libId, {
                        id: libId,
                        title: libInfo.title || question.library_title || libId,
                        description: libInfo.description || '',
                        questions: []
                    });
                }
                const qType = normalizeQuestionType(question.type);
                let options = Array.isArray(question.options) ? question.options : [];
                if (qType === 'judge' && options.length < 2) {
                    options = ['正确', '错误'];
                }
                const answer = qType === 'multiple'
                    ? parseMultipleAnswerForExport(question.ans)
                    : String(question.ans ?? '');
                librariesMap.get(libId).questions.push({
                    question: String(question.q || ''),
                    type: qType,
                    options,
                    answer,
                    analysis: String(question.analysis || ''),
                    difficulty: toIntegerOrDefault(question.difficulty, 1),
                    chapter: String(question.chapter ?? question.knowledge_point ?? '').trim(),
                    updated_at: String(question.updated_at || '')
                });
            });

            const libraries = Array.from(librariesMap.values());
            const payload = {
                exported_at: new Date().toISOString(),
                library_count: libraries.length,
                question_count: selectedQuestions.length,
                libraries
            };

            const normalizedFormat = String(format || 'json').toLowerCase() === 'txt' ? 'txt' : 'json';
            const txtFields = normalizedFormat === 'txt' ? getExportTxtFields() : [];
            const extraFieldHint = normalizedFormat === 'txt'
                ? `，字段：${getExportTxtFieldLabels(txtFields).join('、')}`
                : '';
            const ok = await showConfirmDialog({
                title: '批量导出题目',
                message: `确认导出已选 ${payload.question_count} 道题为 ${normalizedFormat.toUpperCase()} 吗${extraFieldHint}？`,
                confirmText: '开始导出'
            });
            if (!ok) return;

            const filenameBase = `quiz-export-question-bank-selected-${payload.question_count}`;
            if (normalizedFormat === 'txt') {
                const text = buildTxtExportContent(payload, { fields: txtFields });
                downloadBlob(new Blob([text], { type: 'text/plain; charset=utf-8' }), `${filenameBase}.txt`);
                notify(`导出成功：${filenameBase}.txt`);
                return;
            }

            const jsonText = JSON.stringify(payload, null, 2);
            downloadBlob(new Blob([jsonText], { type: 'application/json; charset=utf-8' }), `${filenameBase}.json`);
            notify(`导出成功：${filenameBase}.json`);
        }

        async function loadQuestionBank() {
            state.questionBankLoading = true;
            renderQuestionBankList();
            try {
                const keyword = String(state.questionBankKeyword || '').trim();
                const query = keyword ? `?keyword=${encodeURIComponent(keyword)}` : '';
                const result = await api(`/questions${query}`);
                state.questionBankQuestions = Array.isArray(result.questions) ? result.questions : [];
                state.questionBankLastRefresh = new Date().toISOString();
            } catch (error) {
                state.questionBankQuestions = [];
                notify(`题库加载失败：${error.message}`, true);
            } finally {
                state.questionBankLoading = false;
                renderQuestionBankList();
                renderQuestionBankInfo();
            }
        }

        function applyGlobalSearchKeyword(keyword) {
            state.questionSearch = String(keyword || '');
            const questionSearchInput = $('question-search-input');
            if (questionSearchInput && questionSearchInput.value !== state.questionSearch) {
                questionSearchInput.value = state.questionSearch;
            }
            if (state.currentLibrary) {
                applyQuestionSearch();
            }
        }

        function renderLibraryPanelState() {
            const mainLayout = $('admin-layout-main');
            const panel = $('library-panel');
            const list = $('library-list');
            const toggleBtn = $('toggle-library-list-btn');
            const backdrop = $('library-panel-backdrop');
            const mobileToggleBtn = $('mobile-library-toggle-btn');
            if (!panel || !list || !toggleBtn) return;

            const mobile = isMobileViewport();
            if (!mobile) {
                state.libraryListCollapsed = false;
            }

            if (mainLayout) {
                mainLayout.classList.remove('layout-sidebar-collapsed');
            }
            panel.classList.remove('library-panel-collapsed');
            panel.classList.toggle('library-panel-mobile-open', mobile && !state.libraryListCollapsed);
            list.classList.remove('hidden');

            if (backdrop) {
                backdrop.classList.toggle('hidden', !(mobile && !state.libraryListCollapsed));
            }

            const label = state.libraryListCollapsed ? '展开题集侧边栏' : '折叠题集侧边栏';
            const icon = state.libraryListCollapsed
                ? '<path d="m9 18 6-6-6-6"></path>'
                : '<path d="m15 18-6-6 6-6"></path>';

            toggleBtn.title = label;
            toggleBtn.setAttribute('aria-label', label);
            toggleBtn.innerHTML = `
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    ${icon}
                </svg>
                <span class="sr-only">${label}</span>
            `;

            if (mobileToggleBtn) {
                const mobileLabel = state.libraryListCollapsed ? '展开题集侧边栏' : '收起题集侧边栏';
                mobileToggleBtn.title = mobileLabel;
                mobileToggleBtn.setAttribute('aria-label', mobileLabel);
                mobileToggleBtn.classList.toggle('is-open', !state.libraryListCollapsed);
                mobileToggleBtn.innerHTML = state.libraryListCollapsed
                    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6h16"></path><path d="M4 12h16"></path><path d="M4 18h16"></path></svg><span class="sr-only">展开题集侧边栏</span>'
                    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg><span class="sr-only">收起题集侧边栏</span>';
            }
        }

        function setLibraryListCollapsed(collapsed, remember = true) {
            state.libraryListCollapsed = Boolean(collapsed);
            if (remember) {
                localStorage.setItem(LIBRARY_PANEL_COLLAPSE_KEY, state.libraryListCollapsed ? '1' : '0');
            }
            renderLibraryPanelState();
        }

        function toggleLibraryListCollapsed() {
            setLibraryListCollapsed(!state.libraryListCollapsed);
        }

        function isDarkThemeActive() {
            const pref = getThemePreference();
            if (pref === 'dark') return true;
            if (pref === 'light') return false;
            return darkModeMedia.matches;
        }

        function updateThemeToggleButton() {
            const btn = $('theme-toggle');
            if (!btn) return;
            const isDark = document.body.classList.contains('theme-dark');
            const title = isDark ? '切换日间模式' : '切换夜间模式';
            const icon = isDark
                ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2"></path><path d="M12 20v2"></path><path d="m4.93 4.93 1.41 1.41"></path><path d="m17.66 17.66 1.41 1.41"></path><path d="M2 12h2"></path><path d="M20 12h2"></path><path d="m6.34 17.66-1.41 1.41"></path><path d="m19.07 4.93-1.41 1.41"></path></svg>`
                : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 1 0 9.8 9.8Z"></path></svg>`;
            btn.title = title;
            btn.setAttribute('aria-label', title);
            const label = btn.classList.contains('admin-menu-btn')
                ? '<span>切换主题</span>'
                : `<span class="sr-only">${title}</span>`;
            btn.innerHTML = `${icon}${label}`;
        }

        function syncThemeMode() {
            document.body.classList.toggle('theme-dark', isDarkThemeActive());
            updateThemeToggleButton();
        }

        function toggleThemeMode() {
            const next = document.body.classList.contains('theme-dark') ? 'light' : 'dark';
            setThemePreference(next);
            syncThemeMode();
            notify(next === 'dark' ? '已开启夜间模式' : '已切换日间模式');
        }

        function esc(value) {
            return String(value ?? '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        }

        function normalizeQuestionType(type) {
            const value = String(type || 'single').trim().toLowerCase();
            if (['multiple', 'multi', 'checkbox', '多选'].includes(value)) return 'multiple';
            if (['judge', 'true_false', 'truefalse', 'tf', '判断', '判断题'].includes(value)) return 'judge';
            if (['fill', 'blank', 'fill_blank', '填空', '填空题'].includes(value)) return 'fill';
            if (['qa', 'essay', 'short_answer', '问答', '问答题', '简答', '简答题'].includes(value)) return 'qa';
            return 'single';
        }

        function getAnswerLabelText(type) {
            return '答案';
        }

        function formatAnswerForEditor(type, answer) {
            if (type === 'multiple') {
                if (Array.isArray(answer)) return answer.join(',');
            }
            if (type === 'fill' && Array.isArray(answer)) return answer.join('|');
            return String(answer ?? '');
        }

        function buildAiGeneratePayloadFromCard(card) {
            const isBank = card.classList.contains('question-bank-edit-card');
            const prefix = isBank ? 'qb' : 'q';
            const questionInput = card.querySelector(`.${prefix}-question`);
            const optionsInput = card.querySelector(`.${prefix}-options`);
            const typeInput = card.querySelector(`.${prefix}-type`);
            if (!questionInput || !optionsInput || !typeInput) {
                throw new Error('题目内容不完整');
            }
            const type = normalizeQuestionType(typeInput.value || 'single');
            let options = optionsInput.value
                .split('\n')
                .map((item) => item.trim())
                .filter(Boolean);
            if (type === 'judge' && !options.length) {
                options = ['正确', '错误'];
            }
            if (type === 'fill' || type === 'qa') {
                options = [];
            }
            return {
                question: questionInput.value.trim(),
                type,
                options
            };
        }

        function applyAiGenerateResult(card, result) {
            const isBank = card.classList.contains('question-bank-edit-card');
            const prefix = isBank ? 'qb' : 'q';
            const answerInput = card.querySelector(`.${prefix}-answer`);
            const analysisInput = card.querySelector(`.${prefix}-analysis`);
            const knowledgeInput = card.querySelector(`.${prefix}-knowledge`);
            if (answerInput && typeof result.answer === 'string' && result.answer.trim()) {
                answerInput.value = result.answer.trim();
            }
            if (analysisInput && typeof result.analysis === 'string' && result.analysis.trim()) {
                analysisInput.value = result.analysis.trim();
            }
            if (knowledgeInput && typeof result.chapter === 'string' && result.chapter.trim()) {
                knowledgeInput.value = result.chapter.trim();
            }
        }

        async function runAiGenerateForPreviewItem({ question, type, options }, button, onApply, optionsArg = {}) {
            if (!question || !String(question).trim()) {
                notify('题目不能为空', true);
                return false;
            }
            const silent = Boolean(optionsArg.silent);
            try {
                if (button) {
                    button.disabled = true;
                    button.dataset.loading = '1';
                    button.innerText = '生成中...';
                }
                const result = await api('/ai-generate', {
                    method: 'POST',
                    body: JSON.stringify({
                        question: String(question).trim(),
                        type: normalizeQuestionType(type || 'single'),
                        options: Array.isArray(options) ? options : []
                    })
                });
                if (onApply) onApply(result || {});
                if (!silent) {
                    notify('AI 生成完成');
                }
                return true;
            } catch (error) {
                if (!silent) {
                    notify(error.message || 'AI 生成失败', true);
                }
                return false;
            } finally {
                if (button) {
                    button.disabled = false;
                    button.dataset.loading = '0';
                    button.innerText = 'AI生成';
                }
            }
        }

        function shouldAiGenerateItem(item) {
            const answerEmpty = !item?.answer || !String(item.answer).trim();
            const analysisEmpty = !item?.analysis || !String(item.analysis).trim();
            const chapterEmpty = !item?.chapter || !String(item.chapter).trim();
            return answerEmpty || analysisEmpty || chapterEmpty;
        }

        async function runBatchAiGenerateItems(tasks, applyResult, onProgress, buttonLabel) {
            const total = tasks.length;
            let completed = 0;
            let successCount = 0;
            for (let i = 0; i < total; i += AI_BATCH_CHUNK_SIZE) {
                const slice = tasks.slice(i, i + AI_BATCH_CHUNK_SIZE);
                if (onProgress) onProgress(Math.min(i + slice.length, total), total);
                const response = await api('/ai-generate-batch', {
                    method: 'POST',
                    body: JSON.stringify({
                        items: slice.map((task) => ({
                            question: task.item.question,
                            type: task.item.type,
                            options: task.item.options
                        }))
                    })
                });
                const items = Array.isArray(response?.items) ? response.items : [];
                slice.forEach((task, idx) => {
                    const result = items[idx] || {};
                    applyResult(task, result);
                    if (result.answer || result.analysis || result.chapter) {
                        successCount += 1;
                    }
                    completed += 1;
                });
                if (onProgress) onProgress(completed, total);
            }
            if (buttonLabel) {
                buttonLabel(successCount, total);
            }
            return successCount;
        }

        async function runBatchAiGenerateCollector(button) {
            if (!state.collectorPayload) {
                notify('暂无可生成的题目', true);
                return;
            }
            const tasks = [];
            state.collectorPayload.libraries.forEach((lib, libIndex) => {
                (lib.questions || []).forEach((item, questionIndex) => {
                    if (!item?.question) return;
                    if (shouldAiGenerateItem(item)) {
                        tasks.push({ libIndex, questionIndex, item });
                    }
                });
            });
            if (!tasks.length) {
                notify('没有需要生成的题目');
                return;
            }
            if (button) {
                button.disabled = true;
            }
            const successCount = await runBatchAiGenerateItems(
                tasks,
                (task, result) => {
                    if (result.answer) task.item.answer = result.answer;
                    if (result.analysis) task.item.analysis = result.analysis;
                    if (result.chapter) task.item.chapter = result.chapter;
                },
                (completed, total) => {
                    if (button) button.innerText = `生成中 ${completed}/${total}`;
                }
            );
            if (button) {
                button.disabled = false;
                button.innerText = '批量AI生成';
            }
            renderCollectorPreview(state.collectorPayload, state.collectorFilename);
            notify(`批量生成完成：${successCount} 道题`);
        }

        async function runBatchAiGenerateImportJson(button) {
            if (!state.importJsonPayload) {
                notify('暂无可生成的题目', true);
                return;
            }
            const tasks = [];
            state.importJsonPayload.libraries.forEach((lib, libIndex) => {
                (lib.questions || []).forEach((item, questionIndex) => {
                    if (!item?.question) return;
                    if (shouldAiGenerateItem(item)) {
                        tasks.push({ libIndex, questionIndex, item });
                    }
                });
            });
            if (!tasks.length) {
                notify('没有需要生成的题目');
                return;
            }
            if (button) button.disabled = true;
            const successCount = await runBatchAiGenerateItems(
                tasks,
                (task, result) => {
                    if (result.answer) task.item.answer = result.answer;
                    if (result.analysis) task.item.analysis = result.analysis;
                    if (result.chapter) task.item.chapter = result.chapter;
                },
                (completed, total) => {
                    if (button) button.innerText = `生成中 ${completed}/${total}`;
                }
            );
            if (button) {
                button.disabled = false;
                button.innerText = '批量AI生成';
            }
            renderImportJsonPreview();
            notify(`批量生成完成：${successCount} 道题`);
        }

        async function runBatchAiGenerateImportDoc(button) {
            if (!state.importDocQuestions.length) {
                notify('暂无可生成的题目', true);
                return;
            }
            const tasks = state.importDocQuestions
                .map((item, index) => ({ item, index }))
                .filter(({ item }) => item?.question && shouldAiGenerateItem(item));
            if (!tasks.length) {
                notify('没有需要生成的题目');
                return;
            }
            if (button) button.disabled = true;
            const successCount = await runBatchAiGenerateItems(
                tasks,
                (task, result) => {
                    if (result.answer) task.item.answer = result.answer;
                    if (result.analysis) task.item.analysis = result.analysis;
                    if (result.chapter) task.item.chapter = result.chapter;
                },
                (completed, total) => {
                    if (button) button.innerText = `生成中 ${completed}/${total}`;
                }
            );
            if (button) {
                button.disabled = false;
                button.innerText = '批量AI生成';
            }
            renderImportDocPreview();
            notify(`批量生成完成：${successCount} 道题`);
        }

        async function runAiGenerateForCard(card, button) {
            try {
                const payload = buildAiGeneratePayloadFromCard(card);
                if (!payload.question) {
                    notify('题目不能为空', true);
                    return;
                }
                if (button) {
                    button.disabled = true;
                    button.dataset.loading = '1';
                    button.innerText = '生成中...';
                }
                const result = await api('/ai-generate', {
                    method: 'POST',
                    body: JSON.stringify(payload)
                });
                applyAiGenerateResult(card, result || {});
                notify('AI 生成完成');
            } catch (error) {
                notify(error.message || 'AI 生成失败', true);
            } finally {
                if (button) {
                    button.disabled = false;
                    button.dataset.loading = '0';
                    button.innerText = 'AI生成';
                }
            }
        }

        function getQuestionTypeText(type) {
            const normalized = normalizeQuestionType(type);
            if (normalized === 'multiple') return '多选题';
            if (normalized === 'judge') return '判断题';
            if (normalized === 'fill') return '填空题';
            if (normalized === 'qa') return '问答题';
            return '单选题';
        }

        function normalizeQuestionForImport(raw, normalizeOptions = {}) {
            if (!raw) return null;
            const allowEmptyAnswer = Boolean(normalizeOptions.allowEmptyAnswer);
            const question = String(raw.question || raw.q || '').trim();
            if (!question) return null;
            const type = normalizeQuestionType(raw.type || 'single');
            let questionOptions = Array.isArray(raw.options) ? raw.options : [];
            questionOptions = questionOptions.map((item) => String(item ?? '').trim()).filter(Boolean);
            if (type === 'judge' && questionOptions.length === 0) {
                questionOptions = ['正确', '错误'];
            }
            if (type === 'fill' || type === 'qa') {
                questionOptions = [];
            }
            const answer = String(raw.answer ?? raw.ans ?? '').trim();
            if (!answer && !allowEmptyAnswer) return null;
            if ((type === 'single' || type === 'multiple') && questionOptions.length < 2) return null;
            return {
                question,
                type,
                options: questionOptions,
                answer,
                analysis: String(raw.analysis || '').trim(),
                difficulty: toIntegerOrDefault(raw.difficulty, 1),
                chapter: String(raw.chapter || raw.knowledge_point || '').trim()
            };
        }

        function filterLibrariesForImport(payload, options = {}) {
            const libs = payload.libraries || [];
            const filtered = [];
            let total = 0;
            let ready = 0;
            libs.forEach((lib) => {
                const questions = Array.isArray(lib.questions) ? lib.questions : [];
                total += questions.length;
                const readyQuestions = questions
                    .map((question) => normalizeQuestionForImport(question, options))
                    .filter(Boolean);
                ready += readyQuestions.length;
                if (readyQuestions.length) {
                    filtered.push({
                        id: lib.id,
                        title: lib.title,
                        icon: lib.icon,
                        description: lib.description,
                        questions: readyQuestions
                    });
                }
            });
            return { libraries: filtered, total, ready };
        }

        function getDifficultyText(rawDifficulty) {
            const difficulty = toIntegerOrDefault(rawDifficulty, 1);
            if (difficulty <= 1) return '简单';
            if (difficulty === 2) return '适中';
            return '较难';
        }

        function getDifficultyClass(rawDifficulty) {
            const difficulty = toIntegerOrDefault(rawDifficulty, 1);
            if (difficulty <= 1) return 'text-emerald-600';
            if (difficulty === 2) return 'text-amber-600';
            return 'text-rose-600';
        }

        function toOptionLetter(index) {
            const num = Number.parseInt(String(index ?? '').trim(), 10);
            if (!Number.isFinite(num) || num < 0) return String(index ?? '');
            return String.fromCharCode(65 + num);
        }

        function formatAnswerForList(type, answer) {
            const normalized = normalizeQuestionType(type);
            if (normalized === 'multiple') {
                const items = Array.isArray(answer)
                    ? answer
                    : String(answer || '').split(/[\s,，/|]+/).filter(Boolean);
                return items.map((item) => toOptionLetter(item)).join(',');
            }
            if (normalized === 'judge') {
                const token = String(answer ?? '').trim().toLowerCase();
                if (['0', 'a', '正确', '对', 'true', 't', 'yes', 'y', '√'].includes(token)) return '正确';
                if (['1', 'b', '错误', '错', 'false', 'f', 'no', 'n', '×', 'x'].includes(token)) return '错误';
            }
            if (normalized === 'fill') {
                return String(answer ?? '').split(/[\|｜]/).map((item) => item.trim()).filter(Boolean).join(' | ');
            }
            if (normalized === 'qa') {
                return String(answer ?? '');
            }
            return toOptionLetter(answer);
        }

        function formatEditTime(rawTime) {
            const text = String(rawTime || '').trim();
            if (!text) return '--';
            const normalized = text.includes('T') ? text : text.replace(' ', 'T');
            const withTimezone = /([zZ]|[+-]\d{2}:?\d{2})$/.test(normalized) ? normalized : `${normalized}Z`;
            const date = new Date(withTimezone);
            if (Number.isNaN(date.getTime())) return text;
            return date.toLocaleString('zh-CN', { hour12: false });
        }

        function updateQuestionCardTypeUI(card) {
            if (!card) return;
            const typeSelect = card.querySelector('.q-type');
            const answerLabel = card.querySelector('.q-answer-label');
            const answerInput = card.querySelector('.q-answer');
            const optionsInput = card.querySelector('.q-options');
            const optionsWrap = card.querySelector('.q-options-wrap');
            if (!typeSelect) return;

            const type = normalizeQuestionType(typeSelect.value);
            if (answerLabel) {
                answerLabel.innerText = getAnswerLabelText(type);
            }
            if (answerInput) {
                if (type === 'multiple') {
                    answerInput.placeholder = '如 A,C';
                } else if (type === 'judge') {
                    answerInput.placeholder = '如 对 / 正确 / √';
                } else if (type === 'fill') {
                    answerInput.placeholder = '多个答案用 | 分隔，如 红楼梦|水浒传';
                } else if (type === 'qa') {
                    answerInput.placeholder = '请输入参考答案';
                } else {
                    answerInput.placeholder = '如 A';
                }
            }
            if (optionsWrap) {
                optionsWrap.classList.toggle('hidden', type === 'fill' || type === 'qa');
            }
            if (optionsInput) {
                if (type === 'judge' && !optionsInput.value.trim()) {
                    optionsInput.value = '正确\n错误';
                }
                if (type === 'fill' || type === 'qa') {
                    optionsInput.value = '';
                    optionsInput.placeholder = '该题型无需选项';
                } else {
                    optionsInput.placeholder = type === 'judge' ? '判断题建议：正确 与 错误 每行一个' : '每行一个选项';
                }
            }
        }

        function notify(message, isError = false) {
            const el = $('notice');
            el.textContent = message;
            el.className = `mx-6 mt-4 px-4 py-3 rounded-lg text-sm font-medium ${
                isError ? 'bg-rose-50 text-rose-600 border border-rose-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
            }`;
            el.classList.remove('hidden');
            clearTimeout(notify.timer);
            notify.timer = setTimeout(() => el.classList.add('hidden'), 2400);
        }

        function normalizeSearchText(text) {
            return String(text ?? '').trim().toLowerCase();
        }

        function buildQuestionSearchText(card) {
            const payload = [
                card.getAttribute('data-question-id'),
                card.querySelector('.q-question')?.value || '',
                card.querySelector('.q-options')?.value || '',
                card.querySelector('.q-type')?.value || '',
                card.querySelector('.q-analysis')?.value || '',
                card.querySelector('.q-knowledge')?.value || '',
                card.querySelector('.q-answer')?.value || ''
            ].join(' ');
            return normalizeSearchText(payload);
        }

        function applyQuestionSearch() {
            const root = $('editor');
            if (!root || root.classList.contains('hidden')) return;

            const query = normalizeSearchText(state.questionSearch);
            const selectedType = String(state.questionTypeFilter || 'all');
            const selectedKnowledge = String(state.questionKnowledgeFilter || 'all');
            const selectedDifficulty = String(state.questionDifficultyFilter || 'all');
            const rows = Array.from(root.querySelectorAll('[data-question-filter-row]'));
            let visibleCount = 0;

            rows.forEach((row) => {
                const rowType = String(row.dataset.questionType || '');
                const rowKnowledge = String(row.dataset.questionKnowledge || '');
                const rowDifficulty = String(row.dataset.questionDifficulty || '');
                const rowSearch = normalizeSearchText(row.dataset.questionSearch || '');
                const rowId = row.dataset.questionId;
                const editRow = rowId ? root.querySelector(`[data-edit-row-id="${rowId}"]`) : null;
                const checkbox = row.querySelector('.question-row-check');

                const typeMatch = selectedType === 'all' || rowType === selectedType;
                const knowledgeMatch = selectedKnowledge === 'all' || rowKnowledge === selectedKnowledge;
                const difficultyMatch = selectedDifficulty === 'all' || rowDifficulty === selectedDifficulty;
                const keywordMatch = !query || rowSearch.includes(query);
                const matched = typeMatch && knowledgeMatch && difficultyMatch && keywordMatch;

                row.classList.toggle('hidden', !matched);
                if (editRow) {
                    editRow.classList.toggle('hidden', !matched || !editRow.dataset.expanded);
                }
                if (!matched && checkbox) {
                    checkbox.checked = false;
                }
                if (matched) visibleCount += 1;
            });

            const totalCount = rows.length;
            const emptyHint = $('question-search-empty');
            if (emptyHint) {
                emptyHint.classList.toggle('hidden', visibleCount !== 0);
            }

            const checkAll = $('question-check-all');
            if (checkAll) {
                const visibleRows = rows.filter((row) => !row.classList.contains('hidden'));
                const checkedVisible = visibleRows.filter((row) => row.querySelector('.question-row-check')?.checked);
                checkAll.checked = visibleRows.length > 0 && checkedVisible.length === visibleRows.length;
            }
            syncSelectedQuestionCount();
        }

        function parseImportLibraries(payload) {
            if (Array.isArray(payload)) return payload;
            if (payload && typeof payload === 'object') {
                if (Array.isArray(payload.libraries)) return payload.libraries;
                if (['id', 'title', 'questions'].some((key) => key in payload)) return [payload];
            }
            throw new Error('JSON 顶层需为题集数组，或包含 libraries 字段');
        }

        function normalizeImportOptions(raw) {
            if (Array.isArray(raw)) {
                return raw.map((item) => String(item ?? '').trim()).filter(Boolean);
            }
            if (typeof raw === 'string') {
                return raw.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
            }
            return [];
        }

        function normalizeImportPayload(payload) {
            const libraries = parseImportLibraries(payload);
            return {
                libraries: libraries.map((lib) => {
                    const questions = Array.isArray(lib.questions) ? lib.questions : [];
                    return {
                        id: String(lib.id || '').trim(),
                        title: String(lib.title || '未命名题集').trim(),
                        icon: String(lib.icon || '📚').trim() || '📚',
                        description: String(lib.description || '').trim(),
                        questions: questions.map((q) => ({
                            question: String(q.question || q.q || '').trim(),
                            type: normalizeQuestionType(q.type || 'single'),
                            options: normalizeImportOptions(q.options || q.opts || []),
                            answer: q.answer ?? q.ans ?? '',
                            analysis: q.analysis ?? '',
                            difficulty: toIntegerOrDefault(q.difficulty, 1),
                            chapter: String(q.chapter || q.knowledge_point || '').trim()
                        }))
                    };
                })
            };
        }

        function getImportTargetLibraryId() {
            if (state.currentLibrary && state.currentLibrary.id) return state.currentLibrary.id;
            if (state.libraries[0] && state.libraries[0].id) return state.libraries[0].id;
            return '';
        }

        function renderImportLibrarySelect(selectId, selectedValue) {
            const el = $(selectId);
            if (!el) return;
            const fallback = selectedValue || el.value || getImportTargetLibraryId();
            const options = state.libraries.map((lib) => {
                const selected = fallback === lib.id ? 'selected' : '';
                return `<option value="${esc(lib.id)}" ${selected}>${esc(lib.icon)} ${esc(lib.title)} (${esc(lib.id)})</option>`;
            });
            if (!options.length) {
                el.innerHTML = '<option value="">暂无题集，请先创建题集</option>';
                return;
            }
            el.innerHTML = options.join('');
        }

        function switchImportTab(nextTab) {
            const tab = IMPORT_TAB_IDS.includes(nextTab) ? nextTab : 'json';
            state.importModalTab = tab;

            IMPORT_TAB_IDS.forEach((item) => {
                const panel = $(`import-panel-${item}`);
                const btn = document.querySelector(`[data-import-tab="${item}"]`);
                if (panel) panel.classList.toggle('hidden', item !== tab);
                if (btn) btn.classList.toggle('active', item === tab);
            });
        }

        function openImportModal(defaultTab = 'json') {
            renderImportLibrarySelect('import-doc-library');
            renderImportLibrarySelect('import-single-library');
            switchImportTab(defaultTab);
            $('import-modal').classList.remove('hidden');
            renderImportJsonPreview();
            renderImportDocPreview();
            updateSingleImportTypeUI();
        }

        function closeImportModal() {
            if (isAdminPage('import')) {
                resetImportWorkflowState();
                renderImportJsonPreview();
                renderImportDocPreview();
                return;
            }
            $('import-modal').classList.add('hidden');
        }

        function normalizeExportTxtFields(rawFields) {
            const values = Array.isArray(rawFields) ? rawFields : [];
            const normalized = values
                .map((item) => String(item || '').trim())
                .filter((item) => EXPORT_TXT_FIELDS.includes(item));
            const unique = Array.from(new Set(normalized));
            if (!unique.length) return [...EXPORT_TXT_DEFAULT_FIELDS];
            return unique;
        }

        function getExportTxtFieldLabel(field) {
            return EXPORT_TXT_FIELD_LABELS[field] || field;
        }

        function readExportTxtFieldsFromControls() {
            const checked = Array.from(document.querySelectorAll('.export-txt-field-check:checked'))
                .map((input) => String(input.value || '').trim());
            state.exportTxtFields = normalizeExportTxtFields(checked);
            const selected = new Set(state.exportTxtFields);
            document.querySelectorAll('.export-txt-field-check').forEach((input) => {
                input.checked = selected.has(String(input.value || '').trim());
            });
        }

        function syncExportTxtFieldControls() {
            const selected = new Set(normalizeExportTxtFields(state.exportTxtFields));
            document.querySelectorAll('.export-txt-field-check').forEach((input) => {
                input.checked = selected.has(String(input.value || '').trim());
            });
        }

        function getExportTxtFields() {
            return normalizeExportTxtFields(state.exportTxtFields);
        }

        function getExportTxtFieldLabels(fields = getExportTxtFields()) {
            return normalizeExportTxtFields(fields).map((field) => getExportTxtFieldLabel(field));
        }

        function getExportLibrarySummary(libraryValue) {
            const allQuestionCount = state.libraries.reduce(
                (sum, lib) => sum + toIntegerOrDefault(lib.question_count, 0),
                0
            );
            if (!libraryValue || libraryValue === '__all__') {
                return {
                    libraryId: '',
                    label: '全部题集',
                    libraryCount: state.libraries.length,
                    questionCount: allQuestionCount
                };
            }

            const target = state.libraries.find((lib) => lib.id === libraryValue);
            if (!target) {
                return {
                    libraryId: '',
                    label: '全部题集',
                    libraryCount: state.libraries.length,
                    questionCount: allQuestionCount
                };
            }
            return {
                libraryId: target.id,
                label: `题集「${target.title}」`,
                libraryCount: 1,
                questionCount: toIntegerOrDefault(target.question_count, 0)
            };
        }

        function renderExportLibrarySelect(selectId, selectedValue) {
            const el = $(selectId);
            if (!el) return;
            let fallback = selectedValue || el.value || (state.currentLibrary?.id || '__all__');
            if (fallback !== '__all__' && !state.libraries.some((lib) => lib.id === fallback)) {
                fallback = '__all__';
            }
            const rows = [
                `<option value="__all__" ${fallback === '__all__' ? 'selected' : ''}>全部题集</option>`,
                ...state.libraries.map((lib) => {
                    const selected = fallback === lib.id ? 'selected' : '';
                    return `<option value="${esc(lib.id)}" ${selected}>${esc(lib.icon)} ${esc(lib.title)} (${lib.question_count}题)</option>`;
                })
            ];
            el.innerHTML = rows.join('');
        }

        function refreshExportModalState(selectedValue) {
            const fallback = selectedValue || state.currentLibrary?.id || '__all__';
            renderExportLibrarySelect('export-json-library', fallback);
            renderExportLibrarySelect('export-txt-library', fallback);
            syncExportTxtFieldControls();
            const exportModal = $('export-modal');
            if (exportModal && !exportModal.classList.contains('hidden')) {
                renderExportPreview(state.exportModalTab || 'json');
            }
        }

        function renderExportPreview(format) {
            const selectId = format === 'txt' ? 'export-txt-library' : 'export-json-library';
            const previewId = format === 'txt' ? 'export-txt-preview' : 'export-json-preview';
            const root = $(previewId);
            if (!root) return;
            const summary = getExportLibrarySummary($(selectId)?.value || '__all__');
            const formatLabel = format === 'txt' ? 'TXT 文档' : 'JSON 文件';
            const desc = format === 'txt'
                ? '纯文本导出，适合阅读和打印。'
                : '结构化导出，适合备份和迁移。';
            const txtFields = format === 'txt' ? getExportTxtFields() : [];
            const txtFieldText = format === 'txt'
                ? `<p>导出字段：<strong>${esc(getExportTxtFieldLabels(txtFields).join('、'))}</strong></p>`
                : '';
            root.innerHTML = `
                <div class="space-y-2">
                    <p>导出格式：<strong>${formatLabel}</strong></p>
                    <p>导出范围：<strong>${esc(summary.label)}</strong></p>
                    ${txtFieldText}
                    <p>题集数：<strong>${summary.libraryCount}</strong>，题目数：<strong>${summary.questionCount}</strong></p>
                    <p class="text-xs text-slate-400">${desc}</p>
                </div>
            `;
        }

        function switchExportTab(nextTab) {
            const tab = EXPORT_TAB_IDS.includes(nextTab) ? nextTab : 'json';
            state.exportModalTab = tab;
            EXPORT_TAB_IDS.forEach((item) => {
                const panel = $(`export-panel-${item}`);
                const btn = document.querySelector(`[data-export-tab="${item}"]`);
                if (panel) panel.classList.toggle('hidden', item !== tab);
                if (btn) btn.classList.toggle('active', item === tab);
            });
            renderExportPreview(tab);
        }

        function openExportModal(defaultTab = 'json') {
            refreshExportModalState(state.currentLibrary?.id || '__all__');
            switchExportTab(defaultTab);
            $('export-modal').classList.remove('hidden');
        }

        function closeExportModal() {
            if (isAdminPage('export')) {
                refreshExportModalState(state.currentLibrary?.id || '__all__');
                return;
            }
            $('export-modal').classList.add('hidden');
        }

        function maybeOpenStandaloneModal() {
            if (hasAutoOpenedStandaloneModal) return;
            if (isAdminPage('import')) {
                hasAutoOpenedStandaloneModal = true;
                openImportEntry('json');
                return;
            }
            if (isAdminPage('export')) {
                hasAutoOpenedStandaloneModal = true;
                openExportEntry('json');
            }
        }

        function renderImportJsonPreview() {
            const previewRoot = $('import-json-preview');
            if (!previewRoot) return;
            const preview = state.importJsonPreview;
            if (!preview) {
                previewRoot.innerHTML = '<p>请选择文件后进行检查</p>';
                return;
            }
            if (preview.error) {
                previewRoot.innerHTML = `<p class="text-rose-600">${esc(preview.error)}</p>`;
                return;
            }
            if (!state.importJsonPayload) {
                previewRoot.innerHTML = '<p>预览数据为空，请重新选择文件。</p>';
                return;
            }

            const payload = state.importJsonPayload;
            const totalQuestions = payload.libraries.reduce((sum, lib) => sum + lib.questions.length, 0);
            const typeOptions = [
                { value: 'single', label: '单选题' },
                { value: 'multiple', label: '多选题' },
                { value: 'judge', label: '判断题' },
                { value: 'fill', label: '填空题' },
                { value: 'qa', label: '问答题' }
            ];

            const libsHtml = payload.libraries.map((lib, libIndex) => {
                const questionsHtml = lib.questions.map((q, qIndex) => {
                    const key = `${libIndex}-${qIndex}`;
                    const isExpanded = Boolean(state.previewExpanded.importJson[key]);
                    const summary = `${getQuestionTypeText(q.type)} · ${Array.isArray(q.options) ? q.options.length : 0} 选项`;
                    return `
                        <article class="import-edit-card border rounded-xl p-3 bg-slate-50/70" data-import-json-lib="${libIndex}" data-import-json-question="${qIndex}">
                            <div class="import-row flex items-center gap-3">
                                <button type="button" class="import-json-expand-btn text-xs font-semibold px-2 py-1 rounded-lg bg-slate-100 text-slate-600" data-import-json-lib="${libIndex}" data-import-json-question="${qIndex}">
                                    ${isExpanded ? '收起' : '展开'}
                                </button>
                                <div class="flex-1 min-w-0">
                                    <div class="text-sm font-semibold text-slate-700 truncate">${esc(q.question || `题目 ${qIndex + 1}`)}</div>
                                    <div class="text-xs text-slate-400">${esc(summary)}</div>
                                </div>
                                <button type="button" class="import-json-ai-btn text-xs font-semibold px-2 py-1 rounded-lg bg-slate-900 text-white" data-import-json-lib="${libIndex}" data-import-json-question="${qIndex}">AI生成</button>
                                <button type="button" class="import-json-delete-btn text-rose-600 text-xs font-semibold" data-import-json-lib="${libIndex}" data-import-json-question="${qIndex}">删除</button>
                            </div>
                            ${isExpanded ? `
                                <div class="mt-3 border-t border-slate-200/70 pt-3">
                                    <label class="block text-sm mb-3">
                                        <span class="text-slate-500">题目</span>
                                        <textarea class="w-full mt-1 px-3 py-2 rounded-lg border bg-white min-h-[88px]" data-import-json-field="question">${esc(q.question)}</textarea>
                                    </label>
                                    <div class="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
                                        <label class="block text-sm">
                                            <span class="text-slate-500">题型</span>
                                            <select class="w-full mt-1 px-3 py-2 rounded-lg border bg-white" data-import-json-field="type">
                                                ${typeOptions.map((item) => `<option value="${item.value}" ${q.type === item.value ? 'selected' : ''}>${item.label}</option>`).join('')}
                                            </select>
                                        </label>
                                        <label class="block text-sm">
                                            <span class="text-slate-500">难度</span>
                                            <input type="number" min="1" max="5" class="w-full mt-1 px-3 py-2 rounded-lg border bg-white" data-import-json-field="difficulty" value="${esc(String(q.difficulty || 1))}">
                                        </label>
                                        <label class="block text-sm">
                                            <span class="text-slate-500">章节</span>
                                            <input class="w-full mt-1 px-3 py-2 rounded-lg border bg-white" data-import-json-field="chapter" value="${esc(q.chapter || '')}">
                                        </label>
                                    </div>
                                    <label class="block text-sm mb-3">
                                        <span class="text-slate-500">选项（每行一个）</span>
                                        <textarea class="w-full mt-1 px-3 py-2 rounded-lg border bg-white min-h-[88px]" data-import-json-field="options">${esc(q.options.join('\n'))}</textarea>
                                    </label>
                                    <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                                        <label class="block text-sm">
                                            <span class="text-slate-500">${getAnswerLabelText(q.type)}</span>
                                            <input class="w-full mt-1 px-3 py-2 rounded-lg border bg-white" data-import-json-field="answer" value="${esc(formatAnswerForEditor(q.type, q.answer))}">
                                        </label>
                                        <label class="block text-sm">
                                            <span class="text-slate-500">解析</span>
                                            <textarea class="w-full mt-1 px-3 py-2 rounded-lg border bg-white min-h-[88px]" data-import-json-field="analysis">${esc(String(q.analysis || ''))}</textarea>
                                        </label>
                                    </div>
                                </div>
                            ` : ''}
                        </article>
                    `;
                }).join('');

                return `
                    <section class="import-edit-lib border rounded-xl p-4 bg-white/95">
                        <div class="flex flex-wrap items-center gap-3 mb-3">
                            <label class="block text-xs">
                                <span class="text-slate-500">题集名称</span>
                                <input class="mt-1 px-3 py-2 rounded-lg border bg-white text-sm" data-import-json-lib-field="title" data-import-json-lib="${libIndex}" value="${esc(lib.title)}">
                            </label>
                            <label class="block text-xs">
                                <span class="text-slate-500">题集 ID</span>
                                <input class="mt-1 px-3 py-2 rounded-lg border bg-white text-sm" data-import-json-lib-field="id" data-import-json-lib="${libIndex}" value="${esc(lib.id || '')}">
                            </label>
                            <label class="block text-xs">
                                <span class="text-slate-500">图标</span>
                                <input class="mt-1 px-3 py-2 rounded-lg border bg-white text-sm w-24" data-import-json-lib-field="icon" data-import-json-lib="${libIndex}" value="${esc(lib.icon || '📚')}">
                            </label>
                        </div>
                        <label class="block text-sm mb-3">
                            <span class="text-slate-500">题集描述</span>
                            <textarea class="w-full mt-1 px-3 py-2 rounded-lg border bg-white min-h-[70px]" data-import-json-lib-field="description" data-import-json-lib="${libIndex}">${esc(lib.description || '')}</textarea>
                        </label>
                        <div class="text-xs text-slate-400 mb-3">共 ${lib.questions.length} 题</div>
                        <div class="space-y-3">${questionsHtml || '<div class="text-sm text-slate-400">暂无题目</div>'}</div>
                    </section>
                `;
            }).join('');

            previewRoot.innerHTML = `
                <div class="mb-3 text-sm flex flex-wrap items-center gap-2 justify-between">
                    <div>
                        <p>共检测到 <strong>${payload.libraries.length}</strong> 个题集，<strong>${totalQuestions}</strong> 道题。</p>
                        <p class="text-xs text-slate-400 mt-1">文件：${esc(preview.filename || '')}</p>
                    </div>
                    <button type="button" class="import-json-ai-batch px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-semibold">批量AI生成</button>
                </div>
                <div class="space-y-4">${libsHtml}</div>
            `;
        }

        function toIntegerOrDefault(raw, fallback = 1) {
            const value = Number.parseInt(String(raw ?? '').trim(), 10);
            return Number.isFinite(value) ? value : fallback;
        }

        function stripOptionPrefix(optionText) {
            return String(optionText || '').trim().replace(/^[A-Ha-h][\.\、\)\s]+/, '').trim();
        }

        function normalizeOptionLines(rawText) {
            return String(rawText || '')
                .split('\n')
                .map((line) => stripOptionPrefix(line))
                .filter(Boolean);
        }

        function splitAnswerTokens(rawAnswer) {
            const text = String(rawAnswer || '').trim();
            let tokens = text.split(/[\s,，/|]+/).filter(Boolean);
            if (tokens.length === 1 && /^[A-Za-z]{2,}$/.test(tokens[0])) {
                tokens = tokens[0].split('');
            }
            return tokens;
        }

        function parseAnswerIndexToken(token, optionCount) {
            const text = String(token || '').trim().replace(/[。；;]+$/g, '');
            if (!text) throw new Error('答案不能为空');
            if (/^[A-Za-z]$/.test(text)) {
                const index = text.toUpperCase().charCodeAt(0) - 65;
                if (index < 0 || index >= optionCount) throw new Error('答案超出选项范围');
                return index;
            }
            if (/^-?\d+$/.test(text)) {
                const index = Number.parseInt(text, 10);
                if (index < 0 || index >= optionCount) throw new Error('答案超出选项范围');
                return index;
            }
            throw new Error('答案格式不正确');
        }

        function normalizeJudgeAnswer(rawAnswer) {
            const token = String(rawAnswer || '').trim().replace(/[。；;]+$/g, '').toLowerCase();
            if (['a', '0', '正确', '对', 'true', 't', 'yes', 'y', '√'].includes(token)) return '0';
            if (['b', '1', '错误', '错', 'false', 'f', 'no', 'n', '×', 'x'].includes(token)) return '1';
            return null;
        }

        function parseQuestionDocument(text) {
            const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
            const questions = [];
            let currentType = '';
            let current = null;

            const detectTypeHeader = (line) => {
                let normalized = String(line || '').trim();
                if (!normalized) return '';
                normalized = normalized.replace(/\s+/g, '');
                normalized = normalized.replace(/^[#>*\-\s]+/, '');
                normalized = normalized.replace(/^(?:第?[一二三四五六七八九十\d]+(?:部分|章|节|类)?[、\.\)）:：]?)/, '');
                normalized = normalized.replace(/^[（(【\[]?[一二三四五六七八九十\d]+[）)】\]]?[、\.\)）:：]?/, '');
                normalized = normalized.replace(/^(?:题型|类型)[:：]?/, '');
                normalized = normalized.replace(/(?:（[^）]*）|\([^)]*\)|【[^】]*】|\[[^\]]*\])$/g, '');

                if (/^(?:单选题|单项选择题|single|singlechoice)$/i.test(normalized)) return 'single';
                if (/^(?:多选题|多项选择题|multiple|multiplechoice)$/i.test(normalized)) return 'multiple';
                if (/^(?:判断题|是非题|truefalse|judge)$/i.test(normalized)) return 'judge';
                if (/^(?:填空题|fill|fillblank|fillintheblank)$/i.test(normalized)) return 'fill';
                if (/^(?:问答题|简答题|主观题|qa|essay|shortanswer)$/i.test(normalized)) return 'qa';
                return '';
            };

            const parseChoiceAnswerTokens = (rawAnswer) => {
                const textValue = String(rawAnswer || '').trim().replace(/[。；;]+$/g, '');
                if (!textValue) return [];
                if (/[\.、]/.test(textValue)) {
                    throw new Error('答案格式错误：单选/多选答案只能填选项字母，如 A 或 AD');
                }
                let tokens = textValue.split(/[\s,，|｜/]+/).filter(Boolean);
                if (tokens.length === 1 && /^[A-Ha-h]{2,8}$/.test(tokens[0])) {
                    tokens = tokens[0].split('');
                }
                return tokens.map((token) => {
                    const clean = token.trim().toUpperCase();
                    if (!/^[A-H]$/.test(clean)) {
                        throw new Error('答案格式错误：仅支持 A-H 选项字母');
                    }
                    return clean;
                });
            };

            const extractFillAnswersFromQuestion = (questionText) => {
                const matches = [...String(questionText || '').matchAll(/[（(]([^（）()]*)[）)]/g)];
                return matches.map((item) => (item[1] || '').trim());
            };

            const parseFillAnswerLine = (rawAnswer) => {
                const tokens = String(rawAnswer || '')
                    .split(/[|｜]/)
                    .map((item) => item.trim());
                return tokens.filter((item) => item !== '');
            };

            const inferQuestionType = ({ question, options, answerRaw, presetType }) => {
                if (presetType) return normalizeQuestionType(presetType);

                const normalizedQuestion = String(question || '').trim();
                const normalizedAnswer = String(answerRaw || '').trim();
                const optionList = Array.isArray(options) ? options : [];
                const hasFillBlank = /[（(][^（）()]*[）)]/.test(normalizedQuestion) || /_{2,}|＿{2,}/.test(normalizedQuestion);

                if (optionList.length > 0) {
                    try {
                        const tokens = parseChoiceAnswerTokens(normalizedAnswer);
                        if (tokens.length >= 2) return 'multiple';
                        if (tokens.length === 1) return 'single';
                    } catch (_error) {
                        // 解析失败时继续走后续兜底逻辑
                    }
                    if (normalizeJudgeAnswer(normalizedAnswer) !== null && optionList.length === 2) {
                        return 'judge';
                    }
                    return 'single';
                }

                const fillParts = parseFillAnswerLine(normalizedAnswer);
                if (hasFillBlank || fillParts.length > 1) return 'fill';
                if (normalizeJudgeAnswer(normalizedAnswer) !== null) return 'judge';
                return 'qa';
            };

            const commitCurrent = () => {
                if (!current) return;
                const question = String(current.question || '').trim();
                if (!question) {
                    current = null;
                    return;
                }
                const options = (current.options || []).map((item) => stripOptionPrefix(item)).filter(Boolean);
                const answerRaw = String(current.answer || '').trim();
                const analysis = String(current.analysis || '').trim();
                const chapter = String(current.chapter || '').trim();
                const difficulty = Math.max(1, toIntegerOrDefault(current.difficulty, 1));
                const type = inferQuestionType({
                    question,
                    options,
                    answerRaw,
                    presetType: current.type || currentType
                });
                let answer = '';

                if (type === 'single') {
                    if (options.length < 2) {
                        throw new Error(`题目「${question.slice(0, 28)}」选项不足，至少 2 个`);
                    }
                    if (!answerRaw) {
                        throw new Error(`题目「${question.slice(0, 28)}」缺少答案`);
                    }
                    const tokens = parseChoiceAnswerTokens(answerRaw);
                    if (tokens.length !== 1) {
                        throw new Error(`题目「${question.slice(0, 28)}」单选题答案必须且只能有 1 个选项`);
                    }
                    const index = tokens[0].charCodeAt(0) - 65;
                    if (index < 0 || index >= options.length) {
                        throw new Error(`题目「${question.slice(0, 28)}」答案超出选项范围`);
                    }
                    answer = String(index);
                } else if (type === 'multiple') {
                    if (options.length < 2) {
                        throw new Error(`题目「${question.slice(0, 28)}」选项不足，至少 2 个`);
                    }
                    if (options.length > 8) {
                        throw new Error(`题目「${question.slice(0, 28)}」多选题最多支持 8 个选项`);
                    }
                    if (!answerRaw) {
                        throw new Error(`题目「${question.slice(0, 28)}」缺少答案`);
                    }
                    const tokens = Array.from(new Set(parseChoiceAnswerTokens(answerRaw)));
                    if (tokens.length < 2) {
                        throw new Error(`题目「${question.slice(0, 28)}」多选题答案至少 2 个选项`);
                    }
                    const indices = tokens.map((token) => {
                        const index = token.charCodeAt(0) - 65;
                        if (index < 0 || index >= options.length) {
                            throw new Error(`题目「${question.slice(0, 28)}」答案超出选项范围`);
                        }
                        return index;
                    }).sort((a, b) => a - b);
                    answer = indices.join(',');
                } else if (type === 'judge') {
                    if (!answerRaw) {
                        throw new Error(`题目「${question.slice(0, 28)}」缺少答案`);
                    }
                    answer = normalizeJudgeAnswer(answerRaw);
                    if (answer === null) {
                        throw new Error(`题目「${question.slice(0, 28)}」判断题答案仅支持：对/正确/√ 或 错/错误/×`);
                    }
                } else if (type === 'fill') {
                    if (/_{2,}|＿{2,}/.test(question)) {
                        throw new Error(`题目「${question.slice(0, 28)}」填空题不能使用下划线，请使用括号()`);
                    }
                    const inlineAnswers = extractFillAnswersFromQuestion(question);
                    if (!inlineAnswers.length) {
                        throw new Error(`题目「${question.slice(0, 28)}」填空题必须使用括号()标记空位`);
                    }
                    const answers = answerRaw ? parseFillAnswerLine(answerRaw) : inlineAnswers;
                    if (!answers.length) {
                        throw new Error(`题目「${question.slice(0, 28)}」填空题答案不能为空`);
                    }
                    if (answers.length !== inlineAnswers.length) {
                        throw new Error(`题目「${question.slice(0, 28)}」填空题答案数量需与括号数量一致`);
                    }
                    answer = answers.join('|');
                } else if (type === 'qa') {
                    if (!answerRaw) {
                        throw new Error(`题目「${question.slice(0, 28)}」问答题缺少答案`);
                    }
                    answer = answerRaw;
                } else {
                    throw new Error(`题目「${question.slice(0, 28)}」题型不支持`);
                }

                questions.push({
                    question,
                    type,
                    options: ['single', 'multiple'].includes(type) ? options : (type === 'judge' ? ['正确', '错误'] : []),
                    answer,
                    analysis,
                    difficulty,
                    chapter
                });
                current = null;
            };

            lines.forEach((rawLine) => {
                const line = rawLine.trim();
                if (!line) return;
                if (/^#{1,6}\s*/.test(line)) return;

                const typeHeader = detectTypeHeader(line);
                if (typeHeader) {
                    commitCurrent();
                    currentType = typeHeader;
                    return;
                }

                const questionMatch = line.match(/^(?:第\s*\d+\s*题|[（(]\s*\d+\s*[)）]|\d+)\s*[\.、．\)）]?\s*(.+)$/);
                if (questionMatch) {
                    commitCurrent();
                    current = {
                        type: currentType || '',
                        question: questionMatch[1].trim(),
                        options: [],
                        answer: '',
                        analysis: '',
                        chapter: '',
                        difficulty: '1',
                        lastField: ''
                    };
                    return;
                }

                if (!current) return;

                const optionMatch = line.match(/^([A-Ha-h])(?:\s*[\.\、\)）:：]\s*|\s+)(.+)$/);
                if (optionMatch) {
                    current.options.push(optionMatch[2].trim());
                    current.lastField = '';
                    return;
                }

                const answerMatch = line.match(/^(?:答案|参考答案|正确答案|标准答案|answer)\s*[:：]\s*(.+)$/i);
                if (answerMatch) {
                    current.answer = answerMatch[1].trim();
                    current.lastField = 'answer';
                    return;
                }

                const analysisMatch = line.match(/^(?:解析|analysis)\s*[:：]\s*(.*)$/i);
                if (analysisMatch) {
                    current.analysis = analysisMatch[1].trim();
                    current.lastField = 'analysis';
                    return;
                }

                const diffMatch = line.match(/^(?:难度|difficulty)\s*[:：]\s*(\d+)$/i);
                if (diffMatch) {
                    current.difficulty = diffMatch[1];
                    current.lastField = '';
                    return;
                }

                const chapterMatch = line.match(/^(?:章节|知识点|chapter|knowledge(?:_point)?)\s*[:：]\s*(.+)$/i);
                if (chapterMatch) {
                    current.chapter = chapterMatch[1].trim();
                    current.lastField = '';
                    return;
                }

                if (current.lastField === 'analysis') {
                    current.analysis = current.analysis ? `${current.analysis}\n${line}` : line;
                    return;
                }
                if (current.lastField === 'answer' && (current.type === 'qa' || current.type === 'fill')) {
                    current.answer = current.answer ? `${current.answer}\n${line}` : line;
                    return;
                }
                if (!current.answer && current.options.length === 0) {
                    current.question = `${current.question} ${line}`.trim();
                }
            });

            commitCurrent();
            if (!questions.length) {
                throw new Error('未识别到题目，请检查格式：题号、答案行与题型标题');
            }
            return questions;
        }

        function renderImportDocPreview() {
            const previewRoot = $('import-doc-preview');
            if (!previewRoot) return;
            if (state.importDocParseError) {
                previewRoot.innerHTML = `<p class="text-rose-600">${esc(state.importDocParseError)}</p>`;
                return;
            }
            if (!state.importDocQuestions.length) {
                previewRoot.innerHTML = '<p>点击“检测”生成预览</p>';
                return;
            }

            const typeOptions = [
                { value: 'single', label: '单选题' },
                { value: 'multiple', label: '多选题' },
                { value: 'judge', label: '判断题' },
                { value: 'fill', label: '填空题' },
                { value: 'qa', label: '问答题' }
            ];

            const questionsHtml = state.importDocQuestions.map((q, index) => {
                const key = String(index);
                const isExpanded = Boolean(state.previewExpanded.importDoc[key]);
                const summary = `${getQuestionTypeText(normalizeQuestionType(q.type))} · ${Array.isArray(q.options) ? q.options.length : 0} 选项`;
                return `
                    <article class="import-edit-card border rounded-xl p-3 bg-slate-50/70" data-import-doc-question="${index}">
                        <div class="import-row flex items-center gap-3">
                            <button type="button" class="import-doc-expand-btn text-xs font-semibold px-2 py-1 rounded-lg bg-slate-100 text-slate-600" data-import-doc-question="${index}">
                                ${isExpanded ? '收起' : '展开'}
                            </button>
                            <div class="flex-1 min-w-0">
                                <div class="text-sm font-semibold text-slate-700 truncate">${esc(q.question || `题目 ${index + 1}`)}</div>
                                <div class="text-xs text-slate-400">${esc(summary)}</div>
                            </div>
                            <button type="button" class="import-doc-ai-btn text-xs font-semibold px-2 py-1 rounded-lg bg-slate-900 text-white" data-import-doc-question="${index}">AI生成</button>
                            <button type="button" class="import-doc-delete-btn text-rose-600 text-xs font-semibold" data-import-doc-question="${index}">删除</button>
                        </div>
                        ${isExpanded ? `
                            <div class="mt-3 border-t border-slate-200/70 pt-3">
                                <label class="block text-sm mb-3">
                                    <span class="text-slate-500">题目</span>
                                    <textarea class="w-full mt-1 px-3 py-2 rounded-lg border bg-white min-h-[88px]" data-import-doc-field="question">${esc(q.question)}</textarea>
                                </label>
                                <div class="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
                                    <label class="block text-sm">
                                        <span class="text-slate-500">题型</span>
                                        <select class="w-full mt-1 px-3 py-2 rounded-lg border bg-white" data-import-doc-field="type">
                                            ${typeOptions.map((item) => `<option value="${item.value}" ${normalizeQuestionType(q.type) === item.value ? 'selected' : ''}>${item.label}</option>`).join('')}
                                        </select>
                                    </label>
                                    <label class="block text-sm">
                                        <span class="text-slate-500">难度</span>
                                        <input type="number" min="1" max="5" class="w-full mt-1 px-3 py-2 rounded-lg border bg-white" data-import-doc-field="difficulty" value="${esc(String(q.difficulty || 1))}">
                                    </label>
                                    <label class="block text-sm">
                                        <span class="text-slate-500">章节</span>
                                        <input class="w-full mt-1 px-3 py-2 rounded-lg border bg-white" data-import-doc-field="chapter" value="${esc(q.chapter || '')}">
                                    </label>
                                </div>
                                <label class="block text-sm mb-3">
                                    <span class="text-slate-500">选项（每行一个）</span>
                                    <textarea class="w-full mt-1 px-3 py-2 rounded-lg border bg-white min-h-[88px]" data-import-doc-field="options">${esc((q.options || []).join('\n'))}</textarea>
                                </label>
                                <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    <label class="block text-sm">
                                        <span class="text-slate-500">${getAnswerLabelText(normalizeQuestionType(q.type))}</span>
                                        <input class="w-full mt-1 px-3 py-2 rounded-lg border bg-white" data-import-doc-field="answer" value="${esc(formatAnswerForEditor(normalizeQuestionType(q.type), q.answer))}">
                                    </label>
                                    <label class="block text-sm">
                                        <span class="text-slate-500">解析</span>
                                        <textarea class="w-full mt-1 px-3 py-2 rounded-lg border bg-white min-h-[88px]" data-import-doc-field="analysis">${esc(String(q.analysis || ''))}</textarea>
                                    </label>
                                </div>
                            </div>
                        ` : ''}
                    </article>
                `;
            }).join('');

            previewRoot.innerHTML = `
                <div class="mb-3 text-sm flex flex-wrap items-center gap-2 justify-between">
                    <div>
                        <p>共识别 <strong>${state.importDocQuestions.length}</strong> 道题。</p>
                        ${state.importDocLastFilename ? `<p class="text-xs text-slate-400 mt-1">来源：${esc(state.importDocLastFilename)}</p>` : ''}
                    </div>
                    <button type="button" class="import-doc-ai-batch px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-semibold">批量AI生成</button>
                </div>
                <div class="space-y-3">${questionsHtml}</div>
            `;
        }

        function updateSingleImportTypeUI() {
            const type = normalizeQuestionType($('import-single-type')?.value || 'single');
            const optionsEl = $('import-single-options');
            const answerEl = $('import-single-answer');
            const optionsWrap = $('import-single-options-wrap');
            if (optionsEl) {
                if (type === 'judge') {
                    optionsEl.placeholder = '正确\n错误';
                    if (!optionsEl.value.trim()) {
                        optionsEl.value = '正确\n错误';
                    }
                } else if (type === 'single' || type === 'multiple') {
                    optionsEl.placeholder = 'A. 选项A\nB. 选项B';
                } else {
                    optionsEl.placeholder = '该题型无需选项';
                    optionsEl.value = '';
                }
            }
            if (optionsWrap) {
                optionsWrap.classList.toggle('hidden', type === 'fill' || type === 'qa');
            }
            if (answerEl) {
                if (type === 'multiple') {
                    answerEl.placeholder = '如 AD 或 A,D';
                } else if (type === 'judge') {
                    answerEl.placeholder = '如 对 / 正确 / √';
                } else if (type === 'fill') {
                    answerEl.placeholder = '多个答案用 | 分隔，如 红楼梦|水浒传';
                } else if (type === 'qa') {
                    answerEl.placeholder = '请输入参考答案';
                } else {
                    answerEl.placeholder = '如 A';
                }
            }
        }

        function buildSingleImportPayload() {
            const type = normalizeQuestionType($('import-single-type').value);
            const options = normalizeOptionLines($('import-single-options').value);
            const answerRaw = $('import-single-answer').value.trim();
            let answer = '';

            if ((type === 'single' || type === 'multiple') && options.length < 2) {
                throw new Error('单选/多选题至少需要 2 个选项');
            }
            if ((type === 'single' || type === 'multiple') && options.length > 8) {
                throw new Error('单选/多选题最多支持 8 个选项');
            }
            if (type === 'judge' && options.length === 0) {
                options.push('正确', '错误');
            }
            if (type === 'fill' || type === 'qa') {
                options.length = 0;
            }

            if (type === 'judge') {
                const parsed = normalizeJudgeAnswer(answerRaw);
                if (parsed === null) throw new Error('判断题答案格式不正确，请填写 A/B 或 正确/错误');
                answer = parsed;
            } else if (type === 'multiple') {
                const tokens = splitAnswerTokens(answerRaw);
                if (!tokens.length) throw new Error('多选题答案不能为空');
                const indices = Array.from(new Set(tokens.map((token) => parseAnswerIndexToken(token, options.length)))).sort((a, b) => a - b);
                if (indices.length < 2) throw new Error('多选题答案至少需要 2 个选项');
                answer = indices.join(',');
            } else if (type === 'fill') {
                if (!/[（(].*[）)]/.test($('import-single-question').value)) {
                    throw new Error('填空题题目必须使用括号()标记空位');
                }
                if (!answerRaw) throw new Error('填空题答案不能为空');
                const parts = answerRaw.split(/[|｜]/).map((item) => item.trim()).filter(Boolean);
                if (!parts.length) throw new Error('填空题答案格式不正确，请使用 | 分隔');
                answer = parts.join('|');
            } else if (type === 'qa') {
                if (!answerRaw) throw new Error('问答题答案不能为空');
                answer = answerRaw;
            } else {
                answer = String(parseAnswerIndexToken(answerRaw, options.length));
            }

            return {
                library_id: $('import-single-library').value,
                question: $('import-single-question').value.trim(),
                type,
                options,
                answer,
                analysis: $('import-single-analysis').value.trim(),
                difficulty: Math.max(1, toIntegerOrDefault($('import-single-difficulty').value, 1)),
                chapter: $('import-single-knowledge').value.trim()
            };
        }

        async function api(path, options = {}) {
            const customHeaders = options.headers || {};
            const config = {
                credentials: 'same-origin',
                ...options
            };
            if (!(config.body instanceof FormData)) {
                config.headers = { 'Content-Type': 'application/json', ...customHeaders };
            } else {
                config.headers = { ...customHeaders };
            }
            const response = await fetch(`${API_BASE}${path}`, config);
            const data = await response.json().catch(() => ({}));
            if (response.status === 401) {
                window.location.href = '/admin/login';
                throw new Error('登录已失效，请重新登录');
            }
            if (!response.ok) {
                throw new Error(data.error || '请求失败');
            }
            return data;
        }

        function parseDownloadFilename(contentDisposition, fallbackName) {
            if (!contentDisposition) return fallbackName;
            const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
            if (utf8Match && utf8Match[1]) {
                try {
                    return decodeURIComponent(utf8Match[1].replace(/"/g, ''));
                } catch (error) {
                    return utf8Match[1].replace(/"/g, '');
                }
            }
            const basicMatch = contentDisposition.match(/filename="?([^"]+)"?/i);
            if (basicMatch && basicMatch[1]) {
                return basicMatch[1];
            }
            return fallbackName;
        }

        function downloadBlob(blob, filename) {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
        }

        function normalizeExportFilename(filename, ext) {
            const desiredExt = String(ext || '').replace(/^\./, '').toLowerCase();
            const base = String(filename || '').trim() || `quiz-export.${desiredExt || 'txt'}`;
            if (!desiredExt) return base;
            const next = base.replace(/\.[^.]+$/, '');
            return `${next}.${desiredExt}`;
        }

        function buildTxtExportContent(payload, options = {}) {
            const libraries = Array.isArray(payload?.libraries) ? payload.libraries : [];
            const selectedFields = normalizeExportTxtFields(options.fields || state.exportTxtFields);
            const fieldSet = new Set(selectedFields);
            const lines = [];
            lines.push('# 题库导出文档');
            lines.push(`# 导出时间: ${payload?.exported_at || ''}`);
            lines.push(`# 题集数量: ${payload?.library_count ?? libraries.length}`);
            lines.push(`# 题目数量: ${payload?.question_count ?? 0}`);
            lines.push(`# 导出字段: ${getExportTxtFieldLabels(selectedFields).join('、')}`);
            lines.push('');

            libraries.forEach((lib, libIndex) => {
                const questions = Array.isArray(lib?.questions) ? lib.questions : [];
                lines.push(`## 题集 ${libIndex + 1}: ${lib?.title || '(未命名题集)'}`);
                lines.push(`## 题集ID: ${lib?.id || ''}`);
                if (lib?.description) lines.push(`## 介绍: ${lib.description}`);
                if (!questions.length) {
                    lines.push('## (暂无题目)');
                    lines.push('');
                    return;
                }
                lines.push('');

                questions.forEach((q, qIndex) => {
                    const qType = normalizeQuestionType(q?.type || 'single');
                    let options = Array.isArray(q?.options) ? q.options : [];
                    if (qType === 'judge' && options.length < 2) {
                        options = ['正确', '错误'];
                    }
                    const answerText = formatAnswerForList(qType, q?.answer);
                    const questionText = String(q?.question || '').trim();
                    if (fieldSet.has('question')) {
                        lines.push(`${qIndex + 1}. ${questionText || '(无题目内容)'}`);
                    } else {
                        lines.push(`${qIndex + 1}.`);
                    }
                    if (fieldSet.has('type')) {
                        lines.push(`题型: ${getQuestionTypeText(qType)}`);
                    }
                    if (fieldSet.has('options') && options.length) {
                        options.forEach((opt, optIndex) => {
                            lines.push(`${toOptionLetter(optIndex)}. ${opt}`);
                        });
                    }
                    if (fieldSet.has('answer')) {
                        lines.push(`答案: ${answerText || '--'}`);
                    }
                    if (fieldSet.has('analysis')) {
                        lines.push(`解析: ${q?.analysis || '暂无解析'}`);
                    }
                    if (fieldSet.has('difficulty')) {
                        lines.push(`难度: ${toIntegerOrDefault(q?.difficulty, 1)}`);
                    }
                    if (fieldSet.has('chapter')) {
                        const chapterText = String(q?.chapter ?? q?.knowledge_point ?? '').trim();
                        lines.push(`章节: ${chapterText || '--'}`);
                    }
                    if (fieldSet.has('updated_at')) {
                        lines.push(`编辑时间: ${formatEditTime(q?.updated_at)}`);
                    }
                    lines.push('');
                });
                lines.push('');
            });

            return lines.join('\n').trim();
        }

        async function exportLibraries(format, selectedLibraryValue) {
            const summary = getExportLibrarySummary(selectedLibraryValue);
            if (!summary.libraryCount) {
                notify('暂无可导出的题集', true);
                return;
            }
            const normalizedFormat = String(format || 'json').toLowerCase() === 'txt' ? 'txt' : 'json';
            const txtFields = normalizedFormat === 'txt' ? getExportTxtFields() : [];
            const extraFieldHint = normalizedFormat === 'txt'
                ? `，字段：${getExportTxtFieldLabels(txtFields).join('、')}`
                : '';

            const ok = await showConfirmDialog({
                title: '导出文件',
                message: `确认导出${summary.label}为 ${normalizedFormat.toUpperCase()} 吗${extraFieldHint}？`,
                confirmText: '开始导出'
            });
            if (!ok) return;

            const query = summary.libraryId ? `?library_id=${encodeURIComponent(summary.libraryId)}` : '';
            const exportUrl = `${API_BASE}/export-json${query}`;
            try {
                const response = await fetch(exportUrl, { credentials: 'same-origin' });
                if (response.status === 401) {
                    window.location.href = '/admin/login';
                    throw new Error('登录已失效，请重新登录');
                }
                if (!response.ok) {
                    const data = await response.json().catch(() => ({}));
                    throw new Error(data.error || '导出失败');
                }

                const fallbackName = summary.libraryId ? `quiz-export-${summary.libraryId}.json` : 'quiz-export-all.json';
                const sourceFilename = parseDownloadFilename(
                    response.headers.get('Content-Disposition') || '',
                    fallbackName
                );
                let blob = null;
                let filename = sourceFilename;
                if (normalizedFormat === 'txt') {
                    const payload = await response.json().catch(() => ({}));
                    const text = buildTxtExportContent(payload, { fields: txtFields });
                    blob = new Blob([text], { type: 'text/plain; charset=utf-8' });
                    filename = normalizeExportFilename(sourceFilename, 'txt');
                } else {
                    blob = await response.blob();
                    filename = normalizeExportFilename(sourceFilename, 'json');
                }
                downloadBlob(blob, filename);
                notify(`导出成功：${filename}`);
                closeExportModal();
            } catch (error) {
                notify(error.message, true);
            }
        }

        function closeConfirmDialog(result) {
            $('confirm-modal').classList.add('hidden');
            $('confirm-modal').classList.remove('flex');
            if (confirmResolver) {
                confirmResolver(result);
                confirmResolver = null;
            }
        }

        function showConfirmDialog({
            title = '请确认',
            message = '',
            confirmText = '确认',
            confirmType = 'primary'
        } = {}) {
            $('confirm-title').innerText = title;
            $('confirm-message').innerText = message;
            $('confirm-ok-btn').innerText = confirmText;
            $('confirm-ok-btn').className = `flex-1 py-2.5 rounded-lg text-white font-semibold ${
                confirmType === 'danger' ? 'bg-rose-600' : 'bg-indigo-600'
            }`;
            $('confirm-cancel-btn').onclick = () => closeConfirmDialog(false);
            $('confirm-ok-btn').onclick = () => closeConfirmDialog(true);
            $('confirm-modal').onclick = (event) => {
                if (event.target === $('confirm-modal')) closeConfirmDialog(false);
            };
            $('confirm-modal').classList.remove('hidden');
            $('confirm-modal').classList.add('flex');
            return new Promise((resolve) => {
                confirmResolver = resolve;
            });
        }

        function openCreateLibraryModal() {
            $('new-lib-title').value = '';
            $('new-lib-icon').value = '📚';
            $('new-lib-description').value = '';
            if ($('new-lib-public')) $('new-lib-public').checked = true;
            $('create-library-modal').classList.remove('hidden');
            $('create-library-modal').classList.add('flex');
            $('new-lib-title').focus();
        }

        function closeCreateLibraryModal() {
            $('create-library-modal').classList.add('hidden');
            $('create-library-modal').classList.remove('flex');
        }

        function renderLibraryList() {
            const container = $('library-list');
            const filterSelect = $('library-visibility-filter');
            const filterValue = state.libraryVisibilityFilter === 'public' || state.libraryVisibilityFilter === 'private'
                ? state.libraryVisibilityFilter
                : 'all';
            if (filterSelect && filterSelect.value !== filterValue) {
                filterSelect.value = filterValue;
            }
            const visibleLibraries = state.libraries.filter((lib) => {
                if (filterValue === 'public') return lib?.is_public !== false;
                if (filterValue === 'private') return lib?.is_public === false;
                return true;
            });

            if (!state.libraries.length) {
                container.innerHTML = '<div class="text-sm text-slate-400 text-center py-8 w-full">暂无题集，点击新建题集</div>';
                renderLibraryPanelState();
                return;
            }

            if (!visibleLibraries.length) {
                container.innerHTML = '<div class="text-sm text-slate-400 text-center py-8 w-full">当前筛选下暂无题集</div>';
                renderLibraryPanelState();
                return;
            }

            const cards = visibleLibraries.map((lib) => {
                const active = state.currentLibrary && state.currentLibrary.id === lib.id;
                const visibility = lib.is_public === false ? '私有' : '公开';
                return `
                    <button
                        type="button"
                        data-lib-id="${esc(lib.id)}"
                        title="${esc(lib.title)} (${esc(lib.id)}) · ${visibility}"
                        class="library-compact-btn border transition ${active ? 'is-active' : ''}"
                    >
                        <span class="library-compact-icon">${esc(lib.icon || '📚')}</span>
                        <span class="library-compact-title">${esc(lib.title)}</span>
                        ${lib.is_public === false ? '<span class="text-[10px] text-slate-400">🔒</span>' : ''}
                    </button>
                `;
            }).join('');

            container.innerHTML = `
                <div class="library-compact-grid">${cards}</div>
            `;
            renderLibraryPanelState();
        }

        function renderEditor() {
            if (!isAdminPage('library-management')) {
                $('editor').classList.add('hidden');
                $('editor-empty').classList.add('hidden');
                renderDashboardStats();
                applyAdminPageMode();
                return;
            }

            if (!state.currentLibrary) {
                $('editor').classList.add('hidden');
                $('editor-empty').classList.remove('hidden');
                renderDashboardStats();
                applyAdminPageMode();
                return;
            }

            const lib = state.currentLibrary;
            const knowledgeMap = new Map();
            lib.questions.forEach((question) => {
                const raw = String(question.chapter ?? question.knowledge_point ?? '').trim();
                if (!raw) return;
                const key = normalizeSearchText(raw);
                if (!knowledgeMap.has(key)) {
                    knowledgeMap.set(key, raw);
                }
            });
            const knowledgeOptions = Array.from(knowledgeMap.entries()).sort((a, b) => a[1].localeCompare(b[1], 'zh-CN'));
            const moveTargetOptions = state.libraries
                .filter((item) => item.id !== lib.id)
                .map((item) => `<option value="${esc(item.id)}">${esc(item.icon)} ${esc(item.title)}</option>`)
                .join('');

            $('editor-empty').classList.add('hidden');
            $('editor').classList.remove('hidden');
            $('editor').innerHTML = `
                <div class="border rounded-2xl p-4 bg-slate-50">
                    <h3 class="font-bold mb-4">题集信息</h3>
                    <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <label class="text-sm">
                            <span class="text-slate-500">题集 ID</span>
                            <input id="lib-id" value="${esc(lib.id)}" class="w-full mt-1 px-3 py-2 rounded-lg border" placeholder="仅字母/数字/-/_">
                        </label>
                        <label class="text-sm md:col-span-2">
                            <span class="text-slate-500">题集名称</span>
                            <input id="lib-title" value="${esc(lib.title)}" class="w-full mt-1 px-3 py-2 rounded-lg border">
                        </label>
                        <label class="text-sm">
                            <span class="text-slate-500">图标</span>
                            <input id="lib-icon" value="${esc(lib.icon)}" class="w-full mt-1 px-3 py-2 rounded-lg border">
                        </label>
                        <label class="text-sm md:col-span-3">
                            <span class="text-slate-500">题集介绍</span>
                            <textarea id="lib-description" class="w-full mt-1 px-3 py-2 rounded-lg border" rows="3" placeholder="填写题集介绍，展示在选择模式页面">${esc(lib.description || '')}</textarea>
                        </label>
                        <label class="inline-flex items-center gap-2 text-sm md:col-span-3 cursor-pointer">
                            <input id="lib-is-public" type="checkbox" class="rounded border-slate-300" ${lib.is_public === false ? '' : 'checked'}>
                            <span class="text-slate-500">公开题集（关闭后仅后台可见）</span>
                        </label>
                    </div>
                    <div class="mt-4 flex gap-3">
                        <button id="save-library-btn" class="px-4 py-2 rounded-lg bg-indigo-600 text-white font-semibold">保存题集信息</button>
                        <button id="delete-library-btn" class="px-4 py-2 rounded-lg bg-rose-100 text-rose-600 font-semibold">删除题集</button>
                    </div>
                </div>

                <div class="border rounded-2xl p-4">
                    <div class="flex flex-col gap-3 mb-4">
                        <div class="question-toolbar flex flex-wrap items-center gap-2">
                            <div class="question-toolbar-select-row">
                                <select id="question-type-filter" class="question-toolbar-control px-3 py-2 rounded-lg border text-sm">
                                    <option value="all" ${state.questionTypeFilter === 'all' ? 'selected' : ''}>全部题型</option>
                                    <option value="single" ${state.questionTypeFilter === 'single' ? 'selected' : ''}>单选题</option>
                                    <option value="multiple" ${state.questionTypeFilter === 'multiple' ? 'selected' : ''}>多选题</option>
                                    <option value="judge" ${state.questionTypeFilter === 'judge' ? 'selected' : ''}>判断题</option>
                                    <option value="fill" ${state.questionTypeFilter === 'fill' ? 'selected' : ''}>填空题</option>
                                    <option value="qa" ${state.questionTypeFilter === 'qa' ? 'selected' : ''}>问答题</option>
                                </select>
                                <select id="question-knowledge-filter" class="question-toolbar-control px-3 py-2 rounded-lg border text-sm min-w-[150px]">
                                    <option value="all" ${state.questionKnowledgeFilter === 'all' ? 'selected' : ''}>全部章节</option>
                                    ${knowledgeOptions.map(([key, label]) => `<option value="${esc(key)}" ${state.questionKnowledgeFilter === key ? 'selected' : ''}>${esc(label)}</option>`).join('')}
                                </select>
                                <select id="question-difficulty-filter" class="question-toolbar-control px-3 py-2 rounded-lg border text-sm">
                                    <option value="all" ${state.questionDifficultyFilter === 'all' ? 'selected' : ''}>全部难度</option>
                                    <option value="1" ${state.questionDifficultyFilter === '1' ? 'selected' : ''}>简单</option>
                                    <option value="2" ${state.questionDifficultyFilter === '2' ? 'selected' : ''}>适中</option>
                                    <option value="3" ${state.questionDifficultyFilter === '3' ? 'selected' : ''}>较难</option>
                                </select>
                                <select id="question-batch-action" class="question-toolbar-control question-toolbar-action px-3 py-2 rounded-lg border text-sm">
                                    <option value="" selected disabled hidden>批量操作</option>
                                    <option value="batch-difficulty">修改难度</option>
                                    <option value="batch-knowledge">修改章节</option>
                                    <option value="batch-copy">复制题目</option>
                                    <option value="batch-move">移动题目</option>
                                    <option value="batch-export">导出题目</option>
                                    <option value="delete">删除</option>
                                </select>
                            </div>
                            <select id="question-batch-difficulty" class="question-toolbar-control hidden px-3 py-2 rounded-lg border text-sm">
                                <option value="1">设为简单</option>
                                <option value="2">设为适中</option>
                                <option value="3">设为较难</option>
                            </select>
                            <input id="question-batch-knowledge" class="question-toolbar-control hidden px-3 py-2 rounded-lg border text-sm" placeholder="输入章节，留空可清空">
                            <select id="question-batch-target-library" class="question-toolbar-control hidden px-3 py-2 rounded-lg border text-sm">
                                <option value="">选择目标题集</option>
                                ${moveTargetOptions || '<option value="" disabled>暂无可移动题集</option>'}
                            </select>
                            <select id="question-batch-export-format" class="question-toolbar-control hidden px-3 py-2 rounded-lg border text-sm">
                                <option value="json">导出为 JSON</option>
                                <option value="txt">导出为文档</option>
                            </select>
                            <button id="question-batch-run-btn" class="question-toolbar-run px-3 py-2 rounded-lg bg-slate-100 text-slate-600 font-semibold text-sm">执行</button>
                            <span id="question-selected-hint" class="text-xs text-slate-400 ml-1">已选 0 题</span>
                            <div class="question-toolbar-search ml-auto flex items-center gap-2 w-full md:w-auto">
                                <input id="question-search-input" value="${esc(state.questionSearch)}" class="w-full md:w-72 px-3 py-2 rounded-lg border" placeholder="请输入题目关键词">
                                <button id="question-search-btn" title="搜索" aria-label="搜索" class="toolbar-icon-btn bg-slate-100 text-slate-600 hover:bg-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-300">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                        <circle cx="11" cy="11" r="7"></circle>
                                        <path d="m20 20-3.5-3.5"></path>
                                    </svg>
                                    <span class="sr-only">搜索</span>
                                </button>
                            </div>
                        </div>
                        <h3 id="question-count-label" class="font-bold">题目列表</h3>
                    </div>
                    <div class="overflow-x-auto rounded-xl border border-slate-200">
                        <table class="question-grid-table min-w-[980px] w-full text-sm">
                            <thead class="bg-slate-50 text-slate-600">
                                <tr>
                                    <th class="py-3 px-3 text-left w-10"><input id="question-check-all" type="checkbox" class="rounded border-slate-300"></th>
                                    <th class="py-3 px-2 text-left w-10"></th>
                                    <th class="py-3 px-2 text-left whitespace-nowrap">题型</th>
                                    <th class="py-3 px-2 text-left whitespace-nowrap">编号</th>
                                    <th class="py-3 px-2 text-left whitespace-nowrap">题目</th>
                                    <th class="py-3 px-2 text-left whitespace-nowrap w-[180px]">答案</th>
                                    <th class="py-3 px-2 text-left whitespace-nowrap">章节</th>
                                    <th class="py-3 px-2 text-left whitespace-nowrap">难易程度</th>
                                    <th class="py-3 px-2 text-left whitespace-nowrap">编辑时间</th>
                                    <th class="py-3 px-2 text-left whitespace-nowrap">操作</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${lib.questions.map((q, index) => {
                                    const qType = normalizeQuestionType(q.type);
                                    const answerText = formatAnswerForEditor(qType, q.ans);
                                    const answerPreview = formatAnswerForList(qType, q.ans);
                                    const knowledgeRaw = String(q.chapter ?? q.knowledge_point ?? '').trim();
                                    const knowledgeFilterValue = normalizeSearchText(knowledgeRaw);
                                    const difficultyNum = toIntegerOrDefault(q.difficulty, 1);
                                    const difficultyValue = difficultyNum <= 1 ? '1' : difficultyNum === 2 ? '2' : '3';
                                    const searchText = [
                                        index + 1,
                                        q.id,
                                        q.q,
                                        (q.options || []).join(' '),
                                        answerPreview,
                                        q.analysis,
                                        q.chapter ?? q.knowledge_point ?? '',
                                        qType
                                    ].join(' ');
                                    return `
                                    <tr class="border-b border-slate-100 hover:bg-slate-50/70" data-question-filter-row data-question-id="${q.id}" data-question-type="${esc(qType)}" data-question-knowledge="${esc(knowledgeFilterValue)}" data-question-difficulty="${esc(difficultyValue)}" data-question-search="${esc(searchText)}">
                                        <td class="py-3 px-3 align-middle">
                                            <input type="checkbox" class="question-row-check rounded border-slate-300" data-question-id="${q.id}">
                                        </td>
                                        <td class="py-3 px-2 align-middle">
                                            <button class="row-expand-btn w-6 h-6 inline-flex items-center justify-center rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100" data-question-id="${q.id}" title="展开编辑">›</button>
                                        </td>
                                        <td class="py-3 px-2 align-middle whitespace-nowrap">${getQuestionTypeText(qType)}</td>
                                        <td class="py-3 px-2 align-middle whitespace-nowrap">${index + 1}</td>
                                        <td class="py-3 px-2 align-middle max-w-[380px] truncate" title="${esc(q.q)}">${esc(q.q)}</td>
                                        <td class="py-3 px-2 align-middle font-semibold max-w-[180px] truncate" title="${esc(answerPreview || '--')}">${esc(answerPreview || '--')}</td>
                                        <td class="py-3 px-2 align-middle max-w-[160px] truncate" title="${esc(knowledgeRaw || '--')}">${esc(knowledgeRaw || '--')}</td>
                                        <td class="py-3 px-2 align-middle whitespace-nowrap ${getDifficultyClass(q.difficulty)}">${getDifficultyText(q.difficulty)}</td>
                                        <td class="py-3 px-2 align-middle text-slate-400 whitespace-nowrap" data-question-updated-at="${q.id}">${esc(formatEditTime(q.updated_at))}</td>
                                        <td class="py-3 px-2 align-middle whitespace-nowrap">
                                            <button class="delete-question-btn text-rose-600 hover:text-rose-700" data-question-id="${q.id}">删除</button>
                                        </td>
                                    </tr>
                                    <tr class="hidden bg-slate-50/70" data-edit-row-id="${q.id}">
                                        <td colspan="10" class="px-4 py-4">
                                            <div class="question-edit-card border rounded-xl p-4 bg-white" data-question-id="${q.id}">
                                                <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                                                    <label class="text-sm md:col-span-2">
                                                        <span class="text-slate-500">题目</span>
                                                        <textarea class="q-question w-full mt-1 px-3 py-2 rounded-lg border" rows="2">${esc(q.q)}</textarea>
                                                    </label>
                                                    <label class="text-sm q-options-wrap">
                                                        <span class="text-slate-500">选项 每行一个</span>
                                                        <textarea class="q-options w-full mt-1 px-3 py-2 rounded-lg border" rows="5">${esc((q.options || []).join('\n'))}</textarea>
                                                    </label>
                                                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                                        <label class="block text-sm">
                                                            <span class="text-slate-500">题型</span>
                                                            <select class="q-type w-full mt-1 px-3 py-2 rounded-lg border">
                                                                <option value="single" ${qType === 'single' ? 'selected' : ''}>单选题</option>
                                                                <option value="multiple" ${qType === 'multiple' ? 'selected' : ''}>多选题</option>
                                                                <option value="judge" ${qType === 'judge' ? 'selected' : ''}>判断题</option>
                                                                <option value="fill" ${qType === 'fill' ? 'selected' : ''}>填空题</option>
                                                                <option value="qa" ${qType === 'qa' ? 'selected' : ''}>问答题</option>
                                                            </select>
                                                        </label>
                                                        <label class="block text-sm">
                                                            <span class="text-slate-500 q-answer-label">${getAnswerLabelText(qType)}</span>
                                                            <input type="text" class="q-answer w-full mt-1 px-3 py-2 rounded-lg border" value="${esc(answerText)}">
                                                        </label>
                                                        <label class="block text-sm">
                                                            <span class="text-slate-500">难度</span>
                                                            <input type="number" min="1" class="q-difficulty w-full mt-1 px-3 py-2 rounded-lg border" value="${esc(q.difficulty)}">
                                                        </label>
                                                        <label class="block text-sm">
                                                            <span class="text-slate-500">章节</span>
                                                            <input class="q-knowledge w-full mt-1 px-3 py-2 rounded-lg border" value="${esc(q.chapter ?? q.knowledge_point ?? '')}">
                                                        </label>
                                                    </div>
                                                    <label class="text-sm md:col-span-2">
                                                        <span class="text-slate-500">解析</span>
                                                        <textarea class="q-analysis w-full mt-1 px-3 py-2 rounded-lg border" rows="3">${esc(q.analysis)}</textarea>
                                                    </label>
                                                </div>
                                                <div class="flex flex-wrap gap-3 mt-3">
                                                    <button class="ai-generate-btn px-4 py-2 rounded-lg bg-slate-900 text-white font-semibold">AI生成</button>
                                                    <button class="save-question-btn px-4 py-2 rounded-lg bg-indigo-600 text-white font-semibold">保存题目</button>
                                                    <button class="collapse-question-btn px-4 py-2 rounded-lg bg-slate-100 text-slate-600 font-semibold" data-question-id="${q.id}">收起</button>
                                                </div>
                                            </div>
                                        </td>
                                    </tr>
                                `;
                                }).join('')}
                            </tbody>
                        </table>
                    </div>
                    <div id="question-search-empty" class="hidden mt-4 rounded-xl border border-dashed text-center text-sm text-slate-400 py-8">没有匹配的题目</div>
                </div>
            `;
            if ($('admin-global-search-input') && $('admin-global-search-input').value !== state.questionSearch) {
                $('admin-global-search-input').value = state.questionSearch;
            }
            $('editor').querySelectorAll('.question-edit-card').forEach((card) => updateQuestionCardTypeUI(card));
            updateBatchActionControls();
            applyQuestionSearch();
            syncSelectedQuestionCount();
            renderDashboardStats();
            applyAdminPageMode();
        }

        async function loadLibraries(preferredLibraryId) {
            try {
                state.libraries = await api('/libraries');
                if (!state.libraries.length) {
                    state.currentLibrary = null;
                    renderLibraryList();
                    renderEditor();
                    renderImportLibrarySelect('import-doc-library');
                    renderImportLibrarySelect('import-single-library');
                    refreshExportModalState('__all__');
                    renderDashboardStats();
                    await loadQuestionBank();
                    return;
                }

                const currentId = preferredLibraryId || (state.currentLibrary && state.currentLibrary.id) || state.libraries[0].id;
                renderLibraryList();
                await selectLibrary(currentId);
                renderDashboardStats();
                await loadQuestionBank();
            } catch (error) {
                notify(error.message, true);
            }
        }

        async function selectLibrary(libraryId) {
            try {
                const previousLibraryId = state.currentLibrary ? state.currentLibrary.id : null;
                state.currentLibrary = await api(`/libraries/${libraryId}`);
                if (previousLibraryId !== libraryId) {
                    state.questionSearch = '';
                    state.questionTypeFilter = 'all';
                    state.questionKnowledgeFilter = 'all';
                    state.questionDifficultyFilter = 'all';
                }
                renderLibraryList();
                renderEditor();
                renderImportLibrarySelect('import-doc-library', libraryId);
                renderImportLibrarySelect('import-single-library', libraryId);
                refreshExportModalState(libraryId);
                renderDashboardStats();
            } catch (error) {
                notify(error.message, true);
            }
        }

        function buildQuestionPayload(card) {
            const type = normalizeQuestionType(card.querySelector('.q-type')?.value || 'single');
            const optionsInput = card.querySelector('.q-options');
            const answerInput = card.querySelector('.q-answer');
            const questionInput = card.querySelector('.q-question');
            const analysisInput = card.querySelector('.q-analysis');
            const difficultyInput = card.querySelector('.q-difficulty');
            const knowledgeInput = card.querySelector('.q-knowledge');
            if (!optionsInput || !answerInput || !questionInput || !analysisInput || !difficultyInput || !knowledgeInput) {
                throw new Error('题目编辑区域不完整，请刷新后重试');
            }

            let options = optionsInput.value
                .split('\n')
                .map((item) => item.trim())
                .filter(Boolean);
            if (type === 'judge' && options.length === 0) {
                options = ['正确', '错误'];
            }
            if (type === 'fill' || type === 'qa') {
                options = [];
            }
            const answerRaw = answerInput.value.trim();

            return {
                question: questionInput.value.trim(),
                type,
                options,
                answer: answerRaw,
                analysis: analysisInput.value.trim(),
                difficulty: difficultyInput.value.trim() || '1',
                chapter: knowledgeInput.value.trim(),
                library_id: state.currentLibrary.id
            };
        }

        function updateBatchActionControls() {
            const action = $('question-batch-action')?.value || '';
            const difficultyInput = $('question-batch-difficulty');
            const knowledgeInput = $('question-batch-knowledge');
            const targetLibraryInput = $('question-batch-target-library');
            const exportFormatInput = $('question-batch-export-format');
            const runButton = $('question-batch-run-btn');
            if (!difficultyInput || !knowledgeInput || !targetLibraryInput || !exportFormatInput) return;

            difficultyInput.classList.toggle('hidden', action !== 'batch-difficulty');
            knowledgeInput.classList.toggle('hidden', action !== 'batch-knowledge');
            targetLibraryInput.classList.toggle('hidden', action !== 'batch-move' && action !== 'batch-copy');
            exportFormatInput.classList.toggle('hidden', action !== 'batch-export');
            if (runButton) {
                runButton.innerText = action === 'batch-export' ? '导出' : '执行';
            }
        }

        async function batchUpdateQuestions(questionIds, changes) {
            return api('/questions/batch', {
                method: 'PUT',
                body: JSON.stringify({
                    library_id: state.currentLibrary.id,
                    question_ids: questionIds,
                    changes
                })
            });
        }

        function parseMultipleAnswerForExport(answer) {
            if (Array.isArray(answer)) {
                return Array.from(new Set(
                    answer.map((item) => Number.parseInt(String(item), 10)).filter((item) => Number.isInteger(item))
                )).sort((a, b) => a - b);
            }
            return Array.from(new Set(
                String(answer || '')
                    .split(/[\s,，/|]+/)
                    .map((item) => item.trim())
                    .filter(Boolean)
                    .map((item) => (/^[A-Za-z]$/.test(item) ? item.toUpperCase().charCodeAt(0) - 65 : Number.parseInt(item, 10)))
                    .filter((item) => Number.isInteger(item))
            )).sort((a, b) => a - b);
        }

        function buildSelectedQuestionsExportPayload(questionIds) {
            if (!state.currentLibrary) return null;
            const selectedSet = new Set(questionIds.map((id) => String(id)));
            const selectedQuestions = (state.currentLibrary.questions || [])
                .filter((question) => selectedSet.has(String(question.id)))
                .map((question) => {
                    const qType = normalizeQuestionType(question.type);
                    let options = Array.isArray(question.options) ? question.options : [];
                    if (qType === 'judge' && options.length < 2) {
                        options = ['正确', '错误'];
                    }
                    const answer = qType === 'multiple'
                        ? parseMultipleAnswerForExport(question.ans)
                        : String(question.ans ?? '');
                    return {
                        question: String(question.q || ''),
                        type: qType,
                        options,
                        answer,
                        analysis: String(question.analysis || ''),
                        difficulty: toIntegerOrDefault(question.difficulty, 1),
                        chapter: String(question.chapter ?? question.knowledge_point ?? '').trim(),
                        updated_at: String(question.updated_at || '')
                    };
                });

            return {
                exported_at: new Date().toISOString(),
                library_count: 1,
                question_count: selectedQuestions.length,
                libraries: [{
                    id: String(state.currentLibrary.id || ''),
                    title: String(state.currentLibrary.title || ''),
                    description: String(state.currentLibrary.description || ''),
                    questions: selectedQuestions
                }]
            };
        }

        async function exportSelectedQuestions(questionIds, format) {
            const payload = buildSelectedQuestionsExportPayload(questionIds);
            if (!payload || !payload.question_count) {
                notify('没有可导出的题目', true);
                return;
            }
            const normalizedFormat = String(format || 'json').toLowerCase() === 'txt' ? 'txt' : 'json';
            const txtFields = normalizedFormat === 'txt' ? getExportTxtFields() : [];
            const extraFieldHint = normalizedFormat === 'txt'
                ? `，字段：${getExportTxtFieldLabels(txtFields).join('、')}`
                : '';
            const ok = await showConfirmDialog({
                title: '批量导出题目',
                message: `确认导出已选 ${payload.question_count} 道题为 ${normalizedFormat.toUpperCase()} 吗${extraFieldHint}？`,
                confirmText: '开始导出'
            });
            if (!ok) return;

            const safeLibraryId = String(state.currentLibrary?.id || 'library').replace(/[^\w-]+/g, '-');
            const filenameBase = `quiz-export-${safeLibraryId}-selected-${payload.question_count}`;
            if (normalizedFormat === 'txt') {
                const text = buildTxtExportContent(payload, { fields: txtFields });
                downloadBlob(new Blob([text], { type: 'text/plain; charset=utf-8' }), `${filenameBase}.txt`);
                notify(`导出成功：${filenameBase}.txt`);
                return;
            }

            const jsonText = JSON.stringify(payload, null, 2);
            downloadBlob(new Blob([jsonText], { type: 'application/json; charset=utf-8' }), `${filenameBase}.json`);
            notify(`导出成功：${filenameBase}.json`);
        }

        function syncSelectedQuestionCount() {
            const checkboxes = Array.from(document.querySelectorAll('.question-row-check'));
            const checked = checkboxes.filter((item) => item.checked);
            const label = $('question-selected-hint');
            if (label) {
                label.innerText = `已选 ${checked.length} 题`;
            }

            const checkAll = $('question-check-all');
            if (checkAll) {
                const visible = checkboxes.filter((item) => !item.closest('tr')?.classList.contains('hidden'));
                checkAll.checked = visible.length > 0 && visible.every((item) => item.checked);
            }
        }

        function setEditRowExpanded(questionId, expanded) {
            if (!questionId) return;
            const editRow = $('editor').querySelector(`[data-edit-row-id="${questionId}"]`);
            const expandButton = $('editor').querySelector(`.row-expand-btn[data-question-id="${questionId}"]`);
            if (!editRow) return;

            if (expanded) {
                editRow.dataset.expanded = '1';
                editRow.classList.remove('hidden');
                if (expandButton) expandButton.innerText = '⌄';
                const card = editRow.querySelector('.question-edit-card');
                if (card) {
                    updateQuestionCardTypeUI(card);
                }
            } else {
                delete editRow.dataset.expanded;
                editRow.classList.add('hidden');
                if (expandButton) expandButton.innerText = '›';
            }
        }

        function toggleEditRow(questionId) {
            if (!questionId) return;
            const editRow = $('editor').querySelector(`[data-edit-row-id="${questionId}"]`);
            if (!editRow) return;
            const willExpand = !editRow.dataset.expanded;
            $('editor').querySelectorAll('[data-edit-row-id]').forEach((row) => {
                setEditRowExpanded(row.dataset.editRowId, false);
            });
            setEditRowExpanded(questionId, willExpand);
            applyQuestionSearch();
        }

        function getSelectedQuestionIds() {
            return Array.from(document.querySelectorAll('.question-row-check:checked'))
                .map((input) => input.getAttribute('data-question-id'))
                .filter(Boolean);
        }

        $('create-library-btn').addEventListener('click', async () => {
            openCreateLibraryModal();
        });
        $('create-library-header-btn')?.addEventListener('click', async () => {
            openCreateLibraryModal();
        });
        $('create-library-collapsed-btn')?.addEventListener('click', async () => {
            openCreateLibraryModal();
        });

        async function inspectImportJsonFile(file) {
            state.importJsonFile = file || null;
            state.importJsonPreview = null;
            state.importJsonPayload = null;
            $('import-json-file-name').innerText = file ? file.name : '未选择文件';
            if (!file) {
                renderImportJsonPreview();
                return;
            }

            try {
                const text = await file.text();
                const payload = JSON.parse(text);
                const normalized = normalizeImportPayload(payload);
                const questionCount = normalized.libraries.reduce((sum, lib) => sum + lib.questions.length, 0);
                state.importJsonPayload = normalized;
                state.importJsonPreview = {
                    filename: file.name,
                    libraryCount: normalized.libraries.length,
                    questionCount
                };
                state.previewCollapsed.importJson = true;
                state.previewExpanded.importJson = {};
            } catch (error) {
                state.importJsonPreview = {
                    error: `文件检查失败：${error.message || '请确认 JSON 格式'}`
                };
            }
            renderImportJsonPreview();
        }

        async function submitJsonImport() {
            if (!state.importJsonFile && !state.importJsonPayload) {
                notify('请先选择 JSON 文件', true);
                return;
            }
            const replaceExisting = $('import-json-replace').checked;
            const allowEmptyAnswer = $('import-json-allow-empty-answer')?.checked ?? true;
            const sourcePayload = state.importJsonPayload;
            if (sourcePayload) {
                const { total, ready } = filterLibrariesForImport(sourcePayload, { allowEmptyAnswer });
                if (!ready) {
                    notify(
                        allowEmptyAnswer
                            ? '没有可导入的题目（题目为空或选择题缺少选项）'
                            : '没有可导入的题目（需填写答案与选项）',
                        true
                    );
                    return;
                }
                if (ready < total) {
                    const ok = await showConfirmDialog({
                        title: '导入题库 JSON',
                        message: allowEmptyAnswer
                            ? `共有 ${total} 道题，其中 ${ready} 道可导入（其余题目为空或选择题缺少选项）。确认先导入可导入题目吗？`
                            : `共有 ${total} 道题，其中 ${ready} 道已完整可导入。确认先导入已完成题目吗？`,
                        confirmText: '先导入可导入题目'
                    });
                    if (!ok) return;
                }
            }
            const filenameLabel = state.importJsonFile?.name || '编辑后的 JSON';
            const confirmed = await showConfirmDialog({
                title: '导入题库 JSON',
                message: replaceExisting
                    ? `确认导入「${filenameLabel}」并覆盖同 ID 题集吗？`
                    : `确认导入「${filenameLabel}」吗？若 ID 冲突会报错。`,
                confirmText: '开始导入'
            });
            if (!confirmed) return;

            const formData = new FormData();
            if (state.importJsonPayload) {
                const filtered = filterLibrariesForImport(state.importJsonPayload, { allowEmptyAnswer });
                const filteredPayload = filtered.libraries.length
                    ? { libraries: filtered.libraries }
                    : state.importJsonPayload;
                const payloadText = JSON.stringify(filteredPayload, null, 2);
                const blob = new Blob([payloadText], { type: 'application/json' });
                const filename = state.importJsonFile?.name || 'import.json';
                formData.append('file', new File([blob], filename, { type: 'application/json' }));
            } else {
                formData.append('file', state.importJsonFile);
            }
            if (replaceExisting) {
                formData.append('replace_existing', '1');
            }
            formData.append('allow_empty_answer', allowEmptyAnswer ? '1' : '0');

            try {
                const result = await api('/import-json', {
                    method: 'POST',
                    body: formData
                });
                const replacedText = result.replaced_count ? `，覆盖 ${result.replaced_count} 个题集` : '';
                notify(`导入成功：${result.library_count} 个题集，${result.question_count} 道题${replacedText}`);
                closeImportModal();
                state.importJsonFile = null;
                state.importJsonPreview = null;
                $('import-json-file-name').innerText = '未选择文件';
                const firstLibraryId = result.library_ids && result.library_ids[0];
                await loadLibraries(firstLibraryId);
            } catch (error) {
                notify(error.message, true);
            }
        }

        function parseDocInputToPreview() {
            const source = $('import-doc-text').value.trim();
            state.importDocQuestions = [];
            state.importDocParseError = '';
            if (!source) {
                state.importDocParseError = '请输入题目文本后再检测';
                renderImportDocPreview();
                return;
            }
            try {
                state.importDocQuestions = parseQuestionDocument(source);
                state.previewCollapsed.importDoc = true;
                state.previewExpanded.importDoc = {};
            } catch (error) {
                state.importDocParseError = error.message || '解析失败，请检查格式';
            }
            renderImportDocPreview();
        }

        async function submitDocImport() {
            const libraryId = $('import-doc-library').value;
            if (!libraryId) {
                notify('请先创建或选择题集', true);
                return;
            }
            if (!state.importDocQuestions.length) {
                notify('请先解析文档内容', true);
                return;
            }

            const readyQuestions = state.importDocQuestions
                .map(normalizeQuestionForImport)
                .filter(Boolean);
            if (!readyQuestions.length) {
                notify('没有可导入的题目（需填写答案与选项）', true);
                return;
            }
            if (readyQuestions.length < state.importDocQuestions.length) {
                const okPartial = await showConfirmDialog({
                    title: '导入解析结果',
                    message: `共有 ${state.importDocQuestions.length} 道题，其中 ${readyQuestions.length} 道已完整可导入。确认先导入已完成题目吗？`,
                    confirmText: '先导入已完成题目'
                });
                if (!okPartial) return;
            }

            const ok = await showConfirmDialog({
                title: '导入解析结果',
                message: `确认导入 ${readyQuestions.length} 道题到题集「${libraryId}」吗？`,
                confirmText: '开始导入'
            });
            if (!ok) return;

            let importedCount = 0;
            try {
                for (const question of readyQuestions) {
                    await api(`/libraries/${encodeURIComponent(libraryId)}/questions`, {
                        method: 'POST',
                        body: JSON.stringify({
                            library_id: libraryId,
                            question: question.question,
                            type: question.type,
                            options: question.options,
                            answer: question.answer,
                            analysis: question.analysis,
                            difficulty: question.difficulty,
                            chapter: question.chapter
                        })
                    });
                    importedCount += 1;
                }
                notify(`文档导入成功：${importedCount} 道题`);
                closeImportModal();
                await loadLibraries(libraryId);
            } catch (error) {
                notify(`已导入 ${importedCount} 道题，失败原因：${error.message}`, true);
            }
        }

        async function submitSingleImport() {
            try {
                const payload = buildSingleImportPayload();
                if (!payload.library_id) {
                    notify('请先选择题集', true);
                    return;
                }
                if (!payload.question) {
                    notify('题目不能为空', true);
                    return;
                }
                if ((payload.type === 'single' || payload.type === 'multiple') && payload.options.length < 2) {
                    notify('选项至少需要 2 个', true);
                    return;
                }
                if ((payload.type === 'single' || payload.type === 'multiple') && payload.options.length > 8) {
                    notify('选项最多支持 8 个', true);
                    return;
                }
                if (payload.type === 'judge' && payload.options.length === 0) {
                    payload.options = ['正确', '错误'];
                }

                await api(`/libraries/${encodeURIComponent(payload.library_id)}/questions`, {
                    method: 'POST',
                    body: JSON.stringify(payload)
                });
                notify('题目已录入');
                closeImportModal();
                await loadLibraries(payload.library_id);
            } catch (error) {
                notify(error.message || '录入失败', true);
            }
        }

        function resetSingleImportForm() {
            $('import-single-question').value = '';
            $('import-single-type').value = 'single';
            $('import-single-answer').value = '';
            $('import-single-options').value = '';
            $('import-single-analysis').value = '';
            $('import-single-difficulty').value = '1';
            $('import-single-knowledge').value = '';
            updateSingleImportTypeUI();
        }

        function resetImportWorkflowState() {
            state.importJsonFile = null;
            state.importJsonPreview = null;
            state.importJsonPayload = null;
            state.importDocQuestions = [];
            state.importDocParseError = '';
            state.importDocLastFilename = '';
            state.previewCollapsed.importJson = true;
            state.previewCollapsed.importDoc = true;
            state.previewExpanded.importJson = {};
            state.previewExpanded.importDoc = {};
            $('import-json-replace').checked = false;
            $('import-json-allow-empty-answer').checked = true;
            $('import-json-file-name').innerText = '未选择文件';
            $('import-doc-file-name').innerText = '可直接粘贴文本';
            $('import-doc-text').value = '';
            resetSingleImportForm();
        }

        function openImportEntry(defaultTab = 'json') {
            resetImportWorkflowState();
            openImportModal(defaultTab);
        }

        function openExportEntry(defaultTab = 'json') {
            openExportModal(defaultTab);
        }

        $('import-json-btn')?.addEventListener('click', () => {
            if (!isAdminPage('import')) {
                window.location.href = '/admin/import';
                return;
            }
            openImportEntry('json');
        });

        $('import-tab-bar').addEventListener('click', (event) => {
            const btn = event.target.closest('[data-import-tab]');
            if (!btn) return;
            const tab = btn.getAttribute('data-import-tab') || 'json';
            switchImportTab(tab);
        });

        $('import-modal-close-btn')?.addEventListener('click', closeImportModal);
        $('import-json-cancel-btn').addEventListener('click', closeImportModal);
        $('import-doc-cancel-btn').addEventListener('click', closeImportModal);
        $('import-single-cancel-btn').addEventListener('click', closeImportModal);

        $('import-json-pick-btn').addEventListener('click', () => {
            const input = $('import-json-file-input');
            input.value = '';
            input.click();
        });
        $('import-json-file-input').addEventListener('change', async (event) => {
            const file = event.target.files && event.target.files[0];
            await inspectImportJsonFile(file || null);
        });
        $('import-json-submit-btn').addEventListener('click', submitJsonImport);

        $('import-doc-upload-btn').addEventListener('click', () => {
            const input = $('import-doc-file-input');
            input.value = '';
            input.click();
        });
        $('import-doc-file-input').addEventListener('change', async (event) => {
            const file = event.target.files && event.target.files[0];
            if (!file) return;
            try {
                const text = await file.text();
                $('import-doc-text').value = text;
                state.importDocLastFilename = file.name;
                $('import-doc-file-name').innerText = file.name;
                parseDocInputToPreview();
            } catch (error) {
                notify(`读取文件失败：${error.message}`, true);
            } finally {
                event.target.value = '';
            }
        });
        $('import-doc-parse-btn').addEventListener('click', parseDocInputToPreview);
        $('import-doc-clear-btn').addEventListener('click', () => {
            $('import-doc-text').value = '';
            state.importDocQuestions = [];
            state.importDocParseError = '';
            state.importDocLastFilename = '';
            $('import-doc-file-name').innerText = '可直接粘贴文本';
            renderImportDocPreview();
        });
        $('import-doc-example-btn').addEventListener('click', () => {
            $('import-doc-text').value = IMPORT_DOC_SAMPLE;
            state.importDocLastFilename = '示例文本';
            $('import-doc-file-name').innerText = '示例文本';
            parseDocInputToPreview();
        });
        $('import-doc-submit-btn').addEventListener('click', submitDocImport);

        $('import-single-type').addEventListener('change', updateSingleImportTypeUI);
        $('import-single-submit-btn').addEventListener('click', submitSingleImport);

        $('export-json-btn')?.addEventListener('click', () => {
            if (!isAdminPage('export')) {
                window.location.href = '/admin/export';
                return;
            }
            openExportEntry('json');
        });

        $('export-tab-bar').addEventListener('click', (event) => {
            const btn = event.target.closest('[data-export-tab]');
            if (!btn) return;
            const tab = btn.getAttribute('data-export-tab') || 'json';
            switchExportTab(tab);
        });
        $('export-modal-close-btn')?.addEventListener('click', closeExportModal);
        $('export-json-cancel-btn').addEventListener('click', closeExportModal);
        $('export-txt-cancel-btn').addEventListener('click', closeExportModal);
        $('export-json-library').addEventListener('change', () => renderExportPreview('json'));
        $('export-txt-library').addEventListener('change', () => renderExportPreview('txt'));
        document.querySelectorAll('.export-txt-field-check').forEach((input) => {
            input.addEventListener('change', () => {
                readExportTxtFieldsFromControls();
                renderExportPreview('txt');
            });
        });
        $('export-txt-fields-all-btn')?.addEventListener('click', () => {
            state.exportTxtFields = [...EXPORT_TXT_FIELDS];
            syncExportTxtFieldControls();
            renderExportPreview('txt');
        });
        $('export-txt-fields-default-btn')?.addEventListener('click', () => {
            state.exportTxtFields = [...EXPORT_TXT_DEFAULT_FIELDS];
            syncExportTxtFieldControls();
            renderExportPreview('txt');
        });
        $('export-json-submit-btn').addEventListener('click', async () => {
            await exportLibraries('json', $('export-json-library')?.value || '__all__');
        });
        $('export-txt-submit-btn').addEventListener('click', async () => {
            await exportLibraries('txt', $('export-txt-library')?.value || '__all__');
        });

        $('refresh-btn').addEventListener('click', async () => {
            if (isAdminPage('collector-list')) {
                await loadCollectorRecordList();
                notify('采集列表已刷新');
                return;
            }
            await loadLibraries();
            notify('已刷新');
        });
        $('collector-list-refresh-btn')?.addEventListener('click', async () => {
            await loadCollectorRecordList();
            notify('采集列表已刷新');
        });
        $('collector-list-root')?.addEventListener('click', async (event) => {
            const copyBtn = event.target.closest('.collector-record-copy-btn');
            if (copyBtn) {
                const answer = String(copyBtn.getAttribute('data-answer') || '').trim();
                if (!answer) {
                    notify('该记录没有答案可复制', true);
                    return;
                }
                try {
                    if (navigator.clipboard?.writeText) {
                        await navigator.clipboard.writeText(answer);
                        notify('答案已复制');
                    } else {
                        notify('当前环境不支持剪贴板复制', true);
                    }
                } catch (error) {
                    notify(error.message || '复制失败', true);
                }
                return;
            }

            const deleteBtn = event.target.closest('.collector-record-delete-btn');
            if (deleteBtn) {
                const recordId = String(deleteBtn.getAttribute('data-record-id') || '').trim();
                if (!recordId) return;
                const ok = await showConfirmDialog({
                    title: '删除采集记录',
                    message: '确认删除该采集记录吗？同来源的题目记录会一起移除。',
                    confirmText: '确认删除',
                    confirmType: 'danger'
                });
                if (!ok) return;
                try {
                    await api(`/collector-records/${encodeURIComponent(recordId)}`, { method: 'DELETE' });
                    await loadCollectorRecordList();
                    notify('采集记录已删除');
                } catch (error) {
                    notify(error.message || '删除失败', true);
                }
            }
        });
        $('question-bank-refresh-btn')?.addEventListener('click', async () => {
            await loadQuestionBank();
            notify('题库已刷新');
        });
        $('question-bank-list')?.addEventListener('click', async (event) => {
            const target = event.target;
            if (target.id === 'question-bank-search-btn' || target.closest('#question-bank-search-btn')) {
                const input = $('question-bank-search-input');
                const keyword = String(input?.value || '').trim();
                state.questionBankKeyword = keyword;
                state.questionBankSearch = keyword;
                await loadQuestionBank();
                if (input) input.focus();
                return;
            }
            if (target.id === 'question-bank-batch-run-btn') {
                const action = $('question-bank-batch-action')?.value || '';
                const selectedIds = getQuestionBankSelectedIds();
                if (!selectedIds.length) {
                    notify('请先选择题目', true);
                    return;
                }
                const selectedSet = new Set(selectedIds.map((id) => String(id)));
                const grouped = new Map();
                state.questionBankQuestions.forEach((item) => {
                    const id = String(item.id);
                    if (!selectedSet.has(id)) return;
                    const libId = String(item.library_id || '');
                    if (!libId) return;
                    if (!grouped.has(libId)) grouped.set(libId, []);
                    grouped.get(libId).push(item.id);
                });

                if (action === 'batch-export') {
                    const exportFormat = $('question-bank-batch-export-format')?.value || 'json';
                    await exportQuestionBankSelectedQuestions(selectedIds, exportFormat);
                    return;
                }

                if (action === 'delete') {
                    const ok = await showConfirmDialog({
                        title: '删除题目',
                        message: `确认删除已选 ${selectedIds.length} 道题吗？`,
                        confirmText: '确认删除',
                        confirmType: 'danger'
                    });
                    if (!ok) return;
                    try {
                        await Promise.all(selectedIds.map((id) => api(`/questions/${id}`, { method: 'DELETE' })));
                        notify('题目已删除');
                        await loadLibraries(state.currentLibrary?.id);
                    } catch (error) {
                        notify(error.message, true);
                    }
                    return;
                }

                if (!grouped.size) {
                    notify('所选题目缺少题集信息', true);
                    return;
                }

                try {
                    if (action === 'batch-difficulty') {
                        const difficulty = $('question-bank-batch-difficulty')?.value || '1';
                        await Promise.all(Array.from(grouped.entries()).map(([libId, ids]) => (
                            batchUpdateQuestionsForLibrary(libId, ids, { difficulty })
                        )));
                        notify('批量修改完成');
                        await loadLibraries(state.currentLibrary?.id);
                        return;
                    }
                    if (action === 'batch-knowledge') {
                        const knowledgePoint = ($('question-bank-batch-knowledge')?.value || '').trim();
                        await Promise.all(Array.from(grouped.entries()).map(([libId, ids]) => (
                            batchUpdateQuestionsForLibrary(libId, ids, { chapter: knowledgePoint })
                        )));
                        notify('批量修改完成');
                        await loadLibraries(state.currentLibrary?.id);
                        return;
                    }
                    if (action === 'batch-copy') {
                        const targetLibraryId = $('question-bank-batch-target-library')?.value || '';
                        if (!targetLibraryId) {
                            notify('请选择目标题集', true);
                            return;
                        }
                        await Promise.all(Array.from(grouped.entries()).map(([libId, ids]) => (
                            batchUpdateQuestionsForLibrary(libId, ids, { copy_to_library_id: targetLibraryId })
                        )));
                        notify('批量复制完成');
                        await loadLibraries(state.currentLibrary?.id);
                        return;
                    }
                    if (action === 'batch-move') {
                        const targetLibraryId = $('question-bank-batch-target-library')?.value || '';
                        if (!targetLibraryId) {
                            notify('请选择目标题集', true);
                            return;
                        }
                        await Promise.all(Array.from(grouped.entries()).map(([libId, ids]) => (
                            batchUpdateQuestionsForLibrary(libId, ids, { target_library_id: targetLibraryId })
                        )));
                        notify('批量移动完成');
                        await loadLibraries(state.currentLibrary?.id);
                    }
                } catch (error) {
                    notify(error.message, true);
                }
                return;
            }
            if (target.classList.contains('question-bank-expand-btn')) {
                const questionId = target.getAttribute('data-question-id');
                toggleQuestionBankRow(questionId);
                return;
            }
            if (target.classList.contains('question-bank-collapse-btn')) {
                const questionId = target.getAttribute('data-question-id');
                setQuestionBankRowExpanded(questionId, false);
                return;
            }
            if (target.classList.contains('question-bank-save-btn')) {
                const card = target.closest('.question-bank-edit-card');
                const questionId = target.getAttribute('data-question-id') || card?.getAttribute('data-question-bank-edit');
                if (!card || !questionId) return;
                try {
                    await api(`/questions/${questionId}`, {
                        method: 'PUT',
                        body: JSON.stringify(buildQuestionBankPayload(card))
                    });
                    notify('题目已保存');
                    await loadLibraries(state.currentLibrary?.id);
                } catch (error) {
                    notify(error.message, true);
                }
                return;
            }
            if (target.classList.contains('ai-generate-btn')) {
                const card = target.closest('.question-bank-edit-card');
                if (!card) return;
                await runAiGenerateForCard(card, target);
                return;
            }
            if (target.classList.contains('delete-question-btn')) {
                const questionId = target.getAttribute('data-question-id') || target.closest('[data-question-id]')?.getAttribute('data-question-id');
                if (!questionId) return;
                const ok = await showConfirmDialog({
                    title: '删除题目',
                    message: '确认删除这道题吗？',
                    confirmText: '确认删除',
                    confirmType: 'danger'
                });
                if (!ok) return;
                try {
                    await api(`/questions/${questionId}`, { method: 'DELETE' });
                    notify('题目已删除');
                    await loadLibraries(state.currentLibrary?.id);
                } catch (error) {
                    notify(error.message, true);
                }
            }
        });
        $('question-bank-list')?.addEventListener('keydown', (event) => {
            if (event.target.id !== 'question-bank-search-input') return;
            if (event.key !== 'Enter') return;
            event.preventDefault();
            const input = event.target;
            const keyword = String(input?.value || '').trim();
            state.questionBankKeyword = keyword;
            state.questionBankSearch = keyword;
            loadQuestionBank();
        });

        $('question-bank-list')?.addEventListener('change', (event) => {
            const target = event.target;
            if (target.classList.contains('qb-type')) {
                const card = target.closest('.question-bank-edit-card');
                updateQuestionBankCardTypeUI(card);
                return;
            }
            if (target.id === 'question-bank-type-filter') {
                state.questionBankTypeFilter = target.value || 'all';
                applyQuestionBankSearch();
                return;
            }
            if (target.id === 'question-bank-knowledge-filter') {
                state.questionBankKnowledgeFilter = target.value || 'all';
                applyQuestionBankSearch();
                return;
            }
            if (target.id === 'question-bank-difficulty-filter') {
                state.questionBankDifficultyFilter = target.value || 'all';
                applyQuestionBankSearch();
                return;
            }
            if (target.id === 'question-bank-batch-action') {
                updateQuestionBankBatchControls();
                return;
            }
            if (target.id === 'question-bank-check-all') {
                const checked = target.checked;
                $('question-bank-list')?.querySelectorAll('[data-question-id]').forEach((row) => {
                    if (row.classList.contains('hidden')) return;
                    const checkbox = row.querySelector('.question-bank-row-check');
                    if (checkbox) checkbox.checked = checked;
                });
                syncQuestionBankSelectedCount();
                return;
            }
            if (target.classList.contains('question-bank-row-check')) {
                syncQuestionBankSelectedCount();
            }
        });

        $('toggle-library-list-btn').addEventListener('click', () => {
            toggleLibraryListCollapsed();
        });
        $('mobile-library-toggle-btn')?.addEventListener('click', () => {
            toggleLibraryListCollapsed();
        });
        $('library-panel-backdrop')?.addEventListener('click', () => {
            setLibraryListCollapsed(true);
        });
        $('sidebar-mobile-toggle-btn')?.addEventListener('click', () => {
            toggleSidebarMobile();
        });
        $('sidebar-backdrop')?.addEventListener('click', () => {
            setSidebarMobileOpen(false);
        });

        $('logout-btn').addEventListener('click', async () => {
            const ok = await showConfirmDialog({
                title: '退出登录',
                message: '确认退出管理员后台吗？',
                confirmText: '退出登录',
                confirmType: 'danger'
            });
            if (!ok) return;
            try {
                await api('/logout', { method: 'POST' });
            } finally {
                window.location.href = '/admin/login';
            }
        });

        $('create-lib-cancel-btn').addEventListener('click', closeCreateLibraryModal);
        $('create-library-modal').addEventListener('click', (event) => {
            if (event.target === $('create-library-modal')) closeCreateLibraryModal();
        });
        $('create-lib-submit-btn').addEventListener('click', async () => {
            const title = $('new-lib-title').value.trim();
            const icon = $('new-lib-icon').value.trim() || '📚';
            const description = $('new-lib-description').value.trim();
            const isPublic = $('new-lib-public')?.checked ?? true;
            if (!title) {
                notify('题集名称不能为空', true);
                return;
            }
            try {
                const created = await api('/libraries', {
                    method: 'POST',
                    body: JSON.stringify({ title, icon, description, is_public: isPublic })
                });
                closeCreateLibraryModal();
                notify('题集已创建');
                await loadLibraries(created.id);
            } catch (error) {
                notify(error.message, true);
            }
        });

        $('library-visibility-filter')?.addEventListener('change', async (event) => {
            const value = String(event.target?.value || 'all').trim();
            state.libraryVisibilityFilter = ['all', 'public', 'private'].includes(value) ? value : 'all';
            const visibleLibraries = state.libraries.filter((lib) => {
                if (state.libraryVisibilityFilter === 'public') return lib?.is_public !== false;
                if (state.libraryVisibilityFilter === 'private') return lib?.is_public === false;
                return true;
            });
            if (
                state.currentLibrary
                && !visibleLibraries.some((lib) => lib.id === state.currentLibrary.id)
                && visibleLibraries.length
            ) {
                await selectLibrary(visibleLibraries[0].id);
                return;
            }
            renderLibraryList();
        });

        $('library-list').addEventListener('click', async (event) => {
            const btn = event.target.closest('[data-lib-id]');
            if (!btn) return;
            const libraryId = btn.getAttribute('data-lib-id');
            if (!libraryId) return;
            await selectLibrary(libraryId);
            if (window.matchMedia('(max-width: 1023px)').matches) {
                setLibraryListCollapsed(true);
            }
        });

        $('editor').addEventListener('click', async (event) => {
            if (!state.currentLibrary) return;
            const target = event.target;

            if (target.id === 'question-search-btn' || target.closest('#question-search-btn')) {
                const searchInput = $('question-search-input');
                const keyword = String(searchInput?.value || '').trim();
                state.questionSearch = keyword;
                applyQuestionSearch();
                if (searchInput) searchInput.focus();
                return;
            }

            if (target.id === 'save-library-btn') {
                const libraryId = $('lib-id').value.trim();
                const title = $('lib-title').value.trim();
                const icon = $('lib-icon').value.trim();
                const description = $('lib-description').value.trim();
                const isPublic = $('lib-is-public')?.checked ?? true;
                try {
                    const updated = await api(`/libraries/${state.currentLibrary.id}`, {
                        method: 'PUT',
                        body: JSON.stringify({ id: libraryId, title, icon, description, is_public: isPublic })
                    });
                    notify('题集信息已保存');
                    await loadLibraries(updated?.id || libraryId || state.currentLibrary.id);
                } catch (error) {
                    notify(error.message, true);
                }
                return;
            }

            if (target.id === 'delete-library-btn') {
                const ok = await showConfirmDialog({
                    title: '删除题集',
                    message: `确认删除题集「${state.currentLibrary.title}」吗？该操作不可恢复。`,
                    confirmText: '确认删除',
                    confirmType: 'danger'
                });
                if (!ok) return;
                try {
                    await api(`/libraries/${state.currentLibrary.id}`, { method: 'DELETE' });
                    notify('题集已删除');
                    state.currentLibrary = null;
                    await loadLibraries();
                } catch (error) {
                    notify(error.message, true);
                }
                return;
            }

            if (target.id === 'question-batch-run-btn') {
                const action = $('question-batch-action')?.value || '';
                if (!action) {
                    notify('请选择批量操作', true);
                    return;
                }
                const selectedIds = getSelectedQuestionIds();
                if (!selectedIds.length) {
                    notify('请先勾选要操作的题目', true);
                    return;
                }
                if (action === 'delete') {
                    const ok = await showConfirmDialog({
                        title: '批量删除题目',
                        message: `确认删除已选中的 ${selectedIds.length} 道题吗？该操作不可恢复。`,
                        confirmText: '确认删除',
                        confirmType: 'danger'
                    });
                    if (!ok) return;
                    try {
                        for (const questionId of selectedIds) {
                            await api(`/questions/${questionId}`, { method: 'DELETE' });
                        }
                        notify(`批量删除完成：${selectedIds.length} 道题`);
                        await selectLibrary(state.currentLibrary.id);
                    } catch (error) {
                        notify(error.message, true);
                    }
                    return;
                }
                if (action === 'batch-difficulty') {
                    const difficulty = $('question-batch-difficulty')?.value || '1';
                    try {
                        const result = await batchUpdateQuestions(selectedIds, { difficulty });
                        notify(`批量修改完成：${result.updated_count || 0} 道题已更新难度`);
                        await selectLibrary(state.currentLibrary.id);
                    } catch (error) {
                        notify(error.message, true);
                    }
                    return;
                }
                if (action === 'batch-knowledge') {
                    const knowledgePoint = ($('question-batch-knowledge')?.value || '').trim();
                    try {
                        const result = await batchUpdateQuestions(selectedIds, { chapter: knowledgePoint });
                        notify(`批量修改完成：${result.updated_count || 0} 道题已更新章节`);
                        await selectLibrary(state.currentLibrary.id);
                    } catch (error) {
                        notify(error.message, true);
                    }
                    return;
                }
                if (action === 'batch-copy') {
                    const targetLibraryId = $('question-batch-target-library')?.value || '';
                    if (!targetLibraryId) {
                        notify('请选择目标题集', true);
                        return;
                    }
                    if (targetLibraryId === state.currentLibrary.id) {
                        notify('复制目标题集不能与当前题集相同', true);
                        return;
                    }
                    const targetLibrary = state.libraries.find((item) => item.id === targetLibraryId);
                    const ok = await showConfirmDialog({
                        title: '批量复制题目',
                        message: `确认将已选中的 ${selectedIds.length} 道题复制到「${targetLibrary?.title || targetLibraryId}」吗？`,
                        confirmText: '确认复制'
                    });
                    if (!ok) return;
                    try {
                        const result = await batchUpdateQuestions(selectedIds, { copy_to_library_id: targetLibraryId });
                        notify(`批量复制完成：${result.copied_count || 0} 道题已复制`);
                        await loadLibraries(state.currentLibrary.id);
                    } catch (error) {
                        notify(error.message, true);
                    }
                    return;
                }
                if (action === 'batch-move') {
                    const targetLibraryId = $('question-batch-target-library')?.value || '';
                    if (!targetLibraryId) {
                        notify('请选择目标题集', true);
                        return;
                    }
                    if (targetLibraryId === state.currentLibrary.id) {
                        notify('目标题集不能与当前题集相同', true);
                        return;
                    }
                    const targetLibrary = state.libraries.find((item) => item.id === targetLibraryId);
                    const ok = await showConfirmDialog({
                        title: '批量移动题目',
                        message: `确认将已选中的 ${selectedIds.length} 道题移动到「${targetLibrary?.title || targetLibraryId}」吗？`,
                        confirmText: '确认移动',
                        confirmType: 'danger'
                    });
                    if (!ok) return;
                    try {
                        const result = await batchUpdateQuestions(selectedIds, { target_library_id: targetLibraryId });
                        notify(`批量移动完成：${result.updated_count || 0} 道题已移动`);
                        await loadLibraries(state.currentLibrary.id);
                    } catch (error) {
                        notify(error.message, true);
                    }
                    return;
                }
                if (action === 'batch-export') {
                    const exportFormat = $('question-batch-export-format')?.value || 'json';
                    await exportSelectedQuestions(selectedIds, exportFormat);
                    return;
                }
            }

            if (target.classList.contains('row-expand-btn')) {
                const questionId = target.getAttribute('data-question-id') || target.closest('[data-question-id]')?.getAttribute('data-question-id');
                toggleEditRow(questionId);
                return;
            }

            if (target.classList.contains('collapse-question-btn')) {
                const questionId = target.getAttribute('data-question-id');
                setEditRowExpanded(questionId, false);
                applyQuestionSearch();
                return;
            }

            if (target.classList.contains('ai-generate-btn')) {
                const card = target.closest('.question-edit-card') || target.closest('[data-question-id]');
                if (!card) return;
                await runAiGenerateForCard(card, target);
                return;
            }

            if (target.classList.contains('save-question-btn')) {
                const card = target.closest('.question-edit-card') || target.closest('[data-question-id]');
                const questionId = card?.getAttribute('data-question-id');
                if (!card || !questionId) return;
                try {
                    await api(`/questions/${questionId}`, {
                        method: 'PUT',
                        body: JSON.stringify(buildQuestionPayload(card))
                    });
                    notify('题目已保存');
                    await selectLibrary(state.currentLibrary.id);
                } catch (error) {
                    notify(error.message, true);
                }
                return;
            }

            if (target.classList.contains('delete-question-btn')) {
                const questionId = target.getAttribute('data-question-id') || target.closest('[data-question-id]')?.getAttribute('data-question-id');
                if (!questionId) return;
                const ok = await showConfirmDialog({
                    title: '删除题目',
                    message: '确认删除这道题吗？',
                    confirmText: '确认删除',
                    confirmType: 'danger'
                });
                if (!ok) return;
                try {
                    await api(`/questions/${questionId}`, { method: 'DELETE' });
                    notify('题目已删除');
                    await selectLibrary(state.currentLibrary.id);
                } catch (error) {
                    notify(error.message, true);
                }
            }
        });
        $('editor').addEventListener('keydown', (event) => {
            if (event.target.id !== 'question-search-input') return;
            if (event.key !== 'Enter') return;
            event.preventDefault();
            const searchInput = event.target;
            const keyword = String(searchInput?.value || '').trim();
            state.questionSearch = keyword;
            applyQuestionSearch();
        });


        $('editor').addEventListener('change', (event) => {
            const target = event.target;
            if (target.classList.contains('q-type')) {
                const card = target.closest('.question-edit-card') || target.closest('[data-question-id]');
                updateQuestionCardTypeUI(card);
                return;
            }

            if (target.id === 'question-type-filter') {
                state.questionTypeFilter = target.value || 'all';
                applyQuestionSearch();
                return;
            }
            if (target.id === 'question-knowledge-filter') {
                state.questionKnowledgeFilter = target.value || 'all';
                applyQuestionSearch();
                return;
            }
            if (target.id === 'question-difficulty-filter') {
                state.questionDifficultyFilter = target.value || 'all';
                applyQuestionSearch();
                return;
            }
            if (target.id === 'question-batch-action') {
                updateBatchActionControls();
                return;
            }
            if (target.id === 'question-check-all') {
                const checked = target.checked;
                $('editor').querySelectorAll('[data-question-filter-row]').forEach((row) => {
                    if (row.classList.contains('hidden')) return;
                    const checkbox = row.querySelector('.question-row-check');
                    if (checkbox) checkbox.checked = checked;
                });
                syncSelectedQuestionCount();
                return;
            }
            if (target.classList.contains('question-row-check')) {
                syncSelectedQuestionCount();
            }
        });

        document.addEventListener('keydown', (event) => {
            if (event.key !== 'Escape') return;
            if (!$('import-modal').classList.contains('hidden')) {
                closeImportModal();
            }
            if (!$('create-library-modal').classList.contains('hidden')) {
                closeCreateLibraryModal();
            }
            if (!$('confirm-modal').classList.contains('hidden')) {
                closeConfirmDialog(false);
            }
            if (!$('export-modal').classList.contains('hidden')) {
                closeExportModal();
            }
            if (!$('settings-modal').classList.contains('hidden')) {
                closeSettingsModal();
            }
            if (isMobileViewport() && !state.libraryListCollapsed) {
                setLibraryListCollapsed(true);
            }
            if (isMobileViewport() && state.sidebarMobileOpen) {
                setSidebarMobileOpen(false);
            }
        });

        (async function init() {
            document.body.dataset.themePreference = getStoredThemePreference();
            syncThemeMode();
            syncAdminLayoutMetrics();
            readExportTxtFieldsFromControls();
            setLibraryListCollapsed(getStoredLibraryPanelCollapsed(), false);
            setSidebarCollapsed();
            setSidebarMobileOpen(false);
            if ($('theme-toggle')) {
                $('theme-toggle').addEventListener('click', toggleThemeMode);
            }
            if ($('settings-btn')) {
                $('settings-btn').addEventListener('click', openSettingsModal);
            }
            if ($('settings-close-btn')) {
                $('settings-close-btn').addEventListener('click', closeSettingsModal);
            }
            if ($('settings-cancel-btn')) {
                $('settings-cancel-btn').addEventListener('click', closeSettingsModal);
            }
            if ($('settings-save-btn')) {
                $('settings-save-btn').addEventListener('click', saveAiSettings);
            }
            if ($('settings-test-btn')) {
                $('settings-test-btn').addEventListener('click', testAiConnection);
            }
            if ($('settings-backdrop')) {
                $('settings-backdrop').addEventListener('click', closeSettingsModal);
            }
            if ($('collector-pick-btn')) {
                $('collector-pick-btn').addEventListener('click', () => {
                    $('collector-file-input')?.click();
                });
            }
            if ($('collector-file-input')) {
                $('collector-file-input').addEventListener('change', (event) => {
                    const file = event.target.files && event.target.files[0];
                    state.collectorFile = file || null;
                    state.collectorFilename = file ? file.name : '';
                    if ($('collector-file-name')) {
                        $('collector-file-name').innerText = file ? file.name : '未选择文件';
                    }
                    state.collectorPayload = null;
                    state.collectorPreview = null;
                    if ($('collector-import-btn')) $('collector-import-btn').disabled = true;
                    if ($('collector-preview')) {
                        $('collector-preview').innerText = file ? '已选择文件，点击“开始识别”。' : '请上传题目文件后识别';
                    }
                    if (!file) resetCollectorState();
                });
            }
            if ($('collector-run-btn')) {
                $('collector-run-btn').addEventListener('click', runCollector);
            }
            if ($('collector-import-btn')) {
                $('collector-import-btn').addEventListener('click', importCollectorPayload);
            }
            if ($('collector-reset-btn')) {
                $('collector-reset-btn').addEventListener('click', resetCollectorState);
            }
            if ($('collector-preview')) {
                $('collector-preview').addEventListener('input', (event) => {
                    const target = event.target;
                    if (!state.collectorPayload) return;
                    const field = target.getAttribute('data-collector-field');
                    const libField = target.getAttribute('data-collector-lib-field');
                    if (!field && !libField) return;
                    const libIndex = Number(target.closest('[data-collector-lib]')?.getAttribute('data-collector-lib') || target.getAttribute('data-collector-lib'));
                    if (Number.isNaN(libIndex) || !state.collectorPayload.libraries[libIndex]) return;
                    if (libField) {
                        const value = target.value || '';
                        state.collectorPayload.libraries[libIndex][libField] = value;
                        return;
                    }
                    const questionIndex = Number(target.closest('[data-collector-question]')?.getAttribute('data-collector-question'));
                    if (Number.isNaN(questionIndex)) return;
                    const question = state.collectorPayload.libraries[libIndex].questions[questionIndex];
                    if (!question) return;
                    if (field === 'options') {
                        question.options = String(target.value || '')
                            .split(/\r?\n/)
                            .map((item) => item.trim())
                            .filter(Boolean);
                    } else if (field === 'type') {
                        question.type = normalizeQuestionType(target.value || 'single');
                    } else if (field === 'difficulty') {
                        question.difficulty = toIntegerOrDefault(target.value, 1);
                    } else {
                        question[field] = target.value;
                    }
                });
                $('collector-preview').addEventListener('change', (event) => {
                    const target = event.target;
                    if (target.getAttribute('data-collector-field') === 'type') {
                        renderCollectorPreview(state.collectorPayload, state.collectorFilename);
                    }
                });
                $('collector-preview').addEventListener('click', async (event) => {
                    const expandBtn = event.target.closest('.collector-expand-btn');
                    if (expandBtn) {
                        const libIndex = Number(expandBtn.getAttribute('data-collector-lib'));
                        const questionIndex = Number(expandBtn.getAttribute('data-collector-question'));
                        if (!Number.isNaN(libIndex) && !Number.isNaN(questionIndex)) {
                            const key = `${libIndex}-${questionIndex}`;
                            state.previewExpanded.collector[key] = !state.previewExpanded.collector[key];
                            renderCollectorPreview(state.collectorPayload, state.collectorFilename);
                        }
                        return;
                    }
                    const batchBtn = event.target.closest('.collector-ai-batch');
                    if (batchBtn) {
                        await runBatchAiGenerateCollector(batchBtn);
                        return;
                    }
                    const aiBtn = event.target.closest('.collector-ai-btn');
                    if (aiBtn && state.collectorPayload) {
                        const libIndex = Number(aiBtn.getAttribute('data-collector-lib'));
                        const questionIndex = Number(aiBtn.getAttribute('data-collector-question'));
                        const lib = state.collectorPayload.libraries[libIndex];
                        const item = lib?.questions?.[questionIndex];
                        if (!item) return;
                        await runAiGenerateForPreviewItem(
                            { question: item.question, type: item.type, options: item.options },
                            aiBtn,
                            (result) => {
                                if (result.answer) item.answer = result.answer;
                                if (result.analysis) item.analysis = result.analysis;
                                if (result.chapter) item.chapter = result.chapter;
                            }
                        );
                        renderCollectorPreview(state.collectorPayload, state.collectorFilename);
                        return;
                    }
                    const btn = event.target.closest('.collector-delete-btn');
                    if (!btn || !state.collectorPayload) return;
                    const libIndex = Number(btn.getAttribute('data-collector-lib'));
                    const questionIndex = Number(btn.getAttribute('data-collector-question'));
                    if (Number.isNaN(libIndex) || Number.isNaN(questionIndex)) return;
                    const lib = state.collectorPayload.libraries[libIndex];
                    if (!lib || !Array.isArray(lib.questions)) return;
                    lib.questions.splice(questionIndex, 1);
                    state.previewExpanded.collector = {};
                    renderCollectorPreview(state.collectorPayload, state.collectorFilename);
                });
            }
            if ($('import-json-preview')) {
                $('import-json-preview').addEventListener('input', (event) => {
                    const target = event.target;
                    if (!state.importJsonPayload) return;
                    const field = target.getAttribute('data-import-json-field');
                    const libField = target.getAttribute('data-import-json-lib-field');
                    if (!field && !libField) return;
                    const libIndex = Number(target.closest('[data-import-json-lib]')?.getAttribute('data-import-json-lib') || target.getAttribute('data-import-json-lib'));
                    if (Number.isNaN(libIndex) || !state.importJsonPayload.libraries[libIndex]) return;
                    if (libField) {
                        state.importJsonPayload.libraries[libIndex][libField] = target.value || '';
                        return;
                    }
                    const questionIndex = Number(target.closest('[data-import-json-question]')?.getAttribute('data-import-json-question'));
                    if (Number.isNaN(questionIndex)) return;
                    const question = state.importJsonPayload.libraries[libIndex].questions[questionIndex];
                    if (!question) return;
                    if (field === 'options') {
                        question.options = String(target.value || '')
                            .split(/\r?\n/)
                            .map((item) => item.trim())
                            .filter(Boolean);
                    } else if (field === 'type') {
                        question.type = normalizeQuestionType(target.value || 'single');
                    } else if (field === 'difficulty') {
                        question.difficulty = toIntegerOrDefault(target.value, 1);
                    } else {
                        question[field] = target.value;
                    }
                });
                $('import-json-preview').addEventListener('change', (event) => {
                    const target = event.target;
                    if (target.getAttribute('data-import-json-field') === 'type') {
                        renderImportJsonPreview();
                    }
                });
                $('import-json-preview').addEventListener('click', async (event) => {
                    const expandBtn = event.target.closest('.import-json-expand-btn');
                    if (expandBtn) {
                        const libIndex = Number(expandBtn.getAttribute('data-import-json-lib'));
                        const questionIndex = Number(expandBtn.getAttribute('data-import-json-question'));
                        if (!Number.isNaN(libIndex) && !Number.isNaN(questionIndex)) {
                            const key = `${libIndex}-${questionIndex}`;
                            state.previewExpanded.importJson[key] = !state.previewExpanded.importJson[key];
                            renderImportJsonPreview();
                        }
                        return;
                    }
                    const batchBtn = event.target.closest('.import-json-ai-batch');
                    if (batchBtn) {
                        await runBatchAiGenerateImportJson(batchBtn);
                        return;
                    }
                    const aiBtn = event.target.closest('.import-json-ai-btn');
                    if (aiBtn && state.importJsonPayload) {
                        const libIndex = Number(aiBtn.getAttribute('data-import-json-lib'));
                        const questionIndex = Number(aiBtn.getAttribute('data-import-json-question'));
                        const lib = state.importJsonPayload.libraries[libIndex];
                        const item = lib?.questions?.[questionIndex];
                        if (!item) return;
                        await runAiGenerateForPreviewItem(
                            { question: item.question, type: item.type, options: item.options },
                            aiBtn,
                            (result) => {
                                if (result.answer) item.answer = result.answer;
                                if (result.analysis) item.analysis = result.analysis;
                                if (result.chapter) item.chapter = result.chapter;
                            }
                        );
                        renderImportJsonPreview();
                        return;
                    }
                    const btn = event.target.closest('.import-json-delete-btn');
                    if (!btn || !state.importJsonPayload) return;
                    const libIndex = Number(btn.getAttribute('data-import-json-lib'));
                    const questionIndex = Number(btn.getAttribute('data-import-json-question'));
                    if (Number.isNaN(libIndex) || Number.isNaN(questionIndex)) return;
                    const lib = state.importJsonPayload.libraries[libIndex];
                    if (!lib || !Array.isArray(lib.questions)) return;
                    lib.questions.splice(questionIndex, 1);
                    state.previewExpanded.importJson = {};
                    renderImportJsonPreview();
                });
            }
            if ($('import-doc-preview')) {
                $('import-doc-preview').addEventListener('input', (event) => {
                    const target = event.target;
                    const field = target.getAttribute('data-import-doc-field');
                    if (!field) return;
                    const questionIndex = Number(target.closest('[data-import-doc-question]')?.getAttribute('data-import-doc-question'));
                    if (Number.isNaN(questionIndex)) return;
                    const question = state.importDocQuestions[questionIndex];
                    if (!question) return;
                    if (field === 'options') {
                        question.options = String(target.value || '')
                            .split(/\r?\n/)
                            .map((item) => item.trim())
                            .filter(Boolean);
                    } else if (field === 'type') {
                        question.type = normalizeQuestionType(target.value || 'single');
                    } else if (field === 'difficulty') {
                        question.difficulty = toIntegerOrDefault(target.value, 1);
                    } else {
                        question[field] = target.value;
                    }
                });
                $('import-doc-preview').addEventListener('change', (event) => {
                    const target = event.target;
                    if (target.getAttribute('data-import-doc-field') === 'type') {
                        renderImportDocPreview();
                    }
                });
                $('import-doc-preview').addEventListener('click', async (event) => {
                    const expandBtn = event.target.closest('.import-doc-expand-btn');
                    if (expandBtn) {
                        const questionIndex = Number(expandBtn.getAttribute('data-import-doc-question'));
                        if (!Number.isNaN(questionIndex)) {
                            const key = String(questionIndex);
                            state.previewExpanded.importDoc[key] = !state.previewExpanded.importDoc[key];
                            renderImportDocPreview();
                        }
                        return;
                    }
                    const batchBtn = event.target.closest('.import-doc-ai-batch');
                    if (batchBtn) {
                        await runBatchAiGenerateImportDoc(batchBtn);
                        return;
                    }
                    const aiBtn = event.target.closest('.import-doc-ai-btn');
                    if (aiBtn) {
                        const questionIndex = Number(aiBtn.getAttribute('data-import-doc-question'));
                        const item = state.importDocQuestions[questionIndex];
                        if (!item) return;
                        await runAiGenerateForPreviewItem(
                            { question: item.question, type: item.type, options: item.options },
                            aiBtn,
                            (result) => {
                                if (result.answer) item.answer = result.answer;
                                if (result.analysis) item.analysis = result.analysis;
                                if (result.chapter) item.chapter = result.chapter;
                            }
                        );
                        renderImportDocPreview();
                        return;
                    }
                    const btn = event.target.closest('.import-doc-delete-btn');
                    if (!btn) return;
                    const questionIndex = Number(btn.getAttribute('data-import-doc-question'));
                    if (Number.isNaN(questionIndex)) return;
                    state.importDocQuestions.splice(questionIndex, 1);
                    state.previewExpanded.importDoc = {};
                    renderImportDocPreview();
                });
            }
            if ($('admin-global-search-input')) {
                $('admin-global-search-input').addEventListener('input', (event) => {
                    applyGlobalSearchKeyword(event.target.value);
                });
            }
            const onSystemThemeChange = () => syncThemeMode();
            if (darkModeMedia.addEventListener) {
                darkModeMedia.addEventListener('change', onSystemThemeChange);
            } else if (darkModeMedia.addListener) {
                darkModeMedia.addListener(onSystemThemeChange);
            }
            let lastMobileViewport = isMobileViewport();
            window.addEventListener('resize', () => {
                syncAdminLayoutMetrics();
                const mobileNow = isMobileViewport();
                if (mobileNow !== lastMobileViewport) {
                    lastMobileViewport = mobileNow;
                    if (mobileNow) {
                        setLibraryListCollapsed(true, false);
                        setSidebarMobileOpen(false);
                    } else {
                        setSidebarMobileOpen(false);
                    }
                }
                renderLibraryPanelState();
                renderSidebarState();
            });
            await loadAiSettings();
            applyAdminPageMode();
            await loadLibraries();
            applyAdminPageMode();
            if (isAdminPage('collector-list')) {
                await loadCollectorRecordList();
            }
            maybeOpenStandaloneModal();
        })();
