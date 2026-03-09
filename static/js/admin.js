const API_BASE = (document.body?.dataset?.adminApiBase || '/api/admin').replace(/\/+$/, '') || '/api/admin';
        const darkModeMedia = window.matchMedia('(prefers-color-scheme: dark)');
        const THEME_STORAGE_KEY = 'quiz_theme_preference';
        const state = {
            libraries: [],
            currentLibrary: null,
            questionSearch: ''
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
            return 'single';
        }

        function getAnswerLabelText(type) {
            return '答案';
        }

        function formatAnswerForEditor(type, answer) {
            if (type === 'multiple') {
                if (Array.isArray(answer)) return answer.join(',');
            }
            return String(answer ?? '');
        }

        function updateQuestionCardTypeUI(card) {
            if (!card) return;
            const typeSelect = card.querySelector('.q-type');
            const answerLabel = card.querySelector('.q-answer-label');
            const answerInput = card.querySelector('.q-answer');
            const optionsInput = card.querySelector('.q-options');
            if (!typeSelect) return;

            const type = normalizeQuestionType(typeSelect.value);
            if (answerLabel) {
                answerLabel.innerText = getAnswerLabelText(type);
            }
            if (answerInput) {
                if (type === 'multiple') {
                    answerInput.placeholder = '如 0,2';
                } else if (type === 'judge') {
                    answerInput.placeholder = '如 0（正确）或 1（错误）';
                } else {
                    answerInput.placeholder = '如 0';
                }
            }
            if (optionsInput) {
                if (type === 'judge' && !optionsInput.value.trim()) {
                    optionsInput.value = '正确\n错误';
                }
                optionsInput.placeholder = type === 'judge' ? '判断题建议：正确 与 错误（每行一个）' : '每行一个选项';
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
            const cards = Array.from(root.querySelectorAll('[data-question-id]'));
            let visibleCount = 0;

            cards.forEach((card) => {
                const matched = !query || buildQuestionSearchText(card).includes(query);
                card.classList.toggle('hidden', !matched);
                if (matched) visibleCount += 1;
            });

            const totalCount = cards.length;
            const countLabel = $('question-count-label');
            if (countLabel) {
                countLabel.innerText = `题目列表（显示 ${visibleCount} / ${totalCount} 题）`;
            }

            const emptyHint = $('question-search-empty');
            if (emptyHint) {
                emptyHint.classList.toggle('hidden', visibleCount !== 0);
            }
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
                return;
            }

            container.innerHTML = state.libraries.map((lib) => {
                const active = state.currentLibrary && state.currentLibrary.id === lib.id;
                return `
                    <button data-lib-id="${esc(lib.id)}" class="w-full text-left border rounded-xl p-3 hover:border-indigo-400 transition ${
                        active ? 'bg-indigo-50 border-indigo-400' : 'bg-white border-slate-200'
                    }">
                        <div class="flex items-center justify-between">
                            <div class="flex items-center gap-2">
                                <span class="text-xl">${esc(lib.icon)}</span>
                                <div>
                                    <div class="font-semibold text-sm">${esc(lib.title)}</div>
                                    <div class="text-xs text-slate-400">${esc(lib.id)}</div>
                                </div>
                            </div>
                            <span class="text-xs px-2 py-1 rounded-full bg-slate-100 text-slate-500">${lib.question_count}题</span>
                        </div>
                    </button>
                `;
            }).join('');
        }

        function renderEditor() {
            if (!state.currentLibrary) {
                $('editor').classList.add('hidden');
                $('editor-empty').classList.remove('hidden');
                return;
            }

            const lib = state.currentLibrary;
            $('editor-empty').classList.add('hidden');
            $('editor').classList.remove('hidden');
            $('editor').innerHTML = `
                <div class="border rounded-2xl p-4 bg-slate-50">
                    <h3 class="font-bold mb-4">题集信息</h3>
                    <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <label class="text-sm">
                            <span class="text-slate-500">题集 ID（只读）</span>
                            <input id="lib-id" value="${esc(lib.id)}" class="w-full mt-1 px-3 py-2 rounded-lg border bg-slate-100" readonly>
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
                        <div class="flex items-center justify-between">
                            <h3 id="question-count-label" class="font-bold">题目列表（显示 ${lib.questions.length} / ${lib.questions.length} 题）</h3>
                            <button id="add-question-btn" class="px-4 py-2 rounded-lg bg-emerald-600 text-white font-semibold">新增题目</button>
                        </div>
                        <div class="flex gap-2">
                            <input id="question-search-input" value="${esc(state.questionSearch)}" class="flex-1 px-3 py-2 rounded-lg border" placeholder="搜索题目、选项、解析、知识点、题号">
                            <button id="clear-question-search-btn" class="px-4 py-2 rounded-lg bg-slate-100 text-slate-600 font-semibold">清空</button>
                        </div>
                    </div>
                    <div class="space-y-4">
                        <div id="question-search-empty" class="hidden rounded-xl border border-dashed text-center text-sm text-slate-400 py-8">没有匹配的题目</div>
                        ${lib.questions.map((q, index) => `
                            ${(() => {
                                const qType = normalizeQuestionType(q.type);
                                const answerText = formatAnswerForEditor(qType, q.ans);
                                return `
                            <article class="border rounded-xl p-4 bg-slate-50" data-question-id="${q.id}">
                                <div class="flex items-center justify-between mb-3">
                                    <h4 class="font-semibold">第 ${index + 1} 题</h4>
                                    <button class="delete-question-btn text-sm px-3 py-1.5 rounded-lg bg-rose-100 text-rose-600">删除</button>
                                </div>

                                <label class="block text-sm mb-2">
                                    <span class="text-slate-500">题目</span>
                                    <textarea class="q-question w-full mt-1 px-3 py-2 rounded-lg border" rows="2">${esc(q.q)}</textarea>
                                </label>

                                <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    <label class="text-sm q-options-wrap">
                                        <span class="text-slate-500">选项（每行一个）</span>
                                        <textarea class="q-options w-full mt-1 px-3 py-2 rounded-lg border" rows="5" placeholder="每行一个选项">${esc((q.options || []).join('\n'))}</textarea>
                                    </label>
                                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                        <label class="block text-sm">
                                            <span class="text-slate-500">题型</span>
                                            <select class="q-type w-full mt-1 px-3 py-2 rounded-lg border">
                                                <option value="single" ${qType === 'single' ? 'selected' : ''}>单选题</option>
                                                <option value="multiple" ${qType === 'multiple' ? 'selected' : ''}>多选题</option>
                                                <option value="judge" ${qType === 'judge' ? 'selected' : ''}>判断题</option>
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
                                            <span class="text-slate-500">知识点</span>
                                            <input class="q-knowledge w-full mt-1 px-3 py-2 rounded-lg border" value="${esc(q.knowledge_point)}">
                                        </label>
                                    </div>
                                </div>

                                <label class="block text-sm mt-3">
                                    <span class="text-slate-500">解析</span>
                                    <textarea class="q-analysis w-full mt-1 px-3 py-2 rounded-lg border" rows="3">${esc(q.analysis)}</textarea>
                                </label>

                                <div class="mt-3">
                                    <button class="save-question-btn px-4 py-2 rounded-lg bg-indigo-600 text-white font-semibold">保存题目</button>
                                </div>
                            </article>
                        `;
                            })()}
                        `).join('')}
                    </div>
                </div>
            `;
            $('editor').querySelectorAll('[data-question-id]').forEach((card) => updateQuestionCardTypeUI(card));
            applyQuestionSearch();
        }

        async function loadLibraries(preferredLibraryId) {
            try {
                state.libraries = await api('/libraries');
                if (!state.libraries.length) {
                    state.currentLibrary = null;
                    renderLibraryList();
                    renderEditor();
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
                }
                renderLibraryList();
                renderEditor();
            } catch (error) {
                notify(error.message, true);
            }
        }

        function buildQuestionPayload(card) {
            const type = normalizeQuestionType(card.querySelector('.q-type')?.value || 'single');
            let options = card.querySelector('.q-options').value
                .split('\n')
                .map((item) => item.trim())
                .filter(Boolean);
            if (type === 'judge' && options.length === 0) {
                options = ['正确', '错误'];
            }
            const answerRaw = card.querySelector('.q-answer').value.trim();

            return {
                question: card.querySelector('.q-question').value.trim(),
                type,
                options,
                answer: answerRaw,
                analysis: card.querySelector('.q-analysis').value.trim(),
                difficulty: card.querySelector('.q-difficulty').value.trim() || '1',
                knowledge_point: card.querySelector('.q-knowledge').value.trim(),
                library_id: state.currentLibrary.id
            };
        }

        $('create-library-btn').addEventListener('click', async () => {
            openCreateLibraryModal();
        });

        $('import-json-btn').addEventListener('click', () => {
            const input = $('import-json-input');
            input.value = '';
            input.click();
        });

        $('import-json-input').addEventListener('change', async (event) => {
            const file = event.target.files && event.target.files[0];
            if (!file) return;

            const confirmed = await showConfirmDialog({
                title: '导入题库 JSON',
                message: `确认导入文件「${file.name}」吗？若题集 ID 已存在会报错。`,
                confirmText: '开始导入'
            });

            if (!confirmed) {
                event.target.value = '';
                return;
            }

            const formData = new FormData();
            formData.append('file', file);

            try {
                const result = await api('/import-json', {
                    method: 'POST',
                    body: formData
                });
                notify(`导入成功：${result.library_count} 个题集，${result.question_count} 道题`);
                const firstLibraryId = result.library_ids && result.library_ids[0];
                await loadLibraries(firstLibraryId);
            } catch (error) {
                notify(error.message, true);
            } finally {
                event.target.value = '';
            }
        });

        $('export-json-btn').addEventListener('click', async () => {
            const libraryId = state.currentLibrary ? state.currentLibrary.id : '';
            const scopeLabel = libraryId ? `题集「${state.currentLibrary.title}」` : '全部题集';
            const ok = await showConfirmDialog({
                title: '导出 JSON',
                message: `确认导出${scopeLabel}吗？`,
                confirmText: '开始导出'
            });
            if (!ok) return;

            const query = libraryId ? `?library_id=${encodeURIComponent(libraryId)}` : '';
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

                const blob = await response.blob();
                const fallbackName = libraryId ? `quiz-export-${libraryId}.json` : 'quiz-export-all.json';
                const filename = parseDownloadFilename(
                    response.headers.get('Content-Disposition') || '',
                    fallbackName
                );
                downloadBlob(blob, filename);
                notify(`导出成功：${filename}`);
            } catch (error) {
                notify(error.message, true);
            }
        });

        $('refresh-btn').addEventListener('click', async () => {
            await loadLibraries();
            notify('已刷新');
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
        });

        $('editor').addEventListener('click', async (event) => {
            if (!state.currentLibrary) return;

            if (event.target.id === 'clear-question-search-btn') {
                state.questionSearch = '';
                const searchInput = $('question-search-input');
                if (searchInput) {
                    searchInput.value = '';
                    searchInput.focus();
                }
                applyQuestionSearch();
                return;
            }

            if (event.target.id === 'save-library-btn') {
                const title = $('lib-title').value.trim();
                const icon = $('lib-icon').value.trim();
                const description = $('lib-description').value.trim();
                try {
                    await api(`/libraries/${state.currentLibrary.id}`, {
                        method: 'PUT',
                        body: JSON.stringify({ title, icon, description })
                    });
                    notify('题集信息已保存');
                    await loadLibraries(state.currentLibrary.id);
                } catch (error) {
                    notify(error.message, true);
                }
                return;
            }

            if (event.target.id === 'delete-library-btn') {
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

            if (event.target.id === 'add-question-btn') {
                try {
                    await api(`/libraries/${state.currentLibrary.id}/questions`, {
                        method: 'POST',
                        body: JSON.stringify({
                            question: '新题目（请编辑）',
                            type: 'single',
                            options: ['选项 A', '选项 B'],
                            answer: '0',
                            analysis: '请补充解析',
                            difficulty: 1,
                            knowledge_point: ''
                        })
                    });
                    notify('已新增题目，请继续编辑');
                    await selectLibrary(state.currentLibrary.id);
                } catch (error) {
                    notify(error.message, true);
                }
                return;
            }

            if (event.target.classList.contains('save-question-btn')) {
                const card = event.target.closest('[data-question-id]');
                const questionId = card.getAttribute('data-question-id');
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

            if (event.target.classList.contains('delete-question-btn')) {
                const card = event.target.closest('[data-question-id]');
                const questionId = card.getAttribute('data-question-id');
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
            if (!event.target.classList.contains('q-type')) return;
            const card = event.target.closest('[data-question-id]');
            updateQuestionCardTypeUI(card);
        });

        (async function init() {
            document.body.dataset.themePreference = getStoredThemePreference();
            syncThemeMode();
            if ($('theme-toggle')) {
                $('theme-toggle').addEventListener('click', toggleThemeMode);
            }
            const onSystemThemeChange = () => syncThemeMode();
            if (darkModeMedia.addEventListener) {
                darkModeMedia.addEventListener('change', onSystemThemeChange);
            } else if (darkModeMedia.addListener) {
                darkModeMedia.addListener(onSystemThemeChange);
            }
            await loadLibraries();
        })();
