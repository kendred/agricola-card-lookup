(function () {
    'use strict';

    const STORAGE_KEY = 'agricola-theme';
    const CLASSIC_THEME = 'classic';
    const ALTERNATE_THEME = 'alternate';

    function normalizeTheme(value) {
        return value === ALTERNATE_THEME ? ALTERNATE_THEME : CLASSIC_THEME;
    }

    function readStoredTheme() {
        try {
            return normalizeTheme(localStorage.getItem(STORAGE_KEY));
        } catch (error) {
            return CLASSIC_THEME;
        }
    }

    function getTheme() {
        return normalizeTheme(document.documentElement.dataset.theme);
    }

    function syncThemeMetadata(theme = getTheme()) {
        const title = document.querySelector('title[data-classic-title][data-alternate-title]');
        if (title) {
            document.title = theme === ALTERNATE_THEME
                ? title.dataset.alternateTitle
                : title.dataset.classicTitle;
        }

        const favicon = document.querySelector('link[rel="icon"][data-alternate-href]');
        if (favicon) {
            const href = theme === ALTERNATE_THEME
                ? favicon.dataset.alternateHref
                : favicon.dataset.classicHref;

            if (href) favicon.href = href;

            if (theme === ALTERNATE_THEME) {
                favicon.type = 'image/svg+xml';
            } else {
                favicon.removeAttribute('type');
            }
        }
    }

    function setTheme(theme, persist = true) {
        const nextTheme = normalizeTheme(theme);
        document.documentElement.dataset.theme = nextTheme;
        syncThemeMetadata(nextTheme);

        if (persist) {
            try {
                localStorage.setItem(STORAGE_KEY, nextTheme);
            } catch (error) {
                // The theme can still apply for this page when storage is unavailable.
            }
        }

        document.dispatchEvent(new CustomEvent('agricola:themechange', {
            detail: { theme: nextTheme },
        }));

        return nextTheme;
    }

    function toggleTheme() {
        return setTheme(getTheme() === ALTERNATE_THEME ? CLASSIC_THEME : ALTERNATE_THEME);
    }

    // Apply the stored preference before stylesheets finish loading to avoid a flash.
    setTheme(readStoredTheme(), false);

    document.addEventListener('click', (event) => {
        const toggle = event.target.closest('[data-theme-toggle]');
        if (!toggle) return;
        toggleTheme();
    });

    window.addEventListener('storage', (event) => {
        if (event.key === STORAGE_KEY) {
            setTheme(event.newValue, false);
        }
    });

    window.AgricolaTheme = Object.freeze({
        getTheme,
        setTheme,
        toggleTheme,
        refresh: syncThemeMetadata,
    });
})();
