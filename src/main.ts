import { convertFileSrc, invoke, isTauri } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { resolveResource } from "@tauri-apps/api/path";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open, save } from "@tauri-apps/plugin-dialog";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";

const allowedExtensions = new Set([
  // Common web/standard
  "gif", "webp", "apng", "avif", "png", "jpg", "jpeg", "jpe", "jfif",
  "bmp", "dib", "rle", "tif", "tiff", "ico", "icon", "svg", "svgz",
  "heic", "heif", "jxl", "jp2", "j2k", "jpf", "jpm", "jpx",
  "wdp", "hdp", "tga", "dds", "exr", "hdr", "pic",
  "pbm", "pgm", "ppm", "pnm", "qoi",
  // Adobe / Design
  "psd", "psb", "ai", "eps", "epsf", "epsi",
  // GIMP
  "xcf",
  // Camera RAW
  "cr2", "cr3", "nef", "nrw", "arw", "dng", "orf", "rw2", "raf",
  "srw", "pef", "dcr", "mrw", "x3f", "erf", "raw", "rwl", "kdc",
  // Legacy / Other
  "pcx", "pict", "pct", "sgi", "rgb", "rgba", "bpg", "cin", "dpx",
  "fits", "fts", "fit", "dcm", "cur", "ani", "xpm", "xbm",
  "mng", "jng", "miff", "palm", "wbmp", "otb",
  "pam", "pfm", "pgx", "vtf", "flif", "jbig", "jbig2",
  // PDF (first page)
  "pdf",
]);
const editableExtensions = new Set([
  "png",
  "jpg",
  "jpeg",
  "webp",
  "avif",
  "tif",
  "tiff",
  "bmp",
]);
const editCanvasSaveExtensions = new Set([
  "png",
  "jpg",
  "jpeg",
  "webp",
  "avif",
  "bmp",
  "tif",
  "tiff",
]);
const EDIT_SAVE_DIALOG_FILTERS: Array<{ name: string; extensions: string[] }> = [
  { name: "PNG", extensions: ["png"] },
  { name: "JPEG", extensions: ["jpg", "jpeg"] },
  { name: "WEBP", extensions: ["webp"] },
  { name: "AVIF", extensions: ["avif"] },
  { name: "BMP", extensions: ["bmp"] },
  { name: "TIFF", extensions: ["tif", "tiff"] },
];

const MIN_SCALE = 0.05;
const MAX_SCALE = 8;
const MIN_FRAME_MS = 8;
const animatedDecodeExtensions = new Set(["gif", "webp", "apng", "avif", "png"]);
const nativePreferredStaticExtensions = new Set([
  "jpg",
  "jpeg",
  "jpe",
  "jfif",
  "png",
  "bmp",
  "dib",
  "avif",
  "heic",
  "heif",
]);
const staticDecodeExtensions = new Set(Array.from(allowedExtensions));
const vectorStaticExtensions = new Set([
  "svg",
  "svgz",
  "pdf",
  "ai",
  "eps",
  "epsf",
  "epsi",
]);
const VECTOR_DISPLAY_DPI = 72;
const VECTOR_BASE_DPI = VECTOR_DISPLAY_DPI;
const VECTOR_MAX_DPI = 1200;
const ENABLE_VECTOR_REDECODE = false;
const ZOOM_ANIMATION_BASE_MS = 140;
const ZOOM_ANIMATION_MAX_MS = 260;
const ZOOM_FOLLOW_STIFFNESS = 0.26;
const ZOOM_STEP = 0.05;
const ADAPTIVE_ZOOM_MAX_FACTOR = 6;
const KEY_HOLD_ZOOM_INITIAL_DELAY_MS = 500;
const KEY_HOLD_ZOOM_REPEAT_MS = 35;
const KEY_HOLD_ZOOM_MULTIPLIER = 2;
const WHEEL_BURST_WINDOW_MS = 90;
const PREFETCH_QUEUE_TARGET = 3;
const PREFETCH_QUEUE_MIN_TARGET = 1;
const LOADING_OVERLAY_DELAY_MS = 1000;
const NAV_OVERLAY_IDLE_MS = 1000;
const ALPHA_SCAN_MAX_SIDE = 128;
const ALPHA_SCAN_REFINE_MAX_SIDE = 512;
const ALPHA_THRESHOLD = 250;
const ALPHA_STRICT_THRESHOLD = 220;
const ALPHA_STRICT_MIN_HITS = 8;
const alphaCapableStaticExtensions = new Set([
  "png",
  "apng",
  "gif",
  "webp",
  "avif",
  "ico",
  "icon",
  "svg",
  "svgz",
  "heic",
  "heif",
  "tif",
  "tiff",
  "jxl",
  "qoi",
]);

const openBtn = document.querySelector<HTMLButtonElement>("#open-btn");
const placeholderOpenBtn = document.querySelector<HTMLButtonElement>("#placeholder-open-btn");
const metaBtn = document.querySelector<HTMLButtonElement>("#meta-btn");
const fitBtn = document.querySelector<HTMLButtonElement>("#fit-btn");
const resetBtn = document.querySelector<HTMLButtonElement>("#reset-btn");
const fullscreenBtn = document.querySelector<HTMLButtonElement>("#fullscreen-btn");
const fullscreenBtnLabelEl = fullscreenBtn?.querySelector<HTMLElement>(".fullscreen-btn-label") ?? null;
const dropZone = document.querySelector<HTMLElement>("#drop-zone");
const viewerLayoutEl = document.querySelector<HTMLElement>("#viewer-layout");
const canvas = document.querySelector<HTMLCanvasElement>("#viewer-canvas");
const viewerImage = document.querySelector<HTMLImageElement>("#viewer-image");
const viewerSvgFrame = document.querySelector<HTMLIFrameElement>("#viewer-svg");
const metaPanelEl = document.querySelector<HTMLElement>("#meta-panel");
const metaFileNameEl = document.querySelector<HTMLElement>("#meta-file-name");
const metaExtensionEl = document.querySelector<HTMLElement>("#meta-extension");
const metaResolutionEl = document.querySelector<HTMLElement>("#meta-resolution");
const metaSizeEl = document.querySelector<HTMLElement>("#meta-size");
const metaModifiedEl = document.querySelector<HTMLElement>("#meta-modified");
const metaCreatedEl = document.querySelector<HTMLElement>("#meta-created");
const metaReadonlyEl = document.querySelector<HTMLElement>("#meta-readonly");
const metaPathEl = document.querySelector<HTMLElement>("#meta-path");
const metaStatusEl = document.querySelector<HTMLElement>("#meta-status");
const metaDetailsListEl = document.querySelector<HTMLElement>("#meta-details-list");
const fileNameEl = document.querySelector<HTMLElement>("#file-name");
const fileMetaEl = document.querySelector<HTMLElement>("#file-meta");
const zoomLevelEl = document.querySelector<HTMLElement>("#zoom-level");
const zoomSliderEl = document.querySelector<HTMLInputElement>("#zoom-slider");
const zoomOutBtn = document.querySelector<HTMLButtonElement>("#zoom-out-btn");
const zoomInBtn = document.querySelector<HTMLButtonElement>("#zoom-in-btn");
const loadingTextEl = document.querySelector<HTMLElement>("#loading-text");
const loadingFillEl = document.querySelector<HTMLElement>("#loading-fill");
const loadingPercentEl = document.querySelector<HTMLElement>("#loading-percent");
const stageNoticeEl = document.querySelector<HTMLElement>("#stage-notice");
const stageNoticeTitleEl = document.querySelector<HTMLElement>("#stage-notice-title");
const stageNoticeBodyEl = document.querySelector<HTMLElement>("#stage-notice-body");
const prevBtn = document.querySelector<HTMLButtonElement>("#prev-btn");
const nextBtn = document.querySelector<HTMLButtonElement>("#next-btn");
const animControlsEl = document.querySelector<HTMLElement>("#anim-controls");
const playToggleBtn = document.querySelector<HTMLButtonElement>("#play-toggle-btn");
const playToggleIcon = document.querySelector<HTMLElement>("#play-toggle-icon");
const framePrevBtn = document.querySelector<HTMLButtonElement>("#frame-prev-btn");
const frameNextBtn = document.querySelector<HTMLButtonElement>("#frame-next-btn");
const frameSliderEl = document.querySelector<HTMLInputElement>("#frame-slider");
const frameLabelEl = document.querySelector<HTMLElement>("#frame-label");
const bottomDeleteBtn = document.querySelector<HTMLButtonElement>("#bottom-delete-btn");
const bottomCopyBtn = document.querySelector<HTMLButtonElement>("#bottom-copy-btn");
const bottomShareBtn = document.querySelector<HTMLButtonElement>("#bottom-share-btn");
const bottomPrintBtn = document.querySelector<HTMLButtonElement>("#bottom-print-btn");
const bottomRotateBtn = document.querySelector<HTMLButtonElement>("#bottom-rotate-btn");
const bottomEditBtn = document.querySelector<HTMLButtonElement>("#bottom-edit-btn");
const bottomMoreBtn = document.querySelector<HTMLButtonElement>("#bottom-more-btn");
const bottomMoreMenuEl = document.querySelector<HTMLElement>("#bottom-more-menu");
const thumbnailStripEl = document.querySelector<HTMLElement>("#thumbnail-strip");
const thumbnailListEl = document.querySelector<HTMLElement>("#thumbnail-list");
const setWallpaperBtn = document.querySelector<HTMLButtonElement>("#set-wallpaper-btn");
const revealInExplorerBtn = document.querySelector<HTMLButtonElement>("#reveal-in-explorer-btn");
const copyFilePathBtn = document.querySelector<HTMLButtonElement>("#copy-file-path-btn");
const titlebarSettingsBtn = document.querySelector<HTMLButtonElement>("#titlebar-settings-btn");
const titlebarSettingsMenuEl = document.querySelector<HTMLElement>("#titlebar-settings-menu");
const titlebarMoreBtn = document.querySelector<HTMLButtonElement>("#titlebar-more-btn");
const titlebarMoreMenuEl = document.querySelector<HTMLElement>("#titlebar-more-menu");
const appLicenseInfoBtn = document.querySelector<HTMLButtonElement>("#app-license-info-btn");
const openSourceLicenseInfoBtn = document.querySelector<HTMLButtonElement>("#open-source-license-info-btn");
const helpOpenBtn = document.querySelector<HTMLButtonElement>("#help-open-btn");
const updateCheckBtn = document.querySelector<HTMLButtonElement>("#update-check-btn");
const updateCheckBadgeEl = document.querySelector<HTMLElement>("#update-check-badge");
const titlebarEyedropperBtn = document.querySelector<HTMLButtonElement>("#titlebar-eyedropper-btn");
const titlebarPickedColorBtn = document.querySelector<HTMLButtonElement>("#titlebar-picked-color-btn");
const titlebarEyedropperToastEl = document.querySelector<HTMLElement>("#titlebar-eyedropper-toast");
const stageContextMenuEl = document.querySelector<HTMLElement>("#stage-context-menu");
const ctxDeleteBtn = document.querySelector<HTMLButtonElement>("#ctx-delete-btn");
const ctxCopyBtn = document.querySelector<HTMLButtonElement>("#ctx-copy-btn");
const ctxShareBtn = document.querySelector<HTMLButtonElement>("#ctx-share-btn");
const ctxPrintBtn = document.querySelector<HTMLButtonElement>("#ctx-print-btn");
const ctxRotateBtn = document.querySelector<HTMLButtonElement>("#ctx-rotate-btn");
const ctxEditBtn = document.querySelector<HTMLButtonElement>("#ctx-edit-btn");
const ctxImageInfoBtn = document.querySelector<HTMLButtonElement>("#ctx-image-info-btn");
const ctxSetWallpaperBtn = document.querySelector<HTMLButtonElement>("#ctx-set-wallpaper-btn");
const ctxRevealInExplorerBtn = document.querySelector<HTMLButtonElement>("#ctx-reveal-in-explorer-btn");
const ctxCopyFilePathBtn = document.querySelector<HTMLButtonElement>("#ctx-copy-file-path-btn");
const appModalEl = document.querySelector<HTMLElement>("#app-modal");
const appModalBackdropEl = document.querySelector<HTMLElement>("#app-modal-backdrop");
const appModalTitleEl = document.querySelector<HTMLElement>("#app-modal-title");
const appModalMessageEl = document.querySelector<HTMLElement>("#app-modal-message");
const appModalCancelBtn = document.querySelector<HTMLButtonElement>("#app-modal-cancel");
const appModalOkBtn = document.querySelector<HTMLButtonElement>("#app-modal-ok");
const updateModalEl = document.querySelector<HTMLElement>("#update-modal");
const updateModalBackdropEl = document.querySelector<HTMLElement>("#update-modal-backdrop");
const updateModalCloseBtn = document.querySelector<HTMLButtonElement>("#update-modal-close-btn");
const updateModalStatusEl = document.querySelector<HTMLElement>("#update-modal-status");
const updateModalLatestVersionEl = document.querySelector<HTMLElement>("#update-modal-latest-version");
const updateModalCurrentVersionEl = document.querySelector<HTMLElement>("#update-modal-current-version");
const updateModalChangelogWrapEl = document.querySelector<HTMLElement>("#update-modal-changelog-wrap");
const updateModalChangelogListEl = document.querySelector<HTMLElement>("#update-modal-changelog-list");
const updateModalChangelogEmptyEl = document.querySelector<HTMLElement>("#update-modal-changelog-empty");
const updateModalCloseActionBtn = document.querySelector<HTMLButtonElement>("#update-modal-close-action-btn");
const updateModalOpenPageBtn = document.querySelector<HTMLButtonElement>("#update-modal-open-page-btn");
const appLicenseModalEl = document.querySelector<HTMLElement>("#app-license-modal");
const appLicenseModalBackdropEl = document.querySelector<HTMLElement>("#app-license-modal-backdrop");
const appLicenseModalCloseBtn = document.querySelector<HTMLButtonElement>("#app-license-modal-close-btn");
const appLicenseModalLoadingEl = document.querySelector<HTMLElement>("#app-license-modal-loading");
const appLicenseModalContentEl = document.querySelector<HTMLElement>("#app-license-modal-content");
const editModalEl = document.querySelector<HTMLElement>("#edit-modal");
const editModalBackdropEl = document.querySelector<HTMLElement>("#edit-modal-backdrop");
const editCloseBtn = document.querySelector<HTMLButtonElement>("#edit-close-btn");
const editResetBtn = document.querySelector<HTMLButtonElement>("#edit-reset-btn");
const editUndoBtn = document.querySelector<HTMLButtonElement>("#edit-undo-btn");
const editCancelBtn = document.querySelector<HTMLButtonElement>("#edit-cancel-btn");
const editSaveAsBtn = document.querySelector<HTMLButtonElement>("#edit-save-as-btn");
const editApplyBtn = document.querySelector<HTMLButtonElement>("#edit-apply-btn");
const editUndoTipEl = document.querySelector<HTMLElement>(".edit-undo-tip");
const editCanvasEl = document.querySelector<HTMLCanvasElement>("#edit-canvas");
const editCanvasWrapEl = document.querySelector<HTMLElement>(".edit-canvas-wrap");
const editBrushCursorEl = document.querySelector<HTMLElement>("#edit-brush-cursor");
const editCropHandleLayerEl = document.querySelector<HTMLElement>("#edit-crop-handle-layer");
const editCropHandleEls = document.querySelectorAll<HTMLElement>(".edit-crop-handle");
const editCropSelectedWidthValueEl = document.querySelector<HTMLElement>("#edit-crop-selected-width-value");
const editCropSelectedHeightValueEl = document.querySelector<HTMLElement>("#edit-crop-selected-height-value");
const editTabInsertBtn = document.querySelector<HTMLButtonElement>("#edit-tab-insert-btn");
const editTabColorBtn = document.querySelector<HTMLButtonElement>("#edit-tab-color-btn");
const editTabCropBtn = document.querySelector<HTMLButtonElement>("#edit-tab-crop-btn");
const editTabRotateBtn = document.querySelector<HTMLButtonElement>("#edit-tab-rotate-btn");
const editTabInsertPanelEl = document.querySelector<HTMLElement>("#edit-tab-insert-panel");
const editTabColorPanelEl = document.querySelector<HTMLElement>("#edit-tab-color-panel");
const editTabCropPanelEl = document.querySelector<HTMLElement>("#edit-tab-crop-panel");
const editTabRotatePanelEl = document.querySelector<HTMLElement>("#edit-tab-rotate-panel");
const editCropApplyBtn = document.querySelector<HTMLButtonElement>("#edit-crop-apply-btn");
const editCropSizeWidthEl = document.querySelector<HTMLInputElement>("#edit-crop-size-width");
const editCropSizeHeightEl = document.querySelector<HTMLInputElement>("#edit-crop-size-height");
const editCropTrimTopEl = document.querySelector<HTMLInputElement>("#edit-crop-trim-top");
const editCropTrimLeftEl = document.querySelector<HTMLInputElement>("#edit-crop-trim-left");
const editCropTrimRightEl = document.querySelector<HTMLInputElement>("#edit-crop-trim-right");
const editCropTrimBottomEl = document.querySelector<HTMLInputElement>("#edit-crop-trim-bottom");
const editCropStepperBtnEls = document.querySelectorAll<HTMLButtonElement>(".edit-crop-stepper-btn");
const editCropAspectSelectEl = document.querySelector<HTMLSelectElement>("#edit-crop-aspect-select");
const editCropCustomAspectWrapEl = document.querySelector<HTMLElement>("#edit-crop-custom-aspect-wrap");
const editCropCustomAspectWidthEl = document.querySelector<HTMLInputElement>("#edit-crop-custom-aspect-width");
const editCropCustomAspectHeightEl = document.querySelector<HTMLInputElement>("#edit-crop-custom-aspect-height");
const editCropCenterHorizontalBtn = document.querySelector<HTMLButtonElement>("#edit-crop-center-horizontal-btn");
const editCropCenterVerticalBtn = document.querySelector<HTMLButtonElement>("#edit-crop-center-vertical-btn");
const editTransformRotateLeftBtn = document.querySelector<HTMLButtonElement>("#edit-transform-rotate-left-btn");
const editTransformRotateRightBtn = document.querySelector<HTMLButtonElement>("#edit-transform-rotate-right-btn");
const editTransformFlipHorizontalBtn = document.querySelector<HTMLButtonElement>("#edit-transform-flip-horizontal-btn");
const editTransformFlipVerticalBtn = document.querySelector<HTMLButtonElement>("#edit-transform-flip-vertical-btn");
const editToolBrushBtn = document.querySelector<HTMLButtonElement>("#edit-tool-brush-btn");
const editToolTextBtn = document.querySelector<HTMLButtonElement>("#edit-tool-text-btn");
const editToolShapeBtn = document.querySelector<HTMLButtonElement>("#edit-tool-shape-btn");
const editToolMosaicBtn = document.querySelector<HTMLButtonElement>("#edit-tool-mosaic-btn");
const editToolBlurBtn = document.querySelector<HTMLButtonElement>("#edit-tool-blur-btn");
const editShapeSelectEl = document.querySelector<HTMLSelectElement>("#edit-shape-select");
const editBrushModeSelectEl = document.querySelector<HTMLSelectElement>("#edit-brush-mode-select");
const editMosaicStyleSelectEl = document.querySelector<HTMLSelectElement>("#edit-mosaic-style-select");
const editMosaicIntensityInputEl = document.querySelector<HTMLInputElement>("#edit-mosaic-intensity-input");
const editMosaicIntensityValueEl = document.querySelector<HTMLElement>("#edit-mosaic-intensity-value");
const editBlurStyleSelectEl = document.querySelector<HTMLSelectElement>("#edit-blur-style-select");
const editBlurIntensityInputEl = document.querySelector<HTMLInputElement>("#edit-blur-intensity-input");
const editBlurIntensityValueEl = document.querySelector<HTMLElement>("#edit-blur-intensity-value");
const editColorToolButtonEls = document.querySelectorAll<HTMLButtonElement>(".edit-color-tool-item");
const editColorLayerTitleEl = document.querySelector<HTMLElement>("#edit-color-layer-title");
const editColorLayerListEl = document.querySelector<HTMLElement>("#edit-color-layer-list");
const editColorLayerControlTitleEl = document.querySelector<HTMLElement>("#edit-color-layer-control-title");
const editColorLayerControlWrapEl = document.querySelector<HTMLElement>("#edit-color-layer-control-wrap");
const editColorSelectedLayerNameEl = document.querySelector<HTMLElement>("#edit-color-selected-layer-name");
const editColorLayerSliderWrapEl = document.querySelector<HTMLElement>("#edit-color-layer-slider-wrap");
const editColorLayerValueInputEl = document.querySelector<HTMLInputElement>("#edit-color-layer-value-input");
const editColorLayerValueTextEl = document.querySelector<HTMLElement>("#edit-color-layer-value-text");
const editColorCurveEditorWrapEl = document.querySelector<HTMLElement>("#edit-color-curve-editor-wrap");
const editColorCurveChannelBtnEls = document.querySelectorAll<HTMLButtonElement>(".edit-color-curve-channel-btn");
const editColorCurveCanvasEl = document.querySelector<HTMLCanvasElement>("#edit-color-curve-canvas");
const editColorLutEditorWrapEl = document.querySelector<HTMLElement>("#edit-color-lut-editor-wrap");
const editColorLutLoadBtn = document.querySelector<HTMLButtonElement>("#edit-color-lut-load-btn");
const editColorLutNameEl = document.querySelector<HTMLElement>("#edit-color-lut-name");
const editColorLayerResetBtn = document.querySelector<HTMLButtonElement>("#edit-color-layer-reset-btn");
const editColorInputEl = document.querySelector<HTMLInputElement>("#edit-color-input");
const editColorSwatchEls = document.querySelectorAll<HTMLButtonElement>(".edit-color-swatch");
const editSizeInputEl = document.querySelector<HTMLInputElement>("#edit-size-input");
const editSizeValueEl = document.querySelector<HTMLElement>("#edit-size-value");
const editTextInputEl = document.querySelector<HTMLInputElement>("#edit-text-input");
const editTextAlignSelectEl = document.querySelector<HTMLSelectElement>("#edit-text-align-select");
const editFontSelectEl = document.querySelector<HTMLSelectElement>("#edit-font-select");
const editTextDeleteBtn = document.querySelector<HTMLButtonElement>("#edit-text-delete-btn");
const editLayerListEl = document.querySelector<HTMLElement>("#edit-layer-list");
const editSettingsEmptyEl = document.querySelector<HTMLElement>("#edit-settings-empty");
const editSettingsTextRowEl = document.querySelector<HTMLElement>("#edit-settings-text-row");
const editSettingsFieldGridEl = document.querySelector<HTMLElement>("#edit-settings-field-grid");
const editFieldShapeWrapEl = document.querySelector<HTMLElement>("#edit-field-shape-wrap");
const editFieldFontWrapEl = document.querySelector<HTMLElement>("#edit-field-font-wrap");
const editFieldBrushModeWrapEl = document.querySelector<HTMLElement>("#edit-field-brush-mode-wrap");
const editFieldMosaicStyleWrapEl = document.querySelector<HTMLElement>("#edit-field-mosaic-style-wrap");
const editFieldMosaicIntensityWrapEl = document.querySelector<HTMLElement>("#edit-field-mosaic-intensity-wrap");
const editFieldBlurStyleWrapEl = document.querySelector<HTMLElement>("#edit-field-blur-style-wrap");
const editFieldBlurIntensityWrapEl = document.querySelector<HTMLElement>("#edit-field-blur-intensity-wrap");
const editFieldAlignWrapEl = document.querySelector<HTMLElement>("#edit-field-align-wrap");
const editFieldColorWrapEl = document.querySelector<HTMLElement>("#edit-field-color-wrap");
const editFieldSizeWrapEl = document.querySelector<HTMLElement>("#edit-field-size-wrap");
const editFieldSizeLabelEl = editFieldSizeWrapEl?.querySelector<HTMLElement>(".edit-field-label") ?? null;
const editRightSettingsSectionEl = document.querySelector<HTMLElement>("#edit-right-settings-section");
const bgWhiteBtn = document.querySelector<HTMLButtonElement>("#bg-white-btn");
const bgGrayBtn = document.querySelector<HTMLButtonElement>("#bg-gray-btn");
const bgCheckerBtn = document.querySelector<HTMLButtonElement>("#bg-checker-btn");
const themeToggleBtn = document.querySelector<HTMLButtonElement>("#theme-toggle-btn");
const themeLightBtn = document.querySelector<HTMLButtonElement>("#theme-light-btn");
const themeDarkBtn = document.querySelector<HTMLButtonElement>("#theme-dark-btn");
const bottomToastEl = document.querySelector<HTMLElement>("#bottom-toast");
const STAGE_BG_STORAGE_KEY = "hogumaview.stageBgMode";
const THEME_STORAGE_KEY = "hogumaview.themeMode";
const HELP_PAGE_URL = "https://apps.hoguma.com/apps/hogumaview/help/";
const UPDATE_MANIFEST_URL = "https://hogumaview-update.pages.dev/hogumaview-update.json";
type StageBgMode = "white" | "gray" | "checker";
type ThemeMode = "light" | "dark";
type EditTool = "none" | "brush" | "text" | "shape" | "mosaic" | "blur";
type EditSidebarTab = "insert" | "color" | "crop" | "rotate";
type EditToolWithSize = Exclude<EditTool, "none">;
type EditBrushMode = "draw" | "erase";
type EditMosaicBrushMode = "draw" | "erase";
type EditMosaicStyle = "brush" | "rect" | "ellipse";
type EditMosaicStyleSelectValue = EditMosaicStyle | "erase";
type EditBlurBrushMode = "draw" | "erase";
type EditBlurStyle = "brush" | "rect" | "ellipse";
type EditBlurStyleSelectValue = EditBlurStyle | "erase";
type EditShape = "rect" | "ellipse" | "line" | "arrow" | "double-arrow";
type EditTransformOperation = "rotate-left" | "rotate-right" | "flip-horizontal" | "flip-vertical";
type EditTextAlign = "left" | "center" | "right";
type EditCropRect = { x: number; y: number; width: number; height: number };
type EditCropDragMode = "none" | "move" | "create" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";
type EditCropMetricField = "width" | "height" | "top" | "left" | "right" | "bottom";
type EditCropAspectMode = "free" | "original" | "4:3" | "16:9" | "1:1" | "custom";
type EditTextItem = {
  id: number;
  text: string;
  lines: string[];
  x: number;
  y: number;
  size: number;
  color: string;
  align: EditTextAlign;
  fontFamily: string;
  ascent: number;
  lineHeight: number;
  width: number;
  height: number;
};
type EditUiLayerKind = "text" | "brush" | "shape" | "mosaic" | "blur";
type EditUiLayer = {
  id: number;
  kind: EditUiLayerKind;
  textId: number | null;
  rasterId: number | null;
};
type EditRasterLayer = {
  id: number;
  kind: "brush" | "shape" | "mosaic" | "blur";
  canvas: HTMLCanvasElement;
  offsetX: number;
  offsetY: number;
  hasContent: boolean;
};
type EditMosaicShapeData = {
  style: Exclude<EditMosaicStyle, "brush">;
  sx: number;
  sy: number;
  ex: number;
  ey: number;
  size: number;
};
type EditBlurShapeData = {
  style: Exclude<EditBlurStyle, "brush">;
  sx: number;
  sy: number;
  ex: number;
  ey: number;
  size: number;
};
type EditColorAdjustField = "exposure" | "contrast" | "saturation" | "temperature" | "highlights" | "shadows";
type EditColorAdjustState = Record<EditColorAdjustField, number>;
type EditColorLayerKind = EditColorAdjustField | "curve" | "lut";
type EditCurveChannel = "rgb" | "r" | "g" | "b";
type EditCurvePoint = { x: number; y: number };
type EditCurveLayerData = {
  activeChannel: EditCurveChannel;
  pointsByChannel: Record<EditCurveChannel, EditCurvePoint[]>;
};
type EditLut3DLayerData = {
  title: string;
  sourcePath: string;
  sourceName: string;
  size: number;
  domainMin: [number, number, number];
  domainMax: [number, number, number];
  inputShaper: Float32Array | null;
  table: Float32Array;
  token: number;
};
type EditColorLayer = {
  id: number;
  kind: EditColorLayerKind;
  value: number;
  lutStrength: number;
  curveData: EditCurveLayerData | null;
  lutData: EditLut3DLayerData | null;
};
type EditHistoryEntry = {
  baseImageData: ImageData;
  colorAdjust: EditColorAdjustState;
  colorLayers: EditColorLayer[];
  selectedColorLayerId: number | null;
  nextColorLayerId: number;
  textItems: EditTextItem[];
  rasterLayers: EditRasterLayer[];
  mosaicShapeByLayerId: Array<[number, EditMosaicShapeData]>;
  blurShapeByLayerId: Array<[number, EditBlurShapeData]>;
  uiLayers: EditUiLayer[];
  selectedUiLayerId: number | null;
  selectedTextId: number | null;
};
const stageBgButtons: Array<{ mode: StageBgMode; el: HTMLButtonElement | null }> = [
  { mode: "white", el: bgWhiteBtn },
  { mode: "gray", el: bgGrayBtn },
  { mode: "checker", el: bgCheckerBtn },
];
let currentScale = 1;
let offsetX = 0;
let offsetY = 0;
let dragAndDropAbortController: AbortController | null = null;
let panAndZoomAbortController: AbortController | null = null;
let tauriDropUnlistenPromise: Promise<(() => void) | null> | null = null;
let pendingVisualRotationDeg = 0;
let pendingVisualRotationPath = "";
const visualRotationByPath = new Map<string, number>();
let dragging = false;
let dragStartX = 0;
let dragStartY = 0;
let hasImage = false;
let currentFileName = "";
let currentOpenedPath = "";
let currentFileSizeBytes: number | null = null;
let currentImageExt = "";
let currentImagePathForDecode = "";
let mediaWidth = 1;
let mediaHeight = 1;
let originalMediaWidth = 0;
let originalMediaHeight = 0;
let fullscreenFillMode = false;
let renderMode: "decoder" | "vips" | "native-image" | "webview-svg" = "vips";
let contentDisplayScale = 1;
let currentImageIsVectorStatic = false;
let currentImageIsHdrJpeg = false;
let currentVectorDpi = VECTOR_BASE_DPI;
let vectorRedecodeInFlight = false;
let vectorRedecodeQueuedDpi = VECTOR_BASE_DPI;
let nativeImageProxyCanvasSourceKey = "";



type DecodedImagePayload = {
  width: number;
  height: number;
  bands: number;
  raw: Uint8Array;
  originalWidth: number;
  originalHeight: number;
};

let rafId = 0;
let playingToken = 0;
let frameDecodeInFlight = false;
let currentDecoder: any = null;
let decodedFrameCount = 1;
let nextDecodeFrameIndex = 0;
let nextFrameAt = 0;
let prefetchedFrames: Array<{ image: any; durationMs: number; frameIndex: number }> = [];
let currentPrefetchQueueTarget = PREFETCH_QUEUE_TARGET;
let currentFrameIndex = 0;
let playbackPaused = false;
let currentFrameSequencePlayable = false;
let frameSeekRequestId = 0;
let animationLoopLimit: number | null = null;
let completedAnimationLoops = 0;
let playbackStoppedByLoopLimit = false;
let folderImages: string[] = [];
let folderImageIndex = -1;
let deleteInFlight = false;
let rotateInFlight = false;
let appModalResolver: ((value: boolean) => void) | null = null;
let bottomToastTimer: number | null = null;
let bottomMoreMenuOpen = false;
let titlebarSettingsMenuOpen = false;
let titlebarMoreMenuOpen = false;
let titlebarPickedColorHex = "";
let titlebarEyedropperToastTimer: number | null = null;
let updateModalOpen = false;
let appLicenseModalOpen = false;
let appLicenseLoading = false;
let appLicenseText = "";
let updateManifestLoading = false;
let updateManifestError = "";
let updateManifest: UpdateManifest | null = null;
let updateManifestRequestId = 0;
let appVersion = "";
let hasNewUpdate = false;
let eyedropperPicking = false;
let stageContextMenuOpen = false;
let folderSyncRequestId = 0;
let stageHasAlpha = false;
let loadingOverlayTimer: number | null = null;
let loadingSession = 0;
let lastDevicePixelRatio = window.devicePixelRatio || 1;
let dprMediaQuery: MediaQueryList | null = null;
let dprMediaQueryListener: ((e: MediaQueryListEvent) => void) | null = null;
let zoomAnimationId = 0;
let zoomTargetScale = 1;
let zoomAnimationMode: "none" | "tween" | "follow" = "none";
let lastWheelInputAt = 0;
let lastViewportFitScale = 1;
let zoomFollowAnchor: ZoomAnchor | null = null;
let navOverlayTimer: number | null = null;
let isHoveringAnimControls = false;
let isHoveringStageNavButtons = false;
let keyHoldZoomDirection: 1 | -1 | null = null;
let keyHoldZoomStartTimer: number | null = null;
let keyHoldZoomRepeatTimer: number | null = null;
let stageBgMode: StageBgMode = "white";
let themeMode: ThemeMode = "light";
let editModalOpen = false;
let editSaveInFlight = false;
let editSidebarTab: EditSidebarTab = "insert";
let editToolMode: EditTool = "none";
let editBrushMode: EditBrushMode = "draw";
let editMosaicBrushMode: EditMosaicBrushMode = "draw";
let editMosaicStyle: EditMosaicStyle = "rect";
let editBlurBrushMode: EditBlurBrushMode = "draw";
let editBlurStyle: EditBlurStyle = "rect";
let editDrawing = false;
let editDrawingPointerId: number | null = null;
let editStartX = 0;
let editStartY = 0;
let editLastX = 0;
let editLastY = 0;
let editBrushSmoothedX: number | null = null;
let editBrushSmoothedY: number | null = null;
let editCursorHasClientPoint = false;
let editCursorClientX = 0;
let editCursorClientY = 0;
let editBaseImageData: ImageData | null = null;
let editTextItems: EditTextItem[] = [];
let editNextTextId = 1;
let editSelectedTextId: number | null = null;
let editRasterLayers: EditRasterLayer[] = [];
let editNextRasterLayerId = 1;
let editUiLayers: EditUiLayer[] = [];
let editNextUiLayerId = 1;
let editSelectedUiLayerId: number | null = null;
let editLayerDragJustDropped = false;
let editLayerDropClearTimer: number | null = null;
let editLayerPointerDragCleanup: (() => void) | null = null;
let editDraggingTextId: number | null = null;
let editDraggingTextOffsetX = 0;
let editDraggingTextOffsetY = 0;
let editDraggingTextMoved = false;
let editDraggingShapeLayerId: number | null = null;
let editDraggingShapeMoved = false;
let editDraggingMosaicShapeLayerId: number | null = null;
let editDraggingMosaicShapeMoved = false;
let editDraggingBlurShapeLayerId: number | null = null;
let editDraggingBlurShapeMoved = false;
let editHistory: EditHistoryEntry[] = [];
let editHistoryIndex = -1;
let editDrawingRasterLayerId: number | null = null;
let editDrawingBrushLayerIds: number[] = [];
let editDrawingMosaicLayerIds: number[] = [];
let editDrawingBlurLayerIds: number[] = [];
let editMosaicSourceData: ImageData | null = null;
let editMosaicShapeByLayerId = new Map<number, EditMosaicShapeData>();
let editMosaicSelectionOverlaySuppressedRasterId: number | null = null;
let editBlurSourceCanvas: HTMLCanvasElement | null = null;
let editBlurShapeByLayerId = new Map<number, EditBlurShapeData>();
let editBlurSelectionOverlaySuppressedRasterId: number | null = null;
let editCropRect: EditCropRect | null = null;
let editCropDragging = false;
let editCropDragMode: EditCropDragMode = "none";
let editCropDragStartRect: EditCropRect | null = null;
let editCropAspectMode: EditCropAspectMode = "free";
let editCropCustomAspectWidth = 1;
let editCropCustomAspectHeight = 1;
let metaPanelVisible = false;
let metaPanelRequestId = 0;
let fileSizeRequestId = 0;
let lastStatusResolutionWidth = -1;
let lastStatusResolutionHeight = -1;
const decodePayloadCache = new Map<string, DecodedImagePayload>();
const decodePayloadInFlight = new Map<string, Promise<DecodedImagePayload | null>>();
const decodePayloadCacheOrder: string[] = [];
const hdrJpegByPath = new Map<string, boolean>();
const hdrJpegInFlightByPath = new Map<string, Promise<boolean>>();
const DECODE_PREFETCH_CACHE_LIMIT = 4;
const EDIT_BRUSH_SMOOTHING_FACTOR = 0.34;
const EDIT_HISTORY_LIMIT = 30;
const EDIT_LAYER_DRAG_START_THRESHOLD_PX = 4;
const EDIT_SIZE_PERCENT_STEP = 0.1;
const EDIT_SIZE_PERCENT_MIN = 0.1;
const EDIT_SIZE_PERCENT_MAX = 8.0;
const EDIT_SIZE_PERCENT_DEFAULT = 0.3;
const EDIT_COLOR_ADJUST_MIN = -100;
const EDIT_COLOR_ADJUST_MAX = 100;
const EDIT_LUT_STRENGTH_MIN = 0;
const EDIT_LUT_STRENGTH_MAX = 200;
const EDIT_LUT_STRENGTH_DEFAULT = 100;
const EDIT_COLOR_ADJUST_DRAFT_MAX_PIXELS = 1280 * 720;
const EDIT_COLOR_LAYER_KIND_ORDER: EditColorLayerKind[] = [
  "exposure",
  "contrast",
  "curve",
  "lut",
  "saturation",
  "temperature",
  "shadows",
  "highlights",
];
const EDIT_COLOR_LAYER_LABEL: Record<EditColorLayerKind, string> = {
  exposure: "노출",
  contrast: "대비",
  curve: "커브",
  lut: "LUT",
  saturation: "채도",
  temperature: "색온도",
  shadows: "그림자",
  highlights: "하이라이트",
};
const EDIT_CURVE_CHANNEL_ORDER: EditCurveChannel[] = ["rgb", "r", "g", "b"];
const EDIT_CURVE_CHANNEL_COLOR: Record<EditCurveChannel, string> = {
  rgb: "#ff8a00",
  r: "#ef4444",
  g: "#22c55e",
  b: "#3b82f6",
};
const EDIT_CURVE_CANVAS_PADDING = 10;
const EDIT_CURVE_HIT_RADIUS = 10;
const EDIT_CURVE_DRAG_EPSILON = 0.01;
const EDIT_TEXT_SIZE_PERCENT_MIN = 1.5;
const EDIT_MOSAIC_SIZE_PERCENT_MIN = 4.0;
const EDIT_MOSAIC_SIZE_PERCENT_MAX = 23.9;
const EDIT_MOSAIC_BRUSH_SIZE_PERCENT_MIN = 1.0;
const EDIT_MOSAIC_BRUSH_SIZE_PERCENT_MAX = 8.9;
const EDIT_MOSAIC_BRUSH_SIZE_PERCENT_DEFAULT = 1.9;
const EDIT_MOSAIC_INTENSITY_PERCENT_DEFAULT = 4.9;
const EDIT_MOSAIC_BLOCK_MIN_PX = 4;
const EDIT_MOSAIC_BLOCK_MIN_RATIO = 0.008;
const EDIT_MOSAIC_BLOCK_MAX_RATIO = 0.07;
const EDIT_BLUR_BRUSH_SIZE_PERCENT_MIN = EDIT_MOSAIC_BRUSH_SIZE_PERCENT_MIN;
const EDIT_BLUR_BRUSH_SIZE_PERCENT_MAX = EDIT_MOSAIC_BRUSH_SIZE_PERCENT_MAX;
const EDIT_BLUR_BRUSH_SIZE_PERCENT_DEFAULT = EDIT_MOSAIC_BRUSH_SIZE_PERCENT_DEFAULT;
const EDIT_BLUR_INTENSITY_PERCENT_DEFAULT = EDIT_MOSAIC_INTENSITY_PERCENT_DEFAULT;
const EDIT_BLUR_RADIUS_MIN_PX = 1;
const EDIT_BLUR_RADIUS_MIN_RATIO = 0.002;
const EDIT_BLUR_RADIUS_MAX_RATIO = 0.02;
const EDIT_CROP_MIN_SIZE_PX = 8;
const EDIT_CROP_HANDLE_SIZE_CSS_PX = 10;
const EDIT_CROP_HIT_PADDING_CSS_PX = 6;
const EDIT_CROP_ASPECT_EPSILON = 0.0001;
const EDIT_TEXT_SIZE_PERCENT_DEFAULT = 3.4;
const EDIT_TEXT_SIZE_PERCENT_MAX = 91.4;
const EDIT_COLOR_DEFAULT = "#ff8a00";
const DND_DEBUG_LOG_LIMIT = 300;
const EDIT_TEXT_FONT_DEFAULT = "Segoe UI";
const EDIT_TEXT_FONT_FALLBACK = "sans-serif";
const EDIT_TEXT_FONT_FALLBACK_LIST = [
  EDIT_TEXT_FONT_DEFAULT,
  "Malgun Gothic",
  "맑은 고딕",
  "Arial",
  "Noto Sans KR",
];
const THUMBNAIL_SIZE_PX = 160;
const THUMBNAIL_PLACEHOLDER_SRC = "data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='90' viewBox='0 0 160 90'%3E%3Crect width='160' height='90' fill='%23f5f5f7'/%3E%3Cg transform='translate(68,%2033)' stroke='%23c5ccd9' stroke-width='1.8' fill='none' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='3' y='3' width='18' height='18' rx='3' ry='3'/%3E%3Ccircle cx='8.5' cy='8.5' r='1.5'/%3E%3Cpolyline points='21 15 16 10 5 21'/%3E%3C/g%3E%3C/svg%3E";
const thumbnailPathToSrc = new Map<string, string>();
const thumbnailInFlight = new Map<string, Promise<string | null>>();
let thumbnailRenderToken = 0;
let thumbnailRenderedPaths: string[] = [];
let thumbnailObserver: IntersectionObserver | null = null;
let thumbnailWheelTargetLeft: number | null = null;
let thumbnailWheelRaf = 0;
let thumbnailStripVisible = false;
let thumbnailViewportSyncRaf = 0;
let editCanvasWrapResizeObserver: ResizeObserver | null = null;
let editCanvasDisplaySyncRaf = 0;
let editSizeRatioByTool = makeDefaultEditSizeRatioByTool();
let editColorByTool = makeDefaultEditColorByTool();
let editMosaicIntensityPercent = EDIT_MOSAIC_INTENSITY_PERCENT_DEFAULT;
let editBlurIntensityPercent = EDIT_BLUR_INTENSITY_PERCENT_DEFAULT;
let editCurrentTextFontFamily = EDIT_TEXT_FONT_DEFAULT;
let editColorAdjustState: EditColorAdjustState = {
  exposure: 0,
  contrast: 0,
  saturation: 0,
  temperature: 0,
  highlights: 0,
  shadows: 0,
};
let editColorLayers: EditColorLayer[] = [];
let editSelectedColorLayerId: number | null = null;
let editNextColorLayerId = 1;
let editColorAdjustedSourceRef: ImageData | null = null;
let editColorAdjustedStateKey = "";
let editColorAdjustedCache: ImageData | null = null;
let editColorAdjustBaseCanvasSourceRef: ImageData | null = null;
let editColorAdjustBaseCanvas: HTMLCanvasElement | null = null;
let editColorAdjustedDraftSourceRef: ImageData | null = null;
let editColorAdjustedDraftStateKey = "";
let editColorAdjustedDraftSizeKey = "";
let editColorAdjustedDraftCanvas: HTMLCanvasElement | null = null;
let editColorAdjustPreviewRaf = 0;
let editColorCurveDraggingPointerId: number | null = null;
let editColorCurveDraggingLayerId: number | null = null;
let editColorCurveDraggingChannel: EditCurveChannel | null = null;
let editColorCurveDraggingPointIndex: number | null = null;
let editColorCurveDragChanged = false;
let editNextLutToken = 1;
let editAvailableFonts: EditFontCatalogEntry[] = [];
const editFontAliasesByCss = new Map<string, string[]>();
const editFontCssByAlias = new Map<string, string>();
let editFontFamiliesLoadPromise: Promise<void> | null = null;
let dndDebugLogCount = 0;
let dndDebugLastDragoverAt = 0;
let dndDebugLastStageDragoverAt = 0;
let dndDebugLastUnknownDragoverAt = 0;
let dndDebugLastUnknownDropAt = 0;

type ZoomAnchor = {
  cx: number;
  cy: number;
  localX: number;
  localY: number;
};

type ImageMetadataPayload = {
  path: string;
  fileName: string;
  extension: string;
  fileSizeBytes: number;
  readonly: boolean;
  createdUnixMs: number | null;
  modifiedUnixMs: number | null;
};

type ExifDetailPayload = {
  propertyName: string;
  value: string;
};

type UpdateManifest = {
  version?: string;
  download_url?: string;
  changelog?: string[];
};

function logDndDebug(stage: string, detail?: string) {
  if (dndDebugLogCount >= DND_DEBUG_LOG_LIMIT) return;
  dndDebugLogCount += 1;
  const timestamp = new Date().toISOString();
  const suffix = detail ? ` ${detail}` : "";
  const line = `${timestamp} #${dndDebugLogCount} ${stage}${suffix}`;
  console.info(`[dnd-debug] ${line}`);
  if (isTauri()) {
    void invoke("log_decode_route", {
      route: `dnd:${stage}`,
      source: line,
    }).catch(() => { });
  }
}

function isTextInputLikeTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return (
    el.tagName === "INPUT" ||
    el.tagName === "TEXTAREA" ||
    el.isContentEditable
  );
}

function summarizeDragTransfer(transfer: DataTransfer | null | undefined): string {
  if (!transfer) return "transfer=none";
  const types = Array.from(transfer.types ?? []);
  const items = Array.from(transfer.items ?? []);
  const itemKinds = items.map((item) => item.kind).join(",");
  const itemTypes = items.map((item) => item.type || "-").join(",");
  return [
    `types=[${types.join(",") || "-"}]`,
    `files=${transfer.files?.length ?? 0}`,
    `items=${items.length}`,
    `kinds=[${itemKinds || "-"}]`,
    `itemTypes=[${itemTypes || "-"}]`,
  ].join(" ");
}

type InstalledFontFamilyPayload = {
  cssName: string;
  displayName: string;
  aliases: string[];
};

type EditFontCatalogEntry = {
  cssName: string;
  displayName: string;
  aliases: string[];
};

const EXIF_TAG_KO: Record<string, string> = {
  NewSubfileType: "새 하위 파일 유형",
  SubfileType: "하위 파일 유형",
  ImageWidth: "이미지 너비",
  ImageLength: "이미지 높이",
  ImageDescription: "이미지 설명",
  BitsPerSample: "비트 수준",
  Compression: "압축",
  PhotometricInterpretation: "광도 해석",
  FillOrder: "채움 순서",
  DocumentName: "문서 이름",
  Make: "카메라 제조업체",
  Model: "카메라 모델",
  StripOffsets: "스트립 오프셋",
  Orientation: "방향",
  SamplesPerPixel: "샘플당 픽셀 수",
  RowsPerStrip: "스트립당 행 수",
  StripByteCounts: "스트립 바이트 수",
  XResolution: "수평 해상도",
  YResolution: "수직 해상도",
  PlanarConfiguration: "평면 구성",
  ResolutionUnit: "해상도 단위",
  TransferFunction: "전달 함수",
  WhitePoint: "백색점",
  PrimaryChromaticities: "원색 좌표",
  YCbCrCoefficients: "YCbCr 계수",
  YCbCrSubSampling: "YCbCr 서브샘플링",
  YCbCrPositioning: "YCbCr 위치",
  ReferenceBlackWhite: "기준 흑백값",
  DateTime: "수정 날짜",
  HostComputer: "호스트 컴퓨터",
  ExifIFDPointer: "EXIF IFD 포인터",
  GPSInfoIFDPointer: "GPS IFD 포인터",
  Software: "소프트웨어",
  Artist: "작성자",
  Copyright: "저작권",
  ExposureIndex: "노출 지수",
  SensitivityType: "감도 유형",
  ExposureTime: "노출 시간",
  FNumber: "F-스톱",
  ExposureProgram: "노출 프로그램",
  SpectralSensitivity: "분광 감도",
  PhotographicSensitivity: "ISO 감도",
  ISOSpeedRatings: "ISO 감도",
  StandardOutputSensitivity: "표준 출력 감도",
  RecommendedExposureIndex: "권장 노출 지수",
  ISOSpeed: "ISO 속도",
  ISOSpeedLatitudeyyy: "ISO 속도 위도 yyy",
  ISOSpeedLatitudezzz: "ISO 속도 위도 zzz",
  ExifVersion: "EXIF 버전",
  DateTimeOriginal: "원본 촬영 시각",
  DateTimeDigitized: "디지털화 시각",
  OffsetTime: "표준시 오프셋",
  OffsetTimeOriginal: "원본 표준시 오프셋",
  OffsetTimeDigitized: "디지털화 표준시 오프셋",
  ShutterSpeedValue: "셔터 속도",
  ApertureValue: "조리개 값",
  BrightnessValue: "밝기 값",
  ExposureBiasValue: "노출 보정",
  MaxApertureValue: "최대 조리개",
  SubjectDistance: "피사체 거리",
  SubjectArea: "피사체 영역",
  MeteringMode: "측광 모드",
  LightSource: "광원",
  Flash: "플래시",
  FocalLength: "초점 거리",
  SubjectLocation: "피사체 위치",
  FlashEnergy: "플래시 에너지",
  SpatialFrequencyResponse: "공간 주파수 응답",
  FocalPlaneXResolution: "초점면 X 해상도",
  FocalPlaneYResolution: "초점면 Y 해상도",
  FocalPlaneResolutionUnit: "초점면 해상도 단위",
  SubjectDistanceRange: "피사체 거리 범위",
  ImageUniqueID: "이미지 고유 ID",
  CameraOwnerName: "카메라 소유자",
  BodySerialNumber: "바디 일련번호",
  LensSpecification: "렌즈 사양",
  LensMake: "렌즈 제조업체",
  LensModel: "렌즈 모델",
  LensSerialNumber: "렌즈 일련번호",
  Gamma: "감마",
  SubSecTime: "초 미만 시각",
  SubSecTimeOriginal: "원본 초 미만 시각",
  SubSecTimeDigitized: "디지털화 초 미만 시각",
  InteroperabilityIFDPointer: "상호운용 IFD 포인터",
  FlashpixVersion: "FlashPix 버전",
  ColorSpace: "색 공간",
  PixelXDimension: "픽셀 너비",
  PixelYDimension: "픽셀 높이",
  RelatedSoundFile: "관련 사운드 파일",
  InteroperabilityIndex: "상호운용 인덱스",
  SensingMethod: "감지 방식",
  FileSource: "파일 소스",
  SceneType: "장면 유형",
  CFAPattern: "CFA 패턴",
  CustomRendered: "사용자 렌더링",
  ExposureMode: "노출 모드",
  WhiteBalance: "화이트 밸런스",
  DigitalZoomRatio: "디지털 줌 비율",
  FocalLengthIn35mmFilm: "35mm 환산 초점 거리",
  SceneCaptureType: "장면 촬영 유형",
  GainControl: "게인 제어",
  Contrast: "대비",
  Saturation: "채도",
  Sharpness: "선명도",
  DeviceSettingDescription: "장치 설정 설명",
  ImageNumber: "이미지 번호",
  SecurityClassification: "보안 등급",
  ImageHistory: "이미지 기록",
  GPSVersionID: "GPS 버전",
  GPSLatitudeRef: "GPS 위도 기준",
  GPSLatitude: "GPS 위도",
  GPSLongitudeRef: "GPS 경도 기준",
  GPSLongitude: "GPS 경도",
  GPSAltitudeRef: "GPS 고도 기준",
  GPSAltitude: "GPS 고도",
  GPSTimeStamp: "GPS 시각",
  GPSSatellites: "GPS 위성",
  GPSStatus: "GPS 상태",
  GPSMeasureMode: "GPS 측정 모드",
  GPSDOP: "GPS DOP",
  GPSSpeedRef: "GPS 속도 기준",
  GPSSpeed: "GPS 속도",
  GPSTrackRef: "GPS 진행방향 기준",
  GPSTrack: "GPS 진행방향",
  GPSImgDirectionRef: "이미지 방향 기준",
  GPSImgDirection: "이미지 방향",
  GPSMapDatum: "GPS 지도 기준",
  GPSDestLatitudeRef: "목적지 위도 기준",
  GPSDestLatitude: "목적지 위도",
  GPSDestLongitudeRef: "목적지 경도 기준",
  GPSDestLongitude: "목적지 경도",
  GPSDestBearingRef: "목적지 방위 기준",
  GPSDestBearing: "목적지 방위",
  GPSDestDistanceRef: "목적지 거리 기준",
  GPSDestDistance: "목적지 거리",
  GPSProcessingMethod: "GPS 처리 방법",
  GPSAreaInformation: "GPS 영역 정보",
  GPSDateStamp: "GPS 날짜",
  GPSDifferential: "GPS 보정",
  GPSHPositioningError: "GPS 수평 위치 오차",
  CompressionFactor: "압축 비율",
  ThumbnailOffset: "썸네일 오프셋",
  ThumbnailLength: "썸네일 길이",
  JPEGInterchangeFormat: "JPEG 교환 형식 오프셋",
  JPEGInterchangeFormatLength: "JPEG 교환 형식 길이",
  RelatedImageFileFormat: "관련 이미지 파일 형식",
  RelatedImageWidth: "관련 이미지 너비",
  RelatedImageLength: "관련 이미지 높이",
  UserComment: "사용자 설명",
  MakerNote: "제조사 메모",
  ComponentsConfiguration: "구성 요소 설정",
  CompressedBitsPerPixel: "픽셀당 압축 비트",
  CFARepeatPatternDim: "CFA 반복 패턴 크기",
  BatteryLevel: "배터리 수준",
  CompositeImage: "합성 이미지",
  CompositeImageCount: "합성 이미지 수",
  CompositeImageExposureTimes: "합성 이미지 노출 시간",
  ExposureCompensation: "노출 보정",
  ExposureWarning: "노출 경고",
  FocusWarning: "초점 경고",
  FocusMode: "초점 모드",
  FocusDistanceUpper: "초점 거리(상한)",
  FocusDistanceLower: "초점 거리(하한)",
  FaceDetect: "얼굴 감지",
  NoiseReduction: "노이즈 감소",
  SharpnessFactor: "선명도 계수",
  SaturationAdjust: "채도 조정",
  ContrastAdjust: "대비 조정",
  WhiteBalanceBias: "화이트 밸런스 바이어스",
  LensInfo: "렌즈 정보",
  LensID: "렌즈 ID",
  SerialNumber: "일련번호",
  CameraTemperature: "카메라 온도",
  ImageStabilization: "손떨림 보정",
  FirmwareVersion: "펌웨어 버전",
  OwnerName: "소유자 이름",
  Rating: "등급",
  RatingPercent: "등급(%)",
  XPTitle: "제목",
  XPComment: "설명",
  XPAuthor: "작성자",
  XPKeywords: "키워드",
  XPSubject: "주제",
  ProfileDescription: "프로파일 설명",
  ModifyDate: "수정 시각",
  CreateDate: "생성 시각",
  MetadataDate: "메타데이터 시각",
  TimeZoneOffset: "시간대 오프셋",
  ThumbnailImage: "썸네일 이미지",
  TileWidth: "타일 너비",
  TileLength: "타일 높이",
  TileOffsets: "타일 오프셋",
  TileByteCounts: "타일 바이트 수",
  BlackLevel: "블랙 레벨",
  WhiteLevel: "화이트 레벨",
  DefaultCropOrigin: "기본 자르기 시작점",
  DefaultCropSize: "기본 자르기 크기",
  CalibrationIlluminant1: "보정 광원 1",
  CalibrationIlluminant2: "보정 광원 2",
  ColorMatrix1: "색상 행렬 1",
  ColorMatrix2: "색상 행렬 2",
  CameraCalibration1: "카메라 보정 1",
  CameraCalibration2: "카메라 보정 2",
  AsShotNeutral: "촬영 당시 중립값",
  BaselineExposure: "기준 노출",
  BaselineNoise: "기준 노이즈",
  BaselineSharpness: "기준 선명도",
  LinearResponseLimit: "선형 응답 한계",
  NoiseProfile: "노이즈 프로파일",
  ProfileName: "프로파일 이름",
  ProfileHueSatMapData1: "프로파일 색상맵 데이터 1",
  ProfileHueSatMapData2: "프로파일 색상맵 데이터 2",
  ProfileToneCurve: "프로파일 톤 곡선",
  PreviewApplicationName: "미리보기 앱 이름",
  PreviewApplicationVersion: "미리보기 앱 버전",
  PreviewSettingsName: "미리보기 설정 이름",
  PreviewSettingsDigest: "미리보기 설정 다이제스트",
  PreviewColorSpace: "미리보기 색 공간",
  PreviewDateTime: "미리보기 시각",
  RawDataUniqueID: "RAW 데이터 고유 ID",
  OriginalRawFileName: "원본 RAW 파일명",
  OriginalRawFileData: "원본 RAW 파일 데이터",
  ActiveArea: "활성 영역",
  MaskedAreas: "마스킹 영역",
  OpcodeList1: "연산 목록 1",
  OpcodeList2: "연산 목록 2",
  OpcodeList3: "연산 목록 3",
  NoiseReductionApplied: "적용된 노이즈 감소",
  TimeCodes: "타임코드",
  FrameRate: "프레임 속도",
  ReelName: "릴 이름",
  CameraLabel: "카메라 라벨",
  BaselineExposureOffset: "기준 노출 오프셋",
  DepthFormat: "심도 형식",
  DepthNear: "근거리 심도",
  DepthFar: "원거리 심도",
  DepthUnits: "심도 단위",
  SemanticName: "시맨틱 이름",
  SemanticInstanceID: "시맨틱 인스턴스 ID",
  CalibrationSignature: "보정 서명",
  ProfileCalibrationSignature: "프로파일 보정 서명",
  AsShotProfileName: "촬영 당시 프로파일 이름",
  NoiseModel: "노이즈 모델",
};

function normalizePathForCompare(path: string): string {
  let normalized = path.replace(/\//g, "\\");
  if (normalized.startsWith("\\\\?\\UNC\\")) {
    normalized = `\\\\${normalized.slice(8)}`;
  } else if (normalized.startsWith("\\\\?\\")) {
    normalized = normalized.slice(4);
  }
  return normalized.toLowerCase();
}

function normalizeRotationDeg(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

function getStoredVisualRotationDeg(path: string): number {
  if (!path) return 0;
  return visualRotationByPath.get(normalizePathForCompare(path)) ?? 0;
}

function setStoredVisualRotationDeg(path: string, deg: number) {
  if (!path) return;
  const key = normalizePathForCompare(path);
  const normalized = normalizeRotationDeg(deg);
  if (normalized === 0) {
    visualRotationByPath.delete(key);
    return;
  }
  visualRotationByPath.set(key, normalized);
}

function getVisualRotationDegForCurrentPath(): number {
  const storedDeg = getStoredVisualRotationDeg(currentOpenedPath);
  if (!pendingVisualRotationPath) return storedDeg;
  if (normalizePathForCompare(pendingVisualRotationPath) !== normalizePathForCompare(currentOpenedPath)) {
    return storedDeg;
  }
  return normalizeRotationDeg(storedDeg + pendingVisualRotationDeg);
}

function getEffectiveMediaSize(): { width: number; height: number } {
  const deg = getVisualRotationDegForCurrentPath();
  if (deg === 90 || deg === 270) {
    return { width: mediaHeight, height: mediaWidth };
  }
  return { width: mediaWidth, height: mediaHeight };
}

function setStageAlphaGrid(enabled: boolean) {
  stageHasAlpha = enabled;
}

function syncStageBackgroundClass() {
  const bgClass = stageBgMode === "gray" ? "stage-bg-gray" : stageBgMode === "checker" ? "stage-bg-checker" : "stage-bg-white";
  if (dropZone) {
    dropZone.classList.remove("stage-bg-white", "stage-bg-gray", "stage-bg-checker");
    dropZone.classList.add(bgClass);
  }
  if (editCanvasWrapEl) {
    editCanvasWrapEl.classList.remove("stage-bg-white", "stage-bg-gray", "stage-bg-checker");
    editCanvasWrapEl.classList.add(bgClass);
  }
}

function applyStageBackgroundMode(mode: StageBgMode) {
  stageBgMode = mode;
  syncStageBackgroundClass();
  stageBgButtons.forEach(({ mode: btnMode, el }) => {
    if (!el) return;
    const active = btnMode === mode;
    el.classList.toggle("is-active", active);
    el.setAttribute("aria-pressed", active ? "true" : "false");
  });
  try {
    window.localStorage.setItem(STAGE_BG_STORAGE_KEY, mode);
  } catch {
    // ignore storage errors
  }
}

function loadStageBackgroundMode(): StageBgMode {
  try {
    const saved = window.localStorage.getItem(STAGE_BG_STORAGE_KEY);
    if (saved === "white" || saved === "gray" || saved === "checker") {
      return saved;
    }
  } catch {
    // ignore storage errors
  }
  return "white";
}

function applyThemeMode(mode: ThemeMode) {
  themeMode = mode;
  document.body.classList.toggle("theme-dark", mode === "dark");
  const isDark = mode === "dark";
  if (themeLightBtn) {
    themeLightBtn.classList.toggle("is-active", !isDark);
    themeLightBtn.setAttribute("aria-pressed", !isDark ? "true" : "false");
  }
  if (themeDarkBtn) {
    themeDarkBtn.classList.toggle("is-active", isDark);
    themeDarkBtn.setAttribute("aria-pressed", isDark ? "true" : "false");
  }
  if (themeToggleBtn) {
    themeToggleBtn.textContent = mode === "dark" ? "라이트" : "다크";
    themeToggleBtn.setAttribute("aria-label", mode === "dark" ? "라이트 모드 전환" : "다크 모드 전환");
  }
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    // ignore storage errors
  }
}

function loadThemeMode(): ThemeMode {
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === "light" || saved === "dark") {
      return saved;
    }
  } catch {
    // ignore storage errors
  }
  return "light";
}

function showStageNavOverlay() {
  if (!dropZone || eyedropperPicking) return;
  dropZone.classList.add("show-nav");
  if (navOverlayTimer != null) {
    window.clearTimeout(navOverlayTimer);
  }
  navOverlayTimer = window.setTimeout(() => {
    if (!dropZone || isHoveringAnimControls || isHoveringStageNavButtons) return;
    dropZone.classList.remove("show-nav");
    navOverlayTimer = null;
  }, NAV_OVERLAY_IDLE_MS);
}

function hideStageNavOverlay() {
  if (!dropZone) return;
  dropZone.classList.remove("show-nav");
  if (navOverlayTimer != null) {
    window.clearTimeout(navOverlayTimer);
    navOverlayTimer = null;
  }
}

function setLoading(active: boolean, text = "로딩 중...") {
  if (!dropZone) return;
  if (!active) {
    loadingSession += 1;
    if (loadingOverlayTimer != null) {
      window.clearTimeout(loadingOverlayTimer);
      loadingOverlayTimer = null;
    }
    dropZone.classList.remove("show-loading-overlay");
    dropZone.classList.remove("is-loading");
    loadingFillEl?.classList.remove("is-indeterminate");
    return;
  }

  loadingSession += 1;
  const session = loadingSession;

  if (loadingOverlayTimer != null) {
    window.clearTimeout(loadingOverlayTimer);
    loadingOverlayTimer = null;
  }

  if (loadingTextEl) loadingTextEl.textContent = text;
  if (loadingPercentEl) loadingPercentEl.textContent = text;
  // Hide placeholder immediately while keeping overlay delayed.
  dropZone.classList.add("is-loading");
  dropZone.classList.remove("show-loading-overlay");

  loadingOverlayTimer = window.setTimeout(() => {
    if (!dropZone || session !== loadingSession) return;
    dropZone.classList.add("show-loading-overlay");
    loadingFillEl?.classList.add("is-indeterminate");
  }, LOADING_OVERLAY_DELAY_MS);
}

function startShellSortSnapshotPolling(): () => void {
  if (!isTauri()) return () => { };
  void invoke("start_shell_sort_snapshot_polling").catch(() => {
    // ignore start failure
  });

  return () => {
    void invoke("stop_shell_sort_snapshot_polling").catch(() => {
      // ignore stop failure
    });
  };
}

function hasSamePaths(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

async function decodeStaticThumbnailFallback(path: string): Promise<string | null> {
  if (!isTauri() || !isAbsoluteFilePath(path)) return null;
  try {
    const buf = await invoke<ArrayBuffer>("decode_with_magick", {
      path,
      maxWidth: THUMBNAIL_SIZE_PX,
      maxHeight: THUMBNAIL_SIZE_PX,
      renderDpi: null,
      frameIndex: 0,
    });
    const payload = parseMagickDecodedBuffer(buf);
    if (!payload) return null;

    const rgba = payload.bands === 4
      ? new Uint8ClampedArray(payload.raw.buffer.slice(
        payload.raw.byteOffset,
        payload.raw.byteOffset + payload.raw.byteLength,
      ) as ArrayBuffer)
      : convertRawToRgba(payload.raw, payload.width, payload.height, payload.bands);
    const canvasEl = document.createElement("canvas");
    canvasEl.width = payload.width;
    canvasEl.height = payload.height;
    const ctx = canvasEl.getContext("2d", { alpha: true });
    if (!ctx) return null;
    ctx.putImageData(new ImageData(rgba as any, payload.width, payload.height), 0, 0);
    return canvasEl.toDataURL("image/jpeg", 0.82);
  } catch {
    return null;
  }
}

function shouldUseNativeColorManagedThumbnail(ext: string): boolean {
  // HDR AVIF thumbnails look desaturated when generated via vips/ImageMagick.
  // Use the browser decoder path to keep thumbnail colors aligned with viewer output.
  return ext === "avif";
}

async function decodeAnimatedAvifFirstFrameThumbnail(path: string): Promise<string | null> {
  if (!isTauri() || !isAbsoluteFilePath(path)) return null;
  const DecoderCtor = (window as any).ImageDecoder;
  if (!DecoderCtor) return null;

  let decoder: any = null;
  let frame: any = null;
  try {
    const data = await invoke<ArrayBuffer>("read_image_file_bytes", { path });
    decoder = new DecoderCtor({
      data,
      type: "image/avif",
      preferAnimation: true,
    });
    if (decoder.tracks?.ready) {
      await decoder.tracks.ready;
    }
    const selected = decoder.tracks?.selectedTrack;
    const frameCount = Number(selected?.frameCount ?? 1);
    const animatedFlag = (selected as { animated?: boolean } | undefined)?.animated;
    const isAnimated = (animatedFlag ?? frameCount > 1) && frameCount > 1;
    if (!isAnimated) {
      return null;
    }
    const decoded = await decoder.decode({ frameIndex: 0 });
    frame = decoded?.image ?? null;
    if (!frame) return null;

    const srcW = Math.max(1, Math.floor(Number(frame.displayWidth ?? frame.codedWidth ?? 1)));
    const srcH = Math.max(1, Math.floor(Number(frame.displayHeight ?? frame.codedHeight ?? 1)));
    const scale = Math.min(1, THUMBNAIL_SIZE_PX / Math.max(srcW, srcH));
    const outW = Math.max(1, Math.round(srcW * scale));
    const outH = Math.max(1, Math.round(srcH * scale));

    const canvasEl = document.createElement("canvas");
    canvasEl.width = outW;
    canvasEl.height = outH;
    const ctx = canvasEl.getContext("2d", { alpha: true });
    if (!ctx) return null;
    ctx.clearRect(0, 0, outW, outH);
    ctx.drawImage(frame, 0, 0, outW, outH);
    return canvasEl.toDataURL("image/jpeg", 0.86);
  } catch {
    return null;
  } finally {
    try {
      frame?.close?.();
    } catch {
      // ignore close failure
    }
    try {
      decoder?.close?.();
    } catch {
      // ignore close failure
    }
  }
}

async function getThumbnailSrc(path: string): Promise<string | null> {
  const ext = getExt(path);
  if (shouldUseNativeColorManagedThumbnail(ext)) {
    const cached = thumbnailPathToSrc.get(path);
    if (cached) return cached;

    // Animated AVIF: freeze thumbnail at first frame.
    // Static HDR AVIF: keep native <img> path to preserve color-managed rendering.
    const animatedStatic = await decodeAnimatedAvifFirstFrameThumbnail(path);
    if (animatedStatic) {
      thumbnailPathToSrc.set(path, animatedStatic);
      return animatedStatic;
    }
    const nativeSrc = toImageSrc(path);
    thumbnailPathToSrc.set(path, nativeSrc);
    return nativeSrc;
  }

  const cached = thumbnailPathToSrc.get(path);
  if (cached) return cached;

  if (!isTauri() || !isAbsoluteFilePath(path)) {
    const fallback = toImageSrc(path);
    thumbnailPathToSrc.set(path, fallback);
    return fallback;
  }

  const inFlight = thumbnailInFlight.get(path);
  if (inFlight) return inFlight;

  const task = invoke<string>("get_or_create_vips_thumbnail", {
    path,
    size: THUMBNAIL_SIZE_PX,
  })
    .then((thumbPath) => {
      const src = toImageSrc(thumbPath);
      thumbnailPathToSrc.set(path, src);
      return src;
    })
    .catch(async () => {
      const staticFallback = await decodeStaticThumbnailFallback(path);
      if (staticFallback) {
        thumbnailPathToSrc.set(path, staticFallback);
        return staticFallback;
      }
      thumbnailPathToSrc.set(path, THUMBNAIL_PLACEHOLDER_SRC);
      return THUMBNAIL_PLACEHOLDER_SRC;
    })
    .finally(() => {
      thumbnailInFlight.delete(path);
    });

  thumbnailInFlight.set(path, task);
  return task;
}

function resetThumbnailObserver() {
  if (!thumbnailObserver) return;
  thumbnailObserver.disconnect();
  thumbnailObserver = null;
}

function setThumbnailStripVisibility(visible: boolean): boolean {
  if (!thumbnailStripEl) return false;
  const changed = thumbnailStripVisible !== visible;
  thumbnailStripVisible = visible;
  thumbnailStripEl.hidden = !visible;
  return changed;
}

function scheduleThumbnailStripViewportSync() {
  if (!hasImage) return;
  if (thumbnailViewportSyncRaf) return;
  thumbnailViewportSyncRaf = window.requestAnimationFrame(() => {
    thumbnailViewportSyncRaf = 0;
    handleViewportResize();
  });
}

function stopThumbnailWheelAnimation(resetTarget = true) {
  if (thumbnailWheelRaf) {
    window.cancelAnimationFrame(thumbnailWheelRaf);
    thumbnailWheelRaf = 0;
  }
  if (resetTarget) {
    thumbnailWheelTargetLeft = null;
  }
}

function animateThumbnailScrollBy(delta: number) {
  if (!thumbnailListEl) return;
  const maxLeft = Math.max(0, thumbnailListEl.scrollWidth - thumbnailListEl.clientWidth);
  if (thumbnailWheelTargetLeft == null) {
    thumbnailWheelTargetLeft = thumbnailListEl.scrollLeft;
  }
  thumbnailWheelTargetLeft = clamp(thumbnailWheelTargetLeft + delta, 0, maxLeft);

  if (thumbnailWheelRaf) return;
  const tick = () => {
    if (!thumbnailListEl || thumbnailWheelTargetLeft == null) {
      thumbnailWheelRaf = 0;
      thumbnailWheelTargetLeft = null;
      return;
    }
    const current = thumbnailListEl.scrollLeft;
    const distance = thumbnailWheelTargetLeft - current;
    if (Math.abs(distance) < 0.5) {
      thumbnailListEl.scrollLeft = thumbnailWheelTargetLeft;
      thumbnailWheelRaf = 0;
      thumbnailWheelTargetLeft = null;
      return;
    }
    thumbnailListEl.scrollLeft = current + distance * 0.22;
    thumbnailWheelRaf = window.requestAnimationFrame(tick);
  };
  thumbnailWheelRaf = window.requestAnimationFrame(tick);
}

function ensureThumbnailObserver() {
  if (thumbnailObserver || !thumbnailListEl || typeof IntersectionObserver === "undefined") return;
  thumbnailObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const image = entry.target as HTMLImageElement;
        thumbnailObserver?.unobserve(image);
        const path = image.dataset.path;
        if (!path) continue;
        void loadThumbnailImage(path, image, thumbnailRenderToken);
      }
    },
    {
      root: thumbnailListEl,
      rootMargin: "120px",
      threshold: 0.01,
    },
  );
}

function scrollActiveThumbnailIntoView() {
  const active = thumbnailListEl?.querySelector<HTMLButtonElement>(".thumb-item.is-active");
  active?.scrollIntoView({ block: "nearest", inline: "center" });
}

function focusActiveThumbnail() {
  if (!thumbnailListEl) return;
  stopThumbnailWheelAnimation();
  scrollActiveThumbnailIntoView();
}

function renderThumbnailSelection() {
  if (!thumbnailStripEl || !thumbnailListEl) return;
  const visible = folderImages.length > 0;
  const visibilityChanged = setThumbnailStripVisibility(visible);
  if (!visible) return;
  if (visibilityChanged) {
    scheduleThumbnailStripViewportSync();
  }

  const children = thumbnailListEl.querySelectorAll<HTMLButtonElement>(".thumb-item");
  children.forEach((btn, index) => {
    const isActive = index === folderImageIndex;
    btn.classList.toggle("is-active", isActive);
    btn.setAttribute("aria-current", isActive ? "true" : "false");
  });
  scrollActiveThumbnailIntoView();
}

async function loadThumbnailImage(path: string, img: HTMLImageElement, token: number) {
  const src = await getThumbnailSrc(path);
  if (token !== thumbnailRenderToken) return;
  if (img.dataset.path !== path) return;
  img.src = src || THUMBNAIL_PLACEHOLDER_SRC;
  img.classList.remove("is-loading");
}

function renderThumbnailStrip() {
  if (!thumbnailStripEl || !thumbnailListEl) return;
  const visible = folderImages.length > 0;
  const visibilityChanged = setThumbnailStripVisibility(visible);
  if (visibilityChanged && visible) {
    scheduleThumbnailStripViewportSync();
  }
  if (!visible) {
    thumbnailListEl.replaceChildren();
    thumbnailRenderedPaths = [];
    resetThumbnailObserver();
    return;
  }

  const token = ++thumbnailRenderToken;
  resetThumbnailObserver();
  ensureThumbnailObserver();
  const fragment = document.createDocumentFragment();
  folderImages.forEach((path, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "thumb-item";
    if (index === folderImageIndex) {
      button.classList.add("is-active");
      button.setAttribute("aria-current", "true");
    } else {
      button.setAttribute("aria-current", "false");
    }
    button.title = getBaseName(path);
    button.ariaLabel = getBaseName(path);

    const image = document.createElement("img");
    image.alt = "";
    image.src = THUMBNAIL_PLACEHOLDER_SRC;
    image.loading = "lazy";
    image.decoding = "async";
    image.classList.add("is-loading");
    image.dataset.path = path;
    button.appendChild(image);

    button.addEventListener("click", () => {
      if (normalizePathForCompare(path) === normalizePathForCompare(currentOpenedPath)) return;
      void loadFromPath(path, false);
    });

    fragment.appendChild(button);

    const distance = folderImageIndex >= 0 ? Math.abs(index - folderImageIndex) : 9999;
    if (distance <= 8) {
      void loadThumbnailImage(path, image, token);
    } else if (thumbnailObserver) {
      thumbnailObserver.observe(image);
    } else {
      void loadThumbnailImage(path, image, token);
    }
  });

  thumbnailListEl.replaceChildren(fragment);
  thumbnailRenderedPaths = [...folderImages];
  scrollActiveThumbnailIntoView();
}

function updateFolderNavButtons() {
  const canPrev = folderImageIndex > 0;
  const canNext = folderImageIndex >= 0 && folderImageIndex < folderImages.length - 1;
  if (prevBtn) prevBtn.disabled = !canPrev;
  if (nextBtn) nextBtn.disabled = !canNext;

  const shouldRebuild = !hasSamePaths(thumbnailRenderedPaths, folderImages);
  if (shouldRebuild) {
    renderThumbnailStrip();
  } else {
    renderThumbnailSelection();
  }
}

function updatePlayToggleIcon() {
  if (!playToggleIcon || !playToggleBtn) return;
  if (playbackPaused) {
    playToggleIcon.innerHTML = `<path d="M7 5.6L14.4 10L7 14.4V5.6z" fill="currentColor" />`;
    playToggleBtn.setAttribute("aria-label", "재생");
  } else {
    playToggleIcon.innerHTML = `<rect x="6.1" y="5" width="2.9" height="10" rx="1.1" fill="currentColor" /><rect x="11" y="5" width="2.9" height="10" rx="1.1" fill="currentColor" />`;
    playToggleBtn.setAttribute("aria-label", "일시정지");
  }
}

function updateAnimControlsVisibility() {
  if (!animControlsEl) return;
  const visible = hasImage && renderMode === "decoder" && decodedFrameCount > 1;
  animControlsEl.classList.toggle("is-visible", visible);
}

function updateAnimControlsUi() {
  updateAnimControlsVisibility();
  if (!frameSliderEl || !frameLabelEl) return;
  const total = Math.max(1, decodedFrameCount);
  const current = Math.min(total, Math.max(1, currentFrameIndex + 1));
  const showPlayToggle = total > 1 && currentFrameSequencePlayable;
  if (playToggleBtn) {
    playToggleBtn.style.display = showPlayToggle ? "" : "none";
    playToggleBtn.disabled = !showPlayToggle;
  }
  if (showPlayToggle) {
    updatePlayToggleIcon();
  }
  frameSliderEl.min = "1";
  frameSliderEl.max = `${total}`;
  frameSliderEl.step = "1";
  frameSliderEl.value = `${current}`;
  const ratio = total > 1 ? (current - 1) / (total - 1) : 0;
  frameSliderEl.style.setProperty("--frame-percent", `${Math.round(ratio * 100)}%`);
  frameSliderEl.disabled = total <= 1;
  frameLabelEl.textContent = `${current} / ${total}`;
  if (framePrevBtn) framePrevBtn.disabled = total <= 1;
  if (frameNextBtn) frameNextBtn.disabled = total <= 1;
}

function estimateFrameBytes(width: number, height: number): number {
  const w = Math.max(1, Math.floor(width));
  const h = Math.max(1, Math.floor(height));
  return w * h * 4;
}

function computePrefetchQueueTarget(
  ext: string,
  frameBytes: number,
  frameCount: number,
  sourceBytesHint: number | null,
): number {
  if (frameCount <= 1) return 0;
  let target = PREFETCH_QUEUE_TARGET;

  if (frameBytes >= 24 * 1024 * 1024) {
    target = 1;
  } else if (frameBytes >= 12 * 1024 * 1024) {
    target = Math.min(target, 1);
  } else if (frameBytes >= 6 * 1024 * 1024) {
    target = Math.min(target, 2);
  }

  if (ext === "gif") {
    target = Math.min(target, 2);
  }

  if (sourceBytesHint != null && sourceBytesHint >= 80 * 1024 * 1024) {
    target = 1;
  }

  return Math.max(PREFETCH_QUEUE_MIN_TARGET, target);
}

async function fetchArrayBufferWithProgress(
  src: string,
  totalHintBytes: number | null,
  onProgress: (progress: number | null) => void,
): Promise<ArrayBuffer> {
  const response = await fetch(src);
  if (!response.ok) {
    throw new Error("fetch failed");
  }

  const headerTotal = Number(response.headers.get("content-length") ?? "0");
  const total = headerTotal > 0 ? headerTotal : totalHintBytes ?? 0;
  const body = response.body;
  if (!body) {
    const buf = await response.arrayBuffer();
    onProgress(total > 0 ? 1 : null);
    return buf;
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let contiguous = total > 0 ? new Uint8Array(total) : null;
  let received = 0;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;
    if (contiguous) {
      const next = received + value.byteLength;
      if (next <= contiguous.byteLength) {
        contiguous.set(value, received);
      } else {
        if (received > 0) {
          chunks.push(contiguous.subarray(0, received));
        }
        chunks.push(value);
        contiguous = null;
      }
    } else {
      chunks.push(value);
    }
    received += value.byteLength;
    onProgress(total > 0 ? received / total : null);
  }

  if (contiguous) {
    onProgress(1);
    return received === contiguous.byteLength
      ? contiguous.buffer
      : contiguous.buffer.slice(0, received);
  }

  const merged = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  onProgress(1);
  return merged.buffer;
}

function isAbsoluteFilePath(path: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(path) || path.startsWith("/") || path.startsWith("\\\\");
}

function setStartupLaunchOpenPending(pending: boolean) {
  if (!dropZone) return;
  dropZone.classList.toggle("is-startup-open-pending", pending);
}

async function openLaunchFileIfExists() {
  if (!isTauri()) {
    setStartupLaunchOpenPending(false);
    return;
  }
  try {
    const launchPath = await invoke<string | null>("get_launch_file_path");
    if (typeof launchPath !== "string" || !launchPath) return;
    if (!isAbsoluteFilePath(launchPath)) return;
    await loadFromPath(launchPath, true, true);
  } catch {
    // ignore startup argument failures
  } finally {
    setStartupLaunchOpenPending(false);
  }
}

function scheduleHdrProbeApply(
  sourcePath: string,
  ext: string,
  probeTask: Promise<boolean> | null,
) {
  if (!probeTask || !sourcePath || !isJpegFamilyExt(ext)) return;
  const expectedPathKey = normalizePathForCompare(sourcePath);
  void probeTask.then((detected) => {
    if (!hasImage) return;
    if (normalizePathForCompare(currentOpenedPath) !== expectedPathKey) return;
    if (!isJpegFamilyExt(currentImageExt)) return;
    if (currentImageIsHdrJpeg === detected) return;
    currentImageIsHdrJpeg = detected;
    renderTransform();
  });
}

function getExt(filePath: string): string {
  const dot = filePath.lastIndexOf(".");
  if (dot < 0) return "";
  return filePath.slice(dot + 1).toLowerCase();
}

function canTryNativeImage(ext: string): boolean {
  return allowedExtensions.has(ext);
}

function isJpegFamilyExt(ext: string): boolean {
  return ext === "jpg" || ext === "jpeg" || ext === "jpe" || ext === "jfif";
}

async function isHdrJpegPath(path: string): Promise<boolean> {
  if (!isTauri() || !isAbsoluteFilePath(path)) return false;
  const key = normalizePathForCompare(path);
  const cached = hdrJpegByPath.get(key);
  if (cached != null) return cached;

  const inFlight = hdrJpegInFlightByPath.get(key);
  if (inFlight) return inFlight;

  const task = invoke<boolean>("is_hdr_jpeg", { path })
    .then((value) => Boolean(value))
    .catch(() => false)
    .finally(() => {
      hdrJpegInFlightByPath.delete(key);
    });
  hdrJpegInFlightByPath.set(key, task);
  const detected = await task;
  hdrJpegByPath.set(key, detected);
  return detected;
}

function isEditableFormat(ext: string): boolean {
  return editableExtensions.has(ext);
}

function canEditCurrentImage(): boolean {
  return hasImage && isEditableFormat(currentImageExt) && decodedFrameCount <= 1;
}

function getBaseName(filePath: string): string {
  return filePath.split(/[/\\]/).pop() ?? filePath;
}

function getFileStem(filePath: string): string {
  const base = getBaseName(filePath);
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return base;
  return base.slice(0, dot);
}

function getDirName(filePath: string): string {
  const slash = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  if (slash < 0) return "";
  return filePath.slice(0, slash);
}

function joinPath(dir: string, name: string, originalPath = ""): string {
  if (!dir) return name;
  const sep = dir.includes("\\") || originalPath.includes("\\") ? "\\" : "/";
  return `${dir}${sep}${name}`;
}

function ensurePathHasExtension(path: string, fallbackExt: string): string {
  if (getExt(path)) return path;
  const safeExt = fallbackExt.trim().replace(/^\.+/, "").toLowerCase() || "png";
  return `${path}.${safeExt}`;
}

function getEditSaveMimeType(ext: string): string {
  switch (ext) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    case "avif":
      return "image/avif";
    case "bmp":
      return "image/bmp";
    case "tif":
    case "tiff":
      return "image/tiff";
    case "png":
    default:
      return "image/png";
  }
}

function isMagickSaveExt(ext: string): boolean {
  return ext === "bmp" || ext === "tif" || ext === "tiff";
}

function normalizeEditSaveExt(ext: string): string {
  const normalized = ext.trim().toLowerCase();
  if (normalized === "jpeg") return "jpg";
  return editCanvasSaveExtensions.has(normalized) ? normalized : "png";
}

function getPreferredEditSaveExt(): string {
  return normalizeEditSaveExt(getExt(currentOpenedPath) || currentImageExt || "png");
}

function getEditSaveDialogFilters(preferredExt: string): Array<{ name: string; extensions: string[] }> {
  const normalized = normalizeEditSaveExt(preferredExt);
  const ordered = EDIT_SAVE_DIALOG_FILTERS.map((filter) => ({ ...filter, extensions: [...filter.extensions] }));
  const index = ordered.findIndex((filter) => filter.extensions.includes(normalized));
  if (index > 0) {
    const [picked] = ordered.splice(index, 1);
    ordered.unshift(picked);
  }
  return ordered;
}

function getEditEncodeQuality(mimeType: string): number | undefined {
  switch (mimeType) {
    case "image/jpeg":
      return 0.92;
    case "image/webp":
      return 0.90;
    case "image/avif":
      return 0.85;
    default:
      return undefined;
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function updateRangeSliderVisual(sliderEl: HTMLInputElement | null) {
  if (!sliderEl) return;
  const min = Number(sliderEl.min);
  const max = Number(sliderEl.max);
  const value = Number(sliderEl.value);
  const range = max - min;
  const ratio = range > 0 ? clamp((value - min) / range, 0, 1) : 0;
  sliderEl.style.setProperty("--zoom-percent", `${Math.round(ratio * 100)}%`);
}

function updateZoomSliderVisual() {
  updateRangeSliderVisual(zoomSliderEl);
}

function showStageNotice(title: string, detail = "") {
  if (!stageNoticeEl || !stageNoticeTitleEl || !stageNoticeBodyEl) return;
  stageNoticeTitleEl.textContent = title;
  stageNoticeBodyEl.textContent = detail;
  stageNoticeEl.classList.add("is-visible");
  dropZone?.classList.add("show-stage-notice");
}

function hideStageNotice() {
  if (!stageNoticeEl || !stageNoticeTitleEl || !stageNoticeBodyEl) return;
  stageNoticeTitleEl.textContent = "";
  stageNoticeBodyEl.textContent = "";
  stageNoticeEl.classList.remove("is-visible");
  dropZone?.classList.remove("show-stage-notice");
}

function updateStatus(filePath?: string) {
  const canEditImage = canEditCurrentImage();
  if (zoomLevelEl) {
    zoomLevelEl.textContent = `${Math.round(currentScale * 100)}%`;
  }
  if (zoomSliderEl) {
    const minScale = hasImage ? getMinScaleForCurrentImage() : 1;
    zoomSliderEl.min = `${Math.round(MIN_SCALE * 100)}`;
    zoomSliderEl.max = `${Math.round(MAX_SCALE * 100)}`;
    zoomSliderEl.step = `${Math.round(ZOOM_STEP * 100)}`;
    const sliderValue = clamp(currentScale, minScale, MAX_SCALE);
    zoomSliderEl.value = `${Math.round(sliderValue * 100)}`;
    zoomSliderEl.disabled = !hasImage;
    updateZoomSliderVisual();
  }
  if (zoomOutBtn) zoomOutBtn.disabled = !hasImage;
  if (zoomInBtn) zoomInBtn.disabled = !hasImage;
  if (metaBtn) metaBtn.disabled = !hasImage;
  if (fitBtn) fitBtn.disabled = !hasImage;
  if (resetBtn) resetBtn.disabled = !hasImage;
  if (fullscreenBtn) fullscreenBtn.disabled = !hasImage;
  if (bottomDeleteBtn) bottomDeleteBtn.disabled = !hasImage || deleteInFlight;
  if (bottomCopyBtn) bottomCopyBtn.disabled = !hasImage;
  if (bottomShareBtn) bottomShareBtn.disabled = !hasImage;
  if (bottomPrintBtn) bottomPrintBtn.disabled = !hasImage;
  if (bottomRotateBtn) bottomRotateBtn.disabled = !hasImage || rotateInFlight;
  if (bottomEditBtn) bottomEditBtn.disabled = !canEditImage;
  if (bottomMoreBtn) {
    bottomMoreBtn.disabled = !hasImage;
    if (!hasImage) {
      closeBottomMoreMenu();
      closeStageContextMenu();
    }
  }
  syncStageContextMenuDisabled();
  if (editApplyBtn) {
    editApplyBtn.disabled = !editModalOpen || editSaveInFlight;
  }
  if (editSaveAsBtn) {
    editSaveAsBtn.disabled = !editModalOpen || editSaveInFlight;
  }
  if (editTransformRotateLeftBtn) {
    editTransformRotateLeftBtn.disabled = !editModalOpen || editSaveInFlight;
  }
  if (editTransformRotateRightBtn) {
    editTransformRotateRightBtn.disabled = !editModalOpen || editSaveInFlight;
  }
  if (editTransformFlipHorizontalBtn) {
    editTransformFlipHorizontalBtn.disabled = !editModalOpen || editSaveInFlight;
  }
  if (editTransformFlipVerticalBtn) {
    editTransformFlipVerticalBtn.disabled = !editModalOpen || editSaveInFlight;
  }
  syncEditCropButtonStates();
  if (filePath) currentFileName = getBaseName(filePath);
  if (fileNameEl) {
    fileNameEl.textContent = hasImage ? currentFileName : "";
  }
  updateTitlebarMeta();
}

function openBottomMoreMenu() {
  if (!bottomMoreBtn || !bottomMoreMenuEl) return;
  bottomMoreMenuOpen = true;
  bottomMoreMenuEl.hidden = false;
  bottomMoreBtn.setAttribute("aria-expanded", "true");
}

function closeBottomMoreMenu() {
  if (!bottomMoreBtn || !bottomMoreMenuEl) return;
  bottomMoreMenuOpen = false;
  bottomMoreMenuEl.hidden = true;
  bottomMoreBtn.setAttribute("aria-expanded", "false");
}

function toggleBottomMoreMenu() {
  if (bottomMoreMenuOpen) {
    closeBottomMoreMenu();
  } else {
    openBottomMoreMenu();
  }
}

function openTitlebarSettingsMenu() {
  if (!titlebarSettingsBtn || !titlebarSettingsMenuEl) return;
  titlebarSettingsMenuOpen = true;
  titlebarSettingsMenuEl.hidden = false;
  titlebarSettingsBtn.setAttribute("aria-expanded", "true");
}

function closeTitlebarSettingsMenu() {
  if (!titlebarSettingsBtn || !titlebarSettingsMenuEl) return;
  titlebarSettingsMenuOpen = false;
  titlebarSettingsMenuEl.hidden = true;
  titlebarSettingsBtn.setAttribute("aria-expanded", "false");
}

function toggleTitlebarSettingsMenu() {
  if (titlebarSettingsMenuOpen) {
    closeTitlebarSettingsMenu();
  } else {
    openTitlebarSettingsMenu();
  }
}

function openTitlebarMoreMenu() {
  if (!titlebarMoreBtn || !titlebarMoreMenuEl) return;
  titlebarMoreMenuOpen = true;
  titlebarMoreMenuEl.hidden = false;
  titlebarMoreBtn.setAttribute("aria-expanded", "true");
}

function closeTitlebarMoreMenu() {
  if (!titlebarMoreBtn || !titlebarMoreMenuEl) return;
  titlebarMoreMenuOpen = false;
  titlebarMoreMenuEl.hidden = true;
  titlebarMoreBtn.setAttribute("aria-expanded", "false");
}

function toggleTitlebarMoreMenu() {
  if (titlebarMoreMenuOpen) {
    closeTitlebarMoreMenu();
  } else {
    openTitlebarMoreMenu();
  }
}

function normalizeVersionParts(input: string): number[] {
  return input
    .trim()
    .split(".")
    .map((part) => {
      const numeric = Number(part.replace(/[^0-9]/g, ""));
      return Number.isFinite(numeric) ? numeric : 0;
    });
}

function compareVersionStrings(a: string, b: string): number {
  const left = normalizeVersionParts(a);
  const right = normalizeVersionParts(b);
  const maxLen = Math.max(left.length, right.length);
  for (let i = 0; i < maxLen; i += 1) {
    const lv = left[i] ?? 0;
    const rv = right[i] ?? 0;
    if (lv > rv) return 1;
    if (lv < rv) return -1;
  }
  return 0;
}

function getLatestUpdateVersion(): string {
  return updateManifest?.version?.trim() ?? "";
}

function computeHasNewUpdate(): boolean {
  const latestVersion = getLatestUpdateVersion();
  if (!latestVersion || !appVersion) return false;
  return compareVersionStrings(latestVersion, appVersion) > 0;
}

function syncUpdateCheckBadge() {
  hasNewUpdate = computeHasNewUpdate();
  if (updateCheckBadgeEl) {
    updateCheckBadgeEl.hidden = !hasNewUpdate;
  }
  if (updateCheckBtn) {
    updateCheckBtn.setAttribute("aria-label", hasNewUpdate ? "업데이트 (새 버전 있음)" : "업데이트");
  }
}

function renderUpdateModal() {
  const latestVersion = getLatestUpdateVersion();
  const updateAvailable = computeHasNewUpdate();
  const changelogItems = Array.isArray(updateManifest?.changelog)
    ? updateManifest.changelog
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter((item) => item.length > 0)
    : [];
  if (updateModalLatestVersionEl) {
    updateModalLatestVersionEl.textContent = latestVersion ? `v${latestVersion}` : "정보 없음";
  }
  if (updateModalCurrentVersionEl) {
    updateModalCurrentVersionEl.textContent = appVersion ? `현재 버전: v${appVersion}` : "현재 버전: 확인 중...";
  }
  if (updateModalStatusEl) {
    const hideStatusWhenUpdateAvailable =
      !updateManifestLoading &&
      !updateManifestError &&
      updateAvailable;
    updateModalStatusEl.hidden = hideStatusWhenUpdateAvailable;
    if (updateManifestLoading) {
      updateModalStatusEl.textContent = "업데이트 정보를 확인하는 중...";
    } else if (updateManifestError) {
      updateModalStatusEl.textContent = "업데이트 정보를 불러오지 못했습니다.";
    } else if (updateAvailable) {
      updateModalStatusEl.textContent = "";
    } else {
      updateModalStatusEl.textContent = "현재 최신 버전을 사용 중입니다.";
    }
  }
  const canShowChangelog =
    !updateManifestLoading &&
    !updateManifestError &&
    updateAvailable &&
    changelogItems.length > 0;
  if (updateModalChangelogWrapEl) {
    updateModalChangelogWrapEl.hidden = !canShowChangelog;
  }
  if (updateModalChangelogListEl) {
    updateModalChangelogListEl.textContent = "";
    if (canShowChangelog) {
      for (const text of changelogItems) {
        const li = document.createElement("li");
        li.textContent = text;
        updateModalChangelogListEl.appendChild(li);
      }
    }
  }
  if (updateModalChangelogEmptyEl) {
    const hasItems = !!updateModalChangelogListEl && updateModalChangelogListEl.childElementCount > 0;
    updateModalChangelogEmptyEl.hidden = !canShowChangelog || hasItems;
  }
  if (updateModalOpenPageBtn) {
    const downloadUrl = updateManifest?.download_url?.trim();
    updateModalOpenPageBtn.disabled = updateManifestLoading || (!downloadUrl && !UPDATE_MANIFEST_URL);
  }
}

function setUpdateModalOpen(open: boolean) {
  if (!updateModalEl) return;
  updateModalOpen = open;
  if (open) {
    updateModalEl.classList.add("is-open");
    updateModalEl.classList.remove("is-visible");
    updateModalEl.setAttribute("aria-hidden", "false");
    window.requestAnimationFrame(() => {
      updateModalEl.classList.add("is-visible");
      updateModalCloseBtn?.focus();
    });
    return;
  }
  updateModalEl.classList.remove("is-visible");
  updateModalEl.setAttribute("aria-hidden", "true");
  window.setTimeout(() => {
    if (!updateModalEl.classList.contains("is-visible")) {
      updateModalEl.classList.remove("is-open");
    }
  }, 180);
}

function openUpdateModal() {
  renderUpdateModal();
  setUpdateModalOpen(true);
}

function closeUpdateModal() {
  setUpdateModalOpen(false);
}

function renderAppLicenseModal() {
  if (appLicenseModalLoadingEl) {
    appLicenseModalLoadingEl.hidden = !appLicenseLoading;
  }
  if (appLicenseModalContentEl) {
    appLicenseModalContentEl.textContent = appLicenseText;
    appLicenseModalContentEl.hidden = appLicenseLoading;
  }
}

function setAppLicenseModalOpen(open: boolean) {
  if (!appLicenseModalEl) return;
  appLicenseModalOpen = open;
  if (open) {
    appLicenseModalEl.classList.add("is-open");
    appLicenseModalEl.classList.remove("is-visible");
    appLicenseModalEl.setAttribute("aria-hidden", "false");
    renderAppLicenseModal();
    window.requestAnimationFrame(() => {
      appLicenseModalEl.classList.add("is-visible");
      appLicenseModalCloseBtn?.focus();
    });
    return;
  }
  appLicenseModalEl.classList.remove("is-visible");
  appLicenseModalEl.setAttribute("aria-hidden", "true");
  window.setTimeout(() => {
    if (!appLicenseModalEl.classList.contains("is-visible")) {
      appLicenseModalEl.classList.remove("is-open");
    }
  }, 180);
}

function closeAppLicenseModal() {
  setAppLicenseModalOpen(false);
}

async function readBundledLicenseText(fileName: string): Promise<{ path: string; text: string }> {
  const candidates = [`resources/LICENSE/${fileName}`, `LICENSE/${fileName}`];
  let lastError: unknown = null;
  for (const relativePath of candidates) {
    try {
      const path = await resolveResource(relativePath);
      const text = await invoke<string>("read_text_file", { path });
      return { path, text };
    } catch (e) {
      lastError = e;
    }
  }
  if (lastError) throw lastError;
  throw new Error(`라이선스 경로를 찾지 못했습니다: ${fileName}`);
}

async function openAppLicenseInfo() {
  closeTitlebarMoreMenu();
  appLicenseLoading = true;
  appLicenseText = "";
  setAppLicenseModalOpen(true);
  try {
    if (!isTauri()) {
      throw new Error("Tauri 환경에서만 라이선스 문서를 열 수 있습니다.");
    }
    const { text } = await readBundledLicenseText("HogumaView LICENSE.txt");
    appLicenseText = text;
  } catch (e) {
    appLicenseText = "";
    await showAppModal({
      title: "오류",
      message: `라이선스 문서를 열지 못했습니다: ${String(e)}`,
      okLabel: "확인",
      kind: "alert",
    });
    closeAppLicenseModal();
  } finally {
    appLicenseLoading = false;
    renderAppLicenseModal();
  }
}

async function openOpenSourceLicenseInfo() {
  closeTitlebarMoreMenu();
  try {
    if (!isTauri()) {
      throw new Error("Tauri 환경에서만 라이선스 문서를 열 수 있습니다.");
    }
    const { path: licensePath } = await readBundledLicenseText("Open Source LICENSE.html");
    await openPath(licensePath);
  } catch (e) {
    await showAppModal({
      title: "오류",
      message: `라이선스 문서를 열지 못했습니다: ${String(e)}`,
      okLabel: "확인",
      kind: "alert",
    });
  }
}

async function openUpdateDownloadPage() {
  const downloadUrl = updateManifest?.download_url?.trim();
  const targetUrl = downloadUrl || UPDATE_MANIFEST_URL;
  if (!targetUrl) {
    showBottomToast("업데이트 URL이 없습니다.");
    return;
  }
  try {
    if (isTauri()) {
      await openUrl(targetUrl);
    } else {
      window.open(targetUrl, "_blank", "noopener,noreferrer");
    }
  } catch {
    showBottomToast("업데이트 페이지를 열지 못했습니다.");
  }
}

async function openHelpPage() {
  try {
    if (isTauri()) {
      await openUrl(HELP_PAGE_URL);
    } else {
      window.open(HELP_PAGE_URL, "_blank", "noopener,noreferrer");
    }
  } catch {
    showBottomToast("도움말 페이지를 열지 못했습니다.");
  }
}

async function loadAppVersion() {
  if (!isTauri()) {
    appVersion = "";
    syncUpdateCheckBadge();
    renderUpdateModal();
    return;
  }
  try {
    appVersion = await getVersion();
  } catch {
    appVersion = "";
  }
  syncUpdateCheckBadge();
  renderUpdateModal();
}

async function loadUpdateManifest() {
  const requestId = ++updateManifestRequestId;
  updateManifestLoading = true;
  updateManifestError = "";
  renderUpdateModal();
  try {
    const response = await fetch(UPDATE_MANIFEST_URL, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`http_${response.status}`);
    }
    const data = (await response.json()) as UpdateManifest;
    if (requestId !== updateManifestRequestId) return;
    updateManifest = data;
  } catch (error) {
    if (requestId !== updateManifestRequestId) return;
    updateManifestError = String(error);
  } finally {
    if (requestId !== updateManifestRequestId) return;
    updateManifestLoading = false;
    syncUpdateCheckBadge();
    renderUpdateModal();
  }
}

function normalizeHexColor(hex: string): string | null {
  const value = hex.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(value)) return value.toUpperCase();
  if (/^#[0-9a-fA-F]{3}$/.test(value)) {
    const [r, g, b] = value.slice(1).split("");
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  return null;
}

function syncTitlebarPickedColorDisplay() {
  if (!titlebarPickedColorBtn) return;
  if (!titlebarPickedColorHex) {
    titlebarPickedColorBtn.textContent = "#------";
    titlebarPickedColorBtn.disabled = true;
    titlebarPickedColorBtn.title = "색상 추출 후 복사할 수 있습니다.";
    return;
  }
  titlebarPickedColorBtn.textContent = titlebarPickedColorHex;
  titlebarPickedColorBtn.disabled = false;
  titlebarPickedColorBtn.title = "색상 코드를 복사합니다.";
}

function showTitlebarEyedropperToast(message: string, durationMs = 1200) {
  if (!titlebarEyedropperToastEl) return;
  titlebarEyedropperToastEl.textContent = message;
  titlebarEyedropperToastEl.classList.add("is-visible");
  if (titlebarEyedropperToastTimer != null) {
    window.clearTimeout(titlebarEyedropperToastTimer);
  }
  titlebarEyedropperToastTimer = window.setTimeout(() => {
    titlebarEyedropperToastEl.classList.remove("is-visible");
    titlebarEyedropperToastTimer = null;
  }, durationMs);
}

async function handlePickColorFromEyedropper() {
  const EyeDropperCtor = (window as { EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> } }).EyeDropper;
  if (!EyeDropperCtor) {
    showBottomToast("현재 환경에서는 스포이드 기능을 지원하지 않습니다.");
    return;
  }
  if (!titlebarEyedropperBtn) return;
  eyedropperPicking = true;
  hideStageNavOverlay();
  titlebarEyedropperBtn.disabled = true;
  try {
    const eyedropper = new EyeDropperCtor();
    const picked = await eyedropper.open();
    const normalized = normalizeHexColor(String(picked?.sRGBHex ?? ""));
    if (!normalized) {
      showBottomToast("색상 코드를 읽을 수 없습니다.");
      return;
    }
    titlebarPickedColorHex = normalized;
    syncTitlebarPickedColorDisplay();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (!/abort|cancel/i.test(reason)) {
      showBottomToast("색상 추출에 실패했습니다.");
    }
  } finally {
    eyedropperPicking = false;
    titlebarEyedropperBtn.disabled = false;
  }
}

async function handleCopyPickedColorCode() {
  if (!titlebarPickedColorHex) return;
  try {
    await navigator.clipboard.writeText(titlebarPickedColorHex);
    showTitlebarEyedropperToast("복사됨");
  } catch {
    await showAppModal({
      title: "복사 실패",
      message: "클립보드 복사를 지원하지 않는 환경입니다.",
    });
  }
}

function syncStageContextMenuDisabled() {
  if (ctxDeleteBtn && bottomDeleteBtn) ctxDeleteBtn.disabled = bottomDeleteBtn.disabled;
  if (ctxCopyBtn && bottomCopyBtn) ctxCopyBtn.disabled = bottomCopyBtn.disabled;
  if (ctxShareBtn && bottomShareBtn) ctxShareBtn.disabled = bottomShareBtn.disabled;
  if (ctxPrintBtn && bottomPrintBtn) ctxPrintBtn.disabled = bottomPrintBtn.disabled;
  if (ctxRotateBtn && bottomRotateBtn) ctxRotateBtn.disabled = bottomRotateBtn.disabled;
  if (ctxEditBtn && bottomEditBtn) ctxEditBtn.disabled = bottomEditBtn.disabled;
  if (ctxImageInfoBtn) ctxImageInfoBtn.disabled = !hasImage;
  if (ctxSetWallpaperBtn) ctxSetWallpaperBtn.disabled = !hasImage;
  if (ctxRevealInExplorerBtn) ctxRevealInExplorerBtn.disabled = !hasImage;
  if (ctxCopyFilePathBtn) ctxCopyFilePathBtn.disabled = !hasImage;
}

function openStageContextMenu(clientX: number, clientY: number) {
  if (!stageContextMenuEl) return;
  syncStageContextMenuDisabled();
  stageContextMenuEl.hidden = false;
  stageContextMenuOpen = true;
  const rect = stageContextMenuEl.getBoundingClientRect();
  const margin = 6;
  const left = Math.max(margin, Math.min(clientX, window.innerWidth - rect.width - margin));
  const top = Math.max(margin, Math.min(clientY, window.innerHeight - rect.height - margin));
  stageContextMenuEl.style.left = `${left}px`;
  stageContextMenuEl.style.top = `${top}px`;
}

function closeStageContextMenu() {
  if (!stageContextMenuEl) return;
  stageContextMenuOpen = false;
  stageContextMenuEl.hidden = true;
}

function closeAppModal(accepted: boolean) {
  if (!appModalEl || !appModalResolver) return;
  appModalEl.classList.remove("is-visible");
  appModalEl.setAttribute("aria-hidden", "true");
  const resolve = appModalResolver;
  appModalResolver = null;
  window.setTimeout(() => {
    if (!appModalEl?.classList.contains("is-visible")) {
      appModalEl?.classList.remove("is-open");
    }
  }, 180);
  resolve(accepted);
}

function showBottomToast(message: string, durationMs = 2000) {
  if (!bottomToastEl) return;
  bottomToastEl.textContent = message;
  bottomToastEl.hidden = false;
  if (bottomToastTimer) {
    window.clearTimeout(bottomToastTimer);
  }
  bottomToastTimer = window.setTimeout(() => {
    bottomToastEl.hidden = true;
    bottomToastEl.textContent = "";
    bottomToastTimer = null;
  }, durationMs);
}

async function showAppModal(options: {
  title: string;
  message: string;
  okLabel?: string;
  cancelLabel?: string;
  kind?: "alert" | "confirm";
}): Promise<boolean> {
  if (!appModalEl || !appModalTitleEl || !appModalMessageEl || !appModalCancelBtn || !appModalOkBtn) {
    return false;
  }

  if (appModalResolver) {
    closeAppModal(false);
  }

  const kind = options.kind ?? "alert";
  appModalTitleEl.textContent = options.title;
  appModalMessageEl.textContent = options.message;
  appModalOkBtn.textContent = options.okLabel ?? "확인";
  appModalCancelBtn.textContent = options.cancelLabel ?? "취소";
  appModalCancelBtn.style.display = kind === "confirm" ? "" : "none";
  appModalEl.classList.add("is-open");
  appModalEl.classList.remove("is-visible");
  appModalEl.setAttribute("aria-hidden", "false");

  return await new Promise<boolean>((resolve) => {
    appModalResolver = resolve;
    window.setTimeout(() => {
      appModalEl.classList.add("is-visible");
      appModalOkBtn.focus();
    }, 10);
  });
}

function clearCurrentImageState() {
  clearDisplayedImageState();
  folderImages = [];
  folderImageIndex = -1;
  thumbnailPathToSrc.clear();
  thumbnailInFlight.clear();
  thumbnailRenderedPaths = [];
  thumbnailRenderToken += 1;
  resetThumbnailObserver();
  updateFolderNavButtons();
  hideStageNotice();
}

function clearDisplayedImageState() {
  stopPlayback();
  stopZoomAnimation();
  hasImage = false;
  currentFileName = "";
  currentOpenedPath = "";
  currentFileSizeBytes = null;
  currentImageExt = "";
  currentImagePathForDecode = "";
  currentImageIsHdrJpeg = false;
  nativeImageProxyCanvasSourceKey = "";
  mediaWidth = 1;
  mediaHeight = 1;
  originalMediaWidth = 0;
  originalMediaHeight = 0;
  currentScale = 1;
  offsetX = 0;
  offsetY = 0;
  pendingVisualRotationDeg = 0;
  pendingVisualRotationPath = "";
  rotateInFlight = false;
  if (viewerImage) viewerImage.src = "";
  if (viewerSvgFrame) viewerSvgFrame.src = "about:blank";
  setMetaPanelVisibility(false);
  updateAnimControlsUi();
  renderTransform();
}

async function handleDeleteCurrentImage() {
  if (deleteInFlight) return;
  if (!isTauri() || !isAbsoluteFilePath(currentOpenedPath)) {
    await showAppModal({
      title: "삭제",
      message: "로컬 파일만 삭제할 수 있습니다.",
    });
    return;
  }
  const targetPath = currentOpenedPath;
  const ok = await showAppModal({
    title: "삭제 확인",
    message: "파일을 휴지통으로 이동할까요?",
    okLabel: "예",
    cancelLabel: "아니오",
    kind: "confirm",
  });
  if (!ok) return;

  deleteInFlight = true;
  updateStatus();
  try {
    await invoke("delete_image_file", { path: targetPath });
    setStoredVisualRotationDeg(targetPath, 0);
    const key = normalizePathForCompare(targetPath);
    const removedIndex = folderImages.findIndex((p) => normalizePathForCompare(p) === key);
    const candidates = folderImages.filter((p) => normalizePathForCompare(p) !== key);
    const nextPath = candidates[Math.min(Math.max(0, removedIndex), Math.max(0, candidates.length - 1))];
    if (nextPath) {
      await loadFromPath(nextPath, true);
    } else {
      clearCurrentImageState();
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await showAppModal({
      title: "삭제 실패",
      message: reason,
    });
  } finally {
    deleteInFlight = false;
    updateStatus();
  }
}

async function handleShareCurrentImage() {
  if (!hasImage || !currentOpenedPath) return;
  const shareData: ShareData = {
    title: currentFileName || "이미지",
    text: currentOpenedPath,
  };

  try {
    if (typeof navigator.share === "function") {
      await navigator.share(shareData);
      return;
    }
  } catch {
    // fallback to clipboard
  }

  try {
    await navigator.clipboard.writeText(currentOpenedPath);
    await showAppModal({
      title: "공유",
      message: "경로를 클립보드에 복사했습니다.",
    });
  } catch {
    await showAppModal({
      title: "공유 실패",
      message: "공유를 지원하지 않는 환경입니다.",
    });
  }
}

function canvasToBlob(
  sourceCanvas: HTMLCanvasElement,
  mimeType: string,
  quality?: number,
): Promise<Blob | null> {
  return new Promise((resolve) => {
    sourceCanvas.toBlob((blob) => resolve(blob), mimeType, quality);
  });
}

function canvasToPngBlob(sourceCanvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    sourceCanvas.toBlob((blob) => resolve(blob), "image/png");
  });
}

type LoadedImageSource = { image: HTMLImageElement; cleanup: () => void };

function getMimeTypeFromPath(path: string): string {
  const ext = getExt(path) || currentImageExt;
  if (!ext) return "application/octet-stream";
  return mimeFromExt(ext);
}

function drawSourceToPngBlob(
  source: CanvasImageSource,
  width: number,
  height: number,
): Promise<Blob | null> {
  const safeW = Math.max(1, Math.round(width));
  const safeH = Math.max(1, Math.round(height));
  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = safeW;
  tempCanvas.height = safeH;
  const ctx = tempCanvas.getContext("2d", { alpha: true });
  if (!ctx) return Promise.resolve(null);
  ctx.clearRect(0, 0, safeW, safeH);
  ctx.drawImage(source, 0, 0, safeW, safeH);
  return canvasToPngBlob(tempCanvas);
}

async function loadImageFromBlob(blob: Blob): Promise<LoadedImageSource> {
  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = await loadImageElementForClipboard(objectUrl);
    return {
      image,
      cleanup: () => URL.revokeObjectURL(objectUrl),
    };
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
}

async function loadImageElementFromLocalPath(path: string): Promise<LoadedImageSource | null> {
  if (!isTauri() || !isAbsoluteFilePath(path)) return null;
  const buffer = await invoke<ArrayBuffer>("read_image_file_bytes", { path });
  const blob = new Blob([buffer], { type: getMimeTypeFromPath(path) });
  return await loadImageFromBlob(blob);
}

async function tryBuildClipboardPngBlobFromLocalPath(path: string): Promise<Blob | null> {
  const loaded = await loadImageElementFromLocalPath(path).catch(() => null);
  if (!loaded) return null;
  try {
    const image = loaded.image;
    const width = Math.max(1, image.naturalWidth || image.width || Math.round(mediaWidth));
    const height = Math.max(1, image.naturalHeight || image.height || Math.round(mediaHeight));
    return await drawSourceToPngBlob(image, width, height);
  } finally {
    loaded.cleanup();
  }
}

function buildPngBlobFromDecodedPayload(payload: DecodedImagePayload): Promise<Blob | null> {
  const rgba = payload.bands === 4
    ? new Uint8ClampedArray(payload.raw.buffer.slice(
      payload.raw.byteOffset,
      payload.raw.byteOffset + payload.raw.byteLength,
    ) as ArrayBuffer)
    : convertRawToRgba(payload.raw, payload.width, payload.height, payload.bands);
  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = payload.width;
  tempCanvas.height = payload.height;
  const ctx = tempCanvas.getContext("2d", { alpha: true });
  if (!ctx) return Promise.resolve(null);
  ctx.clearRect(0, 0, payload.width, payload.height);
  ctx.putImageData(new ImageData(rgba as any, payload.width, payload.height), 0, 0);
  return canvasToPngBlob(tempCanvas);
}

async function tryBuildClipboardPngBlobFromMagick(path: string): Promise<Blob | null> {
  if (!isTauri() || !isAbsoluteFilePath(path)) return null;
  const ext = getExt(path) || currentImageExt;
  if (!ext) return null;
  const payload = await fetchDecodedPayload(path, ext);
  if (!payload) return null;
  return await buildPngBlobFromDecodedPayload(payload);
}

async function loadImageElementForClipboard(src: string): Promise<HTMLImageElement> {
  return await new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("image load failed"));
    image.src = src;
  });
}

async function buildClipboardPngBlob(): Promise<Blob | null> {
  if (renderMode === "native-image" && isAbsoluteFilePath(currentOpenedPath)) {
    const browserBlob = await tryBuildClipboardPngBlobFromLocalPath(currentOpenedPath).catch(() => null);
    if (browserBlob) return browserBlob;
    const decodedBlob = await tryBuildClipboardPngBlobFromMagick(currentOpenedPath).catch(() => null);
    if (decodedBlob) return decodedBlob;
  }

  if (canvas && (renderMode === "decoder" || renderMode === "vips")) {
    return await canvasToPngBlob(canvas);
  }

  const src = viewerImage?.src || toImageSrc(currentOpenedPath);
  const image = await loadImageElementForClipboard(src);
  const width = Math.max(1, image.naturalWidth || image.width || Math.round(mediaWidth));
  const height = Math.max(1, image.naturalHeight || image.height || Math.round(mediaHeight));
  try {
    return await drawSourceToPngBlob(image, width, height);
  } catch {
    if (isAbsoluteFilePath(currentOpenedPath)) {
      const browserBlob = await tryBuildClipboardPngBlobFromLocalPath(currentOpenedPath).catch(() => null);
      if (browserBlob) return browserBlob;
      const decodedBlob = await tryBuildClipboardPngBlobFromMagick(currentOpenedPath).catch(() => null);
      if (decodedBlob) return decodedBlob;
    }
    throw new Error("편집 가능한 이미지를 준비하지 못했습니다.");
  }
}

async function handleCopyCurrentImage() {
  if (!hasImage) return;
  if (isTauri() && isAbsoluteFilePath(currentOpenedPath)) {
    try {
      await invoke("copy_file_to_clipboard", { path: currentOpenedPath });
      showBottomToast("클립보드에 복사되었습니다.");
      return;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await showAppModal({
        title: "복사 실패",
        message: reason,
      });
      return;
    }
  }

  const ClipboardItemCtor = (window as any).ClipboardItem;
  if (!navigator.clipboard || typeof navigator.clipboard.write !== "function" || !ClipboardItemCtor) {
    await showAppModal({
      title: "복사 실패",
      message: "이 환경에서는 이미지 복사를 지원하지 않습니다.",
    });
    return;
  }

  try {
    const blob = await buildClipboardPngBlob();
    if (!blob) {
      throw new Error("failed to create clipboard image");
    }
    const item = new ClipboardItemCtor({ "image/png": blob });
    await navigator.clipboard.write([item]);
    showBottomToast("클립보드에 복사되었습니다.");
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await showAppModal({
      title: "복사 실패",
      message: reason,
    });
  }
}

async function handlePrintCurrentImage() {
  if (!isTauri() || !isAbsoluteFilePath(currentOpenedPath)) {
    await showAppModal({
      title: "프린트",
      message: "로컬 파일만 인쇄할 수 있습니다.",
    });
    return;
  }
  try {
    await invoke("print_image_file", { path: currentOpenedPath });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await showAppModal({
      title: "프린트 실패",
      message: reason,
    });
  }
}

async function handleRotateCurrentImage() {
  if (!isTauri() || !isAbsoluteFilePath(currentOpenedPath)) {
    await showAppModal({
      title: "회전",
      message: "로컬 파일만 회전할 수 있습니다.",
    });
    return;
  }
  if (rotateInFlight) return;
  const targetPath = currentOpenedPath;
  rotateInFlight = true;
  updateStatus();
  try {
    const currentDeg = getStoredVisualRotationDeg(targetPath);
    setStoredVisualRotationDeg(targetPath, currentDeg + 90);
    pendingVisualRotationDeg = 0;
    pendingVisualRotationPath = "";
    fitImageToViewport(false, false);
  } finally {
    rotateInFlight = false;
    updateStatus();
  }
}

function getEditCanvasContext(): CanvasRenderingContext2D | null {
  if (!editCanvasEl) return null;
  return editCanvasEl.getContext("2d", { alpha: true });
}

function syncEditCanvasDisplaySize() {
  if (!editCanvasEl || !editCanvasWrapEl) return;
  const width = Math.max(1, editCanvasEl.width);
  const height = Math.max(1, editCanvasEl.height);
  const availableWidth = Math.max(1, editCanvasWrapEl.clientWidth);
  const availableHeight = Math.max(1, editCanvasWrapEl.clientHeight);
  const scale = Math.max(0.01, Math.min(availableWidth / width, availableHeight / height));
  // Keep rendered size strictly inside the wrap to avoid bottom/right clipping.
  const displayWidth = Math.max(1, Math.floor(width * scale));
  const displayHeight = Math.max(1, Math.floor(height * scale));
  editCanvasEl.style.width = `${displayWidth}px`;
  editCanvasEl.style.height = `${displayHeight}px`;
  updateEditBrushCursor();
  syncEditCropHandleLayer();
}

function scheduleSyncEditCanvasDisplaySize() {
  if (!editModalOpen) return;
  if (editCanvasDisplaySyncRaf) return;
  editCanvasDisplaySyncRaf = window.requestAnimationFrame(() => {
    editCanvasDisplaySyncRaf = 0;
    syncEditCanvasDisplaySize();
  });
}

function ensureEditCanvasResizeObserver() {
  if (!editCanvasWrapEl || typeof ResizeObserver === "undefined") return;
  if (editCanvasWrapResizeObserver) return;
  editCanvasWrapResizeObserver = new ResizeObserver(() => {
    if (!editModalOpen) return;
    scheduleSyncEditCanvasDisplaySize();
  });
  editCanvasWrapResizeObserver.observe(editCanvasWrapEl);
}

function normalizeEditPaletteColor(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(value)) return value;
  if (/^#[0-9a-f]{3}$/.test(value)) {
    return `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`;
  }
  return null;
}

function syncEditColorSwatchSelection(color: string | null | undefined) {
  const normalizedColor = normalizeEditPaletteColor(color);
  editColorSwatchEls.forEach((el) => {
    const swatchColor = normalizeEditPaletteColor(el.dataset.editColor);
    const active = !!normalizedColor && swatchColor === normalizedColor;
    el.classList.toggle("is-active", active);
    el.setAttribute("aria-pressed", active ? "true" : "false");
  });
}

function applyEditColorFromControl(commitHistory: boolean) {
  const normalized = normalizeEditPaletteColor(editColorInputEl?.value);
  if (!normalized) {
    syncEditColorSwatchSelection(getEditColorForTool(getCurrentEditColorTool()));
    return;
  }
  editColorByTool[getCurrentEditColorTool()] = normalized;
  if (editColorInputEl && editColorInputEl.value.toLowerCase() !== normalized) {
    editColorInputEl.value = normalized;
  }
  syncEditColorSwatchSelection(normalized);
  const selected = getSelectedEditTextItem();
  if (!selected || editToolMode !== "text") return;
  if (normalizeEditPaletteColor(selected.color) === normalized) return;
  selected.color = normalized;
  renderEditCanvasFromState();
  if (commitHistory) {
    pushEditHistorySnapshot();
  }
}

function getEditStrokeColor(): string {
  const tool = getCurrentEditColorTool();
  const fallback = getEditColorForTool(tool);
  const raw = (editColorInputEl?.value ?? fallback).trim();
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(raw) ? raw : fallback;
}

function getEditBrushMode(): EditBrushMode {
  return editBrushMode === "erase" ? "erase" : "draw";
}

function getEditMosaicBrushMode(): EditMosaicBrushMode {
  return editMosaicBrushMode === "erase" ? "erase" : "draw";
}

function getEditMosaicStyle(): EditMosaicStyle {
  if (editMosaicStyle === "ellipse" || editMosaicStyle === "brush") return editMosaicStyle;
  return "rect";
}

function getEditMosaicStyleSelectValue(): EditMosaicStyleSelectValue {
  if (getEditMosaicStyle() === "brush" && getEditMosaicBrushMode() === "erase") return "erase";
  return getEditMosaicStyle();
}

function getEditBlurBrushMode(): EditBlurBrushMode {
  return editBlurBrushMode === "erase" ? "erase" : "draw";
}

function getEditBlurStyle(): EditBlurStyle {
  if (editBlurStyle === "ellipse" || editBlurStyle === "brush") return editBlurStyle;
  return "rect";
}

function getEditBlurStyleSelectValue(): EditBlurStyleSelectValue {
  if (getEditBlurStyle() === "brush" && getEditBlurBrushMode() === "erase") return "erase";
  return getEditBlurStyle();
}

function clampEditMosaicIntensityPercent(percent: number): number {
  return clamp(percent, EDIT_MOSAIC_SIZE_PERCENT_MIN, EDIT_MOSAIC_SIZE_PERCENT_MAX);
}

function syncEditMosaicIntensityControl() {
  if (!editMosaicIntensityInputEl || !editMosaicIntensityValueEl) return;
  const clamped = clampEditMosaicIntensityPercent(editMosaicIntensityPercent);
  editMosaicIntensityPercent = clamped;
  editMosaicIntensityInputEl.value = `${Math.round(clamped / EDIT_SIZE_PERCENT_STEP)}`;
  editMosaicIntensityValueEl.textContent = percentToStepLevelLabel(
    clamped,
    EDIT_MOSAIC_SIZE_PERCENT_MIN,
    EDIT_MOSAIC_SIZE_PERCENT_MAX,
  );
  updateRangeSliderVisual(editMosaicIntensityInputEl);
}

function clampEditBlurIntensityPercent(percent: number): number {
  return clamp(percent, EDIT_MOSAIC_SIZE_PERCENT_MIN, EDIT_MOSAIC_SIZE_PERCENT_MAX);
}

function syncEditBlurIntensityControl() {
  if (!editBlurIntensityInputEl || !editBlurIntensityValueEl) return;
  const clamped = clampEditBlurIntensityPercent(editBlurIntensityPercent);
  editBlurIntensityPercent = clamped;
  editBlurIntensityInputEl.value = `${Math.round(clamped / EDIT_SIZE_PERCENT_STEP)}`;
  editBlurIntensityValueEl.textContent = percentToStepLevelLabel(
    clamped,
    EDIT_MOSAIC_SIZE_PERCENT_MIN,
    EDIT_MOSAIC_SIZE_PERCENT_MAX,
  );
  updateRangeSliderVisual(editBlurIntensityInputEl);
}

function normalizeEditFontFamilyName(raw: string | null | undefined): string {
  const compact = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!compact) return EDIT_TEXT_FONT_DEFAULT;
  return compact.slice(0, 120);
}

function escapeEditFontFamilyForCanvas(fontFamily: string): string {
  return fontFamily.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function dedupeNormalizedFontFamilies(families: string[]): string[] {
  const seen = new Set<string>();
  const rows: string[] = [];
  for (const family of families) {
    const normalized = normalizeEditFontFamilyName(family);
    const key = normalized.toLocaleLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    rows.push(normalized);
  }
  return rows;
}

function makeEditFontCatalogEntry(
  cssName: string,
  displayName: string,
  aliases: string[],
): EditFontCatalogEntry | null {
  const normalizedCss = normalizeEditFontFamilyName(cssName);
  if (!normalizedCss) return null;
  const normalizedDisplay = normalizeEditFontFamilyName(displayName || normalizedCss);
  const normalizedAliases = dedupeNormalizedFontFamilies([normalizedCss, normalizedDisplay, ...aliases]);
  return {
    cssName: normalizedCss,
    displayName: normalizedDisplay,
    aliases: normalizedAliases,
  };
}

function getDefaultEditFontCatalog(): EditFontCatalogEntry[] {
  return dedupeNormalizedFontFamilies([...EDIT_TEXT_FONT_FALLBACK_LIST, EDIT_TEXT_FONT_FALLBACK])
    .map((name) => makeEditFontCatalogEntry(name, name, [name]))
    .filter((entry): entry is EditFontCatalogEntry => !!entry);
}

function resolveEditFontCssName(fontFamily: string): string {
  const normalized = normalizeEditFontFamilyName(fontFamily);
  const byAlias = editFontCssByAlias.get(normalized.toLocaleLowerCase());
  return byAlias ?? normalized;
}

function getEditFontFallbackChain(fontFamily: string): string[] {
  const cssName = resolveEditFontCssName(fontFamily);
  const aliases = editFontAliasesByCss.get(cssName.toLocaleLowerCase()) ?? [cssName];
  return dedupeNormalizedFontFamilies([cssName, ...aliases, EDIT_TEXT_FONT_FALLBACK]);
}

function buildEditTextCanvasFont(sizePx: number, fontFamily: string): string {
  const safeSize = Math.max(1, Math.round(sizePx));
  const chain = getEditFontFallbackChain(fontFamily)
    .map((family) => `"${escapeEditFontFamilyForCanvas(family)}"`)
    .join(", ");
  return `${safeSize}px ${chain}`;
}

function setEditFontSelectOptions(fonts: EditFontCatalogEntry[]) {
  if (!editFontSelectEl) return;
  const merged = [...fonts, ...getDefaultEditFontCatalog()];
  const uniq = new Map<string, EditFontCatalogEntry>();
  const aliasToKey = new Map<string, string>();
  const upsert = (entry: EditFontCatalogEntry) => {
    const candidateKeys = [entry.cssName, entry.displayName, ...entry.aliases]
      .map((value) => value.toLocaleLowerCase());
    let mergeKey: string | null = null;
    for (const candidate of candidateKeys) {
      const existing = aliasToKey.get(candidate);
      if (existing) {
        mergeKey = existing;
        break;
      }
    }
    const targetKey = mergeKey ?? entry.cssName.toLocaleLowerCase();
    const prev = uniq.get(targetKey);
    const next: EditFontCatalogEntry = prev
      ? {
        cssName: prev.cssName,
        displayName: prev.displayName,
        aliases: dedupeNormalizedFontFamilies([
          ...prev.aliases,
          ...entry.aliases,
          prev.cssName,
          prev.displayName,
          entry.cssName,
          entry.displayName,
        ]),
      }
      : entry;
    uniq.set(targetKey, next);
    for (const alias of [next.cssName, next.displayName, ...next.aliases]) {
      aliasToKey.set(alias.toLocaleLowerCase(), targetKey);
    }
  };
  for (const font of merged) {
    const entry = makeEditFontCatalogEntry(font.cssName, font.displayName, font.aliases);
    if (!entry) continue;
    upsert(entry);
  }
  const currentEntry = makeEditFontCatalogEntry(editCurrentTextFontFamily, editCurrentTextFontFamily, [editCurrentTextFontFamily]);
  if (currentEntry) {
    upsert(currentEntry);
  }
  const sorted = Array.from(uniq.values()).sort((a, b) => a.displayName.localeCompare(b.displayName, "ko"));
  editAvailableFonts = sorted;
  editFontAliasesByCss.clear();
  editFontCssByAlias.clear();
  editFontSelectEl.innerHTML = "";
  const frag = document.createDocumentFragment();
  for (const font of sorted) {
    const option = document.createElement("option");
    option.value = font.cssName;
    option.textContent = font.displayName;
    option.dataset.fontAliases = font.aliases.join("\n");
    frag.appendChild(option);
    editFontAliasesByCss.set(font.cssName.toLocaleLowerCase(), font.aliases);
    for (const alias of font.aliases) {
      editFontCssByAlias.set(alias.toLocaleLowerCase(), font.cssName);
    }
  }
  editFontSelectEl.appendChild(frag);
}

function ensureEditFontSelectHasValue(fontFamily: string) {
  if (!editFontSelectEl) return;
  const cssName = resolveEditFontCssName(fontFamily);
  if (!editAvailableFonts.some((value) => value.cssName.toLocaleLowerCase() === cssName.toLocaleLowerCase())) {
    const entry = makeEditFontCatalogEntry(cssName, cssName, [fontFamily]);
    if (entry) {
      setEditFontSelectOptions([...editAvailableFonts, entry]);
    }
  }
}

function syncEditFontSelectValue(fontFamily: string) {
  if (!editFontSelectEl) return;
  const cssName = resolveEditFontCssName(fontFamily);
  ensureEditFontSelectHasValue(cssName);
  editFontSelectEl.value = cssName;
}

function getEditTextFontFamilyFromControl(): string {
  const selected = resolveEditFontCssName(editFontSelectEl?.value ?? editCurrentTextFontFamily);
  editCurrentTextFontFamily = selected;
  return selected;
}

async function ensureEditFontFamiliesLoaded(): Promise<void> {
  if (editFontFamiliesLoadPromise) {
    await editFontFamiliesLoadPromise;
    return;
  }
  editFontFamiliesLoadPromise = (async () => {
    let fonts = getDefaultEditFontCatalog();
    if (isTauri()) {
      try {
        const rows = await invoke<Array<InstalledFontFamilyPayload | string>>("list_installed_font_families");
        if (Array.isArray(rows) && rows.length > 0) {
          const mapped = rows
            .map((row) => {
              if (typeof row === "string") {
                return makeEditFontCatalogEntry(row, row, [row]);
              }
              if (!row || typeof row !== "object") return null;
              return makeEditFontCatalogEntry(row.cssName, row.displayName, row.aliases ?? []);
            })
            .filter((entry): entry is EditFontCatalogEntry => !!entry);
          if (mapped.length > 0) {
            fonts = mapped;
          }
        }
      } catch {
        // Fallback list is used when the platform command is not available.
      }
    }
    setEditFontSelectOptions(fonts);
    syncEditFontSelectValue(editCurrentTextFontFamily);
  })();
  await editFontFamiliesLoadPromise;
}

function getEditSizeReferenceLength(): number {
  if (!editCanvasEl) return 1;
  return Math.max(1, Math.max(editCanvasEl.width, editCanvasEl.height));
}

function makeDefaultEditSizeRatioByTool(): Record<EditToolWithSize, number> {
  const base = EDIT_SIZE_PERCENT_DEFAULT / 100;
  const textBase = EDIT_TEXT_SIZE_PERCENT_DEFAULT / 100;
  const mosaicBase = EDIT_MOSAIC_BRUSH_SIZE_PERCENT_DEFAULT / 100;
  const blurBase = EDIT_BLUR_BRUSH_SIZE_PERCENT_DEFAULT / 100;
  return {
    brush: base,
    text: textBase,
    shape: base,
    mosaic: mosaicBase,
    blur: blurBase,
  };
}

function makeDefaultEditColorByTool(): Record<EditToolWithSize, string> {
  return {
    brush: EDIT_COLOR_DEFAULT,
    text: EDIT_COLOR_DEFAULT,
    shape: EDIT_COLOR_DEFAULT,
    mosaic: EDIT_COLOR_DEFAULT,
    blur: EDIT_COLOR_DEFAULT,
  };
}

function pickTextMetric(actual: number, fallback: number, hardFallback: number): number {
  if (Number.isFinite(actual) && actual > 0) return actual;
  if (Number.isFinite(fallback) && fallback > 0) return fallback;
  return hardFallback;
}

function measureEditTextMetrics(
  ctx: CanvasRenderingContext2D,
  lines: string[],
  sizePx: number,
): { width: number; ascent: number; lineHeight: number; height: number } {
  const measuredLines = lines.length > 0 ? lines : [""];
  let width = 1;
  let ascent = 0;
  let descent = 0;
  for (const line of measuredLines) {
    const sample = line.length > 0 ? line : " ";
    const metrics = ctx.measureText(sample);
    const tightWidth = (metrics.actualBoundingBoxLeft || 0) + (metrics.actualBoundingBoxRight || 0);
    width = Math.max(width, Math.ceil(Math.max(tightWidth, metrics.width, line.length > 0 ? 1 : 0)));
    ascent = Math.max(
      ascent,
      pickTextMetric(metrics.actualBoundingBoxAscent, metrics.fontBoundingBoxAscent ?? NaN, sizePx * 0.75),
    );
    descent = Math.max(
      descent,
      pickTextMetric(metrics.actualBoundingBoxDescent, metrics.fontBoundingBoxDescent ?? NaN, sizePx * 0.2),
    );
  }
  const lineHeight = Math.max(1, ascent + descent);
  const height = Math.max(lineHeight, measuredLines.length * lineHeight);
  return { width, ascent, lineHeight, height };
}

function getEditSizePercentMin(tool: EditToolWithSize): number {
  if (tool === "text") return EDIT_TEXT_SIZE_PERCENT_MIN;
  if (tool === "mosaic") return EDIT_MOSAIC_BRUSH_SIZE_PERCENT_MIN;
  if (tool === "blur") return EDIT_BLUR_BRUSH_SIZE_PERCENT_MIN;
  return EDIT_SIZE_PERCENT_MIN;
}

function getEditSizePercentMax(tool: EditToolWithSize): number {
  if (tool === "mosaic") return EDIT_MOSAIC_BRUSH_SIZE_PERCENT_MAX;
  if (tool === "blur") return EDIT_BLUR_BRUSH_SIZE_PERCENT_MAX;
  return tool === "text" ? EDIT_TEXT_SIZE_PERCENT_MAX : EDIT_SIZE_PERCENT_MAX;
}

function getEditSizePercentDefault(tool: EditToolWithSize): number {
  return tool === "text" ? EDIT_TEXT_SIZE_PERCENT_DEFAULT : EDIT_SIZE_PERCENT_DEFAULT;
}

function getEditSizeSliderBounds(tool: EditToolWithSize): { min: number; max: number } {
  return {
    min: Math.round(getEditSizePercentMin(tool) / EDIT_SIZE_PERCENT_STEP),
    max: Math.round(getEditSizePercentMax(tool) / EDIT_SIZE_PERCENT_STEP),
  };
}

function clampEditSizeRatio(ratio: number, tool: EditToolWithSize): number {
  return clamp(ratio, getEditSizePercentMin(tool) / 100, getEditSizePercentMax(tool) / 100);
}

function getCurrentEditSizeTool(): EditToolWithSize {
  if (
    editToolMode === "brush"
    || editToolMode === "text"
    || editToolMode === "shape"
    || editToolMode === "mosaic"
    || editToolMode === "blur"
  ) {
    return editToolMode;
  }
  return "brush";
}

function getCurrentEditColorTool(): EditToolWithSize {
  if (editToolMode === "brush" || editToolMode === "text" || editToolMode === "shape") {
    return editToolMode;
  }
  return "brush";
}

function getEditColorForTool(tool: EditToolWithSize): string {
  const normalized = normalizeEditPaletteColor(editColorByTool[tool]);
  return normalized ?? EDIT_COLOR_DEFAULT;
}

function readEditSizeRatioFromControl(): number {
  const tool = getCurrentEditSizeTool();
  const defaultPercent = getEditSizePercentDefault(tool);
  const raw = Number(editSizeInputEl?.value ?? `${Math.round(defaultPercent / EDIT_SIZE_PERCENT_STEP)}`);
  if (!Number.isFinite(raw)) return defaultPercent / 100;
  return clampEditSizeRatio((raw * EDIT_SIZE_PERCENT_STEP) / 100, tool);
}

function setCurrentEditStrokeSizeRatio(ratio: number) {
  const tool = getCurrentEditSizeTool();
  editSizeRatioByTool[tool] = clampEditSizeRatio(ratio, tool);
}

function getEditStrokeSizeRatio(): number {
  const tool = getCurrentEditSizeTool();
  return clampEditSizeRatio(editSizeRatioByTool[tool], tool);
}

function editSizeRatioToSliderValue(ratio: number, tool: EditToolWithSize): string {
  const percent = clampEditSizeRatio(ratio, tool) * 100;
  return `${Math.round(percent / EDIT_SIZE_PERCENT_STEP)}`;
}

function percentToStepLevelLabel(percent: number, minPercent: number, maxPercent: number): string {
  const clamped = clamp(percent, minPercent, maxPercent);
  const level = Math.round((clamped - minPercent) / EDIT_SIZE_PERCENT_STEP) + 1;
  return `${Math.max(1, level)}`;
}

function editSizeRatioToLabel(ratio: number, tool: EditToolWithSize): string {
  const percent = clampEditSizeRatio(ratio, tool) * 100;
  return percentToStepLevelLabel(percent, getEditSizePercentMin(tool), getEditSizePercentMax(tool));
}

function editSizeRatioToPixels(ratio: number, tool: EditToolWithSize): number {
  return Math.max(1, Math.round(getEditSizeReferenceLength() * clampEditSizeRatio(ratio, tool)));
}

function getEditStrokeSize(): number {
  return editSizeRatioToPixels(getEditStrokeSizeRatio(), getCurrentEditSizeTool());
}

function getEditTextSizePx(item: EditTextItem): number {
  return editSizeRatioToPixels(item.size, "text");
}

function setEditSizeControlRatio(ratio: number) {
  if (!editSizeInputEl) return;
  const tool = getCurrentEditSizeTool();
  const bounds = getEditSizeSliderBounds(tool);
  editSizeInputEl.min = `${bounds.min}`;
  editSizeInputEl.max = `${bounds.max}`;
  const normalized = clampEditSizeRatio(ratio, tool);
  editSizeInputEl.value = editSizeRatioToSliderValue(normalized, tool);
  if (editSizeValueEl) {
    editSizeValueEl.textContent = editSizeRatioToLabel(normalized, tool);
  }
  updateRangeSliderVisual(editSizeInputEl);
}

function getEditShapeType(): EditShape {
  const raw = editShapeSelectEl?.value;
  if (raw === "ellipse" || raw === "line" || raw === "arrow" || raw === "double-arrow") return raw;
  return "rect";
}

function syncEditSizeValue() {
  setEditSizeControlRatio(getEditStrokeSizeRatio());
  updateEditBrushCursor();
}

function syncEditUndoButton() {
  if (!editUndoBtn) return;
  const canUndo = editHistoryIndex > 0;
  editUndoBtn.disabled = !canUndo;
}

function getSelectedEditTextItem(): EditTextItem | null {
  if (editSelectedTextId == null) return null;
  return editTextItems.find((item) => item.id === editSelectedTextId) ?? null;
}

function addEditUiLayer(kind: EditUiLayerKind, textId: number | null = null, rasterId: number | null = null) {
  const layer: EditUiLayer = {
    id: editNextUiLayerId++,
    kind,
    textId,
    rasterId,
  };
  editUiLayers.push(layer);
  editSelectedUiLayerId = layer.id;
}

function selectEditUiLayerByTextId(textId: number | null) {
  if (textId == null) return;
  const target = editUiLayers.find((layer) => layer.kind === "text" && layer.textId === textId);
  if (target) {
    editSelectedUiLayerId = target.id;
  }
}

function selectEditUiLayerByRasterId(rasterId: number | null) {
  if (rasterId == null) return;
  const target = editUiLayers.find((layer) => layer.rasterId === rasterId);
  if (target) {
    editSelectedUiLayerId = target.id;
    if (editMosaicSelectionOverlaySuppressedRasterId === rasterId) {
      editMosaicSelectionOverlaySuppressedRasterId = null;
    }
    if (editBlurSelectionOverlaySuppressedRasterId === rasterId) {
      editBlurSelectionOverlaySuppressedRasterId = null;
    }
  }
}

function cleanupEditUiLayers() {
  if (editUiLayers.length === 0) return;
  const before = editUiLayers.length;
  editUiLayers = editUiLayers.filter((layer) => {
    if (layer.kind === "text") {
      if (layer.textId == null) return false;
      return editTextItems.some((item) => item.id === layer.textId);
    }
    if (layer.rasterId == null) return false;
    return editRasterLayers.some((raster) => raster.id === layer.rasterId);
  });
  if (before !== editUiLayers.length && editSelectedUiLayerId != null) {
    if (!editUiLayers.some((layer) => layer.id === editSelectedUiLayerId)) {
      editSelectedUiLayerId = editUiLayers.length > 0 ? editUiLayers[editUiLayers.length - 1].id : null;
    }
  }
}

function getEditRasterLayerById(id: number | null): EditRasterLayer | null {
  if (id == null) return null;
  return editRasterLayers.find((layer) => layer.id === id) ?? null;
}

function cloneEditRasterLayers(layers: EditRasterLayer[]): EditRasterLayer[] {
  return layers.map((layer) => {
    const canvas = document.createElement("canvas");
    canvas.width = layer.canvas.width;
    canvas.height = layer.canvas.height;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (ctx) {
      ctx.drawImage(layer.canvas, 0, 0);
    }
    return {
      id: layer.id,
      kind: layer.kind,
      canvas,
      offsetX: layer.offsetX ?? 0,
      offsetY: layer.offsetY ?? 0,
      hasContent: !!layer.hasContent,
    };
  });
}

function cloneEditUiLayers(layers: EditUiLayer[]): EditUiLayer[] {
  return layers.map((layer) => ({ ...layer }));
}

function createEditRasterLayer(kind: "brush" | "shape" | "mosaic" | "blur"): EditRasterLayer | null {
  if (!editCanvasEl) return null;
  const width = editCanvasEl.width;
  const height = editCanvasEl.height;
  if (width <= 0 || height <= 0) return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const layer: EditRasterLayer = {
    id: editNextRasterLayerId++,
    kind,
    canvas,
    offsetX: 0,
    offsetY: 0,
    hasContent: false,
  };
  editRasterLayers.push(layer);
  addEditUiLayer(kind, null, layer.id);
  return layer;
}

function getOrCreateShapeRasterLayerForDraw(): EditRasterLayer | null {
  const selected = getSelectedEditUiLayer();
  if (selected && selected.kind === "shape") {
    const existing = getEditRasterLayerById(selected.rasterId);
    if (existing && !existing.hasContent) {
      return existing;
    }
  }
  return createEditRasterLayer("shape");
}

function getOrCreateBrushRasterLayerForDraw(): EditRasterLayer | null {
  const selected = getSelectedEditUiLayer();
  if (selected && selected.kind === "brush") {
    const existing = getEditRasterLayerById(selected.rasterId);
    if (existing) {
      return existing;
    }
  }
  return createEditRasterLayer("brush");
}

function getOrCreateMosaicBrushRasterLayerForDraw(): EditRasterLayer | null {
  const selected = getSelectedEditUiLayer();
  if (selected && selected.kind === "mosaic") {
    const existing = getEditRasterLayerById(selected.rasterId);
    if (existing && !editMosaicShapeByLayerId.has(existing.id)) {
      return existing;
    }
  }
  return createEditRasterLayer("mosaic");
}

function getOrCreateMosaicShapeRasterLayerForDraw(): EditRasterLayer | null {
  const selected = getSelectedEditUiLayer();
  if (selected && selected.kind === "mosaic") {
    const existing = getEditRasterLayerById(selected.rasterId);
    if (existing && !existing.hasContent && !editMosaicShapeByLayerId.has(existing.id)) {
      return existing;
    }
  }
  return createEditRasterLayer("mosaic");
}

function getOrCreateBlurBrushRasterLayerForDraw(): EditRasterLayer | null {
  const selected = getSelectedEditUiLayer();
  if (selected && selected.kind === "blur") {
    const existing = getEditRasterLayerById(selected.rasterId);
    if (existing && !editBlurShapeByLayerId.has(existing.id)) {
      return existing;
    }
  }
  return createEditRasterLayer("blur");
}

function getOrCreateBlurShapeRasterLayerForDraw(): EditRasterLayer | null {
  const selected = getSelectedEditUiLayer();
  if (selected && selected.kind === "blur") {
    const existing = getEditRasterLayerById(selected.rasterId);
    if (existing && !existing.hasContent && !editBlurShapeByLayerId.has(existing.id)) {
      return existing;
    }
  }
  return createEditRasterLayer("blur");
}

function getBrushRasterLayersForErase(): EditRasterLayer[] {
  const targets: EditRasterLayer[] = [];
  for (let i = editUiLayers.length - 1; i >= 0; i -= 1) {
    const uiLayer = editUiLayers[i];
    if (uiLayer.kind !== "brush") continue;
    const raster = getEditRasterLayerById(uiLayer.rasterId);
    if (!raster || !raster.hasContent) continue;
    targets.push(raster);
  }
  return targets;
}

function getMosaicRasterLayersForErase(): EditRasterLayer[] {
  const targets: EditRasterLayer[] = [];
  for (let i = editUiLayers.length - 1; i >= 0; i -= 1) {
    const uiLayer = editUiLayers[i];
    if (uiLayer.kind !== "mosaic") continue;
    const raster = getEditRasterLayerById(uiLayer.rasterId);
    if (!raster || !raster.hasContent) continue;
    // Keep shape-style mosaic layers protected from brush eraser.
    if (editMosaicShapeByLayerId.has(raster.id)) continue;
    targets.push(raster);
  }
  return targets;
}

function getBlurRasterLayersForErase(): EditRasterLayer[] {
  const targets: EditRasterLayer[] = [];
  for (let i = editUiLayers.length - 1; i >= 0; i -= 1) {
    const uiLayer = editUiLayers[i];
    if (uiLayer.kind !== "blur") continue;
    const raster = getEditRasterLayerById(uiLayer.rasterId);
    if (!raster || !raster.hasContent) continue;
    // Keep shape-style blur layers protected from brush eraser.
    if (editBlurShapeByLayerId.has(raster.id)) continue;
    targets.push(raster);
  }
  return targets;
}

function getSelectedEditUiLayer(): EditUiLayer | null {
  if (editSelectedUiLayerId == null) return null;
  return editUiLayers.find((layer) => layer.id === editSelectedUiLayerId) ?? null;
}

function getEditTextBounds(item: EditTextItem): { x: number; y: number; width: number; height: number } {
  if (item.align === "center") {
    return { x: item.x - item.width * 0.5, y: item.y, width: item.width, height: item.height };
  }
  if (item.align === "right") {
    return { x: item.x - item.width, y: item.y, width: item.width, height: item.height };
  }
  return { x: item.x, y: item.y, width: item.width, height: item.height };
}

function setEditControlVisibility(el: HTMLElement | null, visible: boolean) {
  if (!el) return;
  el.hidden = !visible;
  el.style.display = visible ? "" : "none";
}

function syncEditTextControls() {
  const isBrushMode = editToolMode === "brush";
  const isTextMode = editToolMode === "text";
  const isShapeMode = editToolMode === "shape";
  const isMosaicMode = editToolMode === "mosaic";
  const isBlurMode = editToolMode === "blur";
  const activeToolKind: EditUiLayerKind | null =
    editToolMode === "text"
      ? "text"
      : editToolMode === "brush"
        ? "brush"
        : editToolMode === "shape"
          ? "shape"
          : editToolMode === "mosaic"
            ? "mosaic"
            : editToolMode === "blur"
              ? "blur"
            : null;
  const hasActiveTool = !!activeToolKind;
  const showColorControls = hasActiveTool && !isMosaicMode && !isBlurMode && !(isBrushMode && getEditBrushMode() !== "draw");
  const selectedLayer = getSelectedEditUiLayer();
  const selectedLayerForTool = selectedLayer && selectedLayer.kind === activeToolKind ? selectedLayer : null;
  const hasLayer = !!selectedLayerForTool;
  const selected = hasLayer && isTextMode ? getSelectedEditTextItem() : null;

  setEditControlVisibility(editRightSettingsSectionEl, hasActiveTool);
  setEditControlVisibility(editSettingsEmptyEl, false);
  setEditControlVisibility(editSettingsTextRowEl, isTextMode);
  setEditControlVisibility(editSettingsFieldGridEl, hasActiveTool);
  if (editSettingsFieldGridEl) {
    editSettingsFieldGridEl.style.gridTemplateColumns = (isBrushMode || isTextMode || isShapeMode || isMosaicMode || isBlurMode)
      ? "minmax(0, 1fr)"
      : "minmax(0, 1fr) minmax(0, 1fr)";
  }
  setEditControlVisibility(editFieldShapeWrapEl, isShapeMode);
  setEditControlVisibility(editFieldFontWrapEl, isTextMode);
  setEditControlVisibility(editFieldBrushModeWrapEl, isBrushMode);
  setEditControlVisibility(editFieldMosaicStyleWrapEl, isMosaicMode);
  setEditControlVisibility(editFieldMosaicIntensityWrapEl, isMosaicMode);
  setEditControlVisibility(editFieldBlurStyleWrapEl, isBlurMode);
  setEditControlVisibility(editFieldBlurIntensityWrapEl, isBlurMode);
  setEditControlVisibility(editFieldAlignWrapEl, false);
  setEditControlVisibility(editFieldColorWrapEl, showColorControls);
  const sizeControlVisible = hasActiveTool
    && (!isMosaicMode || getEditMosaicStyle() === "brush")
    && (!isBlurMode || getEditBlurStyle() === "brush");
  setEditControlVisibility(editFieldSizeWrapEl, sizeControlVisible);
  setEditControlVisibility(editSizeValueEl, sizeControlVisible);
  if (editFieldSizeLabelEl) {
    if (isTextMode) {
      editFieldSizeLabelEl.textContent = "크기";
    } else if (isMosaicMode || isBlurMode) {
      editFieldSizeLabelEl.textContent = "브러쉬 크기";
    } else if (activeToolKind === "brush" || isShapeMode) {
      editFieldSizeLabelEl.textContent = "두께";
    } else {
      editFieldSizeLabelEl.textContent = "두께/크기";
    }
  }
  editColorSwatchEls.forEach((el) => {
    el.hidden = !showColorControls;
    el.style.display = showColorControls ? "" : "none";
  });

  if (editTextInputEl) {
    if (selected && isTextMode) {
      editTextInputEl.value = selected.text;
    }
    editTextInputEl.disabled = !isTextMode;
  }
  if (editTextAlignSelectEl) {
    editTextAlignSelectEl.disabled = true;
    editTextAlignSelectEl.value = selected?.align ?? "left";
  }
  if (isTextMode && selected) {
    editCurrentTextFontFamily = resolveEditFontCssName(selected.fontFamily);
  }
  syncEditFontSelectValue(isTextMode ? editCurrentTextFontFamily : normalizeEditFontFamilyName(editFontSelectEl?.value));
  if (editFontSelectEl) {
    editFontSelectEl.disabled = !isTextMode;
  }
  if (editTextDeleteBtn) {
    editTextDeleteBtn.disabled = !hasLayer;
  }
  if (editShapeSelectEl) {
    editShapeSelectEl.disabled = !isShapeMode;
  }
  if (editBrushModeSelectEl) {
    editBrushModeSelectEl.disabled = !isBrushMode;
    editBrushModeSelectEl.value = getEditBrushMode();
  }
  if (editMosaicStyleSelectEl) {
    editMosaicStyleSelectEl.disabled = !isMosaicMode;
    editMosaicStyleSelectEl.value = getEditMosaicStyleSelectValue();
  }
  if (editMosaicIntensityInputEl) {
    editMosaicIntensityInputEl.disabled = !isMosaicMode;
    syncEditMosaicIntensityControl();
  }
  if (editBlurStyleSelectEl) {
    editBlurStyleSelectEl.disabled = !isBlurMode;
    editBlurStyleSelectEl.value = getEditBlurStyleSelectValue();
  }
  if (editBlurIntensityInputEl) {
    editBlurIntensityInputEl.disabled = !isBlurMode;
    syncEditBlurIntensityControl();
  }
  if (editSizeInputEl) {
    editSizeInputEl.disabled = !sizeControlVisible;
  }
  if (editColorInputEl) {
    const toolColor = getEditColorForTool(getCurrentEditColorTool());
    const selectedColor = isTextMode && selected ? normalizeEditPaletteColor(selected.color) : null;
    const displayColor = selectedColor ?? toolColor;
    if (editColorInputEl.value.toLowerCase() !== displayColor) {
      editColorInputEl.value = displayColor;
    }
    syncEditColorSwatchSelection(displayColor);
    editColorInputEl.disabled = !showColorControls;
  } else {
    syncEditColorSwatchSelection(null);
  }
}

function clearEditLayerDropHints() {
  if (!editLayerListEl) return;
  const hinted = editLayerListEl.querySelectorAll<HTMLElement>(".edit-layer-item.is-drop-before, .edit-layer-item.is-drop-after");
  hinted.forEach((el) => {
    el.classList.remove("is-drop-before", "is-drop-after");
  });
}

function clearEditLayerDragClasses() {
  if (!editLayerListEl) return;
  const dragged = editLayerListEl.querySelectorAll<HTMLElement>(".edit-layer-item.is-dragging");
  dragged.forEach((el) => {
    el.classList.remove("is-dragging");
  });
  clearEditLayerDropHints();
}

function captureEditLayerListItemRects(): Map<number, DOMRect> {
  const rects = new Map<number, DOMRect>();
  if (!editLayerListEl) return rects;
  const items = editLayerListEl.querySelectorAll<HTMLButtonElement>(".edit-layer-item");
  items.forEach((item) => {
    const layerId = Number.parseInt(item.dataset.layerId ?? "", 10);
    if (!Number.isFinite(layerId)) return;
    rects.set(layerId, item.getBoundingClientRect());
  });
  return rects;
}

function animateEditLayerListReorderFrom(previousRects: Map<number, DOMRect>) {
  if (!editLayerListEl || previousRects.size === 0) return;
  const items = editLayerListEl.querySelectorAll<HTMLButtonElement>(".edit-layer-item");
  items.forEach((item) => {
    const layerId = Number.parseInt(item.dataset.layerId ?? "", 10);
    if (!Number.isFinite(layerId)) return;
    const oldRect = previousRects.get(layerId);
    if (!oldRect) return;
    const newRect = item.getBoundingClientRect();
    const deltaX = oldRect.left - newRect.left;
    const deltaY = oldRect.top - newRect.top;
    if (Math.abs(deltaX) < 0.5 && Math.abs(deltaY) < 0.5) return;
    item.animate(
      [
        { transform: `translate(${deltaX}px, ${deltaY}px)` },
        { transform: "translate(0, 0)" },
      ],
      { duration: 140, easing: "cubic-bezier(0.2, 0, 0.2, 1)" },
    );
  });
}

function markEditLayerDragJustDropped() {
  editLayerDragJustDropped = true;
  if (editLayerDropClearTimer != null) {
    window.clearTimeout(editLayerDropClearTimer);
  }
  editLayerDropClearTimer = window.setTimeout(() => {
    editLayerDragJustDropped = false;
    editLayerDropClearTimer = null;
  }, 0);
}

function resolveEditLayerDropCandidate(
  draggedLayerId: number,
  targetLayerId: number,
  placeBeforeTarget: boolean,
): { targetLayerId: number; placeBeforeTarget: boolean } | null {
  if (draggedLayerId === targetLayerId) return null;
  if (editUiLayers.length <= 1) return null;
  const visualLayers = [...editUiLayers].reverse();
  const fromIndex = visualLayers.findIndex((layer) => layer.id === draggedLayerId);
  const targetIndex = visualLayers.findIndex((layer) => layer.id === targetLayerId);
  if (fromIndex < 0 || targetIndex < 0) return null;
  const remaining = visualLayers.filter((layer) => layer.id !== draggedLayerId);
  let insertIndex = placeBeforeTarget ? targetIndex : targetIndex + 1;
  if (fromIndex < insertIndex) {
    insertIndex -= 1;
  }
  insertIndex = Math.max(0, Math.min(insertIndex, remaining.length));
  if (insertIndex === fromIndex) return null;
  if (remaining.length === 0) return null;

  if (insertIndex <= 0) {
    const firstId = remaining[0].id;
    return { targetLayerId: firstId, placeBeforeTarget: true };
  }
  if (insertIndex >= remaining.length) {
    const lastId = remaining[remaining.length - 1].id;
    return { targetLayerId: lastId, placeBeforeTarget: false };
  }
  const nextId = remaining[insertIndex].id;
  return { targetLayerId: nextId, placeBeforeTarget: true };
}

function buildReorderedEditUiLayersByDropTarget(
  draggedLayerId: number,
  targetLayerId: number,
  placeBeforeTarget: boolean,
): EditUiLayer[] | null {
  if (draggedLayerId === targetLayerId) return null;
  if (editUiLayers.length <= 1) return null;
  const visualLayers = [...editUiLayers].reverse();
  const fromIndex = visualLayers.findIndex((layer) => layer.id === draggedLayerId);
  const targetIndex = visualLayers.findIndex((layer) => layer.id === targetLayerId);
  if (fromIndex < 0 || targetIndex < 0) return null;
  const [moved] = visualLayers.splice(fromIndex, 1);
  let insertIndex = placeBeforeTarget ? targetIndex : targetIndex + 1;
  if (fromIndex < insertIndex) {
    insertIndex -= 1;
  }
  insertIndex = Math.max(0, Math.min(insertIndex, visualLayers.length));
  visualLayers.splice(insertIndex, 0, moved);
  const reordered = [...visualLayers].reverse();
  if (reordered.length !== editUiLayers.length) return null;
  for (let i = 0; i < reordered.length; i += 1) {
    if (reordered[i].id !== editUiLayers[i]?.id) {
      return reordered;
    }
  }
  return null;
}

function reorderEditUiLayersByDropTarget(
  draggedLayerId: number,
  targetLayerId: number,
  placeBeforeTarget: boolean,
): boolean {
  const reordered = buildReorderedEditUiLayersByDropTarget(draggedLayerId, targetLayerId, placeBeforeTarget);
  if (!reordered) return false;
  editUiLayers = reordered;
  if (editSelectedUiLayerId != null && !editUiLayers.some((layer) => layer.id === editSelectedUiLayerId)) {
    editSelectedUiLayerId = editUiLayers.length > 0 ? editUiLayers[editUiLayers.length - 1].id : null;
  }
  return true;
}

function syncEditLayerList() {
  cleanupEditUiLayers();
  if (!editLayerListEl) return;
  editLayerListEl.innerHTML = "";
  if (editUiLayers.length === 0) {
    const empty = document.createElement("span");
    empty.className = "edit-layer-empty";
    empty.textContent = "레이어 없음";
    editLayerListEl.appendChild(empty);
    return;
  }
  const textOrder = new Map<number, number>();
  const brushOrder = new Map<number, number>();
  const shapeOrder = new Map<number, number>();
  const mosaicOrder = new Map<number, number>();
  const blurOrder = new Map<number, number>();
  const textLayersByCreated = editUiLayers
    .filter((layer) => layer.kind === "text")
    .sort((a, b) => (a.textId ?? a.id) - (b.textId ?? b.id));
  for (let i = 0; i < textLayersByCreated.length; i += 1) {
    textOrder.set(textLayersByCreated[i].id, i + 1);
  }
  const brushLayersByCreated = editUiLayers
    .filter((layer) => layer.kind === "brush")
    .sort((a, b) => (a.rasterId ?? a.id) - (b.rasterId ?? b.id));
  for (let i = 0; i < brushLayersByCreated.length; i += 1) {
    brushOrder.set(brushLayersByCreated[i].id, i + 1);
  }
  const shapeLayersByCreated = editUiLayers
    .filter((layer) => layer.kind === "shape")
    .sort((a, b) => (a.rasterId ?? a.id) - (b.rasterId ?? b.id));
  for (let i = 0; i < shapeLayersByCreated.length; i += 1) {
    shapeOrder.set(shapeLayersByCreated[i].id, i + 1);
  }
  const mosaicLayersByCreated = editUiLayers
    .filter((layer) => layer.kind === "mosaic")
    .sort((a, b) => (a.rasterId ?? a.id) - (b.rasterId ?? b.id));
  for (let i = 0; i < mosaicLayersByCreated.length; i += 1) {
    mosaicOrder.set(mosaicLayersByCreated[i].id, i + 1);
  }
  const blurLayersByCreated = editUiLayers
    .filter((layer) => layer.kind === "blur")
    .sort((a, b) => (a.rasterId ?? a.id) - (b.rasterId ?? b.id));
  for (let i = 0; i < blurLayersByCreated.length; i += 1) {
    blurOrder.set(blurLayersByCreated[i].id, i + 1);
  }
  const frag = document.createDocumentFragment();
  for (let i = editUiLayers.length - 1; i >= 0; i -= 1) {
    const layer = editUiLayers[i];
    const button = document.createElement("button");
    button.type = "button";
    button.className = "edit-layer-item";
    button.draggable = false;
    button.dataset.layerId = `${layer.id}`;
    const label = document.createElement("span");
    label.className = "edit-layer-item-label";
    const remove = document.createElement("span");
    remove.className = "edit-layer-item-remove";
    remove.draggable = false;
    remove.textContent = "×";
    remove.setAttribute("aria-hidden", "true");
    if (layer.kind === "text") {
      label.textContent = `텍스트 ${textOrder.get(layer.id) ?? 1}`;
    } else if (layer.kind === "brush") {
      label.textContent = `브러쉬 ${brushOrder.get(layer.id) ?? 1}`;
    } else if (layer.kind === "mosaic") {
      label.textContent = `모자이크 ${mosaicOrder.get(layer.id) ?? 1}`;
    } else if (layer.kind === "blur") {
      label.textContent = `블러 ${blurOrder.get(layer.id) ?? 1}`;
    } else {
      label.textContent = `도형 ${shapeOrder.get(layer.id) ?? 1}`;
    }
    button.setAttribute("role", "option");
    button.setAttribute("aria-label", `${label.textContent} 레이어`);
    button.setAttribute("aria-selected", layer.id === editSelectedUiLayerId ? "true" : "false");
    if (layer.id === editSelectedUiLayerId) {
      button.classList.add("is-active");
    }
    button.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement | null;
      if (target?.classList.contains("edit-layer-item-remove")) return;
      const pointerId = e.pointerId;
      const draggedLayerId = layer.id;
      const startX = e.clientX;
      const startY = e.clientY;
      let dragActive = false;
      let dragReordered = false;
      editLayerPointerDragCleanup?.();
      editLayerPointerDragCleanup = null;

      const beginPointerDrag = () => {
        if (dragActive) return;
        dragActive = true;
        button.classList.add("is-dragging");
      };

      const clearPointerHandlers = () => {
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
        window.removeEventListener("pointercancel", onPointerCancel);
        if (editLayerPointerDragCleanup === clearPointerHandlers) {
          editLayerPointerDragCleanup = null;
        }
      };

      const finishPointerDrag = (ev: PointerEvent, canceled: boolean) => {
        if (ev.pointerId !== pointerId) return;
        clearPointerHandlers();
        if (!dragActive) return;
        ev.preventDefault();
        clearEditLayerDragClasses();
        markEditLayerDragJustDropped();
        if (canceled) return;
        if (dragReordered) {
          pushEditHistorySnapshot();
          updateEditCursorFromEvent();
        }
      };

      const applyDragReorderCandidate = (candidate: { targetLayerId: number; placeBeforeTarget: boolean } | null) => {
        if (!candidate) return false;
        const beforeRects = captureEditLayerListItemRects();
        const changed = reorderEditUiLayersByDropTarget(
          draggedLayerId,
          candidate.targetLayerId,
          candidate.placeBeforeTarget,
        );
        if (!changed) return false;
        dragReordered = true;
        renderEditCanvasFromState();
        animateEditLayerListReorderFrom(beforeRects);
        return true;
      };

      const onPointerMove = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        const movedDistance = Math.hypot(ev.clientX - startX, ev.clientY - startY);
        if (!dragActive && movedDistance < EDIT_LAYER_DRAG_START_THRESHOLD_PX) {
          return;
        }
        beginPointerDrag();
        ev.preventDefault();
        clearEditLayerDropHints();
        const hit = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null;
        const targetButton = hit?.closest(".edit-layer-item") as HTMLButtonElement | null;
        if (targetButton && editLayerListEl?.contains(targetButton)) {
          const targetLayerId = Number.parseInt(targetButton.dataset.layerId ?? "", 10);
          if (Number.isFinite(targetLayerId) && targetLayerId !== draggedLayerId) {
            const rect = targetButton.getBoundingClientRect();
            const candidatePlaceBefore = ev.clientY < rect.top + rect.height * 0.5;
            const candidate = resolveEditLayerDropCandidate(draggedLayerId, targetLayerId, candidatePlaceBefore);
            if (applyDragReorderCandidate(candidate)) {
              return;
            }
          }
        }
        const buttons = Array.from(editLayerListEl?.querySelectorAll<HTMLButtonElement>(".edit-layer-item") ?? []);
        if (buttons.length === 0) {
          return;
        }
        const firstButton = buttons[0];
        const lastButton = buttons[buttons.length - 1];
        const firstLayerId = Number.parseInt(firstButton.dataset.layerId ?? "", 10);
        const lastLayerId = Number.parseInt(lastButton.dataset.layerId ?? "", 10);
        const firstRect = firstButton.getBoundingClientRect();
        const lastRect = lastButton.getBoundingClientRect();
        if (ev.clientY < firstRect.top && Number.isFinite(firstLayerId) && firstLayerId !== draggedLayerId) {
          const candidate = resolveEditLayerDropCandidate(draggedLayerId, firstLayerId, true);
          if (applyDragReorderCandidate(candidate)) {
            return;
          }
        }
        if (ev.clientY > lastRect.bottom && Number.isFinite(lastLayerId) && lastLayerId !== draggedLayerId) {
          const candidate = resolveEditLayerDropCandidate(draggedLayerId, lastLayerId, false);
          if (applyDragReorderCandidate(candidate)) {
            return;
          }
        }
      };

      const onPointerUp = (ev: PointerEvent) => {
        finishPointerDrag(ev, false);
      };

      const onPointerCancel = (ev: PointerEvent) => {
        finishPointerDrag(ev, true);
      };

      window.addEventListener("pointermove", onPointerMove, { passive: false });
      window.addEventListener("pointerup", onPointerUp);
      window.addEventListener("pointercancel", onPointerCancel);
      editLayerPointerDragCleanup = clearPointerHandlers;
    });
    button.addEventListener("click", (e) => {
      if (editLayerDragJustDropped) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      const target = e.target as HTMLElement | null;
      if (target?.classList.contains("edit-layer-item-remove")) {
        editSelectedUiLayerId = layer.id;
        void deleteSelectedEditLayer();
        return;
      }
      editSelectedUiLayerId = layer.id;
      if (layer.kind === "text" && layer.textId != null) {
        const exists = editTextItems.some((item) => item.id === layer.textId);
        if (!exists) {
          renderEditCanvasFromState();
          return;
        }
        editSelectedTextId = layer.textId;
        setEditToolMode("text");
      } else if (layer.kind === "brush") {
        editSelectedTextId = null;
        setEditToolMode("brush");
      } else if (layer.kind === "mosaic") {
        editSelectedTextId = null;
        if (
          layer.rasterId != null
          && editMosaicSelectionOverlaySuppressedRasterId === layer.rasterId
        ) {
          editMosaicSelectionOverlaySuppressedRasterId = null;
        }
        setEditToolMode("mosaic");
      } else if (layer.kind === "blur") {
        editSelectedTextId = null;
        if (
          layer.rasterId != null
          && editBlurSelectionOverlaySuppressedRasterId === layer.rasterId
        ) {
          editBlurSelectionOverlaySuppressedRasterId = null;
        }
        setEditToolMode("blur");
      } else {
        editSelectedTextId = null;
        setEditToolMode("shape");
      }
      renderEditCanvasFromState();
      updateEditCursorFromEvent();
    });
    button.addEventListener("auxclick", (e) => {
      if (e.button !== 1) return;
      e.preventDefault();
      editSelectedUiLayerId = layer.id;
      void deleteSelectedEditLayer();
    });
    button.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      editSelectedUiLayerId = layer.id;
      void deleteSelectedEditLayer();
    });
    button.appendChild(label);
    button.appendChild(remove);
    frag.appendChild(button);
  }
  editLayerListEl.appendChild(frag);
}

function setEditCanvasCursor(cursor: string) {
  if (!editCanvasEl) return;
  editCanvasEl.style.cursor = cursor;
}

function hideEditBrushCursor() {
  if (!editBrushCursorEl) return;
  editBrushCursorEl.style.display = "none";
}

function syncEditCropHandleLayer() {
  if (!editCropHandleLayerEl || !editCanvasEl || !editCanvasWrapEl) return;
  const shouldShow = editModalOpen && editSidebarTab === "crop";
  if (!shouldShow) {
    editCropHandleLayerEl.hidden = true;
    return;
  }
  const rect = clampEditCropRectToBounds(editCropRect, editCanvasEl.width, editCanvasEl.height);
  if (!rect || rect.width <= 0 || rect.height <= 0) {
    editCropHandleLayerEl.hidden = true;
    return;
  }
  const canvasRect = editCanvasEl.getBoundingClientRect();
  const wrapRect = editCanvasWrapEl.getBoundingClientRect();
  if (canvasRect.width <= 0 || canvasRect.height <= 0 || wrapRect.width <= 0 || wrapRect.height <= 0) {
    editCropHandleLayerEl.hidden = true;
    return;
  }
  const scaleX = canvasRect.width / Math.max(1, editCanvasEl.width);
  const scaleY = canvasRect.height / Math.max(1, editCanvasEl.height);
  const left = (canvasRect.left - wrapRect.left) + rect.x * scaleX;
  const top = (canvasRect.top - wrapRect.top) + rect.y * scaleY;
  const width = Math.max(1, rect.width * scaleX);
  const height = Math.max(1, rect.height * scaleY);
  editCropHandleLayerEl.style.left = `${left}px`;
  editCropHandleLayerEl.style.top = `${top}px`;
  editCropHandleLayerEl.style.width = `${width}px`;
  editCropHandleLayerEl.style.height = `${height}px`;
  const handleSize = `${EDIT_CROP_HANDLE_SIZE_CSS_PX}px`;
  for (const handleEl of editCropHandleEls) {
    if (handleEl.style.width !== handleSize) {
      handleEl.style.width = handleSize;
      handleEl.style.height = handleSize;
    }
  }
  editCropHandleLayerEl.hidden = false;
}

function updateEditBrushCursor() {
  if (!editBrushCursorEl || !editCanvasEl || !editCanvasWrapEl) return;
  const shouldShow = editModalOpen
    && (
      editToolMode === "brush"
      || (editToolMode === "mosaic" && getEditMosaicStyle() === "brush")
      || (editToolMode === "blur" && getEditBlurStyle() === "brush")
    )
    && editCursorHasClientPoint;
  if (!shouldShow) {
    hideEditBrushCursor();
    return;
  }
  const canvasRect = editCanvasEl.getBoundingClientRect();
  const wrapRect = editCanvasWrapEl.getBoundingClientRect();
  const insideCanvas =
    editCursorClientX >= canvasRect.left &&
    editCursorClientX <= canvasRect.right &&
    editCursorClientY >= canvasRect.top &&
    editCursorClientY <= canvasRect.bottom;
  if (!insideCanvas) {
    hideEditBrushCursor();
    return;
  }

  const safeWidth = Math.max(1, editCanvasEl.width);
  const displayScale = Math.max(0.01, canvasRect.width / safeWidth);
  const diameter = Math.max(4, getEditStrokeSize() * displayScale);
  editBrushCursorEl.style.width = `${diameter}px`;
  editBrushCursorEl.style.height = `${diameter}px`;
  editBrushCursorEl.style.left = `${editCursorClientX - wrapRect.left}px`;
  editBrushCursorEl.style.top = `${editCursorClientY - wrapRect.top}px`;
  editBrushCursorEl.style.display = "block";
}

function getEditCursorForPoint(x: number, y: number): string {
  if (editSidebarTab === "crop") {
    if (editCropDragging) {
      return getEditCropCursorForMode(editCropDragMode);
    }
    return getEditCropCursorForMode(getEditCropDragModeAtPoint(x, y));
  }
  if (editToolMode === "text") {
    if (editDraggingTextId != null) return "grabbing";
    if (findEditTextItemAtPoint(x, y)) return "grab";
    return "text";
  }
  if (editToolMode === "brush") return "none";
  if (editToolMode === "mosaic") {
    if (getEditMosaicStyle() === "brush") return "none";
    if (editDraggingMosaicShapeLayerId != null) return "grabbing";
    return findMosaicShapeRasterLayerAtPoint(x, y) ? "grab" : "crosshair";
  }
  if (editToolMode === "blur") {
    if (getEditBlurStyle() === "brush") return "none";
    if (editDraggingBlurShapeLayerId != null) return "grabbing";
    return findBlurShapeRasterLayerAtPoint(x, y) ? "grab" : "crosshair";
  }
  if (editToolMode === "shape") {
    if (editDraggingShapeLayerId != null) return "grabbing";
    return findShapeRasterLayerAtPoint(x, y) ? "grab" : "crosshair";
  }
  return "default";
}

function updateEditCursorFromEvent(e?: PointerEvent) {
  if (!editCanvasEl) return;
  if (e) {
    editCursorClientX = e.clientX;
    editCursorClientY = e.clientY;
    editCursorHasClientPoint = true;
  }
  if (!editModalOpen) {
    setEditCanvasCursor("default");
    hideEditBrushCursor();
    return;
  }
  if (!e) {
    if (editSidebarTab === "crop") {
      setEditCanvasCursor(editCropDragging ? getEditCropCursorForMode(editCropDragMode) : "crosshair");
      updateEditBrushCursor();
      return;
    }
    if (editToolMode === "text" && editDraggingTextId != null) {
      setEditCanvasCursor("grabbing");
      updateEditBrushCursor();
      return;
    }
    if (editToolMode === "shape" && editDraggingShapeLayerId != null) {
      setEditCanvasCursor("grabbing");
      updateEditBrushCursor();
      return;
    }
    if (editToolMode === "mosaic" && editDraggingMosaicShapeLayerId != null) {
      setEditCanvasCursor("grabbing");
      updateEditBrushCursor();
      return;
    }
    if (editToolMode === "blur" && editDraggingBlurShapeLayerId != null) {
      setEditCanvasCursor("grabbing");
      updateEditBrushCursor();
      return;
    }
    if (editToolMode === "brush") {
      setEditCanvasCursor("none");
    } else if (editToolMode === "mosaic") {
      setEditCanvasCursor(getEditMosaicStyle() === "brush" ? "none" : "crosshair");
    } else if (editToolMode === "blur") {
      setEditCanvasCursor(getEditBlurStyle() === "brush" ? "none" : "crosshair");
    } else if (editToolMode === "text") {
      setEditCanvasCursor("text");
    } else if (editToolMode === "shape") {
      setEditCanvasCursor("crosshair");
    } else {
      setEditCanvasCursor("default");
    }
    updateEditBrushCursor();
    return;
  }
  const { x, y } = getEditCanvasPoint(e);
  setEditCanvasCursor(getEditCursorForPoint(x, y));
  updateEditBrushCursor();
}

function cloneImageData(source: ImageData): ImageData {
  return new ImageData(new Uint8ClampedArray(source.data), source.width, source.height);
}

function cloneEditColorAdjustState(source: EditColorAdjustState): EditColorAdjustState {
  return { ...source };
}

function createDefaultEditCurvePoints(): EditCurvePoint[] {
  return [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
  ];
}

function createDefaultEditCurveLayerData(): EditCurveLayerData {
  return {
    activeChannel: "rgb",
    pointsByChannel: {
      rgb: createDefaultEditCurvePoints(),
      r: createDefaultEditCurvePoints(),
      g: createDefaultEditCurvePoints(),
      b: createDefaultEditCurvePoints(),
    },
  };
}

function clampCurvePointValue(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function normalizeEditCurvePoints(points: EditCurvePoint[]): EditCurvePoint[] {
  const mapped = points.map((point) => ({
    x: clampCurvePointValue(point.x),
    y: clampCurvePointValue(point.y),
  }));
  mapped.sort((a, b) => a.x - b.x);
  const deduped: EditCurvePoint[] = [];
  for (const point of mapped) {
    const last = deduped[deduped.length - 1];
    if (last && Math.abs(last.x - point.x) < 0.00001) {
      last.y = point.y;
    } else {
      deduped.push(point);
    }
  }
  if (deduped.length === 0 || deduped[0].x > 0) {
    deduped.unshift({ x: 0, y: 0 });
  } else {
    deduped[0].x = 0;
    deduped[0].y = 0;
  }
  const last = deduped[deduped.length - 1];
  if (!last || last.x < 1) {
    deduped.push({ x: 1, y: 1 });
  } else {
    last.x = 1;
    last.y = 1;
  }
  return deduped;
}

function cloneEditCurveLayerData(data: EditCurveLayerData | null): EditCurveLayerData | null {
  if (!data) return null;
  const activeChannel = EDIT_CURVE_CHANNEL_ORDER.includes(data.activeChannel) ? data.activeChannel : "rgb";
  return {
    activeChannel,
    pointsByChannel: {
      rgb: normalizeEditCurvePoints(data.pointsByChannel.rgb ?? createDefaultEditCurvePoints()),
      r: normalizeEditCurvePoints(data.pointsByChannel.r ?? createDefaultEditCurvePoints()),
      g: normalizeEditCurvePoints(data.pointsByChannel.g ?? createDefaultEditCurvePoints()),
      b: normalizeEditCurvePoints(data.pointsByChannel.b ?? createDefaultEditCurvePoints()),
    },
  };
}

function cloneEditLut3DLayerData(data: EditLut3DLayerData | null): EditLut3DLayerData | null {
  if (!data) return null;
  return {
    ...data,
    domainMin: [...data.domainMin] as [number, number, number],
    domainMax: [...data.domainMax] as [number, number, number],
    inputShaper: data.inputShaper ? new Float32Array(data.inputShaper) : null,
    table: new Float32Array(data.table),
  };
}

function cloneEditColorLayers(layers: EditColorLayer[]): EditColorLayer[] {
  return layers.map((layer) => ({
    ...layer,
    curveData: cloneEditCurveLayerData(layer.curveData),
    lutData: cloneEditLut3DLayerData(layer.lutData),
  }));
}

function createDefaultEditColorAdjustState(): EditColorAdjustState {
  return {
    exposure: 0,
    contrast: 0,
    saturation: 0,
    temperature: 0,
    highlights: 0,
    shadows: 0,
  };
}

function clampEditColorAdjustValue(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(clamp(value, EDIT_COLOR_ADJUST_MIN, EDIT_COLOR_ADJUST_MAX));
}

function clampEditLutStrengthPercent(value: number): number {
  if (!Number.isFinite(value)) return EDIT_LUT_STRENGTH_DEFAULT;
  return Math.round(clamp(value, EDIT_LUT_STRENGTH_MIN, EDIT_LUT_STRENGTH_MAX));
}

function getEditColorAdjustStateKey(state: EditColorAdjustState): string {
  return [
    state.exposure,
    state.contrast,
    state.saturation,
    state.temperature,
    state.highlights,
    state.shadows,
  ].join("|");
}

function isEditColorAdjustIdentity(state: EditColorAdjustState): boolean {
  return (
    state.exposure === 0
    && state.contrast === 0
    && state.saturation === 0
    && state.temperature === 0
    && state.highlights === 0
    && state.shadows === 0
  );
}

function clearEditColorAdjustCache(options?: { clearBaseCanvas?: boolean }) {
  editColorAdjustedSourceRef = null;
  editColorAdjustedStateKey = "";
  editColorAdjustedCache = null;
  editColorAdjustedDraftSourceRef = null;
  editColorAdjustedDraftStateKey = "";
  editColorAdjustedDraftSizeKey = "";
  editColorAdjustedDraftCanvas = null;
  if (options?.clearBaseCanvas) {
    editColorAdjustBaseCanvasSourceRef = null;
    editColorAdjustBaseCanvas = null;
  }
}

function formatSignedPercent(value: number): string {
  if (value > 0) return `+${value}`;
  return `${value}`;
}

function getEditColorLayerKindLabel(kind: EditColorLayerKind): string {
  return EDIT_COLOR_LAYER_LABEL[kind];
}

function parseEditColorLayerKind(raw: string | null | undefined): EditColorLayerKind | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  if (EDIT_COLOR_LAYER_KIND_ORDER.includes(value as EditColorLayerKind)) {
    return value as EditColorLayerKind;
  }
  return null;
}

function getSelectedEditColorLayer(): EditColorLayer | null {
  if (editSelectedColorLayerId == null) return null;
  return editColorLayers.find((layer) => layer.id === editSelectedColorLayerId) ?? null;
}

function getEditCurveLayerData(layer: EditColorLayer | null): EditCurveLayerData | null {
  if (!layer || layer.kind !== "curve") return null;
  if (!layer.curveData) {
    layer.curveData = createDefaultEditCurveLayerData();
  }
  return layer.curveData;
}

function isEditCurveIdentity(data: EditCurveLayerData | null): boolean {
  if (!data) return true;
  for (const channel of EDIT_CURVE_CHANNEL_ORDER) {
    const points = normalizeEditCurvePoints(data.pointsByChannel[channel] ?? createDefaultEditCurvePoints());
    if (points.length !== 2) return false;
    if (points[0].x !== 0 || points[0].y !== 0) return false;
    if (points[1].x !== 1 || points[1].y !== 1) return false;
  }
  return true;
}

function hasActiveEditCurveAdjustments(): boolean {
  return editColorLayers.some((layer) => layer.kind === "curve" && !isEditCurveIdentity(layer.curveData));
}

function hasActiveEditLutAdjustments(): boolean {
  return editColorLayers.some((layer) => layer.kind === "lut" && !!layer.lutData && clampEditLutStrengthPercent(layer.lutStrength) > 0);
}

function getEditCurveLayerStateKey(layer: EditColorLayer): string {
  const data = getEditCurveLayerData(layer);
  if (!data) return `${layer.id}:none`;
  const channelKey = EDIT_CURVE_CHANNEL_ORDER
    .map((channel) => `${channel}:${normalizeEditCurvePoints(data.pointsByChannel[channel])
      .map((point) => `${point.x.toFixed(4)},${point.y.toFixed(4)}`).join(";")}`)
    .join("|");
  return `${layer.id}:${channelKey}`;
}

function getEditCurveStateKey(): string {
  return editColorLayers
    .filter((layer) => layer.kind === "curve")
    .map((layer) => getEditCurveLayerStateKey(layer))
    .join("||");
}

function getEditLutLayerStateKey(layer: EditColorLayer): string {
  if (layer.kind !== "lut" || !layer.lutData) return `${layer.id}:none`;
  const lut = layer.lutData;
  return `${layer.id}:${lut.token}:${lut.size}:${lut.sourcePath}:${clampEditLutStrengthPercent(layer.lutStrength)}`;
}

function getEditLutStateKey(): string {
  return editColorLayers
    .filter((layer) => layer.kind === "lut")
    .map((layer) => getEditLutLayerStateKey(layer))
    .join("||");
}

function getEditColorPipelineStateKey(): string {
  return `${getEditColorAdjustStateKey(editColorAdjustState)}::curve=${getEditCurveStateKey()}::lut=${getEditLutStateKey()}`;
}

function rebuildEditColorAdjustStateFromLayers() {
  const nextState = createDefaultEditColorAdjustState();
  for (const layer of editColorLayers) {
    if (layer.kind === "curve" || layer.kind === "lut") {
      continue;
    }
    nextState[layer.kind] = clampEditColorAdjustValue(nextState[layer.kind] + layer.value);
  }
  editColorAdjustState = nextState;
}

function syncEditColorLayerToolButtons() {
  const selectedLayer = getSelectedEditColorLayer();
  for (const button of editColorToolButtonEls) {
    const kind = parseEditColorLayerKind(button.dataset.colorLayerKind);
    button.classList.toggle("is-active", kind != null && kind === selectedLayer?.kind);
  }
}

function getEditColorLayerDisplayIndex(layer: EditColorLayer): number {
  let index = 0;
  for (const item of editColorLayers) {
    if (item.kind !== layer.kind) continue;
    index += 1;
    if (item.id === layer.id) {
      return index;
    }
  }
  return Math.max(1, index);
}

function buildEditColorLayerChipLabel(layer: EditColorLayer): string {
  const layerName = getEditColorLayerKindLabel(layer.kind);
  const index = getEditColorLayerDisplayIndex(layer);
  return `${layerName} ${index}`;
}

function parseCubeLutTriplet(tokens: string[], label: string): [number, number, number] {
  if (tokens.length < 4) {
    throw new Error(`${label} 값이 올바르지 않습니다.`);
  }
  const a = Number.parseFloat(tokens[1]);
  const b = Number.parseFloat(tokens[2]);
  const c = Number.parseFloat(tokens[3]);
  if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c)) {
    throw new Error(`${label} 값이 올바르지 않습니다.`);
  }
  return [a, b, c];
}

function parseCubeLutFromText(text: string, sourcePath: string, sourceName: string): EditLut3DLayerData {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  let title = "";
  let size = 0;
  let domainMin: [number, number, number] = [0, 0, 0];
  let domainMax: [number, number, number] = [1, 1, 1];
  const values: number[] = [];

  for (const line of lines) {
    const clean = line.replace(/\s*#.*$/, "").trim();
    if (!clean) continue;
    const tokens = clean.split(/\s+/);
    const head = tokens[0]?.toUpperCase() ?? "";
    if (head === "TITLE") {
      const quoted = clean.match(/^TITLE\s+"(.+)"$/i);
      const rawTitle = quoted ? quoted[1] : tokens.slice(1).join(" ");
      title = rawTitle.trim();
      continue;
    }
    if (head === "LUT_1D_SIZE") {
      throw new Error("1D LUT는 아직 지원하지 않습니다. 3D LUT(.cube)를 사용해주세요.");
    }
    if (head === "LUT_3D_SIZE") {
      const n = Number.parseInt(tokens[1] ?? "", 10);
      if (!Number.isFinite(n) || n < 2 || n > 256) {
        throw new Error("LUT_3D_SIZE 값이 올바르지 않습니다.");
      }
      size = n;
      continue;
    }
    if (head === "DOMAIN_MIN") {
      domainMin = parseCubeLutTriplet(tokens, "DOMAIN_MIN");
      continue;
    }
    if (head === "DOMAIN_MAX") {
      domainMax = parseCubeLutTriplet(tokens, "DOMAIN_MAX");
      continue;
    }

    const r = Number.parseFloat(tokens[0] ?? "");
    const g = Number.parseFloat(tokens[1] ?? "");
    const b = Number.parseFloat(tokens[2] ?? "");
    if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) {
      throw new Error("LUT 데이터 행을 해석할 수 없습니다.");
    }
    values.push(r, g, b);
  }

  if (size < 2) {
    throw new Error("LUT_3D_SIZE 헤더가 없습니다.");
  }
  for (let i = 0; i < 3; i += 1) {
    if (domainMax[i] - domainMin[i] < 0.0000001) {
      throw new Error("DOMAIN_MIN/DOMAIN_MAX 범위가 올바르지 않습니다.");
    }
  }
  const expectedCount = size * size * size * 3;
  if (values.length !== expectedCount) {
    throw new Error(`LUT 데이터 개수가 맞지 않습니다. 기대값 ${expectedCount}개, 실제 ${values.length}개`);
  }

  const table = new Float32Array(expectedCount);
  for (let i = 0; i < expectedCount; i += 1) {
    const value = values[i];
    table[i] = Number.isFinite(value) ? value : 0;
  }

  return {
    title: title || sourceName,
    sourcePath,
    sourceName: sourceName || title || "LUT",
    size,
    domainMin,
    domainMax,
    inputShaper: null,
    table,
    token: editNextLutToken++,
  };
}

function stripLutComment(line: string): string {
  const hashIndex = line.indexOf("#");
  const semiIndex = line.indexOf(";");
  const slashesIndex = line.indexOf("//");
  let cutIndex = -1;
  for (const idx of [hashIndex, semiIndex, slashesIndex]) {
    if (idx >= 0 && (cutIndex < 0 || idx < cutIndex)) {
      cutIndex = idx;
    }
  }
  return cutIndex >= 0 ? line.slice(0, cutIndex) : line;
}

function parseLutNumericTokens(rawLine: string): number[] | null {
  const clean = stripLutComment(rawLine).trim();
  if (!clean) return null;
  const tokens = clean.split(/\s+/);
  const numbers = new Array<number>(tokens.length);
  for (let i = 0; i < tokens.length; i += 1) {
    const value = Number.parseFloat(tokens[i]);
    if (!Number.isFinite(value)) return null;
    numbers[i] = value;
  }
  return numbers;
}

function normalizeChannelTriplets(
  rows: Array<[number, number, number]>,
  scaleHint?: number,
): Array<[number, number, number]> {
  let minValue = Number.POSITIVE_INFINITY;
  let maxValue = Number.NEGATIVE_INFINITY;
  for (const row of rows) {
    minValue = Math.min(minValue, row[0], row[1], row[2]);
    maxValue = Math.max(maxValue, row[0], row[1], row[2]);
  }
  const resolveScale = (): number => {
    let scale = Number.isFinite(scaleHint) && (scaleHint ?? 0) > 1 ? (scaleHint as number) : 0;
    if (scale > 0 && scale < (maxValue * 0.98)) {
      scale = 0;
    }
    if (minValue >= 0 && maxValue > 1 && scale <= 1) {
      const bits = Math.ceil(Math.log2(maxValue + 1));
      const snapped = bits > 0 ? (Math.pow(2, bits) - 1) : maxValue;
      if (Number.isFinite(snapped) && snapped >= maxValue && snapped <= maxValue * 2.2) {
        scale = snapped;
      } else {
        scale = maxValue;
      }
    }
    if (!(scale > 0)) {
      scale = maxValue;
    }
    return scale;
  };
  const scale = resolveScale();
  const normalizeValue = (v: number): number => {
    if (!Number.isFinite(v)) return 0;
    if (maxValue <= minValue + 0.0000001) {
      return clamp(v, 0, 1);
    }
    if (minValue >= 0 && maxValue <= 1) {
      return clamp(v, 0, 1);
    }
    if (minValue >= 0 && maxValue > 1) {
      return clamp(v / Math.max(scale, 0.0000001), 0, 1);
    }
    return clamp((v - minValue) / (maxValue - minValue), 0, 1);
  };
  return rows.map((row) => ([
    normalizeValue(row[0]),
    normalizeValue(row[1]),
    normalizeValue(row[2]),
  ]));
}

function buildNormalizedShaperFromGridValues(gridValues: number[]): Float32Array | null {
  if (gridValues.length < 2) return null;
  const out = new Float32Array(gridValues.length);
  const first = gridValues[0];
  const last = gridValues[gridValues.length - 1];
  const increasing = last > first;
  if (!increasing || !Number.isFinite(first) || !Number.isFinite(last)) {
    return null;
  }
  const span = last - first;
  if (span < 0.0000001) return null;
  for (let i = 0; i < gridValues.length; i += 1) {
    const v = gridValues[i];
    if (!Number.isFinite(v)) return null;
    out[i] = clamp((v - first) / span, 0, 1);
    if (i > 0 && out[i] < out[i - 1]) {
      return null;
    }
  }
  out[0] = 0;
  out[out.length - 1] = 1;
  return out;
}

function parse3dlLutFromText(
  text: string,
  sourcePath: string,
  sourceName: string,
  options?: { bgrFastOrder?: boolean },
): EditLut3DLayerData {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  let title = "";
  let gridValues: number[] | null = null;
  const rows: Array<[number, number, number]> = [];

  for (const line of lines) {
    const clean = stripLutComment(line).trim();
    if (!clean) continue;
    const titleMatch = clean.match(/^TITLE\s+"?(.+?)"?$/i);
    if (titleMatch) {
      title = titleMatch[1].trim();
      continue;
    }
    const values = parseLutNumericTokens(clean);
    if (!values) {
      continue;
    }
    if (!gridValues && values.length > 3) {
      gridValues = values;
      continue;
    }
    if (values.length >= 3) {
      rows.push([values[0], values[1], values[2]]);
    }
  }

  if (rows.length === 0) {
    throw new Error("3DL 데이터 행을 찾을 수 없습니다.");
  }
  const size = gridValues?.length ?? Math.round(Math.cbrt(rows.length));
  if (!Number.isFinite(size) || size < 2 || size > 256) {
    throw new Error("3DL 크기 정보를 확인할 수 없습니다.");
  }
  const expectedRows = size * size * size;
  if (rows.length !== expectedRows) {
    throw new Error(`3DL 데이터 개수가 맞지 않습니다. 기대값 ${expectedRows}개, 실제 ${rows.length}개`);
  }

  const gridMaxHint = gridValues && gridValues.length > 0 ? Math.max(...gridValues) : undefined;
  const normalizedRows = normalizeChannelTriplets(rows, gridMaxHint);
  const inputShaper = gridValues && gridValues.length === size
    ? buildNormalizedShaperFromGridValues(gridValues)
    : null;
  // 3D LUT Creator 계열 3DL은 파일 순서가 B-fast, G-mid, R-slow인 경우가 많다.
  // 옵션으로 활성화된 경우에만 cube 내부 순서(R-fast)로 재정렬한다.
  const useBgrFastOrder = options?.bgrFastOrder === true;
  const table = new Float32Array(expectedRows * 3);
  for (let n = 0; n < expectedRows; n += 1) {
    const src = normalizedRows[n];
    const dstIndex = (() => {
      if (!useBgrFastOrder) return n;
      const b = n % size;
      const g = Math.floor(n / size) % size;
      const r = Math.floor(n / (size * size));
      return ((b * size) + g) * size + r;
    })();
    const offset = dstIndex * 3;
    table[offset] = src[0];
    table[offset + 1] = src[1];
    table[offset + 2] = src[2];
  }

  return {
    title: title || sourceName,
    sourcePath,
    sourceName: sourceName || title || "LUT",
    size,
    domainMin: [0, 0, 0],
    domainMax: [1, 1, 1],
    inputShaper,
    table,
    token: editNextLutToken++,
  };
}

function sample1dLutCurve(curve: Float32Array, x: number): number {
  if (curve.length <= 1) return curve[0] ?? 0;
  const scaled = clamp(x, 0, 1) * (curve.length - 1);
  const lo = Math.floor(scaled);
  const hi = lo >= curve.length - 1 ? curve.length - 1 : lo + 1;
  const t = scaled - lo;
  return curve[lo] + ((curve[hi] - curve[lo]) * t);
}

function parse1dLutAs3dFromText(text: string, sourcePath: string, sourceName: string): EditLut3DLayerData {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  let title = "";
  const rawRows: number[][] = [];
  for (const line of lines) {
    const clean = stripLutComment(line).trim();
    if (!clean) continue;
    const titleMatch = clean.match(/^TITLE\s+"?(.+?)"?$/i);
    if (titleMatch) {
      title = titleMatch[1].trim();
      continue;
    }
    const values = parseLutNumericTokens(clean);
    if (!values || values.length < 3) continue;
    rawRows.push(values);
  }
  if (rawRows.length < 2) {
    throw new Error("LUT 데이터 행을 해석할 수 없습니다.");
  }

  const has4Cols = rawRows.some((row) => row.length >= 4);
  let useInputPlusRgb = false;
  if (has4Cols) {
    // Common .lut format: input R G B (4 columns). Detect monotonic first column.
    useInputPlusRgb = true;
    let prev = Number.NEGATIVE_INFINITY;
    for (const row of rawRows) {
      if (row.length < 4) {
        useInputPlusRgb = false;
        break;
      }
      const input = row[0];
      if (!Number.isFinite(input) || input + 0.000001 < prev) {
        useInputPlusRgb = false;
        break;
      }
      prev = input;
    }
  }

  const rows: Array<[number, number, number]> = rawRows.map((row) => {
    if (useInputPlusRgb && row.length >= 4) {
      return [row[1], row[2], row[3]];
    }
    if (row.length >= 3) {
      const base = row.length - 3;
      return [row[base], row[base + 1], row[base + 2]];
    }
    return [0, 0, 0];
  });

  const normalizedRows = normalizeChannelTriplets(rows);
  const curveR = new Float32Array(normalizedRows.length);
  const curveG = new Float32Array(normalizedRows.length);
  const curveB = new Float32Array(normalizedRows.length);
  for (let i = 0; i < normalizedRows.length; i += 1) {
    curveR[i] = normalizedRows[i][0];
    curveG[i] = normalizedRows[i][1];
    curveB[i] = normalizedRows[i][2];
  }

  const size = 33;
  const table = new Float32Array(size * size * size * 3);
  let cursor = 0;
  for (let bz = 0; bz < size; bz += 1) {
    const bIn = bz / (size - 1);
    for (let gy = 0; gy < size; gy += 1) {
      const gIn = gy / (size - 1);
      for (let rx = 0; rx < size; rx += 1) {
        const rIn = rx / (size - 1);
        table[cursor] = sample1dLutCurve(curveR, rIn);
        table[cursor + 1] = sample1dLutCurve(curveG, gIn);
        table[cursor + 2] = sample1dLutCurve(curveB, bIn);
        cursor += 3;
      }
    }
  }

  return {
    title: title || sourceName,
    sourcePath,
    sourceName: sourceName || title || "LUT",
    size,
    domainMin: [0, 0, 0],
    domainMax: [1, 1, 1],
    inputShaper: null,
    table,
    token: editNextLutToken++,
  };
}

function parseLutFromTextByExt(text: string, sourcePath: string, sourceName: string): EditLut3DLayerData {
  const ext = getExt(sourcePath);
  if (ext === "3dl") {
    return parse3dlLutFromText(text, sourcePath, sourceName, { bgrFastOrder: true });
  }
  if (ext === "lut") {
    try {
      return parseCubeLutFromText(text, sourcePath, sourceName);
    } catch {
      try {
        return parse3dlLutFromText(text, sourcePath, sourceName, { bgrFastOrder: false });
      } catch {
        return parse1dLutAs3dFromText(text, sourcePath, sourceName);
      }
    }
  }
  try {
    return parseCubeLutFromText(text, sourcePath, sourceName);
  } catch {
    return parse3dlLutFromText(text, sourcePath, sourceName, { bgrFastOrder: true });
  }
}

async function loadEditLutFromDialog(layer: EditColorLayer, pushHistory = true): Promise<boolean> {
  if (layer.kind !== "lut") return false;
  if (!isTauri()) {
    showBottomToast("LUT 불러오기는 데스크톱 앱에서만 지원됩니다.");
    return false;
  }
  try {
    const picked = await open({
      multiple: false,
      filters: [
        {
          name: "LUT 파일",
          extensions: ["cube", "3dl", "lut"],
        },
      ],
    });
    if (typeof picked !== "string" || !picked) {
      return false;
    }
    if (!isAbsoluteFilePath(picked)) {
      showBottomToast("LUT 파일 경로를 확인할 수 없습니다.");
      return false;
    }
    const data = await invoke<ArrayBuffer>("read_image_file_bytes", { path: picked });
    const text = new TextDecoder("utf-8").decode(data);
    const parsed = parseLutFromTextByExt(text, picked, getBaseName(picked));
    layer.lutData = parsed;
    clearEditColorAdjustCache();
    syncEditColorLayerControls();
    if (editModalOpen && editCanvasEl) {
      if (editColorAdjustPreviewRaf) {
        window.cancelAnimationFrame(editColorAdjustPreviewRaf);
        editColorAdjustPreviewRaf = 0;
      }
      renderEditCanvasFromState({
        includeSelection: false,
        includeCropOverlay: false,
      });
    }
    if (pushHistory) {
      pushEditHistorySnapshot();
    }
    showBottomToast(`LUT 적용: ${parsed.sourceName}`);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : "LUT 파일을 불러오지 못했습니다.";
    showBottomToast(`LUT 불러오기 실패: ${message}`);
    return false;
  }
}

type EditCurveLutSet = {
  rgb: Uint8Array;
  r: Uint8Array;
  g: Uint8Array;
  b: Uint8Array;
};

function buildCurveLutFromPoints(points: EditCurvePoint[]): Uint8Array {
  const normalized = normalizeEditCurvePoints(points);
  if (normalized.length <= 2) {
    const lut = new Uint8Array(256);
    const p0 = normalized[0];
    const p1 = normalized[1];
    const dx = Math.max(0.000001, p1.x - p0.x);
    for (let i = 0; i < 256; i += 1) {
      const x = i / 255;
      const t = clamp((x - p0.x) / dx, 0, 1);
      const y = p0.y + ((p1.y - p0.y) * t);
      lut[i] = y <= 0 ? 0 : (y >= 1 ? 255 : Math.round(y * 255));
    }
    return lut;
  }

  const count = normalized.length;
  const slopes = new Array<number>(count).fill(0);
  const h = new Array<number>(count - 1).fill(0);
  const delta = new Array<number>(count - 1).fill(0);
  for (let i = 0; i < count - 1; i += 1) {
    const dx = Math.max(0.000001, normalized[i + 1].x - normalized[i].x);
    h[i] = dx;
    delta[i] = (normalized[i + 1].y - normalized[i].y) / dx;
  }
  slopes[0] = delta[0];
  slopes[count - 1] = delta[count - 2];
  for (let i = 1; i < count - 1; i += 1) {
    const d0 = delta[i - 1];
    const d1 = delta[i];
    if (d0 === 0 || d1 === 0 || d0 * d1 < 0) {
      slopes[i] = 0;
      continue;
    }
    const w1 = (2 * h[i]) + h[i - 1];
    const w2 = h[i] + (2 * h[i - 1]);
    slopes[i] = (w1 + w2) / ((w1 / d0) + (w2 / d1));
  }
  for (let i = 0; i < count - 1; i += 1) {
    const d = delta[i];
    if (d === 0) {
      slopes[i] = 0;
      slopes[i + 1] = 0;
      continue;
    }
    const a = slopes[i] / d;
    const b = slopes[i + 1] / d;
    const sum = (a * a) + (b * b);
    if (sum > 9) {
      const t = 3 / Math.sqrt(sum);
      slopes[i] = t * a * d;
      slopes[i + 1] = t * b * d;
    }
  }

  const evalY = (x: number): number => {
    let idx = 0;
    while (idx < count - 2 && x > normalized[idx + 1].x) {
      idx += 1;
    }
    const p0 = normalized[idx];
    const p1 = normalized[idx + 1];
    const dx = Math.max(0.000001, p1.x - p0.x);
    const t = clamp((x - p0.x) / dx, 0, 1);
    const t2 = t * t;
    const t3 = t2 * t;
    const h00 = (2 * t3) - (3 * t2) + 1;
    const h10 = t3 - (2 * t2) + t;
    const h01 = (-2 * t3) + (3 * t2);
    const h11 = t3 - t2;
    const y = (h00 * p0.y) + (h10 * dx * slopes[idx]) + (h01 * p1.y) + (h11 * dx * slopes[idx + 1]);
    return clampCurvePointValue(y);
  };

  const lut = new Uint8Array(256);
  for (let i = 0; i < 256; i += 1) {
    const y = evalY(i / 255);
    lut[i] = y <= 0 ? 0 : (y >= 1 ? 255 : Math.round(y * 255));
  }
  return lut;
}

function composeCurveLut(base: Uint8Array, next: Uint8Array): Uint8Array {
  const out = new Uint8Array(256);
  for (let i = 0; i < 256; i += 1) {
    out[i] = next[base[i]];
  }
  return out;
}

function createIdentityCurveLut(): Uint8Array {
  const lut = new Uint8Array(256);
  for (let i = 0; i < 256; i += 1) {
    lut[i] = i;
  }
  return lut;
}

function buildCombinedCurveLutSetFromLayers(): EditCurveLutSet | null {
  let rgb = createIdentityCurveLut();
  let r = createIdentityCurveLut();
  let g = createIdentityCurveLut();
  let b = createIdentityCurveLut();
  let hasAny = false;
  for (const layer of editColorLayers) {
    if (layer.kind !== "curve") continue;
    const data = getEditCurveLayerData(layer);
    if (!data || isEditCurveIdentity(data)) continue;
    hasAny = true;
    rgb = composeCurveLut(rgb, buildCurveLutFromPoints(data.pointsByChannel.rgb));
    r = composeCurveLut(r, buildCurveLutFromPoints(data.pointsByChannel.r));
    g = composeCurveLut(g, buildCurveLutFromPoints(data.pointsByChannel.g));
    b = composeCurveLut(b, buildCurveLutFromPoints(data.pointsByChannel.b));
  }
  if (!hasAny) return null;
  return { rgb, r, g, b };
}

type EditActiveLutLayer = {
  lut: EditLut3DLayerData;
  strength: number;
};

function buildActiveLut3DLayerListFromLayers(): EditActiveLutLayer[] {
  return editColorLayers
    .filter((layer): layer is EditColorLayer & { kind: "lut"; lutData: EditLut3DLayerData } => layer.kind === "lut" && !!layer.lutData)
    .map((layer) => ({
      lut: layer.lutData,
      strength: clamp(layer.lutStrength / 100, 0, 2),
    }))
    .filter((layer) => layer.strength > 0);
}

type EditLutAxisMap = {
  low: Uint16Array;
  high: Uint16Array;
  t: Float32Array;
};

type EditPreparedLut3DLayer = {
  lut: EditLut3DLayerData;
  strength: number;
  rAxis: EditLutAxisMap;
  gAxis: EditLutAxisMap;
  bAxis: EditLutAxisMap;
};

function buildLutAxisMap(min: number, max: number, size: number): EditLutAxisMap {
  const low = new Uint16Array(256);
  const high = new Uint16Array(256);
  const t = new Float32Array(256);
  const span = max - min;
  const maxIndex = size - 1;
  for (let i = 0; i < 256; i += 1) {
    const value = i / 255;
    const normalized = clamp((value - min) / span, 0, 1) * maxIndex;
    const lo = Math.floor(normalized);
    const hi = lo >= maxIndex ? maxIndex : lo + 1;
    low[i] = lo;
    high[i] = hi;
    t[i] = normalized - lo;
  }
  return { low, high, t };
}

function buildLutAxisMapFromShaper(shaper: Float32Array): EditLutAxisMap {
  const size = shaper.length;
  const low = new Uint16Array(256);
  const high = new Uint16Array(256);
  const t = new Float32Array(256);
  if (size < 2) {
    for (let i = 0; i < 256; i += 1) {
      low[i] = 0;
      high[i] = 0;
      t[i] = 0;
    }
    return { low, high, t };
  }
  const maxIndex = size - 1;
  let cursor = 1;
  for (let i = 0; i < 256; i += 1) {
    const x = i / 255;
    while (cursor < maxIndex && shaper[cursor] < x) {
      cursor += 1;
    }
    const hi = clamp(cursor, 1, maxIndex);
    const lo = hi - 1;
    const loV = shaper[lo];
    const hiV = shaper[hi];
    const span = hiV - loV;
    low[i] = lo;
    high[i] = hi;
    t[i] = span > 0.0000001 ? clamp((x - loV) / span, 0, 1) : 0;
  }
  return { low, high, t };
}

function buildPreparedLut3DLayer(layer: EditActiveLutLayer): EditPreparedLut3DLayer {
  const lut = layer.lut;
  const useShaper = !!lut.inputShaper && lut.inputShaper.length === lut.size;
  const shaperAxis = useShaper ? buildLutAxisMapFromShaper(lut.inputShaper as Float32Array) : null;
  return {
    lut,
    strength: layer.strength,
    rAxis: shaperAxis ?? buildLutAxisMap(lut.domainMin[0], lut.domainMax[0], lut.size),
    gAxis: shaperAxis ?? buildLutAxisMap(lut.domainMin[1], lut.domainMax[1], lut.size),
    bAxis: shaperAxis ?? buildLutAxisMap(lut.domainMin[2], lut.domainMax[2], lut.size),
  };
}

function getEditCurveCanvasPlotRect(canvas: HTMLCanvasElement): { left: number; top: number; size: number } {
  const size = Math.max(10, Math.min(canvas.width, canvas.height) - (EDIT_CURVE_CANVAS_PADDING * 2));
  const left = Math.floor((canvas.width - size) * 0.5);
  const top = Math.floor((canvas.height - size) * 0.5);
  return { left, top, size };
}

function curvePointToCanvasPos(point: EditCurvePoint, canvas: HTMLCanvasElement): { x: number; y: number } {
  const plot = getEditCurveCanvasPlotRect(canvas);
  return {
    x: plot.left + (point.x * plot.size),
    y: plot.top + ((1 - point.y) * plot.size),
  };
}

function canvasPosToCurvePoint(x: number, y: number, canvas: HTMLCanvasElement): EditCurvePoint {
  const plot = getEditCurveCanvasPlotRect(canvas);
  const nx = clampCurvePointValue((x - plot.left) / plot.size);
  const ny = clampCurvePointValue(1 - ((y - plot.top) / plot.size));
  return { x: nx, y: ny };
}

function syncEditColorCurveChannelButtons(data: EditCurveLayerData | null) {
  for (const button of editColorCurveChannelBtnEls) {
    const channel = button.dataset.curveChannel as EditCurveChannel | undefined;
    button.classList.toggle("is-active", !!channel && data?.activeChannel === channel);
  }
}

function renderEditColorCurveEditor() {
  const canvas = editColorCurveCanvasEl;
  if (!canvas) return;
  const selectedLayer = getSelectedEditColorLayer();
  const data = getEditCurveLayerData(selectedLayer);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const plot = getEditCurveCanvasPlotRect(canvas);
  ctx.fillStyle = "rgba(0, 0, 0, 0.02)";
  ctx.fillRect(plot.left, plot.top, plot.size, plot.size);

  ctx.strokeStyle = "rgba(127, 127, 127, 0.22)";
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i += 1) {
    const t = i / 4;
    const x = plot.left + (plot.size * t);
    const y = plot.top + (plot.size * t);
    ctx.beginPath();
    ctx.moveTo(x, plot.top);
    ctx.lineTo(x, plot.top + plot.size);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(plot.left, y);
    ctx.lineTo(plot.left + plot.size, y);
    ctx.stroke();
  }
  ctx.strokeStyle = "rgba(127, 127, 127, 0.35)";
  ctx.beginPath();
  ctx.moveTo(plot.left, plot.top + plot.size);
  ctx.lineTo(plot.left + plot.size, plot.top);
  ctx.stroke();

  if (!data) return;
  const active = data.activeChannel;
  const activePoints = normalizeEditCurvePoints(data.pointsByChannel[active]);
  ctx.strokeStyle = EDIT_CURVE_CHANNEL_COLOR[active];
  ctx.lineWidth = 2;
  const previewLut = buildCurveLutFromPoints(activePoints);
  ctx.beginPath();
  for (let i = 0; i < 256; i += 1) {
    const x = i / 255;
    const y = previewLut[i] / 255;
    const p = curvePointToCanvasPos({ x, y }, canvas);
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();

  for (let i = 0; i < activePoints.length; i += 1) {
    const p = curvePointToCanvasPos(activePoints[i], canvas);
    ctx.beginPath();
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = EDIT_CURVE_CHANNEL_COLOR[active];
    ctx.lineWidth = 1.5;
    ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}

function findCurvePointIndexAtCanvasPos(
  points: EditCurvePoint[],
  canvas: HTMLCanvasElement,
  x: number,
  y: number,
): number | null {
  let bestIndex: number | null = null;
  let bestDistance = EDIT_CURVE_HIT_RADIUS;
  for (let i = 0; i < points.length; i += 1) {
    const cp = curvePointToCanvasPos(points[i], canvas);
    const dx = cp.x - x;
    const dy = cp.y - y;
    const distance = Math.hypot(dx, dy);
    if (distance <= bestDistance) {
      bestDistance = distance;
      bestIndex = i;
    }
  }
  return bestIndex;
}

function applyCurvePointChange(pushHistory: boolean) {
  rebuildEditColorAdjustStateFromLayers();
  clearEditColorAdjustCache();
  if (pushHistory) {
    syncEditColorLayerControls();
  } else {
    renderEditColorCurveEditor();
  }
  if (editModalOpen && editCanvasEl) {
    if (pushHistory) {
      if (editColorAdjustPreviewRaf) {
        window.cancelAnimationFrame(editColorAdjustPreviewRaf);
        editColorAdjustPreviewRaf = 0;
      }
      renderEditCanvasFromState({
        includeSelection: false,
        includeCropOverlay: false,
      });
    } else {
      scheduleEditColorAdjustPreviewRender();
    }
  }
  if (pushHistory) {
    pushEditHistorySnapshot();
  }
}

function updateCurvePointFromCanvasPos(layer: EditColorLayer, channel: EditCurveChannel, index: number, x: number, y: number) {
  const curveData = getEditCurveLayerData(layer);
  if (!curveData || !editColorCurveCanvasEl) return;
  const points = normalizeEditCurvePoints(curveData.pointsByChannel[channel]);
  if (!points[index]) return;
  const next = canvasPosToCurvePoint(x, y, editColorCurveCanvasEl);
  if (index === 0) {
    points[index] = { x: 0, y: 0 };
  } else if (index === points.length - 1) {
    points[index] = { x: 1, y: 1 };
  } else {
    const prevX = points[index - 1].x + EDIT_CURVE_DRAG_EPSILON;
    const nextX = points[index + 1].x - EDIT_CURVE_DRAG_EPSILON;
    points[index] = {
      x: clamp(next.x, prevX, nextX),
      y: next.y,
    };
  }
  curveData.pointsByChannel[channel] = normalizeEditCurvePoints(points);
}

function getEditColorCurveCanvasPoint(e: PointerEvent): { x: number; y: number } | null {
  const canvas = editColorCurveCanvasEl;
  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  const x = ((e.clientX - rect.left) / rect.width) * canvas.width;
  const y = ((e.clientY - rect.top) / rect.height) * canvas.height;
  return { x, y };
}

function finishEditColorCurvePointer(pushHistory: boolean) {
  if (editColorCurveDraggingPointerId == null) return;
  if (editColorCurveCanvasEl?.hasPointerCapture(editColorCurveDraggingPointerId)) {
    editColorCurveCanvasEl.releasePointerCapture(editColorCurveDraggingPointerId);
  }
  const shouldPush = pushHistory && editColorCurveDragChanged;
  editColorCurveDraggingPointerId = null;
  editColorCurveDraggingLayerId = null;
  editColorCurveDraggingChannel = null;
  editColorCurveDraggingPointIndex = null;
  editColorCurveDragChanged = false;
  if (shouldPush) {
    applyCurvePointChange(true);
  }
}

function handleEditColorCurvePointerDown(e: PointerEvent) {
  if (!editModalOpen || e.pointerType === "mouse" && e.button > 2) return;
  const selectedLayer = getSelectedEditColorLayer();
  if (!selectedLayer || selectedLayer.kind !== "curve") return;
  const curveData = getEditCurveLayerData(selectedLayer);
  const canvas = editColorCurveCanvasEl;
  if (!curveData || !canvas) return;
  const point = getEditColorCurveCanvasPoint(e);
  if (!point) return;
  const channel = curveData.activeChannel;
  const points = normalizeEditCurvePoints(curveData.pointsByChannel[channel]);
  const hitIndex = findCurvePointIndexAtCanvasPos(points, canvas, point.x, point.y);

  if (e.button === 2) {
    if (hitIndex != null && hitIndex > 0 && hitIndex < points.length - 1) {
      points.splice(hitIndex, 1);
      curveData.pointsByChannel[channel] = normalizeEditCurvePoints(points);
      applyCurvePointChange(true);
    }
    e.preventDefault();
    return;
  }
  if (e.button !== 0) return;

  let dragIndex = hitIndex;
  let changedOnDown = false;
  if (dragIndex == null) {
    const inserted = canvasPosToCurvePoint(point.x, point.y, canvas);
    if (inserted.x > EDIT_CURVE_DRAG_EPSILON && inserted.x < 1 - EDIT_CURVE_DRAG_EPSILON) {
      points.push(inserted);
      const sorted = normalizeEditCurvePoints(points);
      curveData.pointsByChannel[channel] = sorted;
      dragIndex = sorted.findIndex((p) => Math.abs(p.x - inserted.x) < 0.0001 && Math.abs(p.y - inserted.y) < 0.0001);
      applyCurvePointChange(false);
      changedOnDown = true;
    }
  }
  if (dragIndex == null) return;
  editColorCurveDraggingPointerId = e.pointerId;
  editColorCurveDraggingLayerId = selectedLayer.id;
  editColorCurveDraggingChannel = channel;
  editColorCurveDraggingPointIndex = dragIndex;
  editColorCurveDragChanged = changedOnDown;
  canvas.setPointerCapture(e.pointerId);
  e.preventDefault();
}

function handleEditColorCurvePointerMove(e: PointerEvent) {
  if (editColorCurveDraggingPointerId == null || e.pointerId !== editColorCurveDraggingPointerId) return;
  const selectedLayer = getSelectedEditColorLayer();
  if (!selectedLayer || selectedLayer.id !== editColorCurveDraggingLayerId || selectedLayer.kind !== "curve") return;
  const channel = editColorCurveDraggingChannel;
  const index = editColorCurveDraggingPointIndex;
  if (!channel || index == null) return;
  const point = getEditColorCurveCanvasPoint(e);
  if (!point) return;
  updateCurvePointFromCanvasPos(selectedLayer, channel, index, point.x, point.y);
  editColorCurveDragChanged = true;
  applyCurvePointChange(false);
  e.preventDefault();
}

function handleEditColorCurvePointerUp(e: PointerEvent) {
  if (editColorCurveDraggingPointerId == null || e.pointerId !== editColorCurveDraggingPointerId) return;
  finishEditColorCurvePointer(true);
  e.preventDefault();
}

function handleEditColorCurvePointerCancel(e: PointerEvent) {
  if (editColorCurveDraggingPointerId == null || e.pointerId !== editColorCurveDraggingPointerId) return;
  finishEditColorCurvePointer(false);
}

function syncEditColorLayerControls() {
  const selectedLayer = getSelectedEditColorLayer();
  const hasLayer = editColorLayers.length > 0;
  if (editColorLayerListEl) {
    editColorLayerListEl.textContent = "";
    for (let i = editColorLayers.length - 1; i >= 0; i -= 1) {
      const layer = editColorLayers[i];
      const chipEl = document.createElement("div");
      chipEl.className = "edit-color-layer-chip";
      if (layer.id === selectedLayer?.id) {
        chipEl.classList.add("is-active");
      }
      chipEl.setAttribute("role", "listitem");

      const selectButtonEl = document.createElement("button");
      selectButtonEl.className = "edit-color-layer-chip-select";
      selectButtonEl.type = "button";
      selectButtonEl.dataset.colorLayerSelectId = `${layer.id}`;
      selectButtonEl.textContent = buildEditColorLayerChipLabel(layer);

      const removeButtonEl = document.createElement("button");
      removeButtonEl.className = "edit-color-layer-chip-remove";
      removeButtonEl.type = "button";
      removeButtonEl.dataset.colorLayerRemoveId = `${layer.id}`;
      removeButtonEl.textContent = "×";
      removeButtonEl.setAttribute("aria-label", `${getEditColorLayerKindLabel(layer.kind)} 레이어 삭제`);

      chipEl.append(selectButtonEl, removeButtonEl);
      editColorLayerListEl.append(chipEl);
    }
  }
  if (editColorLayerTitleEl) {
    editColorLayerTitleEl.hidden = !hasLayer;
  }
  if (editColorLayerControlWrapEl) {
    editColorLayerControlWrapEl.hidden = !selectedLayer;
    if (selectedLayer) {
      editColorLayerControlWrapEl.dataset.colorLayerKind = selectedLayer.kind;
    } else {
      delete editColorLayerControlWrapEl.dataset.colorLayerKind;
    }
  }
  if (editColorLayerControlTitleEl) {
    editColorLayerControlTitleEl.hidden = !selectedLayer;
  }
  if (selectedLayer) {
    if (editColorSelectedLayerNameEl) {
      editColorSelectedLayerNameEl.textContent = getEditColorLayerKindLabel(selectedLayer.kind);
    }
    const isCurveLayer = selectedLayer.kind === "curve";
    const isLutLayer = selectedLayer.kind === "lut";
    if (editColorLayerSliderWrapEl) {
      editColorLayerSliderWrapEl.hidden = isCurveLayer;
    }
    if (editColorCurveEditorWrapEl) {
      editColorCurveEditorWrapEl.hidden = !isCurveLayer;
    }
    if (editColorLutEditorWrapEl) {
      editColorLutEditorWrapEl.hidden = !isLutLayer;
    }
    if (isLutLayer) {
      if (editColorLayerValueInputEl) {
        const strength = clampEditLutStrengthPercent(selectedLayer.lutStrength);
        editColorLayerValueInputEl.disabled = false;
        editColorLayerValueInputEl.min = `${EDIT_LUT_STRENGTH_MIN}`;
        editColorLayerValueInputEl.max = `${EDIT_LUT_STRENGTH_MAX}`;
        editColorLayerValueInputEl.step = "1";
        editColorLayerValueInputEl.value = `${strength}`;
        updateRangeSliderVisual(editColorLayerValueInputEl);
      }
      if (editColorLayerValueTextEl) {
        editColorLayerValueTextEl.textContent = `${clampEditLutStrengthPercent(selectedLayer.lutStrength)}%`;
      }
      if (editColorLutLoadBtn) {
        editColorLutLoadBtn.disabled = false;
        editColorLutLoadBtn.textContent = "LUT 불러오기";
      }
      if (editColorLutNameEl) {
        editColorLutNameEl.textContent = selectedLayer.lutData
          ? selectedLayer.lutData.sourceName
          : "불러온 LUT가 없습니다.";
      }
    } else if (!isCurveLayer) {
      if (editColorLayerValueInputEl) {
        editColorLayerValueInputEl.disabled = false;
        editColorLayerValueInputEl.min = `${EDIT_COLOR_ADJUST_MIN}`;
        editColorLayerValueInputEl.max = `${EDIT_COLOR_ADJUST_MAX}`;
        editColorLayerValueInputEl.step = "1";
        editColorLayerValueInputEl.value = `${selectedLayer.value}`;
        updateRangeSliderVisual(editColorLayerValueInputEl);
      }
      if (editColorLayerValueTextEl) {
        editColorLayerValueTextEl.textContent = formatSignedPercent(selectedLayer.value);
      }
    } else {
      if (editColorLayerValueInputEl) {
        editColorLayerValueInputEl.disabled = true;
      }
      const curveData = getEditCurveLayerData(selectedLayer);
      syncEditColorCurveChannelButtons(curveData);
      renderEditColorCurveEditor();
    }
    if (editColorLayerResetBtn) {
      editColorLayerResetBtn.disabled = false;
    }
  } else {
    if (editColorSelectedLayerNameEl) {
      editColorSelectedLayerNameEl.textContent = "레이어를 선택하세요.";
    }
    if (editColorLayerSliderWrapEl) {
      editColorLayerSliderWrapEl.hidden = false;
    }
    if (editColorCurveEditorWrapEl) {
      editColorCurveEditorWrapEl.hidden = true;
    }
    if (editColorLutEditorWrapEl) {
      editColorLutEditorWrapEl.hidden = true;
    }
    if (editColorLayerValueInputEl) {
      editColorLayerValueInputEl.disabled = true;
      editColorLayerValueInputEl.min = `${EDIT_COLOR_ADJUST_MIN}`;
      editColorLayerValueInputEl.max = `${EDIT_COLOR_ADJUST_MAX}`;
      editColorLayerValueInputEl.step = "1";
      editColorLayerValueInputEl.value = "0";
      updateRangeSliderVisual(editColorLayerValueInputEl);
    }
    if (editColorLutLoadBtn) {
      editColorLutLoadBtn.disabled = true;
      editColorLutLoadBtn.textContent = "LUT 불러오기";
    }
    if (editColorLutNameEl) {
      editColorLutNameEl.textContent = "불러온 LUT가 없습니다.";
    }
    if (editColorLayerValueTextEl) {
      editColorLayerValueTextEl.textContent = "0";
    }
    if (editColorLayerResetBtn) {
      editColorLayerResetBtn.disabled = true;
    }
  }
  syncEditColorLayerToolButtons();
}

function syncSelectedEditColorLayerPreviewText() {
  const selectedLayer = getSelectedEditColorLayer();
  if (!selectedLayer) return;
  if (editColorLayerValueTextEl && selectedLayer.kind !== "curve") {
    if (selectedLayer.kind === "lut") {
      editColorLayerValueTextEl.textContent = `${clampEditLutStrengthPercent(selectedLayer.lutStrength)}%`;
    } else {
      editColorLayerValueTextEl.textContent = formatSignedPercent(selectedLayer.value);
    }
  }
  if (selectedLayer.kind === "lut" && editColorLutNameEl) {
    editColorLutNameEl.textContent = selectedLayer.lutData
      ? selectedLayer.lutData.sourceName
      : "불러온 LUT가 없습니다.";
  }
  const selectButtonEl = editColorLayerListEl
    ?.querySelector<HTMLButtonElement>(`[data-color-layer-select-id="${selectedLayer.id}"]`) ?? null;
  if (selectButtonEl) {
    selectButtonEl.textContent = buildEditColorLayerChipLabel(selectedLayer);
  }
}

function syncEditColorAdjustControls() {
  let valueCorrected = false;
  for (let i = 0; i < editColorLayers.length; i += 1) {
    const layer = editColorLayers[i];
    if (layer.kind === "curve") {
      const normalizedCurveData = cloneEditCurveLayerData(getEditCurveLayerData(layer));
      if (normalizedCurveData && layer.curveData !== normalizedCurveData) {
        editColorLayers[i] = { ...layer, curveData: normalizedCurveData };
      }
      continue;
    }
    if (layer.kind === "lut") {
      const nextStrength = clampEditLutStrengthPercent(layer.lutStrength);
      if (nextStrength !== layer.lutStrength) {
        editColorLayers[i] = { ...layer, lutStrength: nextStrength };
        valueCorrected = true;
      }
      continue;
    }
    const nextValue = clampEditColorAdjustValue(layer.value);
    if (nextValue !== layer.value) {
      editColorLayers[i] = { ...layer, value: nextValue };
      valueCorrected = true;
    }
  }
  if (editSelectedColorLayerId != null && !editColorLayers.some((layer) => layer.id === editSelectedColorLayerId)) {
    editSelectedColorLayerId = editColorLayers.length > 0 ? editColorLayers[editColorLayers.length - 1].id : null;
  }
  rebuildEditColorAdjustStateFromLayers();
  if (valueCorrected) {
    clearEditColorAdjustCache();
  }
  syncEditColorLayerControls();
}

function addEditColorLayer(kind: EditColorLayerKind, options?: { pushHistory?: boolean }): EditColorLayer {
  const layer: EditColorLayer = {
    id: editNextColorLayerId,
    kind,
    value: 0,
    lutStrength: EDIT_LUT_STRENGTH_DEFAULT,
    curveData: kind === "curve" ? createDefaultEditCurveLayerData() : null,
    lutData: null,
  };
  editNextColorLayerId += 1;
  editColorLayers = [...editColorLayers, layer];
  editSelectedColorLayerId = layer.id;
  syncEditColorAdjustControls();
  if (options?.pushHistory !== false) {
    pushEditHistorySnapshot();
  }
  return layer;
}

function removeEditColorLayerById(id: number, pushHistory = true): boolean {
  if (!editColorLayers.some((layer) => layer.id === id)) return false;
  const prevPipelineKey = getEditColorPipelineStateKey();
  editColorLayers = editColorLayers.filter((layer) => layer.id !== id);
  if (editSelectedColorLayerId === id) {
    editSelectedColorLayerId = editColorLayers.length > 0 ? editColorLayers[editColorLayers.length - 1].id : null;
  }
  syncEditColorAdjustControls();
  const changed = prevPipelineKey !== getEditColorPipelineStateKey();
  if (changed && editModalOpen && editCanvasEl) {
    clearEditColorAdjustCache();
    if (editColorAdjustPreviewRaf) {
      window.cancelAnimationFrame(editColorAdjustPreviewRaf);
      editColorAdjustPreviewRaf = 0;
    }
    renderEditCanvasFromState({
      includeSelection: false,
      includeCropOverlay: false,
    });
  }
  if (pushHistory) {
    pushEditHistorySnapshot();
  }
  return true;
}

function selectEditColorLayerById(id: number): boolean {
  if (!editColorLayers.some((layer) => layer.id === id)) return false;
  if (editSelectedColorLayerId === id) return false;
  editSelectedColorLayerId = id;
  syncEditColorAdjustControls();
  return true;
}

function resetEditColorAdjustState(pushHistory = false, shouldRender = true) {
  editColorLayers = [];
  editSelectedColorLayerId = null;
  editNextColorLayerId = 1;
  editNextLutToken = 1;
  editColorAdjustState = createDefaultEditColorAdjustState();
  clearEditColorAdjustCache();
  if (editColorAdjustPreviewRaf) {
    window.cancelAnimationFrame(editColorAdjustPreviewRaf);
    editColorAdjustPreviewRaf = 0;
  }
  syncEditColorAdjustControls();
  if (shouldRender && editModalOpen && editCanvasEl) {
    renderEditCanvasFromState();
  }
  if (pushHistory) {
    pushEditHistorySnapshot();
  }
}

function scheduleEditColorAdjustPreviewRender() {
  if (!editModalOpen || !editCanvasEl) return;
  if (editColorAdjustPreviewRaf) return;
  editColorAdjustPreviewRaf = window.requestAnimationFrame(() => {
    editColorAdjustPreviewRaf = 0;
    // Heavy UI sync (layer list/control refresh) is skipped while slider is moving.
    renderEditCanvasFromState({
      includeSelection: false,
      includeCropOverlay: false,
      skipUiSync: true,
      draftColorAdjust: true,
    });
  });
}

function applySelectedEditColorLayerFromControl(pushHistory = false) {
  const selectedLayer = getSelectedEditColorLayer();
  if (!selectedLayer) return;
  if (selectedLayer.kind === "curve") return;
  if (selectedLayer.kind === "lut") {
    const inputStrength = clampEditLutStrengthPercent(Number(editColorLayerValueInputEl?.value ?? selectedLayer.lutStrength));
    if (editColorLayerValueInputEl) {
      editColorLayerValueInputEl.value = `${inputStrength}`;
      updateRangeSliderVisual(editColorLayerValueInputEl);
    }
    if (selectedLayer.lutStrength === inputStrength) {
      syncSelectedEditColorLayerPreviewText();
      return;
    }
    selectedLayer.lutStrength = inputStrength;
    clearEditColorAdjustCache();
    syncSelectedEditColorLayerPreviewText();
    if (editModalOpen && editCanvasEl) {
      if (pushHistory) {
        if (editColorAdjustPreviewRaf) {
          window.cancelAnimationFrame(editColorAdjustPreviewRaf);
          editColorAdjustPreviewRaf = 0;
        }
        renderEditCanvasFromState({
          includeSelection: false,
          includeCropOverlay: false,
        });
      } else {
        scheduleEditColorAdjustPreviewRender();
      }
    }
    if (pushHistory) {
      pushEditHistorySnapshot();
    }
    return;
  }
  const inputValue = clampEditColorAdjustValue(Number(editColorLayerValueInputEl?.value ?? selectedLayer.value));
  if (editColorLayerValueInputEl) {
    editColorLayerValueInputEl.value = `${inputValue}`;
    updateRangeSliderVisual(editColorLayerValueInputEl);
  }
  if (selectedLayer.value === inputValue) {
    syncSelectedEditColorLayerPreviewText();
    return;
  }
  selectedLayer.value = inputValue;
  rebuildEditColorAdjustStateFromLayers();
  clearEditColorAdjustCache();
  syncSelectedEditColorLayerPreviewText();
  if (editModalOpen && editCanvasEl) {
    if (pushHistory) {
      if (editColorAdjustPreviewRaf) {
        window.cancelAnimationFrame(editColorAdjustPreviewRaf);
        editColorAdjustPreviewRaf = 0;
      }
      renderEditCanvasFromState({
        includeSelection: false,
        includeCropOverlay: false,
      });
    } else {
      scheduleEditColorAdjustPreviewRender();
    }
  }
  if (pushHistory) {
    pushEditHistorySnapshot();
  }
}

function resetSelectedEditColorLayer(pushHistory = true) {
  const selectedLayer = getSelectedEditColorLayer();
  if (!selectedLayer) return;
  let changed = false;
  if (selectedLayer.kind === "curve") {
    if (!isEditCurveIdentity(selectedLayer.curveData)) {
      selectedLayer.curveData = createDefaultEditCurveLayerData();
      changed = true;
    }
  } else if (selectedLayer.kind === "lut") {
    if (selectedLayer.lutStrength !== EDIT_LUT_STRENGTH_DEFAULT) {
      selectedLayer.lutStrength = EDIT_LUT_STRENGTH_DEFAULT;
      changed = true;
    }
    if (selectedLayer.lutData) {
      selectedLayer.lutData = null;
      changed = true;
    }
  } else if (selectedLayer.value !== 0) {
    selectedLayer.value = 0;
    changed = true;
  }
  if (!changed) return;
  rebuildEditColorAdjustStateFromLayers();
  clearEditColorAdjustCache();
  syncEditColorLayerControls();
  if (editModalOpen && editCanvasEl) {
    if (pushHistory) {
      if (editColorAdjustPreviewRaf) {
        window.cancelAnimationFrame(editColorAdjustPreviewRaf);
        editColorAdjustPreviewRaf = 0;
      }
      renderEditCanvasFromState({
        includeSelection: false,
        includeCropOverlay: false,
      });
    } else {
      scheduleEditColorAdjustPreviewRender();
    }
  }
  if (pushHistory) {
    pushEditHistorySnapshot();
  }
}

function buildColorAdjustedImageData(
  source: ImageData,
  state: EditColorAdjustState,
  curveLutSet: EditCurveLutSet | null,
  lut3dLayers: EditActiveLutLayer[],
): ImageData {
  const src = source.data;
  const out = new Uint8ClampedArray(src.length);
  const exposureGain = Math.pow(2, state.exposure / 50);
  const contrastFactor = 1 + (state.contrast / 100);
  const saturationFactor = 1 + (state.saturation / 100);
  const temperatureAmount = state.temperature / 100;
  const highlightsAmount = state.highlights / 100;
  const shadowsAmount = state.shadows / 100;
  const useToneRegionAdjust = highlightsAmount !== 0 || shadowsAmount !== 0;
  const useSaturationAdjust = saturationFactor !== 1;
  const useTemperatureAdjust = temperatureAmount !== 0;
  const useCurveAdjust = !!curveLutSet;
  const useLut3DAdjust = lut3dLayers.length > 0;
  const preparedLut3DLayers = useLut3DAdjust
    ? lut3dLayers.map((layer) => buildPreparedLut3DLayer(layer))
    : [];

  // Fast path for linear-only adjustments.
  if (!useToneRegionAdjust && !useSaturationAdjust && !useTemperatureAdjust && !useCurveAdjust && !useLut3DAdjust) {
    const scale = contrastFactor * exposureGain;
    const offset = 128 * (1 - contrastFactor);
    const lut = new Uint8Array(256);
    for (let i = 0; i < 256; i += 1) {
      const v = (i * scale) + offset;
      lut[i] = v <= 0 ? 0 : (v >= 255 ? 255 : Math.round(v));
    }
    for (let i = 0; i < src.length; i += 4) {
      out[i] = lut[src[i]];
      out[i + 1] = lut[src[i + 1]];
      out[i + 2] = lut[src[i + 2]];
      out[i + 3] = src[i + 3];
    }
    return new ImageData(out, source.width, source.height);
  }

  for (let i = 0; i < src.length; i += 4) {
    let r = src[i] * exposureGain;
    let g = src[i + 1] * exposureGain;
    let b = src[i + 2] * exposureGain;

    if (contrastFactor !== 1) {
      r = ((r - 128) * contrastFactor) + 128;
      g = ((g - 128) * contrastFactor) + 128;
      b = ((b - 128) * contrastFactor) + 128;
    }

    if (useTemperatureAdjust) {
      if (temperatureAmount > 0) {
        r += (255 - r) * temperatureAmount * 0.42;
        g += (255 - g) * temperatureAmount * 0.08;
        b -= b * temperatureAmount * 0.48;
      } else {
        const coolAmount = -temperatureAmount;
        r -= r * coolAmount * 0.38;
        g -= g * coolAmount * 0.06;
        b += (255 - b) * coolAmount * 0.5;
      }
    }

    if (saturationFactor !== 1) {
      const gray = (0.2126 * r) + (0.7152 * g) + (0.0722 * b);
      r = gray + ((r - gray) * saturationFactor);
      g = gray + ((g - gray) * saturationFactor);
      b = gray + ((b - gray) * saturationFactor);
    }

    if (useToneRegionAdjust) {
      const luma = (0.2126 * r) + (0.7152 * g) + (0.0722 * b);
      const tone = luma <= 0 ? 0 : (luma >= 255 ? 1 : luma / 255);
      if (shadowsAmount !== 0) {
        const shadowWeight = (1 - tone) * (1 - tone);
        if (shadowsAmount > 0) {
          r += (255 - r) * shadowsAmount * shadowWeight;
          g += (255 - g) * shadowsAmount * shadowWeight;
          b += (255 - b) * shadowsAmount * shadowWeight;
        } else {
          r += r * shadowsAmount * shadowWeight;
          g += g * shadowsAmount * shadowWeight;
          b += b * shadowsAmount * shadowWeight;
        }
      }
      if (highlightsAmount !== 0) {
        const highlightWeight = tone * tone;
        if (highlightsAmount > 0) {
          r += (255 - r) * highlightsAmount * highlightWeight;
          g += (255 - g) * highlightsAmount * highlightWeight;
          b += (255 - b) * highlightsAmount * highlightWeight;
        } else {
          r += r * highlightsAmount * highlightWeight;
          g += g * highlightsAmount * highlightWeight;
          b += b * highlightsAmount * highlightWeight;
        }
      }
    }

    let rOut = r <= 0 ? 0 : (r >= 255 ? 255 : Math.round(r));
    let gOut = g <= 0 ? 0 : (g >= 255 ? 255 : Math.round(g));
    let bOut = b <= 0 ? 0 : (b >= 255 ? 255 : Math.round(b));
    if (curveLutSet) {
      rOut = curveLutSet.r[curveLutSet.rgb[rOut]];
      gOut = curveLutSet.g[curveLutSet.rgb[gOut]];
      bOut = curveLutSet.b[curveLutSet.rgb[bOut]];
    }
    if (useLut3DAdjust) {
      for (const prepared of preparedLut3DLayers) {
        const strength = prepared.strength;
        if (strength <= 0) continue;
        const rBefore = rOut;
        const gBefore = gOut;
        const bBefore = bOut;
        const size = prepared.lut.size;
        const table = prepared.lut.table;
        const rLow = prepared.rAxis.low[rOut];
        const rHigh = prepared.rAxis.high[rOut];
        const rT = prepared.rAxis.t[rOut];
        const gLow = prepared.gAxis.low[gOut];
        const gHigh = prepared.gAxis.high[gOut];
        const gT = prepared.gAxis.t[gOut];
        const bLow = prepared.bAxis.low[bOut];
        const bHigh = prepared.bAxis.high[bOut];
        const bT = prepared.bAxis.t[bOut];

        const i000 = (((bLow * size) + gLow) * size + rLow) * 3;
        const i100 = (((bLow * size) + gLow) * size + rHigh) * 3;
        const i010 = (((bLow * size) + gHigh) * size + rLow) * 3;
        const i110 = (((bLow * size) + gHigh) * size + rHigh) * 3;
        const i001 = (((bHigh * size) + gLow) * size + rLow) * 3;
        const i101 = (((bHigh * size) + gLow) * size + rHigh) * 3;
        const i011 = (((bHigh * size) + gHigh) * size + rLow) * 3;
        const i111 = (((bHigh * size) + gHigh) * size + rHigh) * 3;

        const r00 = table[i000] + ((table[i100] - table[i000]) * rT);
        const r10 = table[i010] + ((table[i110] - table[i010]) * rT);
        const r01 = table[i001] + ((table[i101] - table[i001]) * rT);
        const r11 = table[i011] + ((table[i111] - table[i011]) * rT);
        const r0 = r00 + ((r10 - r00) * gT);
        const r1 = r01 + ((r11 - r01) * gT);
        const rMixed = r0 + ((r1 - r0) * bT);

        const g00 = table[i000 + 1] + ((table[i100 + 1] - table[i000 + 1]) * rT);
        const g10 = table[i010 + 1] + ((table[i110 + 1] - table[i010 + 1]) * rT);
        const g01 = table[i001 + 1] + ((table[i101 + 1] - table[i001 + 1]) * rT);
        const g11 = table[i011 + 1] + ((table[i111 + 1] - table[i011 + 1]) * rT);
        const g0 = g00 + ((g10 - g00) * gT);
        const g1 = g01 + ((g11 - g01) * gT);
        const gMixed = g0 + ((g1 - g0) * bT);

        const b00 = table[i000 + 2] + ((table[i100 + 2] - table[i000 + 2]) * rT);
        const b10 = table[i010 + 2] + ((table[i110 + 2] - table[i010 + 2]) * rT);
        const b01 = table[i001 + 2] + ((table[i101 + 2] - table[i001 + 2]) * rT);
        const b11 = table[i011 + 2] + ((table[i111 + 2] - table[i011 + 2]) * rT);
        const b0 = b00 + ((b10 - b00) * gT);
        const b1 = b01 + ((b11 - b01) * gT);
        const bMixed = b0 + ((b1 - b0) * bT);

        const rNext = Number.isFinite(rMixed) ? (rMixed <= 0 ? 0 : (rMixed >= 1 ? 255 : Math.round(rMixed * 255))) : 0;
        const gNext = Number.isFinite(gMixed) ? (gMixed <= 0 ? 0 : (gMixed >= 1 ? 255 : Math.round(gMixed * 255))) : 0;
        const bNext = Number.isFinite(bMixed) ? (bMixed <= 0 ? 0 : (bMixed >= 1 ? 255 : Math.round(bMixed * 255))) : 0;
        if (strength === 1) {
          rOut = rNext;
          gOut = gNext;
          bOut = bNext;
        } else {
          rOut = clamp(Math.round(rBefore + ((rNext - rBefore) * strength)), 0, 255);
          gOut = clamp(Math.round(gBefore + ((gNext - gBefore) * strength)), 0, 255);
          bOut = clamp(Math.round(bBefore + ((bNext - bBefore) * strength)), 0, 255);
        }
      }
    }
    out[i] = rOut;
    out[i + 1] = gOut;
    out[i + 2] = bOut;
    out[i + 3] = src[i + 3];
  }

  return new ImageData(out, source.width, source.height);
}

type EditBaseRenderSource =
  | { kind: "image-data"; imageData: ImageData }
  | { kind: "canvas"; canvas: HTMLCanvasElement };

function getEditColorAdjustDraftScale(width: number, height: number): number {
  if (width <= 0 || height <= 0) return 1;
  const totalPixels = width * height;
  if (totalPixels <= EDIT_COLOR_ADJUST_DRAFT_MAX_PIXELS) return 1;
  return Math.sqrt(EDIT_COLOR_ADJUST_DRAFT_MAX_PIXELS / totalPixels);
}

function getEditColorAdjustBaseCanvas(): HTMLCanvasElement | null {
  if (!editBaseImageData) return null;
  if (
    editColorAdjustBaseCanvas
    && editColorAdjustBaseCanvasSourceRef === editBaseImageData
    && editColorAdjustBaseCanvas.width === editBaseImageData.width
    && editColorAdjustBaseCanvas.height === editBaseImageData.height
  ) {
    return editColorAdjustBaseCanvas;
  }
  const canvas = document.createElement("canvas");
  canvas.width = editBaseImageData.width;
  canvas.height = editBaseImageData.height;
  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) return null;
  ctx.putImageData(editBaseImageData, 0, 0);
  editColorAdjustBaseCanvasSourceRef = editBaseImageData;
  editColorAdjustBaseCanvas = canvas;
  return canvas;
}

function getEditBaseImageDataForRender(): ImageData | null {
  if (!editBaseImageData) return null;
  const hasLayerAdjustment = hasActiveEditCurveAdjustments() || hasActiveEditLutAdjustments();
  if (isEditColorAdjustIdentity(editColorAdjustState) && !hasLayerAdjustment) {
    return editBaseImageData;
  }
  const key = getEditColorPipelineStateKey();
  if (
    editColorAdjustedCache
    && editColorAdjustedSourceRef === editBaseImageData
    && editColorAdjustedStateKey === key
  ) {
    return editColorAdjustedCache;
  }
  const curveLutSet = buildCombinedCurveLutSetFromLayers();
  const lut3dLayers = buildActiveLut3DLayerListFromLayers();
  const next = buildColorAdjustedImageData(editBaseImageData, editColorAdjustState, curveLutSet, lut3dLayers);
  editColorAdjustedSourceRef = editBaseImageData;
  editColorAdjustedStateKey = key;
  editColorAdjustedCache = next;
  return next;
}

function getEditBaseRenderSource(options?: { allowDraftColorAdjust?: boolean }): EditBaseRenderSource | null {
  if (!editBaseImageData) return null;
  const hasLayerAdjustment = hasActiveEditCurveAdjustments() || hasActiveEditLutAdjustments();
  if (!options?.allowDraftColorAdjust || (isEditColorAdjustIdentity(editColorAdjustState) && !hasLayerAdjustment)) {
    const imageData = getEditBaseImageDataForRender();
    return imageData ? { kind: "image-data", imageData } : null;
  }
  const draftScale = getEditColorAdjustDraftScale(editBaseImageData.width, editBaseImageData.height);
  if (draftScale >= 0.999) {
    const imageData = getEditBaseImageDataForRender();
    return imageData ? { kind: "image-data", imageData } : null;
  }
  const draftWidth = Math.max(1, Math.round(editBaseImageData.width * draftScale));
  const draftHeight = Math.max(1, Math.round(editBaseImageData.height * draftScale));
  const draftSizeKey = `${draftWidth}x${draftHeight}`;
  const draftStateKey = getEditColorPipelineStateKey();
  if (
    editColorAdjustedDraftCanvas
    && editColorAdjustedDraftSourceRef === editBaseImageData
    && editColorAdjustedDraftStateKey === draftStateKey
    && editColorAdjustedDraftSizeKey === draftSizeKey
  ) {
    return { kind: "canvas", canvas: editColorAdjustedDraftCanvas };
  }
  const baseCanvas = getEditColorAdjustBaseCanvas();
  if (!baseCanvas) {
    const imageData = getEditBaseImageDataForRender();
    return imageData ? { kind: "image-data", imageData } : null;
  }
  if (!editColorAdjustedDraftCanvas) {
    editColorAdjustedDraftCanvas = document.createElement("canvas");
  }
  const draftCanvas = editColorAdjustedDraftCanvas;
  if (draftCanvas.width !== draftWidth || draftCanvas.height !== draftHeight) {
    draftCanvas.width = draftWidth;
    draftCanvas.height = draftHeight;
  }
  const draftCtx = draftCanvas.getContext("2d", { alpha: true, willReadFrequently: true });
  if (!draftCtx) {
    const imageData = getEditBaseImageDataForRender();
    return imageData ? { kind: "image-data", imageData } : null;
  }
  draftCtx.clearRect(0, 0, draftWidth, draftHeight);
  draftCtx.drawImage(baseCanvas, 0, 0, draftWidth, draftHeight);
  const draftSource = draftCtx.getImageData(0, 0, draftWidth, draftHeight);
  const curveLutSet = buildCombinedCurveLutSetFromLayers();
  const lut3dLayers = buildActiveLut3DLayerListFromLayers();
  const adjustedDraft = buildColorAdjustedImageData(draftSource, editColorAdjustState, curveLutSet, lut3dLayers);
  draftCtx.putImageData(adjustedDraft, 0, 0);
  editColorAdjustedDraftSourceRef = editBaseImageData;
  editColorAdjustedDraftStateKey = draftStateKey;
  editColorAdjustedDraftSizeKey = draftSizeKey;
  return { kind: "canvas", canvas: draftCanvas };
}

function cloneEditTextItems(items: EditTextItem[]): EditTextItem[] {
  return items.map((item) => ({
    ...item,
    lines: [...item.lines],
  }));
}

function getEditTextItemById(id: number | null): EditTextItem | null {
  if (id == null) return null;
  return editTextItems.find((item) => item.id === id) ?? null;
}

function mutateEditRasterLayer(layer: EditRasterLayer, mutate: (ctx: CanvasRenderingContext2D) => void): boolean {
  const bufferCtx = layer.canvas.getContext("2d", { alpha: true });
  if (!bufferCtx) return false;
  mutate(bufferCtx);
  return true;
}

function drawEditTextItem(ctx: CanvasRenderingContext2D, item: EditTextItem) {
  const bounds = getEditTextBounds(item);
  const sizePx = getEditTextSizePx(item);
  const ascent = Number.isFinite(item.ascent) && item.ascent > 0 ? item.ascent : item.lineHeight * 0.8;
  ctx.save();
  ctx.fillStyle = item.color;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = item.align;
  ctx.font = buildEditTextCanvasFont(sizePx, item.fontFamily);
  for (let i = 0; i < item.lines.length; i += 1) {
    ctx.fillText(item.lines[i], item.x, bounds.y + ascent + i * item.lineHeight);
  }
  ctx.restore();
}

function drawEditRasterLayer(ctx: CanvasRenderingContext2D, layer: EditRasterLayer) {
  ctx.drawImage(layer.canvas, Math.round(layer.offsetX), Math.round(layer.offsetY));
}

function getEditCanvasPixelsPerCssPixel(): number {
  if (!editCanvasEl) return 1;
  const rect = editCanvasEl.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return 1;
  const scaleX = editCanvasEl.width / rect.width;
  const scaleY = editCanvasEl.height / rect.height;
  return Math.max(0.01, (scaleX + scaleY) * 0.5);
}

function getSelectedTextInkBounds(ctx: CanvasRenderingContext2D, item: EditTextItem): { x: number; y: number; width: number; height: number } {
  const bounds = getEditTextBounds(item);
  const sizePx = getEditTextSizePx(item);
  const lines = item.lines.length > 0 ? item.lines : [""];
  const ascentRef = Number.isFinite(item.ascent) && item.ascent > 0 ? item.ascent : item.lineHeight * 0.8;
  const descentRef = Math.max(0, item.lineHeight - ascentRef);
  let inkAscent = 0;
  let inkDescent = 0;

  ctx.save();
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = item.align;
  ctx.font = buildEditTextCanvasFont(sizePx, item.fontFamily);
  for (const line of lines) {
    const sample = line.length > 0 ? line : " ";
    const metrics = ctx.measureText(sample);
    const measuredAscent = Number.isFinite(metrics.actualBoundingBoxAscent) && metrics.actualBoundingBoxAscent >= 0
      ? metrics.actualBoundingBoxAscent
      : ascentRef;
    const measuredDescent = Number.isFinite(metrics.actualBoundingBoxDescent) && metrics.actualBoundingBoxDescent >= 0
      ? metrics.actualBoundingBoxDescent
      : descentRef;
    inkAscent = Math.max(inkAscent, measuredAscent);
    inkDescent = Math.max(inkDescent, measuredDescent);
  }
  ctx.restore();

  const firstBaselineY = bounds.y + ascentRef;
  const topY = firstBaselineY - inkAscent;
  const totalHeight = Math.max(1, inkAscent + inkDescent + (lines.length - 1) * item.lineHeight);
  return { x: bounds.x, y: topY, width: bounds.width, height: totalHeight };
}

function drawSelectedTextOverlay(ctx: CanvasRenderingContext2D, item: EditTextItem) {
  const bounds = getSelectedTextInkBounds(ctx, item);
  const canvasPxPerCssPx = getEditCanvasPixelsPerCssPixel();
  const lineWidth = Math.max(0.25, canvasPxPerCssPx * 1.5);
  const dash = canvasPxPerCssPx * 5;
  const outerPad = Math.max(0.75, canvasPxPerCssPx);
  const x = Math.floor(bounds.x) - outerPad - lineWidth * 0.5;
  const y = Math.floor(bounds.y) - outerPad - lineWidth * 0.5;
  const w = Math.max(lineWidth, Math.ceil(bounds.width) + outerPad * 2 + lineWidth);
  const h = Math.max(lineWidth, Math.ceil(bounds.height) + outerPad * 2 + lineWidth);
  ctx.save();
  ctx.lineWidth = lineWidth;
  ctx.setLineDash([dash, dash]);
  ctx.lineDashOffset = 0;
  ctx.strokeStyle = "rgba(0, 0, 0, 0.96)";
  ctx.strokeRect(x, y, w, h);
  ctx.lineDashOffset = dash;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.98)";
  ctx.strokeRect(x, y, w, h);
  ctx.restore();
}

function drawSelectedMosaicOverlay(
  ctx: CanvasRenderingContext2D,
  layer: EditRasterLayer,
  shapeData: EditMosaicShapeData,
) {
  const sx = shapeData.sx + layer.offsetX;
  const sy = shapeData.sy + layer.offsetY;
  const ex = shapeData.ex + layer.offsetX;
  const ey = shapeData.ey + layer.offsetY;
  const left = Math.min(sx, ex);
  const top = Math.min(sy, ey);
  const width = Math.abs(ex - sx);
  const height = Math.abs(ey - sy);
  if (width < 1 || height < 1) return;
  const canvasPxPerCssPx = getEditCanvasPixelsPerCssPixel();
  const lineWidth = Math.max(0.25, canvasPxPerCssPx * 1.5);
  const dash = canvasPxPerCssPx * 5;
  ctx.save();
  ctx.lineWidth = lineWidth;
  ctx.setLineDash([dash, dash]);
  const strokeShape = () => {
    if (shapeData.style === "ellipse") {
      ctx.beginPath();
      ctx.ellipse(left + width * 0.5, top + height * 0.5, width * 0.5, height * 0.5, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.strokeRect(left, top, width, height);
    }
  };
  ctx.lineDashOffset = 0;
  ctx.strokeStyle = "rgba(0, 0, 0, 0.96)";
  strokeShape();
  ctx.lineDashOffset = dash;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.98)";
  strokeShape();
  ctx.restore();
}

function drawSelectedBlurOverlay(
  ctx: CanvasRenderingContext2D,
  layer: EditRasterLayer,
  shapeData: EditBlurShapeData,
) {
  const sx = shapeData.sx + layer.offsetX;
  const sy = shapeData.sy + layer.offsetY;
  const ex = shapeData.ex + layer.offsetX;
  const ey = shapeData.ey + layer.offsetY;
  const left = Math.min(sx, ex);
  const top = Math.min(sy, ey);
  const width = Math.abs(ex - sx);
  const height = Math.abs(ey - sy);
  if (width < 1 || height < 1) return;
  const canvasPxPerCssPx = getEditCanvasPixelsPerCssPixel();
  const lineWidth = Math.max(0.25, canvasPxPerCssPx * 1.5);
  const dash = canvasPxPerCssPx * 5;
  ctx.save();
  ctx.lineWidth = lineWidth;
  ctx.setLineDash([dash, dash]);
  const strokeShape = () => {
    if (shapeData.style === "ellipse") {
      ctx.beginPath();
      ctx.ellipse(left + width * 0.5, top + height * 0.5, width * 0.5, height * 0.5, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.strokeRect(left, top, width, height);
    }
  };
  ctx.lineDashOffset = 0;
  ctx.strokeStyle = "rgba(0, 0, 0, 0.96)";
  strokeShape();
  ctx.lineDashOffset = dash;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.98)";
  strokeShape();
  ctx.restore();
}

function renderEditCanvasFromState(
  options?: { includeSelection?: boolean; includeCropOverlay?: boolean; skipUiSync?: boolean; draftColorAdjust?: boolean },
) {
  if (!editCanvasEl) return;
  const ctx = getEditCanvasContext();
  if (!ctx) return;
  const width = editCanvasEl.width;
  const height = editCanvasEl.height;
  if (width <= 0 || height <= 0) return;
  const baseSource = getEditBaseRenderSource({ allowDraftColorAdjust: options?.draftColorAdjust === true });
  if (baseSource?.kind === "image-data") {
    ctx.putImageData(baseSource.imageData, 0, 0);
  } else if (baseSource?.kind === "canvas") {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "medium";
    ctx.drawImage(baseSource.canvas, 0, 0, width, height);
  } else {
    ctx.clearRect(0, 0, width, height);
  }
  for (const layer of editUiLayers) {
    if (layer.kind === "text" && layer.textId != null) {
      const item = getEditTextItemById(layer.textId);
      if (item) drawEditTextItem(ctx, item);
      continue;
    }
    if (layer.rasterId != null) {
      const raster = getEditRasterLayerById(layer.rasterId);
      if (raster) drawEditRasterLayer(ctx, raster);
    }
  }
  const includeSelection = options?.includeSelection ?? (
    editToolMode === "text"
    || editToolMode === "mosaic"
    || editToolMode === "blur"
  );
  if (includeSelection) {
    if (editToolMode === "text") {
      const selected = getSelectedEditTextItem();
      if (selected) {
        drawSelectedTextOverlay(ctx, selected);
      }
    } else if (editToolMode === "mosaic") {
      const selectedLayer = getSelectedEditUiLayer();
      if (selectedLayer?.kind === "mosaic" && selectedLayer.rasterId != null) {
        const raster = getEditRasterLayerById(selectedLayer.rasterId);
        if (
          raster
          && editMosaicSelectionOverlaySuppressedRasterId !== raster.id
        ) {
          const shapeData = editMosaicShapeByLayerId.get(raster.id);
          if (shapeData) {
            drawSelectedMosaicOverlay(ctx, raster, shapeData);
          }
        }
      }
    } else if (editToolMode === "blur") {
      const selectedLayer = getSelectedEditUiLayer();
      if (selectedLayer?.kind === "blur" && selectedLayer.rasterId != null) {
        const raster = getEditRasterLayerById(selectedLayer.rasterId);
        if (
          raster
          && editBlurSelectionOverlaySuppressedRasterId !== raster.id
        ) {
          const shapeData = editBlurShapeByLayerId.get(raster.id);
          if (shapeData) {
            drawSelectedBlurOverlay(ctx, raster, shapeData);
          }
        }
      }
    }
  }
  const includeCropOverlay = options?.includeCropOverlay ?? (editSidebarTab === "crop");
  if (includeCropOverlay) {
    drawEditCropOverlay(ctx);
  }
  if (!options?.skipUiSync) {
    syncEditLayerList();
    syncEditTextControls();
    syncEditCropButtonStates();
    syncEditCropHandleLayer();
  }
}

function resetEditHistory() {
  editHistory = [];
  editHistoryIndex = -1;
  syncEditUndoButton();
}

function pushEditHistorySnapshot() {
  if (!editBaseImageData) return;
  if (editHistoryIndex < editHistory.length - 1) {
    editHistory = editHistory.slice(0, editHistoryIndex + 1);
  }
  editHistory.push({
    baseImageData: cloneImageData(editBaseImageData),
    colorAdjust: cloneEditColorAdjustState(editColorAdjustState),
    colorLayers: cloneEditColorLayers(editColorLayers),
    selectedColorLayerId: editSelectedColorLayerId,
    nextColorLayerId: editNextColorLayerId,
    textItems: cloneEditTextItems(editTextItems),
    rasterLayers: cloneEditRasterLayers(editRasterLayers),
    mosaicShapeByLayerId: Array.from(editMosaicShapeByLayerId.entries()).map(([id, data]) => [id, { ...data }]),
    blurShapeByLayerId: Array.from(editBlurShapeByLayerId.entries()).map(([id, data]) => [id, { ...data }]),
    uiLayers: cloneEditUiLayers(editUiLayers),
    selectedUiLayerId: editSelectedUiLayerId,
    selectedTextId: editSelectedTextId,
  });
  if (editHistory.length > EDIT_HISTORY_LIMIT) {
    const overflow = editHistory.length - EDIT_HISTORY_LIMIT;
    editHistory.splice(0, overflow);
    editHistoryIndex = Math.max(0, editHistoryIndex - overflow);
  }
  editHistoryIndex = editHistory.length - 1;
  syncEditUndoButton();
}

function undoEditCanvas() {
  if (editHistoryIndex <= 0) {
    syncEditUndoButton();
    return;
  }
  editHistoryIndex -= 1;
  const state = editHistory[editHistoryIndex];
  if (!state) return;
  editBaseImageData = cloneImageData(state.baseImageData);
  editColorAdjustState = cloneEditColorAdjustState(state.colorAdjust);
  editColorLayers = cloneEditColorLayers(state.colorLayers);
  editSelectedColorLayerId = state.selectedColorLayerId;
  editNextColorLayerId = state.nextColorLayerId;
  clearEditColorAdjustCache();
  syncEditColorAdjustControls();
  editTextItems = cloneEditTextItems(state.textItems);
  editRasterLayers = cloneEditRasterLayers(state.rasterLayers);
  editMosaicShapeByLayerId = new Map(state.mosaicShapeByLayerId.map(([id, data]) => [id, { ...data }]));
  editMosaicSelectionOverlaySuppressedRasterId = null;
  editBlurShapeByLayerId = new Map(state.blurShapeByLayerId.map(([id, data]) => [id, { ...data }]));
  editBlurSelectionOverlaySuppressedRasterId = null;
  editUiLayers = cloneEditUiLayers(state.uiLayers);
  editSelectedUiLayerId = state.selectedUiLayerId;
  editSelectedTextId = state.selectedTextId;
  editCropRect = null;
  if (editCanvasEl && (editCanvasEl.width !== editBaseImageData.width || editCanvasEl.height !== editBaseImageData.height)) {
    editCanvasEl.width = editBaseImageData.width;
    editCanvasEl.height = editBaseImageData.height;
    editCanvasEl.style.width = `${editBaseImageData.width}px`;
    editCanvasEl.style.height = `${editBaseImageData.height}px`;
    scheduleSyncEditCanvasDisplaySize();
  }
  if (editSelectedTextId != null && !editTextItems.some((item) => item.id === editSelectedTextId)) {
    editSelectedTextId = null;
  }
  if (editSidebarTab === "crop") {
    ensureEditCropRectInitialized(true);
  }
  resetEditDrawingState();
  renderEditCanvasFromState();
  updateEditCursorFromEvent();
  syncEditUndoButton();
}

function resetEditWorkingState(options?: { resetHistory?: boolean; resetColorAdjust?: boolean }): boolean {
  if (!editBaseImageData) return false;
  if (options?.resetColorAdjust) {
    resetEditColorAdjustState(false, false);
  }
  resetEditDrawingState();
  editCropRect = null;
  editTextItems = [];
  editNextTextId = 1;
  editSelectedTextId = null;
  editRasterLayers = [];
  editNextRasterLayerId = 1;
  editMosaicShapeByLayerId.clear();
  editMosaicSelectionOverlaySuppressedRasterId = null;
  editBlurShapeByLayerId.clear();
  editBlurSelectionOverlaySuppressedRasterId = null;
  editUiLayers = [];
  editNextUiLayerId = 1;
  editSelectedUiLayerId = null;
  if (editSidebarTab === "crop") {
    ensureEditCropRectInitialized(true);
  }
  renderEditCanvasFromState();
  if (options?.resetHistory) {
    resetEditHistory();
  }
  pushEditHistorySnapshot();
  syncEditToolControls();
  return true;
}

async function handleResetEditCanvas() {
  if (!editModalOpen || !editBaseImageData) return;
  const ok = await showAppModal({
    title: "편집 초기화",
    message: "모든 작업 내용이 초기화됩니다. 계속할까요?",
    okLabel: "초기화",
    cancelLabel: "취소",
    kind: "confirm",
  });
  if (!ok) return;
  if (!resetEditWorkingState({ resetHistory: true, resetColorAdjust: true })) return;
  showBottomToast("모든 작업 내용이 초기화되었습니다.");
}

function transformEditImageData(source: ImageData, operation: EditTransformOperation): ImageData {
  const srcWidth = source.width;
  const srcHeight = source.height;
  const src = source.data;
  const rotated = operation === "rotate-left" || operation === "rotate-right";
  const dstWidth = rotated ? srcHeight : srcWidth;
  const dstHeight = rotated ? srcWidth : srcHeight;
  const dst = new Uint8ClampedArray(dstWidth * dstHeight * 4);

  for (let sy = 0; sy < srcHeight; sy += 1) {
    for (let sx = 0; sx < srcWidth; sx += 1) {
      let dx = sx;
      let dy = sy;
      if (operation === "rotate-left") {
        dx = sy;
        dy = srcWidth - 1 - sx;
      } else if (operation === "rotate-right") {
        dx = srcHeight - 1 - sy;
        dy = sx;
      } else if (operation === "flip-horizontal") {
        dx = srcWidth - 1 - sx;
      } else if (operation === "flip-vertical") {
        dy = srcHeight - 1 - sy;
      }

      const srcOffset = (sy * srcWidth + sx) * 4;
      const dstOffset = (dy * dstWidth + dx) * 4;
      dst[dstOffset] = src[srcOffset];
      dst[dstOffset + 1] = src[srcOffset + 1];
      dst[dstOffset + 2] = src[srcOffset + 2];
      dst[dstOffset + 3] = src[srcOffset + 3];
    }
  }
  return new ImageData(dst, dstWidth, dstHeight);
}

function handleApplyEditTransform(operation: EditTransformOperation) {
  if (!editModalOpen || editSaveInFlight || !editBaseImageData || !editCanvasEl) return;
  const source = captureEditCompositeImageData();
  if (!source) return;
  const transformed = transformEditImageData(source, operation);
  editCanvasEl.width = transformed.width;
  editCanvasEl.height = transformed.height;
  editCanvasEl.style.width = `${transformed.width}px`;
  editCanvasEl.style.height = `${transformed.height}px`;
  editBaseImageData = transformed;
  // transform applies to composited pixels; keep appearance by baking and resetting adjustment sliders
  resetEditColorAdjustState(false, false);
  if (!resetEditWorkingState()) return;
  scheduleSyncEditCanvasDisplaySize();
}

function makeEditCropRectFromPoints(startX: number, startY: number, endX: number, endY: number): EditCropRect {
  const left = Math.min(startX, endX);
  const top = Math.min(startY, endY);
  return {
    x: left,
    y: top,
    width: Math.abs(endX - startX),
    height: Math.abs(endY - startY),
  };
}

function getDefaultEditCropRect(boundsWidth?: number, boundsHeight?: number): EditCropRect | null {
  const width = boundsWidth ?? editCanvasEl?.width ?? 0;
  const height = boundsHeight ?? editCanvasEl?.height ?? 0;
  if (width <= 0 || height <= 0) return null;
  const aspectRatio = getActiveEditCropAspectRatio(width, height);
  return makeEditCropRectForAspect(width, height, aspectRatio);
}

function clampEditCropRectToBounds(rect: EditCropRect | null, width: number, height: number): EditCropRect | null {
  if (!rect || width <= 0 || height <= 0) return null;
  const left = clamp(rect.x, 0, width);
  const top = clamp(rect.y, 0, height);
  const right = clamp(rect.x + rect.width, 0, width);
  const bottom = clamp(rect.y + rect.height, 0, height);
  return {
    x: Math.min(left, right),
    y: Math.min(top, bottom),
    width: Math.abs(right - left),
    height: Math.abs(bottom - top),
  };
}

function ensureEditCropRectInitialized(force = false): boolean {
  if (!editCanvasEl) return false;
  const width = editCanvasEl.width;
  const height = editCanvasEl.height;
  if (width <= 0 || height <= 0) return false;
  if (!force) {
    const clamped = clampEditCropRectToBounds(editCropRect, width, height);
    if (clamped && clamped.width > 0 && clamped.height > 0) {
      editCropRect = clamped;
      return true;
    }
  }
  const fallback = getDefaultEditCropRect(width, height);
  if (!fallback) return false;
  editCropRect = fallback;
  return true;
}

function parseEditCropAspectMode(raw: string | undefined): EditCropAspectMode {
  if (raw === "original" || raw === "4:3" || raw === "16:9" || raw === "1:1" || raw === "custom") {
    return raw;
  }
  return "free";
}

function getActiveEditCropAspectRatio(boundsWidth?: number, boundsHeight?: number): number | null {
  if (editCropAspectMode === "free") return null;
  if (editCropAspectMode === "4:3") return 4 / 3;
  if (editCropAspectMode === "16:9") return 16 / 9;
  if (editCropAspectMode === "1:1") return 1;
  if (editCropAspectMode === "custom") {
    if (editCropCustomAspectWidth <= 0 || editCropCustomAspectHeight <= 0) return null;
    return editCropCustomAspectWidth / editCropCustomAspectHeight;
  }
  const width = boundsWidth ?? editCanvasEl?.width ?? 0;
  const height = boundsHeight ?? editCanvasEl?.height ?? 0;
  if (width <= 0 || height <= 0) return null;
  return width / height;
}

function setEditCropCustomAspectValue(inputEl: HTMLInputElement | null, value: number) {
  if (!inputEl) return;
  const safe = Math.max(EDIT_CROP_ASPECT_EPSILON, value);
  const rounded = Math.round(safe * 10000) / 10000;
  const text = Number.isInteger(rounded) ? `${rounded}` : `${rounded}`.replace(/\.?0+$/, "");
  if (document.activeElement === inputEl) return;
  if (inputEl.value !== text) {
    inputEl.value = text;
  }
}

function syncEditCropAspectControls() {
  if (editCropAspectSelectEl && editCropAspectSelectEl.value !== editCropAspectMode) {
    editCropAspectSelectEl.value = editCropAspectMode;
  }
  const custom = editCropAspectMode === "custom";
  if (editCropCustomAspectWrapEl) {
    editCropCustomAspectWrapEl.hidden = !custom;
  }
  setEditCropCustomAspectValue(editCropCustomAspectWidthEl, editCropCustomAspectWidth);
  setEditCropCustomAspectValue(editCropCustomAspectHeightEl, editCropCustomAspectHeight);
  if (editCropCustomAspectWidthEl) {
    editCropCustomAspectWidthEl.disabled = !custom;
  }
  if (editCropCustomAspectHeightEl) {
    editCropCustomAspectHeightEl.disabled = !custom;
  }
}

function syncEditCropCustomAspectStateFromInputs(): boolean {
  let changed = false;
  const widthRaw = Number(editCropCustomAspectWidthEl?.value ?? "");
  if (Number.isFinite(widthRaw) && widthRaw > EDIT_CROP_ASPECT_EPSILON) {
    const nextWidth = clamp(widthRaw, EDIT_CROP_ASPECT_EPSILON, 10000);
    if (Math.abs(nextWidth - editCropCustomAspectWidth) > EDIT_CROP_ASPECT_EPSILON) {
      editCropCustomAspectWidth = nextWidth;
      changed = true;
    }
  }
  const heightRaw = Number(editCropCustomAspectHeightEl?.value ?? "");
  if (Number.isFinite(heightRaw) && heightRaw > EDIT_CROP_ASPECT_EPSILON) {
    const nextHeight = clamp(heightRaw, EDIT_CROP_ASPECT_EPSILON, 10000);
    if (Math.abs(nextHeight - editCropCustomAspectHeight) > EDIT_CROP_ASPECT_EPSILON) {
      editCropCustomAspectHeight = nextHeight;
      changed = true;
    }
  }
  return changed;
}

function getEditCropMinSizeForAspect(
  boundsWidth: number,
  boundsHeight: number,
  aspectRatio: number | null,
): { minWidth: number; minHeight: number } {
  const minWidthBase = Math.max(1, Math.min(EDIT_CROP_MIN_SIZE_PX, boundsWidth));
  const minHeightBase = Math.max(1, Math.min(EDIT_CROP_MIN_SIZE_PX, boundsHeight));
  if (!aspectRatio || aspectRatio <= EDIT_CROP_ASPECT_EPSILON) {
    return { minWidth: minWidthBase, minHeight: minHeightBase };
  }
  let minWidth = Math.max(minWidthBase, minHeightBase * aspectRatio);
  let minHeight = minWidth / aspectRatio;
  if (minHeight < minHeightBase) {
    minHeight = minHeightBase;
    minWidth = minHeight * aspectRatio;
  }
  const shrink = Math.min(
    minWidth > 0 ? boundsWidth / minWidth : 1,
    minHeight > 0 ? boundsHeight / minHeight : 1,
    1,
  );
  minWidth *= shrink;
  minHeight *= shrink;
  return {
    minWidth: Math.max(1, minWidth),
    minHeight: Math.max(1, minHeight),
  };
}

function buildAspectCropRectFromAnchor(
  anchorX: number,
  anchorY: number,
  currentX: number,
  currentY: number,
  aspectRatio: number,
  boundsWidth: number,
  boundsHeight: number,
  minWidth: number,
  minHeight: number,
): EditCropRect | null {
  const safeAspect = Math.max(EDIT_CROP_ASPECT_EPSILON, aspectRatio);
  const dirX = currentX >= anchorX ? 1 : -1;
  const dirY = currentY >= anchorY ? 1 : -1;
  const maxWidth = dirX > 0 ? boundsWidth - anchorX : anchorX;
  const maxHeight = dirY > 0 ? boundsHeight - anchorY : anchorY;
  if (maxWidth <= 0 || maxHeight <= 0) return null;
  const rawWidth = Math.abs(currentX - anchorX);
  const rawHeight = Math.abs(currentY - anchorY);
  let width = rawWidth;
  let height = rawHeight;
  if (width < EDIT_CROP_ASPECT_EPSILON && height < EDIT_CROP_ASPECT_EPSILON) {
    width = minWidth;
    height = minHeight;
  } else if (width / Math.max(height, EDIT_CROP_ASPECT_EPSILON) >= safeAspect) {
    height = width / safeAspect;
  } else {
    width = height * safeAspect;
  }
  const grow = Math.max(
    minWidth / Math.max(width, EDIT_CROP_ASPECT_EPSILON),
    minHeight / Math.max(height, EDIT_CROP_ASPECT_EPSILON),
    1,
  );
  width *= grow;
  height *= grow;
  const shrink = Math.min(
    maxWidth / Math.max(width, EDIT_CROP_ASPECT_EPSILON),
    maxHeight / Math.max(height, EDIT_CROP_ASPECT_EPSILON),
    1,
  );
  width *= shrink;
  height *= shrink;
  if (width < 1 || height < 1) return null;
  const endX = anchorX + dirX * width;
  const endY = anchorY + dirY * height;
  return clampEditCropRectToBounds(
    makeEditCropRectFromPoints(anchorX, anchorY, endX, endY),
    boundsWidth,
    boundsHeight,
  );
}

function makeEditCropRectForAspect(
  boundsWidth: number,
  boundsHeight: number,
  aspectRatio: number | null,
): EditCropRect | null {
  if (boundsWidth <= 0 || boundsHeight <= 0) return null;
  if (!aspectRatio || aspectRatio <= EDIT_CROP_ASPECT_EPSILON) {
    return { x: 0, y: 0, width: boundsWidth, height: boundsHeight };
  }
  let width = boundsWidth;
  let height = width / aspectRatio;
  if (height > boundsHeight) {
    height = boundsHeight;
    width = height * aspectRatio;
  }
  width = Math.max(1, Math.min(boundsWidth, width));
  height = Math.max(1, Math.min(boundsHeight, height));
  return {
    x: (boundsWidth - width) * 0.5,
    y: (boundsHeight - height) * 0.5,
    width,
    height,
  };
}

function resetEditCropRectForCurrentAspect() {
  if (!editCanvasEl) return;
  const boundsWidth = editCanvasEl.width;
  const boundsHeight = editCanvasEl.height;
  if (boundsWidth <= 0 || boundsHeight <= 0) return;
  const aspectRatio = getActiveEditCropAspectRatio(boundsWidth, boundsHeight);
  const nextRect = makeEditCropRectForAspect(boundsWidth, boundsHeight, aspectRatio);
  if (!nextRect) return;
  const clamped = clampEditCropRectToBounds(nextRect, boundsWidth, boundsHeight);
  if (!clamped) return;
  editCropRect = clamped;
  renderEditCanvasFromState();
}

function getEditCropHandleSizePx(): number {
  return Math.max(5, EDIT_CROP_HANDLE_SIZE_CSS_PX * getEditCanvasPixelsPerCssPixel());
}

function getEditCropHitPaddingPx(): number {
  return Math.max(2, EDIT_CROP_HIT_PADDING_CSS_PX * getEditCanvasPixelsPerCssPixel());
}

function getEditCropDragModeAtPoint(x: number, y: number): EditCropDragMode {
  if (!editCanvasEl) return "none";
  const rect = clampEditCropRectToBounds(editCropRect, editCanvasEl.width, editCanvasEl.height);
  if (!rect || rect.width <= 0 || rect.height <= 0) return "none";
  const left = rect.x;
  const right = rect.x + rect.width;
  const top = rect.y;
  const bottom = rect.y + rect.height;
  const hitTol = getEditCropHandleSizePx() * 0.5 + getEditCropHitPaddingPx();

  const hitCorner = (cx: number, cy: number): boolean => Math.abs(x - cx) <= hitTol && Math.abs(y - cy) <= hitTol;
  if (hitCorner(left, top)) return "nw";
  if (hitCorner(right, top)) return "ne";
  if (hitCorner(right, bottom)) return "se";
  if (hitCorner(left, bottom)) return "sw";

  const withinY = y >= top - hitTol && y <= bottom + hitTol;
  const withinX = x >= left - hitTol && x <= right + hitTol;
  if (withinY && Math.abs(x - left) <= hitTol) return "w";
  if (withinY && Math.abs(x - right) <= hitTol) return "e";
  if (withinX && Math.abs(y - top) <= hitTol) return "n";
  if (withinX && Math.abs(y - bottom) <= hitTol) return "s";

  if (x >= left && x <= right && y >= top && y <= bottom) {
    return "move";
  }
  return "none";
}

function getEditCropCursorForMode(mode: EditCropDragMode): string {
  switch (mode) {
    case "n":
    case "s":
      return "ns-resize";
    case "e":
    case "w":
      return "ew-resize";
    case "ne":
    case "sw":
      return "nesw-resize";
    case "nw":
    case "se":
      return "nwse-resize";
    case "move":
      return "move";
    default:
      return "crosshair";
  }
}

function getEditCropDragModeFromHandleTarget(target: EventTarget | null): EditCropDragMode | null {
  const el = target instanceof HTMLElement ? target : null;
  const handleEl = el?.closest<HTMLElement>(".edit-crop-handle");
  if (!handleEl) return null;
  const pos = handleEl.dataset.cropPos;
  if (
    pos === "n" || pos === "ne" || pos === "e" || pos === "se"
    || pos === "s" || pos === "sw" || pos === "w" || pos === "nw"
  ) {
    return pos;
  }
  return null;
}

function startEditCropDrag(e: PointerEvent, forcedMode?: EditCropDragMode): boolean {
  if (!editModalOpen || !editCanvasEl || editSidebarTab !== "crop") return false;
  if (!ensureEditCropRectInitialized()) return false;
  const { x, y } = getEditCanvasPoint(e);
  const initialRect = clampEditCropRectToBounds(editCropRect, editCanvasEl.width, editCanvasEl.height);
  const hitMode = forcedMode ?? getEditCropDragModeAtPoint(x, y);
  const dragMode: EditCropDragMode = hitMode === "none" ? "create" : hitMode;
  let dragStartX = x;
  let dragStartY = y;
  if (initialRect && dragMode !== "create" && dragMode !== "move") {
    const left = initialRect.x;
    const right = initialRect.x + initialRect.width;
    const top = initialRect.y;
    const bottom = initialRect.y + initialRect.height;
    if (dragMode === "w" || dragMode === "nw" || dragMode === "sw") {
      dragStartX = left;
    } else if (dragMode === "e" || dragMode === "ne" || dragMode === "se") {
      dragStartX = right;
    }
    if (dragMode === "n" || dragMode === "nw" || dragMode === "ne") {
      dragStartY = top;
    } else if (dragMode === "s" || dragMode === "sw" || dragMode === "se") {
      dragStartY = bottom;
    }
  }

  resetEditDrawingState();
  editDrawing = true;
  editCropDragging = true;
  editDrawingPointerId = e.pointerId;
  editStartX = dragStartX;
  editStartY = dragStartY;
  editLastX = x;
  editLastY = y;
  editCropDragMode = dragMode;
  editCropDragStartRect = initialRect;
  if (dragMode === "create") {
    editCropRect = makeEditCropRectFromPoints(x, y, x, y);
  }
  editCanvasEl.setPointerCapture(e.pointerId);
  renderEditCanvasFromState();
  updateEditCursorFromEvent(e);
  return true;
}

function buildEditCropRectFromDrag(
  mode: EditCropDragMode,
  baseRect: EditCropRect | null,
  startX: number,
  startY: number,
  currentX: number,
  currentY: number,
  boundsWidth: number,
  boundsHeight: number,
  aspectRatio: number | null,
): EditCropRect | null {
  const minSize = getEditCropMinSizeForAspect(boundsWidth, boundsHeight, aspectRatio);
  const minWidth = minSize.minWidth;
  const minHeight = minSize.minHeight;
  if (mode === "create") {
    if (aspectRatio && aspectRatio > EDIT_CROP_ASPECT_EPSILON) {
      return buildAspectCropRectFromAnchor(
        startX,
        startY,
        currentX,
        currentY,
        aspectRatio,
        boundsWidth,
        boundsHeight,
        minWidth,
        minHeight,
      );
    }
    return clampEditCropRectToBounds(
      makeEditCropRectFromPoints(startX, startY, currentX, currentY),
      boundsWidth,
      boundsHeight,
    );
  }
  if (!baseRect) return null;
  const dx = currentX - startX;
  const dy = currentY - startY;

  let left = baseRect.x;
  let right = baseRect.x + baseRect.width;
  let top = baseRect.y;
  let bottom = baseRect.y + baseRect.height;

  if (mode === "move") {
    const width = Math.max(minWidth, right - left);
    const height = Math.max(minHeight, bottom - top);
    left = clamp(left + dx, 0, Math.max(0, boundsWidth - width));
    top = clamp(top + dy, 0, Math.max(0, boundsHeight - height));
    right = left + width;
    bottom = top + height;
    return { x: left, y: top, width: width, height: height };
  }

  if (aspectRatio && aspectRatio > EDIT_CROP_ASPECT_EPSILON) {
    if (mode === "nw" || mode === "ne" || mode === "se" || mode === "sw") {
      let anchorX = baseRect.x;
      let anchorY = baseRect.y;
      if (mode === "nw") {
        anchorX = baseRect.x + baseRect.width;
        anchorY = baseRect.y + baseRect.height;
      } else if (mode === "ne") {
        anchorX = baseRect.x;
        anchorY = baseRect.y + baseRect.height;
      } else if (mode === "se") {
        anchorX = baseRect.x;
        anchorY = baseRect.y;
      } else {
        anchorX = baseRect.x + baseRect.width;
        anchorY = baseRect.y;
      }
      return buildAspectCropRectFromAnchor(
        anchorX,
        anchorY,
        currentX,
        currentY,
        aspectRatio,
        boundsWidth,
        boundsHeight,
        minWidth,
        minHeight,
      );
    }
    if (mode === "n" || mode === "s") {
      const fixedY = mode === "n" ? baseRect.y + baseRect.height : baseRect.y;
      let height = Math.abs(currentY - fixedY);
      height = Math.max(minHeight, height);
      const maxHeight = mode === "n" ? fixedY : (boundsHeight - fixedY);
      if (maxHeight <= 0) return null;
      height = Math.min(height, maxHeight);
      let width = height * aspectRatio;
      if (width < minWidth) {
        width = minWidth;
        height = width / aspectRatio;
      }
      if (width > boundsWidth) {
        width = boundsWidth;
        height = width / aspectRatio;
      }
      if (height > maxHeight) {
        height = maxHeight;
        width = height * aspectRatio;
      }
      const centerX = baseRect.x + baseRect.width * 0.5;
      const x = clamp(centerX - width * 0.5, 0, Math.max(0, boundsWidth - width));
      const y = mode === "n" ? fixedY - height : fixedY;
      return { x, y, width, height };
    }
    if (mode === "w" || mode === "e") {
      const fixedX = mode === "w" ? baseRect.x + baseRect.width : baseRect.x;
      let width = Math.abs(currentX - fixedX);
      width = Math.max(minWidth, width);
      const maxWidth = mode === "w" ? fixedX : (boundsWidth - fixedX);
      if (maxWidth <= 0) return null;
      width = Math.min(width, maxWidth);
      let height = width / aspectRatio;
      if (height < minHeight) {
        height = minHeight;
        width = height * aspectRatio;
      }
      if (height > boundsHeight) {
        height = boundsHeight;
        width = height * aspectRatio;
      }
      if (width > maxWidth) {
        width = maxWidth;
        height = width / aspectRatio;
      }
      const centerY = baseRect.y + baseRect.height * 0.5;
      const y = clamp(centerY - height * 0.5, 0, Math.max(0, boundsHeight - height));
      const x = mode === "w" ? fixedX - width : fixedX;
      return { x, y, width, height };
    }
  }

  if (mode === "w" || mode === "nw" || mode === "sw") {
    left = clamp(left + dx, 0, right - minWidth);
  }
  if (mode === "e" || mode === "ne" || mode === "se") {
    right = clamp(right + dx, left + minWidth, boundsWidth);
  }
  if (mode === "n" || mode === "nw" || mode === "ne") {
    top = clamp(top + dy, 0, bottom - minHeight);
  }
  if (mode === "s" || mode === "sw" || mode === "se") {
    bottom = clamp(bottom + dy, top + minHeight, boundsHeight);
  }
  return {
    x: left,
    y: top,
    width: Math.max(minWidth, right - left),
    height: Math.max(minHeight, bottom - top),
  };
}

function getEditCropRectForApply(boundsWidth?: number, boundsHeight?: number): EditCropRect | null {
  const width = boundsWidth ?? editCanvasEl?.width ?? 0;
  const height = boundsHeight ?? editCanvasEl?.height ?? 0;
  const clamped = clampEditCropRectToBounds(editCropRect, width, height);
  if (!clamped) return null;
  const x = Math.floor(clamped.x);
  const y = Math.floor(clamped.y);
  const right = Math.ceil(clamped.x + clamped.width);
  const bottom = Math.ceil(clamped.y + clamped.height);
  const cropWidth = right - x;
  const cropHeight = bottom - y;
  if (cropWidth < 1 || cropHeight < 1) return null;
  return { x, y, width: cropWidth, height: cropHeight };
}

function hasValidEditCropRect(): boolean {
  return !!getEditCropRectForApply();
}

function isEditCropRectFullCanvas(): boolean {
  if (!editCanvasEl) return false;
  const width = editCanvasEl.width;
  const height = editCanvasEl.height;
  if (width <= 0 || height <= 0) return false;
  const rect = getEditCropRectForApply(width, height);
  if (!rect) return false;
  return rect.x === 0 && rect.y === 0 && rect.width === width && rect.height === height;
}

function syncEditCropInfo() {
  const width = editCanvasEl?.width ?? 0;
  const height = editCanvasEl?.height ?? 0;
  const rect = getEditCropRectForApply(width, height);
  const cropWidth = rect?.width ?? 0;
  const cropHeight = rect?.height ?? 0;
  const top = rect?.y ?? 0;
  const left = rect?.x ?? 0;
  const right = rect ? Math.max(0, width - (rect.x + rect.width)) : 0;
  const bottom = rect ? Math.max(0, height - (rect.y + rect.height)) : 0;
  const widthMax = Math.max(1, width - left);
  const heightMax = Math.max(1, height - top);
  const leftMax = Math.max(0, width - right - 1);
  const rightMax = Math.max(0, width - left - 1);
  const topMax = Math.max(0, height - bottom - 1);
  const bottomMax = Math.max(0, height - top - 1);
  if (editCropSizeWidthEl) {
    editCropSizeWidthEl.min = "1";
    editCropSizeWidthEl.max = `${widthMax}`;
    editCropSizeWidthEl.value = `${cropWidth}`;
  }
  if (editCropSizeHeightEl) {
    editCropSizeHeightEl.min = "1";
    editCropSizeHeightEl.max = `${heightMax}`;
    editCropSizeHeightEl.value = `${cropHeight}`;
  }
  if (editCropTrimTopEl) {
    editCropTrimTopEl.min = "0";
    editCropTrimTopEl.max = `${topMax}`;
    editCropTrimTopEl.value = `${top}`;
  }
  if (editCropTrimLeftEl) {
    editCropTrimLeftEl.min = "0";
    editCropTrimLeftEl.max = `${leftMax}`;
    editCropTrimLeftEl.value = `${left}`;
  }
  if (editCropTrimRightEl) {
    editCropTrimRightEl.min = "0";
    editCropTrimRightEl.max = `${rightMax}`;
    editCropTrimRightEl.value = `${right}`;
  }
  if (editCropTrimBottomEl) {
    editCropTrimBottomEl.min = "0";
    editCropTrimBottomEl.max = `${bottomMax}`;
    editCropTrimBottomEl.value = `${bottom}`;
  }
  if (editCropSelectedWidthValueEl) {
    editCropSelectedWidthValueEl.textContent = `${cropWidth}`;
  }
  if (editCropSelectedHeightValueEl) {
    editCropSelectedHeightValueEl.textContent = `${cropHeight}`;
  }
}

function getEditCropMetricInputValue(inputEl: HTMLInputElement | null, fallback: number): number {
  if (!inputEl) return fallback;
  const raw = Number(inputEl.value);
  if (!Number.isFinite(raw)) return fallback;
  return raw;
}

function parseEditCropMetricField(raw: string | undefined): EditCropMetricField | null {
  if (raw === "width" || raw === "height" || raw === "top" || raw === "left" || raw === "right" || raw === "bottom") {
    return raw;
  }
  return null;
}

function getEditCropMetricInputByField(field: EditCropMetricField): HTMLInputElement | null {
  if (field === "width") return editCropSizeWidthEl;
  if (field === "height") return editCropSizeHeightEl;
  if (field === "top") return editCropTrimTopEl;
  if (field === "left") return editCropTrimLeftEl;
  if (field === "right") return editCropTrimRightEl;
  return editCropTrimBottomEl;
}

function getEditCropMetricCurrentValue(field: EditCropMetricField): number {
  const boundsWidth = editCanvasEl?.width ?? 0;
  const boundsHeight = editCanvasEl?.height ?? 0;
  const rect = getEditCropRectForApply(boundsWidth, boundsHeight);
  if (!rect) return 0;
  if (field === "width") return rect.width;
  if (field === "height") return rect.height;
  if (field === "top") return rect.y;
  if (field === "left") return rect.x;
  if (field === "right") return Math.max(0, boundsWidth - (rect.x + rect.width));
  return Math.max(0, boundsHeight - (rect.y + rect.height));
}

function stepEditCropMetricInput(field: EditCropMetricField, direction: 1 | -1) {
  const inputEl = getEditCropMetricInputByField(field);
  if (!inputEl) return;
  syncEditCropInfo();
  const current = getEditCropMetricCurrentValue(field);
  const stepRaw = Number(inputEl.step);
  const step = Number.isFinite(stepRaw) && stepRaw > 0 ? stepRaw : 1;
  const minRaw = Number(inputEl.min);
  const maxRaw = Number(inputEl.max);
  const min = Number.isFinite(minRaw) ? minRaw : -Number.MAX_SAFE_INTEGER;
  const max = Number.isFinite(maxRaw) ? maxRaw : Number.MAX_SAFE_INTEGER;
  const next = clamp(Math.round(current + step * direction), min, max);
  inputEl.value = `${next}`;
  handleEditCropMetricInput(field);
}

function handleEditCropMetricInput(field: EditCropMetricField) {
  if (!editModalOpen || editSaveInFlight || !editCanvasEl) return;
  if (!ensureEditCropRectInitialized()) return;
  const boundsWidth = editCanvasEl.width;
  const boundsHeight = editCanvasEl.height;
  const rect = clampEditCropRectToBounds(editCropRect, boundsWidth, boundsHeight);
  if (!rect || rect.width <= 0 || rect.height <= 0) return;
  const currentTop = rect.y;
  const currentLeft = rect.x;
  const currentRight = Math.max(0, boundsWidth - (rect.x + rect.width));
  const currentBottom = Math.max(0, boundsHeight - (rect.y + rect.height));
  const nextRect: EditCropRect = { ...rect };
  switch (field) {
    case "width": {
      const raw = getEditCropMetricInputValue(editCropSizeWidthEl, rect.width);
      nextRect.width = clamp(Math.round(raw), 1, Math.max(1, boundsWidth - rect.x));
      break;
    }
    case "height": {
      const raw = getEditCropMetricInputValue(editCropSizeHeightEl, rect.height);
      nextRect.height = clamp(Math.round(raw), 1, Math.max(1, boundsHeight - rect.y));
      break;
    }
    case "top": {
      const raw = getEditCropMetricInputValue(editCropTrimTopEl, currentTop);
      const nextTop = clamp(Math.round(raw), 0, Math.max(0, boundsHeight - currentBottom - 1));
      nextRect.y = nextTop;
      nextRect.height = Math.max(1, boundsHeight - nextTop - currentBottom);
      break;
    }
    case "left": {
      const raw = getEditCropMetricInputValue(editCropTrimLeftEl, currentLeft);
      const nextLeft = clamp(Math.round(raw), 0, Math.max(0, boundsWidth - currentRight - 1));
      nextRect.x = nextLeft;
      nextRect.width = Math.max(1, boundsWidth - nextLeft - currentRight);
      break;
    }
    case "right": {
      const raw = getEditCropMetricInputValue(editCropTrimRightEl, currentRight);
      const marginRight = clamp(Math.round(raw), 0, Math.max(0, boundsWidth - currentLeft - 1));
      nextRect.x = currentLeft;
      nextRect.width = Math.max(1, boundsWidth - currentLeft - marginRight);
      break;
    }
    case "bottom": {
      const raw = getEditCropMetricInputValue(editCropTrimBottomEl, currentBottom);
      const marginBottom = clamp(Math.round(raw), 0, Math.max(0, boundsHeight - currentTop - 1));
      nextRect.y = currentTop;
      nextRect.height = Math.max(1, boundsHeight - currentTop - marginBottom);
      break;
    }
  }
  const clamped = clampEditCropRectToBounds(nextRect, boundsWidth, boundsHeight);
  if (!clamped) return;
  editCropRect = clamped;
  renderEditCanvasFromState();
}

function syncEditSaveActionButtonsVisibility() {
  const shouldShow = editSidebarTab !== "crop" || isEditCropRectFullCanvas();
  if (editApplyBtn) {
    editApplyBtn.style.display = shouldShow ? "" : "none";
  }
  if (editSaveAsBtn) {
    editSaveAsBtn.style.display = shouldShow ? "" : "none";
  }
}

function syncEditCropButtonStates() {
  const available = editModalOpen && !editSaveInFlight;
  const hasValidRect = hasValidEditCropRect();
  const cropMetricInputs = [
    editCropSizeWidthEl,
    editCropSizeHeightEl,
    editCropTrimTopEl,
    editCropTrimLeftEl,
    editCropTrimRightEl,
    editCropTrimBottomEl,
  ];
  syncEditCropInfo();
  syncEditCropAspectControls();
  if (editCropApplyBtn) {
    editCropApplyBtn.disabled = !available || !hasValidRect;
  }
  if (editCropAspectSelectEl) {
    editCropAspectSelectEl.disabled = !available;
  }
  if (editCropCustomAspectWidthEl) {
    editCropCustomAspectWidthEl.disabled = !available || editCropAspectMode !== "custom";
  }
  if (editCropCustomAspectHeightEl) {
    editCropCustomAspectHeightEl.disabled = !available || editCropAspectMode !== "custom";
  }
  if (editCropCenterHorizontalBtn) {
    editCropCenterHorizontalBtn.disabled = !available || !hasValidRect;
  }
  if (editCropCenterVerticalBtn) {
    editCropCenterVerticalBtn.disabled = !available || !hasValidRect;
  }
  for (const inputEl of cropMetricInputs) {
    if (!inputEl) continue;
    inputEl.disabled = !available || !hasValidRect;
  }
  for (const buttonEl of editCropStepperBtnEls) {
    buttonEl.disabled = !available || !hasValidRect;
  }
  syncEditSaveActionButtonsVisibility();
}

function handleCenterEditCrop(axis: "horizontal" | "vertical") {
  if (!editModalOpen || editSaveInFlight || !editCanvasEl) return;
  if (!ensureEditCropRectInitialized()) return;
  const width = editCanvasEl.width;
  const height = editCanvasEl.height;
  const rect = clampEditCropRectToBounds(editCropRect, width, height);
  if (!rect || rect.width <= 0 || rect.height <= 0) return;
  const nextRect: EditCropRect = { ...rect };
  if (axis === "horizontal") {
    nextRect.x = Math.round((width - rect.width) * 0.5);
  } else {
    nextRect.y = Math.round((height - rect.height) * 0.5);
  }
  const clamped = clampEditCropRectToBounds(nextRect, width, height);
  if (!clamped) return;
  editCropRect = clamped;
  renderEditCanvasFromState();
}

function drawEditCropOverlay(ctx: CanvasRenderingContext2D) {
  if (!editCanvasEl) return;
  const width = editCanvasEl.width;
  const height = editCanvasEl.height;
  if (width <= 0 || height <= 0) return;
  const rect = clampEditCropRectToBounds(editCropRect, width, height);
  const hasRect = !!rect && rect.width > 0 && rect.height > 0;

  ctx.save();
  ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
  ctx.beginPath();
  ctx.rect(0, 0, width, height);
  if (hasRect && rect) {
    ctx.rect(rect.x, rect.y, rect.width, rect.height);
  }
  ctx.fill("evenodd");

  if (hasRect && rect) {
    const canvasPxPerCssPx = getEditCanvasPixelsPerCssPixel();
    const lineWidth = Math.max(0.25, canvasPxPerCssPx * 1.5);
    const dash = canvasPxPerCssPx * 5;
    ctx.lineWidth = lineWidth;
    ctx.setLineDash([dash, dash]);
    ctx.lineDashOffset = 0;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.96)";
    ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
    ctx.lineDashOffset = dash;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.98)";
    ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
    ctx.setLineDash([]);

  }
  ctx.restore();
}

function cropEditImageData(source: ImageData, rect: EditCropRect): ImageData {
  const src = source.data;
  const srcWidth = source.width;
  const srcHeight = source.height;
  const x = clamp(Math.floor(rect.x), 0, Math.max(0, srcWidth - 1));
  const y = clamp(Math.floor(rect.y), 0, Math.max(0, srcHeight - 1));
  const right = clamp(Math.ceil(rect.x + rect.width), x + 1, srcWidth);
  const bottom = clamp(Math.ceil(rect.y + rect.height), y + 1, srcHeight);
  const width = Math.max(1, right - x);
  const height = Math.max(1, bottom - y);
  const dst = new Uint8ClampedArray(width * height * 4);
  for (let row = 0; row < height; row += 1) {
    const srcOffset = ((y + row) * srcWidth + x) * 4;
    const dstOffset = row * width * 4;
    dst.set(src.subarray(srcOffset, srcOffset + (width * 4)), dstOffset);
  }
  return new ImageData(dst, width, height);
}

function doRectsIntersect(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return (
    a.x < b.x + b.width
    && a.x + a.width > b.x
    && a.y < b.y + b.height
    && a.y + a.height > b.y
  );
}

function canvasHasVisiblePixels(canvas: HTMLCanvasElement): boolean {
  const width = canvas.width;
  const height = canvas.height;
  if (width <= 0 || height <= 0) return false;
  const ctx = canvas.getContext("2d", { alpha: true, willReadFrequently: true });
  if (!ctx) return false;
  const data = ctx.getImageData(0, 0, width, height).data;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] > 0) return true;
  }
  return false;
}

function cropEditRasterLayer(layer: EditRasterLayer, rect: EditCropRect): EditRasterLayer | null {
  const croppedCanvas = document.createElement("canvas");
  croppedCanvas.width = rect.width;
  croppedCanvas.height = rect.height;
  const croppedCtx = croppedCanvas.getContext("2d", { alpha: true });
  if (!croppedCtx) return null;
  croppedCtx.clearRect(0, 0, rect.width, rect.height);
  croppedCtx.drawImage(
    layer.canvas,
    Math.round(layer.offsetX - rect.x),
    Math.round(layer.offsetY - rect.y),
  );
  const hasContent = canvasHasVisiblePixels(croppedCanvas);
  if (!hasContent) return null;
  return {
    ...layer,
    canvas: croppedCanvas,
    offsetX: 0,
    offsetY: 0,
    hasContent: true,
  };
}

function handleApplyEditCropPreserveLayers(cropRect: EditCropRect): boolean {
  if (!editCanvasEl || !editBaseImageData) return false;
  const width = cropRect.width;
  const height = cropRect.height;
  if (width <= 0 || height <= 0) return false;

  const cropBounds = { x: cropRect.x, y: cropRect.y, width: cropRect.width, height: cropRect.height };
  const nextBaseImageData = cropEditImageData(editBaseImageData, cropRect);

  const keptTextIds = new Set<number>();
  const nextTextItems: EditTextItem[] = [];
  for (const item of editTextItems) {
    const bounds = getEditTextBounds(item);
    if (!doRectsIntersect(bounds, cropBounds)) continue;
    keptTextIds.add(item.id);
    nextTextItems.push({
      ...item,
      lines: [...item.lines],
      x: item.x - cropRect.x,
      y: item.y - cropRect.y,
    });
  }

  const keptRasterIds = new Set<number>();
  const nextRasterLayers: EditRasterLayer[] = [];
  for (const layer of editRasterLayers) {
    const croppedLayer = cropEditRasterLayer(layer, cropRect);
    if (!croppedLayer) continue;
    keptRasterIds.add(croppedLayer.id);
    nextRasterLayers.push(croppedLayer);
  }

  editCanvasEl.width = width;
  editCanvasEl.height = height;
  editCanvasEl.style.width = `${width}px`;
  editCanvasEl.style.height = `${height}px`;
  editBaseImageData = nextBaseImageData;
  clearEditColorAdjustCache();
  editTextItems = nextTextItems;
  editRasterLayers = nextRasterLayers;
  editMosaicShapeByLayerId = new Map(
    Array.from(editMosaicShapeByLayerId.entries())
      .filter(([id]) => keptRasterIds.has(id))
      .map(([id, data]) => [id, {
        ...data,
        sx: data.sx - cropRect.x,
        sy: data.sy - cropRect.y,
        ex: data.ex - cropRect.x,
        ey: data.ey - cropRect.y,
      }]),
  );
  editBlurShapeByLayerId = new Map(
    Array.from(editBlurShapeByLayerId.entries())
      .filter(([id]) => keptRasterIds.has(id))
      .map(([id, data]) => [id, {
        ...data,
        sx: data.sx - cropRect.x,
        sy: data.sy - cropRect.y,
        ex: data.ex - cropRect.x,
        ey: data.ey - cropRect.y,
      }]),
  );
  if (
    editMosaicSelectionOverlaySuppressedRasterId != null
    && !keptRasterIds.has(editMosaicSelectionOverlaySuppressedRasterId)
  ) {
    editMosaicSelectionOverlaySuppressedRasterId = null;
  }
  if (
    editBlurSelectionOverlaySuppressedRasterId != null
    && !keptRasterIds.has(editBlurSelectionOverlaySuppressedRasterId)
  ) {
    editBlurSelectionOverlaySuppressedRasterId = null;
  }
  editUiLayers = editUiLayers.filter((layer) => {
    if (layer.kind === "text") {
      return layer.textId != null && keptTextIds.has(layer.textId);
    }
    return layer.rasterId != null && keptRasterIds.has(layer.rasterId);
  });
  if (editSelectedTextId != null && !keptTextIds.has(editSelectedTextId)) {
    editSelectedTextId = null;
  }
  if (editSelectedUiLayerId != null && !editUiLayers.some((layer) => layer.id === editSelectedUiLayerId)) {
    editSelectedUiLayerId = editUiLayers.length > 0 ? editUiLayers[editUiLayers.length - 1].id : null;
  }
  const selectedUiLayer = getSelectedEditUiLayer();
  if (selectedUiLayer?.kind === "text" && selectedUiLayer.textId != null) {
    editSelectedTextId = selectedUiLayer.textId;
  } else if (!selectedUiLayer) {
    editSelectedTextId = null;
  }
  editCropRect = getDefaultEditCropRect(width, height);
  resetEditDrawingState();
  renderEditCanvasFromState();
  pushEditHistorySnapshot();
  scheduleSyncEditCanvasDisplaySize();
  return true;
}

function handleApplyEditCrop() {
  if (!editModalOpen || editSaveInFlight || !editCanvasEl || !editBaseImageData) return;
  const cropRect = getEditCropRectForApply();
  if (!cropRect) return;
  handleApplyEditCropPreserveLayers(cropRect);
}

function syncEditSidebarTabControls() {
  const tabs: Array<{
    tab: EditSidebarTab;
    button: HTMLButtonElement | null;
    panel: HTMLElement | null;
  }> = [
    { tab: "insert", button: editTabInsertBtn, panel: editTabInsertPanelEl },
    { tab: "color", button: editTabColorBtn, panel: editTabColorPanelEl },
    { tab: "crop", button: editTabCropBtn, panel: editTabCropPanelEl },
    { tab: "rotate", button: editTabRotateBtn, panel: editTabRotatePanelEl },
  ];
  tabs.forEach(({ tab, button, panel }) => {
    const active = editSidebarTab === tab;
    if (button) {
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", active ? "true" : "false");
      button.tabIndex = active ? 0 : -1;
    }
    if (panel) {
      panel.classList.toggle("is-active", active);
      panel.hidden = !active;
    }
  });
  const showBottomResetUndo = true;
  if (editResetBtn) {
    editResetBtn.style.display = showBottomResetUndo ? "" : "none";
  }
  if (editUndoBtn) {
    editUndoBtn.style.display = showBottomResetUndo ? "" : "none";
  }
  if (editUndoTipEl) {
    const showUndoTip = editSidebarTab === "insert";
    editUndoTipEl.style.visibility = showUndoTip ? "visible" : "hidden";
    editUndoTipEl.setAttribute("aria-hidden", showUndoTip ? "false" : "true");
  }
  syncEditCropButtonStates();
}

function setEditSidebarTab(tab: EditSidebarTab) {
  const changed = editSidebarTab !== tab;
  editSidebarTab = tab;
  syncEditSidebarTabControls();
  if (tab === "crop") {
    ensureEditCropRectInitialized();
  }
  if (tab !== "insert" && editToolMode !== "none") {
    setEditToolMode("none");
  }
  if (changed) {
    syncEditToolControls();
    renderEditCanvasFromState();
  }
}

function syncEditToolControls() {
  const isBrush = editToolMode === "brush";
  const isText = editToolMode === "text";
  const isShape = editToolMode === "shape";
  const isMosaic = editToolMode === "mosaic";
  const isBlur = editToolMode === "blur";
  if (editToolBrushBtn) {
    editToolBrushBtn.classList.toggle("is-active", isBrush);
    editToolBrushBtn.setAttribute("aria-pressed", isBrush ? "true" : "false");
  }
  if (editToolTextBtn) {
    editToolTextBtn.classList.toggle("is-active", isText);
    editToolTextBtn.setAttribute("aria-pressed", isText ? "true" : "false");
  }
  if (editToolShapeBtn) {
    editToolShapeBtn.classList.toggle("is-active", isShape);
    editToolShapeBtn.setAttribute("aria-pressed", isShape ? "true" : "false");
  }
  if (editToolMosaicBtn) {
    editToolMosaicBtn.classList.toggle("is-active", isMosaic);
    editToolMosaicBtn.setAttribute("aria-pressed", isMosaic ? "true" : "false");
  }
  if (editToolBlurBtn) {
    editToolBlurBtn.classList.toggle("is-active", isBlur);
    editToolBlurBtn.setAttribute("aria-pressed", isBlur ? "true" : "false");
  }
  if (editTextInputEl) {
    editTextInputEl.disabled = !isText;
  }
  syncEditSizeValue();
  syncEditTextControls();
  updateEditCursorFromEvent();
}

function setEditToolMode(mode: EditTool) {
  if (mode !== "none" && editSidebarTab !== "insert") {
    editSidebarTab = "insert";
    syncEditSidebarTabControls();
  }
  editToolMode = mode;
  syncEditToolControls();
}

function resetEditDrawingState() {
  editDrawing = false;
  editDrawingRasterLayerId = null;
  editDrawingBrushLayerIds = [];
  editDrawingMosaicLayerIds = [];
  editDrawingBlurLayerIds = [];
  editCropDragging = false;
  editCropDragMode = "none";
  editCropDragStartRect = null;
  editMosaicSourceData = null;
  editBlurSourceCanvas = null;
  editDraggingTextId = null;
  editDraggingTextOffsetX = 0;
  editDraggingTextOffsetY = 0;
  editDraggingTextMoved = false;
  editDraggingShapeLayerId = null;
  editDraggingShapeMoved = false;
  editDraggingMosaicShapeLayerId = null;
  editDraggingMosaicShapeMoved = false;
  editDraggingBlurShapeLayerId = null;
  editDraggingBlurShapeMoved = false;
  editBrushSmoothedX = null;
  editBrushSmoothedY = null;
  if (editCanvasEl && editDrawingPointerId != null && editCanvasEl.hasPointerCapture(editDrawingPointerId)) {
    editCanvasEl.releasePointerCapture(editDrawingPointerId);
  }
  editDrawingPointerId = null;
  updateEditCursorFromEvent();
}

function closeEditModal() {
  if (!editModalEl) return;
  editModalOpen = false;
  setEditSaveBusy(false);
  if (editColorAdjustPreviewRaf) {
    window.cancelAnimationFrame(editColorAdjustPreviewRaf);
    editColorAdjustPreviewRaf = 0;
  }
  editCursorHasClientPoint = false;
  if (editLayerDropClearTimer != null) {
    window.clearTimeout(editLayerDropClearTimer);
    editLayerDropClearTimer = null;
  }
  editLayerPointerDragCleanup?.();
  editLayerPointerDragCleanup = null;
  editLayerDragJustDropped = false;
  clearEditLayerDragClasses();
  document.body.classList.remove("is-editing");
  resetEditDrawingState();
  editBaseImageData = null;
  editColorAdjustState = createDefaultEditColorAdjustState();
  editColorLayers = [];
  editSelectedColorLayerId = null;
  editNextColorLayerId = 1;
  editColorCurveDraggingPointerId = null;
  editColorCurveDraggingLayerId = null;
  editColorCurveDraggingChannel = null;
  editColorCurveDraggingPointIndex = null;
  editColorCurveDragChanged = false;
  clearEditColorAdjustCache({ clearBaseCanvas: true });
  syncEditColorAdjustControls();
  editTextItems = [];
  editNextTextId = 1;
  editSelectedTextId = null;
  editRasterLayers = [];
  editNextRasterLayerId = 1;
  editMosaicShapeByLayerId.clear();
  editMosaicSelectionOverlaySuppressedRasterId = null;
  editBlurShapeByLayerId.clear();
  editBlurSelectionOverlaySuppressedRasterId = null;
  editCropRect = null;
  editUiLayers = [];
  editNextUiLayerId = 1;
  editSelectedUiLayerId = null;
  resetEditHistory();
  editModalEl.classList.remove("is-visible");
  editModalEl.classList.remove("is-open");
  editModalEl.setAttribute("aria-hidden", "true");
  setEditCanvasCursor("default");
  hideEditBrushCursor();
  if (editCropHandleLayerEl) {
    editCropHandleLayerEl.hidden = true;
  }
  requestAnimationFrame(() => {
    handleViewportResize();
  });
}

function getEditCanvasPoint(e: PointerEvent): { x: number; y: number } {
  if (!editCanvasEl) return { x: 0, y: 0 };
  const rect = editCanvasEl.getBoundingClientRect();
  const safeWidth = Math.max(1, editCanvasEl.width);
  const safeHeight = Math.max(1, editCanvasEl.height);
  if (rect.width <= 0 || rect.height <= 0) {
    return { x: 0, y: 0 };
  }
  const x = clamp((e.clientX - rect.left) * (safeWidth / rect.width), 0, safeWidth);
  const y = clamp((e.clientY - rect.top) * (safeHeight / rect.height), 0, safeHeight);
  return { x, y };
}

function drawSmoothedBrushSegment(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  color: string,
  mode: EditBrushMode,
) {
  const baseX = editBrushSmoothedX ?? editLastX;
  const baseY = editBrushSmoothedY ?? editLastY;
  const smoothedX = baseX + (x - baseX) * EDIT_BRUSH_SMOOTHING_FACTOR;
  const smoothedY = baseY + (y - baseY) * EDIT_BRUSH_SMOOTHING_FACTOR;
  const isErase = mode !== "draw";

  ctx.save();
  ctx.globalCompositeOperation = isErase ? "destination-out" : "source-over";
  ctx.strokeStyle = isErase ? "rgba(0, 0, 0, 1)" : color;
  ctx.lineWidth = size;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(baseX, baseY);
  // Draw up to the smoothed point to keep segments connected at high pointer speed.
  ctx.lineTo(smoothedX, smoothedY);
  ctx.stroke();
  ctx.restore();

  editBrushSmoothedX = smoothedX;
  editBrushSmoothedY = smoothedY;
  editLastX = smoothedX;
  editLastY = smoothedY;
}

function captureEditCompositeImageData(options?: { skipRasterLayerId?: number }): ImageData | null {
  if (!editCanvasEl) return null;
  const width = editCanvasEl.width;
  const height = editCanvasEl.height;
  if (width <= 0 || height <= 0) return null;
  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = width;
  tempCanvas.height = height;
  const tempCtx = tempCanvas.getContext("2d", { alpha: true });
  if (!tempCtx) return null;

  const baseImageData = getEditBaseImageDataForRender();
  if (baseImageData) {
    tempCtx.putImageData(baseImageData, 0, 0);
  } else {
    tempCtx.clearRect(0, 0, width, height);
  }
  for (const layer of editUiLayers) {
    if (layer.kind === "text" && layer.textId != null) {
      const item = getEditTextItemById(layer.textId);
      if (item) drawEditTextItem(tempCtx, item);
      continue;
    }
    if (layer.rasterId != null) {
      if (options?.skipRasterLayerId != null && layer.rasterId === options.skipRasterLayerId) continue;
      const raster = getEditRasterLayerById(layer.rasterId);
      if (raster) drawEditRasterLayer(tempCtx, raster);
    }
  }
  return tempCtx.getImageData(0, 0, width, height);
}

function getEditMosaicBlockSizeFromIntensityPx(): number {
  const intensityNorm = (clampEditMosaicIntensityPercent(editMosaicIntensityPercent) - EDIT_MOSAIC_SIZE_PERCENT_MIN)
    / Math.max(0.0001, EDIT_MOSAIC_SIZE_PERCENT_MAX - EDIT_MOSAIC_SIZE_PERCENT_MIN);
  const ref = getEditSizeReferenceLength();
  const minBlock = Math.max(EDIT_MOSAIC_BLOCK_MIN_PX, Math.round(ref * EDIT_MOSAIC_BLOCK_MIN_RATIO));
  const maxBlock = Math.max(minBlock + 2, Math.round(ref * EDIT_MOSAIC_BLOCK_MAX_RATIO));
  return Math.round(minBlock + (maxBlock - minBlock) * clamp(intensityNorm, 0, 1));
}

function drawEditMosaicDab(
  layerCtx: CanvasRenderingContext2D,
  sourceData: ImageData,
  centerX: number,
  centerY: number,
  strokeSizePx: number,
) {
  const width = sourceData.width;
  const height = sourceData.height;
  if (width <= 0 || height <= 0) return;
  const blockSize = getEditMosaicBlockSizeFromIntensityPx();
  const radius = Math.max(1, strokeSizePx * 0.5);
  const radiusSq = radius * radius;
  const minX = Math.max(0, Math.floor(centerX - radius));
  const maxX = Math.min(width - 1, Math.ceil(centerX + radius));
  const minY = Math.max(0, Math.floor(centerY - radius));
  const maxY = Math.min(height - 1, Math.ceil(centerY + radius));
  const startX = Math.floor(minX / blockSize) * blockSize;
  const startY = Math.floor(minY / blockSize) * blockSize;
  const pixels = sourceData.data;

  for (let by = startY; by <= maxY; by += blockSize) {
    for (let bx = startX; bx <= maxX; bx += blockSize) {
      const sampleX = Math.max(0, Math.min(width - 1, Math.floor(bx + blockSize * 0.5)));
      const sampleY = Math.max(0, Math.min(height - 1, Math.floor(by + blockSize * 0.5)));
      const dx = sampleX - centerX;
      const dy = sampleY - centerY;
      if ((dx * dx) + (dy * dy) > radiusSq) continue;
      const idx = (sampleY * width + sampleX) * 4;
      const alpha = pixels[idx + 3];
      if (alpha <= 0) continue;
      const drawX = Math.max(0, bx);
      const drawY = Math.max(0, by);
      const drawW = Math.min(blockSize, width - drawX);
      const drawH = Math.min(blockSize, height - drawY);
      if (drawW <= 0 || drawH <= 0) continue;
      layerCtx.fillStyle = `rgba(${pixels[idx]}, ${pixels[idx + 1]}, ${pixels[idx + 2]}, ${(alpha / 255).toFixed(3)})`;
      layerCtx.fillRect(drawX, drawY, drawW, drawH);
    }
  }
}

function drawEditMosaicSegment(
  layerCtx: CanvasRenderingContext2D,
  sourceData: ImageData,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  strokeSizePx: number,
) {
  const blockSize = getEditMosaicBlockSizeFromIntensityPx();
  const spacing = Math.max(1, Math.floor(blockSize * 0.5));
  const dx = toX - fromX;
  const dy = toY - fromY;
  const distance = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(distance / spacing));
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    drawEditMosaicDab(
      layerCtx,
      sourceData,
      fromX + dx * t,
      fromY + dy * t,
      strokeSizePx,
    );
  }
}

function drawEditMosaicShapeArea(
  layerCtx: CanvasRenderingContext2D,
  sourceData: ImageData,
  sx: number,
  sy: number,
  ex: number,
  ey: number,
  style: Exclude<EditMosaicStyle, "brush">,
): boolean {
  const width = sourceData.width;
  const height = sourceData.height;
  if (width <= 0 || height <= 0) return false;
  const left = Math.max(0, Math.min(sx, ex));
  const top = Math.max(0, Math.min(sy, ey));
  const right = Math.min(width, Math.max(sx, ex));
  const bottom = Math.min(height, Math.max(sy, ey));
  if (right - left < 1 || bottom - top < 1) return false;

  const blockSize = getEditMosaicBlockSizeFromIntensityPx();
  const pixels = sourceData.data;
  const cx = (left + right) * 0.5;
  const cy = (top + bottom) * 0.5;
  const rx = Math.max(0.001, (right - left) * 0.5);
  const ry = Math.max(0.001, (bottom - top) * 0.5);
  let wrote = false;

  for (let by = Math.floor(top / blockSize) * blockSize; by < bottom; by += blockSize) {
    for (let bx = Math.floor(left / blockSize) * blockSize; bx < right; bx += blockSize) {
      const sampleX = Math.max(0, Math.min(width - 1, Math.floor(bx + blockSize * 0.5)));
      const sampleY = Math.max(0, Math.min(height - 1, Math.floor(by + blockSize * 0.5)));
      if (sampleX < left || sampleX >= right || sampleY < top || sampleY >= bottom) {
        continue;
      }
      if (style === "ellipse") {
        const nx = (sampleX - cx) / rx;
        const ny = (sampleY - cy) / ry;
        if ((nx * nx) + (ny * ny) > 1) continue;
      }
      const idx = (sampleY * width + sampleX) * 4;
      const alpha = pixels[idx + 3];
      if (alpha <= 0) continue;
      const drawX = Math.max(0, bx);
      const drawY = Math.max(0, by);
      const drawW = Math.min(blockSize, right - drawX);
      const drawH = Math.min(blockSize, bottom - drawY);
      if (drawW <= 0 || drawH <= 0) continue;
      layerCtx.fillStyle = `rgba(${pixels[idx]}, ${pixels[idx + 1]}, ${pixels[idx + 2]}, ${(alpha / 255).toFixed(3)})`;
      layerCtx.fillRect(drawX, drawY, drawW, drawH);
      wrote = true;
    }
  }
  return wrote;
}

function redrawEditMosaicShapeLayer(layer: EditRasterLayer, shapeData: EditMosaicShapeData): boolean {
  // Mosaic shape layer stores absolute canvas pixels; keep offset at origin.
  layer.offsetX = 0;
  layer.offsetY = 0;
  const sourceData = captureEditCompositeImageData({ skipRasterLayerId: layer.id });
  if (!sourceData) return false;
  let wrote = false;
  mutateEditRasterLayer(layer, (layerCtx) => {
    layerCtx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
    wrote = drawEditMosaicShapeArea(
      layerCtx,
      sourceData,
      shapeData.sx,
      shapeData.sy,
      shapeData.ex,
      shapeData.ey,
      shapeData.style,
    );
  });
  layer.hasContent = wrote;
  return wrote;
}

function drawEditMosaicShapePreview(
  ctx: CanvasRenderingContext2D,
  style: Exclude<EditMosaicStyle, "brush">,
  sx: number,
  sy: number,
  ex: number,
  ey: number,
) {
  const left = Math.min(sx, ex);
  const top = Math.min(sy, ey);
  const width = Math.abs(ex - sx);
  const height = Math.abs(ey - sy);
  const canvasPxPerCssPx = getEditCanvasPixelsPerCssPixel();
  const lineWidth = Math.max(0.25, canvasPxPerCssPx * 1.5);
  const dash = canvasPxPerCssPx * 5;
  ctx.save();
  ctx.lineWidth = lineWidth;
  ctx.setLineDash([dash, dash]);
  const strokeShape = () => {
    if (style === "ellipse") {
      ctx.beginPath();
      ctx.ellipse(left + width * 0.5, top + height * 0.5, width * 0.5, height * 0.5, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.strokeRect(left, top, width, height);
    }
  };
  ctx.lineDashOffset = 0;
  ctx.strokeStyle = "rgba(0, 0, 0, 0.96)";
  strokeShape();
  ctx.lineDashOffset = dash;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.98)";
  strokeShape();
  ctx.restore();
}

function getEditBlurRadiusFromIntensityPx(): number {
  const intensityNorm = (clampEditBlurIntensityPercent(editBlurIntensityPercent) - EDIT_MOSAIC_SIZE_PERCENT_MIN)
    / Math.max(0.0001, EDIT_MOSAIC_SIZE_PERCENT_MAX - EDIT_MOSAIC_SIZE_PERCENT_MIN);
  const ref = getEditSizeReferenceLength();
  const minRadius = Math.max(EDIT_BLUR_RADIUS_MIN_PX, Math.round(ref * EDIT_BLUR_RADIUS_MIN_RATIO));
  const maxRadius = Math.max(minRadius + 1, Math.round(ref * EDIT_BLUR_RADIUS_MAX_RATIO));
  return Math.round(minRadius + (maxRadius - minRadius) * clamp(intensityNorm, 0, 1));
}

function createEditSourceCanvasFromImageData(sourceData: ImageData): HTMLCanvasElement | null {
  const width = sourceData.width;
  const height = sourceData.height;
  if (width <= 0 || height <= 0) return null;
  const sourceCanvas = document.createElement("canvas");
  sourceCanvas.width = width;
  sourceCanvas.height = height;
  const sourceCtx = sourceCanvas.getContext("2d", { alpha: true });
  if (!sourceCtx) return null;
  sourceCtx.putImageData(sourceData, 0, 0);
  return sourceCanvas;
}

function createEditBlurredSourceCanvasFromImageData(sourceData: ImageData): HTMLCanvasElement | null {
  const sourceCanvas = createEditSourceCanvasFromImageData(sourceData);
  if (!sourceCanvas) return null;
  const blurredCanvas = document.createElement("canvas");
  blurredCanvas.width = sourceCanvas.width;
  blurredCanvas.height = sourceCanvas.height;
  const blurredCtx = blurredCanvas.getContext("2d", { alpha: true });
  if (!blurredCtx) return null;
  const radiusPx = getEditBlurRadiusFromIntensityPx();
  blurredCtx.save();
  blurredCtx.filter = `blur(${Math.max(1, radiusPx)}px)`;
  blurredCtx.drawImage(sourceCanvas, 0, 0);
  blurredCtx.restore();
  return blurredCanvas;
}

function drawEditBlurDab(
  layerCtx: CanvasRenderingContext2D,
  blurredSourceCanvas: HTMLCanvasElement,
  centerX: number,
  centerY: number,
  strokeSizePx: number,
) {
  const radius = Math.max(1, strokeSizePx * 0.5);
  layerCtx.save();
  layerCtx.beginPath();
  layerCtx.arc(centerX, centerY, radius, 0, Math.PI * 2);
  layerCtx.clip();
  layerCtx.drawImage(blurredSourceCanvas, 0, 0);
  layerCtx.restore();
}

function drawEditBlurSegment(
  layerCtx: CanvasRenderingContext2D,
  blurredSourceCanvas: HTMLCanvasElement,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  strokeSizePx: number,
) {
  const spacing = Math.max(1, Math.floor(Math.max(2, strokeSizePx * 0.25)));
  const dx = toX - fromX;
  const dy = toY - fromY;
  const distance = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(distance / spacing));
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    drawEditBlurDab(
      layerCtx,
      blurredSourceCanvas,
      fromX + dx * t,
      fromY + dy * t,
      strokeSizePx,
    );
  }
}

function drawEditBlurShapeArea(
  layerCtx: CanvasRenderingContext2D,
  blurredSourceCanvas: HTMLCanvasElement,
  sx: number,
  sy: number,
  ex: number,
  ey: number,
  style: Exclude<EditBlurStyle, "brush">,
): boolean {
  const width = blurredSourceCanvas.width;
  const height = blurredSourceCanvas.height;
  if (width <= 0 || height <= 0) return false;
  const left = Math.max(0, Math.min(sx, ex));
  const top = Math.max(0, Math.min(sy, ey));
  const right = Math.min(width, Math.max(sx, ex));
  const bottom = Math.min(height, Math.max(sy, ey));
  if (right - left < 1 || bottom - top < 1) return false;

  layerCtx.save();
  layerCtx.beginPath();
  if (style === "ellipse") {
    layerCtx.ellipse(
      (left + right) * 0.5,
      (top + bottom) * 0.5,
      Math.max(0.001, (right - left) * 0.5),
      Math.max(0.001, (bottom - top) * 0.5),
      0,
      0,
      Math.PI * 2,
    );
  } else {
    layerCtx.rect(left, top, right - left, bottom - top);
  }
  layerCtx.clip();
  layerCtx.drawImage(blurredSourceCanvas, 0, 0);
  layerCtx.restore();
  return true;
}

function redrawEditBlurShapeLayer(layer: EditRasterLayer, shapeData: EditBlurShapeData): boolean {
  // Blur shape layer stores absolute canvas pixels; keep offset at origin.
  layer.offsetX = 0;
  layer.offsetY = 0;
  const sourceData = captureEditCompositeImageData({ skipRasterLayerId: layer.id });
  if (!sourceData) return false;
  const blurredSourceCanvas = createEditBlurredSourceCanvasFromImageData(sourceData);
  if (!blurredSourceCanvas) return false;
  let wrote = false;
  mutateEditRasterLayer(layer, (layerCtx) => {
    layerCtx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
    wrote = drawEditBlurShapeArea(
      layerCtx,
      blurredSourceCanvas,
      shapeData.sx,
      shapeData.sy,
      shapeData.ex,
      shapeData.ey,
      shapeData.style,
    );
  });
  layer.hasContent = wrote;
  return wrote;
}

function isEditShapeConstrainModifierActive(e: PointerEvent): boolean {
  return e.shiftKey;
}

function getConstrainedEditShapeEndPoint(
  shape: EditShape,
  sx: number,
  sy: number,
  ex: number,
  ey: number,
  constrain: boolean,
): { x: number; y: number } {
  if (!constrain) {
    return { x: ex, y: ey };
  }
  const dx = ex - sx;
  const dy = ey - sy;
  if (shape === "line" || shape === "arrow" || shape === "double-arrow") {
    const length = Math.hypot(dx, dy);
    if (length <= 0.0001) {
      return { x: ex, y: ey };
    }
    const snappedAngle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
    return {
      x: sx + Math.cos(snappedAngle) * length,
      y: sy + Math.sin(snappedAngle) * length,
    };
  }
  const side = Math.max(Math.abs(dx), Math.abs(dy));
  const signX = dx < 0 ? -1 : 1;
  const signY = dy < 0 ? -1 : 1;
  return {
    x: sx + signX * side,
    y: sy + signY * side,
  };
}

function drawEditShape(
  ctx: CanvasRenderingContext2D,
  shape: EditShape,
  sx: number,
  sy: number,
  ex: number,
  ey: number,
  color: string,
  size: number,
) {
  const drawArrowHead = (
    tipX: number,
    tipY: number,
    ux: number,
    uy: number,
    headLen: number,
    headHalfWidth: number,
  ) => {
    const baseX = tipX - ux * headLen;
    const baseY = tipY - uy * headLen;
    const px = -uy;
    const py = ux;
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(baseX + px * headHalfWidth, baseY + py * headHalfWidth);
    ctx.lineTo(baseX - px * headHalfWidth, baseY - py * headHalfWidth);
    ctx.closePath();
    ctx.fill();
  };
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = size;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (shape === "line") {
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    ctx.restore();
    return;
  }
  if (shape === "arrow" || shape === "double-arrow") {
    const dx = ex - sx;
    const dy = ey - sy;
    const length = Math.hypot(dx, dy);
    if (length <= 0.0001) {
      ctx.restore();
      return;
    }
    const ux = dx / length;
    const uy = dy / length;
    const headLen = Math.max(size * 4.2, 24);
    const headHalfWidth = Math.max(size * 1.9, headLen * 0.48);
    const trimForHead = Math.min(headLen * 0.78, Math.max(0, length * 0.45));
    const startTrim = shape === "double-arrow" ? trimForHead : 0;
    const endTrim = trimForHead;
    const shaftStartX = sx + ux * startTrim;
    const shaftStartY = sy + uy * startTrim;
    const shaftEndX = ex - ux * endTrim;
    const shaftEndY = ey - uy * endTrim;
    ctx.lineCap = "butt";
    ctx.beginPath();
    ctx.moveTo(shaftStartX, shaftStartY);
    ctx.lineTo(shaftEndX, shaftEndY);
    ctx.stroke();
    drawArrowHead(ex, ey, ux, uy, headLen, headHalfWidth);
    if (shape === "double-arrow") {
      drawArrowHead(sx, sy, -ux, -uy, headLen, headHalfWidth);
    }
    ctx.restore();
    return;
  }
  if (shape === "rect") {
    const x = Math.min(sx, ex);
    const y = Math.min(sy, ey);
    const w = Math.abs(ex - sx);
    const h = Math.abs(ey - sy);
    ctx.strokeRect(x, y, w, h);
    ctx.restore();
    return;
  }
  const cx = (sx + ex) * 0.5;
  const cy = (sy + ey) * 0.5;
  const rx = Math.abs(ex - sx) * 0.5;
  const ry = Math.abs(ey - sy) * 0.5;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function makeEditTextItem(ctx: CanvasRenderingContext2D, text: string, x: number, y: number): EditTextItem {
  const size = getEditStrokeSizeRatio();
  const sizePx = editSizeRatioToPixels(size, "text");
  const color = getEditStrokeColor();
  const alignRaw = editTextAlignSelectEl?.value;
  const align: EditTextAlign = alignRaw === "center" || alignRaw === "right" ? alignRaw : "left";
  const fontFamily = getEditTextFontFamilyFromControl();
  const lines = text.split(/\r?\n/);
  ctx.save();
  ctx.font = buildEditTextCanvasFont(sizePx, fontFamily);
  const metrics = measureEditTextMetrics(ctx, lines, sizePx);
  ctx.restore();
  return {
    id: editNextTextId++,
    text,
    lines,
    x,
    y,
    size,
    color,
    align,
    fontFamily,
    ascent: metrics.ascent,
    lineHeight: metrics.lineHeight,
    width: metrics.width,
    height: metrics.height,
  };
}

function recalcEditTextItemMetrics(ctx: CanvasRenderingContext2D, item: EditTextItem) {
  const sizePx = getEditTextSizePx(item);
  item.lines = item.text.split(/\r?\n/);
  ctx.save();
  ctx.font = buildEditTextCanvasFont(sizePx, item.fontFamily);
  const metrics = measureEditTextMetrics(ctx, item.lines, sizePx);
  ctx.restore();
  item.ascent = metrics.ascent;
  item.lineHeight = metrics.lineHeight;
  item.width = metrics.width;
  item.height = metrics.height;
}

function findEditTextItemAtPoint(x: number, y: number): EditTextItem | null {
  for (let i = editUiLayers.length - 1; i >= 0; i -= 1) {
    const layer = editUiLayers[i];
    if (layer.kind !== "text" || layer.textId == null) continue;
    const item = getEditTextItemById(layer.textId);
    if (!item) continue;
    const bounds = getEditTextBounds(item);
    if (
      x >= bounds.x &&
      x <= bounds.x + bounds.width &&
      y >= bounds.y &&
      y <= bounds.y + bounds.height
    ) {
      return item;
    }
  }
  return null;
}

function findShapeRasterLayerAtPoint(x: number, y: number): EditRasterLayer | null {
  for (let i = editUiLayers.length - 1; i >= 0; i -= 1) {
    const uiLayer = editUiLayers[i];
    if (uiLayer.kind !== "shape") continue;
    const raster = getEditRasterLayerById(uiLayer.rasterId);
    if (!raster) continue;
    const localX = Math.floor(x - raster.offsetX);
    const localY = Math.floor(y - raster.offsetY);
    if (localX < 0 || localY < 0 || localX >= raster.canvas.width || localY >= raster.canvas.height) {
      continue;
    }
    const ctx = raster.canvas.getContext("2d", { alpha: true, willReadFrequently: true });
    if (!ctx) continue;
    const alpha = ctx.getImageData(localX, localY, 1, 1).data[3];
    if (alpha > 0) {
      return raster;
    }
  }
  return null;
}

function findMosaicShapeRasterLayerAtPoint(x: number, y: number): EditRasterLayer | null {
  for (let i = editUiLayers.length - 1; i >= 0; i -= 1) {
    const uiLayer = editUiLayers[i];
    if (uiLayer.kind !== "mosaic") continue;
    const raster = getEditRasterLayerById(uiLayer.rasterId);
    if (!raster || !editMosaicShapeByLayerId.has(raster.id)) continue;
    const localX = Math.floor(x - raster.offsetX);
    const localY = Math.floor(y - raster.offsetY);
    if (localX < 0 || localY < 0 || localX >= raster.canvas.width || localY >= raster.canvas.height) {
      continue;
    }
    const ctx = raster.canvas.getContext("2d", { alpha: true, willReadFrequently: true });
    if (!ctx) continue;
    const alpha = ctx.getImageData(localX, localY, 1, 1).data[3];
    if (alpha > 0) {
      return raster;
    }
  }
  return null;
}

function findBlurShapeRasterLayerAtPoint(x: number, y: number): EditRasterLayer | null {
  for (let i = editUiLayers.length - 1; i >= 0; i -= 1) {
    const uiLayer = editUiLayers[i];
    if (uiLayer.kind !== "blur") continue;
    const raster = getEditRasterLayerById(uiLayer.rasterId);
    if (!raster || !editBlurShapeByLayerId.has(raster.id)) continue;
    const localX = Math.floor(x - raster.offsetX);
    const localY = Math.floor(y - raster.offsetY);
    if (localX < 0 || localY < 0 || localX >= raster.canvas.width || localY >= raster.canvas.height) {
      continue;
    }
    const ctx = raster.canvas.getContext("2d", { alpha: true, willReadFrequently: true });
    if (!ctx) continue;
    const alpha = ctx.getImageData(localX, localY, 1, 1).data[3];
    if (alpha > 0) {
      return raster;
    }
  }
  return null;
}

function removeEditRasterLayerById(rasterId: number): void {
  const beforeRasterCount = editRasterLayers.length;
  const beforeUiCount = editUiLayers.length;
  editRasterLayers = editRasterLayers.filter((layer) => layer.id !== rasterId);
  editUiLayers = editUiLayers.filter((layer) => layer.rasterId !== rasterId);
  if (beforeRasterCount === editRasterLayers.length && beforeUiCount === editUiLayers.length) {
    return;
  }
  editMosaicShapeByLayerId.delete(rasterId);
  if (editMosaicSelectionOverlaySuppressedRasterId === rasterId) {
    editMosaicSelectionOverlaySuppressedRasterId = null;
  }
  editBlurShapeByLayerId.delete(rasterId);
  if (editBlurSelectionOverlaySuppressedRasterId === rasterId) {
    editBlurSelectionOverlaySuppressedRasterId = null;
  }
  if (editSelectedUiLayerId != null && !editUiLayers.some((layer) => layer.id === editSelectedUiLayerId)) {
    editSelectedUiLayerId = editUiLayers.length > 0 ? editUiLayers[editUiLayers.length - 1].id : null;
  }
  const selectedLayer = getSelectedEditUiLayer();
  if (selectedLayer?.kind === "text" && selectedLayer.textId != null) {
    editSelectedTextId = selectedLayer.textId;
  } else {
    editSelectedTextId = null;
  }
}

function deleteSelectedEditLayer(): boolean {
  const selectedLayer = getSelectedEditUiLayer();
  if (!selectedLayer) return false;
  let changed = false;
  if (selectedLayer.kind === "text" && selectedLayer.textId != null) {
    const before = editTextItems.length;
    editTextItems = editTextItems.filter((item) => item.id !== selectedLayer.textId);
    changed = editTextItems.length !== before;
    if (editSelectedTextId === selectedLayer.textId) {
      editSelectedTextId = null;
    }
    editUiLayers = editUiLayers.filter((layer) => layer.id !== selectedLayer.id);
  } else {
    const rasterId = selectedLayer.rasterId;
    if (rasterId != null) {
      const before = editRasterLayers.length;
      editRasterLayers = editRasterLayers.filter((layer) => layer.id !== rasterId);
      changed = changed || editRasterLayers.length !== before;
      editMosaicShapeByLayerId.delete(rasterId);
      if (editMosaicSelectionOverlaySuppressedRasterId === rasterId) {
        editMosaicSelectionOverlaySuppressedRasterId = null;
      }
      editBlurShapeByLayerId.delete(rasterId);
      if (editBlurSelectionOverlaySuppressedRasterId === rasterId) {
        editBlurSelectionOverlaySuppressedRasterId = null;
      }
    }
    editUiLayers = editUiLayers.filter((layer) => layer.id !== selectedLayer.id);
    if (editSelectedTextId != null) {
      selectEditUiLayerByTextId(editSelectedTextId);
    }
  }
  if (editUiLayers.length > 0) {
    editSelectedUiLayerId = editUiLayers[Math.max(0, editUiLayers.length - 1)].id;
    const current = getSelectedEditUiLayer();
    if (current?.kind === "text" && current.textId != null) {
      editSelectedTextId = current.textId;
    } else if (editToolMode !== "text") {
      editSelectedTextId = null;
    }
  } else {
    editSelectedUiLayerId = null;
    editSelectedTextId = null;
  }
  renderEditCanvasFromState();
  if (changed || selectedLayer.kind !== "text") {
    pushEditHistorySnapshot();
  }
  return true;
}

function applyEditTextAlign(align: EditTextAlign) {
  const selected = getSelectedEditTextItem();
  if (!selected || selected.align === align) {
    syncEditTextControls();
    return;
  }
  selected.align = align;
  renderEditCanvasFromState();
  pushEditHistorySnapshot();
}

function applyEditTextFontFamily(fontFamily: string) {
  const normalized = resolveEditFontCssName(fontFamily);
  editCurrentTextFontFamily = normalized;
  syncEditFontSelectValue(normalized);
  const selected = getSelectedEditTextItem();
  if (!selected || editToolMode !== "text") {
    syncEditTextControls();
    return;
  }
  if (resolveEditFontCssName(selected.fontFamily) === normalized) {
    return;
  }
  const ctx = getEditCanvasContext();
  if (!ctx) return;
  selected.fontFamily = normalized;
  recalcEditTextItemMetrics(ctx, selected);
  renderEditCanvasFromState();
  pushEditHistorySnapshot();
}

function addEditTextLayer(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  options?: { useDefaultIfEmpty?: boolean; defaultText?: string; showToastIfEmpty?: boolean },
): boolean {
  const raw = (editTextInputEl?.value ?? "").trim();
  const text = raw || (options?.useDefaultIfEmpty ? (options?.defaultText ?? "텍스트") : "");
  if (!text) {
    if (options?.showToastIfEmpty ?? true) {
      showBottomToast("텍스트 입력 후 원하는 위치에 클릭하세요.");
    }
    return false;
  }
  if (editTextInputEl && !raw) {
    editTextInputEl.value = text;
  }
  const item = makeEditTextItem(ctx, text, x, y);
  editTextItems.push(item);
  editSelectedTextId = item.id;
  addEditUiLayer("text", item.id);
  renderEditCanvasFromState();
  return true;
}

function addEditTextAtPoint(ctx: CanvasRenderingContext2D, x: number, y: number): boolean {
  return addEditTextLayer(ctx, x, y);
}

function handleEditCanvasPointerDown(e: PointerEvent) {
  if (!editModalOpen || !editCanvasEl) return;
  if (e.button === 2) {
    const { x, y } = getEditCanvasPoint(e);
    if (editToolMode === "text") {
      const hitText = findEditTextItemAtPoint(x, y);
      if (hitText) {
        editSelectedTextId = hitText.id;
        selectEditUiLayerByTextId(hitText.id);
        deleteSelectedEditLayer();
        updateEditCursorFromEvent(e);
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }
    if (editToolMode === "shape") {
      const hitShapeLayer = findShapeRasterLayerAtPoint(x, y);
      if (hitShapeLayer) {
        editSelectedTextId = null;
        selectEditUiLayerByRasterId(hitShapeLayer.id);
        deleteSelectedEditLayer();
        updateEditCursorFromEvent(e);
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }
    if (editToolMode === "mosaic") {
      const hitMosaicShapeLayer = findMosaicShapeRasterLayerAtPoint(x, y);
      if (hitMosaicShapeLayer) {
        editSelectedTextId = null;
        selectEditUiLayerByRasterId(hitMosaicShapeLayer.id);
        deleteSelectedEditLayer();
        updateEditCursorFromEvent(e);
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }
    if (editToolMode === "blur") {
      const hitBlurShapeLayer = findBlurShapeRasterLayerAtPoint(x, y);
      if (hitBlurShapeLayer) {
        editSelectedTextId = null;
        selectEditUiLayerByRasterId(hitBlurShapeLayer.id);
        deleteSelectedEditLayer();
        updateEditCursorFromEvent(e);
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }
    return;
  }
  if (e.button !== 0) return;
  if (editSidebarTab === "crop") {
    if (startEditCropDrag(e)) {
      e.preventDefault();
      return;
    }
  }
  const { x, y } = getEditCanvasPoint(e);
  if (editToolMode === "none") return;
  const ctx = getEditCanvasContext();
  if (!ctx) return;

  if (editToolMode === "text") {
    const hit = findEditTextItemAtPoint(x, y);
    if (hit) {
      editSelectedTextId = hit.id;
      selectEditUiLayerByTextId(hit.id);
      resetEditDrawingState();
      editDrawing = true;
      editDrawingPointerId = e.pointerId;
      editDraggingTextId = hit.id;
      const bounds = getEditTextBounds(hit);
      editDraggingTextOffsetX = x - bounds.x;
      editDraggingTextOffsetY = y - bounds.y;
      editDraggingTextMoved = false;
      editCanvasEl.setPointerCapture(e.pointerId);
      renderEditCanvasFromState();
      setEditCanvasCursor("grabbing");
      e.preventDefault();
      return;
    }
    const hadSelectedText = !!getSelectedEditTextItem();
    if (hadSelectedText) {
      editSelectedTextId = null;
      editSelectedUiLayerId = null;
      renderEditCanvasFromState();
      updateEditCursorFromEvent(e);
      e.preventDefault();
      return;
    }
    editSelectedTextId = null;
    renderEditCanvasFromState();
    if (addEditTextAtPoint(ctx, x, y)) {
      pushEditHistorySnapshot();
    }
    updateEditCursorFromEvent(e);
    return;
  }

  if (editToolMode === "shape") {
    const hitShapeLayer = findShapeRasterLayerAtPoint(x, y);
    if (hitShapeLayer) {
      editSelectedTextId = null;
      selectEditUiLayerByRasterId(hitShapeLayer.id);
      resetEditDrawingState();
      editDrawing = true;
      editDrawingPointerId = e.pointerId;
      editDraggingShapeLayerId = hitShapeLayer.id;
      editLastX = x;
      editLastY = y;
      editCanvasEl.setPointerCapture(e.pointerId);
      setEditCanvasCursor("grabbing");
      renderEditCanvasFromState();
      e.preventDefault();
      return;
    }
  }
  if (editToolMode === "mosaic" && getEditMosaicStyle() !== "brush") {
    const hitMosaicShapeLayer = findMosaicShapeRasterLayerAtPoint(x, y);
    if (hitMosaicShapeLayer) {
      editSelectedTextId = null;
      selectEditUiLayerByRasterId(hitMosaicShapeLayer.id);
      resetEditDrawingState();
      editDrawing = true;
      editDrawingPointerId = e.pointerId;
      editDraggingMosaicShapeLayerId = hitMosaicShapeLayer.id;
      editLastX = x;
      editLastY = y;
      editCanvasEl.setPointerCapture(e.pointerId);
      setEditCanvasCursor("grabbing");
      renderEditCanvasFromState();
      e.preventDefault();
      return;
    }
  }
  if (editToolMode === "blur" && getEditBlurStyle() !== "brush") {
    const hitBlurShapeLayer = findBlurShapeRasterLayerAtPoint(x, y);
    if (hitBlurShapeLayer) {
      editSelectedTextId = null;
      selectEditUiLayerByRasterId(hitBlurShapeLayer.id);
      resetEditDrawingState();
      editDrawing = true;
      editDrawingPointerId = e.pointerId;
      editDraggingBlurShapeLayerId = hitBlurShapeLayer.id;
      editLastX = x;
      editLastY = y;
      editCanvasEl.setPointerCapture(e.pointerId);
      setEditCanvasCursor("grabbing");
      renderEditCanvasFromState();
      e.preventDefault();
      return;
    }
  }

  resetEditDrawingState();
  editDrawing = true;
  editDrawingPointerId = e.pointerId;
  editStartX = x;
  editStartY = y;
  editLastX = x;
  editLastY = y;
  editBrushSmoothedX = x;
  editBrushSmoothedY = y;
  editCanvasEl.setPointerCapture(e.pointerId);

  if (editToolMode === "brush") {
    const brushMode = getEditBrushMode();
    const isErase = brushMode !== "draw";
    const layers = brushMode === "erase"
      ? getBrushRasterLayersForErase()
      : (() => {
        const layer = getOrCreateBrushRasterLayerForDraw();
        return layer ? [layer] : [];
      })();
    if (layers.length === 0) {
      resetEditDrawingState();
      updateEditCursorFromEvent(e);
      e.preventDefault();
      return;
    }
    editDrawingBrushLayerIds = layers.map((layer) => layer.id);
    editDrawingRasterLayerId = editDrawingBrushLayerIds[0] ?? null;
    const size = getEditStrokeSize();
    const color = getEditStrokeColor();
    for (const layer of layers) {
      mutateEditRasterLayer(layer, (layerCtx) => {
        layerCtx.save();
        layerCtx.globalCompositeOperation = isErase ? "destination-out" : "source-over";
        layerCtx.fillStyle = isErase ? "rgba(0, 0, 0, 1)" : color;
        layerCtx.beginPath();
        layerCtx.arc(x, y, Math.max(1, size * 0.5), 0, Math.PI * 2);
        layerCtx.fill();
        layerCtx.restore();
      });
      if (brushMode === "draw") {
        layer.hasContent = true;
      }
    }
    renderEditCanvasFromState();
  } else if (editToolMode === "mosaic") {
    const style = getEditMosaicStyle();
    const brushMode = getEditMosaicBrushMode();
    if (style === "brush" && brushMode === "erase") {
      const layers = getMosaicRasterLayersForErase();
      if (layers.length === 0) {
        resetEditDrawingState();
        updateEditCursorFromEvent(e);
        e.preventDefault();
        return;
      }
      editDrawingMosaicLayerIds = layers.map((layer) => layer.id);
      const size = getEditStrokeSize();
      for (const layer of layers) {
        mutateEditRasterLayer(layer, (layerCtx) => {
          layerCtx.save();
          layerCtx.globalCompositeOperation = "destination-out";
          layerCtx.fillStyle = "rgba(0, 0, 0, 1)";
          layerCtx.beginPath();
          layerCtx.arc(x, y, Math.max(1, size * 0.5), 0, Math.PI * 2);
          layerCtx.fill();
          layerCtx.restore();
        });
      }
      renderEditCanvasFromState();
    } else {
      const layer = style === "brush"
        ? getOrCreateMosaicBrushRasterLayerForDraw()
        : getOrCreateMosaicShapeRasterLayerForDraw();
      if (!layer) {
        resetEditDrawingState();
        updateEditCursorFromEvent(e);
        e.preventDefault();
        return;
      }
      const sourceData = captureEditCompositeImageData();
      if (!sourceData) {
        resetEditDrawingState();
        updateEditCursorFromEvent(e);
        e.preventDefault();
        return;
      }
      editMosaicSourceData = sourceData;
      editDrawingRasterLayerId = layer.id;
      if (style === "brush") {
        const size = getEditStrokeSize();
        mutateEditRasterLayer(layer, (layerCtx) => {
          drawEditMosaicDab(layerCtx, sourceData, x, y, size);
        });
        layer.hasContent = true;
        renderEditCanvasFromState();
      }
    }
  } else if (editToolMode === "blur") {
    const style = getEditBlurStyle();
    const brushMode = getEditBlurBrushMode();
    if (style === "brush" && brushMode === "erase") {
      const layers = getBlurRasterLayersForErase();
      if (layers.length === 0) {
        resetEditDrawingState();
        updateEditCursorFromEvent(e);
        e.preventDefault();
        return;
      }
      editDrawingBlurLayerIds = layers.map((layer) => layer.id);
      const size = getEditStrokeSize();
      for (const layer of layers) {
        mutateEditRasterLayer(layer, (layerCtx) => {
          layerCtx.save();
          layerCtx.globalCompositeOperation = "destination-out";
          layerCtx.fillStyle = "rgba(0, 0, 0, 1)";
          layerCtx.beginPath();
          layerCtx.arc(x, y, Math.max(1, size * 0.5), 0, Math.PI * 2);
          layerCtx.fill();
          layerCtx.restore();
        });
      }
      renderEditCanvasFromState();
    } else {
      const layer = style === "brush"
        ? getOrCreateBlurBrushRasterLayerForDraw()
        : getOrCreateBlurShapeRasterLayerForDraw();
      if (!layer) {
        resetEditDrawingState();
        updateEditCursorFromEvent(e);
        e.preventDefault();
        return;
      }
      const sourceData = captureEditCompositeImageData();
      if (!sourceData) {
        resetEditDrawingState();
        updateEditCursorFromEvent(e);
        e.preventDefault();
        return;
      }
      const blurredSourceCanvas = createEditBlurredSourceCanvasFromImageData(sourceData);
      if (!blurredSourceCanvas) {
        resetEditDrawingState();
        updateEditCursorFromEvent(e);
        e.preventDefault();
        return;
      }
      editBlurSourceCanvas = blurredSourceCanvas;
      editDrawingRasterLayerId = layer.id;
      if (style === "brush") {
        const size = getEditStrokeSize();
        mutateEditRasterLayer(layer, (layerCtx) => {
          drawEditBlurDab(layerCtx, blurredSourceCanvas, x, y, size);
        });
        layer.hasContent = true;
        renderEditCanvasFromState();
      }
    }
  } else if (editToolMode === "shape") {
    const layer = getOrCreateShapeRasterLayerForDraw();
    if (!layer) return;
    editDrawingRasterLayerId = layer.id;
  }
  updateEditCursorFromEvent(e);
  e.preventDefault();
}

function handleEditCanvasPointerMove(e: PointerEvent) {
  if (!editModalOpen || !editCanvasEl) return;
  if (!editDrawing) {
    updateEditCursorFromEvent(e);
    return;
  }
  if (editDrawingPointerId != null && e.pointerId !== editDrawingPointerId) return;
  const ctx = getEditCanvasContext();
  if (!ctx) return;
  const { x, y } = getEditCanvasPoint(e);
  if (editSidebarTab === "crop" && editCropDragging) {
    editLastX = x;
    editLastY = y;
    const aspectRatio = getActiveEditCropAspectRatio(editCanvasEl.width, editCanvasEl.height);
    const nextRect = buildEditCropRectFromDrag(
      editCropDragMode,
      editCropDragStartRect,
      editStartX,
      editStartY,
      x,
      y,
      editCanvasEl.width,
      editCanvasEl.height,
      aspectRatio,
    );
    if (nextRect) {
      editCropRect = nextRect;
    }
    renderEditCanvasFromState();
    updateEditCursorFromEvent(e);
    e.preventDefault();
    return;
  }

  if (editToolMode === "text" && editDraggingTextId != null) {
    const item = editTextItems.find((it) => it.id === editDraggingTextId);
    if (!item) return;
    const left = clamp(x - editDraggingTextOffsetX, 0, Math.max(0, editCanvasEl.width - item.width));
    item.y = clamp(y - editDraggingTextOffsetY, 0, Math.max(0, editCanvasEl.height - item.height));
    if (item.align === "center") {
      item.x = left + item.width * 0.5;
    } else if (item.align === "right") {
      item.x = left + item.width;
    } else {
      item.x = left;
    }
    editDraggingTextMoved = true;
    renderEditCanvasFromState();
    setEditCanvasCursor("grabbing");
    e.preventDefault();
    return;
  }

  if (editToolMode === "shape" && editDraggingShapeLayerId != null) {
    const layer = getEditRasterLayerById(editDraggingShapeLayerId);
    if (!layer || !editCanvasEl) return;
    const dx = x - editLastX;
    const dy = y - editLastY;
    if (dx !== 0 || dy !== 0) {
      const minOffsetX = -editCanvasEl.width + 1;
      const maxOffsetX = editCanvasEl.width - 1;
      const minOffsetY = -editCanvasEl.height + 1;
      const maxOffsetY = editCanvasEl.height - 1;
      layer.offsetX = Math.round(clamp(layer.offsetX + dx, minOffsetX, maxOffsetX));
      layer.offsetY = Math.round(clamp(layer.offsetY + dy, minOffsetY, maxOffsetY));
      editLastX = x;
      editLastY = y;
      editDraggingShapeMoved = true;
      renderEditCanvasFromState();
    }
    setEditCanvasCursor("grabbing");
    e.preventDefault();
    return;
  }
  if (editToolMode === "mosaic" && editDraggingMosaicShapeLayerId != null) {
    const layer = getEditRasterLayerById(editDraggingMosaicShapeLayerId);
    if (!layer || !editCanvasEl) return;
    const shapeData = editMosaicShapeByLayerId.get(layer.id);
    if (!shapeData) return;
    const dx = x - editLastX;
    const dy = y - editLastY;
    if (dx !== 0 || dy !== 0) {
      if (layer.offsetX !== 0 || layer.offsetY !== 0) {
        shapeData.sx += layer.offsetX;
        shapeData.sy += layer.offsetY;
        shapeData.ex += layer.offsetX;
        shapeData.ey += layer.offsetY;
      }
      shapeData.sx += dx;
      shapeData.sy += dy;
      shapeData.ex += dx;
      shapeData.ey += dy;
      redrawEditMosaicShapeLayer(layer, shapeData);
      editLastX = x;
      editLastY = y;
      editDraggingMosaicShapeMoved = true;
      renderEditCanvasFromState();
    }
    setEditCanvasCursor("grabbing");
    e.preventDefault();
    return;
  }
  if (editToolMode === "blur" && editDraggingBlurShapeLayerId != null) {
    const layer = getEditRasterLayerById(editDraggingBlurShapeLayerId);
    if (!layer || !editCanvasEl) return;
    const shapeData = editBlurShapeByLayerId.get(layer.id);
    if (!shapeData) return;
    const dx = x - editLastX;
    const dy = y - editLastY;
    if (dx !== 0 || dy !== 0) {
      if (layer.offsetX !== 0 || layer.offsetY !== 0) {
        shapeData.sx += layer.offsetX;
        shapeData.sy += layer.offsetY;
        shapeData.ex += layer.offsetX;
        shapeData.ey += layer.offsetY;
      }
      shapeData.sx += dx;
      shapeData.sy += dy;
      shapeData.ex += dx;
      shapeData.ey += dy;
      redrawEditBlurShapeLayer(layer, shapeData);
      editLastX = x;
      editLastY = y;
      editDraggingBlurShapeMoved = true;
      renderEditCanvasFromState();
    }
    setEditCanvasCursor("grabbing");
    e.preventDefault();
    return;
  }

  if (editToolMode === "brush") {
    const brushMode = getEditBrushMode();
    const layers = editDrawingBrushLayerIds
      .map((id) => getEditRasterLayerById(id))
      .filter((layer): layer is EditRasterLayer => !!layer);
    if (layers.length === 0) return;
    const size = getEditStrokeSize();
    const color = getEditStrokeColor();
    const events =
      typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [];
    for (const layer of layers) {
      mutateEditRasterLayer(layer, (layerCtx) => {
        if (events.length > 0) {
          for (const ev of events) {
            const point = getEditCanvasPoint(ev);
            drawSmoothedBrushSegment(layerCtx, point.x, point.y, size, color, brushMode);
          }
        } else {
          drawSmoothedBrushSegment(layerCtx, x, y, size, color, brushMode);
        }
      });
    }
    renderEditCanvasFromState();
    updateEditCursorFromEvent(e);
    e.preventDefault();
    return;
  }

  if (editToolMode === "mosaic") {
    const style = getEditMosaicStyle();
    const brushMode = getEditMosaicBrushMode();
    const size = style === "brush"
      ? getEditStrokeSize()
      : getEditMosaicBlockSizeFromIntensityPx();
    if (style === "brush" && brushMode === "erase") {
      const layers = editDrawingMosaicLayerIds
        .map((id) => getEditRasterLayerById(id))
        .filter((layer): layer is EditRasterLayer => !!layer);
      if (layers.length === 0) return;
      for (const layer of layers) {
        mutateEditRasterLayer(layer, (layerCtx) => {
          layerCtx.save();
          layerCtx.globalCompositeOperation = "destination-out";
          layerCtx.strokeStyle = "rgba(0, 0, 0, 1)";
          layerCtx.lineWidth = size;
          layerCtx.lineCap = "round";
          layerCtx.lineJoin = "round";
          layerCtx.beginPath();
          layerCtx.moveTo(editLastX, editLastY);
          layerCtx.lineTo(x, y);
          layerCtx.stroke();
          layerCtx.restore();
        });
      }
      editLastX = x;
      editLastY = y;
      renderEditCanvasFromState();
    } else if (style === "brush") {
      const layer = getEditRasterLayerById(editDrawingRasterLayerId);
      const sourceData = editMosaicSourceData;
      if (!layer || !sourceData) return;
      mutateEditRasterLayer(layer, (layerCtx) => {
        drawEditMosaicSegment(layerCtx, sourceData, editLastX, editLastY, x, y, size);
      });
      layer.hasContent = true;
      editLastX = x;
      editLastY = y;
      renderEditCanvasFromState();
    } else {
      const layer = getEditRasterLayerById(editDrawingRasterLayerId);
      const sourceData = editMosaicSourceData;
      if (!layer || !sourceData) return;
      renderEditCanvasFromState();
      drawEditMosaicShapePreview(ctx, style, editStartX, editStartY, x, y);
      editLastX = x;
      editLastY = y;
    }
    updateEditCursorFromEvent(e);
    e.preventDefault();
    return;
  }

  if (editToolMode === "blur") {
    const style = getEditBlurStyle();
    const brushMode = getEditBlurBrushMode();
    const size = style === "brush"
      ? getEditStrokeSize()
      : getEditBlurRadiusFromIntensityPx();
    if (style === "brush" && brushMode === "erase") {
      const layers = editDrawingBlurLayerIds
        .map((id) => getEditRasterLayerById(id))
        .filter((layer): layer is EditRasterLayer => !!layer);
      if (layers.length === 0) return;
      for (const layer of layers) {
        mutateEditRasterLayer(layer, (layerCtx) => {
          layerCtx.save();
          layerCtx.globalCompositeOperation = "destination-out";
          layerCtx.strokeStyle = "rgba(0, 0, 0, 1)";
          layerCtx.lineWidth = size;
          layerCtx.lineCap = "round";
          layerCtx.lineJoin = "round";
          layerCtx.beginPath();
          layerCtx.moveTo(editLastX, editLastY);
          layerCtx.lineTo(x, y);
          layerCtx.stroke();
          layerCtx.restore();
        });
      }
      editLastX = x;
      editLastY = y;
      renderEditCanvasFromState();
    } else if (style === "brush") {
      const layer = getEditRasterLayerById(editDrawingRasterLayerId);
      const blurredSourceCanvas = editBlurSourceCanvas;
      if (!layer || !blurredSourceCanvas) return;
      mutateEditRasterLayer(layer, (layerCtx) => {
        drawEditBlurSegment(layerCtx, blurredSourceCanvas, editLastX, editLastY, x, y, size);
      });
      layer.hasContent = true;
      editLastX = x;
      editLastY = y;
      renderEditCanvasFromState();
    } else {
      const layer = getEditRasterLayerById(editDrawingRasterLayerId);
      const blurredSourceCanvas = editBlurSourceCanvas;
      if (!layer || !blurredSourceCanvas) return;
      renderEditCanvasFromState();
      drawEditMosaicShapePreview(ctx, style, editStartX, editStartY, x, y);
      editLastX = x;
      editLastY = y;
    }
    updateEditCursorFromEvent(e);
    e.preventDefault();
    return;
  }

  if (editToolMode === "shape") {
    const layer = getEditRasterLayerById(editDrawingRasterLayerId);
    if (!layer) return;
    const shape = getEditShapeType();
    const constrainedEnd = getConstrainedEditShapeEndPoint(
      shape,
      editStartX,
      editStartY,
      x,
      y,
      isEditShapeConstrainModifierActive(e),
    );
    renderEditCanvasFromState();
    drawEditShape(
      ctx,
      shape,
      editStartX,
      editStartY,
      constrainedEnd.x,
      constrainedEnd.y,
      getEditStrokeColor(),
      getEditStrokeSize(),
    );
    updateEditCursorFromEvent(e);
    e.preventDefault();
  }
}

function finishEditCanvasPointer(e: PointerEvent) {
  if (!editModalOpen || !editDrawing) return;
  if (editDrawingPointerId != null && e.pointerId !== editDrawingPointerId) return;
  if (editSidebarTab === "crop" && editCropDragging) {
    const { x, y } = getEditCanvasPoint(e);
    const boundsWidth = editCanvasEl?.width ?? 0;
    const boundsHeight = editCanvasEl?.height ?? 0;
    const aspectRatio = getActiveEditCropAspectRatio(boundsWidth, boundsHeight);
    const nextRect = buildEditCropRectFromDrag(
      editCropDragMode,
      editCropDragStartRect,
      editStartX,
      editStartY,
      x,
      y,
      boundsWidth,
      boundsHeight,
      aspectRatio,
    );
    const fallbackRect = editCropDragStartRect ?? editCropRect ?? getDefaultEditCropRect(boundsWidth, boundsHeight);
    const pickedRect = nextRect && nextRect.width >= 1 && nextRect.height >= 1 ? nextRect : fallbackRect;
    editCropRect = clampEditCropRectToBounds(pickedRect, boundsWidth, boundsHeight);
    if (!editCropRect) {
      ensureEditCropRectInitialized(true);
    }
    resetEditDrawingState();
    renderEditCanvasFromState();
    updateEditCursorFromEvent(e);
    e.preventDefault();
    return;
  }
  const ctx = getEditCanvasContext();
  let committed = false;
  if (ctx && editToolMode === "text" && editDraggingTextId != null) {
    committed = editDraggingTextMoved;
    resetEditDrawingState();
    if (committed) {
      renderEditCanvasFromState();
      pushEditHistorySnapshot();
    } else {
      renderEditCanvasFromState();
    }
    updateEditCursorFromEvent(e);
    e.preventDefault();
    return;
  }
  if (ctx && editToolMode === "shape" && editDraggingShapeLayerId != null) {
    committed = editDraggingShapeMoved;
    resetEditDrawingState();
    renderEditCanvasFromState();
    if (committed) {
      pushEditHistorySnapshot();
    }
    updateEditCursorFromEvent(e);
    e.preventDefault();
    return;
  }
  if (ctx && editToolMode === "mosaic" && editDraggingMosaicShapeLayerId != null) {
    committed = editDraggingMosaicShapeMoved;
    resetEditDrawingState();
    renderEditCanvasFromState();
    if (committed) {
      pushEditHistorySnapshot();
    }
    updateEditCursorFromEvent(e);
    e.preventDefault();
    return;
  }
  if (ctx && editToolMode === "blur" && editDraggingBlurShapeLayerId != null) {
    committed = editDraggingBlurShapeMoved;
    resetEditDrawingState();
    renderEditCanvasFromState();
    if (committed) {
      pushEditHistorySnapshot();
    }
    updateEditCursorFromEvent(e);
    e.preventDefault();
    return;
  }
  if (ctx && editToolMode === "brush") {
    const brushMode = getEditBrushMode();
    const layers = editDrawingBrushLayerIds
      .map((id) => getEditRasterLayerById(id))
      .filter((layer): layer is EditRasterLayer => !!layer);
    if (layers.length === 0) return;
    const { x, y } = getEditCanvasPoint(e);
    const fromX = editBrushSmoothedX ?? editLastX;
    const fromY = editBrushSmoothedY ?? editLastY;
    const size = getEditStrokeSize();
    const color = getEditStrokeColor();
    const isErase = brushMode !== "draw";
    for (const layer of layers) {
      mutateEditRasterLayer(layer, (layerCtx) => {
        layerCtx.save();
        layerCtx.globalCompositeOperation = isErase ? "destination-out" : "source-over";
        layerCtx.strokeStyle = isErase ? "rgba(0, 0, 0, 1)" : color;
        layerCtx.lineWidth = size;
        layerCtx.lineCap = "round";
        layerCtx.lineJoin = "round";
        layerCtx.beginPath();
        layerCtx.moveTo(fromX, fromY);
        layerCtx.lineTo(x, y);
        layerCtx.stroke();
        layerCtx.restore();
      });
      if (brushMode === "draw") {
        layer.hasContent = true;
      }
    }
    renderEditCanvasFromState();
    committed = true;
  }
  if (ctx && editToolMode === "mosaic") {
    const { x, y } = getEditCanvasPoint(e);
    const style = getEditMosaicStyle();
    const brushMode = getEditMosaicBrushMode();
    const size = style === "brush"
      ? getEditStrokeSize()
      : getEditMosaicBlockSizeFromIntensityPx();
    if (style === "brush" && brushMode === "erase") {
      const layers = editDrawingMosaicLayerIds
        .map((id) => getEditRasterLayerById(id))
        .filter((layer): layer is EditRasterLayer => !!layer);
      if (layers.length === 0) return;
      for (const layer of layers) {
        mutateEditRasterLayer(layer, (layerCtx) => {
          layerCtx.save();
          layerCtx.globalCompositeOperation = "destination-out";
          layerCtx.strokeStyle = "rgba(0, 0, 0, 1)";
          layerCtx.lineWidth = size;
          layerCtx.lineCap = "round";
          layerCtx.lineJoin = "round";
          layerCtx.beginPath();
          layerCtx.moveTo(editLastX, editLastY);
          layerCtx.lineTo(x, y);
          layerCtx.stroke();
          layerCtx.restore();
        });
        if (!canvasHasVisiblePixels(layer.canvas)) {
          removeEditRasterLayerById(layer.id);
        } else {
          layer.hasContent = true;
        }
      }
      committed = true;
    } else if (style === "brush") {
      const layer = getEditRasterLayerById(editDrawingRasterLayerId);
      const sourceData = editMosaicSourceData;
      if (!layer || !sourceData) return;
      mutateEditRasterLayer(layer, (layerCtx) => {
        drawEditMosaicSegment(layerCtx, sourceData, editLastX, editLastY, x, y, size);
      });
      layer.hasContent = true;
      committed = true;
    } else {
      const layer = getEditRasterLayerById(editDrawingRasterLayerId);
      const sourceData = editMosaicSourceData;
      if (!layer || !sourceData) return;
      let wrote = false;
      mutateEditRasterLayer(layer, (layerCtx) => {
        wrote = drawEditMosaicShapeArea(layerCtx, sourceData, editStartX, editStartY, x, y, style);
      });
      if (wrote) {
        editMosaicShapeByLayerId.set(layer.id, {
          style,
          sx: editStartX,
          sy: editStartY,
          ex: x,
          ey: y,
          size,
        });
        editMosaicSelectionOverlaySuppressedRasterId = layer.id;
        layer.hasContent = true;
        committed = true;
      } else if (!layer.hasContent) {
        removeEditRasterLayerById(layer.id);
      }
    }
    renderEditCanvasFromState();
  }
  if (ctx && editToolMode === "blur") {
    const { x, y } = getEditCanvasPoint(e);
    const style = getEditBlurStyle();
    const brushMode = getEditBlurBrushMode();
    const size = style === "brush"
      ? getEditStrokeSize()
      : getEditBlurRadiusFromIntensityPx();
    if (style === "brush" && brushMode === "erase") {
      const layers = editDrawingBlurLayerIds
        .map((id) => getEditRasterLayerById(id))
        .filter((layer): layer is EditRasterLayer => !!layer);
      if (layers.length === 0) return;
      for (const layer of layers) {
        mutateEditRasterLayer(layer, (layerCtx) => {
          layerCtx.save();
          layerCtx.globalCompositeOperation = "destination-out";
          layerCtx.strokeStyle = "rgba(0, 0, 0, 1)";
          layerCtx.lineWidth = size;
          layerCtx.lineCap = "round";
          layerCtx.lineJoin = "round";
          layerCtx.beginPath();
          layerCtx.moveTo(editLastX, editLastY);
          layerCtx.lineTo(x, y);
          layerCtx.stroke();
          layerCtx.restore();
        });
        if (!canvasHasVisiblePixels(layer.canvas)) {
          removeEditRasterLayerById(layer.id);
        } else {
          layer.hasContent = true;
        }
      }
      committed = true;
    } else if (style === "brush") {
      const layer = getEditRasterLayerById(editDrawingRasterLayerId);
      const blurredSourceCanvas = editBlurSourceCanvas;
      if (!layer || !blurredSourceCanvas) return;
      mutateEditRasterLayer(layer, (layerCtx) => {
        drawEditBlurSegment(layerCtx, blurredSourceCanvas, editLastX, editLastY, x, y, size);
      });
      layer.hasContent = true;
      committed = true;
    } else {
      const layer = getEditRasterLayerById(editDrawingRasterLayerId);
      const blurredSourceCanvas = editBlurSourceCanvas;
      if (!layer || !blurredSourceCanvas) return;
      let wrote = false;
      mutateEditRasterLayer(layer, (layerCtx) => {
        wrote = drawEditBlurShapeArea(layerCtx, blurredSourceCanvas, editStartX, editStartY, x, y, style);
      });
      if (wrote) {
        editBlurShapeByLayerId.set(layer.id, {
          style,
          sx: editStartX,
          sy: editStartY,
          ex: x,
          ey: y,
          size,
        });
        editBlurSelectionOverlaySuppressedRasterId = layer.id;
        layer.hasContent = true;
        committed = true;
      } else if (!layer.hasContent) {
        removeEditRasterLayerById(layer.id);
      }
    }
    renderEditCanvasFromState();
  }
  if (ctx && editToolMode === "shape") {
    const layer = getEditRasterLayerById(editDrawingRasterLayerId);
    if (!layer) return;
    const { x, y } = getEditCanvasPoint(e);
    const shape = getEditShapeType();
    const constrainedEnd = getConstrainedEditShapeEndPoint(
      shape,
      editStartX,
      editStartY,
      x,
      y,
      isEditShapeConstrainModifierActive(e),
    );
    const dx = constrainedEnd.x - editStartX;
    const dy = constrainedEnd.y - editStartY;
    const hasMeaningfulDraw = shape === "line" || shape === "arrow" || shape === "double-arrow"
      ? Math.hypot(dx, dy) >= 1
      : (Math.abs(dx) >= 1 || Math.abs(dy) >= 1);
    if (hasMeaningfulDraw) {
      mutateEditRasterLayer(layer, (layerCtx) => {
        const startX = editStartX - layer.offsetX;
        const startY = editStartY - layer.offsetY;
        const endX = constrainedEnd.x - layer.offsetX;
        const endY = constrainedEnd.y - layer.offsetY;
        drawEditShape(
          layerCtx,
          shape,
          startX,
          startY,
          endX,
          endY,
          getEditStrokeColor(),
          getEditStrokeSize(),
        );
      });
      layer.hasContent = true;
      renderEditCanvasFromState();
      committed = true;
    } else if (!layer.hasContent) {
      removeEditRasterLayerById(layer.id);
      renderEditCanvasFromState();
    }
  }
  resetEditDrawingState();
  if (committed) {
    pushEditHistorySnapshot();
  }
  updateEditCursorFromEvent(e);
  e.preventDefault();
}

function handleEditCropHandlePointerDown(e: PointerEvent) {
  if (!editModalOpen || editSidebarTab !== "crop") return;
  if (e.button !== 0) return;
  const modeFromHandle = getEditCropDragModeFromHandleTarget(e.target);
  const dragMode: EditCropDragMode = modeFromHandle ?? "move";
  if (startEditCropDrag(e, dragMode)) {
    e.preventDefault();
    e.stopPropagation();
  }
}

async function openEditModal() {
  if (!canEditCurrentImage()) return;
  if (!editModalEl || !editCanvasEl) return;
  closeBottomMoreMenu();
  closeStageContextMenu();

  try {
    let loaded: LoadedImageSource | null = null;
    try {
      if (renderMode === "native-image" && isAbsoluteFilePath(currentOpenedPath)) {
        loaded = await loadImageElementFromLocalPath(currentOpenedPath).catch(() => null);
      }
      if (!loaded) {
        const blob = await buildClipboardPngBlob();
        if (!blob) {
          throw new Error("편집 가능한 이미지를 준비하지 못했습니다.");
        }
        loaded = await loadImageFromBlob(blob);
      }
      const image = loaded.image;

      const ctx = getEditCanvasContext();
      if (!ctx) {
        throw new Error("편집 캔버스를 사용할 수 없습니다.");
      }

      const width = Math.max(1, image.naturalWidth || image.width || Math.round(mediaWidth));
      const height = Math.max(1, image.naturalHeight || image.height || Math.round(mediaHeight));
      editCanvasEl.width = width;
      editCanvasEl.height = height;
      editCanvasEl.style.width = `${width}px`;
      editCanvasEl.style.height = `${height}px`;
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(image, 0, 0, width, height);
      editBaseImageData = ctx.getImageData(0, 0, width, height);
      resetEditColorAdjustState(false);
      editTextItems = [];
      editNextTextId = 1;
      editSelectedTextId = null;
      editRasterLayers = [];
      editNextRasterLayerId = 1;
      editMosaicShapeByLayerId.clear();
      editMosaicSelectionOverlaySuppressedRasterId = null;
      editBlurShapeByLayerId.clear();
      editBlurSelectionOverlaySuppressedRasterId = null;
      editCropRect = null;
      editCropAspectMode = "free";
      editCropCustomAspectWidth = 1;
      editCropCustomAspectHeight = 1;
      editUiLayers = [];
      editNextUiLayerId = 1;
      editSelectedUiLayerId = null;
      editSizeRatioByTool = makeDefaultEditSizeRatioByTool();
      editColorByTool = makeDefaultEditColorByTool();
      editBrushMode = "draw";
      editMosaicBrushMode = "draw";
      editMosaicStyle = "rect";
      editMosaicIntensityPercent = EDIT_MOSAIC_INTENSITY_PERCENT_DEFAULT;
      editBlurBrushMode = "draw";
      editBlurStyle = "rect";
      editBlurIntensityPercent = EDIT_BLUR_INTENSITY_PERCENT_DEFAULT;
      if (editColorInputEl) {
        editColorInputEl.value = getEditColorForTool("brush");
      }
      syncEditColorSwatchSelection(getEditColorForTool("brush"));
      editCurrentTextFontFamily = EDIT_TEXT_FONT_DEFAULT;
      if (editAvailableFonts.length === 0) {
        setEditFontSelectOptions(getDefaultEditFontCatalog());
      }
      syncEditFontSelectValue(editCurrentTextFontFamily);
      void ensureEditFontFamiliesLoaded();
      renderEditCanvasFromState();
      resetEditDrawingState();
      resetEditHistory();
      pushEditHistorySnapshot();
      syncEditSizeValue();
      setEditSidebarTab("insert");
      setEditToolMode("none");
      syncEditToolControls();
      updateEditCursorFromEvent();

      editModalOpen = true;
      setEditSaveBusy(false);
      document.body.classList.add("is-editing");
      editModalEl.classList.add("is-open");
      editModalEl.classList.add("is-visible");
      editModalEl.setAttribute("aria-hidden", "false");
      scheduleSyncEditCanvasDisplaySize();
    } finally {
      loaded?.cleanup();
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await showAppModal({
      title: "이미지 편집",
      message: reason,
    });
  }
}

function setEditSaveBusy(busy: boolean) {
  editSaveInFlight = busy;
  if (editApplyBtn) {
    editApplyBtn.disabled = busy || !editModalOpen;
  }
  if (editSaveAsBtn) {
    editSaveAsBtn.disabled = busy || !editModalOpen;
  }
  if (editTransformRotateLeftBtn) {
    editTransformRotateLeftBtn.disabled = busy || !editModalOpen;
  }
  if (editTransformRotateRightBtn) {
    editTransformRotateRightBtn.disabled = busy || !editModalOpen;
  }
  if (editTransformFlipHorizontalBtn) {
    editTransformFlipHorizontalBtn.disabled = busy || !editModalOpen;
  }
  if (editTransformFlipVerticalBtn) {
    editTransformFlipVerticalBtn.disabled = busy || !editModalOpen;
  }
  syncEditCropButtonStates();
}

function getDefaultEditedSavePath(): string {
  const sourcePath = isAbsoluteFilePath(currentOpenedPath)
    ? currentOpenedPath
    : currentFileName || "edited-image.png";
  const dir = getDirName(sourcePath);
  const stem = getFileStem(sourcePath) || "edited-image";
  const ext = normalizeEditSaveExt(getExt(sourcePath) || currentImageExt || "png");
  const fileName = `${stem}-edited.${ext}`;
  return dir ? joinPath(dir, fileName, sourcePath) : fileName;
}

function getEditedCanvasRgbaPayload(): { width: number; height: number; rgba: Uint8Array } {
  if (!editCanvasEl) {
    throw new Error("편집 캔버스를 찾을 수 없습니다.");
  }
  const ctx = getEditCanvasContext();
  if (!ctx) {
    throw new Error("편집 캔버스를 사용할 수 없습니다.");
  }
  renderEditCanvasFromState({ includeSelection: false, includeCropOverlay: false });
  const width = editCanvasEl.width;
  const height = editCanvasEl.height;
  if (width <= 0 || height <= 0) {
    throw new Error("저장할 수 있는 이미지 크기가 아닙니다.");
  }
  const imageData = ctx.getImageData(0, 0, width, height);
  return { width, height, rgba: new Uint8Array(imageData.data) };
}

function applyEditedSnapshotToViewer(snapshot: { width: number; height: number; rgba: Uint8Array }, savedPath: string) {
  const prevRenderScaleFactor = hasImage ? getRenderScaleFactor() : 1;
  const prevVisualScale = currentScale * prevRenderScaleFactor;
  const prevVisualTargetScale = zoomTargetScale * prevRenderScaleFactor;
  const payload: DecodedImagePayload = {
    width: snapshot.width,
    height: snapshot.height,
    bands: 4,
    raw: snapshot.rgba,
    originalWidth: snapshot.width,
    originalHeight: snapshot.height,
  };
  const ext = getExt(savedPath) || currentImageExt || "png";
  const previousPath = currentOpenedPath;
  stopPlayback();
  pendingVisualRotationDeg = 0;
  pendingVisualRotationPath = "";
  if (previousPath) {
    setStoredVisualRotationDeg(previousPath, 0);
  }
  if (savedPath) {
    currentOpenedPath = savedPath;
    setStoredVisualRotationDeg(savedPath, 0);
  }
  currentImagePathForDecode = savedPath;
  drawDecodedPayload(payload, savedPath || currentFileName || "편집 이미지", ext, {
    resetView: false,
    renderDpi: null,
  });
  const nextRenderScaleFactor = getRenderScaleFactor();
  if (nextRenderScaleFactor > 0 && prevVisualScale > 0) {
    const minScale = Math.max(getMinScaleForCurrentImage(), getZoomOutMinScaleForCurrentViewport());
    currentScale = clamp(prevVisualScale / nextRenderScaleFactor, minScale, MAX_SCALE);
    zoomTargetScale = clamp(prevVisualTargetScale / nextRenderScaleFactor, minScale, MAX_SCALE);
    renderTransform();
  }
  if (savedPath) {
    void refreshCurrentFileSize(savedPath);
  }
}

function queueFolderSyncAfterSavedImage(path: string, focusThumbnail = false) {
  if (!isTauri() || !isAbsoluteFilePath(path)) return;
  const requestId = ++folderSyncRequestId;
  void (async () => {
    await syncFolderImages(path, requestId);
    if (focusThumbnail && normalizePathForCompare(currentOpenedPath) === normalizePathForCompare(path)) {
      focusActiveThumbnail();
    }
  })();
}

function canPreserveMetadataInBackground(sourcePath: string, targetPath: string): boolean {
  return isTauri() && isAbsoluteFilePath(sourcePath) && isAbsoluteFilePath(targetPath);
}

async function runMetadataPreservationInBackground(
  sourcePath: string,
  targetPath: string,
  tempBackupPath: string | null = null,
) {
  try {
    const result = await invoke<string>("copy_metadata_fast", {
      sourcePath,
      targetPath,
    });
    if (result === "applied") {
      forgetRuntimeImageCache(targetPath);
      if (normalizePathForCompare(currentOpenedPath) === normalizePathForCompare(targetPath)) {
        void refreshCurrentFileSize(targetPath);
      }
    }
  } catch {
    // keep fast-save UX quiet even if metadata copy fails
  } finally {
    if (tempBackupPath) {
      void invoke("remove_temp_file", { path: tempBackupPath }).catch(() => {
        // ignore cleanup failure
      });
    }
  }
}

async function buildEditedCanvasBlobForPath(path: string): Promise<Blob> {
  if (!editCanvasEl) {
    throw new Error("편집 캔버스를 찾을 수 없습니다.");
  }
  const ext = getExt(path) || "png";
  if (!editCanvasSaveExtensions.has(ext)) {
    throw new Error("지원되는 저장 형식은 PNG, JPG, WEBP, AVIF, BMP, TIFF입니다.");
  }
  if (isMagickSaveExt(ext)) {
    throw new Error("BMP/TIFF는 캔버스 인코더 저장을 지원하지 않습니다.");
  }
  renderEditCanvasFromState({ includeSelection: false, includeCropOverlay: false });
  const mimeType = getEditSaveMimeType(ext);
  const quality = getEditEncodeQuality(mimeType);
  const blob = await canvasToBlob(editCanvasEl, mimeType, quality);
  if (!blob) {
    throw new Error("저장할 이미지를 만들지 못했습니다.");
  }
  const actualType = (blob.type || "").toLowerCase();
  if (mimeType !== "image/png" && actualType !== mimeType) {
    throw new Error(`${ext.toUpperCase()} 형식 저장을 지원하지 않습니다. PNG/JPG/WEBP/AVIF로 저장해 주세요.`);
  }
  return blob;
}

async function saveEditedCanvasToPath(
  path: string,
  snapshot?: { width: number; height: number; rgba: Uint8Array },
): Promise<string> {
  if (!isTauri()) {
    throw new Error("데스크톱 앱에서만 파일 저장을 지원합니다.");
  }
  const fallbackExt = getPreferredEditSaveExt();
  const targetPath = ensurePathHasExtension(path, fallbackExt);
  const ext = normalizeEditSaveExt(getExt(targetPath) || fallbackExt);
  if (isMagickSaveExt(ext)) {
    if (!isAbsoluteFilePath(currentOpenedPath)) {
      throw new Error("BMP/TIFF 저장은 로컬 원본 파일에서만 지원됩니다.");
    }
    const payload = snapshot ?? getEditedCanvasRgbaPayload();
    await invoke("save_edited_image_with_magick", {
      sourcePath: currentOpenedPath,
      targetPath,
      width: payload.width,
      height: payload.height,
      rgba: payload.rgba,
    });
    return targetPath;
  }
  if (ext === "avif") {
    try {
      const blob = await buildEditedCanvasBlobForPath(targetPath);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      await invoke("save_image_bytes", { path: targetPath, bytes });
      return targetPath;
    } catch {
      if (!isAbsoluteFilePath(currentOpenedPath)) {
        throw new Error("AVIF 저장은 로컬 원본 파일에서만 지원됩니다.");
      }
      const payload = snapshot ?? getEditedCanvasRgbaPayload();
      await invoke("save_edited_image_with_magick", {
        sourcePath: currentOpenedPath,
        targetPath,
        width: payload.width,
        height: payload.height,
        rgba: payload.rgba,
      });
      return targetPath;
    }
  }

  const blob = await buildEditedCanvasBlobForPath(targetPath);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  await invoke("save_image_bytes", { path: targetPath, bytes });
  return targetPath;
}

async function handleSaveEditedImage() {
  if (!editModalOpen || editSaveInFlight) return;
  if (!isTauri()) {
    await showAppModal({
      title: "이미지 저장",
      message: "데스크톱 앱에서만 저장할 수 있습니다.",
    });
    return;
  }

  if (!isAbsoluteFilePath(currentOpenedPath)) {
    await handleSaveEditedImageAs();
    return;
  }

  try {
    setEditSaveBusy(true);
    const snapshot = getEditedCanvasRgbaPayload();
    const originalPath = currentOpenedPath;
    let metadataBackupPromise: Promise<string | null> | null = null;
    if (canPreserveMetadataInBackground(originalPath, originalPath)) {
      metadataBackupPromise = invoke<string>("create_temp_backup_copy", { path: originalPath })
        .then((value) => (typeof value === "string" && value ? value : null))
        .catch(() => null);
    }
    const savedPath = await saveEditedCanvasToPath(currentOpenedPath, snapshot);
    forgetRuntimeImageCache(savedPath);
    closeEditModal();
    applyEditedSnapshotToViewer(snapshot, savedPath);
    queueFolderSyncAfterSavedImage(savedPath, false);
    if (metadataBackupPromise) {
      void (async () => {
        const backupPath = await metadataBackupPromise!;
        if (!backupPath) return;
        await runMetadataPreservationInBackground(backupPath, savedPath, backupPath);
      })();
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await showAppModal({
      title: "저장 실패",
      message: reason,
    });
  } finally {
    setEditSaveBusy(false);
  }
}

async function handleSaveEditedImageAs() {
  if (!editModalOpen || editSaveInFlight) return;
  if (!isTauri()) {
    await showAppModal({
      title: "이미지 저장",
      message: "데스크톱 앱에서만 저장할 수 있습니다.",
    });
    return;
  }

  const picked = await save({
    defaultPath: getDefaultEditedSavePath(),
    filters: getEditSaveDialogFilters(getPreferredEditSaveExt()),
  });
  if (typeof picked !== "string" || !picked) return;

  try {
    setEditSaveBusy(true);
    const snapshot = getEditedCanvasRgbaPayload();
    const sourceForMetadata = currentOpenedPath;
    const savedPath = await saveEditedCanvasToPath(picked, snapshot);
    forgetRuntimeImageCache(savedPath);
    closeEditModal();
    applyEditedSnapshotToViewer(snapshot, savedPath);
    queueFolderSyncAfterSavedImage(savedPath, true);
    if (canPreserveMetadataInBackground(sourceForMetadata, savedPath)
      && normalizePathForCompare(sourceForMetadata) !== normalizePathForCompare(savedPath)) {
      void runMetadataPreservationInBackground(sourceForMetadata, savedPath);
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await showAppModal({
      title: "새 파일 저장 실패",
      message: reason,
    });
  } finally {
    setEditSaveBusy(false);
  }
}

async function handleSetDesktopWallpaperCurrentImage() {
  if (!isTauri() || !isAbsoluteFilePath(currentOpenedPath)) {
    await showAppModal({
      title: "배경화면",
      message: "로컬 파일만 설정할 수 있습니다.",
    });
    return;
  }
  try {
    await invoke("set_desktop_wallpaper", { path: currentOpenedPath });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await showAppModal({
      title: "배경화면 설정 실패",
      message: reason,
    });
  }
}

async function handleRevealCurrentImageInExplorer() {
  if (!isTauri() || !isAbsoluteFilePath(currentOpenedPath)) {
    await showAppModal({
      title: "파일 탐색기",
      message: "로컬 파일만 열 수 있습니다.",
    });
    return;
  }
  try {
    await invoke("reveal_file_in_explorer", { path: currentOpenedPath });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await showAppModal({
      title: "파일 탐색기 열기 실패",
      message: reason,
    });
  }
}

async function handleCopyCurrentFilePath() {
  if (!currentOpenedPath) return;
  try {
    await navigator.clipboard.writeText(currentOpenedPath);
    showBottomToast("클립보드에 복사되었습니다.");
  } catch {
    await showAppModal({
      title: "경로 복사 실패",
      message: "클립보드 복사를 지원하지 않는 환경입니다.",
    });
  }
}

function logDecodeRoute(route: string, source: string) {
  if (!isTauri()) return;
  void invoke("log_decode_route", { route, source }).catch(() => { });
}

function stepZoom(step: 1 | -1) {
  if (!hasImage) return;
  const minScale = getMinScaleForCurrentImage();
  const baseScale = zoomAnimationId ? zoomTargetScale : currentScale;
  const adaptiveStep = getAdaptiveZoomStep(baseScale);
  const stepped = baseScale + adaptiveStep * step;
  const snapped = snapScaleToStep(stepped);
  animateScaleTo(clamp(snapped, minScale, MAX_SCALE));
}

function stepZoomFast(step: 1 | -1, multiplier = 1) {
  if (!hasImage) return;
  const minScale = getMinScaleForCurrentImage();
  const baseScale = zoomAnimationId ? zoomTargetScale : currentScale;
  const adaptiveStep = getAdaptiveZoomStep(baseScale, multiplier);
  const stepped = baseScale + adaptiveStep * step;
  const snapped = snapScaleToStep(stepped);
  const target = clamp(snapped, minScale, MAX_SCALE);
  // Keep smooth motion while rapidly updating target during key hold.
  animateScaleFollowTo(target);
}

function getAdaptiveZoomStep(baseScale: number, multiplier = 1): number {
  const factor = clamp(baseScale, 1, ADAPTIVE_ZOOM_MAX_FACTOR);
  return ZOOM_STEP * factor * multiplier;
}

function stopKeyHoldZoom() {
  keyHoldZoomDirection = null;
  if (keyHoldZoomStartTimer != null) {
    window.clearTimeout(keyHoldZoomStartTimer);
    keyHoldZoomStartTimer = null;
  }
  if (keyHoldZoomRepeatTimer != null) {
    window.clearInterval(keyHoldZoomRepeatTimer);
    keyHoldZoomRepeatTimer = null;
  }
}

function startKeyHoldZoom(direction: 1 | -1) {
  if (keyHoldZoomDirection === direction) return;
  stopKeyHoldZoom();
  keyHoldZoomDirection = direction;
  keyHoldZoomStartTimer = window.setTimeout(() => {
    if (keyHoldZoomDirection !== direction) return;
    keyHoldZoomRepeatTimer = window.setInterval(() => {
      if (keyHoldZoomDirection !== direction) return;
      stepZoomFast(direction, KEY_HOLD_ZOOM_MULTIPLIER);
    }, KEY_HOLD_ZOOM_REPEAT_MS);
  }, KEY_HOLD_ZOOM_INITIAL_DELAY_MS);
}

function detectTransparencyFromSource(
  source: CanvasImageSource,
  width: number,
  height: number,
  maxSide = ALPHA_SCAN_MAX_SIDE,
  minHits = 1,
  threshold = ALPHA_THRESHOLD,
): boolean {
  const w = Math.max(1, Math.floor(width));
  const h = Math.max(1, Math.floor(height));

  const scale = Math.min(1, maxSide / Math.max(w, h));
  const scanW = Math.max(1, Math.floor(w * scale));
  const scanH = Math.max(1, Math.floor(h * scale));

  const scanCanvas = document.createElement("canvas");
  scanCanvas.width = scanW;
  scanCanvas.height = scanH;
  const scanCtx = scanCanvas.getContext("2d", { alpha: true, willReadFrequently: true });
  if (!scanCtx) return false;

  // Prevent edge interpolation from creating false semi-transparent pixels.
  scanCtx.imageSmoothingEnabled = false;
  scanCtx.clearRect(0, 0, scanW, scanH);
  scanCtx.drawImage(source, 0, 0, scanW, scanH);

  const pixels = scanCtx.getImageData(0, 0, scanW, scanH).data;
  const insetX = scanW > 4 ? 1 : 0;
  const insetY = scanH > 4 ? 1 : 0;
  let hits = 0;
  for (let y = insetY; y < scanH - insetY; y += 1) {
    const row = y * scanW;
    for (let x = insetX; x < scanW - insetX; x += 1) {
      const alpha = pixels[(row + x) * 4 + 3];
      if (alpha < threshold) {
        hits += 1;
        if (hits >= minHits) {
          return true;
        }
      }
    }
  }

  return false;
}

function renderTransform() {
  if (!dropZone || !canvas) return;
  const minScale = getMinScaleForCurrentImage();
  const fitScale = getFitScaleForCurrentViewport();
  lastViewportFitScale = fitScale;
  if (hasImage && currentScale < minScale) {
    currentScale = minScale;
  }
  if (hasImage && zoomTargetScale < minScale) {
    zoomTargetScale = minScale;
  }
  const canDrag = canDragCurrentImage();
  if (!canDrag) {
    offsetX = 0;
    offsetY = 0;
    if (dragging) {
      dragging = false;
      dropZone.classList.remove("is-dragging");
    }
  } else {
    clampPanOffsetToBounds();
  }

  const renderScaleFactor = getRenderScaleFactor();
  const useNativeImage = hasImage && renderMode === "native-image";
  const useSvgWebView = hasImage && renderMode === "webview-svg";
  const visualScale = currentScale * renderScaleFactor;
  const useNativeHdrJpeg = useNativeImage && isJpegFamilyExt(currentImageExt) && currentImageIsHdrJpeg;
  const useNativeJpegProxyCanvas =
    useNativeImage
    && isJpegFamilyExt(currentImageExt)
    && !currentImageIsHdrJpeg
    && visualScale > 1;
  if (useNativeJpegProxyCanvas) {
    ensureNativeImageProxyCanvasForCurrent();
  }
  const applyNativeJpegSeamFix =
    useNativeImage
    && isJpegFamilyExt(currentImageExt)
    && !currentImageIsHdrJpeg
    && currentScale > 1;
  const transformOffsetX = applyNativeJpegSeamFix ? snapToDevicePixel(offsetX) : offsetX;
  const transformOffsetY = applyNativeJpegSeamFix ? snapToDevicePixel(offsetY) : offsetY;
  const visualRotateDeg = getVisualRotationDegForCurrentPath();
  const translateRotateTransform = useNativeHdrJpeg
    ? `translate(calc(-50% + ${transformOffsetX}px), calc(-50% + ${transformOffsetY}px)) rotate(${visualRotateDeg}deg)`
    : `translate3d(calc(-50% + ${transformOffsetX}px), calc(-50% + ${transformOffsetY}px), 0) rotate(${visualRotateDeg}deg)`;
  const scaledTransform = `${translateRotateTransform} scale(${visualScale})`;
  const useCanvasLayer = hasImage && (!useNativeImage || useNativeJpegProxyCanvas) && !useSvgWebView;
  canvas.style.width = `${mediaWidth}px`;
  canvas.style.height = `${mediaHeight}px`;
  canvas.style.transform = scaledTransform;
  if (viewerImage) {
    if (useNativeHdrJpeg) {
      // Reduce compositor seam artifacts on HDR JPEG path.
      viewerImage.style.contain = "none";
      viewerImage.style.willChange = "auto";
      viewerImage.style.backfaceVisibility = "visible";
    } else {
      viewerImage.style.contain = "";
      viewerImage.style.willChange = "";
      viewerImage.style.backfaceVisibility = "";
    }
    if (useNativeImage && !useNativeJpegProxyCanvas) {
      const useLayoutResizeForNative =
        visualScale < 1
        || (currentImageIsHdrJpeg && visualScale > 1);
      if (useLayoutResizeForNative) {
        // Use layout raster path for downscale and HDR-JPEG upscale.
        // This avoids compositor/tile seam artifacts that can appear on transformed HDR JPEG.
        const dpr = Math.max(1, window.devicePixelRatio || 1);
        const scaledWidth = Math.max(1, Math.round(mediaWidth * visualScale * dpr) / dpr);
        const scaledHeight = Math.max(1, Math.round(mediaHeight * visualScale * dpr) / dpr);
        viewerImage.style.width = `${scaledWidth}px`;
        viewerImage.style.height = `${scaledHeight}px`;
        viewerImage.style.transform = translateRotateTransform;
      } else {
        // Keep non-HDR upscale in transform path.
        viewerImage.style.width = "";
        viewerImage.style.height = "";
        viewerImage.style.transform = scaledTransform;
      }
    } else {
      viewerImage.style.width = "";
      viewerImage.style.height = "";
      viewerImage.style.transform = scaledTransform;
    }
  }
  if (viewerSvgFrame) {
    if (useSvgWebView) {
      const scaledWidth = Math.max(1, mediaWidth * visualScale);
      const scaledHeight = Math.max(1, mediaHeight * visualScale);
      viewerSvgFrame.style.width = `${scaledWidth}px`;
      viewerSvgFrame.style.height = `${scaledHeight}px`;
      viewerSvgFrame.style.transform = translateRotateTransform;
    } else {
      viewerSvgFrame.style.transform = scaledTransform;
    }
  }

  dropZone.classList.toggle("is-ready", hasImage);
  dropZone.style.cursor = hasImage ? (canDrag ? "grab" : "default") : "default";
  canvas.style.display = useCanvasLayer ? "block" : "none";
  if (viewerImage) {
    viewerImage.style.display = useNativeImage && !useNativeJpegProxyCanvas ? "block" : "none";
  }
  if (viewerSvgFrame) {
    viewerSvgFrame.style.display = useSvgWebView ? "block" : "none";
  }
  syncStageBackgroundClass();
  updateStatus();
  maybeQueueVectorRedecodeForZoom();
}

function formatByteSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "-";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(index === 0 ? 0 : 2)} ${units[index]}`;
}

function updateTitlebarMeta() {
  if (!fileMetaEl) return;
  if (!hasImage) {
    fileMetaEl.textContent = "";
    return;
  }
  const ext = (currentImageExt || "-").toUpperCase();
  const resW = originalMediaWidth > 0 ? originalMediaWidth : Math.max(1, Math.round(mediaWidth));
  const resH = originalMediaHeight > 0 ? originalMediaHeight : Math.max(1, Math.round(mediaHeight));
  const resolution = `${resW} x ${resH}`;
  const fileSize = currentFileSizeBytes == null ? "-" : formatByteSize(currentFileSizeBytes);
  fileMetaEl.textContent = `포맷 ${ext} · 해상도 ${resolution} · 용량 ${fileSize}`;
}

function syncResolutionUi(force = false) {
  const width = Math.max(1, Math.round(mediaWidth));
  const height = Math.max(1, Math.round(mediaHeight));
  if (!force && width === lastStatusResolutionWidth && height === lastStatusResolutionHeight) {
    return;
  }
  lastStatusResolutionWidth = width;
  lastStatusResolutionHeight = height;
  if (hasImage) {
    updateStatus();
  }
  if (metaPanelVisible) {
    setMetaPanelBaseFields();
  }
}

function formatUnixMs(unixMs: number | null): string {
  if (unixMs == null || !Number.isFinite(unixMs)) return "-";
  const d = new Date(unixMs);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("ko-KR");
}

function setMetaText(el: HTMLElement | null, value: string) {
  if (!el) return;
  el.textContent = value;
}

function renderExifDetails(items: ExifDetailPayload[]) {
  if (!metaDetailsListEl) return;
  metaDetailsListEl.innerHTML = "";
  if (items.length <= 0) {
    const dt = document.createElement("dt");
    dt.textContent = "항목";
    const dd = document.createElement("dd");
    dd.textContent = "표시할 상세 속성이 없습니다.";
    metaDetailsListEl.append(dt, dd);
    return;
  }

  const frag = document.createDocumentFragment();
  for (const item of items) {
    const name = item.propertyName?.trim();
    const value = normalizeExifDisplayValue(item.value);
    if (!name || !value) continue;
    if (shouldHideExifDetail(name)) continue;
    const dt = document.createElement("dt");
    dt.textContent = localizeExifPropertyName(name);
    const dd = document.createElement("dd");
    dd.textContent = value;
    frag.append(dt, dd);
  }
  if (!frag.childNodes.length) {
    const dt = document.createElement("dt");
    dt.textContent = "항목";
    const dd = document.createElement("dd");
    dd.textContent = "표시할 상세 속성이 없습니다.";
    metaDetailsListEl.append(dt, dd);
    return;
  }
  metaDetailsListEl.append(frag);
}

function shouldHideExifDetail(propertyName: string): boolean {
  if (currentImageExt !== "dng") return false;
  return /:Tag\(Tiff,\s*\d+\)$/i.test(propertyName.trim());
}

function localizeExifPropertyName(raw: string): string {
  if (!raw) return "-";
  const idx = raw.indexOf(":");
  if (idx < 0) {
    return EXIF_TAG_KO[raw] ?? raw;
  }
  const ifdRaw = raw.slice(0, idx);
  const tag = raw.slice(idx + 1);
  const tagKo = EXIF_TAG_KO[tag] ?? tag;
  void ifdRaw;
  return tagKo;
}

function normalizeExifDisplayValue(raw: string | null | undefined): string {
  const value = (raw ?? "").trim();
  if (value.length >= 2) {
    if (value.startsWith("\"") && value.endsWith("\"")) {
      return value.slice(1, -1).trim();
    }
    if (value.startsWith("'") && value.endsWith("'")) {
      return value.slice(1, -1).trim();
    }
  }
  return value;
}

function setMetaPanelVisibility(visible: boolean) {
  metaPanelVisible = visible;
  if (metaPanelEl) {
    metaPanelEl.setAttribute("aria-hidden", visible ? "false" : "true");
  }
  if (viewerLayoutEl) {
    viewerLayoutEl.classList.toggle("show-meta-panel", visible);
  }
  if (metaBtn) {
    metaBtn.setAttribute("aria-pressed", visible ? "true" : "false");
  }
  if (hasImage) {
    handleViewportResize();
    renderTransform();
  }
}

function setMetaPanelBaseFields() {
  setMetaText(metaFileNameEl, currentFileName || "-");
  setMetaText(metaExtensionEl, currentImageExt || "-");
  const resW = originalMediaWidth > 0 ? originalMediaWidth : Math.max(1, Math.round(mediaWidth));
  const resH = originalMediaHeight > 0 ? originalMediaHeight : Math.max(1, Math.round(mediaHeight));
  setMetaText(metaResolutionEl, `${resW} x ${resH}`);
}

async function refreshMetadataPanel() {
  if (!metaPanelVisible || !hasImage) return;

  const requestId = ++metaPanelRequestId;
  setMetaPanelBaseFields();
  setMetaText(metaSizeEl, "-");
  setMetaText(metaModifiedEl, "-");
  setMetaText(metaCreatedEl, "-");
  setMetaText(metaReadonlyEl, "-");
  setMetaText(metaPathEl, currentOpenedPath || "-");
  renderExifDetails([]);

  if (!isTauri() || !isAbsoluteFilePath(currentOpenedPath)) {
    setMetaText(metaStatusEl, "로컬 파일 경로가 없어 기본 정보만 표시합니다.");
    return;
  }

  setMetaText(metaStatusEl, "메타데이터 조회 중...");
  try {
    const [metaResult, detailResult] = await Promise.allSettled([
      invoke<ImageMetadataPayload>("get_image_metadata", { path: currentOpenedPath }),
      invoke<ExifDetailPayload[]>("get_exif_details", { path: currentOpenedPath }),
    ]);
    if (requestId !== metaPanelRequestId) return;
    if (metaResult.status === "fulfilled") {
      const meta = metaResult.value;
      setMetaText(metaSizeEl, `${formatByteSize(meta.fileSizeBytes)} (${meta.fileSizeBytes.toLocaleString("ko-KR")} bytes)`);
      setMetaText(metaModifiedEl, formatUnixMs(meta.modifiedUnixMs));
      setMetaText(metaCreatedEl, formatUnixMs(meta.createdUnixMs));
      setMetaText(metaReadonlyEl, meta.readonly ? "예" : "아니오");
      setMetaText(metaPathEl, meta.path || "-");
    } else {
      setMetaText(metaStatusEl, `기본 메타데이터 실패: ${String(metaResult.reason)}`);
    }

    if (detailResult.status === "fulfilled") {
      renderExifDetails(detailResult.value);
    } else {
      renderExifDetails([]);
      if (metaResult.status === "fulfilled") {
        setMetaText(metaStatusEl, `EXIF 상세 실패: ${String(detailResult.reason)}`);
      }
    }

    if (metaResult.status === "fulfilled" && detailResult.status === "fulfilled") {
      setMetaText(metaStatusEl, "정상");
    }
  } catch (error) {
    if (requestId !== metaPanelRequestId) return;
    const reason = error instanceof Error ? error.message : String(error);
    setMetaText(metaStatusEl, `조회 실패: ${reason}`);
  }
}

async function refreshCurrentFileSize(path: string) {
  if (!isTauri() || !isAbsoluteFilePath(path)) {
    currentFileSizeBytes = null;
    updateTitlebarMeta();
    return;
  }
  const requestId = ++fileSizeRequestId;
  try {
    const meta = await invoke<ImageMetadataPayload>("get_image_metadata", { path });
    if (requestId !== fileSizeRequestId) return;
    if (normalizePathForCompare(path) !== normalizePathForCompare(currentOpenedPath)) return;
    currentFileSizeBytes = meta.fileSizeBytes;
  } catch {
    if (requestId !== fileSizeRequestId) return;
    currentFileSizeBytes = null;
  }
  updateTitlebarMeta();
}

function toggleMetadataPanel() {
  if (!hasImage) return;
  const nextVisible = !metaPanelVisible;
  setMetaPanelVisibility(nextVisible);
  if (nextVisible) {
    void refreshMetadataPanel();
  }
}

function stopZoomAnimation() {
  if (zoomAnimationId) {
    cancelAnimationFrame(zoomAnimationId);
    zoomAnimationId = 0;
  }
  zoomAnimationMode = "none";
  zoomFollowAnchor = null;
}

function snapScaleToStep(scale: number): number {
  return Math.round(scale / ZOOM_STEP) * ZOOM_STEP;
}

function animateScaleTo(scale: number, anchor: ZoomAnchor | null = null) {
  stopZoomAnimation();
  zoomAnimationMode = "tween";
  const startScale = currentScale;
  const targetScale = scale;
  zoomTargetScale = targetScale;
  const distance = Math.abs(targetScale - startScale);
  const duration = Math.min(
    ZOOM_ANIMATION_MAX_MS,
    ZOOM_ANIMATION_BASE_MS + distance * 180,
  );
  let startAt = 0;

  const tick = (now: number) => {
    if (startAt === 0) startAt = now;
    const t = clamp((now - startAt) / duration, 0, 1);
    const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    currentScale = startScale + (targetScale - startScale) * eased;
    if (anchor) {
      applyZoomAnchor(anchor, currentScale);
    }

    if (t >= 1) {
      currentScale = targetScale;
      if (anchor) {
        applyZoomAnchor(anchor, currentScale);
      }
      zoomAnimationId = 0;
      zoomAnimationMode = "none";
      renderTransform();
      return;
    }

    renderTransform();
    zoomAnimationId = requestAnimationFrame(tick);
  };

  zoomAnimationId = requestAnimationFrame(tick);
}

function animateViewTo(scale: number, targetOffsetX: number, targetOffsetY: number) {
  stopZoomAnimation();
  zoomAnimationMode = "tween";
  const startScale = currentScale;
  const startOffsetX = offsetX;
  const startOffsetY = offsetY;
  const targetScale = scale;
  zoomTargetScale = targetScale;
  const distance = Math.abs(targetScale - startScale);
  const duration = Math.min(
    ZOOM_ANIMATION_MAX_MS,
    ZOOM_ANIMATION_BASE_MS + distance * 180,
  );
  let startAt = 0;

  const tick = (now: number) => {
    if (startAt === 0) startAt = now;
    const t = clamp((now - startAt) / duration, 0, 1);
    const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    currentScale = startScale + (targetScale - startScale) * eased;
    offsetX = startOffsetX + (targetOffsetX - startOffsetX) * eased;
    offsetY = startOffsetY + (targetOffsetY - startOffsetY) * eased;

    if (t >= 1) {
      currentScale = targetScale;
      offsetX = targetOffsetX;
      offsetY = targetOffsetY;
      zoomAnimationId = 0;
      zoomAnimationMode = "none";
      renderTransform();
      return;
    }

    renderTransform();
    zoomAnimationId = requestAnimationFrame(tick);
  };

  zoomAnimationId = requestAnimationFrame(tick);
}

function animateScaleFollowTo(scale: number, anchor: ZoomAnchor | null = null) {
  zoomTargetScale = scale;
  if (anchor) {
    zoomFollowAnchor = anchor;
  }
  if (zoomAnimationMode === "follow" && zoomAnimationId) return;

  stopZoomAnimation();
  zoomAnimationMode = "follow";
  zoomFollowAnchor = anchor;
  let last = performance.now();

  const tick = (now: number) => {
    const dt = Math.min(64, now - last);
    last = now;
    const alpha = 1 - Math.pow(1 - ZOOM_FOLLOW_STIFFNESS, dt / 16.667);
    currentScale += (zoomTargetScale - currentScale) * alpha;
    if (zoomFollowAnchor) {
      applyZoomAnchor(zoomFollowAnchor, currentScale);
    }

    if (Math.abs(zoomTargetScale - currentScale) < 0.0008) {
      currentScale = zoomTargetScale;
      if (zoomFollowAnchor) {
        applyZoomAnchor(zoomFollowAnchor, currentScale);
      }
      zoomAnimationId = 0;
      zoomAnimationMode = "none";
      zoomFollowAnchor = null;
      renderTransform();
      return;
    }

    renderTransform();
    zoomAnimationId = requestAnimationFrame(tick);
  };

  zoomAnimationId = requestAnimationFrame(tick);
}

function createZoomAnchor(clientX: number, clientY: number): ZoomAnchor | null {
  if (!dropZone || !hasImage) return null;
  const rect = dropZone.getBoundingClientRect();
  const totalScale = currentScale * getRenderScaleFactor();
  if (totalScale <= 0) return null;

  const cx = clientX - rect.left - rect.width * 0.5;
  const cy = clientY - rect.top - rect.height * 0.5;
  const localX = (cx - offsetX) / totalScale;
  const localY = (cy - offsetY) / totalScale;
  return { cx, cy, localX, localY };
}

function createViewportCenterZoomAnchor(): ZoomAnchor | null {
  if (!dropZone || !hasImage) return null;
  const rect = dropZone.getBoundingClientRect();
  return createZoomAnchor(rect.left + rect.width * 0.5, rect.top + rect.height * 0.5);
}

function applyZoomAnchor(anchor: ZoomAnchor, scale: number) {
  const totalScale = scale * getRenderScaleFactor();
  offsetX = anchor.cx - anchor.localX * totalScale;
  offsetY = anchor.cy - anchor.localY * totalScale;
}

function getRenderScaleFactor(): number {
  const pixelPerfect = renderMode === "native-image" || renderMode === "webview-svg"
    ? 1
    : getPixelPerfectScale();
  if (renderMode === "vips" && currentImageIsVectorStatic) {
    return contentDisplayScale;
  }
  return pixelPerfect * contentDisplayScale;
}

function computeVectorTargetDpiForScale(scale: number): number {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const desired = Math.ceil(VECTOR_BASE_DPI * Math.max(1, scale) * dpr);
  return clamp(desired, VECTOR_BASE_DPI, VECTOR_MAX_DPI);
}

function getVectorInitialDpi(): number {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  return clamp(Math.ceil(VECTOR_BASE_DPI * dpr), VECTOR_BASE_DPI, VECTOR_MAX_DPI);
}

function maybeQueueVectorRedecodeForZoom() {
  if (!ENABLE_VECTOR_REDECODE) return;
  if (!hasImage || renderMode !== "vips" || !currentImageIsVectorStatic) return;
  if (!isTauri() || !isAbsoluteFilePath(currentImagePathForDecode)) return;

  const desiredDpi = computeVectorTargetDpiForScale(currentScale);
  if (desiredDpi <= currentVectorDpi + 8) return;

  if (vectorRedecodeInFlight) {
    vectorRedecodeQueuedDpi = Math.max(vectorRedecodeQueuedDpi, desiredDpi);
    return;
  }

  void runVectorRedecode(desiredDpi);
}

async function runVectorRedecode(requestDpi: number) {
  if (!currentImageIsVectorStatic || renderMode !== "vips") return;
  if (!isTauri() || !isAbsoluteFilePath(currentImagePathForDecode)) return;
  if (!currentImageExt || !vectorStaticExtensions.has(currentImageExt)) return;

  const targetDpi = clamp(requestDpi, VECTOR_BASE_DPI, VECTOR_MAX_DPI);
  if (targetDpi <= currentVectorDpi + 8) return;

  vectorRedecodeInFlight = true;
  vectorRedecodeQueuedDpi = Math.max(vectorRedecodeQueuedDpi, targetDpi);
  try {
    await tryDecodeWithMagick(currentImagePathForDecode, currentImageExt, currentImagePathForDecode, {
      renderDpi: targetDpi,
      resetView: false,
    });
  } catch {
    // Keep current frame when high-DPI re-decode fails.
  } finally {
    vectorRedecodeInFlight = false;
    const nextDpi = vectorRedecodeQueuedDpi;
    if (nextDpi > currentVectorDpi + 8) {
      vectorRedecodeQueuedDpi = currentVectorDpi;
      void runVectorRedecode(nextDpi);
    }
  }
}

function canDragCurrentImage(): boolean {
  if (!dropZone || !hasImage) return false;
  const rect = dropZone.getBoundingClientRect();
  const renderScaleFactor = getRenderScaleFactor();
  const { width, height } = getEffectiveMediaSize();
  const renderWidth = width * currentScale * renderScaleFactor;
  const renderHeight = height * currentScale * renderScaleFactor;
  return renderWidth > rect.width + 0.5 || renderHeight > rect.height + 0.5;
}

function clampPanOffsetToBounds() {
  if (!dropZone || !hasImage) return;
  const rect = dropZone.getBoundingClientRect();
  const renderScaleFactor = getRenderScaleFactor();
  const { width, height } = getEffectiveMediaSize();
  const renderWidth = width * currentScale * renderScaleFactor;
  const renderHeight = height * currentScale * renderScaleFactor;

  const maxOffsetX = Math.max(0, (renderWidth - rect.width) * 0.5);
  const maxOffsetY = Math.max(0, (renderHeight - rect.height) * 0.5);

  offsetX = clamp(offsetX, -maxOffsetX, maxOffsetX);
  offsetY = clamp(offsetY, -maxOffsetY, maxOffsetY);
}

function getFitScaleForCurrentViewport(): number {
  if (!dropZone || !hasImage) return 1;
  const rect = dropZone.getBoundingClientRect();
  const renderScaleFactor = getRenderScaleFactor();
  const { width, height } = getEffectiveMediaSize();
  const fitScale = Math.min(
    rect.width / Math.max(1, width * renderScaleFactor),
    rect.height / Math.max(1, height * renderScaleFactor),
  );
  return Math.max(fitScale, 0);
}

function getZoomOutMinScaleForCurrentViewport(): number {
  const fitScale = getFitScaleForCurrentViewport();
  return clamp(fitScale >= 1 ? 1 : fitScale, MIN_SCALE, MAX_SCALE);
}

function getMinScaleForCurrentImage(): number {
  if (!hasImage) return MIN_SCALE;
  return clamp(MIN_SCALE, MIN_SCALE, MAX_SCALE);
}

function getPixelPerfectScale(): number {
  const dpr = window.devicePixelRatio || 1;
  if (!Number.isFinite(dpr) || dpr <= 0) return 1;
  return 1 / dpr;
}

function snapToDevicePixel(value: number): number {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  return Math.round(value * dpr) / dpr;
}

function ensureNativeImageProxyCanvasForCurrent(): boolean {
  if (!canvas || !viewerImage || !viewerImage.complete) return false;
  const src = viewerImage.currentSrc || viewerImage.src;
  if (!src) return false;

  const width = Math.max(1, Math.floor(mediaWidth));
  const height = Math.max(1, Math.floor(mediaHeight));
  const key = `${src}|${width}x${height}`;
  if (
    nativeImageProxyCanvasSourceKey === key
    && canvas.width === width
    && canvas.height === height
  ) {
    return true;
  }

  if (canvas.width !== width || canvas.height !== height) {
    initCanvasSize(width, height);
  }

  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) return false;
  ctx.clearRect(0, 0, width, height);
  try {
    ctx.drawImage(viewerImage, 0, 0, width, height);
  } catch {
    return false;
  }

  nativeImageProxyCanvasSourceKey = key;
  return true;
}

function handleDevicePixelRatioMaybeChanged() {
  const next = window.devicePixelRatio || 1;
  if (Math.abs(next - lastDevicePixelRatio) < 0.001) return;
  lastDevicePixelRatio = next;
  if (hasImage) {
    renderTransform();
  }
  registerDevicePixelRatioWatcher();
}

function handleViewportResize() {
  handleDevicePixelRatioMaybeChanged();
  if (editModalOpen) {
    return;
  }
  if (hasImage) {
    const prevFitScale = lastViewportFitScale;
    const nextFitScale = getFitScaleForCurrentViewport();
    const nextMinScale = getMinScaleForCurrentImage();
    const referenceScale = zoomAnimationId ? zoomTargetScale : currentScale;
    const fitTolerance = Math.max(0.001, prevFitScale * 0.02);
    const wasAtFitScale =
      Math.abs(referenceScale - prevFitScale) <= fitTolerance;

    if (wasAtFitScale) {
      const clampedFit = clamp(nextFitScale, MIN_SCALE, MAX_SCALE);
      stopZoomAnimation();
      currentScale = clampedFit;
      zoomTargetScale = clampedFit;
      offsetX = 0;
      offsetY = 0;
      renderTransform();
      return;
    }

    if (currentScale < nextMinScale) {
      stopZoomAnimation();
      currentScale = nextMinScale;
      zoomTargetScale = nextMinScale;
    }

    renderTransform();
  }
}

function registerDevicePixelRatioWatcher() {
  if (dprMediaQuery && dprMediaQueryListener) {
    dprMediaQuery.removeEventListener("change", dprMediaQueryListener);
  }
  const current = window.devicePixelRatio || 1;
  dprMediaQuery = window.matchMedia(`(resolution: ${current}dppx)`);
  dprMediaQueryListener = () => {
    handleDevicePixelRatioMaybeChanged();
  };
  dprMediaQuery.addEventListener("change", dprMediaQueryListener);
}

function fitImageToViewport(animate = true, allowUpscale = true) {
  if (!dropZone || !hasImage) return;
  const isFs = document.body.classList.contains("is-fullscreen");
  const upscale = allowUpscale || (isFs && fullscreenFillMode);
  const fitScale = getFitScaleForCurrentViewport();
  const targetScale = upscale ? fitScale : Math.min(fitScale, 1);
  const clamped = clamp(targetScale, MIN_SCALE, MAX_SCALE);
  if (animate) {
    animateViewTo(clamped, 0, 0);
  } else {
    offsetX = 0;
    offsetY = 0;
    stopZoomAnimation();
    currentScale = clamped;
    zoomTargetScale = clamped;
    renderTransform();
  }
}

function resetScale() {
  const minScale = getMinScaleForCurrentImage();
  animateViewTo(clamp(1, minScale, MAX_SCALE), 0, 0);
}

function toggleDoubleClickZoom() {
  if (!hasImage) return;
  const fitScale = clamp(getFitScaleForCurrentViewport(), MIN_SCALE, MAX_SCALE);
  const minScale = getMinScaleForCurrentImage();
  const originalScale = clamp(1, minScale, MAX_SCALE);
  const baseScale = zoomAnimationId ? zoomTargetScale : currentScale;
  const tolerance = Math.max(0.001, fitScale * 0.02);
  const isNearFit = Math.abs(baseScale - fitScale) <= tolerance;
  if (isNearFit) {
    animateViewTo(originalScale, 0, 0);
    return;
  }
  animateViewTo(fitScale, 0, 0);
}

function setFullscreenButtonLabel(isFullscreen: boolean) {
  const label = isFullscreen ? "전체화면 해제" : "전체화면";
  if (fullscreenBtnLabelEl) {
    fullscreenBtnLabelEl.textContent = label;
  }
  if (fullscreenBtn) {
    fullscreenBtn.setAttribute("aria-label", label);
  }
}

function toImageSrc(path: string): string {
  if (
    path.startsWith("http://") ||
    path.startsWith("https://") ||
    path.startsWith("blob:") ||
    path.startsWith("data:")
  ) {
    return path;
  }

  if (isAbsoluteFilePath(path)) {
    try {
      return convertFileSrc(path);
    } catch {
      return path.replace(/\\/g, "/");
    }
  }

  return path;
}

function stopPlaybackLoop() {
  playingToken += 1;
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
  frameDecodeInFlight = false;
  nextFrameAt = 0;
  for (const frame of prefetchedFrames) {
    try {
      frame.image.close();
    } catch {
      // no-op
    }
  }
  prefetchedFrames = [];
}

function stopPlayback() {
  stopPlaybackLoop();
  nextDecodeFrameIndex = 0;
  decodedFrameCount = 1;
  currentFrameIndex = 0;
  playbackPaused = false;
  currentFrameSequencePlayable = false;
  animationLoopLimit = null;
  completedAnimationLoops = 0;
  playbackStoppedByLoopLimit = false;
  frameSeekRequestId += 1;
  currentPrefetchQueueTarget = PREFETCH_QUEUE_TARGET;
  updateAnimControlsUi();

  if (currentDecoder) {
    try {
      currentDecoder.close();
    } catch {
      // ignore close failure
    }
    currentDecoder = null;
  }
}

function pausePlayback() {
  if (decodedFrameCount <= 1 || playbackPaused) return;
  playbackPaused = true;
  stopPlaybackLoop();
  updateAnimControlsUi();
}

async function resumePlayback() {
  if (decodedFrameCount <= 1) return;
  if (!currentDecoder || !playbackPaused) return;
  if (playbackStoppedByLoopLimit) {
    completedAnimationLoops = 0;
    playbackStoppedByLoopLimit = false;
    await showFrameAt(0);
  }
  playbackPaused = false;
  const token = ++playingToken;
  nextFrameAt = performance.now();
  prefetchNextFrame(token);
  scheduleTick(token);
  updateAnimControlsUi();
}

async function showFrameAt(frameIndex: number, resumeIfPlaying = false): Promise<void> {
  if (decodedFrameCount <= 1) return;
  const clamped = ((Math.floor(frameIndex) % decodedFrameCount) + decodedFrameCount) % decodedFrameCount;
  if (!currentDecoder) return;
  const seekId = ++frameSeekRequestId;
  const wasPlaying = !playbackPaused;
  pausePlayback();
  const decoderRef = currentDecoder;
  try {
    const decodeResult = await decoderRef.decode({ frameIndex: clamped });
    if (seekId !== frameSeekRequestId || currentDecoder !== decoderRef) {
      decodeResult.image.close();
      return;
    }
    await drawDecodedFrame(decodeResult);
    currentFrameIndex = clamped;
    nextDecodeFrameIndex = (clamped + 1) % decodedFrameCount;
    updateAnimControlsUi();
  } catch {
    // ignore seek failure
  } finally {
    if (
      resumeIfPlaying &&
      wasPlaying &&
      playbackPaused &&
      !playbackStoppedByLoopLimit &&
      currentDecoder === decoderRef
    ) {
      await resumePlayback();
    }
  }
}

function togglePlayback() {
  if (playbackPaused) {
    void resumePlayback();
  } else {
    pausePlayback();
  }
}

function shouldStopAtLoopBoundary(nextFrameIndex: number): boolean {
  if (animationLoopLimit == null) return false;
  if (decodedFrameCount <= 1) return false;
  const willWrap = currentFrameIndex === decodedFrameCount - 1 && nextFrameIndex === 0;
  if (!willWrap) return false;
  return completedAnimationLoops + 1 >= animationLoopLimit;
}

function recordLoopBoundary(nextFrameIndex: number) {
  if (decodedFrameCount <= 1) return;
  if (currentFrameIndex === decodedFrameCount - 1 && nextFrameIndex === 0) {
    completedAnimationLoops += 1;
  }
}

function mimeFromExt(ext: string): string {
  switch (ext) {
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "png":
    case "apng":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "bmp":
      return "image/bmp";
    case "tif":
    case "tiff":
      return "image/tiff";
    case "ico":
      return "image/x-icon";
    case "svg":
      return "image/svg+xml";
    case "avif":
      return "image/avif";
    default:
      return "application/octet-stream";
  }
}

function initCanvasSize(width: number, height: number) {
  if (!canvas) return;
  canvas.width = Math.max(1, Math.floor(width));
  canvas.height = Math.max(1, Math.floor(height));
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  mediaWidth = width;
  mediaHeight = height;
}

async function drawDecodedFrame(decodeResult: any): Promise<number> {
  if (!canvas) return 16;
  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) return 16;

  const frame = decodeResult.image;
  const durationUs = typeof frame.duration === "number" ? frame.duration : 16_000;
  const durationMs = Math.max(MIN_FRAME_MS, Math.round(durationUs / 1000));
  const frameWidth = Math.max(1, Math.floor(Number(frame.displayWidth ?? frame.width ?? canvas.width ?? 1)));
  const frameHeight = Math.max(1, Math.floor(Number(frame.displayHeight ?? frame.height ?? canvas.height ?? 1)));

  const resized = canvas.width !== frameWidth || canvas.height !== frameHeight;
  if (resized) {
    initCanvasSize(frameWidth, frameHeight);
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(frame, 0, 0, canvas.width, canvas.height);
  if (typeof frame.close === "function") {
    frame.close();
  }
  if (resized) {
    syncResolutionUi();
  }

  return durationMs;
}

async function drawFrameImage(frame: any): Promise<number> {
  if (!canvas) return 16;
  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) return 16;

  const durationUs = typeof frame.duration === "number" ? frame.duration : 16_000;
  const durationMs = Math.max(MIN_FRAME_MS, Math.round(durationUs / 1000));
  const frameWidth = Math.max(1, Math.floor(Number(frame.displayWidth ?? frame.width ?? canvas.width ?? 1)));
  const frameHeight = Math.max(1, Math.floor(Number(frame.displayHeight ?? frame.height ?? canvas.height ?? 1)));

  const resized = canvas.width !== frameWidth || canvas.height !== frameHeight;
  if (resized) {
    initCanvasSize(frameWidth, frameHeight);
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(frame, 0, 0, canvas.width, canvas.height);
  if (typeof frame.close === "function") {
    frame.close();
  }
  if (resized) {
    syncResolutionUi();
  }

  return durationMs;
}

function prefetchNextFrame(token: number) {
  if (token !== playingToken || !currentDecoder || decodedFrameCount <= 1) return;
  if (frameDecodeInFlight || prefetchedFrames.length >= currentPrefetchQueueTarget) return;

  frameDecodeInFlight = true;
  const decodeIndex = nextDecodeFrameIndex;
  nextDecodeFrameIndex = (nextDecodeFrameIndex + 1) % decodedFrameCount;

  void currentDecoder
    .decode({ frameIndex: decodeIndex })
    .then((decodeResult: any) => {
      if (token !== playingToken) {
        decodeResult.image.close();
        return;
      }
      const frame = decodeResult.image;
      const durationUs = typeof frame.duration === "number" ? frame.duration : 16_000;
      const durationMs = Math.max(MIN_FRAME_MS, Math.round(durationUs / 1000));
      prefetchedFrames.push({ image: frame, durationMs, frameIndex: decodeIndex });
    })
    .catch(() => {
      nextDecodeFrameIndex = decodeIndex;
    })
    .finally(() => {
      frameDecodeInFlight = false;
      if (token === playingToken) {
        prefetchNextFrame(token);
      }
    });
}

function scheduleTick(token: number) {
  rafId = requestAnimationFrame((now) => {
    void playbackTick(now, token);
  });
}

async function playbackTick(now: number, token: number): Promise<void> {
  if (token !== playingToken || !currentDecoder || playbackPaused) return;

  if (nextFrameAt === 0) {
    nextFrameAt = now;
  }
  prefetchNextFrame(token);

  if (now < nextFrameAt) {
    scheduleTick(token);
    return;
  }

  let frameDuration = 16;
  let inlineDecode = false;
  try {
    if (prefetchedFrames.length > 0) {
      const prefetched = prefetchedFrames.shift()!;
      if (shouldStopAtLoopBoundary(prefetched.frameIndex)) {
        try {
          prefetched.image.close();
        } catch {
          // ignore close failure
        }
        playbackPaused = true;
        playbackStoppedByLoopLimit = true;
        stopPlaybackLoop();
        updateAnimControlsUi();
        return;
      }
      frameDuration = await drawFrameImage(prefetched.image);
      recordLoopBoundary(prefetched.frameIndex);
      currentFrameIndex = prefetched.frameIndex;
      updateAnimControlsUi();
    } else if (!frameDecodeInFlight && decodedFrameCount > 1) {
      inlineDecode = true;
      frameDecodeInFlight = true;
      const decodeIndex = nextDecodeFrameIndex;
      if (shouldStopAtLoopBoundary(decodeIndex)) {
        frameDecodeInFlight = false;
        playbackPaused = true;
        playbackStoppedByLoopLimit = true;
        stopPlaybackLoop();
        updateAnimControlsUi();
        return;
      }
      nextDecodeFrameIndex = (nextDecodeFrameIndex + 1) % decodedFrameCount;
      const decodeResult = await currentDecoder.decode({ frameIndex: decodeIndex });
      if (token !== playingToken) {
        decodeResult.image.close();
        return;
      }
      frameDuration = await drawDecodedFrame(decodeResult);
      recordLoopBoundary(decodeIndex);
      currentFrameIndex = decodeIndex;
      updateAnimControlsUi();
    }

    const target = nextFrameAt + frameDuration;
    nextFrameAt = target < now - 120 ? now + frameDuration : target;
  } catch {
    // When decode fails, keep app responsive and retry next frame.
    nextFrameAt = now + 16;
  } finally {
    if (inlineDecode) {
      frameDecodeInFlight = false;
    }
  }

  prefetchNextFrame(token);
  scheduleTick(token);
}

async function tryDecodeAnimated(
  src: string,
  ext: string,
  displayName: string,
  expectedBytes: number | null,
): Promise<boolean> {
  const DecoderCtor = (window as any).ImageDecoder;
  if (!DecoderCtor || !canvas) {
    console.warn("[tryDecodeAnimated] ImageDecoder not available, DecoderCtor=", !!DecoderCtor, "canvas=", !!canvas);
    return false;
  }

  try {
    setLoading(true, "로딩 중...");
    const data = await fetchArrayBufferWithProgress(src, expectedBytes, () => { });
    setLoading(true, "로딩 중...");
    const decoder = new DecoderCtor({
      data,
      type: mimeFromExt(ext),
      preferAnimation: true,
    });
    setLoading(true, "로딩 중...");

    if (decoder.tracks?.ready) {
      await decoder.tracks.ready;
    }
    setLoading(true, "로딩 중...");

    const selected = decoder.tracks?.selectedTrack;
    const count = selected?.frameCount ?? 1;
    const animatedFlag = (selected as { animated?: boolean } | undefined)?.animated;
    const isAnimatedTrack = animatedFlag ?? count > 1;
    // Wide-gamut / HDR-capable formats (AVIF, HEIC, HEIF) must be decoded here even when
    // single-frame so that the browser's built-in color management applies correctly
    // (PQ → SDR tone mapping, BT.2020 → sRGB primaries, etc.).  Falling back to
    // ImageMagick for these formats produces washed-out results because ImageMagick
    // does not implement the PQ transfer function or HDR→SDR tone mapping.
    const useNativeForSingleFrame = ["avif", "heic", "heif"].includes(ext);
    if ((!isAnimatedTrack || count <= 1) && !useNativeForSingleFrame) {
      try {
        decoder.close();
      } catch {
        // ignore close failure
      }
      return false;
    }
    const rawRepetition = Number((selected as any)?.repetitionCount);
    const finiteRepetition = Number.isFinite(rawRepetition) ? Math.floor(rawRepetition) : NaN;
    // GIF/WebP metadata usually uses 0 as infinite loop.
    const detectedLoopLimit =
      Number.isFinite(finiteRepetition) && finiteRepetition > 0
        ? finiteRepetition + 1
        : null;
    let decodedUnits = 0;

    setLoading(true, "로딩 중...");
    const first = await decoder.decode({ frameIndex: 0 });
    const firstFrame = first.image;
    const w = firstFrame.displayWidth || 1;
    const h = firstFrame.displayHeight || 1;
    const estimatedFrameBytes = estimateFrameBytes(w, h);
    const queueTarget = computePrefetchQueueTarget(ext, estimatedFrameBytes, count, expectedBytes);
    // Keep open latency low: only warm up one extra frame when queue is small/light.
    const warmupTarget = Math.max(1, Math.min(Math.max(1, count), 1 + (queueTarget >= 2 ? 1 : 0)));

    initCanvasSize(w, h);
    setStageAlphaGrid(detectTransparencyFromSource(firstFrame, w, h));
    await drawDecodedFrame(first);
    decodedUnits += 1;
    setLoading(true, "로딩 중...");

    stopPlayback();
    currentDecoder = decoder;
    decodedFrameCount = Math.max(1, count);
    currentFrameIndex = 0;
    playbackPaused = false;
    currentFrameSequencePlayable = decodedFrameCount > 1;
    animationLoopLimit = detectedLoopLimit;
    completedAnimationLoops = 0;
    playbackStoppedByLoopLimit = false;
    currentPrefetchQueueTarget = queueTarget;
    nextDecodeFrameIndex = decodedFrameCount > 1 ? 1 : 0;
    prefetchedFrames = [];
    updateAnimControlsUi();

    while (decodedFrameCount > 1 && decodedUnits < warmupTarget) {
      const decodeIndex = nextDecodeFrameIndex;
      nextDecodeFrameIndex = (nextDecodeFrameIndex + 1) % decodedFrameCount;
      const nextDecoded = await currentDecoder.decode({ frameIndex: decodeIndex });
      const frame = nextDecoded.image;
      const durationUs = typeof frame.duration === "number" ? frame.duration : 16_000;
      const durationMs = Math.max(MIN_FRAME_MS, Math.round(durationUs / 1000));
      prefetchedFrames.push({ image: frame, durationMs, frameIndex: decodeIndex });
      decodedUnits += 1;
      setLoading(true, "로딩 중...");
    }

    renderMode = "decoder";
    originalMediaWidth = 0;
    originalMediaHeight = 0;
    contentDisplayScale = 1;
    currentImageIsVectorStatic = false;
    logDecodeRoute("ImageDecoder", displayName);
    hasImage = true;
    fitImageToViewport(false, false);
    updateStatus(displayName);
    setLoading(true, "로딩 중...");

    if (decodedFrameCount > 1) {
      const token = ++playingToken;
      nextFrameAt = performance.now();
      prefetchNextFrame(token);
      scheduleTick(token);
      updateAnimControlsUi();
    }

    return true;
  } catch {
    return false;
  }
}

function rememberDecodedPayload(path: string, payload: DecodedImagePayload) {
  decodePayloadCache.set(path, payload);
  const oldIndex = decodePayloadCacheOrder.indexOf(path);
  if (oldIndex >= 0) {
    decodePayloadCacheOrder.splice(oldIndex, 1);
  }
  decodePayloadCacheOrder.push(path);
  while (decodePayloadCacheOrder.length > DECODE_PREFETCH_CACHE_LIMIT) {
    const evict = decodePayloadCacheOrder.shift();
    if (evict) {
      decodePayloadCache.delete(evict);
    }
  }
}

function getCachedDecodedPayload(path: string): DecodedImagePayload | null {
  const cached = decodePayloadCache.get(path);
  if (!cached) return null;
  rememberDecodedPayload(path, cached);
  return cached;
}

function forgetDecodedPayload(path: string) {
  decodePayloadCache.delete(path);
  decodePayloadInFlight.delete(path);
  const index = decodePayloadCacheOrder.indexOf(path);
  if (index >= 0) {
    decodePayloadCacheOrder.splice(index, 1);
  }
}

function forgetRuntimeImageCache(path: string) {
  if (!path) return;
  forgetDecodedPayload(path);
  const key = normalizePathForCompare(path);
  hdrJpegByPath.delete(key);
  hdrJpegInFlightByPath.delete(key);
  thumbnailPathToSrc.delete(path);
  thumbnailInFlight.delete(path);
  thumbnailRenderedPaths = [];
}

function convertRawToRgba(raw: Uint8Array, width: number, height: number, bands: number): Uint8ClampedArray {
  const pixelCount = width * height;
  const out = new Uint8ClampedArray(pixelCount * 4);
  if (bands <= 0) return out;

  for (let i = 0; i < pixelCount; i += 1) {
    const srcOffset = i * bands;
    const dstOffset = i * 4;
    const b0 = raw[srcOffset] ?? 0;
    const b1 = raw[srcOffset + 1] ?? b0;
    const b2 = raw[srcOffset + 2] ?? b0;
    const alpha = raw[srcOffset + 3] ?? 255;

    if (bands === 1) {
      out[dstOffset] = b0;
      out[dstOffset + 1] = b0;
      out[dstOffset + 2] = b0;
      out[dstOffset + 3] = 255;
    } else if (bands === 2) {
      out[dstOffset] = b0;
      out[dstOffset + 1] = b0;
      out[dstOffset + 2] = b0;
      out[dstOffset + 3] = b1;
    } else {
      out[dstOffset] = b0;
      out[dstOffset + 1] = b1;
      out[dstOffset + 2] = b2;
      out[dstOffset + 3] = bands >= 4 ? alpha : 255;
    }
  }

  return out;
}

function hasTransparentPixel(rgba: Uint8ClampedArray): boolean {
  for (let i = 3; i < rgba.length; i += 4) {
    if (rgba[i] < ALPHA_THRESHOLD) return true;
  }
  return false;
}

function detectTransparencyForStaticImage(
  source: CanvasImageSource,
  width: number,
  height: number,
  ext: string,
): boolean {
  const mayHaveAlpha = alphaCapableStaticExtensions.has(ext);
  const strictFormat =
    ext === "avif" || ext === "heic" || ext === "heif" || ext === "jxl";
  try {
    const quick = detectTransparencyFromSource(
      source,
      width,
      height,
      ALPHA_SCAN_MAX_SIDE,
      strictFormat ? ALPHA_STRICT_MIN_HITS : 1,
      strictFormat ? ALPHA_STRICT_THRESHOLD : ALPHA_THRESHOLD,
    );
    if (quick) return true;
    if (mayHaveAlpha) {
      return detectTransparencyFromSource(
        source,
        width,
        height,
        ALPHA_SCAN_REFINE_MAX_SIDE,
        strictFormat ? ALPHA_STRICT_MIN_HITS : 1,
        strictFormat ? ALPHA_STRICT_THRESHOLD : ALPHA_THRESHOLD,
      );
    }
    return false;
  } catch {
    // Strict formats are prone to false positives; fail closed.
    return strictFormat ? false : mayHaveAlpha;
  }
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("image load failed"));
    image.src = src;
  });
}

function parseSvgLength(raw: string | null): number | null {
  if (!raw) return null;
  const value = Number.parseFloat(raw.trim());
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

async function readSvgIntrinsicSize(src: string): Promise<{ width: number; height: number } | null> {
  try {
    const response = await fetch(src);
    if (!response.ok) return null;
    const text = await response.text();
    const doc = new DOMParser().parseFromString(text, "image/svg+xml");
    const root = doc.documentElement;
    if (!root || root.nodeName.toLowerCase() !== "svg") return null;

    const widthAttr = parseSvgLength(root.getAttribute("width"));
    const heightAttr = parseSvgLength(root.getAttribute("height"));
    if (widthAttr && heightAttr) {
      return { width: widthAttr, height: heightAttr };
    }

    const viewBox = root.getAttribute("viewBox");
    if (!viewBox) return null;
    const nums = viewBox
      .trim()
      .split(/[\s,]+/)
      .map((v) => Number.parseFloat(v))
      .filter((v) => Number.isFinite(v));
    if (nums.length < 4) return null;
    const width = nums[2];
    const height = nums[3];
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      return null;
    }
    return { width, height };
  } catch {
    return null;
  }
}

async function tryDecodeWithNativeImage(path: string, ext: string, displayName: string): Promise<boolean> {
  if (!viewerImage || !canTryNativeImage(ext)) {
    return false;
  }

  try {
    const src = toImageSrc(path);
    const image = await loadImageElement(src);
    let width = image.naturalWidth || image.width;
    let height = image.naturalHeight || image.height;
    if (ext === "svg") {
      const svgSize = await readSvgIntrinsicSize(src);
      if (svgSize) {
        width = svgSize.width;
        height = svgSize.height;
        viewerImage.style.width = `${width}px`;
        viewerImage.style.height = `${height}px`;
      } else {
        viewerImage.style.width = "";
        viewerImage.style.height = "";
      }
    } else {
      viewerImage.style.width = "";
      viewerImage.style.height = "";
    }
    if (width <= 0 || height <= 0) {
      return false;
    }

    nativeImageProxyCanvasSourceKey = "";
    viewerImage.src = src;
    initCanvasSize(width, height);
    decodedFrameCount = 1;
    currentFrameIndex = 0;
    playbackPaused = false;
    currentFrameSequencePlayable = false;
    animationLoopLimit = null;
    completedAnimationLoops = 0;
    playbackStoppedByLoopLimit = false;
    const hasAlpha = detectTransparencyForStaticImage(image, width, height, ext);
    setStageAlphaGrid(hasAlpha);
    renderMode = "native-image";
    originalMediaWidth = 0;
    originalMediaHeight = 0;
    contentDisplayScale = 1;
    currentImageIsVectorStatic = false;
    currentImageExt = ext;
    currentImagePathForDecode = "";
    currentVectorDpi = VECTOR_BASE_DPI;
    logDecodeRoute("img_native_static", displayName);
    hasImage = true;
    fitImageToViewport(false, false);
    updateAnimControlsUi();
    updateStatus(displayName);
    return true;
  } catch {
    return false;
  }
}


function parseMagickDecodedBuffer(buf: ArrayBuffer): DecodedImagePayload | null {
  const header = new DataView(buf, 0, 20);
  const width = header.getUint32(0, true);
  const height = header.getUint32(4, true);
  const bands = header.getUint32(8, true);
  const originalWidth = header.getUint32(12, true);
  const originalHeight = header.getUint32(16, true);
  if (width <= 0 || height <= 0 || bands <= 0) {
    return null;
  }
  return {
    width,
    height,
    bands,
    raw: new Uint8Array(buf, 20),
    originalWidth: originalWidth > 0 ? originalWidth : width,
    originalHeight: originalHeight > 0 ? originalHeight : height,
  };
}

async function fetchDecodedPayload(path: string, ext: string): Promise<DecodedImagePayload | null> {
  if (!isTauri() || !isAbsoluteFilePath(path) || !staticDecodeExtensions.has(ext)) {
    return null;
  }

  const cached = getCachedDecodedPayload(path);
  if (cached) return cached;

  const inFlight = decodePayloadInFlight.get(path);
  if (inFlight) {
    return inFlight;
  }

  const renderDpi = vectorStaticExtensions.has(ext) ? getVectorInitialDpi() : null;
  const task = invoke<ArrayBuffer>("decode_with_magick", {
    path,
    maxWidth: null,
    maxHeight: null,
    renderDpi,
    frameIndex: null,
  })
    .then((buf) => {
      const normalized = parseMagickDecodedBuffer(buf);
      if (!normalized) return null;
      rememberDecodedPayload(path, normalized);
      return normalized;
    })
    .finally(() => {
      decodePayloadInFlight.delete(path);
    });

  decodePayloadInFlight.set(path, task);
  return task;
}

async function tryRenderSvgWithWebView(path: string, ext: string, displayName: string): Promise<boolean> {
  if (!viewerSvgFrame || (ext !== "svg" && ext !== "svgz")) {
    return false;
  }

  try {
    const src = toImageSrc(path);
    const svgSize = await readSvgIntrinsicSize(src);
    const fallbackImage = svgSize ? null : await loadImageElement(src);
    const fallbackRect = dropZone?.getBoundingClientRect();
    const width = Math.max(
      1,
      Math.round(svgSize?.width ?? fallbackImage?.naturalWidth ?? fallbackImage?.width ?? fallbackRect?.width ?? 1),
    );
    const height = Math.max(
      1,
      Math.round(svgSize?.height ?? fallbackImage?.naturalHeight ?? fallbackImage?.height ?? fallbackRect?.height ?? 1),
    );

    viewerSvgFrame.src = src;
    viewerSvgFrame.style.width = `${width}px`;
    viewerSvgFrame.style.height = `${height}px`;

    initCanvasSize(width, height);
    decodedFrameCount = 1;
    currentFrameIndex = 0;
    playbackPaused = false;
    currentFrameSequencePlayable = false;
    animationLoopLimit = null;
    completedAnimationLoops = 0;
    playbackStoppedByLoopLimit = false;
    setStageAlphaGrid(true);
    renderMode = "webview-svg";
    originalMediaWidth = 0;
    originalMediaHeight = 0;
    contentDisplayScale = 1;
    currentImageIsVectorStatic = false;
    currentImageExt = ext;
    currentImagePathForDecode = "";
    currentVectorDpi = VECTOR_BASE_DPI;
    logDecodeRoute("svg_webview", displayName);
    hasImage = true;
    fitImageToViewport(false, false);
    updateAnimControlsUi();
    updateStatus(displayName);
    return true;
  } catch {
    return false;
  }
}

function drawDecodedPayload(
  payload: DecodedImagePayload,
  displayName: string,
  ext: string,
  options?: { resetView?: boolean; renderDpi?: number | null },
) {
  if (!canvas) return;
  const rgba = payload.bands === 4
    ? new Uint8ClampedArray(payload.raw.buffer.slice(payload.raw.byteOffset, payload.raw.byteOffset + payload.raw.byteLength) as ArrayBuffer)
    : convertRawToRgba(payload.raw, payload.width, payload.height, payload.bands);
  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) return;

  initCanvasSize(payload.width, payload.height);
  ctx.clearRect(0, 0, payload.width, payload.height);
  ctx.putImageData(new ImageData(rgba as any, payload.width, payload.height), 0, 0);

  decodedFrameCount = 1;
  currentFrameIndex = 0;
  playbackPaused = false;
  currentFrameSequencePlayable = false;
  animationLoopLimit = null;
  completedAnimationLoops = 0;
  playbackStoppedByLoopLimit = false;
  setStageAlphaGrid(hasTransparentPixel(rgba));
  renderMode = "vips";
  originalMediaWidth = payload.originalWidth;
  originalMediaHeight = payload.originalHeight;
  currentImageIsVectorStatic = vectorStaticExtensions.has(ext);
  const appliedDpi = currentImageIsVectorStatic
    ? clamp(Math.round(options?.renderDpi ?? VECTOR_BASE_DPI), VECTOR_BASE_DPI, VECTOR_MAX_DPI)
    : VECTOR_BASE_DPI;
  currentVectorDpi = appliedDpi;
  contentDisplayScale = currentImageIsVectorStatic ? VECTOR_BASE_DPI / appliedDpi : 1;
  currentImageExt = ext;
  logDecodeRoute("ImageMagick", displayName);
  hasImage = true;
  if (options?.resetView === false) {
    renderTransform();
  } else {
    fitImageToViewport(false, false);
  }
  updateAnimControlsUi();
  updateStatus(displayName);
}

async function tryDecodeWithMagick(
  path: string,
  ext: string,
  displayName: string,
  options?: { resetView?: boolean; renderDpi?: number | null },
): Promise<boolean> {
  const renderDpi = options?.renderDpi ?? (vectorStaticExtensions.has(ext) ? getVectorInitialDpi() : null);
  const payload = await (async () => {
    if (renderDpi != null) {
      if (!isTauri() || !isAbsoluteFilePath(path) || !staticDecodeExtensions.has(ext)) {
        return null;
      }
      const buf = await invoke<ArrayBuffer>("decode_with_magick", {
        path,
        maxWidth: null,
        maxHeight: null,
        renderDpi,
        frameIndex: null,
      });
      return parseMagickDecodedBuffer(buf);
    }
    return fetchDecodedPayload(path, ext);
  })().catch((error) => {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`ImageMagick decode failed: ${reason}`);
  });
  if (!payload) {
    return false;
  }

  currentImagePathForDecode = path;
  drawDecodedPayload(payload, displayName, ext, {
    resetView: options?.resetView,
    renderDpi,
  });
  return true;
}

async function decodeMagickFramePayload(path: string, frameIndex: number): Promise<DecodedImagePayload> {
  const buf = await invoke<ArrayBuffer>("decode_with_magick", {
    path,
    maxWidth: null,
    maxHeight: null,
    renderDpi: null,
    frameIndex,
  });
  const payload = parseMagickDecodedBuffer(buf);
  if (!payload) {
    throw new Error("invalid decoded payload");
  }
  return payload;
}

async function tryDecodeIcoWithMagickMulti(path: string, ext: string, displayName: string): Promise<boolean> {
  if (!isTauri() || !isAbsoluteFilePath(path) || (ext !== "ico" && ext !== "icon") || !canvas) {
    return false;
  }

  try {
    const countRaw = await invoke<number>("get_magick_image_count", { path });
    const count = Number.isFinite(countRaw) ? Math.max(1, Math.floor(countRaw)) : 1;
    if (count <= 1) {
      return false;
    }

    const createFrame = async (index: number) => {
      const payload = await decodeMagickFramePayload(path, index);
      const rgba = payload.bands === 4
        ? new Uint8ClampedArray(payload.raw.buffer.slice(payload.raw.byteOffset, payload.raw.byteOffset + payload.raw.byteLength) as ArrayBuffer)
        : convertRawToRgba(payload.raw, payload.width, payload.height, payload.bands);
      const imageData = new ImageData(rgba, payload.width, payload.height);
      const image = await createImageBitmap(imageData);
      return { image, hasAlpha: hasTransparentPixel(rgba) };
    };

    const first = await createFrame(0);
    const estimatedFrameBytes = estimateFrameBytes(first.image.width ?? 1, first.image.height ?? 1);

    stopPlayback();
    currentPrefetchQueueTarget = computePrefetchQueueTarget(ext, estimatedFrameBytes, count, null);
    currentDecoder = {
      decode: async ({ frameIndex }: { frameIndex: number }) => {
        const normalized = ((Math.floor(frameIndex) % count) + count) % count;
        const frame = await createFrame(normalized);
        return { image: frame.image };
      },
    };
    decodedFrameCount = count;
    currentFrameIndex = 0;
    playbackPaused = true;
    currentFrameSequencePlayable = false;
    animationLoopLimit = null;
    completedAnimationLoops = 0;
    playbackStoppedByLoopLimit = false;
    nextDecodeFrameIndex = decodedFrameCount > 1 ? 1 : 0;
    prefetchedFrames = [];
    setStageAlphaGrid(first.hasAlpha);
    await drawDecodedFrame({ image: first.image });
    updateAnimControlsUi();

    renderMode = "decoder";
    originalMediaWidth = 0;
    originalMediaHeight = 0;
    contentDisplayScale = 1;
    currentImageIsVectorStatic = false;
    currentVectorDpi = VECTOR_BASE_DPI;
    currentImageExt = ext;
    currentImagePathForDecode = path;
    logDecodeRoute("ImageMagick(ICO multi)", displayName);
    hasImage = true;
    fitImageToViewport(false, false);
    updateAnimControlsUi();
    updateStatus(displayName);
    return true;
  } catch {
    return false;
  }
}

async function loadFromSource(
  source: string,
  displayName: string,
  _expectedBytesHint: number | null = null,
): Promise<boolean> {
  const sourcePath = isAbsoluteFilePath(source) ? source : "";
  const baseName = getBaseName(displayName);
  if (!sourcePath) currentOpenedPath = "";
  if (!sourcePath) {
    currentFileSizeBytes = _expectedBytesHint;
  }
  const ext = getExt(displayName);
  currentImageIsHdrJpeg = false;
  const hdrProbeTask =
    sourcePath && isJpegFamilyExt(ext)
      ? isHdrJpegPath(sourcePath).catch(() => false)
      : null;
  hideStageNotice();
  if (!allowedExtensions.has(ext)) {
    clearDisplayedImageState();
    showStageNotice(baseName, "지원되지 않는 형식입니다.");
    return false;
  }

  stopPlayback();
  stopZoomAnimation();
  setLoading(true, "로딩 중...");

  try {
    if (ext === "svg" || ext === "svgz") {
      const svgWebViewOk = await tryRenderSvgWithWebView(source, ext, displayName);
      if (svgWebViewOk) {
        currentOpenedPath = sourcePath;
        void refreshCurrentFileSize(currentOpenedPath);
        scheduleHdrProbeApply(sourcePath, ext, hdrProbeTask);
        renderTransform();
        void refreshMetadataPanel();
        return true;
      }
    }

    // 1) 애니메이션은 ImageDecoder로 디코딩
    if (animatedDecodeExtensions.has(ext)) {
      const src = isTauri() && isAbsoluteFilePath(source) ? toImageSrc(source) : source;
      const decoderOk = await tryDecodeAnimated(src, ext, displayName, _expectedBytesHint);
      if (decoderOk) {
        currentImageExt = ext;
        currentImagePathForDecode = "";
        currentImageIsVectorStatic = false;
        currentVectorDpi = VECTOR_BASE_DPI;
        currentOpenedPath = sourcePath;
        void refreshCurrentFileSize(currentOpenedPath);
        scheduleHdrProbeApply(sourcePath, ext, hdrProbeTask);
        renderTransform();
        void refreshMetadataPanel();
        return true;
      }
      // Single-frame assets in animation-capable formats should fall back
      // to static decode instead of failing.
    }

    // 2) Use native <img> path first for common static photo formats.
    if (nativePreferredStaticExtensions.has(ext)) {
      const nativeOk = await tryDecodeWithNativeImage(source, ext, displayName);
      if (nativeOk) {
        currentOpenedPath = sourcePath;
        void refreshCurrentFileSize(currentOpenedPath);
        scheduleHdrProbeApply(sourcePath, ext, hdrProbeTask);
        renderTransform();
        void refreshMetadataPanel();
        return true;
      }
    }

    // 3) ICO는 ImageMagick 다중 프레임으로 디코딩
    const decodedIcoMulti = await tryDecodeIcoWithMagickMulti(source, ext, displayName);
    if (decodedIcoMulti) {
      currentOpenedPath = sourcePath;
      void refreshCurrentFileSize(currentOpenedPath);
      scheduleHdrProbeApply(sourcePath, ext, hdrProbeTask);
      renderTransform();
      void refreshMetadataPanel();
      return true;
    }

    // 4) 정적 이미지는 ImageMagick으로 디코딩
    const decodedWithMagick = await tryDecodeWithMagick(source, ext, displayName);
    if (decodedWithMagick) {
      currentOpenedPath = sourcePath;
      void refreshCurrentFileSize(currentOpenedPath);
      scheduleHdrProbeApply(sourcePath, ext, hdrProbeTask);
      renderTransform();
      void refreshMetadataPanel();
      return true;
    }

    throw new Error("이미지 로드 실패");
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error("[image-load]", reason);
    if (isTauri()) {
      try {
        await invoke("log_decode_route", {
          route: "image-load-error",
          source: `${displayName} :: ${reason}`,
        });
      } catch {
        // ignore logging failure
      }
    }
    clearDisplayedImageState();
    showStageNotice(baseName, "지원되지 않는 형식입니다.");
    return false;
  } finally {
    setLoading(false);
  }
}

void animatedDecodeExtensions;
void tryDecodeAnimated;
void tryRenderSvgWithWebView;

function applyFolderSyncResult(requestId: number, list: string[], index: number) {
  if (requestId !== folderSyncRequestId) return;
  folderImages = list;
  folderImageIndex = index;
  updateFolderNavButtons();
}

async function syncFolderImages(path: string, requestId: number) {
  if (!isTauri() || !isAbsoluteFilePath(path)) {
    applyFolderSyncResult(requestId, [], -1);
    return;
  }

  try {
    const list = await invoke<string[]>("list_images_in_same_folder", { path });
    const key = normalizePathForCompare(path);
    const index = list.findIndex((p) => normalizePathForCompare(p) === key);
    applyFolderSyncResult(requestId, list, index);
  } catch {
    applyFolderSyncResult(requestId, [], -1);
  }
}

async function loadFromPath(path: string, syncFolder = true, focusThumbnail = false) {
  const prevPath = currentOpenedPath;
  if (prevPath && normalizePathForCompare(prevPath) !== normalizePathForCompare(path)) {
    // 이미지 전환 시 이전 이미지의 뷰어 회전 상태는 유지하지 않는다.
    setStoredVisualRotationDeg(prevPath, 0);
    pendingVisualRotationDeg = 0;
    pendingVisualRotationPath = "";
  }

  let syncPromise: Promise<void> | null = null;

  if (syncFolder) {
    const key = normalizePathForCompare(path);
    const existingIndex = folderImages.findIndex((p) => normalizePathForCompare(p) === key);
    if (existingIndex >= 0) {
      folderImageIndex = existingIndex;
      updateFolderNavButtons();
    } else {
      folderImageIndex = -1;
      updateFolderNavButtons();
    }

    const requestId = ++folderSyncRequestId;
    syncPromise = syncFolderImages(path, requestId);
  }

  const ok = await loadFromSource(path, path, null);
  if (ok && syncFolder) {
    currentOpenedPath = path;
    if (syncPromise) {
      await syncPromise;
    }
  } else if (ok) {
    currentOpenedPath = path;
    const key = normalizePathForCompare(path);
    folderImageIndex = folderImages.findIndex((p) => normalizePathForCompare(p) === key);
    updateFolderNavButtons();
  } else if (!ok) {
    currentOpenedPath = "";
    if (syncPromise) {
      await syncPromise;
    }
    const key = normalizePathForCompare(path);
    const failedIndex = folderImages.findIndex((p) => normalizePathForCompare(p) === key);
    if (failedIndex >= 0) {
      folderImageIndex = failedIndex;
    }
    updateFolderNavButtons();
  }

  updateFolderNavButtons();
  if (focusThumbnail) {
    focusActiveThumbnail();
  }
}

async function pickFile() {
  if (!isTauri()) return;
  const stopPolling = startShellSortSnapshotPolling();
  try {
    const picked = await open({
      multiple: false,
      filters: [
        {
          name: "이미지 파일",
          extensions: Array.from(allowedExtensions),
        },
      ],
    });

    if (typeof picked === "string") {
      await loadFromPath(picked);
      if (isAbsoluteFilePath(picked)) {
        // First open can race with shell/dialog sort snapshot initialization.
        // Force one capture + one resync so initial folder order matches Explorer more reliably.
        await invoke("capture_shell_sort_cache_snapshot").catch(() => {
          // ignore capture failure on unsupported platforms/contexts
        });
        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, 120);
        });
        if (normalizePathForCompare(currentOpenedPath) === normalizePathForCompare(picked)) {
          const requestId = ++folderSyncRequestId;
          await syncFolderImages(picked, requestId);
        }
      }
    }
  } finally {
    stopPolling();
  }
}

function attachInputFallback() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.style.display = "none";
  document.body.appendChild(input);

  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (!file) return;
    const objectUrl = URL.createObjectURL(file);
    void loadFromSource(objectUrl, file.name, file.size).finally(() => {
      URL.revokeObjectURL(objectUrl);
    });
  });

  openBtn?.addEventListener("click", () => input.click());
}

function teardownDragAndDrop() {
  logDndDebug("teardown-dom-listeners");
  dragAndDropAbortController?.abort();
  dragAndDropAbortController = null;
  dropZone?.classList.remove("is-drop-over");
}

function isExternalFileDragEvent(e: DragEvent): boolean {
  const transfer = e.dataTransfer;
  if (!transfer) return false;
  if (transfer.files && transfer.files.length > 0) return true;
  const items = Array.from(transfer.items ?? []);
  if (items.some((item) => item.kind === "file")) return true;
  const types = Array.from(transfer.types ?? []);
  return (
    types.includes("Files") ||
    types.includes("application/x-moz-file") ||
    types.includes("text/uri-list")
  );
}

async function loadFromDragEvent(e: DragEvent) {
  const file = e.dataTransfer?.files?.[0] as (File & { path?: string }) | undefined;
  if (!file) {
    logDndDebug("drop-no-file");
    return;
  }
  logDndDebug(
    "drop-received",
    `name=${file.name || "-"} path=${file.path ? "yes" : "no"} size=${Number(file.size) || 0} editOpen=${editModalOpen ? 1 : 0}`,
  );
  if (editModalOpen) {
    const ok = await showAppModal({
      title: "이미지 열기",
      message: "현재 편집 내용이 사라집니다.\n새 이미지를 열까요?",
      kind: "confirm",
      okLabel: "열기",
      cancelLabel: "취소",
    });
    if (!ok) {
      logDndDebug("drop-cancelled-by-modal");
      return;
    }
    closeEditModal();
  }
  if (file.path) {
    logDndDebug("drop-load-from-path");
    await loadFromPath(file.path, true, true);
    return;
  }
  logDndDebug("drop-load-from-source");
  const objectUrl = URL.createObjectURL(file);
  await loadFromSource(objectUrl, file.name, file.size);
  URL.revokeObjectURL(objectUrl);
}

function registerDragAndDrop() {
  if (!dropZone) {
    logDndDebug("register-dom-listeners-skipped", "dropZone-missing");
    return;
  }
  teardownDragAndDrop();
  const controller = new AbortController();
  dragAndDropAbortController = controller;
  const { signal } = controller;
  logDndDebug("register-dom-listeners");

  window.addEventListener("dragover", (e) => {
    if (isTextInputLikeTarget(e.target)) return;
    const isExternal = isExternalFileDragEvent(e);
    e.preventDefault();
    const now = performance.now();
    if (isExternal) {
      if (now - dndDebugLastDragoverAt >= 1000) {
        dndDebugLastDragoverAt = now;
        logDndDebug("window-dragover-files");
      }
    } else if (now - dndDebugLastUnknownDragoverAt >= 1000) {
      dndDebugLastUnknownDragoverAt = now;
      logDndDebug("window-dragover-nonfile", summarizeDragTransfer(e.dataTransfer));
    }
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = "copy";
    }
  }, { signal });

  window.addEventListener("drop", (e) => {
    if (isTextInputLikeTarget(e.target)) return;
    if (e.defaultPrevented) return;
    const isExternal = isExternalFileDragEvent(e);
    e.preventDefault();
    if (isExternal) {
      logDndDebug("window-drop-files");
    } else {
      const now = performance.now();
      if (now - dndDebugLastUnknownDropAt >= 500) {
        dndDebugLastUnknownDropAt = now;
        logDndDebug("window-drop-nonfile", summarizeDragTransfer(e.dataTransfer));
      }
    }
    void loadFromDragEvent(e);
  }, { signal });

  window.addEventListener("dragleave", (e) => {
    const related = e.relatedTarget as Node | null;
    if (!related) {
      dropZone.classList.remove("is-drop-over");
    }
  }, { signal });

  dropZone.addEventListener("dragover", (e) => {
    if (isTextInputLikeTarget(e.target)) return;
    const isExternal = isExternalFileDragEvent(e);
    e.preventDefault();
    e.stopPropagation();
    const now = performance.now();
    if (isExternal && now - dndDebugLastStageDragoverAt >= 1000) {
      dndDebugLastStageDragoverAt = now;
      logDndDebug("stage-dragover-files");
    }
    dropZone.classList.add("is-drop-over");
  }, { signal });

  dropZone.addEventListener("dragleave", (e) => {
    dropZone.classList.remove("is-drop-over");
    e.stopPropagation();
  }, { signal });

  dropZone.addEventListener("drop", (e) => {
    if (isTextInputLikeTarget(e.target)) return;
    const isExternal = isExternalFileDragEvent(e);
    e.preventDefault();
    e.stopPropagation();
    if (isExternal) {
      logDndDebug("stage-drop-files");
    } else {
      logDndDebug("stage-drop-nonfile", summarizeDragTransfer(e.dataTransfer));
    }
    dropZone.classList.remove("is-drop-over");
    void loadFromDragEvent(e);
  }, { signal });
}

function teardownPanAndZoom() {
  panAndZoomAbortController?.abort();
  panAndZoomAbortController = null;
  dragging = false;
  dropZone?.classList.remove("is-dragging");
}

function registerPanAndZoom() {
  if (!dropZone) return;
  teardownPanAndZoom();
  const controller = new AbortController();
  panAndZoomAbortController = controller;
  const { signal } = controller;

  dropZone.addEventListener("mousemove", () => {
    if (eyedropperPicking) return;
    showStageNavOverlay();
  }, { signal });
  dropZone.addEventListener("mouseenter", () => {
    if (eyedropperPicking) return;
    showStageNavOverlay();
  }, { signal });
  dropZone.addEventListener("mouseleave", () => {
    if (eyedropperPicking) return;
    hideStageNavOverlay();
  }, { signal });

  dropZone.addEventListener("wheel", (e) => {
    if (eyedropperPicking) return;
    if (!hasImage) return;
    e.preventDefault();
    const minScale = getMinScaleForCurrentImage();
    const wheelMinScale = getZoomOutMinScaleForCurrentViewport();
    const baseScale = zoomAnimationId ? zoomTargetScale : currentScale;
    const adaptiveStep = getAdaptiveZoomStep(baseScale);
    const stepped = e.deltaY < 0 ? baseScale + adaptiveStep : baseScale - adaptiveStep;
    const snapped = snapScaleToStep(stepped);
    const targetMinScale = e.deltaY > 0 ? wheelMinScale : minScale;
    const target = clamp(snapped, targetMinScale, MAX_SCALE);
    const anchor = createZoomAnchor(e.clientX, e.clientY);
    const now = performance.now();
    const isBurst = now - lastWheelInputAt <= WHEEL_BURST_WINDOW_MS || zoomAnimationMode === "follow";
    lastWheelInputAt = now;

    if (isBurst) {
      animateScaleFollowTo(target, anchor);
    } else {
      animateScaleTo(target, anchor);
    }
  }, { passive: false, signal });

  dropZone.addEventListener("mousedown", (e) => {
    if (eyedropperPicking) return;
    if (!hasImage || !canDragCurrentImage()) return;
    dragging = true;
    dragStartX = e.clientX - offsetX;
    dragStartY = e.clientY - offsetY;
    dropZone.classList.add("is-dragging");
  }, { signal });

  window.addEventListener("mousemove", (e) => {
    if (eyedropperPicking) return;
    if (!dragging) return;
    offsetX = e.clientX - dragStartX;
    offsetY = e.clientY - dragStartY;
    renderTransform();
  }, { signal });

  window.addEventListener("mouseup", () => {
    dragging = false;
    dropZone.classList.remove("is-dragging");
  }, { signal });

  dropZone.addEventListener("dblclick", (e) => {
    const target = e.target as HTMLElement;
    if (target.closest("button, input, [data-no-dblzoom]")) return;
    toggleDoubleClickZoom();
  }, { signal });
}

async function teardownTauriDropListener() {
  const unlistenPromise = tauriDropUnlistenPromise;
  tauriDropUnlistenPromise = null;
  const unlisten = await unlistenPromise?.catch(() => null);
  if (unlisten) {
    logDndDebug("teardown-tauri-drop-listener");
    unlisten();
  }
}

function registerTauriDropListener() {
  if (!isTauri()) {
    logDndDebug("register-tauri-drop-skipped", "not-tauri");
    return;
  }
  void (async () => {
    await teardownTauriDropListener();
    const appWindow = getCurrentWindow();
    logDndDebug("register-tauri-drop-listener");
    tauriDropUnlistenPromise = appWindow.onDragDropEvent(async (event) => {
      const payload = event.payload as { type?: string; paths?: string[] };
      const eventType = payload.type ?? "unknown";
      const pathCount = Array.isArray(payload.paths) ? payload.paths.length : 0;
      logDndDebug("tauri-dnd-event", `type=${eventType} paths=${pathCount}`);
      if (payload.type === "drop" && pathCount > 0) {
        await loadFromPath(payload.paths![0], true, true);
      }
    }).then((unlisten) => unlisten).catch((error) => {
      const reason = error instanceof Error ? error.message : String(error);
      logDndDebug("register-tauri-drop-failed", reason);
      return null;
    });
  })();
}

function registerShortcuts() {
  window.addEventListener("keydown", async (e) => {
    if (appModalResolver) {
      return;
    }
    if (editModalOpen) {
      return;
    }

    const target = e.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable)
    ) {
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "o") {
      e.preventDefault();
      await pickFile();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "c") {
      if (!hasImage) return;
      e.preventDefault();
      await handleCopyCurrentImage();
      return;
    }
    if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key === "Delete") {
      if (!hasImage || deleteInFlight) return;
      e.preventDefault();
      await handleDeleteCurrentImage();
      return;
    }
    if (e.key === "0") resetScale();
    if (e.key.toLowerCase() === "f") fitImageToViewport();
    if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
      if (e.key === "ArrowLeft") {
        if (e.repeat) return;
        if (folderImageIndex <= 0) return;
        e.preventDefault();
        const prevPath = folderImages[folderImageIndex - 1];
        await loadFromPath(prevPath, false, true);
        return;
      }
      if (e.key === "ArrowRight") {
        if (e.repeat) return;
        if (folderImageIndex < 0 || folderImageIndex >= folderImages.length - 1) return;
        e.preventDefault();
        const nextPath = folderImages[folderImageIndex + 1];
        await loadFromPath(nextPath, false, true);
        return;
      }
    }
    if (e.key === "+" || e.key === "=") {
      e.preventDefault();
      if (!e.repeat) {
        stepZoom(1);
      }
      startKeyHoldZoom(1);
      return;
    }
    if (e.key === "-") {
      e.preventDefault();
      if (!e.repeat) {
        stepZoom(-1);
      }
      startKeyHoldZoom(-1);
      return;
    }
  });

  window.addEventListener("keyup", (e) => {
    if ((e.key === "+" || e.key === "=") && keyHoldZoomDirection === 1) {
      stopKeyHoldZoom();
      return;
    }
    if (e.key === "-" && keyHoldZoomDirection === -1) {
      stopKeyHoldZoom();
    }
  });

  window.addEventListener("blur", () => {
    stopKeyHoldZoom();
  });
}

function registerTitlebarControls() {
  if (!isTauri()) return;
  const appWindow = getCurrentWindow();
  const maxBtn = document.getElementById("titlebar-maximize");
  let closeRequestInFlight = false;

  const iconMaximize = `<svg width="10" height="10" viewBox="0 0 10 10"><rect x="1" y="1" width="8" height="8" rx="1.5" stroke="currentColor" stroke-width="1.2" fill="none"/></svg>`;
  const iconRestore = `<svg width="10" height="10" viewBox="0 0 10 10"><rect x="0.5" y="2.5" width="6" height="6" rx="1.2" stroke="currentColor" stroke-width="1.1" fill="none"/><path d="M3.5 2.5V1.8A1.2 1.2 0 014.7.6h3.5A1.2 1.2 0 019.4 1.8v3.5a1.2 1.2 0 01-1.2 1.2H7.5" stroke="currentColor" stroke-width="1.1" fill="none"/></svg>`;

  async function syncMaxIcon() {
    if (!maxBtn) return;
    const maximized = await appWindow.isMaximized();
    maxBtn.innerHTML = maximized ? iconRestore : iconMaximize;
    maxBtn.setAttribute("aria-label", maximized ? "창 모드" : "최대화");
  }

  document.getElementById("titlebar-minimize")?.addEventListener("click", () => {
    appWindow.minimize();
  });
  maxBtn?.addEventListener("click", async () => {
    const maximized = await appWindow.isMaximized();
    if (maximized) {
      await appWindow.unmaximize();
    } else {
      await appWindow.maximize();
    }
    syncMaxIcon();
  });
  document.getElementById("titlebar-close")?.addEventListener("click", async () => {
    if (closeRequestInFlight) return;
    closeRequestInFlight = true;
    try {
      if (editModalOpen) {
        const ok = await showAppModal({
          title: "앱 종료",
          message: "작업중인 내용이 사라집니다. 창을 닫을까요?",
          kind: "confirm",
          okLabel: "닫기",
          cancelLabel: "취소",
        });
        if (!ok) return;
      }
      appWindow.close();
    } finally {
      closeRequestInFlight = false;
    }
  });

  appWindow.onResized(() => {
    syncMaxIcon();
  });

  syncMaxIcon();
}

let appUiInitialized = false;

function initializeAppUi() {
  if (appUiInitialized) {
    logDndDebug("initialize-skip", "already-initialized");
    return;
  }
  appUiInitialized = true;
  logDndDebug("initialize-start", `readyState=${document.readyState}`);
  setStartupLaunchOpenPending(isTauri());
  void openLaunchFileIfExists();
  closeBottomMoreMenu();

  window.addEventListener("contextmenu", (e) => {
    const target = e.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable)
    ) {
      return;
    }
    e.preventDefault();
    const onStage = !!target?.closest("#drop-zone");
    if (hasImage && onStage) {
      closeBottomMoreMenu();
      openStageContextMenu(e.clientX, e.clientY);
    } else {
      closeStageContextMenu();
    }
  });

  openBtn?.addEventListener("click", pickFile);
  placeholderOpenBtn?.addEventListener("click", pickFile);
  titlebarEyedropperBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    void handlePickColorFromEyedropper();
  });
  titlebarPickedColorBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    void handleCopyPickedColorCode();
  });
  metaBtn?.addEventListener("click", () => {
    toggleMetadataPanel();
  });
  fitBtn?.addEventListener("click", () => fitImageToViewport());
  resetBtn?.addEventListener("click", resetScale);
  let wasMaximizedBeforeFullscreen = false;
  const fullscreenExitBtn = document.querySelector<HTMLButtonElement>("#fullscreen-exit-btn");
  const fullscreenFillBtn = document.querySelector<HTMLButtonElement>("#fullscreen-fill-btn");
  let fsMouseTimer = 0;
  document.addEventListener("mousemove", () => {
    if (!document.body.classList.contains("is-fullscreen")) return;
    document.body.classList.add("fs-controls-visible");
    clearTimeout(fsMouseTimer);
    fsMouseTimer = window.setTimeout(() => {
      document.body.classList.remove("fs-controls-visible");
    }, 2000);
  });
  fullscreenFillBtn?.addEventListener("click", () => {
    fullscreenFillMode = !fullscreenFillMode;
    fullscreenFillBtn.classList.toggle("is-active", fullscreenFillMode);
    fullscreenFillBtn.textContent = fullscreenFillMode ? "채우기 켜짐" : "채우기";
    fitImageToViewport(true, fullscreenFillMode);
  });
  fullscreenExitBtn?.addEventListener("click", async () => {
    if (!isTauri()) return;
    const appWindow = getCurrentWindow();
    await appWindow.setFullscreen(false);
    if (wasMaximizedBeforeFullscreen) {
      setTimeout(() => appWindow.maximize(), 50);
    }
  });
  fullscreenBtn?.addEventListener("click", async () => {
    if (!isTauri()) return;
    const appWindow = getCurrentWindow();
    const isFs = await appWindow.isFullscreen();
    if (!isFs) {
      wasMaximizedBeforeFullscreen = await appWindow.isMaximized();
      if (wasMaximizedBeforeFullscreen) {
        await appWindow.unmaximize();
      }
      await appWindow.setFullscreen(true);
    } else {
      await appWindow.setFullscreen(false);
      if (wasMaximizedBeforeFullscreen) {
        setTimeout(() => appWindow.maximize(), 50);
      }
    }
  });
  if (isTauri()) {
    const appWindow = getCurrentWindow();
    let wasFullscreen = false;
    void appWindow.isFullscreen().then((isFs) => {
      document.body.classList.toggle("is-fullscreen", isFs);
      setFullscreenButtonLabel(isFs);
      wasFullscreen = isFs;
    }).catch(() => {
      setFullscreenButtonLabel(false);
    });
    appWindow.onResized(async () => {
      const isFs = await appWindow.isFullscreen();
      document.body.classList.toggle("is-fullscreen", isFs);
      setFullscreenButtonLabel(isFs);
      if (isFs && !wasFullscreen) {
        requestAnimationFrame(() => fitImageToViewport(true, fullscreenFillMode));
      }
      if (!isFs) {
        fullscreenFillMode = false;
        fullscreenFillBtn?.classList.remove("is-active");
      }
      wasFullscreen = isFs;
    });
  }
  document.addEventListener("keydown", async (e) => {
    if (e.key === "Escape" && isTauri()) {
      const appWindow = getCurrentWindow();
      const isFs = await appWindow.isFullscreen();
      if (isFs) {
        await appWindow.setFullscreen(false);
        if (wasMaximizedBeforeFullscreen) {
          setTimeout(() => appWindow.maximize(), 50);
        }
      }
    }
  });
  zoomOutBtn?.addEventListener("click", () => stepZoom(-1));
  zoomInBtn?.addEventListener("click", () => stepZoom(1));
  zoomSliderEl?.addEventListener("input", () => {
    if (!hasImage) return;
    const rawPercent = Number(zoomSliderEl.value);
    if (!Number.isFinite(rawPercent)) return;
    const minScale = getMinScaleForCurrentImage();
    const snapped = snapScaleToStep(rawPercent / 100);
    const target = clamp(snapped, minScale, MAX_SCALE);
    const anchor = createViewportCenterZoomAnchor();
    stopZoomAnimation();
    currentScale = target;
    if (anchor) {
      applyZoomAnchor(anchor, currentScale);
    }
    zoomTargetScale = target;
    renderTransform();
  });
  prevBtn?.addEventListener("click", async () => {
    if (folderImageIndex <= 0) return;
    const target = folderImages[folderImageIndex - 1];
    await loadFromPath(target, false, true);
  });
  nextBtn?.addEventListener("click", async () => {
    if (folderImageIndex < 0 || folderImageIndex >= folderImages.length - 1) return;
    const target = folderImages[folderImageIndex + 1];
    await loadFromPath(target, false, true);
  });
  playToggleBtn?.addEventListener("click", () => {
    togglePlayback();
  });
  framePrevBtn?.addEventListener("click", () => {
    void showFrameAt(currentFrameIndex - 1);
  });
  frameNextBtn?.addEventListener("click", () => {
    void showFrameAt(currentFrameIndex + 1);
  });
  frameSliderEl?.addEventListener("input", () => {
    const target = Number(frameSliderEl.value);
    if (!Number.isFinite(target)) return;
    void showFrameAt(target - 1, true);
  });
  animControlsEl?.addEventListener("mouseenter", () => {
    isHoveringAnimControls = true;
    showStageNavOverlay();
  });
  animControlsEl?.addEventListener("mouseleave", () => {
    isHoveringAnimControls = false;
    showStageNavOverlay();
  });
  prevBtn?.addEventListener("mouseenter", () => {
    isHoveringStageNavButtons = true;
    showStageNavOverlay();
  });
  prevBtn?.addEventListener("mouseleave", () => {
    isHoveringStageNavButtons = !!nextBtn?.matches(":hover");
    showStageNavOverlay();
  });
  nextBtn?.addEventListener("mouseenter", () => {
    isHoveringStageNavButtons = true;
    showStageNavOverlay();
  });
  nextBtn?.addEventListener("mouseleave", () => {
    isHoveringStageNavButtons = !!prevBtn?.matches(":hover");
    showStageNavOverlay();
  });
  titlebarSettingsBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    closeBottomMoreMenu();
    closeTitlebarMoreMenu();
    closeStageContextMenu();
    toggleTitlebarSettingsMenu();
  });
  titlebarSettingsMenuEl?.addEventListener("click", (e) => {
    e.stopPropagation();
  });
  titlebarMoreBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    closeBottomMoreMenu();
    closeTitlebarSettingsMenu();
    closeStageContextMenu();
    toggleTitlebarMoreMenu();
  });
  titlebarMoreMenuEl?.addEventListener("click", (e) => {
    e.stopPropagation();
  });
  bgWhiteBtn?.addEventListener("click", () => {
    applyStageBackgroundMode("white");
    closeTitlebarSettingsMenu();
  });
  bgGrayBtn?.addEventListener("click", () => {
    applyStageBackgroundMode("gray");
    closeTitlebarSettingsMenu();
  });
  bgCheckerBtn?.addEventListener("click", () => {
    applyStageBackgroundMode("checker");
    closeTitlebarSettingsMenu();
  });
  themeLightBtn?.addEventListener("click", () => {
    applyThemeMode("light");
    closeTitlebarSettingsMenu();
  });
  themeDarkBtn?.addEventListener("click", () => {
    applyThemeMode("dark");
    closeTitlebarSettingsMenu();
  });
  updateCheckBtn?.addEventListener("click", () => {
    closeTitlebarMoreMenu();
    openUpdateModal();
  });
  appLicenseInfoBtn?.addEventListener("click", () => {
    void openAppLicenseInfo();
  });
  openSourceLicenseInfoBtn?.addEventListener("click", () => {
    void openOpenSourceLicenseInfo();
  });
  helpOpenBtn?.addEventListener("click", () => {
    closeTitlebarMoreMenu();
    void openHelpPage();
  });
  bottomDeleteBtn?.addEventListener("click", () => {
    void handleDeleteCurrentImage();
  });
  bottomCopyBtn?.addEventListener("click", () => {
    void handleCopyCurrentImage();
  });
  bottomShareBtn?.addEventListener("click", () => {
    void handleShareCurrentImage();
  });
  bottomPrintBtn?.addEventListener("click", () => {
    void handlePrintCurrentImage();
  });
  bottomRotateBtn?.addEventListener("click", () => {
    void handleRotateCurrentImage();
  });
  bottomEditBtn?.addEventListener("click", () => {
    void openEditModal();
  });
  bottomMoreBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (bottomMoreBtn.disabled) return;
    closeStageContextMenu();
    toggleBottomMoreMenu();
  });
  bottomMoreMenuEl?.addEventListener("click", (e) => {
    e.stopPropagation();
  });
  thumbnailListEl?.addEventListener(
    "wheel",
    (e) => {
      const absX = Math.abs(e.deltaX);
      const absY = Math.abs(e.deltaY);
      const delta = absX > absY ? e.deltaX : e.deltaY;
      if (Math.abs(delta) < 0.01) return;
      e.preventDefault();
      animateThumbnailScrollBy(delta);
    },
    { passive: false },
  );
  thumbnailListEl?.addEventListener("pointerdown", () => {
    stopThumbnailWheelAnimation();
  });
  stageContextMenuEl?.addEventListener("click", (e) => {
    e.stopPropagation();
  });
  setWallpaperBtn?.addEventListener("click", () => {
    closeBottomMoreMenu();
    void handleSetDesktopWallpaperCurrentImage();
  });
  revealInExplorerBtn?.addEventListener("click", () => {
    closeBottomMoreMenu();
    void handleRevealCurrentImageInExplorer();
  });
  copyFilePathBtn?.addEventListener("click", () => {
    closeBottomMoreMenu();
    void handleCopyCurrentFilePath();
  });
  ctxDeleteBtn?.addEventListener("click", () => {
    closeStageContextMenu();
    void handleDeleteCurrentImage();
  });
  ctxCopyBtn?.addEventListener("click", () => {
    closeStageContextMenu();
    void handleCopyCurrentImage();
  });
  ctxShareBtn?.addEventListener("click", () => {
    closeStageContextMenu();
    void handleShareCurrentImage();
  });
  ctxPrintBtn?.addEventListener("click", () => {
    closeStageContextMenu();
    void handlePrintCurrentImage();
  });
  ctxRotateBtn?.addEventListener("click", () => {
    closeStageContextMenu();
    void handleRotateCurrentImage();
  });
  ctxEditBtn?.addEventListener("click", () => {
    closeStageContextMenu();
    void openEditModal();
  });
  ctxImageInfoBtn?.addEventListener("click", () => {
    closeStageContextMenu();
    toggleMetadataPanel();
  });
  ctxSetWallpaperBtn?.addEventListener("click", () => {
    closeStageContextMenu();
    void handleSetDesktopWallpaperCurrentImage();
  });
  ctxRevealInExplorerBtn?.addEventListener("click", () => {
    closeStageContextMenu();
    void handleRevealCurrentImageInExplorer();
  });
  ctxCopyFilePathBtn?.addEventListener("click", () => {
    closeStageContextMenu();
    void handleCopyCurrentFilePath();
  });
  window.addEventListener("click", () => {
    closeBottomMoreMenu();
    closeTitlebarSettingsMenu();
    closeTitlebarMoreMenu();
    closeStageContextMenu();
  });
  themeToggleBtn?.addEventListener("click", () => {
    applyThemeMode(themeMode === "dark" ? "light" : "dark");
  });
  appModalBackdropEl?.addEventListener("click", () => {
    if (!appModalResolver) return;
    closeAppModal(false);
  });
  appModalCancelBtn?.addEventListener("click", () => {
    if (!appModalResolver) return;
    closeAppModal(false);
  });
  appModalOkBtn?.addEventListener("click", () => {
    if (!appModalResolver) return;
    closeAppModal(true);
  });
  updateModalBackdropEl?.addEventListener("click", () => {
    if (!updateModalOpen) return;
    closeUpdateModal();
  });
  updateModalCloseBtn?.addEventListener("click", () => {
    if (!updateModalOpen) return;
    closeUpdateModal();
  });
  updateModalCloseActionBtn?.addEventListener("click", () => {
    if (!updateModalOpen) return;
    closeUpdateModal();
  });
  updateModalOpenPageBtn?.addEventListener("click", () => {
    void openUpdateDownloadPage();
  });
  appLicenseModalBackdropEl?.addEventListener("click", () => {
    if (!appLicenseModalOpen) return;
    closeAppLicenseModal();
  });
  appLicenseModalCloseBtn?.addEventListener("click", () => {
    if (!appLicenseModalOpen) return;
    closeAppLicenseModal();
  });
  editModalBackdropEl?.addEventListener("click", () => {
    if (!editModalOpen) return;
    closeEditModal();
  });
  editCloseBtn?.addEventListener("click", () => {
    closeEditModal();
  });
  editResetBtn?.addEventListener("click", () => {
    void handleResetEditCanvas();
  });
  editCancelBtn?.addEventListener("click", () => {
    closeEditModal();
  });
  editUndoBtn?.addEventListener("click", () => {
    undoEditCanvas();
  });
  editSaveAsBtn?.addEventListener("click", () => {
    void handleSaveEditedImageAs();
  });
  editApplyBtn?.addEventListener("click", () => {
    void handleSaveEditedImage();
  });
  editTabInsertBtn?.addEventListener("click", () => {
    setEditSidebarTab("insert");
  });
  editTabColorBtn?.addEventListener("click", () => {
    setEditSidebarTab("color");
  });
  editTabCropBtn?.addEventListener("click", () => {
    setEditSidebarTab("crop");
  });
  editCropApplyBtn?.addEventListener("click", () => {
    handleApplyEditCrop();
  });
  editCropAspectSelectEl?.addEventListener("change", () => {
    editCropAspectMode = parseEditCropAspectMode(editCropAspectSelectEl.value);
    syncEditCropAspectControls();
    resetEditCropRectForCurrentAspect();
  });
  const handleEditCropCustomAspectInput = () => {
    const changed = syncEditCropCustomAspectStateFromInputs();
    if (editCropAspectMode !== "custom") return;
    if (!changed) return;
    resetEditCropRectForCurrentAspect();
  };
  editCropCustomAspectWidthEl?.addEventListener("input", handleEditCropCustomAspectInput);
  editCropCustomAspectHeightEl?.addEventListener("input", handleEditCropCustomAspectInput);
  const handleEditCropCustomAspectChange = () => {
    const changed = syncEditCropCustomAspectStateFromInputs();
    syncEditCropAspectControls();
    if (editCropAspectMode !== "custom") return;
    if (!changed) return;
    resetEditCropRectForCurrentAspect();
  };
  editCropCustomAspectWidthEl?.addEventListener("change", handleEditCropCustomAspectChange);
  editCropCustomAspectHeightEl?.addEventListener("change", handleEditCropCustomAspectChange);
  editCropSizeWidthEl?.addEventListener("input", () => {
    handleEditCropMetricInput("width");
  });
  editCropSizeHeightEl?.addEventListener("input", () => {
    handleEditCropMetricInput("height");
  });
  editCropTrimTopEl?.addEventListener("input", () => {
    handleEditCropMetricInput("top");
  });
  editCropTrimLeftEl?.addEventListener("input", () => {
    handleEditCropMetricInput("left");
  });
  editCropTrimRightEl?.addEventListener("input", () => {
    handleEditCropMetricInput("right");
  });
  editCropTrimBottomEl?.addEventListener("input", () => {
    handleEditCropMetricInput("bottom");
  });
  for (const buttonEl of editCropStepperBtnEls) {
    buttonEl.addEventListener("mousedown", (e) => {
      e.preventDefault();
    });
    buttonEl.addEventListener("click", () => {
      const field = parseEditCropMetricField(buttonEl.dataset.cropStepField);
      if (!field) return;
      const direction: 1 | -1 = buttonEl.dataset.cropStepDir === "down" ? -1 : 1;
      stepEditCropMetricInput(field, direction);
    });
  }
  editCropCenterHorizontalBtn?.addEventListener("click", () => {
    handleCenterEditCrop("horizontal");
  });
  editCropCenterVerticalBtn?.addEventListener("click", () => {
    handleCenterEditCrop("vertical");
  });
  editTabRotateBtn?.addEventListener("click", () => {
    setEditSidebarTab("rotate");
  });
  editTransformRotateLeftBtn?.addEventListener("click", () => {
    handleApplyEditTransform("rotate-left");
  });
  editTransformRotateRightBtn?.addEventListener("click", () => {
    handleApplyEditTransform("rotate-right");
  });
  editTransformFlipHorizontalBtn?.addEventListener("click", () => {
    handleApplyEditTransform("flip-horizontal");
  });
  editTransformFlipVerticalBtn?.addEventListener("click", () => {
    handleApplyEditTransform("flip-vertical");
  });
  editToolBrushBtn?.addEventListener("click", () => {
    setEditToolMode("brush");
  });
  editToolTextBtn?.addEventListener("click", () => {
    setEditToolMode("text");
  });
  editToolShapeBtn?.addEventListener("click", () => {
    setEditToolMode("shape");
  });
  editToolMosaicBtn?.addEventListener("click", () => {
    setEditToolMode("mosaic");
  });
  editToolBlurBtn?.addEventListener("click", () => {
    setEditToolMode("blur");
  });
  editBrushModeSelectEl?.addEventListener("change", () => {
    const raw = editBrushModeSelectEl.value;
    const mode: EditBrushMode = raw === "erase" ? "erase" : "draw";
    if (mode === editBrushMode) return;
    editBrushMode = mode;
    syncEditTextControls();
    updateEditCursorFromEvent();
  });
  editMosaicStyleSelectEl?.addEventListener("change", () => {
    const raw = editMosaicStyleSelectEl.value;
    const prevStyle = editMosaicStyle;
    let nextStyle: EditMosaicStyle = "brush";
    let nextBrushMode: EditMosaicBrushMode = editMosaicBrushMode;
    if (raw === "rect" || raw === "ellipse") {
      nextStyle = raw;
      nextBrushMode = "draw";
    } else if (raw === "erase") {
      nextStyle = "brush";
      nextBrushMode = "erase";
    } else {
      nextStyle = "brush";
      nextBrushMode = "draw";
    }
    if (nextStyle === editMosaicStyle && nextBrushMode === editMosaicBrushMode) return;
    editMosaicStyle = nextStyle;
    editMosaicBrushMode = nextBrushMode;
    if (editToolMode === "mosaic") {
      if (prevStyle !== "brush" && nextStyle === "brush") {
        setCurrentEditStrokeSizeRatio(EDIT_MOSAIC_BRUSH_SIZE_PERCENT_DEFAULT / 100);
      }
      syncEditSizeValue();
    }
    syncEditTextControls();
    updateEditCursorFromEvent();
  });
  editMosaicIntensityInputEl?.addEventListener("input", () => {
    const raw = Number(editMosaicIntensityInputEl.value);
    if (!Number.isFinite(raw)) return;
    editMosaicIntensityPercent = clampEditMosaicIntensityPercent(raw * EDIT_SIZE_PERCENT_STEP);
    syncEditMosaicIntensityControl();
  });
  editBlurStyleSelectEl?.addEventListener("change", () => {
    const raw = editBlurStyleSelectEl.value;
    const prevStyle = editBlurStyle;
    let nextStyle: EditBlurStyle = "brush";
    let nextBrushMode: EditBlurBrushMode = editBlurBrushMode;
    if (raw === "rect" || raw === "ellipse") {
      nextStyle = raw;
      nextBrushMode = "draw";
    } else if (raw === "erase") {
      nextStyle = "brush";
      nextBrushMode = "erase";
    } else {
      nextStyle = "brush";
      nextBrushMode = "draw";
    }
    if (nextStyle === editBlurStyle && nextBrushMode === editBlurBrushMode) return;
    editBlurStyle = nextStyle;
    editBlurBrushMode = nextBrushMode;
    if (editToolMode === "blur") {
      if (prevStyle !== "brush" && nextStyle === "brush") {
        setCurrentEditStrokeSizeRatio(EDIT_BLUR_BRUSH_SIZE_PERCENT_DEFAULT / 100);
      }
      syncEditSizeValue();
    }
    syncEditTextControls();
    updateEditCursorFromEvent();
  });
  editBlurIntensityInputEl?.addEventListener("input", () => {
    const raw = Number(editBlurIntensityInputEl.value);
    if (!Number.isFinite(raw)) return;
    editBlurIntensityPercent = clampEditBlurIntensityPercent(raw * EDIT_SIZE_PERCENT_STEP);
    syncEditBlurIntensityControl();
  });
  for (const button of editColorToolButtonEls) {
    button.addEventListener("click", () => {
      const kind = parseEditColorLayerKind(button.dataset.colorLayerKind);
      if (!kind) return;
      addEditColorLayer(kind);
    });
  }
  editColorLayerListEl?.addEventListener("click", (e) => {
    const target = e.target as HTMLElement | null;
    if (!target) return;
    const removeButton = target.closest<HTMLButtonElement>("[data-color-layer-remove-id]");
    if (removeButton) {
      const id = Number(removeButton.dataset.colorLayerRemoveId);
      if (Number.isFinite(id)) {
        removeEditColorLayerById(id, true);
      }
      return;
    }
    const selectButton = target.closest<HTMLButtonElement>("[data-color-layer-select-id]");
    if (!selectButton) return;
    const id = Number(selectButton.dataset.colorLayerSelectId);
    if (!Number.isFinite(id)) return;
    selectEditColorLayerById(id);
  });
  editColorLayerValueInputEl?.addEventListener("input", () => {
    applySelectedEditColorLayerFromControl(false);
  });
  editColorLayerValueInputEl?.addEventListener("change", () => {
    applySelectedEditColorLayerFromControl(true);
  });
  editColorLayerResetBtn?.addEventListener("click", () => {
    resetSelectedEditColorLayer(true);
  });
  editColorLutLoadBtn?.addEventListener("click", () => {
    const selectedLayer = getSelectedEditColorLayer();
    if (!selectedLayer || selectedLayer.kind !== "lut") return;
    void loadEditLutFromDialog(selectedLayer, true);
  });
  for (const button of editColorCurveChannelBtnEls) {
    button.addEventListener("click", () => {
      const channel = button.dataset.curveChannel as EditCurveChannel | undefined;
      if (!channel || !EDIT_CURVE_CHANNEL_ORDER.includes(channel)) return;
      const selectedLayer = getSelectedEditColorLayer();
      const curveData = getEditCurveLayerData(selectedLayer);
      if (!curveData || curveData.activeChannel === channel) return;
      curveData.activeChannel = channel;
      syncEditColorCurveChannelButtons(curveData);
      renderEditColorCurveEditor();
    });
  }
  editColorCurveCanvasEl?.addEventListener("pointerdown", handleEditColorCurvePointerDown);
  editColorCurveCanvasEl?.addEventListener("pointermove", handleEditColorCurvePointerMove);
  editColorCurveCanvasEl?.addEventListener("pointerup", handleEditColorCurvePointerUp);
  editColorCurveCanvasEl?.addEventListener("pointercancel", handleEditColorCurvePointerCancel);
  editColorCurveCanvasEl?.addEventListener("contextmenu", (e) => {
    const selectedLayer = getSelectedEditColorLayer();
    if (!selectedLayer || selectedLayer.kind !== "curve") return;
    e.preventDefault();
  });
  editSizeInputEl?.addEventListener("input", () => {
    const ratio = readEditSizeRatioFromControl();
    setCurrentEditStrokeSizeRatio(ratio);
    const selected = getSelectedEditTextItem();
    if (selected && editToolMode === "text") {
      const ctx = getEditCanvasContext();
      if (ctx) {
        selected.size = ratio;
        recalcEditTextItemMetrics(ctx, selected);
        renderEditCanvasFromState();
      }
    }
    syncEditSizeValue();
  });
  editSizeInputEl?.addEventListener("change", () => {
    const selected = getSelectedEditTextItem();
    if (!selected || editToolMode !== "text") return;
    pushEditHistorySnapshot();
  });
  editTextInputEl?.addEventListener("input", () => {
    const selected = getSelectedEditTextItem();
    if (!selected || editToolMode !== "text") return;
    const ctx = getEditCanvasContext();
    if (!ctx) return;
    selected.text = editTextInputEl.value;
    recalcEditTextItemMetrics(ctx, selected);
    renderEditCanvasFromState();
  });
  editTextInputEl?.addEventListener("change", () => {
    const selected = getSelectedEditTextItem();
    if (!selected || editToolMode !== "text") return;
    pushEditHistorySnapshot();
  });
  editTextAlignSelectEl?.addEventListener("change", () => {
    const raw = editTextAlignSelectEl.value;
    const align: EditTextAlign = raw === "center" || raw === "right" ? raw : "left";
    applyEditTextAlign(align);
  });
  editFontSelectEl?.addEventListener("change", () => {
    applyEditTextFontFamily(editFontSelectEl.value);
  });
  editTextDeleteBtn?.addEventListener("click", () => {
    void deleteSelectedEditLayer();
  });
  editColorInputEl?.addEventListener("input", () => {
    applyEditColorFromControl(false);
  });
  editColorInputEl?.addEventListener("change", () => {
    applyEditColorFromControl(true);
  });
  editColorSwatchEls.forEach((el) => {
    el.addEventListener("click", () => {
      const swatchColor = (el.dataset.editColor ?? "").trim();
      if (!/^#[0-9a-fA-F]{6}$/.test(swatchColor)) return;
      if (!editColorInputEl) return;
      editColorInputEl.value = swatchColor;
      applyEditColorFromControl(true);
    });
  });
  editCanvasEl?.addEventListener("pointerdown", handleEditCanvasPointerDown);
  editCanvasEl?.addEventListener("contextmenu", (e) => {
    if (!editModalOpen) return;
    e.preventDefault();
    e.stopPropagation();
  });
  editCanvasEl?.addEventListener("pointermove", handleEditCanvasPointerMove);
  editCanvasEl?.addEventListener("pointerup", finishEditCanvasPointer);
  editCanvasEl?.addEventListener("pointercancel", finishEditCanvasPointer);
  editCropHandleLayerEl?.addEventListener("pointerdown", handleEditCropHandlePointerDown);
  editCropHandleLayerEl?.addEventListener("contextmenu", (e) => {
    if (!editModalOpen || editSidebarTab !== "crop") return;
    e.preventDefault();
    e.stopPropagation();
  });
  editCanvasEl?.addEventListener("pointerleave", () => {
    editCursorHasClientPoint = false;
    hideEditBrushCursor();
    if (!editDrawing) {
      updateEditCursorFromEvent();
    }
  });
  registerDragAndDrop();
  registerPanAndZoom();
  registerTauriDropListener();
  registerTitlebarControls();
  registerShortcuts();

  if (!isTauri()) {
    attachInputFallback();
  }

  updateFolderNavButtons();
  setMetaPanelVisibility(false);
  applyThemeMode(loadThemeMode());
  applyStageBackgroundMode(loadStageBackgroundMode());
  setEditFontSelectOptions(getDefaultEditFontCatalog());
  syncEditFontSelectValue(editCurrentTextFontFamily);
  void ensureEditFontFamiliesLoaded();
  syncEditSidebarTabControls();
  setEditToolMode(editToolMode);
  syncEditSizeValue();
  syncEditColorAdjustControls();
  syncEditColorSwatchSelection(editColorInputEl?.value ?? EDIT_COLOR_DEFAULT);
  setStageAlphaGrid(stageHasAlpha);
  syncTitlebarPickedColorDisplay();
  updateAnimControlsUi();
  updateStatus();
  syncUpdateCheckBadge();
  renderUpdateModal();
  void loadAppVersion();
  void loadUpdateManifest();
  registerDevicePixelRatioWatcher();
  window.addEventListener("resize", handleViewportResize);
  window.addEventListener("resize", scheduleSyncEditCanvasDisplaySize);
  ensureEditCanvasResizeObserver();
  renderTransform();
}

function teardownReloadSensitiveBindings() {
  logDndDebug("teardown-reload-sensitive-bindings");
  teardownDragAndDrop();
  teardownPanAndZoom();
  // Keep native window drop listener intact across full page reloads.
  // Explicit unlisten during reload can cause drag-and-drop to stop until app restart.
}

if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", initializeAppUi, { once: true });
} else {
  initializeAppUi();
}

const hotContext = (import.meta as ImportMeta & {
  hot?: { dispose(callback: () => void): void };
}).hot;

if (hotContext) {
  hotContext.dispose(() => {
    logDndDebug("hot-dispose");
    teardownReloadSensitiveBindings();
    closeBottomMoreMenu();
    closeTitlebarSettingsMenu();
    closeTitlebarMoreMenu();
    closeStageContextMenu();
    hideStageNotice();
    closeUpdateModal();
    closeEditModal();
  });
}

window.addEventListener("beforeunload", () => {
  logDndDebug("beforeunload");
  teardownReloadSensitiveBindings();
  closeTitlebarMoreMenu();
  closeUpdateModal();
  closeEditModal();
  hideStageNavOverlay();
  stopKeyHoldZoom();
  stopPlayback();
  stopZoomAnimation();
  stopThumbnailWheelAnimation();
  if (thumbnailViewportSyncRaf) {
    window.cancelAnimationFrame(thumbnailViewportSyncRaf);
    thumbnailViewportSyncRaf = 0;
  }
  resetThumbnailObserver();
  if (dprMediaQuery && dprMediaQueryListener) {
    dprMediaQuery.removeEventListener("change", dprMediaQueryListener);
  }
  window.removeEventListener("resize", handleViewportResize);
  window.removeEventListener("resize", scheduleSyncEditCanvasDisplaySize);
  if (editCanvasDisplaySyncRaf) {
    window.cancelAnimationFrame(editCanvasDisplaySyncRaf);
    editCanvasDisplaySyncRaf = 0;
  }
  editCanvasWrapResizeObserver?.disconnect();
  editCanvasWrapResizeObserver = null;
});

window.addEventListener("keydown", (e) => {
  if (editModalOpen && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "z") {
    const target = e.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable)
    ) {
      return;
    }
    e.preventDefault();
    undoEditCanvas();
    return;
  }
  if (editModalOpen && !e.ctrlKey && !e.metaKey && !e.altKey && e.key === "Delete") {
    const target = e.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable)
    ) {
      return;
    }
    if (deleteSelectedEditLayer()) {
      e.preventDefault();
    }
    return;
  }
  if (e.key === "Escape" && editModalOpen) {
    e.preventDefault();
    closeEditModal();
    return;
  }
  if (e.key === "Escape" && updateModalOpen) {
    e.preventDefault();
    closeUpdateModal();
    return;
  }
  if (e.key === "Escape" && appLicenseModalOpen) {
    e.preventDefault();
    closeAppLicenseModal();
    return;
  }
  if (e.key === "Escape" && titlebarSettingsMenuOpen) {
    e.preventDefault();
    closeTitlebarSettingsMenu();
    return;
  }
  if (e.key === "Escape" && titlebarMoreMenuOpen) {
    e.preventDefault();
    closeTitlebarMoreMenu();
    return;
  }
  if (e.key === "Escape" && stageContextMenuOpen) {
    e.preventDefault();
    closeStageContextMenu();
    return;
  }
  if (appModalResolver && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
    const canMoveBetweenModalButtons =
      !!appModalCancelBtn &&
      !!appModalOkBtn &&
      appModalCancelBtn.style.display !== "none";
    if (canMoveBetweenModalButtons) {
      e.preventDefault();
      const active = document.activeElement;
      if (active === appModalCancelBtn) {
        appModalOkBtn.focus();
      } else {
        appModalCancelBtn.focus();
      }
    }
    return;
  }
  if (e.key === "Escape" && bottomMoreMenuOpen) {
    e.preventDefault();
    closeBottomMoreMenu();
    return;
  }
  if (e.key !== "Escape") return;
  if (!appModalResolver) return;
  e.preventDefault();
  closeAppModal(false);
});







