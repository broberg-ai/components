// ORACLE — broberg-ai/trail apps/web-clipper/src/content/extractor.ts at f5ce8ba,
// copied VERBATIM except: the chrome.runtime listener is dropped (no extension in a
// test) and the function is exported. It still reads the global `document`, exactly
// as in Trail, so the test sets one per fixture. Do not "tidy" this file — its whole
// value is that it is Trail's code and not ours.
import { Readability } from '@mozilla/readability'
import TurndownService from 'turndown'

export function extractPageContent(): { title: string; content: string } | null {
  try {
    const documentClone = document.cloneNode(true) as Document
    const reader = new Readability(documentClone, {
      keepClasses: false,
      charThreshold: 0,
    })
    const article = reader.parse()

    if (!article) {
      return null
    }

    const turndown = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      bulletListMarker: '-',
    })

    turndown.addRule('remove-scripts', {
      filter: ['script', 'style', 'noscript', 'iframe', 'nav', 'footer', 'header'],
      replacement: () => '',
    })

    // Readability types `content` as string | null | undefined — an article it
    // could not parse yields nothing to convert, and turndown would throw.
    const markdown = turndown.turndown(article.content ?? '')

    return {
      title: article.title || document.title || 'Untitled',
      content: markdown,
    }
  } catch (err) {
    console.error('Trail Clipper: extraction failed', err)
    return null
  }
}
