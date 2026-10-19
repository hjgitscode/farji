// Triggers one chain-sync pass on a running FARJI app (the same endpoint a Vercel Cron job calls).
//   FARJI_APP_URL     base URL of the app (default http://localhost:3000)
//   FARJI_SYNC_TOKEN       shared token; the route refuses requests without it
const url = (process.env.FARJI_APP_URL ?? "http://localhost:3000").replace(/\/$/, "") + "/api/chain/sync";
const secret = process.env.FARJI_SYNC_TOKEN;

if (!secret) {
  console.error("FARJI_SYNC_TOKEN is not set.");
  process.exit(1);
}

fetch(url, { method: "POST", headers: { authorization: `Bearer ${secret}` } })
  .then(async (res) => {
    console.log(res.status, await res.text());
    process.exit(res.ok ? 0 : 1);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
