// Fixture pages for F099.3. Each exercises something Trail's rules decide:
// headings (atx), fenced code, "-" bullets, and the removal rule for
// script/style/nav/footer/header/iframe/noscript.
export const PAGES: Record<string, string> = {
  article: `<!doctype html><html><head><title>Fingerprints, explained</title></head><body>
<header><a href="/">Site</a></header>
<nav><ul><li><a href="/a">A</a></li><li><a href="/b">B</a></li></ul></nav>
<main><article>
<h1>Fingerprints, explained</h1>
<p>A <strong>chain fingerprint</strong> includes the previous one, so a change anywhere earlier changes every later link.</p>
<h2>Why it matters</h2>
<ul><li>Send only what is new.</li><li>Resend without duplicates.</li><li>Branch when an earlier unit changes.</li></ul>
<pre><code class="language-ts">const fp = await sha256(prev + ":" + own);
console.log(fp);</code></pre>
<p>Read <a href="https://example.com/more">more</a>. <em>Nothing</em> is overwritten.</p>
<script>window.tracker = 1</script><style>p{color:red}</style>
</article></main>
<footer>© 2026</footer>
</body></html>`,
  noisy: `<!doctype html><html><head><title>Noisy page</title></head><body>
<div class="ad">Buy now</div>
<div id="content"><h2>Release notes</h2>
<p>Version 0.18.0 accepts user tickets. A user ticket names the user and the app that swapped it.</p>
<table><thead><tr><th>Field</th><th>Meaning</th></tr></thead><tbody><tr><td>sub</td><td>the user</td></tr><tr><td>azp</td><td>the app</td></tr></tbody></table>
<iframe src="https://example.com/embed"></iframe><noscript>enable js</noscript>
<ol><li>First</li><li>Second</li></ol>
<blockquote>The base is shared, data is not.</blockquote>
</div></body></html>`,
  untitled: `<!doctype html><html><head></head><body><div><p>A page with no title element and only one paragraph of text, which is still worth clipping because someone chose to.</p></div></body></html>`,
  // Readability KEEPS a <header> and a video <iframe> inside an <article> (measured
  // 12/10) — so only Trail's remove-scripts rule takes them out. Without this page a
  // test cannot tell whether that rule is there at all.
  embedded: `<!doctype html><html><head><title>Embedded</title></head><body><article>
<header><p>Byline header text inside the article body which is long enough to keep around for sure.</p></header>
<p>Main paragraph one with plenty of words so Readability is confident this is the article content body text.</p>
<figure><iframe src="https://www.youtube.com/embed/x"></iframe></figure>
<p>Main paragraph two, again with words, and more words, to make the scoring happy and stable here.</p>
</article></body></html>`,
};
