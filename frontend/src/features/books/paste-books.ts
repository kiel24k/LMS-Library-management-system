/** Highest number of copies the "Add many books" page accepts per book. */
export const MAX_COPIES = 999

export type PastedBook = {
  title: string
  author: string
  /** null when the copies column is missing or not a number. */
  copies: number | null
}

type Column = keyof PastedBook

const TITLE_WORDS = new Set(["title", "titles", "booktitle", "booktitles", "titleofbook", "titleofthebook", "bookname", "nameofbook"])
const AUTHOR_WORDS = new Set(["author", "authors", "writer", "writers", "awtor", "mayakda"])
const COPIES_WORDS = new Set(["copies", "copy", "noofcopies", "numberofcopies", "qty", "quantity"])

/** Which column a header cell names ("Title", "Pamagat ng Aklat", "May-akda", "Kopya"…), or null for a normal cell. */
function headerColumn(cell: string): Column | null {
  const word = cell.toLowerCase().replace(/[^a-z]/g, "")
  if (TITLE_WORDS.has(word) || word.startsWith("pamagat")) return "title"
  if (AUTHOR_WORDS.has(word) || word.startsWith("mayakda")) return "author"
  if (COPIES_WORDS.has(word) || word.includes("kopya")) return "copies"
  return null
}

/** True when pasted text holds more than one cell (several lines, or columns from a spreadsheet). */
export function isMultiCellPaste(text: string): boolean {
  return /[\t\r\n]/.test(text.replace(/[\r\n]+$/, ""))
}

const clean = (cell: string) => cell.replace(/\s+/g, " ").trim()

/**
 * Turns text copied from Excel / Google Sheets (or a plain list, one title per line) into books.
 * Columns: 1 = title, 2 = author, 3 = copies (used only when it is a number). Blank lines are skipped.
 * A first line of column names ("Title", "Author", "Pamagat ng Aklat"…) is dropped and says where each column is;
 * without one, a first column that only numbers the lines (1, 2, 3…) is ignored.
 */
export function parsePastedBooks(text: string): PastedBook[] {
  // Spreadsheet copies separate columns with tabs and quote cells that contain line breaks; a plain
  // list has no tabs, so each line is one title (kept whole, quotes and all).
  const table = text.includes("\t") ? splitTabbed(text) : text.split(/\r\n|\r|\n/).map((line) => [line])
  const rows = table.map((cells) => cells.map(clean)).filter((cells) => cells.some((c) => c !== ""))

  let columns: Record<Column, number> = { title: 0, author: 1, copies: 2 }
  const header = rows[0]?.map(headerColumn)
  if (header?.some(Boolean)) {
    rows.shift()
    // A column the header does not name stays in its usual place, unless that place holds another column.
    const find = (column: Column, usual: number) => {
      const at = header.indexOf(column)
      return at >= 0 ? at : header[usual] ? -1 : usual
    }
    columns = { title: find("title", 0), author: find("author", 1), copies: find("copies", 2) }
  } else if (rows.every((cells) => /^\d{1,5}[.)]?$/.test(cells[0] ?? "")) && rows.some((cells) => cells[1])) {
    columns = { title: 1, author: 2, copies: 3 }
  }

  return rows
    .map((cells) => {
      const at = (i: number) => (i >= 0 ? (cells[i] ?? "") : "")
      const copies = at(columns.copies)
      const n = /^\d+$/.test(copies) ? Number(copies) : 0
      return { title: at(columns.title), author: at(columns.author), copies: n >= 1 ? Math.min(n, MAX_COPIES) : null }
    })
    .filter((book) => book.title || book.author)
}

/** One pasted column (e.g. authors), one value per line; blank lines and a column name on the first line are dropped. */
export function parsePastedColumn(text: string): string[] {
  const lines = text.split(/\r\n|\r|\n/).map(clean).filter(Boolean)
  if (lines[0] && headerColumn(lines[0])) lines.shift()
  return lines
}

const endsCell = (ch: string | undefined) => ch === undefined || ch === "\t" || ch === "\n" || ch === "\r"

/**
 * Splits tab-separated text into rows of cells, honoring spreadsheet "quoted cells" and "" escapes.
 * A cell counts as quoted only when its closing quote ends the cell; otherwise (e.g. `"Noli" at iba`) the
 * text is kept as typed. An opening quote that never closes turns quote handling off for the whole paste.
 */
function splitTabbed(text: string, quotes = true): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ""
  let quoteStart = -1 // index of the opening quote while inside a quoted cell
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoteStart >= 0) {
      if (ch !== '"') cell += ch
      else if (text[i + 1] === '"') {
        cell += '"'
        i++
      } else if (endsCell(text[i + 1])) quoteStart = -1
      else {
        cell = text.slice(quoteStart, i + 1)
        quoteStart = -1
      }
      continue
    }
    if (quotes && ch === '"' && cell.trim() === "") {
      quoteStart = i
      cell = ""
    } else if (ch === "\t") {
      row.push(cell)
      cell = ""
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ""
    } else cell += ch
  }
  if (quoteStart >= 0) return splitTabbed(text, false)
  if (cell !== "" || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }
  return rows
}
