# Support: connecting Instagram DMs

What Matt has to create in Meta for Developers so DMs to @trackstar_art land in the Support inbox, and where each value goes. Written 2026-10-16 with the channel code (`server/domain/support/instagram.js`, `api/_routes/support/instagram*.js`). The code is on main; nothing works until these steps are done.

## How it works, in one paragraph

Meta posts every DM to `/api/support/instagram-webhook` within seconds; that is how a DM becomes a conversation in the inbox (there is no polling). A reply from the page goes out through the Instagram API as the account. Meta allows a reply only within 24 hours of the customer's last message; after that the composer says the window has closed. The account's token lives in SystemConfig (connected once from the Support page, like the mailbox) and the support sync cron keeps it alive. This uses the "Instagram API with Instagram Login", which needs no Facebook Page, and Standard Access covers an account we own, so no App Review for the basics.

## In Meta for Developers (about 20 minutes)

1. **Create the app.** developers.facebook.com > My Apps > Create app. Name it Trackstar Support. Under "Add use cases" tick only **Manage messaging & content on Instagram** (not "Engage with customers on Messenger", which is Facebook Page DMs; "Other" is being retired). If it asks for an app type, Business; if it asks for a Business Portfolio, pick or create Trackstar's.
2. **Open the Instagram setup.** In the app dashboard, Use cases > Manage messaging & content on Instagram > Customize > "API setup with Instagram login". (Not "with Facebook login".)
3. **Add the account.** Under step 1 "Generate access tokens", click Add account and sign in as @trackstar_art. It must be a professional account (Business or Creator). This is what makes Standard Access enough.
4. **Instagram app ID and secret.** Use the pair shown at the top of the "API setup with Instagram login" screen (named like "Trackstar Support-IG"), not the Meta app ID under App settings > Basic: the connect flow signs in through instagram.com, which only knows the Instagram app. Copy both into Vercel as `INSTAGRAM_APP_ID` and `INSTAGRAM_APP_SECRET` (and into `.env.local` for local work).
5. **Redirect URI.** Still under the Instagram product, "Business login settings" (step 3 in that screen): add `https://fast.trackstar.art/api/support/instagram-callback` to the OAuth redirect URIs. Add `http://localhost:3000/api/support/instagram-callback` too for local testing.
6. **Webhook.** Step 2 "Configure webhooks": callback URL `https://fast.trackstar.art/api/support/instagram-webhook`, verify token = a string you invent (put the same string in Vercel as `INSTAGRAM_WEBHOOK_VERIFY_TOKEN` and redeploy *before* pressing Verify, or Meta's check fails). Subscribe to `messages` and `message_echoes`. Echoes are what tell the inbox a DM was answered from the Instagram app instead of the page.
7. **Live mode.** Meta only delivers webhooks to an app that is Live (toggle at the top of the dashboard). Going Live asks for a privacy policy URL under App settings > Basic (any page on trackstar.art will do) and may ask for Business Verification of the portfolio. Until the app is Live, DMs are not delivered.
8. **Instagram app setting.** On the phone, in the Instagram app for @trackstar_art: Settings > Messages and story replies > Message controls > "Allow access to messages" must be on, or the API sees nothing.

## In TrackstarOS

9. Set the four env vars (`INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET`, `INSTAGRAM_WEBHOOK_VERIFY_TOKEN`, `INSTAGRAM_HANDLE=trackstar_art`) in Vercel and redeploy. `.env.example` documents them.
10. On /support, in the Instagram card on the right, press **Connect @trackstar_art** and sign in as the account. Any other account is refused. If the login flow gives trouble, the dashboard's "Generate token" button (step 1 of the Instagram product screen, signed in as the account) produces a long-lived token you can paste with **Paste a token** instead.
11. Press **Import recent DMs** once to pull the open conversations (Meta serves the 20 newest messages per conversation).
12. Send a DM to @trackstar_art from a personal account. It should appear in the inbox within seconds. Reply from the page; it should arrive on the phone.

## Replying after 24 hours

Meta's "Human Agent" tag lets a person reply up to 7 days after the customer's message. It is a separate permission that needs App Review (App Review > Permissions and features > Human Agent, with a short description and a screen recording of the inbox). Once approved, set `INSTAGRAM_HUMAN_AGENT_APPROVED=true` and the composer sends with the tag inside 7 days instead of saying the window closed. Until then the page holds the reply and suggests a note for the team.

## What is stored

One `SupportThread` per customer (`channel = instagram`, keyed by their Instagram-scoped id), reopened when they write again; one `SupportMessage` per DM keyed by Meta's message id, so retries and the backfill never duplicate. The customer has no email, so the Orders panel asks the rep to get an order number or the email on the order. Attachments are links to Meta's CDN, which expire; the bytes are not copied.
