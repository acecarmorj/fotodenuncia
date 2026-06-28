(function () {
  "use strict";

  var config = window.CLICKCIDADE_CONFIG || {};
  var categoryLabels = {
    lixo: "Lixo",
    dengue: "Foco de dengue",
    terreno: "Terreno baldio"
  };
  var statusLabels = {
    nova: "Nova",
    triagem: "Em triagem",
    encaminhada: "Encaminhada",
    vistoria: "Em vistoria",
    resolvida: "Resolvida",
    improcedente: "Improcedente"
  };
  var statusOrder = ["nova", "triagem", "encaminhada", "vistoria", "resolvida", "improcedente"];
  var priorityLabels = {
    alta: "Alta",
    media: "Média",
    baixa: "Baixa"
  };
  var categoryColors = {
    lixo: "#e67e22",
    dengue: "#d63c32",
    terreno: "#79513a"
  };
  var statusColors = {
    nova: "#c43d35",
    triagem: "#d88a16",
    encaminhada: "#2e6f95",
    vistoria: "#a56712",
    resolvida: "#20845e",
    improcedente: "#687276"
  };

  var state = {
    session: "",
    reports: [],
    filtered: [],
    selectedId: "",
    map: null,
    baseLayers: {},
    activeBaseLayer: null,
    activeBaseKey: "streets",
    markerLayer: null,
    territoryLayer: null,
    heatLayer: null,
    photoCache: {},
    photoRequestId: 0,
    resolutionDraft: null,
    layerState: {
      territories: true,
      heat: true
    },
    refreshTimer: null
  };

  var $ = function (id) { return document.getElementById(id); };

  function hasApi() {
    var localDemo = /^(localhost|127\.0\.0\.1)$/i.test(location.hostname) &&
      new URLSearchParams(location.search).get("demo") === "1";
    return !localDemo && !!(config.API_URL && /^https?:\/\//i.test(config.API_URL));
  }

  function getPanelSessionKey() {
    var key = config.PANEL_SESSION_KEY || "clickcidade_panel_session";
    var localDemo = /^(localhost|127\.0\.0\.1)$/i.test(location.hostname) &&
      new URLSearchParams(location.search).get("demo") === "1";
    return localDemo ? key + "_demo" : key;
  }

  function setLoginMessage(text, tone) {
    var node = $("loginMessage");
    node.textContent = text || "";
    node.classList.toggle("is-error", tone === "error");
    node.classList.toggle("is-success", tone === "success");
  }

  function postApi(payload) {
    if (!hasApi()) {
      try {
        return Promise.resolve(localDemoApi(payload));
      } catch (error) {
        return Promise.reject(error);
      }
    }
    return fetch(config.API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload)
    }).then(function (response) {
      return response.json();
    });
  }

  function localDemoApi(payload) {
    var reports = JSON.parse(localStorage.getItem("clickcidade_demo_reports") || "[]");
    if (!reports.length) {
      reports = buildDemoReports();
      localStorage.setItem("clickcidade_demo_reports", JSON.stringify(reports));
    }
    if (payload.action === "panel_login") {
      return { ok: true, session: "demo-session", demo: true };
    }
    if (payload.action === "list_reports") {
      return { ok: true, reports: reports, stats: buildStats(reports), demo: true };
    }
    if (payload.action === "get_photo") {
      var photoReport = reports.find(function (report) {
        return String(report.photoId || "") === String(payload.photoId || "") ||
          String(report.resolutionPhotoId || "") === String(payload.photoId || "");
      });
      var photoDataUrl = photoReport && String(photoReport.resolutionPhotoId || "") === String(payload.photoId || "")
        ? photoReport.resolutionPhotoUrl
        : (photoReport && photoReport.photoUrl);
      if (photoReport && /^data:image\//i.test(photoDataUrl || "")) {
        return { ok: true, photoDataUrl: photoDataUrl, demo: true };
      }
      return { ok: false, error: "Foto indisponível no modo demonstração." };
    }
    if (payload.action === "update_report") {
      reports = reports.map(function (report) {
        if (report.id !== payload.id && report.protocol !== payload.id) { return report; }
        var now = new Date().toISOString();
        var nextStatus = payload.status || report.status;
        var resolutionPhotoId = report.resolutionPhotoId || "";
        var resolutionPhotoUrl = report.resolutionPhotoUrl || "";
        if (payload.resolutionPhotoDataUrl) {
          resolutionPhotoId = "demo-resolution-" + Date.now();
          resolutionPhotoUrl = payload.resolutionPhotoDataUrl;
        }
        return Object.assign({}, report, {
          status: nextStatus,
          notes: payload.notes !== undefined ? payload.notes : report.notes,
          responsible: payload.responsible !== undefined ? payload.responsible : report.responsible,
          priority: payload.priority || report.priority,
          resolutionPhotoId: resolutionPhotoId,
          resolutionPhotoUrl: resolutionPhotoUrl,
          resolvedAt: nextStatus === "resolvida" ? (report.resolvedAt || now) : (report.resolvedAt || ""),
          updatedAt: now
        });
      });
      localStorage.setItem("clickcidade_demo_reports", JSON.stringify(reports));
      return { ok: true, reports: reports, demo: true };
    }
    return { ok: false, error: "Ação indisponível no modo demonstração." };
  }

  function buildDemoReports() {
    var now = Date.now();
    function daysAgo(days) {
      return new Date(now - (days * 86400000)).toISOString();
    }
    return [
      {
        id: "demo-1",
        protocol: "CLIC-DEMO-001",
        createdAt: daysAgo(8),
        updatedAt: daysAgo(2),
        category: "dengue",
        status: "vistoria",
        citizenName: "Morador identificado",
        phone: "(22) 99999-0001",
        reference: "Próximo ao campo do bairro.",
        latitude: -21.9337,
        longitude: -42.6084,
        photoUrl: "./assets/clickcidade-logo.png",
        notes: "Vistoria solicitada.",
        responsible: "Equipe de campo",
        priority: "alta",
        source: "demo"
      },
      {
        id: "demo-2",
        protocol: "CLIC-DEMO-002",
        createdAt: daysAgo(2),
        updatedAt: daysAgo(1),
        category: "lixo",
        status: "encaminhada",
        citizenName: "",
        phone: "",
        reference: "Ao lado da escola municipal.",
        latitude: -21.9319,
        longitude: -42.6065,
        photoUrl: "./assets/clickcidade-logo.png",
        notes: "",
        responsible: "Limpeza urbana",
        priority: "media",
        source: "demo"
      },
      {
        id: "demo-3",
        protocol: "CLIC-DEMO-003",
        createdAt: daysAgo(6),
        updatedAt: daysAgo(1),
        category: "terreno",
        status: "resolvida",
        citizenName: "Cidadã identificada",
        phone: "(22) 99999-0003",
        reference: "Rua de demonstração.",
        latitude: -21.9308,
        longitude: -42.6093,
        photoUrl: "./assets/clickcidade-logo.png",
        resolutionPhotoUrl: "./assets/clickcidade-logo.png",
        resolvedAt: daysAgo(1),
        notes: "Serviço concluído.",
        responsible: "Fiscalização",
        priority: "baixa",
        source: "demo"
      }
    ];
  }

  function normalizeReport(report) {
    report = report || {};
    var latitude = numberOrBlank(report.latitude || report.lat);
    var longitude = numberOrBlank(report.longitude || report.lng);
    return {
      id: String(report.id || report.protocol || ""),
      protocol: String(report.protocol || ""),
      createdAt: String(report.createdAt || report.criado_em || report.created_at || ""),
      updatedAt: String(report.updatedAt || report.atualizado_em || report.updated_at || ""),
      category: normalizeCategory(report.category || report.tipo),
      status: normalizeStatus(report.status),
      citizenName: String(report.citizenName || report.nome_cidadao || ""),
      phone: String(report.phone || report.telefone || ""),
      reference: String(report.reference || report.referencia || ""),
      latitude: latitude,
      longitude: longitude,
      accuracy: String(report.accuracy || report.precisao || ""),
      gpsConfirmed: String(report.gpsConfirmed || report.gps_confirmado || "").toLowerCase() === "true" || (!!latitude && !!longitude),
      photoUrl: String(report.photoUrl || report.foto_url || report.photo_download_url || ""),
      photoId: String(report.photoId || report.foto_id || ""),
      notes: String(report.notes || report.observacao_interna || ""),
      responsible: String(report.responsible || report.responsavel || ""),
      priority: String(report.priority || report.prioridade || "media"),
      territory: String(report.territory || report.territorio || ""),
      source: String(report.source || report.origem || ""),
      resolutionPhotoUrl: String(report.resolutionPhotoUrl || report.foto_conclusao_url || ""),
      resolutionPhotoId: String(report.resolutionPhotoId || report.foto_conclusao_id || ""),
      resolvedAt: String(report.resolvedAt || report.resolvido_em || "")
    };
  }

  function numberOrBlank(value) {
    var number = Number(String(value || "").replace(",", "."));
    return Number.isFinite(number) ? number : "";
  }

  function normalizeCategory(value) {
    value = String(value || "").toLowerCase();
    if (value.indexOf("deng") >= 0) { return "dengue"; }
    if (value.indexOf("terreno") >= 0) { return "terreno"; }
    return "lixo";
  }

  function normalizeStatus(value) {
    value = String(value || "").toLowerCase();
    return statusLabels[value] ? value : "nova";
  }

  function formatDate(value) {
    if (!value) { return "-"; }
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) { return value; }
    return date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  }

  function isOpen(report) {
    return report.status !== "resolvida" && report.status !== "improcedente";
  }

  function ageInDays(report) {
    var created = new Date(report.createdAt);
    if (!report.createdAt || Number.isNaN(created.getTime())) { return 0; }
    return Math.max(0, Math.floor((Date.now() - created.getTime()) / 86400000));
  }

  function deadlineInfo(report) {
    var limits = { alta: 2, media: 5, baixa: 10 };
    var priority = ["alta", "media", "baixa"].indexOf(report.priority) >= 0 ? report.priority : "media";
    var age = ageInDays(report);
    var remaining = limits[priority] - age;
    if (remaining < 0) {
      return { className: "is-overdue", label: "Atrasada " + Math.abs(remaining) + (Math.abs(remaining) === 1 ? " dia" : " dias"), age: age };
    }
    if (remaining === 0) {
      return { className: "is-due", label: "Vence hoje", age: age };
    }
    return { className: "", label: remaining + (remaining === 1 ? " dia restante" : " dias restantes"), age: age };
  }

  function buildStats(reports) {
    return {
      total: reports.length,
      trash: reports.filter(function (item) { return item.category === "lixo"; }).length,
      dengue: reports.filter(function (item) { return item.category === "dengue"; }).length,
      land: reports.filter(function (item) { return item.category === "terreno"; }).length
    };
  }

  function getTerritorySource() {
    return window.ACE_TERRITORY_SOURCE || { polygons: [], meta: { catalog: { territories: [] } } };
  }

  function fillTerritoryFilter() {
    var source = getTerritorySource();
    var territories = source.meta && source.meta.catalog && source.meta.catalog.territories
      ? source.meta.catalog.territories
      : [];
    [$("filterTerritory"), $("reportTerritory")].forEach(function (select) {
      if (!select) { return; }
      territories.forEach(function (territory) {
        var option = document.createElement("option");
        option.value = territory;
        option.textContent = territory;
        select.appendChild(option);
      });
    });
  }

  function pointInPolygon(lat, lng, polygon) {
    var inside = false;
    var coords = polygon.coordinates || [];
    for (var i = 0, j = coords.length - 1; i < coords.length; j = i++) {
      var yi = Number(coords[i][0]);
      var xi = Number(coords[i][1]);
      var yj = Number(coords[j][0]);
      var xj = Number(coords[j][1]);
      var intersects = ((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / ((yj - yi) || 0.0000001) + xi);
      if (intersects) { inside = !inside; }
    }
    return inside;
  }

  function distanceToSegmentMeters(lat, lng, start, end) {
    var earthRadius = 6371000;
    var latitudeScale = Math.cos(lat * Math.PI / 180);
    var px = lng * latitudeScale;
    var py = lat;
    var ax = Number(start[1]) * latitudeScale;
    var ay = Number(start[0]);
    var bx = Number(end[1]) * latitudeScale;
    var by = Number(end[0]);
    var dx = bx - ax;
    var dy = by - ay;
    var lengthSquared = dx * dx + dy * dy;
    var position = lengthSquared ? ((px - ax) * dx + (py - ay) * dy) / lengthSquared : 0;
    position = Math.max(0, Math.min(1, position));
    var nearestX = ax + position * dx;
    var nearestY = ay + position * dy;
    return Math.hypot(px - nearestX, py - nearestY) * Math.PI / 180 * earthRadius;
  }

  function distanceToPolygonMeters(lat, lng, polygon) {
    var coords = polygon.coordinates || [];
    var nearest = Infinity;
    for (var index = 1; index < coords.length; index += 1) {
      nearest = Math.min(nearest, distanceToSegmentMeters(lat, lng, coords[index - 1], coords[index]));
    }
    return nearest;
  }

  function detectTerritory(report) {
    if (report.territory) { return report.territory; }
    if (!(report.latitude && report.longitude)) { return ""; }
    var polygons = getTerritorySource().polygons || [];
    var nearestPolygon = null;
    var nearestDistance = Infinity;
    for (var i = 0; i < polygons.length; i += 1) {
      if (pointInPolygon(Number(report.latitude), Number(report.longitude), polygons[i])) {
        return polygons[i].folder || polygons[i].originalFolder || "";
      }
      var distance = distanceToPolygonMeters(Number(report.latitude), Number(report.longitude), polygons[i]);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestPolygon = polygons[i];
      }
    }
    if (nearestPolygon && nearestDistance <= Number(config.TERRITORY_NEARBY_METERS || 180)) {
      return nearestPolygon.folder || nearestPolygon.originalFolder || "";
    }
    return "";
  }

  function enrichReports(reports) {
    return reports.map(normalizeReport).map(function (report) {
      report.territory = detectTerritory(report);
      return report;
    });
  }

  function authenticate(password) {
    setLoginMessage("Entrando...");
    return postApi({ action: "panel_login", password: password }).then(function (result) {
      if (!result || !result.ok || !result.session) {
        throw new Error((result && result.error) || "Senha não autorizada.");
      }
      state.session = result.session;
      sessionStorage.setItem(getPanelSessionKey(), state.session);
      $("loginScreen").hidden = true;
      $("panelShell").hidden = false;
      bootPanel();
    }).catch(function (error) {
      setLoginMessage(error.message || "Não foi possível entrar.", "error");
    });
  }

  function loadReports() {
    $("lastSync").textContent = "Sincronizando...";
    return postApi({ action: "list_reports", session: state.session }).then(function (result) {
      if (!result || !result.ok) {
        throw new Error((result && result.error) || "Não foi possível carregar.");
      }
      state.reports = enrichReports(result.reports || []);
      applyFilters();
      $("lastSync").textContent = "Atualizado em " + new Date().toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) + (result.demo ? " - modo demonstração" : "");
    }).catch(function (error) {
      $("lastSync").textContent = error.message || "Falha na sincronização.";
    });
  }

  function applyFilters() {
    var category = $("filterCategory").value;
    var status = $("filterStatus").value;
    var territory = $("filterTerritory").value;
    var search = $("filterSearch").value.trim().toLowerCase();

    state.filtered = state.reports.filter(function (report) {
      if (category && report.category !== category) { return false; }
      if (status && report.status !== status) { return false; }
      if (territory && report.territory !== territory) { return false; }
      if (search) {
        var haystack = [
          report.protocol,
          categoryLabels[report.category],
          statusLabels[report.status],
          report.citizenName,
          report.phone,
          report.reference,
          report.territory
        ].join(" ").toLowerCase();
        if (haystack.indexOf(search) === -1) { return false; }
      }
      return true;
    });

    renderStats();
    renderAttentionQueue();
    renderList();
    renderMap();
    renderSelected();
    renderReports();
  }

  function renderStats() {
    var stats = buildStats(state.reports);
    var openReports = state.reports.filter(isOpen);
    var progress = state.reports.filter(function (item) {
      return ["triagem", "encaminhada", "vistoria"].indexOf(item.status) >= 0;
    }).length;
    var overdue = openReports.filter(function (item) {
      return deadlineInfo(item).className === "is-overdue";
    }).length;
    var resolved = state.reports.filter(function (item) { return item.status === "resolvida"; }).length;

    $("statTotal").textContent = stats.total;
    $("statTrash").textContent = stats.trash;
    $("statDengue").textContent = stats.dengue;
    $("statLand").textContent = stats.land;
    if ($("statNew")) { $("statNew").textContent = state.reports.filter(function (item) { return item.status === "nova"; }).length; }
    if ($("statProgress")) { $("statProgress").textContent = progress; }
    if ($("statOverdue")) { $("statOverdue").textContent = overdue; }
    if ($("statResolved")) { $("statResolved").textContent = resolved; }
    $("listSummary").textContent = state.filtered.length + " de " + state.reports.length + " denúncias";
    $("mapSummary").textContent = state.filtered.filter(function (item) { return item.latitude && item.longitude; }).length + " pontos com GPS no mapa.";
  }

  function renderAttentionQueue() {
    var list = $("attentionList");
    var pending = state.reports.filter(isOpen).sort(function (a, b) {
      var priorityWeight = { alta: 3, media: 2, baixa: 1 };
      var deadlineA = deadlineInfo(a);
      var deadlineB = deadlineInfo(b);
      var overdueA = deadlineA.className === "is-overdue" ? 1 : 0;
      var overdueB = deadlineB.className === "is-overdue" ? 1 : 0;
      return overdueB - overdueA ||
        (priorityWeight[b.priority] || 2) - (priorityWeight[a.priority] || 2) ||
        deadlineB.age - deadlineA.age;
    });

    $("attentionSummary").textContent = pending.length
      ? pending.length + (pending.length === 1 ? " atendimento em aberto. Priorize atrasadas, dengue e registros mais antigos." : " atendimentos em aberto. Priorize atrasadas, dengue e registros mais antigos.")
      : "Nenhum atendimento pendente.";
    list.innerHTML = "";

    pending.slice(0, 6).forEach(function (report) {
      var deadline = deadlineInfo(report);
      var button = document.createElement("button");
      button.type = "button";
      button.className = "attention-item " + deadline.className;
      button.innerHTML =
        "<div class=\"attention-item-main\">" +
          "<span class=\"priority-label " + escapeAttribute(report.priority) + "\">" + escapeHtml(priorityLabels[report.priority] || report.priority) + "</span>" +
          "<strong>" + escapeHtml(report.protocol || report.id) + "</strong>" +
          "<small>" + escapeHtml(categoryLabels[report.category]) + " | " + escapeHtml(report.territory || "Sem território") + "</small>" +
        "</div>" +
        "<div class=\"deadline-label\">" +
          "<strong>" + deadline.age + (deadline.age === 1 ? " dia aberto" : " dias abertos") + "</strong>" +
          "<span>" + escapeHtml(deadline.label) + "</span>" +
        "</div>";
      button.addEventListener("click", function () {
        state.selectedId = report.id;
        renderList();
        renderSelected();
        focusMapReport(report);
        $("detailPanel").scrollIntoView({ behavior: "smooth", block: "start" });
      });
      list.appendChild(button);
    });

    if (!pending.length) {
      list.innerHTML = "<div class=\"attention-empty\">A fila está em dia.</div>";
    }
  }

  function getReportData() {
    var period = $("reportPeriod") ? $("reportPeriod").value : "30";
    var category = $("reportCategory") ? $("reportCategory").value : "";
    var territory = $("reportTerritory") ? $("reportTerritory").value : "";
    var now = new Date();
    var cutoff = null;
    var customStart = null;
    var customEnd = null;

    if (period === "today") {
      cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    } else if (/^\d+$/.test(period)) {
      cutoff = new Date(now.getTime() - (Number(period) * 24 * 60 * 60 * 1000));
    } else if (period === "custom") {
      if ($("reportStartDate").value) {
        customStart = new Date($("reportStartDate").value + "T00:00:00");
      }
      if ($("reportEndDate").value) {
        customEnd = new Date($("reportEndDate").value + "T23:59:59");
      }
    }

    return state.reports.filter(function (report) {
      var createdAt = new Date(report.createdAt);
      if (cutoff && (!report.createdAt || Number.isNaN(createdAt.getTime()) || createdAt < cutoff)) { return false; }
      if (customStart && (!report.createdAt || Number.isNaN(createdAt.getTime()) || createdAt < customStart)) { return false; }
      if (customEnd && (!report.createdAt || Number.isNaN(createdAt.getTime()) || createdAt > customEnd)) { return false; }
      if (category && report.category !== category) { return false; }
      if (territory && report.territory !== territory) { return false; }
      return true;
    });
  }

  function formatAverageResolution(items) {
    var durations = items.filter(function (report) {
      return report.status === "resolvida" && report.createdAt && (report.resolvedAt || report.updatedAt);
    }).map(function (report) {
      var start = new Date(report.createdAt).getTime();
      var end = new Date(report.resolvedAt || report.updatedAt).getTime();
      return end >= start ? end - start : NaN;
    }).filter(function (duration) {
      return Number.isFinite(duration);
    });
    if (!durations.length) { return "-"; }
    var averageHours = durations.reduce(function (sum, duration) { return sum + duration; }, 0) / durations.length / 3600000;
    if (averageHours < 24) {
      return Math.max(1, Math.round(averageHours)) + " h";
    }
    return (averageHours / 24).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + " dias";
  }

  function getReportPeriodLabel() {
    if ($("reportPeriod").value !== "custom") {
      return $("reportPeriod").options[$("reportPeriod").selectedIndex].text;
    }
    var start = $("reportStartDate").value;
    var end = $("reportEndDate").value;
    if (!start && !end) { return "Período personalizado"; }
    return "De " + (start ? new Date(start + "T00:00:00").toLocaleDateString("pt-BR") : "início") +
      " até " + (end ? new Date(end + "T00:00:00").toLocaleDateString("pt-BR") : "hoje");
  }

  function toggleCustomReportDates() {
    $("reportCustomDates").hidden = $("reportPeriod").value !== "custom";
  }

  function countBy(items, key, values) {
    var result = {};
    values.forEach(function (value) { result[value] = 0; });
    items.forEach(function (item) {
      var value = item[key];
      result[value] = (result[value] || 0) + 1;
    });
    return result;
  }

  function renderReportBars(containerId, values, counts, total) {
    var container = $(containerId);
    container.innerHTML = "";
    values.forEach(function (item) {
      var count = counts[item.key] || 0;
      var percent = total ? Math.round((count / total) * 100) : 0;
      var row = document.createElement("div");
      row.className = "report-bar-row";
      row.innerHTML =
        "<div class=\"report-bar-label\"><span>" + escapeHtml(item.label) + "</span><strong>" + count + " <small>(" + percent + "%)</small></strong></div>" +
        "<div class=\"report-bar-track\"><span style=\"width:" + percent + "%;background:" + escapeAttribute(item.color) + "\"></span></div>";
      container.appendChild(row);
    });
  }

  function renderTerritoryReport(items) {
    var groups = {};
    items.forEach(function (report) {
      var name = report.territory || "Sem território";
      if (!groups[name]) {
        groups[name] = { name: name, total: 0, newCount: 0, open: 0, resolved: 0, dengue: 0 };
      }
      groups[name].total += 1;
      if (report.status === "nova") { groups[name].newCount += 1; }
      if (report.status !== "resolvida" && report.status !== "improcedente") { groups[name].open += 1; }
      if (report.status === "resolvida") { groups[name].resolved += 1; }
      if (report.category === "dengue") { groups[name].dengue += 1; }
    });

    var rows = Object.keys(groups).map(function (key) { return groups[key]; }).sort(function (a, b) {
      return b.total - a.total || a.name.localeCompare(b.name, "pt-BR");
    });
    $("reportTerritoryTotal").textContent = rows.length + (rows.length === 1 ? " território" : " territórios");
    $("reportTerritoryRows").innerHTML = rows.length ? rows.map(function (row) {
      return "<tr>" +
        "<td><strong>" + escapeHtml(row.name) + "</strong></td>" +
        "<td>" + row.total + "</td>" +
        "<td>" + row.newCount + "</td>" +
        "<td>" + row.open + "</td>" +
        "<td>" + row.resolved + "</td>" +
        "<td>" + row.dengue + "</td>" +
      "</tr>";
    }).join("") : "<tr><td colspan=\"6\" class=\"report-table-empty\">Nenhum registro no período selecionado.</td></tr>";
  }

  function renderReports() {
    if (!$("reportsPanel")) { return; }
    var items = getReportData();
    var open = items.filter(function (item) { return item.status !== "resolvida" && item.status !== "improcedente"; }).length;
    var resolved = items.filter(function (item) { return item.status === "resolvida"; }).length;
    var rate = items.length ? Math.round((resolved / items.length) * 100) : 0;
    var categoryCounts = countBy(items, "category", ["lixo", "dengue", "terreno"]);
    var statusCounts = countBy(items, "status", statusOrder);
    var periodLabel = getReportPeriodLabel();

    $("reportTotal").textContent = items.length;
    $("reportOpen").textContent = open;
    $("reportResolved").textContent = resolved;
    $("reportResolutionRate").textContent = rate + "%";
    $("reportAverageTime").textContent = formatAverageResolution(items);
    $("reportSummary").textContent = periodLabel + " | " + items.length + (items.length === 1 ? " denúncia analisada." : " denúncias analisadas.");
    $("reportCategoryTotal").textContent = items.length + (items.length === 1 ? " registro" : " registros");
    $("reportStatusTotal").textContent = items.length + (items.length === 1 ? " registro" : " registros");

    renderReportBars("reportCategoryBars", [
      { key: "lixo", label: categoryLabels.lixo, color: categoryColors.lixo },
      { key: "dengue", label: categoryLabels.dengue, color: categoryColors.dengue },
      { key: "terreno", label: categoryLabels.terreno, color: categoryColors.terreno }
    ], categoryCounts, items.length);
    renderReportBars("reportStatusBars", statusOrder.map(function (status) {
      return { key: status, label: statusLabels[status], color: statusColors[status] };
    }), statusCounts, items.length);
    renderTerritoryReport(items);
  }

  function renderList() {
    var list = $("reportList");
    list.innerHTML = "";
    if (!state.filtered.length) {
      var empty = document.createElement("div");
      empty.className = "detail-empty";
      empty.textContent = "Nenhuma denúncia encontrada.";
      list.appendChild(empty);
      return;
    }
    state.filtered.forEach(function (report) {
      var button = document.createElement("button");
      button.type = "button";
      button.className = "report-item" + (report.id === state.selectedId ? " is-selected" : "");
      var deadline = deadlineInfo(report);
      button.innerHTML =
        "<div>" +
          "<strong>" + escapeHtml(report.protocol || report.id) + "</strong>" +
          "<small>" + escapeHtml(formatDate(report.createdAt)) + " | " + escapeHtml(report.territory || "Sem território") + "</small>" +
          (isOpen(report) ? "<small class=\"list-deadline " + deadline.className + "\">" + escapeHtml(deadline.label) + "</small>" : "") +
        "</div>" +
        "<div class=\"report-item-tags\">" +
          "<span class=\"pill " + report.category + "\">" + escapeHtml(categoryLabels[report.category]) + "</span>" +
          "<span class=\"pill status-pill " + escapeAttribute(report.status) + "\">" + escapeHtml(statusLabels[report.status]) + "</span>" +
        "</div>";
      button.addEventListener("click", function () {
        state.selectedId = report.id;
        renderList();
        renderSelected();
        focusMapReport(report);
      });
      list.appendChild(button);
    });
  }

  function initMap() {
    if (state.map || !window.L) { return; }
    state.map = L.map("reportMap", { zoomControl: true }).setView(config.MAP_CENTER || [-21.9325, -42.6075], config.MAP_ZOOM || 13);
    state.baseLayers = {
      streets: L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap"
      }),
      terrain: L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
        maxZoom: 17,
        attribution: "Mapa &copy; OpenTopoMap, dados &copy; OpenStreetMap"
      }),
      satellite: L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
        maxZoom: 19,
        attribution: "Imagens &copy; Esri"
      })
    };
    state.activeBaseKey = localStorage.getItem("clickcidade_map_base") || "streets";
    if (!state.baseLayers[state.activeBaseKey]) { state.activeBaseKey = "streets"; }
    switchBaseLayer(state.activeBaseKey);
    state.markerLayer = L.layerGroup().addTo(state.map);
    state.territoryLayer = L.layerGroup().addTo(state.map);
    var legend = L.control({ position: "bottomleft" });
    legend.onAdd = function () {
      var container = L.DomUtil.create("div", "map-category-legend");
      container.innerHTML =
        "<strong>Tipos de denúncia</strong>" +
        "<span><i style=\"background:" + categoryColors.lixo + "\"></i>Lixo</span>" +
        "<span><i style=\"background:" + categoryColors.dengue + "\"></i>Foco de dengue</span>" +
        "<span><i style=\"background:" + categoryColors.terreno + "\"></i>Terreno baldio</span>";
      L.DomEvent.disableClickPropagation(container);
      return container;
    };
    legend.addTo(state.map);
  }

  function switchBaseLayer(key) {
    if (!state.map || !state.baseLayers[key]) { return; }
    if (state.activeBaseLayer && state.map.hasLayer(state.activeBaseLayer)) {
      state.map.removeLayer(state.activeBaseLayer);
    }
    state.activeBaseKey = key;
    state.activeBaseLayer = state.baseLayers[key];
    state.activeBaseLayer.addTo(state.map);
    state.activeBaseLayer.bringToBack();
    localStorage.setItem("clickcidade_map_base", key);
    document.querySelectorAll("[data-map-base]").forEach(function (button) {
      button.classList.toggle("is-active", button.getAttribute("data-map-base") === key);
      button.setAttribute("aria-pressed", button.getAttribute("data-map-base") === key ? "true" : "false");
    });
  }

  function renderTerritories() {
    if (!state.map || !state.territoryLayer) { return; }
    state.territoryLayer.clearLayers();
    if (!state.layerState.territories) { return; }
    (getTerritorySource().polygons || []).forEach(function (polygon) {
      var coords = (polygon.coordinates || []).map(function (pair) { return [pair[0], pair[1]]; });
      if (coords.length < 3) { return; }
      var layer = L.polygon(coords, {
        color: polygon.territoryType === "distrito" ? "#2e6f95" : "#d85d16",
        weight: polygon.territoryType === "distrito" ? 1.8 : 1,
        fillColor: polygon.territoryType === "distrito" ? "#e1eef5" : "#fce8da",
        fillOpacity: polygon.territoryType === "distrito" ? .18 : .13
      }).bindPopup("<strong>" + escapeHtml(polygon.folder || polygon.originalFolder || "Território") + "</strong><br>Q " + escapeHtml(polygon.name || polygon.originalName || ""));
      layer.addTo(state.territoryLayer);
    });
  }

  function renderMap() {
    initMap();
    if (!state.map || !state.markerLayer) { return; }
    state.markerLayer.clearLayers();
    renderTerritories();

    if (state.heatLayer) {
      state.map.removeLayer(state.heatLayer);
      state.heatLayer = null;
    }

    var bounds = [];
    var heatPoints = {
      lixo: [],
      dengue: [],
      terreno: []
    };
    state.filtered.forEach(function (report) {
      if (!(report.latitude && report.longitude)) { return; }
      var latlng = [Number(report.latitude), Number(report.longitude)];
      bounds.push(latlng);
      heatPoints[report.category].push([latlng[0], latlng[1], report.category === "dengue" ? 1.3 : .9]);
      var marker = L.circleMarker(latlng, {
        radius: report.category === "dengue" ? 8 : 7,
        color: "#ffffff",
        weight: 2,
        fillColor: categoryColors[report.category],
        fillOpacity: .92
      });
      marker.bindPopup(
        "<div class=\"map-popup\">" +
          "<strong>" + escapeHtml(report.protocol) + "</strong>" +
          "<span>" + escapeHtml(categoryLabels[report.category]) + "</span>" +
          "<span>" + escapeHtml(statusLabels[report.status]) + "</span>" +
          "<span>" + escapeHtml(report.territory || "Sem território") + "</span>" +
        "</div>"
      );
      marker.on("click", function () {
        state.selectedId = report.id;
        renderList();
        renderSelected();
      });
      marker.addTo(state.markerLayer);
    });

    if (state.layerState.heat && window.L && typeof L.heatLayer === "function") {
      var heatGradients = {
        lixo: {
          .25: "rgba(255,239,205,.16)",
          .65: "rgba(242,165,76,.38)",
          1: "rgba(230,126,34,.72)"
        },
        dengue: {
          .25: "rgba(255,223,218,.16)",
          .65: "rgba(230,104,91,.40)",
          1: "rgba(214,60,50,.76)"
        },
        terreno: {
          .25: "rgba(235,223,214,.16)",
          .65: "rgba(164,111,77,.38)",
          1: "rgba(121,81,58,.74)"
        }
      };
      state.heatLayer = L.layerGroup().addTo(state.map);
      Object.keys(heatPoints).forEach(function (category) {
        if (!heatPoints[category].length) { return; }
        L.heatLayer(heatPoints[category], {
          radius: 29,
          blur: 21,
          maxZoom: 16,
          minOpacity: .16,
          gradient: heatGradients[category]
        }).addTo(state.heatLayer);
      });
    }

    if (bounds.length && !state.map._clickCidadeHadFit) {
      state.map.fitBounds(bounds, { padding: [30, 30], maxZoom: 16 });
      state.map._clickCidadeHadFit = true;
    }
  }

  function focusMapReport(report) {
    if (!state.map || !(report.latitude && report.longitude)) { return; }
    state.map.setView([Number(report.latitude), Number(report.longitude)], Math.max(state.map.getZoom(), 16));
  }

  function findSelected() {
    return state.reports.find(function (report) { return report.id === state.selectedId; }) || null;
  }

  function renderSelected() {
    var report = findSelected();
    var empty = $("detailEmpty");
    var content = $("detailContent");
    state.photoRequestId += 1;
    var requestId = state.photoRequestId;
    if (!report) {
      empty.hidden = false;
      content.hidden = true;
      content.innerHTML = "";
      $("detailSubtitle").textContent = "Selecione uma denúncia.";
      return;
    }

    empty.hidden = true;
    content.hidden = false;
    $("detailSubtitle").textContent = report.protocol;
    var mapsLink = report.latitude && report.longitude
      ? "https://www.google.com/maps?q=" + encodeURIComponent(report.latitude + "," + report.longitude)
      : "";
    var originalPhoto = buildPhotoBlock("original", "Foto recebida", report.photoId, report.photoUrl);
    var resolutionPhoto = buildPhotoBlock("resolution", "Foto da conclusão", report.resolutionPhotoId, report.resolutionPhotoUrl);
    var draft = state.resolutionDraft && state.resolutionDraft.reportId === report.id ? state.resolutionDraft : null;

    content.innerHTML =
      (originalPhoto || resolutionPhoto ? "<div class=\"detail-photo-grid\">" + originalPhoto + resolutionPhoto + "</div>" : "") +
      "<div class=\"detail-meta\">" +
        metaBox("Tipo", categoryLabels[report.category]) +
        metaBox("Status", statusLabels[report.status]) +
        metaBox("Data", formatDate(report.createdAt)) +
        metaBox("Tempo aberto", isOpen(report) ? ageInDays(report) + (ageInDays(report) === 1 ? " dia" : " dias") : "Concluída") +
        metaBox("Território", report.territory || "-") +
        metaBox("Nome", report.citizenName || "-") +
        metaBox("WhatsApp", report.phone || "-") +
        metaBox("GPS", report.latitude && report.longitude ? report.latitude + ", " + report.longitude : "Sem GPS confirmado") +
        (report.resolvedAt ? metaBox("Resolvida em", formatDate(report.resolvedAt)) : "") +
      "</div>" +
      "<div class=\"meta-box\"><span>Referência</span><strong>" + escapeHtml(report.reference || "-") + "</strong></div>" +
      "<form class=\"detail-form\" id=\"detailForm\">" +
        "<label class=\"field-label\">Status<select id=\"detailStatus\">" + statusOrder.map(function (status) {
          return "<option value=\"" + status + "\"" + (status === report.status ? " selected" : "") + ">" + escapeHtml(statusLabels[status]) + "</option>";
        }).join("") + "</select></label>" +
        "<label class=\"field-label\">Prioridade<select id=\"detailPriority\">" +
          ["alta", "media", "baixa"].map(function (priority) {
            var label = priorityLabels[priority] || priority;
            return "<option value=\"" + priority + "\"" + (priority === report.priority ? " selected" : "") + ">" + label + "</option>";
          }).join("") +
        "</select></label>" +
        "<label class=\"field-label\">Responsável<input id=\"detailResponsible\" maxlength=\"120\" value=\"" + escapeAttribute(report.responsible) + "\"></label>" +
        "<label class=\"field-label\">Observação interna<textarea id=\"detailNotes\" rows=\"4\" maxlength=\"900\">" + escapeHtml(report.notes) + "</textarea></label>" +
        "<div class=\"resolution-upload\">" +
          "<span class=\"field-label\">Comprovação do serviço</span>" +
          "<input class=\"file-input\" id=\"resolutionPhotoInput\" type=\"file\" accept=\"image/*\" capture=\"environment\">" +
          "<button class=\"photo-button\" id=\"resolutionPhotoButton\" type=\"button\">" + (report.resolutionPhotoId || report.resolutionPhotoUrl ? "Substituir foto da conclusão" : "Adicionar foto da conclusão") + "</button>" +
          "<img class=\"resolution-preview\" id=\"resolutionPreview\" alt=\"Prévia da foto de conclusão\"" + (draft ? " src=\"" + escapeAttribute(draft.dataUrl) + "\"" : " hidden") + ">" +
          "<small id=\"resolutionPhotoName\">" + escapeHtml(draft ? draft.name : (report.resolutionPhotoId || report.resolutionPhotoUrl ? "Foto de conclusão já anexada." : "Opcional para registrar o resultado do serviço.")) + "</small>" +
        "</div>" +
        "<div class=\"detail-actions\">" +
          "<button class=\"primary-button\" type=\"submit\">Salvar</button>" +
          (mapsLink ? "<a class=\"secondary-button\" href=\"" + escapeAttribute(mapsLink) + "\" target=\"_blank\" rel=\"noopener\">Abrir mapa</a>" : "<button class=\"secondary-button\" type=\"button\" disabled>Sem GPS</button>") +
        "</div><p class=\"form-message\" id=\"detailMessage\" role=\"status\"></p>" +
      "</form>";

    if (originalPhoto) {
      setupPhotoFallback(report, {
        prefix: "original",
        photoId: report.photoId,
        photoUrl: report.photoUrl
      }, requestId);
    }
    if (resolutionPhoto) {
      setupPhotoFallback(report, {
        prefix: "resolution",
        photoId: report.resolutionPhotoId,
        photoUrl: report.resolutionPhotoUrl
      }, requestId);
    }
    $("resolutionPhotoButton").addEventListener("click", function () {
      $("resolutionPhotoInput").click();
    });
    $("resolutionPhotoInput").addEventListener("change", function (event) {
      prepareResolutionPhoto(report.id, event.target.files && event.target.files[0]);
    });
    $("detailForm").addEventListener("submit", function (event) {
      event.preventDefault();
      updateSelected(report.id);
    });
  }

  function buildPhotoBlock(prefix, label, photoId, photoUrl) {
    if (!photoId && !photoUrl) { return ""; }
    var drivePhotoUrl = photoId
      ? "https://drive.google.com/file/d/" + encodeURIComponent(photoId) + "/view"
      : photoUrl;
    return "<figure class=\"detail-photo-block\">" +
      "<figcaption>" + escapeHtml(label) + "</figcaption>" +
      "<div class=\"detail-photo-wrap\">" +
        "<img class=\"detail-photo\" id=\"" + prefix + "Photo\" alt=\"" + escapeAttribute(label) + "\" hidden>" +
        "<div class=\"photo-loading\" id=\"" + prefix + "Loading\">Carregando foto...</div>" +
        "<a class=\"photo-fallback\" id=\"" + prefix + "Fallback\" href=\"" + escapeAttribute(drivePhotoUrl) + "\" target=\"_blank\" rel=\"noopener\" hidden>Abrir foto no Google Drive</a>" +
      "</div>" +
    "</figure>";
  }

  function getPhotoUrls(photoId, photoUrl) {
    var urls = [];
    if (photoId) {
      urls.push("https://drive.google.com/thumbnail?id=" + encodeURIComponent(photoId) + "&sz=w1600");
      urls.push("https://lh3.googleusercontent.com/d/" + encodeURIComponent(photoId) + "=w1600");
    }
    if (photoUrl && urls.indexOf(photoUrl) === -1) {
      urls.push(photoUrl);
    }
    return urls;
  }

  function setupPhotoFallback(report, options, requestId) {
    var image = $(options.prefix + "Photo");
    var fallback = $(options.prefix + "Fallback");
    var loading = $(options.prefix + "Loading");
    var urls = getPhotoUrls(options.photoId, options.photoUrl);
    if (!image) { return; }

    function isCurrent() {
      var selected = findSelected();
      return requestId === state.photoRequestId && selected && selected.id === report.id;
    }

    function showFallback() {
      if (!isCurrent()) { return; }
      image.hidden = true;
      if (loading) { loading.hidden = true; }
      if (fallback) { fallback.hidden = false; }
    }

    function tryPublicUrl(index) {
      if (!isCurrent()) { return; }
      if (index >= urls.length) {
        showFallback();
        return;
      }
      image.onload = function () {
        if (!isCurrent()) { return; }
        image.hidden = false;
        if (loading) { loading.hidden = true; }
        if (fallback) { fallback.hidden = true; }
      };
      image.onerror = function () { tryPublicUrl(index + 1); };
      image.hidden = false;
      image.src = urls[index];
    }

    function showApiPhoto(dataUrl) {
      if (!isCurrent() || !/^data:image\//i.test(dataUrl || "")) {
        tryPublicUrl(0);
        return;
      }
      image.onload = function () {
        if (!isCurrent()) { return; }
        image.hidden = false;
        if (loading) { loading.hidden = true; }
        if (fallback) { fallback.hidden = true; }
      };
      image.onerror = function () { tryPublicUrl(0); };
      image.src = dataUrl;
      image.hidden = false;
    }

    if (options.photoId && state.photoCache[options.photoId]) {
      showApiPhoto(state.photoCache[options.photoId]);
      return;
    }
    if (hasApi() && options.photoId) {
      postApi({ action: "get_photo", session: state.session, photoId: options.photoId }).then(function (result) {
        if (!result || !result.ok || !result.photoDataUrl) {
          throw new Error((result && result.error) || "Foto indisponível.");
        }
        state.photoCache[options.photoId] = result.photoDataUrl;
        showApiPhoto(result.photoDataUrl);
      }).catch(function () {
        tryPublicUrl(0);
      });
      return;
    }
    tryPublicUrl(0);
  }

  function resizePanelImage(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error("Não foi possível ler a foto.")); };
      reader.onload = function () {
        var image = new Image();
        image.onerror = function () { reject(new Error("Foto inválida.")); };
        image.onload = function () {
          var maxSide = 1600;
          var scale = Math.min(1, maxSide / Math.max(image.width, image.height));
          var canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(image.width * scale));
          canvas.height = Math.max(1, Math.round(image.height * scale));
          canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
          resolve({
            dataUrl: canvas.toDataURL("image/jpeg", .82),
            name: file.name || "conclusao.jpg",
            mime: "image/jpeg"
          });
        };
        image.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function setDetailMessage(text, tone) {
    var node = $("detailMessage");
    if (!node) { return; }
    node.textContent = text || "";
    node.classList.toggle("is-error", tone === "error");
    node.classList.toggle("is-success", tone === "success");
  }

  function prepareResolutionPhoto(reportId, file) {
    if (!file) { return; }
    setDetailMessage("Preparando foto da conclusão...");
    resizePanelImage(file).then(function (photo) {
      if (!findSelected() || findSelected().id !== reportId) { return; }
      state.resolutionDraft = {
        reportId: reportId,
        dataUrl: photo.dataUrl,
        name: photo.name,
        mime: photo.mime
      };
      $("resolutionPreview").src = photo.dataUrl;
      $("resolutionPreview").hidden = false;
      $("resolutionPhotoName").textContent = photo.name;
      setDetailMessage("Foto da conclusão pronta.", "success");
    }).catch(function (error) {
      state.resolutionDraft = null;
      setDetailMessage(error.message || "Não foi possível preparar a foto.", "error");
    });
  }

  function metaBox(label, value) {
    return "<div class=\"meta-box\"><span>" + escapeHtml(label) + "</span><strong>" + escapeHtml(value || "-") + "</strong></div>";
  }

  function updateSelected(id) {
    var report = findSelected();
    var draft = state.resolutionDraft && state.resolutionDraft.reportId === id ? state.resolutionDraft : null;
    var nextStatus = $("detailStatus").value;
    var payload = {
      action: "update_report",
      session: state.session,
      id: id,
      status: nextStatus,
      priority: $("detailPriority").value,
      responsible: $("detailResponsible").value.trim(),
      notes: $("detailNotes").value.trim()
    };
    if (draft) {
      payload.resolutionPhotoDataUrl = draft.dataUrl;
      payload.resolutionPhotoName = draft.name;
      payload.resolutionPhotoMime = draft.mime;
    }
    setDetailMessage("Salvando atendimento...");
    postApi(payload).then(function (result) {
      if (!result || !result.ok) {
        throw new Error((result && result.error) || "Não foi possível salvar.");
      }
      state.resolutionDraft = null;
      return loadReports();
    }).catch(function (error) {
      setDetailMessage(error.message || "Erro ao salvar.", "error");
    });
  }

  function downloadReportsCsv(reports, filename) {
    var rows = [[
      "protocolo",
      "data",
      "tipo",
      "status",
      "prioridade",
      "território",
      "nome",
      "whatsapp",
      "referência",
      "latitude",
      "longitude",
      "responsável",
      "resolvida_em",
      "observação"
    ]];
    reports.forEach(function (report) {
      rows.push([
        report.protocol,
        report.createdAt,
        categoryLabels[report.category],
        statusLabels[report.status],
        priorityLabels[report.priority] || report.priority,
        report.territory,
        report.citizenName,
        report.phone,
        report.reference,
        report.latitude,
        report.longitude,
        report.responsible,
        report.resolvedAt,
        report.notes
      ]);
    });
    var csv = rows.map(function (row) {
      return row.map(function (value) {
        return "\"" + String(value || "").replace(/"/g, "\"\"") + "\"";
      }).join(",");
    }).join("\n");
    var blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    var link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function exportCsv() {
    downloadReportsCsv(state.filtered, "clickcidade-denuncias.csv");
  }

  function exportReportCsv() {
    downloadReportsCsv(getReportData(), "clickcidade-relatorio.csv");
  }

  function escapeHtml(value) {
    return String(value || "").replace(/[&<>"']/g, function (char) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[char];
    });
  }

  function escapeAttribute(value) {
    return escapeHtml(value).replace(/`/g, "&#96;");
  }

  function dateInputValue(date) {
    var year = date.getFullYear();
    var month = String(date.getMonth() + 1).padStart(2, "0");
    var day = String(date.getDate()).padStart(2, "0");
    return year + "-" + month + "-" + day;
  }

  function bootPanel() {
    fillTerritoryFilter();
    ["filterCategory", "filterStatus", "filterTerritory", "filterSearch"].forEach(function (id) {
      $(id).addEventListener("input", applyFilters);
    });
    var today = new Date();
    var thirtyDaysAgo = new Date(today.getTime() - (30 * 86400000));
    $("reportStartDate").value = dateInputValue(thirtyDaysAgo);
    $("reportEndDate").value = dateInputValue(today);
    toggleCustomReportDates();
    $("reportPeriod").addEventListener("input", function () {
      toggleCustomReportDates();
      renderReports();
    });
    ["reportCategory", "reportTerritory", "reportStartDate", "reportEndDate"].forEach(function (id) {
      $(id).addEventListener("input", renderReports);
    });
    document.querySelectorAll("[data-map-layer]").forEach(function (button) {
      button.addEventListener("click", function () {
        var key = button.getAttribute("data-map-layer");
        state.layerState[key] = !state.layerState[key];
        button.classList.toggle("is-on", state.layerState[key]);
        renderMap();
      });
    });
    document.querySelectorAll("[data-map-base]").forEach(function (button) {
      button.addEventListener("click", function () {
        switchBaseLayer(button.getAttribute("data-map-base"));
      });
    });
    document.querySelectorAll("[data-focus-section]").forEach(function (button) {
      button.addEventListener("click", function () {
        document.querySelectorAll("[data-focus-section]").forEach(function (item) { item.classList.remove("is-active"); });
        button.classList.add("is-active");
        var target = $(button.getAttribute("data-focus-section"));
        if (target) { target.scrollIntoView({ behavior: "smooth", block: "start" }); }
      });
    });
    $("refreshButton").addEventListener("click", loadReports);
    $("exportButton").addEventListener("click", exportCsv);
    $("exportReportButton").addEventListener("click", exportReportCsv);
    $("printReportButton").addEventListener("click", function () { window.print(); });
    $("logoutButton").addEventListener("click", function () {
      sessionStorage.removeItem(getPanelSessionKey());
      location.reload();
    });

    loadReports();
    if (state.refreshTimer) { clearInterval(state.refreshTimer); }
    state.refreshTimer = setInterval(loadReports, Math.max(20, config.PANEL_REFRESH_SECONDS || 45) * 1000);
    setTimeout(function () {
      if (state.map) { state.map.invalidateSize(); }
    }, 300);
  }

  function boot() {
    state.session = sessionStorage.getItem(getPanelSessionKey()) || "";
    if (state.session) {
      $("loginScreen").hidden = true;
      $("panelShell").hidden = false;
      bootPanel();
    }

    $("loginForm").addEventListener("submit", function (event) {
      event.preventDefault();
      authenticate($("passwordInput").value);
    });

    if (!hasApi()) {
      setLoginMessage("Modo demonstração local. Qualquer senha entra.");
    }
  }

  document.addEventListener("DOMContentLoaded", boot);
}());
