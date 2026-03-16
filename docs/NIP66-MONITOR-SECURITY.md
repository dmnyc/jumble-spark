# NIP-66 monitor – security audit (nsec handling)

## Summary

The monitor **nsec** (`NIP66_MONITOR_NSEC`) is used only in the **nip66-cron** container. It is **never** sent to the web app container, written to config.json, or exposed to the client.

## Where the nsec may exist

| Location | Allowed? | Notes |
|----------|----------|--------|
| **Host env** (e.g. `.env`) | ✅ | Operator sets it; not in repo. |
| **jumble-nip66-monitor container env** | ✅ | Only service that needs it. |
| **jumble container env** | ❌ | Removed: nsec is not passed to the web app. |
| **config.json** (served to browser) | ❌ | Entrypoint writes only `NIP66_MONITOR_NPUB` or `{}`; never nsec. |
| **Frontend (Window.__RUNTIME_CONFIG__)** | ❌ | Type and fetch only include `NIP66_MONITOR_NPUB`. |
| **Vite / build** | ❌ | No `VITE_NIP66_*` or nsec in bundle. |

## Checks performed

1. **docker-entrypoint.sh** – Writes config.json only from `NIP66_MONITOR_NPUB`; does not read or write `NIP66_MONITOR_NSEC`.
2. **docker-compose.prod.yml** – `NIP66_MONITOR_NSEC` is set only on the **jumble-nip66-monitor** service; **jumble** has only `NIP66_MONITOR_NPUB`.
3. **main.tsx** – Fetches config and types only `NIP66_MONITOR_NPUB`; no nsec in `Window.__RUNTIME_CONFIG__`.
4. **nip66-monitor.ts** (frontend) – Stub only; `getMonitorSecretKey()` always returns `null`; no env or config read for nsec.
5. **nip66-cron/index.mjs** – Reads nsec from `process.env.NIP66_MONITOR_NSEC` only; never logs it or passes it to `log()`; comment added to never log or expose it.
6. **RelayInfo / RelayLivelinessSection** – Use only `window.__RUNTIME_CONFIG__.NIP66_MONITOR_NPUB` (npub) for display.

## Recommendation

- Keep **NIP66_MONITOR_NSEC** only in the host env and in the **jumble-nip66-monitor** service.
- Do not add nsec to the jumble service env, config.json, or any client-exposed config.
