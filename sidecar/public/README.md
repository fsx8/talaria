# public/ — SPA build output

The sidecar serves this directory as its static root (override with
`TBWEB_PUBLIC_DIR`). Build the SPA into it:

```sh
cd ../spa && npm install && npm run build   # writes straight into ../sidecar/public
```

`npm run dev` in `spa/` (with the sidecar running) is the faster inner loop —
it proxies `/api`, `/events` and `/health` to a live sidecar, so you don't
need to rebuild at all while developing.
