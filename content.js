(() => {
  const CONTROLLED_VIDEOS = new WeakMap();
  const BOUND_NATIVE_BUTTONS = new WeakSet();
  const BUTTON_TO_UI = new WeakMap();
  const OBSERVER_CONFIG = { childList: true, subtree: true };
  const DEFAULT_PROGRESS_INSETS = { left: 88, right: 88 };
  const VOLUME_STORAGE_KEY = "rcVolume";
  const MUTE_STORAGE_KEY = "rcMuted";
  const MIN_PROGRESS_WIDTH = 140;
  const CONTEXT_MENU_LABEL = "Share current timestamp";
  const MAX_TIMESTAMP_ATTEMPTS = 6;
  const TIMESTAMP_STORAGE_PREFIX = "rcTimestamp:";
  const TIMESTAMP_TTL_MS = 2 * 60 * 1000;
  let scanQueued = false;
  let contextMenuEl = null;
  let contextMenuItemEl = null;
  let activeContextUi = null;
  let shareTimestampAppliedUrl = null;
  let shareTimestampAppliedVideo = null;
  let timestampNavSeconds = null;
  let timestampNavPath = null;
  const VOLUME_TERMS = [
    "sound",
    "audio",
    "mute",
    "volume",
    "ton",
    "laut",
    "stumm",
  ];
  const LEFT_UI_TERMS = ["tag", "tagged", "person", "people", "mark", "markier"];
  const MUTED_LABEL_TERMS = [
    "muted",
    "sound off",
    "audio off",
    "sound muted",
    "audio muted",
    "stummgeschaltet",
    "ton aus",
    "stumm",
  ];
  const SVG_ORIGINAL = new WeakMap();
  const SVG_UNMUTED = new WeakMap();
  const buildSelectors = (terms) =>
    terms
      .map(
        (term) =>
          [
            `button[aria-label*='${term}' i]`,
            `button[title*='${term}' i]`,
            `[role='button'][aria-label*='${term}' i]`,
            `[role='button'][title*='${term}' i]`,
            `[tabindex][aria-label*='${term}' i]`,
            `[tabindex][title*='${term}' i]`,
          ].join(",")
      )
      .join(",");
  const NATIVE_VOLUME_SELECTORS = buildSelectors(VOLUME_TERMS);
  const LEFT_UI_SELECTORS = buildSelectors(LEFT_UI_TERMS);

  const formatTime = (value) => {
    if (!Number.isFinite(value) || value < 0) {
      return "0:00";
    }
    const minutes = Math.floor(value / 60);
    const seconds = Math.floor(value % 60);
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  };

  const stopEvent = (event) => {
    event.stopPropagation();
  };

  const labelMatches = (value, terms) => {
    if (!value) {
      return false;
    }
    const lower = value.toLowerCase();
    return terms.some((term) => lower.includes(term));
  };

  const getButtonLabel = (button) => {
    if (!button) {
      return "";
    }
    const direct =
      button.getAttribute("aria-label") ||
      button.getAttribute("title") ||
      button.getAttribute("data-tooltip-text") ||
      button.getAttribute("data-tooltip-content");
    if (direct) {
      return direct;
    }
    const descendant = button.querySelector(
      "[aria-label],[title],[data-tooltip-text],[data-tooltip-content]"
    );
    if (descendant) {
      return (
        descendant.getAttribute("aria-label") ||
        descendant.getAttribute("title") ||
        descendant.getAttribute("data-tooltip-text") ||
        descendant.getAttribute("data-tooltip-content") ||
        ""
      );
    }
    return "";
  };

  const setButtonLabel = (button, label) => {
    if (!button || !label) {
      return;
    }
    const nodes = [
      button,
      ...button.querySelectorAll(
        "[aria-label],[title],[data-tooltip-text],[data-tooltip-content]"
      ),
    ];
    nodes.forEach((node) => {
      node.setAttribute("aria-label", label);
      node.setAttribute("title", label);
      node.setAttribute("data-tooltip-content", label);
      node.setAttribute("data-tooltip-text", label);
    });
  };

  const getUnmutedLabel = (label) => {
    const lower = (label || "").toLowerCase();
    if (lower.includes("ton")) {
      return "Ton an";
    }
    if (lower.includes("audio") || lower.includes("sound")) {
      return "Sound on";
    }
    return "Sound on";
  };

  const getMutedLabel = (label) => {
    const lower = (label || "").toLowerCase();
    if (lower.includes("ton")) {
      return "Ton stummgeschaltet";
    }
    if (lower.includes("audio") || lower.includes("sound")) {
      return "Sound off";
    }
    return "Sound off";
  };

  const getUnmutedSvgMarkup = (svg) => {
    if (!svg) {
      return "";
    }
    if (!SVG_ORIGINAL.has(svg)) {
      SVG_ORIGINAL.set(svg, svg.innerHTML);
    }
    if (SVG_UNMUTED.has(svg)) {
      return SVG_UNMUTED.get(svg);
    }
    const original = SVG_ORIGINAL.get(svg) || "";
    const temp = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    temp.innerHTML = original;
    const use = temp.querySelector("use");
    if (use) {
      const href =
        use.getAttribute("href") || use.getAttribute("xlink:href") || "";
      let replacement = href;
      replacement = replacement.replace("sound_off", "sound_on");
      replacement = replacement.replace("volume_off", "volume_on");
      replacement = replacement.replace("audio_off", "audio_on");
      replacement = replacement.replace("muted", "unmuted");
      replacement = replacement.replace("mute", "unmute");
      replacement = replacement.replace("_off", "_on");
      if (replacement !== href && replacement) {
        use.setAttribute("href", replacement);
        use.setAttribute("xlink:href", replacement);
      }
    }
    temp.querySelectorAll("line, polyline").forEach((el) => el.remove());
    temp.querySelectorAll("path, circle, rect").forEach((el) => {
      const stroke = el.getAttribute("stroke");
      const fill = el.getAttribute("fill");
      if (stroke && (!fill || fill === "none")) {
        el.remove();
      }
    });
    const cleaned = temp.innerHTML;
    const result = cleaned && cleaned !== original ? cleaned : "";
    SVG_UNMUTED.set(svg, result);
    return result;
  };

  const distanceToRect = (x, y, rect) => {
    const dx = Math.max(rect.left - x, 0, x - rect.right);
    const dy = Math.max(rect.top - y, 0, y - rect.bottom);
    return Math.hypot(dx, dy);
  };

  const isSmallControl = (rect, videoRect) => {
    const maxSide = Math.min(
      84,
      videoRect.width * 0.28,
      videoRect.height * 0.28
    );
    return rect.width <= maxSide && rect.height <= maxSide;
  };

  const isNearBottomRight = (buttonRect, videoRect) => {
    const margin = Math.min(
      140,
      Math.max(videoRect.width, videoRect.height) * 0.22
    );
    const withinX = buttonRect.right >= videoRect.right - margin;
    const withinY = buttonRect.bottom >= videoRect.bottom - margin;
    const overlapX =
      Math.min(buttonRect.right, videoRect.right) -
      Math.max(buttonRect.left, videoRect.left);
    const overlapY =
      Math.min(buttonRect.bottom, videoRect.bottom) -
      Math.max(buttonRect.top, videoRect.top);
    return withinX && withinY && overlapX > 0 && overlapY > 0;
  };

  const isNearBottomLeft = (buttonRect, videoRect) => {
    const margin = Math.min(
      140,
      Math.max(videoRect.width, videoRect.height) * 0.22
    );
    const withinX = buttonRect.left <= videoRect.left + margin;
    const withinY = buttonRect.bottom >= videoRect.bottom - margin;
    const overlapX =
      Math.min(buttonRect.right, videoRect.right) -
      Math.max(buttonRect.left, videoRect.left);
    const overlapY =
      Math.min(buttonRect.bottom, videoRect.bottom) -
      Math.max(buttonRect.top, videoRect.top);
    return withinX && withinY && overlapX > 0 && overlapY > 0;
  };

  const findClosestVideoToButton = (button) => {
    if (!button) {
      return null;
    }
    const rect = button.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    let best = null;
    let bestDist = Infinity;
    document.querySelectorAll("video").forEach((video) => {
      const videoRect = video.getBoundingClientRect();
      if (videoRect.width <= 0 || videoRect.height <= 0) {
        return;
      }
      const dist = distanceToRect(centerX, centerY, videoRect);
      if (dist < bestDist) {
        bestDist = dist;
        best = video;
      }
    });
    return bestDist <= 240 ? best : null;
  };

  const findVideoAtPoint = (x, y) => {
    let best = null;
    let bestArea = 0;
    document.querySelectorAll("video").forEach((video) => {
      const rect = video.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        return;
      }
      if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
        return;
      }
      const area = rect.width * rect.height;
      if (area > bestArea) {
        bestArea = area;
        best = video;
      }
    });
    return best;
  };

  const isClickableElement = (node) => {
    if (!node) {
      return false;
    }
    if (node.tagName === "BUTTON") {
      return true;
    }
    if (node.getAttribute("role") === "button") {
      return true;
    }
    if (node.hasAttribute("tabindex") && node.tabIndex >= 0) {
      return true;
    }
    return false;
  };

  const findVolumeButtonFromTarget = (target) => {
    if (!(target instanceof Element)) {
      return null;
    }
    const direct = target.closest(NATIVE_VOLUME_SELECTORS);
    if (direct) {
      return direct;
    }
    const clickable = target.closest("button,[role='button'],[tabindex]");
    if (clickable) {
      const video = findClosestVideoToButton(clickable);
      if (video) {
        const buttonRect = clickable.getBoundingClientRect();
        const videoRect = video.getBoundingClientRect();
        if (
          isNearBottomRight(buttonRect, videoRect) &&
          isSmallControl(buttonRect, videoRect) &&
          clickable.querySelector("svg, path, use")
        ) {
          return clickable;
        }
      }
    }
    let node = target;
    for (let depth = 0; node && depth < 6; depth += 1) {
      const label =
        node.getAttribute("aria-label") || node.getAttribute("title");
      if (labelMatches(label, VOLUME_TERMS)) {
        if (isClickableElement(node)) {
          return node;
        }
        const clickable = node.closest("button,[role='button'],[tabindex]");
        if (clickable) {
          return clickable;
        }
      }
      node = node.parentElement;
    }
    return null;
  };

  const isReelsFeedPage = () => {
    const path = window.location.pathname.toLowerCase();
    return path.startsWith("/reels");
  };

  const isHomeFeedPage = () => {
    const path = window.location.pathname.toLowerCase();
    return path === "/" || path === "/home";
  };

  const isFeedPostVideo = (video) => {
    if (!video) {
      return false;
    }
    if (!isHomeFeedPage()) {
      return false;
    }
    return Boolean(video.closest("article"));
  };

  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

  const getStoredVolume = () => {
    try {
      const raw = window.localStorage.getItem(VOLUME_STORAGE_KEY);
      if (raw === null) {
        return null;
      }
      const value = Number(raw);
      if (!Number.isFinite(value)) {
        return null;
      }
      return clamp(value, 0, 1);
    } catch (error) {
      return null;
    }
  };

  const setStoredVolume = (value) => {
    try {
      const clamped = clamp(value, 0, 1);
      window.localStorage.setItem(VOLUME_STORAGE_KEY, String(clamped));
    } catch (error) {
      return;
    }
  };

  const getStoredMute = () => {
    try {
      const raw = window.localStorage.getItem(MUTE_STORAGE_KEY);
      if (raw === null) {
        return null;
      }
      return raw === "1";
    } catch (error) {
      return null;
    }
  };

  const setStoredMute = (isMuted) => {
    try {
      window.localStorage.setItem(MUTE_STORAGE_KEY, isMuted ? "1" : "0");
    } catch (error) {
      return;
    }
  };

  const applyStoredVolume = (video) => {
    if (!video) {
      return;
    }
    const stored = getStoredVolume();
    if (stored === null) {
      return;
    }
    video.volume = stored;
  };

  const rectsOverlap = (a, b) => {
    const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    return overlapX > 0 && overlapY > 0;
  };

  const findVolumeButtonNearVideo = (video) => {
    if (!video) {
      return null;
    }
    const videoRect = video.getBoundingClientRect();
    if (videoRect.width <= 0 || videoRect.height <= 0) {
      return null;
    }
    const candidates = Array.from(
      document.querySelectorAll("button,[role='button'],[tabindex]")
    );
    let best = null;
    let bestScore = Infinity;
    for (const candidate of candidates) {
      if (!candidate || candidate.closest(".rc-overlay")) {
        continue;
      }
      const rect = candidate.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        continue;
      }
      if (!rectsOverlap(rect, videoRect)) {
        continue;
      }
      if (!isNearBottomRight(rect, videoRect)) {
        continue;
      }
      if (!isSmallControl(rect, videoRect)) {
        continue;
      }
      if (!candidate.querySelector("svg, path, use")) {
        continue;
      }
      const score = Math.hypot(videoRect.right - rect.right, videoRect.bottom - rect.bottom);
      if (score < bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
    return best;
  };

  const findLeftButtonNearVideo = (video) => {
    if (!video) {
      return null;
    }
    const videoRect = video.getBoundingClientRect();
    if (videoRect.width <= 0 || videoRect.height <= 0) {
      return null;
    }
    const candidates = Array.from(
      document.querySelectorAll("button,[role='button'],[tabindex]")
    );
    let best = null;
    let bestScore = Infinity;
    for (const candidate of candidates) {
      if (!candidate || candidate.closest(".rc-overlay")) {
        continue;
      }
      const rect = candidate.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        continue;
      }
      if (!rectsOverlap(rect, videoRect)) {
        continue;
      }
      if (!isNearBottomLeft(rect, videoRect)) {
        continue;
      }
      if (!isSmallControl(rect, videoRect)) {
        continue;
      }
      if (!candidate.querySelector("svg, path, use")) {
        continue;
      }
      const score = Math.hypot(
        rect.left - videoRect.left,
        videoRect.bottom - rect.bottom
      );
      if (score < bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
    return best;
  };

  const findClosestButton = (video, selectors, preferLeft) => {
    if (!video || !selectors) {
      return null;
    }
    const videoRect = video.getBoundingClientRect();
    if (videoRect.width <= 0 || videoRect.height <= 0) {
      return null;
    }
    const videoCenterY = videoRect.top + videoRect.height / 2;
    const margin = 32;
    const candidates = Array.from(document.querySelectorAll(selectors));
    let best = null;
    let bestScore = Infinity;
    for (const candidate of candidates) {
      if (!candidate || candidate.closest(".rc-overlay")) {
        continue;
      }
      const rect = candidate.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        continue;
      }
      const overlapY =
        Math.min(rect.bottom, videoRect.bottom) -
        Math.max(rect.top, videoRect.top);
      if (overlapY <= 0) {
        continue;
      }
      const centerX = rect.left + rect.width / 2;
      if (
        centerX < videoRect.left - margin ||
        centerX > videoRect.right + margin
      ) {
        continue;
      }
      const isLeftSide = centerX < videoRect.left + videoRect.width * 0.55;
      const isRightSide = centerX > videoRect.left + videoRect.width * 0.45;
      if (preferLeft && !isLeftSide) {
        continue;
      }
      if (!preferLeft && !isRightSide) {
        continue;
      }
      const dx = preferLeft
        ? Math.abs(rect.right - videoRect.left)
        : Math.abs(videoRect.right - rect.left);
      const dy = Math.abs(videoCenterY - (rect.top + rect.height / 2));
      const score = dx * 0.7 + dy;
      if (score < bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
    return best;
  };

  const findNativeVolumeButton = (video) => {
    let node = video.parentElement;
    for (let depth = 0; node && depth < 8; depth += 1) {
      const candidate = node.querySelector(NATIVE_VOLUME_SELECTORS);
      if (candidate && !candidate.closest(".rc-overlay")) {
        const videoRect = video.getBoundingClientRect();
        const candidateRect = candidate.getBoundingClientRect();
        if (rectsOverlap(videoRect, candidateRect)) {
          return candidate;
        }
      }
      node = node.parentElement;
    }
    const labeled = findClosestButton(video, NATIVE_VOLUME_SELECTORS, false);
    if (labeled) {
      return labeled;
    }
    return findVolumeButtonNearVideo(video);
  };

  const findLeftUiButton = (video) => {
    let node = video.parentElement;
    for (let depth = 0; node && depth < 8; depth += 1) {
      const candidate = node.querySelector(LEFT_UI_SELECTORS);
      if (candidate && !candidate.closest(".rc-overlay")) {
        return candidate;
      }
      node = node.parentElement;
    }
    const labeled = findClosestButton(video, LEFT_UI_SELECTORS, true);
    if (labeled) {
      return labeled;
    }
    return findLeftButtonNearVideo(video);
  };

  const findVideoForButton = (button) => {
    let node = button;
    for (let depth = 0; node && depth < 10; depth += 1) {
      if (node.tagName === "VIDEO") {
        return node;
      }
      const candidate = node.querySelector("video");
      if (candidate) {
        return candidate;
      }
      node = node.parentElement;
    }
    return findClosestVideoToButton(button);
  };

  const updateOverlayBounds = (ui) => {
    if (!ui || !ui.overlay || !ui.video || !ui.host) {
      return;
    }
    const hostRect = ui.host.getBoundingClientRect();
    const videoRect = ui.video.getBoundingClientRect();
    if (
      hostRect.width <= 0 ||
      hostRect.height <= 0 ||
      videoRect.width <= 0 ||
      videoRect.height <= 0
    ) {
      return;
    }
    const top = Math.round(videoRect.top - hostRect.top);
    const left = Math.round(videoRect.left - hostRect.left);
    ui.overlay.style.inset = "auto";
    ui.overlay.style.top = `${top}px`;
    ui.overlay.style.left = `${left}px`;
    ui.overlay.style.width = `${Math.round(videoRect.width)}px`;
    ui.overlay.style.height = `${Math.round(videoRect.height)}px`;
    ui.overlay.style.right = "auto";
    ui.overlay.style.bottom = "auto";
  };

  const positionVolumePopover = (ui) => {
    if (!ui || !ui.volumePopover || !ui.host) {
      return;
    }
    updateLayoutMode(ui);
    updateOverlayBounds(ui);
    const button = ui.nativeButton || findNativeVolumeButton(ui.video);
    if (!button) {
      return;
    }
    ui.nativeButton = button;
    const overlayRect = ui.overlay.getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();
    if (overlayRect.width <= 0 || overlayRect.height <= 0) {
      return;
    }
    const anchorX = buttonRect.left - overlayRect.left + buttonRect.width / 2;
    const anchorY = buttonRect.top - overlayRect.top;
    const popoverHeight = ui.volumePopover.offsetHeight || 0;
    const popoverWidth = ui.volumePopover.offsetWidth || 0;
    const gap = ui.isReels ? 2 : 10;
    const minTop = 8;
    const maxTop = Math.max(minTop, overlayRect.height - popoverHeight - 8);
    let top = clamp(anchorY - popoverHeight - gap, minTop, maxTop);
    let left = anchorX;

    ui.volumePopover.style.left = `${Math.round(left)}px`;
    ui.volumePopover.style.top = `${Math.round(top)}px`;

    if (ui.isReels && popoverWidth && popoverHeight) {
      const popoverRect = ui.volumePopover.getBoundingClientRect();
      if (rectsOverlap(popoverRect, buttonRect)) {
        const shift = Math.round(popoverWidth / 2 + buttonRect.width / 2 + 8);
        const minLeft = popoverWidth / 2 + 8;
        const maxLeft = overlayRect.width - popoverWidth / 2 - 8;
        let nextLeft = anchorX - shift;
        if (nextLeft < minLeft) {
          nextLeft = anchorX + shift;
        }
        left = clamp(nextLeft, minLeft, maxLeft);
        ui.volumePopover.style.left = `${Math.round(left)}px`;

        const updatedRect = ui.volumePopover.getBoundingClientRect();
        if (rectsOverlap(updatedRect, buttonRect)) {
          const belowTop = buttonRect.bottom - overlayRect.top + 6;
          if (belowTop + popoverHeight <= overlayRect.height - 8) {
            top = clamp(belowTop, minTop, maxTop);
          } else {
            top = clamp(anchorY - popoverHeight - 14, minTop, maxTop);
          }
          ui.volumePopover.style.top = `${Math.round(top)}px`;
        }
      }
    }
  };

  const openVolumePopover = (ui) => {
    if (!ui || !ui.volumePopover) {
      return;
    }
    if (ui.closeTimer) {
      window.clearTimeout(ui.closeTimer);
      ui.closeTimer = null;
    }
    if (!ui.volumePopover.classList.contains("rc-open")) {
      ui.volumePopover.classList.add("rc-open");
    }
    positionVolumePopover(ui);
  };

  const triggerNativeToggle = (ui) => {
    if (!ui || !ui.nativeButton || !ui.nativeButton.isConnected) {
      return false;
    }
    ui.allowNativeClick = true;
    ui.nativeButton.click();
    ui.allowNativeClick = false;
    return true;
  };

  const toggleMute = (ui) => {
    if (!ui || !ui.video) {
      return;
    }
    const wasMuted = ui.video.muted;
    if (!triggerNativeToggle(ui)) {
      ui.video.muted = !ui.video.muted;
    }
    if (wasMuted && ui.video.volume === 0) {
      ui.video.volume = 0.5;
    }
    setStoredMute(ui.video.muted);
    updateButtons(ui.video, ui);
  };

  const canUnmuteNow = () => {
    const activation = navigator.userActivation;
    if (!activation) {
      return false;
    }
    return activation.isActive || activation.hasBeenActive;
  };

  const ensureStoredUnmute = (ui) => {
    if (!ui || !ui.video) {
      return;
    }
    const stored = getStoredVolume();
    if (stored === null || stored <= 0) {
      ui.pendingUnmute = false;
      return;
    }
    const storedMute = getStoredMute();
    if (storedMute === true) {
      ui.pendingUnmute = false;
      return;
    }
    if (!canUnmuteNow()) {
      ui.pendingUnmute = true;
      return;
    }
    if (!ui.video.muted) {
      setStoredMute(false);
      ui.pendingUnmute = false;
      return;
    }
    if (!ui.nativeButton || !ui.nativeButton.isConnected) {
      const found = findNativeVolumeButton(ui.video);
      if (found) {
        bindNativeVolumeButton(ui, found);
      }
    }
    if (!triggerNativeToggle(ui)) {
      ui.video.muted = false;
    }
    if (!ui.video.muted) {
      setStoredMute(false);
      ui.pendingUnmute = false;
    }
  };

  const syncNativeVolumeIcon = (ui) => {
    if (!ui) {
      return;
    }
    if (!ui.nativeButton || !ui.nativeButton.isConnected) {
      const found = ui.video ? findNativeVolumeButton(ui.video) : null;
      if (found) {
        bindNativeVolumeButton(ui, found);
      }
    }
    if (!ui.nativeButton) {
      return;
    }
    const label = getButtonLabel(ui.nativeButton);
    const svg = ui.nativeButton.querySelector("svg");
    const isMuted = ui.video ? ui.video.muted || ui.video.volume === 0 : true;

    if (svg && !SVG_ORIGINAL.has(svg)) {
      SVG_ORIGINAL.set(svg, svg.innerHTML);
    }

    if (isMuted) {
      ui.nativeButton.classList.remove("rc-native-unmuted");
      if (svg && SVG_ORIGINAL.has(svg)) {
        const original = SVG_ORIGINAL.get(svg);
        if (svg.innerHTML !== original) {
          svg.innerHTML = original;
        }
      }
      if (label && !labelMatches(label, MUTED_LABEL_TERMS)) {
        setButtonLabel(ui.nativeButton, getMutedLabel(label));
      }
      return;
    }

    let updated = false;
    if (svg && labelMatches(label, MUTED_LABEL_TERMS)) {
      const unmuted = getUnmutedSvgMarkup(svg);
      if (unmuted) {
        svg.innerHTML = unmuted;
        updated = true;
      }
      setButtonLabel(ui.nativeButton, getUnmutedLabel(label));
    }
    if (!updated) {
      ui.nativeButton.classList.add("rc-native-unmuted");
      setButtonLabel(ui.nativeButton, getUnmutedLabel(label || ""));
    }
  };

  const scheduleIconSync = (ui) => {
    if (!ui || !ui.isReels) {
      return;
    }
    if (ui.iconSyncTimer) {
      window.clearTimeout(ui.iconSyncTimer);
    }
    ui.iconSyncTimer = window.setTimeout(() => {
      ui.iconSyncTimer = null;
      syncNativeVolumeIcon(ui);
    }, 140);
  };

  const showVolumeValue = (ui, value) => {
    if (!ui || !ui.volumeValue) {
      return;
    }
    const percent = Math.round(value * 100);
    ui.volumeValue.textContent = `${percent}%`;
    ui.volumePopover.classList.add("rc-show-value");
    if (ui.valueTimer) {
      window.clearTimeout(ui.valueTimer);
    }
    ui.valueTimer = window.setTimeout(() => {
      ui.valueTimer = null;
      ui.volumePopover.classList.remove("rc-show-value");
    }, 900);
  };

  const handleVolumeButtonClick = (ui, event) => {
    if (!ui) {
      return;
    }
    if (event) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
    if (event && event.detail && event.detail > 1) {
      return;
    }
    if (!ui.volumePopover.classList.contains("rc-open")) {
      openVolumePopover(ui);
      return;
    }
    toggleMute(ui);
    openVolumePopover(ui);
  };

  const handleVolumeButtonDoubleClick = (ui, event) => {
    if (!ui) {
      return;
    }
    if (event) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
    toggleMute(ui);
    openVolumePopover(ui);
  };

  const closeVolumePopover = (ui) => {
    if (!ui || !ui.volumePopover) {
      return;
    }
    if (ui.closeTimer) {
      window.clearTimeout(ui.closeTimer);
      ui.closeTimer = null;
    }
    ui.volumePopover.classList.remove("rc-open");
  };

  const scheduleCloseVolumePopover = (ui) => {
    if (!ui || !ui.volumePopover) {
      return;
    }
    if (ui.closeTimer) {
      window.clearTimeout(ui.closeTimer);
    }
    ui.closeTimer = window.setTimeout(() => {
      ui.closeTimer = null;
      if (ui.isButtonHover || ui.isPopoverHover) {
        return;
      }
      ui.volumePopover.classList.remove("rc-open");
    }, 140);
  };

  const updateLayoutMode = (ui) => {
    if (!ui || !ui.overlay) {
      return;
    }
    const isReels = isReelsFeedPage();
    const isFeed = isFeedPostVideo(ui.video);
    if (ui.isReels === isReels && ui.isFeed === isFeed) {
      return;
    }
    ui.isReels = isReels;
    ui.isFeed = isFeed;
    ui.overlay.classList.toggle("rc-reels", isReels);
    ui.overlay.classList.toggle("rc-feed", isFeed);
  };

  const updateProgressInsets = (ui) => {
    if (!ui || !ui.overlay || !ui.host || !ui.video) {
      return;
    }
    updateLayoutMode(ui);
    const overlayRect = ui.overlay.getBoundingClientRect();
    if (overlayRect.width <= 0) {
      return;
    }

    const isCompact = ui.isReels && overlayRect.width < 480;
    if (ui.isCompact !== isCompact) {
      ui.isCompact = isCompact;
      ui.overlay.classList.toggle("rc-compact", isCompact);
    }

    const isReels = ui.isReels;
    let leftInset = isReels ? 16 : 24;
    let rightInset = isReels ? 16 : DEFAULT_PROGRESS_INSETS.right;

    const leftButton = findLeftUiButton(ui.video);
    if (leftButton) {
      const rect = leftButton.getBoundingClientRect();
      leftInset = rect.right - overlayRect.left + 8;
    }

    const rightButton = ui.nativeButton || findNativeVolumeButton(ui.video);
    if (rightButton) {
      const rect = rightButton.getBoundingClientRect();
      rightInset = overlayRect.right - rect.left + 8;
    }

    if (leftButton && !rightButton) {
      rightInset = leftInset;
    }

    leftInset = clamp(leftInset, 16, overlayRect.width - 16);
    rightInset = clamp(rightInset, 16, overlayRect.width - 16);

    const maxTotal = overlayRect.width - MIN_PROGRESS_WIDTH;
    if (leftInset + rightInset > maxTotal) {
      const overflow = leftInset + rightInset - maxTotal;
      const reduceLeft = Math.min(leftInset - 16, overflow / 2);
      const reduceRight = Math.min(rightInset - 16, overflow - reduceLeft);
      leftInset = Math.max(16, Math.round(leftInset - reduceLeft));
      rightInset = Math.max(16, Math.round(rightInset - reduceRight));
    }

    ui.overlay.style.setProperty("--rc-progress-left", `${Math.round(leftInset)}px`);
    ui.overlay.style.setProperty("--rc-progress-right", `${Math.round(rightInset)}px`);
  };

  const buildShareUrl = (video) => {
    const seconds = Math.max(0, Math.floor(video.currentTime || 0));
    const base = resolveShareBaseUrl(video) || window.location.href;
    const url = new URL(base, window.location.origin);
    url.searchParams.set("rc_t", String(seconds));
    return url.toString();
  };

  const PERMALINK_PATH_RE = /^\/(reel|reels|p|tv)\/[^/?#]+/i;

  const resolvePermalink = (href) => {
    if (!href) {
      return null;
    }
    try {
      const url = new URL(href, window.location.origin);
      if (PERMALINK_PATH_RE.test(url.pathname)) {
        return url.toString();
      }
    } catch (error) {
      return null;
    }
    return null;
  };

  const resolveShareBaseUrl = (video) => {
    if (!video) {
      return null;
    }
    const roots = [];
    const article = video.closest("article");
    if (article) {
      roots.push(article);
    }
    let node = video.parentElement;
    for (let depth = 0; node && depth < 4; depth += 1) {
      roots.push(node);
      node = node.parentElement;
    }
    const seen = new Set();
    for (const root of roots) {
      if (!root || seen.has(root)) {
        continue;
      }
      seen.add(root);
      if (root.matches && root.matches("a[href]")) {
        const resolved = resolvePermalink(root.getAttribute("href"));
        if (resolved) {
          return resolved;
        }
      }
      const anchors = Array.from(root.querySelectorAll("a[href]"));
      for (const anchor of anchors) {
        const resolved = resolvePermalink(anchor.getAttribute("href"));
        if (resolved) {
          return resolved;
        }
      }
    }
    const canonical = document.querySelector("link[rel='canonical']");
    if (canonical) {
      const resolved = resolvePermalink(canonical.getAttribute("href"));
      if (resolved) {
        return resolved;
      }
    }
    return null;
  };

  const parseTimestampFromUrl = (urlString) => {
    if (!urlString) {
      return null;
    }
    try {
      const url = new URL(urlString);
      const raw = url.searchParams.get("rc_t");
      if (!raw) {
        return null;
      }
      const seconds = Number.parseInt(raw, 10);
      if (!Number.isFinite(seconds) || seconds < 0) {
        return null;
      }
      return seconds;
    } catch (error) {
      return null;
    }
  };

  const getPathnameSafe = (urlString) => {
    try {
      return new URL(urlString).pathname;
    } catch (error) {
      return null;
    }
  };

  const getTimestampStorageKey = () =>
    `${TIMESTAMP_STORAGE_PREFIX}${window.location.pathname}`;

  const storeTimestamp = (seconds) => {
    try {
      const key = getTimestampStorageKey();
      const payload = {
        value: seconds,
        storedAt: Date.now(),
      };
      window.sessionStorage.setItem(key, JSON.stringify(payload));
    } catch (error) {
      return;
    }
  };

  const readStoredTimestamp = () => {
    try {
      const key = getTimestampStorageKey();
      const raw = window.sessionStorage.getItem(key);
      if (!raw) {
        return null;
      }
      const payload = JSON.parse(raw);
      if (!payload || typeof payload.value !== "number") {
        window.sessionStorage.removeItem(key);
        return null;
      }
      if (Date.now() - (payload.storedAt || 0) > TIMESTAMP_TTL_MS) {
        window.sessionStorage.removeItem(key);
        return null;
      }
      return payload.value;
    } catch (error) {
      return null;
    }
  };

  const clearStoredTimestamp = () => {
    try {
      window.sessionStorage.removeItem(getTimestampStorageKey());
    } catch (error) {
      return;
    }
  };

  const captureInitialTimestamp = () => {
    if (timestampNavSeconds !== null) {
      return;
    }
    const direct = parseTimestampFromUrl(window.location.href);
    if (direct !== null) {
      timestampNavSeconds = direct;
      timestampNavPath = getPathnameSafe(window.location.href);
      storeTimestamp(direct);
      return;
    }
    const referrer = parseTimestampFromUrl(document.referrer);
    if (referrer !== null) {
      timestampNavSeconds = referrer;
      timestampNavPath =
        getPathnameSafe(document.referrer) || window.location.pathname;
      storeTimestamp(referrer);
    }
  };

  const clearTimestampNavigation = () => {
    timestampNavSeconds = null;
    timestampNavPath = null;
  };

  const getTimestampFromUrl = () => {
    captureInitialTimestamp();
    if (timestampNavSeconds !== null) {
      return timestampNavSeconds;
    }
    if (!timestampNavPath || timestampNavPath !== window.location.pathname) {
      return null;
    }
    return readStoredTimestamp();
  };

  const shouldAutoPauseForTimestamp = () => {
    if (timestampNavSeconds === null || !timestampNavPath) {
      return false;
    }
    return timestampNavPath === window.location.pathname && isReelsFeedPage();
  };

  captureInitialTimestamp();

  const getVisibleArea = (rect) => {
    const visibleX = Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0);
    const visibleY =
      Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0);
    if (visibleX <= 0 || visibleY <= 0) {
      return 0;
    }
    return visibleX * visibleY;
  };

  const getPrimaryVideoInView = () => {
    const centerVideo = findVideoAtPoint(
      window.innerWidth / 2,
      window.innerHeight / 2
    );
    if (centerVideo) {
      return centerVideo;
    }
    let best = null;
    let bestArea = 0;
    document.querySelectorAll("video").forEach((video) => {
      const rect = video.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        return;
      }
      const area = getVisibleArea(rect);
      if (area > bestArea) {
        bestArea = area;
        best = video;
      }
    });
    return best;
  };

  const getPrimaryUi = () => {
    const primary = getPrimaryVideoInView();
    if (!primary) {
      return null;
    }
    return CONTROLLED_VIDEOS.get(primary) || null;
  };

  const applyTimestampFromUrl = (ui) => {
    if (!ui || !ui.video) {
      return;
    }
    const seconds = getTimestampFromUrl();
    if (seconds === null) {
      return;
    }
    if (shouldAutoPauseForTimestamp() && !ui.timestampPauseApplied) {
      ui.video.pause();
      ui.timestampPauseApplied = true;
      ui.pendingPlay = true;
      const stored = getStoredVolume();
      const storedMute = getStoredMute();
      if (stored !== null && stored > 0 && storedMute !== true) {
        ui.pendingUnmute = true;
      }
    }
    const url = window.location.href;
    if (ui.timestampUrl !== url) {
      ui.timestampUrl = url;
      ui.timestampAttempts = 0;
    }
    if (shareTimestampAppliedUrl === url && shareTimestampAppliedVideo === ui.video) {
      return;
    }
    const primary = getPrimaryVideoInView();
    if (primary && primary !== ui.video) {
      return;
    }
    if (ui.timestampAttempts >= MAX_TIMESTAMP_ATTEMPTS) {
      return;
    }
    if (ui.timestampTimer) {
      return;
    }
    ui.timestampTimer = window.setTimeout(() => {
      ui.timestampTimer = null;
      if (!Number.isFinite(ui.video.duration) || ui.video.duration <= 0) {
        ui.timestampAttempts += 1;
        applyTimestampFromUrl(ui);
        return;
      }
      const target = clamp(seconds, 0, Math.max(0, ui.video.duration - 0.05));
      if (Math.abs(ui.video.currentTime - target) > 0.4) {
        if (typeof ui.video.fastSeek === "function") {
          ui.video.fastSeek(target);
        } else {
          ui.video.currentTime = target;
        }
      }
      updateTimeAndProgress(ui.video, ui);
      ui.timestampAttempts += 1;
      window.setTimeout(() => {
        if (shareTimestampAppliedUrl === url && shareTimestampAppliedVideo === ui.video) {
          return;
        }
        const diff = Math.abs(ui.video.currentTime - target);
        if (diff <= 0.6) {
          shareTimestampAppliedUrl = url;
          shareTimestampAppliedVideo = ui.video;
          clearStoredTimestamp();
          clearTimestampNavigation();
          return;
        }
        applyTimestampFromUrl(ui);
      }, 220);
    }, 120);
  };

  const copyToClipboard = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (error) {
      try {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        textarea.style.left = "-9999px";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        textarea.remove();
        return true;
      } catch (fallbackError) {
        return false;
      }
    }
  };

  const closeContextMenu = () => {
    if (!contextMenuEl) {
      return;
    }
    contextMenuEl.classList.remove("rc-open");
    activeContextUi = null;
  };

  const positionContextMenu = (x, y) => {
    if (!contextMenuEl) {
      return;
    }
    const rect = contextMenuEl.getBoundingClientRect();
    const padding = 8;
    const left = clamp(x, padding, window.innerWidth - rect.width - padding);
    const top = clamp(y, padding, window.innerHeight - rect.height - padding);
    contextMenuEl.style.left = `${Math.round(left)}px`;
    contextMenuEl.style.top = `${Math.round(top)}px`;
  };

  const openContextMenu = (x, y, ui) => {
    if (!contextMenuEl || !ui) {
      return;
    }
    activeContextUi = ui;
    contextMenuItemEl.textContent = CONTEXT_MENU_LABEL;
    contextMenuEl.classList.add("rc-open");
    contextMenuEl.style.left = `${Math.round(x)}px`;
    contextMenuEl.style.top = `${Math.round(y)}px`;
    window.requestAnimationFrame(() => positionContextMenu(x, y));
  };

  const ensureContextMenu = () => {
    if (contextMenuEl) {
      return;
    }
    const menu = document.createElement("div");
    menu.className = "rc-context-menu";
    const item = document.createElement("button");
    item.type = "button";
    item.className = "rc-context-item";
    item.textContent = CONTEXT_MENU_LABEL;
    menu.appendChild(item);
    document.body.appendChild(menu);
    contextMenuEl = menu;
    contextMenuItemEl = item;

    item.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!activeContextUi) {
        closeContextMenu();
        return;
      }
      const link = buildShareUrl(activeContextUi.video);
      const copied = await copyToClipboard(link);
      contextMenuItemEl.textContent = copied
        ? "Copied timestamp link"
        : "Copy failed";
      window.setTimeout(() => {
        if (contextMenuItemEl) {
          contextMenuItemEl.textContent = CONTEXT_MENU_LABEL;
        }
      }, 1200);
      closeContextMenu();
    });

    document.addEventListener(
      "click",
      (event) => {
        if (!contextMenuEl || !contextMenuEl.classList.contains("rc-open")) {
          return;
        }
        if (contextMenuEl.contains(event.target)) {
          return;
        }
        closeContextMenu();
      },
      true
    );
    document.addEventListener("scroll", closeContextMenu, true);
    window.addEventListener("resize", closeContextMenu);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeContextMenu();
      }
    });
  };

  const scheduleLayoutUpdate = (ui) => {
    if (!ui || ui.layoutQueued) {
      return;
    }
    ui.layoutQueued = true;
    window.requestAnimationFrame(() => {
      ui.layoutQueued = false;
      updateOverlayBounds(ui);
      updateProgressInsets(ui);
      if (ui.volumePopover.classList.contains("rc-open")) {
        positionVolumePopover(ui);
      }
    });
  };

  const bindNativeVolumeButton = (ui, nativeButton) => {
    if (!ui || !nativeButton) {
      return;
    }
    ui.nativeButton = nativeButton;
    BUTTON_TO_UI.set(nativeButton, ui);
    scheduleLayoutUpdate(ui);
    if (BOUND_NATIVE_BUTTONS.has(nativeButton)) {
      return;
    }
    BOUND_NATIVE_BUTTONS.add(nativeButton);
    nativeButton.dataset.rcBound = "1";

    const resolveUi = () => BUTTON_TO_UI.get(nativeButton);

    const handlePointerEnter = (event) => {
      const currentUi = resolveUi();
      if (!currentUi || event.pointerType === "touch") {
        return;
      }
      currentUi.isButtonHover = true;
      openVolumePopover(currentUi);
    };

    const handlePointerLeave = (event) => {
      const currentUi = resolveUi();
      if (!currentUi || event.pointerType === "touch") {
        return;
      }
      currentUi.isButtonHover = false;
      scheduleCloseVolumePopover(currentUi);
    };

    const handleClick = (event) => {
      const currentUi = resolveUi();
      if (!currentUi) {
        return;
      }
      if (currentUi.allowNativeClick) {
        currentUi.allowNativeClick = false;
        return;
      }
      handleVolumeButtonClick(currentUi, event);
    };

    const handleDoubleClick = (event) => {
      const currentUi = resolveUi();
      if (!currentUi) {
        return;
      }
      handleVolumeButtonDoubleClick(currentUi, event);
    };

    const handleKeyDown = (event) => {
      const currentUi = resolveUi();
      if (!currentUi) {
        return;
      }
      if (event.key === "Enter" || event.key === " ") {
        handleVolumeButtonClick(currentUi, event);
      }
    };

    nativeButton.addEventListener("pointerenter", handlePointerEnter, true);
    nativeButton.addEventListener("pointerleave", handlePointerLeave, true);
    nativeButton.addEventListener("click", handleClick, true);
    nativeButton.addEventListener("dblclick", handleDoubleClick, true);
    nativeButton.addEventListener("keydown", handleKeyDown, true);
  };

  const resolveUiForButton = (button) => {
    if (!button) {
      return null;
    }
    const mapped = BUTTON_TO_UI.get(button);
    if (mapped) {
      return mapped;
    }
    const video = findVideoForButton(button);
    if (!video) {
      return null;
    }
    attachControls(video);
    const ui = CONTROLLED_VIDEOS.get(video);
    if (!ui) {
      return null;
    }
    bindNativeVolumeButton(ui, button);
    return ui;
  };

  const updateButtons = (video, ui) => {
    const isMuted = video.muted || video.volume === 0;
    ui.overlay.classList.toggle("rc-muted", isMuted);
    ui.statusIcon.classList.toggle("rc-paused", video.paused);
    syncNativeVolumeIcon(ui);
    scheduleIconSync(ui);
  };

  const updateTimeAndProgress = (video, ui) => {
    if (!Number.isFinite(video.duration) || video.duration <= 0) {
      ui.timeText.textContent = "0:00 / 0:00";
      ui.seekSlider.value = "0";
      return;
    }

    ui.timeText.textContent = `${formatTime(video.currentTime)} / ${formatTime(
      video.duration
    )}`;

    if (!ui.isSeeking) {
      const percent = (video.currentTime / video.duration) * 100;
      ui.seekSlider.value = `${Math.min(Math.max(percent, 0), 100)}`;
    }
  };

  const buildOverlay = (video, host) => {
    const overlay = document.createElement("div");
    overlay.className = "rc-overlay";

    const volumePopover = document.createElement("div");
    volumePopover.className = "rc-volume-popover";

    const volumeSlider = document.createElement("input");
    volumeSlider.className = "rc-slider rc-volume rc-vertical";
    volumeSlider.type = "range";
    volumeSlider.min = "0";
    volumeSlider.max = "100";
    volumeSlider.value = `${Math.round(video.volume * 100)}`;

    const volumeValue = document.createElement("div");
    volumeValue.className = "rc-volume-value";
    volumeValue.textContent = `${Math.round(video.volume * 100)}%`;

    const volumeTrack = document.createElement("div");
    volumeTrack.className = "rc-volume-track";
    volumeTrack.append(volumeSlider);

    volumePopover.append(volumeTrack, volumeValue);

    const progress = document.createElement("div");
    progress.className = "rc-progress";

    const seekSlider = document.createElement("input");
    seekSlider.className = "rc-slider rc-seek";
    seekSlider.type = "range";
    seekSlider.min = "0";
    seekSlider.max = "100";
    seekSlider.value = "0";

    const timeLabel = document.createElement("div");
    timeLabel.className = "rc-time";
    const statusIcon = document.createElement("span");
    statusIcon.className = "rc-status";
    statusIcon.innerHTML =
      '<svg class="rc-icon rc-icon-play" viewBox="0 0 12 12" aria-hidden="true" focusable="false">' +
      '<path d="M3 2.2L9.8 6 3 9.8V2.2Z" fill="currentColor"></path>' +
      "</svg>" +
      '<svg class="rc-icon rc-icon-pause" viewBox="0 0 12 12" aria-hidden="true" focusable="false">' +
      '<rect x="2.3" y="2.2" width="2.3" height="7.6" rx="0.6" fill="currentColor"></rect>' +
      '<rect x="7.4" y="2.2" width="2.3" height="7.6" rx="0.6" fill="currentColor"></rect>' +
      "</svg>";

    const timeText = document.createElement("span");
    timeText.className = "rc-time-text";
    timeText.textContent = "0:00 / 0:00";

    timeLabel.append(statusIcon, timeText);

    progress.append(timeLabel, seekSlider);

    overlay.append(volumePopover, progress);

    const ui = {
      overlay,
      host,
      video,
      nativeButton: null,
      volumePopover,
      volumeSlider,
      volumeValue,
      seekSlider,
      timeLabel,
      timeText,
      statusIcon,
      isSeeking: false,
      isButtonHover: false,
      isPopoverHover: false,
      closeTimer: null,
      layoutQueued: false,
      allowNativeClick: false,
      valueTimer: null,
      isReels: false,
      isCompact: false,
      isFeed: false,
      iconSyncTimer: null,
      pendingUnmute: false,
      pendingPlay: false,
      timestampPauseApplied: false,
      timestampAttempts: 0,
      timestampTimer: null,
      timestampUrl: null,
    };

    const handleDocumentPointerDown = (event) => {
      if (!volumePopover.classList.contains("rc-open")) {
        return;
      }
      if (volumePopover.contains(event.target)) {
        return;
      }
      if (ui.nativeButton && ui.nativeButton.contains(event.target)) {
        return;
      }
      closeVolumePopover(ui);
    };

    document.addEventListener("pointerdown", handleDocumentPointerDown, true);
    window.addEventListener("scroll", () => scheduleLayoutUpdate(ui), true);
    window.addEventListener("resize", () => scheduleLayoutUpdate(ui));
    host.addEventListener("pointerenter", () => scheduleLayoutUpdate(ui));

    volumePopover.addEventListener("pointerdown", stopEvent);
    volumePopover.addEventListener("pointerenter", () => {
      ui.isPopoverHover = true;
      openVolumePopover(ui);
    });
    volumePopover.addEventListener("pointerleave", () => {
      ui.isPopoverHover = false;
      scheduleCloseVolumePopover(ui);
    });

    volumeSlider.addEventListener("input", (event) => {
      stopEvent(event);
      const value = Number(volumeSlider.value) / 100;
      video.volume = value;
      if (video.muted && value > 0) {
        if (!triggerNativeToggle(ui)) {
          video.muted = false;
        }
      }
      if (value > 0) {
        setStoredMute(false);
      }
      setStoredVolume(value);
      showVolumeValue(ui, value);
      updateButtons(video, ui);
    });

    const beginSeek = (event) => {
      stopEvent(event);
      ui.isSeeking = true;
    };

    const endSeek = (event) => {
      stopEvent(event);
      ui.isSeeking = false;
      updateTimeAndProgress(video, ui);
    };

    seekSlider.addEventListener("pointerdown", beginSeek);
    seekSlider.addEventListener("pointerup", endSeek);
    seekSlider.addEventListener("pointercancel", endSeek);

    seekSlider.addEventListener("input", (event) => {
      stopEvent(event);
      if (!Number.isFinite(video.duration) || video.duration <= 0) {
        return;
      }
      const value = Number(seekSlider.value) / 100;
      video.currentTime = value * video.duration;
      updateTimeAndProgress(video, ui);
    });

    overlay.addEventListener("click", stopEvent);
    overlay.addEventListener("pointerdown", stopEvent);
    overlay.addEventListener("pointerup", stopEvent);

    video.addEventListener("play", () => {
      applyStoredVolume(video);
      updateButtons(video, ui);
      applyTimestampFromUrl(ui);
    });
    video.addEventListener("pause", () => updateButtons(video, ui));
    video.addEventListener("volumechange", () => {
      const value = Math.round(video.volume * 100);
      volumeSlider.value = `${value}`;
      volumeValue.textContent = `${value}%`;
      if (!video.muted) {
        setStoredVolume(video.volume);
      }
      updateButtons(video, ui);
    });
    video.addEventListener("timeupdate", () => updateTimeAndProgress(video, ui));
    const handleMetadata = () => {
      updateTimeAndProgress(video, ui);
      applyTimestampFromUrl(ui);
    };

    video.addEventListener("durationchange", handleMetadata);
    video.addEventListener("loadedmetadata", handleMetadata);

    updateLayoutMode(ui);
    updateButtons(video, ui);
    updateTimeAndProgress(video, ui);
    if (video.readyState >= 1) {
      applyTimestampFromUrl(ui);
    }

    return ui;
  };

  const ensureHostPositioning = (host) => {
    if (host.dataset.rcHost === "1") {
      return;
    }
    host.dataset.rcHost = "1";
    host.classList.add("rc-host");
    const computed = window.getComputedStyle(host);
    if (computed.position === "static") {
      host.style.position = "relative";
    }
  };

  const attachControls = (video) => {
    if (!video || !video.isConnected) {
      return;
    }

    const nativeButton = findNativeVolumeButton(video);

    const existingUi = CONTROLLED_VIDEOS.get(video);
    if (existingUi) {
      if (nativeButton) {
        bindNativeVolumeButton(existingUi, nativeButton);
      }
      ensureStoredUnmute(existingUi);
      return;
    }

    const host = video.parentElement;
    if (!host) {
      return;
    }

    ensureHostPositioning(host);

    applyStoredVolume(video);

    const ui = buildOverlay(video, host);
    host.appendChild(ui.overlay);
    CONTROLLED_VIDEOS.set(video, ui);
    scheduleLayoutUpdate(ui);

    if (nativeButton) {
      bindNativeVolumeButton(ui, nativeButton);
    }
    ensureStoredUnmute(ui);
  };

  const scanForVideos = () => {
    document.querySelectorAll("video").forEach((video) => {
      attachControls(video);
      const ui = CONTROLLED_VIDEOS.get(video);
      if (ui) {
        scheduleLayoutUpdate(ui);
      }
    });
  };

  const scheduleScan = () => {
    if (scanQueued) {
      return;
    }
    scanQueued = true;
    window.requestAnimationFrame(() => {
      scanQueued = false;
      scanForVideos();
    });
  };

  const startObserver = () => {
    if (!document.body) {
      return;
    }
    const observer = new MutationObserver(scheduleScan);
    observer.observe(document.body, OBSERVER_CONFIG);
  };

  const bindGlobalVolumeHandlers = () => {
    if (document.documentElement.dataset.rcGlobalVolume === "1") {
      return;
    }
    document.documentElement.dataset.rcGlobalVolume = "1";

    const handleGlobalClick = (event) => {
      if (event && event.isTrusted === false) {
        return;
      }
      const target = event.target instanceof Element ? event.target : null;
      if (!target) {
        return;
      }
      const button = findVolumeButtonFromTarget(target);
      if (!button || button.dataset.rcBound === "1") {
        return;
      }
      const ui = resolveUiForButton(button);
      if (!ui) {
        return;
      }
      handleVolumeButtonClick(ui, event);
    };

    const handleGlobalDoubleClick = (event) => {
      if (event && event.isTrusted === false) {
        return;
      }
      const target = event.target instanceof Element ? event.target : null;
      if (!target) {
        return;
      }
      const button = findVolumeButtonFromTarget(target);
      if (!button || button.dataset.rcBound === "1") {
        return;
      }
      const ui = resolveUiForButton(button);
      if (!ui) {
        return;
      }
      handleVolumeButtonDoubleClick(ui, event);
    };

    document.addEventListener("click", handleGlobalClick, true);
    document.addEventListener("dblclick", handleGlobalDoubleClick, true);
  };

  const bindShareContextMenu = () => {
    if (document.documentElement.dataset.rcShareMenu === "1") {
      return;
    }
    document.documentElement.dataset.rcShareMenu = "1";
    ensureContextMenu();

    const handleContextMenu = (event) => {
      const target = event.target instanceof Element ? event.target : null;
      const x = event.clientX;
      const y = event.clientY;
      let video = null;
      if (target) {
        video = target.closest("video");
      }
      if (!video) {
        video = findVideoAtPoint(x, y);
      }
      if (!video) {
        return;
      }
      attachControls(video);
      const ui = CONTROLLED_VIDEOS.get(video);
      if (!ui) {
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      openContextMenu(x, y, ui);
    };

    document.addEventListener("contextmenu", handleContextMenu, true);
  };

  const bindUserActivationHandlers = () => {
    if (document.documentElement.dataset.rcActivation === "1") {
      return;
    }
    document.documentElement.dataset.rcActivation = "1";

    const handleActivation = (event) => {
      const ui = getPrimaryUi();
      if (!ui || (!ui.pendingUnmute && !ui.pendingPlay)) {
        return;
      }
      if (event && event.isTrusted === false) {
        return;
      }
      const target = event && event.target instanceof Element ? event.target : null;
      if (target && !ui.host.contains(target)) {
        return;
      }
      if (event && typeof event.preventDefault === "function") {
        event.preventDefault();
      }
      if (event && typeof event.stopImmediatePropagation === "function") {
        event.stopImmediatePropagation();
      }
      applyStoredVolume(ui.video);
      ensureStoredUnmute(ui);
      updateButtons(ui.video, ui);
      syncNativeVolumeIcon(ui);
      if (ui.pendingPlay && ui.video.paused) {
        const playPromise = ui.video.play();
        if (playPromise && typeof playPromise.catch === "function") {
          playPromise.catch(() => {});
        }
      }
      ui.pendingPlay = false;
    };

    document.addEventListener("click", handleActivation, true);
    document.addEventListener("keydown", handleActivation, true);
  };

  const init = () => {
    scanForVideos();
    startObserver();
    bindGlobalVolumeHandlers();
    bindShareContextMenu();
    bindUserActivationHandlers();
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
