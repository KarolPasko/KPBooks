# Tally Invoices

A QuickBooks-style invoicing app that runs entirely on your iPhone. No account, no
backend, no server — your invoices, clients and prices are stored only on the device
(in the browser's local storage), and PDFs are generated on the phone itself.

## Features

- **Invoices** — create, edit, duplicate, mark paid/unpaid, track drafts, unpaid and overdue.
  Discounts (amount or %), tax/VAT, part payments, notes and terms.
- **Clients** — business or personal, with contact person, email, phone, full address and VAT/tax ID.
- **Your own invoice layout editor** — a real A4/Letter page you design by dragging blocks
  (logo, your details, title, invoice details, bill-to, items table, totals, notes, payment
  details, footer, free text, lines, colour bands). Change colours, fonts, sizes, alignment,
  table style; three starting styles (Classic, Modern, Minimal); undo. What you see is exactly
  what the PDF looks like. Long invoices flow onto extra pages automatically.
- **Real PDFs** — vector PDF with selectable text, generated on the device (a few KB each).
- **Send by email** — on iPhone, *Share PDF via Mail* opens the share sheet with the PDF
  attached (the client's address is copied so you can paste it into "To"). There's also a
  plain *Open in Mail* option and *Save PDF*.
- **One-tap sending from Gmail** (optional) — sign in with Google once and invoices are sent
  from your own Gmail address with the PDF attached, straight from the app. Runs entirely in
  the browser via Google sign-in + the Gmail API (send-only permission); see *Gmail setup* below.
- **Invoice numbers** like `ABC 0001` — choose the prefix, number of digits and next number.
- **Import past invoices → automatic prices** — import old invoices from PDF, CSV, pasted text,
  or type them in. Every item and its price goes into your **price book**; when you type an
  item on a new invoice the price fills in automatically (with last-used date and average).
  PDFs made by this app re-import losslessly.
- **Backups** — export everything to a JSON file (Files / iCloud Drive) and restore it.
- Works **offline** and installs to the Home Screen like a native app. Light & dark mode.

## Put it on your iPhone

The app is plain HTML/CSS/JavaScript with no build step. It has to be opened from a web
address once (iPhones can't run a web app straight from the Files app), after which it
lives on your Home Screen and works offline.

**Option A — GitHub Pages (free, recommended)**

1. Merge this branch into `main`.
2. In the repository on GitHub: *Settings → Pages → Build and deployment → Source:* **GitHub Actions**.
3. The included workflow publishes the site; the address appears on the Pages settings screen
   (e.g. `https://<your-user>.github.io/VSO/`).
4. Open that address in **Safari** on your iPhone → **Share** → **Add to Home Screen**.

GitHub Pages only serves the files. Nothing you type is ever sent anywhere — all data stays
on the phone. (Pages for private repositories needs a paid GitHub plan; any static host such as
Netlify or Cloudflare Pages works the same way — just upload the folder.)

**Option B — from your computer on the same Wi-Fi (quick try-out)**

```sh
python3 -m http.server 8000
```

Then open `http://<your-computer's-IP>:8000` in Safari on the iPhone. (Offline mode needs
https, so use Option A for everyday use.)

## Gmail setup (one-time, ~5 minutes)

Google requires each app that sends Gmail to have its own OAuth **Client ID**:

1. Open <https://console.cloud.google.com>, sign in with the Gmail account you'll send from,
   and create a project (e.g. "Tally").
2. Enable the **Gmail API** (search for it in the top bar → Enable).
3. **Google Auth Platform / OAuth consent screen** → Get started → app name "Tally",
   your email, audience **External**.
4. **Audience → Test users** → add your own Gmail address.
5. **Clients → Create client → Web application**. Under *Authorised JavaScript origins* add the
   address the app is served from, e.g. `https://karolpasko.github.io`.
6. Copy the Client ID into **More → Business & invoice settings → Send from Gmail** and tap
   **Connect Gmail**. Google will warn that the app isn't verified — that's expected for your own
   private app; tap *Continue* and allow *Send email on your behalf*.

Google's sign-in lasts about an hour; after that, tapping *Send with Gmail* just asks you to
pick your account again.

## Your data

Everything is stored in Safari's storage for this site on this device. Installing it to the
Home Screen keeps that storage safe from Safari's automatic clean-up; still, use
**More → Back up everything** now and then, and keep the file in iCloud Drive.

## Project layout

```
index.html            app shell
css/app.css           styles (iOS-style, light + dark)
js/app.js             router
js/store.js           on-device data store, numbering, price book learning
js/layout.js          invoice layout engine (templates, flow, pagination, canvas preview)
js/pdf.js             dependency-free vector PDF writer
js/importer.js        past-invoice import: PDF text extraction, field detection, CSV
js/views/*.js         screens
sw.js                 offline cache
```

When you change files, bump `VERSION` in `sw.js` so installed copies pick up the update.
