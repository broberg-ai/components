// The content script: the base's article extractor, no extractors of our own.
// Imports ONLY @broberg/web-clipper/content — anything the popup also imports
// would be split into a shared chunk, and the build refuses that.
import { runContentScript } from "@broberg/web-clipper/content";
runContentScript([]);
