# Porttivo API Deployment Guide

## Nginx Configuration

When deploying behind nginx as a reverse proxy, ensure `client_max_body_size` is set to at least **5MB** to support:

- Milestone image uploads (compressed to ~500KB by client, but allow margin)
- POD (Proof of Delivery) uploads
- Receipt uploads

The API uses Multer with a 5MB limit. nginx defaults to 1MB; requests larger than that return `413 Request Entity Too Large`.

### Example nginx block

```nginx
server {
    listen 80;
    server_name api.port.porttivo.com;

    client_max_body_size 5m;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    location /uploads {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
    }
}
```

### Quick fix

```nginx
client_max_body_size 5m;
```

Add this inside the `server` or `location` block that proxies to the API.

## Cashfree Payout Sandbox Env

For sandbox testing, set these environment variables on the server:

```env
CASHFREE_PAYOUT_MODE=sandbox
CASHFREE_PAYOUT_API_BASE_URL=https://sandbox.cashfree.com/payout
CASHFREE_PAYOUT_CLIENT_ID=<your sandbox payout client id>
CASHFREE_PAYOUT_CLIENT_SECRET=<your sandbox payout client secret>
```

If you are using the Porttivo API behind a public domain, also set:

```env
PUBLIC_API_BASE_URL=https://api.port.porttivo.com
```

Notes:
- Keep these values out of source control.
- Restart the API after updating env values.
- Beneficiary creation and payout transfer both depend on the payout client id and secret being present.
