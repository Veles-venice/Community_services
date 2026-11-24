# Stockroom

Minimal inventory and accounting web app for an NGO or small shop. Items, stock in/out, low-stock alerts, monthly reports, CSV export. Black and white, mobile friendly, no external services or API keys.

- **Stack:** Node.js 22+ (zero npm dependencies), built-in SQLite, plain HTML/CSS/JS.
- **Run:** `npm start` then open http://localhost:3000
- **Test:** `npm test` (exercises every API route)

## Configuration (environment variables)
| Variable | Purpose | Default |
|---|---|---|
| `PORT` | Port to listen on | `3000` |
| `DATA_DIR` | Folder for the SQLite database | `./data` |
| `APP_PASSWORD` | If set, the site asks for this password (any username) | off |
| `CURRENCY` | 3-letter currency code, e.g. `INR`, `EUR` | `USD` |

## Deploy on Vercel (demo / sharing)
1. Push this folder to a GitHub repo.
2. In Vercel: **Add New → Project →** import the repo. Framework preset: **Other**. No build command, no environment variables needed.
3. Deploy. The site opens pre-filled with demo data (items and movements) so it's ready to show.

Vercel's filesystem is temporary, so on Vercel the data is **demo-only**: it resets on redeploys and idle periods, and can differ between server instances. For real records use Render/Docker below (persistent disk), or ask to add a hosted Postgres.
`APP_PASSWORD` only protects the API on Vercel (static pages are public by design), so don't put real data there.

## Deploy with persistent data
**Docker (any host):** `docker build -t stockroom . && docker run -p 3000:3000 -v stockroom-data:/data -e APP_PASSWORD=choose-one stockroom`

**Render:** push this folder to GitHub, create a Blueprint from `render.yaml`, set `APP_PASSWORD`. The 1 GB disk keeps data between deploys.

**Any Node host (Railway, Fly, VPS):** `node server.js` with a persistent `DATA_DIR`. Back up `inventory.db` or use the CSV exports.

## Pages
`#/` Overview · `#/items` Items · `#/movements` Movements · `#/reports` Reports

Stock is always computed from movements, so history and totals can't drift apart. Items with movements can't be deleted, and stock-out can't exceed what's on hand.
