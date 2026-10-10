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

function landingTemplate(manifest: any) {
	const background = manifest.background || 'https://dl.strem.io/addon-background.jpg'
	const logo = manifest.logo || 'https://dl.strem.io/addon-logo.png'
	const favicon = manifest.favicon || logo
	const contactHTML = manifest.contactEmail ?
		`<div class="contact">
			<p>Contact ${manifest.name} creator:</p>
			<a href="mailto:${manifest.contactEmail}">${manifest.contactEmail}</a>
		</div>` : ''

	const stylizedTypes = manifest.types
		.map((t: string) => t[0].toUpperCase() + t.slice(1) + (t !== 'series' ? 's' : ''))

	let formHTML = ''
	let script = ''

	// ── GUIDED INSTALLATION SECTION ──
	const guidedInstallationHTML = `
		<div id="guidedInstallerSection" style="margin: 2rem 0; width: 100%; box-sizing: border-box; padding: 2rem; border-radius: 12px; background: rgba(20, 15, 35, 0.85); border: 1px solid rgba(140, 82, 255, 0.5);">
			<h3 style="text-align: center; margin-bottom: 1.5rem; font-size: 1.3rem; color: #c9b3ff; text-shadow: 0 0 8px rgba(140, 82, 255, 0.6);">
				⚙️ Scegli la tua Configurazione
			</h3>
			
			<!-- Preset Grid -->
			<div id="presetGrid">
				<!-- SENZA PROXY -->
				<div style="margin-bottom: 1.5rem; padding: 1.2rem 1.2rem 0.8rem; border: 1px solid rgba(160, 160, 180, 0.25); border-radius: 10px; background: rgba(255,255,255,0.03);">
					<div style="font-size: 0.8rem; font-weight: 700; letter-spacing: 0.08em; color: #aaa; text-transform: uppercase; margin-bottom: 1rem; display: flex; align-items: center; gap: 0.5rem;">🔓 Senza Proxy (Direct)</div>
					<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 0.85rem;">
						<div class="preset-card" data-preset="anime-direct" style="padding: 1rem; border: 2px solid rgba(140, 82, 255, 0.4); border-radius: 10px; background: rgba(45, 21, 68, 0.7); cursor: pointer; transition: all 0.3s ease;">
							<div style="font-weight: 700; font-size: 0.95rem; margin-bottom: 0.4rem; color: #c9b3ff;">🎌 Anime Only (Direct)</div>
							<div style="font-size: 0.7rem; color: #888; line-height: 1.4;">AnimeUnity, AnimeSaturn, AnimeWorld — modalità Direct</div>
						</div>
					</div>
				</div>

				<!-- CON PROXY -->
				<div style="margin-bottom: 2rem; padding: 1.2rem 1.2rem 0.8rem; border: 1px solid rgba(0, 193, 110, 0.3); border-radius: 10px; background: rgba(0, 193, 110, 0.04);">
					<div style="font-size: 0.8rem; font-weight: 700; letter-spacing: 0.08em; color: #00c16e; text-transform: uppercase; margin-bottom: 1rem; display: flex; align-items: center; gap: 0.5rem;">☂️ Con Proxy (EasyProxy o MediaFlowProxy)</div>
					<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 0.85rem;">
						<div class="preset-card" data-preset="anime-proxy" style="padding: 1rem; border: 2px solid rgba(0, 193, 110, 0.35); border-radius: 10px; background: rgba(0, 80, 45, 0.3); cursor: pointer; transition: all 0.3s ease;">
							<div style="font-weight: 700; font-size: 0.95rem; margin-bottom: 0.4rem; color: #c9b3ff;">🎌 Anime + Proxy</div>
							<div style="font-size: 0.7rem; color: #888; line-height: 1.4;">AnimeUnity, AnimeSaturn, AnimeWorld — con MediaFlowProxy / EasyProxy</div>
						</div>
					</div>
				</div>

			</div>
			<!-- Preset Details Panel -->
			<div id="presetDetailsPanel" style="display: none; background: rgba(10, 10, 25, 0.9); padding: 1.5rem; border-radius: 10px; border: 1px solid rgba(140, 82, 255, 0.6); margin-bottom: 1.5rem;">
				<h4 id="presetName" style="color: #c9b3ff; margin-bottom: 1rem; font-size: 1.1rem;"></h4>
				<div id="presetProviders" style="color: #aaa; font-size: 0.85rem; line-height: 1.8; margin-bottom: 1rem;"></div>
				<div id="mfpPromptContainer" style="display: none; margin-top: 1rem; padding: 1rem; background: rgba(45, 21, 68, 0.7); border-radius: 8px;">
					<p style="color: #c9b3ff; margin: 0 0 0.75rem 0; font-weight: 600;">📍 Proxy URL (obbligatorio)</p>
					<input type="text" id="guidedMfpUrl" placeholder="https://mfp.example.com" style="width: 100%; padding: 0.5rem; margin-bottom: 0.5rem; border: 1px solid rgba(140, 82, 255, 0.5); border-radius: 6px; background: rgba(20, 15, 35, 0.9); color: #fff;">
					<p style="color: #aaa; margin: 0.5rem 0; font-size: 0.75rem;">Password (opzionale)</p>
					<input type="password" id="guidedMfpPwd" placeholder="Password (opzionale)" style="width: 100%; padding: 0.5rem; border: 1px solid rgba(140, 82, 255, 0.5); border-radius: 6px; background: rgba(20, 15, 35, 0.9); color: #fff;">
					<div style="margin-top:0.85rem;text-align:center;">
						<div style="font-size:0.72rem;color:#c9b3ff;margin-bottom:0.4rem;font-weight:600;letter-spacing:0.04em;">Backend Proxy</div>
						<div id="guidedBackendTrack" role="tablist" aria-label="Proxy backend"
							style="position:relative;display:flex;width:260px;margin:0 auto;height:34px;background:rgba(20,15,35,0.9);border:1px solid rgba(140,82,255,0.5);border-radius:30px;cursor:pointer;user-select:none;overflow:hidden;box-shadow:inset 0 0 8px rgba(0,0,0,0.4);">
							<div id="guidedBackendThumb" style="position:absolute;top:3px;left:3px;width:calc(50% - 3px);height:calc(100% - 6px);border-radius:30px;background:linear-gradient(135deg,#8c52ff,#5e2bbf);box-shadow:0 0 12px rgba(140,82,255,0.6);transition:left 0.25s ease, background 0.25s ease;"></div>
							<button type="button" id="guidedBackendEasy" role="tab" aria-selected="true" style="flex:1;position:relative;z-index:2;background:transparent;border:none;color:#fff;font-weight:700;font-size:0.78rem;letter-spacing:0.04em;cursor:pointer;">EasyProxy</button>
							<button type="button" id="guidedBackendMfp" role="tab" aria-selected="false" style="flex:1;position:relative;z-index:2;background:transparent;border:none;color:#aaa;font-weight:700;font-size:0.78rem;letter-spacing:0.04em;cursor:pointer;">MediaFlow</button>
						</div>
					</div>
				</div>
				<div style="display: flex; gap: 1rem; justify-content: center; flex-wrap: wrap;">
					<button id="confirmPresetBtn" type="button" style="padding: 0.7rem 1.5rem; background: #00c16e; color: #fff; border: none; border-radius: 8px; cursor: pointer; font-weight: 600; transition: all 0.3s ease;">
						Continua con questo Preset
					</button>
					<button id="cancelPresetBtn" type="button" style="padding: 0.7rem 1.5rem; background: rgba(140, 82, 255, 0.4); color: #fff; border: 1px solid rgba(140, 82, 255, 0.6); border-radius: 8px; cursor: pointer; font-weight: 600; transition: all 0.3s ease;">
						Indietro
					</button>
				</div>
			</div>
			
			<div style="text-align: center; margin-top: 0.5rem;">
				<p style="font-size: 0.8rem; color: #aaa; margin-bottom: 0.75rem;">Oppure configura manualmente con la modalità personalizzata</p>
				<button id="switchToCustomBtn" type="button" style="display: inline-block; padding: 0.75rem 2rem; background: linear-gradient(135deg, rgba(140,82,255,0.25), rgba(100,50,200,0.35)); color: #e0ccff; border: 1.5px solid rgba(180,130,255,0.7); border-radius: 30px; cursor: pointer; font-weight: 700; font-size: 0.95rem; letter-spacing: 0.03em; box-shadow: 0 0 14px rgba(140,82,255,0.45), 0 0 30px rgba(140,82,255,0.2); transition: all 0.25s ease;">
					➜ Passa a Installazione Personalizzata
				</button>
			</div>
		</div>
	`;

	if ((manifest.config || []).length) {
		let options = ''
		// We'll collect auto-generated options, but skip tmdbApiKey & personalTmdbKey here to custom place them at top later
		manifest.config.forEach((elem: any) => {
			const key = elem.key
			if (["text", "number", "password"].includes(elem.type)) {
				if (key === 'tmdbApiKey') {
					// Remove custom TMDB key field from UI entirely (use default only)
					return;
				}
				const isRequired = elem.required ? ' required' : ''
				const defaultHTML = elem.default ? ` value="${elem.default}"` : ''
				const inputType = elem.type
				options += `
					<div class="form-element">
						<div class="label-to-top">${elem.title}</div>
						<input type="${inputType}" id="${key}" name="${key}" class="full-width"${defaultHTML}${isRequired}/>
					</div>
					`
			} else if (elem.type === 'checkbox') {
				// Skip only personalTmdbKey (custom placement); mediaflowMaster & localMode will be moved later
				if (key === 'personalTmdbKey') return; // removed from UI
				// Sub-menu items: create hidden inputs to store their values from manifest
				if (['animeunityDirect', 'animeunityDirectFhd', 'animeunityProxy', 'animesaturnDirect', 'animesaturnDirectFhd', 'animesaturnProxy', 'animeworldDirect', 'animeworldDirectFhd', 'animeworldProxy', 'useMediaFlow'].includes(key)) {
					const isChecked = (typeof (elem as any).default === 'boolean') && ((elem as any).default as boolean);
					const checkedAttr = isChecked ? ' checked' : '';
					options += `<input type="checkbox" id="hidden_${key}" data-config-key="${key}" style="display:none;"${checkedAttr} />`;
					return;
				}
				// Custom pretty toggle for known keys
				const toggleMap: any = {
					'animeunityEnabled': { title: 'AnimeUnity 🎌 - 🔓 🔒 <span style="font-size:0.65rem; opacity:0.75; font-weight:600;">(Alcuni flussi hanno bisogno di MFP)</span>', invert: false },
					'animesaturnEnabled': { title: 'AnimeSaturn ⭐ - 🔓 🔒 <span style="font-size:0.65rem; opacity:0.75; font-weight:600;">(Alcuni flussi hanno bisogno di MFP)</span>', invert: false },
					'animeworldEnabled': { title: 'AnimeWorld 🌍 - 🔓', invert: false },
					'mediaflowMaster': { title: 'MediaFlow Proxy ☂️', invert: false },
				}
				if (toggleMap[key]) {
					const t = toggleMap[key];
					// Determine checked from elem.default boolean if provided; default visually ON
					const hasDefault = (typeof (elem as any).default === 'boolean');
					// For inverted toggles (disable*), show ON when default=false (i.e., feature enabled)
					let isChecked = hasDefault ? (t.invert ? !((elem as any).default as boolean) : !!(elem as any).default) : true;
					// Force non-anime providers OFF by default
					if (!['animeunityEnabled', 'animesaturnEnabled', 'animeworldEnabled'].includes(key) && !hasDefault) isChecked = false;
					// Force non-anime providers permanently OFF and disabled
					if (t.forceDisabled) isChecked = false;
					const checkedAttr = isChecked ? ' checked' : '';
					const extraAttr = key === 'mediaflowMaster' ? ' data-master-mfp="1"' : '';
					const extraAttrTmdb = key === 'personalTmdbKey' ? ' data-personal-tmdb="1"' : '';
					const disabledAttr = t.forceDisabled ? ' disabled' : '';
					const dimmedClass = t.forceDisabled ? ' dimmed' : '';
					const cursorStyle = t.forceDisabled ? ' style="pointer-events:none; opacity:0.5;"' : '';
					// (Rimossa vecchia iniezione pills Local/FHD - verrà creato sotto-menu dedicato)
					let extraLocal = '';
					options += `
							<div class="form-element"${extraAttr}${extraAttrTmdb}>
								<div class="toggle-row${dimmedClass}" data-toggle-row="${key}">
									<span class="toggle-title">${t.title}${extraLocal}</span>
									<div class="toggle-right"${cursorStyle}>
										<span class="toggle-off">OFF</span>
										<label class="switch">
											<input type="checkbox" id="${key}" name="${key}" data-config-key="${key}" data-main-toggle="1" data-invert="${t.invert ? 'true' : 'false'}"${checkedAttr}${disabledAttr} />
											<span class="slider"></span>
										</label>
										<span class="toggle-on">ON</span>
									</div>
								</div>
							</div>
							`
				} else {
					// Support boolean default as well as legacy 'checked'
					const isChecked = (typeof (elem as any).default === 'boolean')
						? (((elem as any).default as boolean) ? ' checked' : '')
						: (elem.default === 'checked' ? ' checked' : '')
					options += `
						<div class="form-element">
							<label for="${key}">
								<input type="checkbox" id="${key}" name="${key}"${isChecked}> <span class="label-to-right">${elem.title}</span>
							</label>
						</div>
						`
				}
			} else if (elem.type === 'select') {
				const defaultValue = elem.default || (elem.options || [])[0]
				options += `<div class="form-element">
				<div class="label-to-top">${elem.title}</div>
				<select id="${key}" name="${key}" class="full-width">
				`
				const selections = elem.options || []
				selections.forEach((el: string) => {
					const isSelected = el === defaultValue ? ' selected' : ''
					options += `<option value="${el}"${isSelected}>${el}</option>`
				})
				options += `</select>
               </div>
               `
			}
		})
		if (options.length) {
			formHTML = `
			<form class="pure-form" id="mainForm">
				<!-- (Addon Base input removed – resolved server-side; read-only badge appears if available) -->
				<!-- Preset Installazioni consigliate - RIMOSSO -->
				<!--
				<div style="margin:0 0 1rem 0; padding:0.75rem; border:1px solid rgba(140,82,255,0.55); border-radius:10px; background:rgba(20,15,35,0.55);">
					<div style="font-weight:700; margin-bottom:0.5rem; text-align:center; color:#c9b3ff;">Installazioni consigliate</div>
					<div id="presetInstallations" style="display:grid; grid-template-columns:repeat(2, minmax(120px,1fr)); gap:0.5rem; justify-items:stretch; align-items:stretch;">
						<button type="button" data-preset="pubblicamfp" class="preset-btn" style="min-width:120px;">Pubblica (MFP)</button>
						<button type="button" data-preset="locale" class="preset-btn" style="min-width:120px;">Locale</button>
						<button type="button" data-preset="pubblicanomfp" class="preset-btn" style="min-width:140px;">Pubblica (NO MFP)</button>
						<button type="button" data-preset="oci" class="preset-btn" style="min-width:140px;">OCI/Render</button>
					</div>
					<p style="margin:0.6rem 0 0 0; font-size:0.7rem; opacity:0.75; text-align:center;">I preset impostano automaticamente i provider consigliati.</p>
				</div>
				-->
				<!-- Manual placement containers for MediaflowProxy -->
				<div id="mediaflowManualSlot"></div>

				<!-- Centered MediaflowProxy toggle (custom) will be auto-generated below; we move its element after generation via script if needed -->
				${options}
				${manifest.__resolvedAddonBase ? (() => {
					const _raw = manifest.__resolvedAddonBase; const _host = _raw.replace(/^https?:\/\//, ''); const _isFallback = /hanx\.hayd\.uk/.test(_raw); return `<div id="svxAddonBaseBadge" style="text-align:center; margin:-0.25rem 0 1.1rem 0;">
					<span style=\"display:inline-block; padding:0.35rem 0.75rem; background:rgba(0,0,0,0.45); border:1px solid rgba(140,82,255,0.65); border-radius:14px; font-size:0.70rem; letter-spacing:0.05em; font-weight:600; color:#c9b3ff;\" title=\"Addon Base URL risolta all'avvio\">Addon Base URL per Vix FHD: <span style='color:#00c16e;'>${_host}</span><a href=\"https://github.com/Dexxtex/HanX/blob/main/README.md\" target=\"_blank\" style=\"text-decoration:none; margin-left:6px; color:#8c52ff;\">📖 README</a></span>
				</div>` })() : ''}
			</form>

			<div class="separator"></div>
			`
			script += `
			console.log('[SVX] Custom form logic init');
			`
			script += `
			var installLink = document.getElementById('installLink');
			var mainForm = document.getElementById('mainForm');
			if (installLink && mainForm) {
					// Basic runtime guard & error surface
					try { window.__SVX_OK = true; } catch(e) {}
				installLink.onclick = function () { return (mainForm && typeof mainForm.reportValidity === 'function') ? mainForm.reportValidity() : true; };
				var buildConfigFromForm = function() {
					var config = {};
					var elements = (mainForm).querySelectorAll('input, select, textarea');
					elements.forEach(function(el) {
						var key = el.id || el.getAttribute('name') || '';
						if (!key) return;
						if (['personalTmdbKey'].includes(key)) return; // exclude only personal key; include mediaflowMaster in config
						if (el.type === 'checkbox') {
							var cfgKey = el.getAttribute('data-config-key') || key;
							var invert = el.getAttribute('data-invert') === 'true';
							var val = !!el.checked;
							config[cfgKey] = invert ? !val : val;
						} else {
							config[key] = el.value.trim();
						}
					});
					// If mediaflowMaster is disabled, ensure we don't send partial/stale MFP config
					if (!config['mediaflowMaster']) {
						delete config['mediaFlowProxyUrl'];
						delete config['mediaFlowProxyPassword'];
						delete config['useMediaFlow'];
					}
					// (addonBase input removed – server resolved; nothing to store)
					// tmdbApiKey always kept (UI hidden)
					return config;
				};


				// ── PRESET DEFINITIONS ──
				var presets = {
					'anime-direct': {
						name: 'Anime Only (Direct)',
						mfp: false,
						providers: ['AnimeUnity', 'AnimeSaturn', 'AnimeWorld'],
						config: {
							animeunityEnabled: true,
							animesaturnEnabled: true,
							animeworldEnabled: true,
							animeunityDirect: true,
							animesaturnDirect: true,
							animeworldDirect: true,
							mediaflowMaster: false,
							personalTmdbKey: '',
							mfpUrl: '',
							mfpPwd: ''
						}
					},
					'anime-proxy': {
						name: 'Anime + Proxy',
						mfp: true,
						providers: ['AnimeUnity', 'AnimeSaturn', 'AnimeWorld'],
						config: {
							animeunityEnabled: true,
							animesaturnEnabled: true,
							animeworldEnabled: true,
							animeunityProxy: true,
							animesaturnProxy: true,
							animeworldProxy: true,
							mediaflowMaster: true,
							personalTmdbKey: '',
							mfpUrl: '',
							mfpPwd: ''
						}
					}
				};

				var presetCards = document.querySelectorAll('.preset-card');
				var detailsPanel = document.getElementById('presetDetailsPanel');
				var presetNameEl = document.getElementById('presetName');
				var presetProvidersEl = document.getElementById('presetProviders');
				var mfpPromptContainer = document.getElementById('mfpPromptContainer');
				var guidedMfpUrl = document.getElementById('guidedMfpUrl');
				var guidedMfpPwd = document.getElementById('guidedMfpPwd');
				var confirmPresetBtn = document.getElementById('confirmPresetBtn');
				var cancelPresetBtn = document.getElementById('cancelPresetBtn');
				var presetGrid = document.getElementById('presetGrid');
				var selectedPresetKey = null;
				var guidedUseMediaFlow = false;

				// Wire up guided backend selector (EasyProxy / MediaFlow)
				try {
					var gbThumb = document.getElementById('guidedBackendThumb');
					var gbEasy = document.getElementById('guidedBackendEasy');
					var gbMfp = document.getElementById('guidedBackendMfp');
					function applyGuidedBackend(useMf){
						guidedUseMediaFlow = !!useMf;
						if (useMf) {
							if (gbThumb) { gbThumb.style.left = 'calc(50% + 0px)'; gbThumb.style.background = 'linear-gradient(135deg,#4ad7ff,#1a8fb8)'; gbThumb.style.boxShadow = '0 0 14px rgba(74,215,255,0.6)'; }
							if (gbEasy) { gbEasy.style.color = '#aaa'; gbEasy.setAttribute('aria-selected','false'); }
							if (gbMfp) { gbMfp.style.color = '#fff'; gbMfp.setAttribute('aria-selected','true'); }
						} else {
							if (gbThumb) { gbThumb.style.left = '3px'; gbThumb.style.background = 'linear-gradient(135deg,#8c52ff,#5e2bbf)'; gbThumb.style.boxShadow = '0 0 12px rgba(140,82,255,0.6)'; }
							if (gbEasy) { gbEasy.style.color = '#fff'; gbEasy.setAttribute('aria-selected','true'); }
							if (gbMfp) { gbMfp.style.color = '#aaa'; gbMfp.setAttribute('aria-selected','false'); }
						}
					}
					if (gbEasy) gbEasy.addEventListener('click', function(){ applyGuidedBackend(false); });
					if (gbMfp) gbMfp.addEventListener('click', function(){ applyGuidedBackend(true); });
				} catch(e) { console.warn('guided backend selector init failed', e); }

				presetCards.forEach(function(card){
					card.addEventListener('click', function(){
						var key = card.getAttribute('data-preset');
						var preset = presets[key];
						if(!preset) return;
						selectedPresetKey = key;

						// Highlight active card
						presetCards.forEach(function(c){ c.style.borderColor='rgba(140,82,255,0.4)'; c.style.background='rgba(45,21,68,0.7)'; });
						card.style.borderColor='#00c16e';
						card.style.background='rgba(0,193,110,0.15)';

						// Show details panel
						if(presetNameEl) presetNameEl.textContent = preset.name;
						if(presetProvidersEl) presetProvidersEl.innerHTML = preset.providers.map(function(p){ return '<span style="display:inline-block; padding:0.25rem 0.6rem; margin:0.2rem; background:rgba(140,82,255,0.2); border:1px solid rgba(140,82,255,0.4); border-radius:6px; font-size:0.8rem;">' + p + '</span>'; }).join('');

						// Show/hide MFP inputs
						if(mfpPromptContainer) mfpPromptContainer.style.display = preset.mfp ? 'block' : 'none';

						if(detailsPanel) detailsPanel.style.display = 'block';
						if(presetGrid) presetGrid.style.display = 'none';
					});
				});

				// Cancel preset: back to grid
				if(cancelPresetBtn) cancelPresetBtn.addEventListener('click', function(){
					if(detailsPanel) detailsPanel.style.display = 'none';
					if(presetGrid) presetGrid.style.display = 'grid';
					selectedPresetKey = null;
					presetCards.forEach(function(c){ c.style.borderColor='rgba(140,82,255,0.4)'; c.style.background='rgba(45,21,68,0.7)'; });
				});

				// Confirm preset → FastMode popup → Install
				if(confirmPresetBtn) confirmPresetBtn.addEventListener('click', function(){
					var preset = presets[selectedPresetKey];
					if(!preset) return;

					// Validate MFP URL if needed
					if(preset.mfp && guidedMfpUrl){
						var url = guidedMfpUrl.value.trim();
						if(!url){
							guidedMfpUrl.style.borderColor='#ff3b3b';
							guidedMfpUrl.focus();
							return;
						}
						guidedMfpUrl.style.borderColor='rgba(140,82,255,0.5)';
					}

					// Build config
					var config = JSON.parse(JSON.stringify(preset.config));

					if(preset.mfp){
						config.mediaFlowProxyUrl = guidedMfpUrl ? guidedMfpUrl.value.trim() : '';
						config.mediaFlowProxyPassword = guidedMfpPwd ? guidedMfpPwd.value.trim() : '';
						config.useMediaFlow = !!guidedUseMediaFlow;
					}

					// Vai direttamente al pannello install
					showInstallPanel(config);
				// Vai direttamente al pannello install
					showInstallPanel(config);
				});

				// ── INSTALL PANEL (after preset confirmed) ──
				function showInstallPanel(config){
					var configStr = JSON.stringify(config);
					var encodedConfig = btoa(configStr);
					var manifestUrl = window.location.protocol + '//' + window.location.host + '/' + encodedConfig + '/manifest.json';
					var stremioUrl = 'stremio://' + window.location.host + '/' + encodedConfig + '/manifest.json';

					// Hide details panel, show install
					if(detailsPanel) detailsPanel.style.display = 'none';
					if(presetGrid) presetGrid.style.display = 'none';

					// Create install panel inside guided section
					var existingInstall = document.getElementById('guidedInstallPanel');
					if(existingInstall) existingInstall.remove();

					var panel = document.createElement('div');
					panel.id = 'guidedInstallPanel';
					panel.style.cssText = 'text-align:center;padding:1.5rem;';
					panel.innerHTML = '<h3 style="color:#00c16e;margin:0 0 1rem 0;text-shadow:0 0 12px rgba(0,193,110,0.8);">✅ Configurazione Pronta!</h3>'
						+ '<p style="color:#aaa;font-size:0.85rem;margin-bottom:1.5rem;">Configurazione selezionata</p>'
						+ '<div style="display:flex;gap:1rem;justify-content:center;flex-wrap:wrap;margin-bottom:1.5rem;">'
						+ '<a href="' + stremioUrl + '" style="text-decoration:none;"><button type="button" style="padding:0.85rem 2.2rem;background:linear-gradient(135deg,#7c3aff,#a855f7);color:#fff;border:2px solid #c084fc;border-radius:10px;cursor:pointer;font-weight:800;font-size:1.05rem;letter-spacing:0.05em;box-shadow:0 0 18px rgba(168,85,247,0.9),0 0 40px rgba(168,85,247,0.45),inset 0 1px 0 rgba(255,255,255,0.15);text-shadow:0 0 8px rgba(255,255,255,0.6);transition:all 0.2s ease;">🎬 INSTALLA SU STREMIO</button></a>'
						+ '<button id="guidedCopyBtn" type="button" style="padding:0.85rem 2.2rem;background:linear-gradient(135deg,#1e3a8a,#2563eb);color:#fff;border:2px solid #60a5fa;border-radius:10px;cursor:pointer;font-weight:800;font-size:1.05rem;letter-spacing:0.05em;box-shadow:0 0 18px rgba(96,165,250,0.9),0 0 40px rgba(96,165,250,0.45),inset 0 1px 0 rgba(255,255,255,0.15);text-shadow:0 0 8px rgba(255,255,255,0.6);transition:all 0.2s ease;">📋 COPIA MANIFEST URL</button>'
						+ '</div>'
						+ '<div id="guidedKofiSlot" style="margin:1.2rem 0;text-align:center;"></div>'
						+ '<div style="text-align:center;margin-top:1rem;"><button id="guidedBackBtn" type="button" style="display:inline-block;padding:0.75rem 2rem;background:linear-gradient(135deg,rgba(140,82,255,0.25),rgba(100,50,200,0.35));color:#e0ccff;border:1.5px solid rgba(180,130,255,0.7);border-radius:30px;cursor:pointer;font-weight:700;font-size:0.95rem;letter-spacing:0.03em;box-shadow:0 0 14px rgba(140,82,255,0.45),0 0 30px rgba(140,82,255,0.2);transition:all 0.25s ease;">⬅ Riconfigura</button></div>';

					var guidedSec = document.getElementById('guidedInstallerSection');
					if(guidedSec) guidedSec.appendChild(panel);

					// Fill the ko-fi slot with the shared button builder
					var kofiSlot = document.getElementById('guidedKofiSlot');
					if(kofiSlot && !kofiSlot.hasChildNodes()) kofiSlot.appendChild(buildKofiBtn());

					// Copy button
					var copyBtn = document.getElementById('guidedCopyBtn');
					if(copyBtn){
						copyBtn.addEventListener('click', function(){
							try {
								navigator.clipboard.writeText(manifestUrl).then(function(){
									copyBtn.textContent='✅ COPIATO!';
									copyBtn.style.background='linear-gradient(135deg,#065f46,#059669)';
									copyBtn.style.borderColor='#34d399';
									copyBtn.style.boxShadow='0 0 18px rgba(52,211,153,0.9),0 0 40px rgba(52,211,153,0.45)';
									setTimeout(function(){
										copyBtn.textContent='📋 COPIA MANIFEST URL';
										copyBtn.style.background='linear-gradient(135deg,#1e3a8a,#2563eb)';
										copyBtn.style.borderColor='#60a5fa';
										copyBtn.style.boxShadow='0 0 18px rgba(96,165,250,0.9),0 0 40px rgba(96,165,250,0.45)';
									},1600);
								});
							} catch(e) { alert('Copia manualmente: ' + manifestUrl); }
						});
					}

					// Back button
					var backBtn = document.getElementById('guidedBackBtn');
					if(backBtn){
						backBtn.addEventListener('click', function(){
							panel.remove();
							if(presetGrid) presetGrid.style.display = 'grid';
							selectedPresetKey = null;
							presetCards.forEach(function(c){ c.style.borderColor='rgba(140,82,255,0.4)'; c.style.background='rgba(45,21,68,0.7)'; });
						});
					}
				}
			})();
			</script>
		</body>

		</html>`;
		}
		}

		// Assembla l'HTML completo
		return `
	<!DOCTYPE html>
	<html lang="it">
	<head>
		<meta charset="UTF-8">
		<meta name="viewport" content="width=device-width, initial-scale=1.0">
		<title>${manifest.name || 'HanX'} - Config</title>
		<style>
			${STYLESHEET}
		</style>
	</head>
	<body>
		<h1>${manifest.name || 'HanX'}</h1>
		<p>${manifest.description || 'Addon Stremio per anime'}</p>
	
		<!-- Install diretto -->
		<div style="text-align:center; margin:1.5rem 0;">
			<a id="installLink" href="#" class="install-button" style="display:inline-block; padding:12px 24px; background:#8A5AAB; color:#fff; text-decoration:none; border-radius:8px; font-weight:700; font-size:1.1rem;">🎬 Installa su Stremio</a>
		</div>
	
		${contactHTML}
		<div class="container">
			${guidedInstallationHTML}
			${formHTML}
		</div>
		<script>
			// Install link diretto
			(function() {
				var installLink = document.getElementById('installLink');
				if (installLink) {
					var manifestUrl = window.location.protocol + '//' + window.location.host + '/manifest.json';
					installLink.href = 'stremio://install-addon/' + encodeURIComponent(manifestUrl);
				}
			})();
			${script}
		</script>
	</body>
	</html>
		`;
	}

	export { landingTemplate };
