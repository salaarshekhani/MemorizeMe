window.auth = (function () {
    var storageKey = 'flashcards_current_user';
    var guestDataKey = 'flashcards_guest_data';

    function current() {
        try { return localStorage.getItem(storageKey); } catch (e) { return null; }
    }

    function isLoggedIn() {
        return !!current();
    }

    function defaultGuestData() {
        return {
            flashcards: [
                {
                    id: 1,
                    term: "Photosynthesis",
                    translation: "Photosynthese",
                    definition: "The process plants use to turn sunlight, water and carbon dioxide into energy and oxygen.",
                }
            ],
            settings: { sound_enabled: true, timer_seconds: 10, theme: "light" },
            profile: { name: "", level: 1, xp: 0, best_streak: 0, current_streak: 0 },
            performance: {},
            results: [],
        };
    }
    function getGuestData() {
        try {
            var raw = localStorage.getItem(guestDataKey);
            if (raw) {
                var parsed = JSON.parse(raw);
                var defaults = defaultGuestData();
                return {
                    flashcards: Array.isArray(parsed.flashcards) ? parsed.flashcards : defaults.flashcards,
                    settings: Object.assign({}, defaults.settings, parsed.settings || {}),
                    profile: Object.assign({}, defaults.profile, parsed.profile || {}),
                    performance: parsed.performance && typeof parsed.performance === 'object' ? parsed.performance : {},
                    results: Array.isArray(parsed.results) ? parsed.results : [],
                };
            }
        } catch (e) {}
        return defaultGuestData();
    }

    function setGuestData(data) {
        try { localStorage.setItem(guestDataKey, JSON.stringify(data)); } catch (e) {}
    }

    function updateHeaderUI(username, profile) {
        var accountLink = document.getElementById('account-link');
        var xpBadge = document.getElementById('nav-xp-badge');

        if (accountLink) {
            accountLink.textContent = username ? username : 'Login';
            accountLink.href = 'account.html';
            accountLink.setAttribute('aria-label', 'Account');
        }

        if (xpBadge) {
            var level = profile && typeof profile.level !== 'undefined' ? Number(profile.level) : 1;
            var xp = profile && typeof profile.xp !== 'undefined' ? Number(profile.xp) : 0;
            if (!Number.isFinite(level) || level < 1) level = 1;
            if (!Number.isFinite(xp)) xp = 0;
            xpBadge.textContent = 'Level ' + level + ' • ' + xp + ' XP';
        }
    }

    async function refreshHeader() {
        var username = current();
        var profile = null;
        if (username) {
            try {
                var res = await fetch('/api/profile');
                if (res.ok) profile = await res.json();
            } catch (e) {}
        } else {
            profile = getGuestData().profile;
        }
        updateHeaderUI(username, profile);
    }

    async function register(username, password) {
        var res = await fetch('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: username, password: password })
        });
        var data = await res.json();
        if (res.ok) {
            try { localStorage.setItem(storageKey, data.username); } catch (e) {}
            await refreshHeader();
            return { ok: true };
        }
        return { ok: false, msg: data.error };
    }

    async function login(username, password) {
        var res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: username, password: password })
        });
        var data = await res.json();
        if (res.ok) {
            try { localStorage.setItem(storageKey, data.username); } catch (e) {}
            await refreshHeader();
            return { ok: true };
        }
        return { ok: false, msg: data.error };
    }

    function logout() {
        try { localStorage.removeItem(storageKey); } catch (e) {}
        fetch('/api/auth/logout', { method: 'POST' }).catch(function () {});
        refreshHeader().catch(function () {});
    }

    return {
        current: current,
        isLoggedIn: isLoggedIn,
        register: register,
        login: login,
        logout: logout,
        refreshHeader: refreshHeader,
        getGuestData: getGuestData,
        setGuestData: setGuestData,
    };
})();
