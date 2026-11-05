# rentme

**A personal AI assistant for finding a rental apartment in Poland.**

rentme downloads rental listings from **otodom.pl** and **olx.pl** into one local database. It gives them
the same fields and tags on both sites and filters them by your criteria. Claude reads every description
and ranks each flat against your preferences, written in plain language. You browse the results in a web
UI or ask an AI chat in any language: "3 rooms near the metro, up to 6000 with bills, English description".

- **Listings:** title, price including czynsz, deposit, area, rooms, location, author, tags and a link.
  Photos and full descriptions load only when you open them.
- **AI ranking:** a score, a summary, pros and cons, red flags and hidden costs for each listing.
- **AI chat:**
  - searches and reads your listings and marks favorites;
  - remembers standing rules;
  - can adjust your search filters, with your approval or automatically if you allow it.
- **Runs locally:** data stays in SQLite on your machine. You need your own Anthropic API key.

**Quick start:** after the one-time [setup](#setup), double-click `start.bat`, or see
[Starting rentme](#starting-rentme-quick-start).

## Setup

```powershell
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
cd web; npm install; npm run build; cd ..     # builds the React UI into rentme/static
.venv\Scripts\python -m rentme serve          # open http://127.0.0.1:8000
```

Then open **Settings** and fill in everything there. That includes search filters, sources,
AI model and preferences, and the API key. Settings are saved to `config.json`. The key is
saved to `secrets.json`, or comes from the `ANTHROPIC_API_KEY` environment variable.

### Getting an Anthropic API key
1. Sign up at https://console.anthropic.com. This is separate from a claude.ai Pro/Max subscription,
   which does not include API access.
2. **Plans & Billing**: add a payment method and buy some credits (prepaid).
3. **API keys**: click *Create key* and copy the `sk-ant-...` value. It is shown only once.
4. Paste it in rentme → Settings → AI → *Save key*. The app tests it immediately.

Rough cost: ranking 60 listings with Opus 5.5 at low effort costs on the order of a few tens of
cents, and Haiku 5.5 is about 40× cheaper. A chat question usually takes 2–5 model calls.
You can set a monthly spend limit in the Console under *Limits*.

## Starting rentme (quick start)

Do the [setup](#setup) once first. After that, this is all you need each time.

**1. Start the server.** Either:
- double-click **`start.bat`** in the project folder. It starts the server and opens the browser; or
- run it in a terminal (PowerShell):
  ```powershell
  cd C:\myboys\falkura\rentme
  .venv\Scripts\python -m rentme serve            # add --port 8765 to use another port
  ```
  Then open **http://127.0.0.1:8000**.

Keep that window open while you use the app. Close it or press **Ctrl+C** to stop rentme.
Your listings, chats and settings are kept and come back the next time you start it.

**2. The first time only:**
1. **Settings → AI**: paste your API key, click *Save key*, and check that it says it works.
2. **Settings → AI → Your preferences**: describe what you want in plain words.
3. **Settings → Search**: set the city, budget (rent + czynsz), area and rooms, then **Save**.
4. Click **Update now** (top right). The first run takes a few minutes: it downloads listings,
   reads their descriptions and AI-ranks them. Click *log* to watch progress.

**3. Every time after that:**
1. Click **Update now** to fetch new listings. Only new or changed ones are AI-ranked, so it is
   quick and cheap.
2. Browse the **Listings** tab (best first), or ask the **AI search** tab, e.g.
   *"3 rooms near metro M2, up to 6000 with bills, show the best 5"*.
3. Mark flats ★ favorite or ✕ rejected. Rejected flats stay hidden.

**On your phone**

By default rentme can only be opened on the computer that runs it. To use it from your phone on the
same Wi-Fi:
1. Double-click **`start-lan.bat`**, or run `.venv\Scripts\python -m rentme serve --lan`.
2. The terminal prints a link like `http://192.168.1.23:8000/?key=AbC…`. Open it once on the phone
   (type it, or send it to yourself). The phone remembers the key, so after that
   `http://192.168.1.23:8000` is enough. Add it to your home screen for an app-like icon.
3. If Windows asks whether Python may use the network, allow **Private networks** only.

The computer must stay on with the window open. The key protects your API credits from other
people on the network. Don't share the link. `serve --lan --new-key` replaces the key and logs
out every device. If the first link doesn't load (e.g. you use a VPN), try the other addresses
it prints. This doesn't give access from outside your home network.

**Troubleshooting**
| Problem | Fix |
|---|---|
| `.venv not found` / `No module named rentme` | Run the commands from the project folder; do the setup first |
| Page says *frontend not built* | `cd web; npm install; npm run build` |
| Phone can't open the link | Same Wi-Fi? Try the other printed address; allow Python in Windows Firewall (Private) |
| Phone shows *access key needed* | Open the full link with `?key=…` from the terminal once |
| *address already in use* | rentme is already running (open the page), or use `serve --port 8765` |
| Yellow "no API key" banner | Settings → AI → paste the key → *Save key* |
| Chat says *rate limited* / *API error* | Wait a minute; check credits at console.anthropic.com |
| Few or no listings | Widen the filters in Settings, or ask the chat to, then click **Update now** |
| Changed the code in `web/` | Rebuild with `cd web; npm run build`, then restart the server |

## Use

- **Listings**: AI-ranked cards, quick filters, and tag chips (click once to require, twice to exclude).
  Description and photos load only when you click them. **Full / Short** switches whether cards show
  their tags and AI overview, and each card has its own **AI overview** and **Tags** toggles. Your filters
  and view are saved in this browser; **Reset filters** restores the defaults. In the photo viewer you can
  pinch or double-tap (double-click or mouse wheel on a computer) to zoom, and drag to move around.
  - **Notes**: **Add note** on any card (e.g. viewing time, what the landlord said). Notes are searchable,
    filterable (status → "With notes"), and the AI chat reads them as first-hand information.
  - **Find or add by link**: paste an otodom.pl or olx.pl offer link into the search box. A listing you
    already have is shown. A new Otodom offer is fetched and added, and a later update won't mark it as
    gone. New OLX offers can't be fetched automatically; use the OLX import in Settings.
  - **Map ↗** opens the location in Google Maps.
- **AI search**: chat with Claude in any language. Listings it mentions appear as cards, and it only
  knows listings already fetched. It can:
  - **find and compare** listings, reading full descriptions;
  - **hide or star** listings ("remove the one on Górczewska", "hide all without a balcony");
  - **rate** listings that have no AI score yet ("rate all unrated"). This costs API credits;
  - **analyze your starred** listings: total cost, layout, location, red flags, and a recommendation;
  - **change settings and filters** ("exclude Bemowo", "use the cheapest model"). Changes you clearly ask
    for are applied with an **Undo** button; others are proposals with **Apply**;
  - **remember** standing rules.
- **Settings**: every parameter, plus the API key.
- **Update now** (top right): scrape → fetch descriptions → filter → AI-rank.

CLI equivalents: `python -m rentme update | update --no-ai | rank --force | list -n 20`.

Frontend development: run `python -m rentme serve` and `cd web && npm run dev`, then open
http://localhost:5173. Vite proxies `/api` to the Python server.

## How it works

| Step | What happens |
|---|---|
| 1. Search | Each source turns the shared `[search]` filters into its own URL parameters and reads the result pages (Otodom: JSON in `__NEXT_DATA__`; OLX: its `/api/v1/offers` JSON). |
| 2. Cheap filter | Price (rent + czynsz), area, rooms, owner type, excluded tags and keywords are checked locally, because the platforms filter differently. |
| 3. Details | The offer page is fetched only for listings that passed step 2: full description, deposit, czynsz, coordinates, author and amenities. Photos are stored as **URLs only**. |
| 4. Tags | Platform codes are mapped to one vocabulary (`rentme/tags.py`), plus Polish/English keyword detection in the text (e.g. "zwierzęta mile widziane" → `pets_allowed`). |
| 5. AI | Claude gets batches of listings (text only) plus your preferences and returns a score from 0 to 100, a summary, pros and cons, red flags, extracted facts (pets, real monthly cost, minimum lease) and extra tags. |

Each listing record has: source, id, url, title, price, admin fee (czynsz), deposit, area, rooms,
floor, location (city, district, street, lat/lon), author name and type, unified tags, raw platform tags,
description, image URLs, publication date and available-from date.

### Web UI
- Cards are sorted by AI score. You can filter by text, minimum score, max price, source and status.
- Clicking a tag chip cycles it between **require**, **exclude** and **ignore**.
- **Description** and **Photos** are loaded only when you click them. Photos load straight from the platform's CDN, lazily.
- You can mark a listing ★ favorite, seen or rejected. Rejected listings are never sent to the AI again.
- The same flat posted on both platforms is detected (by price, area, rooms and district) and hidden as a duplicate.

## OLX is blocked

OLX is behind a CloudFront bot filter that currently returns **403** to scripts. rentme does not
try to get around this. When it happens, the OLX step is skipped and Otodom still works.
(Many OLX real-estate ads are mirrors of Otodom ads anyway, and those are skipped as duplicates.)
To include OLX by hand, use **Settings → Sources → Import from OLX**:
1. **Show OLX links**, then open one. It shows a page of raw text built from your saved filters, 40 listings per page.
2. On a computer, press Ctrl+S and upload the file. On a phone, select all, copy, and paste it into the box.
3. Click **Rank with AI now** to score the imported listings that pass your filters.

The same from the command line:

```powershell
.venv\Scripts\python -m rentme olx-url        # prints the OLX API URL for your filters
# open it in your normal browser, save the page as olx.json, then:
.venv\Scripts\python -m rentme import-olx olx.json
.venv\Scripts\python -m rentme rank
```

## Cost and model

By default it uses `claude-opus-5-5` at low effort, 6 listings per request, and a cached system prompt (all editable in Settings → AI).
Only listings that passed your filters are ranked, at most `max_per_run` per update.
You can change `model` in the config, for example to `claude-haiku-5-5` for much cheaper bulk ranking.

## Notes
- Requests are throttled (`[scrape].delay`) and identify themselves honestly. Keep `max_pages` modest.
  This is for personal use. Check each site's terms.
- If a site changes its page layout, the adapter in `rentme/sources/` is the only place that needs fixing.

## License

Source-available under the [PolyForm Noncommercial License 1.0.0](LICENSE.md).
You may use, copy, change and share it for any noncommercial purpose, such as personal use, study or hobby projects.
Charities, schools and public research or government organisations may also use it.
Any commercial use, including selling it, running it as a paid service, or using it inside a business, needs written permission from the author (falkura).
