/**
 * ClickCidade API
 * Google Apps Script + Google Sheets + Google Drive.
 *
 * Segredos devem ficar em Script Properties:
 * - CLICKCIDADE_PHOTOS_FOLDER_ID
 * - CLICKCIDADE_PANEL_PASSWORD
 * ou
 * - CLICKCIDADE_PANEL_PASSWORD_SHA256
 *
 * Uso recomendado:
 * cole este script no Apps Script da propria planilha ClickCidade.
 * As abas serao criadas na planilha ativa.
 */

var CLICKCIDADE = {
  APP_NAME: 'ClickCidade',
  VERSION: '20260626-atendimento',
  SHEETS: {
    CONFIG: 'Config',
    REPORTS: 'Denuncias',
    LOG: 'Log'
  },
  PROPS: {
    SPREADSHEET_ID: 'CLICKCIDADE_SPREADSHEET_ID',
    PHOTOS_FOLDER_ID: 'CLICKCIDADE_PHOTOS_FOLDER_ID',
    PANEL_PASSWORD: 'CLICKCIDADE_PANEL_PASSWORD',
    PANEL_PASSWORD_SHA256: 'CLICKCIDADE_PANEL_PASSWORD_SHA256'
  },
  HEADERS: {
    Config: ['chave', 'valor', 'observacao'],
    Denuncias: [
      'id',
      'protocol',
      'createdAt',
      'updatedAt',
      'category',
      'status',
      'phone',
      'reference',
      'latitude',
      'longitude',
      'accuracy',
      'gpsConfirmed',
      'photoId',
      'photoUrl',
      'photoDownloadUrl',
      'notes',
      'responsible',
      'priority',
      'source',
      'userAgent',
      'citizenName',
      'resolutionPhotoId',
      'resolutionPhotoUrl',
      'resolutionPhotoDownloadUrl',
      'resolvedAt'
    ],
    Log: ['createdAt', 'action', 'message', 'payload']
  },
  CATEGORIES: {
    lixo: 'Lixo',
    dengue: 'Foco de dengue',
    terreno: 'Terreno baldio'
  },
  STATUSES: {
    nova: 'Nova',
    triagem: 'Em triagem',
    encaminhada: 'Encaminhada',
    vistoria: 'Em vistoria',
    resolvida: 'Resolvida',
    improcedente: 'Improcedente'
  }
};

function ClickCidade_setup() {
  var ss = ensureStructure_();
  appendLog_('setup', 'Estrutura verificada.', { spreadsheetId: ss.getId() });
  return {
    ok: true,
    app: CLICKCIDADE.APP_NAME,
    version: CLICKCIDADE.VERSION,
    spreadsheetId: ss.getId(),
    spreadsheetUrl: ss.getUrl(),
    passwordConfigured: isPanelPasswordConfigured_(),
    photosFolderConfigured: !!getScriptProperty_(CLICKCIDADE.PROPS.PHOTOS_FOLDER_ID)
  };
}

function ClickCidade_configurarInicial() {
  var ss = ensureStructure_();
  var folderId = getScriptProperty_(CLICKCIDADE.PROPS.PHOTOS_FOLDER_ID);
  var folder;
  var generatedPassword = '';

  if (folderId) {
    folder = DriveApp.getFolderById(folderId);
    if (folder.getName() === 'CarmoCuida - Fotos') {
      folder.setName('ClickCidade - Fotos');
    }
  } else {
    folder = DriveApp.createFolder('ClickCidade - Fotos');
    setScriptProperty_(CLICKCIDADE.PROPS.PHOTOS_FOLDER_ID, folder.getId());
  }

  if (!getScriptProperty_(CLICKCIDADE.PROPS.PANEL_PASSWORD) && !getScriptProperty_(CLICKCIDADE.PROPS.PANEL_PASSWORD_SHA256)) {
    generatedPassword = createInitialPanelPassword_();
    setScriptProperty_(CLICKCIDADE.PROPS.PANEL_PASSWORD, generatedPassword);
  }

  appendLog_('configuracao_inicial', 'Configuracao inicial aplicada.', {
    spreadsheetId: ss.getId(),
    photosFolderId: folder.getId(),
    senhaInicialGerada: generatedPassword ? 'sim' : 'nao'
  });

  try {
    SpreadsheetApp.getUi().alert(
      generatedPassword
        ? 'ClickCidade configurado.\n\nSenha inicial do painel: ' + generatedPassword + '\n\nPasta de fotos: ' + folder.getName()
        : 'ClickCidade configurado.\n\nSenha do painel ja estava configurada.\n\nPasta de fotos: ' + folder.getName()
    );
  } catch (err) {
    // Quando executado fora da interface da planilha, apenas retorna o resultado.
  }

  return {
    ok: true,
    app: CLICKCIDADE.APP_NAME,
    spreadsheetId: ss.getId(),
    spreadsheetUrl: ss.getUrl(),
    photosFolderId: folder.getId(),
    photosFolderUrl: folder.getUrl(),
    panelPassword: generatedPassword || 'JA_CONFIGURADA'
  };
}

function ensureStructure_() {
  var ss = getSpreadsheet_();
  if (ss.getName() === 'CarmoCuida - Denuncias') {
    DriveApp.getFileById(ss.getId()).setName('ClickCidade - Denuncias');
  }
  ensureSheetWithHeaders_(ss, CLICKCIDADE.SHEETS.CONFIG, CLICKCIDADE.HEADERS.Config);
  ensureSheetWithHeaders_(ss, CLICKCIDADE.SHEETS.REPORTS, CLICKCIDADE.HEADERS.Denuncias);
  ensureSheetWithHeaders_(ss, CLICKCIDADE.SHEETS.LOG, CLICKCIDADE.HEADERS.Log);
  seedConfig_(ss);
  return ss;
}

function ClickCidade_useActiveSpreadsheetAsDatabase() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    throw new Error('Nenhuma planilha ativa encontrada.');
  }
  setScriptProperty_(CLICKCIDADE.PROPS.SPREADSHEET_ID, ss.getId());
  return ClickCidade_setup();
}

function doGet(e) {
  var params = (e && e.parameter) || {};
  var action = normalizeText_(params.action || 'status');
  var payload;

  try {
    if (action === 'status') {
      payload = buildStatus_();
    } else {
      payload = { ok: false, error: 'Acao GET nao permitida.', generatedAt: nowIso_() };
    }
  } catch (err) {
    payload = { ok: false, error: safeError_(err), generatedAt: nowIso_() };
  }

  if (params.callback) {
    return ContentService
      .createTextOutput(String(params.callback) + '(' + JSON.stringify(payload) + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return jsonResponse_(payload);
}

function doPost(e) {
  var payload;
  try {
    payload = parseBody_(e);
    var action = normalizeText_(payload.action || '');
    ensureStructure_();

    if (action === 'create_report') {
      return jsonResponse_(createReport_(payload));
    }
    if (action === 'panel_login') {
      return jsonResponse_(panelLogin_(payload));
    }
    if (action === 'list_reports') {
      requirePanelSession_(payload);
      return jsonResponse_(listReports_());
    }
    if (action === 'get_photo') {
      requirePanelSession_(payload);
      return jsonResponse_(getPhoto_(payload));
    }
    if (action === 'update_report') {
      requirePanelSession_(payload);
      return jsonResponse_(updateReport_(payload));
    }
    if (action === 'status') {
      return jsonResponse_(buildStatus_());
    }

    return jsonResponse_({ ok: false, error: 'Acao invalida.', generatedAt: nowIso_() });
  } catch (err) {
    appendLogSafe_('error', safeError_(err), payload || {});
    return jsonResponse_({ ok: false, error: safeError_(err), generatedAt: nowIso_() });
  }
}

function createReport_(payload) {
  var category = normalizeCategory_(payload.category);
  var citizenName = normalizeText_(payload.citizenName || '', 120);
  var phone = normalizeText_(payload.phone || '', 40);
  var reference = normalizeText_(payload.reference || '', 240);
  var lat = normalizeNumber_(payload.latitude);
  var lng = normalizeNumber_(payload.longitude);
  var accuracy = normalizeNumber_(payload.accuracy);
  var hasGps = lat !== '' && lng !== '';

  if (!hasGps && reference.length < 4) {
    throw new Error('Informe GPS ou uma referencia.');
  }

  var photo = savePhoto_(payload.photoDataUrl, payload.photoName, payload.photoMime);
  var now = nowIso_();
  var row = {
    id: Utilities.getUuid(),
    protocol: createProtocol_(),
    createdAt: now,
    updatedAt: now,
    category: category,
    status: 'nova',
    phone: phone,
    reference: reference,
    latitude: lat,
    longitude: lng,
    accuracy: accuracy,
    gpsConfirmed: hasGps ? 'true' : 'false',
    photoId: photo.id,
    photoUrl: photo.url,
    photoDownloadUrl: photo.downloadUrl,
    notes: '',
    responsible: '',
    priority: guessPriority_(category),
    source: 'web',
    userAgent: normalizeText_(payload.userAgent || '', 500),
    citizenName: citizenName,
    resolutionPhotoId: '',
    resolutionPhotoUrl: '',
    resolutionPhotoDownloadUrl: '',
    resolvedAt: ''
  };

  appendObjects_(CLICKCIDADE.SHEETS.REPORTS, [row], CLICKCIDADE.HEADERS.Denuncias);
  appendLog_('create_report', 'Denuncia criada: ' + row.protocol, { protocol: row.protocol, category: row.category });
  return { ok: true, report: row, generatedAt: nowIso_() };
}

function panelLogin_(payload) {
  var password = String(payload.password || '');
  if (!isPanelPasswordConfigured_()) {
    throw new Error('Senha do painel nao configurada nas Script Properties.');
  }
  if (!validatePanelPassword_(password)) {
    appendLogSafe_('panel_login_failed', 'Senha recusada.', {});
    throw new Error('Senha incorreta.');
  }
  var token = Utilities.getUuid() + '-' + String(Date.now());
  CacheService.getScriptCache().put(sessionCacheKey_(token), '1', 21600);
  appendLog_('panel_login', 'Login do painel autorizado.', {});
  return { ok: true, session: token, expiresInSeconds: 21600, generatedAt: nowIso_() };
}

function listReports_() {
  var reports = readRowsAsObjects_(CLICKCIDADE.SHEETS.REPORTS)
    .map(normalizeReportRow_)
    .sort(function(a, b) {
      return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
    });
  return {
    ok: true,
    reports: reports,
    stats: buildStatsFromReports_(reports),
    generatedAt: nowIso_()
  };
}

function getPhoto_(payload) {
  var photoId = normalizeText_(payload.photoId || '', 180);
  if (!photoId) {
    throw new Error('Foto nao informada.');
  }

  var belongsToReport = readRowsAsObjects_(CLICKCIDADE.SHEETS.REPORTS).some(function(row) {
    return String(row.photoId || '') === photoId || String(row.resolutionPhotoId || '') === photoId;
  });
  if (!belongsToReport) {
    throw new Error('Foto nao vinculada a uma denuncia.');
  }

  var file = DriveApp.getFileById(photoId);
  var blob = file.getBlob();
  var mime = String(blob.getContentType() || file.getMimeType() || 'image/jpeg');
  if (mime.indexOf('image/') !== 0) {
    throw new Error('O arquivo da denuncia nao e uma imagem.');
  }

  return {
    ok: true,
    photoId: photoId,
    photoDataUrl: 'data:' + mime + ';base64,' + Utilities.base64Encode(blob.getBytes()),
    generatedAt: nowIso_()
  };
}

function updateReport_(payload) {
  var id = normalizeText_(payload.id || payload.protocol || '', 120);
  if (!id) {
    throw new Error('ID da denuncia nao informado.');
  }

  var rows = readRowsAsObjects_(CLICKCIDADE.SHEETS.REPORTS);
  var rowIndex = rows.findIndex(function(row) {
    return String(row.id) === id || String(row.protocol) === id;
  });
  if (rowIndex === -1) {
    throw new Error('Denuncia nao encontrada.');
  }

  var row = rows[rowIndex];
  var previousStatus = normalizeStatus_(row.status);
  var nextStatus = normalizeStatus_(payload.status || row.status);
  var resolutionPhoto = null;

  if (payload.resolutionPhotoDataUrl) {
    resolutionPhoto = savePhoto_(
      payload.resolutionPhotoDataUrl,
      payload.resolutionPhotoName || ('conclusao-' + String(row.protocol || id) + '.jpg'),
      payload.resolutionPhotoMime
    );
  }

  row.status = nextStatus;
  row.notes = normalizeText_(payload.notes !== undefined ? payload.notes : row.notes, 900);
  row.responsible = normalizeText_(payload.responsible !== undefined ? payload.responsible : row.responsible, 120);
  row.priority = normalizePriority_(payload.priority || row.priority);
  row.updatedAt = nowIso_();

  if (resolutionPhoto) {
    row.resolutionPhotoId = resolutionPhoto.id;
    row.resolutionPhotoUrl = resolutionPhoto.url;
    row.resolutionPhotoDownloadUrl = resolutionPhoto.downloadUrl;
  }
  if (nextStatus === 'resolvida' && !String(row.resolvedAt || '')) {
    row.resolvedAt = row.updatedAt;
  }

  rows[rowIndex] = row;
  writeObjects_(CLICKCIDADE.SHEETS.REPORTS, rows, CLICKCIDADE.HEADERS.Denuncias);
  appendLog_('update_report', 'Denuncia atualizada: ' + id, {
    id: id,
    status: row.status,
    resolutionPhotoAdded: !!resolutionPhoto
  });
  return listReports_();
}

function buildStatus_() {
  return {
    ok: true,
    app: CLICKCIDADE.APP_NAME,
    version: CLICKCIDADE.VERSION,
    generatedAt: nowIso_(),
    passwordConfigured: isPanelPasswordConfigured_(),
    spreadsheetConfigured: !!getScriptProperty_(CLICKCIDADE.PROPS.SPREADSHEET_ID),
    photosFolderConfigured: !!getScriptProperty_(CLICKCIDADE.PROPS.PHOTOS_FOLDER_ID)
  };
}

function getSpreadsheet_() {
  var active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) {
    setScriptProperty_(CLICKCIDADE.PROPS.SPREADSHEET_ID, active.getId());
    return active;
  }
  var id = getScriptProperty_(CLICKCIDADE.PROPS.SPREADSHEET_ID);
  if (id) {
    return SpreadsheetApp.openById(id);
  }
  var created = SpreadsheetApp.create('ClickCidade - Denuncias');
  setScriptProperty_(CLICKCIDADE.PROPS.SPREADSHEET_ID, created.getId());
  return created;
}

function getPhotosFolder_() {
  var id = getScriptProperty_(CLICKCIDADE.PROPS.PHOTOS_FOLDER_ID);
  if (id) {
    var existing = DriveApp.getFolderById(id);
    if (existing.getName() === 'CarmoCuida - Fotos') {
      existing.setName('ClickCidade - Fotos');
    }
    return existing;
  }
  var folder = DriveApp.createFolder('ClickCidade - Fotos');
  setScriptProperty_(CLICKCIDADE.PROPS.PHOTOS_FOLDER_ID, folder.getId());
  return folder;
}

function ensureSheetWithHeaders_(ss, sheetName, headers) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }
  if (sheet.getMaxColumns() < headers.length) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), headers.length - sheet.getMaxColumns());
  }
  var range = sheet.getRange(1, 1, 1, headers.length);
  var current = range.getValues()[0].map(function(value) { return String(value || '').trim(); });
  var same = headers.every(function(header, index) { return current[index] === header; });
  if (!same) {
    range.setValues([headers]);
  }
  sheet.setFrozenRows(1);
  return sheet;
}

function seedConfig_(ss) {
  var sheet = ensureSheetWithHeaders_(ss, CLICKCIDADE.SHEETS.CONFIG, CLICKCIDADE.HEADERS.Config);
  if (sheet.getLastRow() > 1) {
    var existing = sheet.getRange(2, 1, sheet.getLastRow() - 1, 3).getValues();
    existing.forEach(function(row) {
      if (row[0] === 'APP_NAME') {
        row[1] = CLICKCIDADE.APP_NAME;
      }
      if (row[0] === 'VERSION') {
        row[1] = CLICKCIDADE.VERSION;
      }
      if (row[0] === 'PHOTOS_FOLDER') {
        row[2] = 'Use CLICKCIDADE_PHOTOS_FOLDER_ID';
      }
    });
    sheet.getRange(2, 1, existing.length, 3).setValues(existing);
    return;
  }
  sheet.getRange(2, 1, 4, 3).setValues([
    ['APP_NAME', CLICKCIDADE.APP_NAME, 'Nome publico do sistema'],
    ['VERSION', CLICKCIDADE.VERSION, 'Versao do pacote local'],
    ['PANEL_PASSWORD', 'CONFIGURAR_EM_SCRIPT_PROPERTIES', 'Nao coloque senha real na planilha'],
    ['PHOTOS_FOLDER', 'CONFIGURAR_EM_SCRIPT_PROPERTIES', 'Use CLICKCIDADE_PHOTOS_FOLDER_ID']
  ]);
}

function readRowsAsObjects_(sheetName) {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() < 2) {
    return [];
  }
  var values = sheet.getDataRange().getValues();
  var headers = values.shift().map(function(header) { return String(header || '').trim(); });
  return values.map(function(row) {
    var object = {};
    headers.forEach(function(header, index) {
      if (header) {
        object[header] = row[index];
      }
    });
    return object;
  }).filter(function(row) {
    return Object.keys(row).some(function(key) { return row[key] !== '' && row[key] !== null; });
  });
}

function appendObjects_(sheetName, rows, headers) {
  if (!rows.length) {
    return;
  }
  var ss = getSpreadsheet_();
  var sheet = ensureSheetWithHeaders_(ss, sheetName, headers);
  var data = rows.map(function(row) {
    return headers.map(function(header) { return row[header] !== undefined ? row[header] : ''; });
  });
  sheet.getRange(sheet.getLastRow() + 1, 1, data.length, headers.length).setValues(data);
}

function writeObjects_(sheetName, rows, headers) {
  var ss = getSpreadsheet_();
  var sheet = ensureSheetWithHeaders_(ss, sheetName, headers);
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, Math.max(headers.length, sheet.getLastColumn())).clearContent();
  }
  if (!rows.length) {
    return;
  }
  var data = rows.map(function(row) {
    return headers.map(function(header) { return row[header] !== undefined ? row[header] : ''; });
  });
  sheet.getRange(2, 1, data.length, headers.length).setValues(data);
}

function savePhoto_(photoDataUrl, photoName, photoMime) {
  var parsed = parsePhotoDataUrl_(photoDataUrl);
  var folder = getPhotosFolder_();
  var safeName = normalizeFilename_(photoName || ('denuncia-' + Date.now() + parsed.extension));
  if (safeName.indexOf('.') === -1) {
    safeName += parsed.extension;
  }
  var blob = Utilities.newBlob(parsed.bytes, parsed.mime, safeName);
  var file = folder.createFile(blob);
  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (err) {
    appendLogSafe_('photo_sharing_warning', safeError_(err), { fileId: file.getId() });
  }
  return {
    id: file.getId(),
    url: file.getUrl(),
    downloadUrl: 'https://drive.google.com/uc?export=view&id=' + encodeURIComponent(file.getId())
  };
}

function parsePhotoDataUrl_(photoDataUrl) {
  var text = String(photoDataUrl || '');
  var match = /^data:(image\/(?:jpeg|jpg|png|webp));base64,([\s\S]+)$/i.exec(text);
  if (!match) {
    throw new Error('Foto invalida. Envie JPG, PNG ou WebP.');
  }
  var mime = match[1].toLowerCase().replace('image/jpg', 'image/jpeg');
  var extension = mime === 'image/png' ? '.png' : (mime === 'image/webp' ? '.webp' : '.jpg');
  var bytes = Utilities.base64Decode(match[2]);
  if (!bytes || !bytes.length) {
    throw new Error('Foto vazia.');
  }
  return { mime: mime, extension: extension, bytes: bytes };
}

function normalizeReportRow_(row) {
  row = row || {};
  return {
    id: String(row.id || ''),
    protocol: String(row.protocol || ''),
    createdAt: String(row.createdAt || ''),
    updatedAt: String(row.updatedAt || ''),
    category: normalizeCategory_(row.category),
    status: normalizeStatus_(row.status),
    phone: String(row.phone || ''),
    reference: String(row.reference || ''),
    latitude: normalizeNumber_(row.latitude),
    longitude: normalizeNumber_(row.longitude),
    accuracy: normalizeNumber_(row.accuracy),
    gpsConfirmed: String(row.gpsConfirmed || '').toLowerCase() === 'true',
    photoId: String(row.photoId || ''),
    photoUrl: String(row.photoDownloadUrl || row.photoUrl || ''),
    notes: String(row.notes || ''),
    responsible: String(row.responsible || ''),
    priority: normalizePriority_(row.priority),
    source: String(row.source || ''),
    citizenName: String(row.citizenName || ''),
    resolutionPhotoId: String(row.resolutionPhotoId || ''),
    resolutionPhotoUrl: String(row.resolutionPhotoDownloadUrl || row.resolutionPhotoUrl || ''),
    resolvedAt: String(row.resolvedAt || '')
  };
}

function buildStatsFromReports_(reports) {
  return {
    total: reports.length,
    novas: reports.filter(function(row) { return row.status === 'nova'; }).length,
    dengue: reports.filter(function(row) { return row.category === 'dengue'; }).length,
    semGps: reports.filter(function(row) { return !(row.latitude && row.longitude); }).length
  };
}

function requirePanelSession_(payload) {
  var token = String(payload.session || '').trim();
  if (!token || CacheService.getScriptCache().get(sessionCacheKey_(token)) !== '1') {
    throw new Error('Sessao expirada. Entre novamente.');
  }
}

function sessionCacheKey_(token) {
  return 'panel-session:' + token;
}

function isPanelPasswordConfigured_() {
  return !!(getScriptProperty_(CLICKCIDADE.PROPS.PANEL_PASSWORD_SHA256) || getScriptProperty_(CLICKCIDADE.PROPS.PANEL_PASSWORD));
}

function validatePanelPassword_(password) {
  var hash = getScriptProperty_(CLICKCIDADE.PROPS.PANEL_PASSWORD_SHA256);
  if (hash) {
    return constantTimeEqual_(sha256Hex_(password), String(hash).toLowerCase());
  }
  var plain = getScriptProperty_(CLICKCIDADE.PROPS.PANEL_PASSWORD);
  return !!plain && constantTimeEqual_(password, plain);
}

function sha256Hex_(text) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8);
  return bytes.map(function(byte) {
    var value = byte;
    if (value < 0) {
      value += 256;
    }
    return ('0' + value.toString(16)).slice(-2);
  }).join('');
}

function constantTimeEqual_(a, b) {
  a = String(a || '');
  b = String(b || '');
  var max = Math.max(a.length, b.length);
  var diff = a.length === b.length ? 0 : 1;
  for (var i = 0; i < max; i += 1) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

function createProtocol_() {
  var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'America/Sao_Paulo', 'yyyyMMdd');
  var suffix = Utilities.getUuid().replace(/-/g, '').slice(0, 6).toUpperCase();
  return 'CLIC-' + stamp + '-' + suffix;
}

function createInitialPanelPassword_() {
  return 'CLIC-' + Utilities.getUuid().replace(/-/g, '').slice(0, 8).toUpperCase();
}

function normalizeCategory_(value) {
  value = normalizeText_(value || 'lixo').toLowerCase();
  if (value.indexOf('deng') >= 0) {
    return 'dengue';
  }
  if (value.indexOf('terreno') >= 0) {
    return 'terreno';
  }
  return 'lixo';
}

function normalizeStatus_(value) {
  value = normalizeText_(value || 'nova').toLowerCase();
  return CLICKCIDADE.STATUSES[value] ? value : 'nova';
}

function normalizePriority_(value) {
  value = normalizeText_(value || 'media').toLowerCase();
  return ['baixa', 'media', 'alta'].indexOf(value) >= 0 ? value : 'media';
}

function guessPriority_(category) {
  if (category === 'dengue') {
    return 'alta';
  }
  if (category === 'terreno') {
    return 'media';
  }
  return 'baixa';
}

function normalizeNumber_(value) {
  if (value === null || value === undefined || value === '') {
    return '';
  }
  var number = Number(String(value).replace(',', '.'));
  return Number.isFinite(number) ? number : '';
}

function normalizeText_(value, maxLength) {
  maxLength = maxLength || 120;
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function normalizeFilename_(value) {
  var name = normalizeText_(value || 'foto.jpg', 120)
    .replace(/[\\/:*?"<>|#%{}~&]/g, '-')
    .replace(/\s+/g, '-');
  return name || ('foto-' + Date.now() + '.jpg');
}

function parseBody_(e) {
  if (!e || !e.postData || !e.postData.contents) {
    return {};
  }
  return JSON.parse(e.postData.contents);
}

function jsonResponse_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload || {}))
    .setMimeType(ContentService.MimeType.JSON);
}

function nowIso_() {
  return new Date().toISOString();
}

function safeError_(err) {
  return err && err.message ? String(err.message) : String(err || 'Erro desconhecido.');
}

function getScriptProperty_(key) {
  var properties = PropertiesService.getScriptProperties();
  var value = properties.getProperty(key);
  if (value || String(key).indexOf('CLICKCIDADE_') !== 0) {
    return value;
  }
  var legacyKey = String(key).replace(/^CLICKCIDADE_/, 'CARMOCUIDA_');
  var legacyValue = properties.getProperty(legacyKey);
  if (legacyValue) {
    properties.setProperty(key, legacyValue);
  }
  return legacyValue;
}

function setScriptProperty_(key, value) {
  PropertiesService.getScriptProperties().setProperty(key, String(value || ''));
}

function appendLog_(action, message, payload) {
  appendObjects_(CLICKCIDADE.SHEETS.LOG, [{
    createdAt: nowIso_(),
    action: action,
    message: message,
    payload: JSON.stringify(payload || {})
  }], CLICKCIDADE.HEADERS.Log);
}

function appendLogSafe_(action, message, payload) {
  try {
    appendLog_(action, message, payload);
  } catch (err) {
    // Evita que falha de log derrube a API principal.
  }
}
