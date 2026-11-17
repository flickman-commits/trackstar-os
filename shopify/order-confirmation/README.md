# Order confirmation email

The Shopify "Order confirmation" notification (Settings > Notifications >
Customer notifications > Order confirmation), restyled to the brand: Inter
with Helvetica behind it, ink on white, a timeline of what happens next, the
runner details and photo per print, the Manage your order button, and the
site's ink footer. Shopify's own order summary and customer information
blocks are kept untouched in the middle; `top.liquid` restyles them with CSS.

## Where the two files go

The template is one long file in Shopify. Replace two parts of it and leave
Shopify's middle (Order summary, Customer information) alone:

1. **`top.liquid`** replaces everything from the first line down to, but not
   including, the first `<table class="row section">` (the one whose `<h3>`
   reads "Order summary"). Copy the live `link_secret` value out first.
2. **`footer.liquid`** replaces everything from the footer to the end of the
   file. On a stock template that starts at `<table class="row footer">` (the
   "If you have any questions" line); once this footer is installed, it starts
   at the `{% comment %}` that reads "Trackstar order confirmation, the footer".

Subject line: `Your Trackstar Order {{ order_name }} is Confirmed`

Paste the link-signing secret (the value the old template had on its
`hmac_sha256` line, the same as SELF_SERVE_LINK_SECRET in changeWindow.js)
into `link_secret` near the top of top.liquid. Until it is pasted, the Manage
your order button is hidden rather than sending a link that cannot work.

## What the template reads

Line item properties the storefront wizard writes: `Runner Name (First &
Last)`, `Race Year`, `Event`, `Bib #`, `Time`, `Pace`, `No Time`, `Gift`,
`Pre-order`, and the hidden `_photo_path`, `_photo_later`, `_lookup_outcome`,
`_addon_for`. The photo is served by `api/_routes/public/order-photo.js` from the
order id, the signature and the line item's index.

## Testing

Shopify's "Send test email" uses a recent order. Check iPhone Mail, Gmail (Inter falls back to
Helvetica) and Outlook (no background photo: the top shows ink behind the
white wordmark). The photo is `public/email/order-hero.jpg`, served from
fast.trackstar.art.
