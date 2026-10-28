import { statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * HanX — Cosmic editorial.
 * File leggibile, senza immagini Base64 né dipendenze frontend.
 * Asset previsto: public/icon.png alla radice del repository.
 * URL pubblico previsto: /public/icon.png.
 */
export const HANX_ICON_URL = '/public/icon.png';

// Data di compilazione di questo file: dice subito se l'istanza sta servendo
// una build vecchia (il footer mostra il valore).
const BUILD_STAMP = (() => {
    try {
        const date = statSync(fileURLToPath(import.meta.url)).mtime;
        const pad = (n: number) => String(n).padStart(2, '0');
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
            + ` ${pad(date.getHours())}:${pad(date.getMinutes())}`;
    } catch {
        return 'unknown';
    }
})();

// ==================== STILI ====================
const STYLESHEET = String.raw`
:root {
    color-scheme: dark;
    --text: #eef3ff;
    --muted: #a5b2c9;
    --cyan: #71dbf5;
    --coral: #f47888;
    --line: #a5bee329;
}

* {
    box-sizing: border-box;
}

body {
    margin: 0;
    background: #070c19;
    color: var(--text);
    font-family: Arial, Helvetica, sans-serif;
    line-height: 1.45;
    isolation: isolate;
}

body::before {
    content: '';
    position: fixed;
    inset: 0;
    z-index: -2;
    pointer-events: none;
    background: radial-gradient(ellipse at 85% 5%, #39458770, transparent 48%), radial-gradient(ellipse at 0% 50%, #6d264753, transparent 44%), radial-gradient(ellipse at 90% 90%, #174e6545, transparent 42%);
}

body::after {
    content: '';
    position: fixed;
    inset: 0;
    z-index: -1;
    pointer-events: none;
    opacity: 0.7;
    background-image: radial-gradient(circle at 18px 29px, #ffffffb0 0.7px, transparent 1.1px), radial-gradient(circle at 87px 61px, #b6d7ff99 0.5px, transparent 1px), radial-gradient(circle at 47px 109px, #ffffff80 0.6px, transparent 1px);
    background-size: 173px 191px, 257px 229px, 311px 277px;
}

button, input, textarea, select {
    font: inherit;
}

button {
    cursor: pointer;
}

button:disabled {
    cursor: wait;
    opacity: 0.65;
}

button:focus-visible, input:focus-visible, textarea:focus-visible, select:focus-visible, a:focus-visible {
    outline: 3px solid var(--cyan);
    outline-offset: 4px;
}

header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 18px 5vw;
    border-bottom: 1px solid #ffffff32;
}

.head-logo {
    width: 140px;
    height: 64px;
    object-fit: contain;
    filter: drop-shadow(0 0 13px #14a2dd44);
}

.stamp {
    font: 10px/1.6 monospace;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: #b8c2d5;
}

.badge {
    font: 10px monospace;
    background: #ffffff0b;
    border: 1px solid #ffffff35;
    padding: 9px 13px;
}

.wrap {
    max-width: 1420px;
    padding: 0 5vw;
    margin: auto;
}

.hero {
    position: relative;
    display: grid;
    grid-template-columns: 1.15fr 1fr;
    border-bottom: 1px solid #ffffff45;
    min-height: 415px;
    align-items: center;
    gap: 25px;
}

.hero-copy {
    padding: 45px 0;
}

.kicker {
    font: 11px monospace;
    letter-spacing: 1.2px;
    text-transform: uppercase;
    color: #a0dff1;
}

.kicker::before {
    content: '✦';
    color: var(--coral);
    margin-right: 10px;
}

.hero h1 {
    font-size: clamp(52px, 6.9vw, 95px);
    letter-spacing: -5px;
    font-weight: 900;
    line-height: 0.95;
    margin: 26px 0;
}

.hero h1 em {
    font-style: normal;
    color: #fb929b;
}

.hero p {
    font-size: 14px;
    color: #b7bfce;
    max-width: 390px;
}

.hero-art {
    position: relative;
    display: grid;
    place-items: center;
    min-height: 335px;
}

.hero-art::before {
    content: '';
    width: 290px;
    height: 290px;
    border: 1px solid #a8c3e246;
    border-radius: 50%;
    position: absolute;
    transform: rotate(-24deg) scaleX(1.3);
}

.hero-art::after {
    content: '';
    width: 300px;
    height: 300px;
    border: 1px solid #f4788845;
    border-radius: 50%;
    position: absolute;
    transform: rotate(25deg) scaleX(1.3);
    z-index: -1;
}

.hero-logo {
    width: 100%;
    max-width: 540px;
    position: relative;
    filter: drop-shadow(0 15px 30px #020414) drop-shadow(0 0 24px #00bce733);
    z-index: 1;
}

.orbit-label {
    position: absolute;
    bottom: 5px;
    right: 0;
    font: 10px monospace;
    color: #b4c5dd;
    letter-spacing: 2px;
}

.strip {
    display: flex;
    justify-content: space-between;
    padding: 16px 0;
    border-bottom: 1px solid #ffffff35;
    gap: 15px;
    font: 10px monospace;
    letter-spacing: 0.5px;
    text-transform: uppercase;
}

.strip .fade {
    color: #98a4b9;
}

.studio {
    display: grid;
    grid-template-columns: 210px minmax(0, 1fr);
    gap: 45px;
    margin: 36px 0 45px;
}

.rail {
    align-self: start;
    position: sticky;
    top: 20px;
}

.rail h2 {
    font-size: 24px;
    letter-spacing: -1px;
    margin: 0 0 22px;
}

.tab {
    display: block;
    width: 100%;
    text-align: left;
    background: none;
    color: #aeb6c8;
    border: 0;
    border-top: 1px solid #ffffff25;
    padding: 18px 0;
    font-size: 13px;
}

.tab.active {
    color: var(--cyan);
    font-weight: 700;
}

.tab span {
    font: 10px monospace;
    margin-right: 14px;
}

.rail-note {
    font: 10px/1.8 monospace;
    color: #9ba5b9;
    margin-top: 25px;
}

.editorial {
    background: linear-gradient(145deg, #17233bee, #0d1426ef 65%, #22192eee);
    color: var(--text);
    padding: 32px;
    border: 1px solid #87b7e73d;
    box-shadow: 12px 12px 0 #00000025, 0 18px 70px #02061135;
    position: relative;
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
}

.editorial::before {
    content: '';
    width: 58px;
    height: 3px;
    position: absolute;
    top: 0;
    left: 32px;
    background: linear-gradient(90deg, var(--cyan), #e59fdb);
}

.pane {
    display: none;
}

.pane.active {
    display: block;
}

.pane-head {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    align-items: start;
}

.pane-head h2 {
    font-size: 34px;
    letter-spacing: -1.3px;
    margin: 0;
}

.pane-head p {
    font-size: 13px;
    color: var(--muted);
    margin: 8px 0 24px;
}

.meta {
    font: 9px monospace;
    text-transform: uppercase;
    color: var(--muted);
    padding-top: 7px;
    white-space: nowrap;
}

.sources {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 12px;
}

.source {
    position: relative;
    border: 1px solid var(--line);
    padding: 21px 15px;
    background: #0c1427ab;
    min-height: 203px;
    transition: border-color 0.2s, background 0.2s;
}

.source.selected {
    background: linear-gradient(150deg, #23436380, #15213bd9);
    border-color: #83c7ef7a;
}

.source input {
    position: absolute;
    right: 13px;
    top: 14px;
    width: 18px;
    height: 18px;
    accent-color: #47aeca;
}

.source .initial {
    font-size: 48px;
    font-weight: 900;
    letter-spacing: -3px;
    display: block;
    margin: 20px 0 13px;
}

.source:nth-child(1) .initial {
    color: #ffa4b7;
}

.source:nth-child(2) .initial {
    color: #97b2ff;
}

.source:nth-child(3) .initial {
    color: #87dccd;
}

.source strong {
    font-size: 13px;
    display: block;
}

.source small {
    display: block;
    font: 9px monospace;
    color: var(--muted);
    margin-top: 8px;
}

.hint {
    font-size: 11px;
    color: var(--muted);
    line-height: 1.65;
}

.actions {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 15px;
    margin-top: 28px;
    padding-top: 22px;
    border-top: 1px solid var(--line);
}

.btn {
    border: 1px solid #9ebae454;
    background: #101b30;
    color: var(--text);
    padding: 13px 19px;
    font-size: 12px;
    font-weight: 700;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 18px;
    text-decoration: none;
}

.btn.blue {
    background: linear-gradient(110deg, #3855c7, #4765cb);
    color: #fff;
    border-color: #8eaefa70;
}

.btn.coral {
    background: linear-gradient(110deg, #965078, #784894);
    border-color: #e2a7d174;
    color: white;
}

.btn:hover {
    filter: brightness(1.15);
}

.modes {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
}

.mode {
    background: #0c1427ab;
    border: 1px solid var(--line);
    padding: 22px;
    text-align: left;
    color: var(--text);
}

.mode.active {
    background: linear-gradient(145deg, #23436390, #16243dd9);
    border-color: #83c7ef7a;
}

.mode .letter {
    font: 10px monospace;
    color: var(--cyan);
}

.mode h3 {
    font-size: 25px;
    letter-spacing: -1px;
    margin: 10px 0;
}

.mode p {
    font-size: 12px;
    color: var(--muted);
    margin: 0;
}

.field {
    display: block;
    font: 10px monospace;
    margin: 17px 0;
    color: #c4d0e5;
}

.field input, .field select {
    display: block;
    width: 100%;
    margin-top: 8px;
    padding: 13px;
    border: 1px solid #7898c33d;
    background: #091225;
    color: var(--text);
    font: 13px Arial;
    border-radius: 0;
}

input::placeholder {
    color: #8e9ab0;
}

.fields {
    padding-top: 8px;
}

.pair {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 15px;
}

.password-wrap {
    position: relative;
}

.password-wrap input {
    padding-right: 78px;
}

.password-wrap button {
    position: absolute;
    right: 8px;
    top: 8px;
    border: 0;
    background: none;
    color: var(--cyan);
    font: 10px monospace;
    padding: 7px;
}

details {
    font-size: 12px;
    margin-top: 24px;
    padding-top: 17px;
    border-top: 1px solid var(--line);
}

summary {
    cursor: pointer;
    color: #c8d7ee;
}

details label {
    display: block;
    margin: 14px 0;
}

details input[type=checkbox] {
    accent-color: #47aeca;
}

.pass {
    border: 1px solid #87b7e74d;
    padding: 23px;
    background: linear-gradient(145deg, #16233bf0, #0a1427ee);
}

.pass-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid #9ebae44d;
    padding-bottom: 17px;
}

.pass-header strong {
    font-size: 21px;
    letter-spacing: -1px;
}

.pass-header span {
    font: 9px monospace;
    color: var(--cyan);
}

.pass-row {
    display: flex;
    justify-content: space-between;
    gap: 20px;
    padding: 13px 0;
    border-bottom: 1px dashed var(--line);
    font-size: 12px;
}

.pass-row span {
    color: var(--muted);
}

.pass-row strong {
    text-align: right;
    overflow-wrap: anywhere;
}

.url-label {
    font: 10px monospace;
    display: block;
    margin-top: 19px;
    color: #c4d0e5;
}

.url-label textarea {
    display: block;
    margin-top: 8px;
    resize: none;
    width: 100%;
    height: 106px;
    background: #081123;
    border: 1px solid #87b7e73d;
    padding: 12px;
    color: #aee4f6;
    font: 10px/1.7 monospace;
}

.copy-row {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
    margin-top: 16px;
}

.feedback {
    font: 11px/1.6 monospace;
    min-height: 20px;
    margin: 18px 0 0;
    color: #8be7d7;
    overflow-wrap: anywhere;
}

.feedback.error {
    color: #ffabba;
}

footer {
    display: flex;
    justify-content: space-between;
    gap: 15px;
    border-top: 1px solid #ffffff35;
    padding: 22px 0 30px;
    font: 10px monospace;
    color: #9aa5b8;
    text-transform: uppercase;
}

[hidden] {
    display: none !important;
}

@media (max-width: 900px) {
    .studio {
        grid-template-columns: 155px 1fr;
        gap: 25px;
    }
    .hero {
        gap: 10px;
    }
    .hero h1 {
        letter-spacing: -3.5px;
    }
    .hero-art::before, .hero-art::after {
        width: 215px;
        height: 215px;
    }
    .editorial {
        padding: 24px;
    }
    .source {
        padding: 17px 11px;
    }
    .source .initial {
        font-size: 39px;
    }
    .pane-head h2 {
        font-size: 29px;
    }
    .meta {
        display: none;
    }
}

@media (max-width: 650px) {
    header {
        padding: 13px 5vw;
    }
    .head-logo {
        width: 105px;
        height: 48px;
    }
    .stamp {
        display: none;
    }
    .hero {
        grid-template-columns: 1fr;
        gap: 0;
    }
    .hero-copy {
        padding: 33px 0 10px;
    }
    .hero h1 {
        font-size: 61px;
        letter-spacing: -3px;
    }
    .hero-art {
        min-height: 220px;
        max-width: 400px;
        width: 100%;
        margin: auto;
    }
    .hero-logo {
        max-width: 355px;
    }
    .hero-art::before, .hero-art::after {
        height: 190px;
        width: 190px;
    }
    .orbit-label {
        font-size: 8px;
    }
    .strip {
        font-size: 9px;
    }
    .strip .fade {
        display: none;
    }
    .studio {
        display: block;
        margin-top: 22px;
    }
    .rail {
        position: static;
    }
    .rail h2, .rail-note {
        display: none;
    }
    .rail nav {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        margin-bottom: 15px;
    }
    .tab {
        font-size: 11px;
        padding: 12px 0;
    }
    .tab span {
        margin-right: 6px;
    }
    .editorial {
        padding: 20px;
        box-shadow: 6px 6px 0 #0000002b;
    }
    .sources {
        gap: 7px;
    }
    .source {
        padding: 16px 8px;
        min-height: 180px;
    }
    .source strong {
        font-size: 10px;
    }
    .source small {
        font-size: 8px;
    }
    .pair {
        grid-template-columns: 1fr;
    }
    .mode {
        padding: 17px;
    }
    .actions {
        gap: 8px;
    }
    .btn {
        padding: 12px 13px;
        font-size: 11px;
    }
    .pass {
        padding: 15px;
    }
    .pass-header {
        gap: 12px;
        flex-wrap: wrap;
    }
    footer {
        flex-direction: column;
    }
    .meta {
        white-space: normal;
    }
}

@media (prefers-reduced-motion: reduce) {
    * {
        transition: none !important;
    }
}
`;

// ==================== JAVASCRIPT DEL BROWSER ====================
const CLIENT_SCRIPT = String.raw`
(function () {
    'use strict';

    var getElement = function (id) {
        return document.getElementById(id);
    };
    var pageData = window.__HANX_PAGE_DATA__ || { defaults: {} };
    var defaults = pageData.defaults || {};
    var configuredBaseUrl = pageData.publicBaseUrl || '';
    var mode = 'direct';
    var manifestUrl = '';
    var providers = [
        ['animeunityEnabled', 'AnimeUnity'],
        ['animesaturnEnabled', 'AnimeSaturn'],
        ['animeworldEnabled', 'AnimeWorld']
    ];

    function toBoolean(value, fallback) {
        if (value === undefined || value === null) {
            return fallback;
        }
        if (typeof value === 'boolean') {
            return value;
        }
        return ['true', '1', 'on', 'yes', 'checked'].indexOf(
            String(value).toLowerCase()
        ) !== -1;
    }

    function showMessage(text, isError) {
        var feedback = getElement('feedback');
        feedback.textContent = text;
        feedback.classList.toggle('error', !!isError);
    }

    // Base64url: nel path non resta nessun '%'. Stremio decodifica il path dei
    // link stremio:// prima della richiesta, e un JSON percent-encoded diventa
    // JSON grezzo (le '/' di easyProxyUrl spezzano il percorso) -> 404.
    function toBase64Url(text) {
        var bytes = new TextEncoder().encode(text);
        var binary = '';
        for (var i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }

    function buildConfig() {
        var config = {};

        providers.forEach(function (provider) {
            config[provider[0]] = getElement(provider[0]).checked;
        });
        ['animeunityDirect', 'animeunityProxy'].forEach(function (key) {
            config[key] = key === 'animeunityDirect' ? mode === 'direct' : mode === 'proxy';
        });
        // Direct esplicito: vale per tutti i provider e ignora EasyProxy anche
        // quando il server lo espone via env.
        config.directPlayback = mode === 'direct';

        ['tmdbApiKey', 'tvdbApiKey', 'tvdbPin'].forEach(function (key) {
            var value = getElement(key).value.trim();
            if (value) {
                config[key] = value;
            }
        });

        if (mode === 'proxy') {
            config.easyProxyUrl = getElement('easyProxyUrl')
                .value.trim().replace(/\/+$/, '');
            config.easyProxyPassword = getElement('easyProxyPassword').value;
        }

        return config;
    }

    function updatePage() {
        var active = providers.filter(function (provider) {
            return getElement(provider[0]).checked;
        });

        getElement('providerCount').textContent = active.length + ' sorgenti selezionate';
        getElement('sourcesSummary').textContent = active.map(function (provider) {
            return provider[1];
        }).join(' / ') || 'Nessuna';

        var configuredKeys = [];
        if (getElement('tmdbApiKey').value.trim()) configuredKeys.push('TMDB');
        if (getElement('tvdbApiKey').value.trim()) configuredKeys.push('TVDB');
        if (getElement('tvdbPin').value.trim()) configuredKeys.push('TVDB PIN');
        getElement('keysSummary').textContent = configuredKeys.length
            ? configuredKeys.join(' + ')
            : 'Fallback server';

        getElement('modeSummary').textContent = mode === 'direct'
            ? 'Direct'
            : 'EasyProxy';
        getElement('proxyFields').hidden = mode !== 'proxy';

        document.querySelectorAll('.source').forEach(function (card) {
            card.classList.toggle('selected', card.querySelector('input').checked);
        });
        document.querySelectorAll('[data-mode]').forEach(function (button) {
            var selected = button.getAttribute('data-mode') === mode;
            button.classList.toggle('active', selected);
            button.setAttribute('aria-pressed', String(selected));
        });

        var basePath = window.location.pathname
            .replace(/\/(?:configure|index\.html)\/?$/, '')
            .replace(/\/+$/, '');
        var encodedConfig = toBase64Url(JSON.stringify(buildConfig()));
        var baseOrigin = (configuredBaseUrl || window.location.origin).replace(/\/+$/, '');

        manifestUrl = baseOrigin + basePath + '/'
            + encodedConfig + '/manifest.json';

        getElement('manifestUrl').value = manifestUrl;
        getElement('serverSummary').textContent = baseOrigin.replace(/^https?:\/\//, '') + basePath;
        getElement('installLink').href = 'stremio://'
            + manifestUrl.replace(/^https?:\/\//, '');
        // La porta nei link stremio:// la conserva Stremio 4, la scarta Stremio 5
        // (ricostruisce l'URL dal solo hostname). Il pulsante diretto resta
        // sempre: con un porto custom il web link fa da alternativa.
        var parsedManifest = null;
        try {
            parsedManifest = new URL(manifestUrl);
        } catch (e) {
            parsedManifest = null;
        }
        var customPort = parsedManifest && parsedManifest.port
            && parsedManifest.port !== '443' && parsedManifest.port !== '80';
        var installWebLink = getElement('installWebLink');
        getElement('installLink').hidden = false;
        installWebLink.hidden = !customPort;
        if (customPort) {
            installWebLink.href = 'https://web.stremio.com/#/addons?addon='
                + encodeURIComponent(manifestUrl);
            var hint = getElement('installHint');
            if (hint) {
                hint.textContent = 'Questa istanza risponde sulla porta ' + parsedManifest.port
                    + ': alcune versioni di Stremio scartano la porta nei link diretti. '
                    + 'Se «Installa in Stremio» non parte, usa «Installa da Stremio Web» '
                    + 'oppure incolla il link in Stremio → Addons → Add addon. '
                    + 'Il link contiene le chiavi API e la password proxy: non condividerlo.';
            }
        }
    }

    function validateConfig() {
        if (!providers.some(function (provider) {
            return getElement(provider[0]).checked;
        })) {
            showMessage('Seleziona almeno una sorgente.', true);
            return false;
        }

        if (mode === 'proxy') {
            try {
                var proxy = new URL(getElement('easyProxyUrl').value.trim());
                if (!/^https?:$/.test(proxy.protocol) || proxy.username || proxy.password) {
                    throw new Error('Invalid proxy URL');
                }
            } catch (_) {
                showMessage('Inserisci un URL EasyProxy valido, completo di http:// o https://.', true);
                getElement('easyProxyUrl').focus();
                return false;
            }
        }

        return true;
    }

    function changeStep(number) {
        updatePage();

        if (number === 2 && !providers.some(function (provider) {
            return getElement(provider[0]).checked;
        })) {
            showMessage('Seleziona almeno una sorgente.', true);
            return;
        }
        if (number === 4 && !validateConfig()) {
            return;
        }

        document.querySelectorAll('[data-pane]').forEach(function (pane) {
            pane.classList.toggle('active', pane.getAttribute('data-pane') === String(number));
        });
        document.querySelectorAll('[data-step]').forEach(function (button) {
            var selected = button.getAttribute('data-step') === String(number);
            button.classList.toggle('active', selected);
            if (selected) {
                button.setAttribute('aria-current', 'step');
            } else {
                button.removeAttribute('aria-current');
            }
        });

        showMessage('');
        var heading = document.querySelector('.pane.active h2');
        if (heading) {
            heading.setAttribute('tabindex', '-1');
            heading.focus({ preventScroll: true });
        }
    }

    function applyDefaults() {
        providers.forEach(function (provider) {
            getElement(provider[0]).checked = toBoolean(defaults[provider[0]], true);
        });
        ['tmdbApiKey', 'tvdbApiKey', 'tvdbPin', 'easyProxyUrl', 'easyProxyPassword'].forEach(function (key) {
            getElement(key).value = typeof defaults[key] === 'string' ? defaults[key] : '';
        });

        if (getElement('easyProxyUrl').value.trim()) {
            mode = 'proxy';
        }
    }

    document.querySelectorAll('[data-next], [data-step]').forEach(function (button) {
        button.addEventListener('click', function () {
            changeStep(Number(button.getAttribute('data-next') || button.getAttribute('data-step')));
        });
    });
    document.querySelectorAll('[data-mode]').forEach(function (button) {
        button.addEventListener('click', function () {
            mode = button.getAttribute('data-mode');
            updatePage();
            showMessage('');
        });
    });
    document.querySelectorAll('input, select').forEach(function (input) {
        input.addEventListener('input', updatePage);
        input.addEventListener('change', updatePage);
    });

    getElement('revealPassword').addEventListener('click', function () {
        var input = getElement('easyProxyPassword');
        var visible = input.type === 'password';
        input.type = visible ? 'text' : 'password';
        this.textContent = visible ? 'Nascondi' : 'Mostra';
        this.setAttribute('aria-label', visible ? 'Nascondi password' : 'Mostra password');
    });

    document.querySelectorAll('.reveal-key').forEach(function (button) {
        button.addEventListener('click', function () {
            var input = getElement(button.getAttribute('data-target'));
            var visible = input.type === 'password';
            input.type = visible ? 'text' : 'password';
            button.textContent = visible ? 'Nascondi' : 'Mostra';
            button.setAttribute('aria-label', visible ? 'Nascondi chiave' : 'Mostra chiave');
        });
    });

    getElement('copyManifestBtn').addEventListener('click', async function () {
        updatePage();
        if (!validateConfig()) {
            return;
        }

        try {
            if (!navigator.clipboard || !navigator.clipboard.writeText) {
                throw new Error('Clipboard unavailable');
            }
            await navigator.clipboard.writeText(manifestUrl);
            showMessage('URL configurato copiato. Incollalo in Stremio.');
        } catch (_) {
            var input = getElement('manifestUrl');
            input.focus();
            input.select();
            var copied = false;
            try {
                copied = document.execCommand('copy');
            } catch (_) {}
            showMessage(copied ? 'URL configurato copiato.' : 'Copia manualmente il testo selezionato.', !copied);
        }
    });

    getElement('installLink').addEventListener('click', function (event) {
        updatePage();
        if (!validateConfig()) {
            event.preventDefault();
        }
    });

    getElement('checkManifestBtn').addEventListener('click', async function () {
        updatePage();
        if (!validateConfig()) {
            return;
        }

        var urlToCheck = manifestUrl;
        var controller = new AbortController();
        var timer = setTimeout(function () { controller.abort(); }, 15000);
        var button = this;
        button.disabled = true;
        showMessage('Verifica del manifest in corso…');

        try {
            var response = await fetch(urlToCheck, {
                cache: 'no-store',
                signal: controller.signal
            });
            if (!response.ok) {
                throw new Error('HTTP ' + response.status);
            }

            var manifest = await response.json();
            if (!manifest || typeof manifest.id !== 'string'
                || typeof manifest.name !== 'string'
                || typeof manifest.version !== 'string'
                || !Array.isArray(manifest.types)
                || !Array.isArray(manifest.resources)
                || !Array.isArray(manifest.catalogs)) {
                throw new Error('Risposta priva dei campi principali del manifest.');
            }

            showMessage('Manifest raggiungibile: ' + manifest.name + ' — '
                + manifest.version + '. Verifica il playback in Stremio.');
        } catch (error) {
            showMessage('Verifica fallita: '
                + (error.name === 'AbortError' ? 'timeout' : error.message), true);
        } finally {
            clearTimeout(timer);
            button.disabled = false;
        }
    });

    applyDefaults();
    updatePage();
})();
`;

// ==================== TEMPLATE SERVER ====================

function escapeHtml(value: unknown): string {
    const entities: Record<string, string> = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    };

    return String(value ?? '').replace(/[&<>"']/g, character => entities[character]);
}

function serializeForScript(value: unknown): string {
    return JSON.stringify(value)
        .replace(/</g, '\\u003c')
        .replace(/>/g, '\\u003e')
        .replace(/&/g, '\\u0026')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');
}

// Env variables that have a matching manifest config field. Only these are prefilled.
const ENV_CONFIG_DEFAULTS: Record<string, string> = {
    EASYPROXY_URL: 'easyProxyUrl',
    EASYPROXY_PASSWORD: 'easyProxyPassword',
    TMDB_API_KEY: 'tmdbApiKey',
    TVDB_API_KEY: 'tvdbApiKey',
    TVDB_PIN: 'tvdbPin',
};

export function landingTemplate(
    manifest: any,
    env: Record<string, string | undefined> = process.env,
    publicBaseUrl = ''
): string {
    const defaults: Record<string, unknown> = {};
    const fields = Array.isArray(manifest.config) ? manifest.config : [];
    const configKeys = new Set<string>();

    fields.forEach((field: any) => {
        if (typeof field.key !== 'string') return;
        configKeys.add(field.key);
        if (field.default !== undefined) {
            defaults[field.key] = field.default;
        }
    });

    for (const [envKey, configKey] of Object.entries(ENV_CONFIG_DEFAULTS)) {
        if (!configKeys.has(configKey)) continue;
        const value = env[envKey];
        if (!value) continue;
        const normalized = envKey === 'EASYPROXY_PASSWORD' ? value : value.trim();
        if (!normalized) continue;
        defaults[configKey] = normalized;
    }

    const normalizedBaseUrl = String(publicBaseUrl || '').trim().replace(/\/+$/, '');
    const pageData = serializeForScript({ defaults, publicBaseUrl: normalizedBaseUrl });
    const iconUrl = escapeHtml(HANX_ICON_URL);

    return `<!DOCTYPE html>
<html lang="it">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${escapeHtml(manifest.name || 'HanX')} — Configurazione</title>
        <link rel="icon" type="image/png" href="${iconUrl}">
        <style>
${STYLESHEET}
        </style>
    </head>
    <body>
        <header>
            <img class="head-logo" src="${iconUrl}" alt="HanX">
            <div class="stamp">
                Anime configuration studio<br>
                The cosmic edition
            </div>
            <span class="badge">${escapeHtml(manifest.version || '')}</span>
        </header>

        <div class="wrap">
            <section class="hero">
                <div class="hero-copy">
                    <div class="kicker">Un addon. Infiniti nuovi mondi.</div>
                    <h1>YOUR NEXT<br><em>UNIVERSE.</em></h1>
                    <p>
                        Scegli le tue sorgenti anime, collega le chiavi ufficiali TMDB e TVDB
                        e porta HanX su Stremio. Mapping split-cour, aired order e film:
                        il prossimo arco narrativo comincia qui.
                    </p>
                </div>
                <div class="hero-art">
                    <img class="hero-logo" src="${iconUrl}" alt="Logo HanX">
                    <span class="orbit-label">WATCH / DISCOVER / REPEAT</span>
                </div>
            </section>

            <div class="strip">
                <span>AnimeUnity + AnimeSaturn + AnimeWorld</span>
                <span class="fade">Mapping ufficiale TMDB · TVDB · Kitsu</span>
                <span>Solo anime</span>
            </div>

            <div class="studio">
                <aside class="rail">
                    <h2>Fallo tuo.</h2>
                    <nav aria-label="Passaggi configurazione">
                        <button class="tab active" type="button" data-step="1" aria-current="step">
                            <span>01 /</span>Le sorgenti
                        </button>
                        <button class="tab" type="button" data-step="2">
                            <span>02 /</span>Chiavi API
                        </button>
                        <button class="tab" type="button" data-step="3">
                            <span>03 /</span>La connessione
                        </button>
                        <button class="tab" type="button" data-step="4">
                            <span>04 /</span>Il tuo link
                        </button>
                    </nav>
                    <p class="rail-note">
                        ESPLORA NUOVI MONDI.<br>
                        TIENI IL CONTROLLO.<br>
                        La configurazione rimane nel tuo link personale.
                    </p>
                </aside>

                <main class="editorial">
                    <!-- 01: Provider -->
                    <section class="pane active" data-pane="1">
                        <div class="pane-head">
                            <div>
                                <h2>Scegli il tuo trio.</h2>
                                <p>Una, due o tutte e tre. Sei tu a decidere.</p>
                            </div>
                            <span class="meta">01 — Sources</span>
                        </div>

                        <div class="sources">
                            <label class="source selected">
                                <input id="animeunityEnabled" type="checkbox" checked aria-label="Abilita AnimeUnity">
                                <span class="initial">AU.</span>
                                <strong>AnimeUnity</strong>
                                <small>DIRECT / PROXY</small>
                            </label>
                            <label class="source selected">
                                <input id="animesaturnEnabled" type="checkbox" checked aria-label="Abilita AnimeSaturn">
                                <span class="initial">AS.</span>
                                <strong>AnimeSaturn</strong>
                                <small>ANIME PROVIDER</small>
                            </label>
                            <label class="source selected">
                                <input id="animeworldEnabled" type="checkbox" checked aria-label="Abilita AnimeWorld">
                                <span class="initial">AW.</span>
                                <strong>AnimeWorld</strong>
                                <small>ANIME PROVIDER</small>
                            </label>
                        </div>

                        <p class="hint">
                            Disponibilità, qualità e alternative di riproduzione dipendono dai provider.
                            Il mapping usa TMDB, TVDB e Kitsu: nessun dataset di terze parti.
                        </p>
                        <div class="actions">
                            <span class="meta" id="providerCount">3 sorgenti selezionate</span>
                            <button class="btn blue" type="button" data-next="2">
                                Configura le chiavi API ↗
                            </button>
                        </div>
                    </section>

                    <!-- 02: Chiavi API -->
                    <section class="pane" data-pane="2">
                        <div class="pane-head">
                            <div>
                                <h2>Le chiavi del multiverso.</h2>
                                <p>TMDB e TVDB per il mapping ufficiale. Kitsu è pubblico e non richiede chiavi.</p>
                            </div>
                            <span class="meta">02 — API keys</span>
                        </div>

                        <div class="fields">
                            <div class="pair">
                                <label class="field">
                                    TMDB API KEY · FACOLTATIVA
                                    <div class="password-wrap">
                                        <input id="tmdbApiKey" type="password" autocomplete="off" placeholder="Usa il fallback server se vuota">
                                        <button class="reveal-key" data-target="tmdbApiKey" type="button" aria-label="Mostra TMDB API Key">
                                            Mostra
                                        </button>
                                    </div>
                                </label>
                                <label class="field">
                                    TVDB API KEY · FACOLTATIVA
                                    <div class="password-wrap">
                                        <input id="tvdbApiKey" type="password" autocomplete="off" placeholder="Usa il fallback server se vuota">
                                        <button class="reveal-key" data-target="tvdbApiKey" type="button" aria-label="Mostra TVDB API Key">
                                            Mostra
                                        </button>
                                    </div>
                                </label>
                            </div>
                            <label class="field">
                                TVDB PIN · SOLO SE RICHIESTO
                                <div class="password-wrap">
                                    <input id="tvdbPin" type="password" autocomplete="off" placeholder="PIN del progetto TVDB, se abilitato">
                                    <button class="reveal-key" data-target="tvdbPin" type="button" aria-label="Mostra TVDB PIN">
                                        Mostra
                                    </button>
                                </div>
                            </label>

                            <p class="hint">
                                TMDB risolve IMDb/TMDB e i film; TVDB fornisce le stagioni in aired order.
                                Se un campo resta vuoto, HanX usa la chiave del server quando disponibile.
                            </p>
                            <p class="hint">
                                Le chiavi restano nel tuo link personale. Non vengono salvate sul server.
                                In self-host vengono lette dal tuo .env e restano sulla tua istanza;
                                se esponi la pagina su Internet, proteggila con autenticazione.
                            </p>
                        </div>

                        <div class="actions">
                            <button class="btn" type="button" data-next="1">← Sorgenti</button>
                            <button class="btn blue" type="button" data-next="3">La connessione ↗</button>
                        </div>
                    </section>

                    <!-- 03: Connessione -->
                    <section class="pane" data-pane="3">
                        <div class="pane-head">
                            <div>
                                <h2>Trova la tua strada.</h2>
                                <p>Direct oppure il tuo proxy. Senza perdere il filo.</p>
                            </div>
                            <span class="meta">03 — Connection</span>
                        </div>

                        <div class="modes">
                            <button class="mode active" type="button" data-mode="direct" aria-pressed="true">
                                <span class="letter">A / ESSENTIAL</span>
                                <h3>Direct.</h3>
                                <p>Tutti e tre i provider in diretta. Nessun proxy nel link.</p>
                            </button>
                            <button class="mode" type="button" data-mode="proxy" aria-pressed="false">
                                <span class="letter">B / YOUR SETUP</span>
                                <h3>Con proxy.</h3>
                                <p>Tutti e tre i provider via EasyProxy. Collega il tuo.</p>
                            </button>
                        </div>

                        <div class="fields" id="proxyFields" hidden>
                            <div class="pair">
                                <label class="field">
                                    URL EASYPROXY
                                    <input id="easyProxyUrl" type="url" autocomplete="off" placeholder="https://easyproxy.example.com:7860">
                                </label>
                                <label class="field">
                                    PASSWORD · FACOLTATIVA
                                    <div class="password-wrap">
                                        <input id="easyProxyPassword" type="password" autocomplete="off" placeholder="API_PASSWORD di EasyProxy">
                                        <button id="revealPassword" type="button" aria-label="Mostra password">
                                            Mostra
                                        </button>
                                    </div>
                                </label>
                            </div>
                            <p class="hint">
                                EasyProxy resta esterno: inserisci l’URL della tua istanza e, se impostata, la password API.
                            </p>
                        </div>

                        <p class="hint">
                            La scelta vale per AnimeUnity, AnimeSaturn e AnimeWorld insieme. La modalità
                            proxy non verifica l’accessibilità del servizio.
                        </p>

                        <div class="actions">
                            <button class="btn" type="button" data-next="2">← Chiavi API</button>
                            <button class="btn blue" type="button" data-next="4">Genera il mio link ↗</button>
                        </div>
                    </section>

                    <!-- 04: Manifest -->
                    <section class="pane" data-pane="4">
                        <div class="pane-head">
                            <div>
                                <h2>Il tuo accesso<br>a un nuovo universo.</h2>
                                <p>Controlla la configurazione. Poi copia il link.</p>
                            </div>
                            <span class="meta">04 — Link</span>
                        </div>

                        <div class="pass">
                            <div class="pass-header">
                                <strong>HANX / YOUR SETUP</strong>
                                <span>CONFIGURATION PASS</span>
                            </div>
                            <div class="pass-row">
                                <span>Sorgenti</span>
                                <strong id="sourcesSummary"></strong>
                            </div>
                            <div class="pass-row">
                                <span>Chiavi API</span>
                                <strong id="keysSummary"></strong>
                            </div>
                            <div class="pass-row">
                                <span>Connessione</span>
                                <strong id="modeSummary"></strong>
                            </div>
                            <div class="pass-row">
                                <span>Contenuti</span>
                                <strong>Solo anime</strong>
                            </div>
                            <div class="pass-row">
                                <span>Server</span>
                                <strong id="serverSummary"></strong>
                            </div>

                            <label class="url-label" for="manifestUrl">
                                IL TUO MANIFEST URL
                                <textarea id="manifestUrl" readonly spellcheck="false" aria-label="URL del manifest configurato"></textarea>
                            </label>
                            <div class="copy-row">
                                <button id="copyManifestBtn" class="btn coral" type="button">Copia il link ↗</button>
                                <a id="installLink" class="btn blue" href="#">Installa in Stremio ↗</a>
                                <a id="installWebLink" class="btn blue" href="#" hidden>Installa da Stremio Web ↗</a>
                                <button id="checkManifestBtn" class="btn" type="button">Verifica manifest</button>
                            </div>
                            <p class="hint" id="installHint">
                                Incolla l’URL in Stremio per installare l’addon.
                                Il link contiene le eventuali chiavi API e la password proxy: non pubblicarlo.
                                La verifica del manifest non verifica gli stream.
                            </p>
                        </div>

                        <div class="actions">
                            <button class="btn" type="button" data-next="3">← Modifica connessione</button>
                            <span class="meta">Made for your next arc.</span>
                        </div>
                    </section>

                    <p class="feedback" id="feedback" role="status" aria-live="polite"></p>
                </main>
            </div>

            <footer>
                <span>${escapeHtml(manifest.name || 'HanX')} — Anime configuration studio.</span>
                <span>Cosmic edition / Solo anime · build ${escapeHtml(BUILD_STAMP)}</span>
            </footer>
        </div>

        <script>
            window.__HANX_PAGE_DATA__ = ${pageData};
        </script>
        <script>
${CLIENT_SCRIPT}
        </script>
    </body>
</html>`;
}
