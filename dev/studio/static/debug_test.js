// Debug test: load the actual app.js, then test refreshKindVisibility
// against a fake DOM that mirrors the structure in index.html.
//
// We're going to use jsdom to simulate the browser environment.
const fs = require('fs')
const path = require('path')

// Try to use jsdom (Node 24 has it built in? Let's try a simple stub if not).
let createDOM
try {
  // jsdom may or may not be installed. Try it.
  const jsdom = require('jsdom')
  createDOM = (html) => {
    const dom = new jsdom.JSDOM(html, { runScripts: 'dangerously' })
    return dom
  }
} catch (e) {
  // No jsdom — write a minimal stub.
  console.log('jsdom not available, using minimal stub')
  createDOM = null
}

// Read the actual index.html
const html = fs.readFileSync('c:/custom/projects/ai_creative_studio/dev/studio/static/index.html', 'utf8')
const appJs = fs.readFileSync('c:/custom/projects/ai_creative_studio/dev/studio/static/app.js', 'utf8')

if (createDOM) {
  // Strip the <script src="app.js"> tag — we'll eval the JS manually.
  const htmlNoScript = html.replace(/<script src="app\.js"><\/script>/, '')
  const dom = createDOM(htmlNoScript)
  const { window } = dom
  // Stub fetch so the load doesn't blow up.
  window.fetch = () => Promise.resolve({ ok: false, json: () => Promise.resolve({}) })
  // Eval the app.js into the window.
  window.eval(appJs)
  // Check what we got.
  const form = window.document.getElementById('gen-form')
  console.log('form found:', !!form)
  const shows = window.document.querySelectorAll('[data-show]')
  console.log('elements with [data-show]:', shows.length)
  for (const el of shows) {
    console.log(`  data-show="${el.dataset.show}" tag=${el.tagName} display=${el.style.display}`)
  }
  // Try the type change.
  const imageRadio = window.document.getElementById('type-image')
  console.log('image radio found:', !!imageRadio, 'checked:', imageRadio && imageRadio.checked)
  // The page initializes with image selected. After the init IIFE runs
  // the visibility logic should be applied.
  // Let's check what currentType returns.
  console.log('currentType():', window.currentType ? window.currentType() : '(not exposed)')
} else {
  console.log('skipping browser test')
}
