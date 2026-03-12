// API基础URL
        const API_BASE_URL = (document.body?.dataset?.apiBase || '/api').replace(/\/+$/, '') || '/api';
        const darkModeMedia = window.matchMedia('(prefers-color-scheme: dark)');
        const THEME_STORAGE_KEY = 'quiz_theme_preference';
        const QUESTION_FONT_STORAGE_KEY = 'quiz_question_font_percent';
        const QUESTION_COMPACTNESS_STORAGE_KEY = 'quiz_question_compactness_level';
        const DEFAULT_QUESTION_FONT_PERCENT = 100;
        const DEFAULT_COMPACTNESS_LEVEL = 3;
        const ANALYSIS_ACTION_ICON = '<span class="inline-block align-[-1px] text-sm leading-none">✍️</span>';
        const ANALYSIS_ACTION_BUTTON_CLASS = 'px-4 py-2 rounded-xl bg-indigo-50 text-indigo-600 text-sm font-bold border border-indigo-300';
        const COMPACTNESS_LABELS = ['舒展', '标准', '紧凑', '极限'];
        let toastTimer = null;
        const $ = id => document.getElementById(id);
        const escapeHtml = (value) => String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');

        function buildApiUrl(endpoint) {
            const normalizedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
            return `${API_BASE_URL}${normalizedEndpoint}`;
        }

        function syncViewportHeight() {
            document.documentElement.style.setProperty('--app-vh', `${window.innerHeight * 0.01}px`);
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

        function clampQuestionFontPercent(value) {
            const numericValue = Number(value);
            const safeValue = Number.isFinite(numericValue) ? numericValue : DEFAULT_QUESTION_FONT_PERCENT;
            return Math.max(85, Math.min(140, safeValue));
        }

        function clampCompactnessLevel(value) {
            const numericValue = Number(value);
            const safeValue = Number.isFinite(numericValue) ? numericValue : DEFAULT_COMPACTNESS_LEVEL;
            return Math.max(0, Math.min(3, Math.round(safeValue)));
        }

        function getStoredQuestionFontPercent() {
            return clampQuestionFontPercent(localStorage.getItem(QUESTION_FONT_STORAGE_KEY));
        }

        function getStoredCompactnessLevel() {
            return clampCompactnessLevel(localStorage.getItem(QUESTION_COMPACTNESS_STORAGE_KEY));
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
                ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2"></path><path d="M12 20v2"></path><path d="m4.93 4.93 1.41 1.41"></path><path d="m17.66 17.66 1.41 1.41"></path><path d="M2 12h2"></path><path d="M20 12h2"></path><path d="m6.34 17.66-1.41 1.41"></path><path d="m19.07 4.93-1.41 1.41"></path></svg>`
                : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 1 0 9.8 9.8Z"></path></svg>`;
            btn.title = title;
            btn.setAttribute('aria-label', title);
            btn.innerHTML = `${icon}<span class="sr-only">${title}</span>`;
        }

        function syncThemeMode() {
            document.body.classList.toggle('theme-dark', isDarkThemeActive());
            updateThemeToggleButton();
            updateModeSwitchUI();
        }

        function toggleThemeMode() {
            const next = document.body.classList.contains('theme-dark') ? 'light' : 'dark';
            setThemePreference(next);
            syncThemeMode();
            showNotice(next === 'dark' ? '已开启夜间模式' : '已切换日间模式', 'success');
        }

        function isTabletLandscape() {
            return window.innerWidth >= 768 && window.innerWidth <= 1180 && window.innerWidth > window.innerHeight;
        }

        function syncDeviceProfileClass() {
            document.body.classList.toggle('tablet-landscape', isTabletLandscape());
        }

        function showNotice(message, type = 'error') {
            const toast = $('toast');
            const isDark = document.body.classList.contains('theme-dark');
            toast.innerText = message;
            toast.className = `fixed top-20 left-1/2 -translate-x-1/2 z-[230] px-4 py-3 rounded-xl text-sm font-semibold shadow-xl ${
                type === 'success'
                    ? (isDark ? 'bg-emerald-900/80 text-emerald-100 border border-emerald-700' : 'bg-emerald-50 text-emerald-700 border border-emerald-200')
                    : (isDark ? 'bg-rose-900/80 text-rose-100 border border-rose-700' : 'bg-rose-50 text-rose-600 border border-rose-200')
            }`;
            toast.classList.remove('hidden');
            clearTimeout(toastTimer);
            toastTimer = setTimeout(() => toast.classList.add('hidden'), 2400);
        }
        
        // 从API获取数据
        async function fetchFromAPI(endpoint) {
            try {
                const response = await fetch(buildApiUrl(endpoint));
                if (!response.ok) {
                    throw new Error('API请求失败');
                }
                return await response.json();
            } catch (error) {
                console.error('API错误:', error);
                showNotice('获取数据失败，请稍后重试');
                return null;
            }
        }
        
        // 保存答题记录
        async function saveAnswers(libraryId, answers) {
            try {
                const response = await fetch(buildApiUrl('/answers'), {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ library_id: libraryId, answers })
                });
                if (!response.ok) {
                    throw new Error('保存答题记录失败');
                }
                return await response.json();
            } catch (error) {
                console.error('保存答题记录错误:', error);
                showNotice('保存答题记录失败，请稍后重试');
                return null;
            }
        }

        let state = { lib: null, mode: '', idx: 0, answers: {}, pendingAnswers: {}, wrongAttempts: {}, timer: null, timeLeft: 600, isReview: false, practiceHints: {}, submitting: false, navMode: 'next', pendingExamModeSwitch: false, questionFontScale: getStoredQuestionFontPercent() / 100, compactnessLevel: getStoredCompactnessLevel() };
        let confirmResolver = null;
        const MODE_SWITCHABLE = ['browse', 'practice', 'analysis', 'exam'];

        function normalizeRouteMode(rawMode) {
            const mode = String(rawMode ?? '').trim().toLowerCase();
            return MODE_SWITCHABLE.includes(mode) ? mode : '';
        }

        function buildLibraryModeUrl(libraryId = '', mode = '') {
            const params = new URLSearchParams();
            if (libraryId) params.set('library', String(libraryId));
            const normalizedMode = normalizeRouteMode(mode);
            if (normalizedMode) params.set('mode', normalizedMode);
            const query = params.toString();
            return `${window.location.pathname}${query ? `?${query}` : ''}`;
        }

        function syncUrlWithState({ libraryId = '', mode = '', replace = true } = {}) {
            const targetUrl = buildLibraryModeUrl(libraryId, mode);
            if (`${window.location.pathname}${window.location.search}` === targetUrl) return;
            const fn = replace ? 'replaceState' : 'pushState';
            history[fn](null, '', targetUrl);
        }

        function readRouteState() {
            const params = new URLSearchParams(window.location.search || '');
            const libraryId = String(params.get('library') || '').trim();
            const mode = normalizeRouteMode(params.get('mode'));
            return { libraryId, mode };
        }

        function isPullNavMode() {
            return state.navMode === 'pull';
        }

        function closeModeSwitchMenu() {
            const menu = $('mode-switch-menu');
            if (menu) menu.classList.add('hidden');
        }

        function closeFontSizePanel() {
            const panel = $('font-size-panel');
            if (panel) panel.classList.add('hidden');
        }

        function rerenderQuestionWithLayoutUpdate() {
            if (!state.lib || !state.mode) return;
            const currentQuestionIndex = state.idx;
            renderQuestion();
            if (isPullNavMode()) {
                requestAnimationFrame(() => {
                    const card = getQuestionCardElement(currentQuestionIndex);
                    if (card) card.scrollIntoView({ block: 'start' });
                });
            }
        }

        function getQuestionFontPercent() {
            const raw = Math.round((Number(state.questionFontScale) || 1) * 100);
            return clampQuestionFontPercent(raw);
        }

        function getCompactnessLevel() {
            return clampCompactnessLevel(state.compactnessLevel);
        }

        function getCompactnessLabel(level = getCompactnessLevel()) {
            return COMPACTNESS_LABELS[level] || COMPACTNESS_LABELS[DEFAULT_COMPACTNESS_LEVEL];
        }

        function updateQuestionFontSizePreview() {
            const slider = $('question-font-size');
            const label = $('font-size-label');
            const valueTag = $('font-size-value');
            const percent = getQuestionFontPercent();
            if (slider && Number(slider.value) !== percent) {
                slider.value = String(percent);
            }
            if (label) label.innerText = `${percent}%`;
            if (valueTag) valueTag.innerText = `${percent}%`;
        }

        function updateCompactnessPreview() {
            const slider = $('question-density');
            const valueTag = $('compactness-value');
            const level = getCompactnessLevel();
            if (slider && Number(slider.value) !== level) {
                slider.value = String(level);
            }
            if (valueTag) valueTag.innerText = getCompactnessLabel(level);
        }

        function setQuestionFontScaleFromPercent(percent, shouldRender = false) {
            const normalizedPercent = clampQuestionFontPercent(percent);
            state.questionFontScale = normalizedPercent / 100;
            localStorage.setItem(QUESTION_FONT_STORAGE_KEY, String(normalizedPercent));
            updateQuestionFontSizePreview();
            if (!shouldRender) return;
            rerenderQuestionWithLayoutUpdate();
        }

        function setCompactnessLevel(level, shouldRender = false) {
            const normalizedLevel = clampCompactnessLevel(level);
            state.compactnessLevel = normalizedLevel;
            localStorage.setItem(QUESTION_COMPACTNESS_STORAGE_KEY, String(normalizedLevel));
            updateCompactnessPreview();
            if (!shouldRender) return;
            rerenderQuestionWithLayoutUpdate();
        }

        function updateModeSwitchUI() {
            const wrap = $('mode-switch-wrap');
            const label = $('mode-switch-label');
            const navWrap = $('nav-mode-wrap');
            const navToggle = $('nav-mode-toggle');
            const navIcon = $('nav-mode-icon');
            const fontWrap = $('font-size-wrap');
            const restartBtn = $('restart-btn');
            if (!wrap || !label) return;

            const canShow = !!state.lib && !!state.mode && !state.isReview;
            wrap.classList.toggle('hidden', !canShow);
            if (navWrap) navWrap.classList.toggle('hidden', !canShow);
            if (fontWrap) fontWrap.classList.toggle('hidden', !canShow);
            if (restartBtn) {
                restartBtn.classList.toggle('hidden', !canShow);
                if (canShow) {
                    const title = state.mode === 'exam' ? '重新开始考试' : '重新开始本次刷题';
                    restartBtn.title = title;
                    restartBtn.setAttribute('aria-label', title);
                }
            }
            if (!canShow) {
                closeModeSwitchMenu();
                closeFontSizePanel();
                return;
            }

            label.innerText = state.mode;
            updateQuestionFontSizePreview();
            updateCompactnessPreview();
            const inPullMode = isPullNavMode();
            const navTitle = inPullMode ? '切换到下一题模式' : '切换到连续滚动模式';
            if (navToggle) {
                navToggle.title = navTitle;
                navToggle.setAttribute('aria-label', navTitle);
            }
            if (navIcon) {
                navIcon.innerHTML = inPullMode
                    ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 6h10"></path><path d="M7 12h10"></path><path d="M7 18h10"></path></svg>`
                    : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"></path><path d="m13 6 6 6-6 6"></path></svg>`;
            }
            const items = document.querySelectorAll('[data-mode-switch]');
            items.forEach((item) => {
                const mode = item.getAttribute('data-mode-switch');
                const active = mode === state.mode;
                item.classList.toggle('bg-slate-100', active);
                item.classList.toggle('font-bold', active);
                if (!document.body.classList.contains('theme-dark')) {
                    item.classList.toggle('text-slate-800', active);
                    item.classList.toggle('text-slate-600', !active);
                }
            });
        }

        function getQuestionScaleStyle() {
            if (!state.lib || !state.mode) return '';
            const scale = Math.max(0.85, Math.min(1.4, Number(state.questionFontScale) || 1));
            return ` style="font-size:${scale}em;"`;
        }

        const COMPACTNESS_PRESETS = [
            {
                optionsWrap: 'space-y-3',
                optionCard: 'option-card p-4 flex items-center font-bold leading-normal text-slate-600',
                optionTag: 'w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center mr-3 font-black text-slate-400 shrink-0',
                questionCard: 'quiz-panel bg-white/95 rounded-[2.3rem] p-5 md:p-8 shadow-lg border border-slate-200/70',
                questionHeader: 'flex items-start gap-3 mb-6',
                questionIndex: 'text-slate-400 font-black leading-none mt-1',
                questionTitle: 'text-xl md:text-2xl font-bold text-slate-800 leading-snug',
                questionTypeTag: 'inline-flex items-center ml-2 px-2 py-1 rounded-md text-xs font-bold bg-slate-100 text-slate-500 align-middle',
                hintButton: 'mt-5 w-full py-3 bg-indigo-50 text-indigo-600 rounded-2xl font-bold',
                analysisCard: 'analysis-card mt-5 p-4 bg-slate-50 rounded-2xl border-l-8 border-indigo-600',
                analysisAnswer: 'font-black text-indigo-600 mb-2',
                analysisText: 'leading-relaxed text-slate-600 font-medium',
                cardsWrap: 'space-y-4',
                footer: 'flex justify-between items-center gap-3 mt-8 pt-6 border-t pb-safe',
                prevButton: 'font-bold text-slate-400 hover:text-slate-900 disabled:opacity-0 py-2 px-4 transition-all',
                nextButton: 'px-9 py-3 bg-slate-900 text-white rounded-2xl font-bold shadow-xl active:scale-95 transition-transform'
            },
            {
                optionsWrap: 'space-y-2.5',
                optionCard: 'option-card p-3.5 flex items-center font-bold leading-snug text-slate-600',
                optionTag: 'w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center mr-3 font-black text-slate-400 shrink-0',
                questionCard: 'quiz-panel bg-white/95 rounded-[2.1rem] p-4 md:p-7 shadow-lg border border-slate-200/70',
                questionHeader: 'flex items-start gap-2.5 mb-5',
                questionIndex: 'text-slate-400 font-black leading-none mt-0.5',
                questionTitle: 'text-xl md:text-2xl font-bold text-slate-800 leading-snug',
                questionTypeTag: 'inline-flex items-center ml-2 px-2 py-0.5 rounded-md text-xs font-bold bg-slate-100 text-slate-500 align-middle',
                hintButton: 'mt-4 w-full py-3 bg-indigo-50 text-indigo-600 rounded-2xl font-bold',
                analysisCard: 'analysis-card mt-4 p-4 bg-slate-50 rounded-xl border-l-8 border-indigo-600',
                analysisAnswer: 'font-black text-indigo-600 mb-2',
                analysisText: 'leading-relaxed text-slate-600 font-medium',
                cardsWrap: 'space-y-3',
                footer: 'flex justify-between items-center gap-3 mt-6 pt-5 border-t pb-safe',
                prevButton: 'font-bold text-slate-400 hover:text-slate-900 disabled:opacity-0 py-2 px-4 transition-all text-sm',
                nextButton: 'px-8 py-2.5 bg-slate-900 text-white rounded-xl font-bold shadow-xl active:scale-95 transition-transform text-sm'
            },
            {
                optionsWrap: 'space-y-2',
                optionCard: 'option-card p-3 flex items-center font-bold leading-snug text-slate-600',
                optionTag: 'w-7 h-7 rounded-md bg-slate-100 flex items-center justify-center mr-2.5 font-black text-slate-400 shrink-0',
                questionCard: 'quiz-panel bg-white/95 rounded-[1.8rem] p-3.5 md:p-6 shadow-lg border border-slate-200/70',
                questionHeader: 'flex items-start gap-2.5 mb-4',
                questionIndex: 'text-slate-400 font-black leading-none mt-0.5',
                questionTitle: 'text-lg md:text-xl font-bold text-slate-800 leading-snug',
                questionTypeTag: 'inline-flex items-center ml-2 px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-500 align-middle',
                hintButton: 'mt-3 w-full py-2.5 bg-indigo-50 text-indigo-600 rounded-xl font-bold',
                analysisCard: 'analysis-card mt-3 p-3.5 bg-slate-50 rounded-xl border-l-4 border-indigo-600',
                analysisAnswer: 'font-black text-indigo-600 mb-1.5',
                analysisText: 'leading-snug text-slate-600 font-medium',
                cardsWrap: 'space-y-2.5',
                footer: 'flex justify-between items-center gap-2.5 mt-5 pt-4 border-t pb-safe',
                prevButton: 'font-bold text-slate-400 hover:text-slate-900 disabled:opacity-0 py-1.5 px-3 transition-all',
                nextButton: 'px-7 py-2.5 bg-slate-900 text-white rounded-xl font-bold shadow-xl active:scale-95 transition-transform'
            },
            {
                optionsWrap: 'space-y-1.5',
                optionCard: 'option-card p-2.5 flex items-center font-bold leading-tight text-slate-600',
                optionTag: 'w-6 h-6 rounded-md bg-slate-100 flex items-center justify-center mr-2 font-black text-slate-400 shrink-0',
                questionCard: 'quiz-panel bg-white/95 rounded-[1.5rem] p-3 md:p-5 shadow-lg border border-slate-200/70',
                questionHeader: 'flex items-start gap-2 mb-3',
                questionIndex: 'text-slate-400 font-black leading-none mt-0.5',
                questionTitle: 'text-lg md:text-xl font-bold text-slate-800 leading-snug',
                questionTypeTag: 'inline-flex items-center ml-2 px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-500 align-middle',
                hintButton: 'mt-3 w-full py-2.5 bg-indigo-50 text-indigo-600 rounded-xl font-bold',
                analysisCard: 'analysis-card mt-3 p-3 bg-slate-50 rounded-xl border-l-4 border-indigo-600',
                analysisAnswer: 'font-black text-indigo-600 mb-1.5',
                analysisText: 'leading-snug text-slate-600 font-medium',
                cardsWrap: 'space-y-2',
                footer: 'flex justify-between items-center gap-2 mt-4 pt-4 border-t pb-safe',
                prevButton: 'font-bold text-slate-400 hover:text-slate-900 disabled:opacity-0 py-1.5 px-3 transition-all',
                nextButton: 'px-7 py-2.5 bg-slate-900 text-white rounded-xl font-bold shadow-xl active:scale-95 transition-transform'
            }
        ];

        function getCompactnessPreset() {
            return COMPACTNESS_PRESETS[getCompactnessLevel()] || COMPACTNESS_PRESETS[DEFAULT_COMPACTNESS_LEVEL];
        }

        function getQuestionType(question) {
            const raw = String(question?.type || 'single').trim().toLowerCase();
            if (['multiple', 'multi', 'checkbox', '多选'].includes(raw)) return 'multiple';
            if (['judge', 'true_false', 'truefalse', 'tf', '判断', '判断题'].includes(raw)) return 'judge';
            if (['fill', 'blank', 'fill_blank', '填空', '填空题'].includes(raw)) return 'fill';
            if (['qa', 'essay', 'short_answer', '问答', '问答题', '简答', '简答题'].includes(raw)) return 'qa';
            return 'single';
        }

        function getQuestionTypeLabel(question) {
            const qType = getQuestionType(question);
            if (qType === 'multiple') return '多选题';
            if (qType === 'judge') return '判断题';
            if (qType === 'fill') return '填空题';
            if (qType === 'qa') return '问答题';
            return '单选题';
        }

        function getQuestionTypeLabelByType(qType) {
            if (qType === 'multiple') return '多选题';
            if (qType === 'judge') return '判断题';
            if (qType === 'fill') return '填空题';
            if (qType === 'qa') return '问答题';
            return '单选题';
        }

        function getNavQuestionGroups() {
            const order = ['single', 'multiple', 'judge', 'fill', 'qa'];
            const groups = order.map((type) => ({ type, label: getQuestionTypeLabelByType(type), indexes: [] }));
            const groupMap = new Map(groups.map((group) => [group.type, group]));
            (state.lib?.questions || []).forEach((question, index) => {
                const qType = getQuestionType(question);
                const group = groupMap.get(qType) || groupMap.get('single');
                group.indexes.push(index);
            });
            return groups.filter((group) => group.indexes.length > 0);
        }

        function isSingleAttemptQuestionMode() {
            return state.mode === 'browse' || state.mode === 'practice';
        }

        function parseMultipleAnswerValue(value) {
            if (Array.isArray(value)) {
                return Array.from(new Set(value.map((item) => Number(item)).filter(Number.isInteger))).sort((a, b) => a - b);
            }
            if (value === null || value === undefined) return [];
            const raw = String(value).trim();
            if (!raw) return [];

            try {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) {
                    return Array.from(new Set(parsed.map((item) => Number(item)).filter(Number.isInteger))).sort((a, b) => a - b);
                }
            } catch (error) {
                // 非 JSON 时走文本分隔解析
            }

            return Array.from(
                new Set(
                    raw
                        .split(/[\s,，/|]+/)
                        .map((item) => {
                            const token = item.trim();
                            if (/^[A-Za-z]$/.test(token)) return token.toUpperCase().charCodeAt(0) - 65;
                            const num = Number(token);
                            return Number.isInteger(num) ? num : NaN;
                        })
                        .filter(Number.isInteger)
                )
            ).sort((a, b) => a - b);
        }

        function normalizeJudgeAnswerValue(value) {
            const token = String(value ?? '').trim().replace(/[。；;]+$/g, '').toLowerCase();
            if (['a', '0', '正确', '对', 'true', 't', 'yes', 'y', '√'].includes(token)) return '0';
            if (['b', '1', '错误', '错', 'false', 'f', 'no', 'n', '×', 'x'].includes(token)) return '1';
            return null;
        }

        function parseFillAnswerValue(value) {
            if (Array.isArray(value)) {
                return value.map((item) => String(item ?? '').trim()).filter(Boolean);
            }
            return String(value ?? '')
                .split(/[|｜]/)
                .map((item) => item.trim())
                .filter(Boolean);
        }

        function getMultipleAnswerFeedback(question, answerValue) {
            const expected = parseMultipleAnswerValue(question?.ans);
            const received = parseMultipleAnswerValue(answerValue);
            const expectedSet = new Set(expected);
            const receivedSet = new Set(received);
            const wrongSelections = received.filter((idx) => !expectedSet.has(idx));
            const missedSelections = expected.filter((idx) => !receivedSet.has(idx));
            let status = 'correct';
            if (wrongSelections.length || missedSelections.length) {
                if (wrongSelections.length && missedSelections.length) status = '错选+少选';
                else if (wrongSelections.length) status = '错选';
                else status = '少选';
            }
            const receivedText = received.length
                ? received.map((idx) => String.fromCharCode(65 + idx)).join(',')
                : '未作答';
            return { status, wrongSelections, missedSelections, receivedText };
        }

        function getFillAnswerFeedback(question, answerValue) {
            const blankCount = getFillBlankCount(question);
            const expected = getFillDraftValues(question?.ans, blankCount);
            const received = getFillDraftValues(answerValue, blankCount);
            let hasWrong = false;
            let hasMissing = false;
            const perBlank = [];
            for (let idx = 0; idx < blankCount; idx += 1) {
                const receivedValue = String(received[idx] ?? '').trim();
                const expectedValue = String(expected[idx] ?? '').trim();
                let blankStatus = '正确';
                if (!receivedValue) {
                    hasMissing = true;
                    blankStatus = '少填';
                } else if (normalizeFreeText(receivedValue) !== normalizeFreeText(expectedValue)) {
                    hasWrong = true;
                    blankStatus = '错填';
                }
                perBlank.push({
                    index: idx + 1,
                    status: blankStatus,
                    received: receivedValue || '___',
                    expected: expectedValue || '___'
                });
            }
            const status = hasWrong && hasMissing
                ? '错填+少填'
                : (hasWrong ? '错填' : (hasMissing ? '少填' : '正确'));
            const receivedText = received.map((item) => String(item ?? '').trim() || '___').join(' | ');
            const detailText = perBlank
                .map((item) => {
                    if (item.status === '正确') return `第${item.index}空正确`;
                    return `第${item.index}空${item.status} ${item.received} -> ${item.expected}`;
                })
                .join('；');
            return { status, receivedText, detailText };
        }

        function getFillBlankCount(question) {
            const questionText = String(question?.q ?? question?.question ?? '');
            const matches = questionText.match(/[（(][^（）()]*[）)]/g);
            if (matches && matches.length) return matches.length;
            const answerCount = parseFillAnswerValue(question?.ans).length;
            return answerCount || 1;
        }

        function getFillDraftValues(rawAnswer, blankCount) {
            const values = String(rawAnswer ?? '')
                .split(/[|｜]/)
                .map((item) => item.trim());
            const length = Math.max(1, Number(blankCount) || 1);
            const padded = Array.from({ length }, (_, idx) => values[idx] || '');
            return padded;
        }

        function normalizeFreeText(value) {
            return String(value ?? '')
                .trim()
                .replace(/\r\n/g, '\n')
                .replace(/\s+/g, '')
                .replace(/[，,。；;：:、！？!?（）()【】\[\]《》“”"']/g, '')
                .toLowerCase();
        }

        function getQuestionAnswerText(question) {
            const qType = getQuestionType(question);
            if (qType === 'multiple') {
                const answerIndexes = parseMultipleAnswerValue(question.ans);
                if (!answerIndexes.length) return String(question.ans ?? '');
                return answerIndexes.map((idx) => `${String.fromCharCode(65 + idx)}. ${question.options?.[idx] ?? ''}`).join(' / ');
            }
            if (qType === 'judge') {
                const normalized = normalizeJudgeAnswerValue(question.ans);
                if (normalized === '0') return '正确';
                if (normalized === '1') return '错误';
                return String(question.ans ?? '');
            }
            if (qType === 'fill') {
                return parseFillAnswerValue(question.ans).join(' | ');
            }
            if (qType === 'qa') {
                return String(question.ans ?? '');
            }
            const answerIndex = Number(question.ans);
            const hasValidAnswerIndex = Number.isInteger(answerIndex) && answerIndex >= 0 && answerIndex < (question.options || []).length;
            return hasValidAnswerIndex ? `${String.fromCharCode(65 + answerIndex)}. ${question.options[answerIndex]}` : String(question.ans);
        }

        function isQuestionAnswered(questionIdx) {
            return state.answers[questionIdx] !== undefined;
        }

        function isAnswerCorrect(question, userAnswer) {
            const qType = getQuestionType(question);
            if (qType === 'multiple') {
                const expected = parseMultipleAnswerValue(question.ans);
                const received = parseMultipleAnswerValue(userAnswer);
                if (expected.length !== received.length) return false;
                return expected.every((item, idx) => item === received[idx]);
            }
            if (qType === 'judge') {
                const expected = normalizeJudgeAnswerValue(question.ans);
                const received = normalizeJudgeAnswerValue(userAnswer);
                return expected !== null && expected === received;
            }
            if (qType === 'fill') {
                const expected = parseFillAnswerValue(question.ans);
                const received = parseFillAnswerValue(userAnswer);
                if (expected.length !== received.length) return false;
                return expected.every((item, idx) => normalizeFreeText(item) === normalizeFreeText(received[idx]));
            }
            if (qType === 'qa') {
                return normalizeFreeText(userAnswer) === normalizeFreeText(question.ans);
            }
            return String(userAnswer) === String(question.ans);
        }

        function shouldAutoJudgeMultiple(question, selected) {
            if (!(state.mode === 'browse' || state.mode === 'practice')) return false;
            const expected = parseMultipleAnswerValue(question.ans);
            const expectedSet = new Set(expected);
            const hasWrongChoice = selected.some((idx) => !expectedSet.has(idx));
            const isSelectionComplete = selected.length === expected.length;
            return hasWrongChoice || isSelectionComplete;
        }

        function renderAfterAnswerChange(questionIdx) {
            state.idx = questionIdx;
            renderQuestion({ animate: false });
        }

        function commitAnswer(questionIdx, answerValue, renderNow = true) {
            const question = state.lib.questions[questionIdx];
            if (!isAnswerCorrect(question, answerValue)) {
                state.wrongAttempts[questionIdx] = true;
            }
            state.answers[questionIdx] = answerValue;
            delete state.pendingAnswers[questionIdx];
            if (renderNow) renderAfterAnswerChange(questionIdx);
        }

        function finalizePendingAnswer(questionIdx, { strict = true, showError = true } = {}) {
            if (!state.lib || questionIdx < 0 || questionIdx >= state.lib.questions.length) return true;
            const question = state.lib.questions[questionIdx];
            const qType = getQuestionType(question);
            if (qType !== 'multiple' && qType !== 'fill' && qType !== 'qa') return true;

            const pending = state.pendingAnswers[questionIdx];
            if (pending === undefined) {
                if (qType === 'fill') {
                    const blankCount = getFillBlankCount(question);
                    const parts = getFillDraftValues('', blankCount);
                    commitAnswer(questionIdx, parts.join('|'), false);
                }
                return true;
            }

            if (qType === 'multiple') {
                const selected = parseMultipleAnswerValue(pending);
                if (!selected.length) {
                    if (strict) {
                        if (showError) showNotice('请至少选择一个选项');
                        return false;
                    }
                    return true;
                }
                commitAnswer(questionIdx, selected, false);
                return true;
            }
            if (qType === 'fill') {
                const blankCount = getFillBlankCount(question);
                const parts = getFillDraftValues(pending, blankCount);
                commitAnswer(questionIdx, parts.join('|'), false);
                return true;
            }
            if (qType === 'qa') {
                const text = String(pending ?? '').trim();
                if (!text) {
                    if (strict) {
                        if (showError) showNotice('请输入问答题答案');
                        return false;
                    }
                    return true;
                }
                commitAnswer(questionIdx, text, false);
                return true;
            }
            return true;
        }

        function finalizeAllPendingAnswers() {
            if (!state.lib) return;
            Object.keys(state.pendingAnswers).forEach((key) => {
                const idx = Number(key);
                if (Number.isInteger(idx)) finalizePendingAnswer(idx, { strict: false, showError: false });
            });
        }

        function applyModeSwitchInSession(targetMode, options = {}) {
            if (!MODE_SWITCHABLE.includes(targetMode)) return;
            if (!state.lib || state.isReview || !state.mode || targetMode === state.mode) return;
            const bypassExamSetup = !!options.bypassExamSetup;

            const previousMode = state.mode;
            if (targetMode === 'exam' && previousMode !== 'exam' && !bypassExamSetup) {
                state.pendingExamModeSwitch = true;
                openTimeModal();
                closeModeSwitchMenu();
                showNotice('请先设置考试时长', 'success');
                return;
            }

            state.mode = targetMode;

            if (previousMode === 'exam' && targetMode !== 'exam') {
                clearInterval(state.timer);
                state.timer = null;
                $('exam-timer').classList.add('hidden');
            }

            if (targetMode === 'exam' && previousMode !== 'exam') {
                if (!state.timeLeft || state.timeLeft <= 0) state.timeLeft = 600;
                startTimer();
            }

            const isMobile = window.innerWidth <= 768;
            $('nav-title').innerText = targetMode === 'exam' ? '答题进度' : '答题卡';
            $('submit-box').classList.toggle('hidden', targetMode !== 'exam');
            if (targetMode === 'exam') {
                if (isMobile) {
                    $('sidebar').classList.add('active');
                    $('overlay').classList.add('active');
                } else {
                    $('sidebar').classList.remove('hidden');
                }
            } else {
                if (isMobile) {
                    $('sidebar').classList.remove('active');
                    $('overlay').classList.remove('active');
                } else {
                    $('sidebar').classList.add('hidden');
                }
            }

            closeModeSwitchMenu();
            updateModeSwitchUI();
            syncUrlWithState({ libraryId: state.lib.id, mode: targetMode });
            renderQuestion();
            showNotice(`已切换到 ${targetMode} 模式`, 'success');
        }

        function toggleQuestionNavMode() {
            const currentQuestionIndex = state.idx;
            state.navMode = isPullNavMode() ? 'next' : 'pull';
            state.idx = currentQuestionIndex;
            renderQuestion();
            if (state.navMode === 'pull') {
                requestAnimationFrame(() => {
                    const card = getQuestionCardElement(currentQuestionIndex);
                    if (card) card.scrollIntoView({ block: 'start' });
                });
            } else {
                resetMainScrollerPosition();
            }
            showNotice(state.navMode === 'pull' ? '已切换为连续滚动' : '已切换为下一题按钮', 'success');
        }

        function getMainScroller() {
            return $('main-scroll');
        }

        function resetMainScrollerPosition() {
            const scroller = getMainScroller();
            if (!scroller) return;
            scroller.scrollTop = 0;
        }

        function getQuestionCardElement(index) {
            return document.getElementById(`question-card-${index}`);
        }

        function syncCurrentQuestionFromScroll() {
            if (!state.lib || !isPullNavMode()) return;
            const scroller = getMainScroller();
            if (!scroller) return;
            const cards = scroller.querySelectorAll('[data-question-card]');
            if (!cards.length) return;
            const anchorY = scroller.getBoundingClientRect().top + 110;
            let targetIndex = state.idx;
            let minDistance = Number.POSITIVE_INFINITY;

            cards.forEach((card) => {
                const index = Number(card.getAttribute('data-question-card'));
                if (!Number.isInteger(index)) return;
                const distance = Math.abs(card.getBoundingClientRect().top - anchorY);
                if (distance < minDistance) {
                    minDistance = distance;
                    targetIndex = index;
                }
            });

            if (targetIndex !== state.idx) {
                state.idx = targetIndex;
                updateNavState();
            }
        }

        function closeConfirmDialog(result) {
            const modal = $('confirm-modal');
            modal.classList.add('hidden');
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
            $('confirm-ok-btn').className = `flex-1 py-3 rounded-xl text-white font-bold ${
                confirmType === 'danger' ? 'bg-rose-600' : 'bg-indigo-600'
            }`;

            $('confirm-cancel-btn').onclick = () => closeConfirmDialog(false);
            $('confirm-ok-btn').onclick = () => closeConfirmDialog(true);
            $('confirm-modal').onclick = (event) => {
                if (event.target === $('confirm-modal')) closeConfirmDialog(false);
            };
            $('confirm-modal').classList.remove('hidden');

            return new Promise((resolve) => {
                confirmResolver = resolve;
            });
        }

        async function showLibrary(options = {}) {
            const skipHistorySync = !!options.skipHistorySync;
            state.lib = null; state.mode = ''; state.idx = 0; state.answers = {}; state.pendingAnswers = {}; state.wrongAttempts = {}; state.isReview = false; state.practiceHints = {}; state.submitting = false;
            resetExamPanelUI();
            resetMainScrollerPosition();
            closeModeSwitchMenu();
            updateModeSwitchUI();
            $('sidebar').classList.add('hidden');
            $('sidebar-trigger').classList.add('hidden');
            $('exam-timer').classList.add('hidden');
            $('overlay').classList.remove('active');
            if (!skipHistorySync) syncUrlWithState({ libraryId: '', mode: '' });
            
            // 显示加载状态
            $('main-view').innerHTML = `
                <div class="animate__animated animate__fadeIn flex flex-col items-center justify-center py-20">
                    <div class="w-16 h-16 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mb-6"></div>
                    <h3 class="text-xl font-bold text-slate-600">加载题库中...</h3>
                </div>`;
            
            // 从API获取题库列表
            const libraries = await fetchFromAPI('/libraries');
            
            if (!Array.isArray(libraries) || libraries.length === 0) {
                $('main-view').innerHTML = `
                    <div class="animate__animated animate__fadeIn text-center py-20">
                        <div class="text-6xl mb-6">📚</div>
                        <h3 class="text-2xl font-bold text-slate-600 mb-4">暂无题库</h3>
                        <p class="text-slate-400">请联系管理员添加题库</p>
                    </div>`;
                return;
            }
            
            // 生成题库列表
            $('main-view').innerHTML = `
                <div class="animate__animated animate__fadeIn">
                    <h2 class="text-3xl font-black mb-6 text-slate-800 text-center">试卷选择</h2>
                    <div class="library-grid">
                        ${libraries.map(l => `<div onclick="selectLib('${l.id}')" class="quiz-library-card border-2 border-transparent hover:border-indigo-400 cursor-pointer group">
                            <div class="quiz-library-icon mb-3 group-hover:rotate-12 transition-transform">${l.icon}</div>
                            <h3 class="text-base sm:text-lg font-bold leading-snug">${l.title}</h3>
                            <p class="library-meta text-slate-400 text-xs sm:text-sm mt-1.5">加载中...</p>
                        </div>`).join('')}
                    </div>
                </div>`;
            
            // 为每个题库获取题目数量
            libraries.forEach(async (lib) => {
                const libraryDetails = await fetchFromAPI(`/libraries/${lib.id}`);
                if (libraryDetails && libraryDetails.questions) {
                    const element = document.querySelector(`[onclick="selectLib('${lib.id}')"]`);
                    if (element) {
                        const meta = element.querySelector('.library-meta');
                        if (meta) meta.textContent = `${libraryDetails.questions.length} 题 · 专业解析`;
                    }
                }
            });
        }

        async function selectLib(id, options = {}) {
            const routeMode = normalizeRouteMode(options.routeMode);
            const skipHistorySync = !!options.skipHistorySync;
            // 显示加载状态
            $('main-view').innerHTML = `
                <div class="animate__animated animate__fadeIn flex flex-col items-center justify-center py-20">
                    <div class="w-16 h-16 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mb-6"></div>
                    <h3 class="text-xl font-bold text-slate-600">加载题库详情中...</h3>
                </div>`;
            
            // 从API获取题库详情
            const libraryDetails = await fetchFromAPI(`/libraries/${id}`);
            
            if (!libraryDetails || !Array.isArray(libraryDetails.questions)) {
                showNotice('获取题库详情失败，请稍后重试');
                showLibrary();
                return;
            }
            
            state.lib = libraryDetails;
            const questionCount = state.lib.questions.length;
            const introduction = (state.lib.description || '').trim() || `共 ${questionCount} 题。`;
            if (!skipHistorySync) syncUrlWithState({ libraryId: state.lib.id, mode: '' });
            
            $('main-view').innerHTML = `
                <div class="max-w-3xl mx-auto py-8 animate__animated animate__fadeIn">
                    <h2 class="text-3xl md:text-4xl font-black mb-8 text-center text-slate-800">${state.lib.title}</h2>
                    <div class="library-intro mb-5 rounded-2xl border border-slate-200/70 bg-white/90 shadow-sm p-5">
                        <h3 class="text-sm font-black text-slate-400 mb-2 tracking-widest">题集介绍</h3>
                        <p class="text-sm leading-relaxed text-slate-600">${introduction}</p>
                        <p class="text-xs text-slate-400 mt-3">${questionCount} 题</p>
                    </div>
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <a href="${buildLibraryModeUrl(state.lib.id, 'browse')}" onclick="return openModeFromLink(event, 'browse')" class="mode-entry w-full p-4 sm:p-5 rounded-2xl border-2 border-transparent hover:border-indigo-500 text-left flex items-center gap-4">
                            <span class="text-2xl">💡</span>
                            <div><div class="font-bold">浏览模式</div><div class="text-xs text-slate-400">实时对错，适合快速复习</div></div>
                        </a>
                        <a href="${buildLibraryModeUrl(state.lib.id, 'practice')}" onclick="return openModeFromLink(event, 'practice')" class="mode-entry w-full p-4 sm:p-5 rounded-2xl border-2 border-transparent hover:border-emerald-500 text-left flex items-center gap-4">
                            <span class="text-2xl">✍️</span>
                            <div><div class="font-bold">练习模式</div><div class="text-xs text-slate-400">自主控制，隐藏解析</div></div>
                        </a>
                        <a href="${buildLibraryModeUrl(state.lib.id, 'exam')}" onclick="return openModeFromLink(event, 'exam')" class="mode-entry w-full p-4 sm:p-5 rounded-2xl border-2 border-transparent hover:border-rose-500 text-left flex items-center gap-4">
                            <span class="text-2xl">⏱️</span>
                            <div><div class="font-bold text-rose-600">考试模式</div><div class="text-xs text-slate-400 text-rose-300">限时答题，红绿变色复盘</div></div>
                        </a>
                        <a href="${buildLibraryModeUrl(state.lib.id, 'analysis')}" onclick="return openModeFromLink(event, 'analysis')" class="mode-entry w-full p-4 sm:p-5 rounded-2xl border-2 border-transparent hover:border-amber-400 text-left flex items-center gap-4">
                            <span class="text-2xl">📖</span>
                            <div><div class="font-bold text-amber-600">解析模式</div><div class="text-xs text-slate-400">直接显示解析，不需要作答</div></div>
                        </a>
                    </div>
                </div>`;

            if (routeMode) {
                if (routeMode === 'exam') {
                    openTimeModal();
                } else {
                    startMode(routeMode);
                }
            }
        }

        function openModeFromLink(event, mode) {
            if (event) event.preventDefault();
            const normalizedMode = normalizeRouteMode(mode);
            if (!normalizedMode) return false;
            if (normalizedMode === 'exam') openTimeModal();
            else startMode(normalizedMode);
            return false;
        }

        function openTimeModal() {
            const defaultMinute = Math.max(1, Math.min(180, Math.ceil((state.timeLeft || 600) / 60)));
            $('custom-min').value = String(defaultMinute);
            $('time-modal').classList.remove('hidden');
        }
        function closeTimeModal() {
            state.pendingExamModeSwitch = false;
            $('time-modal').classList.add('hidden');
        }
        function confirmStartExam() {
            state.timeLeft = (parseInt($('custom-min').value) || 10) * 60;
            const shouldSwitchExamInSession = state.pendingExamModeSwitch;
            state.pendingExamModeSwitch = false;
            closeTimeModal();
            if (shouldSwitchExamInSession) {
                applyModeSwitchInSession('exam', { bypassExamSetup: true });
            } else {
                startMode('exam');
            }
        }

        function resetExamPanelUI() {
            $('nav-title').innerText = '答题进度';
            $('score-tag').innerText = '';
            $('score-tag').classList.add('hidden');
            $('submit-box').classList.remove('hidden');
        }

        function startMode(mode) {
            state.mode = mode; state.idx = 0; state.answers = {}; state.pendingAnswers = {}; state.wrongAttempts = {}; state.isReview = false; state.practiceHints = {}; state.submitting = false; state.navMode = 'next';
            clearInterval(state.timer);
            resetExamPanelUI();
            resetMainScrollerPosition();
            closeModeSwitchMenu();
            $('sidebar-trigger').classList.remove('hidden');
            const isMobile = window.innerWidth <= 768;
            $('sidebar').className = isMobile ? "flex bg-white flex-col" : "flex w-72 lg:w-80 border-r flex-col";
            $('nav-title').innerText = mode === 'exam' ? '答题进度' : '答题卡';
            $('submit-box').classList.toggle('hidden', mode !== 'exam');
            initNavGrid();

            if (mode === 'exam') {
                startTimer();
                if (isMobile) {
                    $('sidebar').classList.add('active');
                    $('overlay').classList.add('active');
                } else {
                    $('sidebar').classList.remove('hidden');
                }
            } else {
                $('exam-timer').classList.add('hidden');
                if (isMobile) {
                    $('sidebar').classList.remove('active');
                    $('overlay').classList.remove('active');
                } else {
                    $('sidebar').classList.add('hidden');
                }
            }
            updateModeSwitchUI();
            syncUrlWithState({ libraryId: state.lib?.id || '', mode });
            renderQuestion();
        }

        function renderContinuousQuestions({ animate = true } = {}) {
            const isAnalysisMode = state.mode === 'analysis';
            const compact = getCompactnessPreset();

            const cards = state.lib.questions.map((q, qIdx) => {
                const qType = getQuestionType(q);
                const qTypeLabel = getQuestionTypeLabel(q);
                const uAns = state.answers[qIdx];
                const pendingAnswer = state.pendingAnswers[qIdx];
                const isAnswered = isQuestionAnswered(qIdx);
                const isSingleAttemptMode = isSingleAttemptQuestionMode();
                const isLockedAfterAnswer = isSingleAttemptMode && isAnswered;
                const isPracticeHintOpen = !!state.practiceHints[qIdx];
                const showA = isAnalysisMode
                    || state.isReview
                    || (state.mode === 'browse' && isAnswered)
                    || (state.mode === 'practice' && isPracticeHintOpen)
                    || isPracticeHintOpen;
                const answerText = getQuestionAnswerText(q);
                const currentAnswer = pendingAnswer !== undefined ? pendingAnswer : uAns;
                const selectedSingle = currentAnswer;
                const selectedMulti = new Set(parseMultipleAnswerValue(currentAnswer));
                const correctMulti = new Set(parseMultipleAnswerValue(q.ans));
                const multiFeedback = qType === 'multiple' ? getMultipleAnswerFeedback(q, uAns) : null;
                const fillFeedback = qType === 'fill' ? getFillAnswerFeedback(q, uAns) : null;
                let contentHtml = '';
                if (qType === 'fill') {
                    const readOnly = isAnalysisMode || state.isReview || isLockedAfterAnswer;
                    const blankCount = getFillBlankCount(q);
                    const fillValues = getFillDraftValues(currentAnswer, blankCount);
                    const fillInputs = fillValues.map((value, idx) => `
                        <input
                            type="text"
                            value="${escapeHtml(value)}"
                            placeholder="请输入答案"
                            ${readOnly ? 'disabled' : ''}
                            oninput="handleFillInput(${idx}, this.value, ${qIdx})"
                            class="quiz-answer-input w-full rounded-xl border border-slate-200 bg-white/95 px-3 py-3 text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-300 ${readOnly ? 'opacity-75 cursor-not-allowed' : ''}"
                        >
                    `).join('');
                    contentHtml = `
                        <div class="space-y-2.5" ${getQuestionScaleStyle()}>
                            ${fillInputs}
                            ${(readOnly || state.mode === 'exam') ? '' : `<div class="flex justify-end"><button onclick="confirmCurrentAnswer(${qIdx})" class="px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-bold shadow-sm">保存答案</button></div>`}
                        </div>
                    `;
                } else if (qType === 'qa') {
                    const textValue = String(currentAnswer ?? '');
                    const readOnly = isAnalysisMode || state.isReview || isLockedAfterAnswer;
                    contentHtml = `
                        <div class="space-y-2.5" ${getQuestionScaleStyle()}>
                            <textarea class="quiz-answer-input w-full rounded-2xl border border-slate-200 bg-white/95 px-3 py-3 text-slate-700 min-h-[150px] focus:outline-none focus:ring-2 focus:ring-indigo-300 ${readOnly ? 'opacity-75 cursor-not-allowed' : ''}" placeholder="请输入答案后自行判断" ${readOnly ? 'disabled' : ''} oninput="handleTextAnswerInput(this.value, ${qIdx})">${escapeHtml(textValue)}</textarea>
                            ${(readOnly || state.mode === 'exam') ? '' : `
                                <div class="flex flex-wrap justify-end gap-3">
                                    <button onclick="markQuestionMastered(${qIdx})" class="px-4 py-2 rounded-xl bg-emerald-100 text-emerald-700 text-sm font-bold border border-emerald-200">已掌握</button>
                                    <button onclick="markQuestionUnknown(${qIdx})" class="px-4 py-2 rounded-xl bg-amber-500 text-white text-sm font-bold">不会做</button>
                                    <button onclick="revealQuestionAnswer(${qIdx})" class="${ANALYSIS_ACTION_BUTTON_CLASS}">${ANALYSIS_ACTION_ICON}<span class="ml-1">显示解析</span></button>
                                </div>
                            `}
                        </div>
                    `;
                } else {
                    const optionsHtml = (q.options || []).map((opt, i) => {
                        let cls = compact.optionCard;
                        if (qType === 'multiple') {
                            const isCorrectOption = correctMulti.has(i);
                            const isSelectedOption = selectedMulti.has(i);
                            if (isAnalysisMode || state.isReview || (state.mode === 'browse' && isAnswered) || (state.mode === 'practice' && isAnswered) || isLockedAfterAnswer) {
                                if (isCorrectOption && isSelectedOption) cls += " opt-right";
                                else if (isCorrectOption && !isSelectedOption && multiFeedback && multiFeedback.status !== 'correct' && (uAns !== undefined || state.isReview)) cls += " opt-missed";
                                else if (isSelectedOption) cls += " opt-wrong";
                                else cls += " cursor-default";
                            } else if (isSelectedOption) {
                                cls += " option-selected";
                            }
                            if (isLockedAfterAnswer) cls += " cursor-default";
                            return `<label class="${cls} multi-option-row">
                                        <input type="checkbox" class="multi-option-checkbox" ${isSelectedOption ? 'checked' : ''} ${(isAnalysisMode || state.isReview || isLockedAfterAnswer) ? 'disabled' : ''} onchange="handleChoice(${i}, ${qIdx})">
                                        <span class="${compact.optionTag}" style="font-size:0.72em;">${String.fromCharCode(65+i)}</span>
                                        ${opt}
                                    </label>`;
                        } else {
                            if (isAnalysisMode) {
                                if (String(i) === String(q.ans)) cls += " opt-right cursor-default";
                                else cls += " cursor-default";
                            } else if (state.isReview || (state.mode === 'browse' && isAnswered) || (state.mode === 'practice' && isAnswered)) {
                                if (String(i) === String(q.ans)) cls += " opt-right";
                                else if (String(i) === String(uAns)) cls += " opt-wrong";
                            } else if (String(i) === String(selectedSingle)) {
                                cls += " option-selected";
                            }
                        }
                        if (isLockedAfterAnswer) cls += " cursor-default";
                        return `<div onclick="handleChoice(${i}, ${qIdx})" class="${cls}">
                                    <span class="${compact.optionTag}" style="font-size:0.72em;">${String.fromCharCode(65+i)}</span>
                                    ${opt}
                                </div>`;
                    }).join('');
                    const allSelected = (q.options || []).length > 0 && selectedMulti.size === (q.options || []).length;
                    const showMultiToolbar = qType === 'multiple' && !(isAnalysisMode || state.isReview || isLockedAfterAnswer) && state.mode !== 'exam';
                    contentHtml = `
                        <div class="${compact.optionsWrap}"${getQuestionScaleStyle()}>
                            ${optionsHtml}
                        </div>
                        ${showMultiToolbar ? `
                            <div class="mt-3 flex items-center justify-between gap-3">
                                <label class="inline-flex items-center gap-2 text-sm text-slate-500">
                                    <input type="checkbox" ${allSelected ? 'checked' : ''} onchange="toggleSelectAllMultiple(${qIdx})">
                                    全选
                                </label>
                                <button onclick="confirmCurrentAnswer(${qIdx})" class="px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-bold shadow-sm">提交答案</button>
                            </div>
                        ` : ''}
                    `;
                }

                let cardHtml = `
                    <article id="question-card-${qIdx}" data-question-card="${qIdx}" class="${compact.questionCard}">
                        <div class="${compact.questionHeader}">
                            <span class="${compact.questionIndex}"${getQuestionScaleStyle()}>${qIdx + 1}.</span>
                            <h2 class="${compact.questionTitle}"${getQuestionScaleStyle()}>${q.q}<span class="${compact.questionTypeTag}">${qTypeLabel}</span></h2>
                        </div>
                        ${contentHtml}`;

                if (state.mode === 'practice' && isAnswered && !isPracticeHintOpen) {
                    cardHtml += `<div class="mt-3 flex justify-end"><button onclick="toggleHint(${qIdx})" class="${ANALYSIS_ACTION_BUTTON_CLASS}">${ANALYSIS_ACTION_ICON}<span class="ml-1">显示解析</span></button></div>`;
                }

                if (showA) {
                    cardHtml += `<div class="${compact.analysisCard}"${getQuestionScaleStyle()}>
                        ${(qType === 'fill' && fillFeedback) ? `<p class="${compact.analysisText}">你的答案：${escapeHtml(fillFeedback.receivedText)} · ${fillFeedback.status}</p><p class="${compact.analysisText}">分空判断：${escapeHtml(fillFeedback.detailText)}</p>` : ''}
                        ${(qType === 'qa') ? `<p class="${compact.analysisText}">你的答案：${escapeHtml(String(uAns ?? pendingAnswer ?? '未作答'))}</p>` : ''}
                        ${(qType === 'multiple' && multiFeedback && (uAns !== undefined || state.isReview)) ? `<p class="${compact.analysisText}">你的答案：${escapeHtml(multiFeedback.receivedText)} · ${multiFeedback.status === 'correct' ? '正确' : multiFeedback.status}</p>` : ''}
                        <p class="${compact.analysisAnswer}">正确答案：${answerText}</p>
                        <p class="${compact.analysisText}">${q.analysis || '暂无解析'}</p>
                    </div>`;
                }

                cardHtml += `</article>`;
                return cardHtml;
            }).join('');

            const wrapClass = animate
                ? `${compact.cardsWrap} animate__animated animate__fadeIn animate__faster`
                : compact.cardsWrap;
            $('main-view').innerHTML = `
                <div class="${wrapClass}">
                    ${cards}
                </div>`;
            updateNavState();
        }

        function renderQuestion({ animate = true } = {}) {
            if (isPullNavMode()) {
                renderContinuousQuestions({ animate });
                return;
            }
            const compact = getCompactnessPreset();

            const q = state.lib.questions[state.idx];
            const qType = getQuestionType(q);
            const qTypeLabel = getQuestionTypeLabel(q);
            const uAns = state.answers[state.idx];
            const pendingAnswer = state.pendingAnswers[state.idx];
            const isAnswered = isQuestionAnswered(state.idx);
            const isSingleAttemptMode = isSingleAttemptQuestionMode();
            const isLockedAfterAnswer = isSingleAttemptMode && isAnswered;
            const isPracticeHintOpen = !!state.practiceHints[state.idx];
            const isAnalysisMode = state.mode === 'analysis';
            const showA = isAnalysisMode
                || state.isReview
                || (state.mode === 'browse' && isAnswered)
                || (state.mode === 'practice' && isPracticeHintOpen)
                || isPracticeHintOpen;
            const answerText = getQuestionAnswerText(q);
            const isLastQuestion = state.idx === state.lib.questions.length - 1;
            const nextButtonText = isLastQuestion
                ? (state.isReview ? '结束复盘' : (state.mode === 'exam' ? '交卷' : (isAnalysisMode ? '返回首页' : '完成')))
                : '下一题';
            const currentAnswer = pendingAnswer !== undefined ? pendingAnswer : uAns;
            const selectedSingle = currentAnswer;
            const selectedMulti = new Set(parseMultipleAnswerValue(currentAnswer));
            const correctMulti = new Set(parseMultipleAnswerValue(q.ans));
            const multiFeedback = qType === 'multiple' ? getMultipleAnswerFeedback(q, uAns) : null;
            const fillFeedback = qType === 'fill' ? getFillAnswerFeedback(q, uAns) : null;
            let contentHtml = '';
            if (qType === 'fill') {
                const readOnly = isAnalysisMode || state.isReview || isLockedAfterAnswer;
                const blankCount = getFillBlankCount(q);
                const fillValues = getFillDraftValues(currentAnswer, blankCount);
                const fillInputs = fillValues.map((value, idx) => `
                    <input
                        type="text"
                        value="${escapeHtml(value)}"
                        placeholder="请输入答案"
                        ${readOnly ? 'disabled' : ''}
                        oninput="handleFillInput(${idx}, this.value)"
                        class="quiz-answer-input w-full rounded-xl border border-slate-200 bg-white/95 px-3 py-3 text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-300 ${readOnly ? 'opacity-75 cursor-not-allowed' : ''}"
                    >
                `).join('');
                contentHtml = `
                    <div class="space-y-2.5" ${getQuestionScaleStyle()}>
                        ${fillInputs}
                        ${(readOnly || state.mode === 'exam') ? '' : `<div class="flex justify-end"><button onclick="confirmCurrentAnswer()" class="px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-bold shadow-sm">保存答案</button></div>`}
                    </div>
                `;
            } else if (qType === 'qa') {
                const textValue = String(currentAnswer ?? '');
                const readOnly = isAnalysisMode || state.isReview || isLockedAfterAnswer;
                contentHtml = `
                    <div class="space-y-2.5" ${getQuestionScaleStyle()}>
                        <textarea class="quiz-answer-input w-full rounded-2xl border border-slate-200 bg-white/95 px-3 py-3 text-slate-700 min-h-[180px] focus:outline-none focus:ring-2 focus:ring-indigo-300 ${readOnly ? 'opacity-75 cursor-not-allowed' : ''}" placeholder="请输入答案后自行判断" ${readOnly ? 'disabled' : ''} oninput="handleTextAnswerInput(this.value)">${escapeHtml(textValue)}</textarea>
                        ${(readOnly || state.mode === 'exam') ? '' : `
                            <div class="flex flex-wrap justify-end gap-3">
                                <button onclick="markQuestionMastered()" class="px-4 py-2 rounded-xl bg-emerald-100 text-emerald-700 text-sm font-bold border border-emerald-200">已掌握</button>
                                <button onclick="markQuestionUnknown()" class="px-4 py-2 rounded-xl bg-amber-500 text-white text-sm font-bold">不会做</button>
                                <button onclick="revealQuestionAnswer()" class="${ANALYSIS_ACTION_BUTTON_CLASS}">${ANALYSIS_ACTION_ICON}<span class="ml-1">显示解析</span></button>
                            </div>
                        `}
                    </div>
                `;
            } else {
                const optionsHtml = (q.options || []).map((opt, i) => {
                    let cls = compact.optionCard;
                    if (qType === 'multiple') {
                        const isCorrectOption = correctMulti.has(i);
                        const isSelectedOption = selectedMulti.has(i);
                        if (isAnalysisMode || state.isReview || (state.mode === 'browse' && isAnswered) || (state.mode === 'practice' && isAnswered) || isLockedAfterAnswer) {
                            if (isCorrectOption && isSelectedOption) cls += " opt-right";
                            else if (isCorrectOption && !isSelectedOption && multiFeedback && multiFeedback.status !== 'correct' && (uAns !== undefined || state.isReview)) cls += " opt-missed";
                            else if (isSelectedOption) cls += " opt-wrong";
                            else cls += " cursor-default";
                        } else if (isSelectedOption) {
                            cls += " option-selected";
                        }
                        if (isLockedAfterAnswer) cls += " cursor-default";
                        return `<label class="${cls} multi-option-row">
                            <input type="checkbox" class="multi-option-checkbox" ${isSelectedOption ? 'checked' : ''} ${(isAnalysisMode || state.isReview || isLockedAfterAnswer) ? 'disabled' : ''} onchange="handleChoice(${i})">
                            <span class="${compact.optionTag}" style="font-size:0.72em;">${String.fromCharCode(65+i)}</span>
                            ${opt}
                        </label>`;
                    } else {
                        if (isAnalysisMode) {
                            if (String(i) === String(q.ans)) cls += " opt-right cursor-default";
                            else cls += " cursor-default";
                        } else if (state.isReview || (state.mode === 'browse' && isAnswered) || (state.mode === 'practice' && isAnswered)) {
                            if (String(i) === String(q.ans)) cls += " opt-right";
                            else if (String(i) === String(uAns)) cls += " opt-wrong";
                        } else if (String(i) === String(selectedSingle)) {
                            cls += " option-selected";
                        }
                    }
                    if (isLockedAfterAnswer) cls += " cursor-default";
                    return `<div onclick="handleChoice(${i})" class="${cls}">
                        <span class="${compact.optionTag}" style="font-size:0.72em;">${String.fromCharCode(65+i)}</span>
                        ${opt}
                    </div>`;
                }).join('');
                const allSelected = (q.options || []).length > 0 && selectedMulti.size === (q.options || []).length;
                const showMultiToolbar = qType === 'multiple' && !(isAnalysisMode || state.isReview || isLockedAfterAnswer) && state.mode !== 'exam';
                contentHtml = `
                    <div class="${compact.optionsWrap}"${getQuestionScaleStyle()}>
                        ${optionsHtml}
                    </div>
                    ${showMultiToolbar ? `
                        <div class="mt-3 flex items-center justify-between gap-3">
                            <label class="inline-flex items-center gap-2 text-sm text-slate-500">
                                <input type="checkbox" ${allSelected ? 'checked' : ''} onchange="toggleSelectAllMultiple()">
                                全选
                            </label>
                            <button onclick="confirmCurrentAnswer()" class="px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-bold shadow-sm">提交答案</button>
                        </div>
                    ` : ''}
                `;
            }

            const questionCardClass = animate
                ? `${compact.questionCard} animate__animated animate__fadeIn animate__faster`
                : compact.questionCard;
            let html = `
                <div class="${questionCardClass}">
                    <div class="${compact.questionHeader}">
                        <span class="${compact.questionIndex}"${getQuestionScaleStyle()}>${state.idx + 1}.</span>
                        <h2 class="${compact.questionTitle}"${getQuestionScaleStyle()}>${q.q}<span class="${compact.questionTypeTag}">${qTypeLabel}</span></h2>
                    </div>
                    ${contentHtml}`;

            if (state.mode === 'practice' && isAnswered && !isPracticeHintOpen) {
                html += `<div class="mt-3 flex justify-end"><button onclick="toggleHint()" class="${ANALYSIS_ACTION_BUTTON_CLASS}">${ANALYSIS_ACTION_ICON}<span class="ml-1">显示解析</span></button></div>`;
            }

            if (showA) {
                html += `<div class="${compact.analysisCard}"${getQuestionScaleStyle()}>
                    ${(qType === 'fill' && fillFeedback) ? `<p class="${compact.analysisText}">你的答案：${escapeHtml(fillFeedback.receivedText)} · ${fillFeedback.status}</p><p class="${compact.analysisText}">分空判断：${escapeHtml(fillFeedback.detailText)}</p>` : ''}
                    ${(qType === 'qa') ? `<p class="${compact.analysisText}">你的答案：${escapeHtml(String(uAns ?? pendingAnswer ?? '未作答'))}</p>` : ''}
                    ${(qType === 'multiple' && multiFeedback && (uAns !== undefined || state.isReview)) ? `<p class="${compact.analysisText}">你的答案：${escapeHtml(multiFeedback.receivedText)} · ${multiFeedback.status === 'correct' ? '正确' : multiFeedback.status}</p>` : ''}
                    <p class="${compact.analysisAnswer}">正确答案：${answerText}</p>
                    <p class="${compact.analysisText}">${q.analysis || '暂无解析'}</p>
                </div>`;
            }

            html += `<div class="${compact.footer}">
                        <button onclick="jumpTo(${state.idx - 1})" ${state.idx === 0 ? 'disabled' : ''} class="${compact.prevButton}">上题</button>
                        <button onclick="nextStep()" class="${compact.nextButton}">
                            ${nextButtonText}
                        </button>
                    </div>
                </div>`;
            
            $('main-view').innerHTML = html;
            updateNavState();
        }

        // --- 功能函数 ---
        function handleChoice(i, questionIdx = state.idx) {
            if (state.mode === 'analysis') return;
            if (state.isReview) return;
            const question = state.lib.questions[questionIdx];
            const qType = getQuestionType(question);
            const isSingleAttemptMode = isSingleAttemptQuestionMode();

            if (isSingleAttemptMode && isQuestionAnswered(questionIdx)) {
                return;
            }

            if (qType === 'multiple') {
                const existing = state.pendingAnswers[questionIdx] !== undefined
                    ? state.pendingAnswers[questionIdx]
                    : state.answers[questionIdx];
                const selected = new Set(parseMultipleAnswerValue(existing));
                if (selected.has(i)) selected.delete(i);
                else selected.add(i);
                const nextSelected = Array.from(selected).sort((a, b) => a - b);
                state.pendingAnswers[questionIdx] = nextSelected;
                renderAfterAnswerChange(questionIdx);
                return;
            }

            state.pendingAnswers[questionIdx] = i;
            commitAnswer(questionIdx, i);
        }

        function handleTextAnswerInput(value, questionIdx = state.idx) {
            if (state.mode === 'analysis' || state.isReview) return;
            const question = state.lib?.questions?.[questionIdx];
            if (!question) return;
            const qType = getQuestionType(question);
            if (qType !== 'fill' && qType !== 'qa') return;
            state.pendingAnswers[questionIdx] = String(value ?? '');
        }

        function handleFillInput(blankIndex, value, questionIdx = state.idx) {
            if (state.mode === 'analysis' || state.isReview) return;
            const question = state.lib?.questions?.[questionIdx];
            if (!question || getQuestionType(question) !== 'fill') return;
            const blankCount = getFillBlankCount(question);
            const existing = state.pendingAnswers[questionIdx] !== undefined
                ? state.pendingAnswers[questionIdx]
                : state.answers[questionIdx];
            const values = getFillDraftValues(existing, blankCount);
            values[blankIndex] = String(value ?? '');
            state.pendingAnswers[questionIdx] = values.join('|');
        }

        function toggleSelectAllMultiple(questionIdx = state.idx) {
            if (state.mode === 'analysis' || state.isReview) return;
            const question = state.lib?.questions?.[questionIdx];
            if (!question || getQuestionType(question) !== 'multiple') return;
            if (isSingleAttemptQuestionMode() && isQuestionAnswered(questionIdx)) return;
            const optionCount = Array.isArray(question.options) ? question.options.length : 0;
            if (!optionCount) return;
            const existing = state.pendingAnswers[questionIdx] !== undefined
                ? state.pendingAnswers[questionIdx]
                : state.answers[questionIdx];
            const selected = new Set(parseMultipleAnswerValue(existing));
            const nextSelected = selected.size === optionCount
                ? []
                : Array.from({ length: optionCount }, (_, idx) => idx);
            state.pendingAnswers[questionIdx] = nextSelected;
            renderAfterAnswerChange(questionIdx);
        }

        function confirmCurrentAnswer(questionIdx = state.idx) {
            if (!finalizePendingAnswer(questionIdx, { strict: true, showError: true })) return;
            renderAfterAnswerChange(questionIdx);
        }

        function markQuestionMastered(questionIdx = state.idx) {
            if (state.mode === 'analysis' || state.isReview) return;
            const question = state.lib?.questions?.[questionIdx];
            if (!question || getQuestionType(question) !== 'qa') return;
            const existing = state.pendingAnswers[questionIdx] !== undefined
                ? state.pendingAnswers[questionIdx]
                : state.answers[questionIdx];
            const text = String(existing ?? '').trim() || '已掌握';
            commitAnswer(questionIdx, text, false);
            delete state.wrongAttempts[questionIdx];
            state.practiceHints[questionIdx] = false;
            renderAfterAnswerChange(questionIdx);
        }

        function markQuestionUnknown(questionIdx = state.idx) {
            if (state.mode === 'analysis' || state.isReview) return;
            const question = state.lib?.questions?.[questionIdx];
            if (!question) return;
            const qType = getQuestionType(question);
            if (qType !== 'qa' && qType !== 'fill') return;
            const value = qType === 'qa' ? '不会做' : '';
            commitAnswer(questionIdx, value, false);
            state.wrongAttempts[questionIdx] = true;
            state.practiceHints[questionIdx] = false;
            renderAfterAnswerChange(questionIdx);
        }

        function revealQuestionAnswer(questionIdx = state.idx) {
            if (state.mode === 'analysis') return;
            const question = state.lib?.questions?.[questionIdx];
            if (!question) return;
            const qType = getQuestionType(question);
            if (qType !== 'qa' && qType !== 'fill') return;
            state.practiceHints[questionIdx] = true;
            renderAfterAnswerChange(questionIdx);
        }

        function toggleHint(questionIdx = state.idx) {
            state.practiceHints[questionIdx] = true;
            state.idx = questionIdx;
            renderQuestion();
        }

        async function restartCurrentSession() {
            if (!state.lib || !state.mode || state.isReview) return;
            const isExamMode = state.mode === 'exam';
            const ok = await showConfirmDialog({
                title: '确认重新开始',
                message: isExamMode ? '将清空当前考试进度并重新计时，确定继续吗？' : '将清空当前作答进度并从第一题开始，确定继续吗？',
                confirmText: '重新开始',
                confirmType: 'danger'
            });
            if (!ok) return;
            const mode = state.mode;
            startMode(mode);
            showNotice('已重新开始', 'success');
        }

        function nextStep() {
            if (!finalizePendingAnswer(state.idx, { strict: true, showError: true })) return;
            if (state.idx < state.lib.questions.length - 1) jumpTo(state.idx + 1);
            else if (state.isReview) goHome();
            else if (state.mode === 'exam') submitExam();
            else goHome();
        }
        function jumpTo(i) { 
            if (i >= 0 && i < state.lib.questions.length) { 
                if (i !== state.idx && !finalizePendingAnswer(state.idx, { strict: true, showError: true })) return;
                state.idx = i; renderQuestion();
                if (isPullNavMode()) {
                    const card = getQuestionCardElement(i);
                    if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
                } else {
                    resetMainScrollerPosition();
                }
                if(window.innerWidth <= 768) toggleSidebar(false);
            } 
        }
        function initNavGrid() {
            const frag = document.createDocumentFragment();
            const groups = getNavQuestionGroups();
            groups.forEach((group) => {
                const section = document.createElement('section');
                section.className = 'n-group';
                const title = document.createElement('div');
                title.className = 'n-group-title';
                title.innerText = `${group.label} ${group.indexes.length}`;
                section.appendChild(title);

                const itemsWrap = document.createElement('div');
                itemsWrap.className = 'n-group-grid';
                group.indexes.forEach((questionIndex) => {
                    const d = document.createElement('div');
                    d.className = 'n-item';
                    d.dataset.questionIndex = String(questionIndex);
                    d.innerText = questionIndex + 1;
                    d.onclick = () => jumpTo(questionIndex);
                    itemsWrap.appendChild(d);
                });
                section.appendChild(itemsWrap);
                frag.appendChild(section);
            });
            $('nav-grid').innerHTML = ''; $('nav-grid').appendChild(frag);
        }
        function updateNavState() {
            const dots = $('nav-grid').querySelectorAll('.n-item[data-question-index]');
            const showRealtimeResult = state.mode === 'browse' || state.mode === 'practice';
            for (let idx = 0; idx < dots.length; idx++) {
                const dot = dots[idx];
                const i = Number(dot.dataset.questionIndex);
                if (!Number.isInteger(i)) continue;
                const uA = state.answers[i];
                dot.className = 'n-item'; if (i === state.idx) dot.classList.add('n-curr');
                if (state.isReview || showRealtimeResult) {
                    const qType = getQuestionType(state.lib.questions[i]);
                    if (uA === undefined) {
                        if (state.isReview) dot.classList.add('n-done');
                    } else {
                        if (qType === 'qa') {
                            // 问答题按自评展示：已掌握为绿色，不会做为红色
                            if (state.wrongAttempts[i]) dot.classList.add('n-wrong');
                            else dot.classList.add('n-right');
                        } else {
                            const isCorrect = isAnswerCorrect(state.lib.questions[i], uA);
                            if (isCorrect) {
                                if (!state.isReview && showRealtimeResult && state.wrongAttempts[i]) {
                                    // 浏览/练习中：做对但曾做错，使用过渡色强调“已改正”
                                    dot.classList.add('n-corrected');
                                } else {
                                    dot.classList.add('n-right');
                                }
                            } else {
                                dot.classList.add('n-wrong');
                            }
                        }
                    }
                } else if (uA !== undefined) dot.classList.add('n-done');
            }
        }
        async function submitExam(force = false) {
            if (state.submitting || !state.lib || state.isReview) return;
            finalizeAllPendingAnswers();
            if (!force) {
                const answered = Object.keys(state.answers).length;
                const ok = await showConfirmDialog({
                    title: '确认交卷',
                    message: `当前已作答 ${answered}/${state.lib.questions.length} 题，交卷后将进入复盘模式。`,
                    confirmText: '确认交卷',
                    confirmType: 'danger'
                });
                if (!ok) return;
            }
            state.submitting = true;
            
            // 显示加载状态
            $('main-view').innerHTML = `
                <div class="animate__animated animate__fadeIn flex flex-col items-center justify-center py-20">
                    <div class="w-16 h-16 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mb-6"></div>
                    <h3 class="text-xl font-bold text-slate-600">正在提交答卷...</h3>
                </div>`;
            
            // 保存答题记录到API
            const result = await saveAnswers(state.lib.id, state.answers);
            
            if (!result) {
                showNotice('提交失败，请重试');
                state.submitting = false;
                renderQuestion();
                return;
            }
            
            state.isReview = true; clearInterval(state.timer);
            state.submitting = false;
            $('exam-timer').classList.add('hidden');
            $('nav-title').innerText = "成绩分析";
            $('submit-box').classList.add('hidden');
            updateModeSwitchUI();
            const score = result.score;
            const accuracy = result.accuracy ?? (result.total > 0 ? Math.round((result.correct / result.total) * 100) : 0);
            $('score-tag').innerText = `答对: ${score}题`; $('score-tag').classList.remove('hidden');
            $('main-view').innerHTML = `
                <div class="result-panel text-center bg-white/95 border border-slate-200/70 p-12 rounded-[3rem] shadow-2xl max-w-sm mx-auto animate__animated animate__zoomIn">
                    <div class="text-6xl font-black text-indigo-600 mb-4">${score}</div>
                    <p class="text-slate-400 mb-2">共答对 ${result.correct} / ${result.total} 题</p>
                    <p class="text-xs text-slate-300 mb-6">正确率 ${accuracy}%</p>
                    <button onclick="jumpTo(0)" class="w-full py-4 bg-indigo-600 text-white rounded-2xl font-bold mb-4">错题分析</button>
                    <button onclick="goHome()" class="w-full py-4 bg-slate-100 text-slate-500 rounded-2xl font-bold">返回首页</button>
                </div>`;
            if(window.innerWidth <= 768) toggleSidebar(false);
        }
        function startTimer() {
            clearInterval(state.timer);
            $('exam-timer').classList.remove('hidden');
            state.timer = setInterval(() => {
                state.timeLeft--;
                let m = Math.floor(state.timeLeft/60), s = state.timeLeft%60;
                $('exam-timer').innerText = `${m}:${s < 10 ? '0'+s : s}`;
                if(state.timeLeft <= 0) submitExam(true);
            }, 1000);
        }
        function toggleSidebar(force) {
            const sb = $('sidebar'); const ov = $('overlay');
            if(window.innerWidth <= 768) {
                const isActive = force !== undefined ? force : !sb.classList.contains('active');
                sb.classList.toggle('active', isActive);
                ov.classList.toggle('active', isActive);
            } else { sb.classList.toggle('hidden'); }
        }
        async function goHome(conf = false) { 
            const hasInProgressSession = ['browse', 'practice', 'exam'].includes(state.mode);
            const hasProgress = Object.keys(state.answers).length > 0 || state.mode === 'exam';
            if (conf && state.lib && !state.isReview && hasInProgressSession && hasProgress) {
                const ok = await showConfirmDialog({
                    title: '确认退出',
                    message: '退出后当前未交卷进度会丢失，确定继续吗？',
                    confirmText: '退出',
                    confirmType: 'danger'
                });
                if (!ok) return;
            }
            clearInterval(state.timer); await showLibrary(); 
        }

        (async function() {
            syncViewportHeight();
            document.body.dataset.themePreference = getStoredThemePreference();
            syncThemeMode();
            syncDeviceProfileClass();
            if ($('theme-toggle')) {
                $('theme-toggle').addEventListener('click', toggleThemeMode);
            }
            if ($('nav-mode-toggle')) {
                $('nav-mode-toggle').addEventListener('click', toggleQuestionNavMode);
            }
            if ($('font-size-btn')) {
                $('font-size-btn').addEventListener('click', (event) => {
                    event.stopPropagation();
                    const wrap = $('font-size-wrap');
                    const panel = $('font-size-panel');
                    if (!wrap || !panel || wrap.classList.contains('hidden')) return;
                    panel.classList.toggle('hidden');
                    closeModeSwitchMenu();
                });
            }
            if ($('question-font-size')) {
                $('question-font-size').addEventListener('input', (event) => {
                    setQuestionFontScaleFromPercent(event.target.value, !!state.lib && !!state.mode);
                });
            }
            if ($('question-density')) {
                $('question-density').addEventListener('input', (event) => {
                    setCompactnessLevel(event.target.value, !!state.lib && !!state.mode);
                });
            }
            if ($('font-size-reset')) {
                $('font-size-reset').addEventListener('click', () => {
                    const shouldRender = !!state.lib && !!state.mode;
                    setQuestionFontScaleFromPercent(DEFAULT_QUESTION_FONT_PERCENT, false);
                    setCompactnessLevel(DEFAULT_COMPACTNESS_LEVEL, false);
                    if (shouldRender) rerenderQuestionWithLayoutUpdate();
                });
            }
            if ($('mode-switch-btn')) {
                $('mode-switch-btn').addEventListener('click', (event) => {
                    event.stopPropagation();
                    const menu = $('mode-switch-menu');
                    if (!menu || $('mode-switch-wrap').classList.contains('hidden')) return;
                    closeFontSizePanel();
                    menu.classList.toggle('hidden');
                });
            }
            if ($('mode-switch-menu')) {
                $('mode-switch-menu').addEventListener('click', (event) => {
                    const btn = event.target.closest('[data-mode-switch]');
                    if (!btn) return;
                    const targetMode = btn.getAttribute('data-mode-switch');
                    applyModeSwitchInSession(targetMode);
                });
            }
            document.addEventListener('click', (event) => {
                const modeWrap = $('mode-switch-wrap');
                if (modeWrap && !modeWrap.classList.contains('hidden') && !modeWrap.contains(event.target)) {
                    closeModeSwitchMenu();
                }
                const fontWrap = $('font-size-wrap');
                if (fontWrap && !fontWrap.classList.contains('hidden') && !fontWrap.contains(event.target)) {
                    closeFontSizePanel();
                }
            });
            const scroller = getMainScroller();
            if (scroller) {
                scroller.addEventListener('scroll', () => {
                    syncCurrentQuestionFromScroll();
                }, { passive: true });
            }
            const onSystemThemeChange = () => syncThemeMode();
            if (darkModeMedia.addEventListener) {
                darkModeMedia.addEventListener('change', onSystemThemeChange);
            } else if (darkModeMedia.addListener) {
                darkModeMedia.addListener(onSystemThemeChange);
            }
            window.addEventListener('resize', () => {
                syncViewportHeight();
                syncDeviceProfileClass();
            });
            window.addEventListener('orientationchange', () => {
                syncViewportHeight();
                syncDeviceProfileClass();
            });
            updateQuestionFontSizePreview();
            updateCompactnessPreview();
            const routeState = readRouteState();
            if (routeState.libraryId) {
                await selectLib(routeState.libraryId, {
                    routeMode: routeState.mode,
                    skipHistorySync: true
                });
            } else {
                await showLibrary({ skipHistorySync: true });
            }
        })();
