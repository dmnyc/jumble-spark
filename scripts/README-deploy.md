# Deploy Jumble with docker-compose.prod.yml (remote server)

Workflow: **build and push locally** → **pull and run on the server**.

## Local: build and push

From the **repo root** on your machine:

```bash
docker login   # once, if needed
./scripts/build-and-push-prod.sh
```

This builds both images and pushes two tags each (`latest` and the version from `package.json`, e.g. `17.0.0`):

- **Main app:** `silberengel/imwald-jumble`
- **NIP-66 monitor:** `silberengel/imwald-jumble-nip66-monitor`

## Remote server: one-time setup

1. **Docker**  
   Install Docker and Docker Compose (v2).

2. **Clone the repo** (so you have `docker-compose.prod.yml`):
   ```bash
   git clone <your-repo-url> jumble
   cd jumble
   ```

3. **Optional env file** (e.g. for NIP-66 monitor):
   ```bash
   # .env next to docker-compose.prod.yml
   NIP66_MONITOR_NSEC=nsec1...
   NIP66_MONITOR_NPUB=npub1...
   ```

## Remote server: pull and run

After you’ve pushed from local:

```bash
cd jumble
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

The app is on **port 8089**. Both services use `:latest`; to pin a version, set the image in `docker-compose.prod.yml` to e.g. `silberengel/imwald-jumble:17.0.0` and `silberengel/imwald-jumble-nip66-monitor:17.0.0`.

## Useful commands (server)

```bash
# Status
docker compose -f docker-compose.prod.yml ps

# Logs
docker compose -f docker-compose.prod.yml logs -f

# Stop
docker compose -f docker-compose.prod.yml down
```
