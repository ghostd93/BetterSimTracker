import { ensureStyles } from "./ui";

const MOOD_PREVIEW_BACKDROP_CLASS = "bst-mood-preview-backdrop";
const MOOD_PREVIEW_MODAL_CLASS = "bst-mood-preview-modal";
const MOOD_PREVIEW_DIALOG_CLASS = "bst-mood-preview-dialog";
const MOOD_PREVIEW_BODY_CLASS = "bst-mood-preview-open";

let moodPreviewKeyListener: ((event: KeyboardEvent) => void) | null = null;
let moodPreviewOpenedAt = 0;

export function openMoodImageModal(imageUrl: string, altText: string, characterName?: string, moodText?: string): void {
  ensureStyles();
  closeMoodImageModal(true);
  moodPreviewOpenedAt = Date.now();

  const modal = document.createElement("div");
  modal.className = MOOD_PREVIEW_MODAL_CLASS;

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "bst-mood-preview-close";
  closeButton.setAttribute("aria-label", "Close image preview");
  closeButton.innerHTML = "&times;";
  closeButton.addEventListener("click", () => closeMoodImageModal());

  const image = document.createElement("img");
  image.className = "bst-mood-preview-image";
  image.src = imageUrl;
  image.alt = altText || "Mood image";
  image.addEventListener("click", () => {
    if (Date.now() - moodPreviewOpenedAt < 220) return;
    closeMoodImageModal();
  });

  const caption = document.createElement("div");
  caption.className = "bst-mood-preview-caption";
  const captionParts = [characterName, moodText].filter(part => typeof part === "string" && part.trim());
  caption.textContent = captionParts.length ? captionParts.join(" - ") : (altText || "Mood image");

  modal.style.setProperty("position", "relative", "important");
  modal.style.setProperty("width", "min(960px, 94vw)", "important");
  modal.style.setProperty("max-height", "calc(100dvh - 24px)", "important");
  modal.style.setProperty("display", "grid", "important");
  modal.style.setProperty("grid-template-rows", "auto auto", "important");
  modal.style.setProperty("place-items", "center", "important");
  modal.style.setProperty("gap", "10px", "important");
  modal.style.setProperty("z-index", "2147483647", "important");

  image.style.setProperty("max-width", "100%", "important");
  image.style.setProperty("max-height", "calc(100dvh - 24px)", "important");
  image.style.setProperty("object-fit", "contain", "important");

  modal.appendChild(closeButton);
  modal.appendChild(image);
  modal.appendChild(caption);

  const canUseDialog = typeof window.HTMLDialogElement !== "undefined"
    && typeof document.createElement("dialog").showModal === "function";

  if (canUseDialog) {
    const dialog = document.createElement("dialog");
    dialog.className = MOOD_PREVIEW_DIALOG_CLASS;
    dialog.style.setProperty("position", "fixed", "important");
    dialog.style.setProperty("inset", "0", "important");
    dialog.style.setProperty("display", "grid", "important");
    dialog.style.setProperty("place-items", "center", "important");
    dialog.style.setProperty("margin", "0", "important");
    dialog.style.setProperty("width", "100vw", "important");
    dialog.style.setProperty("height", "100dvh", "important");
    dialog.style.setProperty("max-width", "100vw", "important");
    dialog.style.setProperty("max-height", "100dvh", "important");
    dialog.style.setProperty("padding", "12px", "important");
    dialog.style.setProperty("border", "0", "important");
    dialog.style.setProperty("background", "transparent", "important");
    dialog.style.setProperty("overflow", "auto", "important");
    dialog.style.setProperty("z-index", "2147483647", "important");
    dialog.style.setProperty("pointer-events", "auto", "important");

    dialog.appendChild(modal);
    dialog.addEventListener("click", event => {
      if (Date.now() - moodPreviewOpenedAt < 220) return;
      if (event.target === dialog) {
        closeMoodImageModal();
      }
    });
    dialog.addEventListener("cancel", event => {
      event.preventDefault();
      closeMoodImageModal();
    });
    document.body.appendChild(dialog);
    try {
      dialog.showModal();
    } catch {
      dialog.setAttribute("open", "");
    }
    document.body.classList.add(MOOD_PREVIEW_BODY_CLASS);
    document.documentElement.classList.add(MOOD_PREVIEW_BODY_CLASS);
  } else {
    const backdrop = document.createElement("div");
    backdrop.className = MOOD_PREVIEW_BACKDROP_CLASS;
    backdrop.style.setProperty("position", "fixed", "important");
    backdrop.style.setProperty("inset", "0", "important");
    backdrop.style.setProperty("display", "grid", "important");
    backdrop.style.setProperty("place-items", "center", "important");
    backdrop.style.setProperty("padding", "12px", "important");
    backdrop.style.setProperty("background", "rgba(0,0,0,0.72)", "important");
    backdrop.style.setProperty("z-index", "2147483647", "important");
    backdrop.style.setProperty("overflow", "auto", "important");
    backdrop.appendChild(modal);
    backdrop.addEventListener("click", event => {
      if (Date.now() - moodPreviewOpenedAt < 220) return;
      if (event.target === backdrop) {
        closeMoodImageModal();
      }
    });
    backdrop.addEventListener("touchend", event => {
      if (Date.now() - moodPreviewOpenedAt < 220) return;
      if (event.target === backdrop) {
        closeMoodImageModal();
      }
    }, { passive: true });
    document.body.appendChild(backdrop);
    document.body.classList.add(MOOD_PREVIEW_BODY_CLASS);
    document.documentElement.classList.add(MOOD_PREVIEW_BODY_CLASS);
    backdrop.style.opacity = "1";
  }

  modal.style.transform = "none";

  moodPreviewKeyListener = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      closeMoodImageModal();
    }
  };
  document.addEventListener("keydown", moodPreviewKeyListener);
}

export function closeMoodImageModal(immediate = false): void {
  const dialog = document.querySelector(`.${MOOD_PREVIEW_DIALOG_CLASS}`) as HTMLDialogElement | null;
  const backdrop = document.querySelector(`.${MOOD_PREVIEW_BACKDROP_CLASS}`) as HTMLElement | null;
  if (!dialog && !backdrop) {
    document.body.classList.remove(MOOD_PREVIEW_BODY_CLASS);
    document.documentElement.classList.remove(MOOD_PREVIEW_BODY_CLASS);
    if (moodPreviewKeyListener) {
      document.removeEventListener("keydown", moodPreviewKeyListener);
      moodPreviewKeyListener = null;
    }
    moodPreviewOpenedAt = 0;
    return;
  }
  if (moodPreviewKeyListener) {
    document.removeEventListener("keydown", moodPreviewKeyListener);
    moodPreviewKeyListener = null;
  }

  if (dialog) {
    if (dialog.open) {
      try {
        dialog.close();
      } catch {
        // Ignore close errors from already-closing dialog.
      }
    }
    dialog.remove();
  }

  if (!backdrop) {
    document.body.classList.remove(MOOD_PREVIEW_BODY_CLASS);
    document.documentElement.classList.remove(MOOD_PREVIEW_BODY_CLASS);
    moodPreviewOpenedAt = 0;
    return;
  }
  if (immediate) {
    backdrop.remove();
    document.body.classList.remove(MOOD_PREVIEW_BODY_CLASS);
    document.documentElement.classList.remove(MOOD_PREVIEW_BODY_CLASS);
    moodPreviewOpenedAt = 0;
    return;
  }
  if (backdrop.classList.contains("is-closing")) return;
  backdrop.classList.add("is-closing");
  window.setTimeout(() => {
    backdrop.remove();
    document.body.classList.remove(MOOD_PREVIEW_BODY_CLASS);
    document.documentElement.classList.remove(MOOD_PREVIEW_BODY_CLASS);
    moodPreviewOpenedAt = 0;
  }, 150);
}
