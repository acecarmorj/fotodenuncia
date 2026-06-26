(function () {
  "use strict";

  var config = window.CARMOCUIDA_CONFIG || {};
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
  var categoryColors = {
    lixo: "#b7791f",
    dengue: "#c24135",
    terreno: "#246b8f"
  };
  var statusColors = {
    nova: "#c24135",
    triagem: "#b7791f",
    encaminhada: "#246b8f",
    vistoria: "#7a5b13",
    resolvida: "#136f4b",
    improcedente: "#647067"
  };

  var state = {
    session: "",
    reports: [],
    filtered: [],
    selectedId: "",
    map: null,
    markerLayer: null,
    territoryLayer: null,
    heatLayer: null,
    layerState: {
      territories: true,
      heat: true
    },
    refreshTimer: null
  };

  var $ = function (id) { return document.getElementById(id); };

  function hasApi() {
    return !!(config.API_URL && /^https?:\/\//i.test(config.API_URL));
  }

  function setLoginMessage(text, tone) {
    var node = $("loginMessage");
    node.textContent = text || "";
    node.classList.toggle("is-error", tone === "error");
    node.classList.toggle("is-success", tone === "success");
  }

  function postApi(payload) {
    if (!hasApi()) {
      return Promise.resolve(localDemoApi(payload));
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
    var reports = JSON.parse(localStorage.getItem("carmocuida_demo_reports") || "[]");
    if (payload.action === "panel_login") {
      return { ok: true, session: "demo-session", demo: true };
    }
    if (payload.action === "list_reports") {
      return { ok: true, reports: reports, stats: buildStats(reports), demo: true };
    }
    if (payload.action === "update_report") {
      reports = reports.map(function (report) {
        if (report.id !== payload.id && report.protocol !== payload.id) { return report; }
        return Object.assign({}, report, {
          status: payload.status || report.status,
          notes: payload.notes !== undefined ? payload.notes : report.notes,
          responsible: payload.responsible !== undefined ? payload.responsible : report.responsible,
          priority: payload.priority || report.priority,
          updatedAt: new Date().toISOString()
        });
      });
      localStorage.setItem("carmocuida_demo_reports", JSON.stringify(reports));
      return { ok: true, reports: reports, demo: true };
    }
    return { ok: false, error: "Acao indisponivel no modo demonstracao." };
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
      source: String(report.source || report.origem || "")
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

  function buildStats(reports) {
    return {
      total: reports.length,
      newCount: reports.filter(function (item) { return item.status === "nova"; }).length,
      dengue: reports.filter(function (item) { return item.category === "dengue"; }).length,
      noGps: reports.filter(function (item) { return !(item.latitude && item.longitude); }).length
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
    var select = $("filterTerritory");
    territories.forEach(function (territory) {
      var option = document.createElement("option");
      option.value = territory;
      option.textContent = territory;
      select.appendChild(option);
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

  function detectTerritory(report) {
    if (report.territory) { return report.territory; }
    if (!(report.latitude && report.longitude)) { return ""; }
    var polygons = getTerritorySource().polygons || [];
    for (var i = 0; i < polygons.length; i += 1) {
      if (pointInPolygon(Number(report.latitude), Number(report.longitude), polygons[i])) {
        return polygons[i].folder || polygons[i].originalFolder || "";
      }
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
        throw new Error((result && result.error) || "Senha nao autorizada.");
      }
      state.session = result.session;
      sessionStorage.setItem(config.PANEL_SESSION_KEY || "carmocuida_panel_session", state.session);
      $("loginScreen").hidden = true;
      $("panelShell").hidden = false;
      bootPanel();
    }).catch(function (error) {
      setLoginMessage(error.message || "Nao foi possivel entrar.", "error");
    });
  }

  function loadReports() {
    $("lastSync").textContent = "Sincronizando...";
    return postApi({ action: "list_reports", session: state.session }).then(function (result) {
      if (!result || !result.ok) {
        throw new Error((result && result.error) || "Nao foi possivel carregar.");
      }
      state.reports = enrichReports(result.reports || []);
      applyFilters();
      $("lastSync").textContent = "Atualizado em " + new Date().toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) + (result.demo ? " - modo demonstracao" : "");
    }).catch(function (error) {
      $("lastSync").textContent = error.message || "Falha na sincronizacao.";
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
          report.phone,
          report.reference,
          report.territory
        ].join(" ").toLowerCase();
        if (haystack.indexOf(search) === -1) { return false; }
      }
      return true;
    });

    renderStats();
    renderList();
    renderMap();
    renderSelected();
  }

  function renderStats() {
    var stats = buildStats(state.reports);
    $("statTotal").textContent = stats.total;
    $("statNew").textContent = stats.newCount;
    $("statDengue").textContent = stats.dengue;
    $("statNoGps").textContent = stats.noGps;
    $("listSummary").textContent = state.filtered.length + " de " + state.reports.length + " denuncias";
    $("mapSummary").textContent = state.filtered.filter(function (item) { return item.latitude && item.longitude; }).length + " pontos com GPS no mapa.";
  }

  function renderList() {
    var list = $("reportList");
    list.innerHTML = "";
    if (!state.filtered.length) {
      var empty = document.createElement("div");
      empty.className = "detail-empty";
      empty.textContent = "Nenhuma denuncia encontrada.";
      list.appendChild(empty);
      return;
    }
    state.filtered.forEach(function (report) {
      var button = document.createElement("button");
      button.type = "button";
      button.className = "report-item" + (report.id === state.selectedId ? " is-selected" : "");
      button.innerHTML =
        "<div>" +
          "<strong>" + escapeHtml(report.protocol || report.id) + "</strong>" +
          "<small>" + escapeHtml(formatDate(report.createdAt)) + " | " + escapeHtml(report.territory || "Sem territorio") + "</small>" +
        "</div>" +
        "<div>" +
          "<span class=\"pill " + report.category + "\">" + escapeHtml(categoryLabels[report.category]) + "</span>" +
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
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap"
    }).addTo(state.map);
    state.markerLayer = L.layerGroup().addTo(state.map);
    state.territoryLayer = L.layerGroup().addTo(state.map);
  }

  function renderTerritories() {
    if (!state.map || !state.territoryLayer) { return; }
    state.territoryLayer.clearLayers();
    if (!state.layerState.territories) { return; }
    (getTerritorySource().polygons || []).forEach(function (polygon) {
      var coords = (polygon.coordinates || []).map(function (pair) { return [pair[0], pair[1]]; });
      if (coords.length < 3) { return; }
      var layer = L.polygon(coords, {
        color: polygon.territoryType === "distrito" ? "#246b8f" : "#136f4b",
        weight: polygon.territoryType === "distrito" ? 1.8 : 1,
        fillColor: polygon.territoryType === "distrito" ? "#e3f1f7" : "#dff3e9",
        fillOpacity: polygon.territoryType === "distrito" ? .18 : .13
      }).bindPopup("<strong>" + escapeHtml(polygon.folder || polygon.originalFolder || "Territorio") + "</strong><br>Q " + escapeHtml(polygon.name || polygon.originalName || ""));
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
    var heatPoints = [];
    state.filtered.forEach(function (report) {
      if (!(report.latitude && report.longitude)) { return; }
      var latlng = [Number(report.latitude), Number(report.longitude)];
      bounds.push(latlng);
      heatPoints.push([latlng[0], latlng[1], report.category === "dengue" ? 1.4 : .8]);
      var marker = L.circleMarker(latlng, {
        radius: report.category === "dengue" ? 8 : 7,
        color: "#ffffff",
        weight: 2,
        fillColor: statusColors[report.status] || categoryColors[report.category],
        fillOpacity: .92
      });
      marker.bindPopup(
        "<div class=\"map-popup\">" +
          "<strong>" + escapeHtml(report.protocol) + "</strong>" +
          "<span>" + escapeHtml(categoryLabels[report.category]) + "</span>" +
          "<span>" + escapeHtml(statusLabels[report.status]) + "</span>" +
          "<span>" + escapeHtml(report.territory || "Sem territorio") + "</span>" +
        "</div>"
      );
      marker.on("click", function () {
        state.selectedId = report.id;
        renderList();
        renderSelected();
      });
      marker.addTo(state.markerLayer);
    });

    if (state.layerState.heat && window.L && typeof L.heatLayer === "function" && heatPoints.length) {
      state.heatLayer = L.heatLayer(heatPoints, {
        radius: 32,
        blur: 24,
        maxZoom: 16,
        minOpacity: .22,
        gradient: {
          .2: "rgba(255,244,214,.20)",
          .55: "rgba(246,173,85,.42)",
          .82: "rgba(226,83,70,.70)",
          1: "rgba(127,29,29,.92)"
        }
      }).addTo(state.map);
    }

    if (bounds.length && !state.map._carmoCuidaHadFit) {
      state.map.fitBounds(bounds, { padding: [30, 30], maxZoom: 16 });
      state.map._carmoCuidaHadFit = true;
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
    if (!report) {
      empty.hidden = false;
      content.hidden = true;
      content.innerHTML = "";
      $("detailSubtitle").textContent = "Selecione uma denuncia.";
      return;
    }

    empty.hidden = true;
    content.hidden = false;
    $("detailSubtitle").textContent = report.protocol;
    var mapsLink = report.latitude && report.longitude
      ? "https://www.google.com/maps?q=" + encodeURIComponent(report.latitude + "," + report.longitude)
      : "";

    content.innerHTML =
      (report.photoUrl ? "<img class=\"detail-photo\" src=\"" + escapeAttribute(report.photoUrl) + "\" alt=\"Foto da denuncia\">" : "") +
      "<div class=\"detail-meta\">" +
        metaBox("Tipo", categoryLabels[report.category]) +
        metaBox("Status", statusLabels[report.status]) +
        metaBox("Data", formatDate(report.createdAt)) +
        metaBox("Territorio", report.territory || "-") +
        metaBox("Telefone", report.phone || "-") +
        metaBox("GPS", report.latitude && report.longitude ? report.latitude + ", " + report.longitude : "Sem GPS confirmado") +
      "</div>" +
      "<div class=\"meta-box\"><span>Referencia</span><strong>" + escapeHtml(report.reference || "-") + "</strong></div>" +
      "<form class=\"detail-form\" id=\"detailForm\">" +
        "<label class=\"field-label\">Status<select id=\"detailStatus\">" + statusOrder.map(function (status) {
          return "<option value=\"" + status + "\"" + (status === report.status ? " selected" : "") + ">" + escapeHtml(statusLabels[status]) + "</option>";
        }).join("") + "</select></label>" +
        "<label class=\"field-label\">Responsavel<input id=\"detailResponsible\" maxlength=\"120\" value=\"" + escapeAttribute(report.responsible) + "\"></label>" +
        "<label class=\"field-label\">Observacao interna<textarea id=\"detailNotes\" rows=\"4\" maxlength=\"900\">" + escapeHtml(report.notes) + "</textarea></label>" +
        "<div class=\"detail-actions\">" +
          "<button class=\"primary-button\" type=\"submit\">Salvar</button>" +
          (mapsLink ? "<a class=\"secondary-button\" href=\"" + escapeAttribute(mapsLink) + "\" target=\"_blank\" rel=\"noopener\">Abrir mapa</a>" : "<button class=\"secondary-button\" type=\"button\" disabled>Sem GPS</button>") +
        "</div>" +
      "</form>";

    $("detailForm").addEventListener("submit", function (event) {
      event.preventDefault();
      updateSelected(report.id);
    });
  }

  function metaBox(label, value) {
    return "<div class=\"meta-box\"><span>" + escapeHtml(label) + "</span><strong>" + escapeHtml(value || "-") + "</strong></div>";
  }

  function updateSelected(id) {
    var payload = {
      action: "update_report",
      session: state.session,
      id: id,
      status: $("detailStatus").value,
      responsible: $("detailResponsible").value.trim(),
      notes: $("detailNotes").value.trim()
    };
    postApi(payload).then(function (result) {
      if (!result || !result.ok) {
        throw new Error((result && result.error) || "Nao foi possivel salvar.");
      }
      return loadReports();
    }).catch(function (error) {
      alert(error.message || "Erro ao salvar.");
    });
  }

  function exportCsv() {
    var rows = [[
      "protocolo",
      "data",
      "tipo",
      "status",
      "territorio",
      "telefone",
      "referencia",
      "latitude",
      "longitude",
      "responsavel",
      "observacao"
    ]];
    state.filtered.forEach(function (report) {
      rows.push([
        report.protocol,
        report.createdAt,
        categoryLabels[report.category],
        statusLabels[report.status],
        report.territory,
        report.phone,
        report.reference,
        report.latitude,
        report.longitude,
        report.responsible,
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
    link.download = "carmocuida-denuncias.csv";
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function escapeHtml(value) {
    return String(value || "").replace(/[&<>"']/g, function (char) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[char];
    });
  }

  function escapeAttribute(value) {
    return escapeHtml(value).replace(/`/g, "&#96;");
  }

  function bootPanel() {
    fillTerritoryFilter();
    ["filterCategory", "filterStatus", "filterTerritory", "filterSearch"].forEach(function (id) {
      $(id).addEventListener("input", applyFilters);
    });
    document.querySelectorAll("[data-map-layer]").forEach(function (button) {
      button.addEventListener("click", function () {
        var key = button.getAttribute("data-map-layer");
        state.layerState[key] = !state.layerState[key];
        button.classList.toggle("is-on", state.layerState[key]);
        renderMap();
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
    $("logoutButton").addEventListener("click", function () {
      sessionStorage.removeItem(config.PANEL_SESSION_KEY || "carmocuida_panel_session");
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
    state.session = sessionStorage.getItem(config.PANEL_SESSION_KEY || "carmocuida_panel_session") || "";
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
      setLoginMessage("Modo demonstracao local. Qualquer senha entra.");
    }
  }

  document.addEventListener("DOMContentLoaded", boot);
}());
