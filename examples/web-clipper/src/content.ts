// The content script: the base's chat readers (ChatGPT, Claude — the whole
// conversation, F099.9) and the article extractor for every other page.
// Imports ONLY @broberg/web-clipper/content + /extract — anything the popup also
// imports would be split into a shared chunk, and the build refuses that.
import { runContentScript } from "@broberg/web-clipper/content";
import { chatReaders } from "@broberg/web-clipper/extract";
runContentScript(chatReaders);
