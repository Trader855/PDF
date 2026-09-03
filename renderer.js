import * as pdfjsLib from './node_modules/pdfjs-dist/build/pdf.mjs';
const MAX_PDF_SCALE = 1.5;
const THUMBNAIL_WIDTH = 145;
const TOMORROW_NOW_URL = "https://www.tomorrownow.tech";
const appBridge = window.desktopAPI || null;
let pendingPasswordInsert = null;
let thumbnailObserver = null;
const thumbnailTasks = new Set();
let pdfLoadingTask = null;

const filePaths = Object.freeze({
  normalize(value) {
    const source = String(value || "");
    const absolute = source.startsWith("/");
    const parts = [];
    source.split("/").forEach((part) => {
      if (!part || part === ".") return;
      if (part === "..") parts.pop();
      else parts.push(part);
    });
    return `${absolute ? "/" : ""}${parts.join("/")}` || (absolute ? "/" : ".");
  },
  basename(value) {
    const normalized = this.normalize(value).replace(/\/$/, "");
    return normalized.slice(normalized.lastIndexOf("/") + 1);
  },
  dirname(value) {
    const normalized = this.normalize(value).replace(/\/$/, "");
    const index = normalized.lastIndexOf("/");
    if (index < 0) return ".";
    return index === 0 ? "/" : normalized.slice(0, index);
  },
  parse(value) {
    const base = this.basename(value);
    const dot = base.lastIndexOf(".");
    const hasExtension = dot > 0;
    return {
      base,
      name: hasExtension ? base.slice(0, dot) : base,
      ext: hasExtension ? base.slice(dot) : "",
    };
  },
  join(...parts) {
    return this.normalize(parts.filter(Boolean).join("/"));
  },
  resolve(value) {
    return this.normalize(value);
  },
});

if (pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = "node_modules/pdfjs-dist/build/pdf.worker.mjs";
}

const ui = {
  openButton: document.querySelector("#open-pdf"),
  unlockButton: document.querySelector("#unlock-pdf"),
  unlockDialog: document.querySelector("#unlock-dialog"),
  unlockForm: document.querySelector("#unlock-form"),
  unlockPassword: document.querySelector("#unlock-password"),
  unlockMessage: document.querySelector("#unlock-message"),
  fileInput: document.querySelector("#pdf-file-input"),
  fileName: document.querySelector("#file-name"),
  previousButton: document.querySelector("#previous-page"),
  nextButton: document.querySelector("#next-page"),
  pageIndicator: document.querySelector("#page-indicator"),
  zoomIndicator: document.querySelector("#zoom-indicator"),
  pageCount: document.querySelector("#page-count"),
  thumbnailsTitle: document.querySelector("#thumbnails-title"),
  thumbnails: document.querySelector("#thumbnails"),
  workspace: document.querySelector("#main-workspace"),
  dropZone: document.querySelector("#drop-zone"),
  stage: document.querySelector("#pdf-stage"),
  canvas: document.querySelector("#pdf-render"),
  searchOverlay: document.querySelector("#search-overlay"),
  overlay: document.querySelector("#text-box-overlay"),
  mediaOverlay: document.querySelector("#media-overlay"),
  annotationOverlay: document.querySelector("#annotation-overlay"),
  formOverlay: document.querySelector("#form-overlay"),
  undoButton: document.querySelector("#undo-action"),
  redoButton: document.querySelector("#redo-action"),
  rotatePageButton: document.querySelector("#rotate-page"),
  duplicatePageButton: document.querySelector("#duplicate-page"),
  extractPageButton: document.querySelector("#extract-page"),
  deletePageButton: document.querySelector("#delete-page"),
  editButton: document.querySelector("#edit-mode"),
  addTextButton: document.querySelector("#add-text-mode"),
  insertPdfButton: document.querySelector("#insert-pdf"),
  insertPdfInput: document.querySelector("#insert-pdf-input"),
  signatureButton: document.querySelector("#signature-mode"),
  signatureDialog: document.querySelector("#signature-dialog"),
  signatureTypedTab: document.querySelector("#signature-typed-tab"),
  signatureDrawTab: document.querySelector("#signature-draw-tab"),
  signatureTypedPanel: document.querySelector("#signature-typed-panel"),
  signatureDrawPanel: document.querySelector("#signature-draw-panel"),
  signatureName: document.querySelector("#signature-name"),
  signatureTypedPreview: document.querySelector("#signature-typed-preview"),
  signatureCanvas: document.querySelector("#signature-canvas"),
  clearSignature: document.querySelector("#clear-signature"),
  useSignature: document.querySelector("#use-signature"),
  imageButton: document.querySelector("#image-mode"),
  imageInput: document.querySelector("#image-file-input"),
  annotationButton: document.querySelector("#annotation-mode"),
  checkUpdatesButton: document.querySelector("#check-updates"),
  tomorrowNowBanner: document.querySelector("#tomorrow-now-banner"),
  updateBadge: document.querySelector("#update-badge"),
  updateLabel: document.querySelector("#update-label"),
  updateDialog: document.querySelector("#update-dialog"),
  updateTitle: document.querySelector("#update-title"),
  updateDescription: document.querySelector("#update-description"),
  updateVersionRow: document.querySelector("#update-version-row"),
  updateCurrentVersion: document.querySelector("#update-current-version"),
  updateLatestVersion: document.querySelector("#update-latest-version"),
  updateNotes: document.querySelector("#update-notes"),
  updateProgress: document.querySelector("#update-progress"),
  updateProgressTrack: document.querySelector(".update-progress-track"),
  updateProgressBar: document.querySelector("#update-progress-bar"),
  updateProgressLabel: document.querySelector("#update-progress-label"),
  updateLaterButton: document.querySelector("#update-later"),
  downloadUpdateButton: document.querySelector("#download-update"),
  installUpdateButton: document.querySelector("#install-update"),
  moreToolsButton: document.querySelector("#more-tools"),
  toolsMenu: document.querySelector("#tools-menu"),
  formsButton: document.querySelector("#forms-mode"),
  compressButton: document.querySelector("#compress-pdf"),
  ocrButton: document.querySelector("#ocr-pdf"),
  saveButton: document.querySelector("#save-pdf"),
  inspectorIcon: document.querySelector("#inspector-icon"),
  inspectorTitle: document.querySelector("#inspector-title"),
  textProperties: document.querySelector("#text-properties"),
  mediaProperties: document.querySelector("#media-properties"),
  mediaDescription: document.querySelector("#media-description"),
  annotationProperties: document.querySelector("#annotation-properties"),
  annotationColor: document.querySelector("#annotation-color"),
  annotationWidth: document.querySelector("#annotation-width"),
  annotationOpacity: document.querySelector("#annotation-opacity"),
  annotationOpacityValue: document.querySelector("#annotation-opacity-value"),
  formProperties: document.querySelector("#form-properties"),
  formDescription: document.querySelector("#form-description"),
  formFieldName: document.querySelector("#form-field-name"),
  formFieldLabel: document.querySelector("#form-field-label"),
  formFieldChoices: document.querySelector("#form-field-choices"),
  formChoiceOptions: document.querySelector("#form-choice-options"),
  startFormField: document.querySelector("#start-form-field"),
  savedMarks: document.querySelector("#saved-marks"),
  processDialog: document.querySelector("#process-dialog"),
  processForm: document.querySelector("#process-form"),
  processTitle: document.querySelector("#process-title"),
  processDescription: document.querySelector("#process-description"),
  compressionOptions: document.querySelector("#compression-options"),
  ocrOptions: document.querySelector("#ocr-options"),
  runProcessButton: document.querySelector("#run-process"),
  findBar: document.querySelector("#find-bar"),
  findInput: document.querySelector("#find-input"),
  findCount: document.querySelector("#find-count"),
  findPreviousButton: document.querySelector("#find-previous"),
  findNextButton: document.querySelector("#find-next"),
  findCloseButton: document.querySelector("#find-close"),
  selectionHelp: document.querySelector("#selection-help"),
  selectedText: document.querySelector("#selected-text"),
  selectedFont: document.querySelector("#selected-font"),
  fontPickerToggle: document.querySelector("#font-picker-toggle"),
  fontOptions: document.querySelector("#font-options"),
  selectedSize: document.querySelector("#selected-size"),
  coherentButton: document.querySelector("#coherent-edit"),
  coherentDialog: document.querySelector("#coherent-dialog"),
  coherentSummary: document.querySelector("#coherent-summary"),
  coherentOldText: document.querySelector("#coherent-old-text"),
  coherentNewText: document.querySelector("#coherent-new-text"),
  coherentSelectAll: document.querySelector("#coherent-select-all"),
  coherentCount: document.querySelector("#coherent-count"),
  coherentMatchList: document.querySelector("#coherent-match-list"),
  applyCoherentButton: document.querySelector("#apply-coherent-edit"),
  applyButton: document.querySelector("#apply-edit"),
  status: document.querySelector("#status"),
};

const state = {
  pdf: null,
  originalPath: "",
  workingPath: "",
  originalName: "",
  pageNumber: 1,
  selectedSpan: null,
  pendingEditOrigin: null,
  pendingAddition: null,
  inlineEditor: null,
  currentSpans: [],
  renderTask: null,
  renderVersion: 0,
  thumbnailVersion: 0,
  backendReady: false,
  fontCatalog: new Map(),
  fontNames: [],
  loadedPreviewFonts: new Map(),
  applyingEdit: false,
  editMode: false,
  activeTool: null,
  pageScale: MAX_PDF_SCALE,
  lockedPath: "",
  lockedName: "",
  encrypted: false,
  pendingInsertAt: null,
  draggingPage: null,
  mediaDraft: null,
  signatureMode: "typed",
  signatureHasInk: false,
  undoStack: [],
  redoStack: [],
  annotationKind: "highlight",
  annotationDraft: null,
  formFields: [],
  formKind: "text",
  formDraft: null,
  formCreating: false,
  coherentMatches: [],
  coherentOriginalText: "",
  coherentReplacementText: "",
  processKind: null,
  currentViewport: null,
  pdfPageHeight: 0,
  updateStatus: null,
  searchQuery: "",
  searchMatches: [],
  searchIndex: -1,
  searchRequestVersion: 0,
};

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const activePdfPath = () => state.workingPath || state.originalPath;

function openUpdateDialog() {
  if (!ui.updateDialog.open) ui.updateDialog.showModal();
}

function formatDownloadSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function renderUpdateStatus(status) {
  if (!status?.phase) return;
  state.updateStatus = status;

  const phase = status.phase;
  const shouldOpen = status.manual || ["available", "downloading", "downloaded"].includes(phase);
  const hasUpdate = ["available", "downloaded"].includes(phase);
  ui.updateBadge.classList.toggle("hidden", !hasUpdate);
  ui.updateLabel.classList.toggle("hidden", !hasUpdate);
  ui.checkUpdatesButton.classList.toggle("has-update", hasUpdate);
  ui.checkUpdatesButton.setAttribute("aria-label", hasUpdate ? "Aggiornamento disponibile" : "Controlla aggiornamenti");
  ui.checkUpdatesButton.title = hasUpdate ? "Aggiornamento disponibile: clicca per i dettagli" : "Controlla aggiornamenti";
  ui.updateVersionRow.classList.toggle("hidden", !["available", "downloading", "downloaded"].includes(phase));
  ui.updateNotes.classList.add("hidden");
  ui.updateProgress.classList.add("hidden");
  ui.downloadUpdateButton.classList.add("hidden");
  ui.installUpdateButton.classList.add("hidden");
  ui.downloadUpdateButton.disabled = false;
  ui.installUpdateButton.disabled = false;
  ui.updateLaterButton.textContent = ["up-to-date", "development", "error"].includes(phase) ? "Chiudi" : "Più tardi";
  ui.updateCurrentVersion.textContent = status.currentVersion || "—";
  ui.updateLatestVersion.textContent = status.latestVersion || "—";

  if (phase === "checking") {
    ui.updateTitle.textContent = "Controllo aggiornamenti";
    ui.updateDescription.textContent = "Cerco una versione più recente su GitHub…";
  } else if (phase === "available") {
    ui.updateTitle.textContent = "È disponibile un aggiornamento";
    ui.updateDescription.textContent = `Mac PDF Editor ${status.latestVersion || ""} è pronto per essere scaricato.`;
    ui.downloadUpdateButton.classList.remove("hidden");
    if (status.releaseNotes) {
      ui.updateNotes.textContent = status.releaseNotes;
      ui.updateNotes.classList.remove("hidden");
    }
  } else if (phase === "downloading") {
    const percent = Math.max(0, Math.min(100, Number(status.percent) || 0));
    const transferred = formatDownloadSize(Number(status.transferred));
    const total = formatDownloadSize(Number(status.total));
    ui.updateTitle.textContent = "Download in corso";
    ui.updateDescription.textContent = "Puoi continuare a usare il programma durante il download.";
    ui.updateProgress.classList.remove("hidden");
    ui.updateProgressBar.style.width = `${percent}%`;
    ui.updateProgressTrack.setAttribute("aria-valuenow", String(Math.round(percent)));
    ui.updateProgressLabel.textContent = `${Math.round(percent)}%${transferred && total ? ` · ${transferred} di ${total}` : ""}`;
  } else if (phase === "downloaded") {
    ui.updateTitle.textContent = "Aggiornamento pronto";
    ui.updateDescription.textContent = "Il download è terminato. Salva eventuali modifiche, poi riavvia per installarlo.";
    ui.installUpdateButton.classList.remove("hidden");
  } else if (phase === "up-to-date") {
    ui.updateTitle.textContent = "Sei già aggiornato";
    ui.updateDescription.textContent = `Mac PDF Editor ${status.currentVersion || ""} è la versione più recente.`;
  } else if (phase === "development") {
    ui.updateTitle.textContent = "Aggiornamenti pronti";
    ui.updateDescription.textContent = "Il controllo reale sarà attivo nella versione installata e firmata dell’app. In modalità sviluppo è stato disattivato.";
  } else if (phase === "error") {
    ui.updateTitle.textContent = "Controllo non riuscito";
    ui.updateDescription.textContent = status.error || "Non è stato possibile contattare il server degli aggiornamenti. Riprova più tardi.";
  }

  if (shouldOpen) openUpdateDialog();
}

function backendPointToCss(point) {
  if (!state.currentViewport) return [point[0] * state.pageScale, point[1] * state.pageScale];
  return state.currentViewport.convertToViewportPoint(point[0], state.pdfPageHeight - point[1]);
}

function cssPointToBackend(point) {
  if (!state.currentViewport) return [point[0] / state.pageScale, point[1] / state.pageScale];
  const [x, pdfY] = state.currentViewport.convertToPdfPoint(point[0], point[1]);
  return [x, state.pdfPageHeight - pdfY];
}

function backendRectToCss(rect) {
  const corners = [
    backendPointToCss([rect[0], rect[1]]), backendPointToCss([rect[2], rect[1]]),
    backendPointToCss([rect[0], rect[3]]), backendPointToCss([rect[2], rect[3]]),
  ];
  const xs = corners.map((point) => point[0]);
  const ys = corners.map((point) => point[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

function updateSearchControls() {
  const total = state.searchMatches.length;
  const current = total && state.searchIndex >= 0 ? state.searchIndex + 1 : 0;
  ui.findCount.textContent = `${current} / ${total}`;
  ui.findPreviousButton.disabled = total === 0;
  ui.findNextButton.disabled = total === 0;
}

function renderSearchHighlights() {
  const fragment = document.createDocumentFragment();
  if (state.currentViewport) {
    state.searchMatches.forEach((match, index) => {
      if (Number(match.page_num) !== state.pageNumber - 1) return;
      if (!Array.isArray(match.bbox) || match.bbox.length !== 4) return;
      const rect = match.bbox.map(Number);
      if (!rect.every(Number.isFinite)) return;
      const [left, top, right, bottom] = backendRectToCss(rect);
      const highlight = document.createElement("i");
      highlight.className = `search-highlight${index === state.searchIndex ? " is-current" : ""}`;
      highlight.style.left = `${left}px`;
      highlight.style.top = `${top}px`;
      highlight.style.width = `${Math.max(2, right - left)}px`;
      highlight.style.height = `${Math.max(2, bottom - top)}px`;
      highlight.dataset.searchIndex = String(index);
      fragment.appendChild(highlight);
    });
  }
  ui.searchOverlay.replaceChildren(fragment);
}

function resetDocumentSearch({ close = false, clearInput = true } = {}) {
  state.searchRequestVersion += 1;
  state.searchQuery = "";
  state.searchMatches = [];
  state.searchIndex = -1;
  ui.searchOverlay.replaceChildren();
  if (clearInput) ui.findInput.value = "";
  if (close) ui.findBar.classList.add("hidden");
  updateSearchControls();
}

function openDocumentSearch() {
  ui.findBar.classList.remove("hidden");
  requestAnimationFrame(() => {
    ui.findInput.focus();
    ui.findInput.select();
  });
}

async function goToSearchMatch(index) {
  const total = state.searchMatches.length;
  if (!total) return;
  state.searchIndex = (index + total) % total;
  const match = state.searchMatches[state.searchIndex];
  updateSearchControls();

  const pageNumber = Number(match.page_num) + 1;
  if (pageNumber !== state.pageNumber) {
    await renderPage(pageNumber);
  } else {
    renderSearchHighlights();
  }

  requestAnimationFrame(() => {
    ui.searchOverlay.querySelector(`[data-search-index="${state.searchIndex}"]`)?.scrollIntoView({
      behavior: "smooth",
      block: "center",
      inline: "center",
    });
  });
  setStatus(`Risultato ${state.searchIndex + 1} di ${total} per “${state.searchQuery}”.`);
}

async function runDocumentSearch(rawQuery = ui.findInput.value) {
  const query = String(rawQuery || "").trim().replace(/\s+/g, " ");
  const requestVersion = ++state.searchRequestVersion;
  state.searchQuery = query;

  if (!query) {
    state.searchMatches = [];
    state.searchIndex = -1;
    renderSearchHighlights();
    updateSearchControls();
    return;
  }
  if (!state.pdf || !activePdfPath()) {
    state.searchMatches = [];
    state.searchIndex = -1;
    updateSearchControls();
    setStatus("Apri un PDF prima di cercare.", true);
    return;
  }

  ui.findCount.textContent = "Cerco…";
  ui.findPreviousButton.disabled = true;
  ui.findNextButton.disabled = true;
  const result = await apiRequest("/search-text", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_path: activePdfPath(), query }),
  });
  if (requestVersion !== state.searchRequestVersion) return;

  state.searchQuery = result.query || query;
  state.searchMatches = Array.isArray(result.matches) ? result.matches : [];
  state.searchIndex = state.searchMatches.length ? 0 : -1;
  updateSearchControls();

  if (state.searchMatches.length) {
    await goToSearchMatch(0);
    if (result.truncated) setStatus(`Mostro i primi ${state.searchMatches.length} risultati per “${state.searchQuery}”.`);
  } else {
    renderSearchHighlights();
    setStatus(`Nessun risultato per “${state.searchQuery}”.`);
  }
}

function cssRectToBackend(rect) {
  const corners = [
    cssPointToBackend([rect[0], rect[1]]), cssPointToBackend([rect[2], rect[1]]),
    cssPointToBackend([rect[0], rect[3]]), cssPointToBackend([rect[2], rect[3]]),
  ];
  const xs = corners.map((point) => point[0]);
  const ys = corners.map((point) => point[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

function updateHistoryButtons() {
  ui.undoButton.disabled = state.undoStack.length === 0;
  ui.redoButton.disabled = state.redoStack.length === 0;
}

function commitMutation(outputPath) {
  const previousPath = activePdfPath();
  if (previousPath && previousPath !== outputPath) state.undoStack.push(previousPath);
  state.redoStack = [];
  state.workingPath = outputPath;
  resetDocumentSearch({ close: true });
  ui.saveButton.disabled = false;
  updateHistoryButtons();
}

async function navigateHistory(direction) {
  const source = direction === "undo" ? state.undoStack : state.redoStack;
  const destination = direction === "undo" ? state.redoStack : state.undoStack;
  if (!source.length || !state.pdf) return;
  const currentPath = activePdfPath();
  const targetPath = source.pop();
  if (currentPath) destination.push(currentPath);
  state.workingPath = targetPath;
  updateHistoryButtons();
  await reloadWorkingCopy(state.pageNumber);
  ui.saveButton.disabled = false;
  setStatus(direction === "undo" ? "Ultima operazione annullata." : "Operazione ripristinata.");
}

function setStatus(message = "", isError = false) {
  ui.status.textContent = message;
  ui.status.classList.toggle("error", isError);
}

async function ensureBackend() {
  if (state.backendReady) return;

  if (!appBridge) {
    throw new Error("il backend locale è disponibile soltanto nell’app Mac installata");
  }
  await appBridge.request('/health');
  state.backendReady = true;
}

async function apiRequest(endpoint, options = {}) {
  await ensureBackend();
  try {
    return await appBridge.request(endpoint, options.body ? JSON.parse(options.body) : null);
  } catch (error) {
    throw new Error(error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
  }
}

async function loadFontCatalog() {
  const result = await apiRequest("/fonts");
  const fonts = Array.isArray(result.fonts) ? result.fonts : [];
  const optionNames = new Set();
  state.fontCatalog.clear();

  fonts.forEach((font) => {
    if (!font?.label || !font?.id) return;
    state.fontCatalog.set(font.label, font);
    optionNames.add(font.label);
    if (font.style === "regular") {
      (font.aliases || []).forEach((alias) => optionNames.add(alias));
    }
  });

  state.fontNames = [...optionNames].sort((left, right) => left.localeCompare(right, "it"));
  renderFontOptions();
}

function renderFontOptions(filter = "") {
  const normalizedFilter = filter.trim().toLocaleLowerCase("it");
  const names = normalizedFilter
    ? state.fontNames.filter((name) => name.toLocaleLowerCase("it").includes(normalizedFilter))
    : state.fontNames;

  if (!names.length) {
    const empty = document.createElement("div");
    empty.className = "font-picker-empty";
    empty.textContent = state.fontNames.length ? "Nessun carattere trovato" : "Catalogo caratteri non disponibile";
    ui.fontOptions.replaceChildren(empty);
    return;
  }

  const selectedName = ui.selectedFont.value.trim();
  ui.fontOptions.replaceChildren(...names.map((name) => {
    const option = document.createElement("button");
    option.type = "button";
    option.className = "font-picker-option";
    option.setAttribute("role", "option");
    option.setAttribute("aria-selected", String(name === selectedName));
    option.classList.toggle("is-selected", name === selectedName);
    option.textContent = name;
    option.dataset.fontName = name;
    return option;
  }));
}

function openFontPicker(filter = "") {
  if (ui.selectedFont.disabled) return;
  renderFontOptions(filter);
  ui.fontOptions.classList.remove("hidden");
  ui.selectedFont.setAttribute("aria-expanded", "true");
}

function closeFontPicker() {
  ui.fontOptions.classList.add("hidden");
  ui.selectedFont.setAttribute("aria-expanded", "false");
}

async function previewSelectedFont() {
  if (!state.inlineEditor?.content) return;
  const requestedName = ui.selectedFont.value.trim();
  if (!requestedName) return;

  const catalogFont = state.fontCatalog.get(requestedName);
  if (catalogFont) {
    let previewFamily = state.loadedPreviewFonts.get(catalogFont.id);
    if (!previewFamily) {
      previewFamily = `MacPdf-${catalogFont.id}`;
      const fontFace = new FontFace(
        previewFamily,
        new Uint8Array(await appBridge.request(`/font-file/${catalogFont.id}`)),
      );
      await fontFace.load();
      document.fonts.add(fontFace);
      state.loadedPreviewFonts.set(catalogFont.id, previewFamily);
    }
    state.inlineEditor.content.style.fontFamily = `"${previewFamily}", sans-serif`;
  } else {
    const safeName = requestedName.replaceAll('"', "");
    state.inlineEditor.content.style.fontFamily = `"${safeName}", Helvetica, sans-serif`;
  }
  state.inlineEditor.content.style.fontWeight = /bold/i.test(requestedName) ? "700" : "400";
  state.inlineEditor.content.style.fontStyle = /italic|oblique/i.test(requestedName) ? "italic" : "normal";
}

function updateNavigation() {
  const totalPages = state.pdf?.numPages || 0;
  ui.pageIndicator.textContent = `${totalPages ? state.pageNumber : 0} / ${totalPages}`;
  ui.pageCount.textContent = String(totalPages);
  ui.previousButton.disabled = !totalPages || state.pageNumber <= 1;
  ui.nextButton.disabled = !totalPages || state.pageNumber >= totalPages;
  [ui.rotatePageButton, ui.duplicatePageButton, ui.extractPageButton, ui.deletePageButton].forEach((button) => {
    button.disabled = !totalPages;
  });
  if (ui.deletePageButton) ui.deletePageButton.disabled = totalPages <= 1;

  ui.thumbnails.querySelectorAll(".thumbnail-button").forEach((button) => {
    button.classList.toggle("is-active", Number(button.dataset.pageNumber) === state.pageNumber);
  });
}

function setToolButtonLabel(button, label) {
  const labelElement = button.querySelector("span");
  if (labelElement) labelElement.textContent = label;
}

function normalizedEditorText(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function updateCoherentButtonState() {
  const isEditableSelection = Boolean(
    state.selectedSpan
    && state.activeTool === "edit"
    && !ui.selectedText.disabled,
  );
  const originalText = normalizedEditorText(state.selectedSpan?.text);
  const replacementText = normalizedEditorText(currentInlineText());
  const hasTextChange = Boolean(originalText && originalText !== replacementText);

  ui.coherentButton.classList.toggle("hidden", !isEditableSelection);
  ui.coherentButton.disabled = !isEditableSelection || !hasTextChange || state.applyingEdit;
  ui.coherentButton.title = hasTextChange
    ? "Cerca lo stesso valore in tutto il documento"
    : "Modifica prima il testo per cercarlo nelle altre pagine";
}

function setEditorEnabled(enabled) {
  ui.selectedText.disabled = !enabled;
  ui.selectedFont.disabled = !enabled;
  ui.fontPickerToggle.disabled = !enabled;
  if (!enabled) closeFontPicker();
  ui.selectedSize.disabled = !enabled;
  ui.applyButton.disabled = !enabled || state.applyingEdit;
  updateCoherentButtonState();
}

function setInspectorMode(mode = "text") {
  const titles = {
    text: ["T", "Proprietà testo"],
    media: [state.activeTool === "signature" ? "✒" : "▧", state.activeTool === "signature" ? "Proprietà firma" : "Proprietà immagine"],
    annotation: ["✎", "Annotazioni"],
    form: ["▣", "Compila e crea campi"],
  };
  const [icon, title] = titles[mode] || titles.text;
  ui.inspectorIcon.textContent = icon;
  ui.inspectorTitle.textContent = title;
  ui.textProperties.classList.toggle("hidden", mode !== "text");
  ui.mediaProperties.classList.toggle("hidden", mode !== "media");
  ui.annotationProperties.classList.toggle("hidden", mode !== "annotation");
  ui.formProperties.classList.toggle("hidden", mode !== "form");
}

function clearMediaDraft() {
  state.mediaDraft = null;
  ui.mediaOverlay.replaceChildren();
}

function clearSelection() {
  state.selectedSpan = null;
  state.pendingEditOrigin = null;
  state.pendingAddition = null;
  if (state.inlineEditor?.wrapper) state.inlineEditor.wrapper.remove();
  state.inlineEditor = null;
  clearMediaDraft();
  state.annotationDraft = null;
  state.formFields = [];
  state.formDraft = null;
  state.formCreating = false;
  ui.annotationOverlay.replaceChildren();
  ui.annotationOverlay.classList.remove("is-active");
  ui.formOverlay.replaceChildren();
  ui.formOverlay.classList.remove("is-creating");
  ui.overlay.querySelectorAll(".is-selected").forEach((box) => {
    box.classList.remove("is-selected");
  });
  ui.selectedText.value = "";
  ui.selectedFont.value = "";
  ui.selectedSize.value = "";
  ui.selectionHelp.textContent = state.activeTool === "add"
    ? "Clicca nella pagina nel punto in cui vuoi aggiungere il testo."
    : "Clicca su un testo nella pagina.";
  ui.applyButton.textContent = "Applica Modifica";
  state.coherentMatches = [];
  state.coherentOriginalText = "";
  state.coherentReplacementText = "";
  setInspectorMode("text");
  setEditorEnabled(false);
}

function selectSpan(span, box) {
  ui.overlay.querySelectorAll(".is-selected").forEach((item) => {
    item.classList.remove("is-selected");
  });
  box.classList.add("is-selected");

  state.selectedSpan = span;
  state.pendingEditOrigin = Array.isArray(span.origin) ? [...span.origin] : null;
  state.pendingAddition = null;
  ui.selectedText.value = span.text || "";
  ui.selectedFont.value = span.font || "";
  ui.selectedSize.value = Number.isFinite(Number(span.size)) ? Number(span.size) : "";
  ui.selectionHelp.textContent = span.source === "ocr"
    ? `Pagina ${state.pageNumber} · testo riconosciuto dentro un'immagine`
    : `Pagina ${state.pageNumber} · font originale ${span.font || "non identificato"}`;
  ui.applyButton.textContent = "Applica Modifica";
  setEditorEnabled(true);
  createInlineTextEditor({
    kind: "edit",
    origin: state.pendingEditOrigin,
    span,
    text: span.text || "",
  });
  updateCoherentButtonState();
}

async function inspectCurrentPage() {
  if (!activePdfPath()) {
    throw new Error("hai aperto index.html in Chrome. Usa “Mac PDF Editor.app” per modificare e salvare il PDF");
  }

  const result = await apiRequest("/inspect-text", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      file_path: activePdfPath(),
      page_num: state.pageNumber - 1,
    }),
  });

  return Array.isArray(result.spans) ? result.spans : [];
}

function createTextOverlay(spans, viewport) {
  const fragment = document.createDocumentFragment();

  spans.forEach((span, index) => {
    if (!Array.isArray(span.bbox) || span.bbox.length < 4) return;
    const [x0, y0, x1, y1] = span.bbox.map(Number);
    if (![x0, y0, x1, y1].every(Number.isFinite)) return;

    const box = document.createElement("button");
    box.type = "button";
    box.className = "text-box";
    const [left, top, right, bottom] = backendRectToCss([x0, y0, x1, y1]);
    box.style.left = `${left}px`;
    box.style.top = `${top}px`;
    box.style.width = `${Math.max(2, right - left)}px`;
    box.style.height = `${Math.max(2, bottom - top)}px`;
    box.dataset.spanIndex = String(index);
    box.title = span.text || "";
    box.setAttribute("aria-label", span.text ? `Modifica testo: ${span.text}` : "Modifica testo");
    box.addEventListener("click", (event) => {
      event.stopPropagation();
      selectSpan(span, box);
    });
    fragment.appendChild(box);
  });

  ui.overlay.replaceChildren(fragment);
}

async function renderPage(pageNumber) {
  if (!state.pdf) return;

  const renderVersion = ++state.renderVersion;
  state.pageNumber = pageNumber;
  updateNavigation();
  clearSelection();
  ui.overlay.replaceChildren();
  setStatus(`Rendering pagina ${pageNumber}…`);

  if (state.renderTask) {
    const previous = state.renderTask;
    previous.cancel();
    state.renderTask = null;
    await previous.promise.catch(() => {});
  }

  const page = await state.pdf.getPage(pageNumber);
  if (renderVersion !== state.renderVersion) return;

  const baseViewport = page.getViewport({ scale: 1 });
  const availableWidth = Math.max(320, ui.workspace.clientWidth - 72);
  const deviceScale = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
  state.pageScale = Math.min(MAX_PDF_SCALE, availableWidth / baseViewport.width,
    Math.sqrt(12_000_000 / (baseViewport.width * baseViewport.height)) / deviceScale,
    16000 / Math.max(baseViewport.width, baseViewport.height) / deviceScale);
  const viewport = page.getViewport({ scale: state.pageScale });
  state.currentViewport = viewport;
  state.pdfPageHeight = Math.abs(Number(page.view?.[3]) - Number(page.view?.[1])) || baseViewport.height;
  ui.zoomIndicator.textContent = `${Math.round(state.pageScale * 100)}%`;
  const outputScale = deviceScale;
  const context = ui.canvas.getContext("2d", { alpha: false });

  ui.canvas.width = Math.ceil(viewport.width * outputScale);
  ui.canvas.height = Math.ceil(viewport.height * outputScale);
  ui.canvas.style.width = `${viewport.width}px`;
  ui.canvas.style.height = `${viewport.height}px`;
  ui.searchOverlay.style.width = `${viewport.width}px`;
  ui.searchOverlay.style.height = `${viewport.height}px`;
  ui.overlay.style.width = `${viewport.width}px`;
  ui.overlay.style.height = `${viewport.height}px`;
  ui.mediaOverlay.style.width = `${viewport.width}px`;
  ui.mediaOverlay.style.height = `${viewport.height}px`;
  ui.annotationOverlay.style.width = `${viewport.width}px`;
  ui.annotationOverlay.style.height = `${viewport.height}px`;
  ui.formOverlay.style.width = `${viewport.width}px`;
  ui.formOverlay.style.height = `${viewport.height}px`;
  ui.stage.style.width = `${viewport.width}px`;
  ui.stage.style.height = `${viewport.height}px`;

  const renderTask = page.render({
    canvasContext: context,
    viewport,
    transform: outputScale === 1 ? null : [outputScale, 0, 0, outputScale, 0, 0],
  });
  state.renderTask = renderTask;

  try {
    await renderTask.promise;
  } catch (error) {
    if (error?.name === "RenderingCancelledException") return;
    throw error;
  } finally {
    if (state.renderTask === renderTask) state.renderTask = null;
  }

  if (renderVersion !== state.renderVersion) return;
  renderSearchHighlights();

  if (!state.editMode) {
    setStatus("PDF caricato. Scegli uno strumento per iniziare.");
    return;
  }

  if (state.activeTool === "image" || state.activeTool === "signature") {
    setInspectorMode("media");
    ui.selectionHelp.textContent = state.activeTool === "signature"
      ? "Crea una nuova firma dalla barra strumenti per inserirla nella pagina."
      : "Scegli una nuova immagine dalla barra strumenti per inserirla nella pagina.";
    setStatus(state.activeTool === "signature"
      ? "Crea la firma, poi trascinala e ridimensionala sulla pagina."
      : "Scegli un'immagine, poi trascinala e ridimensionala sulla pagina.");
    return;
  }

  if (state.activeTool === "annotation") {
    setInspectorMode("annotation");
    ui.annotationOverlay.classList.add("is-active");
    ui.selectionHelp.textContent = "Disegna direttamente sulla pagina, poi applica l'annotazione.";
    ui.applyButton.textContent = "Applica Annotazione";
    ui.applyButton.disabled = true;
    setStatus("Scegli evidenziatore, penna, freccia o rettangolo e disegna sulla pagina.");
    return;
  }

  if (state.activeTool === "form") {
    setInspectorMode("form");
    await renderFormFields(viewport);
    return;
  }

  setStatus("Analisi del testo…");
  const spans = await inspectCurrentPage();
  if (renderVersion !== state.renderVersion) return;

  state.currentSpans = spans;
  if (state.activeTool === "add") {
    ui.overlay.replaceChildren();
    setStatus("Clicca nel punto della pagina in cui vuoi aggiungere il nuovo testo.");
  } else {
    createTextOverlay(spans, viewport);
    const ocrCount = spans.filter((span) => span.source === "ocr").length;
    setStatus(spans.length
      ? `${spans.length} elementi modificabili rilevati${ocrCount ? `, inclusi ${ocrCount} dentro immagini` : ""}.`
      : "Nessun testo modificabile in questa pagina.");
  }
}

async function renderThumbnails() {
  const thumbnailVersion = ++state.thumbnailVersion;
  thumbnailObserver?.disconnect();
  for (const task of thumbnailTasks) task.cancel();
  thumbnailTasks.clear();
  const pdf = state.pdf;
  let renderQueue = Promise.resolve();
  const visible = new Set();
  const cached = new Map();
  thumbnailObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const button = entry.target;
      if (!entry.isIntersecting) { visible.delete(button); continue; }
      visible.add(button);
      if (button.dataset.ready || button.dataset.queued) continue;
      button.dataset.queued = '1';
      renderQueue = renderQueue.then(async () => {
        if (thumbnailVersion !== state.thumbnailVersion || !visible.has(button)) return;
        const canvas = button.querySelector('canvas');
        const page = await pdf.getPage(Number(button.dataset.pageNumber));
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: Math.min(THUMBNAIL_WIDTH / base.width, 220 / base.height) });
        canvas.width = Math.ceil(viewport.width * 2);
        canvas.height = Math.ceil(viewport.height * 2);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        const task = page.render({ canvasContext: canvas.getContext('2d', { alpha: false }), viewport, transform: [2, 0, 0, 2, 0, 0] });
        thumbnailTasks.add(task);
        try { await task.promise; } finally { thumbnailTasks.delete(task); }
        button.dataset.ready = '1';
        cached.set(button, canvas);
        for (const [oldButton, oldCanvas] of cached) {
          if (cached.size <= 20) break;
          if (visible.has(oldButton)) continue;
          oldCanvas.width = 1; oldCanvas.height = 1;
          delete oldButton.dataset.ready;
          cached.delete(oldButton);
        }
      }).catch((error) => {
        if (error.name !== 'RenderingCancelledException' && thumbnailVersion === state.thumbnailVersion) console.warn('Miniatura non disponibile');
      }).finally(() => { delete button.dataset.queued; });
    }
  }, { root: ui.thumbnails, rootMargin: '300px' });
  ui.thumbnails.replaceChildren();
  ui.thumbnailsTitle.classList.remove("hidden");

  const appendInsertControl = (insertAt) => {
    const insertButton = document.createElement("button");
    insertButton.type = "button";
    insertButton.className = "thumbnail-insert";
    insertButton.textContent = "+ PDF";
    insertButton.title = `Inserisci un PDF in posizione ${insertAt + 1}`;
    insertButton.setAttribute("aria-label", `Inserisci PDF prima della pagina ${insertAt + 1}`);
    insertButton.addEventListener("click", () => {
      state.pendingInsertAt = insertAt;
      ui.insertPdfInput.click();
    });
    ui.thumbnails.appendChild(insertButton);
  };

  appendInsertControl(0);

  for (let pageNumber = 1; pageNumber <= state.pdf.numPages; pageNumber += 1) {
    if (thumbnailVersion !== state.thumbnailVersion) return;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "thumbnail-button";
    button.dataset.pageNumber = String(pageNumber);
    button.draggable = true;
    button.setAttribute("aria-label", `Vai a pagina ${pageNumber}`);

    const canvas = document.createElement("canvas");
    canvas.width = 1; canvas.height = 1;
    canvas.style.width = `${THUMBNAIL_WIDTH}px`;
    canvas.style.height = '200px';
    const label = document.createElement("span");
    label.className = "thumbnail-number";
    label.textContent = String(pageNumber);
    button.append(canvas, label);
    button.addEventListener("click", () => {
      renderPage(pageNumber).catch((error) => setStatus(error.message, true));
    });
    button.addEventListener("dragstart", (event) => {
      state.draggingPage = pageNumber;
      button.classList.add("is-dragging");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", String(pageNumber));
    });
    button.addEventListener("dragend", () => {
      state.draggingPage = null;
      button.classList.remove("is-dragging");
      ui.thumbnails.querySelectorAll(".drop-before,.drop-after").forEach((item) => item.classList.remove("drop-before", "drop-after"));
    });
    button.addEventListener("dragover", (event) => {
      if (!state.draggingPage) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      const after = event.clientY > button.getBoundingClientRect().top + button.offsetHeight / 2;
      button.classList.toggle("drop-before", !after);
      button.classList.toggle("drop-after", after);
    });
    button.addEventListener("dragleave", () => button.classList.remove("drop-before", "drop-after"));
    button.addEventListener("drop", (event) => {
      event.preventDefault();
      const sourcePage = state.draggingPage;
      const after = event.clientY > button.getBoundingClientRect().top + button.offsetHeight / 2;
      button.classList.remove("drop-before", "drop-after");
      if (sourcePage) reorderPage(sourcePage, pageNumber, after).catch((error) => setStatus(`Riordino non riuscito: ${error.message}`, true));
    });
    ui.thumbnails.appendChild(button);
    appendInsertControl(pageNumber);
    updateNavigation();

    thumbnailObserver.observe(button);
  }
}

async function loadPdfData(pdfData) {
  state.renderVersion += 1;
  state.thumbnailVersion += 1;
  thumbnailObserver?.disconnect();
  for (const task of thumbnailTasks) task.cancel();
  if (state.renderTask) state.renderTask.cancel();
  if (pdfLoadingTask) await pdfLoadingTask.destroy();
  pdfLoadingTask = null;
  state.pdf = null;

  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(pdfData), isEvalSupported: false,
    maxImageSize: 12_000_000, canvasMaxAreaInBytes: 48_000_000,
    cMapUrl: 'node_modules/pdfjs-dist/cmaps/', cMapPacked: true,
    standardFontDataUrl: 'node_modules/pdfjs-dist/standard_fonts/', wasmUrl: 'node_modules/pdfjs-dist/wasm/' });
  pdfLoadingTask = loadingTask;
  state.pdf = await loadingTask.promise;
}

async function openPdf(filePath, file = null) {
  if (!pdfjsLib) {
    throw new Error("PDF.js non è disponibile: installa le dipendenze o verifica la connessione alla CDN");
  }
  if (!filePath && !file) throw new Error("File PDF non disponibile");

  setStatus("Apertura del PDF…");
  let pdfInfo = { needs_password: false, is_encrypted: false };
  if (filePath) {
    pdfInfo = await apiRequest("/pdf-info", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file_path: filePath }),
    });
  }

  if (pdfInfo.needs_password) {
    if (pdfLoadingTask) await pdfLoadingTask.destroy();
    pdfLoadingTask = null;
    state.pdf = null;
    state.undoStack = [];
    state.redoStack = [];
    updateHistoryButtons();
    state.originalPath = filePath;
    state.workingPath = "";
    state.originalName = file?.name || filePaths.basename(filePath);
    state.lockedPath = filePath;
    state.lockedName = state.originalName;
    state.encrypted = true;
    resetDocumentSearch({ close: true });
    ui.fileName.textContent = state.originalName;
    ui.fileName.title = filePath;
    ui.unlockButton.disabled = false;
    ui.editButton.disabled = true;
    ui.addTextButton.disabled = true;
    ui.insertPdfButton.disabled = true;
    ui.signatureButton.disabled = true;
    ui.imageButton.disabled = true;
    ui.annotationButton.disabled = true;
    ui.moreToolsButton.disabled = true;
    ui.saveButton.disabled = true;
    ui.thumbnails.replaceChildren();
    ui.stage.classList.add("hidden");
    ui.dropZone.classList.remove("hidden");
    ui.dropZone.querySelector("strong").textContent = "PDF protetto da password";
    ui.dropZone.querySelector("span").textContent = "Premi “Sblocca” e inserisci la password per lavorare su una copia";
    updateNavigation();
    setStatus("Il documento è protetto. Inserisci la password per sbloccare una copia.");
    showUnlockDialog(true);
    return;
  }

  let pdfData;
  if (file) {
    pdfData = new Uint8Array(await file.arrayBuffer());
  } else if (appBridge) {
    pdfData = new Uint8Array(await appBridge.readFile(filePath));
  } else {
    throw new Error("Impossibile leggere il file senza Electron");
  }

  await loadPdfData(pdfData);
  state.originalPath = filePath;
  state.workingPath = "";
  state.originalName = file?.name || filePaths.basename(filePath);
  state.pageNumber = 1;
  state.editMode = false;
  state.activeTool = null;
  state.currentSpans = [];
  state.undoStack = [];
  state.redoStack = [];
  state.lockedPath = "";
  state.lockedName = "";
  state.encrypted = Boolean(pdfInfo.is_encrypted);
  resetDocumentSearch({ close: true });

  ui.fileName.textContent = state.originalName;
  ui.fileName.title = filePath;
  ui.editButton.disabled = false;
  ui.editButton.classList.remove("is-active");
  setToolButtonLabel(ui.editButton, "Modifica testo");
  ui.addTextButton.disabled = false;
  ui.addTextButton.classList.remove("is-active");
  ui.signatureButton.classList.remove("is-active");
  ui.imageButton.classList.remove("is-active");
  ui.annotationButton.classList.remove("is-active");
  ui.annotationButton.classList.remove("is-active");
  clearMediaDraft();
  ui.stage.classList.remove("is-adding-text");
  ui.insertPdfButton.disabled = false;
  ui.signatureButton.disabled = false;
  ui.imageButton.disabled = false;
  ui.annotationButton.disabled = false;
  ui.moreToolsButton.disabled = false;
  ui.unlockButton.disabled = !state.encrypted;
  ui.saveButton.disabled = true;
  ui.dropZone.classList.add("hidden");
  ui.dropZone.querySelector("strong").textContent = "Trascina qui il tuo PDF";
  ui.dropZone.querySelector("span").textContent = "oppure usa “Apri PDF” nella barra superiore";
  ui.stage.classList.remove("hidden");
  updateNavigation();
  updateHistoryButtons();
  renderThumbnails().catch((error) => console.warn("Miniature non disponibili:", error));
  await renderPage(1);
}

async function reloadWorkingCopy(pageNumber) {
  resetDocumentSearch({ close: true });
  if (!appBridge) throw new Error("Impossibile leggere la copia locale senza Electron");
  const pdfData = new Uint8Array(await appBridge.readFile(state.workingPath));
  await loadPdfData(pdfData);
  state.pageNumber = Math.min(pageNumber, state.pdf.numPages);
  renderThumbnails().catch((error) => console.warn("Miniature non disponibili:", error));
  await renderPage(state.pageNumber);
}

async function reorderPage(sourcePage, targetPage, afterTarget) {
  if (!state.pdf || sourcePage === targetPage && !afterTarget) return;
  const order = Array.from({ length: state.pdf.numPages }, (_, index) => index);
  const sourceIndex = sourcePage - 1;
  let insertionIndex = (targetPage - 1) + (afterTarget ? 1 : 0);
  const [moved] = order.splice(sourceIndex, 1);
  if (sourceIndex < insertionIndex) insertionIndex -= 1;
  insertionIndex = Math.max(0, Math.min(order.length, insertionIndex));
  order.splice(insertionIndex, 0, moved);
  if (order.every((pageIndex, index) => pageIndex === index)) return;

  setStatus("Riordino delle pagine…");
  const result = await apiRequest("/reorder-pages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      file_path: activePdfPath(),
      output_path: null,
      order,
    }),
  });
  commitMutation(result.output_path);
  await reloadWorkingCopy(insertionIndex + 1);
  ui.saveButton.disabled = false;
  setStatus("Ordine delle pagine aggiornato. Trascina un'altra miniatura o salva la copia.");
}

async function insertPdfAt(filePath, insertAt, password = null) {
  if (!filePath) throw new Error("percorso del PDF da inserire non disponibile");
  setStatus("Inserimento delle pagine…");
  let result;
  try {
    result = await apiRequest("/insert-pdf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        file_path: activePdfPath(),
        output_path: null,
        insert_file_path: filePath,
        insert_at: insertAt,
        insert_password: password,
      }),
    });
  } catch (error) {
    if (!password && /richiede una password/i.test(error.message)) {
      pendingPasswordInsert = { filePath, insertAt };
      showUnlockDialog(true);
      ui.unlockMessage.textContent = 'Il PDF da inserire è protetto. Inserisci la sua password.';
      return;
    }
    throw error;
  }
  commitMutation(result.output_path);
  const firstInsertedPage = Math.min(insertAt + 1, result.page_count);
  await reloadWorkingCopy(firstInsertedPage);
  ui.saveButton.disabled = false;
  setStatus(`${result.inserted_count} ${result.inserted_count === 1 ? "pagina inserita" : "pagine inserite"}.`);
}

function openPdfSafely(filePath, file = null) {
  openPdf(filePath, file).then(() => {
    if (filePath) return appBridge.pruneSession([filePath]);
  }).catch((error) => {
    console.error(error);
    setStatus(`Errore: ${error.message}`, true);
  });
}

function showUnlockDialog(passwordRequired = state.lockedPath !== "") {
  ui.unlockMessage.textContent = passwordRequired
    ? "Inserisci la password. Verrà creata una copia modificabile e l'originale resterà intatto."
    : "Verrà creata una copia senza protezioni. L'originale resterà intatto.";
  ui.unlockPassword.value = "";
  ui.unlockPassword.closest(".field").classList.toggle("hidden", !passwordRequired);
  ui.unlockDialog.showModal();
  if (passwordRequired) requestAnimationFrame(() => ui.unlockPassword.focus());
}

async function unlockCurrentPdf(password = "") {
  const sourcePath = state.lockedPath || activePdfPath();
  if (!sourcePath) throw new Error("apri prima un PDF protetto");
  const originalPath = state.lockedPath || state.originalPath;
  const originalName = state.lockedName || state.originalName;
  setStatus("Creazione della copia sbloccata…");
  const result = await apiRequest("/unlock-pdf", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_path: sourcePath, password, output_path: null }),
  });
  await openPdf(result.output_path);
  state.originalPath = originalPath;
  state.originalName = originalName;
  state.workingPath = result.output_path;
  state.lockedPath = "";
  state.lockedName = "";
  state.encrypted = false;
  ui.fileName.textContent = originalName;
  ui.fileName.title = originalPath;
  ui.unlockButton.disabled = true;
  ui.saveButton.disabled = false;
  setStatus("PDF sbloccato. Stai lavorando su una copia; ora puoi modificarla e salvarla.");
}

async function applySelectedEdit() {
  const span = state.selectedSpan;
  if (!span || state.applyingEdit) return;
  if (!Array.isArray(state.pendingEditOrigin)) {
    throw new Error("la posizione originale di questo testo non è disponibile");
  }

  const selectedFont = ui.selectedFont.value.trim() || span.font || "Liberation Sans";
  const selectedResource = selectedFont === span.font ? span.font_resource : null;

  state.applyingEdit = true;
  setEditorEnabled(true);
  setStatus("Applicazione della modifica…");

  try {
    const result = await apiRequest("/edit-text", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        file_path: activePdfPath(),
        output_path: null,
        page_num: state.pageNumber - 1,
        bbox: span.bbox,
        origin: state.pendingEditOrigin,
        new_text: currentInlineText(),
        font: selectedFont,
        font_resource: selectedResource,
        size: Number(ui.selectedSize.value) || Number(span.size),
        color: Number(span.color) || 0,
        source: span.source || "native",
        background_color: Number(span.background_color) || 0xFFFFFF,
      }),
    });

    commitMutation(result.output_path);
    const editedPage = state.pageNumber;
    await reloadWorkingCopy(editedPage);
    ui.saveButton.disabled = false;
    setStatus(`${span.source === "ocr" ? "Testo nell'immagine" : "Modifica"} applicato con ${result.font_used}. Ora puoi salvare la nuova versione.`);
  } finally {
    state.applyingEdit = false;
    if (state.selectedSpan) setEditorEnabled(true);
  }
}

function selectedCoherentMatches() {
  return [...ui.coherentMatchList.querySelectorAll("input[type='checkbox'][data-match-index]:checked")]
    .map((checkbox) => state.coherentMatches[Number(checkbox.dataset.matchIndex)])
    .filter(Boolean);
}

function updateCoherentSelectionState() {
  const checkboxes = [...ui.coherentMatchList.querySelectorAll("input[type='checkbox'][data-match-index]")];
  const selectedCount = checkboxes.filter((checkbox) => checkbox.checked).length;
  ui.coherentSelectAll.checked = Boolean(checkboxes.length && selectedCount === checkboxes.length);
  ui.coherentSelectAll.indeterminate = selectedCount > 0 && selectedCount < checkboxes.length;
  ui.coherentCount.textContent = `${selectedCount} di ${checkboxes.length} selezionate`;
  ui.applyCoherentButton.disabled = selectedCount === 0 || state.applyingEdit;
  ui.applyCoherentButton.textContent = selectedCount === 1
    ? "Aggiorna 1 occorrenza"
    : `Aggiorna ${selectedCount} occorrenze`;
}

function renderCoherentMatches() {
  ui.coherentMatchList.replaceChildren(...state.coherentMatches.map((match, index) => {
    const row = document.createElement("label");
    row.className = "coherent-match";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = true;
    checkbox.dataset.matchIndex = String(index);

    const copy = document.createElement("div");
    copy.className = "coherent-match-copy";
    const meta = document.createElement("div");
    meta.className = "coherent-match-meta";
    const page = document.createElement("span");
    page.textContent = `Pagina ${Number(match.page_num) + 1}`;
    meta.appendChild(page);
    if (match.source === "ocr") {
      const source = document.createElement("span");
      source.className = "coherent-source";
      source.textContent = "OCR";
      meta.appendChild(source);
    }

    const context = document.createElement("p");
    context.className = "coherent-context";
    context.textContent = match.context || match.text;
    copy.append(meta, context);
    row.append(checkbox, copy);
    return row;
  }));
  updateCoherentSelectionState();
}

async function findCoherentEdits() {
  if (!state.selectedSpan || state.activeTool !== "edit") return;
  const originalText = String(state.selectedSpan.text || "");
  const replacementText = currentInlineText();
  if (!normalizedEditorText(originalText)) throw new Error("il testo originale è vuoto");
  if (normalizedEditorText(originalText) === normalizedEditorText(replacementText)) {
    throw new Error("modifica prima il testo selezionato");
  }

  ui.coherentButton.disabled = true;
  setStatus("Ricerca dello stesso valore in tutto il PDF, incluso il testo OCR…");
  try {
    const result = await apiRequest("/find-repeated-text", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        file_path: activePdfPath(),
        text: originalText,
        include_ocr: false,
      }),
    });
    const matches = Array.isArray(result.matches) ? result.matches : [];
    if (matches.length < 2) {
      setStatus("Questo valore compare una sola volta: usa “Applica Modifica” per aggiornarlo.");
      return;
    }

    state.coherentMatches = matches;
    state.coherentOriginalText = originalText;
    state.coherentReplacementText = replacementText;
    ui.coherentOldText.textContent = originalText;
    ui.coherentNewText.textContent = replacementText || "(elimina)";
    ui.coherentSummary.textContent = `${matches.length} occorrenze trovate su ${result.page_count} pagine. Scegli quali aggiornare; ogni posizione manterrà il proprio stile.`;
    ui.coherentSelectAll.checked = true;
    renderCoherentMatches();
    ui.coherentDialog.showModal();
    setStatus(`${matches.length} occorrenze trovate. Controlla l'elenco prima di applicare.`);
  } finally {
    updateCoherentButtonState();
  }
}

async function applyCoherentEdit() {
  const selectedMatches = selectedCoherentMatches();
  if (!selectedMatches.length || state.applyingEdit) return;
  const originalText = state.coherentOriginalText;
  const replacementText = state.coherentReplacementText;
  const expectedRemaining = state.coherentMatches.length - selectedMatches.length;

  state.applyingEdit = true;
  ui.applyCoherentButton.disabled = true;
  setEditorEnabled(true);
  setStatus(`Aggiornamento atomico di ${selectedMatches.length} occorrenze…`);

  try {
    const result = await apiRequest("/batch-edit-text", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        file_path: activePdfPath(),
        output_path: null,
        old_text: originalText,
        new_text: replacementText,
        changes: selectedMatches.map((match) => ({
          page_num: match.page_num,
          bbox: match.bbox,
          origin: match.origin,
          font: match.font,
          font_resource: match.font_resource,
          size: match.size,
          color: match.color,
          source: match.source || "native",
          background_color: Number.isFinite(Number(match.background_color))
            ? Number(match.background_color)
            : 0xFFFFFF,
        })),
      }),
    });

    commitMutation(result.output_path);
    ui.coherentDialog.close();
    state.coherentMatches = [];
    await reloadWorkingCopy(state.pageNumber);
    setStatus("Verifica finale della coerenza del documento…");

    let verificationMessage = "";
    try {
      const verification = await apiRequest("/find-repeated-text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file_path: activePdfPath(),
          text: originalText,
          include_ocr: false,
        }),
      });
      const remaining = Array.isArray(verification.matches) ? verification.matches.length : 0;
      verificationMessage = remaining === expectedRemaining
        ? ` Verifica completata: ${remaining
          ? `${remaining} ${remaining === 1 ? "occorrenza lasciata" : "occorrenze lasciate"} intenzionalmente.`
          : "il vecchio valore non è più presente."}`
        : ` Attenzione: la verifica ha rilevato ${remaining} occorrenze residue.`;
    } catch (error) {
      console.warn("Verifica finale non disponibile:", error);
      verificationMessage = " Modifica applicata; verifica finale non disponibile.";
    }

    ui.saveButton.disabled = false;
    setStatus(`${result.changed_count} occorrenze aggiornate in un'unica operazione.${verificationMessage}`);
  } finally {
    state.applyingEdit = false;
    updateCoherentSelectionState();
    updateCoherentButtonState();
  }
}

function pdfColorToCss(colorValue) {
  const color = Number(colorValue) || 0;
  const red = (color >> 16) & 255;
  const green = (color >> 8) & 255;
  const blue = color & 255;
  return `rgb(${red} ${green} ${blue})`;
}

function currentInlineText() {
  return state.inlineEditor?.content?.textContent ?? ui.selectedText.value;
}

function draftOrigin() {
  return state.inlineEditor?.kind === "add"
    ? state.pendingAddition?.origin
    : state.pendingEditOrigin;
}

function updateDraftOrigin(left, top) {
  if (!state.inlineEditor) return;
  const origin = cssPointToBackend([left, top + state.inlineEditor.baselineOffset]);

  if (state.inlineEditor.kind === "add" && state.pendingAddition) {
    state.pendingAddition.origin = origin;
  } else {
    state.pendingEditOrigin = origin;
  }
}

function makeInlineEditorDraggable(wrapper, handle) {
  handle.addEventListener("pointerdown", (startEvent) => {
    startEvent.preventDefault();
    startEvent.stopPropagation();
    handle.setPointerCapture(startEvent.pointerId);

    const initialLeft = Number.parseFloat(wrapper.style.left) || 0;
    const initialTop = Number.parseFloat(wrapper.style.top) || 0;
    const startX = startEvent.clientX;
    const startY = startEvent.clientY;

    const move = (event) => {
      const maxLeft = Math.max(0, ui.canvas.clientWidth - 20);
      const maxTop = Math.max(0, ui.canvas.clientHeight - 4);
      const left = Math.min(maxLeft, Math.max(0, initialLeft + event.clientX - startX));
      const top = Math.min(maxTop, Math.max(0, initialTop + event.clientY - startY));
      wrapper.style.left = `${left}px`;
      wrapper.style.top = `${top}px`;
      updateDraftOrigin(left, top);
      ui.selectionHelp.textContent = "Posizione aggiornata. Scrivi direttamente sulla pagina e poi applica.";
    };

    const stop = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", stop);
      handle.removeEventListener("pointercancel", stop);
    };

    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", stop);
    handle.addEventListener("pointercancel", stop);
  });
}

function createInlineTextEditor({ kind, origin, span, text }) {
  if (!Array.isArray(origin)) return;
  if (state.inlineEditor?.wrapper) state.inlineEditor.wrapper.remove();

  const size = Number(span.size) || 11;
  const ascender = Number(span.ascender) || 1;
  const baselineOffset = size * ascender * state.pageScale;
  const wrapper = document.createElement("div");
  wrapper.className = `inline-text-editor${kind === "edit" ? " is-existing" : ""}`;
  const [originLeft, originTop] = backendPointToCss(origin);
  wrapper.style.left = `${originLeft}px`;
  wrapper.style.top = `${originTop - baselineOffset}px`;

  const handle = document.createElement("button");
  handle.type = "button";
  handle.className = "inline-drag-handle";
  handle.textContent = "✥";
  handle.title = "Trascina per spostare il testo";
  handle.setAttribute("aria-label", "Sposta testo");

  const content = document.createElement("div");
  content.className = "inline-text-content";
  content.setAttribute("contenteditable", "plaintext-only");
  content.setAttribute("role", "textbox");
  content.setAttribute("aria-label", kind === "add" ? "Nuovo testo" : "Modifica testo");
  content.spellcheck = false;
  content.textContent = text;
  content.style.fontFamily = `"${String(span.font || "Helvetica").replaceAll('"', "")}", Helvetica, sans-serif`;
  content.style.fontSize = `${size * state.pageScale}px`;
  content.style.lineHeight = "1.15";
  content.style.fontWeight = /bold/i.test(span.font || "") ? "700" : "400";
  content.style.fontStyle = /italic|oblique/i.test(span.font || "") ? "italic" : "normal";
  content.style.color = pdfColorToCss(span.color);

  wrapper.append(handle, content);
  ui.stage.appendChild(wrapper);
  state.inlineEditor = { wrapper, content, handle, kind, ascender, baselineOffset };
  makeInlineEditorDraggable(wrapper, handle);

  content.addEventListener("input", () => {
    ui.selectedText.value = content.textContent;
    updateCoherentButtonState();
  });
  content.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      ui.applyButton.click();
    }
  });

  requestAnimationFrame(() => {
    content.focus();
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(content);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  });
}

function distanceFromSpan(point, span) {
  if (!Array.isArray(span.bbox) || span.bbox.length < 4) return Number.POSITIVE_INFINITY;
  const [x0, y0, x1, y1] = span.bbox.map(Number);
  const dx = Math.max(x0 - point.x, 0, point.x - x1);
  const dy = Math.max(y0 - point.y, 0, point.y - y1);
  return (dx * dx) + (dy * dy);
}

function nearestTextStyle(point) {
  return state.currentSpans
    .filter((span) => span.text)
    .reduce((nearest, span) => {
      const distance = distanceFromSpan(point, span);
      return !nearest || distance < nearest.distance ? { span, distance } : nearest;
    }, null)?.span || null;
}

function prepareTextAddition(event) {
  if (state.activeTool !== "add" || !state.pdf) return;
  if (event.target.closest(".inline-text-editor")) return;
  event.preventDefault();
  event.stopPropagation();

  const canvasRect = ui.canvas.getBoundingClientRect();
  const cssX = event.clientX - canvasRect.left;
  const cssY = event.clientY - canvasRect.top;
  if (cssX < 0 || cssY < 0 || cssX > canvasRect.width || cssY > canvasRect.height) return;

  const [backendX, backendY] = cssPointToBackend([cssX, cssY]);
  const point = { x: backendX, y: backendY };
  const nearbySpan = nearestTextStyle(point);
  const style = nearbySpan || {
    font: "Helvetica",
    font_resource: null,
    size: 11,
    color: 0,
  };

  state.selectedSpan = null;
  state.pendingAddition = {
    origin: [point.x, point.y],
    font: style.font,
    font_resource: style.font_resource,
    size: Number(style.size) || 11,
    color: Number(style.color) || 0,
    ascender: Number(style.ascender) || 1,
  };

  ui.overlay.replaceChildren();

  ui.selectedText.value = "";
  ui.selectedFont.value = state.pendingAddition.font;
  ui.selectedSize.value = state.pendingAddition.size;
  ui.selectionHelp.textContent = nearbySpan
    ? `Nuovo testo · stile copiato dal ${nearbySpan.font} più vicino.`
    : "Nuovo testo · nessun testo vicino, uso Helvetica.";
  ui.applyButton.textContent = "Aggiungi Testo";
  setEditorEnabled(true);
  createInlineTextEditor({
    kind: "add",
    origin: state.pendingAddition.origin,
    span: state.pendingAddition,
    text: "",
  });
}

async function applyTextAddition() {
  const addition = state.pendingAddition;
  if (!addition || state.applyingEdit) return;
  const newText = currentInlineText();
  if (!newText) throw new Error("scrivi prima il testo da aggiungere");
  const selectedFont = ui.selectedFont.value.trim() || addition.font || "Liberation Sans";
  const selectedResource = selectedFont === addition.font ? addition.font_resource : null;

  state.applyingEdit = true;
  setEditorEnabled(true);
  setStatus("Aggiunta del nuovo testo…");

  try {
    const result = await apiRequest("/add-text", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        file_path: activePdfPath(),
        output_path: null,
        page_num: state.pageNumber - 1,
        origin: addition.origin,
        new_text: newText,
        font: selectedFont,
        font_resource: selectedResource,
        size: Number(ui.selectedSize.value) || addition.size,
        color: addition.color,
      }),
    });

    commitMutation(result.output_path);
    const editedPage = state.pageNumber;
    await reloadWorkingCopy(editedPage);
    ui.saveButton.disabled = false;
    setStatus(`Testo aggiunto con ${result.font_used}. Ora puoi salvarlo o aggiungerne un altro.`);
  } finally {
    state.applyingEdit = false;
    if (state.pendingAddition) setEditorEnabled(true);
  }
}

function prepareMediaDraft(imageData, intrinsicWidth, intrinsicHeight, kind) {
  if (!state.pdf || !imageData) return;
  clearSelection();
  state.activeTool = kind;
  setInspectorMode("media");
  const aspectRatio = Math.max(0.1, Number(intrinsicWidth) / Math.max(1, Number(intrinsicHeight)));
  const width = Math.min(ui.canvas.clientWidth * 0.42, kind === "signature" ? 300 : 260);
  const height = Math.min(ui.canvas.clientHeight * 0.42, width / aspectRatio);
  const left = Math.max(8, (ui.canvas.clientWidth - width) / 2);
  const top = Math.max(8, (ui.canvas.clientHeight - height) / 2);

  const draft = document.createElement("div");
  draft.className = "media-draft";
  draft.style.left = `${left}px`;
  draft.style.top = `${top}px`;
  draft.style.width = `${width}px`;
  draft.style.height = `${height}px`;
  const image = document.createElement("img");
  image.src = imageData;
  image.alt = kind === "signature" ? "Firma da posizionare" : "Immagine da posizionare";
  const resizeHandle = document.createElement("span");
  resizeHandle.className = "media-resize-handle";
  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "media-delete";
  deleteButton.textContent = "×";
  deleteButton.title = "Rimuovi elemento";
  draft.append(image, resizeHandle, deleteButton);
  ui.mediaOverlay.replaceChildren(draft);

  state.mediaDraft = { element: draft, imageData, aspectRatio, kind };
  ui.mediaDescription.textContent = "Trascina l'elemento sulla pagina e usa il punto blu per ridimensionarlo.";
  ui.selectionHelp.textContent = kind === "signature"
    ? "Posiziona e ridimensiona la firma prima di applicarla."
    : "Posiziona e ridimensiona l'immagine prima di applicarla.";
  ui.applyButton.textContent = kind === "signature" ? "Inserisci Firma" : "Inserisci Immagine";
  ui.applyButton.disabled = false;

  const startPointerAction = (startEvent, resize = false) => {
    startEvent.preventDefault();
    startEvent.stopPropagation();
    const target = resize ? resizeHandle : draft;
    target.setPointerCapture(startEvent.pointerId);
    const startX = startEvent.clientX;
    const startY = startEvent.clientY;
    const initialLeft = draft.offsetLeft;
    const initialTop = draft.offsetTop;
    const initialWidth = draft.offsetWidth;
    const initialHeight = draft.offsetHeight;

    const move = (event) => {
      if (resize) {
        const maxWidth = ui.canvas.clientWidth - initialLeft;
        const maxHeight = ui.canvas.clientHeight - initialTop;
        let nextWidth = Math.max(40, initialWidth + event.clientX - startX);
        let nextHeight = nextWidth / aspectRatio;
        if (nextHeight > maxHeight) {
          nextHeight = maxHeight;
          nextWidth = nextHeight * aspectRatio;
        }
        nextWidth = Math.min(maxWidth, nextWidth);
        nextHeight = Math.min(maxHeight, nextHeight);
        draft.style.width = `${Math.max(40, nextWidth)}px`;
        draft.style.height = `${Math.max(24, nextHeight)}px`;
      } else {
        const nextLeft = Math.min(ui.canvas.clientWidth - draft.offsetWidth, Math.max(0, initialLeft + event.clientX - startX));
        const nextTop = Math.min(ui.canvas.clientHeight - draft.offsetHeight, Math.max(0, initialTop + event.clientY - startY));
        draft.style.left = `${nextLeft}px`;
        draft.style.top = `${nextTop}px`;
      }
    };
    const stop = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", stop);
      target.removeEventListener("pointercancel", stop);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", stop);
    target.addEventListener("pointercancel", stop);
  };

  draft.addEventListener("pointerdown", (event) => {
    if (event.target === resizeHandle || event.target === deleteButton) return;
    startPointerAction(event, false);
  });
  resizeHandle.addEventListener("pointerdown", (event) => startPointerAction(event, true));
  deleteButton.addEventListener("click", (event) => {
    event.stopPropagation();
    clearMediaDraft();
    ui.applyButton.disabled = true;
    ui.selectionHelp.textContent = "Elemento rimosso. Scegline un altro dalla barra strumenti.";
  });
}

async function applyMediaDraft() {
  const media = state.mediaDraft;
  if (!media || state.applyingEdit) return;
  const element = media.element;
  const rect = cssRectToBackend([
    element.offsetLeft, element.offsetTop,
    element.offsetLeft + element.offsetWidth, element.offsetTop + element.offsetHeight,
  ]);
  state.applyingEdit = true;
  ui.applyButton.disabled = true;
  setStatus(media.kind === "signature" ? "Inserimento della firma…" : "Inserimento dell'immagine…");
  try {
    const result = await apiRequest("/add-image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        file_path: activePdfPath(),
        output_path: null,
        page_num: state.pageNumber - 1,
        rect,
        image_data: media.imageData,
      }),
    });
    commitMutation(result.output_path);
    const editedPage = state.pageNumber;
    await reloadWorkingCopy(editedPage);
    ui.saveButton.disabled = false;
    setStatus(media.kind === "signature" ? "Firma inserita nel PDF." : "Immagine inserita nel PDF.");
  } finally {
    state.applyingEdit = false;
  }
}

function typedSignatureDataUrl(name) {
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 300;
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#101722";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = '96px "Snell Roundhand", "Brush Script MT", cursive';
  context.fillText(name, canvas.width / 2, canvas.height / 2, canvas.width - 70);
  return canvas.toDataURL("image/png");
}

function resetSignatureCanvas() {
  const context = ui.signatureCanvas.getContext("2d");
  context.clearRect(0, 0, ui.signatureCanvas.width, ui.signatureCanvas.height);
  state.signatureHasInk = false;
}

function setSignatureMode(mode) {
  state.signatureMode = mode;
  const typed = mode === "typed";
  ui.signatureTypedTab.classList.toggle("is-active", typed);
  ui.signatureDrawTab.classList.toggle("is-active", !typed);
  ui.signatureTypedPanel.classList.toggle("hidden", !typed);
  ui.signatureDrawPanel.classList.toggle("hidden", typed);
}

async function performPageOperation(action) {
  if (!state.pdf) return;
  if (action === "delete" && !window.confirm(`Eliminare definitivamente la pagina ${state.pageNumber} dalla copia di lavoro?`)) return;
  setStatus(`${action === "rotate" ? "Rotazione" : action === "duplicate" ? "Duplicazione" : action === "extract" ? "Estrazione" : "Eliminazione"} pagina…`);
  const result = await apiRequest("/page-operation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      file_path: activePdfPath(),
      output_path: null,
      page_num: state.pageNumber - 1,
      action,
    }),
  });

  if (action === "extract") {
    const parsed = filePaths.parse(state.originalName || "documento.pdf");
    const destination = await appBridge.savePdfAs(
      filePaths.join(filePaths.dirname(state.originalPath), `${parsed.name} - pagina ${state.pageNumber}.pdf`),
    );
    if (destination) {
      await appBridge.copyFile(result.output_path, destination);
      setStatus(`Pagina estratta e salvata: ${destination}`);
    }
    return;
  }

  commitMutation(result.output_path);
  await reloadWorkingCopy(result.page_num + 1);
  setStatus(action === "rotate" ? "Pagina ruotata." : action === "duplicate" ? "Pagina duplicata." : "Pagina eliminata.");
}

function hexToPdfColor(hex) {
  const normalized = String(hex || "#000000").replace("#", "");
  return [0, 2, 4].map((offset) => Number.parseInt(normalized.slice(offset, offset + 2), 16) / 255);
}

async function applyAnnotationDraft() {
  const draft = state.annotationDraft;
  if (!draft) throw new Error("disegna prima l'annotazione sulla pagina");
  const payload = {
    file_path: activePdfPath(),
    output_path: null,
    page_num: state.pageNumber - 1,
    kind: draft.kind,
    color: hexToPdfColor(ui.annotationColor.value),
    opacity: Number(ui.annotationOpacity.value) / 100,
    width: Number(ui.annotationWidth.value) || 2,
    rect: draft.rect ? cssRectToBackend(draft.rect) : null,
    points: draft.points ? draft.points.map((point) => cssPointToBackend(point)) : [],
  };
  setStatus("Applicazione dell'annotazione…");
  const result = await apiRequest("/add-annotation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  commitMutation(result.output_path);
  await reloadWorkingCopy(state.pageNumber);
  setStatus("Annotazione applicata. Puoi continuare a disegnare o salvare la copia.");
}

async function renderFormFields(viewport) {
  const result = await apiRequest("/inspect-forms", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_path: activePdfPath(), page_num: state.pageNumber - 1 }),
  });
  state.formFields = [];
  const fragment = document.createDocumentFragment();
  for (const field of result.fields || []) {
    const [x0, y0, x1, y1] = field.rect.map(Number);
    let input;
    if (field.type_id === 2 || field.type_id === 5) {
      input = document.createElement("input");
      input.type = field.type_id === 5 ? "radio" : "checkbox";
      input.checked = input.type === "radio"
        ? String(field.value) === String(field.on_state)
        : ![null, "", "Off", false].includes(field.value);
      if (input.type === "radio") {
        input.name = field.name;
        input.value = field.on_state || "Yes";
      }
    } else if (Array.isArray(field.choices) && field.choices.length) {
      input = document.createElement("select");
      for (const choice of field.choices) {
        const option = document.createElement("option");
        option.value = choice;
        option.textContent = choice;
        input.appendChild(option);
      }
      input.value = field.value || "";
    } else {
      input = document.createElement("input");
      input.type = "text";
      input.value = field.value || "";
    }
    input.className = "form-field";
    const [left, top, right, bottom] = backendRectToCss([x0, y0, x1, y1]);
    input.style.left = `${left}px`;
    input.style.top = `${top}px`;
    input.style.width = `${Math.max(18, right - left)}px`;
    input.style.height = `${Math.max(18, bottom - top)}px`;
    input.title = field.label;
    input.setAttribute("aria-label", field.label);
    fragment.appendChild(input);
    state.formFields.push({ field, input });
  }
  ui.formOverlay.replaceChildren(fragment);
  const count = state.formFields.length;
  ui.formDescription.textContent = count
    ? `${count} ${count === 1 ? "campo disponibile" : "campi disponibili"}. Puoi compilarli oppure crearne altri.`
    : "Questa pagina non contiene campi: scegli un tipo e disegnane uno nuovo.";
  if (!ui.formFieldName.value.trim()) ui.formFieldName.value = `campo_${count + 1}`;
  ui.selectionHelp.textContent = ui.formDescription.textContent;
  ui.applyButton.textContent = "Salva Campi Modulo";
  ui.applyButton.disabled = count === 0;
  setStatus(count ? "Campi modulo pronti: compilali o creane altri." : "Nessun campo presente: ora puoi crearlo direttamente sulla pagina.");
}

function formChoices() {
  return ui.formFieldChoices.value.split(/[\n,;]+/).map((choice) => choice.trim()).filter(Boolean);
}

function setFormKind(kind) {
  state.formKind = kind;
  state.formDraft = null;
  state.formCreating = false;
  ui.formOverlay.classList.remove("is-creating");
  ui.formOverlay.querySelector(".form-field-draft")?.remove();
  document.querySelectorAll("[data-form-kind]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.formKind === kind);
  });
  ui.formChoiceOptions.classList.toggle("hidden", kind !== "combobox");
  ui.applyButton.textContent = "Salva Campi Modulo";
  ui.applyButton.disabled = state.formFields.length === 0;
}

function startFormFieldDrawing() {
  const name = ui.formFieldName.value.trim();
  if (!name) throw new Error("inserisci il nome del campo");
  if (state.formKind === "combobox" && !formChoices().length) {
    throw new Error("inserisci almeno un'opzione per il menu");
  }
  state.formDraft = null;
  state.formCreating = true;
  ui.formOverlay.querySelector(".form-field-draft")?.remove();
  ui.formOverlay.classList.add("is-creating");
  ui.applyButton.textContent = "Crea Campo";
  ui.applyButton.disabled = true;
  setStatus(state.formKind === "checkbox"
    ? "Trascina sulla pagina per disegnare la casella di spunta."
    : "Trascina sulla pagina per definire posizione e dimensione del nuovo campo.");
}

function setupFormFieldDrawing() {
  let drawing = false;
  let startX = 0;
  let startY = 0;
  let draftElement = null;

  ui.formOverlay.addEventListener("pointerdown", (event) => {
    if (!state.formCreating) return;
    event.preventDefault();
    event.stopPropagation();
    const bounds = ui.formOverlay.getBoundingClientRect();
    startX = Math.max(0, Math.min(bounds.width, event.clientX - bounds.left));
    startY = Math.max(0, Math.min(bounds.height, event.clientY - bounds.top));
    drawing = true;
    ui.formOverlay.setPointerCapture(event.pointerId);
    draftElement = document.createElement("div");
    draftElement.className = "form-field-draft";
    draftElement.style.left = `${startX}px`;
    draftElement.style.top = `${startY}px`;
    draftElement.style.width = "1px";
    draftElement.style.height = "1px";
    ui.formOverlay.appendChild(draftElement);
  });

  ui.formOverlay.addEventListener("pointermove", (event) => {
    if (!drawing || !draftElement) return;
    const bounds = ui.formOverlay.getBoundingClientRect();
    const currentX = Math.max(0, Math.min(bounds.width, event.clientX - bounds.left));
    const currentY = Math.max(0, Math.min(bounds.height, event.clientY - bounds.top));
    let deltaX = currentX - startX;
    let deltaY = currentY - startY;
    if (state.formKind === "checkbox") {
      const side = Math.max(Math.abs(deltaX), Math.abs(deltaY));
      deltaX = Math.sign(deltaX || 1) * side;
      deltaY = Math.sign(deltaY || 1) * side;
    }
    const left = Math.min(startX, startX + deltaX);
    const top = Math.min(startY, startY + deltaY);
    const width = Math.abs(deltaX);
    const height = Math.abs(deltaY);
    draftElement.style.left = `${left}px`;
    draftElement.style.top = `${top}px`;
    draftElement.style.width = `${width}px`;
    draftElement.style.height = `${height}px`;
  });

  const stop = () => {
    if (!drawing) return;
    drawing = false;
    const left = Number.parseFloat(draftElement?.style.left) || 0;
    const top = Number.parseFloat(draftElement?.style.top) || 0;
    const width = Number.parseFloat(draftElement?.style.width) || 0;
    const height = Number.parseFloat(draftElement?.style.height) || 0;
    if (width < 10 || height < 10) {
      draftElement?.remove();
      state.formDraft = null;
      ui.applyButton.disabled = true;
      setStatus("Il campo è troppo piccolo: trascina un'area più ampia.", true);
      return;
    }
    state.formDraft = [left, top, left + width, top + height];
    state.formCreating = false;
    ui.formOverlay.classList.remove("is-creating");
    ui.applyButton.textContent = "Crea Campo";
    ui.applyButton.disabled = false;
    setStatus("Posizione definita. Premi “Crea Campo” per inserirlo nel PDF.");
  };
  ui.formOverlay.addEventListener("pointerup", stop);
  ui.formOverlay.addEventListener("pointercancel", stop);
}

async function createFormField() {
  if (!state.formDraft) throw new Error("disegna prima il nuovo campo sulla pagina");
  setStatus("Creazione del campo modulo…");
  const result = await apiRequest("/create-form-field", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      file_path: activePdfPath(),
      output_path: null,
      page_num: state.pageNumber - 1,
      field_type: state.formKind,
      name: ui.formFieldName.value.trim(),
      label: ui.formFieldLabel.value.trim() || ui.formFieldName.value.trim(),
      rect: cssRectToBackend(state.formDraft),
      choices: formChoices(),
    }),
  });
  commitMutation(result.output_path);
  ui.formFieldName.value = "";
  ui.formFieldLabel.value = "";
  state.formDraft = null;
  await reloadWorkingCopy(state.pageNumber);
  setStatus(`Campo “${result.name}” creato. Puoi compilarlo, crearne altri o salvare la copia.`);
}

async function applyFormFields() {
  if (!state.formFields.length) return;
  const values = {};
  for (const { field, input } of state.formFields) {
    if (input.type === "radio" && !input.checked) continue;
    values[field.name] = input.type === "checkbox" ? input.checked : input.value;
  }
  setStatus("Salvataggio dei campi modulo…");
  const result = await apiRequest("/fill-forms", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_path: activePdfPath(), output_path: null, values }),
  });
  commitMutation(result.output_path);
  await reloadWorkingCopy(state.pageNumber);
  setStatus(`${result.updated} ${result.updated === 1 ? "campo aggiornato" : "campi aggiornati"}.`);
}

function applyFormAction() {
  return state.formDraft ? createFormField() : applyFormFields();
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function showProcessDialog(kind) {
  state.processKind = kind;
  const compressing = kind === "compress";
  ui.processTitle.textContent = compressing ? "Comprimi PDF" : "Riconosci testo (OCR)";
  ui.processDescription.textContent = compressing
    ? "Crea una copia più leggera, ideale per allegati e-mail."
    : "Rende selezionabile e ricercabile il testo delle pagine scansionate usando il motore locale di macOS.";
  ui.compressionOptions.classList.toggle("hidden", !compressing);
  ui.ocrOptions.classList.toggle("hidden", compressing);
  ui.runProcessButton.textContent = compressing ? "Comprimi" : "Avvia OCR";
  ui.processDialog.showModal();
}

async function runDocumentProcess() {
  if (state.processKind === "compress") {
    const quality = document.querySelector('input[name="compression"]:checked')?.value || "balanced";
    setStatus("Compressione del documento in corso…");
    const result = await apiRequest("/compress-pdf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file_path: activePdfPath(), output_path: null, quality }),
    });
    commitMutation(result.output_path);
    await reloadWorkingCopy(state.pageNumber);
    setStatus(`Compressione completata: ${formatBytes(result.original_size)} → ${formatBytes(result.final_size)}.`);
  } else {
    const scope = document.querySelector('input[name="ocr-scope"]:checked')?.value || "current";
    setStatus("Riconoscimento del testo in corso…");
    const result = await apiRequest("/ocr-pdf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        file_path: activePdfPath(), output_path: null,
        page_nums: scope === "current" ? [state.pageNumber - 1] : null,
      }),
    });
    commitMutation(result.output_path);
    await reloadWorkingCopy(state.pageNumber);
    setStatus(`OCR completato: ${result.recognized} righe riconosciute.`);
  }
}

function stampDataUrl(text, color = "#d83d37") {
  const canvas = document.createElement("canvas");
  canvas.width = 720;
  canvas.height = 230;
  const context = canvas.getContext("2d");
  context.strokeStyle = color;
  context.fillStyle = color;
  context.lineWidth = 10;
  context.strokeRect(18, 18, canvas.width - 36, canvas.height - 36);
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = "bold 76px Helvetica, sans-serif";
  context.fillText(text, canvas.width / 2, canvas.height / 2, canvas.width - 80);
  return canvas.toDataURL("image/png");
}

function savedSignatureMarks() {
  try {
    const marks = JSON.parse(localStorage.getItem("macPdfEditor.savedMarks") || "[]");
    return Array.isArray(marks) ? marks.filter((mark) => typeof mark.label === 'string' && /^data:image\/png;base64,/.test(mark.imageData)).slice(0, 8) : [];
  } catch {
    return [];
  }
}

function storeSignatureMark(imageData, label) {
  const marks = savedSignatureMarks();
  if (!marks.some((mark) => mark.imageData === imageData)) {
    marks.unshift({ id: Date.now(), label, imageData });
    try {
      localStorage.setItem("macPdfEditor.savedMarks", JSON.stringify(marks.slice(0, 8)));
    } catch {
      setStatus('Firma inseribile, ma memoria delle firme piena. Elimina quelle salvate per conservarne altre.', true);
    }
  }
}

function renderSavedMarks() {
  const defaults = [
    { label: "APPROVATO", imageData: stampDataUrl("APPROVATO", "#278451") },
    { label: "DA VERIFICARE", imageData: stampDataUrl("DA VERIFICARE", "#d57a00") },
    { label: "PAGATO", imageData: stampDataUrl("PAGATO", "#315fd5") },
  ];
  const marks = [...savedSignatureMarks(), ...defaults];
  const fragment = document.createDocumentFragment();
  const clear = document.createElement('button');
  clear.type = 'button'; clear.className = 'btn'; clear.textContent = 'Elimina firme salvate';
  clear.disabled = savedSignatureMarks().length === 0;
  clear.addEventListener('click', () => {
    if (!window.confirm('Eliminare tutte le firme e i timbri salvati su questo Mac?')) return;
    localStorage.removeItem('macPdfEditor.savedMarks'); renderSavedMarks();
  });
  fragment.appendChild(clear);
  for (const mark of marks) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "saved-mark";
    button.title = mark.label;
    const image = document.createElement("img");
    image.src = mark.imageData;
    image.alt = mark.label;
    button.appendChild(image);
    button.addEventListener("click", () => {
      ui.signatureDialog.close();
      state.editMode = true;
      ui.editButton.classList.remove("is-active");
      ui.addTextButton.classList.remove("is-active");
      ui.imageButton.classList.remove("is-active");
      ui.annotationButton.classList.remove("is-active");
      ui.signatureButton.classList.add("is-active");
      prepareMediaDraft(mark.imageData, 720, 230, "signature");
    });
    fragment.appendChild(button);
  }
  ui.savedMarks.replaceChildren(fragment);
}

async function savePdfAs() {
  if (!state.workingPath) {
    throw new Error("non ci sono ancora modifiche da salvare");
  }
  if (!appBridge) {
    throw new Error("il salvataggio richiede l'avvio come applicazione Electron");
  }

  const parsedName = filePaths.parse(state.originalName || "documento.pdf");
  const defaultName = filePaths.join(
    filePaths.dirname(state.originalPath),
    `${parsedName.name} - modificato.pdf`,
  );
  const destination = await appBridge.savePdfAs(defaultName);
  if (!destination) return;

  if (filePaths.resolve(destination) !== filePaths.resolve(state.workingPath)) {
    await appBridge.copyFile(state.workingPath, destination);
  }
  setStatus(`Nuova versione salvata: ${destination}`);
}

async function getLocalFilePath(file) {
  if (!file) return "";
  if (!appBridge) return "";
  try {
    return await appBridge.getPathForFile(file) || "";
  } catch (error) {
    console.warn("Percorso locale non disponibile:", error.message);
    return "";
  }
}

ui.openButton.addEventListener("click", () => ui.fileInput.click());

ui.unlockButton.addEventListener("click", () => showUnlockDialog(Boolean(state.lockedPath)));

ui.unlockForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const operation = pendingPasswordInsert
    ? insertPdfAt(pendingPasswordInsert.filePath, pendingPasswordInsert.insertAt, ui.unlockPassword.value)
    : unlockCurrentPdf(ui.unlockPassword.value);
  operation.then(() => {
    pendingPasswordInsert = null;
    ui.unlockPassword.value = '';
    ui.unlockDialog.close();
  }).catch((error) => {
    console.error(error);
    setStatus(`Sblocco non riuscito: ${error.message}`, true);
    ui.unlockPassword.select();
  });
});
ui.unlockDialog.addEventListener('close', () => { pendingPasswordInsert = null; ui.unlockPassword.value = ''; });

document.querySelectorAll("[data-close-dialog]").forEach((button) => {
  button.addEventListener("click", () => document.querySelector(`#${button.dataset.closeDialog}`)?.close());
});

ui.fileInput.addEventListener("change", () => {
  const file = ui.fileInput.files?.[0];
  if (file) getLocalFilePath(file).then((filePath) => openPdfSafely(filePath, file));
  ui.fileInput.value = "";
});

ui.undoButton.addEventListener("click", () => navigateHistory("undo").catch((error) => setStatus(error.message, true)));
ui.redoButton.addEventListener("click", () => navigateHistory("redo").catch((error) => setStatus(error.message, true)));
ui.rotatePageButton.addEventListener("click", () => performPageOperation("rotate").catch((error) => setStatus(error.message, true)));
ui.duplicatePageButton.addEventListener("click", () => performPageOperation("duplicate").catch((error) => setStatus(error.message, true)));
ui.extractPageButton.addEventListener("click", () => performPageOperation("extract").catch((error) => setStatus(error.message, true)));
ui.deletePageButton.addEventListener("click", () => performPageOperation("delete").catch((error) => setStatus(error.message, true)));

ui.insertPdfButton.addEventListener("click", () => {
  state.pendingInsertAt = state.pageNumber;
  ui.insertPdfInput.click();
});

ui.insertPdfInput.addEventListener("change", () => {
  const file = ui.insertPdfInput.files?.[0];
  const insertAt = state.pendingInsertAt ?? state.pageNumber;
  state.pendingInsertAt = null;
  ui.insertPdfInput.value = "";
  if (!file) return;
  getLocalFilePath(file).then((filePath) => insertPdfAt(filePath, insertAt)).catch((error) => {
    console.error(error);
    setStatus(`Inserimento non riuscito: ${error.message}`, true);
  });
});

ui.imageButton.addEventListener("click", () => ui.imageInput.click());

ui.imageInput.addEventListener("change", () => {
  const file = ui.imageInput.files?.[0];
  ui.imageInput.value = "";
  if (!file) return;
  const reader = new FileReader();
  reader.onerror = () => setStatus("Impossibile leggere l'immagine selezionata.", true);
  reader.onload = () => {
    const image = new Image();
    image.onload = () => {
      state.editMode = true;
      state.activeTool = "image";
      ui.editButton.classList.remove("is-active");
      ui.addTextButton.classList.remove("is-active");
      ui.signatureButton.classList.remove("is-active");
      ui.annotationButton.classList.remove("is-active");
      ui.imageButton.classList.add("is-active");
      prepareMediaDraft(String(reader.result), image.naturalWidth, image.naturalHeight, "image");
    };
    image.onerror = () => setStatus("Formato immagine non supportato.", true);
    image.src = String(reader.result);
  };
  reader.readAsDataURL(file);
});

ui.signatureButton.addEventListener("click", () => {
  setSignatureMode("typed");
  ui.signatureName.value = "";
  ui.signatureTypedPreview.textContent = "La tua firma";
  resetSignatureCanvas();
  renderSavedMarks();
  ui.signatureDialog.showModal();
  requestAnimationFrame(() => ui.signatureName.focus());
});

ui.signatureTypedTab.addEventListener("click", () => setSignatureMode("typed"));
ui.signatureDrawTab.addEventListener("click", () => setSignatureMode("draw"));
ui.signatureName.addEventListener("input", () => {
  ui.signatureTypedPreview.textContent = ui.signatureName.value.trim() || "La tua firma";
});
ui.clearSignature.addEventListener("click", resetSignatureCanvas);

ui.useSignature.addEventListener("click", () => {
  let imageData;
  if (state.signatureMode === "typed") {
    const name = ui.signatureName.value.trim();
    if (!name) {
      ui.signatureName.focus();
      return;
    }
    imageData = typedSignatureDataUrl(name);
    storeSignatureMark(imageData, name);
  } else {
    if (!state.signatureHasInk) {
      setStatus("Disegna prima la firma nel riquadro.", true);
      return;
    }
    imageData = ui.signatureCanvas.toDataURL("image/png");
    storeSignatureMark(imageData, `Firma ${new Date().toLocaleDateString("it-IT")}`);
  }
  ui.signatureDialog.close();
  state.editMode = true;
  state.activeTool = "signature";
  ui.editButton.classList.remove("is-active");
  ui.addTextButton.classList.remove("is-active");
  ui.imageButton.classList.remove("is-active");
  ui.annotationButton.classList.remove("is-active");
  ui.signatureButton.classList.add("is-active");
  prepareMediaDraft(imageData, state.signatureMode === "typed" ? 1200 : ui.signatureCanvas.width, 300, "signature");
});

{
  const canvas = ui.signatureCanvas;
  const context = canvas.getContext("2d");
  context.strokeStyle = "#101722";
  context.lineWidth = 4;
  context.lineCap = "round";
  context.lineJoin = "round";
  let drawing = false;
  const point = (event) => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * canvas.width / rect.width,
      y: (event.clientY - rect.top) * canvas.height / rect.height,
    };
  };
  canvas.addEventListener("pointerdown", (event) => {
    drawing = true;
    canvas.setPointerCapture(event.pointerId);
    const start = point(event);
    context.beginPath();
    context.moveTo(start.x, start.y);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!drawing) return;
    const next = point(event);
    context.lineTo(next.x, next.y);
    context.stroke();
    state.signatureHasInk = true;
  });
  const stopDrawing = () => { drawing = false; };
  canvas.addEventListener("pointerup", stopDrawing);
  canvas.addEventListener("pointercancel", stopDrawing);
}

ui.annotationButton.addEventListener("click", () => {
  if (!state.pdf) return;
  state.editMode = true;
  state.activeTool = "annotation";
  ui.editButton.classList.remove("is-active");
  ui.addTextButton.classList.remove("is-active");
  ui.signatureButton.classList.remove("is-active");
  ui.imageButton.classList.remove("is-active");
  ui.annotationButton.classList.remove("is-active");
  ui.annotationButton.classList.add("is-active");
  ui.stage.classList.remove("is-adding-text");
  renderPage(state.pageNumber).catch((error) => setStatus(error.message, true));
});

document.querySelectorAll("[data-annotation-kind]").forEach((button) => {
  button.addEventListener("click", () => {
    state.annotationKind = button.dataset.annotationKind;
    document.querySelectorAll("[data-annotation-kind]").forEach((item) => item.classList.toggle("is-active", item === button));
    state.annotationDraft = null;
    ui.annotationOverlay.replaceChildren();
    ui.applyButton.disabled = true;
  });
});

ui.annotationOpacity.addEventListener("input", () => {
  ui.annotationOpacityValue.textContent = `${ui.annotationOpacity.value}%`;
});

{
  let drawing = false;
  let startPoint = null;
  let preview = null;
  const localPoint = (event) => {
    const rect = ui.annotationOverlay.getBoundingClientRect();
    return [
      Math.max(0, Math.min(rect.width, event.clientX - rect.left)),
      Math.max(0, Math.min(rect.height, event.clientY - rect.top)),
    ];
  };
  const previewColor = () => ui.annotationColor.value;

  ui.annotationOverlay.addEventListener("pointerdown", (event) => {
    if (state.activeTool !== "annotation") return;
    event.preventDefault();
    drawing = true;
    startPoint = localPoint(event);
    state.annotationDraft = { kind: state.annotationKind, points: [startPoint] };
    ui.annotationOverlay.setPointerCapture(event.pointerId);

    if (["highlight", "rectangle"].includes(state.annotationKind)) {
      preview = document.createElement("div");
      preview.className = "annotation-rect";
      preview.style.left = `${startPoint[0]}px`;
      preview.style.top = `${startPoint[1]}px`;
      preview.style.borderColor = previewColor();
      preview.style.background = state.annotationKind === "highlight" ? `${previewColor()}55` : "transparent";
      ui.annotationOverlay.replaceChildren(preview);
    } else {
      const namespace = "http://www.w3.org/2000/svg";
      const svg = document.createElementNS(namespace, "svg");
      svg.classList.add("annotation-svg");
      preview = document.createElementNS(namespace, "path");
      preview.setAttribute("fill", "none");
      preview.setAttribute("stroke", previewColor());
      preview.setAttribute("stroke-width", ui.annotationWidth.value || "2");
      preview.setAttribute("stroke-linecap", "round");
      preview.setAttribute("stroke-linejoin", "round");
      svg.appendChild(preview);
      ui.annotationOverlay.replaceChildren(svg);
    }
  });

  ui.annotationOverlay.addEventListener("pointermove", (event) => {
    if (!drawing || !preview) return;
    const point = localPoint(event);
    if (["highlight", "rectangle"].includes(state.annotationKind)) {
      const left = Math.min(startPoint[0], point[0]);
      const top = Math.min(startPoint[1], point[1]);
      const width = Math.abs(point[0] - startPoint[0]);
      const height = Math.abs(point[1] - startPoint[1]);
      Object.assign(preview.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` });
      state.annotationDraft.rect = [left, top, left + width, top + height];
    } else if (state.annotationKind === "arrow") {
      state.annotationDraft.points = [startPoint, point];
      preview.setAttribute("d", `M ${startPoint[0]} ${startPoint[1]} L ${point[0]} ${point[1]}`);
    } else {
      const points = state.annotationDraft.points;
      const last = points[points.length - 1];
      if (Math.hypot(point[0] - last[0], point[1] - last[1]) >= 2) points.push(point);
      preview.setAttribute("d", points.map(([x, y], index) => `${index ? "L" : "M"} ${x} ${y}`).join(" "));
    }
  });

  const stop = () => {
    if (!drawing) return;
    drawing = false;
    const draft = state.annotationDraft;
    const valid = draft && (draft.rect ? draft.rect[2] - draft.rect[0] > 4 && draft.rect[3] - draft.rect[1] > 4 : draft.points?.length >= 2);
    if (!valid) {
      state.annotationDraft = null;
      ui.annotationOverlay.replaceChildren();
    }
    ui.applyButton.disabled = !valid;
  };
  ui.annotationOverlay.addEventListener("pointerup", stop);
  ui.annotationOverlay.addEventListener("pointercancel", stop);
}

ui.moreToolsButton.addEventListener("click", (event) => {
  event.stopPropagation();
  const opening = ui.toolsMenu.classList.contains("hidden");
  ui.toolsMenu.classList.toggle("hidden", !opening);
  ui.moreToolsButton.setAttribute("aria-expanded", String(opening));
});

document.addEventListener("click", (event) => {
  if (!event.target.closest(".tool-menu-wrap")) {
    ui.toolsMenu.classList.add("hidden");
    ui.moreToolsButton.setAttribute("aria-expanded", "false");
  }
});

ui.formsButton.addEventListener("click", () => {
  ui.toolsMenu.classList.add("hidden");
  state.editMode = true;
  state.activeTool = "form";
  ui.editButton.classList.remove("is-active");
  ui.addTextButton.classList.remove("is-active");
  ui.signatureButton.classList.remove("is-active");
  ui.imageButton.classList.remove("is-active");
  ui.annotationButton.classList.remove("is-active");
  renderPage(state.pageNumber).catch((error) => setStatus(error.message, true));
});

document.querySelectorAll("[data-form-kind]").forEach((button) => {
  button.addEventListener("click", () => setFormKind(button.dataset.formKind));
});

ui.startFormField.addEventListener("click", () => {
  try {
    startFormFieldDrawing();
  } catch (error) {
    setStatus(`Creazione campo non disponibile: ${error.message}`, true);
  }
});

setupFormFieldDrawing();

ui.compressButton.addEventListener("click", () => {
  ui.toolsMenu.classList.add("hidden");
  showProcessDialog("compress");
});
ui.ocrButton.addEventListener("click", () => {
  ui.toolsMenu.classList.add("hidden");
  showProcessDialog("ocr");
});
ui.processForm.addEventListener("submit", (event) => {
  event.preventDefault();
  ui.runProcessButton.disabled = true;
  runDocumentProcess().then(() => ui.processDialog.close()).catch((error) => {
    console.error(error);
    setStatus(`Operazione non riuscita: ${error.message}`, true);
  }).finally(() => { ui.runProcessButton.disabled = false; });
});

ui.selectedText.addEventListener("input", () => {
  if (state.inlineEditor?.content && state.inlineEditor.content.textContent !== ui.selectedText.value) {
    state.inlineEditor.content.textContent = ui.selectedText.value;
  }
  updateCoherentButtonState();
});

ui.coherentButton.addEventListener("click", () => {
  findCoherentEdits().catch((error) => {
    console.error(error);
    setStatus(`Ricerca coerente non riuscita: ${error.message}`, true);
  });
});

ui.coherentSelectAll.addEventListener("change", () => {
  ui.coherentMatchList.querySelectorAll("input[type='checkbox'][data-match-index]").forEach((checkbox) => {
    checkbox.checked = ui.coherentSelectAll.checked;
  });
  updateCoherentSelectionState();
});

ui.coherentMatchList.addEventListener("change", (event) => {
  if (event.target.matches("input[type='checkbox'][data-match-index]")) {
    updateCoherentSelectionState();
  }
});

ui.applyCoherentButton.addEventListener("click", () => {
  applyCoherentEdit().catch((error) => {
    console.error(error);
    setStatus(`Modifica coerente non riuscita: ${error.message}`, true);
  });
});

ui.selectedFont.addEventListener("input", () => {
  openFontPicker(ui.selectedFont.value);
  previewSelectedFont().catch((error) => {
    console.warn("Anteprima font non disponibile:", error);
  });
});

ui.selectedFont.addEventListener("click", () => {
  // Un nuovo clic deve mostrare l'intero catalogo, non filtrarlo con il font già selezionato.
  openFontPicker();
});

ui.selectedFont.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeFontPicker();
  } else if (event.key === "ArrowDown" && ui.fontOptions.classList.contains("hidden")) {
    event.preventDefault();
    openFontPicker();
  }
});

ui.fontPickerToggle.addEventListener("click", () => {
  if (ui.fontOptions.classList.contains("hidden")) {
    openFontPicker();
    ui.selectedFont.focus();
  } else {
    closeFontPicker();
  }
});

ui.fontOptions.addEventListener("pointerdown", (event) => {
  if (event.target.closest(".font-picker-option")) event.preventDefault();
});

ui.fontOptions.addEventListener("click", (event) => {
  const option = event.target.closest(".font-picker-option");
  if (!option) return;
  ui.selectedFont.value = option.dataset.fontName || option.textContent;
  closeFontPicker();
  ui.selectedFont.focus();
  previewSelectedFont().catch((error) => {
    console.warn("Anteprima font non disponibile:", error);
  });
});

document.addEventListener("click", (event) => {
  if (!event.target.closest(".font-picker")) closeFontPicker();
});

ui.selectedSize.addEventListener("input", () => {
  if (!state.inlineEditor) return;
  const size = Number(ui.selectedSize.value);
  const origin = draftOrigin();
  if (!Number.isFinite(size) || size <= 0 || !Array.isArray(origin)) return;

  state.inlineEditor.content.style.fontSize = `${size * state.pageScale}px`;
  state.inlineEditor.baselineOffset = size * state.inlineEditor.ascender * state.pageScale;
  const [, originTop] = backendPointToCss(origin);
  state.inlineEditor.wrapper.style.top = `${originTop - state.inlineEditor.baselineOffset}px`;
});

ui.previousButton.addEventListener("click", () => {
  if (state.pageNumber > 1) {
    renderPage(state.pageNumber - 1).catch((error) => setStatus(error.message, true));
  }
});

ui.nextButton.addEventListener("click", () => {
  if (state.pdf && state.pageNumber < state.pdf.numPages) {
    renderPage(state.pageNumber + 1).catch((error) => setStatus(error.message, true));
  }
});

ui.editButton.addEventListener("click", () => {
  if (!state.pdf) return;
  if (!activePdfPath()) {
    setStatus("Questa è la versione aperta in Chrome. Chiudila e avvia “Mac PDF Editor.app” dalla cartella del progetto.", true);
    return;
  }

  state.editMode = true;
  state.activeTool = "edit";
  ui.editButton.classList.add("is-active");
  setToolButtonLabel(ui.editButton, "Modifica attiva");
  ui.addTextButton.classList.remove("is-active");
  setToolButtonLabel(ui.addTextButton, "Aggiungi testo");
  ui.signatureButton.classList.remove("is-active");
  ui.imageButton.classList.remove("is-active");
  ui.stage.classList.remove("is-adding-text");
  renderPage(state.pageNumber).catch((error) => {
    console.error(error);
    setStatus(`Modifica testo non disponibile: ${error.message}`, true);
  });
});

ui.addTextButton.addEventListener("click", () => {
  if (!state.pdf) return;
  if (!activePdfPath()) {
    setStatus("Questa è la versione aperta in Chrome. Usa “Mac PDF Editor.app” per aggiungere e salvare testo.", true);
    return;
  }

  state.editMode = true;
  state.activeTool = "add";
  ui.addTextButton.classList.add("is-active");
  setToolButtonLabel(ui.addTextButton, "Aggiunta attiva");
  ui.editButton.classList.remove("is-active");
  setToolButtonLabel(ui.editButton, "Modifica testo");
  ui.signatureButton.classList.remove("is-active");
  ui.imageButton.classList.remove("is-active");
  ui.stage.classList.add("is-adding-text");
  renderPage(state.pageNumber).catch((error) => {
    console.error(error);
    setStatus(`Aggiunta testo non disponibile: ${error.message}`, true);
  });
});

ui.stage.addEventListener("click", prepareTextAddition, true);

ui.applyButton.addEventListener("click", () => {
  const action = state.activeTool === "add"
    ? applyTextAddition()
    : (state.activeTool === "image" || state.activeTool === "signature")
      ? applyMediaDraft()
      : state.activeTool === "annotation"
        ? applyAnnotationDraft()
        : state.activeTool === "form"
          ? applyFormAction()
      : applySelectedEdit();
  action.catch((error) => {
    console.error(error);
    setStatus(`Operazione non riuscita: ${error.message}`, true);
  });
});

let findDebounceTimer = null;

ui.findInput.addEventListener("input", () => {
  clearTimeout(findDebounceTimer);
  findDebounceTimer = setTimeout(() => {
    runDocumentSearch().catch((error) => {
      console.error(error);
      setStatus(`Ricerca non riuscita: ${error.message}`, true);
    });
  }, 280);
});

ui.findInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    if (state.searchMatches.length && state.searchQuery === ui.findInput.value.trim().replace(/\s+/g, " ")) {
      goToSearchMatch(state.searchIndex + (event.shiftKey ? -1 : 1)).catch((error) => setStatus(error.message, true));
    } else {
      clearTimeout(findDebounceTimer);
      runDocumentSearch().catch((error) => setStatus(`Ricerca non riuscita: ${error.message}`, true));
    }
  } else if (event.key === "Escape") {
    event.preventDefault();
    resetDocumentSearch({ close: true });
  }
});

ui.findPreviousButton.addEventListener("click", () => {
  goToSearchMatch(state.searchIndex - 1).catch((error) => setStatus(error.message, true));
});

ui.findNextButton.addEventListener("click", () => {
  goToSearchMatch(state.searchIndex + 1).catch((error) => setStatus(error.message, true));
});

ui.findCloseButton.addEventListener("click", () => resetDocumentSearch({ close: true }));

window.addEventListener("keydown", (event) => {
  const hasCommandModifier = event.metaKey || event.ctrlKey;
  if (hasCommandModifier && event.key.toLowerCase() === "f") {
    event.preventDefault();
    openDocumentSearch();
    return;
  }
  if (!hasCommandModifier || event.key.toLowerCase() !== "z") return;
  if (event.target.closest("input, textarea, [contenteditable]")) return;
  event.preventDefault();
  navigateHistory(event.shiftKey ? "redo" : "undo").catch((error) => setStatus(error.message, true));
});

ui.saveButton.addEventListener("click", () => {
  savePdfAs().catch((error) => {
    console.error(error);
    setStatus(`Salvataggio non riuscito: ${error.message}`, true);
  });
});

ui.tomorrowNowBanner.addEventListener("click", () => {
  if (!appBridge) {
    setStatus("Il collegamento a Tomorrow Now è disponibile nell’app Mac installata.", true);
    return;
  }
  appBridge.openExternal(TOMORROW_NOW_URL).catch((error) => {
    setStatus(`Impossibile aprire Tomorrow Now: ${error.message}`, true);
  });
});

if (appBridge) {
  appBridge.onUpdateStatus((status) => renderUpdateStatus(status));
  appBridge.getUpdateStatus()
    .then((status) => renderUpdateStatus(status))
    .catch((error) => console.warn("Stato aggiornamenti non disponibile:", error.message));
}

ui.checkUpdatesButton.addEventListener("click", () => {
  if (!appBridge) {
    renderUpdateStatus({ phase: "error", manual: true, error: "Il controllo è disponibile nell’app Mac installata." });
    return;
  }
  renderUpdateStatus({
    ...(state.updateStatus || {}),
    phase: "checking",
    manual: true,
  });
  appBridge.checkForUpdates({ manual: true })
    .then((status) => renderUpdateStatus(status))
    .catch((error) => renderUpdateStatus({ phase: "error", manual: true, error: error.message }));
});

ui.updateLaterButton.addEventListener("click", () => ui.updateDialog.close());

ui.downloadUpdateButton.addEventListener("click", () => {
  if (!appBridge) return;
  ui.downloadUpdateButton.disabled = true;
  appBridge.downloadUpdate()
    .then((status) => renderUpdateStatus(status))
    .catch((error) => renderUpdateStatus({ phase: "error", manual: true, error: error.message }))
    .finally(() => { ui.downloadUpdateButton.disabled = false; });
});

ui.installUpdateButton.addEventListener("click", () => {
  if (!appBridge) return;
  ui.installUpdateButton.disabled = true;
  appBridge.installUpdate().then((started) => {
    if (!started) {
      ui.installUpdateButton.disabled = false;
      renderUpdateStatus({ phase: "error", manual: true, error: "L’aggiornamento non è ancora pronto per l’installazione." });
    }
  }).catch((error) => {
    ui.installUpdateButton.disabled = false;
    renderUpdateStatus({ phase: "error", manual: true, error: error.message });
  });
});

let dragDepth = 0;

function preventBrowserNavigation(event) {
  event.preventDefault();
  event.stopPropagation();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
}

window.addEventListener("dragenter", (event) => {
  if (state.draggingPage) return;
  preventBrowserNavigation(event);
  dragDepth += 1;
  ui.dropZone.classList.add("is-dragging");
}, true);

window.addEventListener("dragover", (event) => {
  if (state.draggingPage) return;
  preventBrowserNavigation(event);
}, true);

window.addEventListener("dragleave", (event) => {
  if (state.draggingPage) return;
  preventBrowserNavigation(event);
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) ui.dropZone.classList.remove("is-dragging");
}, true);

window.addEventListener("drop", (event) => {
  if (state.draggingPage) return;
  preventBrowserNavigation(event);
  dragDepth = 0;
  ui.dropZone.classList.remove("is-dragging");
  const file = [...event.dataTransfer.files].find((item) => {
    return item.type === "application/pdf" || item.name.toLowerCase().endsWith(".pdf");
  });

  if (!file) {
    setStatus("Trascina un file PDF valido.", true);
    return;
  }
  getLocalFilePath(file).then((filePath) => openPdfSafely(filePath, file));
}, true);

let pageResizeTimer = null;
window.addEventListener("resize", () => {
  window.clearTimeout(pageResizeTimer);
  pageResizeTimer = window.setTimeout(() => {
    if (!state.pdf || state.inlineEditor) return;
    renderPage(state.pageNumber).catch((error) => setStatus(error.message, true));
  }, 180);
});

loadFontCatalog().catch((error) => {
  console.warn("Catalogo font non disponibile:", error);
});

console.log("Renderer PDF editor pronto");
