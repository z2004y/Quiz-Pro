const form = document.getElementById('login-form');
        const errorText = document.getElementById('error-text');
        const ADMIN_LOGIN_API = document.body?.dataset?.adminLoginApi || '/api/admin/login';
        const darkModeMedia = window.matchMedia('(prefers-color-scheme: dark)');
        const THEME_STORAGE_KEY = 'quiz_theme_preference';

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
            const btn = document.getElementById('theme-toggle');
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
        }

        function toggleThemeMode() {
            const next = document.body.classList.contains('theme-dark') ? 'light' : 'dark';
            setThemePreference(next);
            syncThemeMode();
        }

        async function api(path, options = {}) {
            const response = await fetch(path, {
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                ...options
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data.error || '请求失败');
            }
            return data;
        }

        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            errorText.classList.add('hidden');
            const username = document.getElementById('username').value.trim();
            const password = document.getElementById('password').value;

            try {
                await api(ADMIN_LOGIN_API, {
                    method: 'POST',
                    body: JSON.stringify({ username, password })
                });
                window.location.href = '/admin';
            } catch (error) {
                errorText.textContent = error.message;
                errorText.classList.remove('hidden');
            }
        });

        document.body.dataset.themePreference = getStoredThemePreference();
        syncThemeMode();
        const themeToggle = document.getElementById('theme-toggle');
        if (themeToggle) {
            themeToggle.addEventListener('click', toggleThemeMode);
        }
        const onSystemThemeChange = () => syncThemeMode();
        if (darkModeMedia.addEventListener) {
            darkModeMedia.addEventListener('change', onSystemThemeChange);
        } else if (darkModeMedia.addListener) {
            darkModeMedia.addListener(onSystemThemeChange);
        }
