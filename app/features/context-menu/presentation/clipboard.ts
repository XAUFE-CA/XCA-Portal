/**
 * Region-level actions shared by every mounted context menu: copying text and
 * reading the current selection. Kept apart from the menu state so a region can
 * reuse them without opening a panel.
 * 各挂载区域共用的操作：复制文本与读取当前选区。与菜单状态分开，区域无需打开面板也能复用。
 */
export async function copyText(text: string): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.clipboard) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Selected text inside a region. A text field keeps its own selection in
 * `selectionStart`/`selectionEnd` rather than the document selection, so a selected
 * editor inside the region is read first; the document selection covers everything else.
 * 区域内选中的文本。文本输入框的选区保存在自身的 selectionStart/selectionEnd，而不是文档选区，
 * 因此先读取区域内已选中的编辑器，其余情况再读文档选区。
 */
export function selectionWithin(root: Element | null): string {
  if (root === null || typeof window === "undefined") return "";

  // A page selection wins: selecting inside a text field never populates it, so a
  // non-empty document selection always describes what the visitor highlighted.
  // 页面选区优先：在输入框内选择不会写入文档选区，因此非空的文档选区总是访客真正高亮的内容。
  const selection = window.getSelection();
  if (selection && !selection.isCollapsed) {
    const anchor = selection.anchorNode;
    if (anchor !== null && root.contains(anchor)) return selection.toString();
  }

  // The editor keeps its own range, which survives the right-click that opened the menu.
  // 编辑器维护自己的选区范围，右键打开菜单后仍然保留。
  for (const editor of root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
    "input, textarea",
  )) {
    const start = editor.selectionStart ?? 0;
    const end = editor.selectionEnd ?? 0;
    if (end > start) return editor.value.slice(start, end);
  }

  return "";
}

/**
 * Read text from the clipboard. Browsers gate this behind a user gesture and a
 * permission, so an empty result is reported as a failed paste rather than silence.
 * 从剪贴板读取文本。浏览器以用户手势与权限为前提，因此空结果按粘贴失败报告，而不是静默忽略。
 */
export async function readClipboard(): Promise<string> {
  if (typeof navigator === "undefined" || !navigator.clipboard) return "";
  try {
    return await navigator.clipboard.readText();
  } catch {
    return "";
  }
}

/**
 * Copy an image element to the clipboard. The clipboard API accepts a `ClipboardItem`, which
 * only Chromium-family browsers expose, and it takes PNG as its image type, so a WebP or JPEG
 * source is re-encoded from the fetched bytes. Callers fall back to the address when this
 * returns false.
 * 把图片元素写入剪贴板。剪贴板接口需要 ClipboardItem，仅 Chromium 系浏览器提供，且图片类型只接受
 * PNG，因此 WebP 或 JPEG 源会用取回的字节重新编码。返回 false 时调用方回退到图片地址。
 */
export async function copyImage(element: HTMLImageElement): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.clipboard?.write) return false;
  if (typeof ClipboardItem === "undefined") return false;
  try {
    // A cross-origin image without CORS headers taints the canvas, so the fetch path is
    // tried first: it yields the original bytes instead of a re-encoded canvas.
    // 没有 CORS 头的跨域图片会污染画布，因此先尝试 fetch：它返回原始字节，而不是重新编码的画布。
    const response = await fetch(element.currentSrc || element.src);
    if (!response.ok) return false;
    const blob = await response.blob();
    // Keep the original bytes when the browser accepts the type, and re-encode otherwise:
    // a source image can be WebP while the clipboard only takes PNG.
    // 浏览器接受该类型时保留原始字节，否则重新编码：源图片可能是 WebP，而剪贴板只接受 PNG。
    return (await writeImage(blob.type, blob)) || (await writePng(blob));
  } catch {
    return false;
  }
}

/** Write one clipboard image; an unsupported type reports false instead of throwing. */
async function writeImage(type: string, blob: Blob): Promise<boolean> {
  try {
    await navigator.clipboard.write([new ClipboardItem({ [type]: blob })]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Re-encode fetched bytes as PNG and write them. Decoding the fetched blob rather than the
 * `<img>` element keeps the canvas untainted when the source is cross-origin.
 * 把取回的字节重新编码为 PNG 并写入。解码取回的 Blob 而不是 <img> 元素，使跨域源不会污染画布。
 */
async function writePng(blob: Blob): Promise<boolean> {
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") return false;
  try {
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (context === null) return false;
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    return png !== null && (await writeImage("image/png", png));
  } catch {
    return false;
  }
}
