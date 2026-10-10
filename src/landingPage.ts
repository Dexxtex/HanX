const STYLESHEET = `
* {
	box-sizing: border-box;
}

body,
html {
	margin: 0;
	padding: 0;
	width: 100%;
	min-height: 100%;
}

body {
	padding: 2vh;
	/* Responsive base font size: never smaller than 15px, scales with viewport height */
	font-size: clamp(15px, 2.2vh, 22px);
}

html {
	background: linear-gradient(135deg, #3d1f5c 0%, #2d1544 50%, #1a0d2e 100%);
	background-attachment: fixed;
	min-height: 100vh;
	animation: gradientShift 8s ease-in-out infinite;
}

@keyframes gradientShift {
	0%, 100% { background-position: 0% 50%; }
	50% { background-position: 100% 50%; }
}

@keyframes floatingSoft {
	0%, 100% { transform: translateY(0px); }
	50% { transform: translateY(-10px); }
}

@keyframes glow {
	0%, 100% { opacity: 0.3; }
	50% { opacity: 0.6; }
}

body {
	/* Use a single-column flex layout to avoid unintended side-by-side columns */
	display: flex;
	flex-direction: column;
	align-items: center;
	font-family: 'Open Sans', Arial, sans-serif;
	color: white;
}

h1 {
	font-size: clamp(28px, 5vh, 54px);
	font-weight: 700;
}

h2 {
	font-size: clamp(17px, 2.6vh, 30px);
	font-weight: normal;
	font-style: italic;
	opacity: 0.8;
}

h3 {
	font-size: clamp(17px, 2.6vh, 30px);
}

h1,
h2,
h3,
p {
	margin: 0;
	text-shadow: 0 0 1vh rgba(0, 0, 0, 0.15);
}

p {
	font-size: clamp(14px, 2vh, 22px);
}

ul {
	font-size: clamp(14px, 2vh, 22px);
	margin: 0;
	margin-top: 1vh;
	padding-left: 3vh;
}

a {
	color: white
}

a.install-link {
	text-decoration: none
}

button {
	border: 0;
	outline: 0;
	color: white;
	background: #8A5AAB;
	padding: 1.2vh 3.5vh;
	margin: auto;
	text-align: center;
	font-family: 'Open Sans', Arial, sans-serif;
	font-size: clamp(16px, 2.4vh, 26px);
	font-weight: 600;
	cursor: pointer;
	display: block;
	box-shadow: 0 0.5vh 1vh rgba(0, 0, 0, 0.2);
	transition: box-shadow 0.1s ease-in-out;
}

button:hover {
	box-shadow: none;
}

button:active {
	box-shadow: 0 0 0 0.5vh white inset;
}

/* Pretty toggle styles */
.toggle-row {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 0.6rem;
	padding: 0.45rem 0.25rem;
	border-radius: 10px;
}
.toggle-row.dimmed {
	/* Non oscura più l'intera riga, ma solo il selettore a destra */
}
.toggle-row.dimmed .toggle-right {
	filter: grayscale(100%);
	opacity: 0.55;
	transition: opacity 0.2s ease, filter 0.2s ease;
}
/* Forza il colore rosso quando il toggle è spento e oscurato */
.toggle-row.dimmed .switch input:not(:checked) + .slider {
	background-color: #b31b1b !important;
}
.toggle-title {
	font-size: clamp(0.95rem, 2.1vh, 1.35rem);
	font-weight: 700;
	letter-spacing: 0.01em;
	color: #c9b3ff; /* soft purple */
	text-shadow: 0 0 8px rgba(140, 82, 255, 0.6);
}
.toggle-row.dimmed .toggle-title { color:#555 !important; text-shadow:none; }
.toggle-right {
	display: inline-flex;
	align-items: center;
	gap: 0.4rem;
}
.toggle-off, .toggle-on {
	font-size: clamp(0.75rem, 1.8vh, 1rem);
	font-weight: 700;
	letter-spacing: 0.03em;
}
.toggle-off { color: #888; }
.toggle-on { color: #888; }
.toggle-row.is-on .toggle-on { color: #00c16e; }
.toggle-row:not(.is-on) .toggle-off { color: #ff3b3b; }

/* Switch */
.switch {
	position: relative;
	display: inline-block;
	width: 62px;
	height: 30px;
}
.switch input { display: none; }
.slider {
	position: absolute;
	cursor: pointer;
	top: 0; left: 0; right: 0; bottom: 0;
	background-color: #b31b1b; /* red when OFF */
	transition: 0.2s ease;
	border-radius: 30px;
	box-shadow: 0 0 10px rgba(140, 82, 255, 0.5); /* purple glow */
}
.slider:before {
	position: absolute;
	content: "";
	height: 24px;
	width: 24px;
	left: 3px;
	top: 3px;
	background-color: #fff;
	border-radius: 50%;
	transition: 0.2s ease;
}

.switch input:checked + .slider {
	background-color: #00c16e; /* green when ON */
	box-shadow: 0 0 14px rgba(140, 82, 255, 0.9); /* stronger glow */
}
.switch input:checked + .slider:before { transform: translateX(32px); }

#addon {
	/* Make the main container responsive and single-column */
	width: 100%;
	max-width: 1100px;
	margin: auto;
}

.logo {
	height: 14vh;
	width: 14vh;
	margin: auto;
	margin-bottom: 3vh;
}

.logo img {
	width: 100%;
}

.name, .version {
	display: inline-block;
	vertical-align: top;
}

.name {
	line-height: 5vh;
	margin: 0;
}

.version {
	position: relative;
	line-height: 5vh;
	opacity: 0.8;
	margin-bottom: 2vh;
}

.contact {
	position: absolute;
	left: 0;
	bottom: 4vh;
	width: 100%;
	text-align: center;
}

.contact a {
	font-size: 1.4vh;
	font-style: italic;
}

.separator {
	margin-bottom: 4vh;
}

.form-element {
	margin-bottom: 2vh;
}

.label-to-top {
	margin-bottom: 2vh;
}

.label-to-right {
	margin-left: 1vh !important;
}

.full-width {
	width: 100%;
}

/* Actions row: install + copy side by side */
.actions-row {
	display: flex;
	align-items: center;
	justify-content: center;
	gap: 1rem;
	flex-wrap: wrap;
}
.actions-row .install-link button,
.actions-row #copyManifestLink {
	margin: 0; /* override global button margin */
}
.actions-row .install-link button {
	padding: 0.85rem 2.2rem;
	background: linear-gradient(135deg, #7c3aff, #a855f7);
	color: #fff;
	border: 2px solid #c084fc;
	border-radius: 10px;
	cursor: pointer;
	font-weight: 800;
	font-size: 1.05rem;
	letter-spacing: 0.05em;
	box-shadow: 0 0 18px rgba(168,85,247,0.9), 0 0 40px rgba(168,85,247,0.45), inset 0 1px 0 rgba(255,255,255,0.15);
	text-shadow: 0 0 8px rgba(255,255,255,0.6);
	transition: all 0.2s ease;
}
.actions-row #copyManifestLink {
	padding: 0.85rem 2.2rem;
	background: linear-gradient(135deg, #1e3a8a, #2563eb);
	color: #fff;
	border: 2px solid #60a5fa;
	border-radius: 10px;
	cursor: pointer;
	font-weight: 800;
	font-size: 1.05rem;
	letter-spacing: 0.05em;
	box-shadow: 0 0 18px rgba(96,165,250,0.9), 0 0 40px rgba(96,165,250,0.45), inset 0 1px 0 rgba(255,255,255,0.15);
	text-shadow: 0 0 8px rgba(255,255,255,0.6);
	transition: all 0.2s ease;
}

@keyframes pulse {
	0% { box-shadow: 0 0 0 0 rgba(140, 82, 255, 0.3); }
	70% { box-shadow: 0 0 0 16px rgba(140, 82, 255, 0); }
	100% { box-shadow: 0 0 0 0 rgba(140, 82, 255, 0); }
}
/* Preset buttons */
.preset-btn { background:#4d2d66; border:1px solid #8c52ff; color:#fff; font-weight:600; padding:0.45rem 0.6rem; border-radius:8px; cursor:pointer; box-shadow:0 0 8px rgba(140,82,255,0.4); transition:background .2s, transform .15s; }
.preset-btn:hover { background:#5c3780; }
.preset-btn:active { transform:scale(.95); }
.preset-btn.active { background:#00c16e; border-color:#00c16e; box-shadow:0 0 10px rgba(0,193,110,0.7); }
	/* (Removed floating AddonBase toast styles – inline badge used) */
.help-btn.fast-inline {
	margin-left: 0.75rem;
}
.help-btn { background:rgba(255,255,255,0.1); border:1px solid rgba(255,255,255,0.4); color:#fff; padding:0.35rem 0.9rem; border-radius:999px; letter-spacing:0.05em; cursor:pointer; transition:background 0.2s ease; }
.help-btn:hover { background:rgba(255,255,255,0.2); }
.fast-toast { position:fixed; left:50%; bottom:3rem; transform:translateX(-50%); background:rgba(30,30,40,0.95); color:#fff; padding:0.9rem 1.2rem; border-radius:10px; box-shadow:0 8px 20px rgba(0,0,0,0.3); opacity:0; pointer-events:none; transition:opacity 0.3s ease; max-width:320px; text-align:center; font-size:0.9rem; }
.fast-toast.show { opacity:1; pointer-events:auto; }
`

const CLIENT_SCRIPT = `
(function () {
    'use strict';
    var form = document.getElementById('mainForm');
    var output = document.getElementById('manifestUrlInput');
    var install = document.getElementById('installLink');
    var status = document.getElementById('status');
    var currentUrl = '';

    function field(key) { return form.elements.namedItem(key); }
    function message(text) { status.textContent = text; }

    function configFromForm() {
        var config = {};
        form.querySelectorAll('[data-config-key]').forEach(function (el) {
            var key = el.getAttribute('data-config-key');
            if (key === 'personalTmdbKey' || key === 'mediaflowMaster') return;
            config[key] = el.type === 'checkbox' ? el.checked :
                (key === 'mediaFlowProxyPassword' ? el.value : el.value.trim());
        });
        var master = field('mediaflowMaster');
        if (master && !master.checked) {
            delete config.mediaFlowProxyUrl;
            delete config.mediaFlowProxyPassword;
            delete config.useMediaFlow;
        }
        return config;
    }

    function refresh() {
        var config = configFromForm();
        var base = new URL(document.baseURI);
        base.search = ''; base.hash = '';
        base.pathname = base.pathname.replace(/\\/(?:configure|index\\.html)?\\/?$/, '').replace(/\\/+$/, '');
        var path = base.pathname.replace(/\\/+$/, '') || '';
        currentUrl = base.origin + path + '/' + encodeURIComponent(JSON.stringify(config)) + '/manifest.json';
        output.value = currentUrl;
        install.href = 'stremio://' + currentUrl.replace(/^https?:\\/\\//, '');
        message('URL aggiornato. Contiene la configurazione selezionata.');
        return config;
    }

    function validate() {
        if (!form.reportValidity()) return false;
        var config = configFromForm();
        if (config.mediaFlowProxyUrl) {
            try {
                var proxy = new URL(config.mediaFlowProxyUrl);
                if (!/^https?:$/.test(proxy.protocol)) throw new Error();
            } catch (e) {
                message('Inserisci un URL proxy valido, completo di http:// o https://.');
                return false;
            }
        } else if (field('mediaflowMaster') && field('mediaflowMaster').checked) {
            message('Proxy attivo: inserisci il suo URL.');
            return false;
        }
        if (config.animeunityEnabled === false && config.animesaturnEnabled === false && config.animeworldEnabled === false) {
            message('Attiva almeno un provider.');
            return false;
        }
        return true;
    }

    form.addEventListener('submit', function(e) { e.preventDefault(); if (validate()) refresh(); });
    form.addEventListener('input', refresh);
    form.addEventListener('change', refresh);

    document.querySelectorAll('[data-preset]').forEach(function(button) {
        button.addEventListener('click', function() {
            var proxy = button.getAttribute('data-preset') === 'proxy';
            ['animeunityEnabled','animesaturnEnabled','animeworldEnabled'].forEach(function(key) { if (field(key)) field(key).checked = true; });
            var flags = { mediaflowMaster: proxy, animeunityDirect: !proxy, animeunityDirectFhd: false, animeunityProxy: proxy };
            Object.keys(flags).forEach(function(key) { if (field(key)) field(key).checked = flags[key]; });
            refresh();
        });
    });

    install.addEventListener('click', function(e) { if (!validate()) { e.preventDefault(); return; } refresh(); });

    document.getElementById('copyManifestBtn').addEventListener('click', async function() {
        if (!validate()) return;
        refresh();
        try {
            if (!navigator.clipboard || !navigator.clipboard.writeText) throw new Error();
            await navigator.clipboard.writeText(currentUrl);
            message('URL configurato copiato. Incollalo in Stremio.');
        } catch (e) {
            output.focus(); output.select();
            var copied = false;
            try { copied = document.execCommand('copy'); } catch (_) {}
            message(copied ? 'URL configurato copiato.' : 'Copia manualmente l\u2019URL selezionato.');
        }
    });

    document.getElementById('checkManifestBtn').addEventListener('click', async function() {
        if (!validate()) return;
        refresh();
        var urlToCheck = currentUrl;
        var controller = new AbortController();
        var timer = setTimeout(function() { controller.abort(); }, 15000);
        message('Verifica del manifest in corso\u2026');
        try {
            var response = await fetch(urlToCheck, { signal: controller.signal, cache: 'no-store' });
            if (!response.ok) throw new Error('HTTP ' + response.status);
            var manifest = await response.json();
            if (!manifest || typeof manifest.id !== 'string' || typeof manifest.name !== 'string' || typeof manifest.version !== 'string' || !Array.isArray(manifest.resources) || !Array.isArray(manifest.types) || !Array.isArray(manifest.catalogs)) {
                throw new Error('La risposta non contiene i campi principali di un manifest Stremio.');
            }
            message('Manifest raggiungibile: ' + manifest.name + ' \u2014 ' + manifest.version + '. Il playback va verificato separatamente.');
        } catch (e) {
            message('Verifica fallita: ' + (e.name === 'AbortError' ? 'timeout' : e.message));
        } finally { clearTimeout(timer); }
    });

    refresh();
})();
`;

function escapeHtml(value: unknown): string {
    return String(value ?? '').replace(/[&<>"']/g, (char) => {
        const entities: Record<string, string> = {
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        };
        return entities[char];
    });
}

function landingTemplate(manifest: any): string {
    const fields = Array.isArray(manifest.config) ? [...manifest.config] : [];
    if (!fields.some((field: any) => field.key === 'mediaflowMaster')) {
        fields.push({ key: 'mediaflowMaster', title: 'Abilita proxy', type: 'checkbox', default: false });
    }
    const options = fields.filter((field: any) => field.key !== 'personalTmdbKey').map((field: any) => {
        const key = escapeHtml(field.key);
        const title = escapeHtml(field.title || field.key);
        if (field.type === 'checkbox') {
            const checked = typeof field.default === 'boolean' ? field.default :
                field.default === 'checked' || ['animeunityEnabled', 'animesaturnEnabled', 'animeworldEnabled', 'animeunityDirect'].includes(field.key);
            return `<div class="form-element"><label><input type="checkbox" id="${key}" name="${key}" data-config-key="${key}"${checked ? ' checked' : ''}> ${title}</label></div>`;
        }
        if (field.type === 'select') {
            const choices = (field.options || []).map((value: any) => `<option value="${escapeHtml(value)}"${value === field.default ? ' selected' : ''}>${escapeHtml(value)}</option>`).join('');
            return `<div class="form-element"><label for="${key}">${title}</label><select class="full-width" id="${key}" name="${key}" data-config-key="${key}">${choices}</select></div>`;
        }
        const type = field.key === 'mediaFlowProxyPassword' || field.type === 'password' ? 'password' : field.type === 'number' ? 'number' : 'text';
        return `<div class="form-element"><label for="${key}">${title}</label><input class="full-width" type="${type}" id="${key}" name="${key}" data-config-key="${key}" value="${escapeHtml(field.default ?? '')}"${field.required ? ' required' : ''}></div>`;
    }).join('\n');
    return `<!DOCTYPE html>
<html lang="it">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(manifest.name || 'HanX')} — Configurazione</title>
<style>${STYLESHEET}
input:not([type=checkbox]),select{padding:12px;margin-top:8px;background:#21132e;color:white;border:1px solid #8A5AAB;border-radius:6px}
input[type=checkbox]{display:inline-block;width:20px;height:20px;vertical-align:middle}
.panel{width:100%;max-width:900px;padding:24px;background:rgba(20,15,35,.85);border-radius:12px}
#manifestUrlInput{width:100%;font-size:14px}#status{margin:16px 0;overflow-wrap:anywhere}.actions-row{margin:18px 0}
</style></head>
<body><main class="panel"><h1>${escapeHtml(manifest.name || 'HanX')}</h1><p>${escapeHtml(manifest.description || '')}</p>
<h2 style="margin:20px 0">Configura e copia l'URL per Stremio</h2>
<div class="actions-row"><button type="button" data-preset="direct">Preset Direct</button><button type="button" data-preset="proxy">Preset Proxy</button></div>
<form id="mainForm">${options}<button type="submit">Genera URL configurato</button></form>
<label for="manifestUrlInput">URL del manifest configurato</label><input id="manifestUrlInput" type="text" readonly spellcheck="false">
<div class="actions-row"><button id="copyManifestBtn" type="button">Copia URL Manifest</button><a id="installLink" class="install-link" href="#">Apri in Stremio</a><button id="checkManifestBtn" type="button">Verifica manifest</button></div>
<p id="status" role="status" aria-live="polite"></p><p style="font-size:14px">L'URL contiene la configurazione, inclusa l'eventuale password proxy. Non condividerlo pubblicamente. La verifica del manifest non verifica gli stream.</p>
</main><script>${CLIENT_SCRIPT}</script></body></html>`;
}
export { landingTemplate };
