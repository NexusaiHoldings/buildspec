/**
 * document-parser.ts — Extract plain text from PDF and DOCX files.
 *
 * pdf-parse and mammoth are loaded via eval("require") so Next.js webpack
 * does not try to bundle them for the browser (per substrate rule for
 * native server-side modules).
 */

export interface ParsedDocument {
  text: string;
  pageCount?: number;
  byteLength: number;
  metadata: Record<string, unknown>;
}

/**
 * Resolve a storage key or full URL to a Buffer.
 * Keys without a scheme are prefixed with STORAGE_BASE_URL.
 */
async function fetchFileBuffer(urlOrKey: string): Promise<Buffer> {
  const url =
    urlOrKey.startsWith("http://") || urlOrKey.startsWith("https://")
      ? urlOrKey
      : `${(process.env.STORAGE_BASE_URL ?? "").replace(/\/$/, "")}/${urlOrKey}`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch document: HTTP ${response.status} ${response.statusText} — ${url}`,
    );
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Parse a PDF buffer with pdf-parse.
 * eval("require") bypasses webpack so the binary file-watching code in
 * pdf-parse never reaches the client bundle.
 */
async function parsePdf(buffer: Buffer): Promise<ParsedDocument> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfParse = eval("require")("pdf-parse") as (
    data: Buffer,
    opts?: Record<string, unknown>,
  ) => Promise<{ text: string; numpages: number; info: Record<string, unknown> }>;

  const result = await pdfParse(buffer, { max: 0 });
  return {
    text: result.text ?? "",
    pageCount: result.numpages,
    byteLength: buffer.byteLength,
    metadata: result.info ?? {},
  };
}

/**
 * Parse a DOCX buffer with mammoth extractRawText.
 */
async function parseDocx(buffer: Buffer): Promise<ParsedDocument> {
  const mammoth = eval("require")("mammoth") as {
    extractRawText: (
      opts: { buffer: Buffer },
    ) => Promise<{
      value: string;
      messages: Array<{ type: string; message: string }>;
    }>;
  };

  const result = await mammoth.extractRawText({ buffer });
  const warnings = result.messages
    .filter((m) => m.type === "warning")
    .map((m) => m.message);

  return {
    text: result.value ?? "",
    byteLength: buffer.byteLength,
    metadata: warnings.length > 0 ? { warnings } : {},
  };
}

/** Parse a plain-text buffer — no external dependency. */
function parsePlainText(buffer: Buffer): ParsedDocument {
  return {
    text: buffer.toString("utf-8"),
    byteLength: buffer.byteLength,
    metadata: {},
  };
}

/**
 * Main entry point. Fetches the file at urlOrKey, detects format from
 * mimeType, and returns the extracted text + metadata.
 *
 * Supported MIME types:
 *   - application/pdf
 *   - application/vnd.openxmlformats-officedocument.wordprocessingml.document
 *   - application/msword
 *   - text/*
 */
export async function parseDocument(
  urlOrKey: string,
  mimeType: string,
): Promise<ParsedDocument> {
  const buffer = await fetchFileBuffer(urlOrKey);
  const normalized = mimeType.toLowerCase();

  if (normalized.includes("pdf")) {
    return parsePdf(buffer);
  }
  if (
    normalized.includes("wordprocessingml") ||
    normalized.includes("docx") ||
    normalized === "application/msword"
  ) {
    return parseDocx(buffer);
  }
  if (normalized.startsWith("text/")) {
    return parsePlainText(buffer);
  }

  throw new Error(
    `Unsupported document MIME type: "${mimeType}". Supported: PDF, DOCX, text/*`,
  );
}
