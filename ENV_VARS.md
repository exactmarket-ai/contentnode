# Environment Variables for Railway Deployment

## API service (Dockerfile.api)

| Variable | Example | Notes |
|---|---|---|
| `DATABASE_URL` | `postgresql://...neon.tech/contentnode?sslmode=require` | From Neon dashboard |
| `REDIS_URL` | `redis://default:xxx@roundhouse.proxy.rlwy.net:6379` | From Railway Redis addon |
| `CLERK_SECRET_KEY` | `sk_live_...` | From Clerk dashboard |
| `CORS_ORIGIN` | `https://your-web.up.railway.app` | Your web service URL |
| `PORT` | `3001` | Railway uses this automatically |
| `NODE_ENV` | `production` | |
| `LOG_LEVEL` | `info` | |
| `ANTHROPIC_API_KEY` | `sk-ant-...` | From Anthropic console |
| `PORTAL_BASE_URL` | `https://your-web.up.railway.app` | Your web service URL |
| `S3_BUCKET` | `contentnode-files` | Your R2 bucket name |
| `S3_ENDPOINT` | `https://xxx.r2.cloudflarestorage.com` | From Cloudflare R2 |
| `S3_REGION` | `auto` | Use "auto" for R2 |
| `AWS_ACCESS_KEY_ID` | `xxx` | R2 API token key |
| `AWS_SECRET_ACCESS_KEY` | `xxx` | R2 API token secret |

## Worker service (Dockerfile.worker)

| Variable | Example | Notes |
|---|---|---|
| `DATABASE_URL` | same as API | |
| `REDIS_URL` | same as API | |
| `ANTHROPIC_API_KEY` | same as API | |
| `S3_BUCKET` | same as API | |
| `S3_ENDPOINT` | same as API | |
| `S3_REGION` | same as API | |
| `AWS_ACCESS_KEY_ID` | same as API | |
| `AWS_SECRET_ACCESS_KEY` | same as API | |
| `NODE_ENV` | `production` | |

## Web service (Dockerfile.web)

These are **build-time** variables — set them as Railway build variables (not runtime):

| Variable | Example | Notes |
|---|---|---|
| `VITE_API_URL` | `https://your-api.up.railway.app` | Your API service URL |
| `VITE_CLERK_PUBLISHABLE_KEY` | `pk_live_...` | From Clerk dashboard |
