# Order confirmation email

The Shopify "Order confirmation" notification (Settings > Notifications >
Customer notifications > Order confirmation), restyled to the brand: Inter
with Helvetica behind it, ink on white, a timeline of what happens next, the
runner details and photo per print, the Manage your order button, and the
site's ink footer. Shopify's own order summary and customer information
blocks are kept untouched in the middle; `top.liquid` restyles them with CSS.

## Where the two files go

The template is one long file in Shopify. Replace two parts of it and leave
the middle alone:

1. **`top.liquid`** replaces everything from the first line down to, but not
   including, the first `<table class="row section">` (the one whose `<h3>`
   reads "Order summary").
2. **`footer.liquid`** replaces everything from `<table class="row footer">`
   (the "If you have any questions" line) to the end of the file.

Subject line: `Your Trackstar Order {{ order_name }} is Confirmed`

The link signature on `ship_sig` uses the store's SELF_SERVE_LINK_SECRET
(changeWindow.js); keep the value that is already in the template.

## What the template reads

Line item properties the storefront wizard writes: `Runner Name (First &
Last)`, `Race Year`, `Event`, `Bib #`, `Time`, `Pace`, `No Time`, `Gift`,
`Pre-order`, and the hidden `_photo_path`, `_photo_later`, `_lookup_outcome`,
`_addon_for`. The photo is served by `api/public/order-photo.js` from the
order id, the signature and the line item's index.

## Testing

Shopify's "Send test email" uses a recent order. Check iPhone Mail (the
timeline animates there), Gmail (static timeline, Inter falls back to
Helvetica) and Outlook.
