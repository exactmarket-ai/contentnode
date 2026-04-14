import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Strip Markdown syntax from a string, returning clean plain text.
 * Handles headings, bold, italic, bullets, blockquotes, code, links, and hr.
 */
export function stripMarkdown(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, '')           // ## Heading → Heading
    .replace(/\*\*\*(.+?)\*\*\*/g, '$1')   // ***bold italic*** → text
    .replace(/\*\*(.+?)\*\*/g, '$1')        // **bold** → text
    .replace(/\*(.+?)\*/g, '$1')            // *italic* → text
    .replace(/___(.+?)___/g, '$1')          // ___bold italic___ → text
    .replace(/__(.+?)__/g, '$1')            // __bold__ → text
    .replace(/_([^_]+)_/g, '$1')            // _italic_ → text
    .replace(/~~(.+?)~~/g, '$1')            // ~~strikethrough~~ → text
    .replace(/`([^`]+)`/g, '$1')            // `code` → text
    .replace(/```[\s\S]*?```/g, '')         // ```code blocks``` → remove
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // [link](url) → link text
    .replace(/^[-*+]\s+/gm, '')             // - bullet / * bullet → text
    .replace(/^\d+\.\s+/gm, '')             // 1. ordered list → text
    .replace(/^>\s*/gm, '')                 // > blockquote → text
    .replace(/^---+$/gm, '')                // --- hr → remove
    .replace(/^===+$/gm, '')                // === hr → remove
    .replace(/\n{3,}/g, '\n\n')             // collapse excess blank lines
    .trim()
}
