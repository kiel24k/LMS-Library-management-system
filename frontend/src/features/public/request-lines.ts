import type { PublicBook } from "@/types/api"

/** Same limits as POST /public/libraries/:slug/requests. */
export const REQUEST_LIMITS = { maxBooks: 20, maxQuantity: 5 } as const

/** A book in the visitor's request list. */
export type RequestLine = {
  bookId: string
  title: string
  author: string | null
  coverUrl: string | null
  /** Whether a copy was on the shelf when it was added (books that are out can still be asked for). */
  available: boolean
  quantity: number
}

export function lineFromBook(book: PublicBook): RequestLine {
  return {
    bookId: book.id,
    title: book.title,
    author: book.author,
    coverUrl: book.coverUrl,
    available: book.available,
    quantity: 1,
  }
}

export const totalCopies = (lines: RequestLine[]) => lines.reduce((sum, l) => sum + l.quantity, 0)
