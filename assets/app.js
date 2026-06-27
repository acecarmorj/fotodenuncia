(function () {
  "use strict";

  var config = window.CLICKCIDADE_CONFIG || {};
  var state = {
    photoDataUrl: "",
    photoName: "",
    photoMime: "",
    location: null,
    receipt: null,
    installPrompt: null
  };

  var $ = function (id) { return document.getElementById(id); };

  function hasApi() {
    var localDemo = /^(localhost|127\.0\.0\.1)$/i.test(location.hostname) &&
      new URLSearchParams(location.search).get("demo") === "1";
    return !localDemo && !!(config.API_URL && /^https?:\/\//i.test(config.API_URL));
  }

  function setMessage(text, tone) {
    var node = $("formMessage");
    node.textContent = text || "";
    node.classList.toggle("is-error", tone === "error");
    node.classList.toggle("is-success", tone === "success");
  }

  function getSelectedCategory() {
    var selected = document.querySelector('input[name="category"]:checked');
    return selected ? selected.value : "lixo";
  }

  function postApi(payload) {
    if (!hasApi()) {
      return Promise.resolve(localDemoCreate(payload));
    }
    return fetch(config.API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload)
    }).then(function (response) {
      return response.json();
    });
  }

  function localDemoCreate(payload) {
    var reports = JSON.parse(localStorage.getItem("clickcidade_demo_reports") || "[]");
    var now = new Date().toISOString();
    var protocol = "CLIC-DEMO-" + String(Date.now()).slice(-6);
    var report = {
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
      protocol: protocol,
      createdAt: now,
      updatedAt: now,
      category: payload.category,
      status: "nova",
      citizenName: payload.citizenName || "",
      phone: payload.phone || "",
      reference: payload.reference || "",
      latitude: payload.latitude || "",
      longitude: payload.longitude || "",
      accuracy: payload.accuracy || "",
      gpsConfirmed: !!(payload.latitude && payload.longitude),
      photoUrl: payload.photoDataUrl,
      notes: "",
      responsible: "",
      priority: payload.category === "dengue" ? "alta" : "media",
      source: "demo",
      resolutionPhotoId: "",
      resolutionPhotoUrl: "",
      resolvedAt: ""
    };
    reports.unshift(report);
    localStorage.setItem("clickcidade_demo_reports", JSON.stringify(reports));
    return { ok: true, report: report, demo: true };
  }

  function resizeImage(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error("Nao foi possivel ler a foto.")); };
      reader.onload = function () {
        var image = new Image();
        image.onerror = function () { reject(new Error("Foto invalida.")); };
        image.onload = function () {
          var maxSide = 1600;
          var scale = Math.min(1, maxSide / Math.max(image.width, image.height));
          var width = Math.max(1, Math.round(image.width * scale));
          var height = Math.max(1, Math.round(image.height * scale));
          var canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          var context = canvas.getContext("2d");
          context.drawImage(image, 0, 0, width, height);
          var mime = file.type && /image\/(png|webp|jpeg|jpg)/i.test(file.type) ? file.type : "image/jpeg";
          var dataUrl = canvas.toDataURL(mime === "image/png" ? "image/png" : "image/jpeg", .82);
          resolve({ dataUrl: dataUrl, name: file.name || "foto.jpg", mime: mime });
        };
        image.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function handlePhoto(file) {
    if (!file) { return; }
    setMessage("Preparando foto...");
    resizeImage(file).then(function (photo) {
      state.photoDataUrl = photo.dataUrl;
      state.photoName = photo.name;
      state.photoMime = photo.mime;
      $("photoPreview").src = photo.dataUrl;
      $("photoPreview").hidden = false;
      setMessage("Foto pronta.", "success");
    }).catch(function (error) {
      state.photoDataUrl = "";
      setMessage(error.message, "error");
    });
  }

  function requestLocation() {
    var status = $("locationStatus");
    if (!navigator.geolocation) {
      status.textContent = "GPS indisponivel neste aparelho.";
      return;
    }
    status.textContent = "Buscando localizacao...";
    navigator.geolocation.getCurrentPosition(function (position) {
      state.location = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy
      };
      status.textContent = "GPS confirmado com precisao aproximada de " + Math.round(position.coords.accuracy || 0) + " m.";
    }, function () {
      state.location = null;
      status.textContent = "GPS nao confirmado. Use uma referencia.";
    }, {
      enableHighAccuracy: true,
      timeout: 12000,
      maximumAge: 30000
    });
  }

  function resetForm() {
    $("reportForm").reset();
    $("photoPreview").hidden = true;
    $("photoPreview").removeAttribute("src");
    $("locationStatus").textContent = "Aguardando GPS.";
    state.photoDataUrl = "";
    state.photoName = "";
    state.photoMime = "";
    state.location = null;
  }

  function formatReceiptDate(value) {
    var date = new Date(value || Date.now());
    return date.toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function showReceipt(report) {
    state.receipt = {
      protocol: report.protocol || "",
      createdAt: report.createdAt || new Date().toISOString()
    };
    $("receiptProtocol").textContent = state.receipt.protocol;
    $("receiptDate").textContent = "Enviado em " + formatReceiptDate(state.receipt.createdAt);
    $("reportForm").hidden = true;
    $("receiptPanel").hidden = false;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function startNewReport() {
    resetForm();
    state.receipt = null;
    $("receiptMessage").textContent = "";
    $("receiptPanel").hidden = true;
    $("reportForm").hidden = false;
    setMessage("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function shareReceipt() {
    if (!state.receipt) { return; }
    var text = "ClickCidade - protocolo " + state.receipt.protocol +
      ", enviado em " + formatReceiptDate(state.receipt.createdAt) + ".";
    var shareResult = navigator.share
      ? navigator.share({ title: "Protocolo ClickCidade", text: text })
      : navigator.clipboard.writeText(text);

    Promise.resolve(shareResult).then(function () {
      $("receiptMessage").textContent = navigator.share ? "Protocolo compartilhado." : "Protocolo copiado.";
    }).catch(function (error) {
      if (!error || error.name !== "AbortError") {
        $("receiptMessage").textContent = "Nao foi possivel compartilhar agora.";
      }
    });
  }

  function setupInstallation() {
    window.addEventListener("beforeinstallprompt", function (event) {
      event.preventDefault();
      state.installPrompt = event;
      $("installButton").hidden = false;
    });
    $("installButton").addEventListener("click", function () {
      if (!state.installPrompt) { return; }
      state.installPrompt.prompt();
      state.installPrompt.userChoice.finally(function () {
        state.installPrompt = null;
        $("installButton").hidden = true;
      });
    });
    window.addEventListener("appinstalled", function () {
      state.installPrompt = null;
      $("installButton").hidden = true;
    });
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("./sw.js").catch(function () {
        // The form still works normally when installation is unavailable.
      });
    }
  }

  function handleSubmit(event) {
    event.preventDefault();
    var submit = $("submitButton");
    var reference = $("referenceInput").value.trim();
    var citizenName = $("citizenNameInput").value.trim();
    var phone = $("phoneInput").value.trim();

    if (!state.photoDataUrl) {
      setMessage("Inclua uma foto para enviar.", "error");
      return;
    }

    if (!state.location && reference.length < 4) {
      setMessage("Use o GPS ou informe uma referencia.", "error");
      return;
    }

    submit.disabled = true;
    setMessage("Enviando denuncia...");

    postApi({
      action: "create_report",
      category: getSelectedCategory(),
      citizenName: citizenName,
      phone: phone,
      reference: reference,
      latitude: state.location ? state.location.latitude : "",
      longitude: state.location ? state.location.longitude : "",
      accuracy: state.location ? state.location.accuracy : "",
      photoName: state.photoName,
      photoMime: state.photoMime,
      photoDataUrl: state.photoDataUrl,
      userAgent: navigator.userAgent || ""
    }).then(function (result) {
      if (!result || !result.ok) {
        throw new Error((result && result.error) || "Nao foi possivel enviar.");
      }
      showReceipt(result.report || {});
    }).catch(function (error) {
      setMessage(error.message || "Erro ao enviar.", "error");
    }).finally(function () {
      submit.disabled = false;
    });
  }

  function boot() {
    $("photoButton").addEventListener("click", function () { $("photoInput").click(); });
    $("photoInput").addEventListener("change", function (event) {
      handlePhoto(event.target.files && event.target.files[0]);
    });
    $("locationButton").addEventListener("click", requestLocation);
    $("reportForm").addEventListener("submit", handleSubmit);
    $("shareReceiptButton").addEventListener("click", shareReceipt);
    $("newReportButton").addEventListener("click", startNewReport);
    setupInstallation();

    if (!hasApi()) {
      setMessage("Modo demonstracao local. Configure a URL do Apps Script antes de publicar.");
    }
  }

  document.addEventListener("DOMContentLoaded", boot);
}());
