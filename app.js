// ================================================================
// PEPINIQUOTE v2 — Rewritten cleanly
// ================================================================

const MAX_SUPPLIERS = 5;
let suppliers = []; // { id, name, lastUpdate, data: [{name, cond, size, height, circ, forme, price}], rawHeaders, mapping }
let pricingMode = 'particulier'; // 'particulier' | 'pro'
let pendingMapping = null; // temp state for mapping modal

// ============ INIT ============
function init() {
  loadFromStorage();
  renderSupplierCards();
  updateSupplierCount();
}

// ============ PAGES ============
function showPage(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-' + page).classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => {
    if ((page === 'dashboard' && b.textContent === 'Fournisseurs') ||
        (page === 'quote' && b.textContent === 'Nouveau devis')) {
      b.classList.add('active');
    }
  });
}

// ============ PRICING ============
function setPricingMode(mode) {
  pricingMode = mode;
  document.querySelectorAll('#pricingToggle .toggle-option').forEach(b => {
    b.classList.toggle('active', b.dataset.mode === mode);
  });
  // Re-generate if results exist
  if (document.getElementById('resultsContent').style.display !== 'none') {
    generateQuote();
  }
}

function calculateSellPrice(buyPrice) {
  const base = buyPrice * 3.5;
  return pricingMode === 'pro' ? base * 0.77 : base;
}

// ============ SUPPLIER CARDS ============
function renderSupplierCards() {
  const grid = document.getElementById('suppliersGrid');
  grid.innerHTML = '';
  for (let i = 0; i < MAX_SUPPLIERS; i++) {
    const supplier = suppliers[i];
    const card = document.createElement('div');
    card.className = 'supplier-card' + (supplier ? ' loaded' : '');
    card.dataset.index = i;

    if (supplier) {
      card.innerHTML = renderLoadedCard(supplier, i);
    } else {
      card.innerHTML = renderEmptyCard(i);
      card.addEventListener('click', () => triggerFileInput(i));
      card.addEventListener('dragover', handleDragOver);
      card.addEventListener('dragleave', handleDragLeave);
      card.addEventListener('drop', (e) => handleDrop(e, i));
    }

    grid.appendChild(card);
  }
}

function renderEmptyCard(index) {
  return `
    <svg class="drop-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/>
    </svg>
    <div class="drop-text">Glissez un fichier ici ou <strong>parcourir</strong></div>
    <div class="drop-formats">.xls, .xlsx, .csv</div>
    <input type="file" class="file-input" accept=".xls,.xlsx,.csv" data-index="${index}" onchange="handleFileSelect(event, ${index})">
  `;
}

function renderLoadedCard(supplier, index) {
  const date = new Date(supplier.lastUpdate);
  const dateStr = date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

  // Price range
  const prices = supplier.data.map(d => d.price).filter(p => p > 0);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);

  return `
    <div class="supplier-header">
      <input class="supplier-name" value="${supplier.name}" onchange="renameSupplier(${index}, this.value)" title="Cliquer pour renommer">
      <div class="supplier-actions">
        <button title="Remplacer le fichier" onclick="triggerFileInput(${index})">↻</button>
        <button class="btn-delete" title="Supprimer" onclick="removeSupplier(${index})">✕</button>
      </div>
    </div>
    <div class="supplier-stats">
      <div class="stat-item">
        <div class="stat-value">${supplier.data.length.toLocaleString('fr-FR')}</div>
        <div class="stat-label">Références</div>
      </div>
      <div class="stat-item">
        <div class="stat-value">${minPrice.toFixed(0)}€ – ${maxPrice.toFixed(0)}€</div>
        <div class="stat-label">Fourchette prix</div>
      </div>
    </div>
    <div class="supplier-meta">
      <span class="dot"></span>
      Mis à jour le ${dateStr}
    </div>
    <div class="supplier-mapping-info">
      Colonnes : <strong>${supplier.mapping.nameCol}</strong> (nom), <strong>${supplier.mapping.priceCol}</strong> (prix)
    </div>
    <input type="file" class="file-input" accept=".xls,.xlsx,.csv" data-index="${index}" onchange="handleFileSelect(event, ${index})">
  `;
}

function triggerFileInput(index) {
  const input = document.querySelector(`.file-input[data-index="${index}"]`);
  if (input) input.click();
}

// ============ DRAG & DROP ============
function handleDragOver(e) {
  e.preventDefault();
  e.currentTarget.classList.add('dragover');
}

function handleDragLeave(e) {
  e.currentTarget.classList.remove('dragover');
}

function handleDrop(e, index) {
  e.preventDefault();
  e.currentTarget.classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if (file) processFile(file, index);
}

function handleFileSelect(e, index) {
  const file = e.target.files[0];
  if (file) processFile(file, index);
}

// ============ FILE PROCESSING ============
async function processFile(file, index) {
  try {
    const data = await readFileAsArrayBuffer(file);
    const workbook = XLSX.read(data, { type: 'array' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

    if (rows.length < 2) {
      showToast('Le fichier semble vide', 'error');
      return;
    }

    // Clean rows - trim strings, take only meaningful columns
    const cleanedRows = rows.map(row => {
      return row.slice(0, 15).map(cell => {
        if (typeof cell === 'string') return cell.trim();
        return cell;
      });
    });

    // Auto-detect mapping
    const mapping = autoDetectMapping(cleanedRows);

    // Store pending data for modal
    pendingMapping = {
      index,
      fileName: file.name,
      rows: cleanedRows,
      mapping,
      headers: cleanedRows[0]
    };

    showMappingModal();
  } catch (err) {
    console.error(err);
    showToast('Erreur de lecture du fichier: ' + err.message, 'error');
  }
}

function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

// ============ AUTO-MAPPING ============
function autoDetectMapping(rows) {
  const header = rows[0];
  const sampleRows = rows.slice(1, Math.min(51, rows.length));
  const numCols = header.length;

  // Analyze each column
  const colAnalysis = [];
  for (let c = 0; c < numCols; c++) {
    const values = sampleRows.map(r => r[c]).filter(v => v !== '' && v !== undefined && v !== null);
    if (values.length === 0) { colAnalysis.push({ type: 'empty' }); continue; }

    const numericCount = values.filter(v => typeof v === 'number' || (!isNaN(parseFloat(v)) && /^[\d.,]+$/.test(String(v).trim()))).length;
    const avgLen = values.reduce((s, v) => s + String(v).length, 0) / values.length;
    const isBarcode = values.every(v => /^\d{8,14}$/.test(String(v).trim()));

    // Check for botanical keywords
    const botanicalWords = ['abelia', 'acer', 'prunus', 'photinia', 'lavand', 'rosmar', 'oleander', 'magnol', 'citrus', 'wisteria', 'cupressus'];
    const hasBotanical = values.some(v => {
      const lower = String(v).toLowerCase();
      return botanicalWords.some(w => lower.includes(w));
    });

    // Check for conditioning keywords
    const condKeywords = ['clt', 'motte', 'vqlt', 'klt', 'lv', 'lvq', 'air pot', 'lvc', 'rete'];
    const hasCond = values.some(v => {
      const lower = String(v).toLowerCase().replace(/[.\s]/g, '');
      return condKeywords.some(w => lower === w || lower.startsWith(w));
    });

    // Check for forme keywords
    const formeKeywords = ['tige', 'cone', 'boule', 'espalier', 'multitronc', 'cepee', 'palisse', 'bonsai', 'pompons', 'spirale'];
    const hasForme = values.some(v => {
      const lower = String(v).toLowerCase();
      return formeKeywords.some(w => lower.includes(w));
    });

    colAnalysis.push({
      index: c,
      header: String(header[c] || `Col ${c}`),
      numericRatio: numericCount / values.length,
      avgLen,
      isBarcode,
      hasBotanical,
      hasCond,
      hasForme,
      sampleValues: values.slice(0, 3)
    });
  }

  // Determine columns
  let nameCol = -1, priceCol = -1, condCol = -1, formeCol = -1, potSizeCol = -1, heightCol = -1;

  // 1. Name = botanical + longest text
  const nameCandidates = colAnalysis.filter(c => c.hasBotanical && !c.isBarcode);
  if (nameCandidates.length > 0) {
    nameCol = nameCandidates.sort((a, b) => b.avgLen - a.avgLen)[0].index;
  }

  // 2. Price = last numeric column that's NOT barcode
  const numericCols = colAnalysis.filter(c => c.numericRatio > 0.7 && !c.isBarcode && c.index !== nameCol);
  if (numericCols.length > 0) {
    priceCol = numericCols[numericCols.length - 1].index; // Last numeric = net price
  }

  // 3. Conditioning
  const condCandidates = colAnalysis.filter(c => c.hasCond && c.index !== nameCol);
  if (condCandidates.length > 0) condCol = condCandidates[0].index;

  // 4. Forme
  const formeCandidates = colAnalysis.filter(c => c.hasForme && c.index !== nameCol && c.index !== condCol);
  if (formeCandidates.length > 0) formeCol = formeCandidates[0].index;

  // 5. Pot size (litrage) = numeric column right after conditioning, small numbers (1-200)
  // Typically it's the column just after cond, with values like 3, 5, 7, 10, 15, 18, 25, 30...
  const usedCols = [nameCol, priceCol, condCol, formeCol].filter(c => c >= 0);
  const potSizeCandidates = colAnalysis.filter(c => {
    if (usedCols.includes(c.index) || c.isBarcode || !c.numericRatio) return false;
    if (c.index === priceCol) return false;
    // Check if values look like pot sizes (small integers or ranges like "7-10")
    const vals = sampleRows.map(r => String(r[c.index] || '').trim()).filter(Boolean);
    const looksLikePotSize = vals.filter(v => /^\d{1,3}(-\d{1,3})?$/.test(v)).length;
    return looksLikePotSize > vals.length * 0.4;
  });
  // Pick the first one after condCol (or first available)
  if (potSizeCandidates.length > 0) {
    const afterCond = potSizeCandidates.filter(c => condCol >= 0 && c.index > condCol);
    potSizeCol = (afterCond.length > 0 ? afterCond[0] : potSizeCandidates[0]).index;
  }

  // 6. Height = column with values like "060-080", "100/125", "125-150"
  const heightCandidates = colAnalysis.filter(c => {
    if ([...usedCols, potSizeCol].includes(c.index) || c.isBarcode) return false;
    const vals = sampleRows.map(r => String(r[c.index] || '').trim()).filter(Boolean);
    const looksLikeHeight = vals.filter(v => /^\d{2,3}[\/-]\d{2,3}$/.test(v)).length;
    return looksLikeHeight > vals.length * 0.2;
  });
  if (heightCandidates.length > 0) heightCol = heightCandidates[0].index;

  return {
    nameCol: nameCol >= 0 ? header[nameCol] || `Col ${nameCol}` : null,
    nameIdx: nameCol,
    priceCol: priceCol >= 0 ? header[priceCol] || `Col ${priceCol}` : null,
    priceIdx: priceCol,
    condCol: condCol >= 0 ? header[condCol] || `Col ${condCol}` : null,
    condIdx: condCol,
    formeCol: formeCol >= 0 ? header[formeCol] || `Col ${formeCol}` : null,
    formeIdx: formeCol,
    potSizeCol: potSizeCol >= 0 ? header[potSizeCol] || `Col ${potSizeCol}` : null,
    potSizeIdx: potSizeCol,
    heightCol: heightCol >= 0 ? header[heightCol] || `Col ${heightCol}` : null,
    heightIdx: heightCol,
    colAnalysis
  };
}

// ============ MAPPING MODAL ============
function showMappingModal() {
  if (!pendingMapping) return;

  const { rows, mapping, headers } = pendingMapping;

  // Preview table (first 5 rows)
  let tableHtml = '<table><thead><tr>';
  headers.forEach((h, i) => {
    const role = mapping.nameIdx === i ? ' (→ NOM)' :
                 mapping.priceIdx === i ? ' (→ PRIX)' :
                 mapping.condIdx === i ? ' (→ COND.)' :
                 mapping.potSizeIdx === i ? ' (→ LITRAGE)' :
                 mapping.heightIdx === i ? ' (→ HAUTEUR)' :
                 mapping.formeIdx === i ? ' (→ FORME)' : '';
    tableHtml += `<th>${h || 'Col ' + i}${role}</th>`;
  });
  tableHtml += '</tr></thead><tbody>';
  for (let r = 1; r < Math.min(6, rows.length); r++) {
    tableHtml += '<tr>';
    headers.forEach((_, i) => {
      tableHtml += `<td>${rows[r][i] ?? ''}</td>`;
    });
    tableHtml += '</tr>';
  }
  tableHtml += '</tbody></table>';
  document.getElementById('mappingPreview').innerHTML = tableHtml;

  // Selects
  const colOptions = headers.map((h, i) => `<option value="${i}">${h || 'Col ' + i}</option>`).join('');
  const noneOption = '<option value="-1">— Non détecté —</option>';

  document.getElementById('mappingSelects').innerHTML = `
    <div class="mapping-field">
      <label>🌿 Nom de la plante</label>
      <select id="mapName">${noneOption}${colOptions}</select>
    </div>
    <div class="mapping-field">
      <label>💰 Prix d'achat</label>
      <select id="mapPrice">${noneOption}${colOptions}</select>
    </div>
    <div class="mapping-field">
      <label>📦 Conditionnement</label>
      <select id="mapCond">${noneOption}${colOptions}</select>
    </div>
    <div class="mapping-field">
      <label>🪴 Litrage / Taille pot</label>
      <select id="mapPotSize">${noneOption}${colOptions}</select>
    </div>
    <div class="mapping-field">
      <label>📏 Hauteur</label>
      <select id="mapHeight">${noneOption}${colOptions}</select>
    </div>
    <div class="mapping-field">
      <label>🌳 Forme</label>
      <select id="mapForme">${noneOption}${colOptions}</select>
    </div>
  `;

  // Set detected values
  document.getElementById('mapName').value = mapping.nameIdx;
  document.getElementById('mapPrice').value = mapping.priceIdx;
  document.getElementById('mapCond').value = mapping.condIdx;
  document.getElementById('mapPotSize').value = mapping.potSizeIdx;
  document.getElementById('mapHeight').value = mapping.heightIdx;
  document.getElementById('mapForme').value = mapping.formeIdx;

  document.getElementById('mappingModal').classList.add('active');
}

function closeMappingModal() {
  document.getElementById('mappingModal').classList.remove('active');
  pendingMapping = null;
}

function confirmMapping() {
  if (!pendingMapping) return;

  const nameIdx = parseInt(document.getElementById('mapName').value);
  const priceIdx = parseInt(document.getElementById('mapPrice').value);
  const condIdx = parseInt(document.getElementById('mapCond').value);
  const potSizeIdx = parseInt(document.getElementById('mapPotSize').value);
  const heightIdx = parseInt(document.getElementById('mapHeight').value);
  const formeIdx = parseInt(document.getElementById('mapForme').value);

  if (nameIdx < 0 || priceIdx < 0) {
    showToast('Veuillez sélectionner au minimum le nom et le prix', 'error');
    return;
  }

  const { index, fileName, rows, headers } = pendingMapping;
  const mappedCols = [nameIdx, priceIdx, condIdx, potSizeIdx, heightIdx, formeIdx].filter(c => c >= 0);

  // Parse all data rows
  const parsedData = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const name = String(row[nameIdx] || '').trim();
    const price = parseFloat(row[priceIdx]) || 0;
    if (!name || price <= 0) continue;

    // Parse pot size: extract numeric value from "3", "7-10", "10", "18-25"
    let potSize = '';
    let potSizeNum = 0;
    if (potSizeIdx >= 0) {
      potSize = String(row[potSizeIdx] || '').trim();
      // For ranges like "7-10", take the first number
      const psMatch = potSize.match(/^(\d+)/);
      potSizeNum = psMatch ? parseInt(psMatch[1]) : 0;
    }

    parsedData.push({
      name,
      price,
      cond: condIdx >= 0 ? String(row[condIdx] || '').trim() : '',
      potSize,
      potSizeNum,
      height: heightIdx >= 0 ? String(row[heightIdx] || '').trim() : '',
      forme: formeIdx >= 0 ? String(row[formeIdx] || '').trim() : '',
      // Collect remaining non-mapped columns as extra info
      sizeInfo: rows[0].map((h, i) => {
        if (mappedCols.includes(i)) return null;
        const val = String(row[i] || '').trim();
        if (!val || /^\d{8,14}$/.test(val)) return null;
        return val;
      }).filter(Boolean).join(' | ')
    });
  }

  // Determine supplier name from filename
  const supplierName = fileName.replace(/\.(xls|xlsx|csv)x?$/i, '')
    .replace(/[-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 40);

  const supplierObj = {
    id: Date.now(),
    name: supplierName,
    lastUpdate: new Date().toISOString(),
    data: parsedData,
    mapping: {
      nameCol: headers[nameIdx] || `Col ${nameIdx}`,
      priceCol: headers[priceIdx] || `Col ${priceIdx}`,
      nameIdx,
      priceIdx,
      condIdx,
      potSizeIdx,
      heightIdx,
      formeIdx
    }
  };

  // Add or replace
  if (index < suppliers.length && suppliers[index]) {
    suppliers[index] = supplierObj;
  } else {
    while (suppliers.length < index) suppliers.push(null);
    suppliers[index] = supplierObj;
  }

  saveToStorage();
  renderSupplierCards();
  updateSupplierCount();
  closeMappingModal();
  showToast(`${parsedData.length.toLocaleString('fr-FR')} références chargées !`, 'success');
}

// ============ SUPPLIER MANAGEMENT ============
function renameSupplier(index, newName) {
  if (suppliers[index]) {
    suppliers[index].name = newName;
    saveToStorage();
  }
}

function removeSupplier(index) {
  suppliers[index] = null;
  // Clean trailing nulls
  while (suppliers.length > 0 && suppliers[suppliers.length - 1] === null) {
    suppliers.pop();
  }
  saveToStorage();
  renderSupplierCards();
  updateSupplierCount();
  showToast('Catalogue supprimé', 'info');
}

function updateSupplierCount() {
  const count = suppliers.filter(Boolean).length;
  const totalRefs = suppliers.filter(Boolean).reduce((s, sup) => s + sup.data.length, 0);
  document.getElementById('supplierCount').innerHTML =
    `<strong>${count}</strong> fournisseur${count > 1 ? 's' : ''} · ${totalRefs.toLocaleString('fr-FR')} réf.`;
}

// ============ STORAGE ============
function saveToStorage() {
  try {
    localStorage.setItem('pepiniquote_suppliers', JSON.stringify(suppliers));
  } catch (e) {
    console.warn('localStorage full, data too large');
    showToast('Attention : données trop volumineuses pour le stockage local', 'error');
  }
}

function loadFromStorage() {
  try {
    const saved = localStorage.getItem('pepiniquote_suppliers');
    if (saved) suppliers = JSON.parse(saved);
  } catch (e) {
    console.warn('Failed to load from storage');
  }
}

// ============ FUZZY MATCHING ============
function normalize(str) {
  return str.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove accents
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(x|de|du|des|le|la|les|d|l)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(str) {
  return normalize(str).split(' ').filter(t => t.length > 1);
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i-1] === b[j-1]
        ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
    }
  }
  return dp[m][n];
}

function tokenSimilarity(a, b) {
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 0;
  // Check if one contains the other
  if (a.includes(b) || b.includes(a)) return 0.9;
  const dist = levenshtein(a, b);
  return Math.max(0, 1 - dist / maxLen);
}

function matchScore(queryTokens, candidateName) {
  const candidateTokens = tokenize(candidateName);
  if (queryTokens.length === 0 || candidateTokens.length === 0) return 0;

  let totalScore = 0;
  for (const qt of queryTokens) {
    let bestMatch = 0;
    for (const ct of candidateTokens) {
      bestMatch = Math.max(bestMatch, tokenSimilarity(qt, ct));
    }
    totalScore += bestMatch;
  }
  return totalScore / queryTokens.length;
}

// ============ PARSE CLIENT REQUEST ============
function parseClientRequest(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const items = [];

  for (const line of lines) {
    // Try various quantity patterns
    let qty = 1;
    let plantName = line;

    // Pattern: "5 photinia red robin" or "5x photinia"
    const match1 = line.match(/^(\d+)\s*[x×]?\s+(.+)/i);
    // Pattern: "photinia x5" or "photinia (5)" or "photinia : 5"
    const match2 = line.match(/^(.+?)\s*[x×:]\s*(\d+)\s*$/i);
    const match3 = line.match(/^(.+?)\s*\((\d+)\)\s*$/i);
    // Pattern: "- 5 photinia" (list with dash)
    const match4 = line.match(/^[-•*]\s*(\d+)\s*[x×]?\s+(.+)/i);

    if (match4) {
      qty = parseInt(match4[1]);
      plantName = match4[2];
    } else if (match1) {
      qty = parseInt(match1[1]);
      plantName = match1[2];
    } else if (match2) {
      plantName = match2[1];
      qty = parseInt(match2[2]);
    } else if (match3) {
      plantName = match3[1];
      qty = parseInt(match3[2]);
    }

    // Clean plant name
    plantName = plantName.replace(/^[-•*]\s*/, '').trim();
    if (plantName.length < 2) continue;

    // Extract pot size AND height from plant name
    let requestedPotSize = 0;
    let requestedHeight = '';

    // Litrage patterns: "10L", "10 L", "10l", "10 litres", "clt 10", "CLT. 10"
    const sizePatterns = [
      /\b(\d+)\s*l(?:itres?)?\b/i,                 // "10L", "10 l", "10 litres"
      /\bclt\.?\s*(\d+)\b/i,                       // "clt 10", "CLT. 10"
      /\bconteneur\s*(?:de\s*)?(\d+)\b/i,          // "conteneur 10"
      /\bpot\s*(?:de\s*)?(\d+)\b/i,               // "pot 10", "pot de 10"
      /\b(\d+)\s*lt\b/i,                           // "10 lt"
    ];

    for (const pat of sizePatterns) {
      const sizeMatch = plantName.match(pat);
      if (sizeMatch) {
        requestedPotSize = parseInt(sizeMatch[1]);
        plantName = plantName.replace(pat, '').replace(/\s+/g, ' ').trim();
        break;
      }
    }

    // Height patterns: "150/200", "60/80cm", "100-125", "150cm"
    const heightPatterns = [
      /\b(\d{2,3})\s*[\/\-]\s*(\d{2,3})\s*(?:cm)?\b/i,  // "150/200", "60-80cm"
      /\b(\d{2,3})\s*cm\b/i,                              // "150cm"
    ];

    for (const pat of heightPatterns) {
      const hMatch = plantName.match(pat);
      if (hMatch) {
        requestedHeight = hMatch[0].trim();
        plantName = plantName.replace(pat, '').replace(/\s+/g, ' ').trim();
        break;
      }
    }

    items.push({ qty, plantName, requestedPotSize, requestedHeight });
  }

  return items;
}

// ============ API KEY MANAGEMENT ============
function getApiKey() {
  return localStorage.getItem('pepiniquote_apikey') || '';
}

function saveApiKey(key) {
  localStorage.setItem('pepiniquote_apikey', key.trim());
  updateApiKeyStatus();
}

function updateApiKeyStatus() {
  const dot = document.getElementById('apiKeyStatus');
  const key = getApiKey();
  dot.className = key ? 'api-dot api-dot-on' : 'api-dot api-dot-off';
}

function toggleApiKeyPanel() {
  const panel = document.getElementById('apiKeyPanel');
  panel.classList.toggle('show');
  if (panel.classList.contains('show')) {
    document.getElementById('apiKeyInput').value = getApiKey();
  }
}

// Close panel on click outside
document.addEventListener('click', (e) => {
  const panel = document.getElementById('apiKeyPanel');
  const btn = document.querySelector('.toolbar-settings-btn');
  if (panel && !panel.contains(e.target) && !btn.contains(e.target)) {
    panel.classList.remove('show');
  }
});

// ============ LOADING STATE ============
function showLoading(msg) {
  const panel = document.getElementById('resultsPanel');
  let overlay = panel.querySelector('.loading-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'loading-overlay';
    panel.appendChild(overlay);
  }
  overlay.innerHTML = `<div class="loading-spinner"></div><div class="loading-text">${msg}</div>`;
  overlay.style.display = 'flex';
}

function hideLoading() {
  const overlay = document.querySelector('.loading-overlay');
  if (overlay) overlay.style.display = 'none';
}

// ============ BUILD CATALOG INDEX FOR CLAUDE ============
function buildCatalogIndex() {
  // Build a compact list of unique plant names with their available sizes and prices per supplier
  const loadedSuppliers = suppliers.filter(Boolean);
  const index = {}; // plantName -> { supplier, potSize, height, cond, forme, price }[]

  for (const sup of loadedSuppliers) {
    for (const plant of sup.data) {
      const key = plant.name;
      if (!index[key]) index[key] = [];
      index[key].push({
        s: sup.name,
        ps: plant.potSize,
        h: plant.height,
        c: plant.cond,
        f: plant.forme,
        p: plant.price
      });
    }
  }

  // Build compact text: group by plant name, list sizes/prices
  const lines = [];
  for (const [name, entries] of Object.entries(index)) {
    // Deduplicate and sort by price
    const unique = [];
    const seen = new Set();
    for (const e of entries) {
      const k = `${e.s}|${e.ps}|${e.p}`;
      if (!seen.has(k)) { seen.add(k); unique.push(e); }
    }
    unique.sort((a, b) => a.p - b.p);
    // Compact format: max 5 cheapest options per plant
    const opts = unique.slice(0, 5).map(e => {
      const parts = [e.s];
      if (e.ps) parts.push(e.ps + 'L');
      if (e.h) parts.push('H:' + e.h);
      if (e.f) parts.push(e.f);
      parts.push(e.p + '€');
      return parts.join('/');
    });
    lines.push(`${name}: ${opts.join(' | ')}`);
  }
  return lines.join('\n');
}

// ============ STEP 1: CLAUDE IDENTIFIES PLANTS ============
async function aiIdentifyPlants(clientText) {
  const apiKey = getApiKey();
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system: `Tu es un expert en horticulture/pépinière. Analyse la demande client et identifie chaque plante demandée.
Pour chaque plante:
- Corrige les fautes d'orthographe (fautinia → photinia, etc.)
- Trouve le nom botanique latin (lavande → Lavandula, érable du japon → Acer palmatum, glycine → Wisteria, etc.)
- Extrais la quantité, la taille/litrage si précisé, la forme si précisée

RÉPONDS UNIQUEMENT en JSON:
[{"requested":"texte original","qty":5,"botanicalName":"Photinia","searchTerms":["photinia","photinia fraseri","photinia red robin"],"potSize":10,"height":"","forme":""}]

searchTerms = variantes du nom à chercher dans les catalogues (nom commun, nom latin, variétés courantes). Mets au moins 3 termes.
potSize = 0 si pas précisé.`,
      messages: [{ role: 'user', content: clientText }]
    })
  });
  if (!response.ok) throw new Error('API error ' + response.status + ': ' + await response.text());
  const data = await response.json();
  const jsonMatch = data.content[0].text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error('Réponse invalide');
  return JSON.parse(jsonMatch[0]);
}

// ============ STEP 2: SEARCH PIDF (Shopify) ============
async function searchPIDF(searchTerms, potSize) {
  try {
    const results = [];
    const seenHandles = new Set();

    for (const term of searchTerms.slice(0, 3)) {
      // Use proxy to avoid CORS
      const resp = await fetch(`/proxy/pidf/search?q=${encodeURIComponent(term)}`);
      const data = await resp.json();
      if (!data.resources?.results?.products) continue;

      for (const p of data.resources.results.products) {
        if (seenHandles.has(p.handle)) continue;
        seenHandles.add(p.handle);

        // Fetch full product via proxy to get ALL variants (sizes)
        try {
          const prodResp = await fetch(`/proxy/pidf/product?handle=${encodeURIComponent(p.handle)}`);
          const prodData = await prodResp.json();
          const product = prodData.product;

          for (const v of product.variants) {
            const variantTitle = v.title || '';
            // Parse size from variant title (e.g. "60/80cm", "100/125cm", "3L")
            const potMatch = variantTitle.match(/(\d+)\s*[Ll]/);
            const ps = potMatch ? potMatch[1] : '';
            const psNum = ps ? parseInt(ps) : 0;

            results.push({
              name: product.title,
              price: parseFloat(v.price),
              potSize: ps,
              potSizeNum: psNum,
              height: variantTitle,
              forme: '',
              cond: '',
              sizeInfo: variantTitle,
              supplier: 'PIDF (Mon site)',
              source: 'pidf',
              score: 1.0,
              url: 'https://les-plantes-ile-de-france.com/products/' + p.handle
            });
          }
        } catch (e2) {
          // Fallback: use basic info
          results.push({
            name: p.title,
            price: parseFloat(p.price),
            potSize: '', potSizeNum: 0,
            height: '', forme: '', cond: '', sizeInfo: '',
            supplier: 'PIDF (Mon site)',
            source: 'pidf',
            score: 1.0
          });
        }
      }
    }
    return results;
  } catch (e) {
    console.warn('PIDF search error:', e);
    return [];
  }
}

// ============ STEP 3: SEARCH EXCEL CATALOGUES ============
function searchExcelCatalogues(searchTerms, potSize) {
  const results = [];
  const loadedSuppliers = suppliers.filter(s => s && !s.isPriceVente); // Exclude PIDF (prix vente)

  // Normalize search terms
  const normalizedTerms = searchTerms.map(t => normalize(t));

  for (const sup of loadedSuppliers) {
    for (const plant of sup.data) {
      const plantNorm = normalize(plant.name);

      // Check if any search term matches
      let bestScore = 0;
      for (const term of normalizedTerms) {
        const termTokens = term.split(' ').filter(t => t.length > 1);
        let matched = 0;
        for (const tt of termTokens) {
          if (plantNorm.includes(tt)) matched++;
        }
        const score = termTokens.length > 0 ? matched / termTokens.length : 0;
        bestScore = Math.max(bestScore, score);
      }

      if (bestScore >= 0.5) {
        results.push({
          ...plant,
          supplier: sup.name,
          score: bestScore,
          source: 'excel'
        });
      }
    }
  }

  // Sort by score desc then price asc
  results.sort((a, b) => b.score - a.score || a.price - b.price);
  return results.slice(0, 30); // Top 30 matches
}

// ============ STEP 4: SEARCH FLEUR PRO (live) ============
async function searchFleurPro(searchTerms) {
  try {
    const results = [];
    for (const term of searchTerms.slice(0, 2)) {
      const resp = await fetch(`/proxy/fleur?q=${encodeURIComponent(term)}`);
      const html = await resp.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');

      const text = doc.body.innerText;
      const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

      for (let i = 0; i < lines.length; i++) {
        if (lines[i].match(/\b[Cc]\s?\d/) && lines[i].match(/[A-Z][a-z]/) && lines[i].length > 8 && lines[i].length < 120) {
          const name = lines[i];
          let price = 0;
          for (let j = i + 1; j < Math.min(i + 8, lines.length); j++) {
            const priceMatch = lines[j].match(/([\d]+[,.][\d]+)\s*1\+/);
            if (priceMatch) {
              price = parseFloat(priceMatch[1].replace(',', '.'));
              break;
            }
          }
          if (price > 0) {
            const potMatch = name.match(/C\s*(\d+[,.]?\d*)\s*L/i);
            const potSize = potMatch ? potMatch[1].replace(',', '.') : '';
            results.push({
              name, price,
              potSize,
              potSizeNum: potSize ? parseInt(potSize) : 0,
              cond: 'C', height: '', forme: '',
              supplier: 'Fleur Pro',
              source: 'fleur',
              score: 0.9
            });
          }
        }
      }
    }
    return results;
  } catch (e) {
    console.warn('Fleur Pro search error:', e);
    return [];
  }
}

// ============ STEP 5: CLAUDE COMPILES BEST QUOTE ============
async function aiCompileQuote(plants, allResults) {
  const apiKey = getApiKey();

  // Build compact results for Claude
  let context = '';
  for (const plant of plants) {
    const key = plant.botanicalName;
    const matches = allResults[key] || [];
    context += `\n--- ${plant.requested} (cherché: ${plant.searchTerms.join(', ')}) ---\n`;
    if (matches.length === 0) {
      context += 'AUCUN RÉSULTAT\n';
    } else {
      matches.slice(0, 20).forEach(m => {
        const ps = m.potSize ? m.potSize + 'L' : '';
        const h = m.height ? ' H:' + m.height : '';
        context += `${m.name} | ${m.supplier} | ${ps}${h} | ${m.price}€\n`;
      });
    }
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: `Tu es un assistant devis pour une pépinière appelée "Les Plantes d'Île-de-France" (PIDF). Tu reçois les résultats de recherche de différents fournisseurs.

PRIORITÉ DES FOURNISSEURS (TRÈS IMPORTANT):
1. **PIDF (Mon site)** = C'est NOTRE site de vente. Si la plante est trouvée chez PIDF avec une taille proche, elle DOIT être le bestMatch. Les prix PIDF sont nos prix de vente actuels.
2. Ensuite proposer en alternatives les mêmes plantes chez **Vannucci**, **Catalogue 2022-2024** (Innocenti), et **Fleur Pro** avec la taille exacte demandée ou la plus proche.

RÈGLES:
1. Priorise TOUJOURS PIDF en bestMatch si disponible, même si le litrage n'est pas exactement le même (prends le plus proche)
2. En alternatives, propose les fournisseurs d'achat (Vannucci, Catalogue 2022-2024, Fleur Pro) avec la taille la plus proche de celle demandée
3. Si le client demande "photinia" sans préciser, c'est probablement "Photinia x fraseri Red Robin"
4. Les prix PIDF sont des prix de VENTE. Les prix des autres fournisseurs sont des prix d'ACHAT.
5. Propose au moins 3-4 alternatives de différents fournisseurs et tailles

RÉPONDS UNIQUEMENT en JSON:
[{
  "requested": "texte original client",
  "qty": nombre,
  "bestMatch": {"name":"NOM EXACT","supplier":"fournisseur","potSize":"10","height":"","price":12.50},
  "alternatives": [{"name":"...","supplier":"...","potSize":"...","height":"...","price":0}]
}]`,
      messages: [{ role: 'user', content: `Demande client et résultats:\n${context}` }]
    })
  });

  if (!response.ok) throw new Error('API error ' + response.status);
  const data = await response.json();
  const jsonMatch = data.content[0].text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error('Réponse invalide');
  return JSON.parse(jsonMatch[0]);
}

// ============ GENERATE QUOTE (MAIN) ============
async function generateQuote() {
  const text = document.getElementById('clientRequest').value.trim();
  if (!text) { showToast('Veuillez coller une demande client', 'error'); return; }

  const apiKey = getApiKey();
  if (!apiKey) { generateQuoteLocal(text); return; }

  document.getElementById('resultsEmpty').style.display = 'none';
  document.getElementById('resultsContent').style.display = 'none';

  try {
    // STEP 1: Claude identifies plants
    showLoading('🧠 Claude analyse la demande...');
    const plants = await aiIdentifyPlants(text);
    console.log('Plants identified:', plants);

    // STEP 2-4: Search all sources in parallel for each plant
    const allResults = {};
    for (const plant of plants) {
      showLoading(`🔍 Recherche: ${plant.botanicalName}...`);

      const [pidfResults, excelResults, fleurResults] = await Promise.all([
        searchPIDF(plant.searchTerms, plant.potSize),
        Promise.resolve(searchExcelCatalogues(plant.searchTerms, plant.potSize)),
        searchFleurPro(plant.searchTerms)
      ]);

      allResults[plant.botanicalName] = [...pidfResults, ...excelResults, ...fleurResults];
      console.log(`${plant.botanicalName}: ${allResults[plant.botanicalName].length} results`);
    }

    // STEP 5: Claude compiles the best quote
    showLoading('📊 Claude compile le devis...');
    const quoteItems = await aiCompileQuote(plants, allResults);

    // Convert to display format + ENRICH with all suppliers from catalogues
    const results = quoteItems.map(item => {
      const matches = [];

      // Best match from Claude
      if (item.bestMatch && item.bestMatch.name) {
        matches.push({
          name: item.bestMatch.name,
          supplier: item.bestMatch.supplier,
          price: item.bestMatch.price,
          potSize: item.bestMatch.potSize || '',
          potSizeNum: parseInt(item.bestMatch.potSize) || 0,
          height: item.bestMatch.height || '',
          forme: item.bestMatch.forme || '',
          cond: '',
          sizeInfo: '',
          score: 1.0
        });
      }

      // Alternatives from Claude
      if (item.alternatives) {
        for (const alt of item.alternatives) {
          if (alt.name) {
            matches.push({
              name: alt.name,
              supplier: alt.supplier,
              price: alt.price,
              potSize: alt.potSize || '',
              potSizeNum: parseInt(alt.potSize) || 0,
              height: alt.height || '',
              forme: alt.forme || '',
              cond: '',
              sizeInfo: '',
              score: 0.85
            });
          }
        }
      }

      // ENRICH: search ALL catalogues (including PIDF) for matching plants
      // Extract the key botanical words from all matched names
      const keyWords = new Set();
      for (const m of matches) {
        const tokens = normalize(m.name).split(' ').filter(t => t.length > 3);
        tokens.forEach(t => keyWords.add(t));
      }
      // Remove generic words
      ['grandiflora', 'compacta', 'nana', 'alba', 'rubra', 'aurea'].forEach(w => {
        if (keyWords.size > 2) keyWords.delete(w);
      });

      const allSuppliers = suppliers.filter(Boolean);
      const keyWordsArr = [...keyWords];

      for (const sup of allSuppliers) {
        for (const plant of sup.data) {
          const plantNorm = normalize(plant.name);
          // Match if the plant contains ANY of the key botanical words
          let hits = 0;
          for (const kw of keyWordsArr) {
            if (plantNorm.includes(kw)) hits++;
          }
          // At least 1 key word must match, and at least 50% of key words
          if (hits >= 1 && (keyWordsArr.length <= 2 || hits >= keyWordsArr.length * 0.5)) {
            const exists = matches.find(x => x.name === plant.name && x.supplier === sup.name && x.potSize === plant.potSize);
            if (!exists) {
              matches.push({
                ...plant,
                supplier: sup.name,
                score: 0.85
              });
            }
          }
        }
      }

      return {
        requested: item.requested,
        qty: item.qty || 1,
        matches,
        selected: 0,
        aiPowered: true
      };
    });

    hideLoading();
    renderResults(results);

  } catch (err) {
    hideLoading();
    console.error('AI Quote error:', err);
    showToast('Erreur IA: ' + err.message, 'error');
  }
}

// Find a product in our supplier data by name, supplier, potSize
function findProductInData(matchedName, supplierName, potSize, price) {
  const loadedSuppliers = suppliers.filter(Boolean);
  for (const sup of loadedSuppliers) {
    if (supplierName && sup.name !== supplierName) continue;
    for (const plant of sup.data) {
      if (plant.name === matchedName) {
        if (potSize && plant.potSize && String(plant.potSizeNum) !== String(parseInt(potSize))) continue;
        if (price && Math.abs(plant.price - price) > 0.5) continue;
        return { ...plant, supplier: sup.name, score: 1.0 };
      }
    }
  }
  for (const sup of loadedSuppliers) {
    for (const plant of sup.data) {
      if (plant.name === matchedName) {
        return { ...plant, supplier: sup.name, score: 0.9 };
      }
    }
  }
  return null;
}

// Local matching (fallback when no API key)
function generateQuoteLocal(text) {
  const items = parseClientRequest(text);
  if (items.length === 0) {
    showToast('Aucune plante détectée dans la demande', 'error');
    return;
  }

  const loadedSuppliers = suppliers.filter(Boolean);
  const results = [];

  for (const item of items) {
    const queryTokens = tokenize(item.plantName);
    let allMatches = [];

    for (const sup of loadedSuppliers) {
      for (const plant of sup.data) {
        const score = matchScore(queryTokens, plant.name);
        if (score >= 0.5) {
          allMatches.push({ ...plant, supplier: sup.name, score });
        }
      }
    }

    // If a pot size was requested, filter and boost matches
    const reqSize = item.requestedPotSize;
    if (reqSize > 0) {
      const exactSize = allMatches.filter(m => m.potSizeNum === reqSize);
      const closeSize = allMatches.filter(m => m.potSizeNum > 0 && m.potSizeNum !== reqSize && Math.abs(m.potSizeNum - reqSize) <= Math.max(2, reqSize * 0.3));

      if (exactSize.length > 0) {
        exactSize.sort((a, b) => {
          if (Math.abs(a.score - b.score) > 0.1) return b.score - a.score;
          return a.price - b.price;
        });
        closeSize.sort((a, b) => a.price - b.price);
        allMatches = [...exactSize, ...closeSize];
      } else if (closeSize.length > 0) {
        closeSize.sort((a, b) => Math.abs(a.potSizeNum - reqSize) - Math.abs(b.potSizeNum - reqSize) || a.price - b.price);
        allMatches = closeSize;
      }
    }

    if (reqSize <= 0) {
      const goodMatches = allMatches.filter(m => m.score >= 0.7);
      const weakMatches = allMatches.filter(m => m.score < 0.7);
      goodMatches.sort((a, b) => a.price !== b.price ? a.price - b.price : b.score - a.score);
      weakMatches.sort((a, b) => b.score - a.score);
      allMatches = [...goodMatches, ...weakMatches];
    }

    const seen = new Set();
    const topMatches = [];
    for (const m of allMatches) {
      const key = `${m.name}|${m.supplier}|${m.potSize}|${m.price}`;
      if (!seen.has(key)) { seen.add(key); topMatches.push(m); if (topMatches.length >= 10) break; }
    }

    results.push({
      requested: item.plantName + (reqSize > 0 ? ` (${reqSize}L)` : ''),
      qty: item.qty,
      matches: topMatches,
      selected: 0
    });
  }

  renderResults(results);
}

// ============ STRUCTURE RESULTS FOR DISPLAY ============
// Group by variety name → then by size → then by supplier
function structureResults(results) {
  return results.map(r => {
    if (r.matches.length === 0) return { ...r, varieties: [], selectedVariety: 0, selectedSize: 0, selectedSupplier: 0 };

    // Group by unique plant name
    const nameMap = {};
    for (const m of r.matches) {
      if (!nameMap[m.name]) {
        nameMap[m.name] = { name: m.name, score: m.score, items: [] };
      }
      nameMap[m.name].items.push(m);
      nameMap[m.name].score = Math.max(nameMap[m.name].score, m.score);
    }

    const varieties = Object.values(nameMap).sort((a, b) => b.score - a.score);

    // Within each variety: group by potSize, keep ALL suppliers per size
    for (const v of varieties) {
      const sizeGroups = {};
      for (const item of v.items) {
        const sn = item.potSizeNum || 0;
        if (!sizeGroups[sn]) sizeGroups[sn] = [];
        // Avoid exact duplicates
        const exists = sizeGroups[sn].find(x => x.supplier === item.supplier && Math.abs(x.price - item.price) < 0.01);
        if (!exists) sizeGroups[sn].push(item);
      }
      // Sort sizes ascending, within each size sort suppliers by price asc
      v.sizes = Object.entries(sizeGroups)
        .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
        .map(([sn, items]) => ({
          potSizeNum: parseInt(sn),
          suppliers: items.sort((a, b) => a.price - b.price)
        }));
    }

    return {
      ...r,
      varieties,
      selectedVariety: r.selectedVariety ?? 0,
      selectedSize: r.selectedSize ?? 0,
      selectedSupplier: r.selectedSupplier ?? 0
    };
  });
}

// ============ RENDER RESULTS ============
function renderResults(results) {
  const container = document.getElementById('resultsContent');
  document.getElementById('resultsEmpty').style.display = 'none';
  container.style.display = 'block';

  const structured = structureResults(results);
  window._quoteResults = results;
  window._structuredResults = structured;

  let totalGeneral = 0;

  let html = `<table class="results-table">
    <thead><tr>
      <th>Plante demandée</th>
      <th>Variété</th>
      <th>Taille</th>
      <th>Fournisseur</th>
      <th>Prix achat</th>
      <th>Prix vente</th>
      <th>Qté</th>
      <th>Total</th>
    </tr></thead><tbody>`;

  for (let i = 0; i < structured.length; i++) {
    const r = structured[i];

    if (r.varieties.length === 0) {
      html += `<tr>
        <td><strong>${escapeHtml(r.requested)}</strong></td>
        <td colspan="7" class="not-found">⚠ Aucun résultat trouvé</td>
      </tr>`;
      continue;
    }

    const selVar = Math.min(r.selectedVariety, r.varieties.length - 1);
    const variety = r.varieties[selVar];
    const selSize = Math.min(r.selectedSize, variety.sizes.length - 1);
    const sizeGroup = variety.sizes[selSize];
    const selSup = Math.min(r.selectedSupplier ?? 0, sizeGroup.suppliers.length - 1);
    const current = sizeGroup.suppliers[selSup];

    const sellPrice = calculateSellPrice(current.price);
    const lineTotal = sellPrice * r.qty;
    totalGeneral += lineTotal;

    const scoreClass = variety.score >= 0.85 ? 'score-high' : variety.score >= 0.65 ? 'score-medium' : 'score-low';

    // --- Variety dropdown ---
    let varietyHtml = `<select class="variety-select" onchange="switchVariety(${i}, this.value)">`;
    r.varieties.forEach((v, vi) => {
      const pct = Math.round(v.score * 100);
      varietyHtml += `<option value="${vi}" ${vi === selVar ? 'selected' : ''}>${v.name} (${pct}%)</option>`;
    });
    varietyHtml += '</select>';

    // --- Size/Taille dropdown: collect from ALL varieties ---
    const allSizes = [];
    const seenSizes = new Set();
    // Current variety sizes first
    for (const sg of variety.sizes) {
      const cheapest = sg.suppliers[0];
      const key = sg.potSizeNum + '|' + (cheapest.height || '');
      if (!seenSizes.has(key)) {
        seenSizes.add(key);
        allSizes.push({ ...sg, fromVariety: variety.name, isCurrent: true });
      }
    }
    // Then other varieties' sizes
    for (const v of r.varieties) {
      if (v === variety) continue;
      for (const sg of v.sizes) {
        const cheapest = sg.suppliers[0];
        const key = sg.potSizeNum + '|' + (cheapest.height || '');
        if (!seenSizes.has(key)) {
          seenSizes.add(key);
          allSizes.push({ ...sg, fromVariety: v.name, isCurrent: false });
        }
      }
    }
    // Sort by potSizeNum
    allSizes.sort((a, b) => a.potSizeNum - b.potSizeNum);

    // ALWAYS show as dropdown
    let sizeHtml = `<select class="size-select" onchange="switchSizeGlobal(${i}, this.value)">`;
    allSizes.forEach((sg, si) => {
      const cheapest = sg.suppliers[0];
      const rawSize = cheapest.potSize || (sg.potSizeNum > 0 ? String(sg.potSizeNum) : '');
      const label = rawSize ? (rawSize.toUpperCase().endsWith('L') ? rawSize : rawSize + 'L') : 'N/A';
      const heightInfo = cheapest.height ? ' H:' + cheapest.height : '';
      const formeInfo = cheapest.forme ? ' ' + cheapest.forme : '';
      const src = sg.isCurrent ? '' : ' [' + cheapest.supplier.substring(0, 15) + ']';
      const isSelected = sg.isCurrent && variety.sizes.indexOf(sg) === selSize;
      sizeHtml += `<option value="${si}" ${isSelected ? 'selected' : ''}>${label}${heightInfo}${formeInfo}${src} — ${cheapest.price.toFixed(2)}€</option>`;
    });
    sizeHtml += '</select>';

    // Store allSizes for switchSizeGlobal
    if (!window._allSizesMap) window._allSizesMap = {};
    window._allSizesMap[i] = allSizes;

    // --- Supplier dropdown: collect from ALL varieties ---
    const allSuppliersGlobal = [];
    const seenSup = new Set();
    // Current supplier first
    seenSup.add(current.supplier);
    allSuppliersGlobal.push({ ...current, note: '' });
    // All other suppliers from all varieties
    for (const v of r.varieties) {
      for (const sg of v.sizes) {
        for (const s of sg.suppliers) {
          if (!seenSup.has(s.supplier)) {
            seenSup.add(s.supplier);
            const rawPS = s.potSize || (sg.potSizeNum > 0 ? String(sg.potSizeNum) : '');
            const psLabel = rawPS ? (rawPS.toUpperCase().endsWith('L') ? rawPS : rawPS + 'L') : '';
            allSuppliersGlobal.push({ ...s, note: psLabel ? ` (${psLabel})` : '' });
          }
        }
      }
    }

    // ALWAYS show as dropdown
    let supplierHtml = `<select class="supplier-select" onchange="switchSupplierGlobal(${i}, this.value)">`;
    allSuppliersGlobal.forEach((s, si) => {
      supplierHtml += `<option value="${si}" ${si === 0 ? 'selected' : ''}>${s.supplier}${s.note} — ${s.price.toFixed(2)}€</option>`;
    });
    supplierHtml += '</select>';

    html += `<tr data-row="${i}">
      <td>
        <div class="match-name">${escapeHtml(r.requested)}</div>
        <div class="match-details">× ${r.qty}</div>
      </td>
      <td>
        <span class="match-score ${scoreClass}">${Math.round(variety.score * 100)}%</span>
        ${r.aiPowered ? '<span class="ai-badge">IA</span>' : ''}
        <div style="margin-top:6px">${varietyHtml}</div>
      </td>
      <td>${sizeHtml}</td>
      <td>${supplierHtml}</td>
      <td><span class="price-buy">${current.price.toFixed(2)} €</span></td>
      <td><span class="price-sell">${sellPrice.toFixed(2)} €</span></td>
      <td>${r.qty}</td>
      <td><strong>${lineTotal.toFixed(2)} €</strong></td>
    </tr>`;
  }

  html += '</tbody></table>';

  html += `<div class="results-total">
    <span class="total-label">Total ${pricingMode === 'pro' ? 'PRO' : 'PARTICULIER'} HT</span>
    <div>
      <div class="total-value">${totalGeneral.toFixed(2)} €</div>
      <div class="total-ht">Hors taxes</div>
    </div>
  </div>`;

  container.innerHTML = html;
}

function switchVariety(rowIndex, varIndex) {
  window._quoteResults[rowIndex].selectedVariety = parseInt(varIndex);
  window._quoteResults[rowIndex].selectedSize = 0;
  window._quoteResults[rowIndex].selectedSupplier = 0;
  renderResults(window._quoteResults);
}

function switchSize(rowIndex, sizeIndex) {
  window._quoteResults[rowIndex].selectedSize = parseInt(sizeIndex);
  window._quoteResults[rowIndex].selectedSupplier = 0;
  renderResults(window._quoteResults);
}

function switchSupplier(rowIndex, supIndex) {
  window._quoteResults[rowIndex].selectedSupplier = parseInt(supIndex);
  renderResults(window._quoteResults);
}

function switchSizeGlobal(rowIndex, globalSizeIndex) {
  const allSizes = window._allSizesMap[rowIndex];
  if (!allSizes) return;
  const selected = allSizes[parseInt(globalSizeIndex)];
  if (!selected) return;

  // Find which variety this size belongs to and switch to it
  const r = window._quoteResults[rowIndex];
  const structured = window._structuredResults[rowIndex];
  if (selected.isCurrent) {
    // Same variety, just change size
    const sizeIdx = structured.varieties[structured.selectedVariety || 0].sizes.indexOf(selected);
    r.selectedSize = sizeIdx >= 0 ? sizeIdx : 0;
  } else {
    // Different variety — find it and switch
    for (let vi = 0; vi < structured.varieties.length; vi++) {
      if (structured.varieties[vi].name === selected.fromVariety) {
        r.selectedVariety = vi;
        // Find the size index in this variety
        for (let si = 0; si < structured.varieties[vi].sizes.length; si++) {
          if (structured.varieties[vi].sizes[si].potSizeNum === selected.potSizeNum) {
            r.selectedSize = si;
            break;
          }
        }
        break;
      }
    }
  }
  r.selectedSupplier = 0;
  renderResults(window._quoteResults);
}

function switchSupplierGlobal(rowIndex, globalSupIndex) {
  // For now just re-render — the price display updates from the dropdown
  // In the future we could switch variety/size to match this supplier
  renderResults(window._quoteResults);
}

// ============ UTILS ============
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function showToast(msg, type = 'info') {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.className = `toast ${type} show`;
  setTimeout(() => toast.classList.remove('show'), 3000);
}

// ============ START ============
async function startup() {
  // Auto-load suppliers from server if localStorage is empty
  const saved = localStorage.getItem('pepiniquote_suppliers');
  if (!saved || JSON.parse(saved).filter(Boolean).length === 0) {
    try {
      const resp = await fetch('/suppliers_preload.json');
      if (resp.ok) {
        const data = await resp.json();
        localStorage.setItem('pepiniquote_suppliers', JSON.stringify(data));
        console.log('Auto-loaded', data.filter(Boolean).length, 'suppliers from server');
      }
    } catch (e) { console.warn('No preload file found'); }
  }

  // API key must be entered via the UI button "Clé API Claude"

  init();
  updateApiKeyStatus();
}
startup();
