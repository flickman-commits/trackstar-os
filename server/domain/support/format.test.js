import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lineToHtml, replyToHtml, replyToPlain } from './format.js'

test('bold, italic and links become HTML', () => {
  assert.equal(lineToHtml('This is **really** _nice_'), 'This is <strong>really</strong> <em>nice</em>')
  assert.equal(lineToHtml('See [your design](https://fast.trackstar.art/approve/abc)'), 'See <a href="https://fast.trackstar.art/approve/abc">your design</a>')
  assert.equal(lineToHtml('Track it at https://track.amazon.com/tracking/TBA1.'), 'Track it at <a href="https://track.amazon.com/tracking/TBA1">https://track.amazon.com/tracking/TBA1</a>.')
})

test('underscores in addresses and words are left alone', () => {
  assert.equal(lineToHtml('email kp_24_x@yahoo.com'), 'email kp_24_x@yahoo.com')
  assert.equal(lineToHtml('https://x.com/a_b_c'), '<a href="https://x.com/a_b_c">https://x.com/a_b_c</a>')
})

test('HTML the customer could see is escaped, and only http(s) and mailto links are made', () => {
  assert.equal(lineToHtml('<b>hi</b> & bye'), '&lt;b&gt;hi&lt;/b&gt; &amp; bye')
  assert.equal(lineToHtml('[x](javascript:alert(1))'), '[x](javascript:alert(1))')
})

test('paragraphs and lines', () => {
  assert.equal(replyToHtml('Hey Jane,\n\nLine one\nLine two'), '<div>\n<div>Hey Jane,</div>\n<div><br></div>\n<div>Line one</div>\n<div>Line two</div>\n</div>')
})

test('a DM gets plain text', () => {
  assert.equal(replyToPlain('**Shipped!** See [tracking](https://t.co/1) and _thanks_'), 'Shipped! See tracking: https://t.co/1 and thanks')
})

test('a sent reply reads back from its HTML exactly as it was typed', async () => {
  const { htmlToText } = await import('./mailbox.js')
  const typed = "Hey Celeste,\n\nYes, no problem! We'll ship it to\n\n9091 River Rock Dr N\nChanhassen, MN 55317\n\nThanks,\nMatt from Trackstar"
  assert.equal(htmlToText(replyToHtml(typed)), typed)
  // Gmail's own markup for the same thing.
  assert.equal(htmlToText('<div dir="ltr">Hi,<div><br></div><div>Line one</div><div>Line two</div></div>'), 'Hi,\n\nLine one\nLine two')
  assert.equal(htmlToText('<p>One\nsentence across\nsource lines.</p><p>Two</p>'), 'One sentence across source lines.\nTwo')
})

test('a link macro is the plain address; the worded ones from before are recognized', async () => {
  const { STORE_LINK_MARKUP } = await import('./macros.js')
  assert.equal('[Marathons](https://www.trackstar.art/collections/marathons)'.match(STORE_LINK_MARKUP)?.[1], 'https://www.trackstar.art/collections/marathons')
  assert.equal('See [this](https://www.trackstar.art/products/boston) here'.match(STORE_LINK_MARKUP), null)
  const url = 'https://www.trackstar.art/collections/marathons'
  assert.equal(replyToHtml(url), `<div>\n<div><a href="${url}">${url}</a></div>\n</div>`)
  assert.equal(replyToPlain(url), url)
})
