const API_BASE = (document.body?.dataset?.adminApiBase || '/api/admin').replace(/\/+$/, '') || '/api/admin';
        const darkModeMedia = window.matchMedia('(prefers-color-scheme: dark)');
        const THEME_STORAGE_KEY = 'quiz_theme_preference';
        const LIBRARY_PANEL_COLLAPSE_KEY = 'quiz_admin_library_panel_collapsed';
        const IMPORT_TAB_IDS = ['json', 'doc', 'single'];
        const EXPORT_TAB_IDS = ['json', 'txt'];
        const EXPORT_TXT_FIELDS = ['type', 'question', 'options', 'answer', 'analysis', 'difficulty', 'chapter', 'updated_at'];
        const EXPORT_TXT_DEFAULT_FIELDS = ['type', 'question', 'options', 'answer', 'analysis', 'difficulty', 'chapter'];
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
            libraryListCollapsed: false,
            importModalTab: 'json',
            exportModalTab: 'json',
            exportTxtFields: [...EXPORT_TXT_DEFAULT_FIELDS],
            importJsonFile: null,
            importJsonPreview: null,
            importDocQuestions: [],
            importDocParseError: '',
            importDocLastFilename: ''
        };

        const $ = (id) => document.getElementById(id);
        let confirmResolver = null;

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
            if (window.matchMedia('(max-width: 1023px)').matches) {
                return true;
            }
            const raw = localStorage.getItem(LIBRARY_PANEL_COLLAPSE_KEY);
            if (raw === '1') return true;
            if (raw === '0') return false;
            return false;
        }

        function isMobileViewport() {
            return window.matchMedia('(max-width: 1023px)').matches;
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

            if (mainLayout) {
                mainLayout.classList.toggle('layout-sidebar-collapsed', !mobile && state.libraryListCollapsed);
            }
            panel.classList.toggle('library-panel-collapsed', !mobile && state.libraryListCollapsed);
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
            btn.innerHTML = `${icon}<span class="sr-only">${title}</span>`;
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

        function getQuestionTypeText(type) {
            const normalized = normalizeQuestionType(type);
            if (normalized === 'multiple') return '多选题';
            if (normalized === 'judge') return '判断题';
            if (normalized === 'fill') return '填空题';
            if (normalized === 'qa') return '问答题';
            return '单选题';
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
            const countLabel = $('question-count-label');
            if (countLabel) {
                countLabel.innerText = `题目列表 显示 ${visibleCount} / ${totalCount} 题`;
            }

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
            $('import-modal').classList.add('flex');
            renderImportJsonPreview();
            renderImportDocPreview();
            updateSingleImportTypeUI();
        }

        function closeImportModal() {
            $('import-modal').classList.add('hidden');
            $('import-modal').classList.remove('flex');
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
            $('export-modal').classList.add('flex');
        }

        function closeExportModal() {
            $('export-modal').classList.add('hidden');
            $('export-modal').classList.remove('flex');
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

            const cards = preview.libraries.slice(0, 8).map((lib, index) => `
                <article class="import-preview-card">
                    <h5>${index + 1}. ${esc(lib.title || '未命名题集')}</h5>
                    <p>ID: ${esc(lib.id || '自动生成')}</p>
                    <p>题目数: ${lib.questionCount}</p>
                </article>
            `).join('');
            const extraText = preview.libraries.length > 8
                ? `<p class="mt-2 text-xs text-slate-400">其余 ${preview.libraries.length - 8} 个题集将在导入时一并处理。</p>`
                : '';

            previewRoot.innerHTML = `
                <div class="mb-3 text-sm">
                    <p>共检测到 <strong>${preview.libraryCount}</strong> 个题集，<strong>${preview.questionCount}</strong> 道题。</p>
                    <p class="text-xs text-slate-400 mt-1">文件：${esc(preview.filename || '')}</p>
                </div>
                <div class="import-preview-list">${cards}</div>
                ${extraText}
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
                const match = line.match(/^(?:[一二三四五六七八九十\d]+[、\.\)]\s*)?(单选题|多选题|判断题|填空题|问答题)\s*[:：]?$/);
                if (!match) return '';
                const label = match[1];
                if (label === '单选题') return 'single';
                if (label === '多选题') return 'multiple';
                if (label === '判断题') return 'judge';
                if (label === '填空题') return 'fill';
                if (label === '问答题') return 'qa';
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

            const commitCurrent = () => {
                if (!current) return;
                const question = String(current.question || '').trim();
                if (!question) {
                    current = null;
                    return;
                }
                const type = normalizeQuestionType(current.type || currentType);
                const options = (current.options || []).map((item) => stripOptionPrefix(item)).filter(Boolean);
                const answerRaw = String(current.answer || '').trim();
                const analysis = String(current.analysis || '').trim();
                const chapter = String(current.chapter || '').trim();
                const difficulty = Math.max(1, toIntegerOrDefault(current.difficulty, 1));
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

                const questionMatch = line.match(/^(\d+)\s*[\.、\)]\s*(.+)$/);
                if (questionMatch) {
                    if (!currentType) return;
                    commitCurrent();
                    current = {
                        type: currentType,
                        question: questionMatch[2].trim(),
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

                const optionMatch = line.match(/^([A-Ha-h])\s*[\.、]\s*(.+)$/);
                if (optionMatch) {
                    current.options.push(optionMatch[2].trim());
                    current.lastField = '';
                    return;
                }

                const answerMatch = line.match(/^(?:答案|answer)\s*[:：]\s*(.+)$/i);
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

            const sample = state.importDocQuestions.slice(0, 6).map((item, index) => `
                <article class="import-preview-card">
                    <h5>${index + 1}. ${esc(item.question)}</h5>
                    <p>题型：${getQuestionTypeText(item.type)} | 答案：${esc(item.answer)}</p>
                    <p>选项数：${item.options.length} | 难度：${item.difficulty}</p>
                </article>
            `).join('');
            const rest = state.importDocQuestions.length > 6
                ? `<p class="mt-2 text-xs text-slate-400">其余 ${state.importDocQuestions.length - 6} 道题将在导入时一并提交。</p>`
                : '';
            previewRoot.innerHTML = `
                <div class="mb-3 text-sm">
                    <p>共识别 <strong>${state.importDocQuestions.length}</strong> 道题。</p>
                    ${state.importDocLastFilename ? `<p class="text-xs text-slate-400 mt-1">来源：${esc(state.importDocLastFilename)}</p>` : ''}
                </div>
                <div class="import-preview-list">${sample}</div>
                ${rest}
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
            if (!state.libraries.length) {
                container.innerHTML = '<div class="text-sm text-slate-400 text-center py-10">暂无题集，点击右上角新建</div>';
                renderLibraryPanelState();
                return;
            }

            container.innerHTML = state.libraries.map((lib) => {
                const active = state.currentLibrary && state.currentLibrary.id === lib.id;
                return `
                    <button data-lib-id="${esc(lib.id)}" class="library-item-btn w-full text-left border rounded-xl p-3 hover:border-indigo-400 transition ${
                        active ? 'bg-indigo-50 border-indigo-400' : 'bg-white border-slate-200'
                    }">
                        <div class="library-item-main flex items-center justify-between">
                            <div class="library-item-info flex items-center gap-2">
                                <span class="library-item-icon text-xl">${esc(lib.icon)}</span>
                                <div class="library-item-text">
                                    <div class="font-semibold text-sm">${esc(lib.title)}</div>
                                    <div class="text-xs text-slate-400">${esc(lib.id)}</div>
                                </div>
                            </div>
                            <span class="library-item-count text-xs px-2 py-1 rounded-full bg-slate-100 text-slate-500">${lib.question_count}题</span>
                        </div>
                    </button>
                `;
            }).join('');
            renderLibraryPanelState();
        }

        function renderEditor() {
            if (!state.currentLibrary) {
                $('editor').classList.add('hidden');
                $('editor-empty').classList.remove('hidden');
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
                                <button id="clear-question-search-btn" title="清空搜索" aria-label="清空搜索" class="toolbar-icon-btn bg-slate-100 text-slate-600 hover:bg-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-300">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                        <path d="M3 6h18"></path>
                                        <path d="M8 6V4h8v2"></path>
                                        <path d="M6 6l1 14h10l1-14"></path>
                                        <path d="M10 11v6"></path>
                                        <path d="M14 11v6"></path>
                                    </svg>
                                    <span class="sr-only">清空搜索</span>
                                </button>
                            </div>
                        </div>
                        <h3 id="question-count-label" class="font-bold">题目列表 显示 ${lib.questions.length} / ${lib.questions.length} 题</h3>
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
                                                <div class="flex gap-3 mt-3">
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
            $('editor').querySelectorAll('.question-edit-card').forEach((card) => updateQuestionCardTypeUI(card));
            updateBatchActionControls();
            applyQuestionSearch();
            syncSelectedQuestionCount();
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
                    return;
                }

                const currentId = preferredLibraryId || (state.currentLibrary && state.currentLibrary.id) || state.libraries[0].id;
                renderLibraryList();
                await selectLibrary(currentId);
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
        $('create-library-collapsed-btn')?.addEventListener('click', async () => {
            openCreateLibraryModal();
        });

        async function inspectImportJsonFile(file) {
            state.importJsonFile = file || null;
            state.importJsonPreview = null;
            $('import-json-file-name').innerText = file ? file.name : '未选择文件';
            if (!file) {
                renderImportJsonPreview();
                return;
            }

            try {
                const text = await file.text();
                const payload = JSON.parse(text);
                const libraries = parseImportLibraries(payload);
                const summary = libraries.map((lib, index) => {
                    const questions = Array.isArray(lib?.questions) ? lib.questions : [];
                    return {
                        index: index + 1,
                        id: String(lib?.id || '').trim(),
                        title: String(lib?.title || '').trim(),
                        questionCount: questions.length
                    };
                });
                state.importJsonPreview = {
                    filename: file.name,
                    libraryCount: summary.length,
                    questionCount: summary.reduce((sum, item) => sum + item.questionCount, 0),
                    libraries: summary
                };
            } catch (error) {
                state.importJsonPreview = {
                    error: `文件检查失败：${error.message || '请确认 JSON 格式'}`
                };
            }
            renderImportJsonPreview();
        }

        async function submitJsonImport() {
            if (!state.importJsonFile) {
                notify('请先选择 JSON 文件', true);
                return;
            }
            const replaceExisting = $('import-json-replace').checked;
            const confirmed = await showConfirmDialog({
                title: '导入题库 JSON',
                message: replaceExisting
                    ? `确认导入「${state.importJsonFile.name}」并覆盖同 ID 题集吗？`
                    : `确认导入「${state.importJsonFile.name}」吗？若 ID 冲突会报错。`,
                confirmText: '开始导入'
            });
            if (!confirmed) return;

            const formData = new FormData();
            formData.append('file', state.importJsonFile);
            if (replaceExisting) {
                formData.append('replace_existing', '1');
            }

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

            const ok = await showConfirmDialog({
                title: '导入解析结果',
                message: `确认导入 ${state.importDocQuestions.length} 道题到题集「${libraryId}」吗？`,
                confirmText: '开始导入'
            });
            if (!ok) return;

            let importedCount = 0;
            try {
                for (const question of state.importDocQuestions) {
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

        $('import-json-btn').addEventListener('click', () => {
            state.importJsonFile = null;
            state.importJsonPreview = null;
            state.importDocQuestions = [];
            state.importDocParseError = '';
            state.importDocLastFilename = '';
            $('import-json-replace').checked = false;
            $('import-json-file-name').innerText = '未选择文件';
            $('import-doc-file-name').innerText = '可直接粘贴文本';
            $('import-doc-text').value = '';
            resetSingleImportForm();
            openImportModal('json');
        });

        $('import-tab-bar').addEventListener('click', (event) => {
            const btn = event.target.closest('[data-import-tab]');
            if (!btn) return;
            const tab = btn.getAttribute('data-import-tab') || 'json';
            switchImportTab(tab);
        });

        $('import-modal-close-btn').addEventListener('click', closeImportModal);
        $('import-modal').addEventListener('click', (event) => {
            if (event.target === $('import-modal')) closeImportModal();
        });
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

        $('export-json-btn').addEventListener('click', () => {
            openExportModal('json');
        });

        $('export-tab-bar').addEventListener('click', (event) => {
            const btn = event.target.closest('[data-export-tab]');
            if (!btn) return;
            const tab = btn.getAttribute('data-export-tab') || 'json';
            switchExportTab(tab);
        });
        $('export-modal-close-btn').addEventListener('click', closeExportModal);
        $('export-modal').addEventListener('click', (event) => {
            if (event.target === $('export-modal')) closeExportModal();
        });
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
            await loadLibraries();
            notify('已刷新');
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
            if (!title) {
                notify('题集名称不能为空', true);
                return;
            }
            try {
                const created = await api('/libraries', {
                    method: 'POST',
                    body: JSON.stringify({ title, icon, description })
                });
                closeCreateLibraryModal();
                notify('题集已创建');
                await loadLibraries(created.id);
            } catch (error) {
                notify(error.message, true);
            }
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

            if (target.id === 'clear-question-search-btn') {
                state.questionSearch = '';
                const searchInput = $('question-search-input');
                if (searchInput) {
                    searchInput.value = '';
                    searchInput.focus();
                }
                applyQuestionSearch();
                return;
            }

            if (target.id === 'save-library-btn') {
                const libraryId = $('lib-id').value.trim();
                const title = $('lib-title').value.trim();
                const icon = $('lib-icon').value.trim();
                const description = $('lib-description').value.trim();
                try {
                    const updated = await api(`/libraries/${state.currentLibrary.id}`, {
                        method: 'PUT',
                        body: JSON.stringify({ id: libraryId, title, icon, description })
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

        $('editor').addEventListener('input', (event) => {
            if (event.target.id !== 'question-search-input') return;
            state.questionSearch = event.target.value;
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
            if (isMobileViewport() && !state.libraryListCollapsed) {
                setLibraryListCollapsed(true);
            }
        });

        (async function init() {
            document.body.dataset.themePreference = getStoredThemePreference();
            syncThemeMode();
            readExportTxtFieldsFromControls();
            setLibraryListCollapsed(getStoredLibraryPanelCollapsed(), false);
            if ($('theme-toggle')) {
                $('theme-toggle').addEventListener('click', toggleThemeMode);
            }
            if ($('settings-btn')) {
                $('settings-btn').addEventListener('click', () => {
                    notify('系统设置功能即将上线');
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
                const mobileNow = isMobileViewport();
                if (mobileNow !== lastMobileViewport) {
                    lastMobileViewport = mobileNow;
                    if (mobileNow) {
                        setLibraryListCollapsed(true, false);
                        return;
                    }
                }
                renderLibraryPanelState();
            });
            await loadLibraries();
        })();
