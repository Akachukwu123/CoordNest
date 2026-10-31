document.addEventListener('DOMContentLoaded', () => {
 
  // ── Inject plan header split styles ────────────────────────
  // Applied dynamically when the north arrow clashes with title-block
  (function() {
    const s = document.createElement('style');
    s.textContent = `
      /* When the arrow line moves into the right half of the header,
         move title-block to the left half and arrow-box to the right half */
      #plan-overlay .surv-header.header-split {
        display: flex !important;
        flex-direction: row !important;
        align-items: flex-start !important;
        justify-content: space-between !important;
      }
      #plan-overlay .surv-header.header-split .title-block {
        order: 1;
        width: 50% !important;
        flex: 0 0 50% !important;
        margin-right: auto !important;
        text-align: center;
      }
      #plan-overlay .surv-header.header-split .arrow-box {
        order: 2;
        width: 50% !important;
        flex: 0 0 50% !important;
        margin-left: auto !important;
        justify-content: flex-end;
        position: relative;
        overflow: visible;
      }
      #plan-overlay .surv-header.header-split .upper-plan-no {
        margin-left: auto !important;
        width: 60%;
      }
      }
    `;
    document.head.appendChild(s);
  })();

  // ════════════════════════════════════════════════════════════
  //  PROJECT DROPDOWN
  // ════════════════════════════════════════════════════════════
  const trigger  = document.getElementById('project-dropdown-trigger');
  const dropdown = document.getElementById('project-dropdown');
  if (trigger && dropdown) {
    trigger.addEventListener('click', e => { e.stopPropagation(); dropdown.classList.toggle('active'); });
    document.addEventListener('click', e => { if (!trigger.contains(e.target)) dropdown.classList.remove('active'); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') dropdown.classList.remove('active'); });
  }

  // ════════════════════════════════════════════════════════════
  //  FEEDBACK
  // ════════════════════════════════════════════════════════════
  function showFeedback(id, msg, type = 'success') {
    const el = document.getElementById(id); if (!el) return;
    const s = {
      success: 'color:#2e7d32;background:#e8f5e9;border:1px solid #a5d6a7;',
      warning: 'color:#e65100;background:#fff3e0;border:1px solid #ffcc80;',
      info:    'color:#01579b;background:#e1f5fe;border:1px solid #81d4fa;'
    };
    el.style.cssText = `display:block;font-size:13px;border-radius:6px;padding:8px 12px;margin-bottom:8px;opacity:1;transition:opacity 0.5s ease;${s[type]||s.info}`;
    el.textContent = msg;
    if (el._t) clearTimeout(el._t);
    el._t = setTimeout(() => { el.style.opacity='0'; setTimeout(()=>{ el.style.display='none'; el.style.opacity='1'; },500); }, 2500);
  }
  const SC = (m,t) => showFeedback('coord-feedback',   m, t);
  const SP = (m,t) => showFeedback('plot-feedback',     m, t);
  const SE = (m,t) => showFeedback('export-feedback',   m, t);
  const SG = (m,t) => showFeedback('generate-feedback', m, t);

  // ════════════════════════════════════════════════════════════
  //  ELEMENTS
  // ════════════════════════════════════════════════════════════
  const quickInput = document.getElementById('quick-input');
  const tbody      = document.querySelector('#coord-table tbody');
  const swapBtn    = document.getElementById('swap-btn');
  const coordTable = document.getElementById('coord-table');
  const coordSystemSelect = document.getElementById('plan-coordinate-system');
  const accessRoadOffsetInput = document.getElementById('access-road-offset');

  // ════════════════════════════════════════════════════════════
  //  LOCALSTORAGE
  // ════════════════════════════════════════════════════════════
  const isNewFileWindow = new URLSearchParams(window.location.search).has('newfile');
  if (isNewFileWindow) sessionStorage.removeItem('cn_tab_key');
  let LS_KEY = sessionStorage.getItem('cn_tab_key');
  if (!LS_KEY) {
    LS_KEY = 'coordnest_' + Date.now() + '_' + Math.random().toString(36).slice(2);
    sessionStorage.setItem('cn_tab_key', LS_KEY);
  }
  const projectSyncConfig = window.CN_PROJECT_SYNC || {};
  const isServerSyncEnabled = !!projectSyncConfig.isLoggedIn;
  const currentUserId = Number.isFinite(Number(projectSyncConfig.userId)) ? Number(projectSyncConfig.userId) : null;
  const projectApiUrl = projectSyncConfig.apiUrl || window.location.pathname + '?project_api=1';
  const projectType = projectSyncConfig.projectType || 'cadastral';
  let activeProjectId = Number.isFinite(Number(projectSyncConfig.projectId)) ? Number(projectSyncConfig.projectId) : null;
  if (isNewFileWindow) activeProjectId = null;
  const shouldStartBlankProject = isNewFileWindow || (isServerSyncEnabled && !activeProjectId);
  if (shouldStartBlankProject) {
    try { localStorage.removeItem(LS_KEY); } catch(e) {}
    sessionStorage.removeItem('cn_tab_key');
    LS_KEY = 'coordnest_' + Date.now() + '_' + Math.random().toString(36).slice(2);
    sessionStorage.setItem('cn_tab_key', LS_KEY);
  }
  let syncTimer = null;
  let syncInFlight = false;
  let pendingSyncAfterFlight = false;
  let hasHydratedRemoteState = false;
  if (isNewFileWindow && window.history?.replaceState) {
    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete('newfile');
    window.history.replaceState({}, '', cleanUrl.toString());
  }

  function getPlanFormDataFromStorage() {
    try { return JSON.parse(localStorage.getItem(PLAN_FORM_KEY) || 'null') || {}; } catch(e) { return {}; }
  }

  function buildProjectStatePayload() {
    return {
      lsKey: LS_KEY,
      projectType,
      appState: loadState(),
      planFormState: getPlanFormDataFromStorage(),
      ownerUserId: currentUserId,
      savedAt: new Date().toISOString()
    };
  }

  function hasMeaningfulProjectState(state) {
    if (!state || typeof state !== 'object') return false;
    const appState = state.appState || state;
    const points = appState?.points;
    const projectName = (appState?.projectName || '').trim();
    const hasCustomProjectName = projectName !== '' && projectName.toLowerCase() !== 'untitled';
    return !!((Array.isArray(points) && points.length >= 1) || hasCustomProjectName);
  }

  function isStateOwnedByAnotherUser(state) {
    if (!state || typeof state !== 'object') return false;
    const ownerUserId = state.ownerUserId ?? state.appState?.ownerUserId ?? state.savedUserId ?? state.appState?.savedUserId ?? null;
    if (!ownerUserId) return false;
    return !currentUserId || Number(ownerUserId) !== Number(currentUserId);
  }

  async function syncProjectToServer() {
    if (!isServerSyncEnabled || syncInFlight) return;
    const payload = buildProjectStatePayload();
    if (!hasMeaningfulProjectState(payload)) return;
    syncInFlight = true;
    pendingSyncAfterFlight = false;
    try {
      const body = new URLSearchParams();
      body.set('project_api', '1');
      body.set('action', 'sync_project');
      if (activeProjectId) body.set('project_id', String(activeProjectId));
      body.set('browser_project_key', LS_KEY);
      body.set('project_type', projectType);
      body.set('project_name', payload.appState?.projectName || 'Untitled');
      body.set('project_state', JSON.stringify(payload));
      const res = await fetch(projectApiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
        body: body.toString(),
        credentials: 'same-origin'
      });
      const data = await res.json();
      if (res.ok && data?.ok && data.project_id) {
        activeProjectId = Number(data.project_id) || activeProjectId;
      }
    } catch (err) {
      console.warn('Project sync failed.', err);
    } finally {
      syncInFlight = false;
      if (pendingSyncAfterFlight) scheduleProjectSync(1500);
    }
  }

  function scheduleProjectSync(delay = 1200) {
    if (!isServerSyncEnabled) return;
    if (syncInFlight) {
      pendingSyncAfterFlight = true;
      return;
    }
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      syncTimer = null;
      syncProjectToServer();
    }, delay);
  }

  function hydrateLocalProjectState(payload) {
    if (!payload || typeof payload !== 'object') return false;
    if (isStateOwnedByAnotherUser(payload)) return false;
    const nextLsKey = payload.lsKey || LS_KEY;
    const appState = payload.appState || null;
    const planFormState = payload.planFormState || {};
    if (!appState) return false;
    if (currentUserId) appState.ownerUserId = currentUserId;
    LS_KEY = nextLsKey;
    sessionStorage.setItem('cn_tab_key', LS_KEY);
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(appState));
      localStorage.setItem(PLAN_FORM_KEY, JSON.stringify(planFormState));
    } catch (e) {}
    return true;
  }

  async function loadProjectFromServer(projectId = null) {
    if (!isServerSyncEnabled) return null;
    const url = new URL(projectApiUrl, window.location.href);
    url.searchParams.set('action', 'load_project');
    url.searchParams.set('project_type', projectType);
    if (projectId) url.searchParams.set('project_id', String(projectId));
    try {
      const res = await fetch(url.toString(), { credentials: 'same-origin' });
      const data = await res.json();
      if (res.ok && data?.ok) {
        return data.project || null;
      }
    } catch (err) {
      console.warn('Project load failed.', err);
    }
    return null;
  }

  function saveState() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        points:        currentPoints,
        originIndex:   originIndex,
        pillarLabels:  pillarLabels,
        accessLines:   [...accessLines],
        labelPositions: labelPositions,   // persisted drag positions
        deletedLabels:  [...deletedLabels],
        fontSize:      currentFontSize,
        scale:         currentScale,
        surveyForm:    getSurveyFormData(),
        projectName:   document.querySelector('.project-name-input')?.value || '',
        ownerUserId:   currentUserId
      }));
    } catch(e) {}
    scheduleProjectSync();
  }

  function loadState() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch(e) { return null; }
  }

  function clearState() {
    try { localStorage.removeItem(LS_KEY); } catch(e) {}
    if (typeof PLAN_FORM_KEY !== 'undefined') {
      try { localStorage.removeItem(PLAN_FORM_KEY); } catch(e) {}
    }
  }

  function getSurveyFormData() {
    const ids = ['sf-client','sf-address','sf-state','sf-origin','sf-origin2',
                 'sf-surveyor','sf-office','sf-surv-state','sf-date','sf-plan-no','sf-dep-no'];
    const out = {};
    ids.forEach(id => { const el=document.getElementById(id); if(el) out[id]=el.value; });
    return out;
  }

  // ════════════════════════════════════════════════════════════
  //  STATE
  // ════════════════════════════════════════════════════════════
  let currentPoints  = [];
  let originIndex    = -1;
  let pillarLabels   = [];
  let accessLines    = new Set();
  let currentFontSize = 14;
  let currentScale    = 500;

  // ── Persistent label positions ────────────────────────────
  // Key = textId, value = { x, y }
  // When a label is dragged we store its final position here.
  // renderPlot() checks this first before calculating a default position.
  // This means dragged positions survive re-renders from right-panel actions.
  let labelPositions = {};   // { textId: {x, y} }
  let deletedLabels  = new Set(); // textIds the user has explicitly deleted — skip on re-render

  function clearScaleSensitivePositions() {
    Object.keys(labelPositions).forEach(key => {
      if (
        key.startsWith('txt-pt-') ||
        key.startsWith('junc-') ||
        key.startsWith('txt-ar-') ||
        key.startsWith('line-ar-outer-') ||
        key.startsWith('line-ar-cap1-') ||
        key.startsWith('line-ar-cap2-')
      ) {
        delete labelPositions[key];
      }
    });
  }

  // ════════════════════════════════════════════════════════════
  //  SCALE SELECTOR
  // ════════════════════════════════════════════════════════════
  const scaleSelect = document.querySelector('#scale select');
  if (scaleSelect) {
    scaleSelect.addEventListener('change', () => {
      currentScale = parseInt(scaleSelect.value.replace('1:','').trim()) || 500;
      clearScaleSensitivePositions();
      if (currentPoints.length >= 3) renderPlot(currentPoints);
      updatePlanHeaderMeta();
      requestAnimationFrame(() => requestAnimationFrame(injectPlanPlot));
      saveState();
    });
  }

  function getScaleDenominator() {
    if (scaleSelect) currentScale = parseInt(scaleSelect.value.replace('1:','').trim()) || 500;
    return currentScale;
  }

  function getAccessRoadOffsetMeters() {
    const raw = accessRoadOffsetInput?.value?.trim() || '7';
    const value = parseFloat(raw);
    return (!Number.isNaN(value) && value >= 0) ? value : 7;
  }

  // ════════════════════════════════════════════════════════════
  //  FONT SIZE SLIDER
  // ════════════════════════════════════════════════════════════
  // Track which text element is currently selected for rotation
  let selectedTextId = null;

  function injectFontSlider() {
    // Target the #drag-lines div in the right panel (as defined in HTML).
    // Fall back to appending to .plot-panel if somehow not found.
    if (document.getElementById('font-slider-bar')) return;
    const dragLinesEl = document.getElementById('drag-lines');
    const bar = document.createElement('div');
    bar.id = 'font-slider-bar';
    bar.style.cssText = [
      'display:flex', 'flex-direction:column', 'gap:8px',
      'padding:10px 0', 'font-size:13px',
      "font-family:'Poppins',sans-serif", 'color:#444'
    ].join(';') + ';';
    bar.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;">
        <label for="font-slider" style="white-space:nowrap;font-weight:500;min-width:80px;">Text size:</label>
        <input id="font-slider" type="range" min="7" max="22" value="${currentFontSize}"
          style="flex:1;accent-color:#6366f1;cursor:pointer;" />
        <span id="font-size-display" style="min-width:32px;text-align:right;">${currentFontSize}px</span>
      </div>
      <div style="display:flex;align-items:center;gap:8px;">
        <label for="rotate-slider" style="white-space:nowrap;font-weight:500;min-width:80px;"
          title="Click a label on the plot first, then use this slider to rotate it">
          Rotate label:
        </label>
        <input id="rotate-slider" type="range" min="-180" max="180" value="0"
          style="flex:1;accent-color:#f59e0b;cursor:pointer;" />
        <span id="rotate-display" style="min-width:32px;text-align:right;">0°</span>
      </div>
      <p style="margin:2px 0 0;font-size:11px;color:#999;">Click a label on the plot to select it, then rotate.</p>`;
    if (dragLinesEl) {
      dragLinesEl.appendChild(bar);
      dragLinesEl.style.display = 'block';
    } else {
      // fallback — append beneath plot container
      const panel = document.querySelector('.plot-panel');
      if (panel) panel.appendChild(bar);
    }
    document.getElementById('font-slider').addEventListener('input', function() {
      currentFontSize = parseInt(this.value);
      document.getElementById('font-size-display').textContent = currentFontSize + 'px';
      // Update all text nodes directly — avoids wiping the SVG and losing custom elements
      const svg = getSVGEl();
      if (svg) {
        svg.querySelectorAll('[data-textid]').forEach(el => {
          el.setAttribute('font-size', currentFontSize + 'px');
        });
        customElements.forEach(e => {
          if (e.type === 'text' && e.node) {
            d3.select(e.node).attr('font-size', currentFontSize + 'px');
          }
        });
      }
      saveState();
    });
    document.getElementById('rotate-slider').addEventListener('input', function() {
      const deg = parseInt(this.value);
      document.getElementById('rotate-display').textContent = deg + '°';

      // ── Rotate a custom drawn element (square / line / custom text) ──
      if (selectedDrawEl) {
        const entry = customElements.find(e => e.id === selectedDrawEl);
        if (entry) {
          if (entry.type === 'rect') {
            const cx = entry.x + entry.w / 2, cy = entry.y + entry.h / 2;
            entry.angle = deg;
            d3.select(entry.node).attr('transform', `rotate(${deg},${cx},${cy})`);
          } else if (entry.type === 'line') {
            const mx = (entry.x1 + entry.x2) / 2, my = (entry.y1 + entry.y2) / 2;
            const len = Math.sqrt((entry.x2 - entry.x1) ** 2 + (entry.y2 - entry.y1) ** 2);
            const rad = deg * Math.PI / 180;
            entry.x1 = mx - Math.cos(rad) * len / 2;
            entry.y1 = my - Math.sin(rad) * len / 2;
            entry.x2 = mx + Math.cos(rad) * len / 2;
            entry.y2 = my + Math.sin(rad) * len / 2;
            d3.select(entry.node)
              .attr('x1', entry.x1).attr('y1', entry.y1)
              .attr('x2', entry.x2).attr('y2', entry.y2);
            repositionHandles(entry);
          } else if (entry.type === 'text') {
            entry.angle = deg;
            d3.select(entry.node)
              .attr('data-angle', deg)
              .attr('transform', `rotate(${deg},${entry.x},${entry.y})`);
            repositionHandles(entry);
          }
          return;
        }
      }

      // ── Rotate an existing plot label (bearing text etc.) ──
      if (!selectedTextId) return;
      const svg = document.querySelector('#plot-container svg');
      if (!svg) return;
      const el = svg.querySelector(`[data-textid="${selectedTextId}"]`);
      if (!el) return;
      const x = parseFloat(el.getAttribute('x'));
      const y = parseFloat(el.getAttribute('y'));
      el.setAttribute('data-angle', deg);
      el.setAttribute('transform', `rotate(${deg},${x},${y})`);
      if (!labelPositions[selectedTextId]) labelPositions[selectedTextId] = { x, y };
      labelPositions[selectedTextId].angle = deg;
      saveState();
    });
  }
  injectFontSlider();

  // ════════════════════════════════════════════════════════════
  //  NEW FILE / RESET
  // ════════════════════════════════════════════════════════════
  document.querySelector('.new-project button')?.addEventListener('click', () => {
    const url = new URL(window.location.href);
    url.searchParams.delete('project_id');
    url.searchParams.set('newfile', Date.now().toString());
    window.open(url.toString(), '_blank');
  });

  document.getElementById('clear-all')?.addEventListener('click', () => {
    const projectName = document.querySelector('.project-name-input')?.value || '';
    currentPoints = []; originIndex = -1; pillarLabels = [];
    accessLines = new Set(); labelPositions = {}; deletedLabels = new Set();
    clearState();
    const container = document.getElementById('plot-container');
    if (container) container.innerHTML = '<div class="placeholder-text">Plot will appear here after you click Plot</div>';
    if (quickInput) quickInput.value = '';
    tbody.innerHTML = `<tr><td>P1</td><td><input type="text" value=""/></td><td><input type="text" value=""/></td></tr>`;
    hideTable();
    const av = document.getElementById('area-value'); if (av) av.textContent = '0';
    updatePlanHeaderMeta();
    hidePostPlotSections();
    const pn = document.querySelector('.project-name-input'); if (pn) pn.value = projectName;
  });

  // ════════════════════════════════════════════════════════════
  //  TABLE HELPERS
  // ════════════════════════════════════════════════════════════
  function hideTable() { coordTable.style.display='none'; swapBtn.style.display='none'; }
  function showTable() { coordTable.style.display='table'; swapBtn.style.display='block'; }
  hideTable();

  function isValidCoord(v) { return /^-?\d+(\.\d+)?$/.test(v.trim()); }

  // pillarLabels[i] if set and non-empty, else P(i+1)
  function ptLabel(i) {
    return (pillarLabels[i] && pillarLabels[i].trim()) ? pillarLabels[i] : `P${i+1}`;
  }

  // ════════════════════════════════════════════════════════════
  //  QUICK INPUT
  // ════════════════════════════════════════════════════════════
  function processInput() {
    const text = quickInput?.value.trim() || '';
    if (!text) { hideTable(); tbody.innerHTML=`<tr><td>${ptLabel(0)}</td><td><input type="text" value=""/></td><td><input type="text" value=""/></td></tr>`; return; }
    const tokens = text.split(/[\s,]+/).filter(t=>t.trim()!=='');
    const bad = tokens.filter(t=>!isValidCoord(t));
    if (bad.length) { SC(`Invalid value: "${bad[0]}" — numbers only.`,'warning'); hideTable(); return; }
    if (tokens.length < 2) { SC('Enter at least one coordinate pair.','warning'); return; }
    tbody.innerHTML = '';
    for (let i=0; i<tokens.length; i+=2) {
      const tr=document.createElement('tr');
      tr.innerHTML=`<td>${ptLabel(Math.floor(i/2))}</td><td><input type="text" value="${tokens[i]||''}"/></td><td><input type="text" value="${tokens[i+1]||''}"/></td>`;
      tbody.appendChild(tr);
    }
    showTable();
    SC(`${Math.floor(tokens.length/2)} point(s) ready.`,'success');
  }

  quickInput?.addEventListener('input', processInput);
  quickInput?.addEventListener('paste', () => setTimeout(processInput, 10));

  document.getElementById('quick-input-clear')?.addEventListener('click', () => {
    if (quickInput) quickInput.value = '';
    tbody.innerHTML=`<tr><td>${ptLabel(0)}</td><td><input type="text" value=""/></td><td><input type="text" value=""/></td></tr>`;
    hideTable();
  });

  swapBtn?.addEventListener('click', () => {
    tbody.querySelectorAll('tr').forEach(row => {
      const ei=row.cells[1].querySelector('input'), ni=row.cells[2].querySelector('input');
      if (ei&&ni) { const t=ei.value; ei.value=ni.value; ni.value=t; }
    });
    SC('Eastings and Northings swapped.','info');
  });

  // ════════════════════════════════════════════════════════════
  //  FILE UPLOAD
  // ════════════════════════════════════════════════════════════
  document.getElementById('file-upload')?.addEventListener('change', function() {
    const file=this.files[0]; if(!file) return;
    const ext=file.name.split('.').pop().toLowerCase();
    if (ext==='xlsx'||ext==='xls') {
      const r=new FileReader();
      r.onload=e=>{ try { const wb=XLSX.read(new Uint8Array(e.target.result),{type:'array'}); populateTableFromParsed(parseCoordinateText(XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]])),file.name); } catch { SC('Could not read Excel file.','warning'); } };
      r.readAsArrayBuffer(file);
    } else {
      const r=new FileReader();
      r.onload=e=>populateTableFromParsed(parseCoordinateText(e.target.result),file.name);
      r.onerror=()=>SC('Error reading file.','warning');
      r.readAsText(file);
    }
    this.value='';
  });

  // ════════════════════════════════════════════════════════════
  //  PARSER
  // ════════════════════════════════════════════════════════════
  function splitLine(line) {
    if (line.includes('\t')) return line.split('\t');
    if (line.includes(','))  return line.split(',');
    if (line.includes(';'))  return line.split(';');
    return line.trim().split(/\s{2,}/);
  }
  function classifyHeader(h) {
    h=h.trim().toLowerCase();
    if (/^(point|pt|station|stn|no\.?|#|id)$/i.test(h)) return 'point';
    if (/north|northing|^n$/i.test(h)) return 'northing';
    if (/east|easting|^e$/i.test(h))   return 'easting';
    if (/^x$/i.test(h)) return 'easting';
    if (/^y$/i.test(h)) return 'northing';
    return 'unknown';
  }
  function isNum(s) { return /^-?\d+(\.\d+)?$/.test(String(s).replace(/,/g,'').trim()); }

  function parseCoordinateText(raw) {
    const lines=raw.split(/\r?\n/).map(l=>l.trim()).filter(l=>l.length>0);
    if (!lines.length) return [];
    const fc=splitLine(lines[0]).map(c=>c.trim());
    const isHdr=fc.some(c=>/[a-zA-Z]/.test(c)&&!isNum(c));
    let hmap=null, ds=isHdr?1:0;
    if (isHdr) {
      const cl=fc.map(classifyHeader);
      const pc=cl.indexOf('point'),ec=cl.indexOf('easting'),nc=cl.indexOf('northing');
      if (ec!==-1||nc!==-1) hmap={pc,ec,nc};
    }
    const res=[];
    for (let i=ds;i<lines.length;i++) {
      const cells=splitLine(lines[i]).map(c=>c.trim());
      if (cells.length<2||cells.filter(isNum).length<2) continue;
      let pt='',e='',n='';
      if (hmap) {
        pt=hmap.pc!==-1?(cells[hmap.pc]||`P${res.length+1}`):`P${res.length+1}`;
        e=hmap.ec!==-1?(cells[hmap.ec]||''):''; n=hmap.nc!==-1?(cells[hmap.nc]||''):'';
      } else {
        const ni=cells.findIndex(c=>!isNum(c));
        if (ni!==-1){pt=cells[ni];const ns=cells.filter((_,idx)=>idx!==ni&&isNum(cells[idx]));e=ns[0]||'';n=ns[1]||'';}
        else if(cells.length>=3){const mi=parseFloat(cells[0].replace(/,/g,''));if(Number.isInteger(mi)&&mi<10000){pt=`P${cells[0]}`;e=cells[1];n=cells[2];}else{pt=`P${res.length+1}`;e=cells[0];n=cells[1];}}
        else{pt=`P${res.length+1}`;e=cells[0];n=cells[1];}
      }
      if (!pt) pt=`P${res.length+1}`;
      e=e.replace(/,/g,''); n=n.replace(/,/g,'');
      if (e||n) res.push({point:pt,easting:e,northing:n});
    }
    return res;
  }

  function populateTableFromParsed(rows, fname) {
    tbody.innerHTML='';
    if (!rows.length) { tbody.innerHTML=`<tr><td>${ptLabel(0)}</td><td><input type="text" value=""/></td><td><input type="text" value=""/></td></tr>`; SC('No coordinates found.','warning'); return; }
    rows.forEach((row,i)=>{ const tr=document.createElement('tr'); tr.innerHTML=`<td>${ptLabel(i)}</td><td><input type="text" value="${row.easting}"/></td><td><input type="text" value="${row.northing}"/></td>`; tbody.appendChild(tr); });
    SC(`${rows.length} points loaded from "${fname}"`, 'success'); showTable();
  }

  // ════════════════════════════════════════════════════════════
  //  PLOT BUTTON
  // ════════════════════════════════════════════════════════════
  document.getElementById('plot-btn')?.addEventListener('click', () => {
    const rows=tbody.querySelectorAll('tr'), pts=[], bad=[];
    rows.forEach(row=>{
      const ei=row.cells[1]?.querySelector('input'), ni=row.cells[2]?.querySelector('input');
      if (!ei||!ni) return;
      const ev=ei.value.trim(), nv=ni.value.trim();
      if (ev===''&&nv==='') return;
      if (!isValidCoord(ev)||!isValidCoord(nv)){ bad.push(ev||nv); return; }
      pts.push({easting:parseFloat(ev), northing:parseFloat(nv)});
    });
    if (bad.length){ SP(`Invalid value: "${bad[0]}"`, 'warning'); return; }
    if (pts.length<3){ SP('At least 3 points needed.', 'warning'); return; }
    // New plot — clear saved positions so labels start fresh
    labelPositions = {};
    deletedLabels  = new Set();
    currentPoints = pts;
    originIndex = -1;
    renderPlot(currentPoints);
    buildRightPanel();
    saveState();
  });

  // ════════════════════════════════════════════════════════════
  //  SURVEY MATH
  // ════════════════════════════════════════════════════════════
  function calcDist(p1,p2){ return Math.sqrt((p2.easting-p1.easting)**2+(p2.northing-p1.northing)**2); }
  function calcWCB(p1,p2) { let b=Math.atan2(p2.easting-p1.easting,p2.northing-p1.northing)*180/Math.PI; if(b<0)b+=360; return b; }

  // Split bearing into degrees integer and minutes string
  function bearingParts(deg) {
    const d = Math.floor(deg);
    const m = Math.floor((deg - d) * 60);
    return { deg: `${String(d).padStart(3,'0')}\u00b0`, min: `${String(m).padStart(2,'0')}'` };
  }

  function toDM_dxf(deg){ const d=Math.floor(deg),m=Math.floor((deg-d)*60); return `${String(d).padStart(3,'0')}d${String(m).padStart(2,'0')}m`; }
  function toDM_full(deg){ const {deg:d,min:m}=bearingParts(deg); return d+m; }
  function calcArea(pts){ let a=0,c=pts.length; for(let i=0;i<c;i++){const j=(i+1)%c;a+=pts[i].easting*pts[j].northing-pts[j].easting*pts[i].northing;} return Math.abs(a)/2; }

  // ════════════════════════════════════════════════════════════
  //  CONSTANTS
  // ════════════════════════════════════════════════════════════
  const REF_SCALE      = 500;
  const SHORT_M        = 6;          // real-world metres — use leader below this
  const ACCESS_ROAD_W_M = 5.0;       // access road width in real-world metres

  // ════════════════════════════════════════════════════════════
  //  DRAGGABLE TEXT — no delete button, positions persisted
  // ════════════════════════════════════════════════════════════
  function makeDraggableText(g, defaultX, defaultY, txt, angle, textId, anchor='middle') {
    // Skip labels the user has explicitly deleted — they should not re-appear on re-render
    if (deletedLabels.has(textId)) return null;
    // Use persisted position if available, else use calculated default
    const pos = labelPositions[textId];
    const x   = pos ? pos.x : defaultX;
    const y   = pos ? pos.y : defaultY;
    // Use persisted angle if available (from rotation slider), else use passed angle
    const resolvedAngle = (pos && pos.angle !== undefined) ? pos.angle : angle;

    const el = g.append('text')
      .attr('x', x).attr('y', y)
      .attr('text-anchor', anchor)
      .attr('dominant-baseline', 'middle')
      .attr('font-size', currentFontSize + 'px')
      .attr('font-family', 'monospace')
      .attr('fill', '#333')
      .attr('cursor', 'crosshair')
      .attr('data-angle', resolvedAngle)
      .attr('data-textid', textId)
      .attr('transform', `rotate(${resolvedAngle},${x},${y})`)
      .text(txt);

    // Clicking selects this text for rotation
    el.on('click.select', function(event) {
      event.stopPropagation();
      selectedTextId = textId;
      // Sync rotate slider to this element's current angle
      const rs = document.getElementById('rotate-slider');
      const rd = document.getElementById('rotate-display');
      if (rs) { rs.value = resolvedAngle; }
      if (rd) { rd.textContent = resolvedAngle + '°'; }
      // Visual highlight: briefly outline
      d3.selectAll('[data-textid]').attr('fill', '#333');
      el.attr('fill', '#6366f1');
    });

    el.on('mousedown.drag', function(event) {
      event.stopPropagation(); event.preventDefault();
      const ox=parseFloat(el.attr('x')), oy=parseFloat(el.attr('y'));
      const sx0=event.clientX, sy0=event.clientY;
      const k=d3.zoomTransform(el.node().ownerSVGElement).k;
      const ang=parseFloat(el.attr('data-angle')||0);
      el.style('cursor','grabbing');
      function mv(e) {
        const nx=ox+(e.clientX-sx0)/k, ny=oy+(e.clientY-sy0)/k;
        el.attr('x',nx).attr('y',ny).attr('transform',`rotate(${ang},${nx},${ny})`);
        // Persist position immediately so re-renders use it
        if (!labelPositions[textId]) labelPositions[textId] = {};
        labelPositions[textId].x = nx;
        labelPositions[textId].y = ny;
        if (labelPositions[textId].angle === undefined) labelPositions[textId].angle = ang;
      }
      function up() {
        el.style('cursor','crosshair');
        window.removeEventListener('mousemove',mv);
        window.removeEventListener('mouseup',up);
        saveState();
      }
      window.addEventListener('mousemove',mv);
      window.addEventListener('mouseup',up);
    });

    return el;
  }

  // ════════════════════════════════════════════════════════════
  //  DRAGGABLE LINE — for access road lines
  // ════════════════════════════════════════════════════════════
  function makeDraggableLine(g, defaultX1, defaultY1, defaultX2, defaultY2, lineId, strokeColor, strokeWidth, dashArray) {
    const pos = labelPositions[lineId];
    let x1,y1,x2,y2;
    if (pos) { x1=pos.x1; y1=pos.y1; x2=pos.x2; y2=pos.y2; }
    else { x1=defaultX1; y1=defaultY1; x2=defaultX2; y2=defaultY2; }

    const origStroke = strokeColor || '#333';

    const el = g.append('line')
      .attr('x1',x1).attr('y1',y1).attr('x2',x2).attr('y2',y2)
      .attr('stroke', origStroke)
      .attr('stroke-width',strokeWidth||1)
      .attr('stroke-dasharray',dashArray||'none')
      .attr('data-arid', lineId)
      .attr('cursor','grab');

    // Register in arLineElements registry
    // Derive the boundary segment index from id: 'line-ar-outer-N', 'line-ar-cap1-N', 'line-ar-cap2-N'
    const lineIndexMatch = lineId.match(/line-ar-(?:outer|cap1|cap2)-(\d+)$/);
    const lineIndex = lineIndexMatch ? parseInt(lineIndexMatch[1]) : -1;
    const arEntry = { id: lineId, lineIndex, node: el.node(), origStroke, origWidth: strokeWidth||1, x1, y1, x2, y2 };
    arLineElements.push(arEntry);

    // Click to select
    el.on('click.arselect', function(event) {
      event.stopPropagation();
      selectARLine(lineId);
    });

    el.on('mousedown.drag', function(event) {
      event.stopPropagation(); event.preventDefault();
      selectARLine(lineId);
      const cx1=parseFloat(el.attr('x1')), cy1=parseFloat(el.attr('y1'));
      const cx2=parseFloat(el.attr('x2')), cy2=parseFloat(el.attr('y2'));
      const sx0=event.clientX, sy0=event.clientY;
      const k=d3.zoomTransform(el.node().ownerSVGElement).k;
      el.style('cursor','grabbing');
      function mv(e) {
        const dx=(e.clientX-sx0)/k, dy=(e.clientY-sy0)/k;
        const nx1=cx1+dx, ny1=cy1+dy, nx2=cx2+dx, ny2=cy2+dy;
        el.attr('x1',nx1).attr('y1',ny1).attr('x2',nx2).attr('y2',ny2);
        arEntry.x1=nx1; arEntry.y1=ny1; arEntry.x2=nx2; arEntry.y2=ny2;
        labelPositions[lineId]={x1:nx1,y1:ny1,x2:nx2,y2:ny2};
      }
      function up() { el.style('cursor','grab'); window.removeEventListener('mousemove',mv); window.removeEventListener('mouseup',up); saveState(); }
      window.addEventListener('mousemove',mv); window.addEventListener('mouseup',up);
    });

    return el;
  }

  // ── Select an AR line ─────────────────────────────────────
  function selectARLine(id) {
    deselectAll(); // clears customElements selection AND arLineElements selection
    selectedARLine = id;
    const entry = arLineElements.find(e => e.id === id);
    if (!entry || !entry.node) return;
    d3.select(entry.node).attr('stroke', '#6366f1').attr('stroke-width', 2);
  }

  // ── Deselect all AR lines (called inside deselectAll) ─────
  function deselectAllARLines() {
    arLineElements.forEach(e => {
      if (e.node) d3.select(e.node).attr('stroke', e.origStroke || '#333').attr('stroke-width', e.origWidth || 1);
    });
    selectedARLine = null;
  }
  // ════════════════════════════════════════════════════════════
  //  GEOMETRY HELPERS
  // ════════════════════════════════════════════════════════════

  /**
   * Ray-casting point-in-polygon test (screen coordinates).
   * Returns true if (px,py) is strictly inside the polygon defined by screenPts.
   */
  function pointInPolygonScreen(px, py, screenPts) {
    let inside = false;
    const n = screenPts.length;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = screenPts[i].x, yi = screenPts[i].y;
      const xj = screenPts[j].x, yj = screenPts[j].y;
      const intersect = ((yi > py) !== (yj > py)) &&
        (px < (xj - xi) * (py - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  /**
   * Segment intersection: returns the intersection point of segments
   * (ax1,ay1)-(ax2,ay2) and (bx1,by1)-(bx2,by2), or null if they don't intersect.
   * Uses parametric form; returns { x, y, tA, tB } where tA,tB ∈ [0,1].
   */
  function segmentIntersection(ax1, ay1, ax2, ay2, bx1, by1, bx2, by2) {
    const dAx = ax2 - ax1, dAy = ay2 - ay1;
    const dBx = bx2 - bx1, dBy = by2 - by1;
    const denom = dAx * dBy - dAy * dBx;
    if (Math.abs(denom) < 1e-10) return null; // parallel
    const tA = ((bx1 - ax1) * dBy - (by1 - ay1) * dBx) / denom;
    const tB = ((bx1 - ax1) * dAy - (by1 - ay1) * dAx) / denom;
    if (tA < -1e-6 || tA > 1 + 1e-6 || tB < -1e-6 || tB > 1 + 1e-6) return null;
    return {
      x: ax1 + tA * dAx,
      y: ay1 + tA * dAy,
      tA, tB
    };
  }

  // ════════════════════════════════════════════════════════════
  //  MAIN RENDER
  // ════════════════════════════════════════════════════════════
  function renderPlot(points) {
    if (!points||points.length<3) return;
    // Clear text selection state on re-render
    selectedTextId = null;
    selectedARLine = null;
    // Clear AR line registry — will be repopulated by makeDraggableLine calls below
    arLineElements = [];
    const rs = document.getElementById('rotate-slider');
    const rd = document.getElementById('rotate-display');
    if (rs) rs.value = 0;
    if (rd) rd.textContent = '0°';

    const scaleDenom = getScaleDenominator();
    const container  = document.getElementById('plot-container');
    const totalW     = container.clientWidth  || 700;
    const totalH     = container.clientHeight || 560;

    // Physical sizing at chosen scale, capped to A4
    const MM_TO_PX = 3.7795;
    const A4_W_MM  = 185, A4_H_MM = 265;
    const maxDrawW = A4_W_MM * MM_TO_PX, maxDrawH = A4_H_MM * MM_TO_PX;

    const eastings  = points.map(p=>p.easting);
    const northings = points.map(p=>p.northing);
    const minE=Math.min(...eastings), maxE=Math.max(...eastings);
    const minN=Math.min(...northings),maxN=Math.max(...northings);
    const rangeE=maxE-minE||1, rangeN=maxN-minN||1;

    const physW_px = (rangeE * 1000 / scaleDenom) * MM_TO_PX;
    const physH_px = (rangeN * 1000 / scaleDenom) * MM_TO_PX;
    const fit      = Math.min(maxDrawW/physW_px, maxDrawH/physH_px, 1);
    const drawW    = physW_px * fit;
    const drawH    = physH_px * fit;

    // pxPerMetre in screen space
    const pxPerM   = drawW / rangeE;

    // Inline label offset: 1.5cm real → metres → px
    // 1.5cm at 1:scaleDenom means 1.5cm * scaleDenom / 100 metres on the ground
    // 2mm on paper → real world metres at current scale → screen px
    // 2mm = 0.002m on paper; at 1:S → 0.002 * S metres on the ground
    const offsetPx = (0.002 * scaleDenom) * pxPerM;  // 2mm on paper → screen px

    const labelPad = Math.max(80, currentFontSize * 8);
    const offsetX  = (totalW - drawW) / 2;
    const offsetY  = (totalH - drawH) / 2;

    function sx(e){ return offsetX + (e-minE)/rangeE * drawW; }
    function sy(n){ return offsetY + (1-(n-minN)/rangeN) * drawH; }

    const ptCount = points.length;
    const centX   = points.reduce((s,p)=>s+sx(p.easting),0)/ptCount;
    const centY   = points.reduce((s,p)=>s+sy(p.northing),0)/ptCount;

    // Build SVG
    container.innerHTML = '';
    const svgSel = d3.select('#plot-container')
      .append('svg').attr('width',totalW).attr('height',totalH)
      .style('background','#fff').style('cursor','grab');

    const zoom = d3.zoom().scaleExtent([0.05,20])
      .on('zoom', ev => mainG.attr('transform',ev.transform));
    svgSel.call(zoom).on('dblclick.zoom',null);
    svgSel.on('mousedown',()=>svgSel.style('cursor','grabbing'));
    svgSel.on('mouseup',  ()=>svgSel.style('cursor','grab'));
    svgSel.on('click.deselect', function(event) {
      if (!event.target.closest || !event.target.closest('[data-textid]')) {
        selectedTextId = null;
        d3.selectAll('[data-textid]').attr('fill', '#333');
      }
      // Deselect AR lines unless the click was on one
      if (!event.target.closest || !event.target.closest('[data-arid]')) {
        deselectAllARLines();
      }
    });

    const mainG = svgSel.append('g').attr('class','plot-group');

    // Boundary polygon
    mainG.append('path')
      .datum([...points, points[0]])
      .attr('d', d3.line().x(p=>sx(p.easting)).y(p=>sy(p.northing)))
      .attr('fill','none').attr('stroke','#cc0000').attr('stroke-width',1.5);

    // ── Per-line annotations ──────────────────────────────────
    for (let i=0; i<ptCount; i++) {
      const p1=points[i], p2=points[(i+1)%ptCount];
      const x1=sx(p1.easting), y1=sy(p1.northing);
      const x2=sx(p2.easting), y2=sy(p2.northing);
      const mx=(x1+x2)/2, my=(y1+y2)/2;

      const lineAngle  = Math.atan2(y2-y1, x2-x1);
      const perpAngle  = lineAngle - Math.PI/2;
      const perpX      = Math.cos(perpAngle), perpY=Math.sin(perpAngle);
      const dot        = perpX*(centX-mx)+perpY*(centY-my);
      const outSign    = dot>0?-1:1;

      let dispAngle = lineAngle*180/Math.PI;
      if (dispAngle>90||dispAngle<-90) dispAngle+=180;

      const distReal = calcDist(p1,p2);
      const distStr  = distReal.toFixed(2)+'m';
      const wcb      = calcWCB(p1,p2);
      const {deg: degStr, min: minStr} = bearingParts(wcb);

      const bDegreesId = `txt-b-deg-${i}`;
      const bMinsId    = `txt-b-min-${i}`;
      const dId        = `txt-d-${i}`;

      // Screen length of line
      const screenLen  = Math.sqrt((x2-x1)**2+(y2-y1)**2);
      const charW      = currentFontSize * 0.62;
      const needsLeader = distReal < SHORT_M || (degStr.length * charW) > screenLen * 0.85;

      if (needsLeader) {
        // ── Leader line treatment ────────────────────────────
        // The leader ROOT is fixed at (mx, my) — midpoint of the boundary line.
        // The JUNCTION point (where leader meets shelf) is draggable.
        // The shelf extends left or right from the junction.
        // Degrees and minutes are written ON the shelf; distance below the shelf.

        const leaderLen = 6 * pxPerM;
        const shelfLen  = 10 * pxPerM;

        // Default junction position (persisted if user has dragged it)
        const junctionId = `junc-${i}`;
        const jPos = labelPositions[junctionId];
        const defJx = mx + perpX * outSign * leaderLen;
        const defJy = my + perpY * outSign * leaderLen;
        let jx = jPos ? jPos.x : defJx;
        let jy = jPos ? jPos.y : defJy;

        // Shelf direction: which side of junction has more open space from centroid
        const distLeft  = Math.sqrt((jx - shelfLen - centX)**2 + (jy - centY)**2);
        const distRight = Math.sqrt((jx + shelfLen - centX)**2 + (jy - centY)**2);
        const shelfDir  = distRight >= distLeft ? 1 : -1;
        const shelfEndX = jx + shelfDir * shelfLen;
        const shelfEndY = jy;  // shelf is always horizontal

        // Fixed leader line: root at (mx,my), drawn to current junction
        // We re-draw this as a plain line (not draggable) so its root stays fixed.
        // We use a special group so we can update it when junction moves.
        const leaderGroupId = `g-leader-${i}`;
        const leaderG = mainG.append('g').attr('data-leaderid', leaderGroupId);

        const leaderLine = leaderG.append('line')
          .attr('x1', mx).attr('y1', my)
          .attr('x2', jx).attr('y2', jy)
          .attr('stroke', '#888').attr('stroke-width', 0.8);

        // Shelf line — drawn from junction
        const shelfLine = leaderG.append('line')
          .attr('x1', jx).attr('y1', jy)
          .attr('x2', shelfEndX).attr('y2', shelfEndY)
          .attr('stroke', '#888').attr('stroke-width', 0.8);

        // Degrees and minutes written ON the shelf left-to-right
        const leftPt  = shelfDir > 0 ? jx : shelfEndX;
        const degOnX  = leftPt + shelfLen * 0.25;
        const minOnX  = leftPt + shelfLen * 0.72;
        const aboveY  = jy - currentFontSize * 1.1;

        makeDraggableText(mainG, degOnX, aboveY, degStr, 0, bDegreesId, 'middle');
        makeDraggableText(mainG, minOnX, aboveY, minStr, 0, bMinsId,    'middle');
        makeDraggableText(mainG, (jx+shelfEndX)/2, jy + currentFontSize*1.1, distStr, 0, dId, 'middle');

        // Draggable junction handle (invisible, but interactive)
        // Dragging it moves both the leader end AND the shelf start.
        const handle = leaderG.append('circle')
          .attr('cx', jx).attr('cy', jy)
          .attr('r', 5)
          .attr('fill', 'transparent')
          .attr('stroke', '#6366f1')
          .attr('stroke-width', 0)
          .attr('cursor', 'move')
          .style('cursor', 'move');

        // Show handle border on hover
        handle.on('mouseenter', function() { d3.select(this).attr('stroke-width', 1.5); });
        handle.on('mouseleave', function() { d3.select(this).attr('stroke-width', 0); });

        handle.on('mousedown.drag', function(event) {
          event.stopPropagation(); event.preventDefault();
          const k = d3.zoomTransform(leaderG.node().ownerSVGElement).k;
          let cjx = parseFloat(handle.attr('cx'));
          let cjy = parseFloat(handle.attr('cy'));
          const sx0 = event.clientX, sy0 = event.clientY;

          function mv(e) {
            const dx = (e.clientX - sx0)/k, dy = (e.clientY - sy0)/k;
            const njx = cjx + dx, njy = cjy + dy;
            // Update leader end
            leaderLine.attr('x2', njx).attr('y2', njy);
            // Recompute shelf direction from new junction
            const dL = Math.sqrt((njx - shelfLen - centX)**2 + (njy - centY)**2);
            const dR = Math.sqrt((njx + shelfLen - centX)**2 + (njy - centY)**2);
            const sd = dR >= dL ? 1 : -1;
            const nShelfEndX = njx + sd * shelfLen;
            shelfLine.attr('x1', njx).attr('y1', njy).attr('x2', nShelfEndX).attr('y2', njy);
            handle.attr('cx', njx).attr('cy', njy);
            labelPositions[junctionId] = { x: njx, y: njy };
          }
          function up() {
            window.removeEventListener('mousemove', mv);
            window.removeEventListener('mouseup', up);
            saveState();
          }
          window.addEventListener('mousemove', mv);
          window.addEventListener('mouseup', up);
        });

      } else {
        // ── Inline treatment ─────────────────────────────────
        // Degrees near the LEFT end of the line, minutes near the RIGHT end.
        // "Left" is determined by screen x coordinate — whichever endpoint
        // has smaller x is the left end (handles all line orientations).
        // Both texts offset outward (away from centroid), distance inside.

        // Identify left and right endpoints in screen space
        const leftIsP1 = x1 <= x2;
        const leftX    = leftIsP1 ? x1 : x2;
        const leftY    = leftIsP1 ? y1 : y2;
        const rightX   = leftIsP1 ? x2 : x1;
        const rightY   = leftIsP1 ? y2 : y1;

        // 20% inward from left end, 20% inward from right end
        const degX = leftX  + (rightX-leftX)*0.2 + perpX*outSign*offsetPx;
        const degY = leftY  + (rightY-leftY)*0.2 + perpY*outSign*offsetPx;
        const minX = rightX + (leftX-rightX)*0.2 + perpX*outSign*offsetPx;
        const minY = rightY + (leftY-rightY)*0.2 + perpY*outSign*offsetPx;
        const distX = mx + perpX*-outSign*offsetPx;
        const distY = my + perpY*-outSign*offsetPx;

        makeDraggableText(mainG, degX,  degY,  degStr,  dispAngle, bDegreesId, 'middle');
        makeDraggableText(mainG, minX,  minY,  minStr,  dispAngle, bMinsId,    'middle');
        makeDraggableText(mainG, distX, distY, distStr, dispAngle, dId,        'middle');
      }

      // ── Access road ───────────────────────────────────────
      if (accessLines.has(i)) {
        const ROAD_OFFSET_M = getAccessRoadOffsetMeters();
        const ROAD_EXT_M    = 4.0;

        const roadOffPx = ROAD_OFFSET_M * pxPerM;
        const roadExtPx = ROAD_EXT_M    * pxPerM;

        // Unit vector along boundary line (screen space)
        const lineLenPx = Math.sqrt((x2-x1)**2 + (y2-y1)**2);
        const buxPx = lineLenPx > 0 ? (x2-x1)/lineLenPx : 0;
        const buyPx = lineLenPx > 0 ? (y2-y1)/lineLenPx : 0;

        // Outward offset
        const offX = perpX * outSign * roadOffPx;
        const offY = perpY * outSign * roadOffPx;

        // Polygon vertices in screen space (for inward-cap test)
        const screenPoly = points.map(p => ({ x: sx(p.easting), y: sy(p.northing) }));

        // Build raw outer line endpoints (extended 4m each side)
        let outerX1 = x1 - buxPx*roadExtPx + offX;
        let outerY1 = y1 - buyPx*roadExtPx + offY;
        let outerX2 = x2 + buxPx*roadExtPx + offX;
        let outerY2 = y2 + buyPx*roadExtPx + offY;

        // ── X-crossing fix ────────────────────────────────────
        // If this road's outer line intersects another road's outer line,
        // trim the crossing ends so they meet at the intersection point.
        for (const j of accessLines) {
          if (j <= i) continue; // each pair processed once (lower index)
          const pj1 = points[j], pj2 = points[(j+1)%ptCount];
          const jx1s = sx(pj1.easting), jy1s = sy(pj1.northing);
          const jx2s = sx(pj2.easting), jy2s = sy(pj2.northing);
          const jLL = Math.sqrt((jx2s-jx1s)**2+(jy2s-jy1s)**2);
          const jbux = jLL>0?(jx2s-jx1s)/jLL:0, jbuy = jLL>0?(jy2s-jy1s)/jLL:0;
          const jmx = (jx1s+jx2s)/2, jmy = (jy1s+jy2s)/2;
          const jLA = Math.atan2(jy2s-jy1s, jx2s-jx1s);
          const jPA = jLA - Math.PI/2;
          const jPX = Math.cos(jPA), jPY = Math.sin(jPA);
          const jDot = jPX*(centX-jmx) + jPY*(centY-jmy);
          const jOS = jDot > 0 ? -1 : 1;
          const jJOutX1 = jx1s - jbux*roadExtPx + jPX*jOS*roadOffPx;
          const jJOutY1 = jy1s - jbuy*roadExtPx + jPY*jOS*roadOffPx;
          const jJOutX2 = jx2s + jbux*roadExtPx + jPX*jOS*roadOffPx;
          const jJOutY2 = jy2s + jbuy*roadExtPx + jPY*jOS*roadOffPx;

          const hit = segmentIntersection(
            outerX1, outerY1, outerX2, outerY2,
            jJOutX1, jJOutY1, jJOutX2, jJOutY2
          );
          if (hit) {
            // Trim THIS road's closer endpoint to the intersection
            const d1 = (outerX1-hit.x)**2 + (outerY1-hit.y)**2;
            const d2 = (outerX2-hit.x)**2 + (outerY2-hit.y)**2;
            if (d1 < d2) { outerX1 = hit.x; outerY1 = hit.y; }
            else         { outerX2 = hit.x; outerY2 = hit.y; }
          }
        }

        const arOuterId = `line-ar-outer-${i}`;
        makeDraggableLine(mainG, outerX1, outerY1, outerX2, outerY2,
          arOuterId, '#333', 0.9, '5,3');

        // ── Cap suppression ───────────────────────────────────
        // Suppress a cap if:
        //   (a) the adjacent segment at that endpoint is also an access road, OR
        //   (b) the cap tip would land inside the main polygon (shooting inward)
        const prevLineIdx = (i - 1 + ptCount) % ptCount;
        const nextLineIdx = (i + 1) % ptCount;

        const cap1TipX = x1 - buxPx*roadExtPx;
        const cap1TipY = y1 - buyPx*roadExtPx;
        if (!accessLines.has(prevLineIdx) && !pointInPolygonScreen(cap1TipX, cap1TipY, screenPoly)) {
          makeDraggableLine(mainG, x1, y1, cap1TipX, cap1TipY,
            `line-ar-cap1-${i}`, '#333', 0.7, '3,2');
        }

        const cap2TipX = x2 + buxPx*roadExtPx;
        const cap2TipY = y2 + buyPx*roadExtPx;
        if (!accessLines.has(nextLineIdx) && !pointInPolygonScreen(cap2TipX, cap2TipY, screenPoly)) {
          makeDraggableLine(mainG, x2, y2, cap2TipX, cap2TipY,
            `line-ar-cap2-${i}`, '#333', 0.7, '3,2');
        }

        // "ACCESS ROAD" text between boundary line and outer line, centred
        const arTxtX  = mx + perpX*outSign*(roadOffPx*0.5);
        const arTxtY  = my + perpY*outSign*(roadOffPx*0.5);
        const arTxtId = `txt-ar-${i}`;
        makeDraggableText(mainG, arTxtX, arTxtY, 'ACCESS ROAD', dispAngle, arTxtId, 'middle');
      }
    }

    // ── Beacons + clock-angle point labels ─────────────────────
    points.forEach((p, i) => {
      const cx=sx(p.easting), cy=sy(p.northing);
      mainG.append('rect').attr('x',cx-3).attr('y',cy-3).attr('width',6).attr('height',6).attr('fill','#000').attr('stroke','#000').attr('data-point-index', i);

      const angleRad    = Math.atan2(cy-centY, cx-centX);
      const labelOffset = offsetPx + currentFontSize * 1.2;
      const labelX      = cx + Math.cos(angleRad)*labelOffset;
      const labelY      = cy + Math.sin(angleRad)*labelOffset;
      const anchor      = Math.cos(angleRad)>0.2?'start':Math.cos(angleRad)<-0.2?'end':'middle';

      const ptId = `txt-pt-${i}`;
      // FIX: only render ptLabel if it's a P-label AND pillar not separately rendered below,
      // OR if it's a pillar label — never render both for same point
      if (pillarLabels[i] && pillarLabels[i].trim()) {
        // Only render pillar label once — use ptId slot so position persists
        makeDraggableText(mainG, labelX, labelY, pillarLabels[i], 0, ptId, anchor);
      } else {
        makeDraggableText(mainG, labelX, labelY, `P${i+1}`, 0, ptId, anchor);
      }
    });

    // ── Re-attach surviving custom elements into the new mainG ──
    // renderPlot rebuilds the SVG (container.innerHTML=''), so custom-drawn elements
    // must be moved into the fresh <g>. We rewire events only — handles already exist.
    customElements.forEach(entry => {
      if (!entry.node) return;
      mainG.node().appendChild(entry.node);
      if (entry.type === 'text') {
        d3.select(entry.node).attr('font-size', currentFontSize + 'px');
      }
      if (entry.handleGroup) {
        mainG.node().appendChild(entry.handleGroup);
      }
      // Rewire events only — do NOT call addHandles again (creates duplicate handle groups)
      rewireCustomEl(entry);
    });

  }

  // ════════════════════════════════════════════════════════════
  //  SCALE BAR
  // ════════════════════════════════════════════════════════════
  function drawScaleBar(g, totalW, totalH, scaleDenom, drawW, rangeE) {
    const niceMs=[1,2,5,10,20,25,50,100,200,250,500,1000];
    const pxPerM=drawW/rangeE;
    let barM=niceMs.find(m=>m*pxPerM>=80)||niceMs[niceMs.length-1];
    const barPx=barM*pxPerM;
    const segs=4, bx=20, by=totalH-32;
    const sg=g.append('g');
    for(let t=0;t<segs;t++){
      sg.append('rect').attr('x',bx+t*(barPx/segs)).attr('y',by-8)
        .attr('width',barPx/segs).attr('height',8)
        .attr('fill',t%2===0?'#333':'#fff').attr('stroke','#333').attr('stroke-width',0.5);
    }
    sg.append('text').attr('x',bx).attr('y',by+11).attr('font-size','9px').attr('text-anchor','middle').text('0');
    sg.append('text').attr('x',bx+barPx/2).attr('y',by+11).attr('font-size','9px').attr('text-anchor','middle').text(`${barM/2}m`);
    sg.append('text').attr('x',bx+barPx).attr('y',by+11).attr('font-size','9px').attr('text-anchor','middle').text(`${barM}m`);
    sg.append('text').attr('x',bx+barPx/2).attr('y',by+22).attr('font-size','8px').attr('text-anchor','middle').attr('fill','#555').text(`Scale 1:${scaleDenom}`);
  }

  // ════════════════════════════════════════════════════════════
  //  RIGHT PANEL
  // ════════════════════════════════════════════════════════════
  function hidePostPlotSections() {
    ['distances-section','origin-section','all-access-wrap','pillars-section','pillar-table-section']
      .forEach(id=>{ const el=document.getElementById(id); if(el) el.style.display='none'; });
  }

  function buildRightPanel() {
    updateAreaDisplay();
    buildDistancesSection();
    buildOriginSection();
    buildAccessRoadSection();
    buildPillarSection();
    ['distances-section','origin-section','all-access-wrap','pillars-section']
      .forEach(id=>{ const el=document.getElementById(id); if(el) el.style.display='block'; });
  }

  function updateAreaDisplay() {
    const total=calcArea(currentPoints);
    const lbl=total>=10000?`${(total/10000).toFixed(4)} Ha`:`${total.toFixed(2)} m²`;
    const el=document.getElementById('area-value'); if(el) el.textContent=lbl;
    updatePlanHeaderMeta();
  }

  function buildDistancesSection() {
    const tb=document.getElementById('dist-tbody'); if(!tb) return;
    const n=currentPoints.length; let rows='';
    for(let i=0;i<n;i++){
      const j=(i+1)%n;
      rows+=`<tr><td>${ptLabel(i)} to ${ptLabel(j===0&&n>1?0:j)}</td>
        <td><input type="text" class="dist-input" data-line="${i}" value="${calcDist(currentPoints[i],currentPoints[j]).toFixed(2)}"/></td></tr>`;
    }
    tb.innerHTML=rows;
    tb.querySelectorAll('.dist-input').forEach(inp=>inp.addEventListener('change',onDistEdit));
  }

  function onDistEdit() {
    const inputs = document.querySelectorAll('.dist-input');
    const n = currentPoints.length;

    // Build array of desired distances; keep original if input is blank/invalid
    const newDists = [];
    inputs.forEach(inp => {
      const v  = parseFloat(inp.value);
      const li = parseInt(inp.dataset.line);
      newDists.push(isNaN(v) ? calcDist(currentPoints[li], currentPoints[(li+1)%n]) : v);
    });

    // ── Two-circle intersection adjustment ───────────────────────────────────
    // For each interior point p[i] (1 … n-2) we know the desired distance from
    // its predecessor p[i-1] AND the desired distance to its successor p[i+1].
    // We find the position of p[i] as the intersection of two circles:
    //   circle A centred at the (already-adjusted) predecessor, radius = newDists[i-1]
    //   circle B centred at the ORIGINAL next point,            radius = newDists[i]
    // Of the (up to) two intersections we keep the one closest to the original
    // position of p[i] — this preserves the intended topology.
    // The last point is handled by propagation from the second-to-last point
    // using the bearing of the original last segment.
    //
    // If the two circles don't intersect (radii too far apart) we fall back to
    // placing the point along the original bearing at the new distance.

    function circleIntersect(cx1, cy1, r1, cx2, cy2, r2, origX, origY) {
      const dx = cx2 - cx1, dy = cy2 - cy1;
      const d  = Math.sqrt(dx*dx + dy*dy);
      if (d < 1e-9) return null;                          // coincident centres
      if (d > r1 + r2 + 1e-6) return null;               // too far apart
      if (d < Math.abs(r1 - r2) - 1e-6) return null;     // one inside the other
      const a  = (r1*r1 - r2*r2 + d*d) / (2*d);
      const h2 = r1*r1 - a*a;
      const h  = h2 > 0 ? Math.sqrt(h2) : 0;
      const mx_ = cx1 + a*dx/d, my_ = cy1 + a*dy/d;
      // Two candidate points
      const c1x = mx_ + h*dy/d,  c1y = my_ - h*dx/d;
      const c2x = mx_ - h*dy/d,  c2y = my_ + h*dx/d;
      // Pick the one nearer the original position
      const d1 = (c1x-origX)**2 + (c1y-origY)**2;
      const d2 = (c2x-origX)**2 + (c2y-origY)**2;
      return d1 <= d2 ? {x: c1x, y: c1y} : {x: c2x, y: c2y};
    }

    // ── Place points P1 … P(n-1) using two-circle intersection ─────────────
    // P0 is always fixed. For each subsequent point we intersect:
    //   Circle A: centred at the already-placed predecessor, radius = newDists[i]  (incoming)
    //   Circle B: centred at the ORIGINAL next point,        radius = newDists[i+1] (outgoing pull)
    // For the LAST point (index n-1) the outgoing segment closes back to P0,
    // so Circle B is centred at np[0] with radius = newDists[n-1] (the closing distance).
    // This makes the closing distance fully editable just like every other distance.

    const np = [{...currentPoints[0]}];

    for (let i = 0; i < n - 1; i++) {
      const from     = np[i];
      const origNext = currentPoints[i + 1];

      // The "pull" circle uses the desired length of the NEXT (outgoing) segment.
      // For all interior points the next segment goes to currentPoints[i+2].
      // For the second-to-last point (i === n-2) the closing segment closes back
      // to np[0], so the pull is centred on np[0] at radius = newDists[n-1].

      let pt = null;

      if (i < n - 2) {
        // Interior point: pull from original position two steps ahead
        pt = circleIntersect(
          from.easting, from.northing, newDists[i],
          currentPoints[i + 2].easting, currentPoints[i + 2].northing, newDists[i + 1],
          origNext.easting, origNext.northing
        );
      } else {
        // Last point (i === n-2): pull circle is P0 at closing distance newDists[n-1]
        pt = circleIntersect(
          from.easting, from.northing, newDists[i],
          np[0].easting, np[0].northing, newDists[n - 1],
          origNext.easting, origNext.northing
        );
      }

      if (pt) {
        np.push({ easting: pt.x, northing: pt.y });
      } else {
        // Fallback: propagate along original bearing at new distance
        const b = calcWCB(currentPoints[i], origNext);
        const r = b * Math.PI / 180;
        np.push({
          easting:  from.easting  + newDists[i] * Math.sin(r),
          northing: from.northing + newDists[i] * Math.cos(r)
        });
      }
    }

    currentPoints = np.map(p => ({
      ...p,
      easting: Math.round(Number(p.easting) * 1000) / 1000,
      northing: Math.round(Number(p.northing) * 1000) / 1000
    }));
    updateCoordTable();
    renderPlot(currentPoints);
    buildRightPanel();
    saveState();
  }

  document.getElementById('adjust-btn')?.addEventListener('click', buildDistancesSection);

  function updateCoordTable() {
    const rows=tbody.querySelectorAll('tr');
    currentPoints.forEach((p,i)=>{ if(rows[i]){ rows[i].cells[0].textContent=ptLabel(i); const inp=rows[i].querySelectorAll('input'); if(inp[0]) inp[0].value=p.easting.toFixed(4); if(inp[1]) inp[1].value=p.northing.toFixed(4); } });
  }

  function buildOriginSection() {
    const wrap=document.getElementById('origin-radios'); if(!wrap) return;
    if (originIndex < -1 || originIndex >= currentPoints.length) originIndex = -1;
    let html=`<span><input type="radio" name="orig" value="-1" ${originIndex===-1?'checked':''}/> None</span> `;
    currentPoints.forEach((_,i)=>{ html+=`<span><input type="radio" name="orig" value="${i}" ${originIndex===i?'checked':''}/> ${ptLabel(i)}</span> `; });
    wrap.innerHTML=html;
    wrap.querySelectorAll('input[name="orig"]').forEach(r=>{ r.addEventListener('change',function(){
      originIndex=parseInt(this.value, 10);
      renderPlot(currentPoints);
      requestAnimationFrame(() => requestAnimationFrame(injectPlanPlot));
      saveState();
    }); });
  }

  function buildAccessRoadSection() {
    const wrap=document.getElementById('all-access-wrap'); if(!wrap) return;
    const n=currentPoints.length; let html='<h3>Access Roads</h3><br>';
    for(let i=0;i<n;i++){ const j=(i+1)%n; html+=`<label><input type="checkbox" class="access-chk" data-line="${i}" ${accessLines.has(i)?'checked':''}/> ${ptLabel(i)} to ${ptLabel(j===0&&n>1?0:j)}</label><br>`; }
    wrap.innerHTML=html;
    wrap.querySelectorAll('.access-chk').forEach(chk=>{ chk.addEventListener('change',function(){ const li=parseInt(this.dataset.line); if(this.checked) accessLines.add(li); else accessLines.delete(li); renderPlot(currentPoints); saveState(); }); });
  }

  function buildPillarSection() {
    const tbl=document.getElementById('pillar-table-section'), tb=document.getElementById('pillar-assign-tbody'); if(!tb) return;
    if (!pillarLabels.length||pillarLabels.every(l=>!l||!l.trim())){ if(tbl) tbl.style.display='none'; return; }
    tb.innerHTML='';
    // FIX: only one row per point — no duplicates
    pillarLabels.forEach((lbl,i)=>{
      tb.innerHTML+=`<tr><td>P${i+1}</td>
        <td><input type="text" class="pillar-edit" data-idx="${i}" value="${lbl||''}"
          style="width:100%;border:1px solid #ddd;padding:3px 6px;border-radius:4px;font-size:13px;"/></td></tr>`;
    });
    if(tbl) tbl.style.display='block';
    tb.querySelectorAll('.pillar-edit').forEach(inp=>{ inp.addEventListener('input',function(){
      const idx=parseInt(this.dataset.idx); pillarLabels[idx]=this.value;
      if(pillarLabels.every(l=>!l||!l.trim())) pillarLabels=[];
      updateCoordTable(); buildDistancesSection(); buildOriginSection(); buildAccessRoadSection();
      renderPlot(currentPoints); saveState();
    }); });
  }

  document.getElementById('assign-pillar-btn')?.addEventListener('click',()=>{
    const cap=document.getElementById('pillar-caption')?.value.trim();
    const from=parseInt(document.getElementById('pillar-from')?.value.trim());
    const to=parseInt(document.getElementById('pillar-to')?.value.trim());
    if(!cap||isNaN(from)||isNaN(to)){ showFeedback('pillar-feedback','Fill in all pillar fields.','warning'); return; }
    // FIX: clear first, then push exactly one label per point — no duplicates
    pillarLabels = [];
    for(let i=0;i<currentPoints.length;i++) pillarLabels.push(`${cap} ${from+i}`);
    buildPillarSection();
    updateCoordTable(); buildDistancesSection(); buildOriginSection(); buildAccessRoadSection();
    renderPlot(currentPoints); saveState();
    showFeedback('pillar-feedback',`Pillar numbers assigned to ${currentPoints.length} points.`,'success');
  });

  // ════════════════════════════════════════════════════════════
  //  GENERATE SURVEY PLAN OVERLAY
  // ════════════════════════════════════════════════════════════
  document.getElementById('generate-btn')?.addEventListener('click',()=>{
    if(!currentPoints.length){ SG('Please plot a polygon first.','warning'); return; }
    openSurveyOverlay();
  });

  function openSurveyOverlay(){
    let ov=document.getElementById('survey-overlay');
    if(!ov) ov=createOverlayDOM();
    const saved=window._savedSurveyForm||{};
    Object.entries(saved).forEach(([id,val])=>{ const el=document.getElementById(id); if(el) el.value=val; });
    ov.style.display='flex'; updateSurveyPreview();
  }

  function createOverlayDOM(){
    const ov=document.createElement('div');
    ov.id='survey-overlay';
    ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:10000;display:none;flex-direction:column;overflow-y:auto;padding:20px;font-family:\'Poppins\',sans-serif;';
    ov.innerHTML=`
      <div style="display:flex;justify-content:flex-end;margin-bottom:10px">
        <button id="close-overlay-btn" style="background:#fff;border:none;border-radius:8px;padding:8px 18px;cursor:pointer;font-weight:600;">✕ Close</button>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:20px;justify-content:center;align-items:flex-start;">
        <div id="a4-preview-wrap" style="background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.2);flex:1;min-width:280px;max-width:560px;">
          <div id="a4-preview" style="width:100%;aspect-ratio:210/297;position:relative;padding:8px;box-sizing:border-box;font-family:'Arial',sans-serif;font-size:9px;"></div>
        </div>
        <div style="background:#fff;border-radius:8px;padding:24px;flex:1;min-width:260px;max-width:440px;">
          <h3 style="margin-bottom:16px;font-size:16px;">Survey Plan Details</h3>
          ${sf('sf-client','Client name')}${sf('sf-address','Land address')}${sf('sf-state','State')}
          ${sf('sf-origin','Origin')}${sf('sf-origin2','Origin 2nd line (optional)')}
          ${sf('sf-surveyor',"Surveyor's name")}${sf('sf-office','Office address')}
          ${sf('sf-surv-state','Surveyor state')}${sf('sf-date','Date of Survey')}
          ${sf('sf-plan-no','Plan number')}${sf('sf-dep-no','Deposition number')}
          <div style="margin-top:16px;display:flex;gap:10px;flex-wrap:wrap;">
            <button id="dl-pdf-btn" style="flex:1;padding:12px;background:#6366f1;color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:600;">Download PDF</button>
            <button id="print-btn"  style="flex:1;padding:12px;background:#e5e7eb;color:#111;border:none;border-radius:8px;cursor:pointer;font-weight:600;">Print</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(ov);
    ov.querySelectorAll('.sf-input').forEach(inp=>inp.addEventListener('input',()=>{ updateSurveyPreview(); saveState(); }));
    document.getElementById('close-overlay-btn')?.addEventListener('click',()=>{ ov.style.display='none'; });
    document.getElementById('print-btn')?.addEventListener('click', printSurvey);
    return ov;
  }

  function sf(id,ph){ return `<input id="${id}" class="sf-input" placeholder="${ph}" style="width:100%;padding:10px 12px;border:1.5px solid #e5e7eb;border-radius:8px;font-size:14px;margin-bottom:10px;outline:none;font-family:'Poppins',sans-serif;"/>`; }

  function updateSurveyPreview(){
    const p=document.getElementById('a4-preview'); if(!p) return;
    const v=id=>document.getElementById(id)?.value||'';
    const client=v('sf-client')||'NAME OF CLIENT', address=v('sf-address')||'ADDRESS', state=v('sf-state')||'STATE, NIGERIA';
    const origin=v('sf-origin')||'APPEARS HERE', origin2=v('sf-origin2')||'', surveyor=v('sf-surveyor')||'SURVEYOR NAME';
    const office=v('sf-office')||'ADDRESS', survState=v('sf-surv-state')||'STATE', date=v('sf-date')||'00/00/0000';
    const planNo=v('sf-plan-no')||'OP/0000/0000SP/0000', depNo=v('sf-dep-no')||'OP/0000/0000SP/0000';
    const totalArea=calcArea(currentPoints);
    const areaStr=totalArea>=10000?`${(totalArea/10000).toFixed(3)} Ha`:`${totalArea.toFixed(3)} SQ.MTRS.`;
    const scaleDenom=getScaleDenominator();
    p.innerHTML=`
      <div style="width:100%;height:100%;display:flex;flex-direction:column;border:1px solid #333;">
        <div style="border-bottom:1px solid #333;padding:6px 10px;display:flex;justify-content:space-between;align-items:flex-start;">
          <div style="min-width:90px;">
            <svg width="36" height="50" viewBox="0 0 36 50"><line x1="18" y1="48" x2="18" y2="5" stroke="#333" stroke-width="1.5"/><polygon points="18,2 14,14 18,11 22,14" fill="#333"/><text x="8" y="20" font-size="8" fill="#333">N</text><text x="20" y="20" font-size="8" fill="#333">N</text></svg>
            <div style="font-size:7px;margin-top:4px;">ORIGIN: ${origin}${origin2?'<br>'+origin2:''}</div>
            <div style="font-size:7px;margin-top:2px;">AREA= ${areaStr}</div>
            <div style="margin-top:6px;">${scaleBarHTMLPreview(scaleDenom)}</div>
          </div>
          <div style="text-align:center;flex:1;padding:0 8px;">
            <div style="font-size:8px;">PLAN SHEWING LANDED PROPERTY OF</div>
            <div style="font-size:10px;font-weight:bold;">${client.toUpperCase()}</div>
            <div style="font-size:8px;">AT</div><div style="font-size:8px;">${address.toUpperCase()}</div>
            <div style="font-size:8px;">${state.toUpperCase()}</div>
          </div>
          <div style="min-width:80px;text-align:right;font-size:7px;"><div>PLAN NO:</div><div style="font-weight:bold;">${planNo}</div></div>
        </div>
        <div style="flex:1;overflow:hidden;display:flex;align-items:center;justify-content:center;background:#fff;">
          <div id="preview-plot-area" style="width:92%;height:92%;position:relative;"></div>
        </div>
        <div style="border-top:1px solid #333;display:grid;grid-template-columns:1fr 1fr 1fr;font-size:7px;">
          <div style="padding:4px 6px;border-right:1px solid #333;">
            <div>PLAN NO:</div><div style="font-weight:bold;margin-top:2px;">${planNo}</div>
            <div style="margin-top:4px;">DEPOSITION NO:</div><div style="font-weight:bold;margin-top:2px;">${depNo}</div>
            <div style="margin-top:4px;">SURVEY RECORD /</div>
          </div>
          <div style="padding:4px 6px;border-right:1px solid #333;display:flex;align-items:center;justify-content:center;">
            <div style="width:44px;height:44px;border-radius:50%;background:rgba(200,0,0,0.12);border:2px solid #c00;display:flex;align-items:center;justify-content:center;font-size:6px;color:#c00;">SEAL</div>
          </div>
          <div style="padding:4px 6px;">
            <div>CERTIFIED TRUE COPY OF ORIGINAL PLAN</div><div>MADE BY ME ON ${date}</div>
            <div style="margin-top:8px;border-bottom:1px solid #333;width:80px;"></div>
            <div style="margin-top:4px;font-weight:bold;">${surveyor.toUpperCase()}</div>
            <div>REGISTERED SURVEYOR</div><div>${office.toUpperCase()}</div><div>${survState.toUpperCase()}</div>
          </div>
        </div>
      </div>`;
    injectPreviewPlot();
  }

  function scaleBarHTMLPreview(sd){
    const segs=4,sw=14;
    let h=`<svg width="${segs*sw+1}" height="22" style="display:block;">`;
    for(let i=0;i<segs;i++) h+=`<rect x="${i*sw}" y="0" width="${sw}" height="5" fill="${i%2===0?'#333':'#fff'}" stroke="#333" stroke-width="0.5"/>`;
    h+=`<text x="0" y="14" font-size="6" text-anchor="middle">0</text><text x="${segs*sw}" y="14" font-size="6" text-anchor="middle">m</text></svg>`;
    h+=`<div style="font-size:6px;margin-top:1px;">SCALE 1:${sd}</div>`;
    return h;
  }

  function injectPreviewPlot(){
    const area_el=document.getElementById('preview-plot-area');
    if(!area_el||!currentPoints.length) return;
    const w=area_el.clientWidth||200, h=area_el.clientHeight||200;
    const pts=currentPoints;
    const allE=pts.map(p=>p.easting),allN=pts.map(p=>p.northing);
    const minE=Math.min(...allE),maxE=Math.max(...allE),minN=Math.min(...allN),maxN=Math.max(...allN);
    const re=maxE-minE||1,rn=maxN-minN||1;
    const sc=Math.min((w-20)/re,(h-20)/rn)*0.82,pad=10;
    function px(e){return pad+(e-minE)*sc;}
    function py(n){return pad+(maxN-n)*sc;}
    const n=pts.length;
    const cx_=pts.reduce((s,p)=>s+px(p.easting),0)/n, cy_=pts.reduce((s,p)=>s+py(p.northing),0)/n;
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.setAttribute('width',w); svg.setAttribute('height',h);
    const d=[...pts,pts[0]].map((p,i)=>`${i===0?'M':'L'}${px(p.easting).toFixed(1)},${py(p.northing).toFixed(1)}`).join(' ')+'Z';
    const path=document.createElementNS('http://www.w3.org/2000/svg','path');
    path.setAttribute('d',d); path.setAttribute('fill','none'); path.setAttribute('stroke','#cc0000'); path.setAttribute('stroke-width','0.9');
    svg.appendChild(path);
    pts.forEach((p,i)=>{
      const cpx=px(p.easting),cpy=py(p.northing);
      const r=document.createElementNS('http://www.w3.org/2000/svg','rect');
      r.setAttribute('x',(cpx-2).toFixed(1)); r.setAttribute('y',(cpy-2).toFixed(1)); r.setAttribute('width','4'); r.setAttribute('height','4'); r.setAttribute('fill','#000'); svg.appendChild(r);
      const ang=Math.atan2(cpy-cy_,cpx-cx_),off=12;
      const lx=cpx+Math.cos(ang)*off,ly=cpy+Math.sin(ang)*off;
      const anch=Math.cos(ang)>0.2?'start':Math.cos(ang)<-0.2?'end':'middle';
      const t=document.createElementNS('http://www.w3.org/2000/svg','text');
      t.setAttribute('x',lx.toFixed(1)); t.setAttribute('y',ly.toFixed(1)); t.setAttribute('text-anchor',anch);
      t.setAttribute('dominant-baseline','middle'); t.setAttribute('font-size','5'); t.setAttribute('font-family','monospace'); t.setAttribute('fill','#333');
      t.textContent=ptLabel(i); svg.appendChild(t);
    });
    function svgTxt(x,y,txt,angle){
      const t=document.createElementNS('http://www.w3.org/2000/svg','text');
      t.setAttribute('x',x.toFixed(1)); t.setAttribute('y',y.toFixed(1)); t.setAttribute('text-anchor','middle');
      t.setAttribute('dominant-baseline','middle'); t.setAttribute('font-size','4.5'); t.setAttribute('font-family','monospace'); t.setAttribute('fill','#333');
      t.setAttribute('transform',`rotate(${angle.toFixed(1)},${x.toFixed(1)},${y.toFixed(1)})`);
      t.textContent=txt; return t;
    }
    for(let i=0;i<n;i++){
      const p1=pts[i],p2=pts[(i+1)%n];
      const x1=px(p1.easting),y1=py(p1.northing),x2=px(p2.easting),y2=py(p2.northing);
      const mx=(x1+x2)/2,my=(y1+y2)/2;
      const ang=Math.atan2(y2-y1,x2-x1); let da=ang*180/Math.PI; if(da>90||da<-90) da+=180;
      const perp=ang-Math.PI/2,ppx=Math.cos(perp),ppy=Math.sin(perp);
      const dot=ppx*(cx_-mx)+ppy*(cy_-my),os=dot>0?-1:1;
      const wcb=calcWCB(p1,p2),dr=calcDist(p1,p2);
      const {deg:dg,min:mn}=bearingParts(wcb);
      if(dr<10){
        // Preview leader: short line, long shelf
        const ll=6*sc/100, sl=10*sc/100;  // rough preview scale
        const lx2=mx+ppx*os*ll,ly2=my+ppy*os*ll;
        const dd2=Math.sqrt((lx2+sl-cx_)**2+(ly2-cy_)**2), dd3=Math.sqrt((lx2-sl-cx_)**2+(ly2-cy_)**2);
        const sd=dd2>=dd3?1:-1;
        const shx=lx2+sd*sl;
        const ln=document.createElementNS('http://www.w3.org/2000/svg','line');
        ln.setAttribute('x1',mx.toFixed(1));ln.setAttribute('y1',my.toFixed(1));ln.setAttribute('x2',lx2.toFixed(1));ln.setAttribute('y2',ly2.toFixed(1));
        ln.setAttribute('stroke','#888');ln.setAttribute('stroke-width','0.5');svg.appendChild(ln);
        const sln=document.createElementNS('http://www.w3.org/2000/svg','line');
        sln.setAttribute('x1',lx2.toFixed(1));sln.setAttribute('y1',ly2.toFixed(1));sln.setAttribute('x2',shx.toFixed(1));sln.setAttribute('y2',ly2.toFixed(1));
        sln.setAttribute('stroke','#888');sln.setAttribute('stroke-width','0.5');svg.appendChild(sln);
        const lp=sd>0?lx2:shx;
        svg.appendChild(svgTxt(lp+sl*0.25, ly2-5, dg, 0));
        svg.appendChild(svgTxt(lp+sl*0.72, ly2-5, mn, 0));
        svg.appendChild(svgTxt((lx2+shx)/2, ly2+5, dr.toFixed(2)+'m', 0));
      } else {
        // Always left-to-right: smaller x = left end
        const lip1=x1<=x2;
        const lftX=lip1?x1:x2,lftY=lip1?y1:y2,rgtX=lip1?x2:x1,rgtY=lip1?y2:y1;
        const dgX=lftX+(rgtX-lftX)*0.2+ppx*os*9,dgY=lftY+(rgtY-lftY)*0.2+ppy*os*9;
        const mnX=rgtX+(lftX-rgtX)*0.2+ppx*os*9,mnY=rgtY+(lftY-rgtY)*0.2+ppy*os*9;
        svg.appendChild(svgTxt(dgX,dgY,dg,da));
        svg.appendChild(svgTxt(mnX,mnY,mn,da));
        svg.appendChild(svgTxt(mx+ppx*-os*7,my+ppy*-os*7,dr.toFixed(2)+'m',da));
      }
      if(accessLines.has(i)){
        const ROAD_OFFSET_PREVIEW = 8.5 * sc / 100;
        const ROAD_EXT_PREVIEW    = 4.0 * sc / 100;
        const lineLenPrv = Math.sqrt((x2-x1)**2+(y2-y1)**2);
        const buxPrv = lineLenPrv>0?(x2-x1)/lineLenPrv:0;
        const buyPrv = lineLenPrv>0?(y2-y1)/lineLenPrv:0;
        const offXp = ppx*os*ROAD_OFFSET_PREVIEW;
        const offYp = ppy*os*ROAD_OFFSET_PREVIEW;

        // Screen polygon for inward-cap test
        const sPoly = pts.map(p=>({x:px(p.easting),y:py(p.northing)}));

        let oax1=x1-buxPrv*ROAD_EXT_PREVIEW+offXp, oay1=y1-buyPrv*ROAD_EXT_PREVIEW+offYp;
        let oax2=x2+buxPrv*ROAD_EXT_PREVIEW+offXp, oay2=y2+buyPrv*ROAD_EXT_PREVIEW+offYp;

        // X-crossing fix for preview
        for(const j of accessLines){
          if(j<=i) continue;
          const pj1=pts[j],pj2=pts[(j+1)%n];
          const jx1_=px(pj1.easting),jy1_=py(pj1.northing);
          const jx2_=px(pj2.easting),jy2_=py(pj2.northing);
          const jLL=Math.sqrt((jx2_-jx1_)**2+(jy2_-jy1_)**2);
          const jbux=jLL>0?(jx2_-jx1_)/jLL:0,jbuy=jLL>0?(jy2_-jy1_)/jLL:0;
          const jmx_=(jx1_+jx2_)/2,jmy_=(jy1_+jy2_)/2;
          const jLA=Math.atan2(jy2_-jy1_,jx2_-jx1_),jPA=jLA-Math.PI/2;
          const jPX=Math.cos(jPA),jPY=Math.sin(jPA);
          const jDot=jPX*(cx_-jmx_)+jPY*(cy_-jmy_),jOS=jDot>0?-1:1;
          const jO1x=jx1_-jbux*ROAD_EXT_PREVIEW+jPX*jOS*ROAD_OFFSET_PREVIEW;
          const jO1y=jy1_-jbuy*ROAD_EXT_PREVIEW+jPY*jOS*ROAD_OFFSET_PREVIEW;
          const jO2x=jx2_+jbux*ROAD_EXT_PREVIEW+jPX*jOS*ROAD_OFFSET_PREVIEW;
          const jO2y=jy2_+jbuy*ROAD_EXT_PREVIEW+jPY*jOS*ROAD_OFFSET_PREVIEW;
          const hit=segmentIntersection(oax1,oay1,oax2,oay2,jO1x,jO1y,jO2x,jO2y);
          if(hit){
            const d1=(oax1-hit.x)**2+(oay1-hit.y)**2;
            const d2=(oax2-hit.x)**2+(oay2-hit.y)**2;
            if(d1<d2){oax1=hit.x;oay1=hit.y;}else{oax2=hit.x;oay2=hit.y;}
          }
        }

        const oln=document.createElementNS('http://www.w3.org/2000/svg','line');
        oln.setAttribute('x1',oax1.toFixed(1));oln.setAttribute('y1',oay1.toFixed(1));
        oln.setAttribute('x2',oax2.toFixed(1));oln.setAttribute('y2',oay2.toFixed(1));
        oln.setAttribute('stroke','#333');oln.setAttribute('stroke-width','0.4');
        oln.setAttribute('stroke-dasharray','2,1');oln.setAttribute('style','stroke:#333;stroke-width:0.4;stroke-dasharray:2,1;');svg.appendChild(oln);

        // Cap at p1 — suppress if adjacent road OR cap shoots inward
        const prevIdxPrv = (i - 1 + n) % n;
        const nextIdxPrv = (i + 1) % n;
        const c1tx=x1-buxPrv*ROAD_EXT_PREVIEW, c1ty=y1-buyPrv*ROAD_EXT_PREVIEW;
        if (!accessLines.has(prevIdxPrv) && !pointInPolygonScreen(c1tx,c1ty,sPoly)) {
          const cap=document.createElementNS('http://www.w3.org/2000/svg','line');
          cap.setAttribute('x1',x1.toFixed(1)); cap.setAttribute('y1',y1.toFixed(1));
          cap.setAttribute('x2',c1tx.toFixed(1)); cap.setAttribute('y2',c1ty.toFixed(1));
          cap.setAttribute('stroke','#333');cap.setAttribute('stroke-width','0.3');
          cap.setAttribute('stroke-dasharray','1.5,1');cap.setAttribute('style','stroke:#333;stroke-width:0.3;stroke-dasharray:1.5,1;');svg.appendChild(cap);
        }
        // Cap at p2 — suppress if adjacent road OR cap shoots inward
        const c2tx=x2+buxPrv*ROAD_EXT_PREVIEW, c2ty=y2+buyPrv*ROAD_EXT_PREVIEW;
        if (!accessLines.has(nextIdxPrv) && !pointInPolygonScreen(c2tx,c2ty,sPoly)) {
          const cap=document.createElementNS('http://www.w3.org/2000/svg','line');
          cap.setAttribute('x1',x2.toFixed(1)); cap.setAttribute('y1',y2.toFixed(1));
          cap.setAttribute('x2',c2tx.toFixed(1)); cap.setAttribute('y2',c2ty.toFixed(1));
          cap.setAttribute('stroke','#333');cap.setAttribute('stroke-width','0.3');
          cap.setAttribute('stroke-dasharray','1.5,1');cap.setAttribute('style','stroke:#333;stroke-width:0.3;stroke-dasharray:1.5,1;');svg.appendChild(cap);
        }
      }
    }
    if(originIndex>=0&&originIndex<pts.length){
      const bp=pts[originIndex],bx_=px(bp.easting),by_=py(bp.northing),arm=10;
      const lv=document.createElementNS('http://www.w3.org/2000/svg','line');lv.setAttribute('x1',bx_);lv.setAttribute('y1',by_);lv.setAttribute('x2',bx_);lv.setAttribute('y2',by_-arm);lv.setAttribute('stroke','#555');lv.setAttribute('stroke-width','0.7');svg.appendChild(lv);
      const lh=document.createElementNS('http://www.w3.org/2000/svg','line');lh.setAttribute('x1',bx_-arm);lh.setAttribute('y1',by_);lh.setAttribute('x2',bx_+arm);lh.setAttribute('y2',by_);lh.setAttribute('stroke','#555');lh.setAttribute('stroke-width','0.7');svg.appendChild(lh);
    }
    area_el.innerHTML=''; area_el.appendChild(svg);
  }


  // ════════════════════════════════════════════════════════════
  //  EXPORT
  // ════════════════════════════════════════════════════════════
  document.getElementById('export-btn')?.addEventListener('click',()=>{
    if(!currentPoints.length){ SE('Plot something first.','warning'); return; }
    const sel=document.querySelector('input[name="export"]:checked'); if(!sel){ SE('Select a format.','warning'); return; }
    const fmt=sel.value.trim().toLowerCase();
    if(fmt==='dxf') exportDXF(); else if(fmt==='jpg'||fmt==='image') exportImage(); else if(fmt==='txt') exportTXT();
    else SE(`Unknown format: "${fmt}".`,'warning');
  });

  function exportDXF() {
    if (!currentPoints || currentPoints.length < 3) {
      SE('Nothing to export.', 'warning');
      return;
    }

    const pts = currentPoints;
    const n = pts.length;
    const allE = pts.map(p => Number(p.easting));
    const allN = pts.map(p => Number(p.northing));
    const minE = Math.min(...allE), maxE = Math.max(...allE);
    const minN = Math.min(...allN), maxN = Math.max(...allN);
    const rangeE = maxE - minE || 1;
    const rangeN = maxN - minN || 1;
    const rangeMax = Math.max(rangeE, rangeN);
    const pad = Math.max(rangeMax * 0.1, 10);
    const textH = Math.max(rangeMax * 0.015, 1.5);
    const markerR = Math.max(rangeMax * 0.003, 0.5);
    const off = textH * 3.5;
    const shortM = 6;
    const container = document.getElementById('plot-container');
    const totalW = container?.clientWidth || 700;
    const totalH = container?.clientHeight || 560;
    const scaleDenom = getScaleDenominator();
    const MM_TO_PX = 3.7795;
    const A4_W_MM = 185, A4_H_MM = 265;
    const maxDrawW = A4_W_MM * MM_TO_PX, maxDrawH = A4_H_MM * MM_TO_PX;
    const physW_px = (rangeE * 1000 / scaleDenom) * MM_TO_PX;
    const physH_px = (rangeN * 1000 / scaleDenom) * MM_TO_PX;
    const fit = Math.min(maxDrawW / physW_px, maxDrawH / physH_px, 1);
    const drawW = physW_px * fit;
    const drawH = physH_px * fit;
    const pxPerM = drawW / rangeE;
    const offsetPx = (0.002 * scaleDenom) * pxPerM;
    const offsetX = (totalW - drawW) / 2;
    const offsetY = (totalH - drawH) / 2;
    const centE = allE.reduce((s, v) => s + v, 0) / n;
    const centN = allN.reduce((s, v) => s + v, 0) / n;
    const centX = allE.reduce((s, v) => s + sx(v), 0) / n;
    const centY = allN.reduce((s, v) => s + sy(v), 0) / n;

    function pair(code, value) {
      return "${code}`n${value}`n";
    }

    function sx(e) { return offsetX + ((e - minE) / rangeE) * drawW; }
    function sy(nVal) { return offsetY + (1 - ((nVal - minN) / rangeN)) * drawH; }
    function worldFromScreen(x, y) {
      return {
        easting: minE + ((x - offsetX) / drawW) * rangeE,
        northing: minN + (1 - ((y - offsetY) / drawH)) * rangeN
      };
    }

    function lineEntity(layer, x1, y1, x2, y2, color) {
      let s = '0`nLINE`n';
      s += pair(8, layer);
      s += pair(62, color);
      s += pair(10, x1.toFixed(3));
      s += pair(20, y1.toFixed(3));
      s += pair(30, '0.0');
      s += pair(11, x2.toFixed(3));
      s += pair(21, y2.toFixed(3));
      s += pair(31, '0.0');
      return s;
    }

    function circleEntity(layer, x, y, radius, color) {
      let s = '0`nCIRCLE`n';
      s += pair(8, layer);
      s += pair(62, color);
      s += pair(10, x.toFixed(3));
      s += pair(20, y.toFixed(3));
      s += pair(30, '0.0');
      s += pair(40, radius.toFixed(3));
      return s;
    }

    function pointEntity(layer, x, y, color) {
      let s = '0`nPOINT`n';
      s += pair(8, layer);
      s += pair(62, color);
      s += pair(10, x.toFixed(3));
      s += pair(20, y.toFixed(3));
      s += pair(30, '0.0');
      return s;
    }

    function textEntity(layer, x, y, text, height, color, angle) {
      let s = '0`nTEXT`n';
      s += pair(8, layer);
      s += pair(62, color);
      s += pair(10, x.toFixed(3));
      s += pair(20, y.toFixed(3));
      s += pair(30, '0.0');
      s += pair(40, height.toFixed(3));
      s += pair(1, text);
      s += pair(50, (angle || 0).toFixed(3));
      return s;
    }

    function screenTextToDXFAngle(angle) {
      let a = (360 - (angle || 0)) % 360;
      if (a < 0) a += 360;
      return a;
    }

    function lineTextAngle(dE, dN) {
      let a = Math.atan2(dN, dE) * 180 / Math.PI;
      if (a < -90 || a > 90) a += 180;
      if (a < 0) a += 360;
      return a;
    }

    function textPlacement(id, fallbackX, fallbackY, fallbackAngle) {
      const pos = labelPositions[id];
      if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
        const w = worldFromScreen(pos.x, pos.y);
        return {
          x: w.easting,
          y: w.northing,
          angle: screenTextToDXFAngle(pos.angle !== undefined ? pos.angle : fallbackAngle)
        };
      }
      return { x: fallbackX, y: fallbackY, angle: fallbackAngle };
    }

    function linePlacement(id, x1, y1, x2, y2) {
      const pos = labelPositions[id];
      if (pos && [pos.x1, pos.y1, pos.x2, pos.y2].every(Number.isFinite)) {
        const p1 = worldFromScreen(pos.x1, pos.y1);
        const p2 = worldFromScreen(pos.x2, pos.y2);
        return { x1: p1.easting, y1: p1.northing, x2: p2.easting, y2: p2.northing };
      }
      return { x1, y1, x2, y2 };
    }

    function junctionPlacement(id, x, y) {
      const pos = labelPositions[id];
      if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
        const w = worldFromScreen(pos.x, pos.y);
        return { x: w.easting, y: w.northing };
      }
      return { x, y };
    }

    let dxf = '';
    dxf += '0`nSECTION`n2`nHEADER`n';
    dxf += pair(9, '$ACADVER') + pair(1, 'AC1009');
    dxf += pair(9, '$INSUNITS') + pair(70, '6');
    dxf += pair(9, '$EXTMIN') + pair(10, (minE - pad).toFixed(3)) + pair(20, (minN - pad).toFixed(3)) + pair(30, '0.0');
    dxf += pair(9, '$EXTMAX') + pair(10, (maxE + pad).toFixed(3)) + pair(20, (maxN + pad).toFixed(3)) + pair(30, '0.0');
    dxf += '0`nENDSEC`n';

    dxf += '0`nSECTION`n2`nTABLES`n';
    dxf += '0`nTABLE`n2`nLAYER`n70`n5`n';
    dxf += '0`nLAYER`n2`n0`n70`n0`n62`n7`n6`nCONTINUOUS`n';
    dxf += '0`nLAYER`n2`nBOUNDARY`n70`n0`n62`n1`n6`nCONTINUOUS`n';
    dxf += '0`nLAYER`n2`nPOINTS`n70`n0`n62`n7`n6`nCONTINUOUS`n';
    dxf += '0`nLAYER`n2`nTEXT`n70`n0`n62`n7`n6`nCONTINUOUS`n';
    dxf += '0`nLAYER`n2`nACCESS`n70`n0`n62`n7`n6`nCONTINUOUS`n';
    dxf += '0`nLAYER`n2`nLEADER`n70`n0`n62`n7`n6`nCONTINUOUS`n';
    dxf += '0`nENDTAB`n';
    dxf += '0`nENDSEC`n';

    dxf += '0`nSECTION`n2`nENTITIES`n';

    for (let i = 0; i < n; i++) {
      const p1 = pts[i];
      const p2 = pts[(i + 1) % n];
      dxf += lineEntity('BOUNDARY', Number(p1.easting), Number(p1.northing), Number(p2.easting), Number(p2.northing), 1);
    }

    pts.forEach((p, i) => {
      const e = Number(p.easting);
      const nVal = Number(p.northing);
      dxf += pointEntity('POINTS', e, nVal, 7);
      dxf += circleEntity('POINTS', e, nVal, markerR, 7);

      const cpx = sx(e), cpy = sy(nVal);
      const angleRad = Math.atan2(cpy - centY, cpx - centX);
      const offPxPt = markerR * pxPerM * 3.5;
      const labelWorld = worldFromScreen(cpx + Math.cos(angleRad) * offPxPt, cpy + Math.sin(angleRad) * offPxPt);
      const ptText = (pillarLabels[i] && pillarLabels[i].trim()) ? pillarLabels[i] : "P$($i+1)";
      const placed = textPlacement("txt-pt-$i", labelWorld.easting, labelWorld.northing, 0);
      dxf += textEntity('TEXT', placed.x, placed.y, ptText, textH, 7, placed.angle);
    });

    for (let i = 0; i < n; i++) {
      const p1 = pts[i], p2 = pts[(i + 1) % n];
      const e1 = Number(p1.easting), n1Val = Number(p1.northing);
      const e2 = Number(p2.easting), n2Val = Number(p2.northing);
      const mx = (e1 + e2) / 2, my = (n1Val + n2Val) / 2;
      const dE = e2 - e1, dN = n2Val - n1Val;
      const lineLen = Math.sqrt(dE * dE + dN * dN);
      if (lineLen < 0.001) continue;

      const ux = dE / lineLen, uy = dN / lineLen;
      const px_ = -uy, py_ = ux;
      const dot = px_ * (centE - mx) + py_ * (centN - my);
      const outSign = dot > 0 ? -1 : 1;
      const distStr = lineLen.toFixed(2) + 'm';
      const wcb = calcWCB(p1, p2);
      const parts = bearingParts(wcb);
      const degStr = parts.deg, minStr = parts.min;
      const txtAngle = lineTextAngle(dE, dN);

      const x1s = sx(e1), y1s = sy(n1Val);
      const x2s = sx(e2), y2s = sy(n2Val);
      const mxs = (x1s + x2s) / 2, mys = (y1s + y2s) / 2;
      const lineAngle = Math.atan2(y2s - y1s, x2s - x1s);
      const perpAngle = lineAngle - Math.PI / 2;
      const perpX = Math.cos(perpAngle), perpY = Math.sin(perpAngle);
      const dotScreen = perpX * (centX - mxs) + perpY * (centY - mys);
      const outSignScreen = dotScreen > 0 ? -1 : 1;
      let dispAngle = lineAngle * 180 / Math.PI;
      if (dispAngle > 90 || dispAngle < -90) dispAngle += 180;
      const screenLen = Math.sqrt((x2s - x1s) ** 2 + (y2s - y1s) ** 2);
      const charW = currentFontSize * 0.62;
      const needsLeader = lineLen < shortM || (degStr.length * charW) > screenLen * 0.85;

      if (needsLeader) {
        const leaderLen = 6;
        const shelfLen = 10;
        const defJx = mx + px_ * outSign * leaderLen;
        const defJy = my + py_ * outSign * leaderLen;
        const junction = junctionPlacement("junc-$i", defJx, defJy);
        const distLeft = Math.sqrt((junction.x - shelfLen - centE) ** 2 + (junction.y - centN) ** 2);
        const distRight = Math.sqrt((junction.x + shelfLen - centE) ** 2 + (junction.y - centN) ** 2);
        const shelfDir = distRight >= distLeft ? 1 : -1;
        const shelfEndX = junction.x + shelfDir * shelfLen;

        dxf += lineEntity('LEADER', mx, my, junction.x, junction.y, 7);
        dxf += lineEntity('LEADER', junction.x, junction.y, shelfEndX, junction.y, 7);

        const leftE = shelfDir > 0 ? junction.x : shelfEndX;
        const degPos = textPlacement("txt-b-deg-$i", leftE + shelfLen * 0.25, junction.y + textH * 1.5, 0);
        const minPos = textPlacement("txt-b-min-$i", leftE + shelfLen * 0.72, junction.y + textH * 1.5, 0);
        const distPos = textPlacement("txt-d-$i", (junction.x + shelfEndX) / 2, junction.y - textH * 1.5, 0);
        dxf += textEntity('TEXT', degPos.x, degPos.y, degStr, textH, 7, degPos.angle);
        dxf += textEntity('TEXT', minPos.x, minPos.y, minStr, textH, 7, minPos.angle);
        dxf += textEntity('TEXT', distPos.x, distPos.y, distStr, textH, 7, distPos.angle);
      } else {
        const degDefault = worldFromScreen(x1s + (x2s - x1s) * 0.2 + perpX * outSignScreen * offsetPx, y1s + (y2s - y1s) * 0.2 + perpY * outSignScreen * offsetPx);
        const minDefault = worldFromScreen(x2s + (x1s - x2s) * 0.2 + perpX * outSignScreen * offsetPx, y2s + (y1s - y2s) * 0.2 + perpY * outSignScreen * offsetPx);
        const distDefault = worldFromScreen(mxs + perpX * -outSignScreen * offsetPx, mys + perpY * -outSignScreen * offsetPx);
        const degPos = textPlacement("txt-b-deg-$i", degDefault.easting, degDefault.northing, screenTextToDXFAngle(dispAngle));
        const minPos = textPlacement("txt-b-min-$i", minDefault.easting, minDefault.northing, screenTextToDXFAngle(dispAngle));
        const distPos = textPlacement("txt-d-$i", distDefault.easting, distDefault.northing, screenTextToDXFAngle(dispAngle));
        dxf += textEntity('TEXT', degPos.x, degPos.y, degStr, textH, 7, degPos.angle);
        dxf += textEntity('TEXT', minPos.x, minPos.y, minStr, textH, 7, minPos.angle);
        dxf += textEntity('TEXT', distPos.x, distPos.y, distStr, textH, 7, distPos.angle);
      }

      if (accessLines.has(i)) {
        const roadOff = getAccessRoadOffsetMeters();
        const roadExt = 4.0;
        const outer = linePlacement("line-ar-outer-$i",
          e1 - ux * roadExt + px_ * outSign * roadOff,
          n1Val - uy * roadExt + py_ * outSign * roadOff,
          e2 + ux * roadExt + px_ * outSign * roadOff,
          n2Val + uy * roadExt + py_ * outSign * roadOff
        );
        dxf += lineEntity('ACCESS', outer.x1, outer.y1, outer.x2, outer.y2, 7);

        // World-space polygon for inward-cap test in DXF
        const wPoly = pts.map(p => ({ x: Number(p.easting), y: Number(p.northing) }));
        function ptInPolyWorld(px, py) {
          let inside = false;
          const wn = wPoly.length;
          for (let a = 0, b = wn - 1; a < wn; b = a++) {
            const xi = wPoly[a].x, yi = wPoly[a].y;
            const xj = wPoly[b].x, yj = wPoly[b].y;
            if (((yi > py) !== (yj > py)) && (px < (xj-xi)*(py-yi)/(yj-yi)+xi))
              inside = !inside;
          }
          return inside;
        }

        const prev = (i - 1 + n) % n;
        const next = (i + 1) % n;
        if (!accessLines.has(prev) && !ptInPolyWorld(e1 - ux*roadExt, n1Val - uy*roadExt)) {
          const cap1 = linePlacement("line-ar-cap1-$i", e1, n1Val, e1 - ux * roadExt, n1Val - uy * roadExt);
          dxf += lineEntity('ACCESS', cap1.x1, cap1.y1, cap1.x2, cap1.y2, 7);
        }
        if (!accessLines.has(next) && !ptInPolyWorld(e2 + ux*roadExt, n2Val + uy*roadExt)) {
          const cap2 = linePlacement("line-ar-cap2-$i", e2, n2Val, e2 + ux * roadExt, n2Val + uy * roadExt);
          dxf += lineEntity('ACCESS', cap2.x1, cap2.y1, cap2.x2, cap2.y2, 7);
        }

        const arDefault = worldFromScreen(mxs + perpX * outSignScreen * ((roadOff * pxPerM) * 0.5), mys + perpY * outSignScreen * ((roadOff * pxPerM) * 0.5));
        const arPos = textPlacement("txt-ar-$i", arDefault.easting, arDefault.northing, screenTextToDXFAngle(dispAngle));
        dxf += textEntity('TEXT', arPos.x, arPos.y, 'ACCESS ROAD', textH, 7, arPos.angle);
      }
    }

    dxf += '0`nENDSEC`n0`nEOF`n';

    triggerDownload(new Blob([dxf], { type: 'application/dxf' }), 'survey_plan.dxf');
    SE('DXF exported successfully.', 'success');
  }

  function exportImage(){
    const svgEl=document.querySelector('#plot-container svg'); if(!svgEl){ SE('Plot first.','warning'); return; }
    svgToCanvas(svgEl,2,canvas=>{ triggerDownload(dataURLtoBlob(canvas.toDataURL('image/jpeg',0.95)),'survey_plan.jpg'); SE('Image exported.','success'); });
  }

  function exportTXT(){
    if (!currentPoints || !currentPoints.length) { SE('Nothing to export.', 'warning'); return; }
    const lines = currentPoints.map((p, i) => `P${i + 1}, ${p.easting}, ${p.northing}`);
    triggerDownload(new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' }), 'coordinates.txt');
    SE('Coordinates exported successfully.', 'success');
  }

  function svgToCanvas(svgEl,scale,cb){
    const w=svgEl.clientWidth||700,h=svgEl.clientHeight||600;
    const blob=new Blob([new XMLSerializer().serializeToString(svgEl)],{type:'image/svg+xml;charset=utf-8'});
    const url=URL.createObjectURL(blob),img=new Image();
    img.onload=function(){ const canvas=document.createElement('canvas'); canvas.width=w*scale; canvas.height=h*scale; const ctx=canvas.getContext('2d'); ctx.fillStyle='#ffffff'; ctx.fillRect(0,0,canvas.width,canvas.height); ctx.scale(scale,scale); ctx.drawImage(img,0,0,w,h); URL.revokeObjectURL(url); cb(canvas); };
    img.onerror=()=>{ URL.revokeObjectURL(url); SE('Render failed.','warning'); };
    img.src=url;
  }

  function dataURLtoBlob(d){ const p=d.split(','),mime=p[0].match(/:(.*?);/)[1]; const b=atob(p[1]),arr=new Uint8Array(b.length); for(let i=0;i<b.length;i++) arr[i]=b.charCodeAt(i); return new Blob([arr],{type:mime}); }
  function triggerDownload(blob,filename){ const url=URL.createObjectURL(blob),a=document.createElement('a'); a.href=url; a.download=filename; document.body.appendChild(a); a.click(); document.body.removeChild(a); setTimeout(()=>URL.revokeObjectURL(url),1000); }

  // ════════════════════════════════════════════════════════════
  //  RESTORE FROM LOCALSTORAGE
  // ════════════════════════════════════════════════════════════
  function restoreFromStorage(){
    const state=loadState(); if(!state) return;
    if (isStateOwnedByAnotherUser(state)) {
      clearState();
      sessionStorage.removeItem('cn_tab_key');
      LS_KEY = 'coordnest_' + Date.now() + '_' + Math.random().toString(36).slice(2);
      sessionStorage.setItem('cn_tab_key', LS_KEY);
      return;
    }
    if(state.points?.length){
      currentPoints   = state.points;
      originIndex     = -1;
      pillarLabels    = state.pillarLabels||[];
      accessLines     = new Set(state.accessLines||[]);
      labelPositions  = state.labelPositions||{};
      deletedLabels   = new Set(state.deletedLabels||[]);
      if(state.fontSize) currentFontSize=state.fontSize;
      if(state.scale)    currentScale=state.scale;
      const slider=document.getElementById('font-slider');
      if(slider){ slider.value=currentFontSize; document.getElementById('font-size-display').textContent=currentFontSize+'px'; }
      if(scaleSelect&&state.scale){ scaleSelect.value=`1:${state.scale}`; }
      renderPlot(currentPoints); buildRightPanel();
      tbody.innerHTML='';
      currentPoints.forEach((p,i)=>{ const tr=document.createElement('tr'); tr.innerHTML=`<td>${ptLabel(i)}</td><td><input type="text" value="${p.easting}"/></td><td><input type="text" value="${p.northing}"/></td>`; tbody.appendChild(tr); });
      showTable();
    }
    if(state.projectName){ const pn=document.querySelector('.project-name-input'); if(pn) pn.value=state.projectName; }
    if(state.surveyForm) window._savedSurveyForm=state.surveyForm;
  }

  document.querySelector('.project-name-input')?.addEventListener('input', saveState);
  setInterval(saveState, 10000);
  tbody.innerHTML=`<tr><td>P1</td><td><input type="text" value=""/></td><td><input type="text" value=""/></td></tr>`;
  hidePostPlotSections();
  async function bootstrapProjectState() {
    try {
      const localPayload = buildProjectStatePayload();
      const hasLocalState = hasMeaningfulProjectState(localPayload);

      if (isServerSyncEnabled && activeProjectId) {
        const remoteProject = await loadProjectFromServer(activeProjectId);
        if (remoteProject?.project_state) {
          const parsed = JSON.parse(remoteProject.project_state);
          if (hydrateLocalProjectState(parsed)) {
            hasHydratedRemoteState = true;
            activeProjectId = Number(remoteProject.id) || activeProjectId;
          }
        }
      }

      restoreFromStorage();

      if (isServerSyncEnabled && (hasLocalState || hasHydratedRemoteState)) {
        scheduleProjectSync(hasLocalState ? 250 : 800);
      }
    } catch (err) {
      console.warn('Restore from storage failed, clearing saved state.', err);
      clearState();
      currentPoints = [];
      originIndex = -1;
      pillarLabels = [];
      accessLines = new Set();
      labelPositions = {};
      deletedLabels = new Set();
      const container = document.getElementById('plot-container');
      if (container) container.innerHTML = '<div class="placeholder-text">Plot will appear here after you click Plot</div>';
      tbody.innerHTML = `<tr><td>P1</td><td><input type="text" value=""/></td><td><input type="text" value=""/></td></tr>`;
      hideTable();
      hidePostPlotSections();
    }
  }

  queueMicrotask(() => {
    bootstrapProjectState();
  });

  // ════════════════════════════════════════════════════════════
  //  PLAN OVERLAY — plot clone, scale rule, form persistence, PDF
  // ════════════════════════════════════════════════════════════

  // Key for plan form fields in localStorage
  const PLAN_FORM_KEY = (LS_KEY || 'coordnest') + '_planform';

  function syncPlanFieldValue(sourceId, targetId) {
    const source = document.getElementById(sourceId);
    const target = document.getElementById(targetId);
    if (!source || !target) return;
    target.value = source.value;
  }

  function setupPlanFieldMirrors() {
    const pairs = [
      ['plan-plan-no-top', 'plan-plan-no'],
      ['plan-plan-no', 'plan-plan-no-top']
    ];
    pairs.forEach(([sourceId, targetId]) => {
      const source = document.getElementById(sourceId);
      if (!source || source.dataset.mirrorBound === '1') return;
      source.dataset.mirrorBound = '1';
      source.addEventListener('input', () => {
        syncPlanFieldValue(sourceId, targetId);
        savePlanForm();
      });
    });
    syncPlanFieldValue('plan-plan-no', 'plan-plan-no-top');
  }

  function getSelectedOriginIndex() {
    const checked = document.querySelector('#origin-radios input[name="orig"]:checked');
    if (!checked) return originIndex;
    const next = parseInt(checked.value, 10);
    return Number.isNaN(next) ? -1 : next;
  }

  function formatPlanAreaValue() {
    const total = currentPoints?.length >= 3 ? calcArea(currentPoints) : 0;
    return total >= 10000 ? `${(total / 10000).toFixed(4)} Ha` : `${total.toFixed(2)} m²`;
  }

  function updatePlanHeaderMeta() {
    const scaleDisplay = document.getElementById('plan-scale-display');
    if (scaleDisplay) scaleDisplay.textContent = `SCALE 1:${getScaleDenominator()}`;

    const areaDisplay = document.getElementById('plan-area-display');
    if (areaDisplay) areaDisplay.textContent = `AREA: ${formatPlanAreaValue()}`;

    const originDisplay = document.getElementById('plan-origin-display');
    const coordSystem = coordSystemSelect?.value?.trim() || 'UTM ZONE 32N';
    if (originDisplay) originDisplay.textContent = `ORIGIN: ${coordSystem}`;
  }

  // ── Save / restore plan form fields ──────────────────────
  function savePlanForm() {
    const data = {};
    document.querySelectorAll('#plan-overlay input, #plan-overlay textarea, #plan-overlay select').forEach(el => {
      const key = el.id || el.name || el.placeholder || '';
      if (key) data[key] = el.value;
    });
    try { localStorage.setItem(PLAN_FORM_KEY, JSON.stringify(data)); } catch(e) {}
    scheduleProjectSync();
  }

  function restorePlanForm() {
    try {
      const data = JSON.parse(localStorage.getItem(PLAN_FORM_KEY) || 'null');
      if (!data) return;
      document.querySelectorAll('#plan-overlay input, #plan-overlay textarea, #plan-overlay select').forEach(el => {
        const key = el.id || el.name || el.placeholder || '';
        if (key && data[key] !== undefined) el.value = data[key];
      });
      if (data['plan-plan-no'] !== undefined && data['plan-plan-no-top'] === undefined) {
        const topField = document.getElementById('plan-plan-no-top');
        if (topField) topField.value = data['plan-plan-no'];
      }
    } catch(e) {}
    syncPlanFieldValue('plan-plan-no', 'plan-plan-no-top');
    updatePlanHeaderMeta();
  }

  // Attach save listeners to all plan form fields once DOM is ready
  document.querySelectorAll('#plan-overlay input, #plan-overlay textarea, #plan-overlay select').forEach(el => {
    const evt = el.tagName === 'SELECT' ? 'change' : 'input';
    el.addEventListener(evt, () => {
      savePlanForm();
      updatePlanHeaderMeta();
    });
  });
  setupPlanFieldMirrors();
  coordSystemSelect?.addEventListener('change', () => {
    updatePlanHeaderMeta();
    requestAnimationFrame(() => requestAnimationFrame(injectPlanPlot));
  });
  accessRoadOffsetInput?.addEventListener('input', () => {
    if (currentPoints.length >= 3) {
      clearScaleSensitivePositions();
      renderPlot(currentPoints);
      requestAnimationFrame(() => requestAnimationFrame(injectPlanPlot));
      saveState();
    }
  });

  // ── Override generatePlan / closePlan ─────────────────────
  // The HTML inline script defines these first; we redefine them
  // here (scripts.js loads after) so the overlay also runs
  // injectPlanPlot() and restorePlanForm() every time it opens.
  window.generatePlan = function() {
    const overlay = document.getElementById('plan-overlay');
    if (!overlay) return;
    overlay.style.display = 'block';
    restorePlanForm();
    buildOriginSection();
    updatePlanHeaderMeta();
    // Two rAF calls so the overlay is fully painted and .plot-area
    // has real clientWidth/clientHeight before we measure it.
    requestAnimationFrame(() => requestAnimationFrame(injectPlanPlot));
  };

  window.closePlan = function() {
    const overlay = document.getElementById('plan-overlay');
    if (overlay) overlay.style.display = 'none';
  };

  // ── Render plan plot into .plot-area ─────────────────────
  // The polygon is drawn at the chosen scale (1:S).
  // Physical size = (rangeMetres * 1000 / S) mm → px at 96dpi.
  // If the physical drawing + label padding fits inside the
  // plot-area it is drawn at true scale; if it is larger it is
  // scaled down uniformly so nothing is ever cut off.
  // The drawing is centred inside the SVG (which is exactly
  // plotArea.clientWidth × plotArea.clientHeight).

  function buildPlanSVG(w, h) {
    // w, h = target canvas size in px (plot-area dimensions)
    const PFONT      = 14;
    const MM_TO_PX   = 3.7795;           // 96 dpi: 1mm = 3.7795px
    const scaleDenom = getScaleDenominator();
    const pts = currentPoints;
    const activeOriginIndex = getSelectedOriginIndex();
    const n   = pts.length;

    const allE = pts.map(p => p.easting),  allN = pts.map(p => p.northing);
    const minE = Math.min(...allE), maxE = Math.max(...allE);
    const minN = Math.min(...allN), maxN = Math.max(...allN);
    const re = maxE - minE || 1, rn = maxN - minN || 1;

    // Physical drawing size at the chosen scale
    const physW = (re * 1000 / scaleDenom) * MM_TO_PX;
    const physH = (rn * 1000 / scaleDenom) * MM_TO_PX;

    // Padding in px — enough for labels + leader lines at this scale
    const pad = PFONT * 6;

    // Fit factor: 1.0 means true scale; <1 means scaled down to fit
    const fit = Math.min((w - pad * 2) / physW, (h - pad * 2) / physH, 1.0);

    const drawW  = physW * fit;
    const drawH  = physH * fit;
    const pxPerM = drawW / re;           // px per real-world metre

    // Centre the drawing inside the SVG canvas
    const offX = (w - drawW) / 2;
    const offY = (h - drawH) / 2;

    function px(e) { return offX + (e - minE) / re * drawW; }
    function py(nv){ return offY + (1 - (nv - minN) / rn) * drawH; }

    const cx_ = pts.reduce((s,p) => s + px(p.easting),  0) / n;
    const cy_ = pts.reduce((s,p) => s + py(p.northing), 0) / n;

    const offsetPx = (0.002 * scaleDenom) * pxPerM;  // 2mm paper → px

    const NS = 'http://www.w3.org/2000/svg';
    function mel(tag, attrs, parent) {
      const e = document.createElementNS(NS, tag);
      Object.entries(attrs).forEach(([k,v]) => e.setAttribute(k, String(v)));
      if (parent) parent.appendChild(e);
      return e;
    }
    function mtext(x, y, txt, angle, anchor, parent) {
      const t = mel('text', {
        x: x.toFixed(2), y: y.toFixed(2),
        'text-anchor': anchor || 'middle',
        'dominant-baseline': 'middle',
        'font-size': PFONT + 'px',
        'font-family': 'monospace',
        fill: '#333',
        transform: `rotate(${angle||0},${x.toFixed(2)},${y.toFixed(2)})`
      }, parent);
      t.textContent = txt;
      return t;
    }
    function formatPlanCoord(value, suffix) {
      return `${Number(value).toFixed(3)} ${suffix}`;
    }

    const svg = mel('svg', {
      width: w, height: h,
      xmlns: NS,
      style: 'display:block;background:#fff;overflow:hidden;'
    });

    // ── Boundary polygon ────────────────────────────────────
    const dPath = [...pts, pts[0]].map((p,i) =>
      `${i===0?'M':'L'}${px(p.easting).toFixed(2)},${py(p.northing).toFixed(2)}`
    ).join(' ') + 'Z';
    mel('path', { d: dPath, fill:'none', stroke:'#cc0000', 'stroke-width':'1.5' }, svg);

    // ── Per-line annotations ────────────────────────────────
    for (let i = 0; i < n; i++) {
      const p1 = pts[i], p2 = pts[(i+1)%n];
      const x1 = px(p1.easting), y1 = py(p1.northing);
      const x2 = px(p2.easting), y2 = py(p2.northing);
      const mx = (x1+x2)/2, my = (y1+y2)/2;

      const lineAng = Math.atan2(y2-y1, x2-x1);
      const perpAng = lineAng - Math.PI/2;
      const perpX   = Math.cos(perpAng), perpY = Math.sin(perpAng);
      const dot     = perpX*(cx_-mx) + perpY*(cy_-my);
      const outSign = dot > 0 ? -1 : 1;

      let dispAngle = lineAng * 180 / Math.PI;
      if (dispAngle > 90 || dispAngle < -90) dispAngle += 180;

      const distReal  = calcDist(p1, p2);
      const distStr   = distReal.toFixed(2) + 'm';
      const wcb       = calcWCB(p1, p2);
      const {deg: degStr, min: minStr} = bearingParts(wcb);

      const screenLen   = Math.sqrt((x2-x1)**2 + (y2-y1)**2);
      const needsLeader = distReal < 6 || (degStr.length * PFONT * 0.62) > screenLen * 0.85;

      if (needsLeader) {
        const leaderLen = Math.max(6 * pxPerM, 30);
        const shelfLen  = Math.max(10 * pxPerM, 50);
        const lx = mx + perpX*outSign*leaderLen;
        const ly = my + perpY*outSign*leaderLen;
        const dL = Math.sqrt((lx-shelfLen-cx_)**2 + (ly-cy_)**2);
        const dR = Math.sqrt((lx+shelfLen-cx_)**2 + (ly-cy_)**2);
        const sd = dR >= dL ? 1 : -1;
        const shelfEndX = lx + sd*shelfLen;
        mel('line',{x1:mx.toFixed(2),y1:my.toFixed(2),x2:lx.toFixed(2),y2:ly.toFixed(2),
                    stroke:'#888','stroke-width':'0.8'},svg);
        mel('line',{x1:lx.toFixed(2),y1:ly.toFixed(2),x2:shelfEndX.toFixed(2),y2:ly.toFixed(2),
                    stroke:'#888','stroke-width':'0.8'},svg);
        const lp = sd > 0 ? lx : shelfEndX;
        mtext(lp+shelfLen*0.25, ly-PFONT*1.1, degStr, 0, 'middle', svg);
        mtext(lp+shelfLen*0.72, ly-PFONT*1.1, minStr, 0, 'middle', svg);
        mtext((lx+shelfEndX)/2, ly+PFONT*1.1, distStr, 0, 'middle', svg);
      } else {
        const lip1 = x1 <= x2;
        const lx1=lip1?x1:x2, ly1=lip1?y1:y2, rx1=lip1?x2:x1, ry1=lip1?y2:y1;
        mtext(lx1+(rx1-lx1)*0.2 + perpX*outSign*offsetPx,
              ly1+(ry1-ly1)*0.2 + perpY*outSign*offsetPx, degStr, dispAngle, 'middle', svg);
        mtext(rx1+(lx1-rx1)*0.2 + perpX*outSign*offsetPx,
              ry1+(ly1-ry1)*0.2 + perpY*outSign*offsetPx, minStr, dispAngle, 'middle', svg);
        mtext(mx - perpX*outSign*offsetPx,
              my - perpY*outSign*offsetPx, distStr, dispAngle, 'middle', svg);
      }

      // ── Access road ───────────────────────────────────────
      if (accessLines.has(i)) {
        const ROFF = Math.max(getAccessRoadOffsetMeters() * pxPerM, 28);
        const REXT = Math.max(4.0 * pxPerM, 14);
        const ll   = Math.sqrt((x2-x1)**2+(y2-y1)**2);
        const bux  = ll>0?(x2-x1)/ll:0, buy=ll>0?(y2-y1)/ll:0;
        const ox   = perpX*outSign*ROFF, oy=perpY*outSign*ROFF;

        // Screen polygon for inward-cap test
        const sPoly2 = pts.map(p => ({ x: px(p.easting), y: py(p.northing) }));

        let rox1=x1-bux*REXT+ox, roy1=y1-buy*REXT+oy;
        let rox2=x2+bux*REXT+ox, roy2=y2+buy*REXT+oy;

        // X-crossing fix
        for(const j of accessLines){
          if(j<=i) continue;
          const pj1b=pts[j],pj2b=pts[(j+1)%n];
          const jx1b=px(pj1b.easting),jy1b=py(pj1b.northing);
          const jx2b=px(pj2b.easting),jy2b=py(pj2b.northing);
          const jLLb=Math.sqrt((jx2b-jx1b)**2+(jy2b-jy1b)**2);
          const jbxb=jLLb>0?(jx2b-jx1b)/jLLb:0,jbyb=jLLb>0?(jy2b-jy1b)/jLLb:0;
          const jmxb=(jx1b+jx2b)/2,jmyb=(jy1b+jy2b)/2;
          const jLAb=Math.atan2(jy2b-jy1b,jx2b-jx1b),jPAb=jLAb-Math.PI/2;
          const jPXb=Math.cos(jPAb),jPYb=Math.sin(jPAb);
          const jDb=jPXb*(cx_-jmxb)+jPYb*(cy_-jmyb),jOSb=jDb>0?-1:1;
          const jO1xb=jx1b-jbxb*REXT+jPXb*jOSb*ROFF,jO1yb=jy1b-jbyb*REXT+jPYb*jOSb*ROFF;
          const jO2xb=jx2b+jbxb*REXT+jPXb*jOSb*ROFF,jO2yb=jy2b+jbyb*REXT+jPYb*jOSb*ROFF;
          const hitb=segmentIntersection(rox1,roy1,rox2,roy2,jO1xb,jO1yb,jO2xb,jO2yb);
          if(hitb){
            const db1=(rox1-hitb.x)**2+(roy1-hitb.y)**2;
            const db2=(rox2-hitb.x)**2+(roy2-hitb.y)**2;
            if(db1<db2){rox1=hitb.x;roy1=hitb.y;}else{rox2=hitb.x;roy2=hitb.y;}
          }
        }

        mel('line',{
          x1:rox1.toFixed(2), y1:roy1.toFixed(2),
          x2:rox2.toFixed(2), y2:roy2.toFixed(2),
          stroke:'#333','stroke-width':'0.9','stroke-dasharray':'5,3',
          style:'stroke:#333;stroke-width:0.9;stroke-dasharray:5,3;'
        },svg);
        const prev=(i-1+n)%n, next=(i+1)%n;
        const c1tx2=x1-bux*REXT, c1ty2=y1-buy*REXT;
        if (!accessLines.has(prev) && !pointInPolygonScreen(c1tx2,c1ty2,sPoly2))
          mel('line',{x1:x1.toFixed(2),y1:y1.toFixed(2),
                      x2:c1tx2.toFixed(2),y2:c1ty2.toFixed(2),
                      stroke:'#333','stroke-width':'0.7','stroke-dasharray':'3,2',
                      style:'stroke:#333;stroke-width:0.7;stroke-dasharray:3,2;'},svg);
        const c2tx2=x2+bux*REXT, c2ty2=y2+buy*REXT;
        if (!accessLines.has(next) && !pointInPolygonScreen(c2tx2,c2ty2,sPoly2))
          mel('line',{x1:x2.toFixed(2),y1:y2.toFixed(2),
                      x2:c2tx2.toFixed(2),y2:c2ty2.toFixed(2),
                      stroke:'#333','stroke-width':'0.7','stroke-dasharray':'3,2',
                      style:'stroke:#333;stroke-width:0.7;stroke-dasharray:3,2;'},svg);
        mtext(mx+perpX*outSign*ROFF*0.5, my+perpY*outSign*ROFF*0.5,
              'ACCESS ROAD', dispAngle, 'middle', svg);
      }
    }

    // ── Beacons + labels ────────────────────────────────────
    pts.forEach((p, i) => {
      const cpx = px(p.easting), cpy = py(p.northing);
      mel('rect',{x:(cpx-3).toFixed(2),y:(cpy-3).toFixed(2),
                  width:'6',height:'6',fill:'#000',stroke:'#000'},svg);
      const ang  = Math.atan2(cpy-cy_, cpx-cx_);
      const off  = offsetPx + PFONT * 1.4;
      const lx   = cpx + Math.cos(ang)*off, ly = cpy + Math.sin(ang)*off;
      const anch = Math.cos(ang)>0.2?'start':Math.cos(ang)<-0.2?'end':'middle';
      const lbl  = (pillarLabels[i]&&pillarLabels[i].trim()) ? pillarLabels[i] : `P${i+1}`;
      mtext(lx, ly, lbl, 0, anch, svg);
    });

    // ?? Origin crosshair ????????????????????????????????????
    if (activeOriginIndex >= 0 && activeOriginIndex < pts.length) {
      const bp = pts[activeOriginIndex];
      const bx = px(bp.easting);
      const by_ = py(bp.northing);
      const arm = 12;
      const gap = 4;
      const northText = formatPlanCoord(bp.northing, 'mN');
      const northLineLen = Math.max(76, northText.length * PFONT * 0.58);
      const northEndX = w - 10;
      const northStartX = northEndX - northLineLen;
      const auxLen = northLineLen / 2;
      const leftStartX = 10;
      const bottomEndY = h - 10;
      const bottomStartY = bottomEndY - auxLen;

      mel('line',{x1:bx,y1:by_-(gap+arm),x2:bx,y2:by_-gap,stroke:'#555','stroke-width':'1'},svg);
      mel('line',{x1:bx,y1:by_+gap,x2:bx,y2:by_+(gap+arm),stroke:'#555','stroke-width':'1'},svg);
      mel('line',{x1:bx-(gap+arm),y1:by_,x2:bx-gap,y2:by_,stroke:'#555','stroke-width':'1'},svg);
      mel('line',{x1:bx+gap,y1:by_,x2:bx+(gap+arm),y2:by_,stroke:'#555','stroke-width':'1'},svg);

      mel('line',{x1:leftStartX,y1:by_,x2:leftStartX+auxLen,y2:by_,stroke:'#555','stroke-width':'1'},svg);
      mel('line',{x1:northStartX,y1:by_,x2:northEndX,y2:by_,stroke:'#555','stroke-width':'1'},svg);
      mtext((northStartX+northEndX)/2, by_-(PFONT*0.8), northText, 0, 'middle', svg);

      mel('line',{x1:bx,y1:bottomStartY,x2:bx,y2:bottomEndY,stroke:'#555','stroke-width':'1'},svg);
    }

    return svg;
  }

  function injectScaleRule() {
    const el = document.getElementById('scale-rule');
    if (!el) return;

    const scaleDenom = getScaleDenominator();
    const defs = {
      250:  { left: 5,   midLeft: 2.5, rightMid: 5,   right: 10 },
      500:  { left: 10,  midLeft: 5,   rightMid: 10,  right: 20 },
      1000: { left: 20,  midLeft: 10,  rightMid: 20,  right: 40 },
      2000: { left: 40,  midLeft: 20,  rightMid: 40,  right: 80 },
      2500: { left: 50,  midLeft: 25,  rightMid: 50,  right: 100 },
      5000: { left: 100, midLeft: 50,  rightMid: 100, right: 200 }
    };

    const cfg = defs[scaleDenom] || defs[500];
    const fmt = value => Number.isInteger(value) ? String(value) : String(value).replace(/\.0$/, '');

    // Outermost tick labels carry the "m" unit; inner ticks are plain numbers.
    const rawLabels = [fmt(cfg.left), fmt(cfg.midLeft), '0', fmt(cfg.rightMid), fmt(cfg.right)];
    const tickLabels = rawLabels.map((v, i) => (i === 0 || i === 4) ? `${v}m` : v);

    const barW  = 200;
    const barY  = 14;
    const barH  = 8;
    // Generous equal padding ensures outermost labels never clip at any scale.
    const pad   = 36;
    const svgW  = pad + barW + pad;
    const svgH  = 34;
    const leftX  = pad;
    const rightX = pad + barW;
    const innerY = barY + barH / 2;
    const quarterX      = leftX + barW * 0.25;
    const zeroX         = leftX + barW * 0.5;
    const threeQuarterX = leftX + barW * 0.75;
    const tickXs = [leftX, quarterX, zeroX, threeQuarterX, rightX];

    let hatch = '';
    for (let x = leftX - 8; x <= rightX + 8; x += 10) {
      hatch += `<line x1="${x}" y1="${barY + barH}" x2="${x + 8}" y2="${innerY}" stroke="#222" stroke-width="0.8"/>`;
    }

    let ticks = '';
    tickXs.forEach((x, index) => {
      ticks += `<line x1="${x}" y1="${barY - 3}" x2="${x}" y2="${barY + barH + 1}" stroke="#111" stroke-width="0.9"/>`;
      ticks += `<text x="${x}" y="${barY - 5}" text-anchor="middle" font-size="7.2px" font-family="Times New Roman, serif" fill="#111">${tickLabels[index]}</text>`;
    });

    // Fixed pixel width = the SVG coordinate space exactly, so no label can ever be clipped
    // on screen or in the html2canvas render. margin:auto centres it inside title-block.
    el.innerHTML = `
      <svg width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}"
           xmlns="http://www.w3.org/2000/svg"
           style="display:block;width:${svgW}px;height:${svgH}px;margin:3px auto 0;overflow:hidden;">
        <rect x="${leftX}" y="${barY}" width="${barW}" height="${barH}" fill="#fff" stroke="#111" stroke-width="0.9"/>
        <line x1="${leftX}" y1="${innerY}" x2="${rightX}" y2="${innerY}" stroke="#111" stroke-width="0.7"/>
        <clipPath id="scale-rule-clip"><rect x="${leftX}" y="${innerY}" width="${barW}" height="${barH / 2}" /></clipPath>
        <g clip-path="url(#scale-rule-clip)">${hatch}</g>
        ${ticks}
      </svg>`;
  }

  function injectArrowBoxOriginGuide() {
    const arrowBox = document.querySelector('#plan-overlay .arrow-box');
    const survHeader = document.querySelector('#plan-overlay .surv-header');
    if (!arrowBox || !survHeader) return;

    const previous = arrowBox.querySelector('.arrow-origin-guide');
    if (previous) previous.remove();

    const activeOriginIndex = getSelectedOriginIndex();
    if (activeOriginIndex < 0 || activeOriginIndex >= currentPoints.length) {
      survHeader.classList.remove('header-split');
      return;
    }

    const coordSystem = coordSystemSelect?.value?.trim() || 'UTM ZONE 32N';
    const leftLetter = coordSystem === 'NIGERIAN NATIONAL' ? 'N' : 'U';
    const eastText = `${Number(currentPoints[activeOriginIndex].easting).toFixed(3)} mE`;

    const NS = 'http://www.w3.org/2000/svg';
    const MM_TO_PX = 3.7795;
    const textFont = 10;
    const arrowHalf = 1.5 * MM_TO_PX;
    const arrowHeight = 3 * MM_TO_PX;
    const upperTickHalf = 3 * MM_TO_PX;
    const lowerTickHalf = 2 * MM_TO_PX;
    const arrowTipY = 13 * MM_TO_PX;
    const lineTop = arrowTipY + arrowHeight;
    const crossY = lineTop + 6 * MM_TO_PX;
    const lowerCrossY = crossY + 2 * MM_TO_PX;
    const labelGap = 14 * 0.8;
    const estimatedTextHeight = eastText.length * textFont * 0.58;
    const lineLength = Math.max(estimatedTextHeight * 2, 46);
    const lineBottom = lineTop + lineLength;
    const svgH = lineBottom + 10;

    const headerRect = survHeader.getBoundingClientRect();
    const arrowBoxRect = arrowBox.getBoundingClientRect();
    const plotSvg = document.querySelector('#plan-overlay .plot-area svg');
    const pointRect = plotSvg?.querySelector(`.plot-group [data-point-index="${activeOriginIndex}"]`);

    let linePageX = arrowBoxRect.left + arrowBoxRect.width / 2;
    if (plotSvg && pointRect) {
      const bx = parseFloat(pointRect.getAttribute('x')) + parseFloat(pointRect.getAttribute('width')) / 2;
      const svgRect = plotSvg.getBoundingClientRect();
      const vb = plotSvg.viewBox?.baseVal;
      const vbW = vb?.width || parseFloat(plotSvg.getAttribute('width')) || svgRect.width || 1;
      const vbH = vb?.height || parseFloat(plotSvg.getAttribute('height')) || svgRect.height || 1;
      const drawScale = Math.min(svgRect.width / vbW, svgRect.height / vbH);
      const drawWidth = vbW * drawScale;
      const drawLeft = svgRect.left + (svgRect.width - drawWidth) / 2;
      linePageX = drawLeft + bx * drawScale;
    }

    const lineX = Math.max(16, Math.min(headerRect.width - 16, linePageX - headerRect.left));

    const splitThreshold = headerRect.width * 0.5;
    const shouldSplit = lineX > splitThreshold;
    const isSplit = survHeader.classList.contains('header-split');
    if (shouldSplit !== isSplit) {
      survHeader.classList.toggle('header-split', shouldSplit);
      requestAnimationFrame(() => injectArrowBoxOriginGuide());
      return;
    }

    const wrap = document.createElement('div');
    wrap.className = 'arrow-origin-guide';
    wrap.style.cssText = `position:absolute;top:0;left:${-(arrowBoxRect.left - headerRect.left)}px;width:${headerRect.width}px;height:${svgH}px;pointer-events:none;overflow:visible;`;

    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('width', String(headerRect.width));
    svg.setAttribute('height', String(svgH));
    svg.setAttribute('viewBox', `0 0 ${headerRect.width} ${svgH}`);
    svg.style.display = 'block';
    svg.style.overflow = 'visible';

    function mkLine(x1, y1, x2, y2, w = 1) {
      const el = document.createElementNS(NS, 'line');
      el.setAttribute('x1', x1.toFixed(2));
      el.setAttribute('y1', y1.toFixed(2));
      el.setAttribute('x2', x2.toFixed(2));
      el.setAttribute('y2', y2.toFixed(2));
      el.setAttribute('stroke', '#000');
      el.setAttribute('stroke-width', String(w));
      return el;
    }

    function mkText(x, y, value, angle = 0, anchor = 'middle', baseline = 'middle') {
      const el = document.createElementNS(NS, 'text');
      el.setAttribute('x', x.toFixed(2));
      el.setAttribute('y', y.toFixed(2));
      el.setAttribute('text-anchor', anchor);
      el.setAttribute('dominant-baseline', baseline);
      el.setAttribute('font-size', `${textFont}px`);
      el.setAttribute('font-family', 'Times New Roman, serif');
      el.setAttribute('fill', '#000');
      if (angle) el.setAttribute('transform', `rotate(${angle},${x.toFixed(2)},${y.toFixed(2)})`);
      el.textContent = value;
      return el;
    }

    const arrow = document.createElementNS(NS, 'polygon');
    arrow.setAttribute('points',
      `${lineX.toFixed(2)},${arrowTipY.toFixed(2)} ` +
      `${(lineX - arrowHalf).toFixed(2)},${(arrowTipY + arrowHeight).toFixed(2)} ` +
      `${(lineX + arrowHalf).toFixed(2)},${(arrowTipY + arrowHeight).toFixed(2)}`
    );
    arrow.setAttribute('fill', '#000');
    svg.appendChild(arrow);
    svg.appendChild(mkLine(lineX, lineTop, lineX, lineBottom, 1));
    svg.appendChild(mkLine(lineX - upperTickHalf, crossY, lineX + upperTickHalf, crossY, 1));
    svg.appendChild(mkLine(lineX - lowerTickHalf, lowerCrossY, lineX + lowerTickHalf, lowerCrossY, 1));
    svg.appendChild(mkText(lineX - upperTickHalf - 10, crossY, leftLetter, 0, 'middle'));
    svg.appendChild(mkText(lineX + upperTickHalf + 10, crossY, 'N', 0, 'middle'));
    svg.appendChild(mkText(lineX - labelGap, lineBottom, eastText, -90, 'start', 'alphabetic'));

    wrap.appendChild(svg);
    arrowBox.appendChild(wrap);
  }

  function addOriginOverlayToPlanSvg(svg) {
    if (!svg) return;
    const activeOriginIndex = getSelectedOriginIndex();
    if (activeOriginIndex < 0 || activeOriginIndex >= currentPoints.length) return;

    const plotGroup = svg.querySelector('.plot-group');
    if (!plotGroup) return;

    const pointRect = plotGroup.querySelector(`[data-point-index="${activeOriginIndex}"]`);
    if (!pointRect) return;

    const bx = parseFloat(pointRect.getAttribute('x')) + parseFloat(pointRect.getAttribute('width')) / 2;
    const by = parseFloat(pointRect.getAttribute('y')) + parseFloat(pointRect.getAttribute('height')) / 2;
    const svgWidth = parseFloat(svg.getAttribute('width')) || svg.viewBox.baseVal?.width || svg.clientWidth || 700;
    const svgHeight = parseFloat(svg.getAttribute('height')) || svg.viewBox.baseVal?.height || svg.clientHeight || 600;
    const PFONT = 14;
    const arm = 12;
    const gap = 4;
    const northText = `${Number(currentPoints[activeOriginIndex].northing).toFixed(3)} mN`;
    const northLineLen = Math.max(76, northText.length * PFONT * 0.58);
    const northEndX = svgWidth - 10;
    const northStartX = northEndX - northLineLen;
    const auxLen = northLineLen / 2;
    const leftStartX = 10;
    const bottomEndY = svgHeight - 10;
    const bottomStartY = bottomEndY - auxLen;
    const NS = 'http://www.w3.org/2000/svg';

    const previous = plotGroup.querySelector('.plan-origin-overlay');
    if (previous) previous.remove();

    function line(x1, y1, x2, y2) {
      const el = document.createElementNS(NS, 'line');
      el.setAttribute('x1', x1.toFixed(2));
      el.setAttribute('y1', y1.toFixed(2));
      el.setAttribute('x2', x2.toFixed(2));
      el.setAttribute('y2', y2.toFixed(2));
      el.setAttribute('stroke', '#555');
      el.setAttribute('stroke-width', '1');
      return el;
    }

    function text(x, y, value, angle, anchor = 'middle', baseline = 'middle') {
      const el = document.createElementNS(NS, 'text');
      el.setAttribute('x', x.toFixed(2));
      el.setAttribute('y', y.toFixed(2));
      el.setAttribute('text-anchor', anchor);
      el.setAttribute('dominant-baseline', baseline);
      el.setAttribute('font-size', `${PFONT}px`);
      el.setAttribute('font-family', 'monospace');
      el.setAttribute('fill', '#333');
      if (angle) el.setAttribute('transform', `rotate(${angle},${x.toFixed(2)},${y.toFixed(2)})`);
      el.textContent = value;
      return el;
    }

    const overlay = document.createElementNS(NS, 'g');
    overlay.setAttribute('class', 'plan-origin-overlay');

    overlay.appendChild(line(bx, by - (gap + arm), bx, by - gap));
    overlay.appendChild(line(bx, by + gap, bx, by + (gap + arm)));
    overlay.appendChild(line(bx - (gap + arm), by, bx - gap, by));
    overlay.appendChild(line(bx + gap, by, bx + (gap + arm), by));

    overlay.appendChild(line(leftStartX, by, leftStartX + auxLen, by));
    overlay.appendChild(line(northStartX, by, northEndX, by));
    overlay.appendChild(text((northStartX + northEndX) / 2, by - (PFONT * 0.8), northText, 0));
    overlay.appendChild(line(bx, bottomStartY, bx, bottomEndY));

    plotGroup.appendChild(overlay);
  }

  function injectPlanPlot() {
    const plotArea = document.querySelector('#plan-overlay .plot-area');
    if (!plotArea) return;
    originIndex = getSelectedOriginIndex();

    if (!currentPoints || currentPoints.length < 3) {
      injectArrowBoxOriginGuide();
      plotArea.innerHTML = '<p style="color:#999;font-size:13px;text-align:center;padding:20px;">No plot yet.</p>';
      return;
    }

    plotArea.innerHTML = '';
    plotArea.style.cssText = 'overflow:hidden;display:block;';

    const liveSvg = document.querySelector('#plot-container svg');
    if (liveSvg) {
      const NS = 'http://www.w3.org/2000/svg';
      const srcW = parseFloat(liveSvg.getAttribute('width')) || liveSvg.clientWidth || 700;
      const srcH = parseFloat(liveSvg.getAttribute('height')) || liveSvg.clientHeight || 600;
      const svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('width', String(srcW));
      svg.setAttribute('height', String(srcH));
      svg.setAttribute('viewBox', `0 0 ${srcW} ${srcH}`);
      svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      svg.style.width = '100%';
      svg.style.height = '100%';
      svg.style.display = 'block';
      svg.style.background = '#fff';
      const plotGroup = liveSvg.querySelector('.plot-group');
      if (plotGroup) svg.appendChild(plotGroup.cloneNode(true));
      addOriginOverlayToPlanSvg(svg);
      plotArea.appendChild(svg);
      injectArrowBoxOriginGuide();
    } else {
      const w = plotArea.clientWidth  || 500;
      const h = plotArea.clientHeight || Math.round(156 * 3.7795);
      const svg = buildPlanSVG(w, h);
      plotArea.appendChild(svg);
      injectArrowBoxOriginGuide();
    }

    injectScaleRule();
  }

  function copyComputedStyles(src, dest) {
    if (!(src instanceof Element) || !(dest instanceof Element)) return;
    const cs = window.getComputedStyle(src);
    for (const prop of cs) {
      dest.style.setProperty(prop, cs.getPropertyValue(prop), cs.getPropertyPriority(prop));
    }
    const srcChildren = Array.from(src.children);
    const destChildren = Array.from(dest.children);
    for (let i = 0; i < srcChildren.length; i++) {
      copyComputedStyles(srcChildren[i], destChildren[i]);
    }
  }

  function makeStaticControl(control) {
    const tag = control.tagName.toLowerCase();
    const staticEl = document.createElement('div');
    const cs = window.getComputedStyle(control);
    const value = tag === 'textarea' ? (control.value || control.placeholder || '') : (control.value || control.placeholder || '');

    for (const prop of cs) {
      staticEl.style.setProperty(prop, cs.getPropertyValue(prop), cs.getPropertyPriority(prop));
    }

    staticEl.textContent = value;
    staticEl.style.margin = cs.margin;
    staticEl.style.border = 'none';
    staticEl.style.outline = 'none';
    staticEl.style.background = 'transparent';
    staticEl.style.boxShadow = 'none';
    staticEl.style.overflow = 'hidden';
    staticEl.style.display = tag === 'textarea' ? 'block' : 'inline-block';
    staticEl.style.whiteSpace = tag === 'textarea' ? 'pre-wrap' : 'nowrap';

    if (tag === 'textarea') {
      staticEl.style.width = cs.width;
      staticEl.style.height = cs.height;
    }

    return staticEl;
  }

  function buildPlanExportNode() {
    const sourceSheet = document.querySelector('#plan-overlay .a4-sheet');
    if (!sourceSheet) return null;

    const clone = sourceSheet.cloneNode(true);
    copyComputedStyles(sourceSheet, clone);

    const srcControls = sourceSheet.querySelectorAll('input, textarea, select');
    const cloneControls = clone.querySelectorAll('input, textarea, select');
    cloneControls.forEach((control, index) => {
      const srcControl = srcControls[index];
      if (!srcControl) return;
      const staticEl = makeStaticControl(srcControl);
      control.replaceWith(staticEl);
    });

    clone.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
    clone.style.margin = '0';
    clone.style.boxShadow = 'none';
    clone.style.transform = 'none';

    const wrapper = document.createElement('div');
    wrapper.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
    wrapper.style.width = '794px';
    wrapper.style.height = '1123px';
    wrapper.style.background = '#ffffff';
    wrapper.style.padding = '0';
    wrapper.style.margin = '0';
    wrapper.style.overflow = 'hidden';
    wrapper.style.display = 'block';
    wrapper.appendChild(clone);

    return wrapper;
  }

  function htmlNodeToCanvas(node, width, height, scale, cb) {
    const xhtml = new XMLSerializer().serializeToString(node);
    const svgMarkup =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
      `<foreignObject width="100%" height="100%">${xhtml}</foreignObject>` +
      `</svg>`;

    const blob = new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();

    img.onload = function() {
      const canvas = document.createElement('canvas');
      canvas.width = width * scale;
      canvas.height = height * scale;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);
      cb(canvas);
    };

    img.onerror = function() {
      URL.revokeObjectURL(url);
      SG('Plan export render failed.','warning');
    };

    img.src = url;
  }


  



  function waitForPlanViewReady(cb, attempt = 0) {
    injectPlanPlot();

    requestAnimationFrame(() => {
      const survHeader = document.querySelector('#plan-overlay .surv-header');
      const arrowGuide = document.querySelector('#plan-overlay .arrow-box .arrow-origin-guide');
      const activeOriginIndex = getSelectedOriginIndex();

      if (activeOriginIndex < 0 || activeOriginIndex >= currentPoints.length) {
        cb();
        return;
      }

      const plotSvg = document.querySelector('#plan-overlay .plot-area svg');
      const pointRect = plotSvg?.querySelector(`.plot-group [data-point-index="${activeOriginIndex}"]`);
      const headerRect = survHeader?.getBoundingClientRect();
      const arrowBoxRect = document.querySelector('#plan-overlay .arrow-box')?.getBoundingClientRect();

      let shouldSplit = false;
      if (survHeader && plotSvg && pointRect && headerRect && arrowBoxRect) {
        const bx = parseFloat(pointRect.getAttribute('x')) + parseFloat(pointRect.getAttribute('width')) / 2;
        const svgRect = plotSvg.getBoundingClientRect();
        const vb = plotSvg.viewBox?.baseVal;
        const vbW = vb?.width || parseFloat(plotSvg.getAttribute('width')) || svgRect.width || 1;
        const vbH = vb?.height || parseFloat(plotSvg.getAttribute('height')) || svgRect.height || 1;
        const drawScale = Math.min(svgRect.width / vbW, svgRect.height / vbH);
        const drawWidth = vbW * drawScale;
        const drawLeft = svgRect.left + (svgRect.width - drawWidth) / 2;
        const linePageX = drawLeft + bx * drawScale;
        const lineX = Math.max(16, Math.min(headerRect.width - 16, linePageX - headerRect.left));
        shouldSplit = lineX > (headerRect.width * 0.5);
      }

      const isSplit = !!survHeader?.classList.contains('header-split');
      const ready = !!arrowGuide && shouldSplit === isSplit;

      if (ready || attempt >= 8) {
        cb();
      } else {
        waitForPlanViewReady(cb, attempt + 1);
      }
    });
  }


// —— Download PDF — print the current displayed A4 sheet ——
  function downloadPlanPDF() {
    const sheet = document.querySelector('#plan-overlay .a4-sheet');
    if (!sheet) {
      SG('Survey plan sheet not found.','warning');
      return;
    }

    if (!currentPoints || currentPoints.length < 3) {
      SG('Plot your coordinates first.','warning');
      return;
    }

    waitForPlanViewReady(() => {
      const liveSheet = document.querySelector('#plan-overlay .a4-sheet');

      // ── Rasterise the plot-area SVG to PNG first ──────────────────────────
      // SVG presentation attributes (stroke-dasharray, etc.) are dropped when
      // SVG markup is parsed by an HTML parser (innerHTML / document.write).
      // Rasterising to a PNG image sidesteps this entirely — the browser's own
      // SVG renderer draws the dashes correctly into the canvas, and we embed
      // the result as a plain <img> in the print window.
      const plotSvgLive = liveSheet.querySelector('.plot-area svg');

      function proceedWithClone(plotImgDataURL) {
        // Serialize all non-plot SVGs to markup strings before cloning.
        // The plot-area SVG has already been replaced by an <img> placeholder
        // (or will be swapped in the clone below).
        const serializer = new XMLSerializer();
        const svgPlaceholders = [];
        const liveSVGs = Array.from(liveSheet.querySelectorAll('svg'));
        liveSVGs.forEach((svg, i) => {
          const marker = `__SVG_PLACEHOLDER_${i}__`;
          const serialized = serializer.serializeToString(svg);
          svgPlaceholders.push({ marker, serialized });
          const span = document.createElement('span');
          span.setAttribute('data-svg-ph', marker);
          svg.parentNode.insertBefore(span, svg);
          svg.parentNode.removeChild(svg);
        });

        const clone = liveSheet.cloneNode(true);

        // Restore original SVGs back into the live sheet
        svgPlaceholders.forEach(({ marker, serialized }) => {
          const span = liveSheet.querySelector(`[data-svg-ph="${marker}"]`);
          if (span) {
            const tmp = document.createElement('div');
            tmp.innerHTML = serialized;
            const restoredSvg = tmp.firstChild;
            if (restoredSvg) span.parentNode.insertBefore(restoredSvg, span);
            span.parentNode.removeChild(span);
          }
        });

        // Inject serialized SVG strings into the clone at placeholder positions,
        // EXCEPT for the plot-area SVG — replace that with the rasterised <img>.
        svgPlaceholders.forEach(({ marker, serialized }) => {
          const span = clone.querySelector(`[data-svg-ph="${marker}"]`);
          if (!span) return;

          // Check if this placeholder was the plot-area SVG
          const isPlotSvg = plotImgDataURL && span.closest && span.closest('.plot-area');

          if (isPlotSvg) {
            // Use the rasterised PNG instead of the SVG markup
            const img = document.createElement('img');
            img.src = plotImgDataURL;
            img.style.cssText = 'display:block;width:100%;height:100%;object-fit:contain;';
            span.parentNode.insertBefore(img, span);
            span.parentNode.removeChild(span);
          } else {
            const tmp = document.createElement('div');
            tmp.innerHTML = serialized;
            const clonedSvg = tmp.firstChild;
            if (clonedSvg) span.parentNode.insertBefore(clonedSvg, span);
            span.parentNode.removeChild(span);
          }
        });

      // ── Bake header-split layout as inline styles on the clone ──────────────
      // The header-split class uses flexbox + order to swap title-block / arrow-box.
      // In the PDF pop-up window the live layout measurements don't exist, so we
      // freeze the current computed layout directly onto the clone's elements.
      const liveSurvHeader = liveSheet.querySelector('.surv-header');
      const cloneSurvHeader = clone.querySelector('.surv-header');
      if (liveSurvHeader && cloneSurvHeader) {
        const isSplit = liveSurvHeader.classList.contains('header-split');
        if (isSplit) {
          // Freeze the flex container
          cloneSurvHeader.style.display          = 'flex';
          cloneSurvHeader.style.flexDirection    = 'row';
          cloneSurvHeader.style.alignItems       = 'flex-start';
          cloneSurvHeader.style.justifyContent   = 'space-between';

          // title-block → left half
          const cloneTitleBlock = cloneSurvHeader.querySelector('.title-block');
          if (cloneTitleBlock) {
            cloneTitleBlock.style.order      = '1';
            cloneTitleBlock.style.width      = '50%';
            cloneTitleBlock.style.flex       = '0 0 50%';
            cloneTitleBlock.style.marginRight = 'auto';
            cloneTitleBlock.style.textAlign  = 'center';
          }

          // arrow-box → right half
          const cloneArrowBox = cloneSurvHeader.querySelector('.arrow-box');
          if (cloneArrowBox) {
            cloneArrowBox.style.order        = '2';
            cloneArrowBox.style.width        = '50%';
            cloneArrowBox.style.flex         = '0 0 50%';
            cloneArrowBox.style.marginLeft   = 'auto';
            cloneArrowBox.style.justifyContent = 'flex-end';
            cloneArrowBox.style.position     = 'relative';
            cloneArrowBox.style.overflow     = 'visible';
          }

          // upper-plan-no inside arrow-box
          const cloneUpperPlanNo = cloneSurvHeader.querySelector('.upper-plan-no');
          if (cloneUpperPlanNo) {
            cloneUpperPlanNo.style.marginLeft = 'auto';
            cloneUpperPlanNo.style.width      = '60%';
          }
        }

        // Bake the arrow-origin-guide's absolute position as inline style.
        // In the live page the guide uses left:-Xpx (relative to arrow-box)
        // to overlay the full header width. We convert that to a pixel offset
        // anchored from the header's own left edge so the PDF window sees the
        // exact same position regardless of its own layout dimensions.
        const liveArrowBox  = liveSurvHeader.querySelector('.arrow-box');
        const liveGuide     = liveSurvHeader.querySelector('.arrow-origin-guide');
        const cloneGuide    = cloneSurvHeader.querySelector('.arrow-origin-guide');
        if (liveArrowBox && liveGuide && cloneGuide) {
          const headerRect   = liveSurvHeader.getBoundingClientRect();
          const arrowBoxRect = liveArrowBox.getBoundingClientRect();
          // The guide's SVG coordinate space starts at the header's left edge.
          // Re-express the guide's position as left:0 on the header by switching
          // its containing block to the surv-header instead of the arrow-box.
          // We do this by moving the guide out of arrow-box into surv-header in
          // the clone, and setting explicit left/top/width from the live header rect.
          const guideLeft = arrowBoxRect.left - headerRect.left +
                            parseFloat(liveGuide.style.left || '0');
          cloneGuide.style.position = 'absolute';
          cloneGuide.style.left     = `${guideLeft}px`;
          cloneGuide.style.top      = '0';
          cloneGuide.style.width    = `${headerRect.width}px`;
          // Move the guide to be a direct child of cloneSurvHeader so its
          // absolute position is relative to the header, not the arrow-box.
          cloneSurvHeader.style.position = 'relative';
          cloneSurvHeader.appendChild(cloneGuide);
        }
      }

      // Bake current values of inputs/textareas/selects into static divs in the clone
      const originalFields = liveSheet.querySelectorAll('input, textarea, select');
      const clonedFields   = clone.querySelectorAll('input, textarea, select');
      clonedFields.forEach((field, index) => {
        const original = originalFields[index];
        if (!original) return;
        const tag = field.tagName.toLowerCase();
        const cs = window.getComputedStyle(original);
        const staticEl = document.createElement('div');
        staticEl.style.cssText    = original.style.cssText;
        staticEl.style.border     = 'none';
        staticEl.style.outline    = 'none';
        staticEl.style.background = 'transparent';
        staticEl.style.boxShadow  = 'none';
        staticEl.style.padding    = cs.padding;
        staticEl.style.margin     = cs.margin;
        staticEl.style.fontSize   = cs.fontSize;
        staticEl.style.fontFamily = cs.fontFamily;
        staticEl.style.fontWeight = cs.fontWeight;
        staticEl.style.color      = cs.color;
        staticEl.style.textAlign  = cs.textAlign;
        staticEl.style.width      = cs.width;
        staticEl.style.display    = tag === 'textarea' ? 'block' : 'inline-block';
        staticEl.style.whiteSpace = tag === 'textarea' ? 'pre-wrap' : 'nowrap';
        staticEl.style.overflow   = 'visible';
        if (tag === 'select') {
          staticEl.textContent = original.options?.[original.selectedIndex]?.text || original.value;
        } else {
          staticEl.textContent = original.value || original.placeholder || '';
        }
        field.replaceWith(staticEl);
      });

      const planStyles = Array.from(document.querySelectorAll('link[rel="stylesheet"], style'))
        .map(el => el.outerHTML)
        .join('\n');

      const win = window.open('', '_blank', 'width=1000,height=900');
      if (!win) {
        SG('Pop-up blocked. Allow pop-ups and try again.','warning');
        return;
      }

      win.document.open();
      win.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <title>Survey Plan PDF</title>
          ${planStyles}
          <style>
            body { margin: 0; padding: 0; background: white; }
            .a4-container { background: white !important; padding: 0 !important; min-height: auto !important; }
            .a4-sheet { margin: 0 auto !important; box-shadow: none !important; }
            @page { size: A4 portrait; margin: 0; }
          </style>
        </head>
        <body>
          <div class="a4-container">${clone.outerHTML}</div>
          <script>
            window.onload = function() {
              setTimeout(function() {
                window.focus();
                window.print();
              }, 800);
            };
          <\/script>
        </body>
        </html>
      `);
      win.document.close();

        SG('Print window opened. Choose "Save as PDF".','success');
      } // end proceedWithClone

      // ── Trigger: rasterise plot SVG first, then build print window ──────────
      if (plotSvgLive) {
        svgToCanvas(plotSvgLive, 3, canvas => {
          proceedWithClone(canvas.toDataURL('image/png'));
        });
      } else {
        proceedWithClone(null);
      }
    });
  }
    document.getElementById('plan-download-pdf-btn')?.addEventListener('click', downloadPlanPDF);

  // ════════════════════════════════════════════════════════════
  //  DRAWING TOOLS — Delete, Square, Straight Line, Dashed Line, Custom Text
  // ════════════════════════════════════════════════════════════

  // ── State for drawing tools ───────────────────────────────
  let drawingMode   = null;   // 'square' | 'straight' | 'dashed' | 'text' | null
  let selectedDrawEl = null;  // the currently selected custom element node (SVG element)

  // ── Custom elements registry ─────────────────────────────
  // Each entry: { id, type, node }
  let customElements = [];
  let customElemIdSeq = 0;
  function nextCEId() { return 'ce-' + (++customElemIdSeq); }

  // ── Access road line registry ─────────────────────────────
  // Each entry: { id, lineIndex, node, origStroke, x1, y1, x2, y2 }
  // lineIndex = the boundary segment index (from accessLines Set)
  // id = the labelPositions key e.g. 'line-ar-outer-2'
  let arLineElements = [];
  let selectedARLine = null; // id of currently selected AR line

  // ── Helpers ───────────────────────────────────────────────
  function getMainG() {
    return d3.select('#plot-container svg g.plot-group');
  }
  function getSVGEl() {
    return document.querySelector('#plot-container svg');
  }
  function getZoomK() {
    const svg = getSVGEl();
    if (!svg) return 1;
    return d3.zoomTransform(svg).k;
  }
  function clientToSVGPoint(clientX, clientY) {
    const svg = getSVGEl();
    if (!svg) return { x: clientX, y: clientY };
    const pt = svg.createSVGPoint();
    pt.x = clientX; pt.y = clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: clientX, y: clientY };
    const inv = ctm.inverse();
    const transformed = pt.matrixTransform(inv);
    // Account for the zoom/pan transform on mainG
    const mainGNode = svg.querySelector('g.plot-group');
    if (mainGNode) {
      const gTransform = mainGNode.getAttribute('transform') || '';
      // Parse translate and scale from d3 zoom transform
      const match = gTransform.match(/translate\(([^,]+),([^)]+)\)\s*scale\(([^)]+)\)/);
      if (match) {
        const tx = parseFloat(match[1]), ty = parseFloat(match[2]), k = parseFloat(match[3]);
        return { x: (transformed.x - tx) / k, y: (transformed.y - ty) / k };
      }
    }
    return { x: transformed.x, y: transformed.y };
  }

  // ── Selection highlight ───────────────────────────────────
  function selectCustomEl(id) {
    deselectAll();
    selectedDrawEl = id;
    const entry = customElements.find(e => e.id === id);
    if (!entry) return;
    const node = entry.node;
    if (entry.type === 'text') {
      d3.select(node).attr('fill', '#6366f1');
    } else {
      d3.select(node).attr('stroke', '#6366f1');
    }
    showResizeHandles(entry);

    // Sync rotate slider to this element's current angle
    const currentAngle = entry.type === 'line' ? (() => {
      const dx = entry.x2 - entry.x1, dy = entry.y2 - entry.y1;
      return Math.round(Math.atan2(dy, dx) * 180 / Math.PI);
    })() : (entry.angle || 0);
    const rs = document.getElementById('rotate-slider');
    const rd = document.getElementById('rotate-display');
    if (rs) rs.value = currentAngle;
    if (rd) rd.textContent = currentAngle + '°';
    // Clear plot-label selection so slider targets custom element
    selectedTextId = null;
    d3.selectAll('[data-textid]').attr('fill', '#333');
  }

  function deselectAll() {
    customElements.forEach(e => {
      if (e.node) {
        if (e.type === 'text') {
          d3.select(e.node).attr('fill', '#333');
        } else {
          d3.select(e.node).attr('stroke', e.origStroke || '#333');
        }
      }
      if (e.handleGroup) d3.select(e.handleGroup).style('display', 'none');
    });
    selectedDrawEl = null;
    // Also deselect any selected AR line
    deselectAllARLines();
  }

  // ── Delete selected custom element ───────────────────────
  document.getElementById('delete-btn')?.addEventListener('click', () => {
    // ── AR line selected? ─────────────────────────────────
    if (selectedARLine) {
      const entry = arLineElements.find(e => e.id === selectedARLine);
      if (entry) {
        // Remove the SVG node
        if (entry.node?.parentNode) entry.node.parentNode.removeChild(entry.node);
        // Remove from registry
        const idx = arLineElements.indexOf(entry);
        if (idx !== -1) arLineElements.splice(idx, 1);
        // Remove persisted drag position
        delete labelPositions[entry.id];
        selectedARLine = null;
        saveState();
        return;
      }
    }

    if (!selectedDrawEl) {
      if (selectedTextId) {
        const svg = getSVGEl();
        if (svg) {
          const el = svg.querySelector(`[data-textid="${selectedTextId}"]`);
          if (el) {
            const tid = selectedTextId;
            // Pillar labels (txt-pt-) and distance labels (txt-d-) → not deletable
            const isProtected = tid.startsWith('txt-pt-') || tid.startsWith('txt-d-') || tid.startsWith('txt-b-');
            if (isProtected) {
              showFeedback('generate-feedback', "This element can't be deleted.", 'warning');
              return;
            }
            // Bearing text and access road text → deletable
            const isDeletable = tid.startsWith('txt-ar-');
            if (isDeletable) {
              el.parentNode?.removeChild(el);
              delete labelPositions[tid];
              deletedLabels.add(tid);   // prevent re-render from bringing it back
              selectedTextId = null;
              d3.selectAll('[data-textid]').attr('fill', '#333');
              saveState();
              return;
            }
          }
          const selLine = svg.querySelector('line.ce-selected, [data-lineid].selected');
          if (selLine) { selLine.parentNode?.removeChild(selLine); return; }
        }
      }
      showFeedback('generate-feedback', 'Select an element first, then click Delete.', 'warning');
      return;
    }
    const idx = customElements.findIndex(e => e.id === selectedDrawEl);
    if (idx === -1) return;
    const entry = customElements[idx];
    if (entry.node?.parentNode)   entry.node.parentNode.removeChild(entry.node);
    if (entry.handleGroup?.parentNode) entry.handleGroup.parentNode.removeChild(entry.handleGroup);
    if (entry.foreignObject?.parentNode) entry.foreignObject.parentNode.removeChild(entry.foreignObject);
    customElements.splice(idx, 1);
    selectedDrawEl = null;
  });

  // ── Toggle dimension inputs when tool buttons clicked ─────
  function setActiveTool(mode) {
    // Hide all dimension panels
    ['square-inputs','straight-inputs','dashed-inputs'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
    // Remove active highlight from all tool buttons
    ['square-btn','straight-btn','dashed-btn','create-text'].forEach(id => {
      const btn = document.getElementById(id);
      if (btn) btn.style.outline = '';
    });

    if (drawingMode === mode) {
      // Toggle off
      drawingMode = null;
      return;
    }
    drawingMode = mode;

    const panelMap = { square: 'square-inputs', straight: 'straight-inputs', dashed: 'dashed-inputs' };
    if (panelMap[mode]) {
      const panel = document.getElementById(panelMap[mode]);
      if (panel) { panel.style.display = 'flex'; panel.style.gap = '6px'; panel.style.flexWrap = 'wrap'; }
    }

    const btnMap = { square: 'square-btn', straight: 'straight-btn', dashed: 'dashed-btn', text: 'create-text' };
    const activeBtn = document.getElementById(btnMap[mode]);
    if (activeBtn) activeBtn.style.outline = '2px solid #6366f1';

    // If text mode, show crosshair on canvas so user knows to click to place
    if (mode === 'text') {
      placingText = true;
      const svgEl = getSVGEl();
      if (svgEl) svgEl.style.cursor = 'crosshair';
      showFeedback('generate-feedback', 'Click anywhere on the plot to place a text box.', 'info');
    } else {
      placingText = false;
      const svgEl = getSVGEl();
      if (svgEl) svgEl.style.cursor = 'grab';
    }
  }

  document.getElementById('square-btn')?.addEventListener('click', () => setActiveTool('square'));
  document.getElementById('straight-btn')?.addEventListener('click', () => setActiveTool('straight'));
  document.getElementById('dashed-btn')?.addEventListener('click', () => setActiveTool('dashed'));
  document.getElementById('create-text')?.addEventListener('click', () => setActiveTool('text'));

  // Initially hide the inputs
  ['square-inputs','straight-inputs','dashed-inputs'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });

  // ── Place/draw elements on canvas ─────────────────────────
  let placingText = false;
  let _drawPending = false; // debounce guard to prevent double-draw

  function onceDraw(fn) {
    if (_drawPending) return;
    _drawPending = true;
    fn();
    setTimeout(() => { _drawPending = false; }, 300);
  }

  // Listen for Enter key in dimension inputs to trigger drawing
  document.getElementById('square-height')?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); onceDraw(drawSquareOnCanvas); } });
  document.getElementById('square-width')?.addEventListener('keydown',  e => { if (e.key === 'Enter') { e.preventDefault(); onceDraw(drawSquareOnCanvas); } });
  document.getElementById('straight-length')?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); onceDraw(drawStraightOnCanvas); } });
  document.getElementById('dashed-length')?.addEventListener('keydown',   e => { if (e.key === 'Enter') { e.preventDefault(); onceDraw(drawDashedOnCanvas); } });

  // Inject "Draw" buttons next to each input group
  (function injectDrawButtons() {
    const configs = [
      { panelId: 'square-inputs',   fn: () => onceDraw(drawSquareOnCanvas) },
      { panelId: 'straight-inputs', fn: () => onceDraw(drawStraightOnCanvas) },
      { panelId: 'dashed-inputs',   fn: () => onceDraw(drawDashedOnCanvas) }
    ];
    configs.forEach(({ panelId, fn }) => {
      const panel = document.getElementById(panelId);
      if (!panel || panel.querySelector('.draw-now-btn')) return;
      const btn = document.createElement('button');
      btn.className = 'draw-now-btn'; btn.textContent = 'Draw';
      btn.style.cssText = 'margin-top:6px;padding:4px 10px;border-radius:5px;border:1px solid #6366f1;background:#6366f1;color:#fff;cursor:pointer;font-size:12px;width:100%;';
      btn.addEventListener('click', fn);
      panel.appendChild(btn);
    });
  })();

  function getPlotCenter() {
    const svg = getSVGEl();
    if (!svg) return { x: 350, y: 280 };
    // Return center in SVG local coords accounting for zoom
    const w = svg.clientWidth || 700, h = svg.clientHeight || 560;
    const pt = clientToSVGPoint(w / 2, h / 2);
    return pt;
  }

  function drawSquareOnCanvas() {
    const hVal = parseFloat(document.getElementById('square-height')?.value);
    const wVal = parseFloat(document.getElementById('square-width')?.value);
    if (isNaN(hVal) || isNaN(wVal) || hVal <= 0 || wVal <= 0) return;

    const mainG = getMainG();
    if (mainG.empty()) { showFeedback('generate-feedback', 'Plot something first before drawing.', 'warning'); return; }

    // Use plot container center as default placement
    const c = getPlotCenter();
    const scaleDenom = getScaleDenominator();
    const pxPerM = (() => {
      const svg = getSVGEl();
      if (!svg) return 1;
      const cont = document.getElementById('plot-container');
      const totalW = cont?.clientWidth || 700;
      const MM_TO_PX = 3.7795;
      const eastings = currentPoints.map(p => p.easting);
      const rangeE = (Math.max(...eastings) - Math.min(...eastings)) || 1;
      const A4_W_MM = 185, A4_H_MM = 265;
      const physW_px = (rangeE * 1000 / scaleDenom) * MM_TO_PX;
      const physH_px = ((Math.max(...currentPoints.map(p=>p.northing)) - Math.min(...currentPoints.map(p=>p.northing))||1) * 1000 / scaleDenom) * MM_TO_PX;
      const fit = Math.min((A4_W_MM * MM_TO_PX) / physW_px, (A4_H_MM * MM_TO_PX) / physH_px, 1);
      const drawW = physW_px * fit;
      return drawW / rangeE;
    })();

    const pw = currentPoints.length >= 3 ? wVal * pxPerM : wVal;
    const ph = currentPoints.length >= 3 ? hVal * pxPerM : hVal;
    const x = c.x - pw / 2, y = c.y - ph / 2;
    const id = nextCEId();
    const rect = mainG.append('rect')
      .attr('x', x).attr('y', y)
      .attr('width', pw).attr('height', ph)
      .attr('fill', 'none').attr('stroke', '#333').attr('stroke-width', 1.2)
      .attr('data-ceid', id)
      .attr('cursor', 'crosshair');

    const entry = { id, type: 'rect', node: rect.node(), origStroke: '#333', x, y, w: pw, h: ph };
    customElements.push(entry);
    makeCustomElInteractive(entry);
    setActiveTool(null);
    drawingMode = null;
  }

  function drawLineOnCanvas(dashed) {
    const lenId = dashed ? 'dashed-length' : 'straight-length';
    const lenVal = parseFloat(document.getElementById(lenId)?.value);
    if (isNaN(lenVal) || lenVal <= 0) return;

    const mainG = getMainG();
    if (mainG.empty()) { showFeedback('generate-feedback', 'Plot something first before drawing.', 'warning'); return; }

    const c = getPlotCenter();
    const scaleDenom = getScaleDenominator();
    const pxPerM = (() => {
      if (!currentPoints.length) return 1;
      const eastings = currentPoints.map(p => p.easting);
      const rangeE = (Math.max(...eastings) - Math.min(...eastings)) || 1;
      const MM_TO_PX = 3.7795;
      const A4_W_MM = 185, A4_H_MM = 265;
      const physW_px = (rangeE * 1000 / scaleDenom) * MM_TO_PX;
      const physH_px = ((Math.max(...currentPoints.map(p=>p.northing)) - Math.min(...currentPoints.map(p=>p.northing))||1) * 1000 / scaleDenom) * MM_TO_PX;
      const fit = Math.min((A4_W_MM * MM_TO_PX) / physW_px, (A4_H_MM * MM_TO_PX) / physH_px, 1);
      return (physW_px * fit) / rangeE;
    })();

    const pLen = currentPoints.length >= 3 ? lenVal * pxPerM : lenVal;
    const x1 = c.x - pLen / 2, y1 = c.y, x2 = c.x + pLen / 2, y2 = c.y;
    const id = nextCEId();
    const line = mainG.append('line')
      .attr('x1', x1).attr('y1', y1).attr('x2', x2).attr('y2', y2)
      .attr('stroke', '#333').attr('stroke-width', 1.2)
      .attr('stroke-dasharray', dashed ? '6,3' : 'none')
      .attr('data-ceid', id)
      .attr('cursor', 'crosshair');

    const entry = { id, type: 'line', node: line.node(), origStroke: '#333', dashed, x1, y1, x2, y2 };
    customElements.push(entry);
    makeCustomElInteractive(entry);
    setActiveTool(null);
    drawingMode = null;
  }

  function drawStraightOnCanvas() { drawLineOnCanvas(false); }
  function drawDashedOnCanvas()   { drawLineOnCanvas(true); }

  // ── Unified click handler on plot-container ───────────────
  // Handles: placing text, proximity-select, and deselecting custom elements
  document.getElementById('plot-container')?.addEventListener('click', function(e) {
    // If clicking directly on a custom element, skip — its own handler fires
    if (e.target.closest('[data-ceid]')) return;

    if (placingText) {
      placingText = false;
      const btn = document.getElementById('create-text');
      if (btn) btn.style.outline = '';
      drawingMode = null;

      const mainGSel = getMainG();
      if (mainGSel.empty()) {
        showFeedback('generate-feedback', 'Plot something first before adding text.', 'warning');
        return;
      }

      const svgEl = getSVGEl();
      if (!svgEl) return;
      const svgRect = svgEl.getBoundingClientRect();
      const rawX = e.clientX - svgRect.left;
      const rawY = e.clientY - svgRect.top;
      const t = d3.zoomTransform(svgEl);
      const lx = (rawX - t.x) / t.k;
      const ly = (rawY - t.y) / t.k;

      const id = nextCEId();
      placeCustomText(mainGSel, lx, ly, id, 'Custom text');
      return;
    }

    // Proximity-based selection: check AR lines first, then custom elements
    const svgEl = getSVGEl();
    if (svgEl) {
      const svgRect = svgEl.getBoundingClientRect();
      const rawX = e.clientX - svgRect.left;
      const rawY = e.clientY - svgRect.top;
      const t = d3.zoomTransform(svgEl);
      const lx = (rawX - t.x) / t.k;
      const ly = (rawY - t.y) / t.k;

      // AR lines
      if (arLineElements.length > 0) {
        const nearAR = getNearestARLine(lx, ly, AR_PROX_PX / t.k);
        if (nearAR) { selectARLine(nearAR.id); return; }
      }

      // Custom drawn elements
      if (customElements.length > 0) {
        const nearest = getNearestEntry(lx, ly, PROX_PX / t.k);
        if (nearest) { selectCustomEl(nearest.id); return; }
      }
    }

    // Nothing near — deselect
    deselectAll();
  });

  function placeCustomText(mainGSel, x, y, id, initialText) {
    const k = getZoomK();
    // We use a plain SVG text element (editable via double-click)
    const textEl = mainGSel.append('text')
      .attr('x', x).attr('y', y)
      .attr('text-anchor', 'start')
      .attr('dominant-baseline', 'middle')
      .attr('font-size', currentFontSize + 'px')
      .attr('font-family', 'monospace')
      .attr('fill', '#333')
      .attr('cursor', 'crosshair')
      .attr('data-ceid', id)
      .attr('data-angle', 0)
      .text(initialText);

    const entry = { id, type: 'text', node: textEl.node(), origStroke: '#333', x, y, angle: 0, text: initialText };
    customElements.push(entry);
    makeCustomElInteractive(entry);
    return entry;
  }

  // ── Make custom elements interactive ─────────────────────
  function makeCustomElInteractive(entry) {
    const el = d3.select(entry.node);

    // Cursor crosshair on hover → signals interactability
    el.on('mouseenter.tool', function() {
      d3.select(this).style('cursor', 'crosshair');
    });

    // Click to select
    el.on('click.select', function(event) {
      event.stopPropagation();
      selectCustomEl(entry.id);
    });

    // Double-click to edit text
    if (entry.type === 'text') {
      el.on('dblclick.edit', function(event) {
        event.stopPropagation();
        startInlineTextEdit(entry);
      });
    }

    // Drag to move (whole element)
    el.on('mousedown.move', function(event) {
      if (event.button !== 0) return;
      event.stopPropagation(); event.preventDefault();
      selectCustomEl(entry.id);

      const svgEl = getSVGEl();
      const k = svgEl ? d3.zoomTransform(svgEl).k : 1;

      if (entry.type === 'rect') {
        const ox = parseFloat(el.attr('x')), oy = parseFloat(el.attr('y'));
        const sx0 = event.clientX, sy0 = event.clientY;
        function mv(e) {
          const nx = ox + (e.clientX - sx0) / k, ny = oy + (e.clientY - sy0) / k;
          el.attr('x', nx).attr('y', ny);
          entry.x = nx; entry.y = ny;
          repositionHandles(entry);
        }
        function up() { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); }
        window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);

      } else if (entry.type === 'line') {
        const cx1 = parseFloat(el.attr('x1')), cy1 = parseFloat(el.attr('y1'));
        const cx2 = parseFloat(el.attr('x2')), cy2 = parseFloat(el.attr('y2'));
        const sx0 = event.clientX, sy0 = event.clientY;
        function mv(e) {
          const dx = (e.clientX - sx0) / k, dy = (e.clientY - sy0) / k;
          el.attr('x1', cx1+dx).attr('y1', cy1+dy).attr('x2', cx2+dx).attr('y2', cy2+dy);
          entry.x1 = cx1+dx; entry.y1 = cy1+dy; entry.x2 = cx2+dx; entry.y2 = cy2+dy;
          repositionHandles(entry);
        }
        function up() { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); }
        window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);

      } else if (entry.type === 'text') {
        const ox = parseFloat(el.attr('x')), oy = parseFloat(el.attr('y'));
        const sx0 = event.clientX, sy0 = event.clientY;
        const ang = parseFloat(el.attr('data-angle') || 0);
        function mv(e) {
          const nx = ox + (e.clientX - sx0) / k, ny = oy + (e.clientY - sy0) / k;
          el.attr('x', nx).attr('y', ny).attr('transform', `rotate(${ang},${nx},${ny})`);
          entry.x = nx; entry.y = ny;
          repositionHandles(entry);
        }
        function up() { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); }
        window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
      }
    });

    // Create resize/rotate handles
    addHandles(entry);
  }

  // ── Rewire events only (used on reattach after renderPlot) ───
  // Same as makeCustomElInteractive but skips addHandles so we don't
  // create a second set of handle circles on an entry that already has them.
  function rewireCustomEl(entry) {
    const el = d3.select(entry.node);

    el.on('mouseenter.tool', function() { d3.select(this).style('cursor', 'crosshair'); });
    el.on('click.select', function(event) { event.stopPropagation(); selectCustomEl(entry.id); });

    if (entry.type === 'text') {
      el.on('dblclick.edit', function(event) { event.stopPropagation(); startInlineTextEdit(entry); });
    }

    el.on('mousedown.move', function(event) {
      if (event.button !== 0) return;
      event.stopPropagation(); event.preventDefault();
      selectCustomEl(entry.id);
      const svgEl = getSVGEl();
      const k = svgEl ? d3.zoomTransform(svgEl).k : 1;

      if (entry.type === 'rect') {
        const ox = parseFloat(el.attr('x')), oy = parseFloat(el.attr('y'));
        const sx0 = event.clientX, sy0 = event.clientY;
        function mv(e) { const nx=ox+(e.clientX-sx0)/k,ny=oy+(e.clientY-sy0)/k; el.attr('x',nx).attr('y',ny); entry.x=nx; entry.y=ny; repositionHandles(entry); }
        function up() { window.removeEventListener('mousemove',mv); window.removeEventListener('mouseup',up); }
        window.addEventListener('mousemove',mv); window.addEventListener('mouseup',up);
      } else if (entry.type === 'line') {
        const cx1=parseFloat(el.attr('x1')),cy1=parseFloat(el.attr('y1')),cx2=parseFloat(el.attr('x2')),cy2=parseFloat(el.attr('y2'));
        const sx0=event.clientX,sy0=event.clientY;
        function mv(e) { const dx=(e.clientX-sx0)/k,dy=(e.clientY-sy0)/k; el.attr('x1',cx1+dx).attr('y1',cy1+dy).attr('x2',cx2+dx).attr('y2',cy2+dy); entry.x1=cx1+dx;entry.y1=cy1+dy;entry.x2=cx2+dx;entry.y2=cy2+dy; repositionHandles(entry); }
        function up() { window.removeEventListener('mousemove',mv); window.removeEventListener('mouseup',up); }
        window.addEventListener('mousemove',mv); window.addEventListener('mouseup',up);
      } else if (entry.type === 'text') {
        const ox=parseFloat(el.attr('x')),oy=parseFloat(el.attr('y'));
        const sx0=event.clientX,sy0=event.clientY;
        const ang=parseFloat(el.attr('data-angle')||0);
        function mv(e) { const nx=ox+(e.clientX-sx0)/k,ny=oy+(e.clientY-sy0)/k; el.attr('x',nx).attr('y',ny).attr('transform',`rotate(${ang},${nx},${ny})`); entry.x=nx;entry.y=ny; repositionHandles(entry); }
        function up() { window.removeEventListener('mousemove',mv); window.removeEventListener('mouseup',up); }
        window.addEventListener('mousemove',mv); window.addEventListener('mouseup',up);
      }
    });
  }

  // ── Handles (resize + rotate) ─────────────────────────────
  function addHandles(entry) {
    const mainG = getMainG();
    if (mainG.empty()) return;

    const hg = mainG.append('g')
      .attr('class', 'ce-handles')
      .attr('data-for', entry.id)
      .style('display', 'none');

    entry.handleGroup = hg.node();

    // We'll draw circles at the corners/endpoints
    // For rect: 4 corner handles + 1 rotate handle (top center)
    // For line: 2 endpoint handles + 1 rotate handle (midpoint)
    // For text: 1 rotate handle

    if (entry.type === 'rect') {
      // 4 corner handles
      const corners = ['tl','tr','br','bl'];
      corners.forEach(corner => {
        const h = hg.append('circle')
          .attr('r', 5)
          .attr('fill', '#6366f1')
          .attr('stroke', '#fff')
          .attr('stroke-width', 1.5)
          .attr('cursor', 'nwse-resize')
          .attr('data-handle', corner);
        h.on('mousedown.resize', function(event) {
          event.stopPropagation(); event.preventDefault();
          const svgEl = getSVGEl();
          const k = svgEl ? d3.zoomTransform(svgEl).k : 1;
          const sx0 = event.clientX, sy0 = event.clientY;
          const origX = entry.x, origY = entry.y, origW = entry.w, origH = entry.h;
          function mv(e) {
            const dx = (e.clientX - sx0) / k, dy = (e.clientY - sy0) / k;
            let nx = origX, ny = origY, nw = origW, nh = origH;
            if (corner === 'tl') { nx = origX + dx; ny = origY + dy; nw = origW - dx; nh = origH - dy; }
            if (corner === 'tr') { ny = origY + dy; nw = origW + dx; nh = origH - dy; }
            if (corner === 'br') { nw = origW + dx; nh = origH + dy; }
            if (corner === 'bl') { nx = origX + dx; nw = origW - dx; nh = origH + dy; }
            if (nw < 5) nw = 5; if (nh < 5) nh = 5;
            entry.x = nx; entry.y = ny; entry.w = nw; entry.h = nh;
            d3.select(entry.node).attr('x', nx).attr('y', ny).attr('width', nw).attr('height', nh);
            repositionHandles(entry);
          }
          function up() { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); }
          window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
        });
      });
      // Rotate handle (top center)
      const rh = hg.append('circle')
        .attr('r', 5).attr('fill', '#f59e0b').attr('stroke', '#fff').attr('stroke-width', 1.5)
        .attr('cursor', 'grab').attr('data-handle', 'rotate');
      rh.on('mousedown.rotate', function(event) {
        event.stopPropagation(); event.preventDefault();
        const cx = entry.x + entry.w / 2, cy = entry.y + entry.h / 2;
        function mv(e) {
          const pt = clientToSVGPoint(e.clientX, e.clientY);
          const angle = Math.atan2(pt.y - cy, pt.x - cx) * 180 / Math.PI + 90;
          entry.angle = angle;
          d3.select(entry.node).attr('transform', `rotate(${angle},${cx},${cy})`);
          repositionHandles(entry);
        }
        function up() { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); }
        window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
      });
    }

    if (entry.type === 'line') {
      // 2 endpoint handles
      ['p1','p2'].forEach(ep => {
        const h = hg.append('circle')
          .attr('r', 5).attr('fill', '#6366f1').attr('stroke', '#fff').attr('stroke-width', 1.5)
          .attr('cursor', 'move').attr('data-handle', ep);
        h.on('mousedown.stretch', function(event) {
          event.stopPropagation(); event.preventDefault();
          const svgEl = getSVGEl();
          const k = svgEl ? d3.zoomTransform(svgEl).k : 1;
          const sx0 = event.clientX, sy0 = event.clientY;
          const orig1x = entry.x1, orig1y = entry.y1, orig2x = entry.x2, orig2y = entry.y2;
          function mv(e) {
            const dx = (e.clientX - sx0) / k, dy = (e.clientY - sy0) / k;
            if (ep === 'p1') { entry.x1 = orig1x + dx; entry.y1 = orig1y + dy; }
            else             { entry.x2 = orig2x + dx; entry.y2 = orig2y + dy; }
            d3.select(entry.node)
              .attr('x1', entry.x1).attr('y1', entry.y1)
              .attr('x2', entry.x2).attr('y2', entry.y2);
            repositionHandles(entry);
          }
          function up() { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); }
          window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
        });
      });
      // Rotate handle at midpoint (perpendicular)
      const rh = hg.append('circle')
        .attr('r', 5).attr('fill', '#f59e0b').attr('stroke', '#fff').attr('stroke-width', 1.5)
        .attr('cursor', 'grab').attr('data-handle', 'rotate');
      rh.on('mousedown.rotate', function(event) {
        event.stopPropagation(); event.preventDefault();
        const mx = (entry.x1 + entry.x2) / 2, my = (entry.y1 + entry.y2) / 2;
        const len = Math.sqrt((entry.x2-entry.x1)**2 + (entry.y2-entry.y1)**2);
        function mv(e) {
          const pt = clientToSVGPoint(e.clientX, e.clientY);
          const angle = Math.atan2(pt.y - my, pt.x - mx);
          entry.x1 = mx - Math.cos(angle) * len / 2;
          entry.y1 = my - Math.sin(angle) * len / 2;
          entry.x2 = mx + Math.cos(angle) * len / 2;
          entry.y2 = my + Math.sin(angle) * len / 2;
          d3.select(entry.node)
            .attr('x1', entry.x1).attr('y1', entry.y1)
            .attr('x2', entry.x2).attr('y2', entry.y2);
          repositionHandles(entry);
        }
        function up() { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); }
        window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
      });
    }

    if (entry.type === 'text') {
      // Rotate handle
      const rh = hg.append('circle')
        .attr('r', 5).attr('fill', '#f59e0b').attr('stroke', '#fff').attr('stroke-width', 1.5)
        .attr('cursor', 'grab').attr('data-handle', 'rotate');
      rh.on('mousedown.rotate', function(event) {
        event.stopPropagation(); event.preventDefault();
        const x = entry.x, y = entry.y;
        function mv(e) {
          const pt = clientToSVGPoint(e.clientX, e.clientY);
          const angle = Math.atan2(pt.y - y, pt.x - x) * 180 / Math.PI;
          entry.angle = angle;
          d3.select(entry.node).attr('data-angle', angle).attr('transform', `rotate(${angle},${x},${y})`);
          repositionHandles(entry);
        }
        function up() { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); }
        window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
      });
    }

    repositionHandles(entry);
  }

  function repositionHandles(entry) {
    if (!entry.handleGroup) return;
    const hg = d3.select(entry.handleGroup);

    if (entry.type === 'rect') {
      const { x, y, w, h, angle = 0 } = entry;
      const cx = x + w / 2, cy = y + h / 2;
      const corners = { tl: [x, y], tr: [x+w, y], br: [x+w, y+h], bl: [x, y+h] };
      Object.entries(corners).forEach(([key, [px, py]]) => {
        hg.select(`[data-handle="${key}"]`).attr('cx', px).attr('cy', py);
      });
      hg.select('[data-handle="rotate"]').attr('cx', cx).attr('cy', y - 16);

    } else if (entry.type === 'line') {
      hg.select('[data-handle="p1"]').attr('cx', entry.x1).attr('cy', entry.y1);
      hg.select('[data-handle="p2"]').attr('cx', entry.x2).attr('cy', entry.y2);
      hg.select('[data-handle="rotate"]')
        .attr('cx', (entry.x1 + entry.x2) / 2)
        .attr('cy', (entry.y1 + entry.y2) / 2 - 14);

    } else if (entry.type === 'text') {
      hg.select('[data-handle="rotate"]').attr('cx', entry.x).attr('cy', entry.y - 16);
    }
  }

  function showResizeHandles(entry) {
    if (!entry.handleGroup) return;
    d3.select(entry.handleGroup).style('display', '');
    repositionHandles(entry);
  }

  // ── Proximity drag — mousedown on container starts drag if near an element ──
  document.getElementById('plot-container')?.addEventListener('mousedown', function(e) {
    if (e.button !== 0) return;
    if (placingText) return;
    if (e.target.closest('[data-ceid]')) return; // element's own handler takes over
    if (e.target.closest('[data-arid]')) return; // AR line's own handler takes over

    const svgEl = getSVGEl();
    if (!svgEl) return;
    const svgRect = svgEl.getBoundingClientRect();
    const rawX = e.clientX - svgRect.left;
    const rawY = e.clientY - svgRect.top;
    const t = d3.zoomTransform(svgEl);
    const lx = (rawX - t.x) / t.k;
    const ly = (rawY - t.y) / t.k;

    // Check AR lines first (they sit on top of custom elements visually)
    if (arLineElements.length > 0) {
      const nearAR = getNearestARLine(lx, ly, AR_PROX_PX / t.k);
      if (nearAR) {
        e.stopPropagation(); e.preventDefault();
        selectARLine(nearAR.id);
        const k = t.k;
        const cx1 = nearAR.x1, cy1 = nearAR.y1, cx2 = nearAR.x2, cy2 = nearAR.y2;
        const sx0 = e.clientX, sy0 = e.clientY;
        const elSel = d3.select(nearAR.node);
        function mv(ev) {
          const dx = (ev.clientX - sx0) / k, dy = (ev.clientY - sy0) / k;
          const nx1 = cx1+dx, ny1 = cy1+dy, nx2 = cx2+dx, ny2 = cy2+dy;
          elSel.attr('x1', nx1).attr('y1', ny1).attr('x2', nx2).attr('y2', ny2);
          nearAR.x1 = nx1; nearAR.y1 = ny1; nearAR.x2 = nx2; nearAR.y2 = ny2;
          labelPositions[nearAR.id] = { x1: nx1, y1: ny1, x2: nx2, y2: ny2 };
        }
        function up() { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); saveState(); }
        window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
        return;
      }
    }

    if (customElements.length === 0) return;
    const nearest = getNearestEntry(lx, ly, PROX_PX / t.k);
    if (!nearest) return;

    // Select it and start moving
    e.stopPropagation();
    e.preventDefault();
    selectCustomEl(nearest.id);

    const entry = nearest;
    const elSel = d3.select(entry.node);
    const k = t.k;

    if (entry.type === 'rect') {
      const ox = entry.x, oy = entry.y;
      const sx0 = e.clientX, sy0 = e.clientY;
      function mv(ev) {
        const nx = ox + (ev.clientX - sx0) / k, ny = oy + (ev.clientY - sy0) / k;
        elSel.attr('x', nx).attr('y', ny);
        entry.x = nx; entry.y = ny;
        repositionHandles(entry);
      }
      function up() { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); }
      window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);

    } else if (entry.type === 'line') {
      const cx1 = entry.x1, cy1 = entry.y1, cx2 = entry.x2, cy2 = entry.y2;
      const sx0 = e.clientX, sy0 = e.clientY;
      function mv(ev) {
        const dx = (ev.clientX - sx0) / k, dy = (ev.clientY - sy0) / k;
        entry.x1 = cx1+dx; entry.y1 = cy1+dy; entry.x2 = cx2+dx; entry.y2 = cy2+dy;
        elSel.attr('x1', entry.x1).attr('y1', entry.y1).attr('x2', entry.x2).attr('y2', entry.y2);
        repositionHandles(entry);
      }
      function up() { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); }
      window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);

    } else if (entry.type === 'text') {
      const ox = entry.x, oy = entry.y;
      const ang = entry.angle || 0;
      const sx0 = e.clientX, sy0 = e.clientY;
      function mv(ev) {
        const nx = ox + (ev.clientX - sx0) / k, ny = oy + (ev.clientY - sy0) / k;
        elSel.attr('x', nx).attr('y', ny).attr('transform', `rotate(${ang},${nx},${ny})`);
        entry.x = nx; entry.y = ny;
        repositionHandles(entry);
      }
      function up() { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); }
      window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
    }
  });

  // ── Inline text editing ────────────────────────────────────
  function startInlineTextEdit(entry) {
    const svgEl = getSVGEl();
    if (!svgEl) return;
    const textNode = entry.node;
    const currentText = textNode.textContent;

    // Create a temporary HTML input over the element
    const svgRect = svgEl.getBoundingClientRect();
    const bbox = textNode.getBoundingClientRect();

    const inp = document.createElement('input');
    inp.type = 'text';
    inp.value = currentText;
    inp.style.cssText = `
      position: fixed;
      left: ${bbox.left}px; top: ${bbox.top}px;
      min-width: ${Math.max(bbox.width, 80)}px;
      font-size: ${currentFontSize}px;
      font-family: monospace;
      border: 1.5px solid #6366f1;
      border-radius: 3px;
      padding: 2px 4px;
      background: #fff;
      color: #333;
      z-index: 99999;
      outline: none;
    `;
    document.body.appendChild(inp);
    inp.focus(); inp.select();

    function commit() {
      const newText = inp.value.trim() || currentText;
      d3.select(textNode).text(newText);
      entry.text = newText;
      document.body.removeChild(inp);
    }
    inp.addEventListener('blur', commit);
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } if (e.key === 'Escape') { document.body.removeChild(inp); } });
  }

  // ── Delete key shortcut ───────────────────────────────────
  document.addEventListener('keydown', function(e) {
    if ((e.key === 'Delete' || e.key === 'Backspace') && e.target === document.body) {
      if (selectedDrawEl || selectedARLine) {
        document.getElementById('delete-btn')?.click();
      }
    }
  });

  // ── Proximity cursor — "+" when within 1.5cm (~28px) of any custom element ──
  // We attach to the SVG element and recheck on every mousemove.
  // Distance to a line segment and to a rect's 4 edges are checked.
  const PROX_PX    = 28;  // proximity threshold for custom drawn elements (~1.5cm at 96dpi)
  const AR_PROX_PX = 38;  // larger threshold for thin AR lines (~1cm at 96dpi, easier to grab)

  function ptToSegDist(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return Math.hypot(px - x1, py - y1);
    const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  }

  function distToEntry(entry, mx, my) {
    if (entry.type === 'line') {
      return ptToSegDist(mx, my, entry.x1, entry.y1, entry.x2, entry.y2);
    }
    if (entry.type === 'rect') {
      const { x, y, w, h } = entry;
      return Math.min(
        ptToSegDist(mx, my, x,   y,   x+w, y),
        ptToSegDist(mx, my, x+w, y,   x+w, y+h),
        ptToSegDist(mx, my, x+w, y+h, x,   y+h),
        ptToSegDist(mx, my, x,   y+h, x,   y)
      );
    }
    if (entry.type === 'text') {
      return Math.hypot(mx - entry.x, my - entry.y);
    }
    return Infinity;
  }

  function getNearestEntry(lx, ly, thresholdLocal) {
    let best = null, bestDist = Infinity;
    customElements.forEach(entry => {
      const d = distToEntry(entry, lx, ly);
      if (d <= thresholdLocal && d < bestDist) { bestDist = d; best = entry; }
    });
    return best;
  }

  // Returns nearest AR line entry within threshold (or null)
  function getNearestARLine(lx, ly, thresholdLocal) {
    let best = null, bestDist = Infinity;
    arLineElements.forEach(entry => {
      const d = ptToSegDist(lx, ly, entry.x1, entry.y1, entry.x2, entry.y2);
      if (d <= thresholdLocal && d < bestDist) { bestDist = d; best = entry; }
    });
    return best;
  }

  document.getElementById('plot-container')?.addEventListener('mousemove', function(e) {
    if (placingText) return; // already crosshair
    const svgEl = getSVGEl();
    if (!svgEl) return;
    const svgRect = svgEl.getBoundingClientRect();
    const rawX = e.clientX - svgRect.left;
    const rawY = e.clientY - svgRect.top;
    const t = d3.zoomTransform(svgEl);
    const lx = (rawX - t.x) / t.k;
    const ly = (rawY - t.y) / t.k;

    const near = getNearestEntry(lx, ly, PROX_PX / t.k) || getNearestARLine(lx, ly, AR_PROX_PX / t.k);
    svgEl.style.cursor = near ? 'crosshair' : 'grab';
  });

});